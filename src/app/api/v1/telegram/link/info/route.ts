import { linkInfoSchema } from "@/modules/telegram/telegram.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ body: linkInfoSchema, rateLimit: { scope: "telegram-link", max: 20 } }, ({ body, container }) =>
  container.linkService.info(body.token),
);
