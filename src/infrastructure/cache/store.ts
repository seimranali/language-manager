import IORedis, { type Redis } from "ioredis";

/** Small KV surface shared by caching, rate limits and quotas. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Adds to a counter and starts its TTL when it is first created. */
  incrBy(key: string, amount: number, ttlSeconds: number): Promise<{ value: number; ttlSeconds: number }>;
  ping(): Promise<boolean>;
}

const INCR_SCRIPT = `
local value = redis.call('INCRBY', KEYS[1], ARGV[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[2]); ttl = tonumber(ARGV[2]) end
return {value, ttl}`;

export class RedisStore implements KeyValueStore {
  constructor(private readonly redis: Redis) {}

  get(key: string) {
    return this.redis.get(key);
  }
  async set(key: string, value: string, ttlSeconds: number) {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
  async incrBy(key: string, amount: number, ttlSeconds: number) {
    const [value, ttl] = (await this.redis.eval(INCR_SCRIPT, 1, key, amount, ttlSeconds)) as [number, number];
    return { value, ttlSeconds: ttl };
  }
  async ping() {
    try {
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }
}

/** Single-process stand-in for development and tests. Bounded FIFO. */
export class MemoryStore implements KeyValueStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly maxEntries: number) {}

  private read(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
  private write(key: string, value: string, expiresAt: number) {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expiresAt });
  }
  async get(key: string) {
    return this.read(key)?.value ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number) {
    this.write(key, value, Date.now() + ttlSeconds * 1000);
  }
  async incrBy(key: string, amount: number, ttlSeconds: number) {
    const entry = this.read(key);
    const value = Number(entry?.value ?? 0) + amount;
    const expiresAt = entry?.expiresAt ?? Date.now() + ttlSeconds * 1000;
    this.write(key, String(value), expiresAt);
    return { value, ttlSeconds: Math.ceil((expiresAt - Date.now()) / 1000) };
  }
  async ping() {
    return true;
  }
}

/**
 * Request-path clients must fail fast when Redis is down, or every request would
 * wait forever. Only BullMQ workers block on Redis, and they require retries.
 */
export function createRedis(url: string, role: "request" | "worker" = "request"): Redis {
  if (role === "worker") return new IORedis(url, { maxRetriesPerRequest: null });
  return new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 2_000 });
}
