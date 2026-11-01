import type { PrismaClient, TranslationStatus } from "@prisma/client";

export interface NewHistory {
  userId: string;
  sourceLanguage: string;
  provider: string;
  originalText: string;
  processingDurationMs: number;
  status: TranslationStatus;
  results: { targetLanguage: string; provider: string | null; translatedText: string | null; errorCode: string | null }[];
}

export class TranslationHistoryRepository {
  constructor(private readonly db: PrismaClient) {}

  async create({ results, ...history }: NewHistory) {
    await this.db.translationHistory.create({ data: { ...history, results: { create: results } } });
  }
  async listForUser(userId: string, page: number, pageSize: number) {
    const [items, total] = await this.db.$transaction([
      this.db.translationHistory.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { results: true },
      }),
      this.db.translationHistory.count({ where: { userId } }),
    ]);
    return { items, total };
  }
  findOwned(userId: string, id: string) {
    return this.db.translationHistory.findFirst({ where: { id, userId }, include: { results: true } });
  }
  async deleteOwned(userId: string, id: string) {
    const { count } = await this.db.translationHistory.deleteMany({ where: { id, userId } });
    return count === 1;
  }
  async deleteAll(userId: string) {
    const { count } = await this.db.translationHistory.deleteMany({ where: { userId } });
    return count;
  }
  async deleteOlderThan(cutoff: Date) {
    const { count } = await this.db.translationHistory.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
  }
}
