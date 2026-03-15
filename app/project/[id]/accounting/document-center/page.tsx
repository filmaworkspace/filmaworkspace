"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText, Download, Search, Calendar, Receipt,
  FileCheck, Shield, X, CheckCircle, FolderDown,
  ShieldAlert, CheckSquare, Square, ArrowLeft,
  Building2, Package, Eye, Paperclip, FileImage,
  ChevronDown,
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { zipSync, strToU8 } from "fflate";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type DocumentType = "invoice" | "proforma" | "budget" | "guarantee";
type InvoiceStatus = "pending_approval" | "pending" | "paid" | "overdue" | "cancelled" | "rejected";

interface InvoiceItem {
  description: string;
  subAccountCode: string;
  subAccountDescription: string;
  quantity: number;
  unitPrice: number;
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

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

const fmtDateTime = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";

const fmtMoney = (amount: number, currency = "EUR") => {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + symbol;
};

// ── main ──────────────────────────────────────────────────────────────────────
export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [loading, setLoading]   = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // filters
  const [searchTerm, setSearchTerm]       = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [typeFilter, setTypeFilter]         = useState("all");
  const [statusFilter, setStatusFilter]     = useState("all");
  const [dateRange, setDateRange]           = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [showSupplierDD, setShowSupplierDD] = useState(false);
  const [showTypeDD, setShowTypeDD]         = useState(false);
  const [showStatusDD, setShowStatusDD]     = useState(false);

  // selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // download state
  const [downloading, setDownloading]       = useState(false);
  const [dlProgress, setDlProgress]         = useState({ current: 0, total: 0, label: "" });

  // preview
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  // ── load ────────────────────────────────────────────────────────────
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
          number: raw.number, displayNumber: raw.displayNumber || `FAC-${raw.number}`,
          supplierNumber: raw.supplierNumber, supplier: raw.supplier, supplierId: raw.supplierId,
          supplierTaxId: raw.supplierTaxId, department: raw.department, description: raw.description,
          items: raw.items || [],
          baseAmount: raw.baseAmount || 0, vatAmount: raw.vatAmount || 0,
          irpfAmount: raw.irpfAmount || 0, totalAmount: raw.totalAmount || 0,
          currency: raw.currency || "EUR", status: raw.status,
          dueDate: raw.dueDate?.toDate() || new Date(),
          invoiceDate: raw.invoiceDate?.toDate(),
          createdAt: raw.createdAt?.toDate() || new Date(),
          createdBy: raw.createdBy, createdByName: raw.createdByName,
          attachmentUrl: raw.attachmentUrl, attachmentFileName: raw.attachmentFileName,
          codedAt: raw.codedAt?.toDate(), codedByName: raw.codedByName,
          accountingEntry: raw.accountingEntry,
          paidAt: raw.paidAt?.toDate(), paidAmount: raw.paidAmount,
          paymentMethod: raw.paymentMethod, paymentReference: raw.paymentReference,
          paidByName: raw.paidByName, receiptUrl: raw.receiptUrl, receiptName: raw.receiptName,
          poId: raw.poId, poNumber: raw.poNumber,
        });
      }
      setInvoices(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // ── derived lists ────────────────────────────────────────────────────
  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    invoices.forEach(inv => map.set(inv.supplierId || inv.supplier, inv.supplier));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let f = [...invoices];
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      f = f.filter(inv =>
        inv.number.toLowerCase().includes(s) ||
        inv.displayNumber.toLowerCase().includes(s) ||
        inv.supplier.toLowerCase().includes(s) ||
        inv.description?.toLowerCase().includes(s) ||
        (inv.poNumber && inv.poNumber.toLowerCase().includes(s))
      );
    }
    if (supplierFilter !== "all") f = f.filter(inv => (inv.supplierId || inv.supplier) === supplierFilter);
    if (typeFilter    !== "all") f = f.filter(inv => inv.documentType === typeFilter);
    if (statusFilter  !== "all") f = f.filter(inv => inv.status === statusFilter);
    if (dateRange.from) { const d = new Date(dateRange.from); f = f.filter(inv => inv.createdAt >= d); }
    if (dateRange.to)   { const d = new Date(dateRange.to); d.setHours(23,59,59,999); f = f.filter(inv => inv.createdAt <= d); }
    return f;
  }, [invoices, searchTerm, supplierFilter, typeFilter, statusFilter, dateRange]);

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;

  const toggleSelect    = (id: string) => { const s = new Set(selectedIds); s.has(id) ? s.delete(id) : s.add(id); setSelectedIds(s); };
  const toggleSelectAll = () => setSelectedIds(isAllSelected ? new Set() : new Set(filteredInvoices.map(i => i.id)));

  const hasActiveFilters = searchTerm || supplierFilter !== "all" || typeFilter !== "all" || statusFilter !== "all" || dateRange.from || dateRange.to;

  const clearFilters = () => {
    setSearchTerm(""); setSupplierFilter("all"); setTypeFilter("all");
    setStatusFilter("all"); setDateRange({ from: "", to: "" });
  };

  // ── download helpers ─────────────────────────────────────────────────
  const fetchViaProxy = async (url: string): Promise<ArrayBuffer> => {
    const resp = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error(`Proxy ${resp.status}`);
    return resp.arrayBuffer();
  };

  const fetchBannerPdf = async (invoice: Invoice): Promise<ArrayBuffer> => {
    const body = {
      displayNumber: invoice.displayNumber,
      supplier: invoice.supplier,
      supplierNumber: invoice.supplierNumber || "",
      date: (invoice.invoiceDate || invoice.createdAt).toISOString(),
      type: invoice.documentType,
      items: invoice.items.map(it => ({
        baseAmount: it.baseAmount, vatRate: it.vatRate, vatAmount: it.vatAmount,
        subAccountCode: it.subAccountCode, subAccountDescription: it.subAccountDescription,
      })),
      baseAmount: invoice.baseAmount, vatAmount: invoice.vatAmount,
      irpfRate: invoice.items[0]?.irpfRate ?? 0, irpfAmount: invoice.irpfAmount,
      totalAmount: invoice.totalAmount, status: invoice.status,
      paidAt: invoice.paidAt?.toISOString() || null,
      paymentMethod: invoice.paymentMethod || null,
      paymentReference: invoice.paymentReference || null,
    };
    const resp = await fetch("/api/invoice-banner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`Banner ${resp.status}`);
    return resp.arrayBuffer();
  };

  /** Genera el PDF completo: banner + factura + comprobante */
  const buildInvoicePdf = async (invoice: Invoice): Promise<Uint8Array> => {
    const { PDFDocument } = await import("pdf-lib");
    const final = await PDFDocument.create();

    const embed = async (bytes: ArrayBuffer, fileName?: string) => {
      try {
        const src = await PDFDocument.load(bytes);
        const pages = await final.copyPages(src, src.getPageIndices());
        pages.forEach(p => final.addPage(p));
      } catch {
        const imgBytes = new Uint8Array(bytes);
        const isPng = fileName?.toLowerCase().endsWith(".png");
        const img = isPng ? await final.embedPng(imgBytes) : await final.embedJpg(imgBytes);
        const { width, height } = img.scale(1);
        const scale = Math.min(555 / width, 800 / height, 1);
        const page = final.addPage([595.28, 841.89]);
        page.drawImage(img, { x: 20, y: 841.89 - 20 - height * scale, width: width * scale, height: height * scale });
      }
    };

    // 1. Banner
    try { await embed(await fetchBannerPdf(invoice)); } catch (e) { console.warn("banner:", e); }
    // 2. Factura
    if (invoice.attachmentUrl) { try { await embed(await fetchViaProxy(invoice.attachmentUrl), invoice.attachmentFileName); } catch (e) { console.warn("attachment:", e); } }
    // 3. Comprobante de pago
    if (invoice.receiptUrl) { try { await embed(await fetchViaProxy(invoice.receiptUrl), invoice.receiptName); } catch (e) { console.warn("receipt:", e); } }

    return final.save();
  };

  /** Descarga un solo expediente */
  const downloadSingle = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      setDlProgress({ current: 1, total: 1, label: invoice.displayNumber });
      const bytes = await buildInvoicePdf(invoice);
      triggerDownload(bytes, `Expediente_${invoice.displayNumber}.pdf`);
    } catch (e) { console.error(e); }
    finally { setDownloading(false); setDlProgress({ current: 0, total: 0, label: "" }); }
  };

  /** Descarga selección como ZIP */
  const downloadSelection = async () => {
    if (selectedIds.size === 0) return;
    const selected = filteredInvoices.filter(inv => selectedIds.has(inv.id));
    await downloadAsZip(selected, `Expedientes_seleccion`);
  };

  /** Descarga todas las facturas de un proveedor como ZIP */
  const downloadBySupplier = async (supplierId: string, supplierName: string) => {
    const invs = filteredInvoices.filter(inv => (inv.supplierId || inv.supplier) === supplierId);
    const safeName = supplierName.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 40);
    await downloadAsZip(invs, `Expedientes_${safeName}`);
  };

  /** Descarga todos los documentos filtrados como ZIP */
  const downloadAll = async () => {
    await downloadAsZip(filteredInvoices, `Expedientes_todos`);
  };

  const downloadAsZip = async (invList: Invoice[], zipName: string) => {
    if (invList.length === 0) return;
    try {
      setDownloading(true);
      const entries: Record<string, Uint8Array> = {};
      for (let i = 0; i < invList.length; i++) {
        const inv = invList[i];
        setDlProgress({ current: i + 1, total: invList.length, label: inv.displayNumber });
        try {
          const bytes = await buildInvoicePdf(inv);
          entries[`${inv.displayNumber}.pdf`] = bytes;
        } catch (e) { console.warn(`Error en ${inv.displayNumber}:`, e); }
      }
      if (Object.keys(entries).length === 0) return;
      const zip = zipSync(entries);
      triggerDownload(zip, `${zipName}.zip`, "application/zip");
    } catch (e) { console.error(e); }
    finally { setDownloading(false); setDlProgress({ current: 0, total: 0, label: "" }); }
  };

  const triggerDownload = (bytes: Uint8Array, fileName: string, mime = "application/pdf") => {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  // ── summary stats ────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:   filteredInvoices.length,
    paid:    filteredInvoices.filter(i => i.status === "paid").length,
    pending: filteredInvoices.filter(i => i.status === "pending" || i.status === "pending_approval").length,
    totalAmount: filteredInvoices.reduce((s, i) => s + i.totalAmount, 0),
    paidAmount:  filteredInvoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.paidAmount || i.totalAmount), 0),
  }), [filteredInvoices]);

  // ── suppliers grouped for quick download ────────────────────────────
  const supplierGroups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number }>();
    filteredInvoices.forEach(inv => {
      const key = inv.supplierId || inv.supplier;
      const existing = map.get(key) || { name: inv.supplier, count: 0, total: 0 };
      map.set(key, { name: inv.supplier, count: existing.count + 1, total: existing.total + inv.totalAmount });
    });
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [filteredInvoices]);

  // ── loading / access ─────────────────────────────────────────────────
  if (permissionsLoading || loading) return (
    <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (permissionsError || !permissions.hasAccountingAccess) return (
    <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={28} className="text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">No tienes permisos para acceder a esta sección</p>
        <Link href={`/project/${id}/accounting`}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
          style={{ backgroundColor: "#2F52E0" }}>
          <ArrowLeft size={16} /> Volver
        </Link>
      </div>
    </div>
  );

  // ── download overlay ─────────────────────────────────────────────────
  const DownloadOverlay = () => downloading ? (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center">
        <div className="w-14 h-14 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="font-semibold text-slate-900 mb-1">Generando expedientes</p>
        {dlProgress.total > 1 && (
          <>
            <p className="text-sm text-slate-500 mb-3">{dlProgress.current} de {dlProgress.total}</p>
            <div className="w-full bg-slate-100 rounded-full h-1.5">
              <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(dlProgress.current / dlProgress.total) * 100}%` }} />
            </div>
          </>
        )}
        {dlProgress.label && <p className="text-xs text-slate-400 mt-2 truncate">{dlProgress.label}</p>}
      </div>
    </div>
  ) : null;

  const FilterDropdown = ({ open, onToggle, label, children }: { open: boolean; onToggle: () => void; label: string; children: React.ReactNode }) => (
    <div className="relative">
      <button onClick={onToggle}
        className={cx("flex items-center gap-2 px-3 py-2 border rounded-xl text-sm transition-colors",
          open ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:border-slate-300")}>
        <span className="text-slate-700">{label}</span>
        <ChevronDown size={13} className={cx("text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-40 py-1 min-w-[200px] max-h-72 overflow-y-auto">
            {children}
          </div>
        </>
      )}
    </div>
  );

  const DDOption = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick}
      className={cx("w-full text-left px-4 py-2 text-sm transition-colors whitespace-nowrap",
        active ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>
      {children}
    </button>
  );

  return (
    <div className={cx("min-h-screen bg-slate-50", inter.className)}>
      <DownloadOverlay />

      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="mt-[4.5rem] bg-white border-b border-slate-200">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <FolderDown size={20} className="text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Centro de documentación</h1>
                <p className="text-sm text-slate-500">{invoices.length} documentos cargados</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button onClick={downloadSelection} disabled={downloading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50">
                  <Download size={15} />
                  Descargar selección ({selectedIds.size})
                </button>
              )}
              <button onClick={downloadAll} disabled={downloading || filteredInvoices.length === 0}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-40">
                <Package size={15} />
                Descargar todo ({filteredInvoices.length})
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6 space-y-6">

        {/* ── Stats ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total documentos", value: stats.total, sub: null },
            { label: "Pagadas", value: stats.paid, sub: fmtMoney(stats.paidAmount) },
            { label: "Pendientes", value: stats.pending, sub: null },
            { label: "Importe total", value: fmtMoney(stats.totalAmount), sub: null, wide: true },
          ].map((s, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4">
              <p className="text-xs text-slate-500 mb-1">{s.label}</p>
              <p className="text-xl font-bold text-slate-900">{s.value}</p>
              {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
            </div>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[220px] relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, proveedor, descripción…"
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent" />
            </div>

            {/* Supplier filter */}
            <FilterDropdown open={showSupplierDD} onToggle={() => { setShowSupplierDD(!showSupplierDD); setShowTypeDD(false); setShowStatusDD(false); }}
              label={supplierFilter === "all" ? "Proveedor" : (suppliers.find(s => s[0] === supplierFilter)?.[1] || "Proveedor")}>
              <DDOption active={supplierFilter === "all"} onClick={() => { setSupplierFilter("all"); setShowSupplierDD(false); }}>Todos los proveedores</DDOption>
              {suppliers.map(([sid, sname]) => (
                <DDOption key={sid} active={supplierFilter === sid} onClick={() => { setSupplierFilter(sid); setShowSupplierDD(false); }}>
                  {sname}
                </DDOption>
              ))}
            </FilterDropdown>

            {/* Type filter */}
            <FilterDropdown open={showTypeDD} onToggle={() => { setShowTypeDD(!showTypeDD); setShowSupplierDD(false); setShowStatusDD(false); }}
              label={typeFilter === "all" ? "Tipo" : DOCUMENT_TYPES[typeFilter as DocumentType]?.label || "Tipo"}>
              <DDOption active={typeFilter === "all"} onClick={() => { setTypeFilter("all"); setShowTypeDD(false); }}>Todos los tipos</DDOption>
              {Object.entries(DOCUMENT_TYPES).map(([key, val]) => (
                <DDOption key={key} active={typeFilter === key} onClick={() => { setTypeFilter(key); setShowTypeDD(false); }}>{val.label}</DDOption>
              ))}
            </FilterDropdown>

            {/* Status filter */}
            <FilterDropdown open={showStatusDD} onToggle={() => { setShowStatusDD(!showStatusDD); setShowSupplierDD(false); setShowTypeDD(false); }}
              label={statusFilter === "all" ? "Estado" : STATUS_CONFIG[statusFilter as InvoiceStatus]?.label || "Estado"}>
              <DDOption active={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setShowStatusDD(false); }}>Todos los estados</DDOption>
              {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                <DDOption key={key} active={statusFilter === key} onClick={() => { setStatusFilter(key); setShowStatusDD(false); }}>{val.label}</DDOption>
              ))}
            </FilterDropdown>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                  className="pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <span className="text-slate-300">—</span>
              <div className="relative">
                <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                  className="pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
            </div>

            {hasActiveFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-500 hover:bg-slate-50">
                <X size={13} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* ── Supplier quick-download cards ──────────────────────────── */}
        {supplierFilter === "all" && supplierGroups.length > 1 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Descargar por proveedor</p>
            <div className="flex flex-wrap gap-2">
              {supplierGroups.map(([sid, sg]) => (
                <button key={sid} onClick={() => downloadBySupplier(sid, sg.name)} disabled={downloading}
                  className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-40 group">
                  <Building2 size={13} className="text-slate-400 group-hover:text-blue-500" />
                  <span className="text-slate-700 group-hover:text-blue-700 font-medium">{sg.name}</span>
                  <span className="text-xs text-slate-400 group-hover:text-blue-400">{sg.count} doc · {fmtMoney(sg.total)}</span>
                  <Download size={12} className="text-slate-300 group-hover:text-blue-400 ml-1" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Selection bar ──────────────────────────────────────────── */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={18} />
              <span className="font-medium text-sm">{selectedIds.size} documento{selectedIds.size > 1 ? "s" : ""} seleccionado{selectedIds.size > 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-xs text-slate-300 hover:text-white">Cancelar</button>
              <button onClick={downloadSelection} disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-white text-slate-900 rounded-xl text-sm font-medium hover:bg-slate-100 disabled:opacity-50">
                <Download size={14} /> Descargar ZIP
              </button>
            </div>
          </div>
        )}

        {/* ── Table ──────────────────────────────────────────────────── */}
        {filteredInvoices.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No hay documentos</h3>
            <p className="text-slate-500 text-sm">Ajusta los filtros para encontrar los documentos que buscas</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <button onClick={toggleSelectAll} className="p-1 hover:bg-slate-200 rounded">
                      {isAllSelected ? <CheckSquare size={16} className="text-slate-700" /> : <Square size={16} className="text-slate-400" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Documento</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Proveedor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Importe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Archivos</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map(invoice => {
                  const DocIcon = DOCUMENT_TYPES[invoice.documentType].icon;
                  const isSelected = selectedIds.has(invoice.id);
                  const sc = STATUS_CONFIG[invoice.status];
                  return (
                    <tr key={invoice.id} className={cx("hover:bg-slate-50 transition-colors", isSelected && "bg-blue-50")}>
                      <td className="px-4 py-3.5">
                        <button onClick={() => toggleSelect(invoice.id)} className="p-1 hover:bg-slate-200 rounded">
                          {isSelected ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-slate-400" />}
                        </button>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 flex-shrink-0">
                            <DocIcon size={15} className="text-slate-500" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{invoice.displayNumber}</p>
                            <p className="text-xs text-slate-400">{fmtDate(invoice.invoiceDate || invoice.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="text-sm text-slate-900">{invoice.supplier}</p>
                        {invoice.supplierTaxId && <p className="text-xs text-slate-400">{invoice.supplierTaxId}</p>}
                      </td>
                      <td className="px-4 py-3.5">
                        <p className="font-semibold text-slate-900 text-sm">{fmtMoney(invoice.totalAmount, invoice.currency)}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cx("inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium", sc.bg, sc.text)}>{sc.label}</span>
                        {invoice.status === "paid" && invoice.paidAt && (
                          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(invoice.paidAt)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {invoice.attachmentUrl
                            ? <span title="Factura adjunta"><Paperclip size={14} className="text-blue-400" /></span>
                            : <span title="Sin factura"><Paperclip size={14} className="text-slate-200" /></span>}
                          {invoice.receiptUrl
                            ? <span title="Comprobante adjunto"><FileImage size={14} className="text-emerald-400" /></span>
                            : <span title="Sin comprobante"><FileImage size={14} className="text-slate-200" /></span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setPreviewInvoice(invoice)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Vista previa">
                            <Eye size={15} />
                          </button>
                          <button onClick={() => downloadSingle(invoice)} disabled={downloading}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40" title="Descargar expediente">
                            <Download size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-400 text-right">
              {filteredInvoices.length} de {invoices.length} documentos
            </div>
          </div>
        )}
      </main>

      {/* ── Preview Modal ───────────────────────────────────────────── */}
      {previewInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewInvoice(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#2F52E0" }}>
                  <FileText size={17} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">{previewInvoice.displayNumber}</h3>
                  <p className="text-xs text-slate-500">{previewInvoice.supplier}</p>
                </div>
              </div>
              <button onClick={() => setPreviewInvoice(null)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Items */}
              {previewInvoice.items?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Líneas</h4>
                  <div className="space-y-1.5">
                    {previewInvoice.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-2.5 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-xs font-medium text-slate-900">{item.subAccountCode}</p>
                          <p className="text-xs text-slate-500">{item.description || item.subAccountDescription}</p>
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <p className="text-xs font-semibold text-slate-900">{fmtMoney(item.baseAmount, previewInvoice.currency)}</p>
                          <p className="text-xs text-slate-400">IVA {item.vatRate}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Base imponible</span><span className="text-slate-900">{fmtMoney(previewInvoice.baseAmount, previewInvoice.currency)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">IVA</span><span className="text-slate-900">{fmtMoney(previewInvoice.vatAmount, previewInvoice.currency)}</span></div>
                {previewInvoice.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">IRPF</span><span className="text-slate-900">-{fmtMoney(previewInvoice.irpfAmount, previewInvoice.currency)}</span></div>}
                <div className="border-t border-slate-200 pt-1.5 flex justify-between">
                  <span className="font-semibold text-slate-900">Total</span>
                  <span className="font-bold text-slate-900">{fmtMoney(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                </div>
              </div>

              {/* Payment */}
              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div className="bg-emerald-50 rounded-xl p-4 space-y-1">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle size={14} className="text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-800">Pagada el {fmtDateTime(previewInvoice.paidAt)}</span>
                  </div>
                  {previewInvoice.paymentMethod && <p className="text-xs text-emerald-700">{PAYMENT_METHODS[previewInvoice.paymentMethod] || previewInvoice.paymentMethod}</p>}
                  {previewInvoice.paymentReference && <p className="text-xs text-emerald-700">Ref: {previewInvoice.paymentReference}</p>}
                </div>
              )}

              {/* Attachments indicators */}
              <div className="flex gap-3">
                <div className={cx("flex items-center gap-2 px-3 py-2 rounded-lg text-xs", previewInvoice.attachmentUrl ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400")}>
                  <Paperclip size={12} />
                  {previewInvoice.attachmentUrl ? "Factura adjunta" : "Sin factura"}
                </div>
                <div className={cx("flex items-center gap-2 px-3 py-2 rounded-lg text-xs", previewInvoice.receiptUrl ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400")}>
                  <FileImage size={12} />
                  {previewInvoice.receiptUrl ? "Comprobante adjunto" : "Sin comprobante"}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setPreviewInvoice(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                Cerrar
              </button>
              <button onClick={() => { downloadSingle(previewInvoice); setPreviewInvoice(null); }} disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}>
                <Download size={14} /> Descargar expediente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
