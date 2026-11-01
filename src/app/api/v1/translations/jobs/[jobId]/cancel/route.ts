import { route } from "@/shared/http/handler";

export const POST = route({ auth: true }, ({ auth, params, container }) => container.jobService.cancel(auth.userId, params.jobId!));
