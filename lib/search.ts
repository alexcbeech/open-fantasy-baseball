/**
 * Normalize user-facing text for case- and diacritic-insensitive matching.
 * NFKD also handles compatibility forms such as full-width Latin characters.
 */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}
