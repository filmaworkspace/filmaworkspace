// ─── Facturación de Filma a sus cuentas (productoras) ────────────────────────
// billingInvoices/{id}: borrador → emitida (número correlativo por serie y
// año, inmutable) → anulada (solo con una factura rectificativa, que va en su
// propia serie y en negativo). Los datos fiscales de Filma están en
// adminConfig/billing y se copian a la factura al emitirla, para que un
// cambio posterior no altere facturas ya emitidas.

import { doc, getDoc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { lineAmounts, round2 } from "@/lib/amounts";

export interface BillingParty {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  email: string;
}

export interface BillingSettings extends BillingParty {
  phone: string;
  iban: string;
  bank: string;
  invoicePrefix: string;
  rectifyingPrefix: string;
  quotePrefix: string;
  quoteValidityDays: number;
  quoteConditions: string;
  paymentDays: number;
  defaultVat: number;
  monthlyPrice: number;
  footer: string;
}

export const DEFAULT_SETTINGS: BillingSettings = {
  name: "", taxId: "", address: "", postalCode: "", city: "", province: "", country: "España", email: "",
  phone: "", iban: "", bank: "", invoicePrefix: "F", rectifyingPrefix: "R", quotePrefix: "P", quoteValidityDays: 30,
  quoteConditions: "Precios sin IVA. Las cuotas mensuales se facturan a mes vencido y se pagan por transferencia a 30 días.",
  paymentDays: 30, defaultVat: 21, monthlyPrice: 0,
  footer: "",
};

export interface BillingLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  projectId?: string | null;
}

export type InvoiceStatus = "draft" | "issued" | "voided";
export type InvoiceKind = "standard" | "rectifying";
export type PeriodType = "monthly" | "project" | "other";

export interface BillingInvoice {
  id: string;
  status: InvoiceStatus;
  kind: InvoiceKind;
  number: string | null;
  series: string | null;
  year: number | null;
  producerId: string;
  client: BillingParty;
  issuer: (BillingParty & { phone?: string; iban?: string; bank?: string; footer?: string }) | null;
  periodType: PeriodType;
  periodMonth: string | null;
  projectId: string | null;
  projectName: string | null;
  issueDate: string;
  dueDate: string;
  lines: BillingLine[];
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatBreakdown: { rate: number; base: number; vat: number }[];
  notes: string;
  /** Presupuesto del que sale la factura. */
  quoteId?: string | null;
  quoteNumber?: string | null;
  rectifies?: { id: string; number: string; issueDate: string } | null;
  rectifiedBy?: { id: string; number: string } | null;
  reason?: string | null;
  voidReason?: string | null;
  paid?: boolean;
  paidAt?: string | null;
  sentAt?: { toMillis: () => number } | null;
  sentTo?: string | null;
  createdAt?: { toMillis: () => number } | null;
  issuedAt?: { toMillis: () => number } | null;
}

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected";
export type BillingMode = "monthly" | "single";

/** Presupuesto para un proyecto de una cuenta; de él salen las facturas. */
export interface BillingQuote {
  id: string;
  status: QuoteStatus;
  number: string | null;
  series: string | null;
  year: number | null;
  producerId: string;
  client: BillingParty;
  issuer: BillingInvoice["issuer"];
  projectId: string | null;
  projectName: string;
  title: string;
  issueDate: string;
  validUntil: string;
  billingMode: BillingMode;
  /** Solo cuota mensual: número de meses y mes de inicio (AAAA-MM). */
  months: number | null;
  startMonth: string | null;
  lines: BillingLine[];
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatBreakdown: { rate: number; base: number; vat: number }[];
  notes: string;
  conditions: string;
  decisionNote?: string | null;
  acceptedAt?: { toMillis: () => number } | null;
  sentAt?: { toMillis: () => number } | null;
  sentTo?: string | null;
  createdAt?: { toMillis: () => number } | null;
}

/** Importe total del presupuesto (en mensual, la cuota por el número de meses). */
export const quoteGrandTotal = (q: Pick<BillingQuote, "billingMode" | "months" | "totalAmount" | "baseAmount">) =>
  q.billingMode === "monthly" && q.months ? { base: round2(q.baseAmount * q.months), total: round2(q.totalAmount * q.months) } : { base: q.baseAmount, total: q.totalAmount };

/** Meses (AAAA-MM) que cubre un presupuesto mensual. */
export function quoteMonths(q: Pick<BillingQuote, "startMonth" | "months">): string[] {
  if (!q.startMonth || !q.months) return [];
  const [y, m] = q.startMonth.split("-").map(Number);
  return Array.from({ length: q.months }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** Facturas que cuentan para lo facturado (emitidas, no anuladas, no rectificativas). */
export const countsAsBilled = (i: Pick<BillingInvoice, "status" | "kind">) => i.status === "issued" && i.kind === "standard";

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: "none" | "info" | "ok" | "bad" }> = {
  draft: { label: "Borrador", tone: "none" },
  sent: { label: "Enviado", tone: "info" },
  accepted: { label: "Aceptado", tone: "ok" },
  rejected: { label: "Rechazado", tone: "bad" },
};

export const emptyParty = (): BillingParty => ({ name: "", taxId: "", address: "", postalCode: "", city: "", province: "", country: "España", email: "" });

export async function fetchBillingSettings(db: Firestore): Promise<BillingSettings> {
  try {
    const s = await getDoc(doc(db, "adminConfig", "billing"));
    return { ...DEFAULT_SETTINGS, ...(s.exists() ? (s.data() as Partial<BillingSettings>) : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Base, IVA y total (redondeados a céntimos) y desglose por tipo de IVA. */
export function invoiceTotals(lines: BillingLine[]) {
  const byRate = new Map<number, { base: number; vat: number }>();
  let base = 0, vat = 0;
  for (const l of lines) {
    const a = lineAmounts({ quantity: l.quantity, unitPrice: l.unitPrice, vatRate: l.vatRate, irpfRate: 0 });
    base += a.baseAmount; vat += a.vatAmount;
    const r = byRate.get(l.vatRate) || { base: 0, vat: 0 };
    byRate.set(l.vatRate, { base: r.base + a.baseAmount, vat: r.vat + a.vatAmount });
  }
  return {
    baseAmount: round2(base),
    vatAmount: round2(vat),
    totalAmount: round2(base + vat),
    vatBreakdown: Array.from(byRate.entries()).sort((a, b) => b[0] - a[0]).map(([rate, x]) => ({ rate, base: round2(x.base), vat: round2(x.vat) })),
  };
}

export const lineTotal = (l: BillingLine) => lineAmounts({ quantity: l.quantity, unitPrice: l.unitPrice, vatRate: l.vatRate, irpfRate: 0 }).baseAmount;

export const eur = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);

export const fmtDay = (iso?: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export const monthName = (ym?: string | null) =>
  ym ? new Date(`${ym}-15T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" }) : "";

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const formatNumber = (series: string, year: number, seq: number) => `${series}${year}-${String(seq).padStart(4, "0")}`;

export const partyLines = (p?: Partial<BillingParty> | null) => {
  if (!p) return [];
  const cityLine = [p.postalCode, p.city].filter(Boolean).join(" ") + (p.province && p.province !== p.city ? ` (${p.province})` : "");
  return [p.address, cityLine.trim(), p.country && p.country !== "España" ? p.country : ""].filter((x) => x && x.trim()) as string[];
};

/** Qué falta para poder emitir (datos obligatorios de una factura en España). */
export function missingForIssue(inv: Pick<BillingInvoice, "client" | "lines" | "issueDate">, s: BillingSettings): string[] {
  const out: string[] = [];
  if (!s.name || !s.taxId || !s.address) out.push("Tus datos fiscales (nombre, NIF y dirección) en Ajustes");
  if (!inv.client.name || !inv.client.taxId || !inv.client.address) out.push("Razón social, NIF y dirección del cliente");
  if (!inv.lines.length || inv.lines.some((l) => !l.description.trim())) out.push("Al menos una línea, todas con concepto");
  if (inv.lines.some((l) => !(l.quantity > 0))) out.push("Cantidades mayores que cero");
  if (!inv.issueDate) out.push("Fecha de emisión");
  return out;
}

/**
 * Emite un borrador: le asigna el siguiente número de su serie y año y copia
 * los datos fiscales de Filma. Todo en una transacción para que dos admins no
 * puedan sacar el mismo número.
 */
export async function issueInvoice(db: Firestore, invoiceId: string, settings: BillingSettings, uid: string) {
  const ref = doc(db, "billingInvoices", invoiceId);
  const counters = doc(db, "adminConfig", "billingCounters");
  return runTransaction(db, async (tx) => {
    const [snap, cSnap] = await Promise.all([tx.get(ref), tx.get(counters)]);
    const inv = snap.data() as BillingInvoice | undefined;
    if (!inv) throw new Error("Factura no encontrada");
    if (inv.status !== "draft") throw new Error("Esta factura ya está emitida");
    const year = Number(inv.issueDate.slice(0, 4));
    const series = settings.invoicePrefix || "F";
    const key = `${series}-${year}`;
    const seq = ((cSnap.data() || {})[key] || 0) + 1;
    const number = formatNumber(series, year, seq);
    tx.set(counters, { [key]: seq }, { merge: true });
    tx.update(ref, {
      status: "issued", number, series, year,
      issuer: issuerSnapshot(settings),
      ...invoiceTotals(inv.lines),
      issuedAt: serverTimestamp(), issuedBy: uid, updatedAt: serverTimestamp(),
    });
    return number;
  });
}

/** Emite un presupuesto: número de la serie de presupuestos y datos de Filma. */
export async function issueQuote(db: Firestore, quoteId: string, settings: BillingSettings, uid: string) {
  const ref = doc(db, "billingQuotes", quoteId);
  const counters = doc(db, "adminConfig", "billingCounters");
  return runTransaction(db, async (tx) => {
    const [snap, cSnap] = await Promise.all([tx.get(ref), tx.get(counters)]);
    const q = snap.data() as BillingQuote | undefined;
    if (!q) throw new Error("Presupuesto no encontrado");
    if (q.status !== "draft") throw new Error("Este presupuesto ya está emitido");
    const year = Number(q.issueDate.slice(0, 4));
    const series = settings.quotePrefix || "P";
    const key = `${series}-${year}`;
    const seq = ((cSnap.data() || {})[key] || 0) + 1;
    const number = formatNumber(series, year, seq);
    tx.set(counters, { [key]: seq }, { merge: true });
    tx.update(ref, {
      status: "sent", number, series, year, issuer: issuerSnapshot(settings), ...invoiceTotals(q.lines),
      issuedAt: serverTimestamp(), issuedBy: uid, updatedAt: serverTimestamp(),
    });
    return number;
  });
}

const issuerSnapshot = (s: BillingSettings) => ({
  name: s.name, taxId: s.taxId, address: s.address, postalCode: s.postalCode, city: s.city, province: s.province,
  country: s.country, email: s.email, phone: s.phone, iban: s.iban, bank: s.bank, footer: s.footer,
});

/**
 * Anula una factura emitida emitiendo su rectificativa (serie propia, mismas
 * líneas en negativo, referencia a la original y motivo). Devuelve el id y el
 * número de la rectificativa.
 */
export async function voidWithRectifying(db: Firestore, invoiceId: string, reason: string, settings: BillingSettings, uid: string) {
  const ref = doc(db, "billingInvoices", invoiceId);
  const counters = doc(db, "adminConfig", "billingCounters");
  const newRef = doc(db, "billingInvoices", `${invoiceId}-R`);
  return runTransaction(db, async (tx) => {
    const [snap, cSnap] = await Promise.all([tx.get(ref), tx.get(counters)]);
    const inv = snap.data() as BillingInvoice | undefined;
    if (!inv) throw new Error("Factura no encontrada");
    if (inv.status !== "issued") throw new Error("Solo se puede anular una factura emitida");
    if (inv.kind === "rectifying") throw new Error("Una rectificativa no se anula: emite una factura nueva");
    const issueDate = todayIso();
    const year = Number(issueDate.slice(0, 4));
    const series = settings.rectifyingPrefix || "R";
    const key = `${series}-${year}`;
    const seq = ((cSnap.data() || {})[key] || 0) + 1;
    const number = formatNumber(series, year, seq);
    const lines = inv.lines.map((l) => ({ ...l, id: `${l.id}r`, quantity: -l.quantity }));
    tx.set(counters, { [key]: seq }, { merge: true });
    tx.set(newRef, {
      status: "issued", kind: "rectifying", number, series, year,
      producerId: inv.producerId, client: inv.client, issuer: issuerSnapshot(settings),
      periodType: inv.periodType, periodMonth: inv.periodMonth, projectId: inv.projectId, projectName: inv.projectName,
      quoteId: inv.quoteId || null, quoteNumber: inv.quoteNumber || null,
      issueDate, dueDate: issueDate, lines, ...invoiceTotals(lines),
      notes: "", rectifies: { id: invoiceId, number: inv.number, issueDate: inv.issueDate }, reason,
      paid: false, createdAt: serverTimestamp(), issuedAt: serverTimestamp(), issuedBy: uid, updatedAt: serverTimestamp(),
    });
    tx.update(ref, {
      status: "voided", voidReason: reason, rectifiedBy: { id: newRef.id, number },
      voidedAt: serverTimestamp(), voidedBy: uid, updatedAt: serverTimestamp(),
    });
    return { id: newRef.id, number };
  });
}

/** Datos fiscales del cliente a partir de una cuenta (productora). */
export function clientFromAccount(a?: {
  name?: string; taxId?: string; contactEmail?: string;
  billing?: { name?: string; address?: string; postalCode?: string; city?: string; province?: string; country?: string; email?: string };
} | null): BillingParty {
  const b = a?.billing || {};
  return {
    name: b.name || a?.name || "", taxId: a?.taxId || "", address: b.address || "", postalCode: b.postalCode || "",
    city: b.city || "", province: b.province || "", country: b.country || "España", email: b.email || a?.contactEmail || "",
  };
}

export const newLineId = () => Math.random().toString(36).slice(2, 9);
