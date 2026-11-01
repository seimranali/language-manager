import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "https://test.local",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:test@127.0.0.1:54331/lm_test",
  JWT_ISSUER: "lm-test",
  JWT_AUDIENCE: "lm-clients",
  JWT_KEY_ID: "test-1",
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret-value",
  RATE_LIMIT_MAX_REQUESTS: "100000",
  LOGIN_RATE_LIMIT_MAX: "100000",
  REFRESH_REUSE_LEEWAY_SECONDS: "1",
});
