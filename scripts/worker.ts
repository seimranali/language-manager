import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getEnv } from "@/config/env";
import { getContainer } from "@/container";
import { createRedis } from "@/infrastructure/cache/store";
import { logger } from "@/infrastructure/logging/logger";
import { metrics } from "@/infrastructure/metrics/metrics";
import { MAINTENANCE_QUEUE, TELEGRAM_QUEUE, TRANSLATION_QUEUE } from "@/infrastructure/queue/queues";
import { getPrisma } from "@/infrastructure/database/prisma";
import { telegramUpdateSchema } from "@/modules/telegram/telegram.validation";

async function main() {
  const env = getEnv();
  const container = getContainer();
  if (!env.REDIS_URL) throw new Error("The worker requires REDIS_URL.");
  const connection: ConnectionOptions = createRedis(env.REDIS_URL, "worker");

  const workers = [
    new Worker(TRANSLATION_QUEUE, (job) => container.jobService.process(job.data.jobId, job.attemptsMade + 1), { connection, concurrency: env.JOB_WORKER_CONCURRENCY }),
    new Worker(TELEGRAM_QUEUE, (job) => container.telegramService.process(telegramUpdateSchema.parse(job.data)), { connection, concurrency: env.JOB_WORKER_CONCURRENCY }),
    new Worker(MAINTENANCE_QUEUE, () => container.maintenanceService.runRetention(), { connection, concurrency: 1 }),
  ];
  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      metrics.inc("job_failures_total", { queue: worker.name });
      logger.error({ queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade, code: (error as { code?: string }).code }, "job failed");
    });
  }
  await new Queue(MAINTENANCE_QUEUE, { connection }).upsertJobScheduler("retention", { every: 3_600_000 });
  logger.info("worker started");

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // close() waits for active jobs; unfinished ones are recovered as stalled.
    await Promise.all(workers.map((w) => w.close()));
    await getPrisma().$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
