import { getEnv } from "@/config/env";
import { getPrisma } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";

/** Refuses to serve with bad configuration, and closes pools on shutdown. */
export function startNode() {
  try {
    getEnv();
  } catch (error) {
    logger.fatal({ reason: (error as Error).message }, "startup aborted");
    process.exit(1);
  }
  const shutdown = () => void getPrisma().$disconnect();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
