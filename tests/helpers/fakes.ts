import type { ProviderRequest, ProviderResult, TranslationProvider } from "@/providers/translation/translation-provider.interface";
import { ProviderError } from "@/shared/errors";
import type { TelegramClient } from "@/infrastructure/telegram/telegram-client";
import type { SmsSender } from "@/infrastructure/sms/sms-sender";

export class FakeProvider implements TranslationProvider {
  calls: ProviderRequest[] = [];
  failFor = new Set<string>();
  failure: () => Error = () => new ProviderError("PROVIDER_UNAVAILABLE", "down", this.name, true);
  healthy = true;
  unsupported = new Set<string>();

  constructor(readonly name: string, readonly localeAware = false, public detected = "fr") {}

  async translate(request: ProviderRequest): Promise<ProviderResult> {
    this.calls.push(request);
    if (this.failFor.has(request.targetLanguage)) throw this.failure();
    return {
      text: `[${this.name}:${request.targetLanguage}] ${request.text}`,
      detectedSourceLanguage: this.detected,
      regionalized: Boolean(request.localeGuidance),
      usage: { characters: request.text.length },
    };
  }
  async detect() {
    return this.detected;
  }
  async supports(_source: string | undefined, target: string) {
    return !this.unsupported.has(target);
  }
  async listLanguages() {
    return [];
  }
  pronounceFails = false;
  get pronounce() {
    if (!this.localeAware) return undefined;
    return async (items: { languageCode: string; text: string }[]) => {
      if (this.pronounceFails) throw new Error("down");
      return Object.fromEntries(items.map((i) => [i.languageCode, `say ${i.languageCode}`]));
    };
  }
  romanUrdu: string | null | Error = null;
  get romanUrduToUrdu() {
    if (!this.localeAware) return undefined;
    return async () => {
      if (this.romanUrdu instanceof Error) throw this.romanUrdu;
      return this.romanUrdu;
    };
  }
  isHealthy() {
    return this.healthy;
  }
}

export class FakeTelegram implements TelegramClient {
  sent: { chatId: string; text: string; markup?: unknown; original?: string }[] = [];
  async sendMessage(chatId: string, text: string, markup?: unknown) {
    this.sent.push({ chatId, text, markup });
    return this.sent.length - 1;
  }
  async editMessage(_chatId: string, messageId: number, text: string) {
    const message = this.sent[messageId]!;
    message.original = message.text;
    message.text = text;
  }
  async sendTyping() {}
}

export class FakeSms implements SmsSender {
  messages: { to: string; body: string }[] = [];
  async send(to: string, body: string) {
    this.messages.push({ to, body });
  }
  codeFor(mobile: string) {
    return [...this.messages].reverse().find((m) => m.to === mobile)?.body.match(/\d{6}/)?.[0];
  }
}
