type Op = [method: string, path: string, summary: string, opts?: { auth?: boolean; body?: string; success?: number }];

const OPERATIONS: Op[] = [
  ["get", "/health", "Liveness"],
  ["get", "/health/ready", "Readiness"],
  ["get", "/metrics", "Prometheus metrics (bearer METRICS_TOKEN)"],
  ["get", "/openapi.json", "This document"],
  ["post", "/auth/register", "Register a user", { body: "Register", success: 201 }],
  ["post", "/auth/verify-email/request", "Send an email verification code", { body: "EmailOnly", success: 202 }],
  ["post", "/auth/verify-email/confirm", "Confirm an email verification code", { body: "VerifyEmailConfirm" }],
  ["post", "/auth/verify-mobile/request", "Send a mobile verification code", { body: "MobileOnly", success: 202 }],
  ["post", "/auth/verify-mobile/confirm", "Confirm a verification code", { body: "VerifyConfirm" }],
  ["post", "/auth/login", "Log in", { body: "Login" }],
  ["post", "/auth/refresh", "Rotate a refresh token", { body: "Refresh" }],
  ["post", "/auth/logout", "Revoke the current session", { auth: true }],
  ["post", "/auth/logout-all", "Revoke all sessions", { auth: true }],
  ["get", "/auth/me", "Current user", { auth: true }],
  ["get", "/auth/sessions", "List devices and sessions", { auth: true }],
  ["delete", "/auth/sessions/{id}", "Revoke one session", { auth: true }],
  ["get", "/users/me", "Get profile", { auth: true }],
  ["patch", "/users/me", "Update profile", { auth: true, body: "ProfileUpdate" }],
  ["delete", "/users/me", "Delete account", { auth: true, body: "PasswordConfirm" }],
  ["get", "/users/me/preferences", "Get preferences", { auth: true }],
  ["patch", "/users/me/preferences", "Update preferences", { auth: true, body: "Preferences" }],
  ["post", "/admin/users/{id}/deactivate", "Deactivate a user (admin)", { auth: true }],
  ["get", "/languages", "List languages"],
  ["get", "/languages/search", "Search languages (?q=)"],
  ["get", "/languages/{code}", "Get a language"],
  ["post", "/translations", "Translate into one language", { auth: true, body: "Translate" }],
  ["post", "/translations/multilingual", "Translate into Dutch, English and Saudi Arabic", { auth: true, body: "Multilingual" }],
  ["get", "/translations/history", "List history (?page=&pageSize=)", { auth: true }],
  ["delete", "/translations/history", "Delete all history", { auth: true }],
  ["get", "/translations/history/{id}", "Get a history entry", { auth: true }],
  ["delete", "/translations/history/{id}", "Delete a history entry", { auth: true }],
  ["post", "/translations/jobs", "Create an async job (Idempotency-Key supported)", { auth: true, body: "Job", success: 202 }],
  ["get", "/translations/jobs/{jobId}", "Get a job", { auth: true }],
  ["post", "/translations/jobs/{jobId}/cancel", "Cancel a job", { auth: true }],
  ["post", "/telegram/webhook", "Telegram webhook (X-Telegram-Bot-Api-Secret-Token)"],
  ["post", "/telegram/link/info", "Inspect a link token", { body: "LinkInfo" }],
  ["post", "/telegram/link/complete", "Link Telegram to an account", { body: "LinkComplete" }],
];

const str = { type: "string" };
const bool = { type: "boolean" };
const translation = {
  text: str, sourceLanguage: { type: "string", default: "auto" }, provider: { enum: ["google", "claude", "auto"] },
  style: { enum: ["natural", "formal", "informal", "business", "technical"] }, context: str, audience: str,
  glossary: { type: "object", additionalProperties: str }, preserveFormatting: bool, correctGrammar: bool,
  adaptIdioms: bool, allowFallback: bool, sensitive: bool, includePronunciation: bool,
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const SCHEMAS = {
  Register: object({ firstName: str, lastName: str, gender: str, nativeLanguage: str, email: str, mobile: str, password: str }, ["firstName", "lastName", "gender", "nativeLanguage", "password"]),
  EmailOnly: object({ email: str }, ["email"]),
  VerifyEmailConfirm: object({ email: str, code: str }, ["email", "code"]),
  MobileOnly: object({ mobile: str }, ["mobile"]),
  VerifyConfirm: object({ mobile: str, code: str }, ["mobile", "code"]),
  Login: object({ email: str, mobile: str, password: str, deviceName: str }, ["password"]),
  Refresh: object({ refreshToken: str }, ["refreshToken"]),
  ProfileUpdate: object({ firstName: str, lastName: str, gender: str, nativeLanguage: str }),
  PasswordConfirm: object({ password: str }, ["password"]),
  Preferences: object({ preferredTargetLanguage: { type: ["string", "null"] }, preferredProvider: str, translationStyle: str, saveHistory: bool }),
  Translate: object({ ...translation, targetLanguage: str }, ["text", "targetLanguage"]),
  Multilingual: object(translation, ["text"]),
  Job: object({ ...translation, targetLanguage: str }, ["text"]),
  LinkInfo: object({ token: str }, ["token"]),
  LinkComplete: object({ token: str, mobile: str, password: str }, ["token", "mobile", "password"]),
  Envelope: object({
    success: bool,
    data: {},
    error: { type: ["object", "null"], properties: { code: str, message: str, fields: { type: "array", items: { type: "object" } } } },
    meta: { type: "object", properties: { requestId: str } },
  }),
};

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, summary, opts = {}] of OPERATIONS) {
    const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: str }));
    (paths[path] ??= {})[method] = {
      summary,
      ...(parameters.length ? { parameters } : {}),
      ...(opts.auth ? { security: [{ bearer: [] }] } : {}),
      ...(opts.body ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${opts.body}` } } } } } : {}),
      responses: {
        [opts.success ?? 200]: { description: "Success", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
        default: { description: "Standard error envelope", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Language Manager API", version: "1.0.0" },
    servers: [{ url: "/api/v1" }],
    paths,
    components: { schemas: SCHEMAS, securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
  };
}
