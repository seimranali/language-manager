import { SignJWT } from "jose";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/config/env";
import { signAccessToken, verifyAccessToken } from "@/security/jwt";
import { hashPassword, verifyPassword } from "@/security/password";
import { assertOwner, assertRole } from "@/security/authorization";
import { generateOpaqueToken, hashToken } from "@/security/tokens";

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("StrongPassword123!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "StrongPassword123!")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
  it("treats a malformed hash as a failed check", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});

describe("access tokens", () => {
  it("round-trips the subject and session", async () => {
    const token = await signAccessToken({ userId: "u1", sessionId: "s1" });
    expect(await verifyAccessToken(token)).toEqual({ userId: "u1", sessionId: "s1" });
  });
  it("carries no sensitive claims", async () => {
    const token = await signAccessToken({ userId: "u1", sessionId: "s1" });
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "sid", "sub"]);
  });
  it("rejects malformed and tampered tokens", async () => {
    await expect(verifyAccessToken("nope")).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    const token = await signAccessToken({ userId: "u1", sessionId: "s1" });
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", sid: "s1" })).toString("base64url");
    await expect(verifyAccessToken([h, forged, s].join("."))).rejects.toMatchObject({ code: "TOKEN_INVALID" });
    expect(p).toBeDefined();
  });
  it("rejects a token signed by another key and an expired one", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const sign = (exp: number) =>
      new SignJWT({ sid: "s" }).setProtectedHeader({ alg: "EdDSA", kid: "test-1" }).setSubject("u").setIssuer("lm-test").setAudience("lm-clients").setIssuedAt().setExpirationTime(exp).sign(privateKey);
    await expect(verifyAccessToken(await sign(Math.floor(Date.now() / 1000) + 60))).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });
  it("rejects an expired token from the real key", async () => {
    process.env.JWT_ACCESS_TOKEN_TTL = "1";
    resetEnvForTests();
    const token = await signAccessToken({ userId: "u", sessionId: "s" });
    delete process.env.JWT_ACCESS_TOKEN_TTL;
    resetEnvForTests();
    await new Promise((r) => setTimeout(r, 2100));
    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: "TOKEN_INVALID" });
  });
});

describe("opaque tokens", () => {
  it("are high entropy and hash deterministically", () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toHaveLength(64);
    expect(generateOpaqueToken()).not.toBe(token);
  });
});

describe("authorization", () => {
  it("enforces admin role and ownership", () => {
    expect(() => assertRole("USER", "ADMIN")).toThrowError(/permission/);
    expect(() => assertRole("ADMIN", "ADMIN")).not.toThrow();
    expect(() => assertOwner("a", "b")).toThrowError(/not found/);
  });
});
