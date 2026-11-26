"use client";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import { Button, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, Segmented, Select } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
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
  Wallet,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";


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
  cash_funding: { label: "Reposición de caja", icon: Wallet, color: "slate" },
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
  const [payField, setPayField] = useState<"all" | "name" | "supplier" | "invoice" | "amount">("all");
  const PAY_FIELDS: SearchField<"all" | "name" | "supplier" | "invoice" | "amount">[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Previsión, proveedor o factura" },
    { value: "name", label: "Previsión", placeholder: "Ej. Remesa 15 nov" },
    { value: "supplier", label: "Proveedor", placeholder: "Ej. Rental Norte" },
    { value: "invoice", label: "Nº factura", placeholder: "Ej. FRA-0001", mono: true },
    { value: "amount", label: "Importe", placeholder: "1500 · >1000 · 500-2000", mono: true },
  ];
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
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(showCreateModal || showAddPaymentModal || !!showForecastDetail || showInvoiceStatusSearch || !!confirmDialog);

  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const invoiceFilterRef = useRef<HTMLDivElement>(null);
  const invoiceSortRef = useRef<HTMLDivElement>(null);

  const showToast = (type: "success" | "error" | "warning" | "info", message: string) => { if (type === "error") appToast.error(message); else appToast[type](message); };

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
  const [openDropdownPos, setOpenDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // Facturas pagadas sin justificante (lo que contabilidad echa en falta).
  const [noReceipt, setNoReceipt] = useState<{ id: string; number: string; supplier: string; total: number; paidAt?: Date; forecastId?: string; supplierNumber?: string }[]>([]);
  const [showNoReceipt, setShowNoReceipt] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState<string | null>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const bulkReceiptInput = useRef<HTMLInputElement>(null);
  const receiptTarget = useRef<string | null>(null);

  const attachReceipt = async (invoiceId: string, file: File) => {
    const inv = noReceipt.find((x) => x.id === invoiceId);
    if (!inv) return;
    const r = storageRef(storage, `projects/${id}/receipts/${inv.forecastId || "sin-prevision"}/${invoiceId}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}`);
    await uploadBytes(r, file, { contentType: file.type || undefined });
    const url = await getDownloadURL(r);
    await updateDoc(doc(db, `projects/${id}/invoices`, invoiceId), { receiptUrl: url, receiptName: file.name, receiptUploadedAt: Timestamp.now() });
    // También en el pago de la previsión, si lo hay.
    if (inv.forecastId) {
      const f = forecasts.find((x) => x.id === inv.forecastId);
      if (f) {
        const items = f.items.map((it) => (it.invoiceId === invoiceId && it.status === "completed" && !it.receiptUrl ? { ...it, receiptUrl: url, receiptName: file.name } : it));
        await updateDoc(doc(db, `projects/${id}/paymentForecasts`, f.id), {
          items: items.map((it) => Object.fromEntries(Object.entries({ ...it, addedAt: it.addedAt instanceof Date ? Timestamp.fromDate(it.addedAt) : it.addedAt, completedAt: it.completedAt instanceof Date ? Timestamp.fromDate(it.completedAt) : it.completedAt ?? null }).filter(([, v]) => v !== undefined))),
        }).catch(() => {});
      }
    }
    setNoReceipt((list) => list.filter((x) => x.id !== invoiceId));
  };
  const uploadOne = async (invoiceId: string, file: File) => {
    setUploadingReceipt(invoiceId);
    try { await attachReceipt(invoiceId, file); appToast.success("Justificante guardado"); } catch (e) { appToast.error(e); } finally { setUploadingReceipt(null); }
  };
  const uploadMany = async (files: File[]) => {
    const { matchReceipt } = await import("@/lib/payments/matchReceipts");
    const taken = new Set<string>();
    let ok = 0;
    const left: string[] = [];
    setUploadingReceipt("bulk");
    try {
      for (const file of files) {
        const m = matchReceipt(file.name, "", noReceipt.map((x) => ({ id: x.id, supplier: x.supplier, amount: x.total, numbers: [x.number, x.supplierNumber || ""].filter(Boolean) })), taken);
        if (m.itemId) { taken.add(m.itemId); await attachReceipt(m.itemId, file); ok++; } else left.push(file.name);
      }
      if (ok) appToast.success(`${ok} ${ok === 1 ? "justificante guardado" : "justificantes guardados"}`);
      if (left.length) appToast.error(`Sin coincidencia: ${left.join(", ")}. Súbelos en su fila.`);
    } catch (e) { appToast.error(e); } finally { setUploadingReceipt(null); }
  };

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
      setNoReceipt(invoicesSnap.docs
        .filter((d) => { const x = d.data(); return (x.paidAt || x.status === "paid") && !x.receiptUrl && x.paymentMethod !== "card" && !["cancelled", "void"].includes(x.status); })
        .map((d) => { const x = d.data(); return { id: d.id, number: x.displayNumber || x.number || "", supplier: x.supplier || "", total: x.paidAmount || x.totalAmount || 0, paidAt: x.paidAt?.toDate?.(), forecastId: x.paymentForecastId || undefined, supplierNumber: x.supplierNumber || "" }; }));
      const assignedInvoiceIds = new Set<string>();
      forecastsData.forEach((f) => f.items.forEach((item) => { if (item.invoiceId) assignedInvoiceIds.add(item.invoiceId); }));

      const invoicesData = invoicesSnap.docs
        .filter((docSnap) => {
          const data = docSnap.data();
          // Pagable: cualquier factura activa sin paidAt, sin importar si está codificada/aprobada/contabilizada.
          if (assignedInvoiceIds.has(docSnap.id)) return false;
          if (data.paidAt) return false;
          if (["cancelled", "rejected", "void", "draft", "paid"].includes(data.status)) return false;
          return ["submitted", "pending", "pending_approval", "coded", "overdue", "accounted"].includes(data.status);
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
      showToast("error", "No se ha podido cargar los datos");
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
    const q = searchTerm.trim();
    const byName = matchWords(q, f.name);
    const bySupplier = f.items.some((item) => matchWords(q, item.supplier));
    const byInvoice = f.items.some((item: any) => matchCode(q, item.invoiceNumber));
    const byAmount = matchAmount(q, f.totalAmount, ...f.items.map((i: any) => i.amount || 0)) === true;
    const matchesSearch = !q || (payField === "name" ? byName : payField === "supplier" ? bySupplier : payField === "invoice" ? byInvoice : payField === "amount" ? byAmount : byName || bySupplier || byInvoice || byAmount);
    const matchesStatus = statusFilter === "all" || f.status === statusFilter;
    const { start, end } = getDateRangeFilter();
    const matchesDate = (!start || f.paymentDate >= start) && (!end || f.paymentDate <= end);
    return matchesSearch && matchesStatus && matchesDate;
  });

  const filteredInvoices = availableInvoices
    .filter((inv) => {
      const q = invoiceSearch.trim();
      if (q && !(matchCode(q, inv.displayNumber, inv.number) || matchWords(q, inv.supplier, inv.description) || matchAmount(q, inv.totalAmount) === true)) return false;
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
    } catch (error) { console.error("Error:", error); showToast("error", "No se ha podido crear la previsión"); }
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
    } catch (error) { console.error("Error:", error); showToast("error", "No se ha podido añadir el pago"); }
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

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);
  const formatDate = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";
  const formatDateShort = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(date) : "-";
  const formatDateTime = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-";
  const formatDateForFile = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date).replace(/\//g, "-") : "";

  const getStatusConfig = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string; icon: typeof Edit3 }> = {
      draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit3 },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente", icon: Clock },
      completed: { bg: "bg-[#F7F7F8]", text: "text-slate-900", label: "Completada", icon: CheckCircle2 },
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


  // Verificar permisos - solo accounting_extended puede acceder
  const canAccessPayments = permissions.accountingAccessLevel === "accounting_extended";

  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (!canAccessPayments) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md mx-auto px-6">
          <div className="hidden">
            <ShieldAlert size={32} className="text-red-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Acceso restringido</h1>
          <p className="text-slate-500 mb-6">
            No tienes permisos para acceder a la gestión de pagos. Esta sección está disponible únicamente para usuarios con nivel de acceso &quot;Contabilidad ampliada&quot;.
          </p>
          <button
            onClick={() => router.push(`/project/${id}/accounting`)}
            className="px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
          >
            Volver al panel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>

      <main className="px-6 pb-24 pt-[85px] sm:px-10">
        <PageHeader
          title={<>Pagos <span className="text-[15px] font-normal text-slate-400">{forecasts.length}</span></>}
          actions={
            <>
              <Button variant="ghost" onClick={() => { setShowInvoiceStatusSearch(true); setInvoiceStatusSearchTerm(""); setInvoiceStatusResult(null); }}>Consultar factura</Button>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}><Plus size={14} /> Nueva previsión</Button>
            </>
          }
        />

        {noReceipt.length > 0 && (
          <button type="button" onClick={() => setShowNoReceipt(true)}
            className="mt-5 flex w-full items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-left text-[13px] hover:bg-amber-100/60">
            <span className="text-amber-900"><span className="font-medium tabular-nums">{noReceipt.length}</span> {noReceipt.length === 1 ? "factura pagada sin justificante" : "facturas pagadas sin justificante"}: contabilidad las necesita</span>
            <span className="text-xs font-medium text-slate-900">Subir justificantes</span>
          </button>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <SearchBar fields={PAY_FIELDS} field={payField} onField={setPayField} value={searchTerm} onChange={setSearchTerm} count={filteredForecasts.length} />
          <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="w-44">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="w-44">
            <Select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
              {DATE_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <Segmented value={viewMode} onChange={setViewMode} options={[{ value: "kanban", label: "Tablero" }, { value: "list", label: "Lista" }]} />
          </div>
        </div>

        <div className="mt-5 flex flex-col items-start gap-6 lg:flex-row">
          {/* Facturas por asignar */}
          <aside className="w-full flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 lg:sticky lg:top-[85px] lg:w-80">
            <div className="flex flex-col gap-2 border-b border-slate-200 bg-[#FAFAFA] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600">Por asignar <span className="font-normal text-slate-400">{invoiceStats.total}</span></span>
                <div className="w-32">
                  <Select value={invoiceSortBy} onChange={(e) => setInvoiceSortBy(e.target.value as "dueDate" | "amount" | "supplier")}>
                    {INVOICE_SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
              <Input value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} placeholder="Número, proveedor o importe" />
              <div className="flex gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 text-xs">
                {([["all", "Todas", invoiceStats.total], ["overdue", "Vencidas", invoiceStats.overdue], ["week", "7 días", invoiceStats.dueSoon]] as const).map(([v, l, n]) => (
                  <button
                    key={v}
                    onClick={() => setInvoiceDueDateFilter(v)}
                    className={`flex h-6 flex-1 items-center justify-center gap-1 rounded-[5px] ${invoiceDueDateFilter === v ? "bg-[#F4F4F5] font-medium text-slate-900" : "text-slate-600 hover:text-slate-900"} ${v === "overdue" && n > 0 && invoiceDueDateFilter !== v ? "text-red-700" : ""}`}
                  >
                    {l} <span className="tabular-nums text-slate-400">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
              {filteredInvoices.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-slate-500">{hasActiveInvoiceFilters ? "Sin resultados" : "Todo asignado"}</p>
              ) : (
                filteredInvoices.slice(0, 60).map((invoice) => {
                  const days = getDaysUntilPayment(invoice.dueDate);
                  const hasIban = invoice.supplierId ? invoiceIbans[invoice.supplierId] ?? true : true;
                  const targets = forecasts.filter((f) => f.status === "draft" || f.status === "pending");
                  return (
                    <div
                      key={invoice.id}
                      draggable
                      onDragStart={() => handleDragStart(invoice)}
                      onDragEnd={() => setDraggedInvoice(null)}
                      className={`group flex cursor-grab items-start gap-2 border-b border-slate-100 px-3 py-2 last:border-0 hover:bg-[#FAFAFA] active:cursor-grabbing ${draggedInvoice?.id === invoice.id ? "opacity-40" : ""}`}
                    >
                      <GripVertical size={12} className="mt-1 flex-shrink-0 text-slate-300" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-mono text-xs font-medium">{invoice.displayNumber || `FRA-${invoice.number}`}</span>
                          <span className="tabular-nums text-xs">{formatCurrency(invoice.totalAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span className="truncate">{invoice.supplier || "—"}</span>
                          <span className={`flex-shrink-0 ${days < 0 ? "text-red-700" : days <= 7 ? "text-amber-800" : ""}`}>
                            {days < 0 ? `vencida ${-days} d` : days === 0 ? "hoy" : days <= 7 ? `en ${days} d` : formatDateShort(invoice.dueDate)}
                          </span>
                        </div>
                        {!hasIban && <span className="text-[10px] text-amber-800">Proveedor sin IBAN</span>}
                      </div>
                      {targets.length > 0 && (
                        <Menu trigger={(toggle) => <IconButton label="Añadir a una previsión" onClick={toggle} className="-my-1 opacity-0 group-hover:opacity-100 focus:opacity-100"><Plus size={14} /></IconButton>}>
                          {(close) => (
                            <>
                              {targets.map((f) => (
                                <MenuItem key={f.id} onClick={() => { close(); handleAddPaymentToForecast(f.id, invoice); }}>
                                  {f.name} <span className="ml-1 text-slate-400">{formatDateShort(f.paymentDate)}</span>
                                </MenuItem>
                              ))}
                            </>
                          )}
                        </Menu>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            {filteredForecasts.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-lg p-16 text-center">
                <div className="hidden"><Banknote size={28} className="text-slate-400" /></div>
                <h3 className="text-[14px] font-semibold text-slate-900 mb-2">{searchTerm || statusFilter !== "all" || dateRange !== "all" ? "No se encontraron resultados" : "Sin previsiones de pago"}</h3>
                {(searchTerm || statusFilter !== "all" || dateRange !== "all") && <p className="text-slate-500 text-[13px]">Prueba a ajustar los filtros</p>}
              </div>
            ) : viewMode === "kanban" ? (
              <div className="grid grid-cols-3 gap-4">
                {filteredForecasts.map((forecast) => {
                  const statusConfig = getStatusConfig(forecast.status);
                  const typeConfig = getTypeConfig(forecast.type);
                  const daysUntil = getDaysUntilPayment(forecast.paymentDate);
                  const progress = getCompletionProgress(forecast);
                  const StatusIcon = statusConfig.icon;
                  const TypeIcon = typeConfig.icon;
                  return (
                    <div key={forecast.id} onDragOver={(e) => handleDragOver(e, forecast.id)} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, forecast.id)} className={cx("bg-white border rounded-lg overflow-hidden transition-all", dragOverForecast === forecast.id && forecast.status === "draft" ? "border-[#2F52E0] ring-2 ring-[#2F52E0]/15 scale-[1.01]" : "border-slate-200 hover:shadow-md")}>
                      <div className="px-4 py-3 border-b border-slate-100">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-slate-900 truncate">{forecast.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Calendar size={12} className="text-slate-400" />
                              <span className={cx("text-xs", forecast.status === "completed" ? "text-slate-500" : daysUntil < 0 ? "text-red-700 font-medium" : daysUntil <= 3 ? "text-amber-800 font-medium" : "text-slate-500")}>{formatDate(forecast.paymentDate)}{forecast.status !== "completed" && (daysUntil === 0 ? " · hoy" : daysUntil > 0 && daysUntil <= 7 ? ` · en ${daysUntil} d` : daysUntil < 0 ? ` · hace ${-daysUntil} d` : "")}</span>
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
                                className="fixed w-48 bg-white border border-slate-200 rounded-md shadow-xl z-[9999] py-1"
                                style={{ top: menuPosition.top, right: menuPosition.right }}
                              >
                                <button onClick={() => { setShowForecastDetail(forecast); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Eye size={14} /> Ver detalles</button>
                                {forecast.status === "draft" && (<><button onClick={() => { setSelectedForecastId(forecast.id); setShowAddPaymentModal(true); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Plus size={14} /> Añadir pago</button>{forecast.items.length > 0 && (<button onClick={() => { handleSendForecast(forecast.id); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-[13px] text-amber-600 hover:bg-amber-50 flex items-center gap-2"><Send size={14} /> Enviar</button>)}</>)}
                                {(forecast.status === "pending" || forecast.status === "completed") && (<button onClick={() => { router.push("/project/" + id + "/accounting/payments/" + forecast.id + "/pay"); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-[13px] text-[#2F52E0] hover:bg-[#F7F7F8] flex items-center gap-2"><Banknote size={14} /> {forecast.status === "completed" ? "Ver pagos" : "Ir a pagar"}</button>)}
                                <div className="border-t border-slate-100 my-1" />
                                <button onClick={() => { handleDeleteForecast(forecast.id); setOpenMenuId(null); setMenuPosition(null); }} className="w-full px-4 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14} /> Eliminar</button>
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
                          <div className="h-full flex items-center justify-center text-center py-4"><div><div className="hidden"><FolderOpen size={14} className="text-slate-400" /></div><p className="text-[10px] text-slate-400">Arrastra facturas aquí</p></div></div>
                        ) : (
                          <div className="space-y-1">
                            {forecast.items.map((item) => {
                              const typeInfo = PAYMENT_TYPES[item.type];
                              const ItemIcon = typeInfo.icon;
                              return (
                                <div key={item.id} className="bg-white p-2 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors group">
                                  <div className="flex items-start gap-2">
                                    <div className={cx("w-5 h-5 rounded flex items-center justify-center flex-shrink-0", item.status === "completed" ? "bg-[#2F52E0]/10" : "bg-slate-100")}>{item.status === "completed" ? <CheckCircle2 size={10} className="text-[#2F52E0]" /> : <ItemIcon size={10} className="text-slate-500" />}</div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-1">
                                        <p className="text-[11px] font-medium text-slate-900 truncate font-mono">{item.invoiceNumber ? (/^[A-Za-z]/.test(item.invoiceNumber) ? item.invoiceNumber : "FRA-" + item.invoiceNumber) : item.description}</p>
                                        {forecast.status === "draft" && (<button aria-label="Cerrar" onClick={() => handleRemovePaymentItem(forecast.id, item.id)} className="p-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={10} /></button>)}
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
                          <span className="text-[13px] font-bold text-slate-900">{formatCurrency(forecast.totalAmount)} €</span>
                        </div>
                        {forecast.status !== "draft" && forecast.items.length > 0 && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#2F52E0] rounded-full transition-all" style={{ width: progress.percent + "%" }} /></div>
                            <span className="text-[10px] text-slate-500">{progress.completed}/{progress.total}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="tbl w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Previsión</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Fecha</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Tipo</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Estado</th>
                      <th className="text-center px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Progreso</th>
                      <th className="text-right px-4 py-2.5 text-[11px] font-medium text-slate-500 uppercase">Importe</th>
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
                            <td className="px-4 py-3">
                              <button onClick={() => toggleRowExpanded(forecast.id)} className="text-left hover:text-[#2F52E0] flex items-center gap-2 group/row">
                                <ChevronRight size={16} className={cx("text-slate-400 transition-transform", isExpanded && "rotate-90")} />
                                <div><p className="font-semibold text-slate-900 group-hover/row:text-[#2F52E0] transition-colors">{forecast.name}</p><p className="text-xs text-slate-500 mt-0.5">{forecast.items.length} pagos</p></div>
                              </button>
                            </td>
                            <td className="px-4 py-3"><div className="flex items-center gap-1.5"><Calendar size={14} className="text-slate-400" /><span className="text-[13px] text-slate-700">{formatDate(forecast.paymentDate)}</span></div></td>
                            <td className="px-4 py-3"><span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", typeConfig.bg, typeConfig.text)}><TypeIcon size={12} />{typeConfig.label}</span></td>
                            <td className="px-4 py-3"><span className={cx("inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-medium", statusConfig.bg, statusConfig.text)}><StatusIcon size={12} />{statusConfig.label}</span></td>
                            <td className="px-4 py-3">{forecast.items.length > 0 ? (<div className="flex items-center gap-2 justify-center"><div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#2F52E0] rounded-full" style={{ width: progress.percent + "%" }} /></div><span className="text-xs text-slate-500">{progress.completed}/{progress.total}</span></div>) : (<span className="text-xs text-slate-400">-</span>)}</td>
                            <td className="px-4 py-3 text-right"><span className="text-[13px] font-bold text-slate-900">{formatCurrency(forecast.totalAmount)} €</span></td>
                            <td className="px-4 py-3"><button aria-label="Ver" onClick={() => setShowForecastDetail(forecast)} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"><Eye size={16} /></button></td>
                          </tr>
                          {isExpanded && forecast.items.length > 0 && (
                            <tr><td colSpan={7} className="bg-slate-50 px-4 py-3">
                              <div className="space-y-2">
                                {forecast.items.map((item) => {
                                  const typeInfo = PAYMENT_TYPES[item.type];
                                  const ItemIcon = typeInfo.icon;
                                  return (
                                    <div key={item.id} className="flex items-center justify-between bg-white p-3 rounded-md border border-slate-200">
                                      <div className="flex items-center gap-3">
                                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center", item.status === "completed" ? "bg-[#2F52E0]/10" : "bg-slate-100")}>{item.status === "completed" ? <CheckCircle2 size={16} className="text-[#2F52E0]" /> : <ItemIcon size={16} className="text-slate-500" />}</div>
                                        <div><p className="text-[13px] font-medium text-slate-900 font-mono">{item.invoiceNumber ? (/^[A-Za-z]/.test(item.invoiceNumber) ? item.invoiceNumber : "FRA-" + item.invoiceNumber) : item.description}</p><p className="text-xs text-slate-500">{item.supplier}</p></div>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <span className={cx("text-xs px-2 py-1 rounded-lg", item.status === "completed" ? "bg-[#F7F7F8] text-slate-900" : "bg-amber-50 text-amber-700")}>{item.status === "completed" ? "Completado" : "Pendiente"}</span>
                                        <span className="text-[13px] font-semibold text-slate-900">{formatCurrency(item.partialAmount || item.amount)} €</span>
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

      {/* Nueva previsión */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Nueva previsión de pago"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>Cancelar</Button>
            <Button variant="primary" onClick={handleCreateForecast} disabled={!newForecast.name.trim() || !newForecast.paymentDate}>Crear previsión</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Nombre"><Input value={newForecast.name} onChange={(e) => setNewForecast({ ...newForecast, name: e.target.value })} placeholder="Ej. Remesa 15 de diciembre" autoFocus /></Field>
          <Field label="Fecha de pago"><Input type="date" value={newForecast.paymentDate} onChange={(e) => setNewForecast({ ...newForecast, paymentDate: e.target.value })} /></Field>
          <Field label="Tipo">
            <Segmented
              value={newForecast.type}
              onChange={(v) => setNewForecast({ ...newForecast, type: v })}
              options={[{ value: "remesa", label: "Remesa bancaria" }, { value: "fuera_remesa", label: "Fuera de remesa" }]}
            />
          </Field>
        </div>
      </Modal>

      {/* Añadir pago a una previsión */}
      <Modal
        open={showAddPaymentModal && !!selectedForecastId}
        onClose={() => { setShowAddPaymentModal(false); setSelectedForecastId(null); }}
        title="Añadir pago"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowAddPaymentModal(false); setSelectedForecastId(null); }}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => selectedForecastId && handleAddPaymentToForecast(selectedForecastId)}
              disabled={(newPayment.type === "invoice" && !newPayment.invoiceId) || (newPayment.type === "partial" && (!newPayment.invoiceId || !newPayment.partialAmount)) || (newPayment.type !== "invoice" && newPayment.type !== "partial" && (!newPayment.supplier || !newPayment.amount))}
            >
              Añadir pago
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tipo de pago">
            <Select value={newPayment.type} onChange={(e) => setNewPayment({ ...newPayment, type: e.target.value as PaymentType })}>
              {Object.entries(PAYMENT_TYPES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
            </Select>
          </Field>
          {(newPayment.type === "invoice" || newPayment.type === "partial") && (
            availableInvoices.length > 0 ? (
              <Field label="Factura">
                <Select
                  value={newPayment.invoiceId}
                  onChange={(e) => {
                    const inv = availableInvoices.find((i) => i.id === e.target.value);
                    setNewPayment(inv ? { ...newPayment, invoiceId: inv.id, supplier: inv.supplier, description: inv.description, amount: inv.totalAmount } : { ...newPayment, invoiceId: "" });
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {availableInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.displayNumber || ("FRA-" + inv.number)} · {inv.supplier} · {formatCurrency(inv.totalAmount)} €</option>
                  ))}
                </Select>
              </Field>
            ) : <p className="text-[13px] text-slate-500">No hay facturas aprobadas pendientes de pago.</p>
          )}
          {newPayment.type === "partial" && newPayment.invoiceId && (
            <Field label={`Importe parcial (de ${formatCurrency(newPayment.amount)} €)`}>
              <Input type="number" step="0.01" value={newPayment.partialAmount || ""} onChange={(e) => setNewPayment({ ...newPayment, partialAmount: parseFloat(e.target.value) || 0 })} className="text-right tabular-nums" />
            </Field>
          )}
          {newPayment.type !== "invoice" && newPayment.type !== "partial" && (
            <>
              <Field label="Proveedor o beneficiario"><Input value={newPayment.supplier} onChange={(e) => setNewPayment({ ...newPayment, supplier: e.target.value })} /></Field>
              <Field label="Concepto"><Input value={newPayment.description} onChange={(e) => setNewPayment({ ...newPayment, description: e.target.value })} /></Field>
              <Field label="Importe (€)"><Input type="number" step="0.01" value={newPayment.amount || ""} onChange={(e) => setNewPayment({ ...newPayment, amount: parseFloat(e.target.value) || 0 })} className="text-right tabular-nums" /></Field>
            </>
          )}
        </div>
      </Modal>

      {/* Detalle de una previsión */}
      {(() => {
        const fc = showForecastDetail;
        const st = fc ? getStatusConfig(fc.status) : null;
        const prog = fc ? getCompletionProgress(fc) : null;
        return (
          <Modal
            open={!!fc}
            onClose={() => setShowForecastDetail(null)}
            title={fc ? fc.name : ""}
            width="max-w-3xl"
            footer={fc ? (
              <>
                <span className="mr-auto" />
                {fc.status === "draft" && <Button variant="secondary" onClick={() => { setSelectedForecastId(fc.id); setShowAddPaymentModal(true); setShowForecastDetail(null); }}>Añadir pago</Button>}
                {fc.status === "draft" && fc.items.length > 0 && <Button variant="primary" onClick={() => { handleSendForecast(fc.id); setShowForecastDetail(null); }}>Enviar a pago</Button>}
                {(fc.status === "pending" || fc.status === "completed") && (
                  <Button variant="primary" onClick={() => router.push("/project/" + id + "/accounting/payments/" + fc.id + "/pay")}>{fc.status === "pending" ? "Ir a pagar" : "Ver pagos"}</Button>
                )}
              </>
            ) : undefined}
          >
            {fc && st && prog && (
              <div className="flex flex-col gap-4 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-slate-600">
                  <span className={cx("inline-flex items-center gap-1.5 text-xs font-medium", st.text)}>{st.label}</span>
                  <span>Pago el <b className="font-medium text-slate-900">{formatDate(fc.paymentDate)}</b></span>
                  <span>Total <b className="tabular-nums font-medium text-slate-900">{formatCurrency(fc.totalAmount)} €</b></span>
                  <span>Pagados <b className="tabular-nums font-medium text-slate-900">{prog.completed}/{prog.total}</b></span>
                  <span className="text-xs text-slate-400">Creada por {fc.createdByName} · {formatDate(fc.createdAt)}</span>
                </div>
                {fc.items.length === 0 ? (
                  <p className="border-y border-slate-200 py-8 text-center text-slate-500">Sin pagos añadidos</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="tbl w-full border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                          <th scope="col" className="px-3 py-2 text-left font-medium">Pago</th>
                          <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">Importe</th>
                          <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Estado</th>
                          <th scope="col" className="w-20 px-3 py-2 text-left font-medium">Justificante</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fc.items.map((item) => (
                          <tr key={item.id} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-1.5">
                              <span className="font-mono text-xs font-medium">{item.invoiceNumber ? (/^[A-Za-z]/.test(item.invoiceNumber) ? item.invoiceNumber : "FRA-" + item.invoiceNumber) : item.description}</span>
                              <span className="ml-2 text-xs text-slate-400">{PAYMENT_TYPES[item.type]?.label}</span>
                            </td>
                            <td className="px-3 py-1.5">{item.supplier}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs">{formatCurrency(item.partialAmount || item.amount)}</td>
                            <td className="px-3 py-1.5">
                              <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                                <span className={cx("h-1.5 w-1.5 rounded-full", item.status === "completed" ? "bg-[#2F52E0]" : "bg-amber-500")} />
                                {item.status === "completed" ? "Pagado" : "Pendiente"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-xs">
                              {item.receiptUrl ? <a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-slate-700 underline hover:text-slate-900">Ver</a> : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Modal>
        );
      })()}

      {/* Consultar estado de una factura */}
      <Modal open={showInvoiceStatusSearch} onClose={() => setShowInvoiceStatusSearch(false)} title="Consultar estado de factura">
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex gap-2">
            <Input
              value={invoiceStatusSearchTerm}
              onChange={(e) => { setInvoiceStatusSearchTerm(e.target.value); setInvoiceStatusResult(null); }}
              onKeyDown={(e) => e.key === "Enter" && searchInvoiceStatus()}
              placeholder="Número de factura o proveedor"
              autoFocus
            />
            <Button variant="primary" onClick={searchInvoiceStatus} disabled={!invoiceStatusSearchTerm.trim()}>Buscar</Button>
          </div>
          {invoiceStatusResult && (!invoiceStatusResult.found ? (
            <p className="py-4 text-center text-slate-500">No hay ninguna factura que coincida</p>
          ) : (
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 rounded-md border border-slate-200 px-3 py-2.5">
              <dt className="text-slate-500">Factura</dt><dd className="font-mono text-xs font-medium">{invoiceStatusResult.invoice?.invoiceNumber || invoiceStatusResult.invoice?.displayNumber || invoiceStatusResult.invoice?.number}</dd>
              <dt className="text-slate-500">Proveedor</dt><dd>{invoiceStatusResult.invoice?.supplier}</dd>
              <dt className="text-slate-500">Importe</dt><dd className="tabular-nums">{formatCurrency(invoiceStatusResult.invoice?.totalAmount || invoiceStatusResult.invoice?.amount || 0)} €</dd>
              <dt className="text-slate-500">Estado</dt>
              <dd className="font-medium">{invoiceStatusResult.status === "paid" ? "Pagada" : invoiceStatusResult.status === "scheduled" ? "Programada para pago" : "Sin asignar a ninguna previsión"}</dd>
              {invoiceStatusResult.forecast && (<><dt className="text-slate-500">Previsión</dt><dd>{invoiceStatusResult.forecast.name} · {formatDate(invoiceStatusResult.forecast.paymentDate)}</dd></>)}
            </dl>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>

      <Modal open={showNoReceipt} onClose={() => setShowNoReceipt(false)} title="Pagadas sin justificante" width="max-w-2xl"
        footer={<>
          <Button variant="ghost" onClick={() => setShowNoReceipt(false)}>Cerrar</Button>
          <Button variant="primary" onClick={() => bulkReceiptInput.current?.click()} disabled={uploadingReceipt === "bulk" || !noReceipt.length}>{uploadingReceipt === "bulk" ? "Subiendo…" : "Subir varios"}</Button>
        </>}>
        {noReceipt.length === 0 ? <p className="text-[13px] text-slate-600">Todo justificado.</p> : (
          <>
            <div className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {noReceipt.map((x) => (
                <div key={x.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="w-20 font-mono text-xs text-slate-600">{x.number}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-900">{x.supplier}</span>
                  <span className="text-xs text-slate-500">{x.paidAt ? x.paidAt.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : ""}</span>
                  <span className="w-24 text-right tabular-nums">{new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x.total)} €</span>
                  <Button size="sm" onClick={() => { receiptTarget.current = x.id; receiptInput.current?.click(); }} disabled={!!uploadingReceipt}>{uploadingReceipt === x.id ? "Subiendo…" : "Subir"}</Button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">«Subir varios» asigna cada archivo por el número de factura de su nombre (por ejemplo, FAC-0012.pdf).</p>
          </>
        )}
      </Modal>
      <input ref={receiptInput} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f && receiptTarget.current) uploadOne(receiptTarget.current, f); e.target.value = ""; }} />
      <input ref={bulkReceiptInput} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => { uploadMany(Array.from(e.target.files || [])); e.target.value = ""; }} />
    </div>
  );
}
