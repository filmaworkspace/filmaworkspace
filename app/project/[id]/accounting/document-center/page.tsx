"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { 
  FolderOpen, FileText, Download, ChevronRight, ArrowLeft,
  Building2, Receipt, ShoppingCart, Search, File, CheckCircle,
  Clock, XCircle, CreditCard, Ban, Loader2, Archive,
  Calendar, Hash, ShieldAlert
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";
import jsPDF from "jspdf";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type FolderType = "root" | "suppliers" | "pos" | "invoices";

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  createdAt: Date;
}

interface PO {
  id: string;
  number: string;
  displayNumber: string;
  supplier: string;
  supplierId: string;
  description: string;
  baseAmount: number;
  totalAmount: number;
  status: string;
  createdAt: Date;
  approvedAt?: Date;
  attachmentUrl?: string;
  attachmentFileName?: string;
}

interface Invoice {
  id: string;
  number: string;
  displayNumber: string;
  documentType: string;
  supplier: string;
  supplierId: string;
  supplierNumber?: string;
  description: string;
  baseAmount: number;
  totalAmount: number;
  status: string;
  createdAt: Date;
  invoiceDate?: Date;
  paidAt?: Date;
  attachmentUrl?: string;
  attachmentFileName?: string;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  draft: { label: "Borrador", bg: "bg-slate-100", text: "text-slate-600", icon: File },
  pending: { label: "Pendiente", bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  approved: { label: "Aprobada", bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle },
  rejected: { label: "Rechazada", bg: "bg-red-50", text: "text-red-700", icon: XCircle },
  cancelled: { label: "Anulada", bg: "bg-red-50", text: "text-red-600", icon: Ban },
  closed: { label: "Cerrada", bg: "bg-slate-100", text: "text-slate-600", icon: Archive },
  coding: { label: "Codificando", bg: "bg-violet-50", text: "text-violet-700", icon: FileText },
  pending_approval: { label: "Pend. Aprobación", bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  paid: { label: "Pagada", bg: "bg-blue-50", text: "text-blue-700", icon: CreditCard },
};

const DOC_TYPE_CONFIG: Record<string, { label: string; code: string }> = {
  invoice: { label: "Factura", code: "FAC" },
  proforma: { label: "Proforma", code: "PRF" },
  autonomo: { label: "Autónomo", code: "AUT" },
  ticket: { label: "Ticket", code: "TKT" },
  budget: { label: "Presupuesto", code: "PRE" },
};

export default function DocumentsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [currentFolder, setCurrentFolder] = useState<FolderType>("root");
  const [searchTerm, setSearchTerm] = useState("");
  
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [userId, setUserId] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");

  // ==================== AUTH ====================
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) {
        router.push("/");
      } else {
        setUserId(user.uid);
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && projectId) {
      loadData();
    }
  }, [userId, projectId]);

  // ==================== LOAD DATA ====================
  const loadData = async () => {
    try {
      setLoading(true);

      // Verificar acceso al proyecto
      const userProjectRef = doc(db, `userProjects/${userId}/projects/${projectId}`);
      const userProjectSnap = await getDoc(userProjectRef);
      
      if (!userProjectSnap.exists()) {
        setAccessError("No tienes acceso a este proyecto");
        setLoading(false);
        return;
      }

      const userProjectData = userProjectSnap.data();
      const hasAccountingAccess = userProjectData.permissions?.accounting || false;
      const accountingLevel = userProjectData.accountingAccessLevel;

      // Verificar rol del miembro
      const memberRef = doc(db, `projects/${projectId}/members`, userId!);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role);
      const hasDocsAccess = accountingLevel === "accounting_extended" || accountingLevel === "accounting";

      if (!hasAccountingAccess || (!isEPorPM && !hasDocsAccess)) {
        setAccessError("No tienes permisos para acceder a los documentos");
        setLoading(false);
        return;
      }
      
      setHasAccess(true);

      // Cargar nombre del proyecto
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
      }

      // Cargar proveedores
      const suppliersSnap = await getDocs(
        query(collection(db, `projects/${projectId}/suppliers`), orderBy("createdAt", "desc"))
      );
      const suppliersData: Supplier[] = suppliersSnap.docs.map(d => ({
        id: d.id,
        fiscalName: d.data().fiscalName || d.data().commercialName || "Sin nombre",
        commercialName: d.data().commercialName,
        taxId: d.data().taxId,
        email: d.data().email,
        phone: d.data().phone,
        createdAt: d.data().createdAt?.toDate() || new Date(),
      }));
      setSuppliers(suppliersData);

      // Cargar POs
      const posSnap = await getDocs(
        query(collection(db, `projects/${projectId}/pos`), orderBy("createdAt", "desc"))
      );
      const posData: PO[] = posSnap.docs.map(d => ({
        id: d.id,
        number: d.data().number || "",
        displayNumber: d.data().displayNumber || `PO-${d.data().number}`,
        supplier: d.data().supplier || "Sin proveedor",
        supplierId: d.data().supplierId || "",
        description: d.data().generalDescription || d.data().description || "",
        baseAmount: d.data().baseAmount || 0,
        totalAmount: d.data().totalAmount || 0,
        status: d.data().status || "draft",
        createdAt: d.data().createdAt?.toDate() || new Date(),
        approvedAt: d.data().approvedAt?.toDate(),
        attachmentUrl: d.data().attachmentUrl,
        attachmentFileName: d.data().attachmentFileName,
      }));
      setPos(posData);

      // Cargar Facturas
      const invoicesSnap = await getDocs(
        query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))
      );
      const invoicesData: Invoice[] = invoicesSnap.docs.map(d => ({
        id: d.id,
        number: d.data().number || "",
        displayNumber: d.data().displayNumber || `FAC-${d.data().number}`,
        documentType: d.data().documentType || "invoice",
        supplier: d.data().supplier || "Sin proveedor",
        supplierId: d.data().supplierId || "",
        supplierNumber: d.data().supplierNumber,
        description: d.data().description || "",
        baseAmount: d.data().baseAmount || 0,
        totalAmount: d.data().totalAmount || 0,
        status: d.data().status || "pending",
        createdAt: d.data().createdAt?.toDate() || new Date(),
        invoiceDate: d.data().invoiceDate?.toDate(),
        paidAt: d.data().paidAt?.toDate(),
        attachmentUrl: d.data().attachmentUrl,
        attachmentFileName: d.data().attachmentFileName,
      }));
      setInvoices(invoicesData);

    } catch (error) {
      console.error("Error loading data:", error);
      setAccessError("Error al cargar los datos");
    } finally {
      setLoading(false);
    }
  };

  // ==================== HELPERS ====================
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-ES", { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("es-ES", { 
      day: "2-digit", 
      month: "short", 
      year: "numeric" 
    }).format(date);
  };

  const formatDateShort = (date: Date) => {
    return new Intl.DateTimeFormat("es-ES", { 
      day: "2-digit", 
      month: "2-digit", 
      year: "numeric" 
    }).format(date);
  };

  // ==================== PDF: LISTADO PROVEEDORES ====================
  const generateSuppliersPDF = async () => {
    setGenerating("suppliers-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      
      // Header azul
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 35, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text("Listado de Proveedores", 20, 22);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${projectName} · ${formatDateShort(new Date())}`, 20, 30);

      // Cabecera tabla
      let y = 50;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("NOMBRE FISCAL", 20, y);
      pdf.text("CIF/NIF", 90, y);
      pdf.text("EMAIL", 125, y);
      pdf.text("TELÉFONO", 170, y);
      
      // Filas
      y += 12;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);

      for (const supplier of suppliers) {
        if (y > 270) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(supplier.fiscalName.substring(0, 35), 20, y);
        pdf.text(supplier.taxId || "-", 90, y);
        pdf.text((supplier.email || "-").substring(0, 25), 125, y);
        pdf.text(supplier.phone || "-", 170, y);
        y += 8;
      }

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`Total: ${suppliers.length} proveedores`, 20, 285);
      
      pdf.save(`Proveedores_${projectName.replace(/\s+/g, "_")}_${formatDateShort(new Date()).replace(/\//g, "-")}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== PDF: LISTADO POs ====================
  const generatePOsPDF = async () => {
    setGenerating("pos-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      
      // Header azul
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 35, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text("Listado de Órdenes de Compra", 20, 22);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${projectName} · ${formatDateShort(new Date())}`, 20, 30);

      // Resumen
      let y = 50;
      const totalBase = pos.reduce((sum, p) => sum + p.baseAmount, 0);
      const approved = pos.filter(p => p.status === "approved").length;
      const pending = pos.filter(p => p.status === "pending").length;
      
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 18, "F");
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(9);
      pdf.text(`Total POs: ${pos.length}`, 20, y + 2);
      pdf.text(`Aprobadas: ${approved}`, 60, y + 2);
      pdf.text(`Pendientes: ${pending}`, 100, y + 2);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Importe total: ${formatCurrency(totalBase)} €`, 145, y + 2);

      // Cabecera tabla
      y += 28;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("Nº PO", 20, y);
      pdf.text("PROVEEDOR", 45, y);
      pdf.text("DESCRIPCIÓN", 95, y);
      pdf.text("IMPORTE", 150, y);
      pdf.text("ESTADO", 175, y);
      
      // Filas
      y += 12;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);

      for (const po of pos) {
        if (y > 270) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(po.displayNumber, 20, y);
        pdf.text(po.supplier.substring(0, 25), 45, y);
        pdf.text(po.description.substring(0, 28), 95, y);
        pdf.text(`${formatCurrency(po.baseAmount)} €`, 150, y);
        const status = STATUS_CONFIG[po.status];
        pdf.text(status?.label || po.status, 175, y);
        y += 8;
      }

      pdf.save(`POs_${projectName.replace(/\s+/g, "_")}_${formatDateShort(new Date()).replace(/\//g, "-")}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== PDF: LISTADO FACTURAS ====================
  const generateInvoicesPDF = async () => {
    setGenerating("invoices-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      
      // Header azul
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 35, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(20);
      pdf.setFont("helvetica", "bold");
      pdf.text("Listado de Facturas", 20, 22);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${projectName} · ${formatDateShort(new Date())}`, 20, 30);

      // Resumen
      let y = 50;
      const totalBase = invoices.reduce((sum, i) => sum + i.baseAmount, 0);
      const paid = invoices.filter(i => i.status === "paid").length;
      const pending = invoices.filter(i => ["pending", "pending_approval", "approved"].includes(i.status)).length;
      
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 18, "F");
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(9);
      pdf.text(`Total Facturas: ${invoices.length}`, 20, y + 2);
      pdf.text(`Pagadas: ${paid}`, 65, y + 2);
      pdf.text(`Pendientes: ${pending}`, 105, y + 2);
      pdf.setFont("helvetica", "bold");
      pdf.text(`Importe total: ${formatCurrency(totalBase)} €`, 145, y + 2);

      // Cabecera tabla
      y += 28;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "bold");
      pdf.text("Nº", 20, y);
      pdf.text("TIPO", 40, y);
      pdf.text("PROVEEDOR", 60, y);
      pdf.text("Nº PROV.", 110, y);
      pdf.text("IMPORTE", 140, y);
      pdf.text("ESTADO", 170, y);
      
      // Filas
      y += 12;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);

      for (const inv of invoices) {
        if (y > 270) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(inv.displayNumber, 20, y);
        const docType = DOC_TYPE_CONFIG[inv.documentType];
        pdf.text(docType?.code || "FAC", 40, y);
        pdf.text(inv.supplier.substring(0, 25), 60, y);
        pdf.text((inv.supplierNumber || "-").substring(0, 15), 110, y);
        pdf.text(`${formatCurrency(inv.baseAmount)} €`, 140, y);
        const status = STATUS_CONFIG[inv.status];
        pdf.text(status?.label || inv.status, 170, y);
        y += 8;
      }

      pdf.save(`Facturas_${projectName.replace(/\s+/g, "_")}_${formatDateShort(new Date()).replace(/\//g, "-")}.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== PDF: CARÁTULA PO ====================
  const generatePOCover = async (po: PO) => {
    setGenerating(`po-${po.id}`);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const status = STATUS_CONFIG[po.status];
      
      // Header azul
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 50, "F");
      
      // Título
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(28);
      pdf.setFont("helvetica", "bold");
      pdf.text(po.displayNumber, 20, 32);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.text("Orden de Compra", 20, 42);

      // Badge estado
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageWidth - 60, 20, 45, 18, 3, 3, "F");
      pdf.setTextColor(47, 82, 224);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text(status?.label || po.status, pageWidth - 55, 32);

      // Sección proveedor
      let y = 70;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 35, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.text("PROVEEDOR", 25, y + 12);
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(po.supplier, 25, y + 26);
      
      y += 50;

      // Helper para campos
      const addField = (label: string, value: string, x: number, yPos: number) => {
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(label, x, yPos);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text(value, x, yPos + 10);
      };

      // Fila 1
      addField("Fecha creación", formatDateShort(po.createdAt), 25, y);
      addField("Fecha aprobación", po.approvedAt ? formatDateShort(po.approvedAt) : "-", 90, y);
      addField("Estado", status?.label || po.status, 155, y);
      
      // Fila 2
      y += 35;
      addField("Base imponible", `${formatCurrency(po.baseAmount)} €`, 25, y);
      addField("Total", `${formatCurrency(po.totalAmount)} €`, 90, y);
      addField("Adjunto", po.attachmentFileName ? "Sí" : "No", 155, y);

      // Descripción
      y += 35;
      if (po.description) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(15, y, pageWidth - 30, 40, "F");
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.text("DESCRIPCIÓN", 25, y + 12);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        const descLines = pdf.splitTextToSize(po.description, pageWidth - 60);
        pdf.text(descLines.slice(0, 3), 25, y + 24);
      }

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`${projectName} · Generado el ${formatDateShort(new Date())}`, 20, 285);

      pdf.save(`${po.displayNumber}_Caratula.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== PDF: CARÁTULA FACTURA ====================
  const generateInvoiceCover = async (inv: Invoice) => {
    setGenerating(`inv-${inv.id}`);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const status = STATUS_CONFIG[inv.status];
      const docType = DOC_TYPE_CONFIG[inv.documentType];
      
      // Color header según tipo
      const headerColor = inv.documentType === "invoice" 
        ? [47, 82, 224] 
        : inv.documentType === "proforma" 
          ? [139, 92, 246] 
          : inv.documentType === "ticket" 
            ? [16, 185, 129] 
            : [47, 82, 224];
      
      pdf.setFillColor(headerColor[0], headerColor[1], headerColor[2]);
      pdf.rect(0, 0, pageWidth, 50, "F");
      
      // Título
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(28);
      pdf.setFont("helvetica", "bold");
      pdf.text(inv.displayNumber, 20, 32);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "normal");
      pdf.text(docType?.label || "Factura", 20, 42);

      // Badge estado
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageWidth - 60, 20, 45, 18, 3, 3, "F");
      pdf.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text(status?.label || inv.status, pageWidth - 55, 32);

      // Sección proveedor
      let y = 70;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 35, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.text("PROVEEDOR", 25, y + 12);
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text(inv.supplier, 25, y + 26);
      
      y += 50;

      // Helper para campos
      const addField = (label: string, value: string, x: number, yPos: number) => {
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(label, x, yPos);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text(value, x, yPos + 10);
      };

      // Fila 1
      addField("Nº Factura proveedor", inv.supplierNumber || "-", 25, y);
      addField("Fecha factura", inv.invoiceDate ? formatDateShort(inv.invoiceDate) : "-", 100, y);
      addField("Estado", status?.label || inv.status, 165, y);
      
      // Fila 2
      y += 35;
      addField("Base imponible", `${formatCurrency(inv.baseAmount)} €`, 25, y);
      addField("Total", `${formatCurrency(inv.totalAmount)} €`, 100, y);
      addField("Fecha pago", inv.paidAt ? formatDateShort(inv.paidAt) : "-", 165, y);

      // Descripción
      y += 35;
      if (inv.description) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(15, y, pageWidth - 30, 40, "F");
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "bold");
        pdf.text("DESCRIPCIÓN", 25, y + 12);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        const descLines = pdf.splitTextToSize(inv.description, pageWidth - 60);
        pdf.text(descLines.slice(0, 3), 25, y + 24);
      }

      // Footer
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text(`${projectName} · Generado el ${formatDateShort(new Date())}`, 20, 285);

      pdf.save(`${inv.displayNumber}_Caratula.pdf`);
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== FILTROS ====================
  const filteredSuppliers = suppliers.filter(s => 
    s.fiscalName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.taxId?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPOs = pos.filter(p => 
    p.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.supplier.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredInvoices = invoices.filter(i => 
    i.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
    i.supplier.toLowerCase().includes(searchTerm.toLowerCase()) || 
    i.supplierNumber?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    i.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ==================== LOADING ====================
  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // ==================== SIN ACCESO ====================
  if (accessError || !hasAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">
            {accessError || "No tienes permisos para acceder a esta página"}
          </p>
          <Link
            href={`/project/${projectId}/accounting`}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: "#2F52E0" }}
          >
            <ArrowLeft size={16} />
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  // ==================== RENDER ====================
  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="border-b border-slate-200">
        <div className="mt-[4.5rem] px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between">
            {/* Título con icono */}
            <div className="flex items-center gap-4">
              {currentFolder !== "root" && (
                <button
                  onClick={() => {
                    setCurrentFolder("root");
                    setSearchTerm("");
                  }}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <ArrowLeft size={20} className="text-slate-600" />
                </button>
              )}
              {currentFolder === "root" && (
                <div 
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <FolderOpen size={20} className="text-white" />
                </div>
              )}
              <h1 className="text-xl font-semibold text-slate-900">
                {currentFolder === "root" 
                  ? "Documentos" 
                  : currentFolder === "suppliers" 
                    ? "Proveedores" 
                    : currentFolder === "pos" 
                      ? "Órdenes de Compra" 
                      : "Facturas"}
              </h1>
            </div>

            {/* Búsqueda (solo en subcarpetas) */}
            {currentFolder !== "root" && (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar..."
                  className="w-64 pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Contenido */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        
        {/* ==================== VISTA ROOT ==================== */}
        {currentFolder === "root" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Carpeta Proveedores */}
            <button
              onClick={() => setCurrentFolder("suppliers")}
              className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm transition-all text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center">
                  <Building2 size={24} className="text-amber-600" />
                </div>
                <span className="text-2xl font-bold text-slate-900">{suppliers.length}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1">Proveedores</h3>
              <p className="text-sm text-slate-500">Listado completo</p>
            </button>

            {/* Carpeta POs */}
            <button
              onClick={() => setCurrentFolder("pos")}
              className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm transition-all text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                  <ShoppingCart size={24} className="text-blue-600" />
                </div>
                <span className="text-2xl font-bold text-slate-900">{pos.length}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1">Órdenes de Compra</h3>
              <p className="text-sm text-slate-500">Carátulas y adjuntos</p>
            </button>

            {/* Carpeta Facturas */}
            <button
              onClick={() => setCurrentFolder("invoices")}
              className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm transition-all text-left"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Receipt size={24} className="text-emerald-600" />
                </div>
                <span className="text-2xl font-bold text-slate-900">{invoices.length}</span>
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1">Facturas</h3>
              <p className="text-sm text-slate-500">Carátulas y adjuntos</p>
            </button>
          </div>
        )}

        {/* ==================== VISTA PROVEEDORES ==================== */}
        {currentFolder === "suppliers" && (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {filteredSuppliers.length} proveedores
              </span>
              <button
                onClick={generateSuppliersPDF}
                disabled={generating === "suppliers-list"}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {generating === "suppliers-list" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Descargar PDF
              </button>
            </div>
            
            {/* Lista */}
            <div className="divide-y divide-slate-100">
              {filteredSuppliers.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-500">
                  {searchTerm ? "No se encontraron proveedores" : "Sin proveedores"}
                </div>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <div
                    key={supplier.id}
                    className="px-6 py-4 flex items-center hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mr-4">
                      <Building2 size={18} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{supplier.fiscalName}</p>
                      <div className="flex items-center gap-3 text-sm text-slate-500">
                        {supplier.taxId && <span>{supplier.taxId}</span>}
                        {supplier.email && <span className="truncate">{supplier.email}</span>}
                      </div>
                    </div>
                    <div className="text-sm text-slate-400">
                      {formatDate(supplier.createdAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ==================== VISTA POs ==================== */}
        {currentFolder === "pos" && (
          <div className="space-y-3">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {filteredPOs.length} órdenes de compra
              </span>
              <button
                onClick={generatePOsPDF}
                disabled={generating === "pos-list"}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {generating === "pos-list" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Descargar listado PDF
              </button>
            </div>

            {/* Lista */}
            {filteredPOs.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl px-6 py-12 text-center text-slate-500">
                {searchTerm ? "No se encontraron POs" : "Sin órdenes de compra"}
              </div>
            ) : (
              filteredPOs.map((po) => {
                const status = STATUS_CONFIG[po.status];
                const StatusIcon = status?.icon || File;
                
                return (
                  <div
                    key={po.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-slate-300 transition-colors"
                  >
                    <div className="px-6 py-4 flex items-center gap-4">
                      {/* Icono */}
                      <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <FileText size={24} className="text-blue-600" />
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-slate-900">{po.displayNumber}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status?.bg} ${status?.text}`}>
                            <StatusIcon size={10} />
                            {status?.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Building2 size={12} />
                            {po.supplier}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            {formatDate(po.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Importe */}
                      <div className="text-right mr-4">
                        <p className="font-semibold text-slate-900">{formatCurrency(po.baseAmount)} €</p>
                        <p className="text-xs text-slate-400">Base imponible</p>
                      </div>

                      {/* Acciones */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => generatePOCover(po)}
                          disabled={generating === `po-${po.id}`}
                          className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
                          title="Descargar carátula"
                        >
                          {generating === `po-${po.id}` ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <FileText size={18} />
                          )}
                        </button>
                        {po.attachmentUrl && (
                          <a
                            href={po.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
                            title="Ver adjunto"
                          >
                            <Download size={18} />
                          </a>
                        )}
                        <Link
                          href={`/project/${projectId}/accounting/pos/${po.id}`}
                          className="p-2.5 hover:bg-blue-50 rounded-xl transition-colors text-blue-600"
                          title="Ver PO"
                        >
                          <ChevronRight size={18} />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ==================== VISTA FACTURAS ==================== */}
        {currentFolder === "invoices" && (
          <div className="space-y-3">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center justify-between">
              <span className="text-sm text-slate-500">
                {filteredInvoices.length} facturas
              </span>
              <button
                onClick={generateInvoicesPDF}
                disabled={generating === "invoices-list"}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {generating === "invoices-list" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Descargar listado PDF
              </button>
            </div>

            {/* Lista */}
            {filteredInvoices.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl px-6 py-12 text-center text-slate-500">
                {searchTerm ? "No se encontraron facturas" : "Sin facturas"}
              </div>
            ) : (
              filteredInvoices.map((inv) => {
                const status = STATUS_CONFIG[inv.status];
                const StatusIcon = status?.icon || File;
                const docType = DOC_TYPE_CONFIG[inv.documentType];
                
                return (
                  <div
                    key={inv.id}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-slate-300 transition-colors"
                  >
                    <div className="px-6 py-4 flex items-center gap-4">
                      {/* Icono según tipo */}
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        inv.documentType === "invoice" 
                          ? "bg-emerald-50" 
                          : inv.documentType === "proforma" 
                            ? "bg-violet-50" 
                            : inv.documentType === "ticket" 
                              ? "bg-amber-50" 
                              : "bg-slate-50"
                      }`}>
                        <Receipt size={24} className={
                          inv.documentType === "invoice" 
                            ? "text-emerald-600" 
                            : inv.documentType === "proforma" 
                              ? "text-violet-600" 
                              : inv.documentType === "ticket" 
                                ? "text-amber-600" 
                                : "text-slate-600"
                        } />
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-slate-900">{inv.displayNumber}</p>
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                            {docType?.code || "FAC"}
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status?.bg} ${status?.text}`}>
                            <StatusIcon size={10} />
                            {status?.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Building2 size={12} />
                            {inv.supplier}
                          </span>
                          {inv.supplierNumber && (
                            <span className="flex items-center gap-1">
                              <Hash size={12} />
                              {inv.supplierNumber}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar size={12} />
                            {formatDate(inv.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Importe */}
                      <div className="text-right mr-4">
                        <p className="font-semibold text-slate-900">{formatCurrency(inv.baseAmount)} €</p>
                        <p className="text-xs text-slate-400">Base imponible</p>
                      </div>

                      {/* Acciones */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => generateInvoiceCover(inv)}
                          disabled={generating === `inv-${inv.id}`}
                          className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
                          title="Descargar carátula"
                        >
                          {generating === `inv-${inv.id}` ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <FileText size={18} />
                          )}
                        </button>
                        {inv.attachmentUrl && (
                          <a
                            href={inv.attachmentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700"
                            title="Ver adjunto"
                          >
                            <Download size={18} />
                          </a>
                        )}
                        <Link
                          href={`/project/${projectId}/accounting/invoices/${inv.id}`}
                          className="p-2.5 hover:bg-emerald-50 rounded-xl transition-colors text-emerald-600"
                          title="Ver Factura"
                        >
                          <ChevronRight size={18} />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
