import { PrismaClient } from "@prisma/client";

export const LANGUAGES = [
  ["en", "English", "English"],
  ["ar", "Arabic", "العربية"],
  ["ar-SA", "Arabic (Saudi Arabia)", "العربية (السعودية)"],
  ["nl", "Dutch", "Nederlands"],
  ["ur", "Urdu", "اردو"],
  ["hi", "Hindi", "हिन्दी"],
  ["fr", "French", "Français"],
  ["es", "Spanish", "Español"],
  ["de", "German", "Deutsch"],
  ["zh", "Chinese", "中文"],
] as const;

export async function seed(db: PrismaClient) {
  for (const [code, name, nativeName] of LANGUAGES) {
    await db.language.upsert({ where: { code }, create: { code, name, nativeName }, update: {} });
  }
}

if (/(prisma\/seed\.ts|dist\/seed\.js)$/.test(process.argv[1]?.replace(/\\/g, "/") ?? "")) {
  const db = new PrismaClient();
  seed(db).finally(() => db.$disconnect());
}
