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

  // ── download — CLIENT-SIDE merge for better PDF handling ──────────────────
  const buildInvoicePdf = async (invoice: Invoice): Promise<Uint8Array | null> => {
    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
    
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

    // Helper to generate banner
    const generateBanner = async (): Promise<Uint8Array> => {
      const DOC_LABELS: Record<string, string> = { invoice: "Factura", ticket: "Ticket", proforma: "Proforma", budget: "Presupuesto", guarantee: "Fianza" };
      const PAY_LABELS: Record<string, string> = { transfer: "Transferencia bancaria", card: "Tarjeta", cash: "Efectivo", check: "Cheque", direct_debit: "Domiciliación" };
      const fmtN = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtM = (n: number) => fmtN(n) + " €";
      const fmtD = (iso: string) => { try { return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return iso; } };

      const pageWidth = 595, padding = 20, headerH = 32, subH = 24, lineH = 15;
      const itemsH = Math.max(1, expenseData.items.length) * lineH + 8;
      const paymentH = (expenseData.status === "paid" && expenseData.paidAt) ? 20 : 0;
      const footerH = 26;
      const pageHeight = headerH + subH + itemsH + paymentH + footerH + padding + 8;

      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const dark = rgb(0.12, 0.16, 0.23), orange = rgb(0.976, 0.451, 0.086), mid = rgb(0.44, 0.50, 0.56);
      const white = rgb(1, 1, 1), light = rgb(0.95, 0.96, 0.97), green = rgb(0.13, 0.77, 0.37), border = rgb(0.85, 0.87, 0.89);

      page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: white });
      const hY = pageHeight - headerH;
      page.drawRectangle({ x: 0, y: hY, width: pageWidth, height: headerH, color: dark });
      page.drawRectangle({ x: 0, y: hY, width: 4, height: headerH, color: orange });
      page.drawText(expenseData.displayNumber, { x: padding, y: hY + (headerH - 13) / 2, size: 13, font: fontB, color: white });

      const typeLabel = DOC_LABELS[expenseData.type] || expenseData.type;
      const dateStr = `${fmtD(expenseData.date)}  ·  ${typeLabel}`;
      const dateW = fontR.widthOfTextAtSize(dateStr, 9);
      page.drawText(dateStr, { x: pageWidth - padding - dateW, y: hY + (headerH - 9) / 2, size: 9, font: fontR, color: rgb(0.7, 0.75, 0.8) });

      const subY = hY - subH;
      page.drawLine({ start: { x: 0, y: subY }, end: { x: pageWidth, y: subY }, thickness: 0.5, color: border });
      const supplierParts = [expenseData.supplier, expenseData.supplierNumber].filter(Boolean).join("  ·  ");
      page.drawText(supplierParts, { x: padding, y: subY + (subH - 10) / 2, size: 10, font: fontB, color: dark });

      const itemsTop = subY - 8;
      expenseData.items.forEach((item, i) => {
        const y = itemsTop - i * lineH;
        if (i % 2 === 0) page.drawRectangle({ x: 0, y: y - 3, width: pageWidth, height: lineH, color: light });
        const account = [item.subAccountCode, item.subAccountDescription].filter(Boolean).join(" · ") || "—";
        page.drawText(account, { x: padding, y: y + 2, size: 8, font: fontR, color: dark });
        page.drawText(`Base: ${fmtN(item.baseAmount)}`, { x: 300, y: y + 2, size: 8, font: fontR, color: mid });
        const vatStr = `IVA ${item.vatRate}%: ${fmtN(item.vatAmount)}`;
        page.drawText(vatStr, { x: pageWidth - padding - fontR.widthOfTextAtSize(vatStr, 8), y: y + 2, size: 8, font: fontR, color: mid });
      });

      const afterItemsY = itemsTop - expenseData.items.length * lineH - 4;
      if (expenseData.status === "paid" && expenseData.paidAt) {
        const payY = afterItemsY - 2;
        page.drawRectangle({ x: 0, y: payY - 3, width: pageWidth, height: paymentH, color: rgb(0.93, 0.99, 0.95) });
        const payMethod = expenseData.paymentMethod ? (PAY_LABELS[expenseData.paymentMethod] || expenseData.paymentMethod) : "";
        const parts = ["✓ Pagada el " + fmtD(expenseData.paidAt), payMethod, expenseData.paymentReference ? "Ref: " + expenseData.paymentReference : ""].filter(Boolean).join("  ·  ");
        page.drawText(parts, { x: padding, y: payY + 4, size: 8, font: fontB, color: green });
      }

      const divBase = (expenseData.status === "paid" && expenseData.paidAt) ? afterItemsY - paymentH - 6 : afterItemsY - 4;
      page.drawLine({ start: { x: padding, y: divBase }, end: { x: pageWidth - padding, y: divBase }, thickness: 0.5, color: border });

      const footerY = divBase - 16;
      page.drawText("Base imponible:", { x: padding, y: footerY, size: 8, font: fontR, color: mid });
      page.drawText(fmtM(expenseData.baseAmount), { x: padding + 75, y: footerY, size: 8, font: fontB, color: dark });
      if (expenseData.irpfRate > 0) page.drawText(`IRPF ${expenseData.irpfRate}%: ${fmtM(expenseData.irpfAmount)}`, { x: 260, y: footerY, size: 8, font: fontR, color: mid });

      const totalValStr = fmtM(expenseData.totalAmount);
      const totalValW = fontB.widthOfTextAtSize(totalValStr, 9);
      const totalLabelW = fontR.widthOfTextAtSize("Total:", 8);
      page.drawText("Total:", { x: pageWidth - padding - totalValW - totalLabelW - 6, y: footerY, size: 8, font: fontR, color: mid });
      page.drawText(totalValStr, { x: pageWidth - padding - totalValW, y: footerY, size: 9, font: fontB, color: dark });

      const wm = "Generado por Filma Workspace · filmaworkspace.com";
      page.drawText(wm, { x: pageWidth - padding - fontR.widthOfTextAtSize(wm, 6), y: 5, size: 6, font: fontR, color: rgb(0.75, 0.78, 0.82) });

      return pdfDoc.save();
    };

    // Helper to merge PDFs - INSERT banner into original doc (don't copy pages)
    const mergePdfs = async (bannerBytes: Uint8Array, docBytes: Uint8Array): Promise<Uint8Array> => {
      console.log("[DocCenter] Starting merge (insert approach)...");
      
      try {
        // Load the ORIGINAL document - we'll modify it directly
        const docPdf = await PDFDocument.load(docBytes, { ignoreEncryption: true });
        const originalPageCount = docPdf.getPageCount();
        console.log("[DocCenter] Original doc loaded, pages:", originalPageCount);
        
        // Load banner
        const bannerDoc = await PDFDocument.load(bannerBytes);
        
        // Copy banner page INTO the original document
        const [bannerPage] = await docPdf.copyPages(bannerDoc, [0]);
        
        // Insert banner at position 0 (beginning)
        docPdf.insertPage(0, bannerPage);
        
        console.log("[DocCenter] Banner inserted at beginning");
        console.log("[DocCenter] Final page count:", docPdf.getPageCount());
        
        const result = await docPdf.save();
        console.log("[DocCenter] Saved, size:", result.length);
        return result;
        
      } catch (err) {
        console.error("[DocCenter] Insert approach failed:", err);
        // Fallback: return original without banner
        return docBytes;
      }
    };

    // Main logic
    if (invoice.attachmentUrl) {
      // Fetch raw file (no merge on server)
      const proxyUrl = `/api/storage-proxy?url=${encodeURIComponent(invoice.attachmentUrl)}`;
      console.log("[DocCenter] fetching raw file...");
      const resp = await fetch(proxyUrl);
      if (!resp.ok) return null;
      
      const contentType = resp.headers.get("content-type") || "";
      const fileBytes = new Uint8Array(await resp.arrayBuffer());
      console.log("[DocCenter] raw file:", fileBytes.length, "bytes, type:", contentType);

      // Generate banner client-side
      const bannerBytes = await generateBanner();
      console.log("[DocCenter] banner generated:", bannerBytes.length, "bytes");

      // Convert image to PDF if needed
      let docPdfBytes: Uint8Array;
      if (contentType.includes("pdf")) {
        docPdfBytes = fileBytes;
      } else {
        // Image → PDF
        const imgDoc = await PDFDocument.create();
        const img = contentType.includes("png") 
          ? await imgDoc.embedPng(fileBytes) 
          : await imgDoc.embedJpg(fileBytes);
        const { width, height } = img.scale(1);
        const scale = Math.min(595 / width, 842 / height, 1);
        const page = imgDoc.addPage([595, 842]);
        page.drawImage(img, { x: (595 - width * scale) / 2, y: (842 - height * scale) / 2, width: width * scale, height: height * scale });
        docPdfBytes = await imgDoc.save();
      }

      // Merge banner + document
      let result = await mergePdfs(bannerBytes, docPdfBytes);

      // If there's also a receipt, append it
      if (invoice.receiptUrl) {
        try {
          const rResp = await fetch(`/api/storage-proxy?url=${encodeURIComponent(invoice.receiptUrl)}`);
          if (rResp.ok) {
            const rContentType = rResp.headers.get("content-type") || "";
            const rBytes = new Uint8Array(await rResp.arrayBuffer());
            
            const final = await PDFDocument.load(result);
            
            if (rContentType.includes("pdf")) {
              const rDoc = await PDFDocument.load(rBytes, { ignoreEncryption: true });
              const embeddedPages = await final.embedPdf(rDoc);
              for (const ep of embeddedPages) {
                const page = final.addPage([ep.width, ep.height]);
                page.drawPage(ep, { x: 0, y: 0, width: ep.width, height: ep.height });
              }
            } else {
              // Image receipt
              const img = rContentType.includes("png") ? await final.embedPng(rBytes) : await final.embedJpg(rBytes);
              const { width, height } = img.scale(1);
              const scale = Math.min(555 / width, 800 / height, 1);
              const page = final.addPage([595.28, 841.89]);
              page.drawImage(img, { x: 20, y: 841.89 - 20 - height * scale, width: width * scale, height: height * scale });
            }
            result = await final.save();
          }
        } catch (e) { console.warn("[DocCenter] receipt failed:", e); }
      }

      return result;
    }

    // No attachment → just banner
    return generateBanner();
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
