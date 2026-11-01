import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "test" ? "silent" : (process.env.LOG_LEVEL ?? "info"),
  base: { service: "language-manager" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["password", "*.password", "token", "*.token", "refreshToken", "*.refreshToken", "accessToken", "*.accessToken", "authorization", "*.authorization", "text", "*.text"],
    censor: "[redacted]",
  },
});
