import nodemailer from "nodemailer";
import { logger } from "@/infrastructure/logging/logger";

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Development only; env validation requires SMTP in production. */
export class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string) {
    logger.warn({ to, subject, devMessage: body }, "development email (not delivered)");
  }
}

export class SmtpEmailSender implements EmailSender {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly config: { host: string; port: number; tls: "starttls" | "tls" | "none"; username?: string; password?: string; from: string }) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.tls === "tls",
      requireTLS: config.tls === "starttls",
      auth: config.username ? { user: config.username, pass: config.password } : undefined,
      connectionTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }

  async send(to: string, subject: string, body: string) {
    await this.transport.sendMail({ from: this.config.from, to, subject, text: body });
  }
}
