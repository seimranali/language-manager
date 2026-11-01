import { getEnv } from "@/config/env";
import type { JobQueue } from "@/infrastructure/queue/queues";
import { logger } from "@/infrastructure/logging/logger";
import type { TranslationJobRepository } from "@/repositories/translation-job.repository";
import { assertOwner } from "@/security/authorization";
import { AppError, ProviderError } from "@/shared/errors";
import type { TranslationService } from "./translation.service";
import type { JobInput, MultilingualInput, TranslateInput } from "./translation.validation";

const publicJob = (job: { id: string; status: string; result: unknown; errorCode: string | null; createdAt: Date; completedAt: Date | null }) => ({
  jobId: job.id, status: job.status.toLowerCase(), result: job.result, error: job.errorCode ? { code: job.errorCode } : null,
  createdAt: job.createdAt, completedAt: job.completedAt,
});

export class TranslationJobService {
  constructor(
    private readonly jobs: TranslationJobRepository,
    private readonly queue: JobQueue,
    private readonly translations: TranslationService,
  ) {}

  async create(userId: string, input: JobInput, idempotencyKey?: string) {
    const env = getEnv();
    if (input.text.length > env.TRANSLATION_ASYNC_MAX_INPUT_LENGTH) {
      throw new AppError("VALIDATION_ERROR", "The request contains invalid data.", {
        fields: [{ field: "text", message: `Text must be at most ${env.TRANSLATION_ASYNC_MAX_INPUT_LENGTH} characters.` }],
      });
    }
    if ((await this.queue.depth()) >= env.JOB_QUEUE_MAX_DEPTH) {
      throw new AppError("OVERLOADED", "The translation queue is full. Please retry shortly.", { retryAfterSeconds: 30 });
    }
    const { job, created } = await this.jobs.createIdempotent(userId, idempotencyKey, input);
    if (created) {
      try {
        await this.queue.addTranslation(job.id);
      } catch (error) {
        await this.jobs.delete(job.id);
        logger.error({ err: error }, "job enqueue failed");
        throw new AppError("OVERLOADED", "The translation queue is unavailable. Please retry shortly.", { retryAfterSeconds: 30 });
      }
    }
    return publicJob(job);
  }

  private async owned(userId: string, jobId: string) {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new AppError("NOT_FOUND", "The resource was not found.");
    assertOwner(job.userId, userId);
    return job;
  }

  async get(userId: string, jobId: string) {
    return publicJob(await this.owned(userId, jobId));
  }

  async cancel(userId: string, jobId: string) {
    await this.owned(userId, jobId);
    if (!(await this.jobs.transition(jobId, ["QUEUED", "RUNNING"], "CANCELLED", { completedAt: new Date() }))) {
      throw new AppError("CONFLICT", "The job has already finished.");
    }
    await this.queue.removeTranslation(jobId);
    return publicJob(await this.owned(userId, jobId));
  }

  /** Runs in the worker. Throwing asks the queue to retry. */
  async process(jobId: string, attempt: number) {
    const started = await this.jobs.transition(jobId, ["QUEUED"], "RUNNING", { attempts: attempt });
    if (!started) return;
    const job = (await this.jobs.findById(jobId))!;
    const env = getEnv();
    const request = job.request as JobInput;
    try {
      const max = env.TRANSLATION_ASYNC_MAX_INPUT_LENGTH;
      const result = request.targetLanguage
        ? await this.translations.translate(job.userId, request as TranslateInput, max)
        : await this.translations.multilingual(job.userId, request as MultilingualInput, max);
      await this.jobs.transition(jobId, ["RUNNING"], "COMPLETED", { result: JSON.parse(JSON.stringify(result)), completedAt: new Date() });
    } catch (error) {
      const retry = error instanceof ProviderError ? error.transient : !(error instanceof AppError);
      if (retry && attempt < env.JOB_MAX_ATTEMPTS) {
        await this.jobs.transition(jobId, ["RUNNING"], "QUEUED");
        throw error;
      }
      const errorCode = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      await this.jobs.transition(jobId, ["RUNNING"], "FAILED", { errorCode, completedAt: new Date() });
      if (retry) throw error;
    }
  }
}
