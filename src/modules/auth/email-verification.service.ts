import { getEnv } from "@/config/env";
import type { EmailSender } from "@/infrastructure/email/email-sender";
import { logger } from "@/infrastructure/logging/logger";
import type { EmailVerificationRepository } from "@/repositories/email-verification.repository";
import type { UserRepository } from "@/repositories/user.repository";
import { generateNumericCode, hashToken, safeEqual } from "@/security/tokens";
import { AppError } from "@/shared/errors";

const MAX_ATTEMPTS = 5;
const invalid = () => new AppError("VALIDATION_ERROR", "The verification code is invalid or expired.");

export class EmailVerificationService {
  constructor(
    private readonly verifications: EmailVerificationRepository,
    private readonly users: UserRepository,
    private readonly emails: EmailSender,
  ) {}

  /** Silent for unknown or verified addresses, so it cannot enumerate accounts. */
  async request(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.emailVerifiedAt) return;
    const code = generateNumericCode();
    const ttl = getEnv().VERIFICATION_CODE_TTL;
    await this.verifications.replace(email, hashToken(`${email}:${code}`), new Date(Date.now() + ttl * 1000));
    try {
      await this.emails.send(email, "Your Language Tutor verification code", `Your verification code is ${code}`);
    } catch (error) {
      logger.error({ err: error }, "verification email delivery failed");
    }
  }

  async confirm(email: string, code: string): Promise<void> {
    const current = await this.verifications.findCurrent(email);
    if (!current || current.attempts >= MAX_ATTEMPTS) throw invalid();
    if (!safeEqual(current.codeHash, hashToken(`${email}:${code}`))) {
      await this.verifications.addAttempt(current.id);
      throw invalid();
    }
    if (!(await this.verifications.consume(current.id))) throw invalid();
    await this.users.markEmailVerified(email);
  }
}
