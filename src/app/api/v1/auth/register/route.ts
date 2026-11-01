import { registerSchema } from "@/modules/users/user.validation";
import { created, route } from "@/shared/http/handler";

export const POST = route({ body: registerSchema, rateLimit: { scope: "register", max: 20 } }, async ({ body, container, requestId }) =>
  created(await container.authService.register(body, requestId)),
);
