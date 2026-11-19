// ─── Libro de presupuesto: comprometido, realizado y caja ────────────────────
// ÚNICA fuente de verdad. Se calcula siempre desde los documentos (POs,
// facturas, gastos de caja), nunca sumando y restando contadores, así que no
// puede desviarse. Lo usan el servidor (que además guarda el resultado en las
// subcuentas y en las POs) y cualquier pantalla o informe.
//
// Reglas (con la configuración de costes del proyecto):
//
//  · Comprometido de una línea de PO = su base − lo ya REALIZADO de facturas
//    vinculadas a esa línea. Un importe sale del comprometido exactamente en el
//    mismo momento en que entra en realizado: ni antes ni después, nunca dos
//    veces ni ninguna.
//  · Si la línea está cerrada (o la PO cerrada/anulada) solo sigue comprometido
//    lo facturado que aún no se ha realizado (para no dejar un hueco).
//  · Realizado = líneas de facturas que ya cuentan: al codificarlas o al
//    contabilizarlas, según ajustes. Anuladas/rechazadas nunca cuentan.
//  · Proformas y presupuestos: según ajustes, realizan como una factura o solo
//    cuenta la factura definitiva. Una proforma sustituida por una factura
//    nueva deja de contar cuando la definitiva cuenta (no se duplica).
//  · Caja (tarjetas, transferencias, efectivo): al codificar el sobre/gasto o
//    al contabilizarlo, según ajustes. No pasa por comprometido.
//  · Todo importe sin cuenta va a la clave UNASSIGNED para que el total cuadre.

export type PoTrigger = "on_create" | "on_approve";
export type InvoiceTrigger = "on_code" | "on_account";
export type BoxTrigger = "on_create" | "on_account";

export interface LedgerSettings {
  poCommitmentTrigger: PoTrigger;
  invoiceActualTrigger: InvoiceTrigger;
  boxActualTrigger: BoxTrigger;
  /** true: una proforma/presupuesto realiza como una factura. false: solo la factura definitiva. */
  proformaRealizes: boolean;
}

export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = {
  poCommitmentTrigger: "on_approve",
  invoiceActualTrigger: "on_code",
  boxActualTrigger: "on_create",
  proformaRealizes: true,
};

/** Normaliza lo guardado en config/cost (incluye valores antiguos). */
export function normalizeSettings(raw: Record<string, unknown> | null | undefined): LedgerSettings {
  const r = raw || {};
  const inv = String(r.invoiceActualTrigger || DEFAULT_LEDGER_SETTINGS.invoiceActualTrigger);
  const box = String(r.boxActualTrigger || DEFAULT_LEDGER_SETTINGS.boxActualTrigger);
  const po = String(r.poCommitmentTrigger || DEFAULT_LEDGER_SETTINGS.poCommitmentTrigger);
  return {
    poCommitmentTrigger: po === "on_create" ? "on_create" : "on_approve",
    // Antiguos: on_paid → al contabilizar; on_approve/on_create → al codificar.
    invoiceActualTrigger: inv === "on_account" || inv === "on_paid" ? "on_account" : "on_code",
    boxActualTrigger: box === "on_account" || box === "on_paid" ? "on_account" : "on_create",
    proformaRealizes: r.proformaRealizes === undefined ? DEFAULT_LEDGER_SETTINGS.proformaRealizes : !!r.proformaRealizes,
  };
}

export const UNASSIGNED = "—";

type Doc = Record<string, any> & { id: string };
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Facturas ────────────────────────────────────────────────────────────────

const DEAD_INVOICE = ["cancelled", "rejected", "void", "draft"];

/** La factura existe a efectos de presupuesto (no borrador, no anulada/rechazada). */
export function invoiceAlive(inv: Record<string, any>) {
  return !DEAD_INVOICE.includes(inv.status) && inv.approvalStatus !== "rejected";
}

/** Proforma o presupuesto aún no convertido en factura definitiva. */
export function isProforma(inv: Record<string, any>) {
  return inv.documentType === "proforma" || inv.documentType === "budget";
}

/** ¿Ha llegado ya al momento que la hace contar como realizado? (sin mirar sustituciones) */
export function invoiceReachedTrigger(inv: Record<string, any>, s: LedgerSettings) {
  if (!invoiceAlive(inv)) return false;
  if (isProforma(inv) && !s.proformaRealizes) return false;
  // (status "coded"/"accounted"/"paid" son de documentos antiguos)
  const accounted = !!(inv.accountedAt || inv.accounted || inv.paidAt || ["accounted", "paid"].includes(inv.status));
  return s.invoiceActualTrigger === "on_account" ? accounted : accounted || !!inv.codedAt || inv.status === "coded";
}

// ── POs ─────────────────────────────────────────────────────────────────────

/** ¿La PO compromete con su importe completo? */
export function poCommitsFully(po: Record<string, any>, s: LedgerSettings) {
  if (po.status === "approved") return true;
  return s.poCommitmentTrigger === "on_create" && po.status === "pending";
}
/** PO terminada: solo queda comprometido lo facturado pendiente de realizar. */
const poFinished = (po: Record<string, any>) => po.status === "closed" || po.status === "cancelled";

// ── Resultado ───────────────────────────────────────────────────────────────

export interface SubTotals { committed: number; actual: number; box: number }
export interface PoLineLedger {
  index: number;
  subAccountCode: string;
  base: number;
  /** Facturado: todas las facturas vivas vinculadas (realizadas o no). */
  invoiced: number;
  /** De eso, lo que ya es realizado. */
  realized: number;
  committed: number;
}
export interface PoLedger { lines: PoLineLedger[]; invoiced: number; realized: number; committed: number; base: number }
export interface LedgerIssue { kind: "no_account" | "unlinked_po_line" | "over_invoiced"; docId: string; collection: string; amount: number; detail: string }

export interface Ledger {
  bySub: Record<string, SubTotals>;
  pos: Record<string, PoLedger>;
  /** Por factura: si cuenta como realizado ahora mismo. */
  invoiceRealized: Record<string, boolean>;
  totals: SubTotals;
  issues: LedgerIssue[];
}

export interface LedgerInput {
  pos: Doc[];
  invoices: Doc[];
  cardExpenses?: Doc[];
  transferExpenses?: Doc[];
  transferEnvelopes?: Doc[];
  cashMovements?: Doc[];
}

export function computeLedger(input: LedgerInput, s: LedgerSettings): Ledger {
  const bySub: Record<string, SubTotals> = {};
  const issues: LedgerIssue[] = [];
  const add = (code: string | undefined, k: keyof SubTotals, amount: number) => {
    if (!amount) return;
    const key = code || UNASSIGNED;
    const t = (bySub[key] ||= { committed: 0, actual: 0, box: 0 });
    t[k] = r2(t[k] + amount);
  };

  // 1) Qué facturas cuentan, resolviendo sustituciones proforma → definitiva.
  const invById = new Map(input.invoices.map((i) => [i.id, i]));
  const reached = new Map(input.invoices.map((i) => [i.id, invoiceReachedTrigger(i, s)]));
  const invoiceRealized: Record<string, boolean> = {};
  const invoiceCountsAsInvoiced: Record<string, boolean> = {};
  for (const inv of input.invoices) {
    const repl = inv.replacedByInvoiceId ? invById.get(inv.replacedByInvoiceId) : undefined;
    const replAlive = !!repl && invoiceAlive(repl);
    // Sustituida: deja de contar en cuanto la definitiva cuenta.
    invoiceRealized[inv.id] = !!reached.get(inv.id) && !(replAlive && reached.get(repl!.id));
    invoiceCountsAsInvoiced[inv.id] = invoiceAlive(inv) && !replAlive;
  }

  // 2) Realizado por cuenta de cada línea de factura.
  for (const inv of input.invoices) {
    if (!invoiceRealized[inv.id]) continue;
    for (const it of inv.items || []) {
      const base = num(it.baseAmount);
      if (!it.subAccountCode && base) issues.push({ kind: "no_account", docId: inv.id, collection: "invoices", amount: base, detail: `${inv.displayNumber || inv.number || inv.id}: línea sin cuenta` });
      add(it.subAccountCode, "actual", base);
    }
  }

  // 3) POs: facturado y realizado por línea, y comprometido.
  const pos: Record<string, PoLedger> = {};
  const linked: Record<string, { invoiced: number[]; realized: number[] }> = {};
  const poById = new Map(input.pos.map((p) => [p.id, p]));
  for (const inv of input.invoices) {
    for (const it of inv.items || []) {
      // Cada línea puede ir a su propia PO (ítem de otra PO); si no, a la de la factura.
      const poId: string | undefined = it.poId || inv.poId;
      if (!poId || !poById.has(poId)) continue;
      const po = poById.get(poId)!;
      const poItems: any[] = po.items || [];
      const l = (linked[poId] ||= { invoiced: poItems.map(() => 0), realized: poItems.map(() => 0) });
      const base = num(it.baseAmount);
      // El ítem se identifica por su índice (metadato), no por el concepto.
      let idx = typeof it.poItemIndex === "number" && it.poItemIndex >= 0 && it.poItemIndex < poItems.length ? it.poItemIndex : -1;
      if (idx < 0 && it.poItemId) idx = poItems.findIndex((p) => p.id === it.poItemId);
      if (idx < 0 && it.subAccountCode && !it.poId) idx = poItems.findIndex((p) => p.subAccountCode === it.subAccountCode);
      if (idx < 0) {
        if (base && invoiceCountsAsInvoiced[inv.id]) issues.push({ kind: "unlinked_po_line", docId: inv.id, collection: "invoices", amount: base, detail: `${inv.displayNumber || inv.id}: línea sin partida de la PO` });
        continue;
      }
      if (invoiceCountsAsInvoiced[inv.id]) l.invoiced[idx] = r2(l.invoiced[idx] + base);
      if (invoiceRealized[inv.id]) l.realized[idx] = r2(l.realized[idx] + base);
    }
  }

  for (const po of input.pos) {
    const items: any[] = po.items || [];
    const l = linked[po.id] || { invoiced: items.map(() => 0), realized: items.map(() => 0) };
    // PO aprobada en modificación: sigue contando su versión anterior.
    // (también si la modificación se rechaza: la versión aprobada sigue valiendo).
    const modifying = (po.previousCommittedItems?.length || 0) > 0 && ["draft", "pending", "rejected"].includes(po.status);
    const lines: PoLineLedger[] = items.map((it, i) => {
      const base = num(it.baseAmount);
      const invoiced = l.invoiced[i] || 0, realized = l.realized[i] || 0;
      let committed = 0;
      if (!modifying) {
        if (poFinished(po) || (it.isClosed && poCommitsFully(po, s))) committed = Math.max(0, Math.min(base, invoiced) - realized);
        else if (poCommitsFully(po, s)) committed = Math.max(0, base - realized);
        else committed = Math.max(0, Math.min(base, invoiced) - realized); // borrador/pendiente/rechazada con facturas ya vinculadas
      }
      if (invoiced > base + 0.005 && base > 0) issues.push({ kind: "over_invoiced", docId: po.id, collection: "pos", amount: r2(invoiced - base), detail: `PO-${po.number || po.id} línea ${i + 1}: facturado por encima de la PO` });
      return { index: i, subAccountCode: it.subAccountCode || "", base, invoiced, realized, committed: r2(committed) };
    });
    if (modifying) {
      (po.previousCommittedItems as any[]).forEach((it, i) => {
        const idx = typeof it.index === "number" ? it.index : i;
        const c = Math.max(0, num(it.baseAmount) - (l.realized[idx] || 0));
        const code = it.subAccountCode || items.find((x) => x.subAccountId && x.subAccountId === it.subAccountId)?.subAccountCode;
        add(code, "committed", r2(c));
      });
    } else {
      for (const ln of lines) add(ln.subAccountCode, "committed", ln.committed);
    }
    const sum = (k: keyof PoLineLedger) => r2(lines.reduce((t, x) => t + (x[k] as number), 0));
    pos[po.id] = { lines, invoiced: sum("invoiced"), realized: sum("realized"), committed: sum("committed"), base: sum("base") };
  }

  // 4) Caja.
  const boxLines = (e: Record<string, any>) => {
    const items: any[] = e.items?.length ? e.items : e.lines?.length ? e.lines : [];
    if (!items.length) return [{ code: e.subAccountCode, base: num(e.baseAmount) }];
    return items.map((it) => ({ code: it.subAccountCode || e.subAccountCode, base: num(it.baseAmount) }));
  };
  const coded = (status: string) => (s.boxActualTrigger === "on_account" ? status === "accounted" : status === "reviewed" || status === "accounted");
  for (const e of input.cardExpenses || []) if (coded(e.status)) for (const x of boxLines(e)) add(x.code, "box", x.base);
  const envStatus = new Map((input.transferEnvelopes || []).map((e) => [e.id, e.status]));
  for (const e of input.transferExpenses || []) {
    const st = envStatus.get(e.envelopeId);
    if (st === undefined && (input.transferEnvelopes || []).length) continue; // sobre borrado
    const counts = s.boxActualTrigger === "on_account" ? st === "settled" : true;
    if (counts) for (const x of boxLines(e)) add(x.code, "box", x.base);
  }
  for (const m of input.cashMovements || []) {
    if ((m.type === "expense" || m.type === "settlement") && coded(m.status)) for (const x of boxLines(m)) add(x.code, "box", x.base);
  }
  for (const [code, t] of Object.entries(bySub)) if (code === UNASSIGNED && t.box) issues.push({ kind: "no_account", docId: "", collection: "box", amount: t.box, detail: "Gastos de caja sin cuenta" });

  const totals = Object.values(bySub).reduce((a, t) => ({ committed: r2(a.committed + t.committed), actual: r2(a.actual + t.actual), box: r2(a.box + t.box) }), { committed: 0, actual: 0, box: 0 });
  return { bySub, pos, invoiceRealized, totals, issues };
}
