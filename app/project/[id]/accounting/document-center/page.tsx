"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText,
  Download,
  Search,
  Receipt,
  FileCheck,
  Shield,
  ChevronDown,
  Filter,
  X,
  CheckCircle,
  Eye,
  FolderDown,
  ShieldAlert,
  CreditCard,
  CheckSquare,
  Square,
  Settings,
  Type,
  Layers,
  MoreVertical,
  Clock,
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { jsPDF } from "jspdf";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ============================================================================
// TYPES
// ============================================================================

type DocumentType = "invoice" | "proforma" | "budget" | "guarantee";

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
  items: any[];
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  currency: string;
  status: string;
  dueDate: Date;
  invoiceDate?: Date;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  attachmentUrl?: string;
  codedAt?: Date;
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

interface ExportConfig {
  filenameTemplate: string;
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
  const router = useRouter();
  const id = params?.id as string;

  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  // State - exactamente como invoices-page
  const [projectName, setProjectName] = useState("");
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Record<string, PaymentRecord[]>>({});

  // Filtros
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Selección y descarga
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });

  // Preview y config
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [exportConfig, setExportConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);
  const [downloadMenuId, setDownloadMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  // ============================================================================
  // EFFECTS - exactamente como invoices-page
  // ============================================================================

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    filterInvoices();
  }, [searchTerm, statusFilter, invoices]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setShowStatusDropdown(false);
      }
      if (!target.closest(".download-menu")) {
        setDownloadMenuId(null);
        setMenuPosition(null);
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
        console.error("Error loading config:", e);
      }
    }
  }, [id]);

  // ============================================================================
  // DATA LOADING - COPIADO EXACTAMENTE DE INVOICES-PAGE
  // ============================================================================

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Cargar proyecto
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      // Cargar empresa
      const companyDoc = await getDoc(doc(db, `projects/${id}/config`, "company"));
      if (companyDoc.exists()) setCompanyData(companyDoc.data() as CompanyData);

      // CARGAR FACTURAS - EXACTAMENTE IGUAL QUE INVOICES-PAGE
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const allInvoices = invoicesSnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          documentType: data.documentType || "invoice",
          displayNumber: data.displayNumber || `FAC-${data.number}`,
          createdAt: data.createdAt?.toDate() || new Date(),
          dueDate: data.dueDate?.toDate() || new Date(),
          invoiceDate: data.invoiceDate?.toDate(),
          codedAt: data.codedAt?.toDate(),
          paidAt: data.paidAt?.toDate(),
        };
      }) as Invoice[];

      // FILTRAR POR PERMISOS - EXACTAMENTE IGUAL QUE INVOICES-PAGE
      const invoicesData = allInvoices.filter((inv) => {
        if (permissions.canViewAllPOs) return true;
        if (permissions.canViewDepartmentPOs && inv.department === permissions.department) return true;
        if (permissions.canViewOwnPOs && inv.createdBy === permissions.userId) return true;
        return false;
      });

      // Cargar pagos
      const paymentsData: Record<string, PaymentRecord[]> = {};
      for (const invoice of invoicesData) {
        if (invoice.status === "paid") {
          const paymentsSnap = await getDocs(collection(db, `projects/${id}/invoices/${invoice.id}/payments`));
          if (!paymentsSnap.empty) {
            paymentsData[invoice.id] = paymentsSnap.docs.map((p) => ({
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
      setFilteredInvoices(invoicesData);
      setPayments(paymentsData);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // FILTERING
  // ============================================================================

  const filterInvoices = () => {
    let filtered = [...invoices];
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (inv) =>
          inv.number?.toLowerCase().includes(s) ||
          inv.displayNumber?.toLowerCase().includes(s) ||
          inv.supplier?.toLowerCase().includes(s) ||
          inv.description?.toLowerCase().includes(s) ||
          (inv.poNumber && inv.poNumber.toLowerCase().includes(s))
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((inv) => inv.status === statusFilter);
    }
    setFilteredInvoices(filtered);
  };

  // ============================================================================
  // SELECTION
  // ============================================================================

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredInvoices.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredInvoices.map((inv) => inv.id)));
  };

  const isAllSelected = filteredInvoices.length > 0 && selectedIds.size === filteredInvoices.length;

  // ============================================================================
  // FORMATTING
  // ============================================================================

  const formatCurrency = (amount: number, currency = "EUR") => {
    const symbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "€";
    return `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)} ${symbol}`;
  };

  const formatDate = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";
  const formatDateISO = (date: Date) => date ? date.toISOString().split("T")[0] : "";
  const formatDateTime = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";
  
  const getStatusLabel = () => STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || "Todos";
  const sanitizeFilename = (str: string) => str.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\-_]/g, "_").substring(0, 50);

  const generateFilename = (invoice: Invoice) => {
    const docType = DOCUMENT_TYPES[invoice.documentType] || DOCUMENT_TYPES.invoice;
    let filename = exportConfig.filenameTemplate;
    filename = filename
      .replace("{numero}", invoice.displayNumber || "")
      .replace("{tipo}", docType.code)
      .replace("{proveedor}", sanitizeFilename(invoice.supplier || ""))
      .replace("{nif}", invoice.supplierTaxId || "SIN-NIF")
      .replace("{fecha}", formatDateISO(invoice.invoiceDate || invoice.createdAt))
      .replace("{importe}", (invoice.totalAmount || 0).toFixed(2))
      .replace("{po}", invoice.poNumber ? `PO-${invoice.poNumber}` : "SIN-PO");
    return sanitizeFilename(filename) + ".pdf";
  };

  // ============================================================================
  // CONFIG
  // ============================================================================

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

  // ============================================================================
  // PDF GENERATION - Diseño compacto tipo banner/certificado
  // ============================================================================

  const generateCoverPage = async (invoice: Invoice): Promise<jsPDF> => {
    // Formato horizontal, medio folio aproximadamente
    const pdf = new jsPDF("l", "mm", [210, 148]);
    const pageWidth = 210;
    const pageHeight = 148;
    const margin = 12;

    // Colores
    const brandBlue: [number, number, number] = [47, 82, 224];
    const darkText: [number, number, number] = [15, 23, 42];
    const mutedText: [number, number, number] = [100, 116, 139];
    const lightBg: [number, number, number] = [248, 250, 252];
    const successGreen: [number, number, number] = [16, 185, 129];
    const codingPurple: [number, number, number] = [139, 92, 246];

    // === HEADER con logo y número de documento ===
    // Línea superior decorativa
    pdf.setFillColor(...brandBlue);
    pdf.rect(0, 0, pageWidth, 3, "F");

    // Logo FILMA estilizado
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(22);
    pdf.setTextColor(...brandBlue);
    pdf.text("filma", margin, 17);

    // Número de documento destacado (derecha)
    const docType = DOCUMENT_TYPES[invoice.documentType] || DOCUMENT_TYPES.invoice;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(...darkText);
    pdf.text(invoice.displayNumber || "", pageWidth - margin, 14, { align: "right" });

    // Tipo de documento
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...mutedText);
    pdf.text(docType.label.toUpperCase(), pageWidth - margin, 20, { align: "right" });

    // === LÍNEA SEPARADORA ===
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(margin, 28, pageWidth - margin, 28);

    // === SECCIÓN PRINCIPAL: 3 columnas ===
    const colWidth = (pageWidth - margin * 2 - 16) / 3;
    const col1X = margin;
    const col2X = margin + colWidth + 8;
    const col3X = margin + (colWidth + 8) * 2;
    let y = 35;

    // --- COLUMNA 1: Proveedor ---
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6);
    pdf.setTextColor(...mutedText);
    pdf.text("PROVEEDOR", col1X, y);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(...darkText);
    const supplierName = (invoice.supplier || "").substring(0, 25);
    pdf.text(supplierName, col1X, y + 6);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...mutedText);
    pdf.text(invoice.supplierTaxId || "-", col1X, y + 12);

    // --- COLUMNA 2: Datos documento ---
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6);
    pdf.setTextColor(...mutedText);
    pdf.text("DOCUMENTO", col2X, y);

    pdf.setFontSize(8);
    pdf.setTextColor(...darkText);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Emisión: ${invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "-"}`, col2X, y + 6);
    pdf.text(`Vencimiento: ${formatDate(invoice.dueDate)}`, col2X, y + 12);
    if (invoice.poNumber) {
      pdf.text(`PO: ${invoice.poNumber}`, col2X, y + 18);
    }

    // --- COLUMNA 3: Importe total destacado ---
    pdf.setFillColor(...lightBg);
    pdf.roundedRect(col3X - 2, y - 4, colWidth + 4, 24, 2, 2, "F");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6);
    pdf.setTextColor(...mutedText);
    pdf.text("IMPORTE TOTAL", col3X, y);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.setTextColor(...brandBlue);
    pdf.text(formatCurrency(invoice.totalAmount || 0, invoice.currency), col3X, y + 10);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...mutedText);
    pdf.text(`Base: ${formatCurrency(invoice.baseAmount || 0, invoice.currency)}  IVA: ${formatCurrency(invoice.vatAmount || 0, invoice.currency)}`, col3X, y + 16);

    // === SECCIÓN DE CODIFICACIÓN (destacada) ===
    y = 68;

    if (invoice.codedAt) {
      // Calcular altura necesaria para la caja de codificación
      const itemsWithAccounts = invoice.items?.filter(item => item.subAccountCode) || [];
      const hasAccountBreakdown = itemsWithAccounts.length > 0;
      const boxHeight = hasAccountBreakdown ? 32 + (itemsWithAccounts.length * 6) + 10 : 32;

      // Caja de codificación con borde
      pdf.setFillColor(250, 245, 255); // Fondo violeta muy claro
      pdf.setDrawColor(...codingPurple);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, Math.min(boxHeight, 60), 3, 3, "FD");

      // Icono check (simulado con texto)
      pdf.setFillColor(...codingPurple);
      pdf.circle(margin + 8, y + 10, 4, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text("✓", margin + 6, y + 12);

      // Título
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(...codingPurple);
      pdf.text("CODIFICACIÓN CONTABLE", margin + 18, y + 8);

      // Estado
      pdf.setFillColor(...codingPurple);
      pdf.roundedRect(margin + 18, y + 11, 22, 6, 1, 1, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(6);
      pdf.setTextColor(255, 255, 255);
      pdf.text("VALIDADO", margin + 20, y + 15);

      // Detalles de codificación
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...darkText);
      pdf.text(`Por: ${invoice.codedByName || "-"}`, margin + 18, y + 24);
      pdf.text(`Fecha: ${formatDateTime(invoice.codedAt)}`, margin + 80, y + 24);
      if (invoice.accountingEntry) {
        pdf.text(`Asiento: ${invoice.accountingEntry}`, margin + 140, y + 24);
      }

      // Desglose de cuentas con importes (TABLA)
      if (hasAccountBreakdown) {
        let accountY = y + 32;
        pdf.setFontSize(7);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(...codingPurple);
        pdf.text("IMPUTACIÓN A CUENTAS:", margin + 18, accountY);
        
        accountY += 5;
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(...darkText);
        
        for (const item of itemsWithAccounts.slice(0, 4)) { // Máximo 4 líneas
          const accountText = `${item.subAccountCode} - ${(item.subAccountDescription || "").substring(0, 40)}`;
          const amountText = formatCurrency(item.baseAmount || 0, invoice.currency);
          pdf.text(accountText, margin + 18, accountY);
          pdf.text(amountText, pageWidth - margin - 5, accountY, { align: "right" });
          accountY += 5;
        }
        
        if (itemsWithAccounts.length > 4) {
          pdf.setFontSize(6);
          pdf.setTextColor(...mutedText);
          pdf.text(`... y ${itemsWithAccounts.length - 4} cuenta(s) más`, margin + 18, accountY);
        }
      }

      y += Math.min(boxHeight, 60) + 6;
    } else {
      // Sin codificar
      pdf.setFillColor(254, 249, 195); // Amarillo claro
      pdf.setDrawColor(234, 179, 8);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 18, 3, 3, "FD");

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(161, 98, 7);
      pdf.text("⚠ PENDIENTE DE CODIFICACIÓN CONTABLE", margin + 8, y + 11);

      y += 24;
    }

    // === SECCIÓN DE PAGO (si aplica) ===
    if (invoice.status === "paid" && invoice.paidAt) {
      pdf.setFillColor(236, 253, 245); // Verde claro
      pdf.setDrawColor(...successGreen);
      pdf.setLineWidth(0.5);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 20, 3, 3, "FD");

      // Check de pagado
      pdf.setFillColor(...successGreen);
      pdf.circle(margin + 8, y + 10, 4, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text("✓", margin + 6, y + 12);

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(...successGreen);
      pdf.text("PAGADO", margin + 18, y + 8);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(...darkText);
      const paymentMethod = PAYMENT_METHODS[invoice.paymentMethod || ""] || invoice.paymentMethod || "-";
      pdf.text(`${formatDateTime(invoice.paidAt)} · ${paymentMethod}`, margin + 18, y + 15);

      if (invoice.paymentReference) {
        pdf.setTextColor(...mutedText);
        pdf.text(`Ref: ${invoice.paymentReference}`, margin + 120, y + 15);
      }

      y += 26;
    }

    // === FOOTER ===
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.3);
    pdf.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.setTextColor(...mutedText);
    
    // Izquierda: fecha de generación
    pdf.text(`${formatDateTime(new Date())}`, margin, pageHeight - 7);
    
    // Centro: Generado por filmaworkspace.com
    pdf.text("Generado por filmaworkspace.com", pageWidth / 2, pageHeight - 7, { align: "center" });
    
    // Derecha: nombre del proyecto
    pdf.text(projectName || "", pageWidth - margin, pageHeight - 7, { align: "right" });

    return pdf;
  };

  // ============================================================================
  // DOWNLOAD - Expediente completo (banner + factura + justificantes)
  // ============================================================================

  // Función para convertir URL a base64 (maneja Firebase Storage y CORS)
  const urlToBase64 = async (url: string): Promise<string | null> => {
    try {
      // Intentar fetch directo
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error("Error fetching image:", error);
      return null;
    }
  };

  // Función para añadir imagen al PDF
  const addImageToPdf = async (pdf: jsPDF, imageUrl: string, pageTitle: string): Promise<boolean> => {
    try {
      const base64 = await urlToBase64(imageUrl);
      if (!base64) {
        // Si no se puede cargar la imagen, añadir placeholder
        addPdfPlaceholder(pdf, pageTitle, imageUrl);
        return true;
      }

      // Añadir nueva página A4 vertical
      pdf.addPage([210, 297], "p");
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 15;

      // Header de la página
      pdf.setFillColor(248, 250, 252);
      pdf.rect(0, 0, pageWidth, 25, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.setTextColor(100, 116, 139);
      pdf.text(pageTitle, margin, 16);

      // Línea decorativa
      pdf.setDrawColor(47, 82, 224);
      pdf.setLineWidth(0.5);
      pdf.line(margin, 22, pageWidth - margin, 22);

      // Determinar formato de imagen
      const isPng = base64.includes("image/png");
      const isJpg = base64.includes("image/jpeg") || base64.includes("image/jpg");
      const isGif = base64.includes("image/gif");
      const isWebp = base64.includes("image/webp");
      
      if (isPng || isJpg || isGif || isWebp) {
        const format = isPng ? "PNG" : isGif ? "GIF" : isWebp ? "WEBP" : "JPEG";
        // Calcular dimensiones manteniendo aspect ratio
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - 45; // Espacio para header y footer
        
        try {
          // Añadir imagen
          pdf.addImage(base64, format, margin, 30, maxWidth, maxHeight, undefined, "FAST");
        } catch (imgError) {
          console.error("Error adding image to PDF:", imgError);
          // Si falla, añadir texto indicando el error
          pdf.setFontSize(10);
          pdf.setTextColor(150, 150, 150);
          pdf.text("No se pudo renderizar la imagen", pageWidth / 2, pageHeight / 2, { align: "center" });
          pdf.setFontSize(8);
          pdf.text(imageUrl.substring(0, 80), pageWidth / 2, pageHeight / 2 + 10, { align: "center" });
        }
      }

      return true;
    } catch (error) {
      console.error("Error adding image:", error);
      addPdfPlaceholder(pdf, pageTitle, imageUrl);
      return true;
    }
  };

  // Función para añadir página de PDF externo (solo muestra info si no puede embeber)
  const addPdfPlaceholder = (pdf: jsPDF, title: string, url: string) => {
    pdf.addPage([210, 297], "p");
    const pageWidth = 210;
    const margin = 15;

    // Header
    pdf.setFillColor(248, 250, 252);
    pdf.rect(0, 0, pageWidth, 20, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(100, 116, 139);
    pdf.text(title, margin, 13);

    // Línea decorativa
    pdf.setDrawColor(47, 82, 224);
    pdf.setLineWidth(0.5);
    pdf.line(margin, 18, pageWidth - margin, 18);

    // Mensaje
    pdf.setFillColor(254, 249, 195);
    pdf.roundedRect(margin, 50, pageWidth - margin * 2, 40, 3, 3, "F");
    
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(161, 98, 7);
    pdf.text("Documento adjunto disponible", pageWidth / 2, 65, { align: "center" });
    
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(120, 80, 20);
    pdf.text("Este documento está disponible en el siguiente enlace:", pageWidth / 2, 75, { align: "center" });
    
    pdf.setTextColor(47, 82, 224);
    pdf.setFontSize(8);
    const shortUrl = url.length > 70 ? url.substring(0, 70) + "..." : url;
    pdf.text(shortUrl, pageWidth / 2, 83, { align: "center" });
  };

  // Descargar solo el banner
  const downloadBannerOnly = async (invoice: Invoice) => {
    try {
      setDownloading(true);
      const pdf = await generateCoverPage(invoice);
      pdf.save(generateFilename(invoice).replace(".pdf", "_banner.pdf"));
    } catch (error) {
      console.error("Error:", error);
      alert("Error al generar el documento");
    } finally {
      setDownloading(false);
    }
  };

  // Descargar expediente completo (banner + factura + justificantes)
  const downloadFullExpediente = async (invoice: Invoice) => {
    try {
      setDownloading(true);

      // 1. Generar banner (primera página)
      const pdf = await generateCoverPage(invoice);

      // 2. Añadir factura adjunta si existe
      if (invoice.attachmentUrl) {
        const url = invoice.attachmentUrl.toLowerCase();
        const isImage = url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || 
                        url.includes('.gif') || url.includes('.webp') || url.includes('image/');
        const isPdf = url.includes('.pdf') || url.includes('application/pdf');

        const pageTitle = `FACTURA ORIGINAL - ${invoice.displayNumber}`;

        if (isImage) {
          await addImageToPdf(pdf, invoice.attachmentUrl, pageTitle);
        } else if (isPdf) {
          addPdfPlaceholder(pdf, pageTitle, invoice.attachmentUrl);
        } else {
          // Tipo desconocido, intentar como imagen primero
          await addImageToPdf(pdf, invoice.attachmentUrl, pageTitle);
        }
      } else {
        // No hay adjunto, añadir página indicándolo
        pdf.addPage([210, 297], "p");
        const pageWidth = 210;
        const margin = 15;

        pdf.setFillColor(248, 250, 252);
        pdf.rect(0, 0, pageWidth, 25, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`FACTURA ORIGINAL - ${invoice.displayNumber}`, margin, 16);

        pdf.setDrawColor(47, 82, 224);
        pdf.setLineWidth(0.5);
        pdf.line(margin, 22, pageWidth - margin, 22);

        pdf.setFillColor(254, 243, 199);
        pdf.roundedRect(margin, 100, pageWidth - margin * 2, 50, 3, 3, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.setTextColor(146, 64, 14);
        pdf.text("Sin documento adjunto", pageWidth / 2, 125, { align: "center" });
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text("Esta factura no tiene un documento adjunto en el sistema", pageWidth / 2, 135, { align: "center" });
      }

      // 3. Añadir justificantes de pago si existen
      const invoicePayments = payments[invoice.id] || [];
      
      if (invoicePayments.length > 0) {
        for (const payment of invoicePayments) {
          const pageTitle = `JUSTIFICANTE DE PAGO - ${payment.forecastName} - ${formatCurrency(payment.amount, invoice.currency)}`;

          if (payment.receiptUrl) {
            const url = payment.receiptUrl.toLowerCase();
            const isImage = url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || 
                            url.includes('.gif') || url.includes('.webp') || url.includes('image/');
            const isPdf = url.includes('.pdf') || url.includes('application/pdf');

            if (isImage) {
              await addImageToPdf(pdf, payment.receiptUrl, pageTitle);
            } else if (isPdf) {
              addPdfPlaceholder(pdf, pageTitle, payment.receiptUrl);
            } else {
              await addImageToPdf(pdf, payment.receiptUrl, pageTitle);
            }
          } else {
            // Pago sin justificante
            pdf.addPage([210, 297], "p");
            const pageWidth = 210;
            const margin = 15;

            pdf.setFillColor(248, 250, 252);
            pdf.rect(0, 0, pageWidth, 25, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(10);
            pdf.setTextColor(100, 116, 139);
            pdf.text(pageTitle, margin, 16);

            pdf.setDrawColor(47, 82, 224);
            pdf.setLineWidth(0.5);
            pdf.line(margin, 22, pageWidth - margin, 22);

            // Info del pago
            pdf.setFillColor(236, 253, 245);
            pdf.roundedRect(margin, 50, pageWidth - margin * 2, 60, 3, 3, "F");
            
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(14);
            pdf.setTextColor(6, 95, 70);
            pdf.text("PAGO REGISTRADO", pageWidth / 2, 70, { align: "center" });
            
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            pdf.setTextColor(30, 41, 59);
            pdf.text(`Importe: ${formatCurrency(payment.amount, invoice.currency)}`, pageWidth / 2, 85, { align: "center" });
            pdf.text(`Fecha: ${formatDateTime(payment.paidAt)}`, pageWidth / 2, 93, { align: "center" });
            pdf.text(`Realizado por: ${payment.paidByName}`, pageWidth / 2, 101, { align: "center" });

            pdf.setFillColor(254, 243, 199);
            pdf.roundedRect(margin, 130, pageWidth - margin * 2, 30, 3, 3, "F");
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(9);
            pdf.setTextColor(146, 64, 14);
            pdf.text("Sin justificante adjunto en el sistema", pageWidth / 2, 148, { align: "center" });
          }
        }
      } else if (invoice.status === "paid") {
        // Factura pagada pero sin registros de pago detallados
        pdf.addPage([210, 297], "p");
        const pageWidth = 210;
        const margin = 15;

        pdf.setFillColor(248, 250, 252);
        pdf.rect(0, 0, pageWidth, 25, "F");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.setTextColor(100, 116, 139);
        pdf.text("JUSTIFICANTE DE PAGO", margin, 16);

        pdf.setDrawColor(47, 82, 224);
        pdf.setLineWidth(0.5);
        pdf.line(margin, 22, pageWidth - margin, 22);

        pdf.setFillColor(236, 253, 245);
        pdf.roundedRect(margin, 50, pageWidth - margin * 2, 50, 3, 3, "F");
        
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(14);
        pdf.setTextColor(6, 95, 70);
        pdf.text("FACTURA PAGADA", pageWidth / 2, 70, { align: "center" });
        
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(30, 41, 59);
        pdf.text(`Importe: ${formatCurrency(invoice.paidAmount || invoice.totalAmount, invoice.currency)}`, pageWidth / 2, 85, { align: "center" });
        if (invoice.paidAt) {
          pdf.text(`Fecha: ${formatDateTime(invoice.paidAt)}`, pageWidth / 2, 93, { align: "center" });
        }
      }

      pdf.save(generateFilename(invoice));
    } catch (error) {
      console.error("Error:", error);
      alert("Error al generar el expediente completo");
    } finally {
      setDownloading(false);
    }
  };

  // Descargar seleccionados (expediente completo)
  const downloadSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      setDownloading(true);
      setDownloadProgress({ current: 0, total: selectedIds.size });
      const selected = filteredInvoices.filter((inv) => selectedIds.has(inv.id));
      for (let i = 0; i < selected.length; i++) {
        setDownloadProgress({ current: i + 1, total: selectedIds.size });
        await downloadFullExpediente(selected[i]);
        if (i < selected.length - 1) await new Promise((r) => setTimeout(r, 800));
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Error al descargar");
    } finally {
      setDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const getStatusBadge = (status: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      pending_approval: { bg: "bg-amber-50", text: "text-amber-700", label: "Pte. aprobación" },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pte. pago" },
      paid: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Pagada" },
      overdue: { bg: "bg-red-50", text: "text-red-700", label: "Vencida" },
      cancelled: { bg: "bg-slate-100", text: "text-slate-600", label: "Cancelada" },
      rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
    };
    const c = configs[status] || configs.pending;
    return <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  // ============================================================================
  // LOADING / ERROR
  // ============================================================================

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

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <main className="pt-24 pb-12 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <FolderDown size={24} style={{ color: "#2F52E0" }} />
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Centro de documentación</h1>
              <p className="text-sm text-slate-500">Descarga expedientes con portada de codificación y justificantes</p>
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
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-full">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => { setStatusFilter(opt.value); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${statusFilter === opt.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(statusFilter !== "all" || searchTerm) && (
              <button
                onClick={() => { setStatusFilter("all"); setSearchTerm(""); }}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2"
              >
                <X size={14} />
                Limpiar
              </button>
            )}
          </div>
        </div>

        {/* Selection Bar */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white rounded-2xl p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CheckSquare size={20} />
              <span className="font-medium">{selectedIds.size} documento{selectedIds.size > 1 ? "s" : ""} seleccionado{selectedIds.size > 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedIds(new Set())} className="px-4 py-2 text-sm text-slate-300 hover:text-white">Cancelar</button>
              <button
                onClick={downloadSelected}
                disabled={downloading}
                className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-900 rounded-xl text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
              >
                {downloading ? `Descargando ${downloadProgress.current}/${downloadProgress.total}` : <><Download size={16} />Descargar expedientes</>}
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
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No se encontraron documentos</h3>
            <p className="text-slate-500 text-sm">Ajusta los filtros para encontrar los documentos que buscas</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <button onClick={toggleSelectAll} className="p-1 hover:bg-slate-200 rounded">
                        {isAllSelected ? <CheckSquare size={18} className="text-slate-700" /> : <Square size={18} className="text-slate-400" />}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Documento</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Proveedor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Importe</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase">Codificación</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((invoice) => {
                    const docConfig = DOCUMENT_TYPES[invoice.documentType] || DOCUMENT_TYPES.invoice;
                    const DocIcon = docConfig.icon;
                    const isSelected = selectedIds.has(invoice.id);
                    return (
                      <tr key={invoice.id} className={`hover:bg-slate-50 ${isSelected ? "bg-blue-50" : ""}`}>
                        <td className="px-4 py-4">
                          <button onClick={() => toggleSelect(invoice.id)} className="p-1 hover:bg-slate-200 rounded">
                            {isSelected ? <CheckSquare size={18} className="text-blue-600" /> : <Square size={18} className="text-slate-400" />}
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
                          <button onClick={() => setPreviewInvoice(invoice)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg" title="Vista previa">
                            <Eye size={16} />
                          </button>
                          
                          {/* Menú de descarga */}
                          <div className="relative download-menu">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                if (downloadMenuId === invoice.id) {
                                  setDownloadMenuId(null);
                                  setMenuPosition(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ 
                                    top: rect.bottom + 4, 
                                    left: rect.right - 224 // 224 = ancho del menú (w-56 = 14rem = 224px)
                                  });
                                  setDownloadMenuId(invoice.id);
                                }
                              }} 
                              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                              title="Descargar"
                            >
                              <Download size={16} />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        )}

        {filteredInvoices.length > 0 && (
          <div className="mt-4 text-sm text-slate-500 text-center">
            Mostrando {filteredInvoices.length} de {invoices.length} documentos
          </div>
        )}
      </main>

      {/* Floating Download Menu */}
      {downloadMenuId && menuPosition && (
        <div 
          className="fixed w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] py-1 download-menu"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          {(() => {
            const invoice = filteredInvoices.find(inv => inv.id === downloadMenuId);
            if (!invoice) return null;
            return (
              <>
                <button
                  onClick={() => {
                    downloadFullExpediente(invoice);
                    setDownloadMenuId(null);
                    setMenuPosition(null);
                  }}
                  disabled={downloading}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 disabled:opacity-50"
                >
                  <Layers size={15} className="text-blue-500" />
                  <div>
                    <p className="font-medium">Expediente completo</p>
                    <p className="text-xs text-slate-500">Banner + Factura + Justificantes</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    downloadBannerOnly(invoice);
                    setDownloadMenuId(null);
                    setMenuPosition(null);
                  }}
                  disabled={downloading}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 disabled:opacity-50"
                >
                  <FileText size={15} className="text-slate-400" />
                  <div>
                    <p className="font-medium">Solo banner</p>
                    <p className="text-xs text-slate-500">Portada de codificación</p>
                  </div>
                </button>
                {invoice.attachmentUrl && (
                  <>
                    <div className="border-t border-slate-100 my-1" />
                    <a
                      href={invoice.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => { setDownloadMenuId(null); setMenuPosition(null); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                    >
                      <Eye size={15} className="text-slate-400" />
                      <span>Ver factura original</span>
                    </a>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Config Modal */}
      {showConfigPanel && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfigPanel(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#2F52E0" }}>
                  <Settings size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Configurar exportación</h3>
                  <p className="text-xs text-slate-500">Personaliza el nombre del archivo</p>
                </div>
              </div>
              <button onClick={() => setShowConfigPanel(false)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Type size={16} className="text-slate-500" />
                <h4 className="font-semibold text-slate-900">Nombre del archivo</h4>
              </div>
              <input
                type="text"
                value={exportConfig.filenameTemplate}
                onChange={(e) => updateConfig("filenameTemplate", e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {FILENAME_VARIABLES.map((v) => (
                  <button key={v.key} onClick={() => updateConfig("filenameTemplate", exportConfig.filenameTemplate + v.key)} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-mono text-slate-700" title={v.example}>
                    {v.key}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Vista previa: <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">{exportConfig.filenameTemplate.replace("{tipo}", "FAC").replace("{numero}", "FAC-00001").replace("{proveedor}", "Proveedor_SL").replace("{nif}", "B12345678").replace("{fecha}", "2026-01-15").replace("{importe}", "1500.00").replace("{po}", "PO-00012")}.pdf</span>
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={resetConfig} className="px-4 py-2.5 text-slate-600 hover:text-slate-900 text-sm font-medium">Restaurar</button>
              <button onClick={saveConfig} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "#2F52E0" }}>
                <CheckCircle size={16} />
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal - Wider */}
      {previewInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setPreviewInvoice(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#2F52E0" }}>
                  <FileText size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{previewInvoice.displayNumber}</h3>
                  <p className="text-xs text-slate-500">Vista previa del expediente · {previewInvoice.supplier}</p>
                </div>
              </div>
              <button onClick={() => setPreviewInvoice(null)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {/* Grid layout for better space usage */}
              <div className="grid grid-cols-2 gap-6">
                {/* Left column */}
                <div className="space-y-4">
                  {/* Proveedor */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Proveedor</h4>
                    <p className="font-medium text-slate-900 text-lg">{previewInvoice.supplier}</p>
                    {previewInvoice.supplierTaxId && <p className="text-sm text-slate-600 font-mono mt-1">{previewInvoice.supplierTaxId}</p>}
                  </div>

                  {/* Datos del documento */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Datos del documento</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Tipo</span>
                        <span className="font-medium">{DOCUMENT_TYPES[previewInvoice.documentType]?.label || "Factura"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Número interno</span>
                        <span className="font-medium font-mono">{previewInvoice.displayNumber}</span>
                      </div>
                      {previewInvoice.supplierNumber && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Nº Proveedor</span>
                          <span className="font-medium font-mono">{previewInvoice.supplierNumber}</span>
                        </div>
                      )}
                      {previewInvoice.invoiceDate && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">Fecha emisión</span>
                          <span className="font-medium">{formatDate(previewInvoice.invoiceDate)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-500">Vencimiento</span>
                        <span className="font-medium">{formatDate(previewInvoice.dueDate)}</span>
                      </div>
                      {previewInvoice.poNumber && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">PO vinculada</span>
                          <span className="font-medium font-mono">PO-{previewInvoice.poNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Descripción */}
                  {previewInvoice.description && (
                    <div className="bg-slate-50 rounded-xl p-4">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Descripción</h4>
                      <p className="text-sm text-slate-700">{previewInvoice.description}</p>
                    </div>
                  )}
                </div>

                {/* Right column */}
                <div className="space-y-4">
                  {/* Importes */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-3">Importes</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Base imponible</span>
                        <span className="font-medium">{formatCurrency(previewInvoice.baseAmount, previewInvoice.currency)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">IVA</span>
                        <span className="font-medium text-emerald-600">+{formatCurrency(previewInvoice.vatAmount, previewInvoice.currency)}</span>
                      </div>
                      {previewInvoice.irpfAmount > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">IRPF</span>
                          <span className="font-medium text-red-600">-{formatCurrency(previewInvoice.irpfAmount, previewInvoice.currency)}</span>
                        </div>
                      )}
                      <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between">
                        <span className="font-semibold text-slate-900">Total</span>
                        <span className="font-bold text-lg text-slate-900">{formatCurrency(previewInvoice.totalAmount, previewInvoice.currency)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Codificación */}
                  {previewInvoice.codedAt ? (
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle size={16} className="text-violet-600" />
                        <span className="text-sm font-semibold text-violet-800">Codificada</span>
                      </div>
                      <p className="text-sm text-violet-700">Por {previewInvoice.codedByName}</p>
                      <p className="text-xs text-violet-600 mt-1">{formatDateTime(previewInvoice.codedAt)}</p>
                      {previewInvoice.items?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-violet-200">
                          <p className="text-xs text-violet-600 mb-1">Cuentas imputadas:</p>
                          <div className="flex flex-wrap gap-1">
                            {previewInvoice.items.filter(i => i.subAccountCode).map((item, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-xs font-mono">
                                {item.subAccountCode}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="flex items-center gap-2">
                        <Clock size={16} className="text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">Pendiente de codificación</span>
                      </div>
                    </div>
                  )}

                  {/* Estado de pago */}
                  {previewInvoice.status === "paid" && previewInvoice.paidAt && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CreditCard size={16} className="text-emerald-600" />
                        <span className="text-sm font-semibold text-emerald-800">Pagada</span>
                      </div>
                      <p className="text-sm text-emerald-700">
                        {PAYMENT_METHODS[previewInvoice.paymentMethod || ""] || previewInvoice.paymentMethod || "Sin especificar"}
                      </p>
                      <p className="text-xs text-emerald-600 mt-1">{formatDateTime(previewInvoice.paidAt)}</p>
                      {payments[previewInvoice.id]?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-emerald-200">
                          <p className="text-xs text-emerald-600 mb-2">{payments[previewInvoice.id].length} pago(s) registrado(s)</p>
                          {payments[previewInvoice.id].map((p, idx) => (
                            <div key={idx} className="flex justify-between items-center text-xs py-1">
                              <span className="text-emerald-700">{p.forecastName}</span>
                              <span className="font-medium text-emerald-800">{formatCurrency(p.amount, previewInvoice.currency)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Adjuntos info */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Archivos del expediente</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Factura original</span>
                        {previewInvoice.attachmentUrl ? (
                          <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={12} />Disponible</span>
                        ) : (
                          <span className="text-slate-400">No adjunta</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Justificantes de pago</span>
                        <span className={payments[previewInvoice.id]?.filter(p => p.receiptUrl).length > 0 ? "text-emerald-600" : "text-slate-400"}>
                          {payments[previewInvoice.id]?.filter(p => p.receiptUrl).length || 0} archivo(s)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
              <p className="text-xs text-slate-500">
                Archivo: <span className="font-mono bg-white px-2 py-0.5 rounded border border-slate-200">{generateFilename(previewInvoice)}</span>
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPreviewInvoice(null)} className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium">
                  Cerrar
                </button>
                <button 
                  onClick={() => { downloadBannerOnly(previewInvoice); setPreviewInvoice(null); }} 
                  disabled={downloading} 
                  className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl hover:bg-slate-100 text-sm font-medium disabled:opacity-50"
                >
                  <FileText size={16} />
                  Solo banner
                </button>
                <button 
                  onClick={() => { downloadFullExpediente(previewInvoice); setPreviewInvoice(null); }} 
                  disabled={downloading} 
                  className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50" 
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <Layers size={16} />
                  Expediente completo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
