import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { getEnv } from "@/config/env";
import { getContainer, type Container } from "@/container";
import { logger } from "@/infrastructure/logging/logger";
import { metrics } from "@/infrastructure/metrics/metrics";
import type { AuthContext } from "@/modules/auth/auth.service";
import { assertRole, type Role } from "@/security/authorization";
import { AppError } from "@/shared/errors";
import { parseOrThrow } from "@/shared/validation";

interface Options<B extends z.ZodType, Q extends z.ZodType, A extends boolean> {
  auth?: A;
  role?: Role;
  body?: B;
  query?: Q;
  /** Separate limit bucket, e.g. for login. Defaults to the global limit. */
  rateLimit?: { scope: string; max: number };
}

interface Ctx<B extends z.ZodType, Q extends z.ZodType, A extends boolean> {
  req: NextRequest;
  requestId: string;
  container: Container;
  params: Record<string, string>;
  body: z.output<B>;
  query: z.output<Q>;
  auth: A extends true ? AuthContext : undefined;
  ip: string;
}

class Reply {
  constructor(readonly data: unknown, readonly status: number) {}
}
export const created = (data: unknown) => new Reply(data, 201);
export const accepted = (data: unknown) => new Reply(data, 202);

function clientIp(req: NextRequest): string {
  if (!getEnv().TRUST_PROXY) return "direct";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function readJson(req: NextRequest): Promise<unknown> {
  const max = getEnv().MAX_BODY_BYTES;
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", "The request body is too large.");
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooLarge();
  const raw = await req.text();
  if (Buffer.byteLength(raw) > max) throw tooLarge();
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_JSON", "The request body must be valid JSON.");
  }
}

function errorResponse(error: unknown, requestId: string) {
  const app = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "An unexpected error occurred.");
  const response = NextResponse.json(
    {
      success: false,
      data: null,
      error: { code: app.code, message: app.message, ...(app.details?.fields ? { fields: app.details.fields } : {}) },
      meta: { requestId },
    },
    { status: app.status },
  );
  if (app.details?.retryAfterSeconds) response.headers.set("Retry-After", String(app.details.retryAfterSeconds));
  return { response, app };
}

/** Every route goes through here for auth, limits, validation, logging and the envelope. */
export function route<B extends z.ZodType = z.ZodUndefined, Q extends z.ZodType = z.ZodUndefined, A extends boolean = false>(
  options: Options<B, Q, A>,
  handler: (ctx: Ctx<B, Q, A>) => Promise<unknown>,
) {
  return async (req: NextRequest, segment?: { params: Promise<Record<string, string>> }) => {
    const started = Date.now();
    const requestId = randomUUID();
    let userId: string | undefined;
    let status = 500;
    const path = req.nextUrl.pathname;
    try {
      const container = getContainer();
      const env = getEnv();
      const ip = clientIp(req);
      const scope = options.rateLimit?.scope ?? "api";
      await container.rateLimiter.consume(`${scope}:ip:${ip}`, options.rateLimit?.max ?? env.RATE_LIMIT_MAX_REQUESTS, env.RATE_LIMIT_WINDOW_SECONDS);

      let auth: AuthContext | undefined;
      if (options.auth) {
        const header = req.headers.get("authorization");
        if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Authentication is required.");
        auth = await container.authService.authenticate(header.slice(7));
        userId = auth.userId;
        if (options.role) assertRole(auth.role, options.role);
        await container.rateLimiter.consume(`${scope}:user:${auth.userId}`, options.rateLimit?.max ?? env.RATE_LIMIT_MAX_REQUESTS, env.RATE_LIMIT_WINDOW_SECONDS);
      }

      const body = options.body ? parseOrThrow(options.body, await readJson(req)) : undefined;
      const query = options.query ? parseOrThrow(options.query, Object.fromEntries(req.nextUrl.searchParams)) : undefined;
      const result = await handler({
        req, requestId, container, ip,
        params: (await segment?.params) ?? {},
        body: body as z.output<B>,
        query: query as z.output<Q>,
        auth: auth as Ctx<B, Q, A>["auth"],
      });

      const reply = result instanceof Reply ? result : new Reply(result ?? {}, 200);
      status = reply.status;
      return NextResponse.json({ success: true, data: reply.data, error: null, meta: { requestId } }, { status });
    } catch (error) {
      const { response, app } = errorResponse(error, requestId);
      status = app.status;
      if (status >= 500) logger.error({ err: app.code === "INTERNAL_ERROR" ? error : undefined, requestId, code: app.code }, "request failed");
      return response;
    } finally {
      metrics.inc("http_requests_total", { status: String(status) });
      logger.info({ requestId, method: req.method, route: path, status, durationMs: Date.now() - started, userId }, "request");
    }
  };
}
