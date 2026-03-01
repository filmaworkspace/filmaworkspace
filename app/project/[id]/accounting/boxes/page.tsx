"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db, storage } from "@/lib/firebase";
import {
  doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, Timestamp, writeBatch, setDoc
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  Package, Plus, Search, ChevronDown, ChevronRight, X, Check, AlertCircle, CheckCircle,
  Trash2, Edit, Upload, FileText, Receipt, ArrowLeft, Layers, ShieldAlert, FileSpreadsheet,
  ExternalLink, Lock, Send, Banknote, UserCircle, CreditCard, CheckSquare, AlertTriangle,
  Calendar, Users, Paperclip, Eye, Info, SplitSquareHorizontal, Scissors, FileX, PanelRightOpen,
  RotateCcw, Save, ChevronLeft
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { unzipSync, strFromU8 } from "fflate";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ═══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

interface Box {
  id: string; name: string; code: string; department?: string;
  nextInvoiceNumber: number; nextTicketNumber: number; nextEnvelopeNumber: number;
  createdAt: Date; createdBy: string; createdByName: string;
}

interface Envelope {
  id: string; boxId: string; boxCode: string; number: number; displayNumber: string;
  status: "open" | "reviewing" | "closed";
  totalBase: number; totalVat: number; totalAmount: number;
  expenseCount: number; reviewedCount: number;
  createdAt: Date; createdBy: string; createdByName: string;
  closedAt?: Date; closedBy?: string; closedByName?: string;
}

interface ExpenseItem { baseAmount: number; vatRate: number; vatAmount: number; }

type ConflictType = "amount_diff" | "invoice_covers_multiple" | "partial_invoice" | "missing_document";

interface BoxExpense {
  id: string; envelopeId: string; boxId: string; boxCode: string;
  number: number; displayNumber: string; type: "invoice" | "ticket";
  pleoReceiptId: string; pleoUrl?: string; documentUrl?: string;
  supplier: string; supplierTaxId: string; supplierNumber: string;
  subAccountCode: string; subAccountDescription: string; description: string;
  date: Date; items: ExpenseItem[];
  baseAmount: number; vatAmount: number; irpfRate: number; irpfAmount: number; totalAmount: number;
  pleoAmount?: number;
  status: "pending" | "reviewed" | "accounted";
  reviewedAt?: Date; reviewedBy?: string; reviewedByName?: string;
  conflictType?: ConflictType | null;
  conflictNote?: string;
  conflictResolvedAt?: Date;
  conflictResolvedBy?: string;
  conflictResolvedByName?: string;
}

interface BoxSupplier { taxId: string; name: string; originalName: string; updatedAt?: Date; }

interface TransferEnvelope {
  id: string; number: number; displayNumber: string;
  paymentDate: string; status: "draft" | "pending" | "transferred";
  totalBase: number; totalVat: number; totalAmount: number; expenseCount: number; notes?: string;
  createdAt: Date; createdBy: string; createdByName: string;
  transferredAt?: Date; transferredBy?: string; transferredByName?: string; transferReference?: string;
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
  id: string; envelopeId: string; type: "invoice" | "ticket";
  personName: string; personDepartment?: string; personIban?: string;
  supplier: string; supplierTaxId?: string;
  items: TransferExpenseItem[];
  subAccountCode?: string; subAccountDescription?: string; description?: string;
  date: string;
  baseAmount: number; vatAmount: number;
  irpfRate: number; irpfAmount: number; totalAmount: number;
  attachmentUrl?: string; attachmentFileName?: string;
  createdAt: Date; createdBy: string; createdByName: string;
}

interface SubAccount {
  id: string; code: string; description: string;
  accountId: string; accountCode: string; accountDescription: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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
  "0049": "Santander",
  "0075": "Banco Popular",
  "0081": "Banco Sabadell",
  "0128": "Bankinter",
  "0182": "BBVA",
  "2038": "Bankia",
  "2100": "CaixaBank",
  "2085": "Ibercaja",
  "1465": "ING",
  "0073": "Openbank",
  "0238": "Banco Pastor",
  "0487": "Banco Mare Nostrum",
  "3058": "Cajamar",
  "2048": "Kutxabank",
  "0030": "Banco Español de Crédito",
  "1491": "Triodos Bank",
  "0061": "Banca March",
  "0019": "Deutsche Bank",
  "0065": "Barclays",
  "2095": "Abanca",
  "3025": "Caixa Rural",
  "0234": "Banco Mediolanum",
  "2080": "Abanca",
  "2103": "Unicaja",
  "3035": "Cajasiete",
  "3159": "Caja Rural de Navarra",
  "0083": "Renta 4",
  "0186": "Banco Sabadell Atlántico",
  "2013": "NCG Banco",
  "0131": "Banco Espirito Santo",
  "0093": "Sabadell",
  "0155": "Banco de Crédito Local",
  "2045": "Banco Santander Consumer",
  "2046": "Colonya Caixa Pollença",
  "6000": "Finances i Intercanvis",
  "1000": "Instituto de Crédito Oficial",
};

const formatIban = (raw: string): string =>
  raw.replace(/\s+/g, "").toUpperCase();

const detectBank = (iban: string): string | null => {
  const clean = formatIban(iban);
  if (!clean.startsWith("ES") || clean.length !== 24) return null;
  const bankCode = clean.substring(4, 8);
  return SPANISH_BANKS[bankCode] || null;
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
  open: { bg: "bg-blue-50", text: "text-blue-700", label: "Abierto" },
  reviewing: { bg: "bg-amber-50", text: "text-amber-700", label: "En revisión" },
  closed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Cerrado" },
};

const EXPENSE_STATUS_CONFIG = {
  pending: { bg: "bg-slate-100", text: "text-slate-600", label: "Pendiente" },
  reviewed: { bg: "bg-blue-50", text: "text-blue-700", label: "Revisado" },
  accounted: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Contabilizado" },
};

const TRANSFER_STATUS_CONFIG = {
  draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Borrador" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente" },
  transferred: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Transferido" },
};

const CONFLICT_CONFIG: Record<ConflictType, { icon: string; label: string; description: string; color: string }> = {
  amount_diff:               { icon: "diff",     label: "Diferencia de importe",      description: "El importe de la factura no coincide con el cargo en Pleo",          color: "amber"  },
  invoice_covers_multiple:   { icon: "merge",    label: "Factura cubre varios cargos", description: "Una sola factura agrupa varios movimientos de tarjeta",              color: "blue"   },
  partial_invoice:           { icon: "split",    label: "Factura parcial",             description: "El movimiento de tarjeta corresponde a varias facturas o tickets",   color: "violet" },
  missing_document:          { icon: "missing",  label: "Documento ausente",           description: "No hay factura ni ticket adjunto en Pleo para este gasto",           color: "slate"  },
};

type MainTab = "tarjetas" | "transfers";

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

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
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [mainTab, setMainTab] = useState<MainTab>("tarjetas");
  const [departments, setDepartments] = useState<string[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nextTransferNumber, setNextTransferNumber] = useState(1);

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
  const [showManualExpenseModal, setShowManualExpenseModal] = useState(false);
  const [cardExpensesList, setCardExpensesList] = useState<Array<{
    id: string; type: "invoice" | "ticket"; supplier: string; supplierTaxId: string;
    supplierNumber: string; date: string; irpfRate: number; file: File | null;
    items: Array<{ id: string; subAccountCode: string; subAccountDescription: string; description: string; baseAmount: number; vatRate: number; }>;
  }>>([]);
  const [manualExpenseSaving, setManualExpenseSaving] = useState(false);
  const [showCardTypeDropdown, setShowCardTypeDropdown] = useState<number | null>(null);
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
  // Expense drawer (conflict & edit panel)
  const [drawerExpense, setDrawerExpense] = useState<BoxExpense | null>(null);
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
  const [showDrawerAccountSelector, setShowDrawerAccountSelector] = useState(false);
  const [drawerAccountSearch, setDrawerAccountSearch] = useState("");
  const [drawerAccountSelectorItemIdx, setDrawerAccountSelectorItemIdx] = useState<number | null>(null);

  // TRANSFERS State
  const [transferEnvelopes, setTransferEnvelopes] = useState<TransferEnvelope[]>([]);
  const [transferExpenses, setTransferExpenses] = useState<TransferExpense[]>([]);
  const [selectedTransferEnvelope, setSelectedTransferEnvelope] = useState<TransferEnvelope | null>(null);
  const [showCreateTransferEnvelopeModal, setShowCreateTransferEnvelopeModal] = useState(false);
  const [showDeleteTransferEnvelopeModal, setShowDeleteTransferEnvelopeModal] = useState<TransferEnvelope | null>(null);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [showMarkTransferredModal, setShowMarkTransferredModal] = useState(false);
  const [transferEnvelopeForm, setTransferEnvelopeForm] = useState({ paymentDate: "", notes: "" });
  const [expensePersonForm, setExpensePersonForm] = useState({ name: "", department: "", iban: "" });
  const [expensesList, setExpensesList] = useState<Array<{
    id: string; type: "invoice" | "ticket"; supplier: string; supplierTaxId: string;
    date: string; irpfRate: number; file: File | null;
    items: Array<{
      id: string; subAccountCode: string; subAccountDescription: string;
      description: string; baseAmount: number; vatRate: number;
    }>;
  }>>([]);
  const [transferRef, setTransferRef] = useState("");

  // Dropdowns
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showExpenseDepartmentDropdown, setShowExpenseDepartmentDropdown] = useState(false);
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [accountSearchTerm, setAccountSearchTerm] = useState("");
  const [accountSelectorPos, setAccountSelectorPos] = useState<{ top: number; left: number } | null>(null);
  const [editingExpenseIndex, setEditingExpenseIndex] = useState<number | null>(null);
  const [showTypeDropdown, setShowTypeDropdown] = useState<number | null>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const expenseDepartmentDropdownRef = useRef<HTMLDivElement>(null);
  const accountSelectorRef = useRef<HTMLDivElement>(null);

  // Utils
  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };
  const fmt = (n: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
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
    try {
      setLoading(true);
      const ups = await getDoc(doc(db, `userProjects/${userId}/projects/${projectId}`));
      if (!ups.exists()) { setAccessError("No tienes acceso a este proyecto"); setLoading(false); return; }
      if (!ups.data().permissions?.accounting) { setAccessError("No tienes permisos de contabilidad"); setLoading(false); return; }
      setHasAccess(true);

      const projectDoc = await getDoc(doc(db, `projects/${projectId}`));
      if (projectDoc.exists()) {
        setDepartments(projectDoc.data().departments || []);
        setNextTransferNumber(projectDoc.data().nextTransferNumber || 1);
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
        transferredAt: d.data().transferredAt?.toDate(),
      })) as TransferEnvelope[]);

      const trfExpSnap = await getDocs(query(collection(db, `projects/${projectId}/transferExpenses`), orderBy("createdAt", "desc")));
      setTransferExpenses(trfExpSnap.docs.map(d => ({
        id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date(),
      })) as TransferExpense[]);

    } catch (e) {
      console.error(e);
      showToast("error", "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // PLEO FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── Expense Drawer helpers ──────────────────────────────────────────────────
  const openDrawer = (expense: BoxExpense) => {
    setDrawerExpense(expense);
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
    // Populate drawerItems from expense.items, fallback to single line from flat fields
    const items = expense.items && expense.items.length > 0
      ? expense.items.map((it: any, i: number) => ({
          id: crypto.randomUUID(),
          subAccountCode: i === 0 ? (expense.subAccountCode || "") : (it.subAccountCode || ""),
          subAccountDescription: i === 0 ? (expense.subAccountDescription || "") : (it.subAccountDescription || ""),
          description: i === 0 ? (expense.description || "") : (it.description || ""),
          baseAmount: it.baseAmount || 0,
          vatRate: it.vatRate ?? 21,
        }))
      : [{ id: crypto.randomUUID(), subAccountCode: expense.subAccountCode || "",
           subAccountDescription: expense.subAccountDescription || "",
           description: expense.description || "",
           baseAmount: expense.baseAmount || 0, vatRate: 21 }];
    setDrawerItems(items);
    setDrawerAccountSearch("");
    setShowDrawerAccountSelector(false);
    setDrawerAccountSelectorItemIdx(null);
  };

  const closeDrawer = () => { setDrawerExpense(null); setShowDrawerAccountSelector(false); };

  const handleSaveDrawer = async () => {
    if (!drawerExpense) return;
    setDrawerSaving(true);
    try {
      // If supplier name changed and we have a CIF, update cardSuppliers (supplier learning)
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
      // Compute totals from drawerItems lines
      const irpfRate   = parseFloat(drawerForm.irpfRate) || 0;
      const baseAmount = drawerItems.reduce((s, it) => s + (it.baseAmount || 0), 0);
      const vatAmount  = drawerItems.reduce((s, it) =>
        s + Math.round((it.baseAmount || 0) * (it.vatRate || 0) / 100 * 100) / 100, 0);
      const irpfAmount = Math.round(baseAmount * irpfRate / 100 * 100) / 100;
      const totalAmount = Math.round((baseAmount + vatAmount - irpfAmount) * 100) / 100;
      // First item drives the top-level account fields
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
    } catch { showToast("error", "Error al guardar"); } finally { setDrawerSaving(false); }
  };

  const handleResolveConflict = async () => {
    if (!drawerExpense) return;
    setDrawerSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/cardExpenses`, drawerExpense.id), {
        conflictType: null, conflictNote: "",
        conflictResolvedAt: Timestamp.now(), conflictResolvedBy: userId, conflictResolvedByName: userName,
      });
      showToast("success", "Conflicto resuelto");
      closeDrawer();
      loadData();
    } catch { showToast("error", "Error al resolver conflicto"); } finally { setDrawerSaving(false); }
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
    } catch { showToast("error", "Error al crear caja"); } finally { setSaving(false); }
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
    } catch { showToast("error", "Error al actualizar"); } finally { setSaving(false); }
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
    } catch { showToast("error", "Error al eliminar caja"); } finally { setSaving(false); }
  };

  const handleCreateEnvelope = async () => {
    if (!selectedBox) return;
    setSaving(true);
    try {
      const num = selectedBox.nextEnvelopeNumber || 1;
      const displayNumber = `ENV-${selectedBox.code}-${String(num).padStart(3, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/cardEnvelopes`), {
        boxId: selectedBox.id, boxCode: selectedBox.code, number: num, displayNumber,
        status: "open", totalBase: 0, totalVat: 0, totalAmount: 0,
        expenseCount: 0, reviewedCount: 0,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      await updateDoc(doc(db, `projects/${projectId}/cards`, selectedBox.id), {
        nextEnvelopeNumber: num + 1,
      });
      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateEnvelopeModal(false);
      loadData();
    } catch { showToast("error", "Error al crear sobre"); } finally { setSaving(false); }
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
    } catch { showToast("error", "Error al eliminar sobre"); } finally { setSaving(false); }
  };

  // ── Parser XLSX — usa fflate.unzipSync (pure-JS, sin APIs de browser) ──
  const parsePleoExcel = async (file: File): Promise<any[]> => {
    const ab = await file.arrayBuffer();
    const zip = unzipSync(new Uint8Array(ab));   // descomprime todo el ZIP de una vez

    const readEntry = (name: string): string | null => {
      const entry = zip[name];
      return entry ? strFromU8(entry) : null;
    };

    // 1. SharedStrings
    const sharedStrings: string[] = [];
    const ssXml = readEntry("xl/sharedStrings.xml");
    if (ssXml) {
      // Extraer <si>...</si> con indexOf para evitar problemas de minificación
      let ssp = 0;
      while (true) {
        const siS = ssXml.indexOf("<si>", ssp);
        if (siS < 0) break;
        const siE = ssXml.indexOf("</si>", siS);
        if (siE < 0) break;
        const siContent = ssXml.substring(siS + 4, siE);
        // Concatenar todos los <t>...</t> dentro del <si>
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
    console.log("[XLSX] sharedStrings:", sharedStrings.length, sharedStrings.slice(0,5));

    // 2. Sheet
    const sheetXml = readEntry("xl/worksheets/sheet1.xml");
    if (!sheetXml) throw new Error("No se encontró la hoja de cálculo en el XLSX");
    // Extraer bloques <row>...</row> completos con indexOf
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
    console.log("[XLSX] sheetXml length:", sheetXml?.length, "rowBlocks:", rowBlocks.length);
    if (rowBlocks.length < 2) throw new Error("El archivo no contiene filas de datos");

    // parseRow: usa indexOf/substring — inmune al minificador de Next.js.
    // Los regex con comillas dentro (/t="s"/) se corrompen al minificar.
    const parseRow = (rowXml: string): Record<string, string> => {
      const result: Record<string, string> = {};
      let pos = 0;
      while (true) {
        const cStart = rowXml.indexOf("<c ", pos);
        if (cStart < 0) break;
        const cEnd = rowXml.indexOf(">", cStart);
        if (cEnd < 0) break;
        const tag = rowXml.substring(cStart + 1, cEnd);

        // Extraer columna de r="A1"
        const rIdx = tag.indexOf(" r=");
        if (rIdx < 0) { pos = cEnd + 1; continue; }
        let ci = rIdx + 3;
        if (tag[ci] === '"' || tag[ci] === "'") ci++;
        let col = "";
        while (ci < tag.length && tag[ci] >= "A" && tag[ci] <= "Z") col += tag[ci++];
        if (!col) { pos = cEnd + 1; continue; }

        // Detectar t="s" (shared string) sin regex con comillas
        const tIdx = tag.indexOf(" t=");
        const isShared = tIdx >= 0 && tag.substring(tIdx + 3).replace(/^["']/, "")[0] === "s";

        // Extraer <v>valor</v>
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
    console.log("[XLSX] colToHeader:", JSON.stringify(colToHeader));

    // 3. Group rows by RECIBO PLEO
    const grouped: Record<string, Record<string, string>[]> = {};
    for (let i = 1; i < rowBlocks.length; i++) {
      const raw = parseRow(rowBlocks[i]);
      const record: Record<string, string> = {};
      for (const [col, val] of Object.entries(raw)) {
        const h = colToHeader[col]; if (h) record[h] = val;
      }
      const id = record["RECIBO PLEO"];
      console.log("[XLSX] row RECIBO PLEO:", JSON.stringify(id));
      if (!id) continue;
      (grouped[id] ??= []).push(record);
    }

    // 4. Build result
    const pn = (v?: string) => parseFloat((v ?? "0").replace(",", ".")) || 0;
    const result: any[] = [];

    for (const [receiptId, records] of Object.entries(grouped)) {
      const first = records[0];
      const type: "ticket" | "invoice" =
        (first["TIPO DE DOCUMENTO"] ?? "").toUpperCase() === "TICKET" ? "ticket" : "invoice";
      const items = records.map(r => ({
        baseAmount: pn(r["ANTES DE IMPUESTOS"]),
        vatRate:    pn(r["PORCENTAJE IMPUESTO"]),
        vatAmount:  pn(r["TOTAL IMPUESTO"]),
      }));
      const totalBase  = Math.round(items.reduce((s, it) => s + it.baseAmount, 0) * 100) / 100;
      const totalVat   = Math.round(items.reduce((s, it) => s + it.vatAmount,  0) * 100) / 100;
      const irpfRate   = pn(first["IRPF %"]);
      const irpfAmount = pn(first["IRPF TOTAL"]);
      result.push({
        pleoReceiptId:        receiptId,
        type,
        employee:             (first["EMPLEADO"]                  ?? "").trim(),
        supplier:             (first["PROVEEDOR"]                 ?? "").trim(),
        supplierTaxId:        (first["CIF"]                       ?? "").trim(),
        supplierNumber:       (first["Número de Factura"]         ?? "").trim(),
        subAccountCode:       (first["CODIGO PRESUPUESTO"]        ?? "").trim(),
        subAccountDescription:(first["DESCRIPCIÓN NUMERO CUENTA"] ?? "").trim(),
        description:          (first["DESCRIPCION"] || first["NOTAS"] || "").trim(),
        date:                 (first["FECHA FACTURA/TICKET"] || first["FECHA FACTURA"] || "").trim(),
        pleoUrl:              (first["URL"]                       ?? "").trim(),
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
      const msg = err?.message ? `Error: ${err.message}` : "Error al leer el archivo";
      showToast("error", msg);
      setImportFile(null);
      setImportPreview([]);
    }
  };

  const handleImportExpenses = async () => {
    if (!selectedEnvelope || !selectedBox || importPreview.length === 0) return;
    setImporting(true);
    try {
      const batch = writeBatch(db);
      let invoiceNum = selectedBox.nextInvoiceNumber, ticketNum = selectedBox.nextTicketNumber;
      let totalBase = selectedEnvelope.totalBase, totalVat = selectedEnvelope.totalVat;
      let totalAmount = selectedEnvelope.totalAmount, expenseCount = selectedEnvelope.expenseCount;
      // Duplicate check: pleoReceiptId across ALL envelopes, and taxId+invoiceNumber for facturas
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
        const displayNumber = `BOX-${selectedBox.code}-${isTicket ? "T" : "F"}-${String(num).padStart(4, "0")}`;
        let expenseDate = new Date();
        if (exp.date) {
          const p = exp.date.split("/");
          if (p.length === 3) expenseDate = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
        }
        // Auto-detect conflicts
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
          items: exp.items || [], baseAmount: exp.baseAmount || 0, vatAmount: exp.vatAmount || 0,
          irpfRate: exp.irpfRate || 0, irpfAmount: exp.irpfAmount || 0, totalAmount: exp.totalAmount || 0,
          pleoAmount: pleoAmount,
          conflictType: autoConflictType,
          conflictNote: autoConflictNote,
          status: "pending", createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        totalBase += exp.baseAmount || 0;
        totalVat += exp.vatAmount || 0;
        totalAmount += exp.totalAmount || 0;
        expenseCount++;
      }
      batch.update(doc(db, `projects/${projectId}/cardEnvelopes`, selectedEnvelope.id), {
        totalBase, totalVat, totalAmount, expenseCount,
      });
      batch.update(doc(db, `projects/${projectId}/cards`, selectedBox.id), {
        nextInvoiceNumber: invoiceNum, nextTicketNumber: ticketNum,
      });
      await batch.commit();
      showToast("success", `${importPreview.length} gastos importados`);
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview([]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "Error al importar"); } finally { setImporting(false); }
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
    } catch { showToast("error", "Error al revisar"); }
  };

  // helpers for card expense list (same pattern as transfers)
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
      const boxSnap = await getDoc(doc(db, `projects/${projectId}/cards`, selectedBox.id));
      const boxData = boxSnap.data() || {};
      let nextInvoice = boxData.nextInvoiceNumber ?? 1;
      let nextTicket  = boxData.nextTicketNumber  ?? 1;
      let addedBase = 0, addedVat = 0, addedTotal = 0;
      const batch = writeBatch(db);

      for (const exp of valid) {
        const isTicket = exp.type === "ticket";
        const num = isTicket ? nextTicket++ : nextInvoice++;
        const displayNumber = `BOX-${selectedBox.code}-${isTicket ? "T" : "F"}-${String(num).padStart(4, "0")}`;
        const { baseAmount, vatAmount, irpfAmount, totalAmount } = computeExpenseTotal(exp);

        const dateParts = exp.date.split("/");
        const expenseDate = dateParts.length === 3
          ? new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]))
          : new Date();

        let documentUrl = "";
        if (exp.file) {
          const ext = exp.file.name.split(".").pop() ?? "pdf";
          const sRef = ref(storage, `projects/${projectId}/cardExpenses/${displayNumber}.${ext}`);
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
            baseAmount: it.baseAmount,
            vatRate: it.vatRate,
            vatAmount: Math.round(it.baseAmount * it.vatRate / 100 * 100) / 100,
          })),
          baseAmount, vatAmount, irpfRate: exp.irpfRate, irpfAmount, totalAmount,
          pleoAmount: 0, conflictType: null, conflictNote: "",
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
      });
      batch.update(doc(db, `projects/${projectId}/cards`, selectedBox.id), {
        nextInvoiceNumber: nextInvoice,
        nextTicketNumber:  nextTicket,
      });
      await batch.commit();
      showToast("success", `${valid.length} gasto${valid.length > 1 ? "s" : ""} añadido${valid.length > 1 ? "s" : ""}`);
      setShowManualExpenseModal(false);
      setCardExpensesList([]);
      loadData();
    } catch (e: any) {
      showToast("error", e?.message ?? "Error al añadir gasto");
    } finally { setManualExpenseSaving(false); }
  };

  const handleCloseEnvelope = async (envelope: Envelope) => {
    const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
    const pending = envExpenses.filter(e => e.status === "pending").length;
    if (pending > 0) return showToast("error", `${pending} gastos sin revisar`);
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
    } catch { showToast("error", "Error al cerrar sobre"); }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRANSFER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  const handleCreateTransferEnvelope = async () => {
    if (!transferEnvelopeForm.paymentDate.trim()) return showToast("error", "Fecha de pago obligatoria");
    setSaving(true);
    try {
      const num = nextTransferNumber;
      const displayNumber = `TRF-${String(num).padStart(3, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/transferEnvelopes`), {
        number: num, displayNumber,
        paymentDate: transferEnvelopeForm.paymentDate.trim(),
        status: "draft", totalBase: 0, totalVat: 0, totalAmount: 0, expenseCount: 0,
        notes: transferEnvelopeForm.notes.trim() || "",
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      await updateDoc(doc(db, `projects/${projectId}`), { nextTransferNumber: num + 1 });
      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateTransferEnvelopeModal(false);
      setTransferEnvelopeForm({ paymentDate: "", notes: "" });
      loadData();
    } catch { showToast("error", "Error al crear sobre"); } finally { setSaving(false); }
  };

  const canDeleteTransferEnvelope = (envelope: TransferEnvelope) => envelope.status !== "transferred";

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
    } catch { showToast("error", "Error al eliminar sobre"); } finally { setSaving(false); }
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

  const updateExpenseInList = (index: number, field: string, value: any) => {
    setExpensesList(prev => prev.map((exp, i) => i === index ? { ...exp, [field]: value } : exp));
  };

  const updateExpenseItem = (expIndex: number, itemIndex: number, field: string, value: any) => {
    setExpensesList(prev => prev.map((exp, i) => {
      if (i !== expIndex) return exp;
      const newItems = exp.items.map((item, j) => j === itemIndex ? { ...item, [field]: value } : item);
      return { ...exp, items: newItems };
    }));
  };

  const addItemToExpense = (expIndex: number) => {
    setExpensesList(prev => prev.map((exp, i) => {
      if (i !== expIndex) return exp;
      return { ...exp, items: [...exp.items, createEmptyItem()] };
    }));
  };

  const removeItemFromExpense = (expIndex: number, itemIndex: number) => {
    setExpensesList(prev => prev.map((exp, i) => {
      if (i !== expIndex || exp.items.length <= 1) return exp;
      return { ...exp, items: exp.items.filter((_, j) => j !== itemIndex) };
    }));
  };

  const removeExpenseFromList = (index: number) => {
    setExpensesList(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddAllExpenses = async () => {
    if (!selectedTransferEnvelope) return;
    if (!expensePersonForm.name.trim()) return showToast("error", "Nombre de persona obligatorio");
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
          personName: expensePersonForm.name.trim(),
          personDepartment: expensePersonForm.department || "",
          personIban: expensePersonForm.iban.trim() || "",
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
      setExpensePersonForm({ name: "", department: "", iban: "" });
      setExpensesList([]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "Error al añadir gastos"); } finally { setSaving(false); }
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
    } catch { showToast("error", "Error al eliminar gasto"); }
  };

  const handleSendEnvelope = async (envelope: TransferEnvelope) => {
    if (envelope.expenseCount === 0) return showToast("error", "Añade al menos un gasto");
    try {
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, envelope.id), { status: "pending" });
      showToast("success", "Sobre enviado a pendiente");
      loadData();
    } catch { showToast("error", "Error al enviar"); }
  };

  const handleMarkTransferred = async () => {
    if (!selectedTransferEnvelope || !transferRef.trim()) return showToast("error", "Referencia obligatoria");
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/transferEnvelopes`, selectedTransferEnvelope.id), {
        status: "transferred", transferredAt: Timestamp.now(),
        transferredBy: userId, transferredByName: userName,
        transferReference: transferRef.trim(),
      });
      showToast("success", "Transferencia registrada");
      setShowMarkTransferredModal(false);
      setTransferRef("");
      loadData();
    } catch { showToast("error", "Error al registrar"); } finally { setSaving(false); }
  };

  // Derived Data
  const filteredBoxes = boxes.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.code.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const filteredTransferEnvelopes = transferEnvelopes.filter(e =>
    e.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.paymentDate.includes(searchTerm)
  );
  const cardEnvelopes = selectedBox ? envelopes.filter(e => e.boxId === selectedBox.id) : [];
  const envelopeExpenses = selectedEnvelope ? expenses.filter(e => e.envelopeId === selectedEnvelope.id) : [];
  const currentTransferExpenses = selectedTransferEnvelope
    ? transferExpenses.filter(e => e.envelopeId === selectedTransferEnvelope.id)
    : [];
  const openEnvelopes = envelopes.filter(e => e.status === "open").length;
  const pendingTransfers = transferEnvelopes.filter(e => e.status === "pending").length;
  const totalTarjetasAmount = expenses.reduce((s, e) => s + e.totalAmount, 0);
  const totalTransferAmount = transferEnvelopes.reduce((s, e) => s + e.totalAmount, 0);

  // ─── Loading / Access ─────────────────────────────────────────────────────────
  if (loading || permissionsLoading) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasAccess || accessError) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={28} className="text-red-500" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">{accessError}</p>
        <Link href={`/project/${projectId}/accounting`}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium"
          style={{ backgroundColor: "#2F52E0" }}>
          <ArrowLeft size={16} /> Volver
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
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400 font-medium">Filma Accounting</span>
                <ChevronRight size={14} className="text-slate-300" />
                <span className="text-2xl font-bold bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">BOX</span>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl ml-6">
                <button
                  onClick={() => { setMainTab("tarjetas"); setSelectedBox(null); setSelectedEnvelope(null); setSelectedTransferEnvelope(null); setSearchTerm(""); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === "tarjetas" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                  <CreditCard size={15} /> Tarjetas
                  {openEnvelopes > 0 && (
                    <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{openEnvelopes}</span>
                  )}
                </button>
                <button
                  onClick={() => { setMainTab("transfers"); setSelectedBox(null); setSelectedEnvelope(null); setSelectedTransferEnvelope(null); setSearchTerm(""); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${mainTab === "transfers" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                  <Banknote size={15} /> Transferencias
                  {pendingTransfers > 0 && (
                    <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{pendingTransfers}</span>
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-4 text-xs text-slate-500">
                {mainTab === "tarjetas" ? (
                  <>
                    <span><strong className="text-slate-900">{boxes.length}</strong> cajas</span>
                    <span><strong className="text-amber-600">{openEnvelopes}</strong> sobres abiertos</span>
                    <span><strong className="text-slate-900">{fmt(totalTarjetasAmount)} €</strong></span>
                  </>
                ) : (
                  <>
                    <span><strong className="text-slate-900">{transferEnvelopes.length}</strong> sobres</span>
                    <span><strong className="text-amber-600">{pendingTransfers}</strong> pendientes</span>
                    <span><strong className="text-slate-900">{fmt(totalTransferAmount)} €</strong></span>
                  </>
                )}
              </div>
              <button
                onClick={() => mainTab === "tarjetas"
                  ? (setBoxForm({ name: "", code: "", department: "" }), setShowCreateBoxModal(true))
                  : (setTransferEnvelopeForm({ paymentDate: "", notes: "" }), setShowCreateTransferEnvelopeModal(true))}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90 shadow-lg shadow-orange-500/20"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                <Plus size={16} /> {mainTab === "tarjetas" ? "Nueva caja" : "Nuevo sobre"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-8">
        <div className="flex gap-6">

          {/* ── Left Panel ──────────────────────────────────────────────────────── */}
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-24">
              <div className="mb-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={mainTab === "tarjetas" ? "Buscar caja" : "Buscar sobre"}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              {/* Tarjetas list */}
              {mainTab === "tarjetas" ? (
                <div className="space-y-1">
                  {filteredBoxes.map(box => {
                    const openCount = envelopes.filter(e => e.boxId === box.id && e.status === "open").length;
                    const isSelected = selectedBox?.id === box.id;
                    return (
                      <button key={box.id} onClick={() => { setSelectedBox(box); setSelectedEnvelope(null); }}
                        className={`w-full text-left p-3 rounded-xl transition-all ${isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? "bg-white/20" : "bg-slate-100"}`}>
                              <CreditCard size={16} className={isSelected ? "text-white" : "text-slate-500"} />
                            </div>
                            <div>
                              <p className={`text-sm font-medium ${isSelected ? "text-white" : "text-slate-900"}`}>{box.name}</p>
                              <p className={`text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>
                                {box.code}{box.department ? ` · ${box.department}` : ""}
                              </p>
                            </div>
                          </div>
                          {openCount > 0 && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"}`}>
                              {openCount}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {filteredBoxes.length === 0 && (
                    <p className="text-center py-8 text-slate-400 text-sm">{searchTerm ? "Sin resultados" : "No hay tarjetas"}</p>
                  )}
                </div>
              ) : (
                /* Transfers list */
                <div className="space-y-1">
                  {filteredTransferEnvelopes.map(envelope => {
                    const sc = TRANSFER_STATUS_CONFIG[envelope.status];
                    const isSelected = selectedTransferEnvelope?.id === envelope.id;
                    return (
                      <button key={envelope.id} onClick={() => setSelectedTransferEnvelope(envelope)}
                        className={`w-full text-left p-3 rounded-xl transition-all ${isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? "bg-white/20" : envelope.status === "transferred" ? "bg-emerald-50" : envelope.status === "pending" ? "bg-amber-50" : "bg-slate-100"}`}>
                              <Calendar size={16} className={isSelected ? "text-white" : envelope.status === "transferred" ? "text-emerald-500" : envelope.status === "pending" ? "text-amber-500" : "text-slate-400"} />
                            </div>
                            <div>
                              <p className={`text-sm font-medium ${isSelected ? "text-white" : "text-slate-900"}`}>{envelope.displayNumber}</p>
                              <p className={`text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>{envelope.paymentDate}</p>
                            </div>
                          </div>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : `${sc.bg} ${sc.text}`}`}>
                            {envelope.expenseCount}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredTransferEnvelopes.length === 0 && (
                    <p className="text-center py-8 text-slate-400 text-sm">{searchTerm ? "Sin resultados" : "No hay sobres"}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Right Panel ─────────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">

            {/* ── TARJETAS TAB ────────────────────────────────────────────────── */}
            {mainTab === "tarjetas" ? (
              !selectedBox ? (
                <div className="flex items-center justify-center h-96">
                  <p className="text-sm text-slate-400">{boxes.length === 0 ? "No hay cajas creadas" : "Selecciona una caja"}</p>
                </div>
              ) : !selectedEnvelope ? (
                /* Box detail */
                <div>
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-900">{selectedBox.name}</h2>
                      <p className="text-sm text-slate-500">Código: {selectedBox.code}{selectedBox.department ? ` · ${selectedBox.department}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditBoxForm({ name: selectedBox.name, code: selectedBox.code }); setShowEditBoxModal(true); }}
                        className="flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">
                        <Edit size={14} /> Editar
                      </button>
                      {canDeleteBox(selectedBox) && (
                        <button onClick={() => setShowDeleteBoxModal(true)}
                          className="flex items-center gap-2 px-3 py-2 border border-red-100 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50">
                          <Trash2 size={14} /> Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-slate-500">{cardEnvelopes.length} sobres</p>
                    <button onClick={() => setShowCreateEnvelopeModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
                      <Plus size={16} /> Nuevo sobre
                    </button>
                  </div>
                  {cardEnvelopes.length === 0 ? (
                    <p className="text-center py-16 text-sm text-slate-400">No hay sobres en esta caja</p>
                  ) : (
                    <div className="space-y-2">
                      {cardEnvelopes.map(envelope => {
                        const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
                        const pendingCount = envExpenses.filter(e => e.status === "pending").length;
                        const conflictCount = envExpenses.filter(e => !!e.conflictType).length;
                        const sc = STATUS_CONFIG[envelope.status];
                        return (
                          <div key={envelope.id} className="p-4 border border-slate-200 rounded-xl hover:border-slate-300 transition-all">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setSelectedEnvelope(envelope)}>
                                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                  <Layers size={18} className="text-slate-500" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-slate-900">{envelope.displayNumber}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                  </div>
                                  <p className="text-xs text-slate-500">
                                    {envelope.expenseCount} gastos · {fmt(envelope.totalAmount)} €
                                    {pendingCount > 0 && <span className="text-amber-600 ml-2">· {pendingCount} pendientes</span>}
                                    {conflictCount > 0 && <span className="text-amber-500 ml-2">· {conflictCount} con incidencia</span>}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">{fmtDate(envelope.createdAt)}</span>
                                {canDeleteEnvelope(envelope) && envelope.status !== "closed" && (
                                  <button onClick={e => { e.stopPropagation(); setShowDeleteEnvelopeModal(envelope); }}
                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                                <ChevronRight size={16} className="text-slate-400 cursor-pointer" onClick={() => setSelectedEnvelope(envelope)} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* Envelope detail */
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <button onClick={() => setSelectedEnvelope(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                      <ArrowLeft size={18} />
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold text-slate-900">{selectedEnvelope.displayNumber}</h2>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[selectedEnvelope.status].bg} ${STATUS_CONFIG[selectedEnvelope.status].text}`}>
                          {STATUS_CONFIG[selectedEnvelope.status].label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500">
                        {selectedEnvelope.expenseCount} gastos · Base: {fmt(selectedEnvelope.totalBase)} € · Total: {fmt(selectedEnvelope.totalAmount)} €
                        {envelopeExpenses.filter(e => !!e.conflictType).length > 0 && (
                          <span className="ml-2 text-amber-500">
                            · {envelopeExpenses.filter(e => !!e.conflictType).length} incidencia{envelopeExpenses.filter(e => !!e.conflictType).length > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    </div>
                    {selectedEnvelope.status === "open" && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowImportModal(true)}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                          <Upload size={16} /> Importar Excel
                        </button>
                        <button onClick={() => { setCardExpensesList([createEmptyCardExpense()]); setShowManualExpenseModal(true); }}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                          <Plus size={16} /> Añadir gasto
                        </button>
                        <button
                          onClick={() => handleCloseEnvelope(selectedEnvelope)}
                          disabled={envelopeExpenses.some(e => e.status === "pending")}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                          <Lock size={16} /> Cerrar sobre
                        </button>
                      </div>
                    )}
                  </div>
                  {envelopeExpenses.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <p className="text-sm text-slate-400 mb-4">No hay gastos en este sobre</p>
                        {selectedEnvelope.status === "open" && (
                          <div className="flex gap-2 justify-center">
                            <button onClick={() => setShowImportModal(true)}
                              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                              <Upload size={16} /> Importar Excel
                            </button>
                            <button onClick={() => { setCardExpensesList([createEmptyCardExpense()]); setShowManualExpenseModal(true); }}
                              className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium"
                              style={{ backgroundColor: "#2F52E0" }}>
                              <Plus size={16} /> Añadir gasto
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-4 py-3 font-medium text-slate-600">Número</th>
                            <th className="text-left px-4 py-3 font-medium text-slate-600">Proveedor</th>
                            <th className="text-left px-4 py-3 font-medium text-slate-600">Cuenta</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600">Base</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600">IVA</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                            <th className="text-center px-4 py-3 font-medium text-slate-600">Estado</th>
                            <th className="text-center px-4 py-3 font-medium text-slate-600">Acc.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {envelopeExpenses.map(expense => {
                            const sc = EXPENSE_STATUS_CONFIG[expense.status];
                            const hasConflict = !!expense.conflictType;
                            const conflictCfg = hasConflict ? CONFLICT_CONFIG[expense.conflictType!] : null;
                            const isDrawerOpen = drawerExpense?.id === expense.id;
                            return (
                              <tr key={expense.id}
                                className={`hover:bg-slate-50 cursor-pointer transition-colors ${isDrawerOpen ? "bg-amber-50/40" : ""}`}
                                onClick={() => openDrawer(expense)}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {expense.type === "ticket"
                                      ? <Receipt size={14} className="text-amber-500" />
                                      : <FileText size={14} className="text-blue-500" />}
                                    <span className="font-mono text-xs">{expense.displayNumber}</span>
                                  </div>
                                  {hasConflict && (
                                    <div className="flex items-center gap-1 mt-1">
                                      <Info size={11} className="text-amber-500 flex-shrink-0" />
                                      <span className="text-xs text-amber-600">{conflictCfg!.label}</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <p className="font-medium text-slate-900 truncate max-w-[180px]">{expense.supplier}</p>
                                  <p className="text-xs text-slate-500">{expense.supplierTaxId}</p>
                                </td>
                                <td className="px-4 py-3">
                                  {(() => {
                                    const missing = expense.subAccountCode && !subAccounts.some(sa => sa.code === expense.subAccountCode);
                                    return missing ? (
                                      <div>
                                        <span className="font-mono text-xs text-red-500 font-medium">{expense.subAccountCode}</span>
                                        <p className="text-xs text-red-400 mt-0.5">La cuenta no existe en el proyecto</p>
                                      </div>
                                    ) : (
                                      <span className="font-mono text-xs text-slate-600">{expense.subAccountCode}</span>
                                    );
                                  })()}
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{fmt(expense.baseAmount)}</td>
                                <td className="px-4 py-3 text-right font-mono text-emerald-600">+{fmt(expense.vatAmount)}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className="font-mono font-medium">{fmt(expense.totalAmount)}</span>
                                  {hasConflict && expense.pleoAmount && Math.abs(expense.pleoAmount - expense.totalAmount) > 0.02 && (
                                    <p className="text-xs text-amber-500 font-mono">Pleo: {fmt(expense.pleoAmount)}</p>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                </td>
                                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-center gap-1">
                                    {expense.pleoUrl && (
                                      <a href={expense.pleoUrl} target="_blank" rel="noopener noreferrer"
                                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">
                                        <ExternalLink size={14} />
                                      </a>
                                    )}
                                    {expense.status === "pending" && selectedEnvelope.status === "open" && (
                                      <button onClick={() => handleReviewExpense(expense)}
                                        className="p-1.5 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 rounded">
                                        <Check size={14} />
                                      </button>
                                    )}
                                    <button onClick={() => openDrawer(expense)}
                                      className={`p-1.5 rounded transition-colors ${isDrawerOpen ? "text-amber-500 bg-amber-50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`}>
                                      <PanelRightOpen size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            ) : (
              /* ── TRANSFERS TAB ────────────────────────────────────────────────── */
              !selectedTransferEnvelope ? (
                <div className="flex items-center justify-center h-96">
                  <p className="text-sm text-slate-400">
                    {transferEnvelopes.length === 0 ? "No hay sobres de transferencia" : "Selecciona un sobre"}
                  </p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <button onClick={() => setSelectedTransferEnvelope(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                      <ArrowLeft size={18} />
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-semibold text-slate-900">{selectedTransferEnvelope.displayNumber}</h2>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${TRANSFER_STATUS_CONFIG[selectedTransferEnvelope.status].bg} ${TRANSFER_STATUS_CONFIG[selectedTransferEnvelope.status].text}`}>
                          {TRANSFER_STATUS_CONFIG[selectedTransferEnvelope.status].label}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500">
                        Fecha de pago: {selectedTransferEnvelope.paymentDate} · {selectedTransferEnvelope.expenseCount} gastos · Total: {fmt(selectedTransferEnvelope.totalAmount)} €
                      </p>
                    </div>
                    {selectedTransferEnvelope.status === "draft" && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setExpensePersonForm({ name: "", department: "", iban: "" }); setExpensesList([createEmptyExpense()]); setShowAddExpenseModal(true); }}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                          <Plus size={16} /> Añadir gasto
                        </button>
                        <button
                          onClick={() => handleSendEnvelope(selectedTransferEnvelope)}
                          disabled={selectedTransferEnvelope.expenseCount === 0}
                          className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                          <Send size={16} /> Enviar
                        </button>
                        {canDeleteTransferEnvelope(selectedTransferEnvelope) && (
                          <button onClick={() => setShowDeleteTransferEnvelopeModal(selectedTransferEnvelope)}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}
                    {selectedTransferEnvelope.status === "pending" && (
                      <button
                        onClick={() => { setTransferRef(""); setShowMarkTransferredModal(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700">
                        <Check size={16} /> Marcar transferido
                      </button>
                    )}
                  </div>

                  {selectedTransferEnvelope.status === "transferred" && (
                    <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
                      <CheckSquare size={18} className="text-emerald-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-emerald-800">Transferencia realizada</p>
                        <p className="text-xs text-emerald-600">
                          Ref: {selectedTransferEnvelope.transferReference} · Por {selectedTransferEnvelope.transferredByName} · {fmtDate(selectedTransferEnvelope.transferredAt)}
                        </p>
                      </div>
                    </div>
                  )}

                  {selectedTransferEnvelope.notes && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                      <p className="text-xs text-amber-700"><strong>Notas:</strong> {selectedTransferEnvelope.notes}</p>
                    </div>
                  )}

                  {currentTransferExpenses.length === 0 ? (
                    <div className="flex items-center justify-center h-48">
                      <div className="text-center">
                        <p className="text-sm text-slate-400 mb-4">No hay gastos en este sobre</p>
                        {selectedTransferEnvelope.status === "draft" && (
                          <button
                            onClick={() => { setExpensePersonForm({ name: "", department: "", iban: "" }); setExpensesList([createEmptyExpense()]); setShowAddExpenseModal(true); }}
                            className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium"
                            style={{ backgroundColor: "#2F52E0" }}>
                            <Plus size={16} /> Añadir gasto
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-4 py-3 font-medium text-slate-600 w-[200px]">Persona</th>
                            <th className="text-left px-4 py-3 font-medium text-slate-600 w-[160px]">Proveedor</th>
                            <th className="text-left px-4 py-3 font-medium text-slate-600">Cuentas</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[90px]">Base</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[80px]">IVA</th>
                            <th className="text-right px-4 py-3 font-medium text-slate-600 w-[90px]">Total</th>
                            <th className="text-center px-2 py-3 font-medium text-slate-600 w-[60px]"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {currentTransferExpenses.map(exp => {
                            const displayItems = exp.items && exp.items.length > 0
                              ? exp.items
                              : [{ subAccountCode: exp.subAccountCode || "", subAccountDescription: exp.subAccountDescription || "", baseAmount: exp.baseAmount, vatRate: 0, vatAmount: exp.vatAmount }];
                            const ibanValid = exp.personIban ? validateIban(exp.personIban) : null;
                            const bank = exp.personIban ? detectBank(exp.personIban) : null;
                            return (
                              <tr key={exp.id} className="hover:bg-slate-50 align-top">
                                {/* ── Persona column ── */}
                                <td className="px-4 py-3">
                                  <p className="font-medium text-slate-900 leading-tight">
                                    {exp.personName}
                                    {exp.personDepartment && (
                                      <span className="font-normal text-slate-400"> · {exp.personDepartment}</span>
                                    )}
                                  </p>
                                  {exp.personIban && (
                                    <p className="font-mono text-xs text-slate-400 mt-0.5 leading-tight break-all">
                                      {exp.personIban}
                                      {bank && (
                                        <span className="font-sans not-italic ml-1 text-slate-300">· {bank}</span>
                                      )}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <p className="text-slate-900 truncate" title={exp.supplier}>{exp.supplier}</p>
                                  <p className="text-xs text-slate-500">{exp.date}</p>
                                </td>
                                <td className="px-4 py-3">
                                  {displayItems.map((item, idx) => (
                                    <div key={idx} className={idx > 0 ? "mt-1 pt-1 border-t border-slate-100" : ""}>
                                      <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                        {item.subAccountCode}
                                      </span>
                                      {displayItems.length > 1 && (
                                        <span className="ml-2 text-xs text-slate-500">{fmt(item.baseAmount)} €</span>
                                      )}
                                    </div>
                                  ))}
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{fmt(exp.baseAmount)}</td>
                                <td className="px-4 py-3 text-right font-mono text-emerald-600">+{fmt(exp.vatAmount)}</td>
                                <td className="px-4 py-3 text-right font-mono font-medium">{fmt(exp.totalAmount)}</td>
                                <td className="px-2 py-3 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {exp.attachmentUrl && (
                                      <a href={exp.attachmentUrl} target="_blank" rel="noopener noreferrer"
                                        className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Ver documento">
                                        <Eye size={14} />
                                      </a>
                                    )}
                                    {selectedTransferEnvelope.status === "draft" && (
                                      <button onClick={() => handleDeleteExpense(exp)}
                                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200">
                          <tr>
                            <td colSpan={3} className="px-4 py-3 text-right font-semibold text-slate-600">Total</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(selectedTransferEnvelope.totalBase)}</td>
                            <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-600">+{fmt(selectedTransferEnvelope.totalVat)}</td>
                            <td className="px-4 py-3 text-right font-mono font-bold">{fmt(selectedTransferEnvelope.totalAmount)} €</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* EXPENSE DRAWER (panel lateral de edición y conflictos)                  */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {/* Backdrop */}
      {drawerExpense && (
        <div className="fixed inset-0 z-30 bg-black/10 backdrop-blur-[1px]" onClick={closeDrawer} />
      )}

      {/* Drawer panel */}
      <div className={`fixed top-0 right-0 h-full w-[480px] bg-white shadow-2xl z-40 flex flex-col transition-transform duration-300 ease-out ${drawerExpense ? "translate-x-0" : "translate-x-full"}`}>
        {drawerExpense && (() => {
          const hasConflict = !!drawerExpense.conflictType;
          const conflictCfg = hasConflict ? CONFLICT_CONFIG[drawerExpense.conflictType!] : null;
          const amountDiff = drawerExpense.pleoAmount && drawerExpense.pleoAmount > 0
            ? Math.round((drawerExpense.pleoAmount - drawerExpense.totalAmount) * 100) / 100
            : null;
          return (
            <>
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${drawerExpense.type === "ticket" ? "bg-amber-50" : "bg-blue-50"}`}>
                    {drawerExpense.type === "ticket"
                      ? <Receipt size={16} className="text-amber-500" />
                      : <FileText size={16} className="text-blue-500" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{drawerExpense.displayNumber}</p>
                    <p className="text-xs text-slate-500">{drawerExpense.supplier}</p>
                  </div>
                </div>
                <button onClick={closeDrawer} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
              </div>

              <div className="flex-1 overflow-y-auto">

                {/* ── Aviso de conflicto activo ── */}
                {hasConflict && (
                  <div className="mx-5 mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                    <div className="flex items-start gap-2">
                      <Info size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-800">{conflictCfg!.label}</p>
                        <p className="text-xs text-amber-600 mt-0.5">{conflictCfg!.description}</p>
                        {drawerExpense.conflictNote && (
                          <p className="text-xs text-amber-700 mt-1 italic">"{drawerExpense.conflictNote}"</p>
                        )}
                      </div>
                      <button onClick={handleResolveConflict} disabled={drawerSaving}
                        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors disabled:opacity-50">
                        <Check size={12} /> Resolver
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Importe Pleo vs contable ── */}
                {drawerExpense.pleoAmount && drawerExpense.pleoAmount > 0 && (
                  <div className="mx-5 mt-3">
                    <div className={`flex items-center justify-between p-2.5 rounded-lg text-xs ${amountDiff && Math.abs(amountDiff) > 0.02 ? "bg-amber-50 border border-amber-100" : "bg-slate-50"}`}>
                      <span className="text-slate-500">Cargo real en Pleo</span>
                      <span className={`font-mono font-semibold ${amountDiff && Math.abs(amountDiff) > 0.02 ? "text-amber-700" : "text-slate-700"}`}>
                        {fmt(drawerExpense.pleoAmount)} €
                        {amountDiff && Math.abs(amountDiff) > 0.02 && (
                          <span className="ml-2 text-amber-500">({amountDiff > 0 ? "+" : ""}{fmt(amountDiff)} vs factura)</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Edición de datos del gasto ── */}
                <div className="px-5 mt-4 space-y-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Datos del gasto</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
                      <input type="text" value={drawerForm.supplier}
                        onChange={e => setDrawerForm(f => ({ ...f, supplier: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">CIF / NIF</label>
                      <input type="text" value={drawerForm.supplierTaxId}
                        onChange={e => setDrawerForm(f => ({ ...f, supplierTaxId: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nº Factura</label>
                      <input type="text" value={drawerForm.supplierNumber}
                        onChange={e => setDrawerForm(f => ({ ...f, supplierNumber: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                      <input type="text" value={drawerForm.date} placeholder="DD/MM/YYYY"
                        onChange={e => setDrawerForm(f => ({ ...f, date: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                  </div>

                  {/* ── Líneas de detalle ── */}
                  <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Líneas ({drawerItems.length})</span>
                      <button type="button"
                        onClick={() => setDrawerItems(prev => [...prev, { id: crypto.randomUUID(), subAccountCode: "", subAccountDescription: "", description: "", baseAmount: 0, vatRate: 21 }])}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
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
                              <button type="button"
                                onClick={() => setDrawerItems(prev => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                          {/* Cuenta */}
                          <div className="relative">
                            <button type="button"
                              onClick={() => {
                                setDrawerAccountSelectorItemIdx(drawerAccountSelectorItemIdx === idx ? null : idx);
                                setDrawerAccountSearch("");
                              }}
                              className={`w-full px-3 py-2 border rounded-lg text-xs text-left flex items-center justify-between hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 ${accountMissing ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
                              {item.subAccountCode
                                ? <span className={`font-mono ${accountMissing ? "text-red-600" : "text-slate-700"}`}>
                                    {item.subAccountCode}
                                    {accountMissing
                                      ? <span className="ml-2 font-sans text-red-500 font-medium">· La cuenta no existe en el proyecto</span>
                                      : <span className="ml-2 font-sans text-slate-400">{item.subAccountDescription}</span>}
                                  </span>
                                : <span className="text-slate-400">Seleccionar cuenta</span>}
                              <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                            </button>
                            {drawerAccountSelectorItemIdx === idx && (
                              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl">
                                <div className="p-2 border-b border-slate-100">
                                  <input type="text" value={drawerAccountSearch}
                                    onChange={e => setDrawerAccountSearch(e.target.value)}
                                    placeholder="Buscar cuenta"
                                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-900"
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
                              </div>
                            )}
                          </div>
                          {/* Descripción + importes */}
                          <input type="text" value={item.description} placeholder="Descripción"
                            onChange={e => setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, description: e.target.value } : it))}
                            className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-900" />
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">Base *</label>
                              <input type="number" step="0.01" value={item.baseAmount || ""}
                                onChange={e => setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, baseAmount: parseFloat(e.target.value) || 0 } : it))}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">IVA %</label>
                              <input type="number" step="1" value={item.vatRate}
                                onChange={e => setDrawerItems(prev => prev.map((it, i) => i === idx ? { ...it, vatRate: parseFloat(e.target.value) || 0 } : it))}
                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">Cuota IVA</label>
                              <div className="px-2 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs font-mono text-slate-500">
                                {fmt(Math.round((item.baseAmount || 0) * (item.vatRate || 0) / 100 * 100) / 100)} €
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {/* IRPF + Total global */}
                    <div className="flex items-center justify-between pt-1 px-1">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500">IRPF %</label>
                        <input type="number" step="1" value={drawerForm.irpfRate}
                          onChange={e => setDrawerForm(f => ({ ...f, irpfRate: e.target.value }))}
                          className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900 bg-white" />
                      </div>
                      <div className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs">
                        <span className="text-slate-400">Total:</span>
                        <span className="ml-1.5 font-mono font-semibold">
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

                {/* ── Sección de incidencia ── */}
                <div className="px-5 mt-5 pb-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Incidencia</p>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de incidencia</label>
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
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {drawerForm.conflictType && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nota explicativa</label>
                      <textarea value={drawerForm.conflictNote}
                        onChange={e => setDrawerForm(f => ({ ...f, conflictNote: e.target.value }))}
                        rows={3} placeholder="Explica la incidencia para que quede registrada..."
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none" />
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
                <div className="flex items-center gap-2">
                  {drawerExpense.pleoUrl && (
                    <a href={drawerExpense.pleoUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-white">
                      <ExternalLink size={12} /> Ver en Pleo
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={closeDrawer}
                    className="px-3 py-1.5 text-xs text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleSaveDrawer} disabled={drawerSaving}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ backgroundColor: "#2F52E0" }}>
                    <Save size={12} /> {drawerSaving ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* MODALS */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}

      {/* Create Box Modal */}
      {showCreateBoxModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreateBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva caja</h3>
              <button onClick={() => setShowCreateBoxModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del responsable *</label>
                <input type="text" value={boxForm.name}
                  onChange={e => { const name = e.target.value; setBoxForm({ ...boxForm, name, code: boxForm.code || generateCode(name) }); }}
                  placeholder="Ej: Lucía García"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Código *</label>
                <input type="text" value={boxForm.code}
                  onChange={e => setBoxForm({ ...boxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                  placeholder="Ej: LG" maxLength={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase" />
              </div>
              <div ref={departmentDropdownRef} className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-2">Departamento</label>
                <button type="button" onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between">
                  <span className={boxForm.department ? "text-slate-900" : "text-slate-400"}>{boxForm.department || "Seleccionar"}</span>
                  <ChevronDown size={16} className="text-slate-400" />
                </button>
                {showDepartmentDropdown && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                    <button type="button" onClick={() => { setBoxForm({ ...boxForm, department: "" }); setShowDepartmentDropdown(false); }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-400 hover:bg-slate-50">Sin departamento</button>
                    {departments.map(d => (
                      <button key={d} type="button" onClick={() => { setBoxForm({ ...boxForm, department: d }); setShowDepartmentDropdown(false); }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">{d}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateBoxModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleCreateBox} disabled={saving || !boxForm.name.trim() || !boxForm.code.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Creando..." : "Crear caja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Box Modal */}
      {showEditBoxModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowEditBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Editar caja</h3>
              <button onClick={() => setShowEditBoxModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre *</label>
                <input type="text" value={editBoxForm.name}
                  onChange={e => setEditBoxForm({ ...editBoxForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Código *</label>
                <input type="text" value={editBoxForm.code}
                  onChange={e => setEditBoxForm({ ...editBoxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                  maxLength={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowEditBoxModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleEditBox} disabled={saving || !editBoxForm.name.trim() || !editBoxForm.code.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Box Confirm */}
      {showDeleteBoxModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDeleteBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-4">
                <AlertTriangle size={22} className="text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Eliminar caja</h3>
              <p className="text-sm text-slate-500 mb-6">
                Se eliminará <strong>{selectedBox.name}</strong> y todos sus sobres y gastos pendientes.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteBoxModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={handleDeleteBox} disabled={saving}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Envelope Modal */}
      {showCreateEnvelopeModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreateEnvelopeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo sobre</h3>
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 text-center py-8">
              <p className="text-slate-900 font-medium mb-1">
                ENV-{selectedBox.code}-{String(selectedBox.nextEnvelopeNumber || 1).padStart(3, "0")}
              </p>
              <p className="text-sm text-slate-500">Se creará un nuevo sobre para {selectedBox.name}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleCreateEnvelope} disabled={saving}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Creando..." : "Crear sobre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Envelope Confirm */}
      {showDeleteEnvelopeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDeleteEnvelopeModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-4">
                <AlertTriangle size={22} className="text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Eliminar sobre</h3>
              <p className="text-sm text-slate-500 mb-6">
                Se eliminará <strong>{showDeleteEnvelopeModal.displayNumber}</strong> y todos sus gastos.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteEnvelopeModal(null)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={() => handleDeleteEnvelope(showDeleteEnvelopeModal)} disabled={saving}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Añadir gasto manual ───────────────────────────────────────── */}
      {showManualExpenseModal && selectedEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowManualExpenseModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Añadir gastos</h3>
                <p className="text-sm text-slate-500">{selectedEnvelope.displayNumber} · {selectedBox?.name}</p>
              </div>
              <button onClick={() => setShowManualExpenseModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-6">

              {/* ── Lista de gastos ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gastos ({cardExpensesList.length})</p>
                  <button onClick={() => setCardExpensesList(prev => [...prev, createEmptyCardExpense()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
                    <Plus size={14} /> Nuevo gasto
                  </button>
                </div>
                <div className="space-y-4">
                  {cardExpensesList.map((exp, idx) => (
                    <div key={exp.id} className="p-4 border border-slate-200 rounded-xl space-y-4">

                      {/* Header del gasto */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gasto {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {exp.file && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                              <Paperclip size={12} /> {exp.file.name.length > 20 ? exp.file.name.substring(0, 20) + "…" : exp.file.name}
                            </span>
                          )}
                          {cardExpensesList.length > 1 && (
                            <button onClick={() => removeCardExpense(idx)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Datos generales */}
                      <div className="grid grid-cols-12 gap-3">
                        {/* Tipo */}
                        <div className="col-span-2 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                          <button type="button"
                            onClick={() => setShowCardTypeDropdown(showCardTypeDropdown === idx ? null : idx)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm flex items-center justify-between hover:border-slate-300">
                            <span className="flex items-center gap-1.5">
                              {exp.type === "ticket"
                                ? <><Receipt size={13} className="text-amber-500" /> Ticket</>
                                : <><FileText size={13} className="text-blue-500" /> Factura</>}
                            </span>
                            <ChevronDown size={13} className="text-slate-400" />
                          </button>
                          {showCardTypeDropdown === idx && (
                            <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                              <button type="button"
                                onClick={() => { updateCardExpense(idx, "type", "ticket"); setShowCardTypeDropdown(null); }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2">
                                <Receipt size={13} className="text-amber-500" /> Ticket
                              </button>
                              <button type="button"
                                onClick={() => { updateCardExpense(idx, "type", "invoice"); setShowCardTypeDropdown(null); }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2">
                                <FileText size={13} className="text-blue-500" /> Factura
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Fecha */}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                          <input type="text" value={exp.date}
                            onChange={e => updateCardExpense(idx, "date", e.target.value)}
                            placeholder="DD/MM/YYYY"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>

                        {/* Proveedor */}
                        <div className="col-span-3">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                          <input type="text" value={exp.supplier}
                            onChange={e => updateCardExpense(idx, "supplier", e.target.value)}
                            placeholder="Nombre del proveedor"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>

                        {/* CIF */}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            CIF / NIF {exp.type === "invoice" && <span className="text-red-400">*</span>}
                          </label>
                          <input type="text" value={exp.supplierTaxId}
                            onChange={e => updateCardExpense(idx, "supplierTaxId", e.target.value)}
                            placeholder="B12345678"
                            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 ${exp.type === "invoice" && !exp.supplierTaxId.trim() ? "border-red-300 bg-red-50/30" : "border-slate-200"}`} />
                        </div>

                        {/* Nº Factura (solo si es factura) */}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">
                            {exp.type === "invoice" ? "Nº Factura" : "Referencia"}
                          </label>
                          <input type="text" value={exp.supplierNumber}
                            onChange={e => updateCardExpense(idx, "supplierNumber", e.target.value)}
                            placeholder={exp.type === "invoice" ? "FAC-2026-001" : "—"}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>

                        {/* IRPF */}
                        <div className="col-span-1">
                          <label className="block text-xs font-medium text-slate-600 mb-1">IRPF %</label>
                          <input type="number" value={exp.irpfRate}
                            onChange={e => updateCardExpense(idx, "irpfRate", parseFloat(e.target.value) || 0)}
                            step="1" placeholder="0"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>

                        {/* Documento */}
                        <div className="col-span-12 sm:col-span-0">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Documento</label>
                          <label className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                            <Upload size={14} className="text-slate-400" />
                            <span className="text-slate-500">{exp.file ? "Cambiar" : "Subir"}</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                              onChange={e => { if (e.target.files?.[0]) updateCardExpense(idx, "file", e.target.files[0]); }} />
                          </label>
                        </div>
                      </div>

                      {/* Líneas de detalle */}
                      <div className="bg-slate-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500">Líneas de detalle ({exp.items.length})</span>
                          <button onClick={() => addCardItem(idx)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                            <Plus size={12} /> Añadir línea
                          </button>
                        </div>
                        <div className="space-y-2">
                          {exp.items.map((item, itemIdx) => (
                            <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                              {/* Cuenta */}
                              <div className="col-span-3">
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
                                  {item.subAccountCode
                                    ? <span className="font-mono text-slate-700 truncate">{item.subAccountCode}</span>
                                    : <span className="text-slate-400">Cuenta</span>}
                                  <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                                </button>
                              </div>
                              {/* Descripción */}
                              <div className="col-span-4">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Descripción</label>}
                                <input type="text" value={item.description}
                                  onChange={e => updateCardItem(idx, itemIdx, "description", e.target.value)}
                                  placeholder="Descripción del gasto"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900" />
                              </div>
                              {/* Base */}
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Base *</label>}
                                <input type="number" value={item.baseAmount || ""}
                                  onChange={e => updateCardItem(idx, itemIdx, "baseAmount", parseFloat(e.target.value) || 0)}
                                  step="0.01" placeholder="0.00"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900" />
                              </div>
                              {/* IVA % */}
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">IVA %</label>}
                                <input type="number" value={item.vatRate}
                                  onChange={e => updateCardItem(idx, itemIdx, "vatRate", parseFloat(e.target.value) || 0)}
                                  step="1"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900" />
                              </div>
                              {/* Eliminar línea */}
                              <div className="col-span-1 flex justify-center">
                                {exp.items.length > 1 && (
                                  <button onClick={() => removeCardItem(idx, itemIdx)}
                                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Total del gasto */}
                      <div className="flex justify-end">
                        <div className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">
                          <span className="text-slate-400">Total gasto:</span>
                          <span className="ml-2 font-mono font-semibold">{fmt(computeExpenseTotal(exp).totalAmount)} €</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between flex-shrink-0">
              <p className="text-sm text-slate-500">
                {cardExpensesList.length > 0 && (
                  <>Total: <strong className="text-slate-900 font-mono">
                    {fmt(cardExpensesList.reduce((s, e) => s + computeExpenseTotal(e).totalAmount, 0))} €
                  </strong></>
                )}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowManualExpenseModal(false)}
                  className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={handleAddManualExpense} disabled={manualExpenseSaving}
                  className="px-5 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-2"
                  style={{ backgroundColor: "#2F52E0" }}>
                  {manualExpenseSaving ? "Guardando..." : <><Check size={15} /> Guardar gastos</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Import Tarjetas Modal */}
      {showImportModal && selectedEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Importar gastos</h3>
                <p className="text-sm text-slate-500">Sube el Excel de gastos de tarjeta</p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}
                className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {!importFile ? (
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".xlsx")) handleFileSelect(f); }}
                  className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${isDragging ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                  <Upload size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 mb-2">Arrastra el archivo Excel aquí</p>
                  <p className="text-sm text-slate-400 mb-4">o</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium cursor-pointer">
                    <FileSpreadsheet size={16} /> Seleccionar archivo
                    <input type="file" accept=".xlsx"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                      className="hidden" />
                  </label>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-4">
                    <FileSpreadsheet size={20} className="text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{importFile.name}</p>
                      <p className="text-xs text-slate-500">{importPreview.length} gastos detectados</p>
                    </div>
                    <button onClick={() => { setImportFile(null); setImportPreview([]); }}
                      className="p-1.5 text-slate-400 hover:bg-slate-200 rounded"><X size={16} /></button>
                  </div>
                  {importPreview.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600 w-[80px]">Tipo</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Proveedor / Empleado</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Cuenta · IVA</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600 w-[90px]">Base</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600 w-[90px]">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importPreview.slice(0, 15).map((exp, i) => {
                            // Detect duplicates for this preview row
                            const dupById   = expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId);
                            const invKey    = exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber
                              ? `${exp.supplierTaxId}||${exp.supplierNumber}` : null;
                            const dupByInv  = !!invKey && expenses.some(e =>
                              e.type === "invoice" && e.supplierTaxId === exp.supplierTaxId && e.supplierNumber === exp.supplierNumber
                            );
                            const isDup     = dupById || dupByInv;
                            const dupReason = dupById ? "ID Pleo ya importado" : dupByInv ? "Factura ya existe (mismo CIF + Nº)" : "";
                            // Resolved supplier name
                            const knownSupplier = cardSuppliers.find(s => s.taxId === exp.supplierTaxId);
                            const displaySupplier = knownSupplier ? knownSupplier.name : capitalizeSupplierName(exp.supplier);
                            const nameWasNormalized = knownSupplier && knownSupplier.name !== capitalizeSupplierName(exp.supplier);
                            return (
                            <tr key={i} className={`align-top ${isDup ? "bg-amber-50/60" : "hover:bg-slate-50"}`}>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {isDup && <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" title={dupReason} />}
                                  {exp.type === "ticket"
                                    ? <Receipt size={13} className="text-amber-500 flex-shrink-0" />
                                    : <FileText size={13} className="text-blue-500 flex-shrink-0" />}
                                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${exp.type === "ticket" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                                    {exp.type === "ticket" ? "Ticket" : "Factura"}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-1 pl-0.5">{exp.date}</p>
                                {isDup && <p className="text-xs text-amber-600 font-medium mt-0.5">{dupReason} — se omitirá</p>}
                              </td>
                              <td className="px-3 py-2.5">
                                <p className={`font-medium truncate max-w-[200px] ${isDup ? "text-slate-400 line-through" : "text-slate-900"}`} title={exp.supplier}>
                                  {displaySupplier}
                                </p>
                                {nameWasNormalized && (
                                  <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5">
                                    <Check size={10} /> Nombre fiscal aplicado
                                  </p>
                                )}
                                {exp.employee && <p className="text-xs text-slate-400 truncate">{exp.employee}</p>}
                                {exp.supplierTaxId && <p className="text-xs font-mono text-slate-400">{exp.supplierTaxId}</p>}
                              </td>
                              <td className="px-3 py-2.5">
                                {exp.items.map((item: any, j: number) => (
                                  <div key={j} className={`flex items-center gap-2 ${j > 0 ? "mt-0.5" : ""}`}>
                                    <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                                      {exp.subAccountCode || "—"}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                      {item.vatRate}% · {fmt(item.vatAmount)} €
                                    </span>
                                  </div>
                                ))}
                              </td>
                              <td className={`px-3 py-2.5 text-right font-mono ${isDup ? "text-slate-400" : "text-slate-700"}`}>{fmt(exp.baseAmount)}</td>
                              <td className={`px-3 py-2.5 text-right font-mono font-semibold ${isDup ? "text-slate-400" : "text-slate-900"}`}>{fmt(exp.totalAmount)} €</td>
                            </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200">
                          <tr>
                            <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-slate-500">TOTAL</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-700">
                              {fmt(importPreview.reduce((s: number, e: any) => s + e.baseAmount, 0))}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                              {fmt(importPreview.reduce((s: number, e: any) => s + e.totalAmount, 0))} €
                            </td>
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
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
              <span className="text-sm text-slate-500">
                {importPreview.length > 0 && (() => {
                  const dupCount = importPreview.filter(exp => {
                    if (expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId)) return true;
                    if (exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber)
                      return expenses.some(e => e.type === "invoice" && e.supplierTaxId === exp.supplierTaxId && e.supplierNumber === exp.supplierNumber);
                    return false;
                  }).length;
                  const newCount = importPreview.length - dupCount;
                  return (
                    <>
                      <strong className="text-slate-900">{newCount}</strong> nuevos
                      {dupCount > 0 && <> · <strong className="text-amber-600">{dupCount} duplicado{dupCount > 1 ? "s" : ""}</strong> (se omitirán)</>}
                      {" · "}Base: <strong className="text-slate-900">{fmt(importPreview.filter((_: any, i: number) => !expenses.some(e => e.pleoReceiptId === importPreview[i].pleoReceiptId)).reduce((s: number, e: any) => s + e.baseAmount, 0))} €</strong>
                    </>
                  );
                })()}
              </span>
              <div className="flex gap-3">
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}
                  className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={handleImportExpenses} disabled={importing || importPreview.length === 0}
                  className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                  {importing ? "Importando..." : (() => {
                    const dupCount = importPreview.filter(exp => {
                      if (expenses.some(e => e.pleoReceiptId === exp.pleoReceiptId)) return true;
                      if (exp.type === "invoice" && exp.supplierTaxId && exp.supplierNumber)
                        return expenses.some(e => e.type === "invoice" && e.supplierTaxId === exp.supplierTaxId && e.supplierNumber === exp.supplierNumber);
                      return false;
                    }).length;
                    const newCount = importPreview.length - dupCount;
                    return `Importar ${newCount} gasto${newCount !== 1 ? "s" : ""}${dupCount > 0 ? ` (omitir ${dupCount})` : ""}`;
                  })()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Transfer Envelope Modal */}
      {showCreateTransferEnvelopeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreateTransferEnvelopeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo sobre de transferencia</h3>
              <button onClick={() => setShowCreateTransferEnvelopeModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl text-center">
                <p className="text-slate-900 font-medium">TRF-{String(nextTransferNumber).padStart(3, "0")}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fecha de pago prevista *</label>
                <input type="text" value={transferEnvelopeForm.paymentDate}
                  onChange={e => setTransferEnvelopeForm({ ...transferEnvelopeForm, paymentDate: e.target.value })}
                  placeholder="DD/MM/YYYY"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Notas</label>
                <textarea value={transferEnvelopeForm.notes}
                  onChange={e => setTransferEnvelopeForm({ ...transferEnvelopeForm, notes: e.target.value })}
                  rows={2} placeholder="Observaciones"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateTransferEnvelopeModal(false)}
                className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleCreateTransferEnvelope} disabled={saving || !transferEnvelopeForm.paymentDate.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Creando..." : "Crear sobre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Transfer Envelope Confirm */}
      {showDeleteTransferEnvelopeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowDeleteTransferEnvelopeModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-4">
                <AlertTriangle size={22} className="text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Eliminar sobre</h3>
              <p className="text-sm text-slate-500 mb-6">
                Se eliminará <strong>{showDeleteTransferEnvelopeModal.displayNumber}</strong> y todos sus gastos.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteTransferEnvelopeModal(null)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={() => handleDeleteTransferEnvelope(showDeleteTransferEnvelopeModal)} disabled={saving}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpenseModal && selectedTransferEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddExpenseModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-900">Añadir gastos</h3>
              <button onClick={() => setShowAddExpenseModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto space-y-6">

              {/* ── Persona ── */}
              <div className="p-4 bg-slate-50 rounded-xl">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Datos de la persona</p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Nombre *</label>
                    <input type="text" value={expensePersonForm.name}
                      onChange={e => setExpensePersonForm({ ...expensePersonForm, name: e.target.value })}
                      placeholder="Nombre completo"
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white" />
                  </div>
                  <div ref={expenseDepartmentDropdownRef} className="relative">
                    <label className="block text-sm font-medium text-slate-700 mb-2">Departamento</label>
                    <button type="button" onClick={() => setShowExpenseDepartmentDropdown(!showExpenseDepartmentDropdown)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between bg-white hover:border-slate-300">
                      <span className={expensePersonForm.department ? "text-slate-900" : "text-slate-400"}>
                        {expensePersonForm.department || "Seleccionar"}
                      </span>
                      <ChevronDown size={16} className="text-slate-400" />
                    </button>
                    {showExpenseDepartmentDropdown && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                        <button type="button"
                          onClick={() => { setExpensePersonForm({ ...expensePersonForm, department: "" }); setShowExpenseDepartmentDropdown(false); }}
                          className="w-full px-4 py-2 text-left text-sm text-slate-400 hover:bg-slate-50">Sin departamento</button>
                        {departments.map(d => (
                          <button key={d} type="button"
                            onClick={() => { setExpensePersonForm({ ...expensePersonForm, department: d }); setShowExpenseDepartmentDropdown(false); }}
                            className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">{d}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">IBAN</label>
                    <input
                      type="text"
                      value={expensePersonForm.iban}
                      onChange={e => setExpensePersonForm({ ...expensePersonForm, iban: formatIban(e.target.value) })}
                      placeholder="ES00 0000 0000 0000 0000 0000"
                      className={`w-full px-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 font-mono text-sm bg-white transition-colors ${
                        expensePersonForm.iban && !validateIban(expensePersonForm.iban)
                          ? "border-red-300 focus:ring-red-400"
                          : expensePersonForm.iban && validateIban(expensePersonForm.iban)
                          ? "border-emerald-300 focus:ring-emerald-400"
                          : "border-slate-200 focus:ring-slate-900"
                      }`}
                    />
                    {expensePersonForm.iban && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {validateIban(expensePersonForm.iban) ? (
                          <>
                            <Check size={12} className="text-emerald-500 flex-shrink-0" />
                            <span className="text-xs text-emerald-600">IBAN válido</span>
                            {detectBank(expensePersonForm.iban) && (
                              <span className="text-xs text-slate-400">· {detectBank(expensePersonForm.iban)}</span>
                            )}
                          </>
                        ) : (
                          <>
                            <AlertCircle size={12} className="text-red-400 flex-shrink-0" />
                            <span className="text-xs text-red-500">IBAN no válido</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Gastos ── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gastos ({expensesList.length})</p>
                  <button onClick={() => setExpensesList([...expensesList, createEmptyExpense()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg">
                    <Plus size={14} /> Nuevo gasto
                  </button>
                </div>
                <div className="space-y-4">
                  {expensesList.map((exp, idx) => (
                    <div key={exp.id} className="p-4 border border-slate-200 rounded-xl space-y-4">
                      {/* Header del gasto */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gasto {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          {exp.file && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                              <Paperclip size={12} /> {exp.file.name.substring(0, 20)}...
                            </span>
                          )}
                          {expensesList.length > 1 && (
                            <button onClick={() => removeExpenseFromList(idx)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Datos generales del gasto */}
                      <div className="grid grid-cols-12 gap-3">
                        <div className="col-span-2 relative">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                          <button type="button"
                            onClick={() => setShowTypeDropdown(showTypeDropdown === idx ? null : idx)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-left text-sm flex items-center justify-between hover:border-slate-300">
                            <span className="text-slate-900">{exp.type === "ticket" ? "Ticket" : "Factura"}</span>
                            <ChevronDown size={14} className="text-slate-400" />
                          </button>
                          {showTypeDropdown === idx && (
                            <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                              <button type="button"
                                onClick={() => { updateExpenseInList(idx, "type", "ticket"); setShowTypeDropdown(null); }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Ticket</button>
                              <button type="button"
                                onClick={() => { updateExpenseInList(idx, "type", "invoice"); setShowTypeDropdown(null); }}
                                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">Factura</button>
                            </div>
                          )}
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                          <input type="text" value={exp.date}
                            onChange={e => updateExpenseInList(idx, "date", e.target.value)}
                            placeholder="DD/MM/YYYY"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>
                        <div className="col-span-4">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor *</label>
                          <input type="text" value={exp.supplier}
                            onChange={e => updateExpenseInList(idx, "supplier", e.target.value)}
                            placeholder="Nombre del proveedor"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">IRPF %</label>
                          <input type="number" value={exp.irpfRate}
                            onChange={e => updateExpenseInList(idx, "irpfRate", parseFloat(e.target.value) || 0)}
                            step="1"
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-slate-600 mb-1">Documento</label>
                          <label className="w-full px-3 py-2 border border-dashed border-slate-300 rounded-lg text-sm flex items-center justify-center gap-2 cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                            <Upload size={14} className="text-slate-400" />
                            <span className="text-slate-500">{exp.file ? "Cambiar" : "Subir"}</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                              onChange={e => { if (e.target.files?.[0]) updateExpenseInList(idx, "file", e.target.files[0]); }} />
                          </label>
                        </div>
                      </div>

                      {/* Líneas de detalle */}
                      <div className="bg-slate-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500">Líneas de detalle ({exp.items.length})</span>
                          <button onClick={() => addItemToExpense(idx)}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                            <Plus size={12} /> Añadir línea
                          </button>
                        </div>
                        <div className="space-y-2">
                          {exp.items.map((item, itemIdx) => (
                            <div key={item.id} className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-3">
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
                                  {item.subAccountCode
                                    ? <span className="font-mono text-slate-700 truncate">{item.subAccountCode}</span>
                                    : <span className="text-slate-400">Cuenta</span>}
                                  <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                                </button>
                              </div>
                              <div className="col-span-4">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Descripción</label>}
                                <input type="text" value={item.description}
                                  onChange={e => updateExpenseItem(idx, itemIdx, "description", e.target.value)}
                                  placeholder="Descripción"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900" />
                              </div>
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">Base *</label>}
                                <input type="number" value={item.baseAmount || ""}
                                  onChange={e => updateExpenseItem(idx, itemIdx, "baseAmount", parseFloat(e.target.value) || 0)}
                                  step="0.01" placeholder="0.00"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono" />
                              </div>
                              <div className="col-span-2">
                                {itemIdx === 0 && <label className="block text-xs font-medium text-slate-500 mb-1">IVA %</label>}
                                <input type="number" value={item.vatRate}
                                  onChange={e => updateExpenseItem(idx, itemIdx, "vatRate", parseFloat(e.target.value) || 0)}
                                  step="1"
                                  className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono" />
                              </div>
                              <div className="col-span-1 flex justify-center">
                                {exp.items.length > 1 && (
                                  <button onClick={() => removeItemFromExpense(idx, itemIdx)}
                                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Total del gasto */}
                      <div className="flex justify-end">
                        <div className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">
                          <span className="text-slate-400">Total gasto:</span>
                          <span className="ml-2 font-mono font-semibold">{fmt(computeExpenseTotal(exp).totalAmount)} €</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between flex-shrink-0 bg-white">
              <div className="text-sm text-slate-500">
                Total: <strong className="text-slate-900 font-mono">
                  {fmt(expensesList.reduce((sum, exp) => sum + computeExpenseTotal(exp).totalAmount, 0))} €
                </strong>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowAddExpenseModal(false)}
                  className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
                <button
                  onClick={handleAddAllExpenses}
                  disabled={saving || !expensePersonForm.name.trim() || expensesList.filter(e => e.supplier.trim() && e.items.some(item => item.baseAmount > 0 && item.subAccountCode)).length === 0}
                  className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: "#2F52E0" }}>
                  {saving ? "Guardando..." : (() => {
                    const count = expensesList.filter(e => e.supplier.trim() && e.items.some(item => item.baseAmount > 0 && item.subAccountCode)).length;
                    return `Añadir ${count} gasto${count !== 1 ? "s" : ""}`;
                  })()}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Transferred Modal */}
      {showMarkTransferredModal && selectedTransferEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowMarkTransferredModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Registrar transferencia</h3>
              <button onClick={() => setShowMarkTransferredModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Sobre</p>
                <p className="text-sm font-medium text-slate-900">{selectedTransferEnvelope.displayNumber}</p>
                <p className="text-sm font-mono text-slate-700">{fmt(selectedTransferEnvelope.totalAmount)} €</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Referencia de la transferencia *</label>
                <input type="text" value={transferRef} onChange={e => setTransferRef(e.target.value)}
                  placeholder="Ej: 2024-TRF-001"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowMarkTransferredModal(false)}
                className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleMarkTransferred} disabled={saving || !transferRef.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                <Check size={14} /> {saving ? "Guardando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Selector Dropdown (Fixed) */}
      {showAccountSelector && accountSelectorPos && editingExpenseIndex !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setShowAccountSelector(false); setEditingExpenseIndex(null); }} />
          <div ref={accountSelectorRef}
            className="fixed z-[70] w-80 bg-white border border-slate-200 rounded-xl shadow-xl"
            style={{ top: Math.min(accountSelectorPos.top, window.innerHeight - 300), left: accountSelectorPos.left }}>
            <div className="p-2 border-b border-slate-100">
              <input type="text" value={accountSearchTerm}
                onChange={e => setAccountSearchTerm(e.target.value)}
                placeholder="Buscar cuenta"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {subAccounts
                .filter(sa => !accountSearchTerm ||
                  sa.code.toLowerCase().includes(accountSearchTerm.toLowerCase()) ||
                  sa.description.toLowerCase().includes(accountSearchTerm.toLowerCase()))
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
                    <span className="text-sm text-slate-700 truncate">{sa.description}</span>
                  </button>
                ))}
              {subAccounts.filter(sa =>
                !accountSearchTerm ||
                sa.code.toLowerCase().includes(accountSearchTerm.toLowerCase()) ||
                sa.description.toLowerCase().includes(accountSearchTerm.toLowerCase())
              ).length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-400 text-center">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}
      {showCardAccountSelector && cardAccountSelectorPos && editingCardExpenseIndex !== null && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setShowCardAccountSelector(false); setEditingCardExpenseIndex(null); }} />
          <div className="fixed z-[70] w-80 bg-white border border-slate-200 rounded-xl shadow-xl"
            style={{ top: Math.min(cardAccountSelectorPos.top, window.innerHeight - 300), left: cardAccountSelectorPos.left }}>
            <div className="p-2 border-b border-slate-100">
              <input type="text" value={cardAccountSearch}
                onChange={e => setCardAccountSearch(e.target.value)}
                placeholder="Buscar cuenta"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                autoFocus />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {subAccounts
                .filter(sa => !cardAccountSearch ||
                  sa.code.toLowerCase().includes(cardAccountSearch.toLowerCase()) ||
                  sa.description.toLowerCase().includes(cardAccountSearch.toLowerCase()))
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
                    <span className="text-sm text-slate-700 truncate">{sa.description}</span>
                  </button>
                ))}
              {subAccounts.filter(sa =>
                !cardAccountSearch ||
                sa.code.toLowerCase().includes(cardAccountSearch.toLowerCase()) ||
                sa.description.toLowerCase().includes(cardAccountSearch.toLowerCase())
              ).length === 0 && (
                <p className="px-3 py-4 text-sm text-slate-400 text-center">Sin resultados</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
