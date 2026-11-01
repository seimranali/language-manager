import { getEnv } from "@/config/env";
import { logger } from "@/infrastructure/logging/logger";
import type { MaintenanceRepository } from "@/repositories/maintenance.repository";
import type { TranslationHistoryRepository } from "@/repositories/translation-history.repository";
import type { TranslationJobRepository } from "@/repositories/translation-job.repository";

const DAY = 86_400_000;

export class MaintenanceService {
  constructor(
    private readonly maintenance: MaintenanceRepository,
    private readonly history: TranslationHistoryRepository,
    private readonly jobs: TranslationJobRepository,
  ) {}

  /** Applies the retention policy; scheduled hourly by the worker. */
  async runRetention() {
    const cutoff = new Date(Date.now() - getEnv().HISTORY_RETENTION_DAYS * DAY);
    const history = await this.history.deleteOlderThan(cutoff);
    const jobs = await this.jobs.deleteFinishedBefore(cutoff);
    await this.maintenance.purgeExpired(new Date(Date.now() - 7 * DAY));
    logger.info({ history, jobs }, "retention run complete");
  }
  ping() {
    return this.maintenance.ping();
  }
}
