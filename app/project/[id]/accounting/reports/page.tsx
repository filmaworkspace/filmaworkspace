"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { 
  FileSpreadsheet, Building2, Receipt, FileText, Wallet, 
  ChevronRight, ArrowLeft, ShieldAlert, Download, Calendar,
  Filter, Users, Layers
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// Helper para generar CSV y descargar
const downloadCSV = (data: any[][], filename: string) => {
  const csvContent = data.map(row => 
    row.map(cell => {
      if (cell === null || cell === undefined) return "";
      if (cell instanceof Date) {
        return cell.toLocaleDateString("es-ES");
      }
      const str = String(cell);
      // Escapar comillas y envolver en comillas si contiene coma, comilla o salto de línea
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(";") // Usar ; como separador para mejor compatibilidad con Excel español
  ).join("\n");

  // Añadir BOM para UTF-8
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
interface Supplier {
  id: string;
  fiscalName: string;
  taxId?: string;
  iban?: string;
}

interface PO {
  id: string;
  number: string;
  displayNumber: string;
  supplier: string;
  supplierId: string;
  description: string;
  department?: string;
  status: string;
  baseAmount: number;
  totalAmount: number;
  createdAt: Date;
  approvedAt?: Date;
  items: any[];
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
  department?: string;
  linkedPOId?: string;
  linkedPONumber?: string;
  status: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  createdAt: Date;
  invoiceDate?: Date;
  dueDate?: Date;
  paidAt?: Date;
  items: any[];
}

const REPORTS = [
  {
    id: "supplier",
    title: "Informe por Proveedor",
    description: "Facturas agrupadas por proveedor con totales",
    icon: Building2,
    color: "amber",
  },
  {
    id: "pending_payments",
    title: "Previsión de Pagos",
    description: "Facturas pendientes de pago por vencimiento",
    icon: Wallet,
    color: "blue",
  },
  {
    id: "invoices_list",
    title: "Libro de Facturas",
    description: "Listado completo de facturas recibidas",
    icon: Receipt,
    color: "emerald",
  },
  {
    id: "pos_list",
    title: "Listado de POs",
    description: "Órdenes de compra con estado y totales",
    icon: FileText,
    color: "violet",
  },
  {
    id: "pos_items",
    title: "POs por Items",
    description: "Desglose de items con cuentas contables",
    icon: FileText,
    color: "indigo",
  },
  {
    id: "cost_by_department",
    title: "Costes por Departamento",
    description: "Desglose de gastos por departamento",
    icon: Layers,
    color: "rose",
  },
];

export default function ReportsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // Filters
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) setUserId(user.uid);
      else router.push("/login");
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && projectId) loadData();
  }, [userId, projectId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) {
        setAccessError("Proyecto no encontrado");
        return;
      }
      setProjectName(projectDoc.data().name || "Proyecto");
      setHasAccess(true);

      // Load suppliers
      const suppSnap = await getDocs(query(collection(db, `projects/${projectId}/suppliers`), orderBy("fiscalName")));
      setSuppliers(suppSnap.docs.map(d => ({
        id: d.id,
        fiscalName: d.data().fiscalName || "",
        taxId: d.data().taxId,
        iban: d.data().iban,
      })));

      // Load POs
      const posSnap = await getDocs(query(collection(db, `projects/${projectId}/pos`), orderBy("createdAt", "desc")));
      const posData = posSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          number: data.number || "",
          displayNumber: data.displayNumber || `PO-${data.number}`,
          supplier: data.supplier || "",
          supplierId: data.supplierId || "",
          description: data.generalDescription || "",
          department: data.department,
          status: data.status || "pending",
          baseAmount: data.baseAmount || 0,
          totalAmount: data.totalAmount || 0,
          createdAt: data.createdAt?.toDate() || new Date(),
          approvedAt: data.approvedAt?.toDate(),
          items: data.items || [],
        };
      });
      setPos(posData);

      // Load invoices
      const invSnap = await getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc")));
      const invData = invSnap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          number: data.number || "",
          displayNumber: data.displayNumber || `FAC-${data.number}`,
          documentType: data.documentType || "invoice",
          supplier: data.supplier || "",
          supplierId: data.supplierId || "",
          supplierNumber: data.supplierNumber,
          description: data.description || "",
          department: data.department,
          linkedPOId: data.linkedPOId,
          linkedPONumber: data.linkedPONumber,
          status: data.status || "pending",
          baseAmount: data.baseAmount || 0,
          vatAmount: data.vatAmount || 0,
          totalAmount: data.totalAmount || 0,
          createdAt: data.createdAt?.toDate() || new Date(),
          invoiceDate: data.invoiceDate?.toDate(),
          dueDate: data.dueDate?.toDate(),
          paidAt: data.paidAt?.toDate(),
          items: data.items || [],
        };
      });
      setInvoices(invData);

      // Extract departments
      const depts = new Set<string>();
      posData.forEach(p => p.department && depts.add(p.department));
      invData.forEach(i => i.department && depts.add(i.department));
      setDepartments(Array.from(depts).sort());

    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  const getWeekNumber = (date: Date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  // ==================== INFORME POR PROVEEDOR ====================
  const generateSupplierReport = async () => {
    setGenerating("supplier");
    try {
      const today = new Date();
      const weekNum = getWeekNumber(today);

      // Filter invoices
      let filteredInvoices = invoices;
      if (selectedSupplier !== "all") {
        filteredInvoices = filteredInvoices.filter(i => i.supplierId === selectedSupplier);
      }
      if (selectedDepartment !== "all") {
        filteredInvoices = filteredInvoices.filter(i => i.department === selectedDepartment);
      }
      if (dateFrom) {
        const from = new Date(dateFrom);
        filteredInvoices = filteredInvoices.filter(i => i.invoiceDate && i.invoiceDate >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        filteredInvoices = filteredInvoices.filter(i => i.invoiceDate && i.invoiceDate <= to);
      }

      // Group by supplier
      const bySupplier: Record<string, Invoice[]> = {};
      filteredInvoices.forEach(inv => {
        const key = inv.supplierId || inv.supplier;
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(inv);
      });

      // Create data array
      const data: any[][] = [];
      
      // Header
      data.push([projectName, "", "", "", "", "", "", "", "", "PROVEEDOR"]);
      data.push([]);
      data.push(["", "", "Fecha informe:", today, "N.º informe:", "-"]);
      data.push(["", "", "Semana:", `SEM. ${weekNum}`, "Solicitante:", ""]);
      data.push(["", "", "", "", "Departamento:", selectedDepartment === "all" ? "Todos" : selectedDepartment]);
      data.push([]);
      data.push([]);
      data.push(["PROVEEDORES"]);
      data.push([]);
      data.push(["#", "PO #", "FCT #", "N.º FCT.", "Proveedor", "Descripción", "IBAN", "Fecha FCT.", "Fecha vcto.", "Importe", "Dpto."]);

      let rowNum = 1;
      let grandTotal = 0;

      Object.entries(bySupplier).forEach(([supplierId, invs]) => {
        const supplier = suppliers.find(s => s.id === supplierId);
        let supplierTotal = 0;

        invs.forEach(inv => {
          const po = pos.find(p => p.id === inv.linkedPOId);
          data.push([
            rowNum.toString().padStart(2, "0"),
            po?.number || "",
            inv.number || "",
            inv.supplierNumber || "",
            inv.supplier,
            inv.description,
            supplier?.iban || "",
            inv.invoiceDate || "",
            inv.dueDate || "",
            inv.totalAmount,
            inv.department || ""
          ]);
          supplierTotal += inv.totalAmount;
          rowNum++;
        });

        data.push(["", "", "", "", "", "", "", "", "Suma.-", supplierTotal]);
        data.push([]);
        grandTotal += supplierTotal;
      });

      data.push(["", "", "", "", "", "", "", "", "Total.-", grandTotal]);

      downloadCSV(data, `Proveedor_${projectName.replace(/\s+/g, "_")}_SEM${weekNum}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== PREVISIÓN DE PAGOS ====================
  const generatePaymentsReport = async () => {
    setGenerating("pending_payments");
    try {
      const today = new Date();
      const weekNum = getWeekNumber(today);

      // Filter unpaid invoices
      let pendingInvoices = invoices.filter(i => i.status !== "paid" && !i.paidAt);
      
      if (selectedSupplier !== "all") {
        pendingInvoices = pendingInvoices.filter(i => i.supplierId === selectedSupplier);
      }
      if (selectedDepartment !== "all") {
        pendingInvoices = pendingInvoices.filter(i => i.department === selectedDepartment);
      }

      // Sort by due date
      pendingInvoices.sort((a, b) => {
        const dateA = a.dueDate?.getTime() || 0;
        const dateB = b.dueDate?.getTime() || 0;
        return dateA - dateB;
      });

      const data: any[][] = [];
      
      data.push([projectName, "", "", "", "", "", "", "", "PREVISIÓN DE PAGOS"]);
      data.push([]);
      data.push(["", "", "Fecha previsión:", today, "N.º previsión:", "-"]);
      data.push(["", "", "Semana:", `SEM. ${weekNum}`, "Solicitante:", ""]);
      data.push(["", "", "", "", "Departamento:", selectedDepartment === "all" ? "Todos" : selectedDepartment]);
      data.push([]);
      data.push([]);
      data.push([`TRANSFERENCIAS SEM. ${weekNum}`]);
      data.push([]);
      data.push(["#", "Factura ID", "Factura", "Proveedor", "Contratistas", "Descripción", "IBAN", "Fecha vcto.", "Importe"]);

      let rowNum = 1;
      let total = 0;

      pendingInvoices.forEach(inv => {
        const supplier = suppliers.find(s => s.id === inv.supplierId);
        data.push([
          `01-${rowNum.toString().padStart(2, "0")}`,
          inv.displayNumber,
          inv.supplierNumber || "",
          inv.supplier,
          "",
          inv.description,
          supplier?.iban || "",
          inv.dueDate || "",
          inv.totalAmount
        ]);
        total += inv.totalAmount;
        rowNum++;
      });

      data.push(["", "", "", "", "", "", "", "Suma y sigue.-", total]);
      data.push([]);
      data.push(["", "", "", "", "", "", "", "Total.-", total]);

      downloadCSV(data, `Prevision_Pagos_${projectName.replace(/\s+/g, "_")}_SEM${weekNum}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== LIBRO DE FACTURAS ====================
  const generateInvoicesReport = async () => {
    setGenerating("invoices_list");
    try {
      const today = new Date();

      let filteredInvoices = [...invoices];
      if (selectedSupplier !== "all") {
        filteredInvoices = filteredInvoices.filter(i => i.supplierId === selectedSupplier);
      }
      if (selectedDepartment !== "all") {
        filteredInvoices = filteredInvoices.filter(i => i.department === selectedDepartment);
      }
      if (dateFrom) {
        const from = new Date(dateFrom);
        filteredInvoices = filteredInvoices.filter(i => i.createdAt >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        filteredInvoices = filteredInvoices.filter(i => i.createdAt <= to);
      }

      const data: any[][] = [];
      
      data.push([projectName, "", "", "", "", "", "", "", "", "", "LIBRO DE FACTURAS"]);
      data.push([]);
      data.push(["", "", "Fecha:", today, "Período:", dateFrom && dateTo ? `${dateFrom} - ${dateTo}` : "Todo"]);
      data.push([]);
      data.push([]);
      data.push(["#", "N.º Interno", "N.º Proveedor", "Tipo", "Proveedor", "NIF", "Descripción", "Fecha FCT", "Base", "IVA", "Total", "Estado", "Dpto."]);

      let totalBase = 0;
      let totalVat = 0;
      let totalAmount = 0;

      filteredInvoices.forEach((inv, idx) => {
        const supplier = suppliers.find(s => s.id === inv.supplierId);
        const typeLabels: Record<string, string> = {
          invoice: "Factura", proforma: "Proforma", ticket: "Ticket", autonomo: "Autónomo"
        };
        const statusLabels: Record<string, string> = {
          pending: "Pendiente", approved: "Aprobada", paid: "Pagada", 
          coding: "Codificando", accounted: "Contabilizada", rejected: "Rechazada"
        };
        
        data.push([
          idx + 1,
          inv.displayNumber,
          inv.supplierNumber || "",
          typeLabels[inv.documentType] || inv.documentType,
          inv.supplier,
          supplier?.taxId || "",
          inv.description,
          inv.invoiceDate || "",
          inv.baseAmount,
          inv.vatAmount,
          inv.totalAmount,
          statusLabels[inv.status] || inv.status,
          inv.department || ""
        ]);
        totalBase += inv.baseAmount;
        totalVat += inv.vatAmount;
        totalAmount += inv.totalAmount;
      });

      data.push([]);
      data.push(["", "", "", "", "", "", "TOTALES:", "", totalBase, totalVat, totalAmount, "", ""]);

      downloadCSV(data, `Libro_Facturas_${projectName.replace(/\s+/g, "_")}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== LISTADO POs ====================
  const generatePOsReport = async () => {
    setGenerating("pos_list");
    try {
      const today = new Date();

      let filteredPOs = [...pos];
      if (selectedSupplier !== "all") {
        filteredPOs = filteredPOs.filter(p => p.supplierId === selectedSupplier);
      }
      if (selectedDepartment !== "all") {
        filteredPOs = filteredPOs.filter(p => p.department === selectedDepartment);
      }
      if (dateFrom) {
        const from = new Date(dateFrom);
        filteredPOs = filteredPOs.filter(p => p.createdAt >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        filteredPOs = filteredPOs.filter(p => p.createdAt <= to);
      }

      const data: any[][] = [];
      
      data.push([projectName, "", "", "", "", "", "", "", "LISTADO DE POs"]);
      data.push([]);
      data.push(["", "", "Fecha:", today]);
      data.push([]);
      data.push([]);
      data.push(["#", "N.º PO", "Proveedor", "Descripción", "Departamento", "Fecha", "Estado", "Base", "Total"]);

      let totalBase = 0;
      let totalAmount = 0;

      const statusLabels: Record<string, string> = {
        draft: "Borrador", pending: "Pendiente", approved: "Aprobada", 
        rejected: "Rechazada", closed: "Cerrada", cancelled: "Anulada"
      };

      filteredPOs.forEach((po, idx) => {
        data.push([
          idx + 1,
          po.displayNumber,
          po.supplier,
          po.description,
          po.department || "",
          po.createdAt,
          statusLabels[po.status] || po.status,
          po.baseAmount,
          po.totalAmount
        ]);
        totalBase += po.baseAmount;
        totalAmount += po.totalAmount;
      });

      data.push([]);
      data.push(["", "", "", "", "", "TOTALES:", "", totalBase, totalAmount]);

      downloadCSV(data, `Listado_POs_${projectName.replace(/\s+/g, "_")}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== POs POR ITEMS ====================
  const generatePOsItemsReport = async () => {
    setGenerating("pos_items");
    try {
      const today = new Date();

      let filteredPOs = [...pos];
      if (selectedSupplier !== "all") {
        filteredPOs = filteredPOs.filter(p => p.supplierId === selectedSupplier);
      }
      if (selectedDepartment !== "all") {
        filteredPOs = filteredPOs.filter(p => p.department === selectedDepartment);
      }
      if (dateFrom) {
        const from = new Date(dateFrom);
        filteredPOs = filteredPOs.filter(p => p.createdAt >= from);
      }
      if (dateTo) {
        const to = new Date(dateTo);
        filteredPOs = filteredPOs.filter(p => p.createdAt <= to);
      }

      const data: any[][] = [];
      
      data.push([projectName, "", "", "", "", "", "", "", "", "", "", "POs POR ITEMS"]);
      data.push([]);
      data.push(["", "", "Fecha:", today]);
      data.push([]);
      data.push([]);
      data.push([
        "#", "N.º PO", "Proveedor", "Descripción PO", "Item", "Descripción Item", 
        "Cuenta", "Capítulo", "Base", "IVA", "IRPF", "Total", "Estado"
      ]);

      let totalBase = 0;
      let totalVat = 0;
      let totalIrpf = 0;
      let totalAmount = 0;
      let rowNum = 1;

      const statusLabels: Record<string, string> = {
        draft: "Borrador", pending: "Pendiente", approved: "Aprobada", 
        rejected: "Rechazada", closed: "Cerrada", cancelled: "Anulada"
      };

      filteredPOs.forEach((po) => {
        if (po.items && po.items.length > 0) {
          po.items.forEach((item: any, itemIdx: number) => {
            data.push([
              rowNum,
              po.displayNumber,
              po.supplier,
              po.description,
              itemIdx + 1,
              item.description || "",
              item.subAccountCode || "",
              item.episodeAssignment || "general",
              item.baseAmount || 0,
              item.vatAmount || 0,
              item.irpfAmount || 0,
              item.totalAmount || 0,
              statusLabels[po.status] || po.status
            ]);
            totalBase += item.baseAmount || 0;
            totalVat += item.vatAmount || 0;
            totalIrpf += item.irpfAmount || 0;
            totalAmount += item.totalAmount || 0;
            rowNum++;
          });
        } else {
          data.push([
            rowNum,
            po.displayNumber,
            po.supplier,
            po.description,
            1,
            po.description,
            "",
            "",
            po.baseAmount,
            0,
            0,
            po.totalAmount,
            statusLabels[po.status] || po.status
          ]);
          totalBase += po.baseAmount;
          totalAmount += po.totalAmount;
          rowNum++;
        }
      });

      data.push([]);
      data.push(["", "", "", "", "", "", "", "TOTALES:", totalBase, totalVat, totalIrpf, totalAmount, ""]);

      downloadCSV(data, `POs_Items_${projectName.replace(/\s+/g, "_")}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  // ==================== COSTES POR DEPARTAMENTO ====================
  const generateDepartmentReport = async () => {
    setGenerating("cost_by_department");
    try {
      const today = new Date();

      // Group invoices by department
      const byDept: Record<string, { invoices: Invoice[]; total: number }> = {};
      
      invoices.forEach(inv => {
        const dept = inv.department || "Sin departamento";
        if (!byDept[dept]) byDept[dept] = { invoices: [], total: 0 };
        byDept[dept].invoices.push(inv);
        byDept[dept].total += inv.totalAmount;
      });

      const data: any[][] = [];
      
      data.push([projectName, "", "", "", "", "", "COSTES POR DEPARTAMENTO"]);
      data.push([]);
      data.push(["", "", "Fecha:", today]);
      data.push([]);
      data.push([]);

      let grandTotal = 0;

      Object.entries(byDept).sort((a, b) => b[1].total - a[1].total).forEach(([dept, info]) => {
        data.push([dept.toUpperCase()]);
        data.push(["#", "Factura", "Proveedor", "Descripción", "Fecha", "Importe"]);
        
        info.invoices.forEach((inv, idx) => {
          data.push([
            idx + 1,
            inv.displayNumber,
            inv.supplier,
            inv.description,
            inv.invoiceDate || inv.createdAt,
            inv.totalAmount
          ]);
        });
        
        data.push(["", "", "", "", "Subtotal:", info.total]);
        data.push([]);
        grandTotal += info.total;
      });

      data.push(["", "", "", "", "TOTAL GENERAL:", grandTotal]);

      downloadCSV(data, `Costes_Departamento_${projectName.replace(/\s+/g, "_")}.csv`);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateReport = (reportId: string) => {
    switch (reportId) {
      case "supplier": generateSupplierReport(); break;
      case "pending_payments": generatePaymentsReport(); break;
      case "invoices_list": generateInvoicesReport(); break;
      case "pos_list": generatePOsReport(); break;
      case "pos_items": generatePOsItemsReport(); break;
      case "cost_by_department": generateDepartmentReport(); break;
    }
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess || accessError) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={24} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{accessError || "No tienes permisos"}</p>
          <Link href={`/project/${projectId}/accounting`} className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "#2F52E0" }}>
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  const colorClasses: Record<string, { bg: string; text: string; icon: string }> = {
    amber: { bg: "bg-amber-50", text: "text-amber-600", icon: "text-amber-500" },
    blue: { bg: "bg-blue-50", text: "text-blue-600", icon: "text-blue-500" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", icon: "text-emerald-500" },
    violet: { bg: "bg-violet-50", text: "text-violet-600", icon: "text-violet-500" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-600", icon: "text-indigo-500" },
    rose: { bg: "bg-rose-50", text: "text-rose-600", icon: "text-rose-500" },
  };

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <FileSpreadsheet size={24} style={{ color: "#2F52E0" }} />
              <h1 className="text-2xl font-semibold text-slate-900">Informes</h1>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-6 p-4 bg-slate-50 rounded-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={16} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Filtros</span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Proveedor</label>
                <select
                  value={selectedSupplier}
                  onChange={(e) => setSelectedSupplier(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="all">Todos</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.fiscalName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Departamento</label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="all">Todos</option>
                  {departments.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Desde</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Reports Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
            {REPORTS.map((report) => {
              const Icon = report.icon;
              const colors = colorClasses[report.color];
              const isGenerating = generating === report.id;
              
              return (
                <div
                  key={report.id}
                  className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-slate-300 hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-12 h-12 ${colors.bg} rounded-xl flex items-center justify-center`}>
                      <Icon size={24} className={colors.icon} />
                    </div>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mb-1">{report.title}</h3>
                  <p className="text-sm text-slate-500 mb-4">{report.description}</p>
                  <button
                    onClick={() => handleGenerateReport(report.id)}
                    disabled={isGenerating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <Download size={16} />
                        Descargar Excel
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Stats */}
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900">{suppliers.length}</p>
              <p className="text-sm text-slate-500">Proveedores</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900">{pos.length}</p>
              <p className="text-sm text-slate-500">Órdenes de compra</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900">{invoices.length}</p>
              <p className="text-sm text-slate-500">Facturas</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-2xl font-bold text-slate-900">{formatCurrency(invoices.reduce((sum, i) => sum + i.totalAmount, 0))} €</p>
              <p className="text-sm text-slate-500">Total facturado</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
