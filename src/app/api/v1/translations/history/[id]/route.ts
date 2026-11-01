import { route } from "@/shared/http/handler";

export const GET = route({ auth: true }, ({ auth, params, container }) => container.historyService.get(auth.userId, params.id!));

export const DELETE = route({ auth: true }, async ({ auth, params, container }) => {
  await container.historyService.delete(auth.userId, params.id!);
  return { deleted: true };
});
