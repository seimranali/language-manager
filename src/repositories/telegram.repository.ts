import { Prisma, type PrismaClient, type TelegramUpdateStatus } from "@prisma/client";

const IDENTITY = "telegram";

export class TelegramRepository {
  constructor(private readonly db: PrismaClient) {}

  /** The primary key makes this the idempotency gate for webhook deliveries. */
  async claimUpdate(updateId: number): Promise<boolean> {
    try {
      await this.db.telegramUpdate.create({ data: { updateId: BigInt(updateId) } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
  async releaseUpdate(updateId: number) {
    await this.db.telegramUpdate.deleteMany({ where: { updateId: BigInt(updateId) } });
  }
  async setUpdateStatus(updateId: number, status: TelegramUpdateStatus) {
    await this.db.telegramUpdate.updateMany({ where: { updateId: BigInt(updateId) }, data: { status } });
  }

  findLinkedUser(telegramUserId: string) {
    return this.db.externalIdentity.findUnique({
      where: { provider_externalUserId: { provider: IDENTITY, externalUserId: telegramUserId } },
      include: { user: true },
    });
  }
  /** Creates a Telegram-only account and its link atomically. Null if already linked. */
  async createLinkedUser(telegramUserId: string, data: { firstName: string; lastName: string; gender: string; nativeLanguageCode: string }) {
    try {
      return await this.db.user.create({
        data: { ...data, preferences: { create: {} }, externalIdentities: { create: { provider: IDENTITY, externalUserId: telegramUserId } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }

  /** False when either side of the link already exists. */
  async link(userId: string, telegramUserId: string) {
    try {
      await this.db.externalIdentity.create({ data: { userId, provider: IDENTITY, externalUserId: telegramUserId } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
  async unlink(telegramUserId: string) {
    const { count } = await this.db.externalIdentity.deleteMany({ where: { provider: IDENTITY, externalUserId: telegramUserId } });
    return count === 1;
  }

  async createLinkToken(data: { tokenHash: string; telegramUserId: string; chatId: string; draft?: Prisma.InputJsonValue; expiresAt: Date }) {
    await this.db.$transaction([
      this.db.telegramLinkToken.deleteMany({ where: { telegramUserId: data.telegramUserId, consumedAt: null } }),
      this.db.telegramLinkToken.create({ data }),
    ]);
  }
  findLinkToken(tokenHash: string) {
    return this.db.telegramLinkToken.findFirst({ where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } } });
  }
  async consumeLinkToken(id: string) {
    const { count } = await this.db.telegramLinkToken.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    return count === 1;
  }

  getConversation(telegramUserId: string) {
    return this.db.telegramConversation.findFirst({ where: { telegramUserId, expiresAt: { gt: new Date() } } });
  }
  async saveConversation(telegramUserId: string, step: string, data: Prisma.InputJsonValue, expiresAt: Date) {
    await this.db.telegramConversation.upsert({
      where: { telegramUserId },
      create: { telegramUserId, step, data, expiresAt },
      update: { step, data, expiresAt },
    });
  }
  async clearConversation(telegramUserId: string) {
    await this.db.telegramConversation.deleteMany({ where: { telegramUserId } });
  }
}
