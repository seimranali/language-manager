import { multilingualSchema } from "@/modules/translations/translation.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ auth: true, body: multilingualSchema, rateLimit: { scope: "translate", max: 60 } }, ({ auth, body, container }) =>
  container.translationService.multilingual(auth.userId, body),
);
