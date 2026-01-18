"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText,
  Download,
  Search,
  Calendar,
  Receipt,
  FileCheck,
  Shield,
  ChevronDown,
  Filter,
  X,
  CheckCircle,
  Clock,
  Loader2,
  Eye,
  FolderDown,
  ShieldAlert,
  CreditCard,
  Euro,
  CheckSquare,
  Square,
  Settings,
  ToggleLeft,
  ToggleRight,
  Type,
  Layers,
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { jsPDF } from "jspdf";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

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

interface PaymentRecord {
  id: string;
  forecastId: string;
  forecastName: string;
  amount: number;
  paidAt: Date;
  paidByName: string;
  receiptUrl?: string;
  receiptName?: string;
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

interface ExportConfig {
  filenameTemplate: string;
  showHeader: boolean;
  showCompanyInfo: boolean;
  showSupplierInfo: boolean;
  showDocumentData: boolean;
  showAmounts: boolean;
  showCoding: boolean;
  showPaymentInfo: boolean;
  showAccountBreakdown: boolean;
  showPaymentBreakdown: boolean;
  showFooter: boolean;
  customTitle: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DOCUMENT_TYPES = {
  invoice: { code: "FAC", label: "Factura", icon: Receipt, color: "emerald" },
  proforma: { code: "PRF", label: "Proforma", icon: FileText, color: "violet" },
  budget: { code: "PRS", label: "Presupuesto", icon: FileCheck, color: "amber" },
  guarantee: { code: "FNZ", label: "Fianza", icon: Shield, color: "slate" },
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

const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  filenameTemplate: "{tipo}_{numero}_{proveedor}",
  showHeader: true,
  showCompanyInfo: true,
  showSupplierInfo: true,
  showDocumentData: true,
  showAmounts: true,
  showCoding: true,
  showPaymentInfo: true,
  showAccountBreakdown: true,
  showPaymentBreakdown: true,
  showFooter: true,
  customTitle: "EXPEDIENTE DE DOCUMENTO",
};

const FILENAME_VARIABLES = [
  { key: "{numero}", label: "Número documento", example: "FAC-00001" },
  { key: "{tipo}", label: "Tipo documento", example: "FAC" },
  { key: "{proveedor}", label: "Nombre proveedor", example: "Proveedor SL" },
  { key: "{nif}", label: "NIF proveedor", example: "B12345678" },
  { key: "{fecha}", label: "Fecha documento", example: "2026-01-15" },
  { key: "{importe}", label: "Importe total", example: "1500.00" },
  { key: "{po}", label: "Número PO", example: "PO-00012" },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;

  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------

  const [projectName, setProjectName] = useState("");
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Record<string, PaymentRecord[]>>({});

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("paid");
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Selección y descarga
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });

  // Preview y configuración
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [exportConfig, setExportConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);

  // --------------------------------------------------------------------------
  // EFFECTS
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) {
      loadData();
    }
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    filterInvoices();
  }, [searchTerm, statusFilter, dateRange, invoices]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(e.target as HTMLElement)) {
        setShowStatusDropdown(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const savedConfig = localStorage.getItem(`exportConfig_${id}`);
    if (savedConfig) {
      try {
        setExportConfig({ ...DEFAULT_EXPORT_CONFIG, ...JSON.parse(savedConfig) });
      } catch (e) {
        console.error("Error loading saved config:", e);
      }
    }
  }, [id]);

  // --------------------------------------------------------------------------
  // DATA LOADING
  // --------------------------------------------------------------------------

  const loadData = async () => {
    try {
      setLoading(true);

      // Cargar proyecto
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
      }

      // Cargar datos de empresa
      const companyDoc = await getDoc(doc(db, `projects/${id}/config`, "company"));
      if (companyDoc.exists()) {
        setCompanyData(companyDoc.data() as CompanyData);
      }

      // Cargar facturas
      const invoicesSnapshot = await getDocs(
        query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc"))
      );

      const invoicesData: Invoice[] = [];
      const paymentsData: Record<string, PaymentRecord[]> = {};

      for (const docSnap of invoicesSnapshot.docs) {
        const data = docSnap.data();

        // Verificar permisos
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
          poId: data.poId,
          poNumber: data.poNumber,
        };

        invoicesData.push(invoice);

        // Cargar pagos si está pagada
        if (data.status === "paid") {
          const paymentsSnap = await getDocs(
            collection(db, `projects/${id}/invoices/${docSnap.id}/payments`)
          );
          if (!paymentsSnap.empty) {
            paymentsData[docSnap.id] = paymentsSnap.docs.map((p) => ({
              id: p.id,
              forecastId: p.data().forecastId,
              forecastName: p.data().forecastName,
              amount: p.data().amount,
              paidAt: p.data().paidAt?.toDate(),
              paidByName: p.data().paidByName,
              receiptUrl: p.data().receiptUrl,
              receiptName: p.data().receiptName,
            }));
          }
        }
      }

      setInvoices(invoicesData);
      setPayments(paymentsData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // CONFIG FUNCTIONS
  // --------------------------------------------------------------------------

  const saveConfig = () => {
    localStorage.setItem(`exportConfig_${id}`, JSON.stringify(exportConfig));
    setShowConfigPanel(false);
  };

  const resetConfig = () => {
    setExportConfig(DEFAULT_EXPORT_CONFIG);
    localStorage.removeItem(`exportConfig_${id}`);
  };

  const updateConfig = (key: keyof ExportConfig, value: boolean | string) => {
    setExportConfig((prev) => ({ ...prev, [key]: value }));
  };

  // --------------------------------------------------------------------------
  // FILTERING
  // --------------------------------------------------------------------------

  const filterInvoices = () => {
    let filtered = [...invoices];

    // Búsqueda
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

    // Estado
    if (statusFilter !== "all") {
      filtered = filtered.filter((inv) => inv.status === statusFilter);
    }

    // Rango de fechas
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

  // --------------------------------------------------------------------------
  // SELECTION
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // FORMATTING
  // --------------------------------------------------------------------------

  const formatCurrency = (amount: number, currency = "EUR") => {
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
    return `${new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${symbol}`;
  };

  const formatDate = (date: Date) => {
    return date
      ? new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date)
      : "-";
  };

  const formatDateISO = (date: Date) => {
    return date ? date.toISOString().split("T")[0] : "";
  };

  const formatDateTime = (date: Date) => {
    return date
      ? new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date)
      : "-";
  };

  const getStatusLabel = () => {
    const opt = STATUS_OPTIONS.find((o) => o.value === statusFilter);
    return opt ? opt.label : "Todos";
  };

  const sanitizeFilename = (str: string) => {
    return str.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\-_]/g, "_").substring(0, 50);
  };

  const generateFilename = (invoice: Invoice) => {
    const docType = DOCUMENT_TYPES[invoice.documentType];
    let filename = exportConfig.filenameTemplate;

    filename = filename
      .replace("{numero}", invoice.displayNumber)
      .replace("{tipo}", docType.code)
      .replace("{proveedor}", sanitizeFilename(invoice.supplier))
      .replace("{nif}", invoice.supplierTaxId || "SIN-NIF")
      .replace("{fecha}", formatDateISO(invoice.invoiceDate || invoice.createdAt))
      .replace("{importe}", invoice.totalAmount.toFixed(2))
      .replace("{po}", invoice.poNumber ? `PO-${invoice.poNumber}` : "SIN-PO");

    return sanitizeFilename(filename) + ".pdf";
  };

  // --------------------------------------------------------------------------
  // PDF GENERATION
  // --------------------------------------------------------------------------

  const generateCoverPage = async (invoice: Invoice): Promise<jsPDF> => {
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    let y = margin;

    // Colores
    const primaryColor: [number, number, number] = [47, 82, 224];
    const textDark: [number, number, number] = [30, 41, 59];
    const textMuted: [number, number, number] = [100, 116, 139];
    const borderColor: [number, number, number] = [226, 232, 240];

    // Header
    if (exportConfig.showHeader) {
      pdf.setFillColor(...primaryColor);
      pdf.rect(0, 0, pageWidth, 45, "F");

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.text(exportConfig.customTitle || "EXPEDIENTE DE DOCUMENTO", margin, 28);

      pdf.setFontSize(14);
      pdf.setFont("helvetica", "normal");
      pdf.text(invoice.displayNumber, pageWidth - margin, 28, { align: "right" });

      y = 60;
    }

    // Información de la empresa
    if (exportConfig.showCompanyInfo && companyData) {
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 35, 3, 3, "F");

      pdf.setTextColor(...textDark);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text("EMPRESA", margin + 5, y + 8);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(companyData.fiscalName || "", margin + 5, y + 16);

      pdf.setFontSize(9);
      pdf.setTextColor(...textMuted);
      pdf.text(`CIF: ${companyData.taxId || "-"}`, margin + 5, y + 23);

      if (companyData.address) {
        pdf.text(
          `${companyData.address}, ${companyData.postalCode || ""} ${companyData.city || ""}`,
          margin + 5,
          y + 29
        );
      }

      y += 45;
    }

    // Información del proveedor
    if (exportConfig.showSupplierInfo) {
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 35, 3, 3, "F");

      pdf.setTextColor(...textDark);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text("PROVEEDOR", margin + 5, y + 8);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.text(invoice.supplier, margin + 5, y + 16);

      pdf.setFontSize(9);
      pdf.setTextColor(...textMuted);
      pdf.text(`NIF/CIF: ${invoice.supplierTaxId || "-"}`, margin + 5, y + 23);

      if (invoice.supplierNumber) {
        pdf.text(`Nº Factura proveedor: ${invoice.supplierNumber}`, margin + 5, y + 29);
      }

      y += 45;
    }

    // Datos del documento
    if (exportConfig.showDocumentData) {
      pdf.setTextColor(...textDark);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("DATOS DEL DOCUMENTO", margin, y);
      y += 8;

      pdf.setDrawColor(...borderColor);
      pdf.setLineWidth(0.5);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      const docTypeConfig = DOCUMENT_TYPES[invoice.documentType];
      const dataRows = [
        ["Tipo de documento", `${docTypeConfig.label} (${docTypeConfig.code})`],
        ["Número interno", invoice.displayNumber],
        ["Descripción", invoice.description || "-"],
        ["Fecha de emisión", invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "-"],
        ["Fecha de vencimiento", formatDate(invoice.dueDate)],
        ["PO vinculada", invoice.poNumber ? `PO-${invoice.poNumber}` : "-"],
      ];

      pdf.setFontSize(10);
      for (const [label, value] of dataRows) {
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...textMuted);
        pdf.text(label, margin, y);

        pdf.setTextColor(...textDark);
        pdf.setFont("helvetica", "bold");
        pdf.text(String(value), margin + 55, y);
        y += 7;
      }

      y += 10;
    }

    // Importes
    if (exportConfig.showAmounts) {
      pdf.setTextColor(...textDark);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("IMPORTES", margin, y);
      y += 8;

      pdf.setDrawColor(...borderColor);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      const amountRows = [
        ["Base imponible", formatCurrency(invoice.baseAmount, invoice.currency)],
        ["IVA", formatCurrency(invoice.vatAmount, invoice.currency)],
        ["IRPF", `-${formatCurrency(invoice.irpfAmount, invoice.currency)}`],
      ];

      pdf.setFontSize(10);
      for (const [label, value] of amountRows) {
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...textMuted);
        pdf.text(label, margin, y);

        pdf.setTextColor(...textDark);
        pdf.text(value, pageWidth - margin, y, { align: "right" });
        y += 7;
      }

      // Total destacado
      y += 3;
      pdf.setFillColor(...primaryColor);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 12, 2, 2, "F");

      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text("TOTAL", margin + 5, y + 8);
      pdf.text(formatCurrency(invoice.totalAmount, invoice.currency), pageWidth - margin - 5, y + 8, {
        align: "right",
      });

      y += 25;
    }

    // Codificación contable
    if (exportConfig.showCoding && invoice.codedAt) {
      pdf.setTextColor(...textDark);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("CODIFICACIÓN CONTABLE", margin, y);
      y += 8;

      pdf.setDrawColor(...borderColor);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      pdf.setFontSize(10);
      const codingRows = [
        ["Codificado por", invoice.codedByName || "-"],
        ["Fecha de codificación", formatDateTime(invoice.codedAt)],
        ["Asiento contable", invoice.accountingEntry || "-"],
      ];

      for (const [label, value] of codingRows) {
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...textMuted);
        pdf.text(label, margin, y);

        pdf.setTextColor(...textDark);
        pdf.setFont("helvetica", "bold");
        pdf.text(String(value), margin + 55, y);
        y += 7;
      }

      // Desglose de cuentas
      if (exportConfig.showAccountBreakdown && invoice.items && invoice.items.length > 0) {
        y += 5;
        pdf.setFontSize(9);
        pdf.setTextColor(...textMuted);
        pdf.text("Imputación a cuentas:", margin, y);
        y += 6;

        for (const item of invoice.items) {
          if (item.subAccountCode) {
            pdf.setTextColor(...textDark);
            pdf.text(`${item.subAccountCode} - ${item.subAccountDescription}`, margin + 5, y);
            pdf.text(formatCurrency(item.baseAmount, invoice.currency), pageWidth - margin, y, {
              align: "right",
            });
            y += 5;
          }
        }
      }

      y += 10;
    }

    // Información de pago
    if (exportConfig.showPaymentInfo && invoice.status === "paid" && invoice.paidAt) {
      pdf.setTextColor(...textDark);
      pdf.setFontSize(12);
      pdf.setFont("helvetica", "bold");
      pdf.text("INFORMACIÓN DE PAGO", margin, y);
      y += 8;

      pdf.setDrawColor(...borderColor);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 10;

      pdf.setFontSize(10);
      const paymentRows = [
        ["Estado", "PAGADA"],
        ["Fecha de pago", formatDateTime(invoice.paidAt)],
        ["Método de pago", PAYMENT_METHODS[invoice.paymentMethod || ""] || invoice.paymentMethod || "-"],
        ["Referencia", invoice.paymentReference || "-"],
        ["Importe pagado", formatCurrency(invoice.paidAmount || invoice.totalAmount, invoice.currency)],
        ["Pagado por", invoice.paidByName || "-"],
      ];

      for (const [label, value] of paymentRows) {
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...textMuted);
        pdf.text(label, margin, y);

        pdf.setTextColor(...textDark);
        pdf.setFont("helvetica", "bold");

        if (label === "Estado") {
          pdf.setTextColor(16, 185, 129);
        }

        pdf.text(String(value), margin + 55, y);
        y += 7;
      }

      // Desglose de pagos
      const invoicePayments = payments[invoice.id];
      if (exportConfig.showPaymentBreakdown && invoicePayments && invoicePayments.length > 0) {
        y += 5;
        pdf.setFontSize(9);
        pdf.setTextColor(...textMuted);
        pdf.text("Desglose de pagos:", margin, y);
        y += 6;

        for (const payment of invoicePayments) {
          pdf.setTextColor(...textDark);
          pdf.text(`${payment.forecastName} - ${formatDateTime(payment.paidAt)}`, margin + 5, y);
          pdf.text(formatCurrency(payment.amount, invoice.currency), pageWidth - margin, y, {
            align: "right",
          });
          y += 5;
        }
      }
    }

    // Footer
    if (exportConfig.showFooter) {
      pdf.setFontSize(8);
      pdf.setTextColor(...textMuted);
      pdf.text(
        `Generado el ${formatDateTime(new Date())} - ${projectName}`,
        pageWidth / 2,
        pageHeight - 15,
        { align: "center" }
      );
    }

    return pdf;
  };

  // --------------------------------------------------------------------------
  // DOWNLOAD FUNCTIONS
  // --------------------------------------------------------------------------

  const downloadSingleDocument = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      const pdf = await generateCoverPage(invoice);
      pdf.save(generateFilename(invoice));
    } catch (error) {
      console.error("Error generating document:", error);
      alert("Error al generar el documento");
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

        const pdf = await generateCoverPage(invoice);
        pdf.save(generateFilename(invoice));

        // Pequeña pausa entre descargas
        if (i < selectedInvoices.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error("Error downloading documents:", error);
      alert("Error al descargar los documentos");
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  // --------------------------------------------------------------------------
  // RENDER HELPERS
  // --------------------------------------------------------------------------

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
      <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${config.bg} ${config.text}`}>
        {config.label}
      </span>
    );
  };

  const ToggleSwitch = ({
    enabled,
    onChange,
    label,
  }: {
    enabled: boolean;
    onChange: () => void;
    label: string;
  }) => (
    <button
      onClick={onChange}
      className={`flex items-center justify-between w-full p-3 rounded-xl border transition-colors ${
        enabled ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <span className={`text-sm ${enabled ? "text-blue-900 font-medium" : "text-slate-700"}`}>
        {label}
      </span>
      {enabled ? (
        <ToggleRight size={22} className="text-blue-600" />
      ) : (
        <ToggleLeft size={22} className="text-slate-400" />
      )}
    </button>
  );

  // --------------------------------------------------------------------------
  // LOADING & ERROR STATES
  // --------------------------------------------------------------------------

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">No tienes permisos para acceder a esta sección.</p>
          <Link
            href={`/project/${id}/accounting`}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#2F52E0" }}
          >
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // MAIN RENDER
  // --------------------------------------------------------------------------

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <main className="pt-24 pb-12 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <FolderDown size={24} style={{ color: "#2F52E0" }} />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Centro de documentación</h1>
            </div>
          </div>
          <button
            onClick={() => setShowConfigPanel(true)}
            className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white hover:bg-slate-50 transition-colors"
          >
            <Settings size={16} />
            Configurar exportación
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Search */}
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

            {/* Status Dropdown */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors min-w-[180px]"
              >
                <Filter size={15} className="text-slate-400" />
                <span className="text-slate-700 flex-1 text-left">{getStatusLabel()}</span>
                <ChevronDown
                  size={14}
                  className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`}
                />
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
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        statusFilter === option.value
                          ? "bg-slate-100 text-slate-900 font-medium"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date Range */}
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

            {/* Clear Filters */}
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

        {/* Selection Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={20} />
              <span className="font-medium">
                {selectedIds.size} documento{selectedIds.size > 1 ? "s" : ""} seleccionado
                {selectedIds.size > 1 ? "s" : ""}
              </span>
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
                    <Loader2 size={16} className="animate-spin" />
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No se encontraron documentos</h3>
            <p className="text-slate-500 text-sm">Ajusta los filtros para encontrar los documentos que buscas</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <button
                      onClick={toggleSelectAll}
                      className="p-1 hover:bg-slate-200 rounded transition-colors"
                    >
                      {isAllSelected ? (
                        <CheckSquare size={18} className="text-slate-700" />
                      ) : (
                        <Square size={18} className="text-slate-400" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Documento
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Proveedor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Importe
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Codificación
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Acciones
                  </th>
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
                      className={`hover:bg-slate-50 transition-colors ${isSelected ? "bg-blue-50" : ""}`}
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
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-${docConfig.color}-50`}>
                            <DocIcon size={18} className={`text-${docConfig.color}-600`} />
                          </div>
                          <div>
                            <p className="font-medium text-slate-900 text-sm">{invoice.displayNumber}</p>
                            <p className="text-xs text-slate-500">{formatDate(invoice.createdAt)}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-900">{invoice.supplier}</p>
                        {invoice.supplierTaxId && (
                          <p className="text-xs text-slate-500">{invoice.supplierTaxId}</p>
                        )}
                      </td>

                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">
                          {formatCurrency(invoice.totalAmount, invoice.currency)}
                        </p>
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
                        <div className="flex items-center justify-end gap-2">
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

        {/* Results Count */}
        {filteredInvoices.length > 0 && (
          <div className="mt-4 text-sm text-slate-500 text-center">
            Mostrando {filteredInvoices.length} de {invoices.length} documentos
          </div>
        )}
      </main>

      {/* Config Panel Modal */}
      {showConfigPanel && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowConfigPanel(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <Settings size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Configurar exportación</h3>
                  <p className="text-xs text-slate-500">Personaliza el nombre y contenido del PDF</p>
                </div>
              </div>
              <button
                onClick={() => setShowConfigPanel(false)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Filename Template */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Type size={16} className="text-slate-500" />
                  <h4 className="font-semibold text-slate-900">Nombre del archivo</h4>
                </div>
                <input
                  type="text"
                  value={exportConfig.filenameTemplate}
                  onChange={(e) => updateConfig("filenameTemplate", e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  placeholder="{tipo}_{numero}_{proveedor}"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {FILENAME_VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => updateConfig("filenameTemplate", exportConfig.filenameTemplate + v.key)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-mono text-slate-700 transition-colors"
                      title={v.example}
                    >
                      {v.key}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Vista previa:{" "}
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">
                    {exportConfig.filenameTemplate
                      .replace("{tipo}", "FAC")
                      .replace("{numero}", "FAC-00001")
                      .replace("{proveedor}", "Proveedor_SL")
                      .replace("{nif}", "B12345678")
                      .replace("{fecha}", "2026-01-15")
                      .replace("{importe}", "1500.00")
                      .replace("{po}", "PO-00012")}
                    .pdf
                  </span>
                </p>
              </div>

              {/* Custom Title */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Type size={16} className="text-slate-500" />
                  <h4 className="font-semibold text-slate-900">Título del documento</h4>
                </div>
                <input
                  type="text"
                  value={exportConfig.customTitle}
                  onChange={(e) => updateConfig("customTitle", e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="EXPEDIENTE DE DOCUMENTO"
                />
              </div>

              {/* PDF Sections */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Layers size={16} className="text-slate-500" />
                  <h4 className="font-semibold text-slate-900">Secciones del PDF</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ToggleSwitch
                    enabled={exportConfig.showHeader}
                    onChange={() => updateConfig("showHeader", !exportConfig.showHeader)}
                    label="Encabezado con título"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showCompanyInfo}
                    onChange={() => updateConfig("showCompanyInfo", !exportConfig.showCompanyInfo)}
                    label="Información de empresa"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showSupplierInfo}
                    onChange={() => updateConfig("showSupplierInfo", !exportConfig.showSupplierInfo)}
                    label="Información del proveedor"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showDocumentData}
                    onChange={() => updateConfig("showDocumentData", !exportConfig.showDocumentData)}
                    label="Datos del documento"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showAmounts}
                    onChange={() => updateConfig("showAmounts", !exportConfig.showAmounts)}
                    label="Importes (base, IVA, total)"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showCoding}
                    onChange={() => updateConfig("showCoding", !exportConfig.showCoding)}
                    label="Codificación contable"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showAccountBreakdown}
                    onChange={() => updateConfig("showAccountBreakdown", !exportConfig.showAccountBreakdown)}
                    label="Desglose por cuentas"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showPaymentInfo}
                    onChange={() => updateConfig("showPaymentInfo", !exportConfig.showPaymentInfo)}
                    label="Información de pago"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showPaymentBreakdown}
                    onChange={() => updateConfig("showPaymentBreakdown", !exportConfig.showPaymentBreakdown)}
                    label="Desglose de pagos"
                  />
                  <ToggleSwitch
                    enabled={exportConfig.showFooter}
                    onChange={() => updateConfig("showFooter", !exportConfig.showFooter)}
                    label="Pie de página"
                  />
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
              <button
                onClick={resetConfig}
                className="px-4 py-2.5 text-slate-600 hover:text-slate-900 text-sm font-medium transition-colors"
              >
                Restaurar valores
              </button>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfigPanel(false)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveConfig}
                  className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <CheckCircle size={16} />
                  Guardar configuración
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            {/* Preview Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <FileText size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{previewInvoice.displayNumber}</h3>
                  <p className="text-xs text-slate-500">Vista previa del expediente</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewInvoice(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Proveedor */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Proveedor
                </h4>
                <p className="font-medium text-slate-900">{previewInvoice.supplier}</p>
                {previewInvoice.supplierTaxId && (
                  <p className="text-sm text-slate-500">NIF/CIF: {previewInvoice.supplierTaxId}</p>
                )}
              </div>

              {/* Importes */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Importes
                </h4>
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Base imponible</span>
                    <span className="text-slate-900">
                      {formatCurrency(previewInvoice.baseAmount, previewInvoice.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">IVA</span>
                    <span className="text-slate-900">
                      {formatCurrency(previewInvoice.vatAmount, previewInvoice.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">IRPF</span>
                    <span className="text-slate-900">
                      -{formatCurrency(previewInvoice.irpfAmount, previewInvoice.currency)}
                    </span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between">
                    <span className="font-semibold text-slate-900">Total</span>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(previewInvoice.totalAmount, previewInvoice.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Codificación */}
              {previewInvoice.codedAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Codificación contable
                  </h4>
                  <div className="bg-emerald-50 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle size={16} className="text-emerald-600" />
                      <span className="text-sm font-medium text-emerald-800">Codificada</span>
                    </div>
                    <p className="text-sm text-emerald-700">
                      Por {previewInvoice.codedByName} el {formatDateTime(previewInvoice.codedAt)}
                    </p>
                    {previewInvoice.accountingEntry && (
                      <p className="text-sm text-emerald-700">Asiento: {previewInvoice.accountingEntry}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Pago */}
              {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Información de pago
                  </h4>
                  <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <CreditCard size={16} className="text-blue-600" />
                      <span className="text-sm font-medium text-blue-800">Pagada</span>
                    </div>
                    <p className="text-sm text-blue-700">
                      {PAYMENT_METHODS[previewInvoice.paymentMethod || ""] || previewInvoice.paymentMethod} -{" "}
                      {formatDateTime(previewInvoice.paidAt)}
                    </p>
                    {previewInvoice.paymentReference && (
                      <p className="text-sm text-blue-700">Ref: {previewInvoice.paymentReference}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Cuentas */}
              {previewInvoice.items && previewInvoice.items.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Imputación a cuentas
                  </h4>
                  <div className="space-y-2">
                    {previewInvoice.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center p-3 bg-slate-50 rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.subAccountCode}</p>
                          <p className="text-xs text-slate-500">{item.subAccountDescription}</p>
                        </div>
                        <span className="font-medium text-slate-900">
                          {formatCurrency(item.baseAmount, previewInvoice.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center">
              <p className="text-xs text-slate-500">
                Se guardará como:{" "}
                <span className="font-mono bg-slate-200 px-2 py-0.5 rounded">
                  {generateFilename(previewInvoice)}
                </span>
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setPreviewInvoice(null)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-100 text-sm font-medium transition-colors"
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
        </div>
      )}
    </div>
  );
}
