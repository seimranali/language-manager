import { pageSchema } from "@/modules/translations/translation.validation";
import { route } from "@/shared/http/handler";

export const GET = route({ auth: true, query: pageSchema }, ({ auth, query, container }) =>
  container.historyService.list(auth.userId, query.page, query.pageSize),
);

export const DELETE = route({ auth: true }, ({ auth, container }) => container.historyService.deleteAll(auth.userId));
