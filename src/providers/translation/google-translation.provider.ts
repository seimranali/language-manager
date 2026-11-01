import { v3 } from "@google-cloud/translate";
import { ProviderError } from "@/shared/errors";
import { baseLanguage, normalizeLanguageCode } from "@/shared/languages";
import { splitText } from "@/shared/text";
import type { ProviderGuard } from "./provider-guard";
import type { ProviderRequest, ProviderResult, TranslationProvider } from "./translation-provider.interface";

const NAME = "google";
// Google recommends staying under 5,000 code points per request segment.
const SEGMENT_LIMIT = 5_000;
const BATCH_LIMIT = 25_000;
const TRANSIENT_GRPC = new Set([4, 8, 10, 13, 14]);
const LANGUAGE_LIST_TTL_MS = 6 * 60 * 60 * 1000;

/** Google keeps a few regional variants; every other locale maps to its base language. */
const NATIVE_VARIANTS = new Set(["zh-CN", "zh-TW", "pt-PT", "pt-BR", "fr-CA"]);
export const toGoogleCode = (code: string) => (NATIVE_VARIANTS.has(code) ? code : baseLanguage(code));

export function mapGoogleError(error: unknown): ProviderError {
  const code = (error as { code?: number }).code;
  if (code === 4) return new ProviderError("PROVIDER_TIMEOUT", "The translation provider timed out.", NAME, true);
  if (code !== undefined && TRANSIENT_GRPC.has(code)) {
    return new ProviderError("PROVIDER_UNAVAILABLE", "The translation provider is temporarily unavailable.", NAME, true);
  }
  return new ProviderError("PROVIDER_ERROR", "The translation provider rejected the request.", NAME, false);
}

/** The calls used here; met by the v3 SDK client and GoogleApiKeyClient. */
export interface GoogleClient {
  translateText(request: { parent: string; contents: string[]; mimeType: string; sourceLanguageCode?: string; targetLanguageCode: string }, options: { timeout: number }): Promise<readonly [{ translations?: { translatedText?: string | null; detectedLanguageCode?: string | null }[] | null }, ...unknown[]]>;
  detectLanguage(request: { parent: string; content: string; mimeType: string }, options: { timeout: number }): Promise<readonly [{ languages?: { languageCode?: string | null }[] | null }, ...unknown[]]>;
  getSupportedLanguages(request: { parent: string; displayLanguageCode: string }, options: { timeout: number }): Promise<readonly [{ languages?: { languageCode?: string | null; displayName?: string | null }[] | null }, ...unknown[]]>;
}

interface GoogleConfig {
  projectId: string;
  location: string;
  timeoutMs: number;
  costPerMillionChars: number;
}

export class GoogleTranslationProvider implements TranslationProvider {
  readonly name = NAME;
  readonly localeAware = false;
  private languages?: { at: number; codes: Promise<{ code: string; name: string }[]> };

  constructor(
    private readonly config: GoogleConfig,
    private readonly guard: ProviderGuard,
    client?: GoogleClient,
  ) {
    this.client = client ?? (new v3.TranslationServiceClient() as unknown as GoogleClient);
  }

  private readonly client: GoogleClient;

  private get parent() {
    return `projects/${this.config.projectId}/locations/${this.config.location}`;
  }

  /** Google cannot honour `localeGuidance`, so results report `regionalized: false`. */
  async translate(request: ProviderRequest): Promise<ProviderResult> {
    const segments = splitText(request.text, SEGMENT_LIMIT);
    const batches: string[][] = [];
    let size = 0;
    for (const segment of segments) {
      if (!batches.length || size + segment.length > BATCH_LIMIT) {
        batches.push([]);
        size = 0;
      }
      batches.at(-1)!.push(segment);
      size += segment.length;
    }

    let text = "";
    let detectedSourceLanguage: string | undefined;
    for (const contents of batches) {
      const response = await this.guard.run(async () => {
        try {
          const [result] = await this.client.translateText(
            {
              parent: this.parent,
              contents,
              mimeType: "text/plain",
              sourceLanguageCode: request.sourceLanguage ? toGoogleCode(request.sourceLanguage) : undefined,
              targetLanguageCode: toGoogleCode(request.targetLanguage),
            },
            { timeout: this.config.timeoutMs },
          );
          return result;
        } catch (error) {
          throw mapGoogleError(error);
        }
      }, request.signal);
      for (const item of response.translations ?? []) {
        text += item.translatedText ?? "";
        if (item.detectedLanguageCode) detectedSourceLanguage ??= normalizeLanguageCode(item.detectedLanguageCode);
      }
    }
    if (!text) throw new ProviderError("PROVIDER_ERROR", "The translation provider returned no text.", NAME, false);

    const characters = request.text.length;
    return {
      text,
      detectedSourceLanguage,
      regionalized: false,
      usage: { characters, estimatedCostUsd: (characters / 1_000_000) * this.config.costPerMillionChars },
    };
  }

  async detect(text: string, signal?: AbortSignal) {
    return this.guard.run(async () => {
      try {
        const [result] = await this.client.detectLanguage(
          { parent: this.parent, content: text.slice(0, SEGMENT_LIMIT), mimeType: "text/plain" },
          { timeout: this.config.timeoutMs },
        );
        const code = result.languages?.[0]?.languageCode;
        if (!code) throw new ProviderError("PROVIDER_ERROR", "The language could not be detected.", NAME, false);
        return normalizeLanguageCode(code);
      } catch (error) {
        throw error instanceof ProviderError ? error : mapGoogleError(error);
      }
    }, signal);
  }

  listLanguages() {
    if (!this.languages || Date.now() - this.languages.at > LANGUAGE_LIST_TTL_MS) {
      const codes = this.guard.run(async () => {
        try {
          const [result] = await this.client.getSupportedLanguages(
            { parent: this.parent, displayLanguageCode: "en" },
            { timeout: this.config.timeoutMs },
          );
          return (result.languages ?? []).flatMap((l) =>
            l.languageCode ? [{ code: normalizeLanguageCode(l.languageCode), name: l.displayName ?? l.languageCode }] : [],
          );
        } catch (error) {
          throw mapGoogleError(error);
        }
      });
      this.languages = { at: Date.now(), codes };
      codes.catch(() => (this.languages = undefined));
    }
    return this.languages.codes;
  }

  async supports(sourceLanguage: string | undefined, targetLanguage: string) {
    let codes: Set<string>;
    try {
      codes = new Set((await this.listLanguages()).map((l) => l.code));
    } catch {
      return true; // Let the translate call decide when capabilities are unknown.
    }
    const known = (code: string) => codes.has(toGoogleCode(code));
    return known(targetLanguage) && (!sourceLanguage || known(sourceLanguage));
  }

  isHealthy() {
    return !this.guard.breaker.isOpen();
  }
}
