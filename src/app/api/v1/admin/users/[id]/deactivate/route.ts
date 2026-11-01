import { route } from "@/shared/http/handler";

export const POST = route({ auth: true, role: "ADMIN" }, async ({ auth, container, params, requestId }) => {
  await container.userService.deactivate(params.id!, auth.userId, requestId);
  return { deactivated: true };
});
