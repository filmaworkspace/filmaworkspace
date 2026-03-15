"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText, Download, Search, Calendar, Receipt,
  FileCheck, Shield, X, CheckCircle,
  FileSpreadsheet, Eye, FolderDown, ShieldAlert,
  CheckSquare, Square, ArrowLeft
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

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
  codedBy?: string;
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

const DOCUMENT_TYPES = {
  invoice:   { label: "Factura",       icon: Receipt },
  proforma:  { label: "Proforma",      icon: FileText },
  budget:    { label: "Presupuesto",   icon: FileCheck },
  guarantee: { label: "Fianza",        icon: Shield },
};

const PAYMENT_METHODS: Record<string, string> = {
  transfer:     "Transferencia bancaria",
  card:         "Tarjeta",
  cash:         "Efectivo",
  check:        "Cheque",
  direct_debit: "Domiciliación",
};

function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;

  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => { filterInvoices(); }, [searchTerm, dateRange, invoices]);

  const loadData = async () => {
    try {
      setLoading(true);
      const invoicesSnapshot = await getDocs(
        query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc"))
      );
      const invoicesData: Invoice[] = [];
      for (const docSnap of invoicesSnapshot.docs) {
        const data = docSnap.data();
        const canView =
          permissions.canViewAllPOs ||
          (permissions.canViewDepartmentPOs && data.department === permissions.department) ||
          (permissions.canViewOwnPOs && data.createdBy === permissions.userId);
        if (!canView) continue;
        invoicesData.push({
          id: docSnap.id,
          documentType: data.documentType || "invoice",
          number: data.number,
          displayNumber: data.displayNumber || `FAC-${data.number}`,
          supplierNumber: data.supplierNumber,
          supplier: data.supplier,
          supplierId: data.supplierId,
          supplierTaxId: data.supplierTaxId,
          department: data.department,
          description: data.description,
          items: data.items || [],
          baseAmount: data.baseAmount || 0,
          vatAmount: data.vatAmount || 0,
          irpfAmount: data.irpfAmount || 0,
          totalAmount: data.totalAmount || 0,
          currency: data.currency || "EUR",
          status: data.status,
          dueDate: data.dueDate?.toDate() || new Date(),
          invoiceDate: data.invoiceDate?.toDate(),
          createdAt: data.createdAt?.toDate() || new Date(),
          createdBy: data.createdBy,
          createdByName: data.createdByName,
          attachmentUrl: data.attachmentUrl,
          attachmentFileName: data.attachmentFileName,
          codedAt: data.codedAt?.toDate(),
          codedBy: data.codedBy,
          codedByName: data.codedByName,
          accountingEntry: data.accountingEntry,
          paidAt: data.paidAt?.toDate(),
          paidAmount: data.paidAmount,
          paymentMethod: data.paymentMethod,
          paymentReference: data.paymentReference,
          paidByName: data.paidByName,
          receiptUrl: data.receiptUrl,
          receiptName: data.receiptName,
          poId: data.poId,
          poNumber: data.poNumber,
        });
      }
      setInvoices(invoicesData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterInvoices = () => {
    let filtered = [...invoices];
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(inv =>
        inv.number.toLowerCase().includes(s) ||
        inv.displayNumber.toLowerCase().includes(s) ||
        inv.supplier.toLowerCase().includes(s) ||
        inv.description?.toLowerCase().includes(s) ||
        (inv.poNumber && inv.poNumber.toLowerCase().includes(s))
      );
    }
    if (dateRange.from) {
      const fromDate = new Date(dateRange.from);
      filtered = filtered.filter(inv => inv.createdAt >= fromDate);
    }
    if (dateRange.to) {
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(inv => inv.createdAt <= toDate);
    }
    setFilteredInvoices(filtered);
  };

  const toggleSelect = (invoiceId: string) => {
    const next = new Set(selectedIds);
    next.has(invoiceId) ? next.delete(invoiceId) : next.add(invoiceId);
    setSelectedIds(next);
  };

  const toggleSelectAll = () => {
    setSelectedIds(
      selectedIds.size === filteredInvoices.length
        ? new Set()
        : new Set(filteredInvoices.map(inv => inv.id))
    );
  };

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;

  const fmt = (amount: number, currency = "EUR") => {
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + symbol;
  };

  const fmtDate = (date: Date) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

  const fmtDateTime = (date: Date) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";

  // ── Download via proxy (same as boxes) ──────────────────────────────
  const fetchViaProxy = async (url: string): Promise<ArrayBuffer> => {
    const resp = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error(`Proxy failed: ${resp.status}`);
    return resp.arrayBuffer();
  };

  // ── Generate banner via proxy (pass invoice data) ────────────────────
  const fetchBannerPdf = async (invoice: Invoice): Promise<ArrayBuffer> => {
    const invoiceData = {
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
      // Payment info — extra fields for this page
      status: invoice.status,
      paidAt: invoice.paidAt?.toISOString() || null,
      paymentMethod: invoice.paymentMethod || null,
      paymentReference: invoice.paymentReference || null,
    };

    // Use a dummy storage URL trick: we send a special "banner-only" request
    // by hitting the proxy without a real file URL — instead we POST the data
    const resp = await fetch("/api/invoice-banner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invoiceData),
    });
    if (!resp.ok) throw new Error(`Banner failed: ${resp.status}`);
    return resp.arrayBuffer();
  };

  const generateFullDocument = async (invoice: Invoice): Promise<Uint8Array> => {
    const { PDFDocument } = await import("pdf-lib");
    const finalPdf = await PDFDocument.create();

    const embedPdfOrImage = async (bytes: ArrayBuffer, fileName?: string) => {
      try {
        const srcDoc = await PDFDocument.load(bytes);
        const pages = await finalPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(p => finalPdf.addPage(p));
      } catch {
        // Not a PDF — try as image
        const imgBytes = new Uint8Array(bytes);
        const isPng = fileName?.toLowerCase().endsWith(".png");
        const image = isPng ? await finalPdf.embedPng(imgBytes) : await finalPdf.embedJpg(imgBytes);
        const { width, height } = image.scale(1);
        const maxW = 555, maxH = 800;
        const scale = Math.min(maxW / width, maxH / height, 1);
        const page = finalPdf.addPage([595.28, 841.89]);
        page.drawImage(image, {
          x: 20, y: 841.89 - 20 - height * scale,
          width: width * scale, height: height * scale,
        });
      }
    };

    // 1. Banner
    try {
      const bannerBytes = await fetchBannerPdf(invoice);
      await embedPdfOrImage(bannerBytes);
    } catch (e) { console.warn("Banner error:", e); }

    // 2. Invoice attachment
    if (invoice.attachmentUrl) {
      try {
        const bytes = await fetchViaProxy(invoice.attachmentUrl);
        await embedPdfOrImage(bytes, invoice.attachmentFileName);
      } catch (e) { console.warn("Attachment error:", e); }
    }

    // 3. Payment receipt (always include if exists, regardless of status)
    if (invoice.receiptUrl) {
      try {
        const bytes = await fetchViaProxy(invoice.receiptUrl);
        await embedPdfOrImage(bytes, invoice.receiptName);
      } catch (e) { console.warn("Receipt error:", e); }
    }

    return finalPdf.save();
  };

  const downloadSingleDocument = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      const pdfBytes = await generateFullDocument(invoice);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Expediente_${invoice.displayNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error generating document:", error);
    } finally {
      setDownloading(false);
    }
  };

  const downloadSelectedDocuments = async () => {
    if (selectedIds.size === 0) return;
    try {
      setDownloading(true);
      setDownloadProgress({ current: 0, total: selectedIds.size });
      const selected = filteredInvoices.filter(inv => selectedIds.has(inv.id));
      for (let i = 0; i < selected.length; i++) {
        setDownloadProgress({ current: i + 1, total: selected.length });
        await downloadSingleDocument(selected[i]);
        if (i < selected.length - 1) await new Promise(r => setTimeout(r, 400));
      }
    } catch (error) {
      console.error("Error downloading:", error);
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  const getStatusBadge = (status: InvoiceStatus) => {
    const configs: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
      pending_approval: { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pte. aprobación" },
      pending:          { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pte. pago" },
      paid:             { bg: "bg-emerald-50", text: "text-emerald-700", label: "Pagada" },
      overdue:          { bg: "bg-red-50",     text: "text-red-700",     label: "Vencida" },
      cancelled:        { bg: "bg-slate-100",  text: "text-slate-600",   label: "Cancelada" },
      rejected:         { bg: "bg-red-50",     text: "text-red-700",     label: "Rechazada" },
    };
    const c = configs[status];
    return (
      <span className={cx("inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium", c.bg, c.text)}>
        {c.label}
      </span>
    );
  };

  // ── Loading ──────────────────────────────────────────────────────────
  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
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
  }

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
              <button onClick={downloadSelectedDocuments} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#2F52E0" }}>
                {downloading ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />{downloadProgress.current}/{downloadProgress.total}</>
                ) : (
                  <><Download size={16} />Descargar ({selectedIds.size})</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">

        {/* Filters — search + date only, no status filter */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, proveedor o descripción"
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white text-sm" />
            </div>
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
            {(searchTerm || dateRange.from || dateRange.to) && (
              <button onClick={() => { setSearchTerm(""); setDateRange({ from: "", to: "" }); }}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                <X size={14} /> Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Selection bar */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={20} />
              <span className="font-medium">{selectedIds.size} documento{selectedIds.size > 1 ? "s" : ""} seleccionado{selectedIds.size > 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedIds(new Set())} className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors">Cancelar</button>
              <button onClick={downloadSelectedDocuments} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-900 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors disabled:opacity-50">
                {downloading ? (
                  <><div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />Descargando {downloadProgress.current}/{downloadProgress.total}</>
                ) : (
                  <><Download size={16} />Descargar expedientes</>
                )}
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
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Codificación</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map(invoice => {
                  const DocIcon = DOCUMENT_TYPES[invoice.documentType].icon;
                  const isSelected = selectedIds.has(invoice.id);
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
                            <p className="text-xs text-slate-500">{fmtDate(invoice.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-900">{invoice.supplier}</p>
                        {invoice.supplierTaxId && <p className="text-xs text-slate-500">{invoice.supplierTaxId}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">{fmt(invoice.totalAmount, invoice.currency)}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(invoice.status)}
                          {invoice.status === "paid" && invoice.paidAt && (
                            <p className="text-xs text-slate-400">{fmtDate(invoice.paidAt)}</p>
                          )}
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
                          <button onClick={() => downloadSingleDocument(invoice)} disabled={downloading}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50" title="Descargar expediente">
                            <Download size={16} />
                          </button>
                          {invoice.attachmentUrl && (
                            <a href={invoice.attachmentUrl} target="_blank" rel="noopener noreferrer"
                              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Ver documento original">
                              <FileText size={16} />
                            </a>
                          )}
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
          <div className="mt-4 text-sm text-slate-500 text-center">
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
              <button onClick={() => setPreviewInvoice(null)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={20} />
              </button>
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
                    {previewInvoice.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.subAccountCode}</p>
                          <p className="text-xs text-slate-500">{item.description || item.subAccountDescription}</p>
                        </div>
                        <div className="text-right">
                          <span className="font-medium text-slate-900">{fmt(item.baseAmount, previewInvoice.currency)}</span>
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
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Base imponible</span><span className="text-slate-900">{fmt(previewInvoice.baseAmount, previewInvoice.currency)}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-slate-600">IVA</span><span className="text-slate-900">{fmt(previewInvoice.vatAmount, previewInvoice.currency)}</span></div>
                  {previewInvoice.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">IRPF</span><span className="text-slate-900">-{fmt(previewInvoice.irpfAmount, previewInvoice.currency)}</span></div>}
                  <div className="border-t border-slate-200 pt-2 flex justify-between">
                    <span className="font-semibold text-slate-900">Total</span>
                    <span className="font-bold text-slate-900">{fmt(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                  </div>
                </div>
              </div>

              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Información de pago</h4>
                  <div className="bg-emerald-50 rounded-xl p-4 space-y-1">
                    <div className="flex items-center gap-2 mb-2">
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
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">
                Cerrar
              </button>
              <button onClick={() => { downloadSingleDocument(previewInvoice); setPreviewInvoice(null); }} disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
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
