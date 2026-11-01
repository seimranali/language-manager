import { getEnv } from "@/config/env";
import { logger } from "@/infrastructure/logging/logger";
import type { SmsSender } from "@/infrastructure/sms/sms-sender";
import type { UserRepository } from "@/repositories/user.repository";
import type { VerificationRepository } from "@/repositories/verification.repository";
import { generateNumericCode, hashToken, safeEqual } from "@/security/tokens";
import { AppError } from "@/shared/errors";

const MAX_ATTEMPTS = 5;
const invalid = () => new AppError("VALIDATION_ERROR", "The verification code is invalid or expired.");

export class VerificationService {
  constructor(
    private readonly verifications: VerificationRepository,
    private readonly users: UserRepository,
    private readonly sms: SmsSender,
  ) {}

  /** Silent for unknown or verified numbers, so it cannot enumerate accounts. */
  async request(mobile: string): Promise<void> {
    const user = await this.users.findByMobile(mobile);
    if (!user || user.isVerified) return;
    const code = generateNumericCode();
    const ttl = getEnv().VERIFICATION_CODE_TTL;
    await this.verifications.replace(mobile, hashToken(`${mobile}:${code}`), new Date(Date.now() + ttl * 1000));
    try {
      await this.sms.send(mobile, `Your Language Manager verification code is ${code}`);
    } catch (error) {
      logger.error({ err: error }, "verification SMS delivery failed");
    }
  }

  async confirm(mobile: string, code: string): Promise<void> {
    const current = await this.verifications.findCurrent(mobile);
    if (!current || current.attempts >= MAX_ATTEMPTS) throw invalid();
    if (!safeEqual(current.codeHash, hashToken(`${mobile}:${code}`))) {
      await this.verifications.addAttempt(current.id);
      throw invalid();
    }
    if (!(await this.verifications.consume(current.id))) throw invalid();
    await this.users.markVerified(mobile);
  }
}
