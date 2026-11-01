import { getEnv } from "@/config/env";
import type { TelegramClient } from "@/infrastructure/telegram/telegram-client";
import type { TelegramRepository } from "@/repositories/telegram.repository";
import { generateOpaqueToken, hashToken } from "@/security/tokens";
import { AppError } from "@/shared/errors";
import type { AuditService } from "@/modules/audit/audit.service";
import type { AuthService } from "@/modules/auth/auth.service";

const invalidLink = () => new AppError("VALIDATION_ERROR", "This link is invalid or has expired. Send /login to the bot for a new one.");

/** Secrets never enter chat: the bot sends a short-lived HTTPS link instead. */
export class TelegramLinkService {
  constructor(
    private readonly telegram: TelegramRepository,
    private readonly auth: AuthService,
    private readonly client: TelegramClient,
    private readonly audit: AuditService,
  ) {}

  /** The token sits in the URL fragment so it stays out of server and proxy logs. */
  async createLink(telegramUserId: string, chatId: string, draft?: Record<string, string>) {
    const env = getEnv();
    const token = generateOpaqueToken();
    await this.telegram.createLinkToken({
      tokenHash: hashToken(token),
      telegramUserId,
      chatId,
      draft,
      expiresAt: new Date(Date.now() + env.TELEGRAM_LINK_TTL * 1000),
    });
    return `${env.APP_URL}/telegram/link#token=${token}`;
  }

  async info(token: string) {
    const link = await this.telegram.findLinkToken(hashToken(token));
    if (!link) throw invalidLink();
    return { draft: link.draft, expiresAt: link.expiresAt };
  }

  /** Links only after the account's password and verification checks pass. */
  async complete(token: string, mobile: string, password: string, requestId?: string) {
    const link = await this.telegram.findLinkToken(hashToken(token));
    if (!link) throw invalidLink();
    const user = await this.auth.verifyCredentials(mobile, password);
    if (!(await this.telegram.consumeLinkToken(link.id))) throw invalidLink();
    if (!(await this.telegram.link(user.id, link.telegramUserId))) {
      throw new AppError("CONFLICT", "This account or Telegram user is already linked.");
    }
    await this.audit.record("telegram.linked", user.id, requestId);
    await this.client.sendMessage(link.chatId, "Your account is linked. Send any text to translate it.").catch(() => undefined);
    return { linked: true };
  }
}
