// ─── Cálculo de importes (POs, facturas, vencimientos) ───────────────────────
// Un único sitio para base, IVA, IRPF y total, siempre redondeados a céntimos.
// Sin redondeo, 3 × 33,33 € daba 99,99000000000001 y las sumas de IVA podían
// descuadrar un céntimo respecto a la factura del proveedor.
// Probado en tests/unit/amounts.test.ts.

/** Redondea a 2 decimales (céntimos), con el medio céntimo hacia arriba. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // + 0 convierte −0 en 0 (si no, se vería "-0,00 €")
  return Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100 + 0;
}

export interface LineInput {
  quantity: number;
  unitPrice: number;
  vatRate: number;  // %
  irpfRate: number; // %
}

export interface LineAmounts {
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
}

const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."))) || 0;

/** Importes de una línea: base = cantidad × precio; total = base + IVA − IRPF. */
export function lineAmounts(line: LineInput): LineAmounts {
  const baseAmount = round2(num(line.quantity) * num(line.unitPrice));
  const vatAmount = round2((baseAmount * num(line.vatRate)) / 100);
  const irpfAmount = round2((baseAmount * num(line.irpfRate)) / 100);
  return { baseAmount, vatAmount, irpfAmount, totalAmount: round2(baseAmount + vatAmount - irpfAmount) };
}

/** Totales del documento sumando las líneas ya calculadas. */
export function documentTotals(lines: Partial<LineAmounts>[]): LineAmounts {
  const sum = (k: keyof LineAmounts) => round2(lines.reduce((s, l) => s + (num(l[k]) || 0), 0));
  return { baseAmount: sum("baseAmount"), vatAmount: sum("vatAmount"), irpfAmount: sum("irpfAmount"), totalAmount: sum("totalAmount") };
}

/**
 * Reparte un importe por porcentajes (vencimientos, capítulos). La suma de las
 * partes es exactamente el importe: el céntimo que sobra o falta por redondeo
 * va a la última parte.
 */
export function splitByPercent(total: number, percents: number[]): number[] {
  if (!percents.length) return [];
  const parts = percents.map((p) => round2((total * num(p)) / 100));
  const pctSum = round2(percents.reduce((s, p) => s + num(p), 0));
  if (pctSum === 100) {
    const diff = round2(total - parts.reduce((s, x) => s + x, 0));
    parts[parts.length - 1] = round2(parts[parts.length - 1] + diff);
  }
  return parts;
}

/** Reparte un importe en n partes iguales; la última absorbe el céntimo de ajuste. */
export function splitEqually(total: number, n: number): number[] {
  if (n <= 0) return [];
  const each = Math.floor((round2(total) * 100) / n) / 100;
  const parts = Array.from({ length: n }, () => each);
  parts[n - 1] = round2(total - each * (n - 1));
  return parts;
}

/** Disponible de una PO: base − facturado (nunca negativo) y % facturado. */
export function poRemaining(baseAmount: number, invoicedAmount: number) {
  const base = round2(num(baseAmount));
  const invoiced = round2(num(invoicedAmount));
  return {
    remaining: round2(Math.max(0, base - invoiced)),
    overInvoiced: round2(Math.max(0, invoiced - base)),
    percent: base > 0 ? Math.round((invoiced / base) * 1000) / 10 : 0,
  };
}
