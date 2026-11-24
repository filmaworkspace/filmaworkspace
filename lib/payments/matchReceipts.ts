// ─── Justificantes de pago: a qué pago corresponde cada archivo ──────────────
// Propone (no asigna) con lo que hay: el nombre del archivo y, si es un PDF con
// texto, su contenido. Puntúa coincidencias de número de factura, número del
// proveedor, importe y nombre del proveedor.

export interface ReceiptTarget {
  id: string;
  supplier: string;
  amount: number;
  /** Números con los que puede aparecer: FAC-0012, nº de la factura del proveedor… */
  numbers: string[];
}

export interface ReceiptMatch { itemId: string | null; score: number; reasons: string[] }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const compact = (s: string) => norm(s).replace(/[^a-z0-9]/g, "");
const STOP = new Set(["sl", "sa", "slu", "sociedad", "limitada", "anonima", "s.l.", "s.a."]);

/** Formas habituales de escribir un importe en un justificante. */
export function amountForms(n: number): string[] {
  const fixed = n.toFixed(2);
  const [int, dec] = fixed.split(".");
  const dotted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const commaed = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return Array.from(new Set([`${dotted},${dec}`, `${int},${dec}`, `${commaed}.${dec}`, `${int}.${dec}`]));
}

function scoreOne(fileName: string, text: string, t: ReceiptTarget) {
  const reasons: string[] = [];
  let score = 0;
  const fn = compact(fileName.replace(/\.[a-z0-9]+$/i, ""));
  const tx = compact(text);
  const nums = t.numbers.map(compact).filter((x) => x.length >= 3);
  if (nums.some((n) => fn.includes(n))) { score += 6; reasons.push("número en el nombre del archivo"); }
  else if (tx && nums.some((n) => tx.includes(n))) { score += 5; reasons.push("número en el documento"); }
  if (text && t.amount > 0 && amountForms(t.amount).some((a) => text.includes(a))) { score += 3; reasons.push("importe"); }
  const words = norm(t.supplier).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));
  if (words.length && words.some((w) => fn.includes(w) || (text && norm(text).includes(w)))) { score += 2; reasons.push("proveedor"); }
  return { score, reasons };
}

/**
 * Mejor candidato para un archivo. Solo propone si destaca: puntuación mínima
 * de 3 y sin empate con otro pago.
 */
export function matchReceipt(fileName: string, text: string, targets: ReceiptTarget[], taken: Set<string> = new Set()): ReceiptMatch {
  const scored = targets.filter((t) => !taken.has(t.id)).map((t) => ({ t, ...scoreOne(fileName, text, t) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 3) return { itemId: null, score: best?.score || 0, reasons: [] };
  if (scored[1] && scored[1].score === best.score) return { itemId: null, score: best.score, reasons: ["varios pagos posibles"] };
  return { itemId: best.t.id, score: best.score, reasons: best.reasons };
}
