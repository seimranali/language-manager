import { getEnv } from "@/config/env";
import type { KeyValueStore } from "@/infrastructure/cache/store";
import { logger } from "@/infrastructure/logging/logger";
import type { ProviderUsageRepository } from "@/repositories/provider-usage.repository";
import type { UserPreferenceRepository } from "@/repositories/user-preference.repository";
import type { UserRepository } from "@/repositories/user.repository";
import type { ProviderResult, TranslationProvider, TranslationStyle } from "@/providers/translation/translation-provider.interface";
import { AppError, type ErrorCode } from "@/shared/errors";
import { baseLanguage } from "@/shared/languages";
import type { LanguageService } from "@/modules/languages/language.service";
import type { ProviderMode, ProviderSelector } from "./provider-selector";
import type { TranslationCacheService } from "./translation-cache.service";
import type { TranslationHistoryService } from "./translation-history.service";
import type { MultilingualInput, TranslateInput } from "./translation.validation";
import { guidanceFor, TARGET_PROFILES, type TargetProfile } from "./targets";

const PASSTHROUGH = "none";
const URDU = "ur";
const PRONOUNCED_LANGUAGES = new Set(["nl"]);
const LATIN_LETTERS = /[a-z]/i;
const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

type Common = Omit<MultilingualInput, "text"> & { text: string };

interface Resolved {
  common: Common;
  userId: string;
  mode: ProviderMode;
  style: TranslationStyle;
  source?: string;
  historyOn: boolean;
}

interface TargetOutcome {
  text: string;
  provider: string;
  cached: boolean;
  regionalized: boolean;
  fallbackUsed: boolean;
  detectedSourceLanguage?: string;
}

export interface TargetView {
  languageCode: string;
  languageName: string;
  flag: string;
  text: string | null;
  status: string;
  pronunciation?: string | null;
}

export class TranslationService {
  constructor(
    private readonly selector: ProviderSelector,
    private readonly cache: TranslationCacheService,
    private readonly history: TranslationHistoryService,
    private readonly languages: LanguageService,
    private readonly preferences: UserPreferenceRepository,
    private readonly usage: ProviderUsageRepository,
    private readonly store: KeyValueStore,
    private readonly users: UserRepository,
  ) {}

  async translate(userId: string, input: TranslateInput, maxLength = getEnv().TRANSLATION_MAX_INPUT_LENGTH) {
    const started = Date.now();
    const target = await this.languages.requireActive(input.targetLanguage);
    const resolved = await this.resolve(userId, input, 1, maxLength);
    const outcome = await this.translateTarget(resolved, { code: target.code, name: target.name, guidance: guidanceFor(target.code) });
    const sourceLanguage = resolved.source ?? outcome.detectedSourceLanguage ?? "und";
    const processingDurationMs = Date.now() - started;
    if (resolved.historyOn) {
      await this.history.save({
        userId, sourceLanguage, provider: outcome.provider, originalText: input.text, processingDurationMs, status: "COMPLETED",
        results: [{ targetLanguage: target.code, provider: outcome.provider, translatedText: outcome.text, errorCode: null }],
      });
    }
    return {
      originalText: input.text,
      translatedText: outcome.text,
      sourceLanguage,
      targetLanguage: target.code,
      provider: outcome.provider,
      cached: outcome.cached,
      regionalized: outcome.regionalized,
      fallbackUsed: outcome.fallbackUsed,
    };
  }

  async multilingual(userId: string, input: MultilingualInput, maxLength = getEnv().TRANSLATION_MAX_INPUT_LENGTH) {
    const started = Date.now();
    const env = getEnv();
    const targets = env.MULTILINGUAL_TARGETS.map((key) => ({ key, profile: TARGET_PROFILES[key] })).filter(
      (t): t is { key: string; profile: TargetProfile } => Boolean(t.profile),
    );
    const resolved = await this.resolve(userId, input, targets.length, maxLength);
    resolved.source ??= await this.detect(resolved);
    const sourceName = await this.languages.get(resolved.source).then((l) => l.name, () => resolved.source!);

    // Each target is translated from the original text, never from another target.
    const settled = await Promise.allSettled(targets.map((t) => this.translateTarget(resolved, t.profile)));

    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length === targets.length || (failures.length > 0 && env.MULTILINGUAL_PARTIAL_FAILURE === "fail")) {
      throw failures[0]!.reason;
    }

    const translations: Record<string, TargetView> = Object.fromEntries(
      targets.map(({ key, profile }, index) => {
        const result = settled[index]!;
        const common = { languageCode: profile.code, languageName: profile.name, flag: profile.flag! };
        if (result.status === "fulfilled") {
          const { text, provider, cached, regionalized, fallbackUsed } = result.value;
          return [key, { ...common, text, status: "completed", provider, cached, regionalized, fallbackUsed }];
        }
        const code: ErrorCode = result.reason instanceof AppError ? result.reason.code : "INTERNAL_ERROR";
        if (code === "INTERNAL_ERROR") logger.error({ err: result.reason }, "multilingual target failed");
        return [key, { ...common, text: null, status: "failed", error: { code } }];
      }),
    );

    if (input.includePronunciation) await this.addPronunciation(translations);

    const succeeded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const providers = [...new Set(succeeded.map((r) => r.provider).filter((p) => p !== PASSTHROUGH))];
    const provider = providers.length > 1 ? "mixed" : (providers[0] ?? PASSTHROUGH);
    const status = failures.length > 0 ? "PARTIAL" : "COMPLETED";
    const processingDurationMs = Date.now() - started;

    if (resolved.historyOn) {
      await this.history.save({
        userId, sourceLanguage: resolved.source, provider, originalText: input.text, processingDurationMs, status,
        results: targets.map(({ profile }, index) => {
          const result = settled[index]!;
          return result.status === "fulfilled"
            ? { targetLanguage: profile.code, provider: result.value.provider, translatedText: result.value.text, errorCode: null }
            : { targetLanguage: profile.code, provider: null, translatedText: null, errorCode: result.reason instanceof AppError ? result.reason.code : "INTERNAL_ERROR" };
        }),
      });
    }

    return {
      sourceLanguage: { code: resolved.source, name: sourceName },
      originalText: input.text,
      translations,
      metadata: {
        provider,
        cached: succeeded.every((r) => r.cached),
        status: status.toLowerCase(),
        processingDurationMs,
      },
    };
  }

  /** Optional extra: its failure leaves `pronunciation` null and keeps the translations. */
  async addPronunciation(translations: Record<string, TargetView>) {
    const done = Object.values(translations).filter((t) => t.text !== null && PRONOUNCED_LANGUAGES.has(t.languageCode));
    if (done.length === 0) return;
    const items = done.map((t) => ({ languageCode: t.languageCode, languageName: t.languageName, text: t.text! }));
    let guide: Record<string, string> = {};
    try {
      guide = (await this.selector.pronouncer()?.pronounce?.(items)) ?? {};
    } catch (error) {
      logger.warn({ code: (error as AppError).code }, "pronunciation failed");
    }
    for (const t of done) t.pronunciation = guide[t.languageCode] ?? null;
  }

  private async resolve(userId: string, input: Common, targetCount: number, maxLength: number): Promise<Resolved> {
    const env = getEnv();
    if (input.text.length > maxLength) {
      throw new AppError("VALIDATION_ERROR", "The request contains invalid data.", {
        fields: [{ field: "text", message: `Text must be at most ${maxLength} characters.` }],
      });
    }
    const source = input.sourceLanguage === "auto" ? undefined : input.sourceLanguage;
    if (source) await this.languages.requireActive(source);
    const preferences = await this.preferences.get(userId);
    await this.chargeQuota(userId, input.text.length * targetCount);
    const urdu = await this.readRomanUrdu(userId, input.text, source);
    return {
      common: urdu ? { ...input, text: urdu } : input,
      userId,
      source: urdu ? URDU : source,
      mode: input.provider ?? (preferences.preferredProvider as ProviderMode),
      style: input.style ?? (preferences.translationStyle as TranslationStyle),
      historyOn: env.HISTORY_ENABLED && preferences.saveHistory && !input.sensitive,
    };
  }

  /** Google cannot read Urdu in Latin letters, so it gets Urdu script. On failure the text is translated as written. */
  private async readRomanUrdu(userId: string, text: string, source?: string): Promise<string | null> {
    if ((source && source !== URDU) || !LATIN_LETTERS.test(text) || ARABIC_SCRIPT.test(text)) return null;
    const user = await this.users.findById(userId);
    if (user?.nativeLanguageCode !== URDU) return null;
    try {
      return (await this.selector.romanUrduReader()?.romanUrduToUrdu?.(text)) ?? null;
    } catch (error) {
      logger.warn({ code: (error as AppError).code }, "roman urdu conversion failed");
      return null;
    }
  }

  private async chargeQuota(userId: string, characters: number) {
    const quota = getEnv().TRANSLATION_DAILY_CHAR_QUOTA;
    const key = `quota:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const { value, ttlSeconds } = await this.store.incrBy(key, characters, 90_000);
    if (value > quota) {
      await this.store.incrBy(key, -characters, 90_000);
      throw new AppError("QUOTA_EXCEEDED", "Your daily translation quota has been reached.", { retryAfterSeconds: ttlSeconds });
    }
  }

  private candidates(resolved: Resolved, guidance?: string) {
    const { common, mode, style } = resolved;
    return this.selector.select({
      mode,
      style,
      hasContext: Boolean(common.context || common.glossary),
      hasLocaleGuidance: Boolean(guidance),
      allowFallback: common.allowFallback,
    });
  }

  private async detect(resolved: Resolved): Promise<string> {
    const candidates = this.candidates(resolved, Object.values(TARGET_PROFILES).some((t) => t.guidance) ? "regional" : undefined);
    let failure: unknown;
    for (const provider of candidates) {
      try {
        return await provider.detect(resolved.common.text);
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  private async translateTarget(resolved: Resolved, target: TargetProfile): Promise<TargetOutcome> {
    const { source } = resolved;
    let failure: unknown;
    let supported = false;
    // Only Claude can follow writing guidance, so these targets leave the default provider. An explicit request provider still wins.
    const routed = target.guidance && !resolved.common.provider ? { ...resolved, mode: "auto" as const } : resolved;
    const candidates = this.candidates(routed, target.guidance);
    for (const [index, provider] of candidates.entries()) {
      if (!(await provider.supports(source, target.code))) continue;
      supported = true;
      try {
        return { ...(await this.withProvider(resolved, target, provider)), fallbackUsed: index > 0 };
      } catch (error) {
        failure = error;
        if (index + 1 < candidates.length) logger.warn({ provider: provider.name }, "translation falling back");
      }
    }
    if (!supported) throw new AppError("UNSUPPORTED_LANGUAGE_PAIR", "No configured provider supports this language pair.");
    throw failure;
  }

  private async withProvider(resolved: Resolved, target: TargetProfile, provider: TranslationProvider) {
    const { common, source, style, userId } = resolved;
    const guidance = provider.localeAware ? target.guidance : undefined;

    const sameLanguage = source !== undefined && (source === target.code || baseLanguage(source) === baseLanguage(target.code));
    if (sameLanguage && !guidance) {
      return { text: common.text, provider: PASSTHROUGH, cached: false, regionalized: false };
    }

    const useCache = !common.sensitive;
    const key = this.cache.key({
      text: common.text,
      sourceLanguage: source ?? "auto",
      targetLanguage: target.code,
      provider: provider.name,
      style,
      context: common.context,
      audience: common.audience,
      glossary: common.glossary,
      flags: `${common.preserveFormatting}|${common.correctGrammar}|${common.adaptIdioms}`,
      scopeUserId: common.context || common.audience || common.glossary ? userId : undefined,
    });
    if (useCache) {
      const hit = await this.cache.get(key);
      if (hit) return { ...hit, provider: provider.name, cached: true };
    }

    const call = async () => {
      const result: ProviderResult = await provider.translate({
        text: common.text,
        sourceLanguage: source,
        targetLanguage: target.code,
        targetLanguageName: target.name,
        style,
        context: common.context,
        audience: common.audience,
        glossary: common.glossary,
        preserveFormatting: common.preserveFormatting,
        correctGrammar: common.correctGrammar,
        adaptIdioms: common.adaptIdioms,
        localeGuidance: guidance,
      });
      const value = { text: result.text, detectedSourceLanguage: result.detectedSourceLanguage, regionalized: result.regionalized };
      if (useCache) await this.cache.set(key, value);
      await this.usage
        .record({ userId, provider: provider.name, model: result.model, ...result.usage })
        .catch((error) => logger.error({ err: error }, "usage record failed"));
      return value;
    };
    const value = await (useCache ? this.cache.singleFlight(key, call) : call());
    return { ...value, provider: provider.name, cached: false };
  }
}
