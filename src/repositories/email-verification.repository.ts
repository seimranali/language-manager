import type { PrismaClient } from "@prisma/client";

export class EmailVerificationRepository {
  constructor(private readonly db: PrismaClient) {}

  async replace(email: string, codeHash: string, expiresAt: Date) {
    await this.db.$transaction([
      this.db.emailVerification.deleteMany({ where: { email } }),
      this.db.emailVerification.create({ data: { email, codeHash, expiresAt } }),
    ]);
  }
  findCurrent(email: string) {
    return this.db.emailVerification.findFirst({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }
  async addAttempt(id: string) {
    await this.db.emailVerification.update({ where: { id }, data: { attempts: { increment: 1 } } });
  }
  async consume(id: string) {
    const { count } = await this.db.emailVerification.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }
}
