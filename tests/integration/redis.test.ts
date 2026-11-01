import IORedis from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisStore } from "@/infrastructure/cache/store";
import { BullJobQueue } from "@/infrastructure/queue/queues";

const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)("Redis adapters", () => {
  const redis = url ? new IORedis(url, { maxRetriesPerRequest: null }) : undefined;
  afterAll(async () => {
    await redis?.flushall();
    redis?.disconnect();
  });

  it("stores values and counts atomically with a TTL", async () => {
    const store = new RedisStore(redis!);
    await store.set("a", "1", 60);
    expect(await store.get("a")).toBe("1");
    const results = await Promise.all(Array.from({ length: 50 }, () => store.incrBy("counter", 1, 60)));
    expect(Math.max(...results.map((r) => r.value))).toBe(50);
    expect(results[0]!.ttlSeconds).toBeGreaterThan(0);
    expect(await store.ping()).toBe(true);
  });
  it("enqueues, reports depth and removes jobs", async () => {
    const queue = new BullJobQueue(redis!, 3);
    await queue.addTranslation("job-1");
    expect(await queue.depth()).toBe(1);
    await queue.removeTranslation("job-1");
    expect(await queue.depth()).toBe(0);
  });
});
