import type { NewHistory, TranslationHistoryRepository } from "@/repositories/translation-history.repository";
import { AppError } from "@/shared/errors";
import { logger } from "@/infrastructure/logging/logger";

const notFound = () => new AppError("NOT_FOUND", "The resource was not found.");

export class TranslationHistoryService {
  constructor(private readonly history: TranslationHistoryRepository) {}

  /** A history failure must not lose a translation the user already paid for. */
  async save(entry: NewHistory) {
    try {
      await this.history.create(entry);
    } catch (error) {
      logger.error({ err: error }, "translation history write failed");
    }
  }
  async list(userId: string, page: number, pageSize: number) {
    const { items, total } = await this.history.listForUser(userId, page, pageSize);
    return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }
  async get(userId: string, id: string) {
    const entry = await this.history.findOwned(userId, id);
    if (!entry) throw notFound();
    return entry;
  }
  async delete(userId: string, id: string) {
    if (!(await this.history.deleteOwned(userId, id))) throw notFound();
  }
  async deleteAll(userId: string) {
    return { deleted: await this.history.deleteAll(userId) };
  }
}
