import { createHash } from "node:crypto";
import { getEnv } from "@/config/env";
import type { KeyValueStore } from "@/infrastructure/cache/store";
import { logger } from "@/infrastructure/logging/logger";

export interface CacheKeyParts {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  style: string;
  context?: string;
  audience?: string;
  glossary?: Record<string, string>;
  flags: string;
  /** Set for requests carrying private context, which must not be shared. */
  scopeUserId?: string;
}

export interface CachedTranslation {
  text: string;
  detectedSourceLanguage?: string;
  regionalized: boolean;
}

export class TranslationCacheService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly store: KeyValueStore) {}

  key(parts: CacheKeyParts): string {
    const glossary = parts.glossary ? Object.entries(parts.glossary).sort(([a], [b]) => a.localeCompare(b)) : null;
    const identity = JSON.stringify([
      "v1", parts.text.normalize("NFC").trim(), parts.sourceLanguage, parts.targetLanguage, parts.provider, parts.style,
      parts.context ?? null, parts.audience ?? null, glossary, parts.flags, parts.scopeUserId ?? null,
    ]);
    return `tr:${createHash("sha256").update(identity).digest("hex")}`;
  }

  /** Cache outages degrade to a miss rather than failing the translation. */
  async get(key: string): Promise<CachedTranslation | null> {
    if (!getEnv().TRANSLATION_CACHE_ENABLED) return null;
    try {
      const raw = await this.store.get(key);
      return raw ? (JSON.parse(raw) as CachedTranslation) : null;
    } catch (error) {
      logger.warn({ err: error }, "translation cache read failed");
      return null;
    }
  }

  async set(key: string, value: CachedTranslation): Promise<void> {
    const env = getEnv();
    if (!env.TRANSLATION_CACHE_ENABLED) return;
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > env.TRANSLATION_CACHE_MAX_ENTRY_BYTES) return;
    try {
      await this.store.set(key, raw, env.TRANSLATION_CACHE_TTL);
    } catch (error) {
      logger.warn({ err: error }, "translation cache write failed");
    }
  }

  /** Coalesces identical concurrent requests into one provider call. */
  singleFlight<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const promise = compute().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
