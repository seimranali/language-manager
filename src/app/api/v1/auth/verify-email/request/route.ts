import { verifyEmailRequestSchema } from "@/modules/auth/auth.validation";
import { accepted, route } from "@/shared/http/handler";

export const POST = route({ body: verifyEmailRequestSchema, rateLimit: { scope: "verify-request", max: 5 } }, async ({ body, container }) => {
  await container.rateLimiter.consume(`verify-email:${body.email}`, 5, 3_600);
  await container.emailVerificationService.request(body.email);
  return accepted({ status: "sent_if_eligible" });
});
