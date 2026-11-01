import { getEnv } from "@/config/env";
import { logger } from "@/infrastructure/logging/logger";
import type { RefreshTokenRepository } from "@/repositories/refresh-token.repository";
import type { SessionRepository } from "@/repositories/session.repository";
import type { UserRepository } from "@/repositories/user.repository";
import { signAccessToken, verifyAccessToken } from "@/security/jwt";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/security/password";
import { generateOpaqueToken, hashToken } from "@/security/tokens";
import type { Role } from "@/security/authorization";
import { AppError } from "@/shared/errors";
import type { AuditService } from "@/modules/audit/audit.service";
import type { LanguageService } from "@/modules/languages/language.service";
import { toPublicUser, type UserService } from "@/modules/users/user.service";
import type { RegisterInput } from "@/modules/users/user.validation";
import type { VerificationService } from "./verification.service";

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
}

export interface ClientInfo {
  deviceName?: string;
  userAgent?: string;
  requestId?: string;
}

const badCredentials = () => new AppError("INVALID_CREDENTIALS", "The mobile number or password is incorrect.");
const invalidToken = () => new AppError("TOKEN_INVALID", "The refresh token is invalid or expired.");

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: RefreshTokenRepository,
    private readonly sessions: SessionRepository,
    private readonly userService: UserService,
    private readonly languages: LanguageService,
    private readonly verification: VerificationService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, requestId?: string) {
    this.userService.assertGender(input.gender);
    await this.languages.requireActive(input.nativeLanguage);
    const passwordHash = await hashPassword(input.password);
    const user = await this.users.create({
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender,
      nativeLanguageCode: input.nativeLanguage,
      mobile: input.mobile,
      passwordHash,
    });
    if (!user) throw new AppError("MOBILE_ALREADY_REGISTERED", "This mobile number is already registered.");
    await this.audit.record("user.registered", user.id, requestId);
    await this.verification.request(input.mobile);
    return { user: toPublicUser(user), verification: { status: "pending", channel: "sms" } };
  }

  /** Checks credentials without creating a session; shared with account linking. */
  async verifyCredentials(mobile: string, password: string) {
    const user = await this.users.findByMobile(mobile);
    if (!user) {
      await burnPasswordCheck(password);
      throw badCredentials();
    }
    if (!(await verifyPassword(user.passwordHash ?? "", password)) || !user.isActive) throw badCredentials();
    if (getEnv().REQUIRE_VERIFIED_MOBILE && !user.isVerified) {
      throw new AppError("MOBILE_NOT_VERIFIED", "Verify your mobile number before signing in.");
    }
    return user;
  }

  async login(mobile: string, password: string, client: ClientInfo) {
    let user;
    try {
      user = await this.verifyCredentials(mobile, password);
    } catch (error) {
      await this.audit.record("auth.login_failed", undefined, client.requestId);
      throw error;
    }
    const env = getEnv();
    const refreshToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000);
    const sessionId = await this.tokens.createSession(
      { userId: user.id, deviceName: client.deviceName, userAgent: client.userAgent?.slice(0, 255), expiresAt },
      hashToken(refreshToken),
    );
    await this.users.update(user.id, { lastLoginAt: new Date() });
    const active = await this.sessions.listActive(user.id);
    const excess = active.slice(env.MAX_SESSIONS_PER_USER).map((s) => s.id);
    if (excess.length > 0) await this.sessions.revoke(excess);
    await this.audit.record("auth.login", user.id, client.requestId);
    return { user: toPublicUser(user), ...(await this.tokenPair(user.id, sessionId, refreshToken)) };
  }

  private async tokenPair(userId: string, sessionId: string, refreshToken: string) {
    return {
      accessToken: await signAccessToken({ userId, sessionId }),
      refreshToken,
      tokenType: "Bearer",
      expiresIn: getEnv().JWT_ACCESS_TOKEN_TTL,
    };
  }

  async refresh(refreshToken: string, requestId?: string) {
    const env = getEnv();
    const next = generateOpaqueToken();
    const result = await this.tokens.rotate(hashToken(refreshToken), hashToken(next), new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000));

    if (result.outcome === "invalid") throw invalidToken();
    if (result.outcome === "already-rotated") {
      // A loser of a concurrent refresh looks like reuse; the leeway tells them apart.
      const age = Date.now() - (result.rotatedAt?.getTime() ?? 0);
      if (age <= env.REFRESH_REUSE_LEEWAY_SECONDS * 1000) {
        throw new AppError("REFRESH_CONFLICT", "This token was just refreshed. Use the newest token.");
      }
      await this.sessions.revoke([result.sessionId]);
      await this.audit.record("auth.refresh_reuse_detected", undefined, requestId, { sessionId: result.sessionId });
      logger.warn({ sessionId: result.sessionId, requestId }, "refresh token reuse: family revoked");
      throw new AppError("TOKEN_REUSED", "The refresh token is no longer valid. Sign in again.");
    }

    const session = await this.sessions.findActiveWithUser(result.sessionId);
    if (!session?.user.isActive) throw invalidToken();
    return this.tokenPair(result.userId, result.sessionId, next);
  }

  async authenticate(accessToken: string): Promise<AuthContext> {
    const claims = await verifyAccessToken(accessToken);
    const session = await this.sessions.findActiveWithUser(claims.sessionId);
    if (!session || session.user.id !== claims.userId || !session.user.isActive) {
      throw new AppError("TOKEN_INVALID", "The session is no longer active.");
    }
    return { userId: claims.userId, sessionId: claims.sessionId, role: session.user.role };
  }

  async logout(auth: AuthContext, requestId?: string) {
    await this.sessions.revoke([auth.sessionId]);
    await this.audit.record("auth.logout", auth.userId, requestId);
  }

  async logoutAll(auth: AuthContext, requestId?: string) {
    await this.sessions.revokeAll(auth.userId);
    await this.audit.record("auth.logout_all", auth.userId, requestId);
  }

  listSessions(userId: string) {
    return this.sessions.listActive(userId);
  }

  async revokeSession(userId: string, sessionId: string) {
    if (!(await this.sessions.revokeOwned(userId, sessionId))) {
      throw new AppError("NOT_FOUND", "The resource was not found.");
    }
  }
}
