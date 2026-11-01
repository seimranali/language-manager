import { refreshSchema } from "@/modules/auth/auth.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ body: refreshSchema, rateLimit: { scope: "refresh", max: 60 } }, ({ body, container, requestId }) =>
  container.authService.refresh(body.refreshToken, requestId),
);
