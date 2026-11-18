// ─── Búsqueda avanzada ───────────────────────────────────────────────────────
// Utilidades comunes: sin distinguir mayúsculas ni acentos, varias palabras
// (todas deben aparecer) y comparación de códigos sin separadores.

/** Minúsculas, sin acentos y sin espacios sobrantes. */
export const norm = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Igual que norm, pero además sin espacios ni separadores (códigos, NIF, IBAN). */
export const bare = (v: unknown) => norm(v).replace(/[\s.\-/_]/g, "");

/** ¿Aparecen todas las palabras de la búsqueda en alguno de los textos? */
export function matchWords(query: string, ...texts: unknown[]) {
  const q = norm(query);
  if (!q) return true;
  const hay = texts.map(norm).join(" \u0000 ");
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** ¿Coincide un código (o NIF, IBAN…) ignorando separadores? */
export function matchCode(query: string, ...codes: unknown[]) {
  const q = bare(query);
  if (!q) return true;
  return codes.some((c) => bare(c).includes(q));
}
