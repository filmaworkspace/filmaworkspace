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

/**
 * Búsqueda por importe: "1500" (≈ exacto), ">1000", "<=500", "1000-2000".
 * Acepta formato español ("1.234,56"). Devuelve null si el texto no es un importe.
 */
export function matchAmount(query: string, ...amounts: number[]): boolean | null {
  const q = query.trim().replace(/\s/g, "").replace(/€/g, "");
  if (!q) return null;
  const num = (s: string) => {
    if (!/^[\d.,]+$/.test(s)) return NaN;
    const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\.(?=\d{3}(\D|$))/g, "");
    return parseFloat(normal);
  };
  let test: ((a: number) => boolean) | null = null;
  const range = q.match(/^([\d.,]+)-([\d.,]+)$/);
  const cmp = q.match(/^(>=|<=|>|<)([\d.,]+)$/);
  if (range) {
    const [a, b] = [num(range[1]), num(range[2])];
    if (!isNaN(a) && !isNaN(b)) test = (x) => x >= Math.min(a, b) && x <= Math.max(a, b);
  } else if (cmp) {
    const v = num(cmp[2]);
    if (!isNaN(v)) test = (x) => (cmp[1] === ">" ? x > v : cmp[1] === "<" ? x < v : cmp[1] === ">=" ? x >= v : x <= v);
  } else {
    const v = num(q);
    if (!isNaN(v)) test = (x) => Math.abs(x - v) < 0.005 || Math.floor(x) === v;
  }
  if (!test) return null;
  return amounts.some((a) => test!(a || 0));
}
