// ─── Hub de documentación de contabilidad ────────────────────────────────────
// Reúne todos los documentos del proyecto en carpetas (en inglés, por orden
// alfabético) y genera cada PDF con el diseño del proyecto: la carátula con
// su codificación seguida SIEMPRE del documento real (factura, ticket,
// presupuesto del proveedor). Es el único sitio de la plataforma desde el que
// se descargan documentos de contabilidad.
//
//   Box/Cards/<tarjeta>/<sobre>      Box/Cash/<caja>/<vale>      Box/Transfers/<sobre>
//   Invoices/FRA-0001 · Proveedor (PRF / FNZ según el tipo)    Purchase Orders/PO-0001 · Proveedor
//   Suppliers/<proveedor>/Certificado de cierre · Extracto de facturas

import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import { getScopedDocs, type DocScope } from "@/lib/accountingScope";
import { appendOriginals, type Original } from "./attach";
import {
  buildProjectDoc, contentFingerprint, DOC_TYPES, hubFileName, hubNumber, INVOICE_CODE, renderProjectBand,
  type DocApproval, type DocProject, type DocTypeKey, type ProjectDocSpec,
} from "./projectPdf";

// ─── Tipos ───────────────────────────────────────────────────────────────────
export interface HubItem {
  id: string;                 // "po:<id>", "inv:<id>"…
  path: string[];             // carpetas: ["Purchase Orders"]
  number: string;             // PO-0013
  title: string;              // proveedor / persona
  fileName: string;           // PO-0013 · Vinilos Express.pdf
  type: DocTypeKey;
  typeLabel: string;
  date: Date | null;
  base: number;
  total: number;
  status: string;
  version: string;
  department?: string;
  originals: Original[];
  warnings: string[];         // falta el original, pagada sin justificante…
  /** Anulada: el PDF sale con marca de agua ANULADA en todas las páginas. */
  voided?: boolean;
  /** Otra marca de agua (p. ej. CERRADA). */
  watermark?: { text: string; rgb: [number, number, number] };
  sortKey: string;
  source: { kind: string; id: string };
  spec: () => Promise<Omit<ProjectDocSpec, "project" | "generatedAt" | "generatedBy" | "fingerprint">>;
}

export interface HubProject { name: string; code: string; producer: string; phase: string; legal: string; coverUrl: string | null }

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === "function") return t.toDate();
  if (typeof t.seconds === "number") return new Date(t.seconds * 1000);
  if (typeof v === "string") { const d = new Date(v.length === 10 ? `${v}T12:00:00` : v); return isNaN(d.getTime()) ? null : d; }
  return null;
};
const eur = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format((n || 0) + 0) + " €";
const day = (d: Date | null) => (d ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const num = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "")) || 0);
const short = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0; return h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6); };
const clean = (s?: string) => (s || "").replace(/[\\/:*?"<>|]+/g, " ").trim();

const PO_STATUS: Record<string, string> = { pending: "Pendiente de aprobación", approved: "Aprobada", closed: "Cerrada", cancelled: "Anulada", rejected: "Rechazada" };
const PAY_METHOD: Record<string, string> = { transfer: "Transferencia", card: "Tarjeta", cash: "Efectivo", check: "Cheque", direct_debit: "Domiciliación" };

// ─── Aprobaciones e historial ────────────────────────────────────────────────
interface RawStep { id?: string; order?: number; approverType?: string; roles?: string[]; department?: string; approverNames?: string[]; approvedByNames?: string[]; status?: string; approvedAt?: unknown; rejectedBy?: string[] }
function approvalsFrom(docId: string, steps: RawStep[] | undefined): DocApproval[] {
  // Los niveles omitidos (sin aprobador o fuera de umbral) no son firmas.
  return (steps || []).filter((s) => s.status !== "skipped").map((s, i) => {
    const role = s.approverType === "hod" ? `Jefe de departamento${s.department ? ` · ${s.department}` : ""}`
      : s.approverType === "coordinator" ? "Coordinación"
      : s.approverType === "role" ? (s.roles || []).join(", ") || "Rol de proyecto"
      : "Aprobador designado";
    const at = toDate(s.approvedAt);
    const status = s.status === "approved" ? "approved" : s.status === "rejected" ? "rejected" : "pending";
    return {
      level: i + 1,
      role,
      status,
      by: (s.approvedByNames || []).join(", ") || (s.approverNames || []).join(", ") || undefined,
      at,
      auditId: status !== "pending" ? `APR-${short(`${docId}:${s.id || i}:${at?.getTime() || ""}`)}` : undefined,
    } as DocApproval;
  });
}

// ─── Carga ───────────────────────────────────────────────────────────────────
/** Datos del proyecto para la carátula (nombre, código, productora, datos fiscales, portada). */
export async function loadHubProject(db: Firestore, projectId: string): Promise<HubProject> {
  const base = `projects/${projectId}`;
  const [projSnap, prodCfg, companyCfg] = await Promise.all([
    getDoc(doc(db, "projects", projectId)),
    getDoc(doc(db, `${base}/config`, "production")).catch(() => null),
    getDoc(doc(db, `${base}/config`, "company")).catch(() => null),
  ]);
  const p = projSnap.data() || {};
  const producerNames = (await Promise.all(((p.producers || []) as string[]).map((id) => getDoc(doc(db, "producers", id)).catch(() => null))))
    .map((d) => d?.data()?.name).filter(Boolean) as string[];
  const company = companyCfg?.data() || {};
  const working = (prodCfg?.data()?.workingTitle as string) || "";
  return {
    name: p.name || projectId,
    code: (working || projectId).toUpperCase(),
    producer: producerNames.join(" · "),
    phase: p.phase || "",
    legal: [company.fiscalName, company.taxId && `NIF ${company.taxId}`, [company.address, [company.postalCode, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
    coverUrl: p.coverUrl || null,
  };
}

export async function loadHub(db: Firestore, projectId: string, scope: DocScope, canSeeBox: boolean) {
  const base = `projects/${projectId}`;
  const project = await loadHubProject(db, projectId);

  const [poDocs, invDocs, supSnap] = await Promise.all([
    getScopedDocs(collection(db, `${base}/pos`), scope),
    getScopedDocs(collection(db, `${base}/invoices`), scope),
    getDocs(collection(db, `${base}/suppliers`)).catch(() => null),
  ]);
  const items: HubItem[] = [];
  const usedNumbers = {
    PO: poDocs.map((d) => parseInt(String(d.data().number || "").replace(/\D+/g, ""), 10)).filter((n) => !isNaN(n)),
    INV: invDocs.map((d) => parseInt(String(d.data().number || "").replace(/\D+/g, ""), 10)).filter((n) => !isNaN(n)),
  };
  const supById = new Map((supSnap?.docs || []).map((d) => [d.id, d.data()]));
  const supLines = (id?: string, taxId?: string) => {
    const s = id ? supById.get(id) : undefined;
    if (!s) return taxId ? [`NIF ${taxId}`] : [];
    return [s.taxId && `NIF ${s.taxId}`, [[s.address?.street, s.address?.number].filter(Boolean).join(" "), [s.address?.postalCode, s.address?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), s.contact?.email].filter(Boolean) as string[];
  };

  // ── Purchase Orders ────────────────────────────────────────────────────────
  for (const d of poDocs) {
    const po = d.data();
    if (!po.number || po.status === "draft") continue;
    const number = hubNumber("PO", po.number);
    const version = `V${String(po.version || 1).padStart(2, "0")}`;
    const originals: Original[] = po.attachmentUrl ? [{ url: po.attachmentUrl, label: "Presupuesto del proveedor" }] : [];
    const created = toDate(po.createdAt);
    // Cerrada o anulada: la PO ya no compromete presupuesto. Tiene que verse a simple vista.
    const closed = po.status === "closed", voided = po.status === "cancelled";
    const baseAmt = num(po.baseAmount), invoiced = num(po.invoicedAmount);
    const pendingAmt = Math.max(0, baseAmt - invoiced);
    const commits = closed || voided ? 0 : po.status === "approved" ? pendingAmt : 0;
    const banner = closed
      ? { tone: "closed" as const, title: "PO cerrada · no compromete presupuesto", text: `Cerrada el ${day(toDate(po.closedAt))}${po.closedByName ? ` por ${po.closedByName}` : ""}. Facturado ${eur(invoiced)} de ${eur(baseAmt)}.${pendingAmt > 0 ? ` Los ${eur(pendingAmt)} sin facturar se liberaron del comprometido.` : ""} No admite más facturas.` }
      : voided
        ? { tone: "void" as const, title: "PO anulada · sin efecto en el presupuesto", text: `Anulada el ${day(toDate(po.cancelledAt))}${po.cancelledByName ? ` por ${po.cancelledByName}` : ""}.${po.cancellationReason ? ` Motivo: ${po.cancellationReason}.` : ""} No compromete presupuesto ni admite facturas.` }
        : undefined;
    items.push({
      id: `po:${d.id}`, path: ["Purchase Orders"], number, title: po.supplier || "Sin proveedor",
      fileName: hubFileName(number, po.supplier, version), type: "po", typeLabel: DOC_TYPES.po.label,
      date: created, base: num(po.baseAmount), total: num(po.totalAmount), status: PO_STATUS[po.status] || po.status, version,
      department: po.department, originals, warnings: [], voided, watermark: closed ? { text: "CERRADA", rgb: [0.2, 0.25, 0.33] } : undefined, sortKey: number, source: { kind: "po", id: d.id },
      spec: async () => ({
        docLabel: "Orden de compra", docType: "po", number, version,
        status: { label: PO_STATUS[po.status] || po.status, tone: po.status === "approved" ? "ok" : voided ? "bad" : closed ? "none" : "warn" },
        banner,
        meta: [["Fecha", day(created)], ["Departamento", po.department || "—"], ["Facturado", baseAmt > 0 ? `${Math.round((invoiced / baseAmt) * 100)} %` : "—"], ["Compromete", closed || voided ? `${eur(0)} · ${closed ? "cerrada" : "anulada"}` : eur(commits)]],
        party: { title: "Proveedor", name: po.supplier || "—", lines: supLines(po.supplierId) },
        summary: po.generalDescription ? { title: "Concepto", text: po.generalDescription } : undefined,
        table: {
          columns: [{ label: "Concepto", width: 90 }, { label: "Cuenta", width: 26, mono: true }, { label: "Cant.", width: 16, align: "right" }, { label: "Precio", width: 22, align: "right" }, { label: "Base", width: 24, align: "right" }],
          rows: (po.items || []).map((it: Record<string, unknown>) => [String(it.description || "—"), String(it.subAccountCode || "—"), String(num(it.quantity) || 1), eur(num(it.unitPrice) || num(it.baseAmount)), eur(num(it.baseAmount))]),
          subRows: (po.items || []).map((it: Record<string, unknown>) => (it.subAccountDescription && it.subAccountDescription !== it.description ? String(it.subAccountDescription) : null)),
        },
        totals: { base: eur(num(po.baseAmount)), rows: [["IVA", eur(num(po.vatAmount))], ["IRPF", eur(-num(po.irpfAmount))], ["Total", eur(num(po.totalAmount))]] },
        extraSections: [{ title: "Ejecución", rows: ([
          ["Solicitada por", po.createdByName || "—"],
          ["Facturado", eur(invoiced)],
          ...(closed ? [["Liberado al cerrar", eur(pendingAmt)], ["Compromete", `${eur(0)} (cerrada)`]] : voided ? [["Compromete", `${eur(0)} (anulada)`]] : [["Pendiente de facturar", eur(pendingAmt)], ["Compromete", eur(commits)]]),
        ] as [string, string][]).concat(po.paymentTerms ? [["Condiciones de pago", po.paymentTerms]] : []) }],
        approvals: approvalsFrom(d.id, po.approvalSteps),
        versions: [
          { version: "V01", at: created || new Date(), by: po.createdByName || "—", change: "Creación" },
          ...((po.modificationHistory || []) as { date: unknown; userName: string; reason: string; previousVersion: number }[]).map((m) => ({
            version: `V${String((m.previousVersion || 1) + 1).padStart(2, "0")}`, at: toDate(m.date) || new Date(), by: m.userName || "—", change: m.reason || "Modificación",
          })),
          ...(closed && po.closedAt ? [{ version, at: toDate(po.closedAt)!, by: po.closedByName || "—", change: `Cerrada${pendingAmt > 0 ? `: liberados ${eur(pendingAmt)}` : ""}` }] : []),
          ...(po.cancelledAt ? [{ version, at: toDate(po.cancelledAt)!, by: po.cancelledByName || "—", change: `Anulada${po.cancellationReason ? `: ${po.cancellationReason}` : ""}` }] : []),
        ],
        notes: po.notes || undefined,
      }),
    });
  }

  // ── Invoices (la proforma se sustituye por la factura definitiva) ──────────
  const invoicesBySupplier = new Map<string, Record<string, unknown>[]>();
  for (const d of invDocs) {
    const inv = d.data();
    if (!inv.number || inv.status === "draft") continue;
    const t = (inv.documentType || "invoice") as DocTypeKey;
    const type: DocTypeKey = (["invoice", "proforma", "budget", "guarantee"] as DocTypeKey[]).includes(t) ? t : "invoice";
    const number = hubNumber(INVOICE_CODE[type] || "FRA", inv.number);
    const replaced = !!inv.replacedAt;
    const version = replaced ? "V02" : "V01";
    const created = toDate(inv.createdAt);
    const paidAt = toDate(inv.paidAt);
    const originals: Original[] = [];
    if (inv.attachmentUrl) originals.push({ url: inv.attachmentUrl, label: type === "invoice" ? "Factura original" : `${DOC_TYPES[type].label} original` });
    if (inv.receiptUrl) originals.push({ url: inv.receiptUrl, label: "Justificante de pago" });
    const warnings: string[] = [];
    if (!inv.attachmentUrl) warnings.push("Sin documento original");
    if (paidAt && !inv.receiptUrl && inv.paymentMethod !== "card") warnings.push("Pagada sin justificante");
    if (type === "proforma") warnings.push("Proforma pendiente de la factura definitiva");
    const status = inv.status === "cancelled" || inv.status === "rejected" ? "Anulada" : paidAt ? "Pagada" : inv.codedAt ? "Codificada" : inv.approvedAt ? "Aprobada" : "Registrada";
    const supKey = String(inv.supplierId || inv.supplier || "");
    invoicesBySupplier.set(supKey, [...(invoicesBySupplier.get(supKey) || []), { ...inv, _id: d.id, _number: number }]);
    items.push({
      id: `inv:${d.id}`, path: ["Invoices"], number, title: inv.supplier || "Sin proveedor", voided: status === "Anulada",
      fileName: hubFileName(number, inv.supplier, replaced ? version : undefined), type, typeLabel: DOC_TYPES[type].label,
      date: toDate(inv.invoiceDate) || created, base: num(inv.baseAmount), total: num(inv.totalAmount), status, version,
      department: inv.department, originals, warnings, sortKey: number, source: { kind: "invoice", id: d.id },
      spec: async () => ({
        docLabel: type === "invoice" ? "Factura · expediente" : `${DOC_TYPES[type].label} · expediente`, docType: type, number, version,
        status: { label: status, tone: status === "Pagada" ? "ok" : status === "Anulada" ? "bad" : "warn" },
        banner: status === "Anulada" ? { tone: "void" as const, title: `${DOC_TYPES[type].label} anulada · sin efecto en el presupuesto`, text: `${inv.cancelledAt ? `Anulada el ${day(toDate(inv.cancelledAt))}${inv.cancelledByName ? ` por ${inv.cancelledByName}` : ""}. ` : ""}${inv.cancellationReason || inv.rejectionReason ? `Motivo: ${inv.cancellationReason || inv.rejectionReason}. ` : ""}No cuenta como realizado ni se paga.` } : undefined,
        meta: [["Nº proveedor", inv.supplierNumber || inv.displayNumber || "—"], ["Fecha", day(toDate(inv.invoiceDate) || created)], ["Vencimiento", day(toDate(inv.dueDate))], ["PO", inv.poNumber ? hubNumber("PO", inv.poNumber) : "—"]],
        party: { title: "Proveedor", name: inv.supplier || "—", lines: supLines(inv.supplierId, inv.supplierTaxId) },
        summary: inv.description ? { title: "Concepto", text: inv.description } : undefined,
        table: {
          columns: [{ label: "Codificación", width: 86 }, { label: "Cuenta", width: 28, mono: true }, { label: "IVA", width: 18, align: "right" }, { label: "IRPF", width: 18, align: "right" }, { label: "Base", width: 28, align: "right" }],
          rows: (inv.items || []).map((it: Record<string, unknown>) => [String(it.description || inv.description || "—"), String(it.subAccountCode || "Sin codificar"), `${num(it.vatRate)} %`, `${num(it.irpfRate)} %`, eur(num(it.baseAmount))]),
          subRows: (inv.items || []).map((it: Record<string, unknown>) => (it.subAccountDescription && it.subAccountDescription !== (it.description || inv.description) ? String(it.subAccountDescription) : null)),
        },
        totals: { base: eur(num(inv.baseAmount)), rows: [["IVA", eur(num(inv.vatAmount))], ["IRPF", eur(-num(inv.irpfAmount))], ["Total factura", eur(num(inv.totalAmount))]] },
        extraSections: [
          ...(inv.codedAt ? [{ title: "Contabilidad", rows: [["Codificada", `${day(toDate(inv.codedAt))}${inv.codedByName ? ` · ${inv.codedByName}` : ""}`], ...(inv.accountingEntry ? [["Asiento", String(inv.accountingEntry)]] : [])] as [string, string][] }] : []),
          ...(paidAt ? [{ title: "Pago", rows: [["Fecha", day(paidAt)], ["Forma", PAY_METHOD[inv.paymentMethod] || inv.paymentMethod || "—"], ...(inv.paymentReference ? [["Referencia", String(inv.paymentReference)]] : []), ...(inv.paidByName ? [["Registrado por", String(inv.paidByName)]] : [])] as [string, string][] }] : []),
        ],
        approvals: approvalsFrom(d.id, inv.approvalSteps),
        versions: [
          { version: "V01", at: created || new Date(), by: inv.createdByName || "—", change: `Registro${inv.replacedFromType ? ` como ${DOC_TYPES[inv.replacedFromType as DocTypeKey]?.label.toLowerCase() || "proforma"}` : ""}` },
          ...(replaced ? [{ version: "V02", at: toDate(inv.replacedAt)!, by: "—", change: "Sustituida por la factura definitiva" }] : []),
          ...(inv.codedAt ? [{ version, at: toDate(inv.codedAt)!, by: inv.codedByName || "—", change: "Codificación contable" }] : []),
          ...(paidAt ? [{ version, at: paidAt, by: inv.paidByName || "—", change: "Pago registrado" }] : []),
        ],
        notes: inv.notes || undefined,
      }),
    });
  }

  // ── Suppliers ──────────────────────────────────────────────────────────────
  for (const d of supSnap?.docs || []) {
    const s = d.data();
    const name = s.fiscalName || s.commercialName || "Proveedor";
    const invs = (invoicesBySupplier.get(d.id) || invoicesBySupplier.get(name) || []).filter((i) => i.status !== "cancelled" && i.status !== "rejected");
    if (!invs.length) continue; // solo proveedores con documentación en el proyecto
    const folder = clean(name);
    const addr = [[s.address?.street, s.address?.number].filter(Boolean).join(" "), [s.address?.postalCode, s.address?.city].filter(Boolean).join(" ")].filter(Boolean) as string[];
    const rows = invs.sort((a, b) => String(a._number).localeCompare(String(b._number)));
    const totalBase = rows.reduce((t, i) => t + num(i.baseAmount), 0);
    const pending = rows.filter((i) => !i.paidAt);
    const supCode = `SUP-${short(d.id).slice(0, 4)}`;
    const statement = {
      title: "Extracto de facturas", number: `${supCode}-EXT`,
    };
    items.push({
      id: `sup-ext:${d.id}`, path: ["Suppliers", folder], number: statement.number, title: statement.title,
      fileName: `${statement.title} · ${folder}.pdf`, type: "supplier", typeLabel: "Extracto",
      date: new Date(), base: totalBase, total: rows.reduce((t, i) => t + num(i.totalAmount), 0), status: pending.length ? `${pending.length} pendiente${pending.length > 1 ? "s" : ""} de pago` : "Todo pagado",
      version: "V01", originals: [], warnings: [], sortKey: "B", source: { kind: "supplier", id: d.id },
      spec: async () => ({
        docLabel: "Extracto de proveedor", docType: "supplier", number: statement.number, version: "V01",
        meta: [["NIF", s.taxId || "—"], ["Facturas", String(rows.length)], ["Pagadas", String(rows.length - pending.length)], ["Pendientes", String(pending.length)]],
        party: { title: "Proveedor", name, lines: [s.taxId && `NIF ${s.taxId}`, ...addr, s.contact?.email].filter(Boolean) as string[] },
        table: {
          columns: [{ label: "Factura", width: 30, mono: true }, { label: "Concepto", width: 72 }, { label: "Fecha", width: 24 }, { label: "Pago", width: 24 }, { label: "Base", width: 28, align: "right" }],
          rows: rows.map((i) => [String(i._number), String(i.description || "—"), day(toDate(i.invoiceDate) || toDate(i.createdAt)), i.paidAt ? day(toDate(i.paidAt)) : "Pendiente", eur(num(i.baseAmount))]),
        },
        totals: { base: eur(totalBase), rows: [["IVA", eur(rows.reduce((t, i) => t + num(i.vatAmount), 0))], ["Total", eur(rows.reduce((t, i) => t + num(i.totalAmount), 0))], ["Pendiente de pago", eur(pending.reduce((t, i) => t + num(i.totalAmount), 0))]] },
        versions: [{ version: "V01", at: new Date(), by: "Filma Workspace", change: "Extracto generado" }],
      }),
    });
    if (!pending.length) {
      const num2 = `${supCode}-CIERRE`;
      items.push({
        id: `sup-close:${d.id}`, path: ["Suppliers", folder], number: num2, title: "Certificado de cierre",
        fileName: `Certificado de cierre · ${folder}.pdf`, type: "supplier", typeLabel: "Certificado",
        date: new Date(), base: totalBase, total: rows.reduce((t, i) => t + num(i.totalAmount), 0), status: "Para firmar",
        version: "V01", originals: [], warnings: [], sortKey: "A", source: { kind: "supplier", id: d.id },
        spec: async () => ({
          docLabel: "Certificado de cierre", docType: "supplier", number: num2, version: "V01",
          meta: [["Fecha", day(new Date())], ["Proveedor", name], ["NIF", s.taxId || "—"], ["Facturas", String(rows.length)]],
          party: { title: "Destinatario", name, lines: [s.taxId && `NIF ${s.taxId}`, ...addr].filter(Boolean) as string[] },
          body: [
            `Por medio de la presente se certifica que, a fecha de hoy, no existen facturas pendientes de pago correspondientes a los servicios prestados por ${name} en el marco del proyecto «${project.name}».`,
            "A continuación se detalla el histórico de facturas abonadas. Se expide el presente certificado a petición del interesado y para los efectos que estime oportunos.",
          ],
          highlight: { title: "Todas las facturas han sido abonadas", text: `La relación comercial con ${s.commercialName || name} queda liquidada.` },
          table: {
            columns: [{ label: "Factura", width: 32, mono: true }, { label: "Concepto", width: 78 }, { label: "Pago", width: 28 }, { label: "Base", width: 40, align: "right" }],
            rows: rows.map((i) => [String(i._number), String(i.description || "—"), day(toDate(i.paidAt)), eur(num(i.baseAmount))]),
          },
          totals: { base: eur(totalBase), rows: [["Total abonado (IVA incl.)", eur(rows.reduce((t, i) => t + num(i.totalAmount), 0))]] },
          signature: [{ label: "Por la productora", name: project.legal.split(" · ")[0] || project.name, role: "Departamento de producción" }, { label: "Conforme, el proveedor", name, role: "" }],
          versions: [{ version: "V01", at: new Date(), by: "Filma Workspace", change: "Certificado generado" }],
        }),
      });
    }
  }

  // ── Box ────────────────────────────────────────────────────────────────────
  if (canSeeBox) {
    const [cards, envs, exps, tEnvs, tExps, floats, moves] = await Promise.all(
      ["cards", "cardEnvelopes", "cardExpenses", "transferEnvelopes", "transferExpenses", "cashFloats", "cashMovements"]
        .map((c) => getDocs(collection(db, `${base}/${c}`)).then((s) => s.docs.map((x) => ({ id: x.id, ...x.data() } as Record<string, unknown> & { id: string }))).catch(() => [] as (Record<string, unknown> & { id: string })[])),
    );
    const cardName = new Map(cards.map((c) => [c.id, `${c.code} · ${c.name}`]));
    const expenseRows = (list: Record<string, unknown>[]) => list.flatMap((e) => {
      const its = (e.items as Record<string, unknown>[] | undefined)?.length ? (e.items as Record<string, unknown>[]) : [e];
      return its.map((it) => [String(e.displayNumber || e.number || ""), `${e.supplier || e.personName || "—"}${it.description || e.description ? ` · ${it.description || e.description}` : ""}`, String(it.subAccountCode || e.subAccountCode || "—"), day(toDate(e.date)), eur(num(it.baseAmount))]);
    });
    const envelopeDoc = (kind: "card" | "transfer", env: Record<string, unknown> & { id: string }, list: (Record<string, unknown> & { id: string })[], folder: string[]) => {
      const number = String(env.displayNumber || env.number || env.id);
      const closed = kind === "card" ? env.status === "closed" : env.status === "settled";
      const base = list.reduce((t, e) => t + num(e.baseAmount), 0);
      const total = list.reduce((t, e) => t + num(e.totalAmount), 0);
      const originals = list.map((e) => ({ url: String(e.documentUrl || e.attachmentUrl || ""), label: `${e.displayNumber || e.number || ""} ${e.supplier || ""}`.trim() })).filter((o) => o.url);
      const missingDocs = list.filter((e) => !e.documentUrl && !e.attachmentUrl).length;
      items.push({
        id: `${kind}-env:${env.id}`, path: ["Box", ...folder], number, title: kind === "transfer" ? String(env.personName || "Sobre") : "Sobre",
        fileName: `${clean(number)}${kind === "transfer" && env.personName ? ` · ${clean(String(env.personName))}` : ""}.pdf`, type: "box", typeLabel: "Liquidación",
        date: toDate(env.createdAt), base, total, status: closed ? "Liquidado" : "Abierto", version: "V01",
        originals, warnings: missingDocs ? [`${missingDocs} gasto${missingDocs > 1 ? "s" : ""} sin ticket`] : [], sortKey: number, source: { kind: `${kind}Envelope`, id: env.id },
        spec: async () => ({
          docLabel: kind === "card" ? "Liquidación de tarjeta" : "Liquidación de transferencia", docType: "box", number, version: "V01",
          status: { label: closed ? "Liquidado" : "Abierto", tone: closed ? "ok" : "warn" },
          meta: [["Gastos", String(list.length)], [kind === "card" ? "Tarjeta" : "Persona", kind === "card" ? cardName.get(String(env.boxId)) || "—" : String(env.personName || "—")], ["Creado", day(toDate(env.createdAt))], [closed ? "Liquidado" : "Estado", closed ? day(toDate(env.closedAt || env.settledAt)) : "Abierto"]],
          table: {
            columns: [{ label: "Doc.", width: 26, mono: true }, { label: "Proveedor y concepto", width: 82 }, { label: "Cuenta", width: 26, mono: true }, { label: "Fecha", width: 22 }, { label: "Base", width: 22, align: "right" }],
            rows: expenseRows(list),
          },
          totals: { base: eur(base), rows: [["IVA", eur(list.reduce((t, e) => t + num(e.vatAmount), 0))], ["Total", eur(total)], ...(kind === "transfer" ? [["Anticipado", eur(((env.advances as { amount?: number }[]) || []).reduce((t, a) => t + num(a.amount), 0))] as [string, string]] : [])] },
          versions: [
            { version: "V01", at: toDate(env.createdAt) || new Date(), by: String(env.createdByName || "—"), change: "Apertura del sobre" },
            ...(closed ? [{ version: "V01", at: toDate(env.closedAt || env.settledAt) || new Date(), by: String(env.closedByName || env.settledByName || "—"), change: "Liquidación" }] : []),
          ],
          signature: kind === "transfer" ? [{ label: "Liquida", name: String(env.personName || ""), role: String(env.personDepartment || "") }, { label: "Revisa", name: String(env.settledByName || ""), role: "Contabilidad" }] : undefined,
        }),
      });
    };
    for (const env of envs) envelopeDoc("card", env, exps.filter((e) => e.envelopeId === env.id), ["Cards", clean(cardName.get(String(env.boxId)) || "Tarjeta")]);
    for (const env of tEnvs) envelopeDoc("transfer", env, tExps.filter((e) => e.envelopeId === env.id), ["Transfers"]);
    const floatName = new Map(floats.map((f) => [f.id, `${f.code} · ${f.name}`]));
    for (const m of moves) {
      if (!m.number || m.type === "adjustment") continue;
      const number = String(m.number);
      const kindLabel = ({ funding: "Reposición", advance: "Vale de anticipo", return: "Devolución", expense: "Gasto", settlement: "Justificación", reimbursement: "Reembolso" } as Record<string, string>)[String(m.type)] || "Movimiento";
      const lines = (m.lines as Record<string, unknown>[] | undefined) || [];
      const baseAmt = lines.length ? lines.reduce((t, l) => t + num(l.baseAmount), 0) : num(m.amount);
      const vat = lines.reduce((t, l) => t + num(l.vatAmount), 0);
      const who = String(m.supplier || m.personName || "");
      const needsDoc = ["expense", "settlement"].includes(String(m.type));
      items.push({
        id: `cash:${m.id}`, path: ["Box", "Cash", clean(floatName.get(String(m.floatId)) || "Caja")], number, title: who || kindLabel,
        fileName: `${clean(number)}${who ? ` · ${clean(who)}` : ""}.pdf`, type: "box", typeLabel: kindLabel,
        date: toDate(m.date), base: baseAmt, total: num(m.amount), status: kindLabel, version: "V01",
        originals: m.attachmentUrl ? [{ url: String(m.attachmentUrl), label: m.documentType === "invoice" ? "Factura" : "Ticket" }] : [],
        warnings: needsDoc && !m.attachmentUrl ? ["Sin ticket"] : [], sortKey: number, source: { kind: "cashMovement", id: m.id },
        spec: async () => ({
          docLabel: kindLabel, docType: "box", number, version: "V01",
          meta: [["Fecha", day(toDate(m.date))], ["Caja", floatName.get(String(m.floatId)) || "—"], [m.supplier ? "Proveedor" : "Persona", who || "—"], ["Importe", eur(num(m.amount))]],
          summary: m.description ? { title: "Concepto", text: String(m.description) } : undefined,
          table: lines.length ? {
            columns: [{ label: "Concepto", width: 100 }, { label: "Cuenta", width: 30, mono: true }, { label: "IVA", width: 20, align: "right" }, { label: "Base", width: 28, align: "right" }],
            rows: lines.map((l) => [String(l.description || m.description || "—"), String(l.subAccountCode || "—"), `${num(l.vatRate)} %`, eur(num(l.baseAmount))]),
            subRows: lines.map((l) => (l.subAccountDescription as string) || null),
          } : undefined,
          totals: { base: eur(baseAmt), rows: [["IVA", eur(vat)], ["Total", eur(num(m.amount))]] },
          signature: m.type === "advance" ? [{ label: "Recibí", name: String(m.personName || ""), role: String(m.personDepartment || "") }, { label: "Entrega", name: String(m.createdByName || ""), role: "Caja" }] : undefined,
          versions: [{ version: "V01", at: toDate(m.createdAt) || toDate(m.date) || new Date(), by: String(m.createdByName || "—"), change: "Registro" }],
        }),
      });
    }
  }

  return { project, items, usedNumbers };
}

// ─── Generación ──────────────────────────────────────────────────────────────
const bandCache = new Map<string, string>();

/** Banda de cabecera del proyecto (cacheada) y datos para buildProjectDoc. */
export async function hubDocProject(project: HubProject, projectId: string): Promise<DocProject> {
  const key = `${projectId}:${project.coverUrl || ""}`;
  if (!bandCache.has(key)) bandCache.set(key, await renderProjectBand(projectId, project.coverUrl));
  return { name: project.name, code: project.code, producer: project.producer, phase: project.phase, seed: projectId, band: bandCache.get(key)!, legal: project.legal };
}

export async function renderHubItem(item: HubItem, project: HubProject, projectId: string, user: string) {
  const key = `${projectId}:${project.coverUrl || ""}`;
  if (!bandCache.has(key)) bandCache.set(key, await renderProjectBand(projectId, project.coverUrl));
  const body = await item.spec();
  const proj: DocProject = { name: project.name, code: project.code, producer: project.producer, phase: project.phase, seed: projectId, band: bandCache.get(key)!, legal: project.legal };
  const fingerprint = await contentFingerprint({ id: item.id, body, originals: item.originals.map((o) => o.url) });
  const cover = buildProjectDoc({ ...body, project: proj, generatedAt: new Date(), generatedBy: user, fingerprint }).output("arraybuffer");
  const { bytes, missing } = await appendOriginals(cover, item.originals, `${item.number} · ${project.name}`, { voided: !!item.voided, watermark: item.watermark });
  return { bytes, missing, fingerprint };
}

/** Faltan números en la secuencia (PO-0003, FRA/PRF/FNZ-0007…), contando también los borradores. */
export function numberingGaps(used: number[], prefix: string) {
  const nums = Array.from(new Set(used)).sort((a, b) => a - b);
  const gaps: string[] = [];
  for (let i = 1; i < nums.length; i++) for (let n = nums[i - 1] + 1; n < nums[i] && gaps.length < 20; n++) gaps.push(hubNumber(prefix, n));
  return gaps;
}
