import { route } from "@/shared/http/handler";

export const GET = route({}, ({ container }) => container.languageService.list());
