"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { getInvoiceDisplayState } from "@/lib/invoiceHelpers";
import { Button, Checkbox, EmptyState, IconButton, Input, Page, PageHeader, Select, Spinner } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  Download,
  Eye,
  FileCheck,
  FileImage,
  FileText,
  Paperclip,
  Receipt,
  Search,
  Shield,
  ShieldAlert,
  Square,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

type DocumentType = "invoice" | "proforma" | "budget" | "guarantee";
type InvoiceStatus = "pending_approval" | "pending" | "paid" | "overdue" | "cancelled" | "rejected";

interface InvoiceItem {
  description: string;
  subAccountCode: string;
  subAccountDescription: string;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
}

interface Invoice {
  id: string;
  documentType: DocumentType;
  number: string;
  displayNumber: string;
  supplierNumber?: string;
  supplier: string;
  supplierId: string;
  supplierTaxId?: string;
  department?: string;
  description: string;
  items: InvoiceItem[];
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  currency: string;
  status: InvoiceStatus;
  displayState: string;
  dueDate: Date;
  invoiceDate?: Date;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  attachmentUrl?: string;
  attachmentFileName?: string;
  codedAt?: Date;
  codedByName?: string;
  accountingEntry?: string;
  paidAt?: Date;
  paidAmount?: number;
  paymentMethod?: string;
  paymentReference?: string;
  paidByName?: string;
  receiptUrl?: string;
  receiptName?: string;
  poId?: string;
  poNumber?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_TYPES: Record<DocumentType, { label: string; icon: React.ElementType }> = {
  invoice:   { label: "Factura",     icon: Receipt   },
  proforma:  { label: "Proforma",    icon: FileText  },
  budget:    { label: "Presupuesto", icon: FileCheck },
  guarantee: { label: "Fianza",      icon: Shield    },
};

const PAYMENT_METHODS: Record<string, string> = {
  transfer:     "Transferencia bancaria",
  card:         "Tarjeta",
  cash:         "Efectivo",
  check:        "Cheque",
  direct_debit: "Domiciliación",
};

const STATUS_FALLBACK = { bg: "bg-slate-100", text: "text-slate-600", label: "Sin estado" };

const STATUS_CONFIG: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
  pending_approval: { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pte. aprobación" },
  pending:          { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pte. pago"        },
  paid:             { bg: "bg-emerald-50", text: "text-emerald-700", label: "Pagada"            },
  overdue:          { bg: "bg-red-50",     text: "text-red-700",     label: "Vencida"           },
  cancelled:        { bg: "bg-slate-100",  text: "text-slate-600",   label: "Cancelada"         },
  rejected:         { bg: "bg-red-50",     text: "text-red-700",     label: "Rechazada"         },
};

function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

const fmtDate = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

const fmtDateTime = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";

const fmtMoney = (amount: number, currency = "EUR") => {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "€";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount) + " " + symbol;
};

// ─────────────────────────────────────────────────────────────────────────────

export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [loading, setLoading]   = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [searchTerm, setSearchTerm]         = useState("");
  const [docField, setDocField] = useState<"all" | "number" | "supplier" | "concept" | "amount">("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [missingFiles, setMissingFiles] = useState(false);
  const [uncodedOnly, setUncodedOnly] = useState(false);
  const [statusFilter, setStatusFilter]     = useState("all");
  const [dateRange, setDateRange]           = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [showStatusDD, setShowStatusDD]     = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress]   = useState({ current: 0, total: 0 });

  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  // Bloquea el scroll de la página de detrás mientras el modal de vista previa está abierto.
  useBodyScrollLock(!!previewInvoice);

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const snap = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const data: Invoice[] = [];
      for (const d of snap.docs) {
        const raw = d.data();
        const canView =
          permissions.canViewAllPOs ||
          (permissions.canViewDepartmentPOs && raw.department === permissions.department) ||
          (permissions.canViewOwnPOs && raw.createdBy === permissions.userId);
        if (!canView) continue;
        data.push({
          id: d.id,
          documentType: raw.documentType || "invoice",
          number: raw.number,
          displayNumber: raw.displayNumber || `FRA-${raw.number}`,
          supplierNumber: raw.supplierNumber,
          supplier: raw.supplier,
          supplierId: raw.supplierId,
          supplierTaxId: raw.supplierTaxId,
          department: raw.department,
          description: raw.description,
          items: raw.items || [],
          baseAmount: raw.baseAmount || 0,
          vatAmount: raw.vatAmount || 0,
          irpfAmount: raw.irpfAmount || 0,
          totalAmount: raw.totalAmount || 0,
          currency: raw.currency || "EUR",
          status: raw.status,
          displayState: getInvoiceDisplayState({ status: raw.status, codedAt: raw.codedAt, approvedAt: raw.approvedAt, accountedAt: raw.accountedAt, paidAt: raw.paidAt, dueDate: raw.dueDate?.toDate() }),
          dueDate: raw.dueDate?.toDate() || new Date(),
          invoiceDate: raw.invoiceDate?.toDate(),
          createdAt: raw.createdAt?.toDate() || new Date(),
          createdBy: raw.createdBy,
          createdByName: raw.createdByName,
          attachmentUrl: raw.attachmentUrl,
          attachmentFileName: raw.attachmentFileName,
          codedAt: raw.codedAt?.toDate(),
          codedByName: raw.codedByName,
          accountingEntry: raw.accountingEntry,
          paidAt: raw.paidAt?.toDate(),
          paidAmount: raw.paidAmount,
          paymentMethod: raw.paymentMethod,
          paymentReference: raw.paymentReference,
          paidByName: raw.paidByName,
          receiptUrl: raw.receiptUrl,
          receiptName: raw.receiptName,
          poId: raw.poId,
          poNumber: raw.poNumber,
        });
      }
      setInvoices(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach(inv => map.set(inv.supplierId || inv.supplier, inv.supplier));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let f = [...invoices];
    const q = searchTerm.trim();
    if (q) {
      f = f.filter(inv => {
        const byNumber = matchCode(q, inv.displayNumber, inv.number, inv.poNumber ? `PO-${inv.poNumber}` : "");
        const bySupplier = matchWords(q, inv.supplier) || matchCode(q, inv.supplierTaxId);
        const byConcept = matchWords(q, inv.description);
        const byAmount = matchAmount(q, inv.totalAmount) === true;
        return docField === "number" ? byNumber : docField === "supplier" ? bySupplier : docField === "concept" ? byConcept : docField === "amount" ? byAmount : byNumber || bySupplier || byConcept || byAmount;
      });
    }
    if (statusFilter !== "all") f = f.filter(inv => inv.displayState === statusFilter);
    if (dateRange.from) { const d = new Date(dateRange.from); f = f.filter(inv => inv.createdAt >= d); }
    if (dateRange.to)   { const d = new Date(dateRange.to); d.setHours(23,59,59,999); f = f.filter(inv => inv.createdAt <= d); }
    return f;
  }, [invoices, searchTerm, statusFilter, dateRange, docField]);

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;
  const toggleSelect    = (invId: string) => { const s = new Set(selectedIds); s.has(invId) ? s.delete(invId) : s.add(invId); setSelectedIds(s); };
  const toggleSelectAll = () => setSelectedIds(isAllSelected ? new Set() : new Set(filteredInvoices.map(i => i.id)));
  const hasFilters = searchTerm || statusFilter !== "all" || dateRange.from || dateRange.to;

  // ── download — Server-side merge via proxy with pdf-merger-js ──────────────────
  const buildInvoicePdf = async (invoice: Invoice): Promise<Uint8Array | null> => {
    const { PDFDocument } = await import("pdf-lib");
    
    const expenseData = {
      displayNumber: invoice.displayNumber,
      supplier: invoice.supplier,
      supplierNumber: invoice.supplierNumber || "",
      date: (invoice.invoiceDate || invoice.createdAt).toISOString(),
      type: invoice.documentType,
      items: invoice.items.map(it => ({
        baseAmount: it.baseAmount,
        vatRate: it.vatRate,
        vatAmount: it.vatAmount,
        subAccountCode: it.subAccountCode,
        subAccountDescription: it.subAccountDescription,
      })),
      baseAmount: invoice.baseAmount,
      vatAmount: invoice.vatAmount,
      irpfRate: invoice.items[0]?.irpfRate ?? 0,
      irpfAmount: invoice.irpfAmount,
      totalAmount: invoice.totalAmount,
      status: invoice.status,
      paidAt: invoice.paidAt?.toISOString() || null,
      paymentMethod: invoice.paymentMethod || null,
      paymentReference: invoice.paymentReference || null,
    };

    // Use server-side merge via proxy (uses pdf-merger-js which handles complex PDFs better)
    if (invoice.attachmentUrl) {
      const proxyUrl = `/api/storage-proxy?url=${encodeURIComponent(invoice.attachmentUrl)}&expense=${encodeURIComponent(JSON.stringify(expenseData))}`;
      console.log("[DocCenter] fetching merged PDF from proxy...");
      const resp = await fetch(proxyUrl);
      if (!resp.ok) {
        console.error("[DocCenter] proxy failed:", resp.status);
        return null;
      }
      
      let result = new Uint8Array(await resp.arrayBuffer());
      console.log("[DocCenter] got merged PDF:", result.length, "bytes");

      // If there's also a receipt, append it client-side
      if (invoice.receiptUrl) {
        try {
          const rResp = await fetch(`/api/storage-proxy?url=${encodeURIComponent(invoice.receiptUrl)}`);
          if (rResp.ok) {
            const rContentType = rResp.headers.get("content-type") || "";
            const rBytes = new Uint8Array(await rResp.arrayBuffer());
            
            // Use pdf-lib to append receipt (receipts are usually simple)
            const final = await PDFDocument.load(result);
            
            if (rContentType.includes("pdf")) {
              try {
                const rDoc = await PDFDocument.load(rBytes, { ignoreEncryption: true });
                const rPages = await final.copyPages(rDoc, rDoc.getPageIndices());
                rPages.forEach(p => final.addPage(p));
              } catch (e) {
                console.warn("[DocCenter] couldn't append receipt PDF:", e);
              }
            } else {
              // Image receipt
              const img = rContentType.includes("png") ? await final.embedPng(rBytes) : await final.embedJpg(rBytes);
              const { width, height } = img.scale(1);
              const scale = Math.min(555 / width, 800 / height, 1);
              const page = final.addPage([595.28, 841.89]);
              page.drawImage(img, { x: 20, y: 841.89 - 20 - height * scale, width: width * scale, height: height * scale });
            }
            result = new Uint8Array(await final.save());
          }
        } catch (e) { console.warn("[DocCenter] receipt failed:", e); }
      }

      return result;
    }

    // No attachment → generate banner only via POST endpoint
    const resp = await fetch("/api/invoice-banner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expenseData),
    });
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  };

  const triggerDownload = (bytes: Uint8Array, fileName: string) => {
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSingle = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      const bytes = await buildInvoicePdf(invoice);
      if (bytes) triggerDownload(bytes, `${invoice.displayNumber}.pdf`);
    } catch (e) { console.error(e); }
    finally { setDownloading(false); }
  };

  const downloadMultiple = async (list: Invoice[]) => {
    if (list.length === 0) return;
    try {
      setDownloading(true);
      setDlProgress({ current: 0, total: list.length });
      for (let i = 0; i < list.length; i++) {
        setDlProgress({ current: i + 1, total: list.length });
        const bytes = await buildInvoicePdf(list[i]);
        if (bytes) triggerDownload(bytes, `${list[i].displayNumber}.pdf`);
        if (i < list.length - 1) await new Promise(r => setTimeout(r, 400));
      }
    } catch (e) { console.error(e); }
    finally { setDownloading(false); setDlProgress({ current: 0, total: 0 }); }
  };

  const downloadSelected = () => downloadMultiple(filteredInvoices.filter(inv => selectedIds.has(inv.id)));

  const downloadBySupplier = (supplierId: string) =>
    downloadMultiple(filteredInvoices.filter(inv => (inv.supplierId || inv.supplier) === supplierId));

  // ── loading / access ─────────────────────────────────────────────────
  if (permissionsLoading || loading) return (
    <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
    </div>
  );

  if (permissionsError || !permissions.hasAccountingAccess) return (
    <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
      <div className="text-center max-w-md">
        <div className="hidden">
          <ShieldAlert size={28} className="text-red-500" />
        </div>
        <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">No tienes permisos para acceder a esta sección</p>
        <Link href={`/project/${id}/accounting`}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium">
          <ArrowLeft size={16} /> Volver
        </Link>
      </div>
    </div>
  );

  const FilterDropdown = ({ open, onToggle, label, children }: {
    open: boolean; onToggle: () => void; label: string; children: React.ReactNode;
  }) => (
    <div className="relative">
      <button onClick={onToggle}
        className="flex items-center gap-2 px-4 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white hover:border-slate-300 transition-colors min-w-[160px]">
        <span className="text-slate-700 flex-1 text-left">{label}</span>
        <ChevronDown size={13} className={cx("text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-64 overflow-y-auto" match="min" gap={6}>
            {children}
          </AnchoredPanel>
        </>
      )}
    </div>
  );

  const DDOpt = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick}
      className={cx("w-full text-left px-4 py-1.5 text-[13px] transition-colors whitespace-nowrap",
        active ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>
      {children}
    </button>
  );

  const DOC_STATE: Record<string, { label: string; dot: string; text: string }> = {
    submitted: { label: "Pend. aprobación", dot: "bg-amber-500", text: "text-amber-800" },
    approved: { label: "Aprobada", dot: "bg-emerald-500", text: "text-emerald-800" },
    coded: { label: "Codificada", dot: "bg-violet-500", text: "text-violet-800" },
    accounted: { label: "Contabilizada", dot: "bg-teal-500", text: "text-teal-800" },
    paid: { label: "Pagada", dot: "bg-[#2F52E0]", text: "text-blue-800" },
    overdue: { label: "Vencida", dot: "bg-red-500", text: "text-red-700" },
    rejected: { label: "Rechazada", dot: "bg-red-500", text: "text-red-700" },
    cancelled: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500" },
    draft: { label: "Borrador", dot: "bg-slate-300", text: "text-slate-600" },
  };
  const DOC_FIELDS: SearchField<"all" | "number" | "supplier" | "concept" | "amount">[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Número, proveedor, concepto o importe" },
    { value: "number", label: "Nº documento o PO", placeholder: "Ej. FAC-0012", mono: true },
    { value: "supplier", label: "Proveedor", placeholder: "Nombre o NIF" },
    { value: "concept", label: "Concepto", placeholder: "Ej. alquiler" },
    { value: "amount", label: "Importe", placeholder: "1500 · >1000 · 500-2000", mono: true },
  ];
  const rows = filteredInvoices
    .filter((inv) => supplierFilter === "all" || (inv.supplierId || inv.supplier) === supplierFilter)
    .filter((inv) => !missingFiles || !inv.attachmentUrl || (!!inv.paidAt && !inv.receiptUrl))
    .filter((inv) => !uncodedOnly || !inv.codedAt);
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const filtersOn = !!(hasFilters || supplierFilter !== "all" || missingFiles || uncodedOnly);

  return (
    <Page>
      <PageHeader
        title={<>Centro de documentación <span className="text-[15px] font-normal text-slate-400">{invoices.length}</span></>}
        actions={
          supplierFilter !== "all" ? (
            <Button variant="secondary" onClick={() => downloadBySupplier(supplierFilter)} disabled={downloading}><Download size={14} /> Expedientes del proveedor</Button>
          ) : undefined
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SearchBar fields={DOC_FIELDS} field={docField} onField={setDocField} value={searchTerm} onChange={setSearchTerm} count={rows.length} />
        <div className="w-48">
          <Select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="all">Todos los proveedores</option>
            {suppliers.map(([sid, name]) => <option key={sid} value={sid}>{name}</option>)}
          </Select>
        </div>
        <div className="w-40">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todos los estados</option>
            {Object.entries(DOC_STATE).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
          </Select>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="w-36" aria-label="Desde" />
          <span>—</span>
          <Input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="w-36" aria-label="Hasta" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Checkbox label="Falta algún archivo" checked={missingFiles} onChange={setMissingFiles} />
        <Checkbox label="Sin codificar" checked={uncodedOnly} onChange={setUncodedOnly} />
        {filtersOn && (
          <button onClick={() => { setSearchTerm(""); setStatusFilter("all"); setDateRange({ from: "", to: "" }); setSupplierFilter("all"); setMissingFiles(false); setUncodedOnly(false); }} className="text-xs text-slate-500 hover:text-slate-900">Quitar filtros</button>
        )}
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title={invoices.length ? "Sin resultados" : "Sin documentos"} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1000px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-10 py-2 pl-4"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Seleccionar todo" className="h-3.5 w-3.5 accent-slate-900" /></th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Documento</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Archivos</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Codificación</th>
                  <th scope="col" className="w-20 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const sel = selectedIds.has(invoice.id);
                  const sc = DOC_STATE[invoice.displayState] ?? DOC_STATE.submitted;
                  return (
                    <tr key={invoice.id} className={`border-b border-slate-100 last:border-0 ${sel ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                      <td className="py-1.5 pl-4"><input type="checkbox" checked={sel} onChange={() => toggleSelect(invoice.id)} aria-label={`Seleccionar ${invoice.displayNumber}`} className="h-3.5 w-3.5 accent-slate-900" /></td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="block font-mono text-xs font-medium">{invoice.displayNumber}</span>
                        <span className="block text-xs text-slate-500">{fmtDate(invoice.invoiceDate || invoice.createdAt)}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-1.5">
                        <span className="block truncate">{invoice.supplier}</span>
                        {invoice.supplierTaxId && <span className="block font-mono text-[11px] text-slate-500">{invoice.supplierTaxId}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs font-medium">{fmtMoney(invoice.totalAmount, invoice.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        <span className={`inline-flex items-center gap-1.5 ${sc.text}`}><span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />{sc.label}</span>
                        {invoice.paidAt && <span className="ml-1.5 text-slate-500">{fmtDate(invoice.paidAt)}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        <span className={invoice.attachmentUrl ? "text-slate-700" : "text-red-700"}>{invoice.attachmentUrl ? "Factura" : "Sin factura"}</span>
                        <span className="text-slate-300"> · </span>
                        <span className={invoice.receiptUrl ? "text-slate-700" : invoice.paidAt ? "text-amber-800" : "text-slate-400"}>{invoice.receiptUrl ? "Justificante" : "Sin justificante"}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                        {invoice.codedAt ? <span className="text-slate-700">{[invoice.codedByName, fmtDate(invoice.codedAt)].filter(Boolean).join(" · ")}</span> : <span className="text-slate-400">Sin codificar</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton label="Vista previa" onClick={() => setPreviewInvoice(invoice)} className="-my-1"><Eye size={14} /></IconButton>
                          <IconButton label="Descargar expediente" onClick={() => downloadSingle(invoice)} disabled={downloading} className="-my-1"><Download size={14} /></IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Barra de selección */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-[13px] shadow-lg">
          <span>{selectedIds.size} {selectedIds.size === 1 ? "documento" : "documentos"}</span>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Deseleccionar</Button>
          <Button variant="primary" size="sm" onClick={downloadSelected} disabled={downloading}>
            {downloading ? <><Spinner className="h-3.5 w-3.5" /> {dlProgress.current}/{dlProgress.total}</> : <><Download size={13} /> Descargar expedientes</>}
          </Button>
        </div>
      )}

      {/* Preview Modal */}
      {previewInvoice && (
        <div className="fixed inset-0 bg-slate-900/20 z-[70] flex items-center justify-center p-4"
          onClick={() => setPreviewInvoice(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ backgroundColor: "#2F52E0" }}>
                  <FileText size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{previewInvoice.displayNumber}</h3>
                  <p className="text-xs text-slate-500">Vista previa del expediente</p>
                </div>
              </div>
              <button onClick={() => setPreviewInvoice(null)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Proveedor</h4>
                <p className="font-medium text-slate-900">{previewInvoice.supplier}</p>
                {previewInvoice.supplierTaxId && <p className="text-[13px] text-slate-500">NIF/CIF: {previewInvoice.supplierTaxId}</p>}
              </div>

              {previewInvoice.items?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Líneas de detalle</h4>
                  <div className="space-y-2">
                    {previewInvoice.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-[13px] font-medium text-slate-900">{item.subAccountCode}</p>
                          <p className="text-xs text-slate-500">{item.description || item.subAccountDescription}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-slate-900">{fmtMoney(item.baseAmount, previewInvoice.currency)}</span>
                          <p className="text-xs text-slate-500">IVA {item.vatRate}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Importes</h4>
                <div className="bg-slate-50 rounded-md p-4 space-y-2">
                  <div className="flex justify-between text-[13px]"><span className="text-slate-600">Base imponible</span><span>{fmtMoney(previewInvoice.baseAmount, previewInvoice.currency)}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-slate-600">IVA</span><span>{fmtMoney(previewInvoice.vatAmount, previewInvoice.currency)}</span></div>
                  {previewInvoice.irpfAmount > 0 && <div className="flex justify-between text-[13px]"><span className="text-slate-600">IRPF</span><span>-{fmtMoney(previewInvoice.irpfAmount, previewInvoice.currency)}</span></div>}
                  <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                    <span className="text-slate-900">Total</span>
                    <span className="text-slate-900">{fmtMoney(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                  </div>
                </div>
              </div>

              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Información de pago</h4>
                  <div className="bg-emerald-50 rounded-md p-4 space-y-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle size={15} className="text-emerald-600" />
                      <span className="text-[13px] font-medium text-emerald-800">Pagada el {fmtDateTime(previewInvoice.paidAt)}</span>
                    </div>
                    {previewInvoice.paymentMethod && <p className="text-[13px] text-emerald-700">{PAYMENT_METHODS[previewInvoice.paymentMethod] || previewInvoice.paymentMethod}</p>}
                    {previewInvoice.paymentReference && <p className="text-[13px] text-emerald-700">Ref: {previewInvoice.paymentReference}</p>}
                  </div>
                </div>
              )}

              {previewInvoice.codedAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Codificación contable</h4>
                  <div className="bg-blue-50 rounded-md p-4 space-y-1">
                    <p className="text-[13px] text-blue-700">Por {previewInvoice.codedByName} el {fmtDateTime(previewInvoice.codedAt)}</p>
                    {previewInvoice.accountingEntry && <p className="text-[13px] text-blue-700">Asiento: {previewInvoice.accountingEntry}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setPreviewInvoice(null)}
                className="px-4 py-1.5 border border-slate-200 text-slate-700 rounded-md hover:bg-slate-50 text-[13px] font-medium">Cerrar</button>
              <button onClick={() => { downloadSingle(previewInvoice); setPreviewInvoice(null); }} disabled={downloading}
                className="flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium disabled:opacity-50">
                <Download size={16} /> Descargar expediente
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
