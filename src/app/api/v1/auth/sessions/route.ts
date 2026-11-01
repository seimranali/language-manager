import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, container }) => container.authService.listSessions(auth.userId));
