import type { LanguageRepository } from "@/repositories/language.repository";
import { AppError } from "@/shared/errors";
import type { TranslationProvider } from "@/providers/translation/translation-provider.interface";

export class LanguageService {
  constructor(private readonly languages: LanguageRepository) {}

  list() {
    return this.languages.listActive();
  }
  search(query: string) {
    return this.languages.search(query);
  }

  async get(code: string) {
    const language = await this.languages.findByCode(code);
    if (!language?.isActive) throw new AppError("NOT_FOUND", "The resource was not found.");
    return language;
  }

  async requireActive(code: string) {
    const language = await this.languages.findByCode(code);
    if (!language?.isActive) {
      throw new AppError("VALIDATION_ERROR", "The request contains invalid data.", {
        fields: [{ field: "language", message: `Unsupported language: ${code}` }],
      });
    }
    return language;
  }

  /** Adds languages a provider reports. Admin-managed fields on existing rows are kept. */
  async syncFrom(provider: TranslationProvider) {
    const reported = await provider.listLanguages();
    await Promise.all(reported.map((l) => this.languages.upsert({ code: l.code, name: l.name, nativeName: l.name })));
    return reported.length;
  }
}
