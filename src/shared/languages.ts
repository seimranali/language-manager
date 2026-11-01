/** BCP-47 subset used across the API, e.g. `en`, `ar-SA`, `zh-Hant`. */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function baseLanguage(code: string): string {
  return code.split("-")[0]!.toLowerCase();
}

export function normalizeLanguageCode(code: string): string {
  const [lang, ...rest] = code.trim().replace(/_/g, "-").split("-");
  const subtags = rest.map((part) =>
    part.length === 2 ? part.toUpperCase() : part.length === 4 ? part[0]!.toUpperCase() + part.slice(1).toLowerCase() : part,
  );
  return [lang!.toLowerCase(), ...subtags].join("-");
}
