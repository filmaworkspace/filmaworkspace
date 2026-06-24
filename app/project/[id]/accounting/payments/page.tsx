"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertTriangle,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Filter,
  FolderOpen,
  GripVertical,
  HelpCircle,
  Landmark,
  LayoutGrid,
  List,
  MoreHorizontal,
  PiggyBank,
  Plus,
  Receipt,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import jsPDF from "jspdf";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";


// ─── Constants ───────────────────────────────────────────────────────────────

function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

const PAYMENT_TYPES = {
  invoice: { label: "Pago de factura", icon: Receipt, color: "emerald" },
  partial: { label: "Pago parcial", icon: CircleDollarSign, color: "blue" },
  proforma: { label: "Pago de proforma", icon: FileText, color: "violet" },
  budget: { label: "Pago de presupuesto", icon: Wallet, color: "amber" },
  deposit: { label: "Pago de depósito", icon: PiggyBank, color: "indigo" },
  guarantee: { label: "Pago de fianza", icon: Shield, color: "slate" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentType = keyof typeof PAYMENT_TYPES;

interface Invoice {
  id: string;
  number: string;
  displayNumber?: string;
  supplier: string;
  supplierId: string;
  description: string;
  totalAmount: number;
  baseAmount: number;
  status: string;
  dueDate: Date;
  createdAt: Date;
  department?: string;
}

interface PaymentItem {
  id: string;
  type: PaymentType;
  invoiceId?: string;
  invoiceNumber?: string;
  supplier: string;
  supplierId?: string;
  description: string;
  amount: number;
  partialAmount?: number;
  department?: string;
  addedBy: string;
  addedByName: string;
  addedAt: Date;
  status: "pending" | "completed";
  receiptUrl?: string;
  receiptName?: string;
  completedAt?: Date;
  completedBy?: string;
  completedByName?: string;
}

interface PaymentForecast {
  id: string;
  name: string;
  paymentDate: Date;
  type: "remesa" | "fuera_remesa";
  status: "draft" | "pending" | "completed";
  items: PaymentItem[];
  totalAmount: number;
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "draft", label: "Borrador" },
  { value: "pending", label: "Pendiente" },
  { value: "completed", label: "Completada" },
];

const DATE_RANGE_OPTIONS = [
  { value: "all", label: "Todas las fechas" },
  { value: "this_week", label: "Esta semana" },
  { value: "next_15", label: "Próximos 15 días" },
  { value: "this_month", label: "Este mes" },
  { value: "next_month", label: "Próximo mes" },
];

const INVOICE_FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "overdue", label: "Vencidas" },
  { value: "week", label: "Vence esta semana" },
  { value: "month", label: "Vence este mes" },
];

const INVOICE_SORT_OPTIONS = [
  { value: "dueDate", label: "Vencimiento" },
  { value: "amount", label: "Importe (mayor)" },
  { value: "supplier", label: "Proveedor A-Z" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { loading: permissionsLoading, permissions } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [forecasts, setForecasts] = useState<PaymentForecast[]>([]);
  const [availableInvoices, setAvailableInvoices] = useState<Invoice[]>([]);
  const [invoiceIbans, setInvoiceIbans] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  
  const [invoicesPanelExpanded, setInvoicesPanelExpanded] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceDueDateFilter, setInvoiceDueDateFilter] = useState("all");
  const [invoiceSortBy, setInvoiceSortBy] = useState<"dueDate" | "amount" | "supplier">("dueDate");
  
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [showInvoiceFilterDropdown, setShowInvoiceFilterDropdown] = useState(false);
  const [showInvoiceSortDropdown, setShowInvoiceSortDropdown] = useState(false);
  
  const [showInvoiceStatusSearch, setShowInvoiceStatusSearch] = useState(false);
  const [invoiceStatusSearchTerm, setInvoiceStatusSearchTerm] = useState("");
  const [invoiceStatusResult, setInvoiceStatusResult] = useState<{
    found: boolean;
    invoice?: any;
    status?: string;
    forecast?: PaymentForecast | null;
    paidAmount?: number;
    pendingAmount?: number;
  } | null>(null);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [showForecastDetail, setShowForecastDetail] = useState<PaymentForecast | null>(null);
  const [newForecast, setNewForecast] = useState({ name: "", paymentDate: "", type: "remesa" as "remesa" | "fuera_remesa" });
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null);
  const [newPayment, setNewPayment] = useState({ type: "invoice" as PaymentType, invoiceId: "", supplier: "", description: "", amount: 0, partialAmount: 0 });
  
  const [draggedInvoice, setDraggedInvoice] = useState<Invoice | null>(null);
  const [dragOverForecast, setDragOverForecast] = useState<string | null>(null);
  
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const invoiceFilterRef = useRef<HTMLDivElement>(null);
  const invoiceSortRef = useRef<HTMLDivElement>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setUserId(user.uid);
        setUserName(user.displayName || user.email || "Usuario");
      } else {
        router.push("/");
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && id) loadData();
  }, [userId, id]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-container")) { setOpenMenuId(null); setMenuPosition(null); }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) setShowStatusDropdown(false);
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(target)) setShowDateDropdown(false);
      if (invoiceFilterRef.current && !invoiceFilterRef.current.contains(target)) setShowInvoiceFilterDropdown(false);
      if (invoiceSortRef.current && !invoiceSortRef.current.contains(target)) setShowInvoiceSortDropdown(false);
      if (!target.closest(".custom-dropdown")) setOpenDropdown(null);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      const forecastsSnap = await getDocs(query(collection(db, "projects/" + id + "/paymentForecasts"), orderBy("paymentDate", "asc")));
      const forecastsData = forecastsSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          name: data.name,
          paymentDate: data.paymentDate?.toDate() || new Date(),
          type: data.type,
          status: data.status,
          totalAmount: data.totalAmount || 0,
          notes: data.notes,
          createdAt: data.createdAt?.toDate() || new Date(),
          createdBy: data.createdBy,
          createdByName: data.createdByName,
          items: (data.items || []).map((item: any) => ({
            ...item,
            addedAt: item.addedAt?.toDate ? item.addedAt.toDate() : new Date(),
            completedAt: item.completedAt?.toDate ? item.completedAt.toDate() : undefined,
            status: item.status || "pending",
          })),
        } as PaymentForecast;
      });
      setForecasts(forecastsData);

      const invoicesSnap = await getDocs(query(collection(db, "projects/" + id + "/invoices"), orderBy("dueDate", "asc")));
      const assignedInvoiceIds = new Set<string>();
      forecastsData.forEach((f) => f.items.forEach((item) => { if (item.invoiceId) assignedInvoiceIds.add(item.invoiceId); }));

      const invoicesData = invoicesSnap.docs
        .filter((docSnap) => {
          const data = docSnap.data();
          return (data.status === "pending" || data.status === "overdue" || data.status === "pending_approval") && !assignedInvoiceIds.has(docSnap.id);
        })
        .map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
          dueDate: docSnap.data().dueDate?.toDate() || new Date(),
          createdAt: docSnap.data().createdAt?.toDate() || new Date(),
        })) as Invoice[];

      // Enriquecer nombres de proveedor desde la colección suppliers cuando
      // el campo supplier de la factura esté vacío pero haya supplierId.
      const missingNameIds = [...new Set(
        invoicesData.filter(inv => inv.supplierId && !inv.supplier).map(inv => inv.supplierId!)
      )];
      if (missingNameIds.length > 0) {
        const supplierSnaps = await Promise.all(
          missingNameIds.map(sid => getDoc(doc(db, `projects/${id}/suppliers`, sid)))
        );
        const nameMap: Record<string, string> = {};
        supplierSnaps.forEach((snap, idx) => {
          if (snap.exists()) nameMap[missingNameIds[idx]] = snap.data().name || "";
        });
        invoicesData.forEach(inv => {
          if (inv.supplierId && nameMap[inv.supplierId]) inv.supplier = nameMap[inv.supplierId];
        });
      }

      setAvailableInvoices(invoicesData);

      // Cargar estado IBAN de todos los suppliers para mostrar indicador en el panel
      const allSupplierIds = [...new Set(
        invoicesData.filter(inv => inv.supplierId).map(inv => inv.supplierId!)
      )];
      if (allSupplierIds.length > 0) {
        const ibanSnaps = await Promise.all(
          allSupplierIds.map(sid => getDoc(doc(db, `projects/${id}/suppliers`, sid)))
        );
        const ibanMap: Record<string, boolean> = {};
        ibanSnaps.forEach((snap, idx) => {
          ibanMap[allSupplierIds[idx]] = !!(snap.exists() && snap.data().iban);
        });
        setInvoiceIbans(ibanMap);
      }
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error al cargar los datos");
    } finally {
      setLoading(false);
    }
  };

  const getDateRangeFilter = () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (dateRange) {
      case "this_week": {
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + (7 - today.getDay()));
        return { start: today, end: endOfWeek };
      }
      case "next_15": {
        const end = new Date(today);
        end.setDate(today.getDate() + 15);
        return { start: today, end };
      }
      case "this_month": {
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        return { start: today, end: endOfMonth };
      }
      case "next_month": {
        const startNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        const endNextMonth = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        return { start: startNextMonth, end: endNextMonth };
      }
      default:
        return { start: null, end: null };
    }
  };

  const getDaysUntilPayment = (date: Date) => Math.ceil((date.getTime() - Date.now()) / 86400000);

  const filteredForecasts = forecasts.filter((f) => {
    const matchesSearch = f.name.toLowerCase().includes(searchTerm.toLowerCase()) || f.items.some((item) => item.supplier.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesStatus = statusFilter === "all" || f.status === statusFilter;
    const { start, end } = getDateRangeFilter();
    const matchesDate = (!start || f.paymentDate >= start) && (!end || f.paymentDate <= end);
    return matchesSearch && matchesStatus && matchesDate;
  });

  const filteredInvoices = availableInvoices
    .filter((inv) => {
      const searchLower = invoiceSearch.toLowerCase().trim();
      if (searchLower) {
        const matchesNumber = (inv.displayNumber || inv.number || "").toLowerCase().includes(searchLower);
        const matchesSupplier = inv.supplier.toLowerCase().includes(searchLower);
        const matchesDescription = (inv.description || "").toLowerCase().includes(searchLower);
        if (!matchesNumber && !matchesSupplier && !matchesDescription) return false;
      }
      if (invoiceDueDateFilter === "all") return true;
      const days = getDaysUntilPayment(inv.dueDate);
      if (invoiceDueDateFilter === "overdue") return days < 0;
      if (invoiceDueDateFilter === "week") return days >= 0 && days <= 7;
      if (invoiceDueDateFilter === "month") return days >= 0 && days <= 30;
      return true;
    })
    .sort((a, b) => {
      if (invoiceSortBy === "dueDate") return a.dueDate.getTime() - b.dueDate.getTime();
      if (invoiceSortBy === "amount") return b.totalAmount - a.totalAmount;
      if (invoiceSortBy === "supplier") return a.supplier.localeCompare(b.supplier);
      return 0;
    });

  const invoiceStats = {
    total: availableInvoices.length,
    filtered: filteredInvoices.length,
    overdue: availableInvoices.filter((inv) => getDaysUntilPayment(inv.dueDate) < 0).length,
    dueSoon: availableInvoices.filter((inv) => { const d = getDaysUntilPayment(inv.dueDate); return d >= 0 && d <= 7; }).length,
    totalAmount: filteredInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
  };

  const hasActiveInvoiceFilters = invoiceSearch || invoiceDueDateFilter !== "all";
  const clearInvoiceFilters = () => { setInvoiceSearch(""); setInvoiceDueDateFilter("all"); setInvoiceSortBy("dueDate"); };

  const searchInvoiceStatus = async () => {
    if (!invoiceStatusSearchTerm.trim()) return;
    const searchLower = invoiceStatusSearchTerm.toLowerCase().trim();
    
    // Buscar en facturas disponibles (pendientes de asignar)
    const foundAvailable = availableInvoices.find(inv => 
      inv.number.toLowerCase().includes(searchLower) || 
      (inv.displayNumber && inv.displayNumber.toLowerCase().includes(searchLower)) ||
      inv.supplier.toLowerCase().includes(searchLower)
    );
    
    if (foundAvailable) {
      setInvoiceStatusResult({
        found: true,
        invoice: foundAvailable,
        status: "pending_assignment",
        forecast: null,
        paidAmount: 0,
        pendingAmount: foundAvailable.totalAmount
      });
      return;
    }
    
    // Buscar en facturas asignadas a previsiones
    for (const forecast of forecasts) {
      const foundItem = forecast.items.find(item => 
        item.invoiceNumber?.toLowerCase().includes(searchLower) ||
        item.supplier.toLowerCase().includes(searchLower)
      );
      if (foundItem) {
        const isPaid = foundItem.status === "completed";
        setInvoiceStatusResult({
          found: true,
          invoice: foundItem,
          status: isPaid ? "paid" : (forecast.status === "completed" ? "paid" : "scheduled"),
          forecast: forecast,
          paidAmount: isPaid ? foundItem.amount : 0,
          pendingAmount: isPaid ? 0 : foundItem.amount
        });
        return;
      }
    }
    
    // No encontrada
    setInvoiceStatusResult({ found: false });
  };

  const handleCreateForecast = async () => {
    if (!newForecast.name.trim() || !newForecast.paymentDate) { showToast("error", "Completa todos los campos"); return; }
    try {
      await addDoc(collection(db, "projects/" + id + "/paymentForecasts"), {
        name: newForecast.name.trim(),
        paymentDate: Timestamp.fromDate(new Date(newForecast.paymentDate)),
        type: newForecast.type, status: "draft", items: [], totalAmount: 0,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      setShowCreateModal(false);
      setNewForecast({ name: "", paymentDate: "", type: "remesa" });
      showToast("success", "Previsión creada");
      loadData();
    } catch (error) { console.error("Error:", error); showToast("error", "Error al crear la previsión"); }
  };

  const handleAddPaymentToForecast = async (forecastId: string, invoice?: Invoice) => {
    const forecast = forecasts.find((f) => f.id === forecastId);
    if (!forecast || forecast.status !== "draft") { showToast("error", "Solo se pueden añadir pagos a borradores"); return; }
    const paymentItem: PaymentItem = {
      id: "item_" + Date.now(), type: invoice ? "invoice" : newPayment.type,
      invoiceId: invoice?.id || newPayment.invoiceId || undefined,
      invoiceNumber: invoice?.number || undefined,
      supplier: invoice?.supplier || newPayment.supplier,
      supplierId: invoice?.supplierId || undefined,
      description: invoice?.description || newPayment.description,
      amount: invoice?.totalAmount || newPayment.amount,
      department: invoice?.department, addedBy: userId!, addedByName: userName, addedAt: new Date(), status: "pending",
    };
    if (newPayment.type === "partial" && newPayment.partialAmount > 0) {
      paymentItem.partialAmount = newPayment.partialAmount;
      paymentItem.amount = newPayment.partialAmount;
    }
    const updatedItems = [...forecast.items, paymentItem];
    const totalAmount = updatedItems.reduce((sum, item) => sum + (item.partialAmount || item.amount), 0);
    try {
      await updateDoc(doc(db, "projects/" + id + "/paymentForecasts", forecastId), { items: updatedItems, totalAmount });
      setShowAddPaymentModal(false); setSelectedForecastId(null);
      setNewPayment({ type: "invoice", invoiceId: "", supplier: "", description: "", amount: 0, partialAmount: 0 });
      showToast("success", "Pago añadido"); loadData();
    } catch (error) { console.error("Error:", error); showToast("error", "Error al añadir el pago"); }
  };

  const handleRemovePaymentItem = async (forecastId: string, itemId: string) => {
    const forecast = forecasts.find((f) => f.id === forecastId);
    if (!forecast || forecast.status !== "draft") return;
    const updatedItems = forecast.items.filter((item) => item.id !== itemId);
    const totalAmount = updatedItems.reduce((sum, item) => sum + (item.partialAmount || item.amount), 0);
    try {
      await updateDoc(doc(db, "projects/" + id + "/paymentForecasts", forecastId), { items: updatedItems, totalAmount });
      showToast("success", "Pago eliminado"); loadData();
    } catch (error) { console.error("Error:", error); }
  };

  const handleSendForecast = async (forecastId: string) => {
    const forecast = forecasts.find((f) => f.id === forecastId);
    if (!forecast || forecast.status !== "draft" || forecast.items.length === 0) { showToast("error", "Añade al menos un pago antes de enviar"); return; }
    try {
      await updateDoc(doc(db, "projects/" + id + "/paymentForecasts", forecastId), { status: "pending" });
      showToast("success", "Previsión enviada"); loadData();
    } catch (error) { console.error("Error:", error); }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDeleteForecast = async (forecastId: string) => {
    const forecast = forecasts.find((f) => f.id === forecastId);
    if (!forecast) return;
    if (forecast.items.some((item) => item.status === "completed")) { showToast("error", "No se puede eliminar una previsión con pagos completados"); return; }
    openConfirm(
      "Eliminar previsión de pago",
      "¿Estás seguro de que quieres eliminar esta previsión de pago? Esta acción no se puede deshacer.",
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, "projects/" + id + "/paymentForecasts", forecastId));
          showToast("success", "Previsión eliminada"); loadData();
        } catch (error) { console.error("Error:", error); }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const handleDragStart = (invoice: Invoice) => setDraggedInvoice(invoice);
  const handleDragOver = (e: React.DragEvent, forecastId: string) => { e.preventDefault(); const forecast = forecasts.find((f) => f.id === forecastId); if (forecast?.status === "draft") setDragOverForecast(forecastId); };
  const handleDragLeave = () => setDragOverForecast(null);
  const handleDrop = async (e: React.DragEvent, forecastId: string) => { e.preventDefault(); setDragOverForecast(null); if (draggedInvoice) { await handleAddPaymentToForecast(forecastId, draggedInvoice); setDraggedInvoice(null); } };

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  const formatDate = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";
  const formatDateShort = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(date) : "-";
  const formatDateTime = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";
  const formatDateForFile = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date).replace(/\//g, "-") : "";

  const getStatusConfig = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string; icon: typeof Edit3 }> = {
      draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit3 },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente", icon: Clock },
      completed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completada", icon: CheckCircle2 },
    };
    return config[status] || config.draft;
  };

  const getTypeConfig = (type: "remesa" | "fuera_remesa") => type === "remesa" ? { bg: "bg-slate-100", text: "text-slate-600", label: "Remesa", icon: Landmark } : { bg: "bg-slate-100", text: "text-slate-600", label: "Fuera de remesa", icon: Banknote };

  const getCompletionProgress = (forecast: PaymentForecast) => {
    if (forecast.items.length === 0) return { completed: 0, total: 0, percent: 0 };
    const completed = forecast.items.filter((item) => item.status === "completed").length;
    return { completed, total: forecast.items.length, percent: Math.round((completed / forecast.items.length) * 100) };
  };

  const toggleRowExpanded = (forecastId: string) => { const newExpanded = new Set(expandedRows); if (newExpanded.has(forecastId)) newExpanded.delete(forecastId); else newExpanded.add(forecastId); setExpandedRows(newExpanded); };

  const exportForecastPDF = (forecast: PaymentForecast) => {
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;
    pdf.setFillColor(30, 41, 59); pdf.rect(0, 0, pageWidth, 45, "F");
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(24); pdf.setFont("helvetica", "bold");
    pdf.text("PREVISIÓN DE PAGO", margin, 20);
    pdf.setFontSize(14); pdf.text(forecast.name, margin, 32);
    pdf.setFontSize(10); pdf.text(forecast.type === "remesa" ? "REMESA BANCARIA" : "FUERA DE REMESA", margin, 40);
    y = 55;
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin, y, (pageWidth - margin * 2 - 10) / 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139); pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
    pdf.text("FECHA DE PAGO", margin + 5, y + 8);
    pdf.setTextColor(30, 41, 59); pdf.setFontSize(12);
    pdf.text(formatDate(forecast.paymentDate), margin + 5, y + 18);
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin + (pageWidth - margin * 2 - 10) / 2 + 10, y, (pageWidth - margin * 2 - 10) / 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139); pdf.setFontSize(8); pdf.setFont("helvetica", "bold");
    pdf.text("IMPORTE TOTAL", margin + (pageWidth - margin * 2 - 10) / 2 + 15, y + 8);
    pdf.setTextColor(30, 41, 59); pdf.setFontSize(12);
    pdf.text(formatCurrency(forecast.totalAmount) + " €", margin + (pageWidth - margin * 2 - 10) / 2 + 15, y + 18);
    y += 35;
    pdf.setTextColor(100, 116, 139); pdf.setFontSize(8);
    pdf.text("ESTADO: " + getStatusConfig(forecast.status).label.toUpperCase(), margin, y);
    y += 10;
    pdf.setTextColor(30, 41, 59); pdf.setFontSize(10); pdf.setFont("helvetica", "bold");
    pdf.text("PAGOS (" + forecast.items.length + ")", margin, y);
    y += 8;
    forecast.items.forEach((item, index) => {
      if (y > 260) { pdf.addPage(); y = margin; }
      pdf.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 20, 0, 0, "F");
      pdf.setTextColor(30, 41, 59); pdf.setFontSize(9); pdf.setFont("helvetica", "bold");
      pdf.text((item.invoiceNumber ? "FRA-" + item.invoiceNumber : item.description).substring(0, 40), margin + 5, y + 7);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
      pdf.text(item.supplier.substring(0, 40), margin + 5, y + 14);
      if (item.status === "completed") { pdf.setTextColor(16, 185, 129); pdf.text("Completado", pageWidth - margin - 50, y + 7); }
      else { pdf.setTextColor(245, 158, 11); pdf.text("Pendiente", pageWidth - margin - 50, y + 7); }
      pdf.setTextColor(30, 41, 59); pdf.setFontSize(10); pdf.setFont("helvetica", "bold");
      pdf.text(formatCurrency(item.partialAmount || item.amount) + " €", pageWidth - margin - 5, y + 14, { align: "right" });
      y += 22;
    });
    y += 10;
    pdf.setTextColor(100, 116, 139); pdf.setFontSize(8); pdf.setFont("helvetica", "normal");
    pdf.text("Generado el " + formatDateTime(new Date()) + " - Creado por " + forecast.createdByName, margin, y);
    pdf.save("Prevision_" + forecast.name.replace(/\s+/g, "_") + "_" + formatDateForFile(forecast.paymentDate) + ".pdf");
  };

  // Verificar permisos - solo accounting_extended puede acceder
  const canAccessPayments = permissions.accountingAccessLevel === "accounting_extended";

  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccessPayments) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ShieldAlert size={32} className="text-red-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Acceso restringido</h1>
          <p className="text-slate-500 mb-6">
            No tienes permisos para acceder a la gestión de pagos. Esta sección está disponible únicamente para usuarios con nivel de acceso "Contabilidad ampliada".
          </p>
          <button
            onClick={() => router.push(`/project/${id}/accounting`)}
            className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            Volver al panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      {toast && (
        <div className={cx("fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2", toast.type === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white")}>
          {toast.type === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.message}
        </div>
      )}

      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Banknote size={24} style={{ color: "#2F52E0" }} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Previsiones de pago</h1>
                <p className="text-sm text-slate-500 mt-0.5">{forecasts.length} previsiones · {formatCurrency(forecasts.reduce((s, f) => s + f.totalAmount, 0))} € total</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => { setShowInvoiceStatusSearch(true); setInvoiceStatusSearchTerm(""); setInvoiceStatusResult(null); }}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <HelpCircle size={16} />
                Consultar factura
              </button>
              <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: "#2F52E0" }}>
                <Plus size={16} strokeWidth={2.5} />
                Nueva previsión
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {invoiceStats.overdue > 0 && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0"><AlertTriangle size={20} className="text-red-600" /></div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">{invoiceStats.overdue} factura{invoiceStats.overdue > 1 ? "s" : ""} vencida{invoiceStats.overdue > 1 ? "s" : ""} sin asignar</h3>
                <p className="text-sm text-red-700">Asígnalas a una previsión de pago para evitar retrasos.</p>
              </div>
              <button onClick={() => setInvoicesPanelExpanded(true)} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 flex-shrink-0">Ver facturas</button>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center mb-6">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar previsión o proveedor" className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" />
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <div className="relative" ref={statusDropdownRef}>
              <button onClick={() => setShowStatusDropdown(!showStatusDropdown)} className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm hover:border-slate-300 bg-white min-w-[160px]">
                <Filter size={14} className="text-slate-400" />
                <span className="flex-1 text-left text-xs text-slate-700">{STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}</span>
                <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showStatusDropdown && "rotate-180")} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-full">
                  {STATUS_OPTIONS.map((option) => (
                    <button key={option.value} onClick={() => { setStatusFilter(option.value); setShowStatusDropdown(false); }} className={cx("w-full text-left px-4 py-2.5 text-sm transition-colors", statusFilter === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>{option.label}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="relative" ref={dateDropdownRef}>
              <button onClick={() => setShowDateDropdown(!showDateDropdown)} className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm hover:border-slate-300 bg-white min-w-[160px]">
                <Calendar size={14} className="text-slate-400" />
                <span className="flex-1 text-left text-xs text-slate-700">{DATE_RANGE_OPTIONS.find(o => o.value === dateRange)?.label}</span>
                <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showDateDropdown && "rotate-180")} />
              </button>
              {showDateDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-full">
                  {DATE_RANGE_OPTIONS.map((option) => (
                    <button key={option.value} onClick={() => { setDateRange(option.value); setShowDateDropdown(false); }} className={cx("w-full text-left px-4 py-2.5 text-sm transition-colors", dateRange === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>{option.label}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex border border-slate-200 rounded-xl overflow-hidden bg-white">
              <button onClick={() => setViewMode("kanban")} className={cx("px-3 py-2.5 text-sm transition-colors", viewMode === "kanban" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}><LayoutGrid size={16} /></button>
              <button onClick={() => setViewMode("list")} className={cx("px-3 py-2.5 text-sm transition-colors border-l border-slate-200", viewMode === "list" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50")}><List size={16} /></button>
            </div>
          </div>
        </div>

        <div className="flex gap-6">
          <div className={cx("flex-shrink-0 transition-all duration-300", invoicesPanelExpanded ? "w-80" : "w-20")}>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden sticky top-24">
              {!invoicesPanelExpanded ? (
                <button onClick={() => setInvoicesPanelExpanded(true)} className="w-full p-4 flex flex-col items-center gap-2 hover:bg-slate-50 transition-colors">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center"><Receipt size={16} className="text-slate-600" /></div>
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-bold text-slate-900">{invoiceStats.total}</span>
                    <span className="text-[10px] text-slate-500 text-center leading-tight">Facturas<br/>pendientes</span>
                  </div>
                  {invoiceStats.overdue > 0 && (<span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">{invoiceStats.overdue} vencidas</span>)}
                  <ChevronRight size={14} className="text-slate-400 mt-1" />
                </button>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center"><Receipt size={16} className="text-slate-600" /></div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-sm">Facturas pendientes</h3>
                          <p className="text-xs text-slate-500">{invoiceStats.filtered} de {invoiceStats.total}</p>
                        </div>
                      </div>
                      <button onClick={() => setInvoicesPanelExpanded(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"><X size={14} /></button>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => setInvoiceDueDateFilter(invoiceDueDateFilter === "overdue" ? "all" : "overdue")} className={cx("flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all", invoiceDueDateFilter === "overdue" ? "bg-red-100 text-red-700 ring-1 ring-red-200" : "bg-white text-slate-600 hover:bg-slate-100")}><span className="text-red-600 font-bold">{invoiceStats.overdue}</span> vencidas</button>
                      <button onClick={() => setInvoiceDueDateFilter(invoiceDueDateFilter === "week" ? "all" : "week")} className={cx("flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all", invoiceDueDateFilter === "week" ? "bg-amber-100 text-amber-700 ring-1 ring-amber-200" : "bg-white text-slate-600 hover:bg-slate-100")}><span className="text-amber-600 font-bold">{invoiceStats.dueSoon}</span> próximas</button>
                    </div>
                  </div>
                  <div className="p-3 border-b border-slate-100">
                    <div className="relative mb-2">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="text" value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} placeholder="Buscar factura" className="w-full pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white" />
                      {invoiceSearch && (<button onClick={() => setInvoiceSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"><X size={12} /></button>)}
                    </div>
                    <div className="flex gap-2">
                      <div className="relative flex-1" ref={invoiceFilterRef}>
                        <button onClick={() => setShowInvoiceFilterDropdown(!showInvoiceFilterDropdown)} className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white hover:border-slate-300">
                          <span className="text-slate-600">{INVOICE_FILTER_OPTIONS.find(o => o.value === invoiceDueDateFilter)?.label}</span>
                          <ChevronDown size={12} className="text-slate-400" />
                        </button>
                        {showInvoiceFilterDropdown && (
                          <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                            {INVOICE_FILTER_OPTIONS.map((option) => (
                              <button key={option.value} onClick={() => { setInvoiceDueDateFilter(option.value); setShowInvoiceFilterDropdown(false); }} className={cx("w-full text-left px-3 py-2 text-xs transition-colors", invoiceDueDateFilter === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>{option.label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="relative flex-1" ref={invoiceSortRef}>
                        <button onClick={() => setShowInvoiceSortDropdown(!showInvoiceSortDropdown)} className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white hover:border-slate-300">
                          <span className="text-slate-600">{INVOICE_SORT_OPTIONS.find(o => o.value === invoiceSortBy)?.label}</span>
                          <ChevronDown size={12} className="text-slate-400" />
                        </button>
                        {showInvoiceSortDropdown && (
                          <div className="absolute top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                            {INVOICE_SORT_OPTIONS.map((option) => (
                              <button key={option.value} onClick={() => { setInvoiceSortBy(option.value as "dueDate" | "amount" | "supplier"); setShowInvoiceSortDropdown(false); }} className={cx("w-full text-left px-3 py-2 text-xs transition-colors", invoiceSortBy === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50")}>{option.label}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {hasActiveInvoiceFilters && (<button onClick={clearInvoiceFilters} className="w-full mt-2 px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1"><X size={10} />Limpiar filtros</button>)}
                  </div>
                  <div className="max-h-[400px] overflow-y-auto">
                    {filteredInvoices.length === 0 ? (
                      <div className="text-center py-10 px-4">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">{hasActiveInvoiceFilters ? <Search size={20} className="text-slate-400" /> : <CheckCircle2 size={20} className="text-emerald-500" />}</div>
                        <p className="text-sm font-medium text-slate-700">{hasActiveInvoiceFilters ? "Sin resultados" : "¡Todo al día!"}</p>
                        <p className="text-xs text-slate-500 mt-1">{hasActiveInvoiceFilters ? "Prueba con otros filtros" : "No hay facturas pendientes"}</p>
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {filteredInvoices.slice(0, 30).map((invoice) => {
                          const days = getDaysUntilPayment(invoice.dueDate);
                          const isOverdue = days < 0;
                          const isDueSoon = days >= 0 && days <= 7;
                          const hasIban = invoice.supplierId
                            ? invoiceIbans[invoice.supplierId] ?? true
                            : true;
                          return (
                            <div key={invoice.id} draggable onDragStart={() => handleDragStart(invoice)} onDragEnd={() => setDraggedInvoice(null)} className={cx("p-3 rounded-xl cursor-grab active:cursor-grabbing transition-all border group", draggedInvoice?.id === invoice.id ? "opacity-50 scale-95 border-slate-400" : "border-transparent", isOverdue ? "bg-red-50 hover:bg-red-100" : "bg-slate-50 hover:bg-slate-100")}>
                              <div className="flex items-start gap-2">
                                <div className={cx("w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5", isOverdue ? "bg-red-100" : "bg-slate-200")}><GripVertical size={10} className={isOverdue ? "text-red-400" : "text-slate-400"} /></div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-900 truncate font-mono">{invoice.displayNumber || ("FRA-" + invoice.number)}</p>
                                      <p className="text-[11px] text-slate-600 truncate">{invoice.supplier || "—"}</p>
                                    </div>
                                    <p className="text-xs font-bold text-slate-900 flex-shrink-0">{formatCurrency(invoice.totalAmount)} €</p>
                                  </div>
                                  <div className="flex items-center justify-between mt-1.5">
                                    <span className={cx("text-[10px] px-1.5 py-0.5 rounded-full font-medium", isOverdue ? "bg-red-100 text-red-700" : isDueSoon ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600")}>{isOverdue ? ("Vencida " + Math.abs(days) + "d") : isDueSoon ? (days + "d") : formatDateShort(invoice.dueDate)}</span>
                                    <div className="flex items-center gap-1.5">
                                      {!hasIban && (
                                        <span className="text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-medium">Sin IBAN</span>
                                      )}
                                      <span className="text-[9px] text-slate-400 opacity-0 group-hover:opacity-100">Arrastra →</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {filteredInvoices.length > 30 && (<div className="text-center py-2"><p className="text-[10px] text-slate-500">+{filteredInvoices.length - 30} facturas más</p></div>)}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex-1">
            {filteredForecasts.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Banknote size={28} className="text-slate-400" /></div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{searchTerm || statusFilter !== "all" || dateRange !== "all" ? "No se encontraron resultados" : "Sin previsiones de pago"}</h3>
                <p className="text-slate-500 text-sm">{searchTerm || statusFilter !== "all" || dateRange !== "all" ? "Prueba a ajustar los filtros" : "Crea tu primera previsión para organizar los pagos"}</p>
              </div>
            ) : viewMode === "kanban" ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredForecasts.map((forecast) => {
                  const statusConfig = getStatusConfig(forecast.status);
                  const typeConfig = getTypeConfig(forecast.type);
                  const daysUntil = getDaysUntilPayment(forecast.paymentDate);
                  const progress = getCompletionProgress(forecast);
                  const StatusIcon = statusConfig.icon;
                  const TypeIcon = typeConfig.icon;
                  return (
                    <div key={forecast.id} onDragOver={(e) => handleDragOver(e, forecast.id)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, forecast.id)} className={cx("bg-white border rounded-2xl overflow-hidden transition-all", dragOverForecast === forecast.id && forecast.status === "draft" ? "border-emerald-400 ring-2 ring-emerald-100 scale-[1.01]" : "border-slate-200 hover:shadow-md")}>
                      <div className="px-4 py-3 border-b border-slate-100">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-slate-900 truncate">{forecast.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar size={12} className="text-slate-400" />
                              <span className={cx("text-xs", daysUntil < 0 ? "text-red-600 font-semibold" : daysUntil <= 3 ? "text-amber-600 font-semibold" : "text-slate-500")}>{formatDate(forecast.paymentDate)}{daysUntil >= 0 && daysUntil <= 7 ? (" (" + daysUntil + "d)") : ""}{daysUntil < 0 ? (" (hace " + Math.abs(daysUntil) + "d)") : ""}</span>
                            </div>
                          </div>
                          <div className="relative menu-container">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openMenuId === forecast.id) {
                                  setOpenMenuId(null);
                                  setMenuPosition(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                  setOpenMenuId(forecast.id);
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {openMenuId === forecast.id && menuPosition && (
                              <div
                                className="fixed w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] py-1"
                                style={{ top: menuPosition.top, right: menuPosition.right }}
                              >
                                <button onClick={() => { setShowForecastDetail(forecast); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Eye size={14} /> Ver detalles</button>
                                <button onClick={() => { exportForecastPDF(forecast); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Download size={14} /> Exportar PDF</button>
                                {forecast.status === "draft" && (<><button onClick={() => { setSelectedForecastId(forecast.id); setShowAddPaymentModal(true); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Plus size={14} /> Añadir pago</button>{forecast.items.length > 0 && (<button onClick={() => { handleSendForecast(forecast.id); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2"><Send size={14} /> Enviar</button>)}</>)}
                                {(forecast.status === "pending" || forecast.status === "completed") && (<button onClick={() => { router.push("/project/" + id + "/accounting/payments/" + forecast.id + "/pay"); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-emerald-600 hover:bg-emerald-50 flex items-center gap-2"><Banknote size={14} /> {forecast.status === "completed" ? "Ver pagos" : "Ir a pagar"}</button>)}
                                <div className="border-t border-slate-100 my-1" />
                                <button onClick={() => { handleDeleteForecast(forecast.id); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14} /> Eliminar</button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", statusConfig.bg, statusConfig.text)}><StatusIcon size={12} />{statusConfig.label}</span>
                          <span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", typeConfig.bg, typeConfig.text)}><TypeIcon size={12} />{typeConfig.label}</span>
                        </div>
                      </div>
                      <div className="p-2 min-h-[80px] max-h-[180px] overflow-y-auto bg-slate-50/50">
                        {forecast.items.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-center py-4"><div><div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center mx-auto mb-2"><FolderOpen size={14} className="text-slate-400" /></div><p className="text-[10px] text-slate-400">Arrastra facturas aquí</p></div></div>
                        ) : (
                          <div className="space-y-1">
                            {forecast.items.map((item) => {
                              const typeInfo = PAYMENT_TYPES[item.type];
                              const ItemIcon = typeInfo.icon;
                              return (
                                <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors group">
                                  <div className="flex items-start gap-2">
                                    <div className={cx("w-5 h-5 rounded flex items-center justify-center flex-shrink-0", item.status === "completed" ? "bg-emerald-100" : "bg-slate-100")}>{item.status === "completed" ? <CheckCircle2 size={10} className="text-emerald-600" /> : <ItemIcon size={10} className="text-slate-500" />}</div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-1">
                                        <p className="text-[11px] font-medium text-slate-900 truncate font-mono">{item.invoiceNumber ? ("FRA-" + item.invoiceNumber) : item.description}</p>
                                        {forecast.status === "draft" && (<button onClick={() => handleRemovePaymentItem(forecast.id, item.id)} className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={10} /></button>)}
                                      </div>
                                      <div className="flex items-center justify-between mt-0.5">
                                        <span className="text-[10px] text-slate-500 truncate">{item.supplier}</span>
                                        <span className="text-[11px] font-semibold text-slate-900">{formatCurrency(item.partialAmount || item.amount)} €</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="px-4 py-3 border-t border-slate-100 bg-white">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">{forecast.items.length} pagos</span>
                          <span className="text-sm font-bold text-slate-900">{formatCurrency(forecast.totalAmount)} €</span>
                        </div>
                        {forecast.status !== "draft" && forecast.items.length > 0 && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: progress.percent + "%" }} /></div>
                            <span className="text-[10px] text-slate-500">{progress.completed}/{progress.total}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Previsión</th>
                      <th className="text-left px-4 py-4 text-xs font-semibold text-slate-500 uppercase">Fecha</th>
                      <th className="text-left px-4 py-4 text-xs font-semibold text-slate-500 uppercase">Tipo</th>
                      <th className="text-left px-4 py-4 text-xs font-semibold text-slate-500 uppercase">Estado</th>
                      <th className="text-center px-4 py-4 text-xs font-semibold text-slate-500 uppercase">Progreso</th>
                      <th className="text-right px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Importe</th>
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredForecasts.map((forecast) => {
                      const statusConfig = getStatusConfig(forecast.status);
                      const typeConfig = getTypeConfig(forecast.type);
                      const progress = getCompletionProgress(forecast);
                      const StatusIcon = statusConfig.icon;
                      const TypeIcon = typeConfig.icon;
                      const isExpanded = expandedRows.has(forecast.id);
                      return (
                        <React.Fragment key={forecast.id}>
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <button onClick={() => toggleRowExpanded(forecast.id)} className="text-left hover:text-[#2F52E0] flex items-center gap-2 group/row">
                                <ChevronRight size={16} className={cx("text-slate-400 transition-transform", isExpanded && "rotate-90")} />
                                <div><p className="font-semibold text-slate-900 group-hover/row:text-[#2F52E0] transition-colors">{forecast.name}</p><p className="text-xs text-slate-500 mt-0.5">{forecast.items.length} pagos</p></div>
                              </button>
                            </td>
                            <td className="px-4 py-4"><div className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /><span className="text-sm text-slate-700">{formatDate(forecast.paymentDate)}</span></div></td>
                            <td className="px-4 py-4"><span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", typeConfig.bg, typeConfig.text)}><TypeIcon size={12} />{typeConfig.label}</span></td>
                            <td className="px-4 py-4"><span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", statusConfig.bg, statusConfig.text)}><StatusIcon size={12} />{statusConfig.label}</span></td>
                            <td className="px-4 py-4">{forecast.items.length > 0 ? (<div className="flex items-center gap-2 justify-center"><div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: progress.percent + "%" }} /></div><span className="text-xs text-slate-500">{progress.completed}/{progress.total}</span></div>) : (<span className="text-xs text-slate-400">-</span>)}</td>
                            <td className="px-6 py-4 text-right"><span className="text-sm font-bold text-slate-900">{formatCurrency(forecast.totalAmount)} €</span></td>
                            <td className="px-4 py-4"><button onClick={() => setShowForecastDetail(forecast)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Eye size={16} /></button></td>
                          </tr>
                          {isExpanded && forecast.items.length > 0 && (
                            <tr><td colSpan={7} className="bg-slate-50 px-6 py-4">
                              <div className="space-y-2">
                                {forecast.items.map((item) => {
                                  const typeInfo = PAYMENT_TYPES[item.type];
                                  const ItemIcon = typeInfo.icon;
                                  return (
                                    <div key={item.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                                      <div className="flex items-center gap-3">
                                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center", item.status === "completed" ? "bg-emerald-100" : "bg-slate-100")}>{item.status === "completed" ? <CheckCircle2 size={16} className="text-emerald-600" /> : <ItemIcon size={16} className="text-slate-500" />}</div>
                                        <div><p className="text-sm font-medium text-slate-900 font-mono">{item.invoiceNumber ? ("FRA-" + item.invoiceNumber) : item.description}</p><p className="text-xs text-slate-500">{item.supplier}</p></div>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <span className={cx("text-xs px-2 py-1 rounded-lg", item.status === "completed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{item.status === "completed" ? "Completado" : "Pendiente"}</span>
                                        <span className="text-sm font-semibold text-slate-900">{formatCurrency(item.partialAmount || item.amount)} €</span>
                                        {item.receiptUrl && (<a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-slate-400 hover:text-slate-700"><ExternalLink size={14} /></a>)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva previsión de pago</h3>
              <button onClick={() => setShowCreateModal(false)} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la previsión</label>
                <input type="text" value={newForecast.name} onChange={(e) => setNewForecast({ ...newForecast, name: e.target.value })} placeholder="Nombre de la remesa" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fecha de pago</label>
                <input type="date" value={newForecast.paymentDate} onChange={(e) => setNewForecast({ ...newForecast, paymentDate: e.target.value })} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de pago</label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setNewForecast({ ...newForecast, type: "remesa" })} className={cx("p-4 rounded-xl border-2 transition-all text-left", newForecast.type === "remesa" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}>
                    <Landmark size={20} className={newForecast.type === "remesa" ? "text-slate-900" : "text-slate-400"} />
                    <p className="font-semibold text-slate-900 mt-2">Remesa</p>
                    <p className="text-xs text-slate-500 mt-1">Pago bancario agrupado</p>
                  </button>
                  <button type="button" onClick={() => setNewForecast({ ...newForecast, type: "fuera_remesa" })} className={cx("p-4 rounded-xl border-2 transition-all text-left", newForecast.type === "fuera_remesa" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}>
                    <Banknote size={20} className={newForecast.type === "fuera_remesa" ? "text-slate-900" : "text-slate-400"} />
                    <p className="font-semibold text-slate-900 mt-2">Fuera de remesa</p>
                    <p className="text-xs text-slate-500 mt-1">Transferencia individual</p>
                  </button>
                </div>
              </div>
              <button onClick={handleCreateForecast} disabled={!newForecast.name.trim() || !newForecast.paymentDate} className="w-full mt-4 px-4 py-3 text-white rounded-xl font-medium transition-opacity disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>Crear previsión</button>
            </div>
          </div>
        </div>
      )}

      {showAddPaymentModal && selectedForecastId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowAddPaymentModal(false); setSelectedForecastId(null); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Añadir pago</h3>
              <button onClick={() => { setShowAddPaymentModal(false); setSelectedForecastId(null); }} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de pago</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(PAYMENT_TYPES).map(([key, value]) => {
                    const Icon = value.icon;
                    return (
                      <button key={key} type="button" onClick={() => setNewPayment({ ...newPayment, type: key as PaymentType })} className={cx("p-3 rounded-xl border-2 transition-all text-left", newPayment.type === key ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300")}>
                        <Icon size={16} className={newPayment.type === key ? "text-slate-900" : "text-slate-400"} />
                        <p className="font-medium text-slate-900 text-sm mt-1">{value.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
              {(newPayment.type === "invoice" || newPayment.type === "partial") && availableInvoices.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Seleccionar factura</label>
                  <div className="relative custom-dropdown">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown(openDropdown === "invoiceSelect" ? null : "invoiceSelect")}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                    >
                      <span className="text-slate-900 truncate">
                        {newPayment.invoiceId
                          ? (() => { const inv = availableInvoices.find(i => i.id === newPayment.invoiceId); return inv ? `${inv.displayNumber || "FRA-" + inv.number} · ${inv.supplier} · ${formatCurrency(inv.totalAmount)} €` : "Seleccionar..."; })()
                          : "Seleccionar..."}
                      </span>
                      <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === "invoiceSelect" ? "rotate-180" : ""}`} />
                    </button>
                    {openDropdown === "invoiceSelect" && (
                      <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => { setNewPayment({ ...newPayment, invoiceId: "" }); setOpenDropdown(null); }}
                          className={`w-full px-4 py-2 text-left text-sm transition-colors ${!newPayment.invoiceId ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                        >
                          Seleccionar...
                        </button>
                        {availableInvoices.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            onClick={() => { setNewPayment({ ...newPayment, invoiceId: inv.id, supplier: inv.supplier, description: inv.description, amount: inv.totalAmount }); setOpenDropdown(null); }}
                            className={`w-full px-4 py-2 text-left text-sm transition-colors ${newPayment.invoiceId === inv.id ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            {inv.displayNumber || ("FRA-" + inv.number)} · {inv.supplier} · {formatCurrency(inv.totalAmount)} €
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {newPayment.type === "partial" && newPayment.invoiceId && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Importe parcial (de {formatCurrency(newPayment.amount)} €)</label>
                  <input type="number" value={newPayment.partialAmount || ""} onChange={(e) => setNewPayment({ ...newPayment, partialAmount: parseFloat(e.target.value) || 0 })} placeholder="0.00" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
              )}
              {newPayment.type !== "invoice" && newPayment.type !== "partial" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor</label>
                    <input type="text" value={newPayment.supplier} onChange={(e) => setNewPayment({ ...newPayment, supplier: e.target.value })} placeholder="Nombre del proveedor" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                    <input type="text" value={newPayment.description} onChange={(e) => setNewPayment({ ...newPayment, description: e.target.value })} placeholder="Concepto del pago" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Importe</label>
                    <input type="number" value={newPayment.amount || ""} onChange={(e) => setNewPayment({ ...newPayment, amount: parseFloat(e.target.value) || 0 })} placeholder="0.00" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                </>
              )}
              <button onClick={() => handleAddPaymentToForecast(selectedForecastId)} disabled={(newPayment.type === "invoice" && !newPayment.invoiceId) || (newPayment.type === "partial" && (!newPayment.invoiceId || !newPayment.partialAmount)) || (newPayment.type !== "invoice" && newPayment.type !== "partial" && (!newPayment.supplier || !newPayment.amount))} className="w-full mt-4 px-4 py-3 text-white rounded-xl font-medium transition-opacity disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>Añadir pago</button>
            </div>
          </div>
        </div>
      )}

      {showForecastDetail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowForecastDetail(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-slate-900">{showForecastDetail.name}</h3>
                  {(() => { const config = getStatusConfig(showForecastDetail.status); const Icon = config.icon; return (<span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", config.bg, config.text)}><Icon size={12} />{config.label}</span>); })()}
                </div>
                <p className="text-sm text-slate-500">Creada por {showForecastDetail.createdByName} · {formatDate(showForecastDetail.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => exportForecastPDF(showForecastDetail)} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg" title="Exportar PDF"><Download size={18} /></button>
                <button onClick={() => setShowForecastDetail(null)} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-50 rounded-xl p-4"><p className="text-xs text-slate-500 mb-1">Fecha de pago</p><p className="text-lg font-bold text-slate-900">{formatDate(showForecastDetail.paymentDate)}</p></div>
                <div className="bg-slate-50 rounded-xl p-4"><p className="text-xs text-slate-500 mb-1">Total</p><p className="text-lg font-bold text-slate-900">{formatCurrency(showForecastDetail.totalAmount)} €</p></div>
                <div className="bg-slate-50 rounded-xl p-4"><p className="text-xs text-slate-500 mb-1">Progreso</p>{(() => { const progress = getCompletionProgress(showForecastDetail); return (<div className="flex items-center gap-2"><div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: progress.percent + "%" }} /></div><span className="text-sm font-bold text-slate-900">{progress.completed}/{progress.total}</span></div>); })()}</div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-700 uppercase mb-3">Pagos ({showForecastDetail.items.length})</h4>
                {showForecastDetail.items.length === 0 ? (
                  <div className="text-center py-8 bg-slate-50 rounded-xl"><FolderOpen size={24} className="text-slate-400 mx-auto mb-2" /><p className="text-sm text-slate-500">Sin pagos añadidos</p></div>
                ) : (
                  <div className="space-y-2">
                    {showForecastDetail.items.map((item) => {
                      const typeInfo = PAYMENT_TYPES[item.type];
                      const ItemIcon = typeInfo.icon;
                      return (
                        <div key={item.id} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                          <div className="flex items-start gap-3">
                            <div className={cx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", item.status === "completed" ? "bg-emerald-100" : "bg-slate-100")}>{item.status === "completed" ? <CheckCircle2 size={18} className="text-emerald-600" /> : <ItemIcon size={18} className="text-slate-500" />}</div>
                            <div className="flex-1">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-semibold text-slate-900 font-mono">{item.invoiceNumber ? ("FRA-" + item.invoiceNumber) : item.description}</p>
                                  <p className="text-sm text-slate-600">{item.supplier}</p>
                                  <p className="text-xs text-slate-400 mt-1">{typeInfo.label} · Añadido por {item.addedByName}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-lg font-bold text-slate-900">{formatCurrency(item.partialAmount || item.amount)} €</p>
                                  <span className={cx("text-xs px-2 py-1 rounded-lg", item.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{item.status === "completed" ? "Completado" : "Pendiente"}</span>
                                </div>
                              </div>
                              <div className="mt-3 pt-3 border-t border-slate-200">
                                {item.status === "completed" && item.receiptUrl ? (
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm text-emerald-700"><FileCheck size={14} /><span>{item.receiptName || "Justificante"}</span></div>
                                    <a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">Ver <ExternalLink size={12} /></a>
                                  </div>
                                ) : item.status === "completed" ? (
                                  <p className="text-xs text-emerald-600">✓ Completado el {formatDate(item.completedAt!)} por {item.completedByName}</p>
                                ) : (
                                  <p className="text-xs text-slate-400">Pendiente de pago</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              {showForecastDetail.status === "draft" && showForecastDetail.items.length > 0 && (
                <button onClick={() => { handleSendForecast(showForecastDetail.id); setShowForecastDetail(null); }} className="px-4 py-2 text-sm bg-amber-500 text-white hover:bg-amber-600 rounded-lg flex items-center gap-2"><Send size={14} />Enviar</button>
              )}
              {showForecastDetail.status === "draft" && (
                <button onClick={() => { setSelectedForecastId(showForecastDetail.id); setShowAddPaymentModal(true); setShowForecastDetail(null); }} className="px-4 py-2 text-sm text-white hover:opacity-90 rounded-lg flex items-center gap-2" style={{ backgroundColor: "#2F52E0" }}><Plus size={14} />Añadir pago</button>
              )}
              {showForecastDetail.status === "pending" && (
                <button onClick={() => router.push("/project/" + id + "/accounting/payments/" + showForecastDetail.id + "/pay")} className="px-4 py-2 text-sm bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg flex items-center gap-2"><Banknote size={14} />Ir a pagar</button>
              )}
              {showForecastDetail.status === "completed" && (
                <button onClick={() => router.push("/project/" + id + "/accounting/payments/" + showForecastDetail.id + "/pay")} className="px-4 py-2 text-sm bg-slate-700 text-white hover:bg-slate-800 rounded-lg flex items-center gap-2"><Eye size={14} />Ver pagos</button>
              )}
              <button onClick={() => setShowForecastDetail(null)} className="px-4 py-2 text-sm border border-slate-200 text-slate-700 hover:bg-white rounded-lg">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de consulta de estado de factura */}
      {showInvoiceStatusSearch && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowInvoiceStatusSearch(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(47, 82, 224, 0.1)' }}>
                  <HelpCircle size={20} style={{ color: '#2F52E0' }} />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Consultar estado de factura</h3>
              </div>
              <button onClick={() => setShowInvoiceStatusSearch(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6">
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={invoiceStatusSearchTerm}
                  onChange={(e) => { setInvoiceStatusSearchTerm(e.target.value); setInvoiceStatusResult(null); }}
                  onKeyDown={(e) => e.key === "Enter" && searchInvoiceStatus()}
                  placeholder="Número de factura o proveedor"
                  className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                  autoFocus
                />
              </div>
              <button
                onClick={searchInvoiceStatus}
                disabled={!invoiceStatusSearchTerm.trim()}
                className="w-full px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: '#2F52E0' }}
              >
                Buscar
              </button>

              {invoiceStatusResult && (
                <div className="mt-6">
                  {!invoiceStatusResult.found ? (
                    <div className="text-center py-6">
                      <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                        <Search size={20} className="text-slate-400" />
                      </div>
                      <p className="text-sm text-slate-500">No se encontró ninguna factura con ese criterio</p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-400 uppercase">Factura</span>
                        <span className="text-sm font-semibold text-slate-900">{invoiceStatusResult.invoice?.invoiceNumber || invoiceStatusResult.invoice?.displayNumber || invoiceStatusResult.invoice?.number}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-400 uppercase">Proveedor</span>
                        <span className="text-sm text-slate-700">{invoiceStatusResult.invoice?.supplier}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-400 uppercase">Importe</span>
                        <span className="text-sm font-semibold text-slate-900">{formatCurrency(invoiceStatusResult.invoice?.totalAmount || invoiceStatusResult.invoice?.amount || 0)} €</span>
                      </div>
                      <div className="border-t border-slate-200 pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-400 uppercase">Estado</span>
                          {invoiceStatusResult.status === "paid" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold">
                              <CheckCircle2 size={12} />
                              Pagada
                            </span>
                          )}
                          {invoiceStatusResult.status === "scheduled" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-semibold">
                              <Clock size={12} />
                              Programada
                            </span>
                          )}
                          {invoiceStatusResult.status === "pending_assignment" && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">
                              <Receipt size={12} />
                              Sin asignar
                            </span>
                          )}
                        </div>
                        {invoiceStatusResult.forecast && (
                          <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200">
                            <p className="text-xs text-slate-500 mb-1">Asignada a previsión:</p>
                            <p className="text-sm font-medium text-slate-900">{invoiceStatusResult.forecast.name}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              Fecha de pago: {formatDate(invoiceStatusResult.forecast.paymentDate)}
                            </p>
                          </div>
                        )}
                        {invoiceStatusResult.status === "pending_assignment" && (
                          <p className="text-xs text-slate-500 mt-3">Esta factura aún no ha sido asignada a ninguna previsión de pago.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
