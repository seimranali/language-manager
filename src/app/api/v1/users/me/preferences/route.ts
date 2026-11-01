import { updatePreferencesSchema } from "@/modules/users/user.validation";
import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, container }) => container.userService.getPreferences(auth.userId));

export const PATCH = route({ auth: true, body: updatePreferencesSchema }, ({ auth, body, container }) =>
  container.userService.updatePreferences(auth.userId, body),
);
