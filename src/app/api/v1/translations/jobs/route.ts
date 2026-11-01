import { jobSchema } from "@/modules/translations/translation.validation";
import { accepted, route } from "@/shared/http/handler";

export const POST = route({ auth: true, body: jobSchema, rateLimit: { scope: "translate", max: 60 } }, async ({ auth, body, container, req }) =>
  accepted(await container.jobService.create(auth.userId, body, req.headers.get("idempotency-key")?.slice(0, 128) ?? undefined)),
);
