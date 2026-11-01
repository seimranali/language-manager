import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/infrastructure/cache/rate-limiter";
import { MemoryStore } from "@/infrastructure/cache/store";
import { ProviderGuard, Semaphore } from "@/providers/translation/provider-guard";
import { ProviderError } from "@/shared/errors";

const guard = (over = {}) =>
  new ProviderGuard(
    { provider: "x", concurrency: 2, queueLimit: 1, ratePerMinute: 1000, timeoutMs: 50, maxRetries: 2, failureThreshold: 3, resetMs: 60_000, baseDelayMs: 1, ...over },
    new RateLimiter(new MemoryStore(100)),
  );
const transient = () => new ProviderError("PROVIDER_UNAVAILABLE", "down", "x", true);
const permanent = () => new ProviderError("PROVIDER_ERROR", "bad", "x", false);

describe("ProviderGuard", () => {
  it("retries transient failures with a bound", async () => {
    const call = vi.fn().mockRejectedValueOnce(transient()).mockResolvedValue("ok");
    expect(await guard().run(call)).toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("stops after maxRetries", async () => {
    const call = vi.fn().mockRejectedValue(transient());
    await expect(guard({ failureThreshold: 100 }).run(call)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("does not retry permanent errors or count them against the circuit", async () => {
    const g = guard();
    const call = vi.fn().mockRejectedValue(permanent());
    for (let i = 0; i < 5; i += 1) await expect(g.run(call)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(call).toHaveBeenCalledTimes(5);
    expect(g.breaker.isOpen()).toBe(false);
  });
  it("times out a hanging provider and aborts its signal", async () => {
    let aborted = false;
    const call = (signal: AbortSignal) =>
      new Promise((_, reject) => signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }));
    await expect(guard({ maxRetries: 0 }).run(call)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(aborted).toBe(true);
  });
  it("opens the circuit and fails fast", async () => {
    const g = guard({ maxRetries: 0 });
    const call = vi.fn().mockRejectedValue(transient());
    for (let i = 0; i < 3; i += 1) await expect(g.run(call)).rejects.toBeDefined();
    await expect(g.run(call)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it("half-opens after the reset window", async () => {
    const g = guard({ maxRetries: 0, resetMs: 5 });
    for (let i = 0; i < 3; i += 1) await g.run(async () => { throw transient(); }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(await g.run(async () => "ok")).toBe("ok");
  });
  it("turns the provider rate limit into OVERLOADED", async () => {
    const g = guard({ ratePerMinute: 1 });
    await g.run(async () => 1);
    await expect(g.run(async () => 1)).rejects.toMatchObject({ code: "OVERLOADED" });
  });
});

describe("RateLimiter", () => {
  it("fails closed with a 503 when the store is down", async () => {
    const down = { get: vi.fn(), set: vi.fn(), ping: vi.fn(), incrBy: () => Promise.reject(new Error("redis down")) };
    await expect(new RateLimiter(down).consume("k", 1, 60)).rejects.toMatchObject({ code: "OVERLOADED", status: 503 });
  });
});

describe("Semaphore", () => {
  it("caps concurrency and rejects beyond the queue limit", async () => {
    const s = new Semaphore(1, 1);
    const first = await s.acquire();
    const waiting = s.acquire();
    await expect(s.acquire()).rejects.toMatchObject({ code: "OVERLOADED" });
    first();
    (await waiting)();
    (await s.acquire())();
  });
});
