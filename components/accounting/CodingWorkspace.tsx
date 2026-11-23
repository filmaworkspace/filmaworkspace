"use client";

// ─── Codificar una factura ───────────────────────────────────────────────────
// Documento a la izquierda; a la derecha, la codificación. «Leer documento»
// extrae los datos (texto del PDF u OCR local, sin servicios externos) y los
// propone: quien codifica elige qué aplicar, nunca se ponen solos. El IBAN sale
// siempre de la ficha del proveedor (certificado de titularidad); el del
// documento solo se compara. El cuadre compara la codificación con los
// importes del documento.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import {
  AlertTriangle, Check, ChevronDown, ExternalLink, FileText, Loader2, Plus, ScanText, Search, ShieldAlert, ShieldCheck, Trash2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";
import { LineOrigin, type OriginPO, type OriginPOItem } from "@/components/accounting/LineOrigin";
import { documentTotals, lineAmounts } from "@/lib/amounts";
import { FIELD_LABELS, parseInvoiceText, validIban, validTaxId, type Proposal, type ProposalField } from "@/lib/ocr/parseInvoice";

export interface CodingForm {
  supplierNumber: string; invoiceDate: string; dueDate: string; description: string; supplierTaxId: string; supplierIban: string; supplierBic: string;
  paymentMethod: string; currency: string; accountingEntry: string; isAsset: boolean; assetCategory: string; notes: string;
}
export interface CodingItem {
  description: string; subAccountId: string; subAccountCode: string; subAccountDescription: string; quantity: number; unitPrice: number; vatRate: number; irpfRate: number;
  poId?: string | null; poNumber?: string | null; poItemId?: string | null; poItemIndex?: number; isNewItem: boolean;
}
interface Sub { id: string; code: string; description: string; committed: number; actual: number; budgeted: number }
interface SupplierInfo { name?: string; taxId?: string; iban?: string; bankAccount?: string; bic?: string; certificates?: { bankOwnership?: { uploaded?: boolean; verified?: boolean; expiryDate?: { toDate?: () => Date } | Date | null } } }

const VAT_RATES = [0, 4, 10, 21];
const IRPF_RATES = [0, 7, 15, 19];
const PAYMENT_METHODS = [
  { value: "transfer", label: "Transferencia bancaria" }, { value: "card", label: "Tarjeta" }, { value: "cash", label: "Efectivo" },
  { value: "check", label: "Cheque" }, { value: "direct_debit", label: "Domiciliación" },
];
const money = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0) + " €";
const dayEs = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "—");
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const isPdf = (url?: string) => !!url && (url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application/pdf"));
const fmtIban = (s?: string) => (s || "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
const CONF_DOT = { alta: "bg-emerald-500", media: "bg-amber-500", baja: "bg-slate-300" } as const;
const MONEY_FIELDS: ProposalField[] = ["baseAmount", "vatAmount", "irpfAmount", "totalAmount"];

const input = "h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:bg-[#F7F7F8]";
const label = "mb-1 block text-[11.5px] font-medium text-slate-500";

export function CodingWorkspace({
  projectId, invoice, supplier, linkedPO, originPOs, subAccounts, form, setForm, items, setItems, saving, onSave, onClose,
}: {
  projectId: string;
  invoice: { id: string; displayNumber: string; supplier: string; supplierId?: string; attachmentUrl?: string; originalAttachmentUrl?: string; replacedFromType?: string };
  supplier: SupplierInfo | null;
  linkedPO: { id: string; number: string; supplier: string; items?: OriginPOItem[] } | null;
  originPOs: OriginPO[];
  subAccounts: Sub[];
  form: CodingForm;
  setForm: (f: CodingForm | ((f: CodingForm) => CodingForm)) => void;
  items: CodingItem[];
  setItems: (i: CodingItem[] | ((i: CodingItem[]) => CodingItem[])) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const [showOriginal, setShowOriginal] = useState(false);
  const [ownTaxIds, setOwnTaxIds] = useState<string[]>([]);
  const [read, setRead] = useState<{ state: "idle" | "reading" | "done" | "error"; label?: string; pct?: number; method?: string; error?: string }>({ state: "idle" });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [picked, setPicked] = useState<Set<ProposalField>>(new Set());
  const [docIban, setDocIban] = useState<string | null>(null);
  const [reference, setReference] = useState<Partial<Record<ProposalField, number>>>({});
  const [search, setSearch] = useState<{ idx: number; q: string } | null>(null);
  const [more, setMore] = useState(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const url = showOriginal ? invoice.originalAttachmentUrl : invoice.attachmentUrl;

  // Nuestro NIF (el del cliente de la factura) no puede ser el del proveedor.
  useEffect(() => {
    getDoc(doc(db, `projects/${projectId}/config`, "company")).then((s) => { const t = s.data()?.taxId; if (t) setOwnTaxIds([String(t)]); }).catch(() => {});
  }, [projectId]);

  // El IBAN es siempre el de la ficha del proveedor.
  const supplierIban = (supplier?.bankAccount || supplier?.iban || "").replace(/\s+/g, "").toUpperCase();
  useEffect(() => {
    if (!supplier) return;
    setForm((f) => ({ ...f, supplierIban, supplierBic: supplier.bic || f.supplierBic, supplierTaxId: f.supplierTaxId || supplier.taxId || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, supplierIban]);

  // ⌘/Ctrl + Enter: completar
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); saveRef.current(); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const totals = useMemo(() => {
    const t = documentTotals(items.map((it) => lineAmounts(it)));
    return { base: t.baseAmount, vat: t.vatAmount, irpf: t.irpfAmount, total: t.totalAmount };
  }, [items]);

  // ── Lectura del documento ────────────────────────────────────────────────
  const readDoc = async () => {
    if (!url) return;
    setRead({ state: "reading", label: "Abriendo el documento…" });
    try {
      const { readDocument } = await import("@/lib/ocr/readDocument");
      const r = await readDocument(url, (l, pct) => setRead({ state: "reading", label: l, pct }));
      const all = parseInvoiceText(r.text, { exclude: ownTaxIds });
      // El IBAN del documento solo se compara con el de la ficha.
      setDocIban((all.find((p) => p.field === "supplierIban")?.value as string) || null);
      const list = all.filter((p) => p.field !== "supplierIban");
      setProposals(list);
      // Importes del documento: referencia para el cuadre.
      setReference(Object.fromEntries(list.filter((p) => MONEY_FIELDS.includes(p.field)).map((p) => [p.field, Number(p.value)])));
      setPicked(new Set());
      setRead({ state: "done", method: r.method === "ocr" ? "OCR" : "texto del PDF" });
    } catch (e) {
      setRead({ state: "error", error: (e as Error).message || "No se ha podido leer el documento" });
    }
  };

  /** Valor actual de la codificación para un campo propuesto. */
  const current = (f: ProposalField): string | number | null => {
    if (f === "supplierNumber") return form.supplierNumber || null;
    if (f === "invoiceDate") return form.invoiceDate || null;
    if (f === "dueDate") return form.dueDate || null;
    if (f === "supplierTaxId") return form.supplierTaxId || null;
    if (f === "baseAmount") return totals.base || null;
    if (f === "vatAmount") return totals.vat || null;
    if (f === "irpfAmount") return totals.irpf || null;
    if (f === "totalAmount") return totals.total || null;
    if (f === "vatRate") return items.length ? items[0].vatRate : null;
    if (f === "irpfRate") return items.length ? items[0].irpfRate : null;
    return null;
  };
  const differs = (p: Proposal) => {
    const c = current(p.field);
    if (c === null || c === "") return true;
    return typeof p.value === "number" ? Math.abs(Number(c) - p.value) > 0.004 : String(c).toUpperCase() !== String(p.value).toUpperCase();
  };
  // Qué se puede aplicar (los importes de IVA, IRPF y total son solo referencia).
  const applicable = (p: Proposal) => !["vatAmount", "irpfAmount", "totalAmount"].includes(p.field) && (p.field !== "baseAmount" || items.length === 1);

  const selectable = proposals.filter((p) => applicable(p) && differs(p));
  const pickedCount = selectable.filter((p) => picked.has(p.field)).length;
  const apply = () => {
    const chosen = proposals.filter((p) => picked.has(p.field) && applicable(p));
    if (!chosen.length) return;
    const get = (f: ProposalField) => chosen.find((p) => p.field === f)?.value;
    setForm((f) => ({
      ...f,
      supplierNumber: (get("supplierNumber") as string) ?? f.supplierNumber,
      invoiceDate: (get("invoiceDate") as string) ?? f.invoiceDate,
      dueDate: (get("dueDate") as string) ?? f.dueDate,
      supplierTaxId: (get("supplierTaxId") as string) ?? f.supplierTaxId,
    }));
    const base = get("baseAmount") as number | undefined, vatRate = get("vatRate") as number | undefined, irpfRate = get("irpfRate") as number | undefined;
    if (base !== undefined || vatRate !== undefined || irpfRate !== undefined) {
      setItems((list) => list.map((it) => ({
        ...it,
        ...(base !== undefined && list.length === 1 ? { quantity: 1, unitPrice: base } : {}),
        ...(vatRate !== undefined ? { vatRate } : {}),
        ...(irpfRate !== undefined ? { irpfRate } : {}),
      })));
    }
    setPicked(new Set());
  };

  // ── Comprobaciones ───────────────────────────────────────────────────────
  const cert = supplier?.certificates?.bankOwnership;
  const certExpiry = cert?.expiryDate ? ((cert.expiryDate as { toDate?: () => Date }).toDate?.() || (cert.expiryDate as Date)) : null;
  const certState = !supplierIban ? "none" : cert?.verified ? (certExpiry && certExpiry < new Date() ? "expired" : "verified") : cert?.uploaded ? "unverified" : "nocert";
  const ibanMismatch = !!docIban && !!form.supplierIban && docIban !== form.supplierIban.replace(/\s+/g, "").toUpperCase();
  const taxIdDoc = proposals.find((p) => p.field === "supplierTaxId")?.value as string | undefined;
  const taxIdMismatch = !!taxIdDoc && !!supplier?.taxId && taxIdDoc !== supplier.taxId.replace(/[\s\-.]/g, "").toUpperCase();
  const checks = [
    { ok: !!form.supplierNumber.trim(), label: "Nº" },
    { ok: !!form.invoiceDate, label: "Fecha" },
    { ok: items.length > 0 && items.every((i) => i.subAccountId), label: `Cuentas ${items.filter((i) => i.subAccountId).length}/${items.length}` },
    { ok: items.every((i) => i.unitPrice > 0), label: "Importes" },
  ];
  const refBase = reference.baseAmount, refTotal = reference.totalAmount;
  const fitsBase = refBase === undefined || Math.abs(refBase - totals.base) < 0.01;
  const fitsTotal = refTotal === undefined || Math.abs(refTotal - totals.total) < 0.01;
  if (refBase !== undefined || refTotal !== undefined) checks.push({ ok: fitsBase && fitsTotal, label: "Cuadre" });

  // ── Líneas ───────────────────────────────────────────────────────────────
  const setItem = (idx: number, patch: Partial<CodingItem>) => setItems((list) => list.map((x, k) => (k === idx ? { ...x, ...patch } : x)));
  const fromPO = (poItem: OriginPOItem & Record<string, any>, idx: number): CodingItem => ({
    description: poItem.description || "", subAccountId: poItem.subAccountId || "", subAccountCode: poItem.subAccountCode || "", subAccountDescription: poItem.subAccountDescription || "",
    quantity: poItem.quantity || 1, unitPrice: poItem.unitPrice || 0, vatRate: poItem.vatRate ?? 21, irpfRate: poItem.irpfRate ?? 0,
    poId: linkedPO!.id, poNumber: linkedPO!.number, poItemId: poItem.id || `item-${idx}`, poItemIndex: idx, isNewItem: false,
  });
  const subById = (id: string) => subAccounts.find((s) => s.id === id);
  const results = search ? subAccounts.filter((s) => `${s.code} ${s.description}`.toLowerCase().includes(search.q.toLowerCase())).slice(0, 12) : [];

  return (
    <div className={`fixed inset-0 z-[55] flex flex-col bg-white ${inter.className}`}>
      {/* Barra superior */}
      <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-slate-200 px-4">
        <button onClick={onClose} aria-label="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-[#F1F1F3] hover:text-slate-900"><X size={17} /></button>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">Codificar <span className="font-mono text-[12px] font-normal text-slate-500">{invoice.displayNumber}</span></p>
          <p className="truncate text-xs text-slate-500">{invoice.supplier}</p>
        </div>
        <div className="ml-4 hidden items-center gap-1.5 lg:flex">
          {checks.map((c) => (
            <span key={c.label} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] ${c.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500"}`}>
              {c.ok ? <Check size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}{c.label}
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <p className="text-[11px] text-slate-500">Base imponible</p>
            <p className="text-[15px] font-semibold tabular-nums text-slate-900">{money(totals.base)}</p>
          </div>
          <button onClick={onSave} disabled={saving} title="⌘ / Ctrl + Enter"
            className="flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {saving ? "Guardando…" : "Completar codificación"}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_620px]">
        {/* Documento */}
        <section className="flex min-h-0 flex-col bg-[#F4F4F5]">
          <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
            {invoice.replacedFromType && invoice.originalAttachmentUrl && (
              <div className="inline-flex rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5 text-[12px]">
                <button onClick={() => setShowOriginal(false)} className={`rounded px-2 py-0.5 ${!showOriginal ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>Factura</button>
                <button onClick={() => setShowOriginal(true)} className={`rounded px-2 py-0.5 ${showOriginal ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>{invoice.replacedFromType === "proforma" ? "Proforma" : "Presupuesto"}</button>
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button aria-label="Alejar" onClick={() => setZoom(Math.max(50, zoom - 25))} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-[#F1F1F3]"><ZoomOut size={15} /></button>
              <span className="w-11 text-center text-[11.5px] tabular-nums text-slate-500">{zoom}%</span>
              <button aria-label="Acercar" onClick={() => setZoom(Math.min(200, zoom + 25))} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-[#F1F1F3]"><ZoomIn size={15} /></button>
              {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Abrir en otra pestaña" className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-[#F1F1F3]"><ExternalLink size={14} /></a>}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {url ? (
              isPdf(url)
                ? <iframe title="Documento" src={`${url}#toolbar=0`} className="rounded-md bg-white shadow-sm" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left", width: `${10000 / zoom}%`, height: `${10000 / zoom}%` }} />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={url} alt={`Documento de ${invoice.displayNumber}`} className="max-w-full rounded-md bg-white shadow-sm" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top left" }} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-slate-400"><FileText size={36} /><p className="mt-2 text-[13px]">Sin documento</p></div>
            )}
          </div>
        </section>

        {/* Codificación */}
        <section className="min-h-0 space-y-6 overflow-y-auto border-l border-slate-200 px-6 py-5">
          {/* Lectura del documento */}
          <div className="rounded-lg border border-slate-200">
            <div className="flex items-center gap-3 px-4 py-3">
              <ScanText size={16} className="text-slate-500" />
              <p className="flex-1 text-[13px] font-medium text-slate-900">
                Lectura del documento
                {read.state === "done" && <span className="ml-2 text-xs font-normal text-slate-400">por {read.method}</span>}
              </p>
              {read.state !== "reading" && (
                <button onClick={readDoc} disabled={!url} className="h-8 rounded-md border border-slate-200 px-3 text-[12.5px] font-medium text-slate-700 hover:bg-[#F7F7F8] disabled:opacity-40">
                  {read.state === "done" ? "Volver a leer" : "Leer documento"}
                </button>
              )}
            </div>
            {read.state === "reading" && (
              <div className="border-t border-slate-100 px-4 py-3">
                <p className="text-xs text-slate-500">{read.label}</p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800 transition-all" style={{ width: `${read.pct ?? 15}%` }} /></div>
              </div>
            )}
            {read.state === "error" && <p className="border-t border-slate-100 px-4 py-3 text-xs text-red-600">{read.error}</p>}
            {read.state === "done" && (
              <div className="border-t border-slate-100">
                {proposals.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-500">No se han reconocido datos en el documento.</p>
                ) : (
                  <>
                    <table className="w-full text-[12.5px]">
                      <tbody>
                        {proposals.map((p) => {
                          const can = applicable(p);
                          const isMoney = typeof p.value === "number" && MONEY_FIELDS.includes(p.field);
                          const shown = isMoney ? money(p.value as number) : p.field.endsWith("Rate") ? `${p.value} %` : p.field.endsWith("Date") ? dayEs(String(p.value)) : String(p.value);
                          const c = current(p.field);
                          const same = !differs(p);
                          return (
                            <tr key={p.field} className="border-b border-slate-100 last:border-0">
                              <td className="w-8 py-2 pl-4">
                                {can && !same
                                  ? <input type="checkbox" checked={picked.has(p.field)} aria-label={`Usar ${FIELD_LABELS[p.field]}`}
                                      onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(p.field)) n.delete(p.field); else n.add(p.field); return n; })} className="accent-slate-900" />
                                  : same ? <Check size={13} className="text-emerald-600" /> : null}
                              </td>
                              <td className="py-2 pr-2 text-slate-500">{FIELD_LABELS[p.field]}</td>
                              <td className="py-2 pr-2">
                                <span className={`font-medium ${["supplierTaxId", "supplierNumber"].includes(p.field) ? "font-mono text-[12px]" : "tabular-nums"} text-slate-900`}>{shown}</span>
                                {!same && c !== null && c !== "" && <span className="ml-2 text-[11px] text-slate-400">ahora {typeof c === "number" && isMoney ? money(c) : p.field.endsWith("Date") ? dayEs(String(c)) : String(c)}</span>}
                                {!can && !same && <span className="ml-2 text-[11px] text-slate-400">referencia</span>}
                              </td>
                              <td className="w-6 py-2 pr-4"><span title={`Confianza ${p.confidence}`} className={`block h-2 w-2 rounded-full ${CONF_DOT[p.confidence]}`} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5">
                      {selectable.length > 0 && (pickedCount === selectable.length
                        ? <button onClick={() => setPicked(new Set())} className="h-8 rounded-md px-3 text-[12.5px] text-slate-500 hover:text-slate-900">Ninguno</button>
                        : <button onClick={() => setPicked(new Set(selectable.map((p) => p.field)))} className="h-8 rounded-md px-3 text-[12.5px] text-slate-500 hover:text-slate-900">Todos</button>)}
                      <button onClick={apply} disabled={!pickedCount} className="h-8 rounded-md bg-slate-900 px-3 text-[12.5px] font-medium text-white disabled:opacity-40">Usar seleccionados{pickedCount ? ` (${pickedCount})` : ""}</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Factura */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label} htmlFor="c-num">Nº factura proveedor</label>
              <input id="c-num" className={`${input} font-mono`} value={form.supplierNumber} onChange={(e) => setForm({ ...form, supplierNumber: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="c-date">Fecha factura</label>
              <input id="c-date" type="date" className={input} value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="c-due">Vencimiento</label>
              <input id="c-due" type="date" className={input} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
              {form.invoiceDate && (
                <div className="mt-1 flex gap-1">
                  {[0, 30, 60, 90].map((n) => (
                    <button key={n} type="button" onClick={() => setForm({ ...form, dueDate: addDays(form.invoiceDate, n) })}
                      className={`rounded px-1.5 py-0.5 text-[10.5px] ${form.dueDate === addDays(form.invoiceDate, n) ? "bg-slate-900 text-white" : "bg-[#F1F1F3] text-slate-600 hover:text-slate-900"}`}>{n === 0 ? "Contado" : `${n} d`}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="col-span-3">
              <label className={label} htmlFor="c-desc">Descripción</label>
              <input id="c-desc" className={input} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          {/* Proveedor */}
          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="truncate text-[13px] font-medium text-slate-900">{invoice.supplier}</p>
              {invoice.supplierId && <Link href={`/project/${projectId}/accounting/suppliers/${invoice.supplierId}`} target="_blank" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">Ficha <ExternalLink size={11} /></Link>}
            </div>
            <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3">
              <div>
                <label className={label} htmlFor="c-nif">NIF / CIF</label>
                <div className="relative">
                  <input id="c-nif" className={`${input} pr-7 font-mono`} value={form.supplierTaxId} onChange={(e) => setForm({ ...form, supplierTaxId: e.target.value.toUpperCase() })} />
                  {form.supplierTaxId && (validTaxId(form.supplierTaxId)
                    ? <Check size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600" aria-label="NIF válido" />
                    : <AlertTriangle size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-500" aria-label="NIF no válido" />)}
                </div>
              </div>
              <div>
                <span className={label}>IBAN (de la ficha del proveedor)</span>
                <div className="flex h-8 items-center rounded-md border border-slate-200 bg-[#F7F7F8] px-2.5">
                  <span className="truncate font-mono text-[12.5px] text-slate-900">{fmtIban(form.supplierIban) || <span className="font-sans text-slate-400">Sin IBAN en la ficha</span>}</span>
                </div>
                {certState === "verified" && <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700"><ShieldCheck size={12} /> Certificado de titularidad verificado</p>}
                {certState === "unverified" && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><ShieldAlert size={12} /> Certificado de titularidad sin verificar</p>}
                {certState === "expired" && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><ShieldAlert size={12} /> Certificado de titularidad caducado</p>}
                {certState === "nocert" && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><ShieldAlert size={12} /> Sin certificado de titularidad</p>}
                {form.supplierIban && !validIban(form.supplierIban) && <p className="mt-1 text-[11px] text-amber-700">El IBAN de la ficha no es válido.</p>}
              </div>
            </div>
            {ibanMismatch && (
              <p className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <ShieldAlert size={14} className="mt-px flex-shrink-0" />
                El documento indica otra cuenta ({fmtIban(docIban!)}). Se pagará a la de la ficha; si el proveedor ha cambiado de banco, pide un certificado nuevo.
              </p>
            )}
            {taxIdMismatch && (
              <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-xs text-amber-900">
                <AlertTriangle size={14} className="mt-px flex-shrink-0" />
                El NIF del documento ({taxIdDoc}) no coincide con el de la ficha ({supplier?.taxId}).
              </p>
            )}
          </div>

          {/* Líneas */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium text-slate-900">Líneas <span className="ml-1 font-normal tabular-nums text-slate-400">{items.length}</span></p>
              <div className="flex gap-1.5">
                {linkedPO?.items?.length ? (
                  <button onClick={() => setItems(linkedPO.items!.map((it, i) => fromPO(it as OriginPOItem & Record<string, any>, i)))} className="h-7 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-[#F7F7F8]">Copiar de PO-{linkedPO.number}</button>
                ) : null}
                <button onClick={() => setItems([...items, { description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "", quantity: 1, unitPrice: 0, vatRate: items[items.length - 1]?.vatRate ?? 21, irpfRate: items[items.length - 1]?.irpfRate ?? 0, isNewItem: true }])}
                  className="flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-[#F7F7F8]"><Plus size={12} /> Línea</button>
              </div>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => {
                const sub = subById(it.subAccountId);
                const lt = lineAmounts(it);
                const avail = sub && sub.budgeted > 0 ? sub.budgeted - sub.committed - sub.actual : null;
                return (
                  <div key={idx} className={`rounded-lg border px-3 py-2.5 ${it.subAccountId ? "border-slate-200" : "border-amber-200"}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] tabular-nums text-slate-400">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <LineOrigin
                          link={{ poId: it.poId || (it.isNewItem ? null : linkedPO?.id), poNumber: it.poNumber, poItemIndex: it.poItemIndex, poItemId: it.poItemId, isNewItem: it.isNewItem }}
                          invoicePO={linkedPO ? { id: linkedPO.id, number: linkedPO.number, supplier: linkedPO.supplier, items: (linkedPO.items || []) as OriginPOItem[] } : null}
                          pos={originPOs}
                          onLink={(po, poItem, i) => setItems((list) => list.map((x, k) => (k !== idx ? x : {
                            ...x, poId: po.id, poNumber: po.number, poItemIndex: i, poItemId: poItem.id || `item-${i}`, isNewItem: false,
                            description: x.description.trim() ? x.description : poItem.description || "",
                            subAccountId: poItem.subAccountId || x.subAccountId, subAccountCode: poItem.subAccountCode || x.subAccountCode, subAccountDescription: poItem.subAccountDescription || x.subAccountDescription,
                          })))}
                          onNew={() => setItem(idx, { isNewItem: true, poId: null, poNumber: null, poItemId: null, poItemIndex: undefined })}
                        />
                      </div>
                      {items.length > 1 && <button onClick={() => setItems(items.filter((_, k) => k !== idx))} aria-label={`Quitar línea ${idx + 1}`} className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>}
                    </div>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                      <input aria-label="Concepto" className={input} value={it.description} placeholder="Concepto" onChange={(e) => setItem(idx, { description: e.target.value })} />
                      {it.subAccountId ? (
                        <div className="flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-[#F7F7F8] px-2.5">
                          <span className="font-mono text-[12.5px] text-slate-900">{it.subAccountCode}</span>
                          <span className="flex-1 truncate text-xs text-slate-600">{it.subAccountDescription}</span>
                          <button aria-label="Cambiar cuenta" onClick={() => setItem(idx, { subAccountId: "", subAccountCode: "", subAccountDescription: "" })} className="text-slate-400 hover:text-slate-700"><X size={13} /></button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input aria-label="Buscar cuenta" className={`${input} pl-7`} placeholder="Cuenta" value={search?.idx === idx ? search.q : ""}
                            onChange={(e) => setSearch({ idx, q: e.target.value })} onFocus={() => setSearch({ idx, q: search?.idx === idx ? search.q : "" })} />
                          {search?.idx === idx && search.q && (
                            <AnchoredPanel className="max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg" match="width">
                              {results.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sin resultados</p>}
                              {results.map((s) => (
                                <button key={s.id} onClick={() => { setItem(idx, { subAccountId: s.id, subAccountCode: s.code, subAccountDescription: s.description }); setSearch(null); }}
                                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-[#F7F7F8]">
                                  <span className="font-mono text-slate-700">{s.code}</span><span className="flex-1 truncate text-slate-600">{s.description}</span>
                                </button>
                              ))}
                            </AnchoredPanel>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-[64px_110px_72px_72px_minmax(0,1fr)] items-end gap-2">
                      <div><span className={label}>Cant.</span><input aria-label="Cantidad" inputMode="decimal" className={`${input} text-right tabular-nums`} value={String(it.quantity ?? "")} onChange={(e) => setItem(idx, { quantity: parseFloat(e.target.value.replace(",", ".")) || 0 })} /></div>
                      <div><span className={label}>Precio</span><input aria-label="Precio unitario" inputMode="decimal" className={`${input} text-right tabular-nums`} value={String(it.unitPrice || "")} onChange={(e) => setItem(idx, { unitPrice: parseFloat(e.target.value.replace(",", ".")) || 0 })} /></div>
                      <div><span className={label}>IVA</span>
                        <select aria-label="IVA" className={`${input} pr-1`} value={it.vatRate} onChange={(e) => setItem(idx, { vatRate: Number(e.target.value) })}>
                          {Array.from(new Set([...VAT_RATES, it.vatRate])).map((r) => <option key={r} value={r}>{r} %</option>)}
                        </select>
                      </div>
                      <div><span className={label}>IRPF</span>
                        <select aria-label="IRPF" className={`${input} pr-1`} value={it.irpfRate} onChange={(e) => setItem(idx, { irpfRate: Number(e.target.value) })}>
                          {Array.from(new Set([...IRPF_RATES, it.irpfRate])).map((r) => <option key={r} value={r}>{r} %</option>)}
                        </select>
                      </div>
                      <div className="pb-1.5 text-right">
                        <p className="text-[13px] font-semibold tabular-nums text-slate-900">{money(lt.baseAmount)}</p>
                        {avail !== null && <p className={`text-[11px] tabular-nums ${avail - lt.baseAmount < 0 ? "text-red-600" : "text-slate-400"}`}>Disponible {money(avail)}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cuadre */}
          <div className="rounded-lg border border-slate-200">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                  <th className="px-4 py-2 text-left font-medium" />
                  <th className="px-2 py-2 text-right font-medium">Base</th>
                  <th className="px-2 py-2 text-right font-medium">IVA</th>
                  <th className="px-2 py-2 text-right font-medium">IRPF</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-2 text-slate-500">Codificación</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{money(totals.base)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(totals.vat)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{totals.irpf ? `−${money(totals.irpf)}` : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(totals.total)}</td>
                </tr>
                {Object.keys(reference).length > 0 && (
                  <tr className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-500">Documento</td>
                    {(["baseAmount", "vatAmount", "irpfAmount", "totalAmount"] as ProposalField[]).map((f, i) => {
                      const v = reference[f];
                      const mine = [totals.base, totals.vat, totals.irpf, totals.total][i];
                      const ok = v === undefined || Math.abs(v - mine) < 0.01;
                      return (
                        <td key={f} className={`${i === 3 ? "px-4" : "px-2"} py-2 text-right tabular-nums ${v === undefined ? "text-slate-300" : ok ? "text-emerald-700" : "font-medium text-red-600"}`}>
                          {v === undefined ? "—" : (f === "irpfAmount" ? `−${money(v)}` : money(v))}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
            {Object.keys(reference).length > 0 && !(fitsBase && fitsTotal) && (
              <p className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-red-700"><AlertTriangle size={13} /> La codificación no cuadra con el documento: diferencia de base {money(Math.abs((refBase ?? totals.base) - totals.base))}.</p>
            )}
          </div>

          {/* Más */}
          <div className="rounded-lg border border-slate-200">
            <button onClick={() => setMore(!more)} aria-expanded={more} className="flex w-full items-center justify-between px-4 py-2.5 text-[13px] text-slate-700">
              Pago y notas <ChevronDown size={14} className={`text-slate-400 transition-transform ${more ? "rotate-180" : ""}`} />
            </button>
            {more && (
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 px-4 py-3">
                <div>
                  <label className={label} htmlFor="c-pay">Método de pago</label>
                  <select id="c-pay" className={input} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-slate-700">
                    <input type="checkbox" checked={form.isAsset} onChange={(e) => setForm({ ...form, isAsset: e.target.checked })} className="accent-slate-900" /> Activo / inventario
                  </label>
                </div>
                {form.isAsset && (
                  <div className="col-span-2">
                    <label className={label} htmlFor="c-asset">Categoría de activo</label>
                    <input id="c-asset" className={input} value={form.assetCategory} onChange={(e) => setForm({ ...form, assetCategory: e.target.value })} />
                  </div>
                )}
                <div className="col-span-2">
                  <label className={label} htmlFor="c-notes">Notas internas</label>
                  <textarea id="c-notes" rows={2} className={`${input} h-auto py-1.5`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
