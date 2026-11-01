import { route } from "@/shared/http/handler";

export const POST = route({ auth: true }, async ({ auth, container, requestId }) => {
  await container.authService.logout(auth, requestId);
  return { loggedOut: true };
});
