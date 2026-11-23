"use client";
import { errorText } from "@/lib/toast";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import CashBox from "@/components/box/CashBox";
import { syncBudget } from "@/lib/ledgerClient";
import { sendEnvelopeToApproval } from "@/lib/boxApproval";
import { PendingApprovalNotice } from "@/components/accounting/ApprovalFlow";
import { Button, EmptyState, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Segmented, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getBlob, getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  ClipboardCopy,
  ExternalLink,
  Link2,
  Calendar,
  Check,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Edit,
  Eye,
  FileSpreadsheet,
  FileText,
  FileX,
  Info,
  Layers,
  Lock,
  Maximize2,
  PanelRightOpen,
  Paperclip,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Scale,
  Scissors,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  SplitSquareHorizontal,
  Trash2,
  Upload,
  MoreHorizontal,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import { strFromU8, unzipSync } from "fflate";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Box {
  id: string;
  name: string;
  code: string;
  department?: string;
  nextEnvelopeNumber: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

interface Envelope {
  id: string;
  boxId: string;
  boxCode: string;
  number: number;
  displayNumber: string;
  status: "open" | "reviewing" | "closed" | "pending_approval";
  // Aprobación (lib/boxApproval)
  approvedAt?: unknown;
  approvalBase?: number;
  rejectionReason?: string;
  rejectedByName?: string;
  approvalSteps?: any[];
  currentApprovalStep?: number;

  totalBase: number;
  totalVat: number;
  totalAmount: number;
  expenseCount: number;
  reviewedCount: number;
  nextInvoiceNumber: number;
  nextTicketNumber: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  closedAt?: Date;
  closedBy?: string;
  closedByName?: string;
}

interface ExpenseItem {
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  subAccountCode?: string;
  subAccountDescription?: string;
}

type ConflictType = "amount_diff" | "invoice_covers_multiple" | "partial_invoice" | "missing_document";

// For invoice_covers_multiple: list of card charges that this invoice covers
interface LinkedCharge {
  amount: number;
  date: string;
}

interface BoxExpense {
  id: string;
  envelopeId: string;
  boxId: string;
  boxCode: string;
  number: number;
  displayNumber: string;
  type: "invoice" | "ticket";
  pleoReceiptId: string;
  pleoUrl?: string;
  documentUrl?: string;
  supplier: string;
  supplierTaxId: string;
  supplierNumber: string;
  subAccountCode: string;
  subAccountDescription: string;
  description: string;
  date: Date;
  items: ExpenseItem[];
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  pleoAmount?: number;
  status: "pending" | "reviewed" | "accounted";
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewedByName?: string;
  conflictType?: ConflictType | null;
  conflictNote?: string;
  conflictAnnotatedAt?: Date;
  conflictAnnotatedBy?: string;
  conflictAnnotatedByName?: string;
  linkedCharges?: LinkedCharge[];  // for invoice_covers_multiple
  conflictResolvedAt?: Date;
  conflictResolvedBy?: string;
  conflictResolvedByName?: string;
}

interface BoxSupplier {
  taxId: string;
  name: string;
  originalName: string;
  updatedAt?: Date;
}

interface AdvanceEntry {
  id: string;
  amount: number;
  method: "bank" | "cash";
  date: string;
  proofUrl?: string;
  proofFileName?: string;
  addedAt: Date;
  addedBy: string;
  addedByName: string;
}

interface TransferEnvelope {
  id: string;
  number: number;
  displayNumber: string;
  paymentDate: string;
  status: "draft" | "settled" | "pending_approval";
  // Aprobación (lib/boxApproval)
  approvedAt?: unknown;
  approvalBase?: number;
  rejectionReason?: string;
  rejectedByName?: string;
  approvalSteps?: any[];
  currentApprovalStep?: number;

  // Persona del sobre (un sobre = una persona)
  personName: string;
  personDepartment?: string;
  personIban?: string;
  // Anticipos (opcional, puede haber varios — p. ej. 500€ al inicio y otros
  // 200€ más adelante si hace falta antes de liquidar)
  advances: AdvanceEntry[];
  // Totales de gasto
  totalBase: number;
  totalVat: number;
  totalAmount: number;
  expenseCount: number;
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  // Liquidación
  settledAt?: Date;
  settledBy?: string;
  settledByName?: string;
  settlementDirection?: "production_to_person" | "person_to_production" | "none";
  settlementAmount?: number;
  settlementReference?: string;
  settlementProofUrl?: string;
  settlementProofFileName?: string;
}

interface TransferExpenseItem {
  subAccountCode: string;
  subAccountDescription: string;
  description: string;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
}

interface TransferExpense {
  id: string;
  envelopeId: string;
  type: "invoice" | "ticket";
  personName: string;
  personDepartment?: string;
  personIban?: string;
  supplier: string;
  supplierTaxId?: string;
  items: TransferExpenseItem[];
  subAccountCode?: string;
  subAccountDescription?: string;
  description?: string;
  date: string;
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  attachmentUrl?: string;
  attachmentFileName?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

interface SubAccount {
  id: string;
  code: string;
  description: string;
  accountId: string;
  accountCode: string;
  accountDescription: string;
}


// Estado visible de un sobre de tarjeta (incluye la aprobación).
const cardEnvState = (e: { status: string; approvedAt?: unknown }) =>
  e.status === "open" ? { l: "Abierto", d: "bg-amber-500", t: "text-amber-800" }
  : e.status === "pending_approval" ? { l: "En aprobación", d: "bg-[#2F52E0]", t: "text-[#2F52E0]" }
  : e.status === "reviewing" ? (e.approvedAt ? { l: "Aprobado", d: "bg-emerald-500", t: "text-emerald-800" } : { l: "En revisión", d: "bg-slate-400", t: "text-slate-600" })
  : { l: "Cerrado", d: "bg-emerald-500", t: "text-emerald-800" };

// ─── Constants ───────────────────────────────────────────────────────────────

const capitalizeSupplierName = (name: string): string => {
  if (!name) return "";
  const lw = ["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "con", "por", "para"];
  return name.toLowerCase().split(" ").map((w, i) =>
    i > 0 && lw.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
};

const generateCode = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

// ── IBAN helpers ──────────────────────────────────────────────────────────────
const SPANISH_BANKS: Record<string, string> = {
  "0049": "Santander", "0075": "Banco Popular", "0081": "Banco Sabadell",
  "0128": "Bankinter", "0182": "BBVA", "2038": "Bankia", "2100": "CaixaBank",
  "2085": "Ibercaja", "1465": "ING", "0073": "Openbank", "0238": "Banco Pastor",
  "0487": "Banco Mare Nostrum", "3058": "Cajamar", "2048": "Kutxabank",
  "0030": "Banco Español de Crédito", "1491": "Triodos Bank", "0061": "Banca March",
  "0019": "Deutsche Bank", "0065": "Barclays", "2095": "Abanca", "3025": "Caixa Rural",
  "0234": "Banco Mediolanum", "2080": "Abanca", "2103": "Unicaja", "3035": "Cajasiete",
  "3159": "Caja Rural de Navarra", "0083": "Renta 4", "0186": "Banco Sabadell Atlántico",
  "2013": "NCG Banco", "0131": "Banco Espirito Santo", "0093": "Sabadell",
  "0155": "Banco de Crédito Local", "2045": "Banco Santander Consumer",
  "2046": "Colonya Caixa Pollença", "6000": "Finances i Intercanvis",
  "1000": "Instituto de Crédito Oficial",
};

const formatIban = (raw: string): string => raw.replace(/\s+/g, "").toUpperCase();

const detectBank = (iban: string): string | null => {
  const clean = formatIban(iban);
  if (!clean.startsWith("ES") || clean.length !== 24) return null;
  return SPANISH_BANKS[clean.substring(4, 8)] || null;
};

const validateIban = (iban: string): boolean => {
  const clean = formatIban(iban);
  if (!clean.startsWith("ES") || clean.length !== 24) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.split("").map(c => {
    const n = c.charCodeAt(0);
    return n >= 65 && n <= 90 ? String(n - 55) : c;
  }).join("");
  let remainder = 0;
  for (const ch of numeric) { remainder = (remainder * 10 + parseInt(ch)) % 97; }
  return remainder === 1;
};

// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  open:      { bg: "bg-[#F7F7F8]",    text: "text-slate-900",    label: "Abierto"     },
  reviewing: { bg: "bg-amber-50",   text: "text-amber-700",   label: "En revisión" },
  closed:    { bg: "bg-emerald-50", text: "text-emerald-700", label: "Cerrado"     },
};

const EXPENSE_STATUS_CONFIG = {
  pending:    { bg: "bg-slate-100",  text: "text-slate-600",   label: "Pendiente"     },
  reviewed:   { bg: "bg-[#F7F7F8]",    text: "text-slate-900",    label: "Revisado"      },
  accounted:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "Contabilizado" },
};

const TRANSFER_STATUS_CONFIG = {
  draft:   { bg: "bg-slate-100",  text: "text-slate-600",   label: "Borrador"  },
  settled: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Liquidado" },
};

const CONFLICT_CONFIG: Record<ConflictType, {
  icon: string; label: string; description: string; color: string;
  resolvable: boolean; // true = can be fully resolved; false = annotate-only
}> = {
  amount_diff:             { icon: "diff",    label: "Diferencia de importe",       description: "El importe de la factura no coincide con el cargo en Pleo",         color: "amber",  resolvable: false },
  invoice_covers_multiple: { icon: "merge",   label: "Factura cubre varios cargos", description: "Una sola factura agrupa varios movimientos de tarjeta",             color: "blue",   resolvable: false },
  partial_invoice:         { icon: "split",   label: "Factura parcial",             description: "El movimiento de tarjeta corresponde a varias facturas o tickets",  color: "violet", resolvable: false },
  missing_document:        { icon: "missing", label: "Documento ausente",           description: "No hay factura ni ticket adjunto en Pleo para este gasto",          color: "slate",  resolvable: true  },
};

type MainTab = "tarjetas" | "transfers" | "cash";

// ─────────────────────────────────────────────────────────────────────────────

export default function BoxesPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const { loading: permissionsLoading } = useAccountingPermissions(projectId);

  // Common State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("tarjetas");
  const [departments, setDepartments] = useState<string[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  // Búsqueda dentro de un sobre de tarjeta
  const [envSearch, setEnvSearch] = useState("");
  const [trfSearch, setTrfSearch] = useState("");
  const [trfField, setTrfField] = useState<"all" | "supplier" | "account" | "amount">("all");
  const [envField, setEnvField] = useState<"all" | "number" | "supplier" | "account" | "amount">("all");
  const [envStatus, setEnvStatus] = useState<"all" | "pending" | "reviewed" | "conflict" | "nodoc">("all");
  const ENV_FIELDS: SearchField<"all" | "number" | "supplier" | "account" | "amount">[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Nº, proveedor o cuenta" },
    { value: "number", label: "Nº de gasto", placeholder: "Ej. TP-02-T01", mono: true },
    { value: "supplier", label: "Proveedor", placeholder: "Nombre o NIF" },
    { value: "account", label: "Cuenta", placeholder: "Ej. 04.02", mono: true },
    { value: "amount", label: "Importe", placeholder: "50 · >100 · 20-80", mono: true },
  ];
  const [nextTransferNumber, setNextTransferNumber] = useState(1);

  // Export config (demo / preview — no conectado todavía a ningún servicio real)
  const [showExportConfigModal, setShowExportConfigModal] = useState(false);
  const [exportConfig, setExportConfig] = useState({
    providerName: "",
    format: "csv" as "csv" | "excel" | "api",
    frequency: "manual" as "manual" | "daily" | "weekly",
    mapCategories: true,
    mapReceipts: true,
  });

  // PLEO State
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [expenses, setExpenses] = useState<BoxExpense[]>([]);
  const [cardSuppliers, setBoxSuppliers] = useState<BoxSupplier[]>([]);
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [showEditBoxModal, setShowEditBoxModal] = useState(false);
  const [showDeleteBoxModal, setShowDeleteBoxModal] = useState(false);
  const [showCreateEnvelopeModal, setShowCreateEnvelopeModal] = useState(false);
  const [showDeleteEnvelopeModal, setShowDeleteEnvelopeModal] = useState<Envelope | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showReceiptImportModal, setShowReceiptImportModal] = useState(false);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [uploadingReceipts, setUploadingReceipts] = useState(false);
  const [showManualExpenseModal, setShowManualExpenseModal] = useState(false);
  const [cardExpensesList, setCardExpensesList] = useState<Array<{
    id: string; type: "invoice" | "ticket"; supplier: string; supplierTaxId: string;
    supplierNumber: string; date: string; irpfRate: number; file: File | null;
    items: Array<{ id: string; subAccountCode: string; subAccountDescription: string; description: string; baseAmount: number; vatRate: number; }>;
  }>>([]);
  const [manualExpenseSaving, setManualExpenseSaving] = useState(false);
  const [showCardTypeDropdown, setShowCardTypeDropdown] = useState<number | null>(null);
  const [cardTypeDropdownPos, setCardTypeDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [showCardAccountSelector, setShowCardAccountSelector] = useState(false);
  const [cardAccountSearch, setCardAccountSearch] = useState("");
  const [cardAccountSelectorPos, setCardAccountSelectorPos] = useState<{ top: number; left: number } | null>(null);
  const [editingCardExpenseIndex, setEditingCardExpenseIndex] = useState<number | null>(null);
  const [boxForm, setBoxForm] = useState({ name: "", code: "", department: "" });
  const [editBoxForm, setEditBoxForm] = useState({ name: "", code: "" });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Expense drawer
  const [drawerExpense, setDrawerExpense] = useState<BoxExpense | null>(null);
  const [drawerShowPreview, setDrawerShowPreview] = useState(false);
  const [drawerForm, setDrawerForm] = useState({
    supplier: "", supplierTaxId: "", supplierNumber: "",
    subAccountCode: "", subAccountDescription: "", description: "",
    date: "", baseAmount: "", vatAmount: "", irpfRate: "", irpfAmount: "", totalAmount: "",
    conflictType: "" as ConflictType | "",
    conflictNote: "",
  });
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerItems, setDrawerItems] = useState<Array<{
    id: string; subAccountCode: string; subAccountDescription: string;
    description: string; baseAmount: number; vatRate: number;
  }>>([]);
  // Linked charges for invoice_covers_multiple
  const [drawerLinkedCharges, setDrawerLinkedCharges] = useState<LinkedCharge[]>([]);
  const [showDrawerAccountSelector, setShowDrawerAccountSelector] = useState(false);
  const [drawerAccountSearch, setDrawerAccountSearch] = useState("");
  const [drawerAccountSelectorItemIdx, setDrawerAccountSelectorItemIdx] = useState<number | null>(null);

  // FORM SUBMISSIONS State (box_request)
  const [formSubmissions, setFormSubmissions] = useState<{
    id: string; requesterName: string; createdByName: string; submittedAt: Date;
    totalAmount: number; expenseCount: number; importedToEnvelopeId?: string | null;
    targetEnvelopeId?: string | null;
    expenses: { description: string; amount: number; fileUrl?: string; fileName?: string }[];
    notes?: string;
  }[]>([]);
  const [showSendBoxFormModal, setShowSendBoxFormModal] = useState(false);
  const [boxFormRequesterName, setBoxFormRequesterName] = useState("");
  const [boxFormMessage, setBoxFormMessage] = useState("");
  const [boxFormTargetEnvelopeId, setBoxFormTargetEnvelopeId] = useState("");
  const [generatingBoxForm, setGeneratingBoxForm] = useState(false);
  const [generatedBoxResult, setGeneratedBoxResult] = useState<{ url: string; pin: string } | null>(null);
  const [copiedBoxUrl, setCopiedBoxUrl] = useState(false);
  const [copiedBoxPin, setCopiedBoxPin] = useState(false);
  const [volcandoFormId, setVolcandoFormId] = useState<string | null>(null);
  const [showVolcarModal, setShowVolcarModal] = useState<string | null>(null);
  const [showVolcadas, setShowVolcadas] = useState(false);
  const [volcarTargetEnvelopeId, setVolcarTargetEnvelopeId] = useState("");
  const [showVolcarEnvDropdown, setShowVolcarEnvDropdown] = useState(false);
  // Per-expense completion data when volcando (codificación: proveedor real,
  // no la persona que solicitó — factura/ticket, cuenta(s) de presupuesto, IVA, IRPF)
  const [volcarExpenseData, setVolcarExpenseData] = useState<Array<{
    supplier: string;
    supplierTaxId: string;
    type: "invoice" | "ticket";
    date: string;
    irpfRate: number;
    items: Array<{
      id: string;
      subAccountCode: string;
      subAccountDescription: string;
      baseAmount: number;
      vatRate: number;
      showSubAccountDropdown: boolean;
      subAccountSearch: string;
    }>;
  }>>([]);
  const [showVolcarSupplierDropdown, setShowVolcarSupplierDropdown] = useState<number | null>(null);
  const [volcarSupplierDropdownPos, setVolcarSupplierDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [volcarAccountDropdownPos, setVolcarAccountDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // TRANSFERS State
  const [transferEnvelopes, setTransferEnvelopes] = useState<TransferEnvelope[]>([]);
  const [transferExpenses, setTransferExpenses] = useState<TransferExpense[]>([]);
  const [selectedTransferEnvelope, setSelectedTransferEnvelope] = useState<TransferEnvelope | null>(null);
  const [showCreateTransferEnvelopeModal, setShowCreateTransferEnvelopeModal] = useState(false);
  const [showDeleteTransferEnvelopeModal, setShowDeleteTransferEnvelopeModal] = useState<TransferEnvelope | null>(null);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [showAddAdvanceModal, setShowAddAdvanceModal] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({
    amount: "", method: "bank" as "bank" | "cash", date: new Date().toISOString().slice(0, 10),
    iban: "", proofFile: null as File | null,
  });
  const [addingAdvance, setAddingAdvance] = useState(false);
  const [transferEnvelopeForm, setTransferEnvelopeForm] = useState({
    notes: "", personName: "", personDepartment: "",
  });
  const [expensesList, setExpensesList] = useState<Array<{
    id: string; type: "invoice" | "ticket"; supplier: string; supplierTaxId: string;
    date: string; irpfRate: number; file: File | null;
    items: Array<{ id: string; subAccountCode: string; subAccountDescription: string; description: string; baseAmount: number; vatRate: number; }>;
  }>>([]);
  const [settleForm, setSettleForm] = useState({ reference: "", proofFile: null as File | null });

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto (un solo lock,
  // vale para todos: da igual cuál esté abierto). Los selectores de cuenta
  // anclados (showAccountSelector/showCardAccountSelector) no cuentan: son
  // paneles pequeños, no modales a pantalla completa con su propio scroll.
  useBodyScrollLock(
    showCreateBoxModal || showEditBoxModal || showDeleteBoxModal || showCreateEnvelopeModal ||
    !!showDeleteEnvelopeModal || showManualExpenseModal || showImportModal || showReceiptImportModal ||
    showCreateTransferEnvelopeModal || !!showDeleteTransferEnvelopeModal || showAddExpenseModal ||
    showSettleModal || showAddAdvanceModal || showSendBoxFormModal || !!showVolcarModal || showExportConfigModal
  );

  // Dropdowns
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showExpenseDepartmentDropdown, setShowExpenseDepartmentDropdown] = useState(false);
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [accountSearchTerm, setAccountSearchTerm] = useState("");
  const [accountSelectorPos, setAccountSelectorPos] = useState<{ top: number; left: number } | null>(null);
  const [editingExpenseIndex, setEditingExpenseIndex] = useState<number | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState<number | null>(null);
  const [typeDropdownPos, setTypeDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [showExpenseSupplierDropdown, setShowExpenseSupplierDropdown] = useState<number | null>(null);
  const [expenseSupplierDropdownPos, setExpenseSupplierDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const expenseDepartmentDropdownRef = useRef<HTMLDivElement>(null);
  const accountSelectorRef = useRef<HTMLDivElement>(null);

  // Utils
  const showToast = (type: "success" | "error" | "warning" | "info", message: string) => { if (type === "error") appToast.error(message); else appToast[type](message); };
  const fmt = (n: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
  const fmtDate = (date: Date | any) => {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  };

  // Effects
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (!user) router.push("/");
      else { setUserId(user.uid); setUserName(user.displayName || user.email || "Usuario"); }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(e.target as Node))
        setShowDepartmentDropdown(false);
      if (expenseDepartmentDropdownRef.current && !expenseDepartmentDropdownRef.current.contains(e.target as Node))
        setShowExpenseDepartmentDropdown(false);
      if (accountSelectorRef.current && !accountSelectorRef.current.contains(e.target as Node))
        setShowAccountSelector(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (userId && projectId && !permissionsLoading) loadData();
  }, [userId, projectId, permissionsLoading]);

  // ─── Load Data ───────────────────────────────────────────────────────────────
  const loadData = async () => {
    // Cada cambio en cajas recarga la página: es el momento de recalcular el
    // presupuesto desde los documentos (lib/budgetLedger). No bloquea la carga.
    syncBudget(projectId);
    try {
      setLoading(true);
      const ups = await getDoc(doc(db, `userProjects/${userId}/projects/${projectId}`));
      if (!ups.exists()) { setAccessError("No tienes acceso a este proyecto"); setLoading(false); return; }
      if (!ups.data().permissions?.accounting) { setAccessError("No tienes permisos de contabilidad"); setLoading(false); return; }

      // Verificar nivel de acceso BOX — solo visitor, accounting y accounting_extended
      const memberSnap = await getDoc(doc(db, `projects/${projectId}/members`, userId!));
      if (memberSnap.exists()) {
        const level = memberSnap.data().accountingAccessLevel || "user";
        const boxLevels = ["visitor", "accounting", "accounting_extended"];
        if (!boxLevels.includes(level)) {
          setAccessError("Tu nivel de acceso no incluye el módulo BOX. Contacta con el administrador del proyecto.");
          setLoading(false);
          return;
        }
      }

      setHasAccess(true);

      const projectDoc = await getDoc(doc(db, `projects/${projectId}`));
      if (projectDoc.exists()) {
        setDepartments(projectDoc.data().departments || []);
        setNextTransferNumber(projectDoc.data().nextTransferNumber || 1);
        setProjectName(projectDoc.data().name || "");
      }

      const accountsSnap = await getDocs(query(collection(db, `projects/${projectId}/accounts`), orderBy("code")));
      const allSubAccounts: SubAccount[] = [];
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subSnap = await getDocs(query(
          collection(db, `projects/${projectId}/accounts/${accDoc.id}/subaccounts`), orderBy("code")
        ));
        subSnap.docs.forEach(subDoc => {
          const subData = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id, code: subData.code || "", description: subData.description || "",
            accountId: accDoc.id, accountCode: accData.code || "", accountDescription: accData.description || "",
          });
        });
      }
      setSubAccounts(allSubAccounts);

      const boxesSnap = await getDocs(query(collection(db, `projects/${projectId}/cards`), orderBy("name")));
      setBoxes(boxesSnap.docs.map(d => ({
        id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date(),
      })) as Box[]);

      const envSnap = await getDocs(query(collection(db, `projects/${projectId}/cardEnvelopes`), orderBy("createdAt", "desc")));
      setEnvelopes(envSnap.docs.map(d => ({
        id: d.id, ...d.data(),
        createdAt: d.data().createdAt?.toDate() || new Date(),
        closedAt: d.data().closedAt?.toDate(),
      })) as Envelope[]);

      const expSnap = await getDocs(query(collection(db, `projects/${projectId}/cardExpenses`), orderBy("date", "desc")));
      setExpenses(expSnap.docs.map(d => ({
        id: d.id, ...d.data(),
        date: d.data().date?.toDate() || new Date(),
        reviewedAt: d.data().reviewedAt?.toDate(),
      })) as BoxExpense[]);

      const supSnap = await getDocs(collection(db, `projects/${projectId}/cardSuppliers`));
      setBoxSuppliers(supSnap.docs.map(d => ({ taxId: d.id, ...d.data() })) as BoxSupplier[]);

      const trfEnvSnap = await getDocs(query(collection(db, `projects/${projectId}/transferEnvelopes`), orderBy("createdAt", "desc")));
      setTransferEnvelopes(trfEnvSnap.docs.map(d => ({
        id: d.id, ...d.data(),
        createdAt: d.data().createdAt?.toDate() || new Date(),
        settledAt: d.data().settledAt?.toDate(),
        advances: (d.data().advances || []).map((a: any) => ({ ...a, addedAt: a.addedAt?.toDate?.() || new Date() })),
      })) as TransferEnvelope[]);

      const trfExpSnap = await getDocs(query(collection(db, `projects/${projectId}/transferExpenses`), orderBy("createdAt", "desc")));
      setTransferExpenses(trfExpSnap.docs.map(d => ({
        id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date(),
      })) as TransferExpense[]);

      // Load submitted box_request forms for this project
      const formsSnap = await getDocs(query(
        collection(db, "forms"),
        where("projectId", "==", projectId),
        where("type", "==", "box_request"),
        where("status", "==", "submitted"),
        orderBy("submittedAt", "desc"),
      ));
      setFormSubmissions(formsSnap.docs.map(d => {
        const v = d.data();
        const rd = v.responseData || {};
        return {
          id: d.id,
          requesterName: rd.requesterName || v.prefilled?.requesterName || "—",
          createdByName: v.createdByName || "",
          submittedAt: v.submittedAt?.toDate() || new Date(),
          totalAmount: rd.totalAmount || 0,
          expenseCount: (rd.expenses || []).length,
          importedToEnvelopeId: v.importedToEnvelopeId ?? null,
          targetEnvelopeId: v.targetEnvelopeId ?? null,
          expenses: rd.expenses || [],
          notes: rd.notes || "",
        };
      }));

    } catch (e) {
      console.error(e);
      showToast("error", "No se ha podido cargar datos");
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // PLEO FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── Expense Drawer helpers ──────────────────────────────────────────────────
  const openDrawer = (expense: BoxExpense, showPreview = false) => {
    setDrawerExpense(expense);
    setDrawerShowPreview(showPreview);
    setDrawerForm({
      supplier: expense.supplier,
      supplierTaxId: expense.supplierTaxId || "",
      supplierNumber: expense.supplierNumber || "",
      subAccountCode: expense.subAccountCode || "",
      subAccountDescription: expense.subAccountDescription || "",
      description: expense.description || "",
      date: expense.date instanceof Date
        ? expense.date.toLocaleDateString("es-ES")
        : (expense.date as any)?.toDate?.()?.toLocaleDateString("es-ES") ?? "",
      baseAmount: String(expense.baseAmount ?? ""),
      vatAmount: String(expense.vatAmount ?? ""),
      irpfRate: String(expense.irpfRate ?? ""),
      irpfAmount: String(expense.irpfAmount ?? ""),
      totalAmount: String(expense.totalAmount ?? ""),
      conflictType: expense.conflictType ?? "",
      conflictNote: expense.conflictNote ?? "",
    });
    const items = expense.items && expense.items.length > 0
      ? expense.items.map((it: any, i: number) => ({
          id: crypto.randomUUID(),
          subAccountCode: it.subAccountCode ?? (i === 0 ? expense.subAccountCode || "" : ""),
          subAccountDescription: it.subAccountDescription ?? (i === 0 ? expense.subAccountDescription || "" : ""),
          description: it.description ?? (i === 0 ? expense.description || "" : ""),
          baseAmount: it.baseAmount || 0,
          vatRate: it.vatRate ?? 21,
        }))
      : [{ id: crypto.randomUUID(), subAccountCode: expense.subAccountCode || "",
           subAccountDescription: expense.subAccountDescription || "",
           description: expense.description || "",
           baseAmount: expense.baseAmount || 0, vatRate: 21 }];
    setDrawerItems(items);
    setDrawerLinkedCharges(expense.linkedCharges || []);
    setDrawerAccountSearch("");
    setShowDrawerAccountSelector(false);
    setDrawerAccountSelectorItemIdx(null);
  };

  const closeDrawer = () => {
    setDrawerExpense(null);
    setDrawerShowPreview(false);
    setShowDrawerAccountSelector(false);
  };

  const handleSaveDrawer = async () => {
    if (!drawerExpense) return;
    setDrawerSaving(true);
    try {
      const newSupplier = drawerForm.supplier.trim();
      const cif = drawerForm.supplierTaxId.trim();
      if (cif && newSupplier && newSupplier !== drawerExpense.supplier) {
        await setDoc(doc(db, `projects/${projectId}/cardSuppliers`, cif),
          { taxId: cif, name: newSupplier, originalName: drawerExpense.supplier, updatedAt: Timestamp.now() },
          { merge: true });
        setBoxSuppliers(prev => {
          const without = prev.filter(s => s.taxId !== cif);
          return [...without, { taxId: cif, name: newSupplier, originalName: drawerExpense.supplier }];
        });
      }
      const irpfRate   = parseFloat(drawerForm.irpfRate) || 0;
      const baseAmount = drawerItems.reduce((s, it) => s + (it.baseAmount || 0), 0);
      const vatAmount  = drawerItems.reduce((s, it) =>
        s + Math.round((it.baseAmount || 0) * (it.vatRate || 0) / 100 * 100) / 100, 0);
      const irpfAmount = Math.round(baseAmount * irpfRate / 100 * 100) / 100;
      const totalAmount = Math.round((baseAmount + vatAmount - irpfAmount) * 100) / 100;
      const first = drawerItems[0] ?? { subAccountCode: "", subAccountDescription: "", description: "" };
      const updates: any = {
        supplier: drawerForm.supplier.trim(),
        supplierTaxId: drawerForm.supplierTaxId.trim(),
        supplierNumber: drawerForm.supplierNumber.trim(),
        subAccountCode: first.subAccountCode,
        subAccountDescription: first.subAccountDescription,
        description: first.description,
        baseAmount, vatAmount, irpfRate, irpfAmount, totalAmount,
        items: drawerItems.map(it => ({
          subAccountCode: it.subAccountCode,
          subAccountDescription: it.subAccountDescription,
          description: it.description,
          baseAmount: it.baseAmount,
          vatRate: it.vatRate,
          vatAmount: Math.round((it.baseAmount || 0) * (it.vatRate || 0) / 100 * 100) / 100,
        })),
        conflictType: drawerForm.conflictType || null,
        conflictNote: drawerForm.conflictNote.trim(),
        linkedCharges: drawerLinkedCharges,
      };
      if (drawerForm.date) {
        const parts = drawerForm.date.split("/");
        if (parts.length === 3) {
          updates.date = Timestamp.fromDate(new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])));
        }
      }
      await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, drawerExpense.id), updates);
      showToast("success", "Gasto actualizado");
      closeDrawer();
      loadData();
    } catch { showToast("error", "No se ha podido guardar"); } finally { setDrawerSaving(false); }
  };

  // Resolve: only for resolvable conflicts (missing_document)
  const handleResolveConflict = async () => {
    if (!drawerExpense) return;
    setDrawerSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, drawerExpense.id), {
        conflictType: null, conflictNote: "",
        conflictResolvedAt: Timestamp.now(), conflictResolvedBy: userId, conflictResolvedByName: userName,
      });
      showToast("success", "Incidencia resuelta");
      closeDrawer();
      loadData();
    } catch { showToast("error", "No se ha podido resolver incidencia"); } finally { setDrawerSaving(false); }
  };

  // Annotate: for non-resolvable conflicts — saves note + timestamp but keeps conflictType
  const handleAnnotateConflict = async () => {
    if (!drawerExpense) return;
    setDrawerSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, drawerExpense.id), {
        conflictNote: drawerForm.conflictNote.trim(),
        linkedCharges: drawerLinkedCharges,
        conflictAnnotatedAt: Timestamp.now(),
        conflictAnnotatedBy: userId,
        conflictAnnotatedByName: userName,
      });
      showToast("success", "Incidencia anotada para cuadre");
      closeDrawer();
      loadData();
    } catch { showToast("error", "No se ha podido anotar incidencia"); } finally { setDrawerSaving(false); }
  };

  const handleCreateBox = async () => {
    if (!boxForm.name.trim() || !boxForm.code.trim()) return showToast("error", "Nombre y código obligatorios");
    if (boxes.some(b => b.code.toUpperCase() === boxForm.code.toUpperCase())) return showToast("error", "Código ya en uso");
    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/cards`), {
        name: boxForm.name.trim(), code: boxForm.code.toUpperCase().trim(),
        department: boxForm.department || "",
        nextInvoiceNumber: 1, nextTicketNumber: 1, nextEnvelopeNumber: 1,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      showToast("success", "Caja creada");
      setShowCreateBoxModal(false);
      setBoxForm({ name: "", code: "", department: "" });
      loadData();
    } catch { showToast("error", "No se ha podido crear caja"); } finally { setSaving(false); }
  };

  const handleEditBox = async () => {
    if (!selectedBox || !editBoxForm.name.trim() || !editBoxForm.code.trim()) return;
    if (boxes.some(b => b.id !== selectedBox.id && b.code.toUpperCase() === editBoxForm.code.toUpperCase()))
      return showToast("error", "Código ya en uso");
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/cards`, selectedBox.id), {
        name: editBoxForm.name.trim(), code: editBoxForm.code.toUpperCase().trim(),
      });
      showToast("success", "Caja actualizada");
      setShowEditBoxModal(false);
      loadData();
    } catch { showToast("error", "No se ha podido actualizar"); } finally { setSaving(false); }
  };

  const canDeleteBox = (box: Box) =>
    !expenses.filter(e => e.boxId === box.id).some(e => e.status === "reviewed" || e.status === "accounted");

  const handleDeleteBox = async () => {
    if (!selectedBox) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      expenses.filter(e => e.boxId === selectedBox.id).forEach(e =>
        batch.delete(doc(db, `projects/${projectId}/cardExpenses`, e.id)));
      envelopes.filter(e => e.boxId === selectedBox.id).forEach(e =>
        batch.delete(doc(db, `projects/${projectId}/cardEnvelopes`, e.id)));
      batch.delete(doc(db, `projects/${projectId}/cards`, selectedBox.id));
      await batch.commit();
      showToast("success", "Caja eliminada");
      setShowDeleteBoxModal(false);
      setSelectedBox(null);
      loadData();
    } catch { showToast("error", "No se ha podido eliminar caja"); } finally { setSaving(false); }
  };

  const handleCreateEnvelope = async () => {
    if (!selectedBox) return;
    setSaving(true);
    try {
      const num = selectedBox.nextEnvelopeNumber || 1;
      const displayNumber = `BOX-${selectedBox.code}${String(num).padStart(3, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/cardEnvelopes`), {
        boxId: selectedBox.id, boxCode: selectedBox.code, number: num, displayNumber,
        status: "open", totalBase: 0, totalVat: 0, totalAmount: 0,
        expenseCount: 0, reviewedCount: 0,
        nextInvoiceNumber: 1, nextTicketNumber: 1,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      await updateDoc(doc(db, `projects/${projectId}/cards`, selectedBox.id), {
        nextEnvelopeNumber: num + 1,
      });
      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateEnvelopeModal(false);
      loadData();
    } catch { showToast("error", "No se ha podido crear sobre"); } finally { setSaving(false); }
  };

  const canDeleteEnvelope = (envelope: Envelope) =>
    !expenses.filter(e => e.envelopeId === envelope.id).some(e => e.status === "reviewed" || e.status === "accounted");

  const handleDeleteEnvelope = async (envelope: Envelope) => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      expenses.filter(e => e.envelopeId === envelope.id).forEach(e =>
        batch.delete(doc(db, `projects/${projectId}/cardExpenses`, e.id)));
      batch.delete(doc(db, `projects/${projectId}/cardEnvelopes`, envelope.id));
      await batch.commit();
      showToast("success", "Sobre eliminado");
      setShowDeleteEnvelopeModal(null);
      if (selectedEnvelope?.id === envelope.id) setSelectedEnvelope(null);
      loadData();
    } catch { showToast("error", "No se ha podido eliminar sobre"); } finally { setSaving(false); }
  };

  // ── Parser XLSX ──────────────────────────────────────────────────────────────
  const parsePleoExcel = async (file: File): Promise<any[]> => {
    const ab = await file.arrayBuffer();
    const zip = unzipSync(new Uint8Array(ab));

    const readEntry = (name: string): string | null => {
      const entry = zip[name];
      return entry ? strFromU8(entry) : null;
    };

    // 1. SharedStrings
    const sharedStrings: string[] = [];
    const ssXml = readEntry("xl/sharedStrings.xml");
    if (ssXml) {
      let ssp = 0;
      while (true) {
        const siS = ssXml.indexOf("<si>", ssp);
        if (siS < 0) break;
        const siE = ssXml.indexOf("</si>", siS);
        if (siE < 0) break;
        const siContent = ssXml.substring(siS + 4, siE);
        let text = "";
        let tp = 0;
        while (true) {
          const tS = siContent.indexOf("<t", tp);
          if (tS < 0) break;
          const tTagE = siContent.indexOf(">", tS);
          if (tTagE < 0) break;
          const tE = siContent.indexOf("</t>", tTagE);
          if (tE < 0) break;
          text += siContent.substring(tTagE + 1, tE);
          tp = tE + 4;
        }
        sharedStrings.push(text);
        ssp = siE + 5;
      }
    }

    // 2. Sheet
    const sheetXml = readEntry("xl/worksheets/sheet1.xml");
    if (!sheetXml) throw new Error("No se encontró la hoja de cálculo en el XLSX");
    const rowBlocks: string[] = [];
    { let rp = 0;
      while (true) {
        const rs = sheetXml.indexOf("<row", rp);
        if (rs < 0) break;
        const re = sheetXml.indexOf("</row>", rs);
        if (re < 0) break;
        rowBlocks.push(sheetXml.substring(rs, re + 6));
        rp = re + 6;
      }
    }
    if (rowBlocks.length < 2) throw new Error("El archivo no contiene filas de datos");

    const parseRow = (rowXml: string): Record<string, string> => {
      const result: Record<string, string> = {};
      let pos = 0;
      while (true) {
        const cStart = rowXml.indexOf("<c ", pos);
        if (cStart < 0) break;
        const cEnd = rowXml.indexOf(">", cStart);
        if (cEnd < 0) break;
        const tag = rowXml.substring(cStart + 1, cEnd);
        const rIdx = tag.indexOf(" r=");
        if (rIdx < 0) { pos = cEnd + 1; continue; }
        let ci = rIdx + 3;
        if (tag[ci] === '"' || tag[ci] === "'") ci++;
        let col = "";
        while (ci < tag.length && tag[ci] >= "A" && tag[ci] <= "Z") col += tag[ci++];
        if (!col) { pos = cEnd + 1; continue; }
        const tIdx = tag.indexOf(" t=");
        const isShared = tIdx >= 0 && tag.substring(tIdx + 3).replace(/^["']/, "")[0] === "s";
        const closeIdx = rowXml.indexOf("</c>", cEnd);
        if (closeIdx < 0) break;
        const inner = rowXml.substring(cEnd + 1, closeIdx);
        const vO = inner.indexOf("<v>"), vC = inner.indexOf("</v>");
        let v = vO >= 0 && vC > vO ? inner.substring(vO + 3, vC).trim() : "";
        if (isShared && v !== "") v = sharedStrings[parseInt(v, 10)] ?? v;
        result[col] = v;
        pos = closeIdx + 4;
      }
      return result;
    };

    const colToHeader = parseRow(rowBlocks[0]);

    // 3. Group rows by RECIBO PLEO
    const grouped: Record<string, Record<string, string>[]> = {};
    for (let i = 1; i < rowBlocks.length; i++) {
      const raw = parseRow(rowBlocks[i]);
      const record: Record<string, string> = {};
      for (const [col, val] of Object.entries(raw)) {
        const h = colToHeader[col]; if (h) record[h] = val;
      }
      const id = record["RECIBO PLEO"];
      if (!id) continue;
      (grouped[id] ??= []).push(record);
    }

    // 4. Build result — FIX: each item reads its own subAccountCode from its row
    const pn = (v?: string) => parseFloat((v ?? "0").replace(",", ".")) || 0;
    const result: any[] = [];

    for (const [receiptId, records] of Object.entries(grouped)) {
      const first = records[0];
      const type: "ticket" | "invoice" =
        (first["TIPO DE DOCUMENTO"] ?? "").toUpperCase() === "TICKET" ? "ticket" : "invoice";

      // ── FIX: each item reads subAccountCode/Description from its own row,
      //         falling back to first row if empty
      const items = records.map(r => ({
        baseAmount:            pn(r["ANTES DE IMPUESTOS"]),
        vatRate:               pn(r["PORCENTAJE IMPUESTO"]),
        vatAmount:             pn(r["TOTAL IMPUESTO"]),
        subAccountCode:        (r["CODIGO PRESUPUESTO"]         || first["CODIGO PRESUPUESTO"]         || "").trim(),
        subAccountDescription: (r["DESCRIPCIÓN NUMERO CUENTA"]  || first["DESCRIPCIÓN NUMERO CUENTA"]  || "").trim(),
      }));

      const totalBase  = Math.round(items.reduce((s, it) => s + it.baseAmount, 0) * 100) / 100;
      const totalVat   = Math.round(items.reduce((s, it) => s + it.vatAmount,  0) * 100) / 100;
      const irpfRate   = pn(first["IRPF %"]);
      const irpfAmount = pn(first["IRPF TOTAL"]);
      result.push({
        pleoReceiptId:         receiptId,
        type,
        employee:              (first["EMPLEADO"]                  ?? "").trim(),
        supplier:              (first["PROVEEDOR"]                 ?? "").trim(),
        supplierTaxId:         (first["CIF"]                       ?? "").trim(),
        supplierNumber:        (first["Número de Factura"]         ?? "").trim(),
        subAccountCode:        (first["CODIGO PRESUPUESTO"]        ?? "").trim(),
        subAccountDescription: (first["DESCRIPCIÓN NUMERO CUENTA"] ?? "").trim(),
        description:           (first["DESCRIPCION"] || first["NOTAS"] || "").replace(/\s+/g, " ").trim(),
        date:                  (first["FECHA FACTURA/TICKET"] || first["FECHA FACTURA"] || "").trim(),
        pleoUrl:               (first["URL"]                       ?? "").trim(),
        items,
        baseAmount:  totalBase,
        vatAmount:   totalVat,
        irpfRate,
        irpfAmount,
        totalAmount: Math.round((totalBase + totalVat - irpfAmount) * 100) / 100,
        pleoAmount:  Math.round(records.reduce((s, r) => s + pn(r["IMPORTE"]), 0) * 100) / 100,
      });
    }

    if (result.length === 0) throw new Error("No se encontraron gastos en el archivo");
    return result;
  };

  const handleFileSelect = async (file: File) => {
    setImportFile(file);
    setImportPreview([]);
    try {
      const result = await parsePleoExcel(file);
      setImportPreview(result);
    } catch (err: any) {
      console.error("[parsePleoExcel] Error:", err);
      showToast("error", errorText(err, "No se ha podido leer el archivo"));
      setImportFile(null);
      setImportPreview([]);
    }
  };

  const handleImportExpenses = async () => {
    if (!selectedEnvelope || !selectedBox || importPreview.length === 0) return;
    setImporting(true);
    try {
      const batch = writeBatch(db);
      let invoiceNum = selectedEnvelope.nextInvoiceNumber ?? 1, ticketNum = selectedEnvelope.nextTicketNumber ?? 1;
      let totalBase = selectedEnvelope.totalBase, totalVat = selectedEnvelope.totalVat;
      let totalAmount = selectedEnvelope.totalAmount, expenseCount = selectedEnvelope.expenseCount;
      const existingPleoIds = new Set(expenses.map(e => e.pleoReceiptId));
      const existingInvoiceKeys = new Set(
        expenses
          .filter(e => e.type === "invoice" && e.supplierTaxId && e.supplierNumber)
          .map(e => `${e.supplierTaxId}||${e.supplierNumber}`)
      );
      const localSuppliers = [...cardSuppliers];
      for (const exp of importPreview) {
        if (existingPleoIds.has(exp.pleoReceiptId)) continue;
        const invoiceKey = exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber
          ? `${exp.supplierTaxId}||${exp.supplierNumber}` : null;
        if (invoiceKey && existingInvoiceKeys.has(invoiceKey)) continue;
        let supplierName = exp.supplier;
        const found = localSuppliers.find(s => s.taxId === exp.supplierTaxId);
        if (found) {
          supplierName = found.name;
        } else if (exp.supplierTaxId) {
          const normalized = capitalizeSupplierName(exp.supplier);
          await setDoc(doc(db, `projects/${projectId}/cardSuppliers`, exp.supplierTaxId),
            { taxId: exp.supplierTaxId, name: normalized, originalName: exp.supplier, updatedAt: Timestamp.now() },
            { merge: true });
          supplierName = normalized;
          localSuppliers.push({ taxId: exp.supplierTaxId, name: normalized, originalName: exp.supplier });
        }
        const isTicket = exp.type === "ticket";
        const num = isTicket ? ticketNum++ : invoiceNum++;
        const displayNumber = `${selectedEnvelope.displayNumber}-${isTicket ? "T" : "F"}${String(num).padStart(3, "0")}`;
        let expenseDate = new Date();
        if (exp.date) {
          const p = exp.date.split("/");
          if (p.length === 3) expenseDate = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
        }
        const pleoAmount = exp.pleoAmount || 0;
        const computedTotal = exp.totalAmount || 0;
        const autoConflicts: ConflictType[] = [];
        if (!exp.pleoUrl || exp.pleoUrl.trim() === "") autoConflicts.push("missing_document");
        if (pleoAmount > 0 && Math.abs(pleoAmount - computedTotal) > 0.02) autoConflicts.push("amount_diff");
        const autoConflictType: ConflictType | null = autoConflicts[0] ?? null;
        const autoConflictNote = autoConflicts.length > 0
          ? autoConflicts.map(c => CONFLICT_CONFIG[c].label).join(", ") + " (detectado automáticamente)"
          : "";

        const expRef = doc(collection(db, `projects/${projectId}/cardExpenses`));
        batch.set(expRef, {
          envelopeId: selectedEnvelope.id, boxId: selectedBox.id, boxCode: selectedBox.code,
          number: num, displayNumber, type: exp.type, pleoReceiptId: exp.pleoReceiptId,
          pleoUrl: exp.pleoUrl || "", documentUrl: "", supplier: supplierName,
          supplierTaxId: exp.supplierTaxId || "", supplierNumber: exp.supplierNumber || "",
          subAccountCode: exp.subAccountCode || "", subAccountDescription: exp.subAccountDescription || "",
          description: exp.description || "", date: Timestamp.fromDate(expenseDate),
          items: exp.items || [],
          baseAmount: exp.baseAmount || 0, vatAmount: exp.vatAmount || 0,
          irpfRate: exp.irpfRate || 0, irpfAmount: exp.irpfAmount || 0, totalAmount: exp.totalAmount || 0,
          pleoAmount,
          conflictType: autoConflictType,
          conflictNote: autoConflictNote,
          linkedCharges: [],
          status: "pending", createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        totalBase += exp.baseAmount || 0;
        totalVat += exp.vatAmount || 0;
        totalAmount += exp.totalAmount || 0;
        expenseCount++;
      }
      batch.update(doc(db, `projects/${projectId}/cardEnvelopes`, selectedEnvelope.id), {
        totalBase, totalVat, totalAmount, expenseCount,
        nextInvoiceNumber: invoiceNum, nextTicketNumber: ticketNum,
      });
      await batch.commit();
      showToast("success", `${importPreview.length} gastos importados`);
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview([]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido importar"); } finally { setImporting(false); }
  };

  const handleImportReceipts = async () => {
    if (!selectedEnvelope || receiptFiles.length === 0) return;
    setUploadingReceipts(true);
    const envelopeExps = expenses.filter(e => e.envelopeId === selectedEnvelope.id);
    let matched = 0, skipped = 0;
    try {
      for (const file of receiptFiles) {
        const nameNoExt = file.name.replace(/\.[^.]+$/, "");
        const expense = envelopeExps.find(e =>
          e.pleoReceiptId && nameNoExt.includes(String(e.pleoReceiptId))
        );
        if (!expense) { skipped++; continue; }
        const ext = file.name.split(".").pop() ?? "pdf";
        const sRef = ref(storage,
          `projects/${projectId}/cardExpenses/${expense.id}/receipt.${ext}`);
        await uploadBytes(sRef, file);
        const url = await getDownloadURL(sRef);
        const updates: any = { documentUrl: url };
        if (expense.conflictType === "missing_document") {
          updates.conflictType = null;
          updates.conflictNote = "";
          updates.conflictResolvedAt = Timestamp.now();
          updates.conflictResolvedBy = userId;
          updates.conflictResolvedByName = userName;
        }
        await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, expense.id), updates);
        matched++;
      }
      showToast("success",
        `${matched} recibo${matched !== 1 ? "s" : ""} vinculado${matched !== 1 ? "s" : ""}${skipped > 0 ? ` · ${skipped} sin emparejar` : ""}`
      );
      setShowReceiptImportModal(false);
      setReceiptFiles([]);
      loadData();
    } catch (e) {
      console.error(e);
      showToast("error", "No se ha podido subir recibos");
    } finally {
      setUploadingReceipts(false);
    }
  };


  const handleReviewExpense = async (expense: BoxExpense) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, expense.id), {
        status: "reviewed", reviewedAt: Timestamp.now(), reviewedBy: userId, reviewedByName: userName,
      });
      const envelope = envelopes.find(e => e.id === expense.envelopeId);
      if (envelope) {
        await updateDoc(doc(db, `projects/${projectId}/cardEnvelopes`, envelope.id), {
          reviewedCount: (envelope.reviewedCount || 0) + 1,
        });
      }
      showToast("success", "Gasto revisado");
      loadData();
    } catch { showToast("error", "No se ha podido revisar"); }
  };

  // helpers for card expense list
  const createEmptyCardItem = () => ({
    id: crypto.randomUUID(),
    subAccountCode: "", subAccountDescription: "", description: "",
    baseAmount: 0, vatRate: 21,
  });

  const createEmptyCardExpense = () => ({
    id: crypto.randomUUID(),
    type: "invoice" as "invoice" | "ticket",
    supplier: "", supplierTaxId: "", supplierNumber: "",
    date: new Date().toLocaleDateString("es-ES"),
    irpfRate: 0,
    file: null as File | null,
    items: [createEmptyCardItem()],
  });

  const updateCardExpense = (index: number, field: string, value: any) =>
    setCardExpensesList(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));

  const updateCardItem = (expIdx: number, itemIdx: number, field: string, value: any) =>
    setCardExpensesList(prev => prev.map((e, i) => {
      if (i !== expIdx) return e;
      return { ...e, items: e.items.map((it, j) => j === itemIdx ? { ...it, [field]: value } : it) };
    }));

  const addCardItem = (expIdx: number) =>
    setCardExpensesList(prev => prev.map((e, i) =>
      i === expIdx ? { ...e, items: [...e.items, createEmptyCardItem()] } : e));

  const removeCardItem = (expIdx: number, itemIdx: number) =>
    setCardExpensesList(prev => prev.map((e, i) =>
      i === expIdx && e.items.length > 1
        ? { ...e, items: e.items.filter((_, j) => j !== itemIdx) }
        : e));

  const removeCardExpense = (index: number) =>
    setCardExpensesList(prev => prev.filter((_, i) => i !== index));

  const handleAddManualExpense = async () => {
    if (!selectedEnvelope || !selectedBox) return;
    const valid = cardExpensesList.filter(
      e => e.supplier.trim() && e.items.some(it => it.baseAmount > 0 && it.subAccountCode)
    );
    if (valid.length === 0) return showToast("error", "Añade al menos un gasto con proveedor, cuenta e importe");
    const missingCif = valid.find(e => e.type === "invoice" && !e.supplierTaxId.trim());
    if (missingCif) return showToast("error", `El CIF es obligatorio en facturas (gasto: ${missingCif.supplier || "sin proveedor"})`);
    setManualExpenseSaving(true);
    try {
      const envSnap = await getDoc(doc(db, `projects/${projectId}/cardEnvelopes`, selectedEnvelope.id));
      const envData = envSnap.data() || {};
      let nextInvoice = envData.nextInvoiceNumber ?? 1;
      let nextTicket  = envData.nextTicketNumber  ?? 1;
      let addedBase = 0, addedVat = 0, addedTotal = 0;
      const batch = writeBatch(db);

      for (const exp of valid) {
        const isTicket = exp.type === "ticket";
        const num = isTicket ? nextTicket++ : nextInvoice++;
        const displayNumber = `${selectedEnvelope.displayNumber}-${isTicket ? "T" : "F"}${String(num).padStart(3, "0")}`;
        const { baseAmount, vatAmount, irpfAmount, totalAmount } = computeExpenseTotal(exp);

        const dateParts = exp.date.split("/");
        const expenseDate = dateParts.length === 3
          ? new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]))
          : new Date();

        let documentUrl = "";
        if (exp.file) {
          const extFile = exp.file.name.split(".").pop() ?? "pdf";
          const sRef = ref(storage, `projects/${projectId}/cardExpenses/${displayNumber}.${extFile}`);
          await uploadBytes(sRef, exp.file);
          documentUrl = await getDownloadURL(sRef);
        }

        const supplierName = capitalizeSupplierName(exp.supplier.trim());
        const firstItem = exp.items[0];
        const expRef = doc(collection(db, `projects/${projectId}/cardExpenses`));
        batch.set(expRef, {
          envelopeId: selectedEnvelope.id, boxId: selectedBox.id, boxCode: selectedBox.code,
          number: num, displayNumber, type: exp.type,
          pleoReceiptId: `MANUAL-${Date.now()}-${num}`,
          pleoUrl: "", documentUrl,
          supplier: supplierName, supplierTaxId: exp.supplierTaxId.trim(),
          supplierNumber: exp.supplierNumber.trim(),
          subAccountCode: firstItem?.subAccountCode ?? "",
          subAccountDescription: firstItem?.subAccountDescription ?? "",
          description: firstItem?.description ?? "",
          date: Timestamp.fromDate(expenseDate),
          items: exp.items.map(it => ({
            baseAmount: it.baseAmount, vatRate: it.vatRate,
            vatAmount: Math.round(it.baseAmount * it.vatRate / 100 * 100) / 100,
            subAccountCode: it.subAccountCode,
            subAccountDescription: it.subAccountDescription,
          })),
          baseAmount, vatAmount, irpfRate: exp.irpfRate, irpfAmount, totalAmount,
          pleoAmount: 0, conflictType: null, conflictNote: "", linkedCharges: [],
          status: "pending",
          createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        addedBase  += baseAmount;
        addedVat   += vatAmount;
        addedTotal += totalAmount;
      }

      batch.update(doc(db, `projects/${projectId}/cardEnvelopes`, selectedEnvelope.id), {
        totalBase:    (selectedEnvelope.totalBase   || 0) + addedBase,
        totalVat:     (selectedEnvelope.totalVat    || 0) + addedVat,
        totalAmount:  (selectedEnvelope.totalAmount || 0) + addedTotal,
        expenseCount: (selectedEnvelope.expenseCount || 0) + valid.length,
        nextInvoiceNumber: nextInvoice,
        nextTicketNumber:  nextTicket,
      });
      await batch.commit();
      showToast("success", `${valid.length} gasto${valid.length > 1 ? "s" : ""} añadido${valid.length > 1 ? "s" : ""}`);
      setShowManualExpenseModal(false);
      setCardExpensesList([]);
      loadData();
    } catch (e: any) {
      showToast("error", errorText(e, "No se ha podido añadir el gasto"));
    } finally { setManualExpenseSaving(false); }
  };

  const handleCloseEnvelope = async (envelope: Envelope) => {
    const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
    const pending = envExpenses.filter(e => e.status === "pending").length;
    if (pending > 0) return showToast("error", `${pending} gastos sin revisar`);
    // Si hay niveles de aprobación de sobres, primero se aprueba (lib/boxApproval).
    try {
      setSaving(true);
      const dept = boxes.find((b) => b.id === envelope.boxId)?.department;
      if (await sendEnvelopeToApproval(projectId, "card", envelope as any, dept, { uid: userId || "", name: userName })) {
        showToast("success", `${envelope.displayNumber} enviado a aprobación`);
        setSelectedEnvelope({ ...envelope, status: "pending_approval", approvedAt: undefined, rejectionReason: undefined });
        loadData();
        return;
      }
    } catch (e) { showToast("error", errorText(e, "No se ha podido enviar a aprobación")); return; } finally { setSaving(false); }
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, `projects/${projectId}/cardEnvelopes`, envelope.id), {
        status: "closed", closedAt: Timestamp.now(), closedBy: userId, closedByName: userName,
      });
      envExpenses.forEach(e =>
        batch.update(doc(db, `projects/${projectId}/cardExpenses`, e.id), {
          status: "accounted", accountedAt: Timestamp.now(),
        }));
      await batch.commit();
      showToast("success", "Sobre cerrado");
      loadData();
    } catch { showToast("error", "No se ha podido cerrar sobre"); }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSFER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── Send Box Form ────────────────────────────────────────────────────────────

  const handleGenerateBoxForm = async () => {
    if (!boxFormRequesterName.trim()) return;
    setGeneratingBoxForm(true);
    try {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const expires = new Date();
      expires.setDate(expires.getDate() + 30);
      const docRef = await addDoc(collection(db, "forms"), {
        type: "box_request",
        pin,
        status: "pending",
        projectId,
        projectName,
        createdBy: userId,
        createdByName: userName,
        coordinatorMessage: boxFormMessage.trim() || null,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expires),
        importedToEnvelopeId: null,
        targetEnvelopeId: boxFormTargetEnvelopeId || null,
        prefilled: { requesterName: boxFormRequesterName.trim() },
      });
      setGeneratedBoxResult({ url: `${window.location.origin}/form/${docRef.id}`, pin });
    } catch (e) { console.error(e); showToast("error", "No se ha podido generar el formulario"); }
    finally { setGeneratingBoxForm(false); }
  };

  const copyBox = async (text: string, type: "url" | "pin") => {
    await navigator.clipboard.writeText(text);
    if (type === "url") { setCopiedBoxUrl(true); setTimeout(() => setCopiedBoxUrl(false), 2000); }
    else { setCopiedBoxPin(true); setTimeout(() => setCopiedBoxPin(false), 2000); }
  };

  const copyBoxMessage = async (url: string, pin: string) => {
    const msg = `Este es el enlace al formulario:\n${url}\n\nPara acceder a él, tendrás que usar esta clave: ${pin}`;
    await navigator.clipboard.writeText(msg);
    setCopiedBoxUrl(true); setTimeout(() => setCopiedBoxUrl(false), 2000);
  };

  const closeBoxFormModal = () => {
    setShowSendBoxFormModal(false);
    setBoxFormRequesterName("");
    setBoxFormMessage("");
    setBoxFormTargetEnvelopeId("");
    setGeneratedBoxResult(null);
  };

  // ─── Volcar solicitud a sobre ─────────────────────────────────────────────────

  const handleVolcarToEnvelope = async (formId: string) => {
    if (!volcarTargetEnvelopeId) return showToast("error", "Selecciona un sobre de transferencias");
    const submission = formSubmissions.find((f) => f.id === formId);
    if (!submission) return;
    setVolcandoFormId(formId);
    try {
      const envelope = transferEnvelopes.find((e) => e.id === volcarTargetEnvelopeId);
      if (!envelope) return;
      const batch = writeBatch(db);
      let addedBase = 0;
      let addedVat = 0;
      let addedTotal = 0;

      for (let i = 0; i < submission.expenses.length; i++) {
        const exp = submission.expenses[i];
        const ed = volcarExpenseData[i] || {
          supplier: "", supplierTaxId: "", type: "ticket" as "invoice" | "ticket",
          date: new Date().toISOString().slice(0, 10), irpfRate: 0,
          items: [{ id: crypto.randomUUID(), subAccountCode: "", subAccountDescription: "", baseAmount: Number(exp.amount) || 0, vatRate: 0, showSubAccountDropdown: false, subAccountSearch: "" }],
        };
        const { baseAmount, vatAmount, irpfAmount, totalAmount } = computeExpenseTotal(ed);

        const newExpRef = doc(collection(db, `projects/${projectId}/transferExpenses`));
        batch.set(newExpRef, {
          envelopeId: volcarTargetEnvelopeId,
          type: ed.type,
          personName: envelope.personName || submission.requesterName,
          personDepartment: envelope.personDepartment || "",
          personIban: envelope.personIban || "",
          supplier: ed.supplier || "",
          supplierTaxId: ed.supplierTaxId || "",
          items: ed.items.map((it) => ({
            subAccountCode: it.subAccountCode,
            subAccountDescription: it.subAccountDescription,
            description: exp.description,
            baseAmount: it.baseAmount,
            vatRate: it.vatRate,
            vatAmount: Math.round((it.baseAmount || 0) * (it.vatRate || 0) / 100 * 100) / 100,
          })),
          subAccountCode: ed.items[0]?.subAccountCode || "",
          subAccountDescription: ed.items[0]?.subAccountDescription || "",
          date: ed.date,
          baseAmount,
          vatAmount,
          irpfRate: ed.irpfRate,
          irpfAmount,
          totalAmount,
          attachmentUrl: exp.fileUrl || null,
          attachmentFileName: exp.fileName || null,
          fromFormId: formId,
          fromFormRequester: submission.requesterName,
          createdAt: Timestamp.now(),
          createdBy: userId,
          createdByName: userName,
        });

        addedBase  += baseAmount;
        addedVat   += vatAmount;
        addedTotal += totalAmount;
      }

      batch.update(doc(db, `projects/${projectId}/transferEnvelopes`, volcarTargetEnvelopeId), {
        totalBase:    (envelope.totalBase   || 0) + addedBase,
        totalVat:     (envelope.totalVat    || 0) + addedVat,
        totalAmount:  (envelope.totalAmount || 0) + addedTotal,
        expenseCount: (envelope.expenseCount || 0) + submission.expenses.length,
      });

      batch.update(doc(db, "forms", formId), { importedToEnvelopeId: volcarTargetEnvelopeId });

      await batch.commit();
      setShowVolcarModal(null);
      setVolcarTargetEnvelopeId("");
      setVolcarExpenseData([]);
      showToast("success", `${submission.expenses.length} gasto${submission.expenses.length !== 1 ? "s" : ""} volcado${submission.expenses.length !== 1 ? "s" : ""} al sobre`);
      await loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido volcar los gastos"); }
    finally { setVolcandoFormId(null); }
  };

  // ─────────────────────────────────────────────────────────────────────────────

  const emptyTransferEnvelopeForm = {
    notes: "", personName: "", personDepartment: "",
  };

  const handleCreateTransferEnvelope = async () => {
    if (!transferEnvelopeForm.personName.trim()) return showToast("error", "Nombre de la persona obligatorio");
    setSaving(true);
    try {
      const num = nextTransferNumber;
      const displayNumber = `PC-${String(num).padStart(3, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/transferEnvelopes`), {
        number: num, displayNumber,
        paymentDate: "",
        status: "draft", totalBase: 0, totalVat: 0, totalAmount: 0, expenseCount: 0,
        notes: transferEnvelopeForm.notes.trim() || "",
        personName: transferEnvelopeForm.personName.trim(),
        personDepartment: transferEnvelopeForm.personDepartment || "",
        personIban: "",
        advances: [],
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      await updateDoc(doc(db, `projects/${projectId}`), { nextTransferNumber: num + 1 });
      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateTransferEnvelopeModal(false);
      setTransferEnvelopeForm(emptyTransferEnvelopeForm);
      loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido crear sobre"); } finally { setSaving(false); }
  };

  // Un sobre puede recibir varios anticipos a lo largo del tiempo (p. ej. 500€
  // al principio y otros 200€ más adelante si hace falta antes de liquidar).
  const handleAddAdvance = async () => {
    if (!selectedTransferEnvelope) return;
    if (!Number(advanceForm.amount) || Number(advanceForm.amount) <= 0) return showToast("error", "Importe obligatorio");
    if (!advanceForm.proofFile) return showToast("error", "Adjunta el comprobante del anticipo");
    setAddingAdvance(true);
    try {
      const fileName = `${Date.now()}_${advanceForm.proofFile.name}`;
      const fileRef = ref(storage, `projects/${projectId}/transferEnvelopes/${selectedTransferEnvelope.id}/advances/${fileName}`);
      await uploadBytes(fileRef, advanceForm.proofFile);
      const proofUrl = await getDownloadURL(fileRef);
      const entry: AdvanceEntry = {
        id: crypto.randomUUID(),
        amount: Number(advanceForm.amount),
        method: advanceForm.method,
        date: advanceForm.date,
        proofUrl, proofFileName: advanceForm.proofFile.name,
        addedAt: new Date(), addedBy: userId || "", addedByName: userName,
      };
      const updates: any = { advances: [...selectedTransferEnvelope.advances, { ...entry, addedAt: Timestamp.now() }] };
      if (advanceForm.method === "bank" && advanceForm.iban.trim()) {
        updates.personIban = advanceForm.iban.trim();
      }
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, selectedTransferEnvelope.id), updates);
      showToast("success", "Anticipo añadido");
      setShowAddAdvanceModal(false);
      setAdvanceForm({ amount: "", method: "bank", date: new Date().toISOString().slice(0, 10), iban: "", proofFile: null });
      loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido añadir el anticipo"); } finally { setAddingAdvance(false); }
  };

  const canDeleteTransferEnvelope = (envelope: TransferEnvelope) => envelope.status !== "settled";

  const handleDeleteTransferEnvelope = async (envelope: TransferEnvelope) => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      transferExpenses.filter(e => e.envelopeId === envelope.id).forEach(e =>
        batch.delete(doc(db, `projects/${projectId}/transferExpenses`, e.id)));
      batch.delete(doc(db, `projects/${projectId}/transferEnvelopes`, envelope.id));
      await batch.commit();
      showToast("success", "Sobre eliminado");
      setShowDeleteTransferEnvelopeModal(null);
      if (selectedTransferEnvelope?.id === envelope.id) setSelectedTransferEnvelope(null);
      loadData();
    } catch { showToast("error", "No se ha podido eliminar sobre"); } finally { setSaving(false); }
  };

  const computeExpenseTotal = (exp: { items: Array<{ baseAmount: number; vatRate: number }>; irpfRate: number }) => {
    const baseAmount = exp.items.reduce((sum, item) => sum + (item.baseAmount || 0), 0);
    const vatAmount = exp.items.reduce((sum, item) =>
      sum + Math.round((item.baseAmount || 0) * (item.vatRate || 0) / 100 * 100) / 100, 0);
    const irpfAmount = Math.round(baseAmount * (exp.irpfRate || 0) / 100 * 100) / 100;
    return { baseAmount, vatAmount, irpfAmount, totalAmount: baseAmount + vatAmount - irpfAmount };
  };

  const createEmptyItem = () => ({
    id: crypto.randomUUID(),
    subAccountCode: "", subAccountDescription: "", description: "",
    baseAmount: 0, vatRate: 21,
  });

  const createEmptyExpense = () => ({
    id: crypto.randomUUID(),
    type: "ticket" as "invoice" | "ticket",
    supplier: "", supplierTaxId: "",
    date: new Date().toLocaleDateString("es-ES"),
    irpfRate: 0,
    file: null as File | null,
    items: [createEmptyItem()],
  });

  const updateExpenseInList = (index: number, field: string, value: any) =>
    setExpensesList(prev => prev.map((exp, i) => i === index ? { ...exp, [field]: value } : exp));

  const updateExpenseItem = (expIndex: number, itemIndex: number, field: string, value: any) =>
    setExpensesList(prev => prev.map((exp, i) => {
      if (i !== expIndex) return exp;
      return { ...exp, items: exp.items.map((item, j) => j === itemIndex ? { ...item, [field]: value } : item) };
    }));

  const addItemToExpense = (expIndex: number) =>
    setExpensesList(prev => prev.map((exp, i) =>
      i === expIndex ? { ...exp, items: [...exp.items, createEmptyItem()] } : exp));

  const removeItemFromExpense = (expIndex: number, itemIndex: number) =>
    setExpensesList(prev => prev.map((exp, i) => {
      if (i !== expIndex || exp.items.length <= 1) return exp;
      return { ...exp, items: exp.items.filter((_, j) => j !== itemIndex) };
    }));

  const removeExpenseFromList = (index: number) =>
    setExpensesList(prev => prev.filter((_, i) => i !== index));

  const handleAddAllExpenses = async () => {
    if (!selectedTransferEnvelope) return;
    const validExpenses = expensesList.filter(
      exp => exp.supplier.trim() && exp.items.some(item => item.baseAmount > 0 && item.subAccountCode)
    );
    if (validExpenses.length === 0) return showToast("error", "Añade al menos un gasto válido");
    setSaving(true);
    try {
      let addedTotalBase = 0, addedTotalVat = 0, addedTotalAmount = 0;
      for (const exp of validExpenses) {
        const { baseAmount, vatAmount, irpfAmount, totalAmount } = computeExpenseTotal(exp);
        let attachmentUrl = "", attachmentFileName = "";
        if (exp.file) {
          const fileName = `${Date.now()}_${exp.file.name}`;
          const fileRef = ref(storage, `projects/${projectId}/transferExpenses/${selectedTransferEnvelope.id}/${fileName}`);
          await uploadBytes(fileRef, exp.file);
          attachmentUrl = await getDownloadURL(fileRef);
          attachmentFileName = exp.file.name;
        }
        const itemsData = exp.items
          .filter(item => item.baseAmount > 0 && item.subAccountCode)
          .map(item => ({
            subAccountCode: item.subAccountCode,
            subAccountDescription: item.subAccountDescription,
            description: item.description || "",
            baseAmount: item.baseAmount,
            vatRate: item.vatRate,
            vatAmount: Math.round(item.baseAmount * item.vatRate / 100 * 100) / 100,
          }));
        await addDoc(collection(db, `projects/${projectId}/transferExpenses`), {
          envelopeId: selectedTransferEnvelope.id, type: exp.type,
          personName: selectedTransferEnvelope.personName,
          personDepartment: selectedTransferEnvelope.personDepartment || "",
          personIban: selectedTransferEnvelope.personIban || "",
          supplier: exp.supplier.trim(),
          supplierTaxId: exp.supplierTaxId.trim() || "",
          items: itemsData,
          date: exp.date,
          baseAmount, vatAmount, irpfRate: exp.irpfRate, irpfAmount, totalAmount,
          attachmentUrl, attachmentFileName,
          createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        addedTotalBase += baseAmount;
        addedTotalVat += vatAmount;
        addedTotalAmount += totalAmount;
      }
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, selectedTransferEnvelope.id), {
        totalBase: selectedTransferEnvelope.totalBase + addedTotalBase,
        totalVat: selectedTransferEnvelope.totalVat + addedTotalVat,
        totalAmount: selectedTransferEnvelope.totalAmount + addedTotalAmount,
        expenseCount: selectedTransferEnvelope.expenseCount + validExpenses.length,
      });
      showToast("success", `${validExpenses.length} gasto${validExpenses.length > 1 ? "s" : ""} añadido${validExpenses.length > 1 ? "s" : ""}`);
      setShowAddExpenseModal(false);
      setExpensesList([]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido añadir gastos"); } finally { setSaving(false); }
  };

  const handleDeleteExpense = async (expense: TransferExpense) => {
    if (!selectedTransferEnvelope) return;
    try {
      await deleteDoc(doc(db, `projects/${projectId}/transferExpenses`, expense.id));
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, selectedTransferEnvelope.id), {
        totalBase: Math.max(0, selectedTransferEnvelope.totalBase - expense.baseAmount),
        totalVat: Math.max(0, selectedTransferEnvelope.totalVat - expense.vatAmount),
        totalAmount: Math.max(0, selectedTransferEnvelope.totalAmount - expense.totalAmount),
        expenseCount: Math.max(0, selectedTransferEnvelope.expenseCount - 1),
      });
      showToast("success", "Gasto eliminado");
      loadData();
    } catch { showToast("error", "No se ha podido eliminar gasto"); }
  };

  // Calcula quién liquida a quién: si el gasto no supera el anticipo, la
  // persona devuelve la diferencia; si lo supera, la productora se la paga.
  const getTotalAdvance = (envelope: TransferEnvelope) => (envelope.advances || []).reduce((s, a) => s + a.amount, 0);

  const getSettlementPreview = (envelope: TransferEnvelope) => {
    const diff = Math.round((envelope.totalAmount - getTotalAdvance(envelope)) * 100) / 100;
    if (diff > 0) return { diff, direction: "production_to_person" as const, label: `La productora paga a ${envelope.personName}` };
    if (diff < 0) return { diff: Math.abs(diff), direction: "person_to_production" as const, label: `${envelope.personName} devuelve a la productora` };
    return { diff: 0, direction: "none" as const, label: "Sin movimiento" };
  };

  const handleSettleEnvelope = async () => {
    if (!selectedTransferEnvelope) return;
    const preview = getSettlementPreview(selectedTransferEnvelope);
    if (preview.direction !== "none" && !settleForm.proofFile) return showToast("error", "Sube el extracto de la liquidación");
    setSaving(true);
    try {
      let settlementProofUrl = "", settlementProofFileName = "";
      if (settleForm.proofFile) {
        const fileName = `${Date.now()}_${settleForm.proofFile.name}`;
        const fileRef = ref(storage, `projects/${projectId}/transferEnvelopes/${selectedTransferEnvelope.id}/settlementProof/${fileName}`);
        await uploadBytes(fileRef, settleForm.proofFile);
        settlementProofUrl = await getDownloadURL(fileRef);
        settlementProofFileName = settleForm.proofFile.name;
      }
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, selectedTransferEnvelope.id), {
        status: "settled", settledAt: Timestamp.now(),
        settledBy: userId, settledByName: userName,
        settlementDirection: preview.direction,
        settlementAmount: preview.diff,
        settlementReference: settleForm.reference.trim() || "",
        settlementProofUrl, settlementProofFileName,
      });
      showToast("success", "Sobre liquidado");
      setShowSettleModal(false);
      setSettleForm({ reference: "", proofFile: null });
      loadData();
    } catch (e) { console.error(e); showToast("error", "No se ha podido liquidar"); } finally { setSaving(false); }
  };

  // Derived Data
  const filteredBoxes = boxes.filter(b => matchWords(searchTerm, b.name, b.department) || matchCode(searchTerm, b.code));
  const filteredTransferEnvelopes = transferEnvelopes.filter(e =>
    matchWords(searchTerm, e.personName, e.personDepartment) || matchCode(searchTerm, e.displayNumber, e.paymentDate)
  );
  const cardEnvelopes = selectedBox ? envelopes.filter(e => e.boxId === selectedBox.id) : [];
  const envelopeExpenses = selectedEnvelope ? expenses.filter(e => e.envelopeId === selectedEnvelope.id) : [];
  const currentTransferExpenses = selectedTransferEnvelope
    ? transferExpenses.filter(e => e.envelopeId === selectedTransferEnvelope.id)
    : [];
  const openEnvelopes = envelopes.filter(e => e.status === "open").length;
  const pendingFormSubmissions = formSubmissions.filter((f) => !f.importedToEnvelopeId).length;
  const totalTarjetasAmount = expenses.reduce((s, e) => s + e.totalAmount, 0);
  const totalTransferAmount = transferEnvelopes.reduce((s, e) => s + e.totalAmount, 0);

  // Detect document type for preview — Firebase Storage URLs encode the filename in the `o` query param
  const getDocumentType = (url: string): "pdf" | "image" | null => {
    if (!url) return null;
    // Try to extract the actual filename from Firebase Storage URL (?o=path%2Ffile.pdf&...)
    let filename = url;
    try {
      const u = new URL(url);
      const o = u.searchParams.get("o") || u.pathname;
      filename = decodeURIComponent(o).toLowerCase();
    } catch { filename = url.toLowerCase(); }
    if (filename.includes(".pdf")) return "pdf";
    if (filename.includes(".jpg") || filename.includes(".jpeg") || filename.includes(".png") || filename.includes(".webp")) return "image";
    return "pdf"; // default
  };

  // ─── Loading / Access ─────────────────────────────────────────────────────────
  if (loading || permissionsLoading) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
    </div>
  );

  if (!hasAccess || accessError) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="text-center max-w-md">
        <div className="hidden">
          <ShieldAlert size={28} className="text-red-500" />
        </div>
        <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6 text-[13px]">{accessError || "No tienes permisos para acceder a este módulo"}</p>
        <Link href={`/project/${projectId}/accounting`}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium">
          <ArrowLeft size={16} /> Volver a contabilidad
        </Link>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {/* Toast */}

      {/* Header */}
      <div className="mt-[53px]">
        <div className="px-6 pt-8 sm:px-10">
          <div className="flex h-[61px] items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">Cajas</h1>
              <div className="ml-4 flex items-center gap-1">
                <button
                  onClick={() => { setMainTab("tarjetas"); setSelectedBox(null); setSelectedEnvelope(null); setSelectedTransferEnvelope(null); setSearchTerm(""); }}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-[13px] transition-colors ${mainTab === "tarjetas" ? "font-medium text-slate-900 bg-[#F1F1F3]" : "text-slate-500 hover:text-slate-700"}`}>
                  <CreditCard size={15} /> Tarjetas
                  {openEnvelopes > 0 && (
                    <span className="text-xs tabular-nums text-amber-800">{openEnvelopes}</span>
                  )}
                </button>
                <button
                  onClick={() => { setMainTab("transfers"); setSelectedBox(null); setSelectedEnvelope(null); setSelectedTransferEnvelope(null); setSearchTerm(""); }}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-[13px] transition-colors ${mainTab === "transfers" ? "font-medium text-slate-900 bg-[#F1F1F3]" : "text-slate-500 hover:text-slate-700"}`}>
                  <Send size={15} /> Transferencias
                  {pendingFormSubmissions > 0 && (
                    <span className="text-xs tabular-nums text-amber-800">{pendingFormSubmissions}</span>
                  )}
                </button>
                <button
                  onClick={() => { setMainTab("cash"); setSelectedBox(null); setSelectedEnvelope(null); setSelectedTransferEnvelope(null); setSearchTerm(""); }}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-[13px] transition-colors ${mainTab === "cash" ? "font-medium text-slate-900 bg-[#F1F1F3]" : "text-slate-500 hover:text-slate-700"}`}>
                  <Banknote size={15} /> Efectivo
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowExportConfigModal(true)}
                title="Configurar exportación a servicio de tarjetas"
                className="p-1.5 text-slate-400 rounded-md hover:bg-[#F4F4F5] hover:text-slate-900 transition-colors">
                <Settings size={16} />
              </button>
              {/* En Efectivo el botón se oculta pero conserva su hueco, para que la
                  cabecera no cambie de altura al cambiar de pestaña. */}
              <button
                aria-hidden={mainTab === "cash"}
                tabIndex={mainTab === "cash" ? -1 : 0}
                onClick={() => mainTab === "tarjetas"
                  ? (setBoxForm({ name: "", code: "", department: "" }), setShowCreateBoxModal(true))
                  : (setTransferEnvelopeForm(emptyTransferEnvelopeForm), setShowCreateTransferEnvelopeModal(true))}
                className={`flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium ${mainTab === "cash" ? "invisible" : ""}`}>
                <Plus size={16} /> {mainTab === "tarjetas" ? "Nueva tarjeta" : "Nuevo sobre"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {mainTab === "cash" ? (
        <CashBox
          projectId={projectId}
          projectName={projectName}
          userId={userId}
          userName={userName}
          subAccounts={subAccounts.map((s) => ({ code: s.code, description: s.description }))}
          departments={departments}
          onToast={showToast}
        />
      ) : (
      <div className="px-6 pt-6 sm:px-10 pb-8">
        <div className="flex gap-6">

          {/* ── Left Panel ──────────────────────────────────────────────────────── */}
          <div className="w-64 flex-shrink-0">
            <div className="sticky top-[85px]">
              <div className="mb-4">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder={mainTab === "tarjetas" ? "Tarjeta, código o departamento" : "Persona, nº de sobre o departamento"}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>

              {mainTab === "tarjetas" ? (
                <div className="space-y-1">
                  {filteredBoxes.map(box => {
                    const openCount = envelopes.filter(e => e.boxId === box.id && e.status === "open").length;
                    const isSelected = selectedBox?.id === box.id;
                    return (
                      <button key={box.id} onClick={() => { setSelectedBox(box); setSelectedEnvelope(null); }}
                        className={`relative flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left ${isSelected ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                        {isSelected && <span className="absolute inset-y-1 left-0 w-[2px] rounded bg-slate-900" />}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-slate-900">{box.name}</span>
                          <span className="block text-xs text-slate-500"><span className="font-mono">{box.code}</span>{box.department ? ` · ${box.department}` : ""}</span>
                        </span>
                        {openCount > 0 && <span className="text-xs tabular-nums text-amber-800" title="Sobres abiertos">{openCount} abierto{openCount > 1 ? "s" : ""}</span>}
                      </button>
                    );
                  })}
                  {filteredBoxes.length === 0 && (
                    <p className="text-center py-8 text-slate-400 text-[13px]">{searchTerm ? "Sin resultados" : "No hay tarjetas"}</p>
                  )}
                </div>
              ) : (
                <>
                {/* Solicitudes recibidas (pendientes de volcar) */}
                {mainTab === "transfers" && pendingFormSubmissions > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 px-1 text-xs font-medium text-slate-500">
                      Solicitudes recibidas <span className="font-normal text-amber-800">{pendingFormSubmissions}</span>
                    </p>
                    <div className="space-y-1">
                      {formSubmissions.filter((fs) => !fs.importedToEnvelopeId).map((fs) => (
                        <div key={fs.id} className="rounded-md border border-slate-200 p-3 text-left">
                          <div className="flex items-start justify-between gap-1 mb-1">
                            <p className="text-[13px] font-medium text-slate-900 leading-tight">{fs.requesterName}</p>
                            <span className="flex-shrink-0 text-xs text-amber-800">Pendiente</span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {fs.expenseCount} gasto{fs.expenseCount !== 1 ? "s" : ""} · <strong>{new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(fs.totalAmount)} €</strong>
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">{fs.submittedAt.toLocaleDateString("es-ES")}</p>
                          <button
                            onClick={() => {
                              setShowVolcarModal(fs.id);
                              setVolcarTargetEnvelopeId(fs.targetEnvelopeId && transferEnvelopes.some(e => e.id === fs.targetEnvelopeId && e.status === "draft") ? fs.targetEnvelopeId : "");
                              const today = new Date().toISOString().slice(0, 10);
                              setVolcarExpenseData(fs.expenses.map((exp) => {
                                const total = Number(exp.amount) || 0;
                                const vatRate = 21;
                                const baseAmount = Math.round((total / (1 + vatRate / 100)) * 100) / 100;
                                return {
                                  supplier: "", // el proveedor de la factura/ticket, NO el solicitante
                                  supplierTaxId: "",
                                  type: "ticket" as "invoice" | "ticket",
                                  date: today,
                                  irpfRate: 0,
                                  items: [{ id: crypto.randomUUID(), subAccountCode: "", subAccountDescription: "", baseAmount, vatRate, showSubAccountDropdown: false, subAccountSearch: "" }],
                                };
                              }));
                              setShowVolcarSupplierDropdown(null);
                            }}
                            className="mt-2 w-full rounded-md border border-[#E4E4E7] bg-[#F1F1F3] px-2 py-1.5 text-xs font-medium text-slate-900 hover:bg-[#E8E8EB]">
                            Volcar a sobre →
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-slate-100 mt-3 mb-3" />
                  </div>
                )}

                {/* Solicitudes volcadas (histórico, colapsado) */}
                {mainTab === "transfers" && formSubmissions.some((fs) => fs.importedToEnvelopeId) && (
                  <div className="mb-4">
                    <button
                      onClick={() => setShowVolcadas(!showVolcadas)}
                      className="w-full flex items-center justify-between px-1 mb-2"
                    >
                      <p className="text-xs font-medium text-slate-500">
                        Solicitudes volcadas
                        <span className="ml-1.5 text-slate-300">{formSubmissions.filter((fs) => fs.importedToEnvelopeId).length}</span>
                      </p>
                      <ChevronDown size={12} className={`text-slate-400 transition-transform ${showVolcadas ? "rotate-180" : ""}`} />
                    </button>
                    {showVolcadas && (
                      <div className="space-y-1">
                        {formSubmissions.filter((fs) => fs.importedToEnvelopeId).map((fs) => (
                          <div key={fs.id} className="rounded-md border border-slate-200 p-3 text-left">
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <p className="text-[13px] font-medium text-slate-900 leading-tight">{fs.requesterName}</p>
                              <span className="flex-shrink-0 text-xs text-emerald-800">Volcado</span>
                            </div>
                            <p className="text-xs text-slate-500">
                              {fs.expenseCount} gasto{fs.expenseCount !== 1 ? "s" : ""} · <strong>{new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(fs.totalAmount)} €</strong>
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">{fs.submittedAt.toLocaleDateString("es-ES")}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="border-t border-slate-100 mt-3 mb-3" />
                  </div>
                )}
                <div className="space-y-1">
                  {filteredTransferEnvelopes.map(envelope => {
                    const isSelected = selectedTransferEnvelope?.id === envelope.id;
                    return (
                      <button key={envelope.id} onClick={() => setSelectedTransferEnvelope(envelope)}
                        className={`relative flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left ${isSelected ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                        {isSelected && <span className="absolute inset-y-1 left-0 w-[2px] rounded bg-slate-900" />}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-slate-900">{envelope.personName || "Sin persona"}</span>
                          <span className="block text-xs text-slate-500"><span className="font-mono">{envelope.displayNumber}</span> · {envelope.expenseCount} gastos</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-xs ${envelope.status === "settled" ? "text-emerald-800" : envelope.status === "pending_approval" ? "text-[#2F52E0]" : "text-amber-800"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${envelope.status === "settled" ? "bg-emerald-500" : envelope.status === "pending_approval" ? "bg-[#2F52E0]" : "bg-amber-500"}`} />{envelope.status === "settled" ? "Liquidado" : envelope.status === "pending_approval" ? "En aprobación" : envelope.approvedAt ? "Aprobado" : "Abierto"}
                        </span>
                      </button>
                    );
                  })}
                  {filteredTransferEnvelopes.length === 0 && (
                    <p className="text-center py-8 text-slate-400 text-[13px]">{searchTerm ? "Sin resultados" : "No hay sobres"}</p>
                  )}
                </div>
                </>
              )}
            </div>
          </div>

          {/* ── Right Panel ─────────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {mainTab === "tarjetas" ? (
              !selectedBox ? (
                <EmptyState title={boxes.length === 0 ? "Aún no hay tarjetas" : "Elige una tarjeta"} />
              ) : !selectedEnvelope ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                        {selectedBox.name}
                        <span className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 font-mono text-[11px] font-normal text-slate-600">{selectedBox.code}</span>
                      </h2>
                      {selectedBox.department && <p className="text-xs text-slate-500">{selectedBox.department}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Menu trigger={(t) => <IconButton label="Más acciones de la tarjeta" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                        {(close) => (
                          <>
                            <MenuItem onClick={() => { close(); setEditBoxForm({ name: selectedBox.name, code: selectedBox.code }); setShowEditBoxModal(true); }}>Editar tarjeta</MenuItem>
                            {canDeleteBox(selectedBox) && (<><MenuSeparator /><MenuItem danger onClick={() => { close(); setShowDeleteBoxModal(true); }}>Eliminar tarjeta</MenuItem></>)}
                          </>
                        )}
                      </Menu>
                      <Button variant="primary" onClick={() => setShowCreateEnvelopeModal(true)}><Plus size={14} /> Nuevo sobre</Button>
                    </div>
                  </div>
                  {cardEnvelopes.length === 0 ? (
                    <EmptyState title="Esta tarjeta aún no tiene sobres" />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="tbl w-full min-w-[720px] border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                            <th scope="col" className="px-4 py-2 text-left font-medium">Sobre</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Gastos</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Por revisar</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Abierto</th>
                            <th scope="col" className="w-12 py-2 pr-3" />
                          </tr>
                        </thead>
                        <tbody>
                          {cardEnvelopes.map((envelope) => {
                            const envExpenses = expenses.filter((e) => e.envelopeId === envelope.id);
                            const pendingCount = envExpenses.filter((e) => e.status === "pending").length;
                            const conflictCount = envExpenses.filter((e) => !!e.conflictType).length;
                            const st = cardEnvState(envelope);
                            return (
                              <tr key={envelope.id} onClick={() => setSelectedEnvelope(envelope)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                                <td className="px-4 py-1.5 font-mono text-xs font-medium">{envelope.displayNumber}</td>
                                <td className="px-3 py-1.5 text-xs"><span className={`inline-flex items-center gap-1.5 ${st.t}`}><span className={`h-1.5 w-1.5 rounded-full ${st.d}`} />{st.l}</span></td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{envelope.expenseCount}</td>
                                <td className="px-3 py-1.5 text-xs">
                                  {pendingCount > 0 ? <span className="text-amber-800">{pendingCount} pendientes</span> : <span className="text-slate-400">—</span>}
                                  {conflictCount > 0 && <span className="text-red-700"> · {conflictCount} con incidencia</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-xs font-medium">{fmt(envelope.totalAmount)}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtDate(envelope.createdAt)}</td>
                                <td className="py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                                  {canDeleteEnvelope(envelope) && envelope.status !== "closed" && (
                                    <Menu trigger={(t) => <IconButton label="Acciones del sobre" onClick={t} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                                      {(close) => <MenuItem danger onClick={() => { close(); setShowDeleteEnvelopeModal(envelope); }}>Eliminar sobre</MenuItem>}
                                    </Menu>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                /* Envelope detail */
                (() => {
                  const q = envSearch.trim();
                  const visible = envelopeExpenses.filter((e) => {
                    if (envStatus === "pending" && e.status !== "pending") return false;
                    if (envStatus === "reviewed" && e.status === "pending") return false;
                    if (envStatus === "conflict" && !e.conflictType) return false;
                    if (envStatus === "nodoc" && e.documentUrl) return false;
                    if (!q) return true;
                    const byNumber = matchCode(q, e.displayNumber);
                    const bySupplier = matchWords(q, e.supplier) || matchCode(q, e.supplierTaxId);
                    const byConcept = matchWords(q, e.description);
                    const byAccount = matchCode(q, e.subAccountCode) || matchWords(q, e.subAccountDescription);
                    const byAmount = matchAmount(q, e.totalAmount, e.baseAmount) === true;
                    return envField === "number" ? byNumber : envField === "supplier" ? bySupplier : envField === "account" ? byAccount : envField === "amount" ? byAmount : byNumber || bySupplier || byConcept || byAccount || byAmount;
                  });
                  const tot = visible.reduce((s, e) => ({ base: s.base + e.baseAmount, vat: s.vat + e.vatAmount, total: s.total + e.totalAmount }), { base: 0, vat: 0, total: 0 });
                  const open = selectedEnvelope.status === "open";
                  const pendingN = envelopeExpenses.filter((e) => e.status === "pending").length;
                  const est = cardEnvState(selectedEnvelope);
                  return (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-col gap-1">
                          <button onClick={() => setSelectedEnvelope(null)} className="inline-flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> {selectedBox.name}</button>
                          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                            <span className="font-mono">{selectedEnvelope.displayNumber}</span>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-normal ${est.t}`}><span className={`h-1.5 w-1.5 rounded-full ${est.d}`} />{est.l}</span>
                          </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Menu trigger={(t) => <IconButton label="Más acciones del sobre" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                            {(close) => (
                              <>
                                <MenuItem onClick={() => { close(); router.push(`/project/${projectId}/accounting/document-center?doc=card-env:${selectedEnvelope.id}`); }}>Ver en documentación</MenuItem>
                                {open && <MenuItem onClick={() => { close(); setShowImportModal(true); }}>Importar Excel de la tarjeta</MenuItem>}
                                {open && envelopeExpenses.length > 0 && <MenuItem onClick={() => { close(); setReceiptFiles([]); setShowReceiptImportModal(true); }}>Importar recibos</MenuItem>}
                              </>
                            )}
                          </Menu>
                          {open && <Button variant="secondary" onClick={() => { setCardExpensesList([createEmptyCardExpense()]); setShowManualExpenseModal(true); }}><Plus size={14} /> Gasto</Button>}
                          {(open || selectedEnvelope.status === "reviewing") && (
                            <Button variant="primary" onClick={() => handleCloseEnvelope(selectedEnvelope)} disabled={pendingN > 0 || saving} title={pendingN > 0 ? `Quedan ${pendingN} gastos por revisar` : undefined}>
                              <Lock size={14} /> Cerrar sobre
                            </Button>
                          )}
                        </div>
                      </div>

                      {selectedEnvelope.status === "pending_approval" && <PendingApprovalNotice doc={selectedEnvelope as any} />}
                      {selectedEnvelope.status === "open" && selectedEnvelope.rejectionReason && (
                        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">Rechazado{selectedEnvelope.rejectedByName ? ` por ${selectedEnvelope.rejectedByName}` : ""}: {selectedEnvelope.rejectionReason}</p>
                      )}
                      {envelopeExpenses.length === 0 ? (
                        <EmptyState
                          title="Sin gastos en este sobre"
                          action={open ? (
                            <div className="flex gap-2">
                              <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>Importar Excel</Button>
                              <Button variant="primary" size="sm" onClick={() => { setCardExpensesList([createEmptyCardExpense()]); setShowManualExpenseModal(true); }}>Añadir gasto</Button>
                            </div>
                          ) : undefined}
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <SearchBar fields={ENV_FIELDS} field={envField} onField={setEnvField} value={envSearch} onChange={setEnvSearch} count={visible.length} />
                            <Segmented
                              value={envStatus}
                              onChange={setEnvStatus}
                              options={[
                                { value: "all", label: "Todos" },
                                { value: "pending", label: `Por revisar · ${pendingN}` },
                                { value: "reviewed", label: "Revisados" },
                                { value: "conflict", label: "Incidencias" },
                                { value: "nodoc", label: "Sin documento" },
                              ]}
                            />
                          </div>
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="tbl w-full min-w-[900px] border-collapse text-[13px]">
                              <thead>
                                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                                  <th scope="col" className="px-4 py-2 text-left font-medium">Nº</th>
                                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                                  <th scope="col" className="px-3 py-2 text-left font-medium">Cuenta</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">Base</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">IVA</th>
                                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                                  <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                                  <th scope="col" className="w-20 py-2 pr-3" />
                                </tr>
                              </thead>
                              <tbody>
                                {visible.map((expense) => {
                                  const hasConflict = !!expense.conflictType;
                                  const isDrawerOpen = drawerExpense?.id === expense.id;
                                  const missing = expense.subAccountCode && !subAccounts.some((sa) => sa.code === expense.subAccountCode);
                                  const st = expense.status === "pending" ? { l: "Pendiente", d: "bg-amber-500", t: "text-amber-800" } : expense.status === "reviewed" ? { l: "Revisado", d: "bg-slate-400", t: "text-slate-600" } : { l: "Contabilizado", d: "bg-emerald-500", t: "text-emerald-800" };
                                  return (
                                    <tr key={expense.id} onClick={() => openDrawer(expense)} className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${isDrawerOpen ? "bg-[#F4F4F5]" : ""}`}>
                                      <td className="whitespace-nowrap px-4 py-1.5">
                                        <span className="font-mono text-xs font-medium">{expense.displayNumber}</span>
                                        <span className="ml-1.5 text-[10px] text-slate-500">{expense.type === "ticket" ? "ticket" : "factura"}</span>
                                        {hasConflict && <span className="block text-[11px] text-red-700">{CONFLICT_CONFIG[expense.conflictType!].label}</span>}
                                      </td>
                                      <td className="max-w-[240px] px-3 py-1.5">
                                        <span className="block truncate font-medium text-slate-900">{expense.supplier}</span>
                                        <span className="block font-mono text-[11px] text-slate-500">{expense.supplierTaxId}</span>
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                                        <span className={missing ? "text-red-700" : "text-slate-600"} title={missing ? "La cuenta no existe en el presupuesto" : undefined}>{expense.subAccountCode || "—"}</span>
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{fmt(expense.baseAmount)}</td>
                                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{fmt(expense.vatAmount)}</td>
                                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs font-medium">
                                        {fmt(expense.totalAmount)}
                                        {hasConflict && expense.pleoAmount && Math.abs(expense.pleoAmount - expense.totalAmount) > 0.02 && <span className="block text-[11px] font-normal text-red-700">tarjeta {fmt(expense.pleoAmount)}</span>}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                                        <span className={`inline-flex items-center gap-1.5 ${st.t}`}><span className={`h-1.5 w-1.5 rounded-full ${st.d}`} />{st.l}</span>
                                        {!expense.documentUrl && <span className="ml-1.5 text-red-700">· sin doc.</span>}
                                      </td>
                                      <td className="py-1.5 pr-3" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-end gap-0.5">
                                          {expense.status === "pending" && open && (
                                            <IconButton label="Marcar revisado" onClick={() => handleReviewExpense(expense)} className="-my-1"><Check size={14} /></IconButton>
                                          )}
                                          <Menu trigger={(t) => <IconButton label="Acciones del gasto" onClick={t} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                                            {(close) => (
                                              <>
                                                <MenuItem onClick={() => { close(); openDrawer(expense); }}>Abrir</MenuItem>
                                                {expense.documentUrl && <MenuItem onClick={() => { close(); openDrawer(expense, true); }}>Ver documento</MenuItem>}
                                                {expense.pleoUrl && <MenuItem onClick={() => { close(); window.open(expense.pleoUrl, "_blank", "noopener"); }}>Ver en la tarjeta (Pleo)</MenuItem>}
                                              </>
                                            )}
                                          </Menu>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                                  <td className="px-4 py-2 font-semibold" colSpan={3}>Total{visible.length !== envelopeExpenses.length ? " filtrado" : ""}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(tot.base)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(tot.vat)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(tot.total)}</td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()
              )
            ) : (
              /* ── TRANSFERENCIAS ── */
              !selectedTransferEnvelope ? (
                <EmptyState title={transferEnvelopes.length === 0 ? "Aún no hay sobres de transferencias" : "Elige un sobre"} />
              ) : (() => {
                const env = selectedTransferEnvelope;
                const draft = env.status === "draft";
                const preview = getSettlementPreview(env);
                const totalAdvance = getTotalAdvance(env);
                const q = trfSearch.trim();
                const visible = currentTransferExpenses.filter((exp) => {
                  if (!q) return true;
                  const items = exp.items?.length ? exp.items : [{ subAccountCode: exp.subAccountCode || "", subAccountDescription: exp.subAccountDescription || "", description: exp.description || "" } as any];
                  const bySupplier = matchWords(q, exp.supplier) || matchCode(q, exp.supplierTaxId);
                  const byAccount = items.some((i: any) => matchCode(q, i.subAccountCode) || matchWords(q, i.subAccountDescription));
                  const byAmount = matchAmount(q, exp.totalAmount, exp.baseAmount) === true;
                  if (trfField === "supplier") return bySupplier;
                  if (trfField === "account") return byAccount;
                  if (trfField === "amount") return byAmount;
                  return bySupplier || byAccount || byAmount || matchWords(q, exp.description, ...items.map((i: any) => i.description));
                });
                const bank = env.personIban ? detectBank(env.personIban) : null;
                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <button onClick={() => setSelectedTransferEnvelope(null)} className="inline-flex w-fit items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Sobres</button>
                        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
                          <span className="font-mono">{env.displayNumber}</span>
                          <span>{env.personName}</span>
                          {(() => {
                            const ts = env.status === "pending_approval" ? { l: "En aprobación", d: "bg-[#2F52E0]", t: "text-[#2F52E0]" }
                              : draft ? (env.approvedAt ? { l: "Aprobado", d: "bg-emerald-500", t: "text-emerald-800" } : { l: "Abierto", d: "bg-amber-500", t: "text-amber-800" })
                              : { l: "Liquidado", d: "bg-emerald-500", t: "text-emerald-800" };
                            return <span className={`inline-flex items-center gap-1.5 text-xs font-normal ${ts.t}`}><span className={`h-1.5 w-1.5 rounded-full ${ts.d}`} />{ts.l}</span>;
                          })()}
                        </h2>
                        <p className="text-xs text-slate-500">
                          {[env.personDepartment, env.paymentDate && `pago ${env.paymentDate.split("-").reverse().join("/")}`].filter(Boolean).join(" · ")}
                          {env.personIban && <> · <span className="font-mono">{env.personIban}</span>{bank && ` (${bank})`}</>}
                        </p>
                      </div>
                      {draft && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Menu trigger={(t) => <IconButton label="Más acciones del sobre" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                            {(close) => (
                              <>
                                <MenuItem onClick={() => { close(); setAdvanceForm({ amount: "", method: "bank", date: new Date().toISOString().slice(0, 10), iban: "", proofFile: null }); setShowAddAdvanceModal(true); }}>Añadir anticipo</MenuItem>
                                <MenuItem onClick={() => { close(); setBoxFormRequesterName(env.personName); setBoxFormMessage(""); setBoxFormTargetEnvelopeId(env.id); setGeneratedBoxResult(null); setShowSendBoxFormModal(true); }}>Pedir gastos por enlace</MenuItem>
                                {canDeleteTransferEnvelope(env) && (<><MenuSeparator /><MenuItem danger onClick={() => { close(); setShowDeleteTransferEnvelopeModal(env); }}>Eliminar sobre</MenuItem></>)}
                              </>
                            )}
                          </Menu>
                          <Button variant="secondary" onClick={() => { setExpensesList([createEmptyExpense()]); setShowAddExpenseModal(true); }}><Plus size={14} /> Gasto</Button>
                          <Button variant="primary" disabled={(env.advances.length === 0 && env.expenseCount === 0) || saving} onClick={async () => {
                            // Si hay niveles de aprobación de sobres, primero se aprueba (lib/boxApproval).
                            try {
                              setSaving(true);
                              if (await sendEnvelopeToApproval(projectId, "transfer", env as any, env.personDepartment, { uid: userId || "", name: userName })) {
                                showToast("success", `${env.displayNumber} enviado a aprobación`);
                                setSelectedTransferEnvelope({ ...env, status: "pending_approval", approvedAt: undefined, rejectionReason: undefined });
                                loadData();
                                return;
                              }
                            } catch (e) { showToast("error", errorText(e, "No se ha podido enviar a aprobación")); return; } finally { setSaving(false); }
                            setSettleForm({ reference: "", proofFile: null }); setShowSettleModal(true);
                          }}><Scale size={14} /> Liquidar</Button>
                        </div>
                      )}
                    </div>

                    {env.status === "pending_approval" && <PendingApprovalNotice doc={env as any} />}
                    {draft && env.rejectionReason && (
                      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">Rechazado{env.rejectedByName ? ` por ${env.rejectedByName}` : ""}: {env.rejectionReason}</p>
                    )}
                    {/* Posición del sobre */}
                    <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-200">
                      <div className="flex flex-col gap-0.5 border-r border-slate-100 px-4 py-3">
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">Anticipado</span>
                        <span className="tabular-nums text-lg font-semibold">{fmt(totalAdvance)} €</span>
                        {env.advances.length > 0 && (
                          <span className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                            {env.advances.map((a) => (
                              <span key={a.id}>{fmt(a.amount)} · {a.method === "cash" ? "efectivo" : "transf."} {a.date.slice(5).split("-").reverse().join("/")}{a.proofUrl && <> · <a href={a.proofUrl} target="_blank" rel="noopener noreferrer" className="underline">ver</a></>}</span>
                            ))}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 border-r border-slate-100 px-4 py-3">
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">Gastado</span>
                        <span className="tabular-nums text-lg font-semibold">{fmt(env.totalAmount)} €</span>
                        <span className="text-xs text-slate-500">{env.expenseCount} gastos</span>
                      </div>
                      <div className="flex flex-col gap-0.5 px-4 py-3">
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">{draft ? "Liquidación prevista" : "Liquidación"}</span>
                        {draft ? (
                          <>
                            <span className="tabular-nums text-lg font-semibold">{preview.direction === "none" ? "0,00" : fmt(preview.diff)} €</span>
                            <span className="text-xs text-slate-500">{preview.label}</span>
                          </>
                        ) : (
                          <>
                            <span className="tabular-nums text-lg font-semibold">{fmt(env.settlementAmount || 0)} €</span>
                            <span className="text-xs text-slate-500">
                              {env.settlementDirection === "none" ? "Sin movimiento" : env.settlementDirection === "production_to_person" ? `Productora → ${env.personName}` : `${env.personName} → productora`}
                              {" · "}{env.settledByName} {fmtDate(env.settledAt)}
                              {env.settlementProofUrl && <> · <a href={env.settlementProofUrl} target="_blank" rel="noopener noreferrer" className="underline">extracto</a></>}
                              {env.settlementReference && ` · ref. ${env.settlementReference}`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {env.notes && <p className="text-xs text-slate-600">Notas: {env.notes}</p>}

                    {currentTransferExpenses.length === 0 ? (
                      <EmptyState title="Sin gastos en este sobre" action={draft ? <Button variant="primary" size="sm" onClick={() => { setExpensesList([createEmptyExpense()]); setShowAddExpenseModal(true); }}>Añadir gasto</Button> : undefined} />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-3">
                          <SearchBar
                            fields={[
                              { value: "all", label: "Buscar en todo", placeholder: "Proveedor, concepto o cuenta" },
                              { value: "supplier", label: "Proveedor", placeholder: "Nombre o NIF" },
                              { value: "account", label: "Cuenta", placeholder: "Ej. 03.02", mono: true },
                              { value: "amount", label: "Importe", placeholder: "50 · >100 · 20-80", mono: true },
                            ]}
                            field={trfField}
                            onField={setTrfField}
                            value={trfSearch}
                            onChange={setTrfSearch}
                            count={visible.length}
                          />
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="tbl w-full min-w-[760px] border-collapse text-[13px]">
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                                <th scope="col" className="px-4 py-2 text-left font-medium">Fecha</th>
                                <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                                <th scope="col" className="px-3 py-2 text-left font-medium">Cuentas</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Base</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">IVA</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                                <th scope="col" className="w-20 py-2 pr-3" />
                              </tr>
                            </thead>
                            <tbody>
                              {visible.map((exp) => {
                                const items = exp.items?.length ? exp.items : [{ subAccountCode: exp.subAccountCode || "", baseAmount: exp.baseAmount } as any];
                                return (
                                  <tr key={exp.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                                    <td className="whitespace-nowrap px-4 py-1.5 tabular-nums text-slate-600">{exp.date ? exp.date.split("-").reverse().slice(0, 2).join("/") : "—"}</td>
                                    <td className="max-w-[260px] px-3 py-1.5">
                                      <span className="block truncate font-medium text-slate-900">{exp.supplier}</span>
                                      <span className="block text-[11px] text-slate-500">{exp.type === "invoice" ? "Factura" : "Ticket"}{exp.supplierTaxId && <> · <span className="font-mono">{exp.supplierTaxId}</span></>}</span>
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{items.map((i: any) => i.subAccountCode).filter(Boolean).join(", ") || "—"}</td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{fmt(exp.baseAmount)}</td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{fmt(exp.vatAmount)}</td>
                                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs font-medium">{fmt(exp.totalAmount)}</td>
                                    <td className="py-1.5 pr-3">
                                      <div className="flex items-center justify-end gap-0.5">
                                        {exp.attachmentUrl ? (
                                          <IconButton label="Ver documento" onClick={() => window.open(exp.attachmentUrl, "_blank", "noopener")} className="-my-1"><Eye size={14} /></IconButton>
                                        ) : <span className="mr-1 whitespace-nowrap text-[11px] text-red-700">sin doc.</span>}
                                        {draft && <IconButton label="Eliminar gasto" onClick={() => handleDeleteExpense(exp)} className="-my-1"><Trash2 size={13} /></IconButton>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                                <td className="px-4 py-2 font-semibold" colSpan={3}>Total</td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(env.totalBase)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(env.totalVat)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(env.totalAmount)}</td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()
            )}

          </div>
        </div>
      </div>

      )}

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* EXPENSE DRAWER                                                          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {drawerExpense && (
        <div className="fixed top-[53px] inset-x-0 bottom-0 z-30 bg-black/10 backdrop-blur-[1px]" onClick={closeDrawer} />
      )}

      {/* Drawer — expands to double panel when preview is open */}
      <div className={`fixed top-[53px] right-0 bg-white shadow-xl z-40 flex flex-col transition-all duration-300 ease-out ${drawerExpense ? "translate-x-0" : "translate-x-full"} ${drawerShowPreview ? "w-[900px]" : "w-[480px]"}`} style={{ height: "calc(100vh - 53px)" }}>
        {drawerExpense && (() => {
          const hasConflict = !!drawerExpense.conflictType;
          const conflictCfg = hasConflict ? CONFLICT_CONFIG[drawerExpense.conflictType!] : null;
          const isResolvable = hasConflict && conflictCfg!.resolvable;
          const isAnnotatable = hasConflict && !conflictCfg!.resolvable;
          const amountDiff = drawerExpense.pleoAmount && drawerExpense.pleoAmount > 0
            ? Math.round((drawerExpense.pleoAmount - drawerExpense.totalAmount) * 100) / 100
            : null;
          const docType = getDocumentType(drawerExpense.documentUrl || "");

          // Navigation within envelope
          const navList = envelopeExpenses; // sorted same as table
          const navIdx = navList.findIndex(e => e.id === drawerExpense.id);
          const hasPrev = navIdx > 0;
          const hasNext = navIdx < navList.length - 1;
          const goTo = (idx: number) => openDrawer(navList[idx], drawerShowPreview);

          return (
            <div className="flex flex-1 overflow-hidden">
              {/* ── Left side: form ── */}
              <div className="w-[480px] flex-shrink-0 flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {/* Prev/Next arrows */}
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => hasPrev && goTo(navIdx - 1)}
                        disabled={!hasPrev}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                        title="Gasto anterior">
                        <ChevronLeft size={15} />
                      </button>
                      <span className="text-xs text-slate-400 tabular-nums">{navIdx + 1}/{navList.length}</span>
                      <button
                        onClick={() => hasNext && goTo(navIdx + 1)}
                        disabled={!hasNext}
                        className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                        title="Gasto siguiente">
                        <ChevronRight size={15} />
                      </button>
                    </div>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${drawerExpense.type === "ticket" ? "bg-amber-50" : "bg-[#F7F7F8]"}`}>
                      {drawerExpense.type === "ticket"
                        ? <Receipt size={16} className="text-amber-500" />
                        : <FileText size={16} className="text-slate-500" />}
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-slate-900">{drawerExpense.displayNumber}</p>
                      <p className="text-xs text-slate-500">{drawerExpense.supplier}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {drawerExpense.documentUrl && (
                      <button
                        onClick={() => setDrawerShowPreview(!drawerShowPreview)}
                        title={drawerShowPreview ? "Ocultar documento" : "Ver documento"}
                        className={`p-1.5 rounded-lg transition-colors ${drawerShowPreview ? "text-slate-700 bg-[#F7F7F8]" : "text-slate-400 hover:bg-slate-100"}`}>
                        <Eye size={16} />
                      </button>
                    )}
                    <button aria-label="Cerrar" onClick={closeDrawer} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {/* Conflict banner */}
                  {hasConflict && (
                    <div className="mx-5 mt-4 p-3 bg-amber-50 border border-amber-100 rounded-md">
                      <div className="flex items-start gap-2">
                        <Info size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-amber-800">{conflictCfg!.label}</p>
                          <p className="text-xs text-amber-600 mt-0.5">{conflictCfg!.description}</p>
                          {!conflictCfg!.resolvable && (
                            <p className="text-xs text-amber-500 mt-1 italic">Esta incidencia se anota para cuadre posterior — no se cierra.</p>
                          )}
                          {drawerExpense.conflictNote && (
                            <p className="text-xs text-amber-700 mt-1 italic">&quot;{drawerExpense.conflictNote}&quot;</p>
                          )}
                          {drawerExpense.conflictAnnotatedAt && (
                            <p className="text-xs text-amber-500 mt-1">
                              Anotado por {drawerExpense.conflictAnnotatedByName} · {fmtDate(drawerExpense.conflictAnnotatedAt)}
                            </p>
                          )}
                        </div>
                        {isResolvable && (
                          <button onClick={handleResolveConflict} disabled={drawerSaving}
                            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 disabled:opacity-50">
                            <Check size={12} /> Resolver
                          </button>
                        )}
                        {isAnnotatable && (
                          <button onClick={handleAnnotateConflict} disabled={drawerSaving}
                            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg border border-amber-300 disabled:opacity-50">
                            <Save size={12} /> Anotar
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Pleo amount + linked charges */}
                  {drawerExpense.pleoAmount && drawerExpense.pleoAmount > 0 && (
                    <div className={`mx-5 ${hasConflict ? "mt-3" : "mt-4"}`}>
                      <div className={`flex items-center justify-between p-2.5 rounded-lg text-xs ${amountDiff && Math.abs(amountDiff) > 0.02 ? "bg-amber-50 border border-amber-100" : "bg-slate-50"}`}>
                        <span className="text-slate-500">Cargo real en Pleo</span>
                        <span className={`tabular-nums font-semibold ${amountDiff && Math.abs(amountDiff) > 0.02 ? "text-amber-700" : "text-slate-700"}`}>
                          {fmt(drawerExpense.pleoAmount)} €
                          {amountDiff && Math.abs(amountDiff) > 0.02 && (
                            <span className="ml-2 text-amber-500">({amountDiff > 0 ? "+" : ""}{fmt(amountDiff)} vs factura)</span>
                          )}
                        </span>
                      </div>
                      {/* Linked charges: shown when invoice covers multiple card charges */}
                      {drawerExpense.conflictType === "invoice_covers_multiple" && drawerExpense.linkedCharges && drawerExpense.linkedCharges.length > 0 && (
                        <div className="mt-1.5 border border-slate-200 rounded-lg overflow-hidden">
                          <div className="bg-[#F7F7F8] px-3 py-1.5 flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-900">Cargos de tarjeta vinculados</span>
                            <span className="text-xs text-slate-500">{drawerExpense.linkedCharges.length} cargo{drawerExpense.linkedCharges.length !== 1 ? "s" : ""}</span>
                          </div>
                          <div className="divide-y divide-slate-200 bg-white">
                            {drawerExpense.linkedCharges.map((charge, ci) => (
                              <div key={ci} className="flex items-center justify-between px-3 py-2">
                                <span className="text-xs text-slate-500">{charge.date || "—"}</span>
                                <span className="text-xs tabular-nums font-medium text-slate-800">{fmt(charge.amount)} €</span>
                              </div>
                            ))}
                          </div>
                          <div className="bg-[#F7F7F8] px-3 py-1.5 flex items-center justify-between border-t border-slate-200">
                            <span className="text-xs font-medium text-slate-700">Total cargos</span>
                            <span className="text-xs tabular-nums font-semibold text-slate-900">
                              {fmt(drawerExpense.linkedCharges.reduce((s, c) => s + (c.amount || 0), 0))} €
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Form fields */}
                  <div className="px-5 mt-4 space-y-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Datos del gasto</p>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
                        <input type="text" value={drawerForm.supplier}
                          onChange={e => setDrawerForm(f => ({ ...f, supplier: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">CIF / NIF</label>
                        <input type="text" value={drawerForm.supplierTaxId}
                          onChange={e => setDrawerForm(f => ({ ...f, supplierTaxId: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] tabular-nums focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Nº Factura</label>
                        <input type="text" value={drawerForm.supplierNumber}
                          onChange={e => setDrawerForm(f => ({ ...f, supplierNumber: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                        <input type="text" value={drawerForm.date} placeholder="DD/MM/YYYY"
                          onChange={e => setDrawerForm(f => ({ ...f, date: e.target.value }))}
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Descripción del gasto</label>
                      <input type="text" value={drawerForm.description}
                        onChange={e => setDrawerForm(f => ({ ...f, description: e.target.value }))}
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                    </div>

                    {/* Líneas */}
                    <div className="bg-slate-50 rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Líneas ({drawerItems.length})</span>
                        <button type="button"
                          onClick={() => setDrawerItems(prev => [...prev, { id: crypto.randomUUID(), subAccountCode: "", subAccountDescription: "", description: "", baseAmount: 0, vatRate: 21 }])}
                          className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900 font-medium">
                          <Plus size={12} /> Añadir línea
                        </button>
                      </div>
                      {drawerItems.map((item, idx) => {
                        const accountMissing = item.subAccountCode && !subAccounts.some(sa => sa.code === item.subAccountCode);
                        return (
                          <div key={item.id} className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-400 font-medium">Línea {idx + 1}</span>
                              {drawerItems.length > 1 && (
                                <button aria-label="Eliminar" type="button"
                                  onClick={() => setDrawerItems(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            <div className="relative">
                              <button type="button"
                                onClick={() => { setDrawerAccountSelectorItemIdx(drawerAccountSelectorItemIdx === idx ? null : idx); setDrawerAccountSearch(""); }}
                                className={`w-full px-3 py-2 border rounded-lg text-xs text-left flex items-center justify-between hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 ${accountMissing ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
                                {item.subAccountCode
                                  ? <span className={`font-mono ${accountMissing ? "text-red-600" : "text-slate-700"}`}>
                                      {item.subAccountCode}
                                      {accountMissing
                                        ? <span className="ml-2 font-sans text-red-500 font-medium">· La cuenta no existe</span>
                                        : <span className="ml-2 font-sans text-slate-400">{item.subAccountDescription}</span>}
                                    </span>
                                  : <span className="text-slate-400">Seleccionar cuenta</span>}
                                <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                              </button>
                              {drawerAccountSelectorItemIdx === idx && (
                                <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-xl" match="width">
                                  <div className="p-2 border-b border-slate-100">
                                    <input type="text" value={drawerAccountSearch}
                                      onChange={e => setDrawerAccountSearch(e.target.value)}
                                      placeholder="Buscar cuenta"
                                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900"
                                      autoFocus />
                                  </div>
                                  <div className="max-h-48 overflow-y-auto">
                                    {subAccounts
                                      .filter(sa => !drawerAccountSearch || sa.code.toLowerCase().includes(drawerAccountSearch.toLowerCase()) || sa.description.toLowerCase().includes(drawerAccountSearch.toLowerCase()))
                                      .slice(0, 40)
                                      .map(sa => (
                                        <button key={sa.id} type="button"
                                          onClick={() => {
                                            setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, subAccountCode: sa.code, subAccountDescription: sa.description } : it));
                                            setDrawerAccountSelectorItemIdx(null);
                                          }}
                                          className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                                          <span className="font-mono text-xs text-slate-500 w-16 flex-shrink-0">{sa.code}</span>
                                          <span className="text-xs text-slate-700 truncate">{sa.description}</span>
                                        </button>
                                      ))}
                                  </div>
                                </AnchoredPanel>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Base *</label>
                                <input type="number" step="0.01" value={item.baseAmount || ""}
                                  onChange={e => setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, baseAmount: parseFloat(e.target.value) || 0 } : it))}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900" />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">IVA %</label>
                                <input type="number" step="1" value={item.vatRate}
                                  onChange={e => setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, vatRate: parseFloat(e.target.value) || 0 } : it))}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900" />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Cuota IVA</label>
                                <div className="px-2 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs tabular-nums text-slate-500">
                                  {fmt(Math.round((item.baseAmount || 0) * (item.vatRate || 0) / 100 * 100) / 100)} €
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between pt-1 px-1">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-slate-500">IRPF %</label>
                          <input type="number" step="1" value={drawerForm.irpfRate}
                            onChange={e => setDrawerForm(f => ({ ...f, irpfRate: e.target.value }))}
                            className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900 bg-white" />
                        </div>
                        <div className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs">
                          <span className="text-slate-400">Total:</span>
                          <span className="ml-1.5 tabular-nums font-semibold">
                            {fmt(Math.round((
                              drawerItems.reduce((s, it) => s + (it.baseAmount || 0), 0) +
                              drawerItems.reduce((s, it) => s + Math.round((it.baseAmount || 0) * (it.vatRate || 0) / 100 * 100) / 100, 0) -
                              Math.round(drawerItems.reduce((s, it) => s + (it.baseAmount || 0), 0) * (parseFloat(drawerForm.irpfRate) || 0) / 100 * 100) / 100
                            ) * 100) / 100)} €
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Incidencias section */}
                  <div className="px-5 mt-5 pb-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Incidencia</p>

                    <div className="grid grid-cols-2 gap-2">
                      {(Object.entries(CONFLICT_CONFIG) as [ConflictType, typeof CONFLICT_CONFIG[ConflictType]][]).map(([key, cfg]) => {
                        const icons: Record<string, React.ReactNode> = {
                          diff:    <Info size={13} />,
                          merge:   <SplitSquareHorizontal size={13} />,
                          split:   <Scissors size={13} />,
                          missing: <FileX size={13} />,
                        };
                        const selected = drawerForm.conflictType === key;
                        return (
                          <button key={key} type="button"
                            onClick={() => setDrawerForm(f => ({ ...f, conflictType: selected ? "" : key as ConflictType }))}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors ${selected ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}>
                            <span className={selected ? "text-amber-500" : "text-slate-400"}>{icons[cfg.icon]}</span>
                            <span>{cfg.label}</span>
                            {!cfg.resolvable && (
                              <span className="ml-auto text-[10px] text-slate-300">cuadre</span>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {drawerForm.conflictType && (
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Nota explicativa</label>
                        <textarea value={drawerForm.conflictNote}
                          onChange={e => setDrawerForm(f => ({ ...f, conflictNote: e.target.value }))}
                          rows={2} placeholder="Explica la incidencia"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 resize-none" />
                      </div>
                    )}

                    {/* Linked charges mini-table for invoice_covers_multiple */}
                    {drawerForm.conflictType === "invoice_covers_multiple" && (
                      <div className="bg-[#F7F7F8] border border-slate-200 rounded-md p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-900">Cargos de tarjeta que cubre esta factura</p>
                          <button type="button"
                            onClick={() => setDrawerLinkedCharges(prev => [...prev, { amount: 0, date: "" }])}
                            className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900 font-medium">
                            <Plus size={12} /> Añadir cargo
                          </button>
                        </div>
                        {drawerLinkedCharges.length === 0 && (
                          <p className="text-xs text-slate-400 text-center py-2">Sin cargos anotados aún</p>
                        )}
                        <div className="space-y-2">
                          {drawerLinkedCharges.map((charge, ci) => (
                            <div key={ci} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2">
                              <div className="flex-1">
                                <input
                                  type="text"
                                  value={charge.date}
                                  onChange={e => setDrawerLinkedCharges(prev => prev.map((c, i) => i === ci ? { ...c, date: e.target.value } : c))}
                                  placeholder="DD/MM/YYYY"
                                  className="w-full text-xs border-0 focus:outline-none bg-transparent text-slate-600 placeholder-slate-300"
                                />
                              </div>
                              <div className="w-28">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={charge.amount || ""}
                                    onChange={e => setDrawerLinkedCharges(prev => prev.map((c, i) => i === ci ? { ...c, amount: parseFloat(e.target.value) || 0 } : c))}
                                    placeholder="0.00"
                                    className="w-full text-xs tabular-nums border-0 focus:outline-none bg-transparent text-right text-slate-900 placeholder-slate-300"
                                  />
                                  <span className="text-xs text-slate-400">€</span>
                                </div>
                              </div>
                              <button aria-label="Cerrar" type="button"
                                onClick={() => setDrawerLinkedCharges(prev => prev.filter((_, i) => i !== ci))}
                                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                        </div>
                        {drawerLinkedCharges.length > 0 && (
                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
                            <span className="text-xs text-slate-500">Total cargos</span>
                            <span className="text-xs tabular-nums font-semibold text-slate-900">
                              {fmt(drawerLinkedCharges.reduce((s, c) => s + (c.amount || 0), 0))} €
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {drawerExpense.conflictResolvedAt && !drawerExpense.conflictType && (
                      <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg text-xs text-emerald-700">
                        <Check size={12} className="text-emerald-500" />
                        Incidencia resuelta por {drawerExpense.conflictResolvedByName} · {fmtDate(drawerExpense.conflictResolvedAt)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Drawer footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
                  <div className="flex items-center gap-1">
                    {drawerExpense.documentUrl && (
                      <a href={drawerExpense.documentUrl} target="_blank" rel="noopener noreferrer"
                        title="Abrir documento en nueva pestaña"
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-[#F4F4F5] rounded-lg transition-colors">
                        <ExternalLink size={15} />
                      </a>
                    )}
                    {drawerExpense.pleoUrl && (
                      <a href={drawerExpense.pleoUrl} target="_blank" rel="noopener noreferrer"
                        title="Ver en Pleo"
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors text-xs font-medium flex items-center gap-1">
                        <ExternalLink size={15} /> Pleo
                      </a>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={closeDrawer}
                      className="px-3 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                      Cancelar
                    </button>
                    <button onClick={handleSaveDrawer} disabled={drawerSaving}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-lg disabled:opacity-50 transition-colors">
                      {drawerSaving ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Right side: document preview ── */}
              {drawerShowPreview && drawerExpense.documentUrl && (
                <div className="flex-1 border-l border-slate-200 flex flex-col bg-slate-50">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                    <p className="text-xs font-semibold text-slate-600">Documento</p>
                    <div className="flex items-center gap-2">
                      <a href={drawerExpense.documentUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                        <Maximize2 size={12} /> Abrir
                      </a>
                      <button aria-label="Cerrar" onClick={() => setDrawerShowPreview(false)}
                        className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden p-2">
                    {docType === "pdf" ? (
                      <iframe
                        src={drawerExpense.documentUrl}
                        className="w-full h-full rounded-lg border border-slate-200"
                        title="Documento del gasto"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center overflow-auto">
                        <img
                          src={drawerExpense.documentUrl}
                          alt="Documento del gasto"
                          className="max-w-full max-h-full object-contain rounded-lg shadow"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* MODALS                                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {/* Create Box Modal */}
            <Modal
        open={!!(showCreateBoxModal)}
        onClose={() => setShowCreateBoxModal(false)}
        title={"Nueva caja"}
        width="max-w-md"
        footer={(showCreateBoxModal) ? <>
<button onClick={() => setShowCreateBoxModal(false)} className={buttonClass("ghost")}>Cancelar</button>
              <button onClick={handleCreateBox}
                disabled={saving || !boxForm.name.trim() || !boxForm.code.trim() || boxes.some(b => b.code.toUpperCase() === boxForm.code.toUpperCase())}
                className={buttonClass("primary")}>
                {saving ? "Creando..." : "Crear caja"}
              </button>
        </> : undefined}
        >
        {(showCreateBoxModal) && (
          <>
<div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre del responsable *</label>
                <input type="text" value={boxForm.name}
                  onChange={e => { const name = e.target.value; setBoxForm({ ...boxForm, name, code: boxForm.code || generateCode(name) }); }}
                  placeholder="Nombre del titular"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Código *</label>
                {(() => {
                  const isDuplicate = boxForm.code.trim().length > 0 && boxes.some(b => b.code.toUpperCase() === boxForm.code.toUpperCase());
                  return (
                    <>
                      <input type="text" value={boxForm.code}
                        onChange={e => setBoxForm({ ...boxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                        placeholder="LG" maxLength={3}
                        className={`w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 tabular-nums uppercase transition-colors ${isDuplicate ? "border-red-400 bg-red-50 focus:ring-red-400" : "border-slate-200 focus:ring-slate-900/10 focus:border-slate-900"} text-[13px]`} />
                      {isDuplicate && (
                        <p className="flex items-center gap-1.5 mt-1.5 text-xs text-red-600 font-medium">
                          <AlertCircle size={12} />
                          Este código ya está en uso — no se pueden repetir siglas
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
              <div ref={departmentDropdownRef} className="relative">
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Departamento</label>
                <button type="button" onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
                  className="w-full px-4 py-1.5 border border-slate-200 rounded-md text-left flex items-center justify-between text-[13px]">
                  <span className={boxForm.department ? "text-slate-900" : "text-slate-400"}>{boxForm.department || "Seleccionar"}</span>
                  <ChevronDown size={16} className="text-slate-400" />
                </button>
                {showDepartmentDropdown && (
                  <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                    <button type="button" onClick={() => { setBoxForm({ ...boxForm, department: "" }); setShowDepartmentDropdown(false); }}
                      className="w-full px-4 py-2 text-left text-[13px] text-slate-400 hover:bg-slate-50">Sin departamento</button>
                    {departments.map(d => (
                      <button key={d} type="button" onClick={() => { setBoxForm({ ...boxForm, department: d }); setShowDepartmentDropdown(false); }}
                        className="w-full px-4 py-2 text-left text-[13px] hover:bg-slate-50">{d}</button>
                    ))}
                  </AnchoredPanel>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Edit Box Modal */}
            <Modal
        open={!!(showEditBoxModal && selectedBox)}
        onClose={() => setShowEditBoxModal(false)}
        title={"Editar caja"}
        width="max-w-md"
        footer={(showEditBoxModal && selectedBox) ? <>
<button onClick={() => setShowEditBoxModal(false)} className={buttonClass("ghost")}>Cancelar</button>
              <button onClick={handleEditBox} disabled={saving || !editBoxForm.name.trim() || !editBoxForm.code.trim() || boxes.some(b => b.id !== selectedBox.id && b.code.toUpperCase() === editBoxForm.code.toUpperCase())}
                className={buttonClass("primary")}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
        </> : undefined}
        >
        {(showEditBoxModal && selectedBox) && (
          <>
<div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre *</label>
                <input type="text" value={editBoxForm.name}
                  onChange={e => setEditBoxForm({ ...editBoxForm, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Código *</label>
                {(() => {
                  const isDuplicate = editBoxForm.code.trim().length > 0 &&
                    boxes.some(b => b.id !== selectedBox.id && b.code.toUpperCase() === editBoxForm.code.toUpperCase());
                  return (
                    <>
                      <input type="text" value={editBoxForm.code}
                        onChange={e => setEditBoxForm({ ...editBoxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                        maxLength={3}
                        className={`w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 tabular-nums uppercase transition-colors ${isDuplicate ? "border-red-400 bg-red-50 focus:ring-red-400" : "border-slate-200 focus:ring-slate-900/10 focus:border-slate-900"} text-[13px]`} />
                      {isDuplicate && (
                        <p className="flex items-center gap-1.5 mt-1.5 text-xs text-red-600 font-medium">
                          <AlertCircle size={12} />
                          Este código ya está en uso — no se pueden repetir siglas
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Delete Box Confirm */}
            <Modal
        open={!!(showDeleteBoxModal && selectedBox)}
        onClose={() => setShowDeleteBoxModal(false)}
        title={"Eliminar caja"}
        width="max-w-sm"
        footer={(showDeleteBoxModal && selectedBox) ? <>
<button onClick={() => setShowDeleteBoxModal(false)} className={buttonClass("secondary")}>Cancelar</button>
                <button onClick={handleDeleteBox} disabled={saving} className={buttonClass("danger")}>
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
        </> : undefined}
        >
        {(showDeleteBoxModal && selectedBox) && (
          <>
<p className="text-[13px] text-slate-600">Se eliminará <strong>{selectedBox.name}</strong> y todos sus sobres y gastos pendientes.</p>
          </>
        )}
      </Modal>

      {/* Create Envelope Modal */}
            <Modal
        open={!!(showCreateEnvelopeModal && selectedBox)}
        onClose={() => setShowCreateEnvelopeModal(false)}
        title={"Nuevo sobre"}
        width="max-w-md"
        footer={(showCreateEnvelopeModal && selectedBox) ? <>
<button onClick={() => setShowCreateEnvelopeModal(false)} className={buttonClass("ghost")}>Cancelar</button>
              <button onClick={handleCreateEnvelope} disabled={saving} className={buttonClass("primary")}>
                {saving ? "Creando..." : "Crear sobre"}
              </button>
        </> : undefined}
        >
        {(showCreateEnvelopeModal && selectedBox) && (
          <>
<div className="">
              <p className="text-slate-900 font-medium mb-1">BOX-{selectedBox.code}{String(selectedBox.nextEnvelopeNumber || 1).padStart(3, "0")}</p>
              <p className="text-[13px] text-slate-500">Se creará un nuevo sobre para {selectedBox.name}</p>
            </div>
          </>
        )}
      </Modal>

      {/* Delete Envelope Confirm */}
            <Modal
        open={!!(showDeleteEnvelopeModal)}
        onClose={() => setShowDeleteEnvelopeModal(null)}
        title={"Eliminar sobre"}
        width="max-w-sm"
        footer={(showDeleteEnvelopeModal) ? <>
<button onClick={() => setShowDeleteEnvelopeModal(null)} className={buttonClass("secondary")}>Cancelar</button>
                <button onClick={() => handleDeleteEnvelope(showDeleteEnvelopeModal)} disabled={saving} className={buttonClass("danger")}>
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
        </> : undefined}
        >
        {(showDeleteEnvelopeModal) && (
          <>
<p className="text-[13px] text-slate-600">Se eliminará <strong>{showDeleteEnvelopeModal.displayNumber}</strong> y todos sus gastos.</p>
          </>
        )}
      </Modal>

      {/* Manual Expense Modal */}
            <Modal
        open={!!(showManualExpenseModal && selectedEnvelope)}
        onClose={() => setShowManualExpenseModal(false)}
        title={"Añadir gastos"}
        width="max-w-5xl"
        footer={(showManualExpenseModal && selectedEnvelope) ? <>
<p className="text-[13px] text-slate-500">
                {cardExpensesList.length > 0 && <>Total: <strong className="text-slate-900 tabular-nums">{fmt(cardExpensesList.reduce((s, e) => s + computeExpenseTotal(e).totalAmount, 0))} €</strong></>}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowManualExpenseModal(false)} className="px-4 py-2 text-slate-600 rounded-md text-[13px] font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={handleAddManualExpense} disabled={manualExpenseSaving}
                  className={buttonClass("primary")}>
                  {manualExpenseSaving ? "Guardando..." : <><Check size={15} /> Guardar gastos</>}
                </button>
              </div>
        </> : undefined}
        >
        {(showManualExpenseModal && selectedEnvelope) && (
          <>
            <p className="-mt-1 mb-3 text-[13px] text-slate-500">{selectedEnvelope.displayNumber} · {selectedBox?.name}</p>
<div className="flex-1 overflow-y-auto space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gastos ({cardExpensesList.length})</p>
                  <button onClick={() => setCardExpensesList(prev => [...prev, createEmptyCardExpense()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
                    <Plus size={14} /> Nuevo gasto
                  </button>
                </div>
                <div className="space-y-4">
                  {cardExpensesList.map((exp, idx) => (
                    <div key={exp.id} className="p-4 border border-slate-200 rounded-md space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gasto {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {exp.file && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                              <Paperclip size={12} /> {exp.file.name.length > 20 ? exp.file.name.substring(0, 20) + "…" : exp.file.name}
                            </span>
                          )}
                          {cardExpensesList.length > 1 && (
                            <button aria-label="Eliminar" onClick={() => removeCardExpense(idx)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-2 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                          <button type="button" onClick={(e) => {
                            if (showCardTypeDropdown === idx) { setShowCardTypeDropdown(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            setCardTypeDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                            setShowCardTypeDropdown(idx);
                          }}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] flex items-center justify-between hover:border-slate-300">
                            <span className="flex items-center gap-1.5">
                              {exp.type === "ticket" ? <><Receipt size={13} className="text-amber-500" /> Ticket</> : <><FileText size={13} className="text-slate-500" /> Factura</>}
                            </span>
                            <ChevronDown size={13} className="text-slate-400" />
                          </button>
                          {showCardTypeDropdown === idx && cardTypeDropdownPos && (
                            <div className="fixed z-50 bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden"
                              style={{ top: cardTypeDropdownPos.top, left: cardTypeDropdownPos.left, width: cardTypeDropdownPos.width }}>
                              <button type="button" onClick={() => { updateCardExpense(idx, "type", "ticket"); setShowCardTypeDropdown(null); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center gap-2"><Receipt size={13} className="text-amber-500" /> Ticket</button>
                              <button type="button" onClick={() => { updateCardExpense(idx, "type", "invoice"); setShowCardTypeDropdown(null); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center gap-2"><FileText size={13} className="text-slate-500" /> Factura</button>
                            </div>
                          )}
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                          <input type="text" value={exp.date} onChange={e => updateCardExpense(idx, "date", e.target.value)} placeholder="DD/MM/YYYY"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                          <input type="text" value={exp.supplier} onChange={e => updateCardExpense(idx, "supplier", e.target.value)} placeholder="Nombre del proveedor"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">CIF / NIF {exp.type === "invoice" && <span className="text-red-400">*</span>}</label>
                          <input type="text" value={exp.supplierTaxId} onChange={e => updateCardExpense(idx, "supplierTaxId", e.target.value)} placeholder="B12345678"
                            className={`w-full px-2.5 py-1.5 border rounded-lg text-[13px] font-mono focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 ${exp.type === "invoice" && !exp.supplierTaxId.trim() ? "border-red-300 bg-red-50/30" : "border-slate-200"}`} />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">{exp.type === "invoice" ? "Nº Factura" : "Referencia"}</label>
                          <input type="text" value={exp.supplierNumber} onChange={e => updateCardExpense(idx, "supplierNumber", e.target.value)}
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-600 mb-1">IRPF %</label>
                          <input type="number" value={exp.irpfRate} onChange={e => updateCardExpense(idx, "irpfRate", parseFloat(e.target.value) || 0)} step="1"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] tabular-nums focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-12">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Descripción del gasto</label>
                          <input type="text" value={(exp as any).description ?? ""} onChange={e => updateCardExpense(idx, "description", e.target.value)} placeholder="Concepto del gasto"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-12">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Documento</label>
                          <label className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-[13px] flex items-center justify-center gap-2 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                            <Upload size={14} className="text-slate-400" />
                            <span className="text-slate-500">{exp.file ? "Cambiar" : "Subir"}</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                              onChange={e => { if (e.target.files?.[0]) updateCardExpense(idx, "file", e.target.files[0]); }} />
                          </label>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500">Líneas de detalle ({exp.items.length})</span>
                          <button onClick={() => addCardItem(idx)} className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"><Plus size={12} /> Añadir línea</button>
                        </div>
                        <div className="space-y-2">
                          {exp.items.map((item, itemIdx) => (
                            <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-6">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Cuenta *</label>}
                                <button type="button"
                                  onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setCardAccountSelectorPos({ top: rect.bottom + 4, left: rect.left });
                                    setEditingCardExpenseIndex(idx * 1000 + itemIdx);
                                    setShowCardAccountSelector(true);
                                    setCardAccountSearch("");
                                  }}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-left text-xs flex items-center justify-between hover:border-slate-300 bg-white">
                                  {item.subAccountCode ? <span className="font-mono text-slate-700 truncate">{item.subAccountCode}</span> : <span className="text-slate-400">Cuenta</span>}
                                  <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                                </button>
                              </div>
                              <div className="col-span-3">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Base *</label>}
                                <input type="number" value={item.baseAmount || ""} onChange={e => updateCardItem(idx, itemIdx, "baseAmount", parseFloat(e.target.value) || 0)} step="0.01"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs tabular-nums focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                              </div>
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">IVA %</label>}
                                <input type="number" value={item.vatRate} onChange={e => updateCardItem(idx, itemIdx, "vatRate", parseFloat(e.target.value) || 0)} step="1"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs tabular-nums focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                              </div>
                              <div className="col-span-1 flex justify-center">
                                {exp.items.length > 1 && (
                                  <button aria-label="Eliminar" onClick={() => removeCardItem(idx, itemIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={12} /></button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <div className="bg-slate-900 text-white px-4 py-2 rounded-lg text-[13px]">
                          <span className="text-slate-400">Total gasto:</span>
                          <span className="ml-2 tabular-nums font-semibold">{fmt(computeExpenseTotal(exp).totalAmount)} €</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Import Excel Modal */}
            <Modal
        open={!!(showImportModal && selectedEnvelope)}
        onClose={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}
        title={"Importar gastos"}
        width="max-w-3xl"
        footer={(showImportModal && selectedEnvelope) ? <>
<span className="text-[13px] text-slate-500">
                {importPreview.length > 0 && (() => {
                  const dupCount = importPreview.filter(exp => {
                    if (expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId)) return true;
                    if (exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber)
                      return expenses.some(e => e.type === "invoice" && e.supplierTaxId === exp.supplierTaxId && e.supplierNumber === exp.supplierNumber);
                    return false;
                  }).length;
                  const newCount = importPreview.length - dupCount;
                  return <><strong className="text-slate-900">{newCount}</strong> nuevos{dupCount > 0 && <> · <strong className="text-amber-600">{dupCount} duplicado{dupCount > 1 ? "s" : ""}</strong> (se omitirán)</>}</>;
                })()}
              </span>
              <div className="flex gap-3">
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }} className="px-4 py-2 text-slate-600 rounded-md text-[13px] font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={handleImportExpenses} disabled={importing || importPreview.length === 0}
                  className={buttonClass("primary")}>
                  {importing ? "Importando..." : `Importar ${importPreview.length - importPreview.filter(exp => expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId)).length} gastos`}
                </button>
              </div>
        </> : undefined}
        >
        {(showImportModal && selectedEnvelope) && (
          <>
            <p className="-mt-1 mb-3 text-[13px] text-slate-500">Sube el Excel de gastos de tarjeta</p>
<div className="flex-1 overflow-y-auto">
              {!importFile ? (
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".xlsx")) handleFileSelect(f); }}
                  className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${isDragging ? "border-slate-400 bg-[#F7F7F8]" : "border-slate-200"}`}>
                  <Upload size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 mb-2">Arrastra el archivo Excel aquí</p>
                  <p className="text-[13px] text-slate-400 mb-4">o</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-md text-[13px] font-medium cursor-pointer">
                    <FileSpreadsheet size={16} /> Seleccionar archivo
                    <input type="file" accept=".xlsx" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} className="hidden" />
                  </label>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md mb-4">
                    <FileSpreadsheet size={20} className="text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-slate-900">{importFile.name}</p>
                      <p className="text-xs text-slate-500">{importPreview.length} gastos detectados</p>
                    </div>
                    <button aria-label="Cerrar" onClick={() => { setImportFile(null); setImportPreview([]); }} className="p-1.5 text-slate-400 hover:bg-slate-200 rounded"><X size={16} /></button>
                  </div>
                  {importPreview.length > 0 && (
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                      <table className="tbl w-full text-[13px]">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600 w-[80px]">Tipo</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Proveedor</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Cuenta · IVA</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600 w-[90px]">Base</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600 w-[90px]">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importPreview.slice(0, 15).map((exp, i) => {
                            const dupById  = expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId);
                            const invKey   = exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber ? `${exp.supplierTaxId}||${exp.supplierNumber}` : null;
                            const dupByInv = !!invKey && expenses.some(e => e.type === "invoice" && e.supplierTaxId === exp.supplierTaxId && e.supplierNumber === exp.supplierNumber);
                            const isDup    = dupById || dupByInv;
                            const dupReason = dupById ? "ID Pleo ya importado" : dupByInv ? "Factura ya existe (mismo CIF + Nº)" : "";
                            const knownSupplier = cardSuppliers.find(s => s.taxId === exp.supplierTaxId);
                            const displaySupplier = knownSupplier ? knownSupplier.name : capitalizeSupplierName(exp.supplier);
                            return (
                              <tr key={i} className={`align-top ${isDup ? "bg-amber-50/60" : "hover:bg-slate-50"}`}>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-1.5">
                                    {isDup && <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />}
                                    {exp.type === "ticket" ? <Receipt size={13} className="text-amber-500 flex-shrink-0" /> : <FileText size={13} className="text-slate-500 flex-shrink-0" />}
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${exp.type === "ticket" ? "bg-amber-100 text-amber-700" : "bg-[#F1F1F3] text-slate-900"}`}>{exp.type === "ticket" ? "Ticket" : "Factura"}</span>
                                  </div>
                                  <p className="text-xs text-slate-400 mt-1">{exp.date}</p>
                                  {isDup && <p className="text-xs text-amber-600 font-medium mt-0.5">{dupReason} — se omitirá</p>}
                                </td>
                                <td className="px-3 py-2.5">
                                  <p className={`font-medium truncate max-w-[200px] ${isDup ? "text-slate-400 line-through" : "text-slate-900"}`}>{displaySupplier}</p>
                                  {exp.supplierTaxId && <p className="text-xs font-mono text-slate-400">{exp.supplierTaxId}</p>}
                                </td>
                                <td className="px-3 py-2.5">
                                  {exp.items.map((item: any, j: number) => (
                                    <div key={j} className={`flex items-center gap-2 ${j > 0 ? "mt-0.5" : ""}`}>
                                      <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                        {item.subAccountCode || exp.subAccountCode || "—"}
                                      </span>
                                      <span className="text-xs text-slate-500">{item.vatRate}% · {fmt(item.vatAmount)} €</span>
                                    </div>
                                  ))}
                                </td>
                                <td className={`px-3 py-2.5 text-right tabular-nums ${isDup ? "text-slate-400" : "text-slate-700"}`}>{fmt(exp.baseAmount)}</td>
                                <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${isDup ? "text-slate-400" : "text-slate-900"}`}>{fmt(exp.totalAmount)} €</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200">
                          <tr>
                            <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">TOTAL</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-700">{fmt(importPreview.reduce((s: number, e: any) => s + e.baseAmount, 0))}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-900">{fmt(importPreview.reduce((s: number, e: any) => s + e.totalAmount, 0))} €</td>
                          </tr>
                        </tfoot>
                      </table>
                      {importPreview.length > 15 && (
                        <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500 text-center border-t border-slate-100">
                          +{importPreview.length - 15} gastos más no mostrados
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* Receipt Import Modal */}
      {showReceiptImportModal && selectedEnvelope && (() => {
        const envelopeExps = expenses.filter(e => e.envelopeId === selectedEnvelope.id);
        const fileMatches = receiptFiles.map(file => {
          const nameNoExt = file.name.replace(/\.[^.]+$/, "");
          const expense = envelopeExps.find(e => e.pleoReceiptId && nameNoExt.includes(String(e.pleoReceiptId)));
          return { file, expense: expense ?? null };
        });
        const matched   = fileMatches.filter(m => m.expense).length;
        const unmatched = fileMatches.filter(m => !m.expense).length;
        const coveredIds = new Set(fileMatches.filter(m => m.expense).map(m => m.expense!.id));
        const missingDocs = envelopeExps.filter(e => !e.documentUrl && !coveredIds.has(e.id));
        return (
          <Modal open onClose={() => { setShowReceiptImportModal(false); setReceiptFiles([]); }} title={"Importar recibos"} width="max-w-xl" footer={<>
<p className="text-xs text-slate-400">{envelopeExps.filter(e => !e.documentUrl).length} gastos sin documento</p>
                <div className="flex gap-3">
                  <button onClick={() => { setShowReceiptImportModal(false); setReceiptFiles([]); }} className={buttonClass("ghost")}>Cancelar</button>
                  <button onClick={handleImportReceipts} disabled={uploadingReceipts || matched === 0}
                    className={buttonClass("primary")}>
                    {uploadingReceipts ? <><RotateCcw size={14} className="animate-spin" /> Subiendo...</> : <><Upload size={14} /> Vincular {matched} recibo{matched !== 1 ? "s" : ""}</>}
                  </button>
                </div>
</>}>
<p className="-mt-1 mb-3 text-[13px] text-slate-500">Los archivos se emparejan por el ID Pleo en el nombre</p>
<div className="flex-1 overflow-y-auto space-y-4">
                <label className={`flex flex-col items-center justify-center gap-2 w-full py-8 border-2 border-dashed rounded-md cursor-pointer transition-colors ${receiptFiles.length > 0 ? "border-slate-200 bg-[#F7F7F8]" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"}`}>
                  <FileText size={28} className={receiptFiles.length > 0 ? "text-slate-400" : "text-slate-300"} />
                  <div className="text-center">
                    <p className="text-[13px] font-medium text-slate-700">{receiptFiles.length > 0 ? `${receiptFiles.length} archivo${receiptFiles.length > 1 ? "s" : ""} seleccionado${receiptFiles.length > 1 ? "s" : ""}` : "Selecciona facturas y tickets"}</p>
                    <p className="text-xs text-slate-400 mt-0.5">PDF, JPG, PNG · varios archivos a la vez</p>
                  </div>
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                    onChange={e => setReceiptFiles(Array.from(e.target.files ?? []))} />
                </label>
                {receiptFiles.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full text-xs font-medium text-emerald-700">
                        <Check size={12} /> {matched} emparejado{matched !== 1 ? "s" : ""}
                      </span>
                      {unmatched > 0 && (
                        <span className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-xs font-medium text-amber-700">
                          <AlertTriangle size={12} /> {unmatched} sin emparejar
                        </span>
                      )}
                    </div>
                    <div className="border border-slate-200 rounded-md overflow-hidden divide-y divide-slate-100">
                      {fileMatches.map(({ file, expense: exp }, i) => (
                        <div key={i} className={`flex items-center gap-3 px-4 py-2.5 ${exp ? "" : "bg-amber-50/40"}`}>
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${exp ? "bg-emerald-50" : "bg-amber-50"}`}>
                            {exp ? <Check size={13} className="text-emerald-500" /> : <AlertTriangle size={13} className="text-amber-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs tabular-nums text-slate-700 truncate">{file.name}</p>
                            {exp ? <p className="text-xs text-emerald-600 mt-0.5">{exp.displayNumber} · {exp.supplier}</p>
                              : <p className="text-xs text-amber-500 mt-0.5">No se encontró ningún gasto con este ID</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
</Modal>
        );
      })()}

      {/* Create Transfer Envelope Modal */}
            <Modal
        open={!!(showCreateTransferEnvelopeModal)}
        onClose={() => setShowCreateTransferEnvelopeModal(false)}
        title={"Nuevo sobre de transferencias"}
        width="max-w-lg"
        footer={(showCreateTransferEnvelopeModal) ? <>
<button onClick={() => setShowCreateTransferEnvelopeModal(false)} className={buttonClass("ghost")}>Cancelar</button>
              <button onClick={handleCreateTransferEnvelope} disabled={saving || !transferEnvelopeForm.personName.trim()}
                className={buttonClass("primary")}>
                {saving ? "Creando..." : "Crear sobre"}
              </button>
        </> : undefined}
        >
        {(showCreateTransferEnvelopeModal) && (
          <>
<div className="flex-1 space-y-5 overflow-visible">
              <div className="p-3 bg-slate-50 rounded-md text-center">
                <p className="text-slate-900 font-medium">PC-{String(nextTransferNumber).padStart(3, "0")}</p>
              </div>

              {/* Persona */}
              <div className="p-4 bg-slate-50 rounded-md space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Persona</p>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre *</label>
                  <input type="text" value={transferEnvelopeForm.personName}
                    onChange={e => setTransferEnvelopeForm({ ...transferEnvelopeForm, personName: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white text-[13px]" />
                </div>
                <div ref={expenseDepartmentDropdownRef} className="relative">
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Departamento</label>
                  <button type="button" onClick={() => setShowExpenseDepartmentDropdown(!showExpenseDepartmentDropdown)}
                    className="w-full px-4 py-1.5 border border-slate-200 rounded-md text-left flex items-center justify-between bg-white hover:border-slate-300 text-[13px]">
                    <span className={transferEnvelopeForm.personDepartment ? "text-slate-900" : "text-slate-400"}>{transferEnvelopeForm.personDepartment || "Seleccionar"}</span>
                    <ChevronDown size={16} className="text-slate-400" />
                  </button>
                  {showExpenseDepartmentDropdown && (
                    <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                      <button type="button" onClick={() => { setTransferEnvelopeForm({ ...transferEnvelopeForm, personDepartment: "" }); setShowExpenseDepartmentDropdown(false); }}
                        className="w-full px-4 py-2 text-left text-[13px] text-slate-400 hover:bg-slate-50">Sin departamento</button>
                      {departments.map(d => (
                        <button key={d} type="button" onClick={() => { setTransferEnvelopeForm({ ...transferEnvelopeForm, personDepartment: d }); setShowExpenseDepartmentDropdown(false); }}
                          className="w-full px-4 py-2 text-left text-[13px] hover:bg-slate-50">{d}</button>
                      ))}
                    </AnchoredPanel>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Notas</label>
                <textarea value={transferEnvelopeForm.notes}
                  onChange={e => setTransferEnvelopeForm({ ...transferEnvelopeForm, notes: e.target.value })}
                  rows={2} placeholder="Observaciones"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 resize-none text-[13px]" />
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Delete Transfer Envelope Confirm */}
            <Modal
        open={!!(showDeleteTransferEnvelopeModal)}
        onClose={() => setShowDeleteTransferEnvelopeModal(null)}
        title={"Eliminar sobre"}
        width="max-w-sm"
        footer={(showDeleteTransferEnvelopeModal) ? <>
<button onClick={() => setShowDeleteTransferEnvelopeModal(null)} className={buttonClass("secondary")}>Cancelar</button>
                <button onClick={() => handleDeleteTransferEnvelope(showDeleteTransferEnvelopeModal)} disabled={saving} className={buttonClass("danger")}>
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
        </> : undefined}
        >
        {(showDeleteTransferEnvelopeModal) && (
          <>
<p className="text-[13px] text-slate-600">Se eliminará <strong>{showDeleteTransferEnvelopeModal.displayNumber}</strong> y todos sus gastos.</p>
          </>
        )}
      </Modal>

      {/* Add Transfer Expense Modal */}
            <Modal
        open={!!(showAddExpenseModal && selectedTransferEnvelope)}
        onClose={() => setShowAddExpenseModal(false)}
        title={"Añadir gastos"}
        width="max-w-5xl"
        footer={(showAddExpenseModal && selectedTransferEnvelope) ? <>
<div className="text-[13px] text-slate-500">
                Total: <strong className="text-slate-900 tabular-nums">{fmt(expensesList.reduce((sum, exp) => sum + computeExpenseTotal(exp).totalAmount, 0))} €</strong>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowAddExpenseModal(false)} className={buttonClass("ghost")}>Cancelar</button>
                <button onClick={handleAddAllExpenses}
                  disabled={saving || expensesList.filter(e => e.supplier.trim() && e.items.some(item => item.baseAmount > 0 && item.subAccountCode)).length === 0}
                  className={buttonClass("primary")}>
                  {saving ? "Guardando..." : `Añadir ${expensesList.filter(e => e.supplier.trim() && e.items.some(item => item.baseAmount > 0 && item.subAccountCode)).length} gasto${expensesList.filter(e => e.supplier.trim() && e.items.some(item => item.baseAmount > 0 && item.subAccountCode)).length !== 1 ? "s" : ""}`}
                </button>
              </div>
        </> : undefined}
        >
        {(showAddExpenseModal && selectedTransferEnvelope) && (
          <>
            <p className="-mt-1 mb-3 text-[13px] text-slate-500">Contra el sobre de {selectedTransferEnvelope.personName}</p>
<div className="flex-1 overflow-y-auto space-y-6">
              {/* Gastos */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gastos ({expensesList.length})</p>
                  <button onClick={() => setExpensesList([...expensesList, createEmptyExpense()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
                    <Plus size={14} /> Nuevo gasto
                  </button>
                </div>
                <div className="space-y-4">
                  {expensesList.map((exp, idx) => (
                    <div key={exp.id} className="p-4 border border-slate-200 rounded-md space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gasto {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {exp.file && <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg"><Paperclip size={12} /> {exp.file.name.substring(0, 20)}...</span>}
                          {expensesList.length > 1 && <button aria-label="Eliminar" onClick={() => removeExpenseFromList(idx)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>}
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-3 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                          <button type="button" onClick={(e) => {
                            if (showTypeDropdown === idx) { setShowTypeDropdown(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTypeDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                            setShowTypeDropdown(idx);
                          }}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-left text-[13px] flex items-center justify-between hover:border-slate-300">
                            <span className="text-slate-900">{exp.type === "ticket" ? "Ticket" : "Factura"}</span>
                            <ChevronDown size={14} className="text-slate-400" />
                          </button>
                          {showTypeDropdown === idx && typeDropdownPos && (
                            <div className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1"
                              style={{ top: typeDropdownPos.top, left: typeDropdownPos.left, width: typeDropdownPos.width }}>
                              <button type="button" onClick={() => { updateExpenseInList(idx, "type", "ticket"); setShowTypeDropdown(null); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50">Ticket</button>
                              <button type="button" onClick={() => { updateExpenseInList(idx, "type", "invoice"); setShowTypeDropdown(null); }} className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50">Factura</button>
                            </div>
                          )}
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                          <input type="text" value={exp.date} onChange={e => updateExpenseInList(idx, "date", e.target.value)} placeholder="DD/MM/YYYY"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">IRPF %</label>
                          <input type="number" value={exp.irpfRate} onChange={e => updateExpenseInList(idx, "irpfRate", parseFloat(e.target.value) || 0)} step="1"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums" />
                        </div>
                        <div className="col-span-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Documento</label>
                          <label className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-[13px] flex items-center justify-center gap-2 cursor-pointer hover:border-slate-400 hover:bg-slate-50">
                            <Upload size={14} className="text-slate-400" />
                            <span className="text-slate-500">{exp.file ? "Cambiar" : "Subir"}</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                              onChange={e => { if (e.target.files?.[0]) updateExpenseInList(idx, "file", e.target.files[0]); }} />
                          </label>
                        </div>
                        <div className="col-span-8 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor (empresa de la factura/ticket) *</label>
                          <input type="text" value={exp.supplier}
                            onChange={e => { updateExpenseInList(idx, "supplier", e.target.value); setShowExpenseSupplierDropdown(idx); }}
                            onFocus={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setExpenseSupplierDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                              setShowExpenseSupplierDropdown(idx);
                            }}
                            placeholder="Nombre del proveedor"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                          {showExpenseSupplierDropdown === idx && expenseSupplierDropdownPos && (() => {
                            const filtered = cardSuppliers.filter(s =>
                              s.name.toLowerCase().includes(exp.supplier.toLowerCase()) || s.taxId.includes(exp.supplier)
                            );
                            if (filtered.length === 0) return null;
                            return (
                              <div className="fixed z-50 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-40 overflow-y-auto"
                                style={{ top: expenseSupplierDropdownPos.top, left: expenseSupplierDropdownPos.left, width: expenseSupplierDropdownPos.width }}>
                                {filtered.slice(0, 8).map(s => (
                                  <button key={s.taxId} type="button"
                                    onClick={() => {
                                      setExpensesList(prev => prev.map((e2, i2) => i2 === idx ? { ...e2, supplier: s.name, supplierTaxId: s.taxId } : e2));
                                      setShowExpenseSupplierDropdown(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between">
                                    <span className="text-slate-900">{s.name}</span>
                                    <span className="text-xs text-slate-400">{s.taxId}</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs font-medium text-slate-600 mb-1">CIF / NIF</label>
                          <input type="text" value={exp.supplierTaxId} onChange={e => updateExpenseInList(idx, "supplierTaxId", e.target.value)}
                            placeholder="B12345678"
                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                        </div>
                      </div>
                      <input type="text" value={(exp as any).description ?? ""} onChange={e => updateExpenseInList(idx, "description", e.target.value)} placeholder="Descripción del gasto"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                      <div className="bg-slate-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500">Líneas de detalle ({exp.items.length})</span>
                          <button onClick={() => addItemToExpense(idx)} className="flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"><Plus size={12} /> Añadir línea</button>
                        </div>
                        <div className="space-y-2">
                          {exp.items.map((item, itemIdx) => (
                            <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-6">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Cuenta *</label>}
                                <button type="button"
                                  onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setAccountSelectorPos({ top: rect.bottom + 4, left: rect.left });
                                    setEditingExpenseIndex(idx * 1000 + itemIdx);
                                    setShowAccountSelector(true);
                                    setAccountSearchTerm("");
                                  }}
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-left text-xs flex items-center justify-between hover:border-slate-300 bg-white">
                                  {item.subAccountCode ? <span className="font-mono text-slate-700 truncate">{item.subAccountCode}</span> : <span className="text-slate-400">Cuenta</span>}
                                  <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                                </button>
                              </div>
                              <div className="col-span-3">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Base *</label>}
                                <input type="number" value={item.baseAmount || ""} onChange={e => updateExpenseItem(idx, itemIdx, "baseAmount", parseFloat(e.target.value) || 0)} step="0.01"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums" />
                              </div>
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">IVA %</label>}
                                <input type="number" value={item.vatRate} onChange={e => updateExpenseItem(idx, itemIdx, "vatRate", parseFloat(e.target.value) || 0)} step="1"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums" />
                              </div>
                              <div className="col-span-1 flex justify-center">
                                {exp.items.length > 1 && <button aria-label="Eliminar" onClick={() => removeItemFromExpense(idx, itemIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={12} /></button>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <div className="bg-slate-900 text-white px-4 py-2 rounded-lg text-[13px]">
                          <span className="text-slate-400">Total gasto:</span>
                          <span className="ml-2 tabular-nums font-semibold">{fmt(computeExpenseTotal(exp).totalAmount)} €</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Mark Transferred Modal */}
      {showSettleModal && selectedTransferEnvelope && (() => {
        const preview = getSettlementPreview(selectedTransferEnvelope);
        return (
          <Modal open onClose={() => setShowSettleModal(false)} title={"Liquidación"} width="max-w-md" footer={<>
<button onClick={() => setShowSettleModal(false)} className={buttonClass("ghost")}>Cancelar</button>
                <button onClick={handleSettleEnvelope} disabled={saving || (preview.direction !== "none" && !settleForm.proofFile)}
                  className={buttonClass("primary")}>
                  <Scale size={14} /> {saving ? "Liquidando..." : "Confirmar liquidación"}
                </button>
</>}>
<div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-md space-y-1.5 text-[13px]">
                  <div className="flex justify-between"><span className="text-slate-500">Anticipo{selectedTransferEnvelope.advances.length > 1 ? "s" : ""}</span><span className="tabular-nums text-slate-900">{fmt(getTotalAdvance(selectedTransferEnvelope))} €</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total gastos</span><span className="tabular-nums text-slate-900">{fmt(selectedTransferEnvelope.totalAmount)} €</span></div>
                  <div className="border-t border-slate-200 my-1.5" />
                  <div className="flex justify-between">
                    <span className="text-slate-700 font-medium">{preview.direction === "none" ? "Resultado" : preview.label}</span>
                    <span className={`tabular-nums font-bold ${preview.direction === "none" ? "text-slate-500" : "text-slate-900"}`}>
                      {preview.direction === "none" ? "0,00 €" : `${fmt(preview.diff)} €`}
                    </span>
                  </div>
                </div>
                {preview.direction !== "none" && (
                  <>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Extracto del banco *</label>
                      <label className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-slate-300 rounded-md bg-white cursor-pointer hover:border-slate-400 text-[13px] text-slate-500">
                        <Upload size={15} />
                        {settleForm.proofFile ? settleForm.proofFile.name : "Subir fichero"}
                        <input type="file" className="hidden" onChange={e => setSettleForm({ ...settleForm, proofFile: e.target.files?.[0] || null })} />
                      </label>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Referencia (opcional)</label>
                      <input type="text" value={settleForm.reference} onChange={e => setSettleForm({ ...settleForm, reference: e.target.value })} placeholder="2024-PC-001"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums text-[13px]" />
                    </div>
                  </>
                )}
              </div>
</Modal>
        );
      })()}

      {/* Add Advance Modal */}
            <Modal
        open={!!(showAddAdvanceModal && selectedTransferEnvelope)}
        onClose={() => setShowAddAdvanceModal(false)}
        title={"Añadir anticipo"}
        width="max-w-md"
        footer={(showAddAdvanceModal && selectedTransferEnvelope) ? <>
<button onClick={() => setShowAddAdvanceModal(false)} className={buttonClass("ghost")}>Cancelar</button>
              <button onClick={handleAddAdvance} disabled={addingAdvance}
                className={buttonClass("primary")}>
                <Banknote size={14} /> {addingAdvance ? "Añadiendo..." : "Añadir anticipo"}
              </button>
        </> : undefined}
        >
        {(showAddAdvanceModal && selectedTransferEnvelope) && (
          <>
            <p className="-mt-1 mb-3 text-[13px] text-slate-500">{selectedTransferEnvelope.advances.length > 0
                    ? `Ya hay ${fmt(getTotalAdvance(selectedTransferEnvelope))} € anticipados en este sobre`
                    : `Sobre ${selectedTransferEnvelope.displayNumber} · ${selectedTransferEnvelope.personName}`}</p>
<div className="space-y-4">
              {/* Las transferencias siempre se hacen por banco: el efectivo va por
                  las cajas de Efectivo (Petty Cash), que funcionan aparte. */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Importe transferido *</label>
                <input type="number" min="0" step="0.01" value={advanceForm.amount}
                  onChange={e => setAdvanceForm({ ...advanceForm, amount: e.target.value, method: "bank" })}
                  placeholder="500,00"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 tabular-nums text-[13px]" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Fecha</label>
                <input type="date" value={advanceForm.date}
                  onChange={e => setAdvanceForm({ ...advanceForm, date: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
              </div>
              {(
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">IBAN de {selectedTransferEnvelope.personName} (opcional)</label>
                  <input type="text" value={advanceForm.iban}
                    onChange={e => setAdvanceForm({ ...advanceForm, iban: formatIban(e.target.value) })}
                    placeholder="ES00 0000 0000 0000 0000 0000"
                    className={`w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 font-mono text-xs whitespace-nowrap transition-colors ${
                      advanceForm.iban && !validateIban(advanceForm.iban) ? "border-red-300 focus:ring-red-400"
                        : advanceForm.iban && validateIban(advanceForm.iban) ? "border-emerald-300 focus:ring-emerald-400"
                        : "border-slate-200 focus:ring-slate-900/10 focus:border-slate-900"
                    }`} />
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">
                  Comprobante de transferencia *
                </label>
                <label className="flex items-center gap-2 px-4 py-1.5 border border-dashed border-slate-300 rounded-md cursor-pointer hover:border-slate-400 text-[13px] text-slate-500">
                  <Upload size={15} />
                  {advanceForm.proofFile ? advanceForm.proofFile.name : "Subir fichero"}
                  <input type="file" className="hidden" onChange={e => setAdvanceForm({ ...advanceForm, proofFile: e.target.files?.[0] || null })} />
                </label>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Account Selector (Transfer modal) */}
      {showAccountSelector && accountSelectorPos && editingExpenseIndex !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setShowAccountSelector(false); setEditingExpenseIndex(null); }} />
          <div ref={accountSelectorRef}
            className="fixed z-[70] w-80 bg-white border border-slate-200 rounded-md shadow-xl"
            style={{ top: Math.min(accountSelectorPos.top, window.innerHeight - 300), left: accountSelectorPos.left }}>
            <div className="p-2 border-b border-slate-100">
              <input type="text" value={accountSearchTerm} onChange={e => setAccountSearchTerm(e.target.value)} placeholder="Buscar cuenta"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900" autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {subAccounts
                .filter(sa => !accountSearchTerm || sa.code.toLowerCase().includes(accountSearchTerm.toLowerCase()) || sa.description.toLowerCase().includes(accountSearchTerm.toLowerCase()))
                .slice(0, 50)
                .map(sa => (
                  <button key={sa.id} type="button"
                    onClick={() => {
                      const expIndex = Math.floor(editingExpenseIndex / 1000);
                      const itemIndex = editingExpenseIndex % 1000;
                      if (editingExpenseIndex >= 1000) {
                        updateExpenseItem(expIndex, itemIndex, "subAccountCode", sa.code);
                        updateExpenseItem(expIndex, itemIndex, "subAccountDescription", sa.description);
                      } else {
                        setExpensesList(prev => prev.map((exp, i) =>
                          i === editingExpenseIndex
                            ? { ...exp, items: exp.items.map((item, j) => j === 0 ? { ...item, subAccountCode: sa.code, subAccountDescription: sa.description } : item) }
                            : exp
                        ));
                      }
                      setShowAccountSelector(false);
                      setEditingExpenseIndex(null);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                    <span className="font-mono text-xs text-slate-600 w-16 flex-shrink-0">{sa.code}</span>
                    <span className="text-[13px] text-slate-700 truncate">{sa.description}</span>
                  </button>
                ))}
              {subAccounts.filter(sa => !accountSearchTerm || sa.code.toLowerCase().includes(accountSearchTerm.toLowerCase()) || sa.description.toLowerCase().includes(accountSearchTerm.toLowerCase())).length === 0 && (
                <p className="px-3 py-4 text-[13px] text-slate-400 text-center">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Account Selector (Card modal) */}
      {showCardAccountSelector && cardAccountSelectorPos && editingCardExpenseIndex !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setShowCardAccountSelector(false); setEditingCardExpenseIndex(null); }} />
          <div className="fixed z-[70] w-80 bg-white border border-slate-200 rounded-md shadow-xl"
            style={{ top: Math.min(cardAccountSelectorPos.top, window.innerHeight - 300), left: cardAccountSelectorPos.left }}>
            <div className="p-2 border-b border-slate-100">
              <input type="text" value={cardAccountSearch} onChange={e => setCardAccountSearch(e.target.value)} placeholder="Buscar cuenta"
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-1 focus:ring-slate-900/10 focus:border-slate-900" autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {subAccounts
                .filter(sa => !cardAccountSearch || sa.code.toLowerCase().includes(cardAccountSearch.toLowerCase()) || sa.description.toLowerCase().includes(cardAccountSearch.toLowerCase()))
                .slice(0, 50)
                .map(sa => (
                  <button key={sa.id} type="button"
                    onClick={() => {
                      const expIdx  = Math.floor(editingCardExpenseIndex / 1000);
                      const itemIdx = editingCardExpenseIndex % 1000;
                      updateCardItem(expIdx, itemIdx, "subAccountCode", sa.code);
                      updateCardItem(expIdx, itemIdx, "subAccountDescription", sa.description);
                      setShowCardAccountSelector(false);
                      setEditingCardExpenseIndex(null);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50 last:border-0">
                    <span className="font-mono text-xs text-slate-600 w-16 flex-shrink-0">{sa.code}</span>
                    <span className="text-[13px] text-slate-700 truncate">{sa.description}</span>
                  </button>
                ))}
              {subAccounts.filter(sa => !cardAccountSearch || sa.code.toLowerCase().includes(cardAccountSearch.toLowerCase()) || sa.description.toLowerCase().includes(cardAccountSearch.toLowerCase())).length === 0 && (
                <p className="px-3 py-4 text-[13px] text-slate-400 text-center">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Send Box Form Modal ────────────────────────────────────────────── */}
      {showSendBoxFormModal && (
        <Modal open onClose={() => { setShowSendBoxFormModal(false); setGeneratedBoxResult(null); }} title={"Enviar solicitud de caja"} width="max-w-md">
{!generatedBoxResult ? (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre del solicitante</label>
                  <input
                    type="text"
                    value={boxFormRequesterName}
                    onChange={e => setBoxFormRequesterName(e.target.value)}
                    placeholder="Nombre del beneficiario"
                    className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Mensaje opcional</label>
                  <textarea
                    value={boxFormMessage}
                    onChange={e => setBoxFormMessage(e.target.value)}
                    rows={2}
                    placeholder="Instrucciones adicionales para el solicitante"
                    className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 resize-none"
                  />
                </div>
                <button
                  onClick={handleGenerateBoxForm}
                  disabled={generatingBoxForm || !boxFormRequesterName.trim()}
                  className="w-full py-1.5 rounded-md text-[13px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                  {generatingBoxForm ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Generando...</> : <><Link2 size={15} /> Generar enlace</>}
                </button>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <p className="text-[13px] text-slate-600">Comparte este enlace y PIN con <strong>{boxFormRequesterName}</strong>.</p>
                {/* PIN */}
                <div className="bg-slate-900 rounded-md p-4 text-center">
                  <p className="text-xs text-slate-400 mb-2 tracking-widest uppercase">PIN de acceso</p>
                  <div className="flex justify-center gap-3">
                    {generatedBoxResult.pin.split("").map((d, i) => (
                      <span key={i} className="w-12 h-14 flex items-center justify-center bg-white/10 rounded-lg text-3xl font-bold text-white tracking-widest">{d}</span>
                    ))}
                  </div>
                </div>
                {/* URL */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Enlace del formulario</p>
                  <p className="text-xs text-slate-600 break-all font-mono bg-slate-50 rounded-lg px-2 py-1.5">{generatedBoxResult.url}</p>
                  <div className="flex gap-2">
                    <button onClick={() => copyBoxMessage(generatedBoxResult!.url, generatedBoxResult!.pin)} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border transition-colors ${copiedBoxUrl ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                      {copiedBoxUrl ? <><Check size={12} /> Copiado</> : <><ClipboardCopy size={12} /> Copiar mensaje</>}
                    </button>
                    <a href={generatedBoxResult.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
                      <ExternalLink size={12} /> Abrir
                    </a>
                  </div>
                </div>
                <button onClick={() => { setShowSendBoxFormModal(false); setGeneratedBoxResult(null); }} className="w-full py-1.5 rounded-md text-[13px] font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
                  Cerrar
                </button>
              </div>
            )}
</Modal>
      )}

      {/* ── Volcar a sobre Modal ───────────────────────────────────────────── */}
      {showVolcarModal && (() => {
        const fs = formSubmissions.find(f => f.id === showVolcarModal);
        const openEnvelopes = transferEnvelopes.filter(e => e.status === "draft");
        const selectedEnv = openEnvelopes.find(e => e.id === volcarTargetEnvelopeId);
        const updateEd = (i: number, patch: Partial<typeof volcarExpenseData[0]>) =>
          setVolcarExpenseData(prev => prev.map((ed, idx) => idx === i ? { ...ed, ...patch } : ed));
        const updateVolcarItem = (expIdx: number, itemIdx: number, patch: Partial<typeof volcarExpenseData[0]["items"][0]>) =>
          setVolcarExpenseData(prev => prev.map((ed, i) => {
            if (i !== expIdx) return ed;
            return { ...ed, items: ed.items.map((it, j) => j === itemIdx ? { ...it, ...patch } : it) };
          }));
        const addVolcarItem = (expIdx: number) =>
          setVolcarExpenseData(prev => prev.map((ed, i) =>
            i === expIdx ? { ...ed, items: [...ed.items, { id: crypto.randomUUID(), subAccountCode: "", subAccountDescription: "", baseAmount: 0, vatRate: 21, showSubAccountDropdown: false, subAccountSearch: "" }] } : ed));
        const removeVolcarItem = (expIdx: number, itemIdx: number) =>
          setVolcarExpenseData(prev => prev.map((ed, i) => {
            if (i !== expIdx || ed.items.length <= 1) return ed;
            return { ...ed, items: ed.items.filter((_, j) => j !== itemIdx) };
          }));
        const VAT_RATES = [0, 4, 10, 21];
        const IRPF_RATES = [0, 7, 15, 19];

        return (
          <Modal open onClose={() => { setShowVolcarModal(null); setShowVolcarEnvDropdown(false); setShowVolcarSupplierDropdown(null); }} title={"Volcar a sobre de transferencias"} width="max-w-4xl" footer={<>
<button onClick={() => { setShowVolcarModal(null); setShowVolcarEnvDropdown(false); }}
                  className={buttonClass("secondary")}>
                  Cancelar
                </button>
                <button onClick={() => handleVolcarToEnvelope(showVolcarModal!)}
                  disabled={!volcarTargetEnvelopeId || volcandoFormId === showVolcarModal}
                  className={buttonClass("primary")}>
                  {volcandoFormId === showVolcarModal
                    ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Volcando</>
                    : "Volcar al sobre"}
                </button>
</>}>
<p className="-mt-1 mb-3 text-[13px] text-slate-500">{fs?.requesterName} · {fs?.expenseCount} gasto{fs?.expenseCount !== 1 ? "s" : ""} · <strong>{new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(fs?.totalAmount ?? 0)} €</strong></p>
{/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                {/* Sobre de destino */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sobre de destino</label>
                  {openEnvelopes.length === 0 ? (
                    <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-[13px] text-amber-700">
                      No hay sobres abiertos. Crea uno en la pestaña Transferencias primero.
                    </div>
                  ) : (
                    <div className="relative">
                      <button type="button" onClick={() => setShowVolcarEnvDropdown(!showVolcarEnvDropdown)}
                        className="w-full px-4 py-1.5 border border-slate-200 rounded-md text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white text-[13px]">
                        <span className={selectedEnv ? "text-slate-900 text-sm" : "text-slate-400 text-sm"}>
                          {selectedEnv ? `${selectedEnv.displayNumber}${selectedEnv.paymentDate ? ` · ${selectedEnv.paymentDate}` : ""}` : "Seleccionar sobre"}
                        </span>
                        <ChevronDown size={15} className={`text-slate-400 transition-transform ${showVolcarEnvDropdown ? "rotate-180" : ""}`} />
                      </button>
                      {showVolcarEnvDropdown && (
                        <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                          {openEnvelopes.map(env => (
                            <button key={env.id} type="button"
                              onClick={() => { setVolcarTargetEnvelopeId(env.id); setShowVolcarEnvDropdown(false); }}
                              className={`w-full px-4 py-1.5 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between transition-colors ${volcarTargetEnvelopeId === env.id ? "bg-slate-50 font-medium" : ""}`}>
                              <div>
                                <p className="text-slate-900">{env.displayNumber}</p>
                                {env.paymentDate && <p className="text-xs text-slate-400">{env.paymentDate}</p>}
                              </div>
                              {volcarTargetEnvelopeId === env.id && <Check size={14} className="text-slate-600 flex-shrink-0" />}
                            </button>
                          ))}
                        </AnchoredPanel>
                      )}
                    </div>
                  )}
                </div>

                {/* Per-expense detail completion */}
                {fs && fs.expenses.map((exp, i) => {
                  const ed = volcarExpenseData[i];
                  if (!ed) return null;
                  const totalAmt = Number(exp.amount) || 0;
                  const { baseAmount: itemsBase, vatAmount: itemsVat, totalAmount: itemsTotal } = computeExpenseTotal(ed);
                  const totalMismatch = Math.abs(itemsTotal - totalAmt) > 0.01;
                  const docType = exp.fileUrl ? getDocumentType(exp.fileUrl) : null;
                  const filteredSuppliers = cardSuppliers.filter(s =>
                    s.name.toLowerCase().includes(ed.supplier.toLowerCase()) ||
                    s.taxId.includes(ed.supplier)
                  );

                  return (
                    <div key={i} className="border border-slate-200 rounded-lg overflow-visible">
                      {/* Expense header */}
                      <div className="bg-slate-50 rounded-t-lg px-4 py-3 border-b border-slate-200 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-slate-900 truncate">{exp.description || `Gasto ${i + 1}`}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Total del ticket: <strong>{new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(totalAmt)} €</strong>
                          </p>
                        </div>
                        {exp.fileUrl && (
                          <a href={exp.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 flex-shrink-0">
                            <Maximize2 size={12} /> Abrir
                          </a>
                        )}
                      </div>

                      <div className="flex flex-col md:flex-row">
                        {/* Documento — "en un ladito", para consultar mientras se codifica */}
                        <div className="w-full md:w-52 flex-shrink-0 bg-slate-100 md:rounded-bl-2xl border-b md:border-b-0 md:border-r border-slate-200 p-3">
                          {!exp.fileUrl ? (
                            <div className="h-40 md:h-full flex flex-col items-center justify-center gap-1.5 text-slate-400 text-center">
                              <FileX size={22} />
                              <span className="text-[11px]">Sin documento adjunto</span>
                            </div>
                          ) : docType === "pdf" ? (
                            <a href={exp.fileUrl} target="_blank" rel="noopener noreferrer" className="block h-40 md:h-full">
                              <iframe src={exp.fileUrl} className="w-full h-full rounded-lg border border-slate-200 pointer-events-none bg-white" title="Documento del gasto" />
                            </a>
                          ) : (
                            <a href={exp.fileUrl} target="_blank" rel="noopener noreferrer" className="block h-40 md:h-full">
                              <img src={exp.fileUrl} alt="Documento del gasto"
                                className="w-full h-full object-contain rounded-lg bg-white"
                                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            </a>
                          )}
                        </div>

                        {/* Fields */}
                        <div className="flex-1 p-4 grid grid-cols-2 gap-3">

                          {/* Tipo */}
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
                            <div className="flex gap-1">
                              {(["ticket", "invoice"] as const).map(t => (
                                <button key={t} type="button"
                                  onClick={() => updateEd(i, { type: t })}
                                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${ed.type === t ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                                  {t === "ticket" ? "Ticket" : "Factura"}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Proveedor */}
                          <div className="col-span-2 relative">
                            <label className="block text-xs font-medium text-slate-500 mb-1">Proveedor (empresa de la factura/ticket)</label>
                            <input type="text" value={ed.supplier}
                              onChange={e => { updateEd(i, { supplier: e.target.value }); setShowVolcarSupplierDropdown(i); }}
                              onFocus={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setVolcarSupplierDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                                setShowVolcarSupplierDropdown(i);
                              }}
                              placeholder="Nombre del proveedor"
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                            {showVolcarSupplierDropdown === i && volcarSupplierDropdownPos && filteredSuppliers.length > 0 && (
                              <div className="fixed z-20 bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-40 overflow-y-auto"
                                style={{ top: volcarSupplierDropdownPos.top, left: volcarSupplierDropdownPos.left, width: volcarSupplierDropdownPos.width }}>
                                {filteredSuppliers.slice(0, 8).map(s => (
                                  <button key={s.taxId} type="button"
                                    onClick={() => { updateEd(i, { supplier: s.name, supplierTaxId: s.taxId }); setShowVolcarSupplierDropdown(null); }}
                                    className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50 flex items-center justify-between">
                                    <span className="text-slate-900">{s.name}</span>
                                    <span className="text-xs text-slate-400">{s.taxId}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* CIF/NIF proveedor */}
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">CIF / NIF</label>
                            <input type="text" value={ed.supplierTaxId}
                              onChange={e => updateEd(i, { supplierTaxId: e.target.value })}
                              placeholder="B12345678"
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                          </div>

                          {/* Fecha */}
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">Fecha del gasto</label>
                            <input type="date" value={ed.date}
                              onChange={e => updateEd(i, { date: e.target.value })}
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                          </div>

                          {/* IRPF */}
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-slate-500 mb-1">IRPF</label>
                            <div className="flex gap-1">
                              {IRPF_RATES.map(r => (
                                <button key={r} type="button"
                                  onClick={() => updateEd(i, { irpfRate: r })}
                                  className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${ed.irpfRate === r ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                                  {r}%
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Cuenta(s) de presupuesto */}
                          <div className="col-span-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="block text-xs font-medium text-slate-500">Cuenta(s) de presupuesto</label>
                              <button type="button" onClick={() => addVolcarItem(i)}
                                className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800">
                                <Plus size={11} /> Añadir cuenta
                              </button>
                            </div>
                            {ed.items.map((item, j) => {
                              const filteredAccounts = subAccounts.filter(a =>
                                !item.subAccountSearch ||
                                a.code.includes(item.subAccountSearch) ||
                                a.description.toLowerCase().includes(item.subAccountSearch.toLowerCase())
                              );
                              return (
                                <div key={item.id} className="flex items-start gap-2">
                                  <div className="flex-1 relative">
                                    <input type="text"
                                      value={item.subAccountCode ? `${item.subAccountCode} · ${item.subAccountDescription}` : item.subAccountSearch}
                                      onChange={e => updateVolcarItem(i, j, { subAccountSearch: e.target.value, subAccountCode: "", subAccountDescription: "" })}
                                      onFocus={(e) => {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setVolcarAccountDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
                                        updateVolcarItem(i, j, { showSubAccountDropdown: true });
                                      }}
                                      placeholder="Buscar cuenta"
                                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                                    {item.showSubAccountDropdown && volcarAccountDropdownPos && filteredAccounts.length > 0 && (
                                      <div className="fixed z-20 bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto"
                                        style={{ top: volcarAccountDropdownPos.top, left: volcarAccountDropdownPos.left, width: volcarAccountDropdownPos.width }}>
                                        {filteredAccounts.slice(0, 10).map(a => (
                                          <button key={a.id} type="button"
                                            onClick={() => updateVolcarItem(i, j, { subAccountCode: a.code, subAccountDescription: a.description, subAccountSearch: "", showSubAccountDropdown: false })}
                                            className="w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50">
                                            <span className="font-mono text-slate-500 mr-2">{a.code}</span>
                                            <span className="text-slate-900">{a.description}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <input type="number" step="0.01" value={item.baseAmount || ""}
                                    onChange={e => updateVolcarItem(i, j, { baseAmount: parseFloat(e.target.value) || 0 })}
                                    placeholder="Base"
                                    className="w-24 px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] text-right focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900" />
                                  <div className="relative">
                                    <select value={item.vatRate}
                                      onChange={e => updateVolcarItem(i, j, { vatRate: Number(e.target.value) })}
                                      className="w-20 px-2 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 appearance-none">
                                      {VAT_RATES.map(r => <option key={r} value={r}>{r}% IVA</option>)}
                                    </select>
                                  </div>
                                  {ed.items.length > 1 && (
                                    <button aria-label="Eliminar" type="button" onClick={() => removeVolcarItem(i, j)}
                                      className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            <p className={`text-xs ${totalMismatch ? "text-amber-600" : "text-slate-400"}`}>
                              {totalMismatch && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}
                              Codificado: {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(itemsTotal)} €
                              {" "}(base {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(itemsBase)} € · IVA {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(itemsVat)} €)
                              {totalMismatch && ` — no coincide con el total del ticket (${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(totalAmt)} €)`}
                            </p>
                          </div>

                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
</Modal>
        );
      })()}

      {/* ── Configurar exportación (DEMO / vista previa) ──────────────────── */}
            <Modal
        open={!!(showExportConfigModal)}
        onClose={() => setShowExportConfigModal(false)}
        title={"Exportación a servicio de tarjetas"}
        width="max-w-lg"
        footer={(showExportConfigModal) ? <>
<button
                onClick={() => setShowExportConfigModal(false)}
                className={buttonClass("secondary")}
              >
                Cerrar
              </button>
              <button
                onClick={() => { setShowExportConfigModal(false); showToast("success", "Vista previa · esta configuración aún no está conectada"); }}
                className={buttonClass("primary")}
              >
                Guardar configuración
              </button>
        </> : undefined}
        >
        {(showExportConfigModal) && (
          <>
            <p className="-mt-1 mb-3 text-[13px] text-slate-500">Vista previa · aún no conectado a ningún proveedor</p>
<div className="space-y-5">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md flex gap-2.5">
                <Info size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Así se verá el panel para sincronizar BOX con el proveedor de tarjetas corporativas del proyecto
                  (gastos, sobres y justificantes). Todavía es una demo: nada de lo que configures aquí se guarda.
                </p>
              </div>

              {/* Proveedor */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Proveedor de tarjetas</label>
                <input
                  type="text"
                  value={exportConfig.providerName}
                  onChange={(e) => setExportConfig({ ...exportConfig, providerName: e.target.value })}
                  placeholder="Nombre de tu proveedor de tarjetas corporativas"
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-amber-500 bg-white"
                />
              </div>

              {/* Formato */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Formato de exportación</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: "csv", label: "CSV", icon: FileSpreadsheet },
                    { value: "excel", label: "Excel", icon: FileText },
                    { value: "api", label: "API / Webhook", icon: Link2 },
                  ] as const).map((opt) => {
                    const Icon = opt.icon;
                    const active = exportConfig.format === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setExportConfig({ ...exportConfig, format: opt.value })}
                        className={`flex flex-col items-center gap-1.5 py-2 rounded-md border-2 text-xs font-medium transition-all ${active ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
                      >
                        <Icon size={16} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {exportConfig.format === "api" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Endpoint / Webhook URL</label>
                  <input
                    type="text"
                    disabled
                    placeholder="https://api.tu-proveedor.com/webhooks/box"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-slate-50 text-slate-400 cursor-not-allowed"
                  />
                </div>
              )}

              {/* Frecuencia */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Frecuencia de sincronización</label>
                <div className="flex gap-2">
                  {([
                    { value: "manual", label: "Manual" },
                    { value: "daily", label: "Diaria" },
                    { value: "weekly", label: "Semanal" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setExportConfig({ ...exportConfig, frequency: opt.value })}
                      className={`flex-1 py-2 rounded-md text-xs font-medium border transition-all ${exportConfig.frequency === opt.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Qué se exporta */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Qué se incluye</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:border-slate-300 transition-all">
                    <input
                      type="checkbox"
                      checked={exportConfig.mapCategories}
                      onChange={(e) => setExportConfig({ ...exportConfig, mapCategories: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500 text-[13px]"
                    />
                    <span className="text-[13px] text-slate-700">Mapeo de departamentos y cuentas presupuestarias</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-md cursor-pointer hover:border-slate-300 transition-all">
                    <input
                      type="checkbox"
                      checked={exportConfig.mapReceipts}
                      onChange={(e) => setExportConfig({ ...exportConfig, mapReceipts: e.target.checked })}
                      className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500 text-[13px]"
                    />
                    <span className="text-[13px] text-slate-700">Adjuntar justificantes y tickets</span>
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
