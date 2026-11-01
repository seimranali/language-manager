import { logger } from "@/infrastructure/logging/logger";
import { metrics } from "@/infrastructure/metrics/metrics";
import type { RateLimiter } from "@/infrastructure/cache/rate-limiter";
import { AppError, ProviderError } from "@/shared/errors";

export interface GuardOptions {
  provider: string;
  concurrency: number;
  queueLimit: number;
  ratePerMinute: number;
  timeoutMs: number;
  maxRetries: number;
  failureThreshold: number;
  resetMs: number;
  baseDelayMs?: number;
}

/** Bounded FIFO semaphore: rejects instead of queueing without limit. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number, private readonly queueLimit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.queueLimit) {
        throw new AppError("OVERLOADED", "The translation service is busy. Please retry shortly.", { retryAfterSeconds: 5 });
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    };
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly provider: string, private readonly threshold: number, private readonly resetMs: number) {}

  /** After the reset window the circuit is half-open and admits calls again. */
  isOpen(): boolean {
    return this.failures >= this.threshold && Date.now() - this.openedAt < this.resetMs;
  }
  success() {
    this.failures = 0;
  }
  failure() {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      if (Date.now() - this.openedAt >= this.resetMs) {
        logger.error({ alert: "provider_circuit_open", provider: this.provider }, "provider circuit opened");
        metrics.inc("provider_circuit_open_total", { provider: this.provider });
      }
      this.openedAt = Date.now();
    }
  }
}

export class ProviderGuard {
  private readonly semaphore: Semaphore;
  readonly breaker: CircuitBreaker;

  constructor(private readonly options: GuardOptions, private readonly limiter: RateLimiter) {
    this.semaphore = new Semaphore(options.concurrency, options.queueLimit);
    this.breaker = new CircuitBreaker(options.provider, options.failureThreshold, options.resetMs);
  }

  /** Wraps one provider call with: circuit -> rate -> concurrency -> timeout + retries. */
  async run<T>(call: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
    const { provider, ratePerMinute, maxRetries } = this.options;
    if (this.breaker.isOpen()) {
      throw new ProviderError("PROVIDER_UNAVAILABLE", "The translation provider is temporarily unavailable.", provider, true);
    }
    await this.limiter.consume(`provider:${provider}`, ratePerMinute, 60).catch((error) => {
      if (error instanceof AppError && error.code === "RATE_LIMITED") {
        throw new AppError("OVERLOADED", "The translation service is busy. Please retry shortly.", error.details);
      }
      throw error;
    });
    const release = await this.semaphore.acquire();
    try {
      for (let attempt = 0; ; attempt += 1) {
        const started = Date.now();
        try {
          const result = await this.attempt(call, outer);
          this.breaker.success();
          metrics.inc("provider_requests_total", { provider, outcome: "success" });
          logger.debug({ provider, latencyMs: Date.now() - started }, "provider call succeeded");
          return result;
        } catch (error) {
          const transient = error instanceof ProviderError && error.transient;
          metrics.inc("provider_requests_total", { provider, outcome: "failure" });
          logger.warn({ provider, latencyMs: Date.now() - started, attempt, code: (error as AppError).code }, "provider call failed");
          if (transient) this.breaker.failure();
          if (!transient || attempt >= maxRetries || this.breaker.isOpen() || outer?.aborted) throw error;
          await this.backoff(attempt, error.retryAfterMs);
        }
      }
    } finally {
      release();
    }
  }

  private attempt<T>(call: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
    const { provider, timeoutMs } = this.options;
    const controller = new AbortController();
    const onOuter = () => controller.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError("PROVIDER_TIMEOUT", "The translation provider timed out.", provider, true));
        controller.abort();
      }, timeoutMs);
    });
    return Promise.race([call(controller.signal), timeout]).finally(() => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuter);
    });
  }

  private backoff(attempt: number, retryAfterMs?: number) {
    const ceiling = (this.options.baseDelayMs ?? 250) * 2 ** attempt;
    const delay = retryAfterMs ?? ceiling / 2 + Math.random() * (ceiling / 2);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
