import { getEnv } from "@/config/env";
import { telegramUpdateSchema } from "@/modules/telegram/telegram.validation";
import { safeEqual } from "@/security/tokens";
import { AppError } from "@/shared/errors";
import { route } from "@/shared/http/handler";

export const POST = route({ body: telegramUpdateSchema, rateLimit: { scope: "telegram", max: 6_000 } }, async ({ req, body, container }) => {
  const secret = getEnv().TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret) throw new AppError("SERVICE_DISABLED", "The Telegram integration is not configured.");
  if (!safeEqual(secret, given)) throw new AppError("UNAUTHENTICATED", "Authentication is required.");
  return container.telegramService.accept(body);
});
