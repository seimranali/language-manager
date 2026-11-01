import { translateSchema } from "@/modules/translations/translation.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ auth: true, body: translateSchema, rateLimit: { scope: "translate", max: 60 } }, ({ auth, body, container }) =>
  container.translationService.translate(auth.userId, body),
);
