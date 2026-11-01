import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/config/env";
import { MemoryStore } from "@/infrastructure/cache/store";
import { ProviderSelector, type SelectionInput } from "@/modules/translations/provider-selector";
import { TranslationCacheService } from "@/modules/translations/translation-cache.service";
import { TranslationProviderFactory } from "@/providers/translation/translation-provider.factory";
import { FakeProvider } from "../helpers/fakes";

const google = new FakeProvider("google");
const claude = new FakeProvider("claude", true);
const selector = new ProviderSelector(new TranslationProviderFactory().register(google).register(claude));
const input: SelectionInput = { mode: "auto", style: "natural", hasContext: false, hasLocaleGuidance: false, allowFallback: false };
const names = (over: Partial<SelectionInput>) => selector.select({ ...input, ...over }).map((p) => p.name);

afterEach(() => {
  delete process.env.TRANSLATION_ALLOW_FALLBACK;
  resetEnvForTests();
  google.healthy = true;
});

describe("provider selection", () => {
  it("routes general text to Google", () => expect(names({})).toEqual(["google"]));
  it("routes context, formal style and regional targets to Claude", () => {
    expect(names({ hasContext: true })).toEqual(["claude"]);
    expect(names({ style: "business" })).toEqual(["claude"]);
    expect(names({ hasLocaleGuidance: true })).toEqual(["claude"]);
  });
  it("honours explicit modes without switching", () => {
    expect(names({ mode: "google", hasLocaleGuidance: true })).toEqual(["google"]);
    expect(names({ mode: "claude", allowFallback: true })).toEqual(["claude"]);
  });
  it("needs both server policy and request consent to fall back", () => {
    process.env.TRANSLATION_ALLOW_FALLBACK = "true";
    resetEnvForTests();
    expect(names({ mode: "google" })).toEqual(["google"]);
    expect(names({ mode: "google", allowFallback: true })).toEqual(["google", "claude"]);
  });
  it("auto avoids unhealthy providers when fallback is allowed", () => {
    process.env.TRANSLATION_ALLOW_FALLBACK = "true";
    resetEnvForTests();
    google.healthy = false;
    expect(names({})).toEqual(["claude", "google"]);
  });
  it("errors for an unconfigured provider", () => {
    const only = new ProviderSelector(new TranslationProviderFactory().register(google));
    expect(() => only.select({ ...input, mode: "claude" })).toThrowError(/not configured/);
  });
});

describe("translation cache", () => {
  const cache = new TranslationCacheService(new MemoryStore(100));
  const parts = { text: "Hi", sourceLanguage: "en", targetLanguage: "ar", provider: "google", style: "natural", flags: "x" };

  it("separates every attribute that changes the output", () => {
    const base = cache.key(parts);
    for (const change of [{ text: "Ho" }, { targetLanguage: "nl" }, { provider: "claude" }, { style: "formal" }, { context: "c" }, { glossary: { a: "b" } }, { scopeUserId: "u" }, { flags: "y" }]) {
      expect(cache.key({ ...parts, ...change })).not.toBe(base);
    }
  });
  it("ignores glossary key order and surrounding whitespace", () => {
    expect(cache.key({ ...parts, glossary: { a: "1", b: "2" } })).toBe(cache.key({ ...parts, glossary: { b: "2", a: "1" } }));
    expect(cache.key({ ...parts, text: " Hi " })).toBe(cache.key(parts));
  });
  it("coalesces concurrent identical calls", async () => {
    const compute = vi.fn(async () => "v");
    const results = await Promise.all([cache.singleFlight("k", compute), cache.singleFlight("k", compute)]);
    expect(results).toEqual(["v", "v"]);
    expect(compute).toHaveBeenCalledTimes(1);
  });
  it("survives a store outage as a miss", async () => {
    const broken = new TranslationCacheService({ get: () => Promise.reject(new Error("x")), set: () => Promise.reject(new Error("x")), incrBy: vi.fn(), ping: vi.fn() });
    expect(await broken.get("k")).toBeNull();
    await expect(broken.set("k", { text: "t", regionalized: false })).resolves.toBeUndefined();
  });
});
