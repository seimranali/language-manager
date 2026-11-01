const SEPARATORS = ["\n\n", "\n", ". ", "。", "؟ ", "? ", "! ", " "];

/**
 * Splits text into chunks of at most `limit` UTF-16 units, preferring paragraph
 * then sentence boundaries, and never cutting a surrogate pair.
 * Concatenating the chunks reproduces the input exactly.
 */
export function splitText(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = -1;
    for (const separator of SEPARATORS) {
      const index = window.lastIndexOf(separator);
      if (index > 0) {
        cut = index + separator.length;
        break;
      }
    }
    if (cut <= 0) {
      cut = limit;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
