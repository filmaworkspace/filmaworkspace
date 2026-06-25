"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code,
  CreditCard,
  Download,
  Edit,
  Euro,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileText,
  FileUp,
  Glasses,
  Hash,
  KeyRound,
  Layers,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { getCostSettings, shouldRealizeInvoice } from "@/lib/budgetRules";
import { unrealizeInvoice, updatePOItemsInvoiced, realizeInvoice } from "@/lib/budgetOperations";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

type InvoiceStatus = "draft" | "pending" | "pending_approval" | "approved" | "rejected" | "paid" | "cancelled" | "coding" | "coded" | "accounted" | "returned" | "partial_return";
type DocumentType = "invoice" | "proforma" | "autonomo" | "ticket" | "budget" | "guarantee";

interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

interface InvoiceItem {
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
  poItemId?: string;
  poItemIndex?: number;
  isNewItem?: boolean;
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface ApprovalStepStatus {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers: string[];
  approverNames?: string[];
  roles?: string[];
  department?: string;
  approvedBy: string[];
  approvedByNames?: string[];
  rejectedBy: string[];
  status: "pending" | "approved" | "rejected";
  requireAll: boolean;
  approvedAt?: Date;
}

interface ApprovalComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: Date;
  type: "approval" | "rejection" | "info_request" | "comment";
  stepOrder?: number;
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
  supplierIban?: string;
  supplierBic?: string;
  department?: string;
  description: string;
  notes?: string;
  items: InvoiceItem[];
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  invoiceDate?: Date;
  dueDate: Date;
  status: InvoiceStatus;
  approvalStatus?: string;
  approvalSteps?: ApprovalStepStatus[];
  currentApprovalStep?: number;
  comments?: ApprovalComment[];
  attachmentUrl?: string;
  attachmentFileName?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  codedAt?: Date;
  codedBy?: string;
  codedByName?: string;
  approvedAt?: Date;
  approvedBy?: string;
  approvedByName?: string;
  paidAt?: Date;
  paidAmount?: number;
  paymentMethod?: string;
  paymentReference?: string;
  cancelledAt?: Date;
  cancelledByName?: string;
  cancellationReason?: string;
  poId?: string;
  poNumber?: string;
  requiresReplacement?: boolean;
  replacedByInvoiceId?: string;
  isReplacement?: boolean;
  replacesDocumentId?: string;
  replacesDocumentNumber?: string;
  currency?: string;
  accountingEntry?: string;
  isAsset?: boolean;
  assetCategory?: string;
  replacedFromType?: string;
  replacedAt?: Date;
  originalAttachmentUrl?: string;
  originalAttachmentFileName?: string;
  accounted?: boolean;
  accountedAt?: Date;
  accountedBy?: string;
  accountedByName?: string;
  accountingEntryNumber?: string;
  accountingAccount?: string;
  delegatedToAccounting?: boolean;
  delegatedAt?: Date;
  delegatedBy?: string;
  delegatedByName?: string;
  guaranteeReturns?: GuaranteeReturn[];
  totalReturned?: number;
}

interface LinkedPO {
  id: string;
  number: string;
  supplier: string;
  baseAmount: number;
  invoicedAmount: number;
  status: string;
  items?: any[];
}

interface Supplier {
  id: string;
  name: string;
  taxId?: string;
  iban?: string;
  bic?: string;
}

interface SubAccount {
  id: string;
  code: string;
  description: string;
  accountId: string;
  committed: number;
  actual: number;
  budgeted: number;
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

interface GuaranteeReturn {
  id: string;
  amount: number;
  date: Date;
  receiptUrl?: string;
  receiptFileName?: string;
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<InvoiceStatus, { bg: string; text: string; label: string; icon: typeof Clock }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit },
  coding: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificando", icon: Code },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente pago", icon: Clock },
  pending_approval: { bg: "bg-amber-50", text: "text-amber-700", label: "Pend. aprobación", icon: Clock },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada", icon: CheckCircle },
  coded: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificada", icon: Code },
  accounted: { bg: "bg-teal-50", text: "text-teal-700", label: "Contabilizada", icon: Lock },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada", icon: XCircle },
  paid: { bg: "bg-blue-50", text: "text-blue-700", label: "Pagada", icon: CreditCard },
  cancelled: { bg: "bg-red-50", text: "text-red-700", label: "Anulada", icon: Ban },
  returned: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Devuelta", icon: CheckCircle },
  partial_return: { bg: "bg-amber-50", text: "text-amber-700", label: "Devolución parcial", icon: Clock },
};

const DOC_TYPE_CONFIG: Record<DocumentType, { label: string; code: string; color: string }> = {
  invoice: { label: "Factura", code: "FRA", color: "text-indigo-600" },
  proforma: { label: "Proforma", code: "PRF", color: "text-violet-600" },
  autonomo: { label: "Autónomo", code: "AUT", color: "text-amber-600" },
  ticket: { label: "Ticket", code: "TKT", color: "text-emerald-600" },
  budget: { label: "Presupuesto", code: "PRS", color: "text-cyan-600" },
  guarantee: { label: "Fianza", code: "FNZ", color: "text-rose-600" },
};

const VAT_RATES = [0, 4, 10, 21];
const IRPF_RATES = [0, 7, 15, 19];
const PAYMENT_METHODS = [
  { value: "transfer", label: "Transferencia bancaria" },
  { value: "card", label: "Tarjeta" },
  { value: "cash", label: "Efectivo" },
  { value: "check", label: "Cheque" },
  { value: "direct_debit", label: "Domiciliación" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const invoiceId = params?.invoiceId as string;
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(projectId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [linkedPO, setLinkedPO] = useState<LinkedPO | null>(null);
  const [allInvoiceIds, setAllInvoiceIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [showOriginalDoc, setShowOriginalDoc] = useState(false);
  
  // Coding mode states
  const [codingMode, setCodingMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [codingForm, setCodingForm] = useState({
    supplierNumber: "", invoiceDate: "", dueDate: "", description: "", supplierTaxId: "", supplierIban: "", supplierBic: "",
    paymentMethod: "transfer", currency: "EUR", accountingEntry: "", isAsset: false, assetCategory: "", notes: "",
  });
  const [codingItems, setCodingItems] = useState<Array<{ description: string; subAccountId: string; subAccountCode: string; subAccountDescription: string; quantity: number; unitPrice: number; vatRate: number; irpfRate: number; poItemIndex?: number; isNewItem: boolean; }>>([]);
  const [searchSubAccount, setSearchSubAccount] = useState("");
  const [showApprovalNoteModal, setShowApprovalNoteModal] = useState<ApprovalComment | null>(null);
  const [replacingDocument, setReplacingDocument] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Guarantee return modal states
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnForm, setReturnForm] = useState({ amount: 0, date: "", notes: "" });
  const [returnFile, setReturnFile] = useState<File | null>(null);
  const [processingReturn, setProcessingReturn] = useState(false);
  const returnFileInputRef = useRef<HTMLInputElement>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".custom-dropdown")) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (type: "success" | "error", message: string) => { setToast({ type, message }); setTimeout(() => setToast(null), 3000); };
  const formatCurrency = (a: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0);
  const formatDate = (d: Date) => d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "-";
  const formatDateTime = (d: Date) => d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : "-";
  const formatDateInput = (d: Date) => d ? d.toISOString().split("T")[0] : "";

  useEffect(() => { if (projectId && invoiceId && !permissionsLoading) loadData(); }, [projectId, invoiceId, permissionsLoading]);

  const loadData = async () => {
    try {
      setLoading(true);
      const invoiceDoc = await getDoc(doc(db, `projects/${projectId}/invoices`, invoiceId));
      if (!invoiceDoc.exists()) { router.push(`/project/${projectId}/accounting/invoices`); return; }
      const data = invoiceDoc.data();
      const invoiceData: Invoice = {
        id: invoiceDoc.id, documentType: data.documentType || "invoice", number: data.number || "", displayNumber: data.displayNumber || `FRA-${data.number}`,
        supplierNumber: data.supplierNumber, supplier: data.supplier || "", supplierId: data.supplierId || "", supplierTaxId: data.supplierTaxId, supplierIban: data.supplierIban, supplierBic: data.supplierBic,
        department: data.department, description: data.description || "", notes: data.notes, items: data.items || [],
        baseAmount: data.baseAmount || 0, vatAmount: data.vatAmount || 0, irpfAmount: data.irpfAmount || 0, totalAmount: data.totalAmount || 0,
        invoiceDate: data.invoiceDate?.toDate(), dueDate: data.dueDate?.toDate() || new Date(), status: data.status || "pending",
        approvalStatus: data.approvalStatus, attachmentUrl: data.attachmentUrl, attachmentFileName: data.attachmentFileName,
        createdAt: data.createdAt?.toDate() || new Date(), createdBy: data.createdBy || "", createdByName: data.createdByName || "",
        codedAt: data.codedAt?.toDate(), codedBy: data.codedBy, codedByName: data.codedByName,
        approvedAt: data.approvedAt?.toDate(), approvedBy: data.approvedBy, approvedByName: data.approvedByName,
        paidAt: data.paidAt?.toDate(), paidAmount: data.paidAmount, paymentMethod: data.paymentMethod, paymentReference: data.paymentReference,
        cancelledAt: data.cancelledAt?.toDate(), cancelledByName: data.cancelledByName, cancellationReason: data.cancellationReason,
        poId: data.poId, poNumber: data.poNumber, requiresReplacement: data.requiresReplacement,
        replacedByInvoiceId: data.replacedByInvoiceId, isReplacement: data.isReplacement,
        replacesDocumentId: data.replacesDocumentId, replacesDocumentNumber: data.replacesDocumentNumber,
        currency: data.currency || "EUR", accountingEntry: data.accountingEntry, isAsset: data.isAsset, assetCategory: data.assetCategory,
        replacedFromType: data.replacedFromType, replacedAt: data.replacedAt?.toDate(),
        originalAttachmentUrl: data.originalAttachmentUrl, originalAttachmentFileName: data.originalAttachmentFileName,
        accounted: data.accounted || false, accountedAt: data.accountedAt?.toDate(), accountedBy: data.accountedBy,
        accountedByName: data.accountedByName, accountingEntryNumber: data.accountingEntryNumber, accountingAccount: data.accountingAccount,
        delegatedToAccounting: data.delegatedToAccounting || false, delegatedAt: data.delegatedAt?.toDate(), delegatedBy: data.delegatedBy, delegatedByName: data.delegatedByName,
        guaranteeReturns: (data.guaranteeReturns || []).map((r: any) => ({
          ...r,
          date: r.date?.toDate ? r.date.toDate() : new Date(r.date),
          createdAt: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
        })),
        totalReturned: data.totalReturned || 0,
        approvalSteps: (data.approvalSteps || []).map((step: any) => ({
          ...step,
          approvedAt: step.approvedAt?.toDate ? step.approvedAt.toDate() : undefined,
        })),
        currentApprovalStep: data.currentApprovalStep ?? null,
        comments: (data.comments || []).map((c: any) => ({
          ...c,
          createdAt: c.createdAt?.toDate ? c.createdAt.toDate() : new Date(),
        })),
      };
      setInvoice(invoiceData);

      // Init coding form
      setCodingForm({
        supplierNumber: data.supplierNumber || "", invoiceDate: formatDateInput(data.invoiceDate?.toDate() || new Date()),
        dueDate: formatDateInput(data.dueDate?.toDate() || new Date()), description: data.description || "",
        supplierTaxId: data.supplierTaxId || "", supplierIban: data.supplierIban || "", supplierBic: data.supplierBic || "",
        paymentMethod: data.paymentMethod || "transfer", currency: data.currency || "EUR",
        accountingEntry: data.accountingEntry || "", isAsset: data.isAsset || false, assetCategory: data.assetCategory || "", notes: data.notes || "",
      });
      setCodingItems((data.items || []).map((i: any) => ({
        description: i.description || "", subAccountId: i.subAccountId || "", subAccountCode: i.subAccountCode || "",
        subAccountDescription: i.subAccountDescription || "", quantity: i.quantity || 1, unitPrice: i.unitPrice || 0,
        vatRate: i.vatRate ?? 21, irpfRate: i.irpfRate ?? 0, poItemIndex: i.poItemIndex, isNewItem: i.isNewItem ?? (i.poItemIndex === undefined || i.poItemIndex === null),
      })));

      // Load PO
      if (data.poId) {
        const poDoc = await getDoc(doc(db, `projects/${projectId}/pos`, data.poId));
        if (poDoc.exists()) {
          const poData = poDoc.data();
          setLinkedPO({ id: poDoc.id, number: poData.number, supplier: poData.supplier, baseAmount: poData.baseAmount || 0, invoicedAmount: poData.invoicedAmount || 0, status: poData.status, items: poData.items });
        }
      }

      // Load invoice IDs for nav - filtrar por permisos
      const invoicesSnap = await getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "asc")));
      const accessibleInvoices = invoicesSnap.docs.filter((d) => {
        const invData = d.data();
        // Si es rol de proyecto, puede ver todas
        if (permissions.isProjectRole) return true;
        // Si es jefe de departamento, puede ver las de su departamento
        if (permissions.canViewDepartmentPOs && invData.department === permissions.department) return true;
        // Si solo puede ver las propias
        if (permissions.canViewOwnPOs && invData.createdBy === permissions.userId) return true;
        return false;
      });
      setAllInvoiceIds(accessibleInvoices.map((d) => d.id));
      setCurrentIndex(accessibleInvoices.findIndex((d) => d.id === invoiceId));

      // Load suppliers
      const suppliersSnap = await getDocs(collection(db, `projects/${projectId}/suppliers`));
      setSuppliers(suppliersSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Supplier[]);

      // Load subaccounts
      const accountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
      const subs: SubAccount[] = [];
      for (const acc of accountsSnap.docs) {
        const subSnap = await getDocs(collection(db, `projects/${projectId}/accounts/${acc.id}/subaccounts`));
        subSnap.docs.forEach((s) => {
          const sd = s.data();
          subs.push({ id: s.id, code: sd.code, description: sd.description, accountId: acc.id, committed: sd.committed || 0, actual: sd.actual || 0, budgeted: sd.budgeted || 0 });
        });
      }
      setSubAccounts(subs.sort((a, b) => a.code.localeCompare(b.code)));

      // Load payments for this invoice
      const forecastsSnap = await getDocs(collection(db, `projects/${projectId}/paymentForecasts`));
      const invoicePayments: PaymentRecord[] = [];
      for (const forecastDoc of forecastsSnap.docs) {
        const fData = forecastDoc.data();
        const items = fData.items || [];
        for (const item of items) {
          if (item.invoiceId === invoiceId && item.status === "completed") {
            invoicePayments.push({
              id: item.id,
              forecastId: forecastDoc.id,
              forecastName: fData.name || "Remesa",
              amount: item.partialAmount || item.amount,
              paidAt: item.completedAt?.toDate ? item.completedAt.toDate() : new Date(item.completedAt),
              paidByName: item.completedByName || "Usuario",
              receiptUrl: item.receiptUrl,
              receiptName: item.receiptName,
            });
          }
        }
      }
      setPayments(invoicePayments.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime()));

      setLoading(false);
    } catch (error) { console.error("Error:", error); setLoading(false); }
  };

  const loadSupplierData = async () => {
    if (!invoice?.supplierId) return;
    const sup = suppliers.find((s) => s.id === invoice.supplierId);
    if (sup) {
      setCodingForm((prev) => ({ ...prev, supplierTaxId: sup.taxId || prev.supplierTaxId, supplierIban: sup.iban || prev.supplierIban, supplierBic: sup.bic || prev.supplierBic }));
    }
  };

  const calculateItemTotals = (item: typeof codingItems[0]) => {
    const base = item.quantity * item.unitPrice;
    const vat = base * (item.vatRate / 100);
    const irpf = base * (item.irpfRate / 100);
    return { base, vat, irpf, total: base + vat - irpf };
  };

  const calculateTotals = () => {
    let base = 0, vat = 0, irpf = 0;
    codingItems.forEach((item) => { const t = calculateItemTotals(item); base += t.base; vat += t.vat; irpf += t.irpf; });
    return { base, vat, irpf, total: base + vat - irpf };
  };

  const addCodingItem = () => {
    setCodingItems([...codingItems, { description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "", quantity: 1, unitPrice: 0, vatRate: 21, irpfRate: 0, isNewItem: true }]);
  };

  const removeCodingItem = (index: number) => {
    if (codingItems.length <= 1) return;
    setCodingItems(codingItems.filter((_, i) => i !== index));
  };

  const updateCodingItem = (index: number, field: string, value: any) => {
    const updated = [...codingItems];
    updated[index] = { ...updated[index], [field]: value };
    setCodingItems(updated);
  };

  const selectSubAccount = (index: number, sub: SubAccount) => {
    updateCodingItem(index, "subAccountId", sub.id);
    updateCodingItem(index, "subAccountCode", sub.code);
    updateCodingItem(index, "subAccountDescription", sub.description);
    setSearchSubAccount("");
  };

  const handleSaveCoding = async () => {
    if (!invoice) return;
    // Validate
    if (!codingForm.invoiceDate) { showToast("error", "Fecha de factura requerida"); return; }
    if (codingItems.some((i) => !i.subAccountId)) { showToast("error", "Todas las partidas deben tener cuenta asignada"); return; }
    if (codingItems.some((i) => i.unitPrice <= 0)) { showToast("error", "Los importes deben ser mayores a 0"); return; }

    setSaving(true);
    try {
      const totals = calculateTotals();
      const items = codingItems.map((item) => {
        const t = calculateItemTotals(item);
        return { ...item, baseAmount: t.base, vatAmount: t.vat, irpfAmount: t.irpf, totalAmount: t.total };
      });

      const costSettings = await getCostSettings(projectId);

      // Con on_code: la codificación es el único trigger de realización, sin importar aprobaciones
      const isFirstCoding = costSettings.invoiceActualTrigger === "on_code" && !invoice.codedAt;
      const newStatus = isFirstCoding ? "coded" : invoice.status === "draft" ? "pending_approval" : invoice.status;

      // Guardar datos de la factura
      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoice.id), {
        supplierNumber: codingForm.supplierNumber, invoiceDate: codingForm.invoiceDate ? Timestamp.fromDate(new Date(codingForm.invoiceDate)) : null,
        dueDate: Timestamp.fromDate(new Date(codingForm.dueDate)), description: codingForm.description,
        supplierTaxId: codingForm.supplierTaxId, supplierIban: codingForm.supplierIban, supplierBic: codingForm.supplierBic,
        paymentMethod: codingForm.paymentMethod, currency: codingForm.currency, accountingEntry: codingForm.accountingEntry,
        isAsset: codingForm.isAsset, assetCategory: codingForm.assetCategory, notes: codingForm.notes,
        items, baseAmount: totals.base, vatAmount: totals.vat, irpfAmount: totals.irpf, totalAmount: totals.total,
        status: newStatus,
        codedAt: Timestamp.now(), codedBy: permissions.userId, codedByName: permissions.userName,
      });

      if (isFirstCoding) {
        // Primera codificación: realizar presupuesto con los ítems finales del equipo de conta
        const newBudgetItems = items.filter(i => i.subAccountId && i.baseAmount > 0)
          .map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
        if (newBudgetItems.length > 0) await realizeInvoice(projectId, newBudgetItems);
        if (invoice.poId) await updatePOItemsInvoiced(projectId, invoice.poId, items, "add");
      } else if (invoice.codedAt) {
        // Re-codificación: ajustar ítems de presupuesto y PO
        const oldBudgetItems = (invoice.items || [])
          .filter((i: any) => i.subAccountId && i.baseAmount > 0)
          .map((i: any) => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
        const newBudgetItems = items.filter(i => i.subAccountId && i.baseAmount > 0)
          .map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
        if (oldBudgetItems.length > 0) await unrealizeInvoice(projectId, oldBudgetItems);
        if (newBudgetItems.length > 0) await realizeInvoice(projectId, newBudgetItems);
        if (invoice.poId) {
          if (invoice.items && invoice.items.length > 0)
            await updatePOItemsInvoiced(projectId, invoice.poId, invoice.items, "subtract");
          await updatePOItemsInvoiced(projectId, invoice.poId, items, "add");
        }
      }

      showToast("success", "Factura codificada correctamente");
      setCodingMode(false);
      await loadData();
    } catch (error) { console.error("Error:", error); showToast("error", "Error al guardar"); } finally { setSaving(false); }
  };

  const verifyPassword = async (): Promise<boolean> => {
    if (!passwordInput.trim()) { setPasswordError("Introduce tu contraseña"); return false; }
    const user = auth.currentUser;
    if (!user?.email) { setPasswordError("No hay usuario autenticado"); return false; }
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, passwordInput));
      setPasswordError(""); return true;
    } catch (e: any) { setPasswordError(e.code?.includes("password") || e.code?.includes("credential") ? "Contraseña incorrecta" : "Error"); return false; }
  };

  const handleCancelInvoice = async () => {
    if (!invoice || !cancellationReason.trim()) return;
    if (!(await verifyPassword())) return;
    setProcessing(true);
    try {
      // Verificar si la factura estaba realizada según la configuración
      const costSettings = await getCostSettings(projectId);
      const wasRealized = shouldRealizeInvoice(invoice.status, costSettings);
      
      // Si estaba realizada, revertir el presupuesto
      if (wasRealized) {
        const budgetItems = invoice.items
          .filter(item => item.subAccountId && item.baseAmount > 0)
          .map(item => ({
            subAccountId: item.subAccountId,
            baseAmount: item.baseAmount,
          }));
        
        if (budgetItems.length > 0) {
          await unrealizeInvoice(projectId, budgetItems);
        }
        
        // Actualizar PO si existe - restar de cada item individual
        if (invoice.poId) {
          await updatePOItemsInvoiced(projectId, invoice.poId, invoice.items, "subtract");
        }
      }
      
      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoice.id), {
        status: "cancelled", 
        cancelledAt: Timestamp.now(), 
        cancelledBy: permissions.userId, 
        cancelledByName: permissions.userName, 
        cancellationReason: cancellationReason.trim(),
      });
      setShowCancelModal(false); 
      setPasswordInput(""); 
      setCancellationReason("");
      await loadData();
    } catch (e) { 
      showToast("error", "Error al anular"); 
    } finally { 
      setProcessing(false); 
    }
  };

  const navigateInvoice = (dir: "prev" | "next") => {
    const idx = dir === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (idx >= 0 && idx < allInvoiceIds.length) router.push(`/project/${projectId}/accounting/invoices/${allInvoiceIds[idx]}`);
  };

  const canCode = () => {
    if (invoice?.accounted) return false; // Bloqueada si está contabilizada
    return permissions.accountingAccessLevel === "accounting" || permissions.accountingAccessLevel === "accounting_extended";
  };
  const canPay = () => {
    return permissions.accountingAccessLevel === "accounting_extended";
  };
  const canCancel = () => {
    if (invoice?.accounted) return false; // Bloqueada si está contabilizada
    return invoice && !["cancelled", "paid"].includes(invoice.status) && permissions.isProjectRole;
  };
  // Solo contabilidad ampliada puede modificar (genera nueva versión y reinicia aprobaciones)
  const canModify = () => {
    if (invoice?.accounted) return false;
    if (invoice?.status === "cancelled" || invoice?.status === "paid") return false;
    return permissions.accountingAccessLevel === "accounting_extended";
  };
  // Solo contabilidad ampliada puede hacer corrección administrativa (sin nueva versión)
  const canAdminCorrect = () => {
    if (invoice?.accounted) return false;
    if (invoice?.status === "cancelled") return false;
    return permissions.accountingAccessLevel === "accounting_extended";
  };
  const canEdit = () => {
    if (invoice?.accounted) return false; // Bloqueada si está contabilizada
    return invoice && ["draft", "rejected"].includes(invoice.status);
  };
  const canReplaceDocument = () => {
    if (invoice?.accounted) return false;
    if (invoice?.status === "cancelled") return false;
    return permissions.accountingAccessLevel === "accounting_extended";
  };
  
  // Fianza: puede registrar devolución si es fianza pagada y tiene permisos
  const canRegisterReturn = () => {
    if (!invoice) return false;
    if (invoice.documentType !== "guarantee") return false;
    if (invoice.status !== "paid" && invoice.status !== "partial_return") return false;
    return permissions.accountingAccessLevel === "accounting_extended";
  };
  
  const getRemainingGuarantee = () => {
    if (!invoice) return 0;
    return invoice.totalAmount - (invoice.totalReturned || 0);
  };
  
  const openReturnModal = () => {
    const remaining = getRemainingGuarantee();
    setReturnForm({ amount: remaining, date: new Date().toISOString().split("T")[0], notes: "" });
    setReturnFile(null);
    setShowReturnModal(true);
  };
  
  const handleReturnFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setReturnFile(file);
  };
  
  const handleRegisterReturn = async () => {
    if (!invoice || !returnForm.amount || !returnForm.date) {
      showToast("error", "Completa el importe y la fecha");
      return;
    }
    
    const remaining = getRemainingGuarantee();
    if (returnForm.amount > remaining) {
      showToast("error", `El importe no puede superar el pendiente (${formatCurrency(remaining)} €)`);
      return;
    }
    
    setProcessingReturn(true);
    try {
      let receiptUrl = "";
      let receiptFileName = "";
      
      // Subir extracto si existe
      if (returnFile) {
        const timestamp = Date.now();
        const safeFileName = returnFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storageRef = ref(storage, `projects/${projectId}/invoices/${invoiceId}/returns/${timestamp}_${safeFileName}`);
        await uploadBytes(storageRef, returnFile);
        receiptUrl = await getDownloadURL(storageRef);
        receiptFileName = returnFile.name;
      }
      
      const returnEntry: GuaranteeReturn = {
        id: `return_${Date.now()}`,
        amount: returnForm.amount,
        date: new Date(returnForm.date),
        receiptUrl,
        receiptFileName,
        notes: returnForm.notes,
        createdAt: new Date(),
        createdBy: permissions.userId || "",
        createdByName: permissions.userName || "",
      };
      
      const newTotalReturned = (invoice.totalReturned || 0) + returnForm.amount;
      const isFullReturn = Math.abs(newTotalReturned - invoice.totalAmount) < 0.01;
      
      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoiceId), {
        guaranteeReturns: arrayUnion({
          ...returnEntry,
          date: Timestamp.fromDate(returnEntry.date),
          createdAt: Timestamp.now(),
        }),
        totalReturned: newTotalReturned,
        status: isFullReturn ? "returned" : "partial_return",
      });
      
      // Actualizar estado local
      setInvoice({
        ...invoice,
        guaranteeReturns: [...(invoice.guaranteeReturns || []), returnEntry],
        totalReturned: newTotalReturned,
        status: isFullReturn ? "returned" : "partial_return",
      });
      
      setShowReturnModal(false);
      showToast("success", isFullReturn ? "Fianza devuelta completamente" : "Devolución parcial registrada");
    } catch (error) {
      console.error("Error registering return:", error);
      showToast("error", "Error al registrar la devolución");
    } finally {
      setProcessingReturn(false);
    }
  };
  
  const isPDF = (url?: string) => url?.toLowerCase().includes(".pdf") || url?.toLowerCase().includes("application/pdf");

  const handleReplaceDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !invoice) return;
    
    setReplacingDocument(true);
    try {
      // Subir nuevo archivo
      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const storageRef = ref(storage, `projects/${projectId}/invoices/${invoiceId}/${timestamp}_${safeFileName}`);
      await uploadBytes(storageRef, file);
      const newUrl = await getDownloadURL(storageRef);
      
      // Preparar datos de auditoría
      const auditEntry = {
        action: "document_replaced",
        userId: permissions.userId || "",
        userName: permissions.userName || "",
        timestamp: Timestamp.now(),
        previousFileName: invoice.attachmentFileName || "",
        newFileName: file.name,
      };
      
      // Actualizar documento
      const updateData: Record<string, any> = {
        attachmentUrl: newUrl,
        attachmentFileName: file.name,
        documentHistory: arrayUnion(auditEntry),
        updatedAt: Timestamp.now(),
        updatedBy: permissions.userId || "",
        updatedByName: permissions.userName || "",
      };
      
      // Guardar documento anterior si no había original y existe uno actual
      if (!invoice.originalAttachmentUrl && invoice.attachmentUrl) {
        updateData.originalAttachmentUrl = invoice.attachmentUrl;
        updateData.originalAttachmentFileName = invoice.attachmentFileName || "";
      }
      
      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoiceId), updateData);
      
      // Actualizar estado local
      setInvoice({
        ...invoice,
        attachmentUrl: newUrl,
        attachmentFileName: file.name,
        ...((!invoice.originalAttachmentUrl && invoice.attachmentUrl) ? {
          originalAttachmentUrl: invoice.attachmentUrl,
          originalAttachmentFileName: invoice.attachmentFileName || "",
        } : {}),
      });
      
      showToast("success", "Documento reemplazado correctamente");
    } catch (error) {
      console.error("Error replacing document:", error);
      showToast("error", "Error al reemplazar el documento");
    } finally {
      setReplacingDocument(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
          <p className="text-slate-500 mb-6">No tienes permisos para ver este documento.</p>
          <Link
            href={`/project/${projectId}/accounting/invoices`}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#2F52E0" }}
          >
            Volver a facturas
          </Link>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const config = STATUS_CONFIG[invoice.status];
  const docConfig = DOC_TYPE_CONFIG[invoice.documentType];
  const StatusIcon = config.icon;
  const totals = calculateTotals();

  // Coding Mode UI
  if (codingMode) {
    return (
      <div className={`min-h-screen bg-slate-100 ${inter.className}`}>
        {toast && <div className="fixed bottom-4 right-4 z-50"><div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white text-sm font-medium`}>{toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{toast.message}</div></div>}
        
        {/* Coding Header */}
        <div className="bg-violet-600 text-white px-6 py-3 flex items-center justify-between fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-4">
            <button onClick={() => setCodingMode(false)} className="p-2 hover:bg-violet-700 rounded-lg"><X size={20} /></button>
            <div className="flex items-center gap-3">
              <Code size={20} />
              <span className="font-semibold">Codificar</span>
              <span className="bg-violet-500 px-2 py-0.5 rounded text-sm">{invoice.displayNumber}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-violet-200 text-sm">Total: <span className="font-bold text-white">{formatCurrency(totals.total)} €</span></span>
            <button onClick={handleSaveCoding} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-white text-violet-700 rounded-xl text-sm font-semibold hover:bg-violet-50 disabled:opacity-50 shadow-lg">
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <FileCheck size={16} />}
              {saving ? "Guardando..." : "Completar codificación"}
            </button>
          </div>
        </div>

        <div className="flex pt-[52px]" style={{ height: "100vh" }}>
          {/* Left: Document Preview */}
          <div className="w-1/2 bg-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm">Vista previa del documento</span>
                {invoice.replacedFromType && invoice.originalAttachmentUrl && (
                  <button
                    onClick={() => setShowOriginalDoc(!showOriginalDoc)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${showOriginalDoc ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-300 hover:bg-slate-600"}`}
                  >
                    {showOriginalDoc ? "Ver factura" : `Ver ${invoice.replacedFromType === "proforma" ? "proforma" : "presupuesto"} original`}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setZoomLevel(Math.max(50, zoomLevel - 25))} className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ZoomOut size={16} /></button>
                <span className="text-slate-400 text-xs w-12 text-center">{zoomLevel}%</span>
                <button onClick={() => setZoomLevel(Math.min(200, zoomLevel + 25))} className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ZoomIn size={16} /></button>
                {(showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl) && (
                  <a href={showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ExternalLink size={16} /></a>
                )}
              </div>
            </div>
            {showOriginalDoc && invoice.originalAttachmentUrl && (
              <div className="bg-violet-600/20 border border-violet-500/30 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
                <FileText size={14} className="text-violet-400" />
                <span className="text-violet-300 text-xs">
                  Mostrando {invoice.replacedFromType === "proforma" ? "proforma" : "presupuesto"} original
                </span>
              </div>
            )}
            <div className="flex-1 bg-slate-900 rounded-xl overflow-auto">
              {(() => {
                const currentUrl = showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl;
                return currentUrl ? (
                  isPDF(currentUrl) ? (
                    <iframe src={`${currentUrl}#toolbar=0`} className="w-full h-full" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left", width: `${100 / (zoomLevel / 100)}%`, height: `${100 / (zoomLevel / 100)}%` }} />
                  ) : (
                    <img src={currentUrl} alt="Documento" className="max-w-full" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left" }} />
                  )
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500"><FileUp size={48} className="mb-2" /><p>Sin documento</p></div>
                );
              })()}
            </div>
          </div>

          {/* Right: Coding Form */}
          <div className="w-1/2 overflow-y-auto p-6">
            {/* Header Info */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Nº Factura proveedor</label>
                  <input value={codingForm.supplierNumber} onChange={(e) => setCodingForm({ ...codingForm, supplierNumber: e.target.value })} placeholder="Número de proveedor" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fecha factura</label>
                  <input type="date" value={codingForm.invoiceDate} onChange={(e) => setCodingForm({ ...codingForm, invoiceDate: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fecha vencimiento</label>
                  <input type="date" value={codingForm.dueDate} onChange={(e) => setCodingForm({ ...codingForm, dueDate: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="mt-4">
                <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                <input value={codingForm.description} onChange={(e) => setCodingForm({ ...codingForm, description: e.target.value })} placeholder="Descripción de la factura" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
              </div>
            </div>

            {/* Supplier Info */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Building2 size={16} className="text-slate-400" />Proveedor: {invoice.supplier}</h3>
                <button onClick={loadSupplierData} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><RefreshCw size={12} />Cargar datos</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">CIF/NIF</label>
                  <input value={codingForm.supplierTaxId} onChange={(e) => setCodingForm({ ...codingForm, supplierTaxId: e.target.value })} placeholder="B12345678" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">IBAN</label>
                  <input value={codingForm.supplierIban} onChange={(e) => setCodingForm({ ...codingForm, supplierIban: e.target.value })} placeholder="ES12 3456 7890 1234 5678 90" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">BIC</label>
                  <input value={codingForm.supplierBic} onChange={(e) => setCodingForm({ ...codingForm, supplierBic: e.target.value })} placeholder="BBVAESMMXXX" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Líneas de codificación</h3>
                <div className="flex items-center gap-2">
                  {linkedPO && linkedPO.items && linkedPO.items.length > 0 && (
                    <button 
                      onClick={() => {
                        const poItems = linkedPO.items!.map((poItem: any, idx: number) => ({
                          description: poItem.description || "",
                          subAccountId: poItem.subAccountId || "",
                          subAccountCode: poItem.subAccountCode || "",
                          subAccountDescription: poItem.subAccountDescription || "",
                          quantity: poItem.quantity || 1,
                          unitPrice: poItem.unitPrice || 0,
                          vatRate: poItem.vatRate ?? 21,
                          irpfRate: poItem.irpfRate ?? 0,
                          poItemIndex: idx,
                          isNewItem: false,
                        }));
                        setCodingItems(poItems);
                      }} 
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-200"
                    >
                      <LinkIcon size={14} />Importar de PO
                    </button>
                  )}
                  <button onClick={addCodingItem} className="flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-200"><Plus size={14} />Añadir línea</button>
                </div>
              </div>

              {/* PO Items selector */}
              {linkedPO && linkedPO.items && linkedPO.items.length > 0 && (
                <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <p className="text-xs font-medium text-indigo-800 mb-2">Añadir línea desde PO-{linkedPO.number}:</p>
                  <div className="flex flex-wrap gap-2">
                    {linkedPO.items.map((poItem: any, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setCodingItems([...codingItems, {
                            description: poItem.description || "",
                            subAccountId: poItem.subAccountId || "",
                            subAccountCode: poItem.subAccountCode || "",
                            subAccountDescription: poItem.subAccountDescription || "",
                            quantity: poItem.quantity || 1,
                            unitPrice: poItem.unitPrice || 0,
                            vatRate: poItem.vatRate ?? 21,
                            irpfRate: poItem.irpfRate ?? 0,
                            poItemIndex: idx,
                            isNewItem: false,
                          }]);
                        }}
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-200 rounded-lg text-xs hover:bg-indigo-100 transition-colors"
                      >
                        <span className="font-medium text-indigo-700">#{idx + 1}</span>
                        <span className="text-slate-600 truncate max-w-[150px]">{poItem.description || "Sin descripción"}</span>
                        <span className="font-mono text-slate-500">{formatCurrency(poItem.unitPrice || 0)}€</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {codingItems.map((item, idx) => (
                  <div key={idx} className={`border rounded-xl p-4 relative ${item.isNewItem ? "border-amber-200 bg-amber-50/30" : "border-indigo-200 bg-indigo-50/30"}`}>
                    <div className="absolute -top-2 left-3 flex items-center gap-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-500 font-medium">Línea {idx + 1}</span>
                      {item.isNewItem ? (
                        <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                          <Plus size={10} />Nuevo
                        </span>
                      ) : (
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                          <LinkIcon size={10} />De PO
                        </span>
                      )}
                    </div>
                    {codingItems.length > 1 && <button onClick={() => removeCodingItem(idx)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>}
                    
                    <div className="grid grid-cols-12 gap-3 mt-2">
                      <div className="col-span-12">
                        <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                        <input value={item.description} onChange={(e) => updateCodingItem(idx, "description", e.target.value)} placeholder="Descripción del concepto" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                      </div>
                      
                      <div className="col-span-6">
                        <label className="text-xs text-slate-500 block mb-1">Cuenta / Partida</label>
                        <div className="relative">
                          {item.subAccountId ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg">
                              <span className="font-mono text-sm text-violet-700">{item.subAccountCode}</span>
                              <span className="text-xs text-slate-600 truncate flex-1">{item.subAccountDescription}</span>
                              <button onClick={() => { updateCodingItem(idx, "subAccountId", ""); updateCodingItem(idx, "subAccountCode", ""); updateCodingItem(idx, "subAccountDescription", ""); }} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                            </div>
                          ) : (
                            <div className="relative">
                              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              <input placeholder="Buscar cuenta" value={searchSubAccount} onChange={(e) => setSearchSubAccount(e.target.value)} onFocus={() => setSearchSubAccount("")} className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                              {searchSubAccount && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                                  {subAccounts.filter((s) => s.code.toLowerCase().includes(searchSubAccount.toLowerCase()) || s.description.toLowerCase().includes(searchSubAccount.toLowerCase())).slice(0, 10).map((s) => (
                                    <button key={s.id} onClick={() => selectSubAccount(idx, s)} className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-sm">
                                      <span className="font-mono text-violet-600">{s.code}</span>
                                      <span className="text-slate-600 truncate">{s.description}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {linkedPO && linkedPO.items && (
                        <div className="col-span-3">
                          <label className="text-xs text-slate-500 block mb-1">Origen</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                updateCodingItem(idx, "isNewItem", !item.isNewItem);
                                if (!item.isNewItem) updateCodingItem(idx, "poItemIndex", undefined);
                              }}
                              className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${item.isNewItem ? "bg-amber-100 text-amber-700 border border-amber-200" : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"}`}
                            >
                              Nuevo
                            </button>
                            <button
                              type="button"
                              onClick={() => updateCodingItem(idx, "isNewItem", false)}
                              className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${!item.isNewItem ? "bg-indigo-100 text-indigo-700 border border-indigo-200" : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"}`}
                            >
                              De PO
                            </button>
                          </div>
                        </div>
                      )}

                      {linkedPO && linkedPO.items && !item.isNewItem && (
                        <div className="col-span-3">
                          <label className="text-xs text-slate-500 block mb-1">Línea de PO</label>
                          <div className="relative custom-dropdown">
                            <button
                              type="button"
                              onClick={() => setOpenDropdown(openDropdown === `poitem-${idx}` ? null : `poitem-${idx}`)}
                              className="w-full px-3 py-2 border border-indigo-200 bg-indigo-50 rounded-lg text-sm text-left flex items-center justify-between gap-2 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors"
                            >
                              <span className="text-slate-900 truncate">
                                {item.poItemIndex !== undefined && item.poItemIndex !== null
                                  ? `#${item.poItemIndex + 1} - ${linkedPO.items[item.poItemIndex]?.description?.substring(0, 30) || `Línea ${item.poItemIndex + 1}`}`
                                  : "Seleccionar..."}
                              </span>
                              <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `poitem-${idx}` ? "rotate-180" : ""}`} />
                            </button>
                            {openDropdown === `poitem-${idx}` && (
                              <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                                <button
                                  type="button"
                                  onClick={() => { updateCodingItem(idx, "poItemIndex", undefined); setOpenDropdown(null); }}
                                  className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.poItemIndex === undefined || item.poItemIndex === null ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                >
                                  Seleccionar...
                                </button>
                                {linkedPO.items.map((poItem: any, i: number) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => { updateCodingItem(idx, "poItemIndex", i); setOpenDropdown(null); }}
                                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.poItemIndex === i ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                  >
                                    #{i + 1} - {poItem.description?.substring(0, 30) || `Línea ${i + 1}`}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">IVA %</label>
                        <div className="relative custom-dropdown">
                          <button
                            type="button"
                            onClick={() => setOpenDropdown(openDropdown === `vat-${idx}` ? null : `vat-${idx}`)}
                            className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors"
                          >
                            <span className="text-slate-900 truncate">{item.vatRate}%</span>
                            <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `vat-${idx}` ? "rotate-180" : ""}`} />
                          </button>
                          {openDropdown === `vat-${idx}` && (
                            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                              {VAT_RATES.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => { updateCodingItem(idx, "vatRate", Number(r)); setOpenDropdown(null); }}
                                  className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.vatRate === r ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                >
                                  {r}%
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">IRPF %</label>
                        <div className="relative custom-dropdown">
                          <button
                            type="button"
                            onClick={() => setOpenDropdown(openDropdown === `irpf-${idx}` ? null : `irpf-${idx}`)}
                            className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors"
                          >
                            <span className="text-slate-900 truncate">{item.irpfRate}%</span>
                            <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `irpf-${idx}` ? "rotate-180" : ""}`} />
                          </button>
                          {openDropdown === `irpf-${idx}` && (
                            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                              {IRPF_RATES.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => { updateCodingItem(idx, "irpfRate", Number(r)); setOpenDropdown(null); }}
                                  className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.irpfRate === r ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                >
                                  {r}%
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">Cantidad</label>
                        <input type="number" step="0.01" min="0" value={item.quantity || ""} onChange={(e) => updateCodingItem(idx, "quantity", parseFloat(e.target.value) || 0)} placeholder="1" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none text-right font-mono" />
                      </div>

                      <div className="col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">Precio unit.</label>
                        <div className="relative">
                          <input type="number" step="0.01" value={item.unitPrice || ""} onChange={(e) => updateCodingItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} placeholder="0.00" className="w-full px-3 py-2 pr-8 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none text-right font-mono" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
                        </div>
                      </div>

                      <div className="col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">Total línea</label>
                        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-right font-mono font-semibold text-slate-900">
                          {formatCurrency(calculateItemTotals(item).total)} €
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">Base imponible</p><p className="font-bold text-slate-900">{formatCurrency(totals.base)} €</p></div>
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">IVA</p><p className="font-bold text-emerald-600">+{formatCurrency(totals.vat)} €</p></div>
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">IRPF</p><p className="font-bold text-red-600">-{formatCurrency(totals.irpf)} €</p></div>
                <div className="text-center bg-white rounded-xl p-3"><p className="text-violet-600 text-xs mb-1">TOTAL</p><p className="font-bold text-xl text-violet-700">{formatCurrency(totals.total)} €</p></div>
              </div>
            </div>

            {/* Extra Info */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900 mb-4">Información adicional</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 block mb-1">Método de pago</label>
                  <div className="relative custom-dropdown">
                    <button
                      type="button"
                      onClick={() => setOpenDropdown(openDropdown === "paymentMethod" ? null : "paymentMethod")}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors"
                    >
                      <span className="text-slate-900 truncate">{PAYMENT_METHODS.find(m => m.value === codingForm.paymentMethod)?.label ?? codingForm.paymentMethod}</span>
                      <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === "paymentMethod" ? "rotate-180" : ""}`} />
                    </button>
                    {openDropdown === "paymentMethod" && (
                      <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                        {PAYMENT_METHODS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setCodingForm({ ...codingForm, paymentMethod: opt.value }); setOpenDropdown(null); }}
                            className={`w-full px-4 py-2 text-left text-sm transition-colors ${codingForm.paymentMethod === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={codingForm.isAsset} onChange={(e) => setCodingForm({ ...codingForm, isAsset: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
                    <span className="text-sm text-slate-700">Es un activo / inventario</span>
                  </label>
                </div>
                {codingForm.isAsset && (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 block mb-1">Categoría de activo</label>
                    <input value={codingForm.assetCategory} onChange={(e) => setCodingForm({ ...codingForm, assetCategory: e.target.value })} placeholder="Categoría del activo" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 block mb-1">Notas internas</label>
                  <textarea value={codingForm.notes} onChange={(e) => setCodingForm({ ...codingForm, notes: e.target.value })} rows={2} placeholder="Notas para el equipo de contabilidad" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none resize-none" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal Detail View
  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50"><div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white text-sm font-medium`}>{toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{toast.message}</div></div>}
      
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <Receipt size={24} className="text-slate-400" />
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-semibold text-slate-900">{docConfig.label}</h1>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-sm font-mono">{invoice.displayNumber}</span>
                  {/* Estado principal */}
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium text-sm ${config.bg} ${config.text}`}><StatusIcon size={14} />{config.label}</span>
                  {/* Badge "Codificada" solo cuando el status ya avanzó más allá de coded */}
                  {invoice.codedAt && invoice.status !== "coded" && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-100 text-violet-700 rounded-lg font-medium text-sm">
                      <FileCheck size={14} />Codificada
                    </span>
                  )}
                  {/* Contabilizada */}
                  {invoice.accounted && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg font-medium text-sm">
                      <Lock size={14} />Contabilizada
                    </span>
                  )}
                  {invoice.poNumber && <Link href={`/project/${projectId}/accounting/pos/${invoice.poId}`} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100"><LinkIcon size={12} />PO-{invoice.poNumber}</Link>}
                </div>
                <p className="text-slate-500 text-sm mt-1">{invoice.supplier}{invoice.department && <span className="ml-2 text-slate-400">· {invoice.department}</span>}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 mr-2">
                <button onClick={() => navigateInvoice("prev")} disabled={currentIndex <= 0} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="text-xs text-slate-500 px-2">{currentIndex + 1} / {allInvoiceIds.length}</span>
                <button onClick={() => navigateInvoice("next")} disabled={currentIndex >= allInvoiceIds.length - 1} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>

              {canCode() && invoice.status !== "cancelled" && (
                <button onClick={() => setCodingMode(true)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${invoice.codedAt ? "bg-violet-100 text-violet-700 hover:bg-violet-200" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
                  <Code size={16} />
                  {invoice.codedAt ? "Editar codificación" : "Codificar"}
                </button>
              )}

              {canModify() && (
                <Link href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium">
                  <Edit size={16} />Modificar
                </Link>
              )}
              {invoice.status === "pending" && canPay() && <Link href={`/project/${projectId}/accounting/payments?invoice=${invoice.id}`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium"><CreditCard size={16} />Ir a pagar</Link>}
              
              {/* Botón de devolución para fianzas */}
              {canRegisterReturn() && (
                <button onClick={openReturnModal} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 text-sm font-medium">
                  <RefreshCw size={16} />Registrar devolución
                </button>
              )}

              <div className="relative">
                <button onClick={() => setShowActionsMenu(!showActionsMenu)} className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50"><MoreHorizontal size={18} /></button>
                {showActionsMenu && (<><div className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} /><div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
                  {invoice.attachmentUrl && <a href={invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" onClick={() => setShowActionsMenu(false)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><Download size={16} className="text-slate-400" />Descargar</a>}
                  {canReplaceDocument() && (
                    <button 
                      onClick={() => { fileInputRef.current?.click(); setShowActionsMenu(false); }} 
                      disabled={replacingDocument}
                      className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3 disabled:opacity-50"
                    >
                      <Upload size={16} className="text-slate-400" />
                      {replacingDocument ? "Subiendo..." : "Reemplazar documento"}
                    </button>
                  )}
                  {canAdminCorrect() && <Link href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit?mode=correction`} onClick={() => setShowActionsMenu(false)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><FileCheck size={16} className="text-slate-400" />Corrección administrativa</Link>}
                  {canCancel() && <><div className="border-t border-slate-100 my-1" /><button onClick={() => { setShowCancelModal(true); setShowActionsMenu(false); }} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"><XCircle size={16} />Anular</button></>}
                </div></>)}
              </div>
              
              {/* Input oculto para reemplazar documento */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleReplaceDocument} 
                accept=".pdf,.jpg,.jpeg,.png,.webp" 
                className="hidden" 
              />
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Banner de delegación a contabilidad */}
        {invoice.status === "coding" && invoice.delegatedToAccounting && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <Clock size={20} className="text-amber-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-amber-800 mb-1">Pendiente de codificación</h3>
                <p className="text-sm text-amber-700">
                  Esta factura fue enviada sin codificar por <span className="font-medium">{invoice.delegatedByName || invoice.createdByName}</span>
                  {invoice.delegatedAt && <span> el {formatDate(invoice.delegatedAt)}</span>}.
                  Los items necesitan asignación de cuentas contables.
                </p>
                {canCode() && (
                  <button 
                    onClick={() => setCodingMode(true)} 
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
                  >
                    <Code size={14} />
                    Codificar ahora
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Descripción siempre primero */}
        {invoice.description && (
          <div className="mb-6 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4">
            <p className="text-slate-700">{invoice.description}</p>
          </div>
        )}

        {/* Info compacta de codificación y contabilización */}
        {invoice.codedAt && (
          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <FileCheck size={12} className="text-violet-500" />
              <span>Codificada por {invoice.codedByName}</span>
            </span>
            {invoice.supplierNumber && (
              <span>Nº prov: <span className="font-mono text-slate-700">{invoice.supplierNumber}</span></span>
            )}
            {invoice.supplierTaxId && (
              <span>CIF: <span className="font-mono text-slate-700">{invoice.supplierTaxId}</span></span>
            )}
            {invoice.supplierIban && (
              <span>IBAN: <span className="font-mono text-slate-700">{invoice.supplierIban}</span></span>
            )}
            {invoice.accounted && (
              <>
                <span className="flex items-center gap-1.5">
                  <Lock size={12} className="text-emerald-500" />
                  <span>Asiento: <span className="font-mono text-emerald-700 font-medium">{invoice.accountingEntryNumber}</span></span>
                </span>
                <span className="text-slate-400">por {invoice.accountedByName}</span>
              </>
            )}
            {canCode() && (
              <button onClick={() => setCodingMode(true)} className="text-violet-600 hover:text-violet-800 font-medium">
                Editar
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* Left: Document Preview */}
          <div className="space-y-6">
            {/* Document Preview with actions */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-slate-900">Documento</h3>
                  {invoice.replacedFromType && invoice.originalAttachmentUrl && (
                    <button
                      onClick={() => setShowOriginalDoc(!showOriginalDoc)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${showOriginalDoc ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    >
                      {showOriginalDoc ? "Ver factura" : `Ver ${invoice.replacedFromType === "proforma" ? "proforma" : "presupuesto"}`}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEdit() && !invoice.replacedFromType && (
                    <Link 
                      href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit?replaceDoc=true`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg font-medium"
                    >
                      <RefreshCw size={12} />
                      Sustituir
                    </Link>
                  )}
                  {(showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl) && (
                    <a href={showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">
                      <ExternalLink size={12} />
                      Abrir
                    </a>
                  )}
                </div>
              </div>
              {showOriginalDoc && invoice.originalAttachmentUrl && (
                <div className="bg-violet-50 border-b border-violet-100 px-6 py-2 flex items-center gap-2">
                  <FileText size={14} className="text-violet-600" />
                  <span className="text-violet-700 text-xs font-medium">
                    Mostrando {invoice.replacedFromType === "proforma" ? "proforma" : "presupuesto"} original
                  </span>
                </div>
              )}
              <div className="p-4">
                {(() => {
                  const currentUrl = showOriginalDoc ? invoice.originalAttachmentUrl : invoice.attachmentUrl;
                  return currentUrl ? (
                    isPDF(currentUrl) ? (
                      <iframe src={`${currentUrl}#toolbar=0`} className="w-full h-[600px] rounded-xl border border-slate-200" />
                    ) : (
                      <img src={currentUrl} alt="Doc" className="w-full rounded-xl border border-slate-200" />
                    )
                  ) : (
                    <div className="h-[300px] bg-slate-50 rounded-xl flex flex-col items-center justify-center gap-3">
                      <FileUp size={32} className="text-slate-300" />
                      <p className="text-sm text-slate-400">Sin documento adjunto</p>
                      {canEdit() && (
                        <Link 
                          href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit?addDoc=true`}
                          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                        >
                          <FileUp size={14} />
                          Añadir documento
                        </Link>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {invoice.notes && <div className="bg-white border border-slate-200 rounded-2xl p-6"><h3 className="font-semibold text-slate-900 mb-3">Notas</h3><p className="text-sm text-slate-600">{invoice.notes}</p></div>}
          </div>

          {/* Right: Info */}
          <div className="space-y-6">
            {/* Items FIRST */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Líneas de factura</h3>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{invoice.items.length} {invoice.items.length === 1 ? 'línea' : 'líneas'}</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                {invoice.items.map((item, i) => {
                  const episodeLabel = item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0
                    ? item.episodes.length === 1 
                      ? item.episodes[0].episode.toString()
                      : item.episodes.map(e => e.episode).join(", ")
                    : "General";
                  return (
                    <div key={i} className={`p-4 ${item.isNewItem ? "bg-amber-50/50" : ""}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-slate-900">{item.description || "Sin descripción"}</p>
                            {item.isNewItem ? (
                              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5"><Plus size={8} />Nuevo</span>
                            ) : item.poItemIndex !== undefined && item.poItemIndex !== null ? (
                              <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5"><LinkIcon size={8} />PO #{item.poItemIndex + 1}</span>
                            ) : null}
                          </div>
                          <p className="text-sm text-slate-500">{item.subAccountCode} · {item.subAccountDescription}</p>
                        </div>
                        <p className="font-bold text-slate-900">{formatCurrency(item.baseAmount)} €</p>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {item.vatRate > 0 && <span>IVA {item.vatRate}%</span>}
                        {item.irpfRate > 0 && <span className="text-red-500">IRPF {item.irpfRate}%</span>}
                        {item.episodeAssignment && (
                          <span className="flex items-center gap-1 text-violet-600">
                            <Layers size={10} />
                            {episodeLabel}
                          </span>
                        )}
                      </div>
                      {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.episodes.map((ep) => (
                            <span key={ep.episode} className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-lg">
                              {ep.episode}: {formatCurrency(ep.amount)} €
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary AFTER items */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Resumen</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Base imponible</span><span className="font-medium">{formatCurrency(invoice.baseAmount)} €</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">IVA</span><span className="font-medium text-emerald-600">+{formatCurrency(invoice.vatAmount)} €</span></div>
                {invoice.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">IRPF</span><span className="font-medium text-red-600">-{formatCurrency(invoice.irpfAmount)} €</span></div>}
                <div className="pt-3 border-t border-slate-200 flex justify-between"><span className="font-medium">Total</span><span className="text-xl font-bold">{formatCurrency(invoice.totalAmount)} €</span></div>
              </div>
            </div>

            {/* Coding Status - Only show if NOT coded yet */}
            {!invoice.codedAt && canCode() && invoice.status !== "cancelled" ? (
              <button 
                onClick={() => setCodingMode(true)} 
                className="w-full bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-violet-100 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                  <Code size={20} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-violet-900">Codificar factura</p>
                  <p className="text-xs text-violet-700">Añadir datos fiscales y contables</p>
                </div>
                <ChevronRight size={20} className="text-violet-400" />
              </button>
            ) : !invoice.codedAt && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Clock size={16} className="text-slate-400" />
                </div>
                <div>
                  <p className="font-medium text-slate-700">Pendiente de codificación</p>
                  <p className="text-xs text-slate-500">Por asignar a contabilidad</p>
                </div>
              </div>
            )}

            {/* Payments Section */}
            {(invoice.status === "paid" || payments.length > 0) && (
              <div className={`border rounded-2xl p-5 ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CreditCard size={18} className={payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-600" : "text-amber-600"} />
                    <span className={`font-semibold ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-900" : "text-amber-900"}`}>
                      {payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "Pagada completamente" : "Pago parcial"}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-700" : "text-amber-700"}`}>
                      {formatCurrency(payments.reduce((sum, p) => sum + p.amount, 0))} €
                    </p>
                    {payments.reduce((sum, p) => sum + p.amount, 0) < invoice.totalAmount * 0.99 && (
                      <p className="text-xs text-amber-600">de {formatCurrency(invoice.totalAmount)} € ({Math.round((payments.reduce((sum, p) => sum + p.amount, 0) / invoice.totalAmount) * 100)}%)</p>
                    )}
                  </div>
                </div>

                {/* Progress bar for partial payments */}
                {payments.reduce((sum, p) => sum + p.amount, 0) < invoice.totalAmount * 0.99 && (
                  <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden mb-4">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min(100, (payments.reduce((sum, p) => sum + p.amount, 0) / invoice.totalAmount) * 100)}%` }} />
                  </div>
                )}

                {/* Individual payments */}
                {payments.length > 0 && (
                  <div className="space-y-2">
                    <p className={`text-xs font-medium mb-2 ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-700" : "text-amber-700"}`}>
                      Pagos realizados ({payments.length})
                    </p>
                    {payments.map((payment) => (
                      <div key={payment.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "bg-emerald-100" : "bg-amber-100"}`}>
                          <CheckCircle size={14} className={payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-600" : "text-amber-600"} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{payment.forecastName}</p>
                          <p className="text-xs text-slate-500">{formatDate(payment.paidAt)} · {payment.paidByName}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{formatCurrency(payment.amount)} €</p>
                          {payment.receiptUrl && (
                            <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center justify-end gap-1">
                              <FileText size={10} />Justificante
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {payments.length === 0 && invoice.paidAt && (
                  <div className="bg-white rounded-xl p-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                      <CheckCircle size={14} className="text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{formatCurrency(invoice.paidAmount || invoice.totalAmount)} €</p>
                      <p className="text-xs text-slate-500">Pagado el {formatDate(invoice.paidAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Replaced Document Alert - factura definitiva subida */}
            {invoice.replacedFromType && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <CheckCircle size={20} className="text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-emerald-900">Factura definitiva subida</p>
                    <p className="text-sm text-emerald-700 mt-1">
                      Este documento era {invoice.replacedFromType === "proforma" ? "una proforma" : "un presupuesto"} y ha sido sustituido por la factura definitiva.
                      {invoice.replacedAt && ` Sustituido el ${formatDate(invoice.replacedAt)}.`}
                    </p>
                    {invoice.originalAttachmentUrl && (
                      <button
                        onClick={() => setShowOriginalDoc(true)}
                        className="mt-2 text-sm text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1"
                      >
                        <FileText size={14} />
                        Ver {invoice.replacedFromType === "proforma" ? "proforma" : "presupuesto"} original
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Pending Replacement Alert */}
            {invoice.requiresReplacement && !invoice.replacedFromType && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <RefreshCw size={20} className="text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900">Pendiente de factura definitiva</p>
                    <p className="text-sm text-amber-700 mt-1">
                      {invoice.status === "paid" 
                        ? "Este documento ha sido pagado. Recuerda subir la factura definitiva del proveedor."
                        : "Este documento provisional deberá ser sustituido por la factura definitiva del proveedor."}
                    </p>
                    <Link
                      href={`/project/${projectId}/accounting/invoices/replace?docId=${invoice.id}`}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 transition-colors"
                    >
                      <RefreshCw size={16} />
                      Subir factura definitiva
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Linked PO */}
            {linkedPO && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <LinkIcon size={16} className="text-indigo-600" />
                    <span className="font-semibold text-indigo-900">PO-{linkedPO.number}</span>
                  </div>
                  <Link href={`/project/${projectId}/accounting/pos/${linkedPO.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">Ver PO <ExternalLink size={10} /></Link>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="text-indigo-600 text-xs">Base</p>
                    <p className="font-medium text-slate-900">{formatCurrency(linkedPO.baseAmount)} €</p>
                  </div>
                  <div>
                    <p className="text-indigo-600 text-xs">Facturado</p>
                    <p className="font-medium text-slate-900">{formatCurrency(linkedPO.invoicedAmount)} €</p>
                  </div>
                  <div className="flex-1">
                    <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, (linkedPO.invoicedAmount / linkedPO.baseAmount) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-indigo-600 font-medium">{Math.round((linkedPO.invoicedAmount / linkedPO.baseAmount) * 100)}%</span>
                </div>
              </div>
            )}

            {/* Details - More compact */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Detalles</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Proveedor</p>
                    <p className="font-medium">{invoice.supplier}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-amber-500" />
                  <div>
                    <p className="text-xs text-slate-500">{invoice.documentType === "guarantee" ? "Fecha depósito" : "Vencimiento"}</p>
                    <p className="font-medium">{formatDate(invoice.dueDate)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Creado por</p>
                    <p className="font-medium">{invoice.createdByName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Fecha creación</p>
                    <p className="font-medium">{formatDate(invoice.createdAt)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cancellation Info */}
            {invoice.status === "cancelled" && invoice.cancellationReason && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Ban size={16} className="text-red-600" />
                  <span className="font-semibold text-red-900">Anulada</span>
                </div>
                <p className="text-sm text-red-700">{invoice.cancellationReason}</p>
                <p className="text-xs text-red-500 mt-2">{invoice.cancelledByName} · {formatDateTime(invoice.cancelledAt!)}</p>
              </div>
            )}

            {/* Guarantee Returns History */}
            {invoice.documentType === "guarantee" && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <RefreshCw size={16} className="text-emerald-600" />
                    <span className="font-semibold text-emerald-900">Estado de la fianza</span>
                  </div>
                  {invoice.status === "returned" ? (
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium">Devuelta completamente</span>
                  ) : invoice.status === "partial_return" ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-medium">Devolución parcial</span>
                  ) : invoice.status === "paid" ? (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-lg font-medium">Depositada</span>
                  ) : (
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-lg font-medium">Pendiente</span>
                  )}
                </div>
                
                {/* Resumen de importes */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-white rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Importe total</p>
                    <p className="font-semibold text-slate-900">{formatCurrency(invoice.totalAmount)} €</p>
                  </div>
                  <div className="bg-white rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Devuelto</p>
                    <p className="font-semibold text-emerald-600">{formatCurrency(invoice.totalReturned || 0)} €</p>
                  </div>
                  <div className="bg-white rounded-xl p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">Pendiente</p>
                    <p className="font-semibold text-amber-600">{formatCurrency(getRemainingGuarantee())} €</p>
                  </div>
                </div>
                
                {/* Historial de devoluciones */}
                {invoice.guaranteeReturns && invoice.guaranteeReturns.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-emerald-700 mb-2">Historial de devoluciones</p>
                    {invoice.guaranteeReturns.map((ret, idx) => (
                      <div key={ret.id || idx} className="bg-white rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <CheckCircle size={14} className="text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{formatCurrency(ret.amount)} €</p>
                            <p className="text-xs text-slate-500">{formatDate(ret.date)} · {ret.createdByName}</p>
                            {ret.notes && <p className="text-xs text-slate-400 mt-0.5">{ret.notes}</p>}
                          </div>
                        </div>
                        {ret.receiptUrl && (
                          <a 
                            href={ret.receiptUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
                            title="Ver extracto"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Mensaje si no hay devoluciones */}
                {(!invoice.guaranteeReturns || invoice.guaranteeReturns.length === 0) && invoice.status === "paid" && (
                  <p className="text-sm text-emerald-700 text-center py-2">
                    La fianza está depositada. Registra las devoluciones cuando se produzcan.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Firmas */}
        {invoice.approvalSteps && invoice.approvalSteps.length > 0 && (
          <div className="mt-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Firmas</h3>
              {invoice.status === "approved" || invoice.status === "pending" || invoice.status === "paid" ? (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle size={12} />
                  Completado
                </span>
              ) : invoice.status === "pending_approval" ? (
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <Clock size={12} />
                  {invoice.approvalSteps.filter(s => s.status === "approved").length}/{invoice.approvalSteps.length}
                </span>
              ) : invoice.status === "rejected" ? (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <XCircle size={12} />
                  Rechazado
                </span>
              ) : null}
            </div>

            <div className="p-4">
              <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${invoice.approvalSteps.length}, minmax(0, 1fr))` }}>
                {invoice.approvalSteps.map((step, index) => {
                  const isApproved = step.status === "approved";
                  const isRejected = step.status === "rejected";
                  const isPending = step.status === "pending";
                  const isCurrent = invoice.currentApprovalStep === index;
                  
                  const signerName = isApproved && step.approvedByNames?.[0] 
                    ? step.approvedByNames[0] 
                    : step.approverNames?.[0] || "—";
                  
                  const signerId = isApproved && step.approvedBy?.[0] 
                    ? step.approvedBy[0] 
                    : step.approvers?.[0];
                  
                  const userComment = signerId ? (invoice.comments || []).find(c => 
                    c.userId === signerId && 
                    (c.type === "approval" || c.type === "rejection" || c.type === "comment")
                  ) : null;

                  return (
                    <div 
                      key={step.id} 
                      className={`p-3 rounded-xl border text-center ${
                        isApproved ? "bg-emerald-50 border-emerald-200" : 
                        isRejected ? "bg-red-50 border-red-200" : 
                        isCurrent ? "bg-amber-50 border-amber-200" : 
                        "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1 mb-2">
                        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Nivel {step.order}</span>
                        {userComment && (
                          <button
                            onClick={() => setShowApprovalNoteModal(userComment)}
                            className="p-0.5 hover:bg-white/50 rounded transition-colors"
                            title="Ver nota"
                          >
                            <Glasses size={12} className={
                              isApproved ? "text-emerald-600" : 
                              isRejected ? "text-red-600" : 
                              "text-slate-400"
                            } />
                          </button>
                        )}
                      </div>
                      
                      <div className={`w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-xs font-semibold ${
                        isApproved ? "bg-emerald-200 text-emerald-700" : 
                        isRejected ? "bg-red-200 text-red-700" : 
                        isCurrent ? "bg-amber-200 text-amber-700" :
                        "bg-slate-200 text-slate-500"
                      }`}>
                        {isApproved ? <Check size={14} /> : 
                         isRejected ? <X size={14} /> : 
                         signerName.charAt(0).toUpperCase()}
                      </div>
                      
                      <p className={`text-sm font-medium truncate ${
                        isApproved ? "text-emerald-800" : 
                        isRejected ? "text-red-800" : 
                        "text-slate-700"
                      }`}>
                        {signerName}
                      </p>
                      
                      {isApproved ? (
                        <p className="text-[10px] text-emerald-600 mt-0.5">
                          {step.approvedAt 
                            ? `${new Date(step.approvedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · ${new Date(step.approvedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
                            : "Firmado"
                          }
                        </p>
                      ) : isRejected ? (
                        <p className="text-[10px] text-red-600 mt-0.5">Rechazado</p>
                      ) : isCurrent ? (
                        <p className="text-[10px] text-amber-600 mt-0.5">Pendiente</p>
                      ) : (
                        <p className="text-[10px] text-slate-400 mt-0.5">En espera</p>
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Creado por <span className="font-medium text-slate-700">{invoice.createdByName}</span></span>
                <span>{formatDate(invoice.createdAt)}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal Nota del Aprobador */}
      {showApprovalNoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowApprovalNoteModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  showApprovalNoteModal.type === "approval" ? "bg-emerald-100" :
                  showApprovalNoteModal.type === "rejection" ? "bg-red-100" :
                  "bg-slate-100"
                }`}>
                  <Glasses size={24} className={
                    showApprovalNoteModal.type === "approval" ? "text-emerald-600" :
                    showApprovalNoteModal.type === "rejection" ? "text-red-600" :
                    "text-slate-600"
                  } />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Nota del aprobador</h3>
                  <p className="text-sm text-slate-500">{showApprovalNoteModal.userName}</p>
                </div>
              </div>
              
              <div className={`p-4 rounded-xl border ${
                showApprovalNoteModal.type === "approval" ? "bg-emerald-50 border-emerald-200" :
                showApprovalNoteModal.type === "rejection" ? "bg-red-50 border-red-200" :
                "bg-slate-50 border-slate-200"
              }`}>
                <p className="text-sm text-slate-700 italic">"{showApprovalNoteModal.text}"</p>
              </div>
              
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar size={12} />
                  {formatDateTime(showApprovalNoteModal.createdAt)}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  showApprovalNoteModal.type === "approval" ? "bg-emerald-100 text-emerald-700" :
                  showApprovalNoteModal.type === "rejection" ? "bg-red-100 text-red-700" :
                  showApprovalNoteModal.type === "info_request" ? "bg-amber-100 text-amber-700" :
                  "bg-slate-100 text-slate-700"
                }`}>
                  {showApprovalNoteModal.type === "approval" && "Aprobación"}
                  {showApprovalNoteModal.type === "rejection" && "Rechazo"}
                  {showApprovalNoteModal.type === "info_request" && "Solicitud de info"}
                  {showApprovalNoteModal.type === "comment" && "Comentario"}
                </span>
              </div>
              
              <button 
                onClick={() => setShowApprovalNoteModal(null)}
                className="w-full mt-4 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCancelModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><XCircle size={20} className="text-red-600" /></div>
              <div><h3 className="text-lg font-semibold">Anular {invoice.displayNumber}</h3><p className="text-xs text-slate-500">Esta acción no se puede deshacer</p></div>
            </div>
            <div className="p-6">
              <div className="mb-4"><label className="block text-sm font-medium text-slate-700 mb-2">Motivo *</label><textarea value={cancellationReason} onChange={(e) => setCancellationReason(e.target.value)} rows={3} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-slate-900 outline-none" /></div>
              <div className="mb-6"><label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2"><KeyRound size={14} />Contraseña</label><input type="password" value={passwordInput} onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }} className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-slate-900 outline-none ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"}`} />{passwordError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}</div>
              <div className="flex gap-3"><button onClick={() => { setShowCancelModal(false); setPasswordInput(""); setCancellationReason(""); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button><button onClick={handleCancelInvoice} disabled={processing || !cancellationReason.trim() || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium disabled:opacity-50">{processing ? "Anulando..." : "Anular"}</button></div>
            </div>
          </div>
        </div>
      )}

      {/* Guarantee Return Modal */}
      {showReturnModal && invoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowReturnModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <RefreshCw size={20} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Registrar devolución de fianza</h3>
                <p className="text-xs text-slate-500">{invoice.displayNumber} · {invoice.supplier}</p>
              </div>
            </div>
            
            <div className="p-6 space-y-5">
              {/* Resumen de fianza */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Importe total</p>
                    <p className="font-semibold text-slate-900">{formatCurrency(invoice.totalAmount)} €</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Devuelto</p>
                    <p className="font-semibold text-emerald-600">{formatCurrency(invoice.totalReturned || 0)} €</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Pendiente</p>
                    <p className="font-semibold text-amber-600">{formatCurrency(getRemainingGuarantee())} €</p>
                  </div>
                </div>
              </div>
              
              {/* Importe a devolver */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Importe devuelto *</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="0.01"
                    value={returnForm.amount || ""} 
                    onChange={(e) => setReturnForm({ ...returnForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-3 pr-10 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0.00"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">€</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={() => setReturnForm({ ...returnForm, amount: getRemainingGuarantee() })}
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    Devolución completa
                  </button>
                  <span className="text-slate-300">·</span>
                  <button 
                    onClick={() => setReturnForm({ ...returnForm, amount: getRemainingGuarantee() / 2 })}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    50%
                  </button>
                </div>
              </div>
              
              {/* Fecha de devolución */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fecha de devolución *</label>
                <input 
                  type="date" 
                  value={returnForm.date} 
                  onChange={(e) => setReturnForm({ ...returnForm, date: e.target.value })}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
              
              {/* Extracto bancario */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Extracto bancario</label>
                <input 
                  type="file" 
                  ref={returnFileInputRef}
                  onChange={handleReturnFileSelect}
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                />
                {returnFile ? (
                  <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <FileText size={18} className="text-emerald-600" />
                    <span className="flex-1 text-sm text-emerald-700 truncate">{returnFile.name}</span>
                    <button onClick={() => setReturnFile(null)} className="p-1 hover:bg-emerald-100 rounded">
                      <X size={16} className="text-emerald-600" />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => returnFileInputRef.current?.click()}
                    className="w-full px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm text-slate-500 hover:border-slate-300 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <Upload size={16} />
                    Subir extracto (opcional)
                  </button>
                )}
              </div>
              
              {/* Observaciones */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Observaciones</label>
                <textarea 
                  value={returnForm.notes} 
                  onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })}
                  rows={2}
                  placeholder="Notas adicionales sobre la devolución"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
              <button 
                onClick={() => setShowReturnModal(false)} 
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
              >
                Cancelar
              </button>
              <button 
                onClick={handleRegisterReturn} 
                disabled={processingReturn || !returnForm.amount || !returnForm.date}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {processingReturn ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Registrando...</>
                ) : (
                  <><CheckCircle size={16} />Registrar devolución</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
