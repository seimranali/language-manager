import { splitText } from "@/shared/text";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export type ReplyMarkup = Record<string, unknown>;

export interface TelegramClient {
  /** Returns the id of the last message sent. */
  sendMessage(chatId: string, text: string, replyMarkup?: ReplyMarkup): Promise<number | undefined>;
  editMessage(chatId: string, messageId: number, text: string): Promise<void>;
  sendTyping(chatId: string): Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds?: number) {
    super(`Telegram API responded ${status}`);
  }
}

export class HttpTelegramClient implements TelegramClient {
  constructor(private readonly botToken: string) {}

  async call(method: string, payload: unknown): Promise<unknown> {
    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return ((await response.json()) as { result?: unknown }).result;
    const body = (await response.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
    throw new TelegramApiError(response.status, body.parameters?.retry_after);
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: ReplyMarkup) {
    const parts = splitText(text, TELEGRAM_MESSAGE_LIMIT);
    let messageId: number | undefined;
    for (const [index, part] of parts.entries()) {
      const sent = await this.sendWithRetry({
        chat_id: chatId,
        text: part,
        ...(index === parts.length - 1 && replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
      messageId = (sent as { message_id?: number } | undefined)?.message_id;
    }
    return messageId;
  }

  async editMessage(chatId: string, messageId: number, text: string) {
    await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text });
  }

  async sendTyping(chatId: string) {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  private async sendWithRetry(payload: unknown) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.call("sendMessage", payload);
      } catch (error) {
        const retryable = error instanceof TelegramApiError && (error.status === 429 || error.status >= 500);
        if (!retryable || attempt >= 2) throw error;
        await new Promise((r) => setTimeout(r, (error.retryAfterSeconds ?? 2 ** attempt) * 1000));
      }
    }
  }
}
