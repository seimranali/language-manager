import { verifyEmailConfirmSchema } from "@/modules/auth/auth.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ body: verifyEmailConfirmSchema, rateLimit: { scope: "verify-confirm", max: 10 } }, async ({ body, container }) => {
  await container.emailVerificationService.confirm(body.email, body.code);
  return { verified: true };
});
