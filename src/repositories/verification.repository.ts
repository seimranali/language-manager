import type { PrismaClient } from "@prisma/client";

export class VerificationRepository {
  constructor(private readonly db: PrismaClient) {}

  async replace(mobile: string, codeHash: string, expiresAt: Date) {
    await this.db.$transaction([
      this.db.mobileVerification.deleteMany({ where: { mobile } }),
      this.db.mobileVerification.create({ data: { mobile, codeHash, expiresAt } }),
    ]);
  }
  findCurrent(mobile: string) {
    return this.db.mobileVerification.findFirst({
      where: { mobile, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }
  async addAttempt(id: string) {
    await this.db.mobileVerification.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }
  /** False when another request already consumed the code. */
  async consume(id: string) {
    const { count } = await this.db.mobileVerification.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }
}
