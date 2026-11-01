import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, params, container }) => container.jobService.get(auth.userId, params.jobId!));
