// ─── Caja de efectivo (Petty Cash) ───────────────────────────────────────────
// Modelo:
//   projects/{id}/cashFloats/{floatId}      una caja física (con su custodio)
//   projects/{id}/cashMovements/{movId}     libro de caja: cada entrada/salida
//   projects/{id}/cashCounts/{countId}      arqueos (recuento por billetes y monedas)
//
// El saldo no se guarda: se calcula sumando el efecto de cada movimiento, así
// nunca se descuadra por una escritura a medias.

export type CashMovementType =
  | "funding"        // reposición: entra efectivo a la caja (desde banco, cheque…)
  | "advance"        // anticipo: sale efectivo a una persona, que justificará después
  | "return"         // devolución de anticipo: la persona devuelve lo que sobró
  | "expense"        // pago directo con ticket/factura desde la caja
  | "settlement"     // justificación de un anticipo con tickets (no mueve efectivo)
  | "reimbursement"  // la caja reembolsa a una persona que gastó más del anticipo
  | "adjustment";    // descuadre detectado en un arqueo (+/-)

export type CashMovementStatus = "pending" | "reviewed" | "accounted";

export interface CashLine {
  subAccountCode: string;
  subAccountDescription: string;
  description: string;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
}

export interface CashFloat {
  id: string;
  name: string;
  code: string;
  custodianName: string;
  department?: string;
  status: "open" | "closed";
  nextNumber: number;
  notes?: string;
  createdAt: Date | null;
  createdByName?: string;
}

export interface CashMovement {
  id: string;
  floatId: string;
  type: CashMovementType;
  number: string;              // nº de vale, p. ej. CP-0007
  date: string;                // YYYY-MM-DD
  personName?: string;
  personDepartment?: string;
  supplier?: string;
  supplierTaxId?: string;
  documentType?: "ticket" | "invoice";
  description: string;
  reference?: string;          // reposición: transferencia, cheque…
  amount: number;              // importe absoluto
  lines?: CashLine[];          // gastos y justificaciones
  advanceId?: string;          // justificaciones, devoluciones y reembolsos
  attachmentUrl?: string;
  attachmentFileName?: string;
  status: CashMovementStatus;
  createdAt: Date | null;
  createdByName?: string;
}

export interface CashCount {
  id: string;
  floatId: string;
  date: string;
  counts: Record<string, number>; // denominación → unidades
  counted: number;
  expected: number;
  difference: number;
  notes?: string;
  createdAt: Date | null;
  createdByName?: string;
}

export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];

export const MOVEMENT_LABEL: Record<CashMovementType, string> = {
  funding: "Reposición",
  advance: "Anticipo",
  return: "Devolución",
  expense: "Gasto",
  settlement: "Justificación",
  reimbursement: "Reembolso",
  adjustment: "Ajuste de arqueo",
};

/** Efecto del movimiento sobre el efectivo de la caja (+ entra, − sale). */
export function cashEffect(m: Pick<CashMovement, "type" | "amount">): number {
  switch (m.type) {
    case "funding":
    case "return":
      return m.amount;
    case "advance":
    case "expense":
    case "reimbursement":
      return -m.amount;
    case "adjustment":
      return m.amount; // con signo
    default:
      return 0; // la justificación documenta un anticipo, no mueve efectivo
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function balanceOf(movements: CashMovement[]) {
  return round2(movements.reduce((s, m) => s + cashEffect(m), 0));
}

/** Pendiente de justificar de cada anticipo (anticipo − justificado − devuelto). */
export function advanceOutstanding(advance: CashMovement, movements: CashMovement[]) {
  const linked = movements.filter((m) => m.advanceId === advance.id);
  const justified = linked.filter((m) => m.type === "settlement").reduce((s, m) => s + m.amount, 0);
  const returned = linked.filter((m) => m.type === "return").reduce((s, m) => s + m.amount, 0);
  const reimbursed = linked.filter((m) => m.type === "reimbursement").reduce((s, m) => s + m.amount, 0);
  return round2(advance.amount - justified - returned + reimbursed);
}

export function lineTotals(lines: CashLine[]) {
  const base = round2(lines.reduce((s, l) => s + (l.baseAmount || 0), 0));
  const vat = round2(lines.reduce((s, l) => s + (l.vatAmount || 0), 0));
  return { base, vat, total: round2(base + vat) };
}

/** Movimientos que imputan coste al presupuesto (realizado de caja). */
export const isCostMovement = (m: Pick<CashMovement, "type">) => m.type === "expense" || m.type === "settlement";

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
