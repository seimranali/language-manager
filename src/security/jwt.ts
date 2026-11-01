import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey, type JWTHeaderParameters } from "jose";
import { getEnv } from "@/config/env";
import { AppError } from "@/shared/errors";

const ALGORITHM = "EdDSA";

export interface AccessClaims {
  userId: string;
  sessionId: string;
}

let signingKey: Promise<CryptoKey> | undefined;
let verifyKeys: Promise<Map<string, CryptoKey>> | undefined;

function getSigningKey() {
  signingKey ??= importPKCS8(getEnv().JWT_PRIVATE_KEY, ALGORITHM);
  return signingKey;
}

function getVerifyKeys() {
  verifyKeys ??= (async () => {
    const env = getEnv();
    const retired = JSON.parse(env.JWT_RETIRED_PUBLIC_KEYS) as Record<string, string>;
    const keys = new Map<string, CryptoKey>();
    keys.set(env.JWT_KEY_ID, await importSPKI(env.JWT_PUBLIC_KEY, ALGORITHM));
    for (const [kid, key] of Object.entries(retired)) {
      keys.set(kid, await importSPKI(key.replace(/\\n/g, "\n"), ALGORITHM));
    }
    return keys;
  })();
  return verifyKeys;
}

export function resetJwtKeysForTests(): void {
  signingKey = undefined;
  verifyKeys = undefined;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const env = getEnv();
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: ALGORITHM, kid: env.JWT_KEY_ID })
    .setSubject(claims.userId)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_ACCESS_TOKEN_TTL}s`)
    .sign(await getSigningKey());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  const env = getEnv();
  const keys = await getVerifyKeys();
  try {
    const { payload } = await jwtVerify(
      token,
      async (header: JWTHeaderParameters) => {
        const key = header.kid ? keys.get(header.kid) : undefined;
        if (!key) throw new Error("unknown kid");
        return key;
      },
      { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithms: [ALGORITHM], requiredClaims: ["sub", "exp", "iat"] },
    );
    if (typeof payload.sid !== "string") throw new Error("missing sid");
    return { userId: payload.sub!, sessionId: payload.sid };
  } catch {
    throw new AppError("TOKEN_INVALID", "The access token is invalid or expired.");
  }
}
