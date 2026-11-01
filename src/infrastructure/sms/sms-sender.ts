import { logger } from "@/infrastructure/logging/logger";

export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

/** Development only; env validation refuses this sender in production. */
export class ConsoleSmsSender implements SmsSender {
  async send(to: string, body: string) {
    logger.warn({ to, devMessage: body }, "development SMS (not delivered)");
  }
}

export class TwilioSmsSender implements SmsSender {
  constructor(private readonly config: { accountSid: string; authToken: string; from: string }) {}

  async send(to: string, body: string) {
    const { accountSid, authToken, from } = this.config;
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twilio responded ${response.status}`);
  }
}
