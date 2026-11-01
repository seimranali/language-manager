import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAll } from "@/app/api/v1/auth/logout-all/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { DELETE as revokeSession, } from "@/app/api/v1/auth/sessions/[id]/route";
import { GET as sessions } from "@/app/api/v1/auth/sessions/route";
import { POST as confirm } from "@/app/api/v1/auth/verify-mobile/confirm/route";
import { POST as deactivate } from "@/app/api/v1/admin/users/[id]/deactivate/route";
import { DELETE as deleteMe } from "@/app/api/v1/users/me/route";
import { hashToken } from "@/security/tokens";
import { call, db, nextMobile, PASSWORD, registration, resetWorld, type World } from "./harness";

let world: World;
beforeEach(async () => {
  world = await resetWorld();
});

async function verifiedUser() {
  const mobile = nextMobile();
  const created = await call(register, { body: registration(mobile) });
  expect(created.status).toBe(201);
  await call(confirm, { body: { mobile, code: world.sms.codeFor(mobile) } });
  const session = await call(login, { body: { mobile, password: PASSWORD } });
  expect(session.status).toBe(200);
  return { mobile, ...session.json.data, userId: session.json.data.user.id as string };
}

describe("registration", () => {
  it("creates a user, hashes the password and leaks no secrets", async () => {
    const mobile = nextMobile();
    const { status, json } = await call(register, { body: registration(mobile) });
    expect(status).toBe(201);
    expect(json.data.user).toMatchObject({ mobile, role: "USER", isVerified: false });
    expect(json.data.verification.status).toBe("pending");
    expect(JSON.stringify(json)).not.toMatch(/argon2|passwordHash|StrongPassword/);
    const row = await db.user.findUniqueOrThrow({ where: { mobile } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });
  it("returns standardized validation errors", async () => {
    const { status, json } = await call(register, { body: { ...registration(nextMobile()), mobile: "nope", gender: "" } });
    expect(status).toBe(400);
    expect(json).toMatchObject({ success: false, data: null, error: { code: "VALIDATION_ERROR" } });
    expect(json.error.fields.length).toBeGreaterThan(0);
    expect(json.meta.requestId).toBeDefined();
  });
  it("rejects unknown gender and language", async () => {
    expect((await call(register, { body: { ...registration(nextMobile()), gender: "robot" } })).status).toBe(400);
    expect((await call(register, { body: { ...registration(nextMobile()), nativeLanguage: "xx" } })).status).toBe(400);
  });
  it("refuses self-assigned admin", async () => {
    expect((await call(register, { body: { ...registration(nextMobile()), role: "ADMIN" } })).status).toBe(400);
  });
  it("lets exactly one of many concurrent duplicates win", async () => {
    const mobile = nextMobile();
    const results = await Promise.all(Array.from({ length: 8 }, () => call(register, { body: registration(mobile) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });
  it("does not verify without the correct code", async () => {
    const mobile = nextMobile();
    await call(register, { body: registration(mobile) });
    expect((await call(confirm, { body: { mobile, code: "000000" === world.sms.codeFor(mobile) ? "111111" : "000000" } })).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { mobile } })).isVerified).toBe(false);
  });
});

describe("login", () => {
  it("blocks unverified accounts after a correct password", async () => {
    const mobile = nextMobile();
    await call(register, { body: registration(mobile) });
    const { status, json } = await call(login, { body: { mobile, password: PASSWORD } });
    expect(status).toBe(403);
    expect(json.error.code).toBe("MOBILE_NOT_VERIFIED");
  });
  it("gives one generic failure for wrong password and unknown user", async () => {
    const { mobile } = await verifiedUser();
    const wrong = await call(login, { body: { mobile, password: "Wrong-Password-1" } });
    const unknown = await call(login, { body: { mobile: nextMobile(), password: PASSWORD } });
    expect(wrong.status).toBe(401);
    expect(wrong.json.error).toEqual(unknown.json.error);
  });
  it("stores only a hash of the refresh token", async () => {
    const { refreshToken } = await verifiedUser();
    const rows = await db.refreshToken.findMany();
    expect(rows[0]!.tokenHash).toBe(hashToken(refreshToken));
    expect(JSON.stringify(rows)).not.toContain(refreshToken);
  });
  it("protects /me", async () => {
    const { accessToken, mobile } = await verifiedUser();
    expect((await call(me)).status).toBe(401);
    expect((await call(me, { token: "bad" })).status).toBe(401);
    expect((await call(me, { token: accessToken })).json.data.mobile).toBe(mobile);
  });
});

describe("refresh rotation", () => {
  it("rotates and invalidates the old token", async () => {
    const { refreshToken } = await verifiedUser();
    const first = await call(refresh, { body: { refreshToken } });
    expect(first.status).toBe(200);
    expect(first.json.data.refreshToken).not.toBe(refreshToken);
    expect((await call(refresh, { body: { refreshToken: first.json.data.refreshToken } })).status).toBe(200);
  });
  it("yields one winner under concurrent refresh and keeps the session", async () => {
    const { refreshToken } = await verifiedUser();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(refresh, { body: { refreshToken } })));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).length).toBe(5);
    expect(await db.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
    expect((await call(refresh, { body: { refreshToken: winners[0]!.json.data.refreshToken } })).status).toBe(200);
  });
  it("revokes the family on reuse after the leeway", async () => {
    const { refreshToken, accessToken } = await verifiedUser();
    const rotated = await call(refresh, { body: { refreshToken } });
    await new Promise((r) => setTimeout(r, 1100));
    const reuse = await call(refresh, { body: { refreshToken } });
    expect(reuse.status).toBe(401);
    expect(reuse.json.error.code).toBe("TOKEN_REUSED");
    expect((await call(refresh, { body: { refreshToken: rotated.json.data.refreshToken } })).status).toBe(401);
    expect((await call(me, { token: accessToken })).status).toBe(401);
    expect(await db.auditLog.count({ where: { action: "auth.refresh_reuse_detected" } })).toBe(1);
  });
  it("rejects unknown tokens", async () => {
    expect((await call(refresh, { body: { refreshToken: "x".repeat(43) } })).status).toBe(401);
  });
});

describe("sessions", () => {
  it("logout kills the session immediately", async () => {
    const { accessToken, refreshToken } = await verifiedUser();
    expect((await call(logout, { method: "POST", token: accessToken })).status).toBe(200);
    expect((await call(me, { token: accessToken })).status).toBe(401);
    expect((await call(refresh, { body: { refreshToken } })).status).toBe(401);
  });
  it("logout-all kills every device", async () => {
    const { accessToken, mobile } = await verifiedUser();
    const other = await call(login, { body: { mobile, password: PASSWORD, deviceName: "Phone" } });
    await call(logoutAll, { method: "POST", token: accessToken });
    expect((await call(me, { token: other.json.data.accessToken })).status).toBe(401);
  });
  it("lists own sessions and cannot revoke another user's", async () => {
    const a = await verifiedUser();
    const b = await verifiedUser();
    const list = await call(sessions, { token: b.accessToken });
    const id = list.json.data[0].id;
    expect((await call(revokeSession, { method: "DELETE", token: a.accessToken, params: { id } })).status).toBe(404);
    expect((await call(revokeSession, { method: "DELETE", token: b.accessToken, params: { id } })).status).toBe(200);
  });
  it("enforces the session limit", async () => {
    const { mobile, accessToken } = await verifiedUser();
    for (let i = 0; i < 10; i += 1) await call(login, { body: { mobile, password: PASSWORD } });
    expect((await call(me, { token: accessToken })).status).toBe(401);
    expect(await db.session.count({ where: { revokedAt: null } })).toBe(10);
  });
});

describe("account lifecycle", () => {
  it("requires admin to deactivate, and deactivation revokes access", async () => {
    const admin = await verifiedUser();
    const user = await verifiedUser();
    expect((await call(deactivate, { method: "POST", token: user.accessToken, params: { id: admin.userId } })).status).toBe(403);
    await db.user.update({ where: { id: admin.userId }, data: { role: "ADMIN" } });
    expect((await call(deactivate, { method: "POST", token: admin.accessToken, params: { id: user.userId } })).status).toBe(200);
    expect((await call(me, { token: user.accessToken })).status).toBe(401);
    expect((await call(login, { body: { mobile: user.mobile, password: PASSWORD } })).status).toBe(401);
  });
  it("deletes an account only with the password", async () => {
    const { accessToken, userId } = await verifiedUser();
    expect((await call(deleteMe, { method: "DELETE", token: accessToken, body: { password: "x" } })).status).toBe(401);
    expect((await call(deleteMe, { method: "DELETE", token: accessToken, body: { password: PASSWORD } })).status).toBe(200);
    expect(await db.user.findUnique({ where: { id: userId } })).toBeNull();
  });
});
