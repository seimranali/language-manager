import type { PrismaClient } from "@prisma/client";

export class LanguageRepository {
  constructor(private readonly db: PrismaClient) {}

  listActive() {
    return this.db.language.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  }
  findByCode(code: string) {
    return this.db.language.findUnique({ where: { code } });
  }
  search(query: string) {
    return this.db.language.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { nativeName: { contains: query, mode: "insensitive" } },
          { code: { startsWith: query, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: 50,
    });
  }
  async upsert(language: { code: string; name: string; nativeName: string }) {
    await this.db.language.upsert({
      where: { code: language.code },
      create: language,
      update: { name: language.name },
    });
  }
}
