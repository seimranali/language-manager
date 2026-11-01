import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const generateOpaqueToken = () => randomBytes(32).toString("base64url");

/** SHA-256 suffices for 256-bit random tokens; they cannot be brute-forced. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const generateNumericCode = (digits = 6) => randomInt(0, 10 ** digits).toString().padStart(digits, "0");

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}
