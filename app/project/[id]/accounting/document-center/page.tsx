"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { 
  FolderOpen, FileText, Download, ChevronRight, ArrowLeft,
  Building2, Receipt, Search, File, CheckCircle,
  Clock, XCircle, CreditCard, Ban, Archive, ShieldAlert, ExternalLink
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";
import jsPDF from "jspdf";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type FolderType = "root" | "suppliers" | "pos" | "invoices";

interface Supplier {
  id: string;
  fiscalName: string;
  taxId?: string;
  email?: string;
  phone?: string;
  createdAt: Date;
}

interface POItem {
  description: string;
  subAccountCode: string;
  quantity: number;
  unitPrice: number;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
}

interface PO {
  id: string;
  displayNumber: string;
  supplier: string;
  description: string;
  department?: string;
  currency?: string;
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  status: string;
  createdAt: Date;
  approvedAt?: Date;
  attachmentUrl?: string;
  items: POItem[];
}

interface InvoiceItem {
  description: string;
  subAccountCode: string;
  quantity: number;
  unitPrice: number;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
}

interface Invoice {
  id: string;
  displayNumber: string;
  documentType: string;
  supplier: string;
  supplierNumber?: string;
  description: string;
  department?: string;
  currency?: string;
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  status: string;
  createdAt: Date;
  invoiceDate?: Date;
  dueDate?: Date;
  paidAt?: Date;
  attachmentUrl?: string;
  items: InvoiceItem[];
  linkedPONumber?: string;
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
  accounted: { label: "Contabilizada", bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle },
};

const DOC_TYPE_CONFIG: Record<string, { label: string; code: string }> = {
  invoice: { label: "Factura", code: "FAC" },
  proforma: { label: "Proforma", code: "PRF" },
  autonomo: { label: "Autónomo", code: "AUT" },
  ticket: { label: "Ticket", code: "TKT" },
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
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) setUserId(user.uid);
      else router.push("/login");
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && projectId) checkAccessAndLoad();
  }, [userId, projectId]);

  const checkAccessAndLoad = async () => {
    try {
      setLoading(true);
      setAccessError(null);
      
      // Solo verificar que el proyecto existe
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) { 
        setAccessError("Proyecto no encontrado"); 
        setLoading(false); 
        return; 
      }
      setProjectName(projectDoc.data().name || "Proyecto");
      setHasAccess(true);
      await loadData();
    } catch (error) {
      console.error("Error in checkAccessAndLoad:", error);
      // Intentar cargar datos de todos modos
      setHasAccess(true);
      try {
        await loadData();
      } catch (loadError) {
        console.error("Error loading data:", loadError);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const suppliersSnap = await getDocs(query(collection(db, "projects/" + projectId + "/suppliers"), orderBy("fiscalName")));
      setSuppliers(suppliersSnap.docs.map(d => ({
        id: d.id, fiscalName: d.data().fiscalName || "", taxId: d.data().taxId,
        email: d.data().email, phone: d.data().phone, createdAt: d.data().createdAt?.toDate() || new Date(),
      })));

      const posSnap = await getDocs(query(collection(db, "projects/" + projectId + "/pos"), orderBy("createdAt", "desc")));
      setPos(posSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, displayNumber: data.displayNumber || "PO-" + data.number, supplier: data.supplier || "",
          description: data.generalDescription || "", department: data.department, currency: data.currency || "EUR",
          baseAmount: data.baseAmount || 0, vatAmount: data.vatAmount || 0, irpfAmount: data.irpfAmount || 0,
          totalAmount: data.totalAmount || 0, status: data.status || "pending",
          createdAt: data.createdAt?.toDate() || new Date(), approvedAt: data.approvedAt?.toDate(),
          attachmentUrl: data.attachmentUrl,
          items: (data.items || []).map((item: any) => ({
            description: item.description || "", subAccountCode: item.subAccountCode || "",
            quantity: item.quantity || 1, unitPrice: item.unitPrice || 0, baseAmount: item.baseAmount || 0,
            vatRate: item.vatRate || 0, vatAmount: item.vatAmount || 0, irpfAmount: item.irpfAmount || 0,
            totalAmount: item.totalAmount || 0,
          })),
        };
      }));

      const invoicesSnap = await getDocs(query(collection(db, "projects/" + projectId + "/invoices"), orderBy("createdAt", "desc")));
      setInvoices(invoicesSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, displayNumber: data.displayNumber || "FAC-" + data.number, documentType: data.documentType || "invoice",
          supplier: data.supplier || "", supplierNumber: data.supplierNumber, description: data.description || "",
          department: data.department, currency: data.currency || "EUR",
          baseAmount: data.baseAmount || 0, vatAmount: data.vatAmount || 0, irpfAmount: data.irpfAmount || 0,
          totalAmount: data.totalAmount || 0, status: data.status || "pending",
          createdAt: data.createdAt?.toDate() || new Date(), invoiceDate: data.invoiceDate?.toDate(),
          dueDate: data.dueDate?.toDate(), paidAt: data.paidAt?.toDate(), attachmentUrl: data.attachmentUrl,
          linkedPONumber: data.linkedPONumber,
          items: (data.items || []).map((item: any) => ({
            description: item.description || "", subAccountCode: item.subAccountCode || "",
            quantity: item.quantity || 1, unitPrice: item.unitPrice || 0, baseAmount: item.baseAmount || 0,
            vatRate: item.vatRate || 0, vatAmount: item.vatAmount || 0, irpfAmount: item.irpfAmount || 0,
            totalAmount: item.totalAmount || 0,
          })),
        };
      }));
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const formatDate = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  const formatDateShort = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const getCurrencySymbol = (currency: string) => ({ EUR: "€", USD: "$", GBP: "£" }[currency] || "€");

  const filteredSuppliers = suppliers.filter(s => s.fiscalName.toLowerCase().includes(searchTerm.toLowerCase()) || s.taxId?.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredPOs = pos.filter(p => p.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) || p.supplier.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredInvoices = invoices.filter(i => i.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) || i.supplier.toLowerCase().includes(searchTerm.toLowerCase()));

  // PDF: Listado Proveedores
  const generateSuppliersPDF = async () => {
    setGenerating("suppliers-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 32, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Listado de Proveedores", 20, 20);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(projectName + " - " + formatDateShort(new Date()), 20, 28);

      let y = 48;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 6, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("NOMBRE FISCAL", 20, y);
      pdf.text("CIF/NIF", 95, y);
      pdf.text("EMAIL", 130, y);
      pdf.text("TELÉFONO", 175, y);
      
      y += 10;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      for (const supplier of suppliers) {
        if (y > 275) { pdf.addPage(); y = 20; }
        pdf.text(supplier.fiscalName.substring(0, 40), 20, y);
        pdf.text(supplier.taxId || "-", 95, y);
        pdf.text((supplier.email || "-").substring(0, 25), 130, y);
        pdf.text(supplier.phone || "-", 175, y);
        y += 7;
      }
      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.text("Total: " + suppliers.length + " proveedores", 20, 287);
      pdf.save("Proveedores_" + projectName.replace(/\s+/g, "_") + ".pdf");
    } catch (error) { console.error(error); }
    finally { setGenerating(null); }
  };

  // PDF: Listado POs
  const generatePOsPDF = async () => {
    setGenerating("pos-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 32, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Órdenes de Compra", 20, 20);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(projectName + " - " + formatDateShort(new Date()), 20, 28);

      let y = 46;
      const totalBase = pos.reduce((sum, p) => sum + p.baseAmount, 0);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 14, "F");
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(8);
      pdf.text("Total: " + pos.length + " POs", 20, y + 3);
      pdf.setFont("helvetica", "bold");
      pdf.text("Importe: " + formatCurrency(totalBase) + " EUR", 150, y + 3);

      y += 22;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 6, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("NÚMERO", 20, y);
      pdf.text("PROVEEDOR", 50, y);
      pdf.text("FECHA", 115, y);
      pdf.text("ESTADO", 140, y);
      pdf.text("BASE", 170, y, { align: "right" });
      pdf.text("TOTAL", 195, y, { align: "right" });
      
      y += 10;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      for (const po of pos) {
        if (y > 275) { pdf.addPage(); y = 20; }
        const status = STATUS_CONFIG[po.status];
        pdf.text(po.displayNumber, 20, y);
        pdf.text(po.supplier.substring(0, 30), 50, y);
        pdf.text(formatDateShort(po.createdAt), 115, y);
        pdf.text(status?.label || po.status, 140, y);
        pdf.text(formatCurrency(po.baseAmount), 170, y, { align: "right" });
        pdf.text(formatCurrency(po.totalAmount), 195, y, { align: "right" });
        y += 7;
      }
      pdf.save("POs_" + projectName.replace(/\s+/g, "_") + ".pdf");
    } catch (error) { console.error(error); }
    finally { setGenerating(null); }
  };

  // PDF: Listado Facturas
  const generateInvoicesPDF = async () => {
    setGenerating("invoices-list");
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 32, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Facturas", 20, 20);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(projectName + " - " + formatDateShort(new Date()), 20, 28);

      let y = 46;
      const totalBase = invoices.reduce((sum, i) => sum + i.baseAmount, 0);
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 5, pageWidth - 30, 14, "F");
      pdf.setTextColor(71, 85, 105);
      pdf.setFontSize(8);
      pdf.text("Total: " + invoices.length + " facturas", 20, y + 3);
      pdf.setFont("helvetica", "bold");
      pdf.text("Importe: " + formatCurrency(totalBase) + " EUR", 150, y + 3);

      y += 22;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y - 6, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("NÚMERO", 20, y);
      pdf.text("PROVEEDOR", 50, y);
      pdf.text("FECHA", 115, y);
      pdf.text("ESTADO", 140, y);
      pdf.text("BASE", 170, y, { align: "right" });
      pdf.text("TOTAL", 195, y, { align: "right" });
      
      y += 10;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      for (const inv of invoices) {
        if (y > 275) { pdf.addPage(); y = 20; }
        const status = STATUS_CONFIG[inv.status];
        pdf.text(inv.displayNumber, 20, y);
        pdf.text(inv.supplier.substring(0, 30), 50, y);
        pdf.text(formatDateShort(inv.createdAt), 115, y);
        pdf.text(status?.label || inv.status, 140, y);
        pdf.text(formatCurrency(inv.baseAmount), 170, y, { align: "right" });
        pdf.text(formatCurrency(inv.totalAmount), 195, y, { align: "right" });
        y += 7;
      }
      pdf.save("Facturas_" + projectName.replace(/\s+/g, "_") + ".pdf");
    } catch (error) { console.error(error); }
    finally { setGenerating(null); }
  };

  // PDF: Carátula PO con items
  const generatePOCover = async (po: PO) => {
    setGenerating("po-" + po.id);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const status = STATUS_CONFIG[po.status];
      const currency = getCurrencySymbol(po.currency || "EUR");
      
      pdf.setFillColor(47, 82, 224);
      pdf.rect(0, 0, pageWidth, 45, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.text(po.displayNumber, 20, 25);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text("Orden de Compra", 20, 35);

      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageWidth - 55, 18, 40, 14, 2, 2, "F");
      pdf.setTextColor(47, 82, 224);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.text(status?.label || po.status, pageWidth - 35, 27, { align: "center" });

      let y = 60;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 28, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.text("PROVEEDOR", 20, y + 8);
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(13);
      pdf.setFont("helvetica", "bold");
      pdf.text(po.supplier, 20, y + 20);

      y += 38;
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.text("Fecha creación", 20, y);
      pdf.text("Fecha aprobación", 75, y);
      pdf.text("Departamento", 130, y);
      y += 8;
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text(formatDateShort(po.createdAt), 20, y);
      pdf.text(po.approvedAt ? formatDateShort(po.approvedAt) : "-", 75, y);
      pdf.text(po.department || "-", 130, y);

      if (po.description) {
        y += 18;
        pdf.setFillColor(248, 250, 252);
        pdf.rect(15, y, pageWidth - 30, 18, "F");
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text("DESCRIPCIÓN", 20, y + 7);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(9);
        const descLines = pdf.splitTextToSize(po.description, pageWidth - 50);
        pdf.text(descLines.slice(0, 1), 20, y + 14);
        y += 18;
      }

      y += 12;
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text("Items", 20, y);
      y += 8;

      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("DESCRIPCIÓN", 20, y + 6);
      pdf.text("CUENTA", 85, y + 6);
      pdf.text("CANT.", 115, y + 6);
      pdf.text("P.UNIT", 135, y + 6);
      pdf.text("BASE", 160, y + 6, { align: "right" });
      pdf.text("IVA", 178, y + 6, { align: "right" });
      pdf.text("TOTAL", 195, y + 6, { align: "right" });
      
      y += 14;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      for (const item of po.items) {
        if (y > 250) { pdf.addPage(); y = 20; }
        pdf.text(item.description.substring(0, 30), 20, y);
        pdf.text(item.subAccountCode || "-", 85, y);
        pdf.text(String(item.quantity), 115, y);
        pdf.text(formatCurrency(item.unitPrice), 135, y);
        pdf.text(formatCurrency(item.baseAmount), 160, y, { align: "right" });
        pdf.text(formatCurrency(item.vatAmount), 178, y, { align: "right" });
        pdf.text(formatCurrency(item.totalAmount), 195, y, { align: "right" });
        y += 8;
      }

      y += 5;
      pdf.setDrawColor(226, 232, 240);
      pdf.line(125, y, 195, y);
      y += 8;

      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("Base imponible", 125, y);
      pdf.setTextColor(30, 41, 59);
      pdf.text(formatCurrency(po.baseAmount) + " " + currency, 195, y, { align: "right" });
      
      y += 7;
      pdf.setTextColor(100, 116, 139);
      pdf.text("IVA", 125, y);
      pdf.setTextColor(30, 41, 59);
      pdf.text(formatCurrency(po.vatAmount) + " " + currency, 195, y, { align: "right" });

      if (po.irpfAmount && po.irpfAmount !== 0) {
        y += 7;
        pdf.setTextColor(100, 116, 139);
        pdf.text("IRPF", 125, y);
        pdf.setTextColor(30, 41, 59);
        pdf.text("-" + formatCurrency(Math.abs(po.irpfAmount)) + " " + currency, 195, y, { align: "right" });
      }
      
      y += 10;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(30, 41, 59);
      pdf.text("TOTAL", 125, y);
      pdf.text(formatCurrency(po.totalAmount) + " " + currency, 195, y, { align: "right" });

      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.setFont("helvetica", "normal");
      pdf.text(projectName + " - Generado el " + formatDateShort(new Date()), 20, 287);

      pdf.save(po.displayNumber + ".pdf");
    } catch (error) { console.error(error); }
    finally { setGenerating(null); }
  };

  // PDF: Carátula Factura con items
  const generateInvoiceCover = async (inv: Invoice) => {
    setGenerating("inv-" + inv.id);
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const status = STATUS_CONFIG[inv.status];
      const docType = DOC_TYPE_CONFIG[inv.documentType];
      const currency = getCurrencySymbol(inv.currency || "EUR");
      
      const headerColors: Record<string, number[]> = {
        invoice: [47, 82, 224], proforma: [139, 92, 246], ticket: [16, 185, 129], autonomo: [245, 158, 11],
      };
      const hc = headerColors[inv.documentType] || [47, 82, 224];
      
      pdf.setFillColor(hc[0], hc[1], hc[2]);
      pdf.rect(0, 0, pageWidth, 45, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(24);
      pdf.setFont("helvetica", "bold");
      pdf.text(inv.displayNumber, 20, 25);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(docType?.label || "Factura", 20, 35);

      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(pageWidth - 55, 18, 40, 14, 2, 2, "F");
      pdf.setTextColor(hc[0], hc[1], hc[2]);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "bold");
      pdf.text(status?.label || inv.status, pageWidth - 35, 27, { align: "center" });

      let y = 60;
      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 28, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.text("PROVEEDOR", 20, y + 8);
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(13);
      pdf.setFont("helvetica", "bold");
      pdf.text(inv.supplier, 20, y + 20);

      y += 38;
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(8);
      pdf.setFont("helvetica", "normal");
      pdf.text("Num. Proveedor", 20, y);
      pdf.text("Fecha factura", 70, y);
      pdf.text("Vencimiento", 120, y);
      if (inv.linkedPONumber) pdf.text("PO vinculada", 165, y);
      y += 8;
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "bold");
      pdf.text(inv.supplierNumber || "-", 20, y);
      pdf.text(inv.invoiceDate ? formatDateShort(inv.invoiceDate) : "-", 70, y);
      pdf.text(inv.dueDate ? formatDateShort(inv.dueDate) : "-", 120, y);
      if (inv.linkedPONumber) pdf.text(inv.linkedPONumber, 165, y);

      if (inv.description) {
        y += 18;
        pdf.setFillColor(248, 250, 252);
        pdf.rect(15, y, pageWidth - 30, 18, "F");
        pdf.setTextColor(100, 116, 139);
        pdf.setFontSize(8);
        pdf.setFont("helvetica", "normal");
        pdf.text("DESCRIPCIÓN", 20, y + 7);
        pdf.setTextColor(30, 41, 59);
        pdf.setFontSize(9);
        const descLines = pdf.splitTextToSize(inv.description, pageWidth - 50);
        pdf.text(descLines.slice(0, 1), 20, y + 14);
        y += 18;
      }

      y += 12;
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text("Items", 20, y);
      y += 8;

      pdf.setFillColor(248, 250, 252);
      pdf.rect(15, y, pageWidth - 30, 10, "F");
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(7);
      pdf.setFont("helvetica", "bold");
      pdf.text("DESCRIPCIÓN", 20, y + 6);
      pdf.text("CUENTA", 85, y + 6);
      pdf.text("CANT.", 115, y + 6);
      pdf.text("P.UNIT", 135, y + 6);
      pdf.text("BASE", 160, y + 6, { align: "right" });
      pdf.text("IVA", 178, y + 6, { align: "right" });
      pdf.text("TOTAL", 195, y + 6, { align: "right" });
      
      y += 14;
      pdf.setTextColor(30, 41, 59);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);

      for (const item of inv.items) {
        if (y > 250) { pdf.addPage(); y = 20; }
        pdf.text(item.description.substring(0, 30), 20, y);
        pdf.text(item.subAccountCode || "-", 85, y);
        pdf.text(String(item.quantity), 115, y);
        pdf.text(formatCurrency(item.unitPrice), 135, y);
        pdf.text(formatCurrency(item.baseAmount), 160, y, { align: "right" });
        pdf.text(formatCurrency(item.vatAmount), 178, y, { align: "right" });
        pdf.text(formatCurrency(item.totalAmount), 195, y, { align: "right" });
        y += 8;
      }

      y += 5;
      pdf.setDrawColor(226, 232, 240);
      pdf.line(125, y, 195, y);
      y += 8;

      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 116, 139);
      pdf.text("Base imponible", 125, y);
      pdf.setTextColor(30, 41, 59);
      pdf.text(formatCurrency(inv.baseAmount) + " " + currency, 195, y, { align: "right" });
      
      y += 7;
      pdf.setTextColor(100, 116, 139);
      pdf.text("IVA", 125, y);
      pdf.setTextColor(30, 41, 59);
      pdf.text(formatCurrency(inv.vatAmount) + " " + currency, 195, y, { align: "right" });

      if (inv.irpfAmount && inv.irpfAmount !== 0) {
        y += 7;
        pdf.setTextColor(100, 116, 139);
        pdf.text("IRPF", 125, y);
        pdf.setTextColor(30, 41, 59);
        pdf.text("-" + formatCurrency(Math.abs(inv.irpfAmount)) + " " + currency, 195, y, { align: "right" });
      }
      
      y += 10;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.setTextColor(30, 41, 59);
      pdf.text("TOTAL", 125, y);
      pdf.text(formatCurrency(inv.totalAmount) + " " + currency, 195, y, { align: "right" });

      if (inv.paidAt) {
        y += 12;
        pdf.setFillColor(16, 185, 129);
        pdf.roundedRect(125, y - 4, 70, 12, 2, 2, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.text("Pagada el " + formatDateShort(inv.paidAt), 160, y + 3, { align: "center" });
      }

      pdf.setFontSize(7);
      pdf.setTextColor(148, 163, 184);
      pdf.setFont("helvetica", "normal");
      pdf.text(projectName + " - Generado el " + formatDateShort(new Date()), 20, 287);

      pdf.save(inv.displayNumber + ".pdf");
    } catch (error) { console.error(error); }
    finally { setGenerating(null); }
  };

  if (loading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess || accessError) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="text-center max-w-md">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={24} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{accessError || "No tienes permisos para acceder"}</p>
          <Link href={"/project/" + projectId + "/accounting"} className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "#2F52E0" }}>
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              {currentFolder !== "root" ? (
                <button onClick={() => { setCurrentFolder("root"); setSearchTerm(""); }} className="w-10 h-10 rounded-xl flex items-center justify-center border border-slate-200 hover:bg-slate-50">
                  <ArrowLeft size={18} className="text-slate-600" />
                </button>
              ) : (
                <FolderOpen size={24} style={{ color: "#2F52E0" }} />
              )}
              <h1 className="text-2xl font-semibold text-slate-900">
                {currentFolder === "root" ? "Documentos" : currentFolder === "suppliers" ? "Proveedores" : currentFolder === "pos" ? "Órdenes de compra" : "Facturas"}
              </h1>
            </div>
            {currentFolder !== "root" && (
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar" className="w-64 pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
            )}
          </div>

          {currentFolder === "root" && (
            <div className="grid grid-cols-3 gap-4 mt-6">
              <button onClick={() => setCurrentFolder("suppliers")} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm text-left">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center"><Building2 size={24} className="text-amber-600" /></div>
                  <span className="text-2xl font-bold text-slate-900">{suppliers.length}</span>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">Proveedores</h3>
                <p className="text-sm text-slate-500">Listado completo</p>
              </button>
              <button onClick={() => setCurrentFolder("pos")} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm text-left">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center"><FileText size={24} className="text-blue-600" /></div>
                  <span className="text-2xl font-bold text-slate-900">{pos.length}</span>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">Órdenes de compra</h3>
                <p className="text-sm text-slate-500">Documentos y carátulas</p>
              </button>
              <button onClick={() => setCurrentFolder("invoices")} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm text-left">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center"><Receipt size={24} className="text-emerald-600" /></div>
                  <span className="text-2xl font-bold text-slate-900">{invoices.length}</span>
                </div>
                <h3 className="text-base font-semibold text-slate-900 mb-1">Facturas</h3>
                <p className="text-sm text-slate-500">Documentos y carátulas</p>
              </button>
            </div>
          )}

          {currentFolder === "suppliers" && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mt-6">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <span className="text-sm text-slate-500">{filteredSuppliers.length} proveedores</span>
                <button onClick={generateSuppliersPDF} disabled={generating === "suppliers-list"} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                  {generating === "suppliers-list" ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
                  Exportar PDF
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredSuppliers.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <Building2 size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">{searchTerm ? "Sin resultados" : "Sin proveedores"}</p>
                  </div>
                ) : (
                  filteredSuppliers.map((supplier) => (
                    <div key={supplier.id} className="px-6 py-4 flex items-center hover:bg-slate-50">
                      <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center mr-4"><Building2 size={18} className="text-amber-600" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{supplier.fiscalName}</p>
                        <p className="text-sm text-slate-500">{supplier.taxId || ""}{supplier.taxId && supplier.email ? " · " : ""}{supplier.email || ""}</p>
                      </div>
                      <span className="text-sm text-slate-400">{formatDate(supplier.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {currentFolder === "pos" && (
            <div className="mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center justify-between mb-4">
                <span className="text-sm text-slate-500">{filteredPOs.length} órdenes de compra</span>
                <button onClick={generatePOsPDF} disabled={generating === "pos-list"} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                  {generating === "pos-list" ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
                  Exportar listado
                </button>
              </div>
              {filteredPOs.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl px-6 py-16 text-center">
                  <FileText size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">{searchTerm ? "Sin resultados" : "Sin órdenes de compra"}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredPOs.map((po) => {
                    const status = STATUS_CONFIG[po.status];
                    const StatusIcon = status?.icon || File;
                    return (
                      <div key={po.id} className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center gap-4 hover:border-slate-300">
                        <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0"><FileText size={20} className="text-blue-600" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="font-semibold text-slate-900">{po.displayNumber}</p>
                            <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " + (status?.bg || "") + " " + (status?.text || "")}><StatusIcon size={10} />{status?.label}</span>
                          </div>
                          <p className="text-sm text-slate-500">{po.supplier} · {formatDate(po.createdAt)}</p>
                        </div>
                        <div className="text-right mr-2">
                          <p className="font-semibold text-slate-900">{formatCurrency(po.totalAmount)} €</p>
                          <p className="text-xs text-slate-400">Total</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => generatePOCover(po)} disabled={generating === "po-" + po.id} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700" title="Descargar PDF">
                            {generating === "po-" + po.id ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : <Download size={16} />}
                          </button>
                          {po.attachmentUrl && <a href={po.attachmentUrl} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700" title="Ver adjunto"><ExternalLink size={16} /></a>}
                          <Link href={"/project/" + projectId + "/accounting/pos/" + po.id} className="p-2 hover:bg-blue-50 rounded-lg text-blue-600"><ChevronRight size={16} /></Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {currentFolder === "invoices" && (
            <div className="mt-6">
              <div className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center justify-between mb-4">
                <span className="text-sm text-slate-500">{filteredInvoices.length} facturas</span>
                <button onClick={generateInvoicesPDF} disabled={generating === "invoices-list"} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                  {generating === "invoices-list" ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download size={14} />}
                  Exportar listado
                </button>
              </div>
              {filteredInvoices.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl px-6 py-16 text-center">
                  <Receipt size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">{searchTerm ? "Sin resultados" : "Sin facturas"}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredInvoices.map((inv) => {
                    const status = STATUS_CONFIG[inv.status];
                    const StatusIcon = status?.icon || File;
                    const docType = DOC_TYPE_CONFIG[inv.documentType];
                    const iconColors: Record<string, { bg: string; text: string }> = {
                      invoice: { bg: "bg-emerald-50", text: "text-emerald-600" },
                      proforma: { bg: "bg-violet-50", text: "text-violet-600" },
                      ticket: { bg: "bg-amber-50", text: "text-amber-600" },
                      autonomo: { bg: "bg-orange-50", text: "text-orange-600" },
                    };
                    const colors = iconColors[inv.documentType] || { bg: "bg-slate-50", text: "text-slate-600" };
                    return (
                      <div key={inv.id} className="bg-white border border-slate-200 rounded-2xl px-6 py-4 flex items-center gap-4 hover:border-slate-300">
                        <div className={"w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 " + colors.bg}><Receipt size={20} className={colors.text} /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="font-semibold text-slate-900">{inv.displayNumber}</p>
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">{docType?.code || "FAC"}</span>
                            <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium " + (status?.bg || "") + " " + (status?.text || "")}><StatusIcon size={10} />{status?.label}</span>
                          </div>
                          <p className="text-sm text-slate-500">{inv.supplier}{inv.supplierNumber ? " · " + inv.supplierNumber : ""} · {formatDate(inv.createdAt)}</p>
                        </div>
                        <div className="text-right mr-2">
                          <p className="font-semibold text-slate-900">{formatCurrency(inv.totalAmount)} €</p>
                          <p className="text-xs text-slate-400">Total</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => generateInvoiceCover(inv)} disabled={generating === "inv-" + inv.id} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700" title="Descargar PDF">
                            {generating === "inv-" + inv.id ? <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" /> : <Download size={16} />}
                          </button>
                          {inv.attachmentUrl && <a href={inv.attachmentUrl} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700" title="Ver adjunto"><ExternalLink size={16} /></a>}
                          <Link href={"/project/" + projectId + "/accounting/invoices/" + inv.id} className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600"><ChevronRight size={16} /></Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
