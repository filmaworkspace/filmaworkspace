// ─── Lectura de facturas: del texto a propuestas ─────────────────────────────
// A partir del texto de una factura (extraído del PDF o por OCR) propone datos:
// NIF/CIF del proveedor, IBAN, número, fechas, base, IVA, IRPF y total. Solo
// propone: quien codifica decide qué usar. Sin servicios externos: reglas y
// comprobaciones (IBAN válido, NIF con su letra, base + IVA − IRPF = total).

export type Confidence = "alta" | "media" | "baja";
export type ProposalField = "supplierTaxId" | "supplierIban" | "supplierNumber" | "invoiceDate" | "dueDate" | "baseAmount" | "vatRate" | "vatAmount" | "irpfRate" | "irpfAmount" | "totalAmount";

export interface Proposal {
  field: ProposalField;
  /** Valor normalizado (fechas AAAA-MM-DD, importes en número, NIF/IBAN sin espacios). */
  value: string | number;
  /** Tal y como aparece en el documento. */
  raw: string;
  confidence: Confidence;
  /** Otras lecturas posibles (p. ej. varios NIF). */
  alternatives?: (string | number)[];
}

export const FIELD_LABELS: Record<ProposalField, string> = {
  supplierTaxId: "NIF / CIF del proveedor", supplierIban: "IBAN", supplierNumber: "Nº de factura", invoiceDate: "Fecha de factura",
  dueDate: "Vencimiento", baseAmount: "Base imponible", vatRate: "IVA %", vatAmount: "Cuota de IVA", irpfRate: "IRPF %", irpfAmount: "Retención IRPF", totalAmount: "Total",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── Importes ────────────────────────────────────────────────────────────────
const AMOUNT_RE = /-?\d{1,3}(?:[.\s ]\d{3})*(?:,\d{1,2})|-?\d+(?:[.,]\d{1,2})|-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})/g;
/** "1.234,56" / "1234,56" / "1,234.56" / "1234.56" → 1234.56 */
export function parseAmount(s: string): number | null {
  let t = s.replace(/[€\s ]/g, "").replace(/EUR/i, "");
  if (!t) return null;
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) t = t.replace(/,/g, "");
  else if (lastDot >= 0 && t.length - lastDot - 1 === 3 && !/\.\d{3}\./.test(t) && (t.match(/\./g) || []).length >= 1 && lastComma < 0 && t.split(".").length > 2) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
const amountsIn = (line: string) => (line.match(AMOUNT_RE) || []).map((m) => ({ raw: m.trim(), value: parseAmount(m) })).filter((a): a is { raw: string; value: number } => a.value !== null);

// ── Fechas ──────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12, ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
function toIso(d: number, m: number, y: number) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function datesIn(line: string): { raw: string; value: string }[] {
  const out: { raw: string; value: string }[] = [];
  for (const m of line.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    const v = toIso(+m[1], +m[2], +m[3]); if (v) out.push({ raw: m[0], value: v });
  }
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const v = toIso(+m[3], +m[2], +m[1]); if (v) out.push({ raw: m[0], value: v });
  }
  for (const m of norm(line).matchAll(/\b(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?\s*(?:de\s+)?(\d{4})\b/g)) {
    const mm = MONTHS[m[2]]; if (!mm) continue;
    const v = toIso(+m[1], mm, +m[3]); if (v) out.push({ raw: m[0], value: v });
  }
  return out;
}

// ── NIF / CIF / NIE ─────────────────────────────────────────────────────────
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
export function validTaxId(id: string): boolean {
  const t = id.toUpperCase().replace(/[\s\-.]/g, "").replace(/^ES/, "");
  if (/^\d{8}[A-Z]$/.test(t)) return DNI_LETTERS[+t.slice(0, 8) % 23] === t[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(t)) return DNI_LETTERS[+(("XYZ".indexOf(t[0])) + t.slice(1, 8)) % 23] === t[8];
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(t)) {
    const digits = t.slice(1, 8);
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const n = +digits[i];
      if (i % 2 === 0) { const d = n * 2; sum += Math.floor(d / 10) + (d % 10); } else sum += n;
    }
    const c = (10 - (sum % 10)) % 10;
    return t[8] === String(c) || t[8] === "JABCDEFGHI"[c];
  }
  return false;
}
const TAXID_RE = /\b(?:ES[\s\-]?)?([A-HJ-NP-SUVW][\s\-.]?\d{7}[\s\-.]?[0-9A-J]|\d{8}[\s\-]?[A-Z]|[XYZ][\s\-]?\d{7}[\s\-]?[A-Z])\b/g;
const cleanTaxId = (s: string) => s.toUpperCase().replace(/[\s\-.]/g, "").replace(/^ES/, "");

// ── IBAN ────────────────────────────────────────────────────────────────────
export function validIban(iban: string): boolean {
  const t = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(t)) return false;
  const r = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of r) mod = (mod * 10 + +ch) % 97;
  return mod === 1;
}

// ── Lectura ─────────────────────────────────────────────────────────────────
/** El importe de una línea con etiqueta: el último de la línea, o el de la siguiente si no hay. */
function labelled(lines: string[], re: RegExp, opts: { notRe?: RegExp } = {}) {
  for (let i = 0; i < lines.length; i++) {
    const n = norm(lines[i]);
    if (!re.test(n) || (opts.notRe && opts.notRe.test(n))) continue;
    const after = lines[i].slice(n.search(re));
    // Ignora porcentajes ("21 %", "21,00%") al buscar el importe.
    const amounts = amountsIn(after.replace(/\d+(?:[.,]\d+)?\s*%/g, " "));
    if (amounts.length) return { ...amounts[amounts.length - 1], line: lines[i] };
    const next = lines[i + 1] ? amountsIn(lines[i + 1].replace(/\d+(?:[.,]\d+)?\s*%/g, " ")) : [];
    if (next.length) return { ...next[next.length - 1], line: lines[i + 1] };
  }
  return null;
}
const percentIn = (line: string) => { const m = line.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/); return m ? parseAmount(m[1]) : null; };

export function parseInvoiceText(text: string, opts: { exclude?: string[] } = {}): Proposal[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const all = lines.join("\n");
  const out: Proposal[] = [];
  const exclude = new Set((opts.exclude || []).map(cleanTaxId));

  // NIF / CIF: válidos y que no sean los nuestros (el cliente de la factura).
  const ids: { raw: string; value: string }[] = [];
  for (const m of all.matchAll(TAXID_RE)) {
    const v = cleanTaxId(m[0]);
    if (validTaxId(v) && !exclude.has(v) && !ids.some((x) => x.value === v)) ids.push({ raw: m[0], value: v });
  }
  if (ids.length) out.push({ field: "supplierTaxId", value: ids[0].value, raw: ids[0].raw, confidence: ids.length === 1 ? "alta" : "media", alternatives: ids.slice(1).map((x) => x.value) });

  // IBAN válido
  for (const m of all.toUpperCase().matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g)) {
    const v = m[0].replace(/\s+/g, "");
    if (validIban(v)) { out.push({ field: "supplierIban", value: v, raw: m[0], confidence: "alta" }); break; }
  }

  // Número de factura
  const numRe = /(?:factura|fra\.?|invoice|n[ºo°]\.?\s*(?:de\s+)?factura|numero(?:\s+de\s+factura)?|n[ºo°]\s*:?)\s*(?:n[ºo°.]*|numero|num\.?|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/._]{1,24})/i;
  for (const l of lines) {
    const m = l.match(numRe);
    if (!m) continue;
    const v = m[1].replace(/[.,;:]+$/, "");
    if (!/\d/.test(v) || validTaxId(v) || datesIn(v).length) continue;
    out.push({ field: "supplierNumber", value: v, raw: m[0], confidence: /n[ºo°]|numero|#/i.test(m[0]) ? "alta" : "media" });
    break;
  }

  // Fechas: por etiqueta y, si no, la primera.
  const dateBy = (re: RegExp) => { for (let i = 0; i < lines.length; i++) if (re.test(norm(lines[i]))) { const d = datesIn(lines[i])[0] || datesIn(lines[i + 1] || "")[0]; if (d) return d; } return null; };
  const due = dateBy(/vencimiento|vence|fecha de pago|due date/);
  const issued = dateBy(/fecha(?:\s+de)?\s*(?:factura|emision|expedicion)|fecha\s*:|^fecha\b|invoice date|date/);
  const first = datesIn(all)[0];
  const inv = issued || (first && first.value !== due?.value ? first : null);
  if (inv) out.push({ field: "invoiceDate", value: inv.value, raw: inv.raw, confidence: issued ? "alta" : "baja" });
  if (due && due.value !== inv?.value) out.push({ field: "dueDate", value: due.value, raw: due.raw, confidence: "alta" });

  // Importes
  const base = labelled(lines, /base imponible|base\s*:|subtotal|importe neto|total neto|base\b/, { notRe: /retencion|irpf/ });
  const vatLine = lines.find((l) => /\biva\b|i\.v\.a|vat\b/.test(norm(l)) && !/incluido|exento/.test(norm(l)));
  const vat = labelled(lines, /cuota\s*(?:de\s*)?iva|\biva\b|i\.v\.a|vat\b/, { notRe: /incluido|exento|base|total/ });
  const irpf = labelled(lines, /irpf|retencion/);
  const total = labelled(lines, /total\s*(?:factura|a pagar|eur|€)|importe total|total\s*:|\btotal\b/, { notRe: /neto|base|subtotal|iva/ });
  const vatRate = vatLine ? percentIn(vatLine) : null;
  const irpfLine = lines.find((l) => /irpf|retencion/.test(norm(l)));
  const irpfRate = irpfLine ? percentIn(irpfLine) : null;

  // ¿Cuadran? base + IVA − IRPF = total
  const fits = base && total && Math.abs(base.value + (vat?.value || 0) - (irpf?.value || 0) - total.value) < 0.05;
  const conf = (x: unknown): Confidence => (fits ? "alta" : x ? "media" : "baja");
  if (base) out.push({ field: "baseAmount", value: base.value, raw: base.raw, confidence: conf(base) });
  if (vatRate !== null && [0, 4, 5, 10, 21].includes(vatRate)) out.push({ field: "vatRate", value: vatRate, raw: `${vatRate} %`, confidence: fits ? "alta" : "media" });
  if (vat) out.push({ field: "vatAmount", value: vat.value, raw: vat.raw, confidence: conf(vat) });
  if (irpfRate !== null && irpfRate > 0 && irpfRate < 50) out.push({ field: "irpfRate", value: irpfRate, raw: `${irpfRate} %`, confidence: fits ? "alta" : "media" });
  if (irpf) out.push({ field: "irpfAmount", value: irpf.value, raw: irpf.raw, confidence: conf(irpf) });
  if (total) out.push({ field: "totalAmount", value: total.value, raw: total.raw, confidence: conf(total) });

  // Si falta la base pero hay total e IVA %: se deduce (marcada como baja).
  if (!base && total && vatRate !== null) {
    const b = Math.round((total.value / (1 + vatRate / 100 - (irpfRate || 0) / 100)) * 100) / 100;
    out.push({ field: "baseAmount", value: b, raw: `deducida de ${total.raw}`, confidence: "baja" });
  }
  return out;
}
