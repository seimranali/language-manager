import { AppError } from "@/shared/errors";
import type { TranslationProvider } from "./translation-provider.interface";

/** Registry of configured engines. A new engine only needs `register`. */
export class TranslationProviderFactory {
  private readonly providers = new Map<string, TranslationProvider>();

  register(provider: TranslationProvider) {
    this.providers.set(provider.name, provider);
    return this;
  }
  find(name: string) {
    return this.providers.get(name);
  }
  get(name: string): TranslationProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new AppError("SERVICE_DISABLED", `The ${name} provider is not configured.`);
    return provider;
  }
  names() {
    return [...this.providers.keys()];
  }
}
