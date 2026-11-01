import { Queue, type ConnectionOptions } from "bullmq";

export const TRANSLATION_QUEUE = "translation-jobs";
export const TELEGRAM_QUEUE = "telegram-updates";
export const MAINTENANCE_QUEUE = "maintenance";

export interface JobQueue {
  addTranslation(jobId: string): Promise<void>;
  addTelegramUpdate(updateId: string, update: unknown): Promise<void>;
  removeTranslation(jobId: string): Promise<void>;
  depth(): Promise<number>;
}

export class BullJobQueue implements JobQueue {
  private readonly translation: Queue;
  private readonly telegram: Queue;

  constructor(connection: ConnectionOptions, private readonly maxAttempts: number) {
    this.translation = new Queue(TRANSLATION_QUEUE, { connection });
    this.telegram = new Queue(TELEGRAM_QUEUE, { connection });
  }

  async addTranslation(jobId: string) {
    await this.translation.add("translate", { jobId }, {
      jobId,
      attempts: this.maxAttempts,
      backoff: { type: "exponential", delay: 2_000, jitter: 0.5 },
      removeOnComplete: { count: 1_000 },
      // Failed entries stay in BullMQ's failed set, which is the dead-letter store.
      removeOnFail: { count: 10_000 },
    });
  }

  async addTelegramUpdate(updateId: string, update: unknown) {
    await this.telegram.add("update", update, {
      jobId: updateId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000, jitter: 0.5 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    });
  }

  async removeTranslation(jobId: string) {
    await (await this.translation.getJob(jobId))?.remove().catch(() => undefined);
  }

  depth() {
    return this.translation.getJobCountByTypes("waiting", "delayed", "active");
  }
}
