const BASE = "https://translation.googleapis.com/language/translate/v2";

/** HTTP statuses expressed as the gRPC codes `mapGoogleError` understands. */
function grpcCode(status: number) {
  if (status === 429) return 8;
  return status >= 500 ? 14 : 3;
}

/** Translation API v2 with an API key, shaped like the v3 client methods the provider uses. */
export class GoogleApiKeyClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, body: unknown, timeout: number): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    }).catch(() => {
      throw { code: 14 };
    });
    if (!response.ok) throw { code: grpcCode(response.status) };
    return ((await response.json()) as { data: T }).data;
  }

  async translateText(
    request: { contents: string[]; sourceLanguageCode?: string; targetLanguageCode: string },
    options: { timeout: number },
  ) {
    const data = await this.request<{ translations: { translatedText: string; detectedSourceLanguage?: string }[] }>(
      "",
      { q: request.contents, source: request.sourceLanguageCode, target: request.targetLanguageCode, format: "text" },
      options.timeout,
    );
    const translations = data.translations.map((t) => ({ translatedText: t.translatedText, detectedLanguageCode: t.detectedSourceLanguage }));
    return [{ translations }] as [{ translations: typeof translations }];
  }

  async detectLanguage(request: { content: string }, options: { timeout: number }) {
    const data = await this.request<{ detections: { language: string }[][] }>("/detect", { q: request.content }, options.timeout);
    return [{ languages: [{ languageCode: data.detections[0]?.[0]?.language }] }] as [{ languages: { languageCode?: string }[] }];
  }

  async getSupportedLanguages(_request: unknown, options: { timeout: number }) {
    const data = await this.request<{ languages: { language: string; name: string }[] }>("/languages", { target: "en" }, options.timeout);
    return [{ languages: data.languages.map((l) => ({ languageCode: l.language, displayName: l.name })) }] as [{ languages: { languageCode: string; displayName: string }[] }];
  }
}
