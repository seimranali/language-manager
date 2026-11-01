import { logger } from "@/infrastructure/logging/logger";
import type { AuditLogRepository } from "@/repositories/audit-log.repository";

export class AuditService {
  constructor(private readonly audit: AuditLogRepository) {}

  /** Audit failures are logged and never break the audited operation. */
  async record(action: string, userId?: string, requestId?: string, metadata?: Record<string, string | number | boolean>) {
    try {
      await this.audit.record({ action, userId, requestId, metadata });
    } catch (error) {
      logger.error({ err: error, action }, "audit write failed");
    }
  }
}
