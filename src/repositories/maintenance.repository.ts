import type { PrismaClient } from "@prisma/client";

export class MaintenanceRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Removes expired security and idempotency records. Revoked tokens stay until expiry for reuse detection. */
  async purgeExpired(updatesBefore: Date) {
    const now = new Date();
    await this.db.$transaction([
      this.db.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.mobileVerification.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.emailVerification.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.telegramLinkToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.telegramConversation.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.telegramUpdate.deleteMany({ where: { receivedAt: { lt: updatesBefore } } }),
    ]);
  }
  async ping() {
    await this.db.$queryRaw`SELECT 1`;
  }
}
