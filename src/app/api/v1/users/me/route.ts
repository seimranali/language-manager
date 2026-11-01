import { deleteAccountSchema, updateProfileSchema } from "@/modules/users/user.validation";
import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, container }) => container.userService.getProfile(auth.userId));

export const PATCH = route({ auth: true, body: updateProfileSchema }, ({ auth, body, container }) =>
  container.userService.updateProfile(auth.userId, body),
);

export const DELETE = route({ auth: true, body: deleteAccountSchema }, async ({ auth, body, container, requestId }) => {
  await container.userService.deleteAccount(auth.userId, body.password, requestId);
  return { deleted: true };
});
