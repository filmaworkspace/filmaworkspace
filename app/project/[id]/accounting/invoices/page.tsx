"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { Button, Checkbox, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { getScopedDocs, scopeFromPermissions, sortByTime } from "@/lib/accountingScope";
import {
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
  Building2,
  Calendar,
  ChevronDown,
  Clock,
  Code,
  Eye,
  FileCheck,
  FileText,
  Filter,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Receipt,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { syncBudget } from "@/lib/ledgerClient";
import { pendingTooltip } from "@/components/accounting/ApprovalFlow";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { getInvoiceDisplayState, inInvoiceView, type InvoiceView } from "@/lib/invoiceHelpers";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_TYPES = {
  invoice: { code: "FRA", label: "Factura", icon: Receipt, bgColor: "bg-emerald-50", textColor: "text-emerald-700", borderColor: "border-emerald-200" },
  proforma: { code: "PRF", label: "Proforma", icon: FileText, bgColor: "bg-violet-50", textColor: "text-violet-700", borderColor: "border-violet-200" },
  budget: { code: "PRS", label: "Presupuesto", icon: FileCheck, bgColor: "bg-amber-50", textColor: "text-amber-700", borderColor: "border-amber-200" },
  guarantee: { code: "FNZ", label: "Fianza", icon: Shield, bgColor: "bg-slate-100", textColor: "text-slate-700", borderColor: "border-slate-300" },
};

// Filter values are display states (see getInvoiceDisplayState).
const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "submitted", label: "En sistema" },
  { value: "approved", label: "Aprobadas" },
  { value: "coded", label: "Codificadas" },
  { value: "accounted", label: "Contabilizadas" },
  { value: "paid", label: "Pagadas" },
  { value: "overdue", label: "Vencidas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "cancelled", label: "Canceladas" },
];

// ─── Types ───────────────────────────────────────────────────────────────────

type DocumentType = keyof typeof DOCUMENT_TYPES;

interface InvoiceItem {
  id: string;
  description: string;
  subAccountId: string;
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
  supplier: string;
  supplierId: string;
  department?: string;
  poId?: string;
  poNumber?: string;
  description: string;
  items: InvoiceItem[];
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  // Lifecycle only. Legacy values kept for backwards compat with existing docs.
  status: "draft" | "submitted" | "void" | "pending_approval" | "pending" | "paid" | "overdue" | "cancelled" | "rejected" | "coded" | "accounted" | "returned" | "partial_return";
  approvalSteps?: any[];
  currentApprovalStep?: number;
  dueDate: Date;
  paymentDate?: Date;
  attachmentUrl: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  paidByName?: string;
  notes?: string;
  rejectedAt?: Date;
  rejectedByName?: string;
  rejectionReason?: string;
  requiresReplacement?: boolean;
  replacedByInvoiceId?: string;
  linkedDocumentId?: string;
  codedAt?: Date;
  codedByName?: string;
  approvedAt?: Date;
  accountedAt?: Date;
  paidAt?: Date;
  accounted?: boolean;
  accountingEntryNumber?: string;
  replacedBy?: string;
}

interface CompanyData {
  fiscalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  email?: string;
  phone?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const searchParams = useSearchParams();
  const supplierParam = searchParams?.get("supplier") || "";
  const viewParam = searchParams?.get("vista") || "";
  const [view, setViewState] = useState<"all" | InvoiceView>(
    (["recibidas", "aprobadas", "pagadas", "semana"].includes(viewParam) ? viewParam : "all") as "all" | InvoiceView,
  );
  const [searchField, setSearchField] = useState<"all" | "number" | "supplier" | "concept" | "account" | "amount">("all");
  const [onlyPendingReplacement, setOnlyPendingReplacement] = useState(false);
  // La vista queda en la URL (?vista=…) para poder compartir el enlace o volver atrás.
  const setView = (v: "all" | InvoiceView) => {
    setViewState(v);
    const qs = new URLSearchParams(searchParams?.toString() || "");
    if (v === "all") qs.delete("vista"); else qs.set("vista", v);
    const str = qs.toString();
    router.replace(`/project/${id}/accounting/invoices${str ? `?${str}` : ""}`, { scroll: false });
  };

  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filteredInvoices, setFilteredInvoices] = useState<Invoice[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showUncodedOnly, setShowUncodedOnly] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [pendingReplacementCount, setPendingReplacementCount] = useState(0);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // Bloquea el scroll de la página de detrás mientras el modal de detalle o
  // el de confirmación están abiertos.
  useBodyScrollLock(showDetailModal || !!confirmDialog);

  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Verificar si el usuario puede codificar (contabilidad o contabilidad ampliada)
  const canCodeInvoices = permissions.accountingAccessLevel === "accounting" || permissions.accountingAccessLevel === "accounting_extended";

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    filterInvoices();
  }, [searchTerm, statusFilter, typeFilter, showUncodedOnly, invoices]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-container")) {
        setOpenMenuId(null);
        setMenuPosition(null);
      }
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


      // Solo lo que este usuario puede leer (ver lib/accountingScope)
      const invoiceDocs = sortByTime(await getScopedDocs(collection(db, `projects/${id}/invoices`), scopeFromPermissions(permissions)));
      const allInvoices = invoiceDocs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          documentType: data.documentType || "invoice",
          displayNumber: data.displayNumber || `FRA-${data.number}`,
          createdAt: data.createdAt?.toDate() || new Date(),
          dueDate: data.dueDate?.toDate() || new Date(),
          paymentDate: data.paymentDate?.toDate(),
          rejectedAt: data.rejectedAt?.toDate(),
          codedAt: data.codedAt?.toDate(),
          codedByName: data.codedByName,
          approvedAt: data.approvedAt?.toDate(),
          accountedAt: data.accountedAt?.toDate(),
          paidAt: data.paidAt?.toDate(),
          accounted: data.accounted || false,
          accountingEntryNumber: data.accountingEntryNumber,
        };
      }) as Invoice[];

      const invoicesData = allInvoices.filter((inv) => {
        if (permissions.canViewAllPOs) return true;
        if (permissions.canViewDepartmentPOs && inv.department === permissions.department) return true;
        if (permissions.canViewOwnPOs && inv.createdBy === permissions.userId) return true;
        return false;
      });

      let pendingCount = 0;
      for (const invoice of invoicesData) {
        // "Vencida" ahora es un estado calculado (ver getInvoiceDisplayState); no se
        // persiste en Firestore.
        // Contar proformas y presupuestos que no han sido reemplazados
        if (invoice.requiresReplacement && !invoice.replacedByInvoiceId && !invoice.replacedBy) pendingCount++;
      }
      setPendingReplacementCount(pendingCount);
      setInvoices(invoicesData);
    } catch (error) {
      console.error("Error:", error);
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
    if (statusFilter !== "all") filtered = filtered.filter((inv) => getInvoiceDisplayState(inv) === statusFilter);
    if (typeFilter !== "all") filtered = filtered.filter((inv) => inv.documentType === typeFilter);
    if (showUncodedOnly) filtered = filtered.filter((inv) => !inv.codedAt);
    setFilteredInvoices(filtered);
  };

  const closeMenu = () => {
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  const canEditInvoice = (invoice: Invoice): boolean => {
    if (invoice.accounted || invoice.accountedAt) return false; // Bloqueada si está contabilizada
    if (invoice.paidAt) return false;
    if (["paid", "cancelled", "rejected", "void"].includes(invoice.status)) return false;
    if (permissions.canEditAllPOs) return true;
    if (permissions.canEditDepartmentPOs && invoice.department === permissions.department) return true;
    if (permissions.canEditOwnPOs && invoice.createdBy === permissions.userId) return true;
    return false;
  };

  const canDeleteInvoice = (invoice: Invoice): boolean => {
    if (invoice.accounted || invoice.accountedAt) return false; // Bloqueada si está contabilizada
    // Solo se puede borrar antes de aprobar, o si está rechazada.
    if (invoice.approvedAt) return false;
    if (!["submitted", "pending_approval", "rejected"].includes(invoice.status)) return false;
    return canEditInvoice(invoice);
  };

  const canMarkAsPaid = (invoice: Invoice): boolean => {
    // Pagable cuando está aprobada y aún no pagada.
    if (!invoice.approvedAt || invoice.paidAt) return false;
    if (["cancelled", "rejected", "void"].includes(invoice.status)) return false;
    if (permissions.isProjectRole) return true;
    if (permissions.canEditAllPOs) return true;
    return false;
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice || !canDeleteInvoice(invoice)) return;
    openConfirm(
      "Eliminar factura",
      `¿Eliminar ${invoice.displayNumber}? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${id}/invoices`, invoiceId));
          loadData();
        } catch (error) {
          console.error("Error:", error);
        }
        closeMenu();
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const handleMarkAsPaid = async (invoiceId: string) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice || !canMarkAsPaid(invoice)) return;
    openConfirm(
      "Marcar como pagada",
      `¿Marcar ${invoice.displayNumber} como pagada? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmDialog(null);
        await doMarkAsPaid(invoice);
      },
      { confirmLabel: "Marcar como pagada" }
    );
  };

  const doMarkAsPaid = async (invoice: Invoice) => {
    try {
      await updateDoc(doc(db, `projects/${id}/invoices`, invoice.id), {
        status: "submitted",
        paidAt: Timestamp.now(),
        paidBy: permissions.userId,
        paidByName: permissions.userName,
        paymentDate: Timestamp.now(),
      });

      // Presupuesto: se recalcula desde los documentos (el pago no duplica nada).
      await syncBudget(id);

      loadData();
    } catch (error) {
      console.error("Error:", error);
    }
    closeMenu();
  };

  const handleCancelInvoice = async (invoiceId: string) => {
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice || !canEditInvoice(invoice)) return;

    const reason = prompt(`¿Motivo de cancelación de ${invoice.displayNumber}?`);
    if (!reason) return;

    try {
      await updateDoc(doc(db, `projects/${id}/invoices`, invoiceId), {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: permissions.userId,
        cancellationReason: reason,
      });
      await syncBudget(id);

      loadData();
    } catch (error) {
      console.error("Error:", error);
    }
    closeMenu();
  };

  const getDocumentTypeBadge = (docType: DocumentType) => {
    const config = DOCUMENT_TYPES[docType] || DOCUMENT_TYPES.invoice;
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${config.bgColor} ${config.textColor}`}>
        <Icon size={12} />
        {config.code}
      </span>
    );
  };

  const getStatusBadge = (invoice: Invoice) => {
    const state = getInvoiceDisplayState(invoice);
    const config: Record<string, { bg: string; text: string; label: string }> = {
      draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador" },
      submitted: { bg: "bg-purple-50", text: "text-purple-700", label: "En sistema" },
      approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada" },
      coded: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificada" },
      accounted: { bg: "bg-teal-50", text: "text-teal-700", label: "Contabilizada" },
      paid: { bg: "bg-blue-50", text: "text-blue-700", label: "Pagada" },
      overdue: { bg: "bg-red-50", text: "text-red-700", label: "Vencida" },
      cancelled: { bg: "bg-red-100", text: "text-red-700", label: "Anulada" },
      void: { bg: "bg-red-100", text: "text-red-700", label: "Anulada" },
      rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
      returned: { bg: "bg-teal-50", text: "text-teal-700", label: "Devuelta" },
      partial_return: { bg: "bg-cyan-50", text: "text-cyan-700", label: "Dev. parcial" },
    };
    const c = config[state] || config.submitted;
    const struck = state === "cancelled" || state === "void";
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text} ${struck ? "line-through" : ""}`}>
        {struck && <span className="font-bold">✕</span>}
        {c.label}
      </span>
    );
  };

  const getApprovalProgress = (invoice: Invoice) => {
    if (!invoice.approvalSteps?.length) return null;
    const approved = invoice.approvalSteps.filter((s) => s.status === "approved").length;
    const counted = invoice.approvalSteps.filter((s) => s.status !== "skipped").length;
    return (
      <div className="flex items-center gap-1 mt-1">
        {invoice.approvalSteps.map((step, idx) => (
          <div
            key={idx}
            className={`w-2 h-2 rounded-full ${
              step.status === "approved" ? "bg-emerald-500" : step.status === "rejected" ? "bg-red-500" : step.status === "skipped" ? "bg-slate-100 ring-1 ring-slate-200" : idx === invoice.currentApprovalStep ? "bg-amber-500" : "bg-slate-300"
            }`}
          />
        ))}
        <span className="text-xs text-slate-500 ml-1">
          {approved}/{counted}
        </span>
      </div>
    );
  };

  const formatDate = (date: Date) => (date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-");
  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);
  const getDaysUntilDue = (dueDate: Date) => Math.ceil((dueDate.getTime() - Date.now()) / 86400000);

  const exportInvoices = (list: Invoice[]) => {
    const rows = [["TIPO", "NÚMERO", "PROVEEDOR", "CONCEPTO", "PO", "BASE", "TOTAL", "ESTADO", "VENCIMIENTO"]];
    list.forEach((inv) => {
      const docType = DOCUMENT_TYPES[inv.documentType] || DOCUMENT_TYPES.invoice;
      rows.push([docType.code, inv.displayNumber, inv.supplier, inv.description || "", inv.poNumber ? `PO-${inv.poNumber}` : "", formatCurrency(inv.baseAmount), formatCurrency(inv.totalAmount), getInvoiceDisplayState(inv), formatDate(inv.dueDate)]);
    });
    const q = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const blob = new Blob(["\uFEFF" + rows.map((r) => r.map(q).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Documentos_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  // ── Vistas, búsqueda avanzada y filtros ───────────────────────────────────
  type InvField = "all" | "number" | "supplier" | "concept" | "account" | "amount";
  const INV_FIELDS: SearchField<InvField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Número, proveedor o concepto" },
    { value: "number", label: "Nº documento o PO", placeholder: "Ej. FRA-0012 o PO-0003", mono: true },
    { value: "supplier", label: "Proveedor", placeholder: "Ej. Rental Norte" },
    { value: "concept", label: "Concepto", placeholder: "Ej. alquiler cámara" },
    { value: "account", label: "Cuenta", placeholder: "Ej. 04.01 o iluminación", mono: true },
    { value: "amount", label: "Importe", placeholder: "1500 · >1000 · 500-2000", mono: true },
  ];
  const VIEWS: { value: "all" | InvoiceView; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "recibidas", label: "Recibidas" },
    { value: "aprobadas", label: "Aprobadas" },
    { value: "pagadas", label: "Pagadas" },
    { value: "semana", label: "Vencen esta semana" },
  ];
  const invMatches = (inv: Invoice) => {
    const q = searchTerm.trim();
    if (!q) return true;
    const byNumber = matchCode(q, inv.displayNumber, inv.number, inv.poNumber ? `PO-${inv.poNumber}` : "");
    const bySupplier = matchWords(q, inv.supplier);
    const byConcept = matchWords(q, inv.description, ...(inv.items || []).map((i) => i.description));
    const byAccount = (inv.items || []).some((i) => matchCode(q, i.subAccountCode) || matchWords(q, i.subAccountDescription));
    const byAmount = matchAmount(q, inv.totalAmount, inv.baseAmount);
    if (searchField === "number") return byNumber;
    if (searchField === "supplier") return bySupplier;
    if (searchField === "concept") return byConcept;
    if (searchField === "account") return byAccount;
    if (searchField === "amount") return byAmount === true;
    return byNumber || bySupplier || byConcept || byAccount || byAmount === true;
  };
  const rows = invoices
    .filter((inv) => view === "all" || inInvoiceView(view, getInvoiceDisplayState(inv), inv.dueDate))
    .filter((inv) => !supplierParam || inv.supplierId === supplierParam)
    .filter(invMatches)
    .filter((inv) => statusFilter === "all" || getInvoiceDisplayState(inv) === statusFilter)
    .filter((inv) => typeFilter === "all" || inv.documentType === typeFilter)
    .filter((inv) => !showUncodedOnly || !inv.codedAt)
    .filter((inv) => !onlyPendingReplacement || (inv.requiresReplacement && !inv.replacedByInvoiceId && !inv.replacedBy))
    .sort((a, b) => view === "semana" ? a.dueDate.getTime() - b.dueDate.getTime() : 0);
  const viewCount = (v: "all" | InvoiceView) => v === "all" ? invoices.length : invoices.filter((inv) => inInvoiceView(v, getInvoiceDisplayState(inv), inv.dueDate)).length;
  const filtersActive = statusFilter !== "all" || typeFilter !== "all" || showUncodedOnly || !!supplierParam;
  const supplierName = supplierParam ? invoices.find((i) => i.supplierId === supplierParam)?.supplier : null;
  const active = rows.filter((r) => !["cancelled", "void", "rejected"].includes(r.status));
  const totals = { base: active.reduce((s, r) => s + (r.baseAmount || 0), 0), total: active.reduce((s, r) => s + (r.totalAmount || 0), 0) };

  const STATE: Record<string, { label: string; dot: string; text: string }> = {
    draft: { label: "Borrador", dot: "bg-slate-300", text: "text-slate-600" },
    submitted: { label: "Pend. aprobación", dot: "bg-amber-500", text: "text-amber-800" },
    approved: { label: "Aprobada", dot: "bg-emerald-500", text: "text-emerald-800" },
    coded: { label: "Codificada", dot: "bg-violet-500", text: "text-violet-800" },
    accounted: { label: "Contabilizada", dot: "bg-teal-500", text: "text-teal-800" },
    paid: { label: "Pagada", dot: "bg-[#2F52E0]", text: "text-blue-800" },
    overdue: { label: "Vencida", dot: "bg-red-500", text: "text-red-700" },
    rejected: { label: "Rechazada", dot: "bg-red-500", text: "text-red-700" },
    cancelled: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500 line-through" },
    void: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500 line-through" },
    returned: { label: "Devuelta", dot: "bg-teal-500", text: "text-teal-800" },
    partial_return: { label: "Dev. parcial", dot: "bg-cyan-500", text: "text-cyan-800" },
  };
  const dueLabel = (inv: Invoice, state: string) => {
    if (inv.paidAt || ["paid", "cancelled", "void", "rejected"].includes(state)) return null;
    const d = getDaysUntilDue(inv.dueDate);
    if (d < 0) return { text: `hace ${-d} d`, cls: "text-red-700" };
    if (d === 0) return { text: "hoy", cls: "text-red-700" };
    if (d <= 7) return { text: `en ${d} d`, cls: "text-amber-800" };
    return null;
  };

  if (permissionsLoading || loading) return <PageLoading />;

  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white px-6 ${inter.className}`}>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-slate-900">Sin acceso</p>
          <p className="mt-1 text-[13px] text-slate-500">{permissionsError || "No tienes acceso a contabilidad en este proyecto."}</p>
          <Link href="/dashboard" className={`${buttonClass("primary")} mt-5`}>Volver a proyectos</Link>
        </div>
      </div>
    );
  }

  return (
    <Page>
      <PageHeader
        title={
          <>
            Facturas <span className="text-[15px] font-normal text-slate-400">{invoices.length}</span>
            {!permissions.canViewAllPOs && (
              <span className="text-xs font-normal text-slate-500">· {permissions.canViewDepartmentPOs ? permissions.department : "solo tus documentos"}</span>
            )}
          </>
        }
        actions={
          <>
            <Menu trigger={(toggle) => <IconButton label="Más acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); exportInvoices(rows); }}>Exportar lo filtrado (CSV)</MenuItem>
                </>
              )}
            </Menu>
            {permissions.canCreatePO && (
              <Link href={`/project/${id}/accounting/invoices/new`} className={buttonClass("primary")}><Upload size={14} /> Subir documento</Link>
            )}
          </>
        }
      />

      {pendingReplacementCount > 0 && (
        <button
          onClick={() => { setStatusFilter("all"); setView("all"); setSearchField("all"); setSearchTerm(""); setOnlyPendingReplacement(!onlyPendingReplacement); }}
          className={`mt-5 flex w-full items-center justify-between rounded-md border px-3.5 py-2 text-left text-[13px] ${onlyPendingReplacement ? "border-slate-900 bg-[#F7F7F8]" : "border-amber-200 bg-amber-50 hover:bg-amber-100/60"}`}
        >
          <span className="text-amber-900">{pendingReplacementCount} {pendingReplacementCount === 1 ? "proforma pagada espera" : "proformas pagadas esperan"} su factura definitiva</span>
          <span className="text-xs font-medium text-slate-900">{onlyPendingReplacement ? "Ver todas" : "Ver"}</span>
        </button>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="tablist" aria-label="Vista">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              onClick={() => setView(v.value)}
              className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${view === v.value ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"} ${v.value === "semana" && view !== v.value ? "text-red-700" : ""}`}
            >
              {v.label}
              <span className="tabular-nums text-slate-400">{viewCount(v.value)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={INV_FIELDS} field={searchField} onField={setSearchField} value={searchTerm} onChange={setSearchTerm} count={rows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="w-44">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">Todos los tipos</option>
            {(Object.entries(DOCUMENT_TYPES) as [DocumentType, typeof DOCUMENT_TYPES.invoice][]).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        {canCodeInvoices && <Checkbox label="Sin codificar" checked={showUncodedOnly} onChange={setShowUncodedOnly} />}
        </div>
      </div>

      {(supplierName || filtersActive) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {supplierName && (
            <button onClick={() => router.replace(`/project/${id}/accounting/invoices${view !== "all" ? `?vista=${view}` : ""}`)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-slate-700 hover:border-slate-300">
              Proveedor: {supplierName} <X size={11} />
            </button>
          )}
          <button onClick={() => { setStatusFilter("all"); setTypeFilter("all"); setShowUncodedOnly(false); if (supplierParam) router.replace(`/project/${id}/accounting/invoices`); }} className="text-slate-500 hover:text-slate-900">Quitar filtros</button>
        </div>
      )}

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title={invoices.length ? "Sin resultados" : "Sin documentos"} action={!invoices.length && permissions.canCreatePO ? <Link href={`/project/${id}/accounting/invoices/new`} className={buttonClass("primary", "sm")}>Subir documento</Link> : undefined} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[1000px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-44 px-4 py-2 text-left font-medium">Documento</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor y concepto</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Base</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="w-44 px-3 py-2 text-left font-medium">Vencimiento</th>
                  <th scope="col" className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((invoice) => {
                  const state = getInvoiceDisplayState(invoice);
                  const st = STATE[state] || STATE.submitted;
                  const docType = DOCUMENT_TYPES[invoice.documentType] || DOCUMENT_TYPES.invoice;
                  const href = `/project/${id}/accounting/invoices/${invoice.id}`;
                  const dead = state === "cancelled" || state === "void";
                  const due = dueLabel(invoice, state);
                  const needsReplacement = invoice.requiresReplacement && (invoice.paidAt || invoice.status === "paid") && !invoice.replacedByInvoiceId;
                  const progress = !invoice.approvedAt && (invoice.status === "submitted" || invoice.status === "pending_approval") && invoice.approvalSteps?.length
                    ? pendingTooltip(invoice as any) || null : null;
                  return (
                    <tr key={invoice.id} className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${dead ? "text-slate-400" : ""}`} onClick={() => router.push(href)}>
                      <td className="relative whitespace-nowrap px-4 py-1.5" title={`${st.label}${progress ? ` · ${progress}` : ""}`}>
                        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] ${st.dot}`} />
                        <span className="sr-only">{st.label}</span>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-8 font-mono text-[10px] text-slate-500" title={docType.label}>{docType.code}</span>
                          <span className={`font-mono text-xs font-medium ${dead ? "line-through" : ""}`}>{invoice.displayNumber}</span>
                          {(invoice.accounted || invoice.accountedAt) && <span title={`Contabilizada${invoice.accountingEntryNumber ? ` · asiento ${invoice.accountingEntryNumber}` : ""}`}><Lock size={11} className="text-slate-400" /></span>}
                          {needsReplacement && <span className="rounded border border-amber-200 bg-amber-50 px-1 text-[10px] text-amber-800">falta factura</span>}
                        </span>
                      </td>
                      <td className="px-3 py-1.5" title={[invoice.supplier, invoice.description].filter(Boolean).join(" · ")}>
                        <div className={`truncate font-medium ${dead ? "" : "text-slate-900"}`}>
                          {invoice.supplier}
                          {invoice.poNumber && <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">PO-{invoice.poNumber}</span>}
                        </div>
                        <div className="truncate text-xs text-slate-500">{invoice.description || <span className="text-slate-300">Sin concepto</span>}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{formatCurrency(invoice.baseAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs font-medium">{formatCurrency(invoice.totalAmount)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600">
                        {formatDate(invoice.dueDate)}
                        {due && <span className={`ml-1.5 text-xs ${due.cls}`}>{due.text}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); router.push(href); }}>Abrir</MenuItem>
                              <MenuItem onClick={() => { close(); router.push(`/project/${id}/accounting/document-center?doc=inv:${invoice.id}`); }}>Ver en documentación</MenuItem>
                              <MenuItem onClick={() => { close(); navigator.clipboard?.writeText(invoice.displayNumber); }}>Copiar número</MenuItem>
                              {needsReplacement && permissions.canCreatePO && (
                                <MenuItem onClick={() => { close(); router.push(`/project/${id}/accounting/invoices/new?linkTo=${invoice.id}`); }}>Subir factura definitiva</MenuItem>
                              )}
                              {canEditInvoice(invoice) && !invoice.paidAt && !["cancelled", "rejected", "void"].includes(invoice.status) && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem onClick={() => { close(); handleCancelInvoice(invoice.id); }}>Anular</MenuItem>
                                </>
                              )}
                              {canDeleteInvoice(invoice) && <MenuItem danger onClick={() => { close(); handleDeleteInvoice(invoice.id); }}>Eliminar</MenuItem>}
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                  <td className="px-4 py-2 font-semibold" colSpan={2}>Total {rows.length === invoices.length ? "" : "filtrado "}sin anuladas</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(totals.base)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(totals.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>
    </Page>
  );
}
