import { verifyConfirmSchema } from "@/modules/auth/auth.validation";
import { route } from "@/shared/http/handler";

export const POST = route({ body: verifyConfirmSchema, rateLimit: { scope: "verify-confirm", max: 10 } }, async ({ body, container }) => {
  await container.verificationService.confirm(body.mobile, body.code);
  return { verified: true };
});
