import { getEnv } from "@/config/env";
import { HttpTelegramClient } from "@/infrastructure/telegram/telegram-client";

async function main() {
  const env = getEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_URL) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_URL are required.");
  await new HttpTelegramClient(env.TELEGRAM_BOT_TOKEN).call("setWebhook", {
    url: env.TELEGRAM_WEBHOOK_URL,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  console.log("Webhook configured.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Webhook setup failed.");
  process.exit(1);
});
