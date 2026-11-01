export type TranslationStyle = "natural" | "formal" | "informal" | "business" | "technical";

export interface ProviderRequest {
  text: string;
  /** Undefined asks the provider to detect the language. */
  sourceLanguage?: string;
  targetLanguage: string;
  /** Human name, e.g. "Arabic (Saudi Arabia)". */
  targetLanguageName: string;
  style: TranslationStyle;
  context?: string;
  audience?: string;
  glossary?: Record<string, string>;
  preserveFormatting: boolean;
  correctGrammar: boolean;
  adaptIdioms: boolean;
  /** Regional writing rules; a provider unable to apply them reports `regionalized: false`. */
  localeGuidance?: string;
  signal?: AbortSignal;
}

export interface ProviderResult {
  text: string;
  detectedSourceLanguage?: string;
  regionalized: boolean;
  model?: string;
  usage: { characters: number; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number };
}

/** Every engine (Google, Claude, a future DeepL) implements this contract. */
export interface TranslationProvider {
  readonly name: string;
  /** Whether `localeGuidance` is honoured; drives routing of regional targets. */
  readonly localeAware: boolean;
  translate(request: ProviderRequest): Promise<ProviderResult>;
  detect(text: string, signal?: AbortSignal): Promise<string>;
  supports(sourceLanguage: string | undefined, targetLanguage: string): Promise<boolean>;
  listLanguages(): Promise<{ code: string; name: string }[]>;
  isHealthy(): boolean;
  /** Optional: spells each text in simple Latin letters, keyed by language code. */
  pronounce?(items: { languageCode: string; languageName: string; text: string }[], signal?: AbortSignal): Promise<Record<string, string>>;
  /** Optional: rewrites Roman Urdu in Urdu script; null when the text is not Roman Urdu. */
  romanUrduToUrdu?(text: string, signal?: AbortSignal): Promise<string | null>;
}
