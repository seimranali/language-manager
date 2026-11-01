import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { NewSession } from "./session.repository";

export type RotationResult =
  | { outcome: "rotated"; userId: string; sessionId: string }
  | { outcome: "invalid" }
  | { outcome: "already-rotated"; sessionId: string; rotatedAt: Date | null };

export class RefreshTokenRepository {
  constructor(private readonly db: PrismaClient) {}

  async createSession(session: NewSession, tokenHash: string) {
    const created = await this.db.session.create({
      data: {
        ...session,
        tokens: { create: { userId: session.userId, tokenHash, expiresAt: session.expiresAt } },
      },
    });
    return created.id;
  }

  /**
   * Swaps a token for its successor in one transaction. The conditional update
   * takes the row lock, so exactly one of any concurrent callers can win.
   */
  rotate(tokenHash: string, nextHash: string, nextExpiresAt: Date): Promise<RotationResult> {
    return this.db.$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
      if (!token) return { outcome: "invalid" };
      const stale = { outcome: "already-rotated", sessionId: token.tokenFamilyId, rotatedAt: token.revokedAt } as const;
      if (token.revokedAt) return token.replacedByTokenId ? stale : { outcome: "invalid" };
      const now = new Date();
      if (token.expiresAt <= now || token.session.revokedAt) return { outcome: "invalid" };

      const nextId = randomUUID();
      const claimed = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: now, replacedByTokenId: nextId },
      });
      if (claimed.count === 0) return { ...stale, rotatedAt: now };

      await tx.refreshToken.create({
        data: { id: nextId, userId: token.userId, tokenHash: nextHash, tokenFamilyId: token.tokenFamilyId, expiresAt: nextExpiresAt },
      });
      await tx.session.update({ where: { id: token.tokenFamilyId }, data: { lastUsedAt: now, expiresAt: nextExpiresAt } });
      return { outcome: "rotated", userId: token.userId, sessionId: token.tokenFamilyId };
    });
  }

  findFamilyByHash(tokenHash: string) {
    return this.db.refreshToken.findUnique({ where: { tokenHash }, select: { tokenFamilyId: true, userId: true } });
  }
}
