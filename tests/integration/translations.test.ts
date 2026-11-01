import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/config/env";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as confirm } from "@/app/api/v1/auth/verify-mobile/confirm/route";
import { GET as languages } from "@/app/api/v1/languages/route";
import { GET as search } from "@/app/api/v1/languages/search/route";
import { GET as language } from "@/app/api/v1/languages/[code]/route";
import { DELETE as clearHistory, GET as history } from "@/app/api/v1/translations/history/route";
import { DELETE as deleteEntry, GET as historyEntry } from "@/app/api/v1/translations/history/[id]/route";
import { POST as cancelJob } from "@/app/api/v1/translations/jobs/[jobId]/cancel/route";
import { GET as getJob } from "@/app/api/v1/translations/jobs/[jobId]/route";
import { POST as createJob } from "@/app/api/v1/translations/jobs/route";
import { POST as multilingual } from "@/app/api/v1/translations/multilingual/route";
import { POST as translate } from "@/app/api/v1/translations/route";
import { GET as ready } from "@/app/api/v1/health/ready/route";
import { PATCH as updatePreferences } from "@/app/api/v1/users/me/preferences/route";
import { getContainer } from "@/container";
import { ProviderError } from "@/shared/errors";
import { call, db, nextMobile, PASSWORD, registration, resetWorld, type World } from "./harness";

let world: World;
let token: string;

async function signIn() {
  const mobile = nextMobile();
  await call(register, { body: registration(mobile) });
  await call(confirm, { body: { mobile, code: world.sms.codeFor(mobile) } });
  return (await call(login, { body: { mobile, password: PASSWORD } })).json.data.accessToken as string;
}

beforeEach(async () => {
  world = await resetWorld();
  token = await signIn();
});
afterEach(() => {
  for (const key of ["MULTILINGUAL_PARTIAL_FAILURE", "TRANSLATION_ALLOW_FALLBACK", "TRANSLATION_DAILY_CHAR_QUOTA", "TRANSLATION_MAX_INPUT_LENGTH", "RATE_LIMIT_MAX_REQUESTS"]) delete process.env[key];
  process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
  resetEnvForTests();
});

const TEXT = "Bonjour, comment allez-vous aujourd'hui ?";

describe("POST /translations", () => {
  it("requires auth", async () => {
    expect((await call(translate, { body: { text: "x", targetLanguage: "ar" } })).status).toBe(401);
  });
  it("translates and reports provider output, not invented data", async () => {
    const { status, json } = await call(translate, { token, body: { text: "Hello", sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ translatedText: "[google:fr] Hello", sourceLanguage: "en", targetLanguage: "fr", provider: "google", cached: false });
  });
  it("rejects empty text, oversize text and catalog-unknown languages", async () => {
    expect((await call(translate, { token, body: { text: "  ", targetLanguage: "ar" } })).status).toBe(400);
    expect((await call(translate, { token, body: { text: "a", targetLanguage: "xx" } })).status).toBe(400);
    process.env.TRANSLATION_MAX_INPUT_LENGTH = "3";
    resetEnvForTests();
    expect((await call(translate, { token, body: { text: "abcd", targetLanguage: "ar" } })).status).toBe(400);
  });
  it("returns 422 when no provider supports the pair", async () => {
    world.google.unsupported.add("hi");
    const { status, json } = await call(translate, { token, body: { text: "a", targetLanguage: "hi", provider: "google" } });
    expect(status).toBe(422);
    expect(json.error.code).toBe("UNSUPPORTED_LANGUAGE_PAIR");
  });
  it("serves the second identical call from cache, across users for plain text", async () => {
    const body = { text: "Cached", sourceLanguage: "en", targetLanguage: "fr", provider: "google" };
    await call(translate, { token, body });
    const other = await signIn();
    expect((await call(translate, { token: other, body })).json.data.cached).toBe(true);
    expect(world.google.calls).toHaveLength(1);
  });
  it("does not share a context-bearing entry between users", async () => {
    const body = { text: "Private", sourceLanguage: "en", targetLanguage: "fr", provider: "google", context: "secret project" };
    await call(translate, { token, body });
    const other = await signIn();
    expect((await call(translate, { token: other, body })).json.data.cached).toBe(false);
  });
  it("never caches or stores sensitive requests", async () => {
    const body = { text: "Medical", sourceLanguage: "en", targetLanguage: "fr", provider: "google", sensitive: true };
    await call(translate, { token, body });
    expect((await call(translate, { token, body })).json.data.cached).toBe(false);
    expect(await db.translationHistory.count()).toBe(0);
  });
  it("coalesces concurrent identical requests", async () => {
    const body = { text: "Together", sourceLanguage: "en", targetLanguage: "fr", provider: "google" };
    const results = await Promise.all(Array.from({ length: 10 }, () => call(translate, { token, body })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(world.google.calls).toHaveLength(1);
  });
  it("does not switch providers without policy and consent", async () => {
    world.google.failFor.add("fr");
    const body = { text: "x", sourceLanguage: "en", targetLanguage: "fr", provider: "google", allowFallback: true };
    expect((await call(translate, { token, body })).status).toBe(503);
    expect(world.claude.calls).toHaveLength(0);
    process.env.TRANSLATION_ALLOW_FALLBACK = "true";
    resetEnvForTests();
    const { json } = await call(translate, { token, body });
    expect(json.data).toMatchObject({ provider: "claude", fallbackUsed: true });
  });
  it("maps a provider timeout to a standardized 503", async () => {
    world.google.failFor.add("fr");
    world.google.failure = () => new ProviderError("PROVIDER_TIMEOUT", "timed out", "google", true);
    const { status, json } = await call(translate, { token, body: { text: "x", sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    expect(status).toBe(503);
    expect(json.error).toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
  it("enforces the daily quota", async () => {
    process.env.TRANSLATION_DAILY_CHAR_QUOTA = "5";
    resetEnvForTests();
    const { status, json, headers } = await call(translate, { token, body: { text: "too long", targetLanguage: "fr" } });
    expect(status).toBe(429);
    expect(json.error.code).toBe("QUOTA_EXCEEDED");
    expect(headers.get("retry-after")).toBeTruthy();
  });
  it("enforces rate limits", async () => {
    process.env.RATE_LIMIT_MAX_REQUESTS = "2";
    resetEnvForTests();
    const results = [await call(languages), await call(languages), await call(languages)];
    expect(results.map((r) => r.status)).toEqual([200, 200, 429]);
  });
  it("records usage", async () => {
    await call(translate, { token, body: { text: "Usage", sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    expect(await db.providerUsage.count()).toBe(1);
  });
});

describe("POST /translations/multilingual", () => {
  it("returns all three translations from the original, in the contract shape", async () => {
    const { status, json } = await call(multilingual, { token, body: { text: TEXT, sourceLanguage: "auto", provider: "claude" } });
    expect(status).toBe(200);
    expect(json.data.sourceLanguage).toEqual({ code: "fr", name: "French" });
    expect(json.data.originalText).toBe(TEXT);
    expect(json.data.translations.dutch).toMatchObject({ languageCode: "nl", languageName: "Dutch", text: `[claude:nl] ${TEXT}` });
    expect(json.data.translations.english).toMatchObject({ languageCode: "en", text: `[claude:en] ${TEXT}` });
    expect(json.data.translations.arabicSaudiArabia).toMatchObject({ languageCode: "ar-SA", languageName: "Arabic (Saudi Arabia)", text: `[claude:ar-SA] ${TEXT}`, regionalized: true });
    expect(json.data.metadata).toMatchObject({ provider: "claude", cached: false });
    expect(world.claude.calls.every((c) => c.text === TEXT)).toBe(true);
  });
  it("applies writing guidance to Dutch and Arabic but not English", async () => {
    await call(multilingual, { token, body: { text: TEXT, provider: "claude" } });
    expect(world.claude.calls.find((c) => c.targetLanguage === "ar-SA")?.localeGuidance).toMatch(/Saudi/);
    expect(world.claude.calls.find((c) => c.targetLanguage === "nl")?.localeGuidance).toContain("Dutch");
    expect(world.claude.calls.find((c) => c.targetLanguage === "en")?.localeGuidance).toBeUndefined();
  });
  it("is honest when Google cannot regionalize", async () => {
    const { json } = await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    expect(json.data.translations.arabicSaudiArabia).toMatchObject({ languageCode: "ar-SA", regionalized: false });
  });
  it("in auto mode routes Dutch and Arabic to Claude and English to Google", async () => {
    const { json } = await call(multilingual, { token, body: { text: TEXT, provider: "auto" } });
    expect(json.data.translations.arabicSaudiArabia.provider).toBe("claude");
    expect(json.data.translations.dutch.provider).toBe("claude");
    expect(json.data.translations.english.provider).toBe("google");
    expect(json.data.metadata.provider).toBe("mixed");
  });
  it("does not retranslate a target already in the source language", async () => {
    world.google.detected = "en";
    const { json } = await call(multilingual, { token, body: { text: "Hello", provider: "google" } });
    expect(json.data.translations.english).toMatchObject({ text: "Hello", provider: "none" });
    expect(world.google.calls.map((c) => c.targetLanguage).sort()).toEqual(["ar-SA", "nl"]);
  });
  it("returns partial results and never fabricates the failed one", async () => {
    world.google.failFor.add("nl");
    const { status, json } = await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    expect(status).toBe(200);
    expect(json.data.translations.dutch).toMatchObject({ text: null, status: "failed", error: { code: "PROVIDER_UNAVAILABLE" } });
    expect(json.data.translations.english.status).toBe("completed");
    expect(json.data.metadata.status).toBe("partial");
  });
  it("can be configured to fail the whole request", async () => {
    process.env.MULTILINGUAL_PARTIAL_FAILURE = "fail";
    resetEnvForTests();
    world.google.failFor.add("nl");
    expect((await call(multilingual, { token, body: { text: TEXT, provider: "google" } })).status).toBe(503);
  });
  it("errors when every target fails", async () => {
    for (const code of ["nl", "en", "ar-SA"]) world.google.failFor.add(code);
    expect((await call(multilingual, { token, body: { text: TEXT, provider: "google" } })).status).toBe(503);
  });
  it("caches per target", async () => {
    await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    const { json } = await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    expect(json.data.metadata.cached).toBe(true);
    expect(world.google.calls).toHaveLength(3);
  });
  it("stores all three in history", async () => {
    await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    const row = await db.translationHistory.findFirstOrThrow({ include: { results: true } });
    expect(row).toMatchObject({ originalText: TEXT, sourceLanguage: "fr", provider: "google", status: "COMPLETED" });
    expect(row.results.map((r) => r.targetLanguage).sort()).toEqual(["ar-SA", "en", "nl"]);
  });
  it("respects the saveHistory preference", async () => {
    await call(updatePreferences, { method: "PATCH", token, body: { saveHistory: false } });
    await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    expect(await db.translationHistory.count()).toBe(0);
  });
});

describe("pronunciation", () => {
  it("is added per target only on request", async () => {
    const plain = await call(multilingual, { token, body: { text: TEXT, provider: "google" } });
    expect(plain.json.data.translations.dutch.pronunciation).toBeUndefined();
    const { json } = await call(multilingual, { token, body: { text: TEXT, provider: "google", includePronunciation: true } });
    expect(json.data.translations.dutch.pronunciation).toBe("say nl");
    expect(json.data.translations.arabicSaudiArabia.pronunciation).toBeUndefined();
    expect(json.data.translations.english.pronunciation).toBeUndefined();
  });
  it("keeps translations when it fails, and skips failed targets", async () => {
    world.claude.pronounceFails = true;
    const { status, json } = await call(multilingual, { token, body: { text: TEXT, provider: "google", includePronunciation: true } });
    expect(status).toBe(200);
    expect(json.data.translations.dutch).toMatchObject({ status: "completed", pronunciation: null });
  });
});

describe("Roman Urdu", () => {
  const ROMAN = "aap kaise hain";
  const URDU_TEXT = "آپ کیسے ہیں";
  const send = () => call(multilingual, { token, body: { text: ROMAN, provider: "google" } });
  const makeUrduNative = () => db.user.updateMany({ data: { nativeLanguageCode: "ur" } });

  it("translates the Urdu reading for native Urdu speakers and keeps the original", async () => {
    await makeUrduNative();
    world.claude.romanUrdu = URDU_TEXT;
    const { json } = await send();
    expect(json.data.originalText).toBe(ROMAN);
    expect(json.data.sourceLanguage.code).toBe("ur");
    expect(json.data.translations.dutch.text).toBe(`[google:nl] ${URDU_TEXT}`);
    expect(world.google.calls[0]!.sourceLanguage).toBe("ur");
  });
  it("leaves other languages from native Urdu speakers alone", async () => {
    await makeUrduNative();
    const { json } = await send();
    expect(json.data.translations.dutch.text).toBe(`[google:nl] ${ROMAN}`);
  });
  it("does not apply to other native languages", async () => {
    world.claude.romanUrdu = URDU_TEXT;
    const { json } = await send();
    expect(json.data.translations.dutch.text).toBe(`[google:nl] ${ROMAN}`);
  });
  it("translates the text as written when the conversion fails", async () => {
    await makeUrduNative();
    world.claude.romanUrdu = new Error("down");
    const { status, json } = await send();
    expect(status).toBe(200);
    expect(json.data.translations.dutch.text).toBe(`[google:nl] ${ROMAN}`);
  });
});

describe("history access", () => {
  it("paginates and isolates users", async () => {
    for (const text of ["a", "b", "c"]) await call(translate, { token, body: { text, sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    const page = await call(history, { token, query: "?page=1&pageSize=2" });
    expect(page.json.data.items).toHaveLength(2);
    expect(page.json.data.pagination).toMatchObject({ total: 3, totalPages: 2 });
    const other = await signIn();
    expect((await call(history, { token: other })).json.data.items).toHaveLength(0);
    const id = page.json.data.items[0].id;
    expect((await call(historyEntry, { token: other, params: { id } })).status).toBe(404);
    expect((await call(deleteEntry, { method: "DELETE", token: other, params: { id } })).status).toBe(404);
    expect((await call(deleteEntry, { method: "DELETE", token, params: { id } })).status).toBe(200);
    expect((await call(clearHistory, { method: "DELETE", token })).json.data.deleted).toBe(2);
  });
  it("purges entries past retention", async () => {
    await call(translate, { token, body: { text: "old", sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    await db.translationHistory.updateMany({ data: { createdAt: new Date(0) } });
    await getContainer().maintenanceService.runRetention();
    expect(await db.translationHistory.count()).toBe(0);
  });
});

describe("jobs", () => {
  const poll = async (jobId: string) => {
    for (let i = 0; i < 100; i += 1) {
      const job = await call(getJob, { token, params: { jobId } });
      if (["completed", "failed", "cancelled"].includes(job.json.data.status)) return job;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("job did not finish");
  };
  it("runs a multilingual job to completion", async () => {
    const { status, json } = await call(createJob, { token, body: { text: TEXT, provider: "google" } });
    expect(status).toBe(202);
    const done = await poll(json.data.jobId);
    expect(done.json.data.status).toBe("completed");
    expect(done.json.data.result.translations.dutch.text).toContain("[google:nl]");
  });
  it("is idempotent per key and private per user", async () => {
    const headers = { "idempotency-key": "same" };
    const first = await call(createJob, { token, headers, body: { text: "a", targetLanguage: "fr", provider: "google" } });
    const second = await call(createJob, { token, headers, body: { text: "a", targetLanguage: "fr", provider: "google" } });
    expect(second.json.data.jobId).toBe(first.json.data.jobId);
    await poll(first.json.data.jobId);
    const other = await signIn();
    expect((await call(getJob, { token: other, params: { jobId: first.json.data.jobId } })).status).toBe(404);
    expect((await call(cancelJob, { method: "POST", token: other, params: { jobId: first.json.data.jobId } })).status).toBe(404);
  });
  it("records terminal failure and refuses to cancel a finished job", async () => {
    world.google.failFor.add("fr");
    const { json } = await call(createJob, { token, body: { text: "a", sourceLanguage: "en", targetLanguage: "fr", provider: "google" } });
    const done = await poll(json.data.jobId);
    expect(done.json.data).toMatchObject({ status: "failed", error: { code: "PROVIDER_UNAVAILABLE" } });
    expect((await call(cancelJob, { method: "POST", token, params: { jobId: json.data.jobId } })).status).toBe(409);
  });
  it("applies backpressure when the queue is full", async () => {
    const full = { addTranslation: async () => {}, addTelegramUpdate: async () => {}, removeTranslation: async () => {}, depth: async () => 1_000_000 };
    world = await resetWorld({ queue: full });
    token = await signIn();
    expect((await call(createJob, { token, body: { text: "a", targetLanguage: "fr" } })).status).toBe(503);
  });
});

describe("catalog and health", () => {
  it("lists, gets and searches", async () => {
    expect((await call(languages)).json.data.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(["nl", "en", "ar-SA"]));
    expect((await call(language, { params: { code: "ar-SA" } })).json.data.nativeName).toContain("السعودية");
    expect((await call(language, { params: { code: "xx" } })).status).toBe(404);
    expect((await call(search, { query: "?q=arab" })).json.data).toHaveLength(2);
  });
  it("reports readiness without internals", async () => {
    const response = await ready();
    expect(await response.json()).toEqual({ status: "ready" });
  });
});
