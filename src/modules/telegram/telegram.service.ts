import type { JobQueue } from "@/infrastructure/queue/queues";
import { logger } from "@/infrastructure/logging/logger";
import { TELEGRAM_MESSAGE_LIMIT, type TelegramClient } from "@/infrastructure/telegram/telegram-client";
import type { TelegramRepository } from "@/repositories/telegram.repository";
import { AppError } from "@/shared/errors";
import { getEnv } from "@/config/env";
import type { LanguageService } from "@/modules/languages/language.service";
import type { TranslationHistoryService } from "@/modules/translations/translation-history.service";
import type { TranslationService } from "@/modules/translations/translation.service";
import { multilingualSchema, translateSchema } from "@/modules/translations/translation.validation";
import type { UserService } from "@/modules/users/user.service";
import { parseOrThrow } from "@/shared/validation";
import type { TelegramLinkService } from "./telegram-link.service";
import { parseCommand, type TelegramUpdate } from "./telegram.validation";

const HELP = `Commands:
/register - create an account
/login - link an existing account
/translate <text> - translate text
/language <code> - set your preferred target language
/mylanguage - show your language settings
/history - show recent translations
/logout - unlink this Telegram account
/help - show this message

Once linked, any text you send is translated into Dutch, English and Saudi Arabic.`;

const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const NEED_LINK = "Please link an account first: send /login or /register.";

type Message = NonNullable<TelegramUpdate["message"]>;
type Draft = Record<string, string>;

export class TelegramService {
  constructor(
    private readonly telegram: TelegramRepository,
    private readonly client: TelegramClient,
    private readonly queue: JobQueue,
    private readonly translations: TranslationService,
    private readonly history: TranslationHistoryService,
    private readonly users: UserService,
    private readonly languages: LanguageService,
    private readonly links: TelegramLinkService,
  ) {}

  /** Webhook entry: dedupes, enqueues and returns quickly. */
  async accept(update: TelegramUpdate): Promise<{ duplicate: boolean }> {
    if (!(await this.telegram.claimUpdate(update.update_id))) return { duplicate: true };
    try {
      await this.queue.addTelegramUpdate(String(update.update_id), update);
    } catch (error) {
      // Release the claim so Telegram's redelivery can succeed.
      await this.telegram.releaseUpdate(update.update_id);
      throw error;
    }
    return { duplicate: false };
  }

  async process(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    try {
      // Private chats only: group messages may hold other people's content.
      if (message?.from && !message.from.is_bot && message.chat.type === "private") await this.handle(message);
      await this.telegram.setUpdateStatus(update.update_id, "PROCESSED");
    } catch (error) {
      await this.telegram.setUpdateStatus(update.update_id, "FAILED");
      throw error;
    }
  }

  private async handle(message: Message) {
    const telegramUserId = String(message.from!.id);
    const chatId = String(message.chat.id);
    try {
      const parsed = message.text ? parseCommand(message.text) : null;
      if (parsed) return await this.command(parsed.command, parsed.args, telegramUserId, chatId);
      const conversation = await this.telegram.getConversation(telegramUserId);
      if (conversation) return await this.registrationStep(conversation.step, conversation.data as Draft, message, telegramUserId, chatId);
      if (message.text) return await this.translateAll(message.text, telegramUserId, chatId);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      logger.info({ code: error.code }, "telegram request rejected");
      await this.client.sendMessage(chatId, error.message);
    }
  }

  private async linkedUserId(telegramUserId: string): Promise<string | null> {
    const identity = await this.telegram.findLinkedUser(telegramUserId);
    return identity?.user.isActive ? identity.userId : null;
  }

  private async command(command: string, args: string, telegramUserId: string, chatId: string) {
    const userId = await this.linkedUserId(telegramUserId);
    const requireLink = async (run: (id: string) => Promise<unknown>) => (userId ? run(userId) : this.client.sendMessage(chatId, NEED_LINK));
    switch (command) {
      case "start":
        return this.client.sendMessage(chatId, `Welcome to Language Manager.\n\n${HELP}`);
      case "help":
        return this.client.sendMessage(chatId, HELP);
      case "register":
        if (userId) return this.client.sendMessage(chatId, "This Telegram account is already linked.");
        await this.telegram.saveConversation(telegramUserId, "firstName", {}, this.conversationExpiry());
        return this.client.sendMessage(chatId, "Let's create your account. What is your first name?");
      case "login": {
        if (userId) return this.client.sendMessage(chatId, "This Telegram account is already linked.");
        const url = await this.links.createLink(telegramUserId, chatId);
        return this.client.sendMessage(chatId, `Open this private link to sign in. It expires soon and works once.\n${url}\n\nNever send your password in this chat.`);
      }
      case "translate":
        return requireLink(async (id) => {
          if (!args) return this.client.sendMessage(chatId, "Usage: /translate <text>");
          const preferences = await this.users.getPreferences(id);
          if (!preferences.preferredTargetLanguage) return this.translateAll(args, telegramUserId, chatId);
          const result = await this.translations.translate(id, parseOrThrow(translateSchema, { text: args, targetLanguage: preferences.preferredTargetLanguage }));
          return this.client.sendMessage(chatId, result.translatedText);
        });
      case "language":
        return requireLink(async (id) => {
          if (!args) return this.client.sendMessage(chatId, "Usage: /language <code>, for example /language fr");
          const language = await this.languages.requireActive(args);
          await this.users.updatePreferences(id, { preferredTargetLanguage: language.code });
          return this.client.sendMessage(chatId, `Preferred target language: ${language.name}`);
        });
      case "mylanguage":
        return requireLink(async (id) => {
          const [profile, preferences] = await Promise.all([this.users.getProfile(id), this.users.getPreferences(id)]);
          return this.client.sendMessage(chatId, `Native language: ${profile.nativeLanguage}\nPreferred target: ${preferences.preferredTargetLanguage ?? "not set"}\nProvider: ${preferences.preferredProvider}`);
        });
      case "history":
        return requireLink(async (id) => {
          const { items } = await this.history.list(id, 1, 5);
          if (items.length === 0) return this.client.sendMessage(chatId, "No translation history yet.");
          const lines = items.map((h) => `${h.createdAt.toISOString().slice(0, 10)}: ${h.originalText.slice(0, 80)}`);
          return this.client.sendMessage(chatId, lines.join("\n"));
        });
      case "logout":
        await this.telegram.clearConversation(telegramUserId);
        return this.client.sendMessage(chatId, (await this.telegram.unlink(telegramUserId)) ? "This Telegram account is now unlinked." : "This Telegram account is not linked.");
      default:
        return this.client.sendMessage(chatId, "Unknown command. Send /help.");
    }
  }

  private conversationExpiry() {
    return new Date(Date.now() + CONVERSATION_TTL_MS);
  }

  private async translateAll(text: string, telegramUserId: string, chatId: string) {
    const userId = await this.linkedUserId(telegramUserId);
    if (!userId) return this.client.sendMessage(chatId, NEED_LINK);
    await this.client.sendTyping(chatId).catch(() => undefined);
    const result = await this.translations.multilingual(userId, parseOrThrow(multilingualSchema, { text }));
    const format = () =>
      Object.values(result.translations)
        .map((t) => {
          const body = t.text ?? "(translation failed, please retry)";
          return `${t.flag} ${t.languageName}\n${body}${t.pronunciation ? `\n🔊 ${t.pronunciation}` : ""}`;
        })
        .join("\n\n");

    // Translations go out first; pronunciation takes longer and is added afterwards.
    const messageId = await this.client.sendMessage(chatId, format());
    if (!getEnv().TELEGRAM_PRONUNCIATION) return;
    await this.translations.addPronunciation(result.translations);
    const full = format();
    if (messageId !== undefined && full.length <= TELEGRAM_MESSAGE_LIMIT) {
      await this.client.editMessage(chatId, messageId, full).catch((error) => logger.warn({ err: error }, "pronunciation edit failed"));
    } else {
      await this.client.sendMessage(chatId, full);
    }
  }

  private async registrationStep(step: string, draft: Draft, message: Message, telegramUserId: string, chatId: string) {
    const advance = async (next: string, data: Draft, prompt: string, markup?: Record<string, unknown>) => {
      await this.telegram.saveConversation(telegramUserId, next, data, this.conversationExpiry());
      await this.client.sendMessage(chatId, prompt, markup);
    };
    const text = message.text?.trim() ?? "";
    switch (step) {
      case "firstName":
        if (!text) return this.client.sendMessage(chatId, "Please send your first name.");
        return advance("lastName", { ...draft, firstName: text.slice(0, 100) }, "What is your last name?");
      case "lastName": {
        if (!text) return this.client.sendMessage(chatId, "Please send your last name.");
        const options = getEnv().SUPPORTED_GENDERS;
        return advance("gender", { ...draft, lastName: text.slice(0, 100) }, `What is your gender? Options: ${options.join(", ")}`);
      }
      case "gender": {
        const gender = text.toLowerCase();
        if (!getEnv().SUPPORTED_GENDERS.includes(gender)) return this.client.sendMessage(chatId, "Please choose one of the listed options.");
        return advance("nativeLanguage", { ...draft, gender }, "What is your native language? For example Arabic, Urdu or en.");
      }
      case "nativeLanguage": {
        const wanted = text.toLowerCase();
        const language = (await this.languages.list()).find((l) => [l.code, l.name, l.nativeName].some((v) => v.toLowerCase() === wanted));
        if (!language) return this.client.sendMessage(chatId, "That language is not supported. Try a name like Arabic, or a code like ar.");
        await this.telegram.clearConversation(telegramUserId);
        const user = await this.telegram.createLinkedUser(telegramUserId, {
          firstName: draft.firstName!, lastName: draft.lastName!, gender: draft.gender!, nativeLanguageCode: language.code,
        });
        return this.client.sendMessage(chatId, user ? "Your account is ready. Send any text to translate it." : "This Telegram account is already linked.", { remove_keyboard: true });
      }
      default:
        return this.telegram.clearConversation(telegramUserId);
    }
  }
}
