import { getEnv } from "@/config/env";
import type { SessionRepository } from "@/repositories/session.repository";
import type { UserPreferenceRepository, PreferenceChanges } from "@/repositories/user-preference.repository";
import type { UserRepository } from "@/repositories/user.repository";
import { verifyPassword } from "@/security/password";
import { AppError } from "@/shared/errors";
import type { AuditService } from "@/modules/audit/audit.service";
import type { LanguageService } from "@/modules/languages/language.service";

type User = NonNullable<Awaited<ReturnType<UserRepository["findById"]>>>;

export function toPublicUser(user: User) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    gender: user.gender,
    nativeLanguage: user.nativeLanguageCode,
    mobile: user.mobile,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    isVerified: user.isVerified,
    mobileVerifiedAt: user.mobileVerifiedAt,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

const notFound = () => new AppError("NOT_FOUND", "The resource was not found.");

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: UserPreferenceRepository,
    private readonly sessions: SessionRepository,
    private readonly languages: LanguageService,
    private readonly audit: AuditService,
  ) {}

  assertGender(gender: string) {
    if (!getEnv().SUPPORTED_GENDERS.includes(gender)) {
      throw new AppError("VALIDATION_ERROR", "The request contains invalid data.", {
        fields: [{ field: "gender", message: "Unsupported value." }],
      });
    }
  }

  async getProfile(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw notFound();
    return toPublicUser(user);
  }

  async updateProfile(userId: string, changes: { firstName?: string; lastName?: string; gender?: string; nativeLanguage?: string }) {
    if (changes.gender) this.assertGender(changes.gender);
    if (changes.nativeLanguage) await this.languages.requireActive(changes.nativeLanguage);
    const { nativeLanguage, ...rest } = changes;
    const user = await this.users.update(userId, {
      ...rest,
      ...(nativeLanguage ? { nativeLanguage: { connect: { code: nativeLanguage } } } : {}),
    });
    return toPublicUser(user);
  }

  getPreferences(userId: string) {
    return this.preferences.get(userId);
  }

  async updatePreferences(userId: string, changes: PreferenceChanges) {
    if (changes.preferredTargetLanguage) await this.languages.requireActive(changes.preferredTargetLanguage);
    return this.preferences.update(userId, changes);
  }

  async deleteAccount(userId: string, password: string, requestId?: string) {
    const user = await this.users.findById(userId);
    if (!user) throw notFound();
    if (!(await verifyPassword(user.passwordHash ?? "", password))) {
      throw new AppError("INVALID_CREDENTIALS", "The credentials are incorrect.");
    }
    await this.users.delete(userId);
    await this.audit.record("account.deleted", undefined, requestId);
  }

  async deactivate(userId: string, actorId: string, requestId?: string) {
    if (!(await this.users.findById(userId))) throw notFound();
    await this.users.update(userId, { isActive: false });
    await this.sessions.revokeAll(userId);
    await this.audit.record("account.deactivated", actorId, requestId, { target: userId });
  }
}
