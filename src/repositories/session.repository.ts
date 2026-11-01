import type { PrismaClient } from "@prisma/client";

export interface NewSession {
  userId: string;
  deviceName?: string;
  userAgent?: string;
  expiresAt: Date;
}

export class SessionRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Session lookup joined with the owner: the single auth check per request. */
  findActiveWithUser(id: string) {
    return this.db.session.findFirst({
      where: { id, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });
  }
  listActive(userId: string) {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: { id: true, deviceName: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
  }
  /** Revokes a session and every refresh token in its family atomically. */
  async revoke(ids: string[]) {
    const now = new Date();
    await this.db.$transaction([
      this.db.session.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
      this.db.refreshToken.updateMany({ where: { tokenFamilyId: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
    ]);
  }
  async revokeOwned(userId: string, id: string) {
    const session = await this.db.session.findFirst({ where: { id, userId }, select: { id: true } });
    if (!session) return false;
    await this.revoke([id]);
    return true;
  }
  async revokeAll(userId: string) {
    const sessions = await this.db.session.findMany({ where: { userId, revokedAt: null }, select: { id: true } });
    await this.revoke(sessions.map((s) => s.id));
  }
}
