import { logger } from "@/infrastructure/logging/logger";
import { AppError } from "@/shared/errors";
import type { KeyValueStore } from "./store";

export class RateLimiter {
  constructor(private readonly store: KeyValueStore) {}

  /** Fixed-window limit, shared by every process using the same store. */
  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    let counted;
    try {
      counted = await this.store.incrBy(`rl:${key}`, 1, windowSeconds);
    } catch (error) {
      // Fails closed: an outage must not switch off brute-force protection.
      logger.error({ err: error }, "rate limit store unavailable");
      throw new AppError("OVERLOADED", "The service is temporarily unavailable.", { retryAfterSeconds: 5 });
    }
    const { value, ttlSeconds } = counted;
    if (value > limit) {
      throw new AppError("RATE_LIMITED", "Too many requests. Please try again later.", { retryAfterSeconds: ttlSeconds });
    }
  }
}
