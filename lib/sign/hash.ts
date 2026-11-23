// Filma Sign: JSON estable para la huella SHA-256 de lo que se firma.

/** JSON estable (claves ordenadas) para que la huella no dependa del orden. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
/** Quita Timestamps y referencias (no se pueden congelar tal cual). */
export function plain(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as { toMillis?: () => number };
    if (typeof o.toMillis === "function") return o.toMillis();
    if (Array.isArray(v)) return v.map(plain);
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}
