import { verifyRequestSchema } from "@/modules/auth/auth.validation";
import { accepted, route } from "@/shared/http/handler";

export const POST = route({ body: verifyRequestSchema, rateLimit: { scope: "verify-request", max: 5 } }, async ({ body, container }) => {
  await container.rateLimiter.consume(`verify-mobile:${body.mobile}`, 5, 3_600);
  await container.verificationService.request(body.mobile);
  return accepted({ status: "sent_if_eligible" });
});
