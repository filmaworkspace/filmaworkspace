// ─── Facturación de Filma a sus cuentas (productoras) ────────────────────────
// billingInvoices/{id}: borrador → emitida (número correlativo por serie y
// año, inmutable) → anulada (solo con una factura rectificativa, que va en su
// propia serie y en negativo). Los datos fiscales de Filma están en
// adminConfig/billing y se copian a la factura al emitirla, para que un
// cambio posterior no altere facturas ya emitidas.

import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, where, type DocumentReference, type Firestore, type Transaction } from "firebase/firestore";
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
  /** Cuota mensual del acceso a Budgeting (por persona). */
  budgetingPrice?: number;
  /** Filma Sign por uso: precio por documento firmado y por documento caducado o rechazado. */
  signPricePerSigned?: number;
  signPricePerExpired?: number;
  footer: string;
  /** Numeración personalizada por tipo de documento (si falta, la clásica F2026-0001). */
  numbering?: Partial<Record<NumberingKind, Partial<NumberingRule>>>;
  /** Fases que se proponen en un presupuesto por fases, con su cuota mensual y meses. */
  phaseDefaults?: { name: string; price: number; months: number }[];
}

export type NumberingKind = "invoice" | "rectifying" | "quote";
export interface NumberingRule {
  /** Serie: la parte fija (F, FW-, FACT/…). */
  prefix: string;
  /** Plantilla con {SERIE}, {AAAA}, {AA}, {MM} y {N} (obligatorio). */
  format: string;
  /** Dígitos del número (0001 → 4). */
  digits: number;
  /** Cada año empieza en 1, o la numeración sigue siempre. */
  reset: "yearly" | "never";
}

export const NUMBERING_LABEL: Record<NumberingKind, string> = { invoice: "Facturas", rectifying: "Rectificativas", quote: "Presupuestos" };
const DEFAULT_PREFIX: Record<NumberingKind, string> = { invoice: "F", rectifying: "R", quote: "P" };
export const DEFAULT_FORMAT = "{SERIE}{AAAA}-{N}";

export const DEFAULT_PHASES = [
  { name: "Preproducción", price: 0, months: 2 },
  { name: "Rodaje", price: 0, months: 2 },
  { name: "Postproducción", price: 0, months: 3 },
];

/** Regla de numeración efectiva (con compatibilidad con las series antiguas). */
export function numberingRule(s: BillingSettings, kind: NumberingKind): NumberingRule {
  const n = s.numbering?.[kind] || {};
  const legacy = kind === "invoice" ? s.invoicePrefix : kind === "rectifying" ? s.rectifyingPrefix : s.quotePrefix;
  return {
    prefix: (n.prefix ?? legacy ?? DEFAULT_PREFIX[kind]) || DEFAULT_PREFIX[kind],
    format: n.format && n.format.includes("{N}") ? n.format : DEFAULT_FORMAT,
    digits: Math.min(8, Math.max(1, Number(n.digits) || 4)),
    reset: n.reset === "never" ? "never" : "yearly",
  };
}

/** Clave del contador (la anual coincide con la de siempre: F-2026). */
export const counterKey = (r: NumberingRule, year: number) => (r.reset === "never" ? `${r.prefix}-all` : `${r.prefix}-${year}`);

/** Número a partir de la regla, la fecha (AAAA-MM-DD) y el correlativo. */
export function renderNumber(r: NumberingRule, dateIso: string, seq: number) {
  const [y, m] = dateIso.split("-");
  return r.format
    .replaceAll("{SERIE}", r.prefix).replaceAll("{AAAA}", y).replaceAll("{AA}", y.slice(2)).replaceAll("{MM}", m)
    .replaceAll("{N}", String(seq).padStart(r.digits, "0"));
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
  /** Línea de uso de Filma Sign (firmados / caducados). */
  usage?: "signed" | "expired";
}

export type InvoiceStatus = "draft" | "issued" | "voided";
export type InvoiceKind = "standard" | "rectifying";
export type PeriodType = "monthly" | "project" | "other";
/** A quién se factura: una cuenta (productora) o una persona (usuario). */
export type BillTo = "account" | "user";
/** Qué se factura: un proyecto, un servicio (Budgeting, Filma Sign) u otra cosa. */
export type BillingSubject = "project" | "budgeting" | "sign" | "other";
export const SUBJECT_LABEL: Record<BillingSubject, string> = { project: "Proyecto", budgeting: "Budgeting", sign: "Filma Sign", other: "Otro concepto" };

/** Servicios de Filma que se cobran aparte de los proyectos (cuota mensual). */
export const SERVICES = {
  budgeting: { name: "Filma Budgeting", line: "Acceso a Filma Budgeting", price: (s: BillingSettings) => s.budgetingPrice || 0 },
  // Filma Sign se cobra por uso (ver SIGN_USAGE); este precio es el del documento firmado.
  sign: { name: "Filma Sign", line: "Filma Sign · documento firmado", price: (s: BillingSettings) => s.signPricePerSigned || 0 },
} as const;
export type ServiceSubject = keyof typeof SERVICES;
export const isService = (s?: BillingSubject | null): s is ServiceSubject => s === "budgeting" || s === "sign";

export interface BillingInvoice {
  id: string;
  status: InvoiceStatus;
  kind: InvoiceKind;
  number: string | null;
  series: string | null;
  year: number | null;
  /** Cuenta a la que se factura (vacío si es a una persona). */
  producerId: string;
  billTo?: BillTo;
  /** Persona a la que se factura (billTo = user). */
  userId?: string | null;
  subject?: BillingSubject;
  client: BillingParty;
  issuer: (BillingParty & { phone?: string; iban?: string; bank?: string; footer?: string }) | null;
  periodType: PeriodType;
  periodMonth: string | null;
  /** Meses que cubre (una factura puede agrupar varios). */
  periodMonths?: string[] | null;
  /** Filma Sign por uso: periodo y solicitudes que se facturan (no se cobran dos veces). */
  signUsage?: { from: string; to: string; signed: string[]; expired: string[] } | null;
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
export type BillingMode = "monthly" | "phases" | "single" | "usage";

// ── Filma Sign por uso ──────────────────────────────────────────────────────
// Se cobra cada documento enviado a firmar según cómo acaba: firmado (precio
// completo) o caducado/rechazado (su propio precio). Los cancelados no se
// cobran. El presupuesto lleva cantidades estimadas; la factura, las reales.
export type SignUsageKind = "signed" | "expired";
export const SIGN_USAGE: Record<SignUsageKind, { line: string; price: (s: BillingSettings) => number }> = {
  signed: { line: "Filma Sign · documento firmado", price: (s) => s.signPricePerSigned || 0 },
  expired: { line: "Filma Sign · documento caducado o rechazado", price: (s) => s.signPricePerExpired || 0 },
};
/** Líneas de uso de Filma Sign con sus cantidades. */
export function signUsageLines(q: { signed: number; expired: number }, prices: { signed: number; expired: number }, vatRate: number, suffix = ""): BillingLine[] {
  return (["signed", "expired"] as SignUsageKind[]).map((k) => ({
    id: newLineId(), description: `${SIGN_USAGE[k].line}${suffix}`, quantity: q[k], unitPrice: prices[k], vatRate, usage: k,
  }));
}
/** Precio unitario de cada tipo en un presupuesto por uso (o el de ajustes). */
export function signUsagePrices(lines: BillingLine[] | null | undefined, s: BillingSettings) {
  const find = (k: SignUsageKind) => lines?.find((l) => l.usage === k)?.unitPrice;
  return { signed: find("signed") ?? SIGN_USAGE.signed.price(s), expired: find("expired") ?? SIGN_USAGE.expired.price(s) };
}

/** Fase de un presupuesto por fases: sus meses y sus líneas mensuales. */
export interface QuotePhase { id: string; name: string; months: number; lines: BillingLine[] }

/** Presupuesto para un proyecto de una cuenta; de él salen las facturas. */
export interface BillingQuote {
  id: string;
  status: QuoteStatus;
  number: string | null;
  series: string | null;
  year: number | null;
  /** Cuenta a la que se factura (vacío si es a una persona). */
  producerId: string;
  billTo?: BillTo;
  /** Persona a la que se factura (billTo = user). */
  userId?: string | null;
  subject?: BillingSubject;
  client: BillingParty;
  issuer: BillingInvoice["issuer"];
  projectId: string | null;
  projectName: string;
  title: string;
  issueDate: string;
  validUntil: string;
  billingMode: BillingMode;
  /** Cuota mensual y por fases: número de meses y mes de inicio (AAAA-MM). */
  months: number | null;
  startMonth: string | null;
  /** Por fases (preproducción, rodaje…): cada una con sus meses y su cuota. */
  phases?: QuotePhase[] | null;
  lines: BillingLine[];
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  vatBreakdown: { rate: number; base: number; vat: number }[];
  notes: string;
  conditions: string;
  decisionNote?: string | null;
  /** Filma Sign */
  signRequestId?: string | null;
  signStatus?: "pending" | "signed" | "declined" | "cancelled" | null;
  acceptedAt?: { toMillis: () => number } | null;
  sentAt?: { toMillis: () => number } | null;
  sentTo?: string | null;
  createdAt?: { toMillis: () => number } | null;
}

/** Importe total del presupuesto (en mensual, la cuota por el número de meses; por fases ya va todo en las líneas). */
export const quoteGrandTotal = (q: Pick<BillingQuote, "billingMode" | "months" | "totalAmount" | "baseAmount">) =>
  q.billingMode === "monthly" && q.months ? { base: round2(q.baseAmount * q.months), total: round2(q.totalAmount * q.months) } : { base: q.baseAmount, total: q.totalAmount };

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Meses (AAAA-MM) que cubre un presupuesto mensual o por fases. */
export function quoteMonths(q: Pick<BillingQuote, "startMonth" | "months"> & { billingMode?: BillingMode; phases?: QuotePhase[] | null }): string[] {
  const total = q.billingMode === "phases" ? (q.phases || []).reduce((t, p) => t + (p.months || 0), 0) : q.months || 0;
  if (!q.startMonth || !total) return [];
  return Array.from({ length: total }, (_, i) => addMonths(q.startMonth!, i));
}

/** Fase a la que pertenece cada mes de un presupuesto por fases. */
export function phaseSchedule(q: Pick<BillingQuote, "startMonth" | "phases">): { month: string; phase: QuotePhase; index: number }[] {
  if (!q.startMonth) return [];
  const out: { month: string; phase: QuotePhase; index: number }[] = [];
  let k = 0;
  (q.phases || []).forEach((phase, index) => {
    for (let i = 0; i < (phase.months || 0); i++) out.push({ month: addMonths(q.startMonth!, k++), phase, index });
  });
  return out;
}

/** Líneas del presupuesto por fases: cada línea mensual × los meses de su fase. */
export function phasesToLines(phases: QuotePhase[]): BillingLine[] {
  return phases.flatMap((p) => p.lines.map((l) => ({
    ...l,
    id: `${p.id}-${l.id}`,
    description: `${p.name} · ${l.description}`.trim(),
    quantity: round2((l.quantity || 0) * (p.months || 0)),
  })));
}

/** Cuota mensual (base) de una fase. */
export const phaseMonthlyBase = (p: QuotePhase) => invoiceTotals(p.lines).baseAmount;

/** Meses que ya cubre una factura. */
export const invoiceMonths = (i: Pick<BillingInvoice, "periodMonth" | "periodMonths">) =>
  i.periodMonths?.length ? i.periodMonths : i.periodMonth ? [i.periodMonth] : [];

/** "enero 2027" o "enero – marzo 2027". */
export function monthsLabel(months: string[]) {
  if (!months.length) return "";
  if (months.length === 1) return monthName(months[0]);
  const s = [...months].sort();
  return `${monthName(s[0])} – ${monthName(s[s.length - 1])} (${s.length} meses)`;
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
export async function issueInvoice(db: Firestore, invoiceId: string, settings: BillingSettings, uid: string, customNumber?: string) {
  const ref = doc(db, "billingInvoices", invoiceId);
  const counters = doc(db, "adminConfig", "billingCounters");
  return runTransaction(db, async (tx) => {
    const [snap, cSnap] = await Promise.all([tx.get(ref), tx.get(counters)]);
    const inv = snap.data() as BillingInvoice | undefined;
    if (!inv) throw new Error("Factura no encontrada");
    if (inv.status !== "draft") throw new Error("Esta factura ya está emitida");
    const { number, series, year } = takeNumber(tx, counters, cSnap.data(), numberingRule(settings, "invoice"), inv.issueDate, customNumber);
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
export async function issueQuote(db: Firestore, quoteId: string, settings: BillingSettings, uid: string, customNumber?: string) {
  const ref = doc(db, "billingQuotes", quoteId);
  const counters = doc(db, "adminConfig", "billingCounters");
  return runTransaction(db, async (tx) => {
    const [snap, cSnap] = await Promise.all([tx.get(ref), tx.get(counters)]);
    const q = snap.data() as BillingQuote | undefined;
    if (!q) throw new Error("Presupuesto no encontrado");
    if (q.status !== "draft") throw new Error("Este presupuesto ya está emitido");
    const { number, series, year } = takeNumber(tx, counters, cSnap.data(), numberingRule(settings, "quote"), q.issueDate, customNumber);
    tx.update(ref, {
      status: "sent", number, series, year, issuer: issuerSnapshot(settings), ...invoiceTotals(q.lines),
      issuedAt: serverTimestamp(), issuedBy: uid, updatedAt: serverTimestamp(),
    });
    return number;
  });
}

/**
 * Siguiente número de la serie (o el número escrito a mano, que no mueve el
 * contador). Se llama dentro de la transacción de emisión.
 */
function takeNumber(
  tx: Transaction, counters: DocumentReference, data: Record<string, number> | undefined,
  rule: NumberingRule, dateIso: string, customNumber?: string,
) {
  const year = Number(dateIso.slice(0, 4));
  if (customNumber?.trim()) return { number: customNumber.trim(), series: rule.prefix, year };
  const key = counterKey(rule, year);
  const seq = ((data || {})[key] || 0) + 1;
  tx.set(counters, { [key]: seq }, { merge: true });
  return { number: renderNumber(rule, dateIso, seq), series: rule.prefix, year };
}

/** ¿Hay ya un documento con ese número? (para los números escritos a mano) */
export async function numberTaken(db: Firestore, kind: "invoice" | "quote", number: string) {
  const snap = await getDocs(query(collection(db, kind === "quote" ? "billingQuotes" : "billingInvoices"), where("number", "==", number.trim())));
  return !snap.empty;
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
    const { number, series, year } = takeNumber(tx, counters, cSnap.data(), numberingRule(settings, "rectifying"), issueDate);
    const lines = inv.lines.map((l) => ({ ...l, id: `${l.id}r`, quantity: -l.quantity }));
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

/** Datos fiscales del cliente a partir de una persona (usuario). */
export function clientFromUser(u?: { name?: string; email?: string; billing?: Partial<BillingParty> | null } | null): BillingParty {
  const b = u?.billing || {};
  return {
    name: b.name || u?.name || "", taxId: b.taxId || "", address: b.address || "", postalCode: b.postalCode || "",
    city: b.city || "", province: b.province || "", country: b.country || "España", email: b.email || u?.email || "",
  };
}

/**
 * Datos fiscales de una persona: se guardan en billingClients/{uid} (solo
 * admins), no en su perfil, que leen otros usuarios.
 */
export async function fetchUserClient(db: Firestore, u?: { id: string; name?: string; email?: string } | null): Promise<BillingParty> {
  if (!u) return clientFromUser(null);
  const snap = await getDoc(doc(db, "billingClients", u.id)).catch(() => null);
  return clientFromUser({ ...u, billing: snap?.exists() ? (snap.data() as Partial<BillingParty>) : null });
}
export async function saveUserClient(db: Firestore, userId: string, client: BillingParty) {
  await setDoc(doc(db, "billingClients", userId), { ...client, updatedAt: serverTimestamp() });
}

/** Nombre del concepto que sale en listados: proyecto, el servicio u otro. */
export const docSubject = (d: { subject?: BillingSubject; projectName?: string | null }) =>
  isService(d.subject) ? SERVICES[d.subject].name : d.projectName || (d.subject === "other" ? "Otro concepto" : "—");

export const newLineId = () => Math.random().toString(36).slice(2, 9);
