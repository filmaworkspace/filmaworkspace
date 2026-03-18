"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText, Download, Search, Calendar, Receipt,
  FileCheck, Shield, ChevronDown, Filter, X, CheckCircle,
  Clock, Package, Eye, FolderDown, ShieldAlert,
  Hash, Euro, CheckSquare, Square, ArrowLeft
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// Types
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

interface CompanyData {
  fiscalName: string;
  taxId: string;
  address?: string;
  postalCode?: string;
  city?: string;
  province?: string;
}

const DOCUMENT_TYPES = {
  invoice: { code: "FAC", label: "Factura", icon: Receipt },
  proforma: { code: "PRF", label: "Proforma", icon: FileText },
  budget: { code: "PRS", label: "Presupuesto", icon: FileCheck },
  guarantee: { code: "FNZ", label: "Fianza", icon: Shield },
};

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "paid", label: "Pagadas" },
  { value: "pending", label: "Pendientes de pago" },
  { value: "pending_approval", label: "Pendientes de aprobación" },
];

const PAYMENT_METHODS: Record<string, string> = {
  transfer: "Transferencia bancaria",
  card: "Tarjeta",
  cash: "Efectivo",
  check: "Cheque",
  direct_debit: "Domiciliación",
};

function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

export default function DocumentCenterPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState("");
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("paid");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });

  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    filterInvoices();
  }, [searchTerm, statusFilter, typeFilter, dateRange, invoices]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setShowStatusDropdown(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      const companyDoc = await getDoc(doc(db, `projects/${id}/config`, "company"));
      if (companyDoc.exists()) setCompanyData(companyDoc.data() as CompanyData);

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

        const invoice: Invoice = {
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
        };

        invoicesData.push(invoice);
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
      filtered = filtered.filter(
        (inv) =>
          inv.number.toLowerCase().includes(s) ||
          inv.displayNumber.toLowerCase().includes(s) ||
          inv.supplier.toLowerCase().includes(s) ||
          inv.description.toLowerCase().includes(s) ||
          (inv.poNumber && inv.poNumber.toLowerCase().includes(s))
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((inv) => inv.status === statusFilter);
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter((inv) => inv.documentType === typeFilter);
    }

    if (dateRange.from) {
      const fromDate = new Date(dateRange.from);
      filtered = filtered.filter((inv) => inv.createdAt >= fromDate);
    }
    if (dateRange.to) {
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((inv) => inv.createdAt <= toDate);
    }

    setFilteredInvoices(filtered);
  };

  const toggleSelect = (invoiceId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(invoiceId)) {
      newSelected.delete(invoiceId);
    } else {
      newSelected.add(invoiceId);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
    }
  };

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;

  const formatCurrency = (amount: number, currency = "EUR") => {
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " " + symbol;
  };

  const formatDate = (date: Date) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

  const formatDateTime = (date: Date) =>
    date
      ? new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date)
      : "-";

  const getStatusLabel = () => {
    const opt = STATUS_OPTIONS.find((o) => o.value === statusFilter);
    return opt ? opt.label : "Todos";
  };

  // PDF Generation - Elegant & Minimal
  // Genera el banner de información del documento (21cm x 7cm en la parte superior)
  const generateDocInfoBanner = (invoice: Invoice): jsPDF => {
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const margin = 15;
    let y = 25;

    // Colors
    const primary: [number, number, number] = [47, 82, 224]; // Azul
    const dark: [number, number, number] = [15, 23, 42];
    const muted: [number, number, number] = [100, 116, 139];
    const green: [number, number, number] = [34, 197, 94];

    // === LADO IZQUIERDO: DOCUMENTO + NÚMERO (en cursiva negrita) ===
    pdf.setTextColor(...dark);
    pdf.setFontSize(32);
    pdf.setFont("helvetica", "bolditalic");
    pdf.text("DOCUMENTO", margin, y);
    
    pdf.setFontSize(38);
    pdf.setFont("helvetica", "bold");
    pdf.text(invoice.displayNumber, margin, y + 14);

    // === LADO DERECHO: INFO DEL DOCUMENTO ===
    const rightCol = 105;
    let yRight = y - 8;

    // Tipo de documento
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...muted);
    pdf.text("TIPO DE DOCUMENTO:", rightCol, yRight);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dark);
    pdf.text(DOCUMENT_TYPES[invoice.documentType].label.toUpperCase(), rightCol + 40, yRight);
    
    // Icono de pagada (cuadrado verde con símbolo $)
    if (invoice.status === "paid") {
      const iconX = rightCol + 58;
      const iconY = yRight - 3.5;
      pdf.setFillColor(...green);
      pdf.roundedRect(iconX, iconY, 5, 5, 0.8, 0.8, "F");
      pdf.setDrawColor(...green);
      pdf.setLineWidth(0.3);
      // Dibujar icono de factura/dinero simplificado
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(4);
      pdf.text("$=", iconX + 1, yRight - 0.5);
    }

    yRight += 6;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...muted);
    pdf.text("FECHA DOCUMENTO:", rightCol, yRight);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dark);
    pdf.text(invoice.invoiceDate ? formatDate(invoice.invoiceDate) : formatDate(invoice.createdAt), rightCol + 40, yRight);

    // N.º documento (más a la derecha)
    const farRight = pageWidth - margin;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...muted);
    pdf.text("N.º DOCUMENTO:", farRight - 25, yRight, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dark);
    pdf.text(invoice.supplierNumber || invoice.number || "-", farRight, yRight, { align: "right" });

    // === LÍNEA SEPARADORA ===
    y = 48;
    pdf.setDrawColor(...dark);
    pdf.setLineWidth(0.4);
    pdf.line(rightCol, y, pageWidth - margin, y);

    // === SECCIÓN CODIFICACIÓN ===
    y = 56;
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dark);
    pdf.text("CODIFICACIÓN", rightCol, y);

    y += 12;

    // Listar cada cuenta con su importe (agrupadas)
    if (invoice.items && invoice.items.length > 0) {
      // Agrupar por cuenta
      const accountTotals: Record<string, { code: string; description: string; amount: number }> = {};
      for (const item of invoice.items) {
        const code = item.subAccountCode || "SIN CUENTA";
        if (!accountTotals[code]) {
          accountTotals[code] = {
            code,
            description: item.subAccountDescription || item.description || "",
            amount: 0,
          };
        }
        accountTotals[code].amount += item.baseAmount || 0;
      }

      for (const account of Object.values(accountTotals)) {
        // Código en azul (grande y bold)
        pdf.setFontSize(16);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...primary);
        pdf.text(account.code, rightCol, y);

        // Descripción + importe en negro (mismo tamaño)
        pdf.setTextColor(...dark);
        const descText = account.description.toUpperCase().substring(0, 20);
        const amountText = formatCurrency(account.amount, invoice.currency);
        pdf.text(descText + " · " + amountText, rightCol + 28, y);

        y += 10;
        
        if (y > 90) break; // Límite de altura del banner (~7cm)
      }
    }

    // === FOOTER (parte inferior izquierda) ===
    const footerY = 100;
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...dark);
    pdf.text("FILMA", margin, footerY);
    
    pdf.setFontSize(9);
    pdf.setTextColor(...muted);
    pdf.text("·", margin + 14, footerY);
    
    pdf.setTextColor(...primary);
    pdf.setFont("helvetica", "bold");
    pdf.text("ACCOUNTING", margin + 18, footerY);
    
    pdf.setTextColor(...muted);
    pdf.text("·", margin + 42, footerY);
    
    pdf.setFont("helvetica", "normal");
    pdf.text("filmaworkspace.com", margin + 46, footerY);

    return pdf;
  };

  // Función para combinar el banner + factura original + comprobante de pago
  const generateFullDocument = async (invoice: Invoice): Promise<Uint8Array> => {
    // 1. Generar el banner como PDF
    const bannerPdf = generateDocInfoBanner(invoice);
    const bannerBytes = bannerPdf.output("arraybuffer");

    // Crear el documento final
    const finalPdf = await PDFDocument.create();

    // Añadir el banner
    const bannerDoc = await PDFDocument.load(bannerBytes);
    const [bannerPage] = await finalPdf.copyPages(bannerDoc, [0]);
    finalPdf.addPage(bannerPage);

    // 2. Añadir el PDF original de la factura si existe
    if (invoice.attachmentUrl) {
      try {
        const response = await fetch(invoice.attachmentUrl);
        const attachmentBytes = await response.arrayBuffer();
        
        // Intentar cargar como PDF
        try {
          const attachmentDoc = await PDFDocument.load(attachmentBytes);
          const pageCount = attachmentDoc.getPageCount();
          const pageIndices = Array.from({ length: pageCount }, (_, i) => i);
          const copiedPages = await finalPdf.copyPages(attachmentDoc, pageIndices);
          copiedPages.forEach((page) => finalPdf.addPage(page));
        } catch {
          // Si no es PDF (es imagen), crear una página con la imagen
          const imageBytes = new Uint8Array(attachmentBytes);
          let image;
          
          if (invoice.attachmentFileName?.toLowerCase().includes(".png")) {
            image = await finalPdf.embedPng(imageBytes);
          } else {
            image = await finalPdf.embedJpg(imageBytes);
          }
          
          const page = finalPdf.addPage([595.28, 841.89]); // A4
          const { width, height } = image.scale(1);
          const scale = Math.min(555 / width, 800 / height);
          page.drawImage(image, {
            x: 20,
            y: 841.89 - 20 - height * scale,
            width: width * scale,
            height: height * scale,
          });
        }
      } catch (error) {
        console.error("Error loading attachment:", error);
      }
    }

    // 3. Añadir el comprobante de pago si existe
    if (invoice.receiptUrl && invoice.status === "paid") {
      try {
        const response = await fetch(invoice.receiptUrl);
        const receiptBytes = await response.arrayBuffer();
        
        try {
          const receiptDoc = await PDFDocument.load(receiptBytes);
          const pageCount = receiptDoc.getPageCount();
          const pageIndices = Array.from({ length: pageCount }, (_, i) => i);
          const copiedPages = await finalPdf.copyPages(receiptDoc, pageIndices);
          copiedPages.forEach((page) => finalPdf.addPage(page));
        } catch {
          // Si no es PDF (es imagen)
          const imageBytes = new Uint8Array(receiptBytes);
          let image;
          
          if (invoice.receiptName?.toLowerCase().includes(".png")) {
            image = await finalPdf.embedPng(imageBytes);
          } else {
            image = await finalPdf.embedJpg(imageBytes);
          }
          
          const page = finalPdf.addPage([595.28, 841.89]); // A4
          const { width, height } = image.scale(1);
          const scale = Math.min(555 / width, 800 / height);
          page.drawImage(image, {
            x: 20,
            y: 841.89 - 20 - height * scale,
            width: width * scale,
            height: height * scale,
          });
        }
      } catch (error) {
        console.error("Error loading receipt:", error);
      }
    }

    return finalPdf.save();
  };

  // Mantener la función antigua para compatibilidad (genera solo la portada completa)
  const generateCoverPage = async (invoice: Invoice): Promise<jsPDF> => {
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const margin = 20;
    let y = margin;

    // Colors
    const primary: [number, number, number] = [47, 82, 224];
    const dark: [number, number, number] = [15, 23, 42];
    const muted: [number, number, number] = [100, 116, 139];
    const light: [number, number, number] = [241, 245, 249];

    // Header line
    pdf.setDrawColor(...primary);
    pdf.setLineWidth(0.8);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 15;

    // Document title
    pdf.setTextColor(...dark);
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");
    pdf.text("EXPEDIENTE", margin, y);
    
    pdf.setFontSize(14);
    pdf.setTextColor(...muted);
    pdf.setFont("helvetica", "normal");
    pdf.text(invoice.displayNumber, margin, y + 8);
    
    // Status badge
    if (invoice.status === "paid") {
      pdf.setFillColor(16, 185, 129);
      pdf.roundedRect(pageWidth - margin - 25, y - 8, 25, 8, 2, 2, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(8);
      pdf.text("PAGADA", pageWidth - margin - 22, y - 3);
    }

    y += 25;

    // Separator
    pdf.setDrawColor(...light);
    pdf.setLineWidth(0.3);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 15;

    // Two column layout for header info
    const col1 = margin;
    const col2 = pageWidth / 2 + 5;

    // Company info (left)
    if (companyData) {
      pdf.setTextColor(...muted);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("EMPRESA", col1, y);
      y += 5;
      pdf.setTextColor(...dark);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(companyData.fiscalName || "", col1, y);
      y += 4;
      pdf.setFontSize(9);
      pdf.setTextColor(...muted);
      pdf.text("CIF: " + (companyData.taxId || "-"), col1, y);
    }

    // Supplier info (right)
    let yRight = y - 9;
    pdf.setTextColor(...muted);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text("PROVEEDOR", col2, yRight);
    yRight += 5;
    pdf.setTextColor(...dark);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(invoice.supplier, col2, yRight);
    yRight += 4;
    pdf.setFontSize(9);
    pdf.setTextColor(...muted);
    pdf.text("NIF: " + (invoice.supplierTaxId || "-"), col2, yRight);

    y += 20;

    // Document details section
    pdf.setTextColor(...muted);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text("DETALLES DEL DOCUMENTO", margin, y);
    y += 8;

    const detailsData = [
      ["Tipo", DOCUMENT_TYPES[invoice.documentType].label],
      ["Descripción", invoice.description || "-"],
      ["Fecha emisión", invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "-"],
      ["Fecha vencimiento", formatDate(invoice.dueDate)],
      ["PO vinculada", invoice.poNumber ? "PO-" + invoice.poNumber : "-"],
    ];

    pdf.setFontSize(9);
    for (const [label, value] of detailsData) {
      pdf.setTextColor(...muted);
      pdf.setFont("helvetica", "normal");
      pdf.text(label, margin, y);
      pdf.setTextColor(...dark);
      pdf.setFont("helvetica", "bold");
      const valueStr = String(value).substring(0, 60);
      pdf.text(valueStr, margin + 45, y);
      y += 6;
    }

    y += 10;

    // Items table
    if (invoice.items && invoice.items.length > 0) {
      pdf.setTextColor(...muted);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("LÍNEAS DE DETALLE", margin, y);
      y += 8;

      // Table header
      pdf.setFillColor(...light);
      pdf.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
      pdf.setTextColor(...dark);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("CUENTA", margin + 2, y);
      pdf.text("DESCRIPCIÓN", margin + 30, y);
      pdf.text("BASE", pageWidth - margin - 40, y, { align: "right" });
      pdf.text("IVA", pageWidth - margin - 20, y, { align: "right" });
      pdf.text("TOTAL", pageWidth - margin - 2, y, { align: "right" });
      y += 8;

      // Table rows
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      for (const item of invoice.items) {
        pdf.setTextColor(...dark);
        pdf.text(item.subAccountCode || "-", margin + 2, y);
        const desc = (item.description || item.subAccountDescription || "-").substring(0, 35);
        pdf.text(desc, margin + 30, y);
        pdf.setTextColor(...muted);
        pdf.text(formatCurrency(item.baseAmount, invoice.currency), pageWidth - margin - 40, y, { align: "right" });
        pdf.text(item.vatRate + "%", pageWidth - margin - 20, y, { align: "right" });
        pdf.setTextColor(...dark);
        pdf.text(formatCurrency(item.totalAmount, invoice.currency), pageWidth - margin - 2, y, { align: "right" });
        y += 6;

        if (y > 250) {
          pdf.addPage();
          y = margin;
        }
      }

      y += 5;
    }

    // Totals section
    pdf.setDrawColor(...light);
    pdf.line(pageWidth - margin - 60, y, pageWidth - margin, y);
    y += 8;

    const totalsData = [
      ["Base imponible", formatCurrency(invoice.baseAmount, invoice.currency)],
      ["IVA", formatCurrency(invoice.vatAmount, invoice.currency)],
      ["IRPF", "-" + formatCurrency(invoice.irpfAmount, invoice.currency)],
    ];

    pdf.setFontSize(9);
    for (const [label, value] of totalsData) {
      pdf.setTextColor(...muted);
      pdf.setFont("helvetica", "normal");
      pdf.text(label, pageWidth - margin - 58, y);
      pdf.setTextColor(...dark);
      pdf.text(value, pageWidth - margin, y, { align: "right" });
      y += 6;
    }

    // Total highlight
    y += 2;
    pdf.setFillColor(...primary);
    pdf.roundedRect(pageWidth - margin - 60, y - 4, 60, 10, 2, 2, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    pdf.text("TOTAL", pageWidth - margin - 55, y + 2);
    pdf.text(formatCurrency(invoice.totalAmount, invoice.currency), pageWidth - margin - 3, y + 2, { align: "right" });

    y += 20;

    // Coding section
    if (invoice.codedAt) {
      pdf.setTextColor(...muted);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("CODIFICACIÓN CONTABLE", margin, y);
      y += 8;

      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...dark);
      pdf.text("Codificado por " + (invoice.codedByName || "-") + " el " + formatDateTime(invoice.codedAt), margin, y);
      y += 5;
      if (invoice.accountingEntry) {
        pdf.setTextColor(...muted);
        pdf.text("Asiento: " + invoice.accountingEntry, margin, y);
        y += 5;
      }

      // Account breakdown
      if (invoice.items && invoice.items.length > 0) {
        y += 3;
        for (const item of invoice.items) {
          if (item.subAccountCode) {
            pdf.setTextColor(...dark);
            pdf.text(item.subAccountCode + " - " + (item.subAccountDescription || "").substring(0, 40), margin + 5, y);
            pdf.text(formatCurrency(item.baseAmount, invoice.currency), pageWidth - margin, y, { align: "right" });
            y += 5;
          }
        }
      }
      y += 10;
    }

    // Payment section
    if (invoice.status === "paid" && invoice.paidAt) {
      pdf.setTextColor(...muted);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("INFORMACIÓN DE PAGO", margin, y);
      y += 8;

      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(16, 185, 129);
      pdf.text("Pagada el " + formatDateTime(invoice.paidAt), margin, y);
      y += 5;
      pdf.setTextColor(...dark);
      pdf.text("Método: " + (PAYMENT_METHODS[invoice.paymentMethod || ""] || invoice.paymentMethod || "-"), margin, y);
      y += 5;
      if (invoice.paymentReference) {
        pdf.setTextColor(...muted);
        pdf.text("Ref: " + invoice.paymentReference, margin, y);
        y += 5;
      }
      pdf.text("Importe: " + formatCurrency(invoice.paidAmount || invoice.totalAmount, invoice.currency), margin, y);
    }

    // Footer
    pdf.setTextColor(...muted);
    pdf.setFontSize(7);
    pdf.text(projectName + " - Generado el " + formatDateTime(new Date()), pageWidth / 2, 290, { align: "center" });

    return pdf;
  };

  const downloadSingleDocument = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      
      // Usar el nuevo formato con banner + factura + comprobante
      const pdfBytes = await generateFullDocument(invoice);
      
      // Descargar el PDF
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${invoice.displayNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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

      const selectedInvoices = filteredInvoices.filter((inv) => selectedIds.has(inv.id));

      for (let i = 0; i < selectedInvoices.length; i++) {
        const invoice = selectedInvoices[i];
        setDownloadProgress({ current: i + 1, total: selectedIds.size });

        const pdfBytes = await generateFullDocument(invoice);
        
        const blob = new Blob([pdfBytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${invoice.displayNumber}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        if (i < selectedInvoices.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error("Error downloading documents:", error);
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  const getStatusBadge = (status: InvoiceStatus) => {
    const configs: Record<InvoiceStatus, { bg: string; text: string; label: string }> = {
      pending_approval: { bg: "bg-amber-50", text: "text-amber-700", label: "Pte. aprobación" },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pte. pago" },
      paid: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Pagada" },
      overdue: { bg: "bg-red-50", text: "text-red-700", label: "Vencida" },
      cancelled: { bg: "bg-slate-100", text: "text-slate-600", label: "Cancelada" },
      rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
    };
    const config = configs[status];
    return (
      <span className={cx("inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium", config.bg, config.text)}>
        {config.label}
      </span>
    );
  };

  // Loading
  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Access denied
  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">No tienes permisos para acceder a esta sección</p>
          <Link
            href={"/project/" + id + "/accounting"}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: "#2F52E0" }}
          >
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          {/* Page header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <FolderDown size={24} className="text-blue-600" />
              <h1 className="text-2xl font-semibold text-slate-900">Centro de documentación</h1>
            </div>

            {selectedIds.size > 0 && (
              <button
                onClick={downloadSelectedDocuments}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#2F52E0" }}
              >
                {downloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {downloadProgress.current}/{downloadProgress.total}
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Descargar ({selectedIds.size})
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search size={18} className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, proveedor o descripción"
                className="w-full pl-11 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent bg-white text-sm"
              />
            </div>

            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors min-w-[180px]"
              >
                <Filter size={15} className="text-slate-400" />
                <span className="text-slate-700 flex-1 text-left">{getStatusLabel()}</span>
                <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showStatusDropdown && "rotate-180")} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setStatusFilter(option.value);
                        setShowStatusDropdown(false);
                      }}
                      className={cx(
                        "w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap",
                        statusFilter === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                  className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <span className="text-slate-400">—</span>
              <div className="relative">
                <Calendar size={15} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                  className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            {(statusFilter !== "all" || searchTerm || dateRange.from || dateRange.to) && (
              <button
                onClick={() => {
                  setStatusFilter("all");
                  setSearchTerm("");
                  setDateRange({ from: "", to: "" });
                }}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
              >
                <X size={14} />
                Limpiar
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
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={downloadSelectedDocuments}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-900 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                {downloading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-900 rounded-full animate-spin" />
                    Descargando {downloadProgress.current}/{downloadProgress.total}
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Descargar expedientes
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Documents List */}
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
                      {isAllSelected ? (
                        <CheckSquare size={18} className="text-slate-700" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
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
                {filteredInvoices.map((invoice) => {
                  const docConfig = DOCUMENT_TYPES[invoice.documentType];
                  const DocIcon = docConfig.icon;
                  const isSelected = selectedIds.has(invoice.id);

                  return (
                    <tr
                      key={invoice.id}
                      className={cx("hover:bg-slate-50 transition-colors", isSelected && "bg-blue-50")}
                    >
                      <td className="px-4 py-4">
                        <button
                          onClick={() => toggleSelect(invoice.id)}
                          className="p-1 hover:bg-slate-200 rounded transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare size={18} className="text-blue-600" />
                          ) : (
                            <Square size={18} className="text-slate-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-100">
                            <DocIcon size={18} className="text-slate-500" />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{invoice.displayNumber}</p>
                            <p className="text-xs text-slate-500">{formatDate(invoice.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-900">{invoice.supplier}</p>
                        {invoice.supplierTaxId && <p className="text-xs text-slate-500">{invoice.supplierTaxId}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">{formatCurrency(invoice.totalAmount, invoice.currency)}</p>
                      </td>
                      <td className="px-4 py-4">{getStatusBadge(invoice.status)}</td>
                      <td className="px-4 py-4">
                        {invoice.codedAt ? (
                          <div className="flex items-center gap-2">
                            <CheckCircle size={14} className="text-emerald-500" />
                            <div>
                              <p className="text-xs text-slate-700">{invoice.codedByName}</p>
                              <p className="text-xs text-slate-500">{formatDate(invoice.codedAt)}</p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Sin codificar</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setPreviewInvoice(invoice)}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            title="Vista previa"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => downloadSingleDocument(invoice)}
                            disabled={downloading}
                            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            title="Descargar expediente"
                          >
                            <Download size={16} />
                          </button>
                          {invoice.attachmentUrl && (
                            <a
                              href={invoice.attachmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Ver documento original"
                            >
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
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewInvoice(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
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
              <button
                onClick={() => setPreviewInvoice(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Proveedor</h4>
                <p className="font-medium text-slate-900">{previewInvoice.supplier}</p>
                {previewInvoice.supplierTaxId && <p className="text-sm text-slate-500">NIF/CIF: {previewInvoice.supplierTaxId}</p>}
              </div>

              {previewInvoice.items && previewInvoice.items.length > 0 && (
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
                          <span className="font-medium text-slate-900">{formatCurrency(item.baseAmount, previewInvoice.currency)}</span>
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
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Base imponible</span>
                    <span className="text-slate-900">{formatCurrency(previewInvoice.baseAmount, previewInvoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">IVA</span>
                    <span className="text-slate-900">{formatCurrency(previewInvoice.vatAmount, previewInvoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">IRPF</span>
                    <span className="text-slate-900">-{formatCurrency(previewInvoice.irpfAmount, previewInvoice.currency)}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between">
                    <span className="font-semibold text-slate-900">Total</span>
                    <span className="font-bold text-slate-900">{formatCurrency(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                  </div>
                </div>
              </div>

              {previewInvoice.codedAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Codificación contable</h4>
                  <div className="bg-emerald-50 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle size={16} className="text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-800">Codificada</span>
                    </div>
                    <p className="text-sm text-emerald-700">Por {previewInvoice.codedByName} el {formatDateTime(previewInvoice.codedAt)}</p>
                    {previewInvoice.accountingEntry && (
                      <p className="text-sm text-emerald-700">Asiento: {previewInvoice.accountingEntry}</p>
                    )}
                  </div>
                </div>
              )}

              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Información de pago</h4>
                  <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                    <p className="text-sm text-blue-700">
                      {PAYMENT_METHODS[previewInvoice.paymentMethod || ""] || previewInvoice.paymentMethod} - {formatDateTime(previewInvoice.paidAt)}
                    </p>
                    {previewInvoice.paymentReference && (
                      <p className="text-sm text-blue-700">Ref: {previewInvoice.paymentReference}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setPreviewInvoice(null)}
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors"
              >
                Cerrar
              </button>
              <button
                onClick={() => {
                  downloadSingleDocument(previewInvoice);
                  setPreviewInvoice(null);
                }}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}
              >
                <Download size={16} />
                Descargar expediente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
