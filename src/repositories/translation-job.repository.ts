import { Prisma, type PrismaClient, type JobStatus } from "@prisma/client";

export class TranslationJobRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Returns the existing job when the idempotency key was already used. */
  async createIdempotent(userId: string, idempotencyKey: string | undefined, request: unknown) {
    try {
      const job = await this.db.translationJob.create({
        data: { userId, idempotencyKey, request: request as Prisma.InputJsonValue },
      });
      return { job, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && idempotencyKey) {
        const job = await this.db.translationJob.findUniqueOrThrow({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
        return { job, created: false };
      }
      throw error;
    }
  }
  findById(id: string) {
    return this.db.translationJob.findUnique({ where: { id } });
  }
  async delete(id: string) {
    await this.db.translationJob.delete({ where: { id } });
  }
  /** Compare-and-set so cancellation and worker pickup cannot both succeed. */
  async transition(id: string, from: JobStatus[], to: JobStatus, extra: Prisma.TranslationJobUpdateManyMutationInput = {}) {
    const { count } = await this.db.translationJob.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...extra } });
    return count === 1;
  }
  async deleteFinishedBefore(cutoff: Date) {
    const { count } = await this.db.translationJob.deleteMany({
      where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, updatedAt: { lt: cutoff } },
    });
    return count;
  }
}
