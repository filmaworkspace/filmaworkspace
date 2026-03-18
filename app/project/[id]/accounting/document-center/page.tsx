"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useMemo } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText, Download, Search, Calendar, Receipt,
  FileCheck, Shield, X, CheckCircle, FolderDown,
  ShieldAlert, CheckSquare, Square, ArrowLeft,
  Building2, Eye, Paperclip, FileImage, ChevronDown,
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

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

const fmtDate = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

const fmtDateTime = (date: Date) =>
  date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";

const fmtMoney = (amount: number, currency = "EUR") => {
  const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "€";
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + symbol;
};

export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [loading, setLoading]   = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [searchTerm, setSearchTerm]         = useState("");
  const [statusFilter, setStatusFilter]     = useState("all");
  const [dateRange, setDateRange]           = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [showStatusDD, setShowStatusDD]     = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress]   = useState({ current: 0, total: 0 });

  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

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
          displayNumber: raw.displayNumber || `FAC-${raw.number}`,
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
    if (statusFilter !== "all") f = f.filter(inv => inv.status === statusFilter);
    if (dateRange.from) { const d = new Date(dateRange.from); f = f.filter(inv => inv.createdAt >= d); }
    if (dateRange.to)   { const d = new Date(dateRange.to); d.setHours(23,59,59,999); f = f.filter(inv => inv.createdAt <= d); }
    return f;
  }, [invoices, searchTerm, statusFilter, dateRange]);

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;
  const toggleSelect    = (invId: string) => { const s = new Set(selectedIds); s.has(invId) ? s.delete(invId) : s.add(invId); setSelectedIds(s); };
  const toggleSelectAll = () => setSelectedIds(isAllSelected ? new Set() : new Set(filteredInvoices.map(i => i.id)));
  const hasFilters = searchTerm || statusFilter !== "all" || dateRange.from || dateRange.to;

  // ── download — SAME pattern as BOX ──────────────────────────────────
  const buildInvoicePdf = async (invoice: Invoice): Promise<Uint8Array | null> => {
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

    // Case 1: has attachment → proxy merges banner+doc server-side (same as BOX)
    if (invoice.attachmentUrl) {
      const proxyUrl = `/api/storage-proxy?url=${encodeURIComponent(invoice.attachmentUrl)}&expense=${encodeURIComponent(JSON.stringify(expenseData))}`;
      console.log("[DocCenter] fetching proxy:", proxyUrl.substring(0, 120) + "...");
      const resp = await fetch(proxyUrl);
      console.log("[DocCenter] proxy status:", resp.status, "content-type:", resp.headers.get("content-type"));
      if (!resp.ok) return null;
      const mainBytes = new Uint8Array(await resp.arrayBuffer());
      console.log("[DocCenter] mainBytes:", mainBytes.length);

      // If there's also a receipt, append it
      if (invoice.receiptUrl) {
        const { PDFDocument } = await import("pdf-lib");
        const final = await PDFDocument.create();
        const mainDoc = await PDFDocument.load(mainBytes);
        const mainPages = await final.copyPages(mainDoc, mainDoc.getPageIndices());
        mainPages.forEach(p => final.addPage(p));
        try {
          const rResp = await fetch(`/api/storage-proxy?url=${encodeURIComponent(invoice.receiptUrl)}`);
          if (rResp.ok) {
            const rBytes = await rResp.arrayBuffer();
            try {
              const rDoc = await PDFDocument.load(rBytes);
              const rPages = await final.copyPages(rDoc, rDoc.getPageIndices());
              rPages.forEach(p => final.addPage(p));
            } catch {
              // image receipt
              const imgBytes = new Uint8Array(rBytes);
              const isPng = invoice.receiptName?.toLowerCase().endsWith(".png");
              const img = isPng ? await final.embedPng(imgBytes) : await final.embedJpg(imgBytes);
              const { width, height } = img.scale(1);
              const scale = Math.min(555 / width, 800 / height, 1);
              const page = final.addPage([595.28, 841.89]);
              page.drawImage(img, { x: 20, y: 841.89 - 20 - height * scale, width: width * scale, height: height * scale });
            }
          }
        } catch (e) { console.warn("receipt failed:", e); }
        return final.save();
      }

      return mainBytes;
    }

    // Case 2: no attachment → banner only via proxy (pass a dummy? No — use invoice-banner POST)
    const resp = await fetch("/api/invoice-banner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(expenseData),
    });
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  };

  const triggerDownload = (bytes: Uint8Array, fileName: string) => {
    const blob = new Blob([bytes], { type: "application/pdf" });
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

  const FilterDropdown = ({ open, onToggle, label, children }: {
    open: boolean; onToggle: () => void; label: string; children: React.ReactNode;
  }) => (
    <div className="relative">
      <button onClick={onToggle}
        className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors min-w-[160px]">
        <span className="text-slate-700 flex-1 text-left">{label}</span>
        <ChevronDown size={13} className={cx("text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onToggle} />
          <div className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-40 py-1 min-w-full max-h-64 overflow-y-auto">
            {children}
          </div>
        </>
      )}
    </div>
  );

  const DDOpt = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick}
      className={cx("w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap",
        active ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>
      {children}
    </button>
  );

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <FolderDown size={24} className="text-blue-600" />
              <h1 className="text-2xl font-semibold text-slate-900">Centro de documentación</h1>
            </div>
            {selectedIds.size > 0 && (
              <button onClick={downloadSelected} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}>
                {downloading
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{dlProgress.current}/{dlProgress.total}</>
                  : <><Download size={16} />Descargar ({selectedIds.size})</>}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8 space-y-6">

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, proveedor o descripción"
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white text-sm" />
            </div>

            <FilterDropdown open={showStatusDD}
              onToggle={() => setShowStatusDD(!showStatusDD)}
              label={statusFilter === "all" ? "Todos los estados" : (STATUS_CONFIG[statusFilter as InvoiceStatus]?.label || "Estado")}>
              <DDOpt active={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setShowStatusDD(false); }}>Todos los estados</DDOpt>
              {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                <DDOpt key={key} active={statusFilter === key} onClick={() => { setStatusFilter(key); setShowStatusDD(false); }}>{val.label}</DDOpt>
              ))}
            </FilterDropdown>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                  className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <span className="text-slate-400">—</span>
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                  className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
            </div>

            {hasFilters && (
              <button onClick={() => { setSearchTerm(""); setStatusFilter("all"); setDateRange({ from: "", to: "" }); }}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                <X size={14} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Supplier quick-download */}
        {suppliers.length > 1 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Descargar por proveedor</p>
            <div className="flex flex-wrap gap-2">
              {suppliers.map(([sid, sname]) => {
                const count = filteredInvoices.filter(inv => (inv.supplierId || inv.supplier) === sid).length;
                if (count === 0) return null;
                return (
                  <button key={sid} onClick={() => downloadBySupplier(sid)} disabled={downloading}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm hover:border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-40 group">
                    <Building2 size={13} className="text-slate-400" />
                    <span className="text-slate-700 font-medium">{sname}</span>
                    <span className="text-xs text-slate-400">{count}</span>
                    <Download size={12} className="text-slate-300 group-hover:text-slate-500" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selection bar */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={20} />
              <span className="font-medium">{selectedIds.size} documento{selectedIds.size > 1 ? "s" : ""} seleccionado{selectedIds.size > 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedIds(new Set())} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Cancelar</button>
              <button onClick={downloadSelected} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-900 rounded-xl text-sm font-medium hover:bg-slate-100 disabled:opacity-50">
                {downloading
                  ? <><div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />Descargando {dlProgress.current}/{dlProgress.total}</>
                  : <><Download size={16} />Descargar expedientes</>}
              </button>
            </div>
          </div>
        )}

        {/* Table */}
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
                    <button onClick={toggleSelectAll} className="p-1 hover:bg-slate-200 rounded transition-colors">
                      {isAllSelected ? <CheckSquare size={18} className="text-slate-700" /> : <Square size={18} className="text-slate-400" />}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Documento</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Proveedor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Importe</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Estado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Archivos</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Codificación</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map(invoice => {
                  const DocIcon = DOCUMENT_TYPES[invoice.documentType].icon;
                  const isSelected = selectedIds.has(invoice.id);
                  const sc = STATUS_CONFIG[invoice.status];
                  return (
                    <tr key={invoice.id} className={cx("hover:bg-slate-50 transition-colors", isSelected && "bg-blue-50")}>
                      <td className="px-4 py-4">
                        <button onClick={() => toggleSelect(invoice.id)} className="p-1 hover:bg-slate-200 rounded transition-colors">
                          {isSelected ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} className="text-slate-400" />}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100">
                            <DocIcon size={18} className="text-slate-500" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{invoice.displayNumber}</p>
                            <p className="text-xs text-slate-500">{fmtDate(invoice.invoiceDate || invoice.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-900">{invoice.supplier}</p>
                        {invoice.supplierTaxId && <p className="text-xs text-slate-500">{invoice.supplierTaxId}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">{fmtMoney(invoice.totalAmount, invoice.currency)}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={cx("inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium", sc.bg, sc.text)}>{sc.label}</span>
                        {invoice.status === "paid" && invoice.paidAt && (
                          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(invoice.paidAt)}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span title={invoice.attachmentUrl ? "Factura adjunta" : "Sin factura"}>
                            <Paperclip size={14} className={invoice.attachmentUrl ? "text-blue-400" : "text-slate-200"} />
                          </span>
                          <span title={invoice.receiptUrl ? "Comprobante adjunto" : "Sin comprobante"}>
                            <FileImage size={14} className={invoice.receiptUrl ? "text-emerald-400" : "text-slate-200"} />
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {invoice.codedAt ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle size={14} className="text-emerald-500" />
                            <div>
                              <p className="text-xs text-slate-700">{invoice.codedByName}</p>
                              <p className="text-xs text-slate-500">{fmtDate(invoice.codedAt)}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Sin codificar</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setPreviewInvoice(invoice)}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Vista previa">
                            <Eye size={16} />
                          </button>
                          <button onClick={() => downloadSingle(invoice)} disabled={downloading}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50" title="Descargar expediente">
                            <Download size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredInvoices.length > 0 && (
          <div className="text-sm text-slate-500 text-center">
            Mostrando {filteredInvoices.length} de {invoices.length} documentos
          </div>
        )}
      </main>

      {/* Preview Modal */}
      {previewInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewInvoice(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#2F52E0" }}>
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
                {previewInvoice.supplierTaxId && <p className="text-sm text-slate-500">NIF/CIF: {previewInvoice.supplierTaxId}</p>}
              </div>

              {previewInvoice.items?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Líneas de detalle</h4>
                  <div className="space-y-2">
                    {previewInvoice.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.subAccountCode}</p>
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
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Base imponible</span><span>{fmtMoney(previewInvoice.baseAmount, previewInvoice.currency)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">IVA</span><span>{fmtMoney(previewInvoice.vatAmount, previewInvoice.currency)}</span></div>
                  {previewInvoice.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">IRPF</span><span>-{fmtMoney(previewInvoice.irpfAmount, previewInvoice.currency)}</span></div>}
                  <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
                    <span className="text-slate-900">Total</span>
                    <span className="text-slate-900">{fmtMoney(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                  </div>
                </div>
              </div>

              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Información de pago</h4>
                  <div className="bg-emerald-50 rounded-xl p-4 space-y-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle size={15} className="text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-800">Pagada el {fmtDateTime(previewInvoice.paidAt)}</span>
                    </div>
                    {previewInvoice.paymentMethod && <p className="text-sm text-emerald-700">{PAYMENT_METHODS[previewInvoice.paymentMethod] || previewInvoice.paymentMethod}</p>}
                    {previewInvoice.paymentReference && <p className="text-sm text-emerald-700">Ref: {previewInvoice.paymentReference}</p>}
                  </div>
                </div>
              )}

              {previewInvoice.codedAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Codificación contable</h4>
                  <div className="bg-blue-50 rounded-xl p-4 space-y-1">
                    <p className="text-sm text-blue-700">Por {previewInvoice.codedByName} el {fmtDateTime(previewInvoice.codedAt)}</p>
                    {previewInvoice.accountingEntry && <p className="text-sm text-blue-700">Asiento: {previewInvoice.accountingEntry}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setPreviewInvoice(null)}
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cerrar</button>
              <button onClick={() => { downloadSingle(previewInvoice); setPreviewInvoice(null); }} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}>
                <Download size={16} /> Descargar expediente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
