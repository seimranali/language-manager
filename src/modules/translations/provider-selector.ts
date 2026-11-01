import { getEnv } from "@/config/env";
import type { TranslationProviderFactory } from "@/providers/translation/translation-provider.factory";
import type { TranslationProvider, TranslationStyle } from "@/providers/translation/translation-provider.interface";
import { AppError } from "@/shared/errors";

export type ProviderMode = "google" | "claude" | "auto";

export interface SelectionInput {
  mode: ProviderMode;
  style: TranslationStyle;
  hasContext: boolean;
  hasLocaleGuidance: boolean;
  allowFallback: boolean;
}

const CONTEXTUAL_STYLES = new Set<TranslationStyle>(["formal", "business", "technical"]);

/** Returns providers in the order they may be tried; only the first runs unless policy allows fallback. */
export class ProviderSelector {
  constructor(private readonly factory: TranslationProviderFactory) {}

  /** The engine used for pronunciation guides, if one is configured. */
  pronouncer(): TranslationProvider | undefined {
    return this.factory.names().map((name) => this.factory.get(name)).find((p) => p.pronounce);
  }

  /** The engine used to read Roman Urdu, if one is configured. */
  romanUrduReader(): TranslationProvider | undefined {
    return this.factory.names().map((name) => this.factory.get(name)).find((p) => p.romanUrduToUrdu);
  }

  select(input: SelectionInput): TranslationProvider[] {
    const allowFallback = getEnv().TRANSLATION_ALLOW_FALLBACK;
    const all = this.factory.names().map((name) => this.factory.get(name));
    if (all.length === 0) throw new AppError("SERVICE_DISABLED", "No translation provider is configured.");

    if (input.mode !== "auto") {
      const chosen = this.factory.get(input.mode);
      if (!(allowFallback && input.allowFallback)) return [chosen];
      return [chosen, ...all.filter((p) => p !== chosen)];
    }

    const contextual = input.hasContext || input.hasLocaleGuidance || CONTEXTUAL_STYLES.has(input.style);
    const ranked = [...all].sort((a, b) => Number(contextual ? b.localeAware : a.localeAware) - Number(contextual ? a.localeAware : b.localeAware));
    const healthy = ranked.filter((p) => p.isHealthy());
    const ordered = allowFallback ? [...healthy, ...ranked.filter((p) => !p.isHealthy())] : ranked;
    return allowFallback ? ordered : ordered.slice(0, 1);
  }
}
