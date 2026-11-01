import { z } from "zod";
import { route } from "@/shared/http/handler";

export const GET = route({ query: z.object({ q: z.string().trim().min(1).max(50) }) }, ({ query, container }) =>
  container.languageService.search(query.q),
);
