import { PrismaClient } from "@prisma/client";

const holder = globalThis as unknown as { prisma?: PrismaClient };

/** Pool size and TLS are set on DATABASE_URL (`connection_limit`, `sslmode`). */
export function getPrisma(): PrismaClient {
  holder.prisma ??= new PrismaClient();
  return holder.prisma;
}

export type { PrismaClient };
