import { route } from "@/shared/http/handler";

export const DELETE = route({ auth: true }, async ({ auth, container, params }) => {
  await container.authService.revokeSession(auth.userId, params.id!);
  return { revoked: true };
});
