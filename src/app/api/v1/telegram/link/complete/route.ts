import { linkCompleteSchema } from "@/modules/telegram/telegram.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ body: linkCompleteSchema, rateLimit: { scope: "telegram-link", max: 20 } }, ({ body, container, requestId }) =>
  container.linkService.complete(body.token, body.mobile, body.password, requestId),
);
