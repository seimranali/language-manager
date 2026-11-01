import { route } from "@/shared/http/handler";

export const GET = route({}, ({ params, container }) => container.languageService.get(params.code!));
