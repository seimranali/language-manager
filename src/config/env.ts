import { z } from "zod";

const bool = (fallback: boolean) =>
  z.enum(["true", "false"]).default(fallback ? "true" : "false").transform((v) => v === "true");
const pem = z.string().min(1).transform((v) => v.replace(/\\n/g, "\n"));
const csv = (fallback: string) =>
  z.string().default(fallback).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: bool(false),
    CORS_ALLOWED_ORIGINS: csv(""),
    MAX_BODY_BYTES: z.coerce.number().int().positive().default(262_144),
    METRICS_TOKEN: z.string().min(16).optional(),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().optional(),

    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
    JWT_KEY_ID: z.string().min(1),
    JWT_PRIVATE_KEY: pem,
    JWT_PUBLIC_KEY: pem,
    // JSON object of kid -> public PEM; keeps tokens from a retired key valid.
    JWT_RETIRED_PUBLIC_KEYS: z.string().default("{}"),

    REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2_592_000),
    REFRESH_REUSE_LEEWAY_SECONDS: z.coerce.number().int().nonnegative().default(10),
    MAX_SESSIONS_PER_USER: z.coerce.number().int().positive().default(10),

    SUPPORTED_GENDERS: csv("male,female,other,prefer_not_to_say"),
    REQUIRE_VERIFIED_MOBILE: bool(true),
    VERIFICATION_PROVIDER: z.enum(["console", "twilio"]).default("console"),
    VERIFICATION_CODE_TTL: z.coerce.number().int().positive().default(600),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
    // Uses Translation API v2. Takes priority over the project/ADC path.
    GOOGLE_API_KEY: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().default("global"),
    GOOGLE_CONCURRENCY: z.coerce.number().int().positive().default(20),
    GOOGLE_RATE_PER_MINUTE: z.coerce.number().int().positive().default(600),
    GOOGLE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    GOOGLE_COST_PER_MILLION_CHARS_USD: z.coerce.number().nonnegative().default(20),

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
    ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
    ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),
    ANTHROPIC_INPUT_COST_PER_MTOK_USD: z.coerce.number().nonnegative().default(2),
    ANTHROPIC_OUTPUT_COST_PER_MTOK_USD: z.coerce.number().nonnegative().default(10),
    CLAUDE_CONCURRENCY: z.coerce.number().int().positive().default(5),
    CLAUDE_RATE_PER_MINUTE: z.coerce.number().int().positive().default(60),
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

    PROVIDER_QUEUE_LIMIT: z.coerce.number().int().nonnegative().default(100),
    PROVIDER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),
    CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
    CIRCUIT_RESET_MS: z.coerce.number().int().positive().default(30_000),

    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
    TELEGRAM_WEBHOOK_URL: z.url().optional(),
    TELEGRAM_PRONUNCIATION: bool(true),
    /** Target codes that use a guidance-aware provider unless the request names one. */
    GUIDED_TARGETS: z.string().default("nl,ar-SA").transform((v) => v.split(",").map((c) => c.trim()).filter(Boolean)),
    ROMAN_URDU_ENABLED: bool(true),
    TELEGRAM_LINK_TTL: z.coerce.number().int().positive().default(900),

    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    TRANSLATION_CACHE_ENABLED: bool(true),
    TRANSLATION_CACHE_TTL: z.coerce.number().int().positive().default(86_400),
    TRANSLATION_CACHE_MAX_ENTRY_BYTES: z.coerce.number().int().positive().default(65_536),
    MEMORY_STORE_MAX_ENTRIES: z.coerce.number().int().positive().default(10_000),
    TRANSLATION_MAX_INPUT_LENGTH: z.coerce.number().int().positive().default(10_000),
    TRANSLATION_ASYNC_MAX_INPUT_LENGTH: z.coerce.number().int().positive().default(100_000),
    TRANSLATION_ALLOW_FALLBACK: bool(false),
    TRANSLATION_DAILY_CHAR_QUOTA: z.coerce.number().int().positive().default(200_000),
    MULTILINGUAL_TARGETS: csv("dutch,english,arabicSaudiArabia"),
    MULTILINGUAL_PARTIAL_FAILURE: z.enum(["partial", "fail"]).default("partial"),

    HISTORY_ENABLED: bool(true),
    HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    JOB_QUEUE_MAX_DEPTH: z.coerce.number().int().positive().default(1_000),
    JOB_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  })
  .superRefine((env, ctx) => {
    const require = (key: keyof typeof env, why: string) => {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `required ${why}` });
    };
    if (env.NODE_ENV === "production") {
      require("REDIS_URL", "in production: rate limits, quotas and jobs must be distributed");
      if (env.VERIFICATION_PROVIDER === "console") {
        ctx.addIssue({ code: "custom", path: ["VERIFICATION_PROVIDER"], message: "console delivery is not allowed in production" });
      }
    }
    if (env.VERIFICATION_PROVIDER === "twilio") {
      require("TWILIO_ACCOUNT_SID", "for twilio verification");
      require("TWILIO_AUTH_TOKEN", "for twilio verification");
      require("TWILIO_FROM_NUMBER", "for twilio verification");
    }
    if (env.TELEGRAM_BOT_TOKEN) require("TELEGRAM_WEBHOOK_SECRET", "when the Telegram bot is enabled");
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` can run without runtime secrets. */
export function getEnv(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  cached = result.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = undefined;
}
