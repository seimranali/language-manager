export type ErrorCode =
  | "VALIDATION_ERROR" | "INVALID_JSON" | "PAYLOAD_TOO_LARGE" | "UNAUTHENTICATED" | "INVALID_CREDENTIALS"
  | "TOKEN_INVALID" | "TOKEN_REUSED" | "REFRESH_CONFLICT" | "MOBILE_NOT_VERIFIED" | "FORBIDDEN" | "NOT_FOUND"
  | "CONFLICT" | "MOBILE_ALREADY_REGISTERED" | "UNSUPPORTED_LANGUAGE_PAIR" | "RATE_LIMITED" | "QUOTA_EXCEEDED"
  | "PROVIDER_ERROR" | "PROVIDER_REFUSED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "OVERLOADED"
  | "SERVICE_DISABLED" | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, INVALID_JSON: 400, PAYLOAD_TOO_LARGE: 413, UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401,
  TOKEN_INVALID: 401, TOKEN_REUSED: 401, REFRESH_CONFLICT: 409, MOBILE_NOT_VERIFIED: 403, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, MOBILE_ALREADY_REGISTERED: 409, UNSUPPORTED_LANGUAGE_PAIR: 422, RATE_LIMITED: 429, QUOTA_EXCEEDED: 429,
  PROVIDER_ERROR: 502, PROVIDER_REFUSED: 502, PROVIDER_UNAVAILABLE: 503, PROVIDER_TIMEOUT: 503, OVERLOADED: 503,
  SERVICE_DISABLED: 503, INTERNAL_ERROR: 500,
};

export interface FieldIssue {
  field: string;
  message: string;
}

/** An expected failure. `message` is always safe to show to clients. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { fields?: FieldIssue[]; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

/** A provider failure; `transient` decides whether it may be retried. */
export class ProviderError extends AppError {
  constructor(
    code: ErrorCode,
    message: string,
    readonly provider: string,
    readonly transient: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(code, message);
    this.name = "ProviderError";
  }
}
