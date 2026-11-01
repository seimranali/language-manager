import type { Prisma, PrismaClient } from "@prisma/client";

export class AuditLogRepository {
  constructor(private readonly db: PrismaClient) {}

  async record(entry: { action: string; userId?: string; requestId?: string; metadata?: Prisma.InputJsonValue }) {
    await this.db.auditLog.create({ data: entry });
  }
}
