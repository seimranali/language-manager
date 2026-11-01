import type { PrismaClient } from "@prisma/client";

export class ProviderUsageRepository {
  constructor(private readonly db: PrismaClient) {}

  async record(entry: {
    userId: string;
    provider: string;
    model?: string;
    characters: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }) {
    await this.db.providerUsage.create({ data: entry });
  }
}
