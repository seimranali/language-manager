import type { PrismaClient } from "@prisma/client";

export interface PreferenceChanges {
  preferredTargetLanguage?: string | null;
  preferredProvider?: string;
  translationStyle?: string;
  saveHistory?: boolean;
}

export class UserPreferenceRepository {
  constructor(private readonly db: PrismaClient) {}

  get(userId: string) {
    return this.db.userPreference.upsert({ where: { userId }, create: { userId }, update: {} });
  }
  update(userId: string, changes: PreferenceChanges) {
    return this.db.userPreference.upsert({ where: { userId }, create: { userId, ...changes }, update: changes });
  }
}
