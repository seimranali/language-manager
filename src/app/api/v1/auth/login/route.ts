import { getEnv } from "@/config/env";
import { loginSchema } from "@/modules/auth/auth.validation";
import { route } from "@/shared/http/handler";

export const POST = route(
  { body: loginSchema, rateLimit: { scope: "login", max: 30 } },
  async ({ body, container, requestId, req }) => {
    const env = getEnv();
    await container.rateLimiter.consume(`login:mobile:${body.mobile}`, env.LOGIN_RATE_LIMIT_MAX, env.RATE_LIMIT_WINDOW_SECONDS);
    return container.authService.login(body.mobile, body.password, {
      deviceName: body.deviceName,
      userAgent: req.headers.get("user-agent") ?? undefined,
      requestId,
    });
  },
);
