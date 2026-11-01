import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, container }) => container.userService.getProfile(auth.userId));
