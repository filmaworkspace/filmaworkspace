"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db, storage } from "@/lib/firebase";
import {
  arrayUnion,
  collection,
  deleteField,
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
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Euro,
  Eye,
  FileCheck,
  FileText,
  Hash,
  Info,
  Layers,
  Lock,
  Package,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { getCostSettings, shouldRealizeInvoice } from "@/lib/budgetRules";
import { realizeInvoice, unrealizeInvoice } from "@/lib/budgetOperations";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_TYPES = {
  invoice: { code: "FRA", label: "Factura", icon: Receipt, bgColor: "bg-emerald-50", textColor: "text-emerald-700" },
  proforma: { code: "PRF", label: "Proforma", icon: FileText, bgColor: "bg-violet-50", textColor: "text-violet-700" },
  budget: { code: "PRS", label: "Presupuesto", icon: FileCheck, bgColor: "bg-amber-50", textColor: "text-amber-700" },
  guarantee: { code: "FNZ", label: "Fianza", icon: Shield, bgColor: "bg-slate-100", textColor: "text-slate-700" },
};

const VAT_RATES = [{ value: 0, label: "0%" }, { value: 4, label: "4%" }, { value: 10, label: "10%" }, { value: 21, label: "21%" }];
const IRPF_RATES = [{ value: 0, label: "0%" }, { value: 7, label: "7%" }, { value: 15, label: "15%" }, { value: 19, label: "19%" }];

// ─── Types ───────────────────────────────────────────────────────────────────

type DocumentType = keyof typeof DOCUMENT_TYPES;

interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

interface InvoiceItem {
  id: string;
  description: string;
  poItemId?: string;
  poItemIndex?: number;
  isNewItem: boolean;
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
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface SubAccount {
  id: string;
  code: string;
  description: string;
  budgeted: number;
  committed: number;
  actual: number;
  available: number;
  accountId: string;
  accountCode: string;
  accountDescription: string;
}

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName?: string;
  taxId: string;
}

interface Member {
  userId: string;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  position?: string;
}

interface ApprovalStep {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers?: string[];
  roles?: string[];
  department?: string;
  requireAll: boolean;
  hasAmountThreshold?: boolean;
  amountThreshold?: number;
  amountCondition?: "above" | "below" | "between";
  amountThresholdMax?: number;
}

interface ApprovalStepStatus {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers: string[];
  approverNames: string[];
  roles?: string[];
  department?: string;
  approvedBy: string[];
  rejectedBy: string[];
  status: "pending" | "approved" | "rejected";
  requireAll: boolean;
}

interface DueDateEntry {
  id: string;
  date: string;
  type: "percentage" | "amount";
  percentage: number;
  amount: number;
}

interface PO {
  id: string;
  number: string;
  supplier: string;
  supplierId: string;
  department?: string;
  totalAmount: number;
  baseAmount?: number;
  items: any[];
}

interface POItem {
  id?: string;
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
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface POItemWithInvoiced extends POItem {
  invoicedAmount: number;
  availableAmount: number;
}

// ─────────────────────────────────────────────────────────────────────────────

function cx(...args: (string | boolean | null | undefined)[]): string { return args.filter(Boolean).join(" "); }

export default function EditInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const invoiceId = params?.invoiceId as string;
  const isAdminCorrection = searchParams.get("mode") === "correction";

  const { loading: permissionsLoading, error: permissionsError, permissions, getAvailableDepartments } = useAccountingPermissions(id);

  // Estados básicos
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [accessDenied, setAccessDenied] = useState(false);

  // Datos de la factura original
  const [originalInvoice, setOriginalInvoice] = useState<any>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDisplayNumber, setInvoiceDisplayNumber] = useState("");
  const [invoiceVersion, setInvoiceVersion] = useState(1);
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [linkedPO, setLinkedPO] = useState<PO | null>(null);

  // Formulario
  const [formData, setFormData] = useState({ supplier: "", supplierName: "", department: "", description: "", dueDate: "", notes: "" });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [totals, setTotals] = useState({ baseAmount: 0, vatAmount: 0, irpfAmount: 0, totalAmount: 0 });

  // Vencimientos múltiples
  const [multipleDueDates, setMultipleDueDates] = useState(false);
  const [dueDates, setDueDates] = useState<DueDateEntry[]>([]);

  // Datos de referencia
  const [departments, setDepartments] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);

  // Episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount">("equal");
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);

  // Archivos
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [existingFileUrl, setExistingFileUrl] = useState("");
  const [existingFileName, setExistingFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Modales
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showPOItemsModal, setShowPOItemsModal] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);
  
  // Items de PO
  const [poItemsWithInvoiced, setPOItemsWithInvoiced] = useState<POItemWithInvoiced[]>([]);

  // Dropdown departamento
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);

  // Guardar items originales para presupuesto
  const [originalItems, setOriginalItems] = useState<InvoiceItem[]>([]);
  const [wasApproved, setWasApproved] = useState(false);

  useEffect(() => {
    if (id && invoiceId && !permissionsLoading) loadData();
  }, [id, invoiceId, permissionsLoading]);

  useEffect(() => { calculateTotals(); }, [items]);
  useEffect(() => { if (Object.keys(touched).length > 0) validateForm(true); }, [formData, items]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(event.target as Node)) setShowDepartmentDropdown(false);
      if (!(event.target as HTMLElement).closest(".custom-dropdown")) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Verificar permiso
      if (permissions.accountingAccessLevel !== "accounting_extended") {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      // Cargar factura
      const invoiceDoc = await getDoc(doc(db, `projects/${id}/invoices`, invoiceId));
      if (!invoiceDoc.exists()) { router.push(`/project/${id}/accounting/invoices`); return; }
      
      const data = invoiceDoc.data();
      setOriginalInvoice(data);
      setInvoiceNumber(data.number || "");
      setInvoiceDisplayNumber(data.displayNumber || "");
      setInvoiceVersion(data.version || 1);
      setInvoiceStatus(data.status || "draft");
      setDocumentType(data.documentType || "invoice");
      setExistingFileUrl(data.attachmentUrl || "");
      setExistingFileName(data.attachmentFileName || "");
      
      // Verificar si estaba aprobada/realizada
      const wasRealizedBefore = ["pending", "approved", "paid"].includes(data.status);
      setWasApproved(wasRealizedBefore);

      setFormData({
        supplier: data.supplierId || "",
        supplierName: data.supplier || "",
        department: data.department || "",
        description: data.description || "",
        dueDate: data.dueDate?.toDate?.().toISOString().split("T")[0] || new Date().toISOString().split("T")[0],
        notes: data.notes || "",
      });

      // Vencimientos múltiples
      if (data.hasMultipleDueDates && data.dueDates) {
        setMultipleDueDates(true);
        setDueDates(data.dueDates.map((d: any, idx: number) => ({
          id: String(idx + 1),
          date: d.date?.toDate?.().toISOString().split("T")[0] || "",
          type: "percentage" as const,
          percentage: d.percentage || 0,
          amount: d.amount || 0,
        })));
      }

      // Items
      const loadedItems = (data.items || []).map((item: any, idx: number) => ({
        id: item.id || String(idx + 1),
        description: item.description || "",
        poItemId: item.poItemId || undefined,
        poItemIndex: item.poItemIndex,
        isNewItem: item.isNewItem ?? true,
        subAccountId: item.subAccountId || "",
        subAccountCode: item.subAccountCode || "",
        subAccountDescription: item.subAccountDescription || "",
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        baseAmount: item.baseAmount || 0,
        vatRate: item.vatRate ?? 21,
        vatAmount: item.vatAmount || 0,
        irpfRate: item.irpfRate || 0,
        irpfAmount: item.irpfAmount || 0,
        totalAmount: item.totalAmount || 0,
        episodeAssignment: item.episodeAssignment || "general",
        episodes: item.episodes || undefined,
      }));
      setItems(loadedItems);
      setOriginalItems(JSON.parse(JSON.stringify(loadedItems)));

      // Cargar PO vinculada
      if (data.poId) {
        const poDoc = await getDoc(doc(db, `projects/${id}/pos`, data.poId));
        if (poDoc.exists()) {
          const poData = poDoc.data();
          setLinkedPO({ id: poDoc.id, number: poData.number, supplier: poData.supplier, supplierId: poData.supplierId, department: poData.department, totalAmount: poData.totalAmount, baseAmount: poData.baseAmount, items: poData.items || [] });
        }
      }

      // Cargar proyecto para episodios
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        const projectData = projectDoc.data();
        const eps = projectData.episodes || 1;
        setTotalEpisodes(eps);
        setEpisodesEnabled(eps > 1);
        setDepartments(projectData.departments || []);
      }

      // Cargar proveedores
      const suppSnap = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName")));
      setSuppliers(suppSnap.docs.filter(d => !d.data().closure).map(d => ({ id: d.id, fiscalName: d.data().fiscalName || "", commercialName: d.data().commercialName, taxId: d.data().taxId || "" })));

      // Cargar subcuentas
      const accountsSnap = await getDocs(collection(db, `projects/${id}/accounts`));
      const allSubAccounts: SubAccount[] = [];
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subSnap = await getDocs(collection(db, `projects/${id}/accounts/${accDoc.id}/subaccounts`));
        subSnap.docs.forEach(subDoc => {
          const subData = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id, code: subData.code || "", description: subData.description || "",
            budgeted: subData.budgeted || 0, committed: subData.committed || 0, actual: subData.actual || 0,
            available: (subData.budgeted || 0) - (subData.actual || 0),
            accountId: accDoc.id, accountCode: accData.code || "", accountDescription: accData.description || "",
          });
        });
      }
      setSubAccounts(allSubAccounts.sort((a, b) => a.code.localeCompare(b.code)));

      // Cargar miembros
      const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
      setMembers(membersSnap.docs.map(d => ({ userId: d.id, ...d.data() } as Member)));

      // Cargar configuración de aprobaciones
      const approvalDoc = await getDoc(doc(db, `projects/${id}/config`, "approvals"));
      if (approvalDoc.exists()) setApprovalConfig(approvalDoc.data().invoiceApprovals || []);

    } catch (error) {
      console.error("Error loading invoice:", error);
    } finally {
      setLoading(false);
    }
  };

  // Cálculos
  const calculateItemTotal = (item: InvoiceItem) => {
    const base = item.quantity * item.unitPrice;
    const vat = base * (item.vatRate / 100);
    const irpf = base * (item.irpfRate / 100);
    return { baseAmount: base, vatAmount: vat, irpfAmount: irpf, totalAmount: base + vat - irpf };
  };

  const calculateTotals = () => {
    const newTotals = {
      baseAmount: items.reduce((s, i) => s + i.baseAmount, 0),
      vatAmount: items.reduce((s, i) => s + i.vatAmount, 0),
      irpfAmount: items.reduce((s, i) => s + i.irpfAmount, 0),
      totalAmount: items.reduce((s, i) => s + i.totalAmount, 0),
    };
    setTotals(newTotals);

    // Recalcular vencimientos si están activos
    if (multipleDueDates && dueDates.length > 0) {
      setDueDates(prev => prev.map(d => ({
        ...d,
        amount: newTotals.totalAmount * (d.percentage / 100),
      })));
    }
  };

  // Items
  const updateItem = (i: number, field: keyof InvoiceItem, value: any) => {
    const n = [...items];
    n[i] = { ...n[i], [field]: value, ...calculateItemTotal({ ...n[i], [field]: value }) };
    setItems(n);
    setTouched(p => ({ ...p, [`item_${i}_${field}`]: true }));
  };

  const addNewItem = () => {
    setItems([...items, {
      id: String(Date.now()), description: "", isNewItem: true, subAccountId: "", subAccountCode: "", subAccountDescription: "",
      quantity: 1, unitPrice: 0, baseAmount: 0, vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general",
    }]);
  };

  const removeItem = (i: number) => { if (items.length > 1) setItems(items.filter((_, idx) => idx !== i)); };

  // Cargar items de PO con facturado
  const loadPOItemsWithInvoiced = async () => {
    if (!linkedPO) return;
    try {
      // Obtener todas las facturas de esta PO (excluyendo la actual)
      const invoicesSnap = await getDocs(query(
        collection(db, `projects/${id}/invoices`),
        where("poId", "==", linkedPO.id),
        where("status", "in", ["pending", "pending_approval", "approved", "paid", "overdue"])
      ));
      
      // Calcular cuánto está facturado por item
      const itemInvoicedAmounts: Record<number, number> = {};
      invoicesSnap.docs.forEach(invDoc => {
        if (invDoc.id === invoiceId) return; // Excluir factura actual
        const invData = invDoc.data();
        (invData.items || []).forEach((item: any) => {
          if (item.poItemIndex !== undefined && item.poItemIndex !== null) {
            itemInvoicedAmounts[item.poItemIndex] = (itemInvoicedAmounts[item.poItemIndex] || 0) + (item.totalAmount || 0);
          }
        });
      });

      const poItemsEnriched: POItemWithInvoiced[] = (linkedPO.items || []).map((item: any, idx: number) => ({
        id: item.id,
        description: item.description || "",
        subAccountId: item.subAccountId || "",
        subAccountCode: item.subAccountCode || "",
        subAccountDescription: item.subAccountDescription || "",
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        baseAmount: item.baseAmount || 0,
        vatRate: item.vatRate ?? 21,
        vatAmount: item.vatAmount || 0,
        irpfRate: item.irpfRate || 0,
        irpfAmount: item.irpfAmount || 0,
        totalAmount: item.totalAmount || 0,
        episodeAssignment: item.episodeAssignment || "general",
        episodes: item.episodes,
        invoicedAmount: itemInvoicedAmounts[idx] || 0,
        availableAmount: (item.totalAmount || 0) - (itemInvoicedAmounts[idx] || 0),
      }));

      setPOItemsWithInvoiced(poItemsEnriched);
      setShowPOItemsModal(true);
    } catch (error) {
      console.error("Error loading PO items:", error);
    }
  };

  const addPOItemToInvoice = (poItem: POItemWithInvoiced, idx: number) => {
    setItems([...items, {
      id: String(Date.now()),
      description: poItem.description,
      poItemId: poItem.id,
      poItemIndex: idx,
      isNewItem: false,
      subAccountId: poItem.subAccountId,
      subAccountCode: poItem.subAccountCode,
      subAccountDescription: poItem.subAccountDescription,
      quantity: poItem.quantity,
      unitPrice: poItem.unitPrice,
      baseAmount: poItem.baseAmount,
      vatRate: poItem.vatRate,
      vatAmount: poItem.vatAmount,
      irpfRate: poItem.irpfRate,
      irpfAmount: poItem.irpfAmount,
      totalAmount: poItem.totalAmount,
      episodeAssignment: poItem.episodeAssignment || "general",
      episodes: poItem.episodes ? [...poItem.episodes] : undefined,
    }]);
    setShowPOItemsModal(false);
  };

  // Selección
  const selectSupplier = (s: Supplier) => {
    setFormData({ ...formData, supplier: s.id, supplierName: s.fiscalName });
    setShowSupplierModal(false);
    setSupplierSearch("");
    handleBlur("supplier");
  };

  const selectAccount = (sub: SubAccount) => {
    if (currentItemIndex !== null) {
      const n = [...items];
      n[currentItemIndex] = { ...n[currentItemIndex], subAccountId: sub.id, subAccountCode: sub.code, subAccountDescription: sub.description };
      setItems(n);
    }
    setShowAccountModal(false);
    setAccountSearch("");
    setCurrentItemIndex(null);
  };

  // Episodios
  const openEpisodeModal = (index: number) => {
    setEpisodeItemIndex(index);
    const item = items[index];
    if (item.episodes && item.episodes.length > 0) {
      setTempEpisodeDistribution([...item.episodes]);
      const allEqual = item.episodes.every(e => Math.abs(e.percentage - item.episodes![0].percentage) < 0.01);
      setEpisodeDistributionMode(allEqual ? "equal" : "amount");
    } else {
      setTempEpisodeDistribution([]);
    }
    setShowEpisodeModal(true);
  };

  const toggleEpisodeInDistribution = (episodeNum: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    const existing = tempEpisodeDistribution.find(e => e.episode === episodeNum);
    if (existing) {
      setTempEpisodeDistribution(tempEpisodeDistribution.filter(e => e.episode !== episodeNum));
    } else {
      const newDist = [...tempEpisodeDistribution, { episode: episodeNum, amount: 0, percentage: 0 }].sort((a, b) => a.episode - b.episode);
      recalculateDistribution(newDist, item.baseAmount);
    }
  };

  const recalculateDistribution = (dist: EpisodeDistribution[], baseAmount: number) => {
    if (dist.length === 0) { setTempEpisodeDistribution([]); return; }
    if (episodeDistributionMode === "equal") {
      const pct = 100 / dist.length;
      const amt = baseAmount / dist.length;
      setTempEpisodeDistribution(dist.map(e => ({ ...e, percentage: pct, amount: amt })));
    } else {
      setTempEpisodeDistribution(dist);
    }
  };

  const updateEpisodeAmount = (episodeNum: number, amount: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    setTempEpisodeDistribution(prev => prev.map(e => e.episode === episodeNum ? { ...e, amount, percentage: item.baseAmount > 0 ? (amount / item.baseAmount) * 100 : 0 } : e));
  };

  const saveEpisodeDistribution = () => {
    if (episodeItemIndex === null) return;
    const n = [...items];
    if (tempEpisodeDistribution.length > 0) {
      n[episodeItemIndex] = { ...n[episodeItemIndex], episodeAssignment: "specific", episodes: tempEpisodeDistribution };
    } else {
      n[episodeItemIndex] = { ...n[episodeItemIndex], episodeAssignment: "general", episodes: undefined };
    }
    setItems(n);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
  };

  // Vencimientos múltiples
  const addDueDate = () => {
    const remaining = 100 - dueDates.reduce((s, d) => s + d.percentage, 0);
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30 * (dueDates.length + 1));
    setDueDates([...dueDates, { id: String(Date.now()), date: defaultDate.toISOString().split("T")[0], type: "percentage", percentage: Math.max(0, remaining), amount: totals.totalAmount * (Math.max(0, remaining) / 100) }]);
  };

  const removeDueDate = (i: number) => { if (dueDates.length > 2) setDueDates(dueDates.filter((_, idx) => idx !== i)); };

  const updateDueDate = (i: number, field: keyof DueDateEntry, value: any) => {
    const newDueDates = [...dueDates];
    newDueDates[i] = { ...newDueDates[i], [field]: value };
    if (field === "percentage") newDueDates[i].amount = totals.totalAmount * (value / 100);
    if (field === "amount") newDueDates[i].percentage = totals.totalAmount > 0 ? (value / totals.totalAmount) * 100 : 0;
    setDueDates(newDueDates);
  };

  const getDueDatesPercentage = () => dueDates.reduce((sum, d) => sum + d.percentage, 0);
  const isDueDatesValid = () => Math.abs(getDueDatesPercentage() - 100) < 0.1;

  // Aprobaciones
  const resolveApprovers = (step: ApprovalStep, dept?: string): { ids: string[]; names: string[] } => {
    const ids: string[] = [];
    const names: string[] = [];
    if (step.approverType === "fixed" && step.approvers) {
      step.approvers.forEach(uid => {
        const m = members.find(mb => mb.userId === uid);
        if (m) { ids.push(uid); names.push(m.name || m.email || uid); }
      });
    } else if (step.approverType === "role" && step.roles) {
      members.filter(m => step.roles!.includes(m.role || "")).forEach(m => { ids.push(m.userId); names.push(m.name || m.email || m.userId); });
    } else if (step.approverType === "hod") {
      const targetDept = step.department || dept;
      members.filter(m => m.department === targetDept && (m.position?.toLowerCase().includes("head") || m.position?.toLowerCase().includes("jefe") || m.role === "HOD")).forEach(m => { ids.push(m.userId); names.push(m.name || m.email || m.userId); });
    }
    return { ids, names };
  };

  const generateApprovalSteps = (): ApprovalStepStatus[] => {
    if (approvalConfig.length === 0) return [];
    return approvalConfig.map(step => {
      const { ids, names } = resolveApprovers(step, formData.department);
      const stepData: any = { id: step.id || "", order: step.order || 0, approverType: step.approverType || "role", approvers: ids, approverNames: names, roles: step.roles || [], department: step.department || "", approvedBy: [], rejectedBy: [], status: "pending" as const, requireAll: step.requireAll ?? false, hasAmountThreshold: step.hasAmountThreshold || false };
      if (step.amountThreshold !== undefined) stepData.amountThreshold = step.amountThreshold;
      if (step.amountCondition !== undefined) stepData.amountCondition = step.amountCondition;
      if (step.amountThresholdMax !== undefined) stepData.amountThresholdMax = step.amountThresholdMax;
      return stepData;
    });
  };

  const shouldAutoApprove = (steps: ApprovalStepStatus[]) => steps.length === 0 || steps.every(s => s.approvers.length === 0);

  // Validación
  const validateForm = (silent = false) => {
    const newErrors: Record<string, string> = {};
    if (!formData.supplier) newErrors.supplier = "Selecciona un proveedor";
    if (!formData.description.trim()) newErrors.description = "Añade una descripción";
    if (items.length === 0) newErrors.items = "Añade al menos un item";
    items.forEach((item, i) => {
      if (!item.description.trim()) newErrors[`item_${i}_description`] = "Falta descripción";
      if (!item.subAccountId) newErrors[`item_${i}_account`] = "Selecciona cuenta";
      if (item.baseAmount <= 0) newErrors[`item_${i}_amount`] = "Importe inválido";
    });
    if (multipleDueDates && !isDueDatesValid()) newErrors.dueDates = "Los vencimientos deben sumar 100%";
    if (!silent) setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: string) => setTouched(p => ({ ...p, [field]: true }));

  // Guardar
  const handleSave = async (sendForApproval: boolean) => {
    if (sendForApproval && !validateForm()) return;

    setSaving(true);
    try {
      const costSettings = await getCostSettings(id);

      // Subir archivo si hay uno nuevo
      let fileUrl = existingFileUrl;
      let fileName = existingFileName;
      if (uploadedFile) {
        const fileRef = ref(storage, `projects/${id}/invoices/${invoiceDisplayNumber}/${uploadedFile.name}`);
        await uploadBytes(fileRef, uploadedFile);
        fileUrl = await getDownloadURL(fileRef);
        fileName = uploadedFile.name;
      }

      // Preparar items
      const itemsData = items.map(i => {
        const itemData: any = {
          description: i.description?.trim() || "",
          poItemId: i.poItemId || null,
          poItemIndex: i.poItemIndex !== undefined ? i.poItemIndex : null,
          isNewItem: i.isNewItem || false,
          subAccountId: i.subAccountId || "",
          subAccountCode: i.subAccountCode || "",
          subAccountDescription: i.subAccountDescription || "",
          quantity: i.quantity || 0,
          unitPrice: i.unitPrice || 0,
          baseAmount: i.baseAmount || 0,
          vatRate: i.vatRate || 0,
          vatAmount: i.vatAmount || 0,
          irpfRate: i.irpfRate || 0,
          irpfAmount: i.irpfAmount || 0,
          totalAmount: i.totalAmount || 0,
          episodeAssignment: i.episodeAssignment || "general",
        };
        if (i.episodes && i.episodes.length > 0) itemData.episodes = i.episodes;
        return itemData;
      });

      const updateData: Record<string, any> = {
        supplier: formData.supplierName || "",
        supplierId: formData.supplier || "",
        department: formData.department || "",
        description: formData.description?.trim() || "",
        notes: formData.notes?.trim() || "",
        items: itemsData,
        baseAmount: totals.baseAmount || 0,
        vatAmount: totals.vatAmount || 0,
        irpfAmount: totals.irpfAmount || 0,
        totalAmount: totals.totalAmount || 0,
        updatedAt: Timestamp.now(),
        updatedBy: permissions.userId || "",
        updatedByName: permissions.userName || "",
      };

      // Vencimientos
      if (multipleDueDates && dueDates.length > 0) {
        updateData.hasMultipleDueDates = true;
        updateData.dueDates = dueDates.map(d => ({ date: Timestamp.fromDate(new Date(d.date)), percentage: d.percentage, amount: d.amount }));
        updateData.dueDate = Timestamp.fromDate(new Date(dueDates[0].date));
      } else {
        updateData.hasMultipleDueDates = false;
        updateData.dueDate = Timestamp.fromDate(new Date(formData.dueDate || new Date()));
        updateData.dueDates = deleteField();
      }

      // Attachment
      if (fileUrl) {
        updateData.attachmentUrl = fileUrl;
        updateData.attachmentFileName = fileName || "";
      }

      if (isAdminCorrection) {
        // Corrección administrativa: no crear nueva versión
        updateData.adminCorrectionHistory = arrayUnion({
          timestamp: Timestamp.now(),
          userId: permissions.userId || "",
          userName: permissions.userName || "",
          changes: "Corrección administrativa",
        });
      } else if (sendForApproval) {
        // Modificación normal: incrementar versión y reiniciar aprobaciones
        const newVersion = (invoiceVersion || 1) + 1;
        updateData.version = newVersion;

        // Guardar items anteriores si estaba realizada
        if (wasApproved && originalItems.length > 0) {
          updateData.previousRealizedItems = originalItems.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
        }

        const steps = generateApprovalSteps();
        if (shouldAutoApprove(steps)) {
          updateData.status = "pending";
          updateData.approvalStatus = "approved";
          updateData.autoApproved = true;
          updateData.approvedAt = Timestamp.now();
          updateData.approvedBy = permissions.userId || "";
          updateData.approvedByName = permissions.userName || "";
          updateData.approvalSteps = deleteField();
          updateData.currentApprovalStep = deleteField();
        } else {
          updateData.status = "pending_approval";
          updateData.approvalStatus = "pending";
          updateData.approvalSteps = steps;
          updateData.currentApprovalStep = 0;
          updateData.approvedAt = deleteField();
          updateData.approvedBy = deleteField();
          updateData.approvedByName = deleteField();
        }

        updateData.modificationHistory = arrayUnion({
          date: Timestamp.now(),
          userId: permissions.userId || "",
          userName: permissions.userName || "",
          previousVersion: invoiceVersion || 1,
        });
      } else {
        updateData.status = "draft";
      }

      await updateDoc(doc(db, `projects/${id}/invoices`, invoiceId), updateData);

      // Manejar presupuesto
      if (!isAdminCorrection && sendForApproval) {
        const finalStatus = updateData.status;
        
        if (finalStatus === "pending" && wasApproved && originalItems.length > 0) {
          // Desrealizar items anteriores
          const itemsToUnrealize = originalItems.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
          if (itemsToUnrealize.length > 0) await unrealizeInvoice(id, itemsToUnrealize);
          // Realizar nuevos items
          if (shouldRealizeInvoice(finalStatus, costSettings)) {
            const itemsToRealize = items.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
            if (itemsToRealize.length > 0) await realizeInvoice(id, itemsToRealize);
          }
        } else if (finalStatus === "pending" && !wasApproved) {
          if (shouldRealizeInvoice(finalStatus, costSettings)) {
            const itemsToRealize = items.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
            if (itemsToRealize.length > 0) await realizeInvoice(id, itemsToRealize);
          }
        }
      }

      setSuccessMessage(isAdminCorrection ? "Corrección guardada" : sendForApproval ? "Factura enviada para aprobación" : "Borrador guardado");
      setTimeout(() => router.push(`/project/${id}/accounting/invoices/${invoiceId}`), 1500);
    } catch (error: any) {
      console.error("Error saving invoice:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Helpers
  const formatCurrency = (a: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0);
  const canEdit = () => invoiceStatus === "draft" || invoiceStatus === "rejected";
  const currentDocType = DOCUMENT_TYPES[documentType];
  const DocIcon = currentDocType.icon;

  const getCompletionPercentage = () => {
    let completed = 0, total = 4;
    if (formData.supplier) completed++;
    if (formData.description.trim()) completed++;
    if (items.some(i => i.description.trim() && i.subAccountId && i.baseAmount > 0)) completed++;
    if (uploadedFile || existingFileUrl) completed++;
    return Math.round((completed / total) * 100);
  };

  const getApprovalPreview = () => {
    const steps = generateApprovalSteps();
    if (shouldAutoApprove(steps)) return { autoApprove: true, message: "Se aprobará automáticamente", steps: [] };
    return { autoApprove: false, message: `${steps.length} nivel${steps.length > 1 ? "es" : ""} de aprobación`, steps };
  };

  const filteredSuppliers = suppliers.filter(s => s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) || s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()));
  const filteredSubAccounts = subAccounts.filter(s => s.code.toLowerCase().includes(accountSearch.toLowerCase()) || s.description.toLowerCase().includes(accountSearch.toLowerCase()));
  const availableDepartments = getAvailableDepartments(departments);
  const approvalPreview = getApprovalPreview();
  const completionPercentage = getCompletionPercentage();
  const hasError = (f: string) => touched[f] && errors[f];
  const isValid = (f: string) => touched[f] && !errors[f];

  // Loading
  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Access denied
  if (permissionsError || !permissions.hasAccountingAccess || accessDenied) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">Solo contabilidad ampliada puede editar facturas.</p>
          <Link href={`/project/${id}/accounting/invoices/${invoiceId}`} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <DocIcon size={24} className={currentDocType.textColor} />
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">
                  {isAdminCorrection ? "Corrección administrativa" : "Editar"} {currentDocType.label.toLowerCase()}
                </h1>
                <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-sm font-mono font-medium">
                  {invoiceDisplayNumber}
                </span>
                {invoiceVersion > 1 && (
                  <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium">
                    V{String(invoiceVersion).padStart(2, "0")}
                  </span>
                )}
                <span className={cx("px-2.5 py-1 rounded-lg text-xs font-medium",
                  invoiceStatus === "draft" ? "bg-slate-100 text-slate-700" :
                  invoiceStatus === "rejected" ? "bg-red-50 text-red-700" :
                  "bg-amber-50 text-amber-700"
                )}>
                  {invoiceStatus === "draft" ? "Borrador" : invoiceStatus === "rejected" ? "Rechazada" : "Pendiente"}
                </span>
                {linkedPO && (
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">
                    PO-{linkedPO.number}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link href={`/project/${id}/accounting/invoices/${invoiceId}`} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">
                <Eye size={16} />
                Ver
              </Link>
              {!isAdminCorrection && canEdit() && (
                <button onClick={() => handleSave(false)} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors disabled:opacity-50">
                  <Save size={16} />
                  Borrador
                </button>
              )}
              <button onClick={() => handleSave(true)} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</> : 
                  isAdminCorrection ? <><CheckCircle size={16} />Guardar corrección</> :
                  approvalPreview.autoApprove ? <><CheckCircle size={16} />Aprobar</> : <><Send size={16} />Enviar</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3">
            <CheckCircle size={18} className="text-emerald-600" />
            <span className="text-sm text-emerald-700 font-medium">{successMessage}</span>
          </div>
        )}

        {isAdminCorrection && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-amber-800">Modo corrección administrativa</h3>
              <p className="text-sm text-amber-700 mt-1">Los cambios se guardarán sin crear nueva versión ni reiniciar aprobaciones.</p>
            </div>
          </div>
        )}

        {!canEdit() && !isAdminCorrection && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600" />
            <span className="text-sm text-amber-700 font-medium">Esta factura está pendiente de aprobación. Guardar creará una nueva versión.</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Información básica */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>

              <div className="p-6 space-y-5">
                {/* Proveedor */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor *</label>
                  <button onClick={() => setShowSupplierModal(true)} onBlur={() => handleBlur("supplier")} className={cx("w-full px-4 py-3 border rounded-xl hover:border-slate-300 transition-colors text-left flex items-center justify-between bg-white",
                    hasError("supplier") ? "border-red-300 bg-red-50" : isValid("supplier") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                  )}>
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center", isValid("supplier") ? "bg-emerald-100" : "bg-slate-100")}>
                          {isValid("supplier") ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Building2 size={16} className="text-slate-500" />}
                        </div>
                        <span className="font-medium text-slate-900">{formData.supplierName}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Seleccionar proveedor...</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("supplier") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.supplier}</p>}
                </div>

                {/* Departamento */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Departamento</label>
                    <div className="relative" ref={departmentDropdownRef}>
                      <button type="button" onClick={() => !permissions.fixedDepartment && setShowDepartmentDropdown(!showDepartmentDropdown)} disabled={!!permissions.fixedDepartment} className={cx("w-full px-4 py-3 border rounded-xl text-left flex items-center justify-between bg-white disabled:bg-slate-50 text-sm disabled:cursor-not-allowed hover:border-slate-300 transition-colors", "border-slate-200")}>
                        <span className={formData.department ? "text-slate-900" : "text-slate-400"}>
                          {formData.department || "Seleccionar..."}
                        </span>
                        <div className="flex items-center gap-2">
                          {permissions.fixedDepartment && <Lock size={14} className="text-slate-400" />}
                          <ChevronDown size={16} className={"text-slate-400 transition-transform " + (showDepartmentDropdown ? "rotate-180" : "")} />
                        </div>
                      </button>
                      {showDepartmentDropdown && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                          {availableDepartments.map(dept => (
                            <button key={dept} type="button" onClick={() => { setFormData({ ...formData, department: dept }); setShowDepartmentDropdown(false); }} className={cx("w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors", formData.department === dept ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600")}>
                              {dept}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Fecha vencimiento</label>
                    <input type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" />
                  </div>
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Descripción *</label>
                  <div className="relative">
                    <textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} onBlur={() => handleBlur("description")} placeholder="Describe el propósito de esta factura" rows={3} className={cx("w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm pr-10",
                      hasError("description") ? "border-red-300 bg-red-50" : isValid("description") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                    )} />
                    {isValid("description") && <CheckCircle2 size={16} className="absolute right-4 top-4 text-emerald-600" />}
                  </div>
                  {hasError("description") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.description}</p>}
                </div>

                {/* Notas */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Notas</label>
                  <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} placeholder="Notas adicionales (opcional)" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm" />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">Items</h2>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{items.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  {linkedPO && (
                    <button onClick={loadPOItemsWithInvoiced} className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium transition-colors">
                      <Package size={14} />
                      Items de PO
                    </button>
                  )}
                  <button onClick={addNewItem} className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors">
                    <Plus size={14} />
                    Añadir
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                {items.map((item, index) => {
                  const itemComplete = item.description.trim() && item.subAccountId && item.quantity > 0 && item.unitPrice > 0;

                  return (
                    <div key={item.id} className={cx("border rounded-xl p-5 transition-all", itemComplete ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50")}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            {itemComplete ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Hash size={12} />}
                            Item {index + 1}
                          </span>
                          {itemComplete && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-medium">Completo</span>}
                          {!item.isNewItem && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg font-medium">De PO</span>}
                        </div>
                        {items.length > 1 && (
                          <button onClick={() => removeItem(index)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="space-y-4">
                        <input type="text" value={item.description} onChange={e => updateItem(index, "description", e.target.value)} onBlur={() => handleBlur(`item_${index}_description`)} placeholder="Descripción del item" className={cx("w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white",
                          hasError(`item_${index}_description`) ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"
                        )} />

                        {/* Cuenta */}
                        {item.isNewItem ? (
                          <button onClick={() => { setCurrentItemIndex(index); setShowAccountModal(true); }} className={cx("w-full px-4 py-2.5 border rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 bg-white",
                            hasError(`item_${index}_account`) ? "border-red-300 bg-red-50" : item.subAccountCode ? "border-emerald-200 bg-emerald-50" : "border-slate-200"
                          )}>
                            {item.subAccountCode ? (
                              <div className="flex items-center gap-2">
                                <CheckCircle2 size={14} className="text-emerald-600" />
                                <span className="font-mono text-slate-900">{item.subAccountCode} - {item.subAccountDescription}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400">Seleccionar cuenta</span>
                            )}
                            <Search size={14} className="text-slate-400" />
                          </button>
                        ) : (
                          <div className="px-4 py-2.5 bg-slate-100 rounded-xl text-sm flex items-center gap-2">
                            <CheckCircle2 size={14} className="text-emerald-600" />
                            <span className="font-mono text-slate-700">{item.subAccountCode} - {item.subAccountDescription}</span>
                          </div>
                        )}

                        {/* Episodios */}
                        {episodesEnabled && totalEpisodes > 1 && (
                          <button onClick={() => openEpisodeModal(index)} className={cx("w-full px-4 py-2.5 border rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
                            item.episodeAssignment === "general" ? "border-slate-200" : "border-violet-200 bg-violet-50"
                          )}>
                            {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                              <div className="flex items-center gap-2">
                                <Layers size={14} className="text-violet-600" />
                                <span className="text-slate-900">{item.episodes.length === 1 ? `Ep. ${item.episodes[0].episode}` : `${item.episodes.length} capítulos`}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <Layers size={14} className="text-slate-400" />
                                <span className="text-slate-600">General (todos los capítulos)</span>
                              </div>
                            )}
                            <ChevronDown size={14} className="text-slate-400" />
                          </button>
                        )}

                        {/* Cantidades */}
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                            <input type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => updateItem(index, "quantity", parseFloat(e.target.value) || 0)} className={cx("w-full px-3 py-2.5 border rounded-xl text-sm bg-white", item.quantity > 0 ? "border-emerald-200" : "border-slate-200")} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Precio</label>
                            <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)} className={cx("w-full px-3 py-2.5 border rounded-xl text-sm bg-white", item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200")} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                            <div className="relative custom-dropdown">
                              <button
                                type="button"
                                onClick={() => setOpenDropdown(openDropdown === `vat-${index}` ? null : `vat-${index}`)}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                              >
                                <span className="text-slate-900 truncate">{VAT_RATES.find(r => r.value === item.vatRate)?.label ?? `${item.vatRate}%`}</span>
                                <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `vat-${index}` ? "rotate-180" : ""}`} />
                              </button>
                              {openDropdown === `vat-${index}` && (
                                <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                                  {VAT_RATES.map(opt => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => { updateItem(index, "vatRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                      className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.vatRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IRPF</label>
                            <div className="relative custom-dropdown">
                              <button
                                type="button"
                                onClick={() => setOpenDropdown(openDropdown === `irpf-${index}` ? null : `irpf-${index}`)}
                                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                              >
                                <span className="text-slate-900 truncate">{IRPF_RATES.find(r => r.value === item.irpfRate)?.label ?? `${item.irpfRate}%`}</span>
                                <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `irpf-${index}` ? "rotate-180" : ""}`} />
                              </button>
                              {openDropdown === `irpf-${index}` && (
                                <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                                  {IRPF_RATES.map(opt => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => { updateItem(index, "irpfRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                      className={`w-full px-4 py-2 text-left text-sm transition-colors ${item.irpfRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <div className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm">
                            <span className="text-slate-400">Total:</span>
                            <span className="ml-2 font-semibold">{formatCurrency(item.totalAmount)} €</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Vencimientos múltiples */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Vencimientos</h2>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm text-slate-600">Vencimientos múltiples</span>
                  <input type="checkbox" checked={multipleDueDates} onChange={e => {
                    setMultipleDueDates(e.target.checked);
                    if (e.target.checked && dueDates.length === 0) {
                      const d1 = new Date(); d1.setDate(d1.getDate() + 30);
                      const d2 = new Date(); d2.setDate(d2.getDate() + 60);
                      setDueDates([
                        { id: "1", date: d1.toISOString().split("T")[0], type: "percentage", percentage: 50, amount: totals.totalAmount * 0.5 },
                        { id: "2", date: d2.toISOString().split("T")[0], type: "percentage", percentage: 50, amount: totals.totalAmount * 0.5 },
                      ]);
                    }
                  }} className="w-4 h-4 rounded" />
                </label>
              </div>

              {multipleDueDates && (
                <div className="p-6 space-y-4">
                  {dueDates.map((dd, i) => (
                    <div key={dd.id} className="flex items-center gap-4">
                      <input type="date" value={dd.date} onChange={e => updateDueDate(i, "date", e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm flex-1" />
                      <div className="flex items-center gap-2">
                        <input type="number" value={dd.percentage} onChange={e => updateDueDate(i, "percentage", parseFloat(e.target.value) || 0)} className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm text-right" />
                        <span className="text-sm text-slate-500">%</span>
                      </div>
                      <span className="text-sm text-slate-600 w-24 text-right">{formatCurrency(dd.amount)} €</span>
                      {dueDates.length > 2 && (
                        <button onClick={() => removeDueDate(i)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button onClick={addDueDate} className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"><Plus size={14} />Añadir vencimiento</button>
                    <div className={cx("text-sm font-medium", isDueDatesValid() ? "text-emerald-600" : "text-red-600")}>
                      Total: {getDueDatesPercentage().toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="lg:col-span-1 space-y-4">
            {/* Progreso */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-slate-700">Progreso</span>
                <span className={cx("text-sm font-bold", completionPercentage === 100 ? "text-emerald-600" : "text-slate-900")}>{completionPercentage}%</span>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={cx("h-full transition-all duration-300", completionPercentage === 100 ? "bg-emerald-500" : "bg-slate-900")} style={{ width: `${completionPercentage}%` }} />
              </div>
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  {formData.supplier ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                  <span className={formData.supplier ? "text-slate-700" : "text-slate-400"}>Proveedor</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {formData.description.trim() ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                  <span className={formData.description.trim() ? "text-slate-700" : "text-slate-400"}>Descripción</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {items.some(i => i.description.trim() && i.subAccountId && i.baseAmount > 0) ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                  <span className={items.some(i => i.description.trim() && i.subAccountId && i.baseAmount > 0) ? "text-slate-700" : "text-slate-400"}>Items</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {uploadedFile || existingFileUrl ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                  <span className={(uploadedFile || existingFileUrl) ? "text-slate-700" : "text-slate-400"}>Documento</span>
                </div>
              </div>
            </div>

            {/* Totales */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Resumen</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Base imponible</span><span className="text-slate-900">{formatCurrency(totals.baseAmount)} €</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">IVA</span><span className="text-slate-900">{formatCurrency(totals.vatAmount)} €</span></div>
                {totals.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">IRPF</span><span className="text-red-600">-{formatCurrency(totals.irpfAmount)} €</span></div>}
                <div className="border-t border-slate-100 pt-2 mt-2">
                  <div className="flex justify-between"><span className="font-medium text-slate-900">Total</span><span className="font-bold text-lg text-slate-900">{formatCurrency(totals.totalAmount)} €</span></div>
                </div>
              </div>
            </div>

            {/* Aprobación */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Aprobación</h3>
              {approvalPreview.autoApprove ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle size={16} />
                  <span>Se aprobará automáticamente</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <Clock size={16} />
                    <span>{approvalPreview.message}</span>
                  </div>
                  {approvalPreview.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-500 ml-6">
                      <ChevronRight size={12} />
                      <span>{step.approverNames.join(", ") || "Sin aprobadores"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Documento */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Documento</h3>
              {existingFileUrl && !uploadedFile && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-3">
                  <FileText size={18} className="text-slate-400" />
                  <span className="text-sm text-slate-600 flex-1 truncate">{existingFileName}</span>
                  <a href={existingFileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">Ver</a>
                </div>
              )}
              <label className={cx("flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors",
                isDragging ? "border-slate-400 bg-slate-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
              )} onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={e => { e.preventDefault(); setIsDragging(false); setUploadedFile(e.dataTransfer.files[0]); }}>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setUploadedFile(e.target.files?.[0] || null)} className="hidden" />
                {uploadedFile ? (
                  <div className="text-center">
                    <CheckCircle size={24} className="text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">{uploadedFile.name}</p>
                    <p className="text-xs text-slate-400 mt-1">Click para cambiar</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload size={24} className="text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">{existingFileUrl ? "Subir nuevo" : "Subir documento"}</p>
                  </div>
                )}
              </label>
            </div>
          </div>
        </div>
      </main>

      {/* Modal items de PO */}
      {showPOItemsModal && linkedPO && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPOItemsModal(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Items de PO-{linkedPO.number}</h2>
                <p className="text-sm text-slate-500">Selecciona un item para añadirlo a la factura</p>
              </div>
              <button onClick={() => setShowPOItemsModal(false)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={20} /></button>
            </div>
            <div className="p-6 max-h-96 overflow-y-auto space-y-3">
              {poItemsWithInvoiced.map((poItem, idx) => {
                const isOver = poItem.availableAmount < 0;
                return (
                  <button
                    key={poItem.id || idx}
                    onClick={() => addPOItemToInvoice(poItem, idx)}
                    className={cx(
                      "w-full text-left p-4 border rounded-xl transition-colors",
                      isOver ? "border-red-200 bg-red-50 hover:border-red-300" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">{poItem.description || "Sin descripción"}</p>
                        <p className="text-xs text-slate-500 font-mono mt-1">{poItem.subAccountCode} - {poItem.subAccountDescription}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">{formatCurrency(poItem.totalAmount)} €</p>
                        <p className="text-xs text-slate-500">Total PO</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm mt-3 pt-3 border-t border-slate-100">
                      <div>
                        <p className="text-slate-500 text-xs">Facturado</p>
                        <p className="font-medium text-slate-700">{formatCurrency(poItem.invoicedAmount)} €</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Disponible</p>
                        <p className={cx("font-medium", isOver ? "text-red-600" : poItem.availableAmount < poItem.totalAmount * 0.1 ? "text-amber-600" : "text-emerald-600")}>
                          {formatCurrency(poItem.availableAmount)} €
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg">
                          <Plus size={12} />
                          Añadir
                        </span>
                      </div>
                    </div>
                    {isOver && (
                      <div className="flex items-center gap-2 mt-3 text-xs text-red-600">
                        <AlertTriangle size={12} />
                        Este item ya está sobre-facturado
                      </div>
                    )}
                  </button>
                );
              })}
              {poItemsWithInvoiced.length === 0 && (
                <div className="text-center py-8">
                  <Package size={32} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-500">No hay items en esta PO</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal proveedor */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSupplierModal(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Search size={20} className="text-slate-400" />
                <input type="text" value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="Buscar proveedor" autoFocus className="flex-1 outline-none text-sm" />
                <button onClick={() => setShowSupplierModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredSuppliers.map(s => (
                <button key={s.id} onClick={() => selectSupplier(s)} className="w-full px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <p className="font-medium text-slate-900">{s.fiscalName}</p>
                  <p className="text-xs text-slate-500">{s.taxId}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal cuenta */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAccountModal(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Search size={20} className="text-slate-400" />
                <input type="text" value={accountSearch} onChange={e => setAccountSearch(e.target.value)} placeholder="Buscar cuenta" autoFocus className="flex-1 outline-none text-sm" />
                <button onClick={() => setShowAccountModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredSubAccounts.map(s => (
                <button key={s.id} onClick={() => selectAccount(s)} className="w-full px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <p className="font-medium text-slate-900 font-mono">{s.code}</p>
                  <p className="text-sm text-slate-500">{s.description}</p>
                  {s.accountDescription && <p className="text-xs text-slate-400 mt-0.5">{s.accountCode} · {s.accountDescription}</p>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal episodios */}
      {showEpisodeModal && episodeItemIndex !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowEpisodeModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold">Asignar capítulos</h3>
              <button onClick={() => setShowEpisodeModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-4">
                <button onClick={() => { setEpisodeDistributionMode("equal"); recalculateDistribution(tempEpisodeDistribution, items[episodeItemIndex].baseAmount); }} className={cx("flex-1 py-2 rounded-lg text-sm font-medium", episodeDistributionMode === "equal" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}>
                  Partes iguales
                </button>
                <button onClick={() => setEpisodeDistributionMode("amount")} className={cx("flex-1 py-2 rounded-lg text-sm font-medium", episodeDistributionMode === "amount" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}>
                  Por importe
                </button>
              </div>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map(ep => {
                  const selected = tempEpisodeDistribution.find(e => e.episode === ep);
                  return (
                    <div key={ep} className={cx("flex items-center gap-3 p-3 rounded-lg border", selected ? "border-slate-300 bg-slate-50" : "border-slate-200")}>
                      <input type="checkbox" checked={!!selected} onChange={() => toggleEpisodeInDistribution(ep)} className="w-4 h-4" />
                      <span className="font-medium">Ep. {ep}</span>
                      {selected && episodeDistributionMode === "amount" && (
                        <input type="number" value={selected.amount || ""} onChange={e => updateEpisodeAmount(ep, parseFloat(e.target.value) || 0)} placeholder="0.00" className="ml-auto w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right" />
                      )}
                      {selected && episodeDistributionMode === "equal" && (
                        <span className="ml-auto text-sm text-slate-500">{selected.percentage.toFixed(1)}%</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200 flex gap-3">
                <button onClick={() => setTempEpisodeDistribution([])} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm">
                  General
                </button>
                <button onClick={saveEpisodeDistribution} className="flex-1 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium">
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
