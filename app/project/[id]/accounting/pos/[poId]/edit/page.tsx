"use client";
import { confirmDialog } from "@/lib/toast";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useCanSeeBudget } from "@/hooks/useCanSeeBudget";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { AccountPickerModal, EpisodeModal, SupplierPickerModal } from "@/components/accounting/Pickers";
import { documentTotals, lineAmounts } from "@/lib/amounts";
import { getScopedDocs, scopeFromPermissions } from "@/lib/accountingScope";
import { approverIdsOf } from "@/lib/approvers";
import { ApprovalSteps } from "@/components/accounting/ApprovalFlow";
import { buildFlow, type ApprovalStepConfig, type FlowMember } from "@/lib/approvalFlow";
import { loadBudgetFigures } from "@/lib/budgetFigures";
import {
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
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Eye,
  FileText,
  FileUp,
  Hash,
  Info,
  Layers,
  Lock,
  Package,
  Plus,
  Save,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { getCostSettings, shouldCommitPO } from "@/lib/budgetRules";
import { syncBudget } from "@/lib/ledgerClient";
import { AmountSummary } from "@/components/accounting/AmountSummary";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { AutosaveNotice, AutosaveStatus } from "@/components/accounting/AutosaveNotice";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName: string;
  country: string;
  taxId: string;
  paymentMethod: string;
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

interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

interface POItem {
  id: string;
  description: string;
  subAccountId: string;
  subAccountCode: string;
  subAccountDescription: string;
  date: string;
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

interface ApprovalStep {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers?: string[];
  approverNames?: string[];
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
  status: "pending" | "approved" | "rejected" | "skipped";
  skipReason?: string | null;
  requireAll: boolean;
  hasAmountThreshold?: boolean;
  amountThreshold?: number;
  amountCondition?: "above" | "below" | "between";
  amountThresholdMax?: number;
}

interface Member {
  userId: string;
  permissions?: { accounting?: boolean } | null;
  accountingAccessLevel?: string | null;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  position?: string;
}

interface ItemInvoiceStatus {
  hasInvoices: boolean;
  hasAccountedInvoices: boolean;
  invoiceNumbers: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PO_TYPES = [
  { value: "rental", label: "Alquiler", icon: ShoppingCart, description: "Equipos, vehículos, espacios" },
  { value: "purchase", label: "Compra", icon: Package, description: "Material, consumibles" },
  { value: "service", label: "Servicio", icon: Wrench, description: "Trabajos, honorarios" },
  { value: "deposit", label: "Fianza", icon: Shield, description: "Depósitos de garantía" },
];

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const CURRENCIES = [
  { value: "EUR", label: "EUR", symbol: "€" },
  { value: "USD", label: "USD", symbol: "$" },
  { value: "GBP", label: "GBP", symbol: "£" },
];

const VAT_RATES = [{ value: 0, label: "0%" }, { value: 4, label: "4%" }, { value: 10, label: "10%" }, { value: 21, label: "21%" }];
const IRPF_RATES = [{ value: 0, label: "0%" }, { value: 7, label: "7%" }, { value: 15, label: "15%" }, { value: 19, label: "19%" }];

// ─────────────────────────────────────────────────────────────────────────────

export default function EditPOPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const canSeeBudgetFigures = useCanSeeBudget(id);
  const poId = params?.poId as string;

  const {
    loading: permissionsLoading,
    error: permissionsError,
    permissions,
    canEditPO,
    getAvailableDepartments,
  } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [docUpdatedAt, setDocUpdatedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [poNumber, setPONumber] = useState("");
  const [poVersion, setPOVersion] = useState(1);
  const [poStatus, setPOStatus] = useState<string>("draft");
  const [poCreatedBy, setPOCreatedBy] = useState<string>("");
  const [poDepartment, setPODepartment] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // Los avisos van por lib/toast.
  const setSuccessMessage = (m: string) => { if (m) appToast.success(m); };
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [existingFileUrl, setExistingFileUrl] = useState("");
  const [existingFileName, setExistingFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Configuración de episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount" | "percentage">("equal");
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(showSupplierModal || showAccountModal || showEpisodeModal);

  // Dropdown de departamento
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    supplier: "", supplierName: "", department: "",
    poType: "service" as "rental" | "purchase" | "service" | "deposit",
    currency: "EUR", generalDescription: "", paymentTerms: "", notes: "",
  });
  // PO "fantasma": igual que en Nueva orden de compra, sin proveedor
  // asignado todavía. Se carga del propio PO al abrir la edición, para que
  // guardar otros cambios no obligue a rellenar el proveedor de golpe.
  const [noSupplier, setNoSupplier] = useState(false);

  const [items, setItems] = useState<POItem[]>([{
    id: "1", description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "",
    date: new Date().toISOString().split("T")[0], quantity: 1, unitPrice: 0, baseAmount: 0,
    vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general",
  }]);

  const [totals, setTotals] = useState({ baseAmount: 0, vatAmount: 0, irpfAmount: 0, totalAmount: 0 });
  
  // Estado para rastrear facturas asociadas a cada item (por índice)
  const [itemInvoiceStatus, setItemInvoiceStatus] = useState<Record<number, ItemInvoiceStatus>>({});
  
  // Items originales comprometidos (para mantener comprometido durante edición)
  const [originalCommittedItems, setOriginalCommittedItems] = useState<{index?: number; subAccountId: string; subAccountCode?: string; baseAmount: number}[] | null>(null);
  const [wasApprovedBefore, setWasApprovedBefore] = useState(false);
  
  // Items originales con todas sus propiedades (para detectar cambios de cuenta)
  const [originalItems, setOriginalItems] = useState<{subAccountId: string; subAccountCode: string; subAccountDescription: string}[]>([]);

  // ─── Autoguardado de la edición (hooks/useFormAutosave) ──────────────────
  // Solo se recupera si es posterior a la última versión guardada del documento.
  const autosave = useFormAutosave({
    key: id && poId && permissions.userId ? `autosave:po:${poId}:${permissions.userId}` : null,
    value: { formData, items, noSupplier },
    ready: !loading && !!docUpdatedAt,
    newerThan: docUpdatedAt,
    isEmpty: () => false,
    onRestore: (v) => { setFormData(v.formData); setItems(v.items); setNoSupplier(!!v.noSupplier); },
  });

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id && poId) loadData();
  }, [permissionsLoading, permissions.userId, id, poId]);

  useEffect(() => { calculateTotals(); }, [items]);
  useEffect(() => { if (Object.keys(touched).length > 0) validateForm(true); }, [formData, items]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(event.target as Node)) {
        setShowDepartmentDropdown(false);
      }
      if (!(event.target as HTMLElement).closest(".custom-dropdown")) setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const poDoc = await getDoc(doc(db, `projects/${id}/pos`, poId));
      if (!poDoc.exists()) {
        router.push(`/project/${id}/accounting/pos`);
        return;
      }

      const poData = poDoc.data();
      const poForPermissions = {
        id: poId,
        department: poData.department || "",
        createdBy: poData.createdBy || "",
        status: poData.status || "draft",
      };

      if (!canEditPO(poForPermissions as any)) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setPOCreatedBy(poData.createdBy || "");
      setPODepartment(poData.department || "");
      setPONumber(poData.number || "");
      setPOVersion(poData.version || 1);
      setPOStatus(poData.status || "draft");
      setExistingFileUrl(poData.attachmentUrl || "");
      setExistingFileName(poData.attachmentFileName || "");
      
      // Guardar si la PO fue aprobada antes (tiene items comprometidos)
      // Puede estar en draft/rejected después de editar una aprobada
      const hadCommittedItems = poData.previousCommittedItems || (poData.status === "approved" ? poData.items : null);
      if (hadCommittedItems) {
        setOriginalCommittedItems(hadCommittedItems.map((item: any, i: number) => ({
          index: item.index ?? i,
          subAccountId: item.subAccountId,
          subAccountCode: item.subAccountCode || "",
          baseAmount: item.baseAmount || 0,
        })).filter((item: any) => item.baseAmount > 0));
        setWasApprovedBefore(true);
      }

      setDocUpdatedAt(poData.updatedAt?.toDate?.() || poData.createdAt?.toDate?.() || null);
      setFormData({
        supplier: poData.supplierId || "", supplierName: poData.supplier || "",
        department: poData.department || "", poType: poData.poType || "service",
        currency: poData.currency || "EUR",
        generalDescription: poData.description || poData.generalDescription || "",
        paymentTerms: poData.paymentTerms || "", notes: poData.notes || "",
      });
      setNoSupplier(!!poData.noSupplier);

      const loadedItems = (poData.items || []).map((item: any, idx: number) => ({
        id: item.id || String(idx + 1), description: item.description || "",
        subAccountId: item.subAccountId || "", subAccountCode: item.subAccountCode || "",
        subAccountDescription: item.subAccountDescription || "",
        date: item.date || new Date().toISOString().split("T")[0],
        quantity: item.quantity || 1, unitPrice: item.unitPrice || 0,
        baseAmount: item.baseAmount || 0, vatRate: item.vatRate ?? 21,
        vatAmount: item.vatAmount || 0, irpfRate: item.irpfRate || 0,
        irpfAmount: item.irpfAmount || 0, totalAmount: item.totalAmount || 0,
        episodeAssignment: item.episodeAssignment || "general",
        episodes: item.episodes || undefined,
      }));

      if (loadedItems.length === 0) {
        loadedItems.push({ id: "1", description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "", date: new Date().toISOString().split("T")[0], quantity: 1, unitPrice: 0, baseAmount: 0, vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general" });
      }
      setItems(loadedItems);
      
      // Guardar items originales para detectar cambios de cuenta
      setOriginalItems(loadedItems.map((item: any) => ({
        subAccountId: item.subAccountId || "",
        subAccountCode: item.subAccountCode || "",
        subAccountDescription: item.subAccountDescription || "",
      })));

      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
        setDepartments(projectDoc.data().departments || []);
      }

      // Cargar configuración de episodios
      const productionDoc = await getDoc(doc(db, `projects/${id}/config/production`));
      if (productionDoc.exists()) {
        const prodData = productionDoc.data();
        if (prodData.projectType === "serie") {
          setTotalEpisodes(prodData.episodes || 0);
          const projectConfigDoc = await getDoc(doc(db, `projects/${id}/config/project`));
          if (projectConfigDoc.exists()) {
            const configData = projectConfigDoc.data();
            setEpisodesEnabled(configData.enableEpisodes || false);
          }
        }
      }

      const membersSnapshot = await getDocs(collection(db, `projects/${id}/members`));
      const membersData: Member[] = [];
      for (const memberDocSnap of membersSnapshot.docs) {
        const memberData = memberDocSnap.data();
        let name = memberData.name || memberData.email || memberDocSnap.id;
        try {
          const userDoc = await getDoc(doc(db, "users", memberDocSnap.id));
          if (userDoc.exists()) name = userDoc.data().displayName || name;
        } catch (e) {}
        membersData.push({ userId: memberDocSnap.id, name, email: memberData.email, role: memberData.role, department: memberData.department, position: memberData.position, permissions: memberData.permissions || null, accountingAccessLevel: memberData.accountingAccessLevel || null });
      }
      setMembers(membersData);

      const approvalConfigDoc = await getDoc(doc(db, `projects/${id}/config/approvals`));
      if (approvalConfigDoc.exists()) setApprovalConfig(approvalConfigDoc.data().poApprovals || []);

      const suppliersSnapshot = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName", "asc")));
      setSuppliers(suppliersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Supplier)));

      const accountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const allSubAccounts: SubAccount[] = [];
      const figures = await loadBudgetFigures(id as string);
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        subAccountsSnapshot.docs.forEach((subDoc) => {
          const data = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id, code: data.code, description: data.description,
            budgeted: figures[subDoc.id] ?? data.budgeted ?? 0, committed: data.committed || 0, actual: data.actual || 0,
            available: (figures[subDoc.id] ?? data.budgeted ?? 0) - (data.committed || 0) - (data.actual || 0),
            accountId: accountDoc.id, accountCode: accountData.code, accountDescription: accountData.description,
          });
        });
      }
      setSubAccounts(allSubAccounts);

      // Cargar facturas asociadas a esta PO para verificar items con facturas contabilizadas
      const invoicesSnapshot = { docs: await getScopedDocs(collection(db, `projects/${id}/invoices`), scopeFromPermissions(permissions), [where("poId", "==", poId)]) };
      const invoiceStatusByItem: Record<number, ItemInvoiceStatus> = {};
      
      invoicesSnapshot.docs.forEach((invDoc) => {
        const invData = invDoc.data();
        if (invData.poId === poId && invData.items) {
          invData.items.forEach((invItem: any) => {
            if (invItem.poItemIndex !== undefined && invItem.poItemIndex !== null) {
              const idx = invItem.poItemIndex;
              if (!invoiceStatusByItem[idx]) {
                invoiceStatusByItem[idx] = { hasInvoices: false, hasAccountedInvoices: false, invoiceNumbers: [] };
              }
              invoiceStatusByItem[idx].hasInvoices = true;
              invoiceStatusByItem[idx].invoiceNumbers.push(invData.displayNumber || invData.number);
              if (invData.accounted) {
                invoiceStatusByItem[idx].hasAccountedInvoices = true;
              }
            }
          });
        }
      });
      setItemInvoiceStatus(invoiceStatusByItem);

    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };


  // Flujo de aprobación: lógica única en lib/approvalFlow (pasos sin aprobador
  // o fuera de umbral se omiten con su motivo; nunca se bloquea).
  const generateApprovalSteps = (dept?: string): ApprovalStepStatus[] =>
    buildFlow(approvalConfig as ApprovalStepConfig[], members as FlowMember[], { department: dept, baseAmount: totals.baseAmount }).steps as unknown as ApprovalStepStatus[];

  const shouldAutoApprove = (steps: ApprovalStepStatus[]): boolean => !steps.some((s) => s.status === "pending");

  // Importes redondeados a céntimos (lib/amounts)
  const calculateItemTotal = (item: POItem) => lineAmounts(item);

  const updateItem = (index: number, field: keyof POItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    const calc = calculateItemTotal(newItems[index]);
    newItems[index] = { ...newItems[index], ...calc };
    setItems(newItems);
    setTouched((prev) => ({ ...prev, [`item_${index}_${field}`]: true }));
  };

  const addItem = () => {
    setItems([...items, { id: String(items.length + 1), description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "", date: new Date().toISOString().split("T")[0], quantity: 1, unitPrice: 0, baseAmount: 0, vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general" }]);
  };

  const removeItem = (index: number) => { if (items.length === 1) return; setItems(items.filter((_, i) => i !== index)); };

  // Funciones para manejo de episodios
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
      const newEp: EpisodeDistribution = { episode: episodeNum, amount: 0, percentage: 0 };
      const newDist = [...tempEpisodeDistribution, newEp].sort((a, b) => a.episode - b.episode);
      recalculateDistribution(newDist, item.baseAmount);
    }
  };

  const recalculateDistribution = (dist: EpisodeDistribution[], totalAmount: number) => {
    if (dist.length === 0) { setTempEpisodeDistribution([]); return; }
    if (episodeDistributionMode === "equal") {
      const equalPercentage = 100 / dist.length;
      const equalAmount = totalAmount / dist.length;
      setTempEpisodeDistribution(dist.map(e => ({ ...e, percentage: equalPercentage, amount: equalAmount })));
    } else {
      setTempEpisodeDistribution(dist);
    }
  };

  const updateEpisodeAmount = (episodeNum: number, amount: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    setTempEpisodeDistribution(tempEpisodeDistribution.map(e => e.episode === episodeNum ? { ...e, amount, percentage: (amount / item.baseAmount) * 100 } : e));
  };

  const updateEpisodePercentage = (episodeNum: number, percentage: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    setTempEpisodeDistribution(tempEpisodeDistribution.map(e => e.episode === episodeNum ? { ...e, percentage, amount: (percentage / 100) * item.baseAmount } : e));
  };

  const applyEqualDistribution = () => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item || tempEpisodeDistribution.length === 0) return;
    const equalPercentage = 100 / tempEpisodeDistribution.length;
    const equalAmount = item.baseAmount / tempEpisodeDistribution.length;
    setTempEpisodeDistribution(tempEpisodeDistribution.map(e => ({ ...e, percentage: equalPercentage, amount: equalAmount })));
  };

  const saveEpisodeDistribution = (dist: EpisodeDistribution[] = tempEpisodeDistribution) => {
    if (episodeItemIndex === null) return;
    const newItems = [...items];
    const isGeneral = dist.length === 0 || dist.length === totalEpisodes;
    newItems[episodeItemIndex] = {
      ...newItems[episodeItemIndex],
      episodeAssignment: isGeneral ? "general" : "specific",
      episodes: dist.length > 0 && dist.length < totalEpisodes ? dist : undefined,
    };
    setItems(newItems);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
    setTempEpisodeDistribution([]);
  };

  const getTotalDistributedPercentage = () => tempEpisodeDistribution.reduce((sum, e) => sum + e.percentage, 0);
  const getTotalDistributedAmount = () => tempEpisodeDistribution.reduce((sum, e) => sum + e.amount, 0);

  const calculateTotals = () => {
    setTotals(documentTotals(items));
  };

  const selectSupplier = (supplier: Supplier) => {
    setFormData({ ...formData, supplier: supplier.id, supplierName: supplier.fiscalName, paymentTerms: supplier.paymentMethod });
    setTouched((prev) => ({ ...prev, supplier: true }));
    setShowSupplierModal(false);
    setSupplierSearch("");
  };

  const selectAccount = (subAccount: SubAccount) => {
    if (currentItemIndex !== null) {
      const newItems = [...items];
      newItems[currentItemIndex] = { ...newItems[currentItemIndex], subAccountId: subAccount.id, subAccountCode: subAccount.code, subAccountDescription: subAccount.description };
      setItems(newItems);
      setTouched((prev) => ({ ...prev, [`item_${currentItemIndex}_account`]: true }));
    }
    setShowAccountModal(false);
    setAccountSearch("");
    setCurrentItemIndex(null);
  };

  const validateForm = (silent = false) => {
    const newErrors: Record<string, string> = {};
    if (!noSupplier && !formData.supplier) newErrors.supplier = "Selecciona un proveedor";
    if (!formData.department) newErrors.department = "Selecciona un departamento";
    if (!formData.generalDescription.trim()) newErrors.generalDescription = "Descripción obligatoria";
    items.forEach((item, index) => {
      if (!item.description.trim()) newErrors[`item_${index}_description`] = "Obligatorio";
      if (!item.subAccountId) newErrors[`item_${index}_account`] = "Obligatorio";
      if (item.quantity <= 0) newErrors[`item_${index}_quantity`] = "Debe ser > 0";
      if (item.unitPrice <= 0) newErrors[`item_${index}_unitPrice`] = "Debe ser > 0";
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: string) => setTouched((prev) => ({ ...prev, [field]: true }));

  const handleFileUpload = (file: File) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      appToast.error("Solo PDF o imágenes hasta 10MB"); return;
    }
    setUploadedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, []);



  const savePO = async (sendForApproval: boolean) => {
    if (sendForApproval && !validateForm()) return;
    if (poStatus !== "draft" && poStatus !== "rejected") { appToast.error("Solo se pueden editar borradores o rechazadas"); return; }

    setSaving(true);
    try {
      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      
      let fileUrl = existingFileUrl;
      let fileName = existingFileName;

      if (uploadedFile) {
        const fileRef = ref(storage, `projects/${id}/pos/${poNumber}/${uploadedFile.name}`);
        await uploadBytes(fileRef, uploadedFile);
        fileUrl = await getDownloadURL(fileRef);
        fileName = uploadedFile.name;
      }

      const itemsData = items.map((item) => ({
        description: item.description?.trim() || "", 
        subAccountId: item.subAccountId || "",
        subAccountCode: item.subAccountCode || "", 
        subAccountDescription: item.subAccountDescription || "",
        date: item.date || new Date().toISOString().split("T")[0], 
        quantity: item.quantity || 1, 
        unitPrice: item.unitPrice || 0,
        baseAmount: item.baseAmount || 0, 
        vatRate: item.vatRate ?? 21, 
        vatAmount: item.vatAmount || 0,
        irpfRate: item.irpfRate || 0, 
        irpfAmount: item.irpfAmount || 0, 
        totalAmount: item.totalAmount || 0,
        episodeAssignment: item.episodeAssignment || "general",
        ...(item.episodes && item.episodes.length > 0 ? { episodes: item.episodes } : {}),
      }));

      const poData: any = {
        supplier: formData.supplierName || "",
        supplierId: formData.supplier || "",
        noSupplier,
        department: formData.department || "",
        poType: formData.poType || "service", 
        currency: formData.currency || "EUR",
        generalDescription: formData.generalDescription?.trim() || "", 
        description: formData.generalDescription?.trim() || "",
        paymentTerms: formData.paymentTerms || "", 
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
      
      // Solo añadir attachment si existe
      if (fileUrl) {
        poData.attachmentUrl = fileUrl;
        poData.attachmentFileName = fileName || "";
      }

      // Si la PO tenía items comprometidos anteriormente, guardarlos para el cálculo de diferencia al aprobar
      if (wasApprovedBefore && originalCommittedItems && originalCommittedItems.length > 0) {
        poData.previousCommittedItems = originalCommittedItems;
      }

      if (sendForApproval) {
        const approvalSteps = generateApprovalSteps(formData.department);
        if (shouldAutoApprove(approvalSteps)) {
          poData.status = "approved";
          poData.approvedAt = Timestamp.now();
          poData.approvedBy = permissions.userId || "";
          poData.approvedByName = permissions.userName || "";
          poData.autoApproved = true;
          // Se guardan los pasos omitidos (con su motivo) para auditoría.
          if (approvalSteps.length) { poData.approvalSteps = approvalSteps; poData.approverIds = []; poData.currentApprovalStep = -1; }
          poData.committedAmount = totals.baseAmount;
          poData.remainingAmount = totals.baseAmount;
          // Limpiar previousCommittedItems ya que se va a aprobar directamente
          poData.previousCommittedItems = deleteField();
        } else {
          poData.status = "pending";
          poData.approvalSteps = approvalSteps;
          poData.approverIds = approverIdsOf(approvalSteps);
          poData.currentApprovalStep = approvalSteps.findIndex((x) => x.status === "pending");
          // Si la configuración es on_create, también comprometer en pending
          if (costSettings.poCommitmentTrigger === "on_create" && !wasApprovedBefore) {
            // Solo comprometer si NO tenía comprometido anterior (nuevo PO)
            poData.committedAmount = totals.baseAmount;
            poData.remainingAmount = totals.baseAmount;
          }
          // Si ya tenía comprometido, mantener el anterior hasta aprobar
        }
      } else {
        poData.status = "draft";
      }

      await updateDoc(doc(db, `projects/${id}/pos`, poId), poData);
      autosave.clear();

      // Actualizar facturas vinculadas si cambiaron las cuentas de los items
      await updateLinkedInvoicesAccounts();

      // Presupuesto: se recalcula desde los documentos (lib/budgetLedger).
      await syncBudget(id);

      setSuccessMessage(poData.status === "approved" ? "PO aprobada automáticamente" : poData.status === "pending" ? "PO enviada para aprobación" : "Borrador guardado");
      setTimeout(() => router.push(`/project/${id}/accounting/pos`), 1500);
    } catch (error: any) {
      appToast.error(error);
    } finally {
      setSaving(false);
    }
  };

  // Helper para descomprometer items específicos


  // Helper para actualizar facturas vinculadas cuando cambian las cuentas de los items de la PO
  const updateLinkedInvoicesAccounts = async () => {
    // Detectar qué items cambiaron de cuenta
    const changedItems: { index: number; newSubAccountId: string; newSubAccountCode: string; newSubAccountDescription: string }[] = [];
    
    items.forEach((item, index) => {
      const original = originalItems[index];
      if (original && original.subAccountId !== item.subAccountId) {
        changedItems.push({
          index,
          newSubAccountId: item.subAccountId,
          newSubAccountCode: item.subAccountCode,
          newSubAccountDescription: item.subAccountDescription,
        });
      }
    });

    if (changedItems.length === 0) return;

    // Buscar facturas vinculadas a esta PO
    const invoicesSnapshot = { docs: await getScopedDocs(collection(db, `projects/${id}/invoices`), scopeFromPermissions(permissions), [where("poId", "==", poId)]) };
    
    for (const invDoc of invoicesSnapshot.docs) {
      const invData = invDoc.data();
      if (invData.poId !== poId) continue;
      
      // Verificar si algún item de la factura está afectado
      let needsUpdate = false;
      const updatedInvoiceItems = (invData.items || []).map((invItem: any) => {
        const changedItem = changedItems.find(ci => ci.index === invItem.poItemIndex);
        if (changedItem) {
          needsUpdate = true;
          return {
            ...invItem,
            subAccountId: changedItem.newSubAccountId,
            subAccountCode: changedItem.newSubAccountCode,
            subAccountDescription: changedItem.newSubAccountDescription,
          };
        }
        return invItem;
      });

      if (needsUpdate) {
        await updateDoc(doc(db, `projects/${id}/invoices`, invDoc.id), {
          items: updatedInvoiceItems,
          updatedAt: Timestamp.now(),
        });
      }
    }
  };

  const canEdit = () => poStatus === "draft" || poStatus === "rejected";
  const getCurrencySymbol = () => CURRENCIES.find((c) => c.value === formData.currency)?.symbol || "€";
  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount);

  const getApprovalPreview = () => {
    const steps = generateApprovalSteps(formData.department);
    const pending = steps.filter((s) => s.status === "pending").length;
    if (!pending) return { autoApprove: true, message: "Se aprobará automáticamente", steps };
    return { autoApprove: false, message: pending + " nivel" + (pending > 1 ? "es" : "") + " de aprobación", steps };
  };


  const getCompletionPercentage = () => {
    let completed = 0, total = 4;
    if (formData.supplier || noSupplier) completed++;
    if (formData.department) completed++;
    if (formData.generalDescription.trim()) completed++;
    if (items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0)) completed++;
    return Math.round((completed / total) * 100);
  };

  const filteredSuppliers = suppliers.filter((s) => s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) || s.commercialName?.toLowerCase().includes(supplierSearch.toLowerCase()) || s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()));
  const filteredSubAccounts = subAccounts.filter((s) => s.code.toLowerCase().includes(accountSearch.toLowerCase()) || s.description.toLowerCase().includes(accountSearch.toLowerCase()));

  const availableDepartments = getAvailableDepartments(departments);

  const approvalPreview = getApprovalPreview();
  const completionPercentage = getCompletionPercentage();
  const hasError = (field: string) => touched[field] && errors[field];
  const isValid = (field: string) => touched[field] && !errors[field];

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || accessDenied) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="hidden">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para editar esta orden de compra"}</p>
          <Link
            href={`/project/${id}/accounting/pos`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
          >
            <ArrowLeft size={16} />
            Volver a POs
          </Link>
        </div>
      </div>
    );
  }


  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[53px]">
        <div className="px-6 pt-8 sm:px-10">
          <div className="relative flex min-h-[44px] items-center justify-start border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">Editar orden de compra</h1>
                <AutosaveStatus savedAt={autosave.savedAt} />
                <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[13px] font-mono font-medium">
                  PO-{poNumber}
                </span>
                {poVersion > 1 && (
                  <span className="px-2 py-1 bg-[#F7F7F8] text-slate-900 rounded-lg text-xs font-medium">
                    V{String(poVersion).padStart(2, "0")}
                  </span>
                )}
                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${poStatus === "draft" ? "bg-slate-100 text-slate-700" : poStatus === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {poStatus === "draft" ? "Borrador" : poStatus === "rejected" ? "Rechazada" : "Pendiente"}
                </span>
                {permissions.fixedDepartment && (
                  <span className="px-2 py-1 bg-[#F7F7F8] text-slate-900 rounded-lg text-xs font-medium">
                    {permissions.fixedDepartment}
                  </span>
                )}
              </div>
            </div>

            <div className="absolute right-0 flex items-center gap-3">
              <Link href={`/project/${id}/accounting/pos/${poId}`} className="flex items-center gap-2 px-4 py-1.5 border border-slate-200 text-slate-700 rounded-md hover:bg-slate-50 text-[13px] font-medium transition-colors">
                <Eye size={16} />
                Ver
              </Link>
              {canEdit() && (
                <>
                  <button onClick={() => savePO(false)} disabled={saving} className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-slate-700 rounded-md hover:bg-slate-50 text-[13px] font-medium transition-colors disabled:opacity-50">
                    <Save size={16} />
                    Borrador
                  </button>
                  <button onClick={() => savePO(true)} disabled={saving} className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                    {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</> : <>{approvalPreview.autoApprove ? <CheckCircle size={16} /> : <Send size={16} />}{approvalPreview.autoApprove ? "Aprobar" : "Enviar"}</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 sm:px-10 py-8">
        <AutosaveNotice restoredAt={autosave.restoredAt} onDiscard={() => { autosave.discard(); window.location.reload(); }} />

        {!canEdit() && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600" />
            <span className="text-[13px] text-amber-700 font-medium">Esta PO está pendiente de aprobación y no se puede editar.</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Proveedor {!noSupplier && "*"}</label>
                  <button
                    onClick={() => canEdit() && setShowSupplierModal(true)}
                    disabled={!canEdit()}
                    onBlur={() => handleBlur("supplier")}
                    className={`w-full px-4 py-2 border ${noSupplier ? "border-dashed border-slate-300 bg-slate-50" : hasError("supplier") ? "border-red-300 bg-red-50" : isValid("supplier") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-md hover:border-slate-300 transition-colors text-left flex items-center justify-between bg-white disabled:bg-slate-50 disabled:cursor-not-allowed text-[13px]`}
                  >
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 ${isValid("supplier") ? "bg-emerald-100" : "bg-slate-100"} rounded-lg flex items-center justify-center`}>
                          {isValid("supplier") ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Building2 size={16} className="text-slate-500" />}
                        </div>
                        <span className="font-medium text-slate-900">{formData.supplierName}</span>
                      </div>
                    ) : noSupplier ? (
                      <div className="flex items-center gap-3">
                        <div className="hidden">
                          <Building2 size={16} className="text-slate-400" />
                        </div>
                        <span className="text-slate-500 text-[13px]">Sin proveedor asignado. Se completará más adelante</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Seleccionar proveedor...</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("supplier") && !noSupplier && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.supplier}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
                      Departamento *
                      {permissions.fixedDepartment && (
                        <span className="ml-2 text-xs text-slate-400 font-normal">(asignado)</span>
                      )}
                    </label>
                    <div className="relative" ref={departmentDropdownRef}>
                      <button
                        type="button"
                        onClick={() => { if (canEdit() && !permissions.fixedDepartment) setShowDepartmentDropdown(!showDepartmentDropdown); }}
                        onBlur={() => handleBlur("department")}
                        disabled={!canEdit() || !!permissions.fixedDepartment}
                        className={`w-full px-4 py-2 border ${hasError("department") ? "border-red-300 bg-red-50" : isValid("department") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-md text-left flex items-center justify-between bg-white disabled:bg-slate-50 text-[13px] disabled:cursor-not-allowed hover:border-slate-300 transition-colors`}
                      >
                        <span className={formData.department ? "text-slate-900" : "text-slate-400"}>
                          {formData.department || "Seleccionar..."}
                        </span>
                        <div className="flex items-center gap-2">
                          {permissions.fixedDepartment && <Lock size={14} className="text-slate-400" />}
                          {isValid("department") && !permissions.fixedDepartment && <CheckCircle2 size={16} className="text-emerald-600" />}
                          <ChevronDown size={16} className={"text-slate-400 transition-transform " + (showDepartmentDropdown ? "rotate-180" : "")} />
                        </div>
                      </button>
                      {showDepartmentDropdown && (
                        <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                          {availableDepartments.map((dept) => (
                            <button
                              key={dept}
                              type="button"
                              onClick={() => { setFormData({ ...formData, department: dept }); setShowDepartmentDropdown(false); handleBlur("department"); }}
                              className={"w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors " + (formData.department === dept ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600")}
                            >
                              {dept}
                            </button>
                          ))}
                        </AnchoredPanel>
                      )}
                    </div>
                    {hasError("department") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.department}</p>}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Tipo de PO</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PO_TYPES.map((type) => {
                        const Icon = type.icon;
                        const isSelected = formData.poType === type.value;
                        return (
                          <button key={type.value} onClick={() => canEdit() && setFormData({ ...formData, poType: type.value as any })} disabled={!canEdit()} className={`px-3 py-1.5 rounded-md border transition-all flex items-center gap-2 text-[13px] ${isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-600 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`} title={type.description}>
                            <Icon size={14} />
                            {type.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Moneda: compacta */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-slate-600">Moneda</span>
                  <div className="inline-flex rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5">
                    {CURRENCIES.map((c) => (
                      <button key={c.value} type="button" onClick={() => setFormData({ ...formData, currency: c.value })}
                        className={cx("h-6 rounded-[5px] px-2 text-xs transition-colors", formData.currency === c.value ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900")}>
                        {c.symbol} {c.value}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Descripción general *</label>
                  <div className="relative">
                    <textarea value={formData.generalDescription} onChange={(e) => setFormData({ ...formData, generalDescription: e.target.value })} onBlur={() => handleBlur("generalDescription")} disabled={!canEdit()} placeholder="Describe el propósito de esta orden de compra..." rows={3} className={`w-full px-2.5 py-1.5 border ${hasError("generalDescription") ? "border-red-300 bg-red-50" : isValid("generalDescription") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white resize-none text-[13px] pr-10 disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                    {isValid("generalDescription") && <CheckCircle2 size={16} className="absolute right-4 top-4 text-emerald-600" />}
                  </div>
                  {hasError("generalDescription") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.generalDescription}</p>}
                </div>
              </div>
            </div>


            {/* Items */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-visible">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">Items</h2>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{items.length}</span>
                </div>
                {canEdit() && (
                  <button onClick={addItem} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium transition-colors border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                    <Plus size={14} />
                    Añadir
                  </button>
                )}
              </div>

              <div className="p-6 space-y-4">
                {items.map((item, index) => {
                  const itemHasAllFields = item.description.trim() && item.subAccountId && item.quantity > 0 && item.unitPrice > 0;
                  const selectedAccount = subAccounts.find((a) => a.id === item.subAccountId);

                  return (
                    <div key={item.id} className={`border rounded-md p-5 transition-all ${itemHasAllFields ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50"}`}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            {itemHasAllFields ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Hash size={12} />}
                            Item {index + 1}
                          </span>
                          {itemHasAllFields && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-medium">Completo</span>}
                        </div>
                        {items.length > 1 && canEdit() && (
                          <button onClick={() => removeItem(index)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="space-y-4">
                        <input type="text" value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} onBlur={() => handleBlur(`item_${index}_description`)} disabled={!canEdit()} placeholder="Descripción del item..." className={`w-full px-2.5 py-1.5 border ${hasError(`item_${index}_description`) ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"} rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />

                        <div>
                          {/* Aviso si tiene facturas contabilizadas */}
                          {itemInvoiceStatus[index]?.hasAccountedInvoices && (
                            <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                              <Lock size={12} className="text-red-500 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-red-700">Este item tiene facturas contabilizadas ({itemInvoiceStatus[index].invoiceNumbers.join(", ")}). No se puede cambiar la cuenta.</span>
                            </div>
                          )}
                          {/* Aviso si tiene facturas codificadas pero no contabilizadas */}
                          {itemInvoiceStatus[index]?.hasInvoices && !itemInvoiceStatus[index]?.hasAccountedInvoices && (
                            <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                              <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />
                              <span className="text-xs text-amber-700">Este item tiene facturas asignadas ({itemInvoiceStatus[index].invoiceNumbers.join(", ")}). Cambiar la cuenta las afectará.</span>
                            </div>
                          )}
                          <button 
                            onClick={async () => { 
                              if (itemInvoiceStatus[index]?.hasAccountedInvoices) {
                                return; // Bloqueado
                              }
                              if (itemInvoiceStatus[index]?.hasInvoices && !(await confirmDialog({ title: "¿Cambiar la cuenta del ítem?", message: "Tiene facturas vinculadas; también cambiará en ellas.", confirmLabel: "Cambiar" }))) {
                                return;
                              }
                              setCurrentItemIndex(index); 
                              setShowAccountModal(true); 
                            }} 
                            disabled={!canEdit() || itemInvoiceStatus[index]?.hasAccountedInvoices} 
                            className={`w-full px-4 py-3 border ${hasError(`item_${index}_account`) ? "border-red-300 bg-red-50" : itemInvoiceStatus[index]?.hasAccountedInvoices ? "border-red-200 bg-red-50" : item.subAccountCode ? "border-emerald-200 bg-emerald-50" : "border-slate-200"} rounded-md text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`}>
                            {item.subAccountCode ? (
                              <div className="flex items-center gap-2">
                                {itemInvoiceStatus[index]?.hasAccountedInvoices ? (
                                  <Lock size={14} className="text-red-500" />
                                ) : (
                                  <CheckCircle2 size={14} className="text-emerald-600" />
                                )}
                                <span className="font-mono text-slate-900">{item.subAccountCode} - {item.subAccountDescription}</span>
                              </div>
                            ) : (
                              <span className="text-slate-400">Seleccionar cuenta...</span>
                            )}
                            <Search size={14} className="text-slate-400" />
                          </button>
                          {canSeeBudgetFigures && selectedAccount && (
                            <div className="mt-2 p-2 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                              <span className="text-slate-500">Disponible:</span>
                              <span className={`font-medium ${
                                selectedAccount.available < item.baseAmount
                                  ? "text-red-600"
                                  : selectedAccount.available < selectedAccount.budgeted * 0.2
                                  ? "text-amber-600"
                                  : "text-emerald-600"
                              }`}>
                                {formatCurrency(selectedAccount.available)} €
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Asignación de capítulos */}
                        {episodesEnabled && totalEpisodes > 0 && (
                          <div>
                            <button
                              onClick={async () => {
                                if (itemInvoiceStatus[index]?.hasAccountedInvoices) {
                                  return; // Bloqueado
                                }
                                if (itemInvoiceStatus[index]?.hasInvoices && !(await confirmDialog({ title: "¿Cambiar los capítulos del ítem?", message: "Tiene facturas vinculadas; también cambiará en ellas.", confirmLabel: "Cambiar" }))) {
                                  return;
                                }
                                openEpisodeModal(index);
                              }}
                              disabled={!canEdit() || itemInvoiceStatus[index]?.hasAccountedInvoices}
                              className={`w-full px-4 py-2 border rounded-md text-[13px] text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white disabled:bg-slate-50 disabled:cursor-not-allowed ${
                                itemInvoiceStatus[index]?.hasAccountedInvoices ? "border-red-200 bg-red-50" : item.episodeAssignment === "general" ? "border-slate-200" : "border-slate-200 bg-[#F7F7F8]"
                              }`}
                            >
                              {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                                <div className="flex items-center gap-2">
                                  {itemInvoiceStatus[index]?.hasAccountedInvoices ? (
                                    <Lock size={14} className="text-red-500" />
                                  ) : (
                                    <Layers size={14} className="text-slate-700" />
                                  )}
                                  <span className="text-slate-900">
                                    {item.episodes.length === 1 ? `Cap. ${item.episodes[0].episode}` : `${item.episodes.length} capítulos`}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  {itemInvoiceStatus[index]?.hasAccountedInvoices ? (
                                    <Lock size={14} className="text-red-500" />
                                  ) : (
                                    <Layers size={14} className="text-slate-400" />
                                  )}
                                  <span className="text-slate-600">General (todos los capítulos)</span>
                                </div>
                              )}
                              <ChevronDown size={14} className="text-slate-400" />
                            </button>
                            {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 1 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.episodes.map((ep) => (
                                  <span key={ep.episode} className="text-xs bg-[#F1F1F3] text-slate-900 px-2 py-0.5 rounded-lg">
                                    {ep.episode}: {formatCurrency(ep.amount)} {getCurrencySymbol()}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Fecha</label>
                            <input type="date" value={item.date} onChange={(e) => updateItem(index, "date", e.target.value)} disabled={!canEdit()} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white disabled:bg-slate-50 disabled:cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                            <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)} disabled={!canEdit()} className={`w-full px-2.5 py-1.5 border ${item.quantity > 0 ? "border-emerald-200" : "border-slate-200"} rounded-md text-[13px] bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Precio unit.</label>
                            <div className="relative">
                              <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)} disabled={!canEdit()} className={`w-full pl-6 pr-3 py-1.5 border ${item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200"} rounded-md text-[13px] bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{getCurrencySymbol()}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Base</label>
                            <div className="px-3 py-2.5 bg-slate-100 rounded-md text-[13px] font-medium text-slate-900">{formatCurrency(item.baseAmount)} {getCurrencySymbol()}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                            <div className="relative custom-dropdown">
                              <button
                                type="button"
                                onClick={() => { if (canEdit()) setOpenDropdown(openDropdown === `vat-${index}` ? null : `vat-${index}`); }}
                                className={`w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${!canEdit() ? "opacity-50 cursor-not-allowed bg-slate-50" : ""}`}
                              >
                                <span className="text-slate-900 truncate">{VAT_RATES.find(r => r.value === item.vatRate)?.label ?? `${item.vatRate}%`}</span>
                                <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `vat-${index}` ? "rotate-180" : ""}`} />
                              </button>
                              {openDropdown === `vat-${index}` && (
                                <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                  {VAT_RATES.map(opt => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => { updateItem(index, "vatRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                      className={`w-full px-4 py-2 text-left text-[13px] transition-colors ${item.vatRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </AnchoredPanel>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IRPF</label>
                            <div className="relative custom-dropdown">
                              <button
                                type="button"
                                onClick={() => { if (canEdit()) setOpenDropdown(openDropdown === `irpf-${index}` ? null : `irpf-${index}`); }}
                                className={`w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${!canEdit() ? "opacity-50 cursor-not-allowed bg-slate-50" : ""}`}
                              >
                                <span className="text-slate-900 truncate">{IRPF_RATES.find(r => r.value === item.irpfRate)?.label ?? `${item.irpfRate}%`}</span>
                                <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `irpf-${index}` ? "rotate-180" : ""}`} />
                              </button>
                              {openDropdown === `irpf-${index}` && (
                                <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                  {IRPF_RATES.map(opt => (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      onClick={() => { updateItem(index, "irpfRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                      className={`w-full px-4 py-2 text-left text-[13px] transition-colors ${item.irpfRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                    >
                                      {opt.label}
                                    </button>
                                  ))}
                                </AnchoredPanel>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">+IVA</label>
                            <div className="px-3 py-2.5 bg-emerald-50 rounded-md text-[13px] font-medium text-emerald-700">+{formatCurrency(item.vatAmount)}</div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">-IRPF</label>
                            <div className="px-3 py-2.5 bg-red-50 rounded-md text-[13px] font-medium text-red-700">-{formatCurrency(item.irpfAmount)}</div>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <div className="flex items-baseline gap-3 text-[13px]"><span className="text-xs text-slate-400">Total {formatCurrency(item.totalAmount)} {getCurrencySymbol()}</span><span className="text-slate-500">Base</span><span className="text-base font-semibold tabular-nums text-slate-900">{formatCurrency(item.baseAmount)} {getCurrencySymbol()}</span></div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


            {/* File Upload */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Adjuntar presupuesto</h2>
                <p className="text-xs text-slate-500 mt-0.5">Opcional - PDF, JPG o PNG hasta 10MB</p>
              </div>

              <div className="p-6">
                {existingFileUrl && !uploadedFile && (
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md p-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#F1F1F3] rounded-lg flex items-center justify-center">
                        <FileText size={18} className="text-slate-700" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-slate-900">{existingFileName}</p>
                        <a href={existingFileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-700 hover:underline">Ver archivo actual</a>
                      </div>
                    </div>
                    {canEdit() && (
                      <button onClick={() => { setExistingFileUrl(""); setExistingFileName(""); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <X size={16} />
                      </button>
                    )}
                  </div>
                )}

                {canEdit() && (
                  <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} className={`border-2 border-dashed rounded-md p-8 text-center transition-all ${isDragging ? "border-slate-400 bg-[#F7F7F8]" : uploadedFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}>
                    {uploadedFile ? (
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-md p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <FileUp size={18} className="text-emerald-600" />
                          </div>
                          <div className="text-left">
                            <span className="text-[13px] font-medium text-slate-900 block">{uploadedFile.name}</span>
                            <span className="text-xs text-slate-500">{(uploadedFile.size / 1024).toFixed(0)} KB</span>
                          </div>
                        </div>
                        <button onClick={() => setUploadedFile(null)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer block">
                        <div className="hidden">
                          <Upload size={20} className="text-slate-400" />
                        </div>
                        <p className="text-[13px] font-medium text-slate-700">Arrastra o haz clic para subir</p>
                        <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG (máx. 10MB)</p>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); }} className="hidden" />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Additional Info */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información adicional</h2>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Condiciones de pago</label>
                  <input type="text" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} disabled={!canEdit()} placeholder="Ej: Transferencia 30 días..." className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white text-[13px] disabled:bg-slate-50 disabled:cursor-not-allowed" />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Notas internas</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} disabled={!canEdit()} placeholder="Notas adicionales..." rows={2} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white resize-none text-[13px] disabled:bg-slate-50 disabled:cursor-not-allowed" />
                </div>
              </div>
            </div>
          </div>


          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="space-y-4">
              {/* Progress */}
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-medium text-slate-700">Progreso</span>
                  <span className={`text-[13px] font-bold ${completionPercentage === 100 ? "text-emerald-600" : "text-slate-900"}`}>{completionPercentage}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${completionPercentage === 100 ? "bg-emerald-500" : "bg-slate-700"}`} style={{ width: `${completionPercentage}%` }} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {formData.supplier || noSupplier ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={formData.supplier || noSupplier ? "text-slate-700" : "text-slate-400"}>Proveedor</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {formData.department ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={formData.department ? "text-slate-700" : "text-slate-400"}>Departamento</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {formData.generalDescription.trim() ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={formData.generalDescription.trim() ? "text-slate-700" : "text-slate-400"}>Descripción</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0) ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0) ? "text-slate-700" : "text-slate-400"}>Items válidos</span>
                  </div>
                </div>
              </div>

              {/* Totals */}
              <AmountSummary base={totals.baseAmount} vat={totals.vatAmount} irpf={totals.irpfAmount} total={totals.totalAmount} symbol={getCurrencySymbol()} />

              {/* Approval Preview */}
              {canEdit() && (
                <div className={`border rounded-lg overflow-hidden ${approvalPreview.autoApprove ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className="px-5 py-4 border-b border-opacity-50" style={{ borderColor: approvalPreview.autoApprove ? "#a7f3d0" : "#fcd34d" }}>
                    <div className="flex items-center gap-3">
                      {approvalPreview.autoApprove ? (
                        <div className="w-10 h-10 bg-emerald-100 rounded-md flex items-center justify-center">
                          <CheckCircle size={20} className="text-emerald-600" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-amber-100 rounded-md flex items-center justify-center">
                          <Clock size={20} className="text-amber-600" />
                        </div>
                      )}
                      <div>
                        <p className={`font-semibold ${approvalPreview.autoApprove ? "text-emerald-800" : "text-amber-800"}`}>
                          {approvalPreview.autoApprove ? "Aprobación automática" : "Requiere aprobación"}
                        </p>
                        <p className={`text-[13px] ${approvalPreview.autoApprove ? "text-emerald-700" : "text-amber-700"}`}>{approvalPreview.message}</p>
                      </div>
                    </div>
                  </div>

                  {approvalPreview.steps.length > 0 && (
                  <div className="bg-white/60 px-5 py-4">
                    <ApprovalSteps steps={approvalPreview.steps} department={formData.department} preview />
                  </div>
                )}
                </div>
              )}

              {/* Info */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Info size={14} className="text-slate-500" />
                  </div>
                  <div className="text-[13px] text-slate-600">
                    <p className="font-medium text-slate-700 mb-2">Proceso de la PO</p>
                    <ul className="space-y-1.5 text-slate-500">
                      <li className="flex items-start gap-2"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" /><span>Los borradores no comprometen presupuesto</span></li>
                      <li className="flex items-start gap-2"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" /><span>Una vez aprobada, se compromete el presupuesto</span></li>
                      <li className="flex items-start gap-2"><ChevronRight size={12} className="mt-0.5 flex-shrink-0" /><span>Las facturas se vinculan a la PO aprobada</span></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>


      <SupplierPickerModal
        open={showSupplierModal}
        onClose={() => { setShowSupplierModal(false); setSupplierSearch(""); }}
        suppliers={suppliers}
        onSelect={selectSupplier}
        onNoSupplier={() => {
          setNoSupplier(true);
          setFormData((prev: any) => ({ ...prev, supplier: "", supplierName: "" }));
          setShowSupplierModal(false);
          setSupplierSearch("");
        }}
      />
      <AccountPickerModal
        open={showAccountModal}
        onClose={() => { setShowAccountModal(false); setAccountSearch(""); setCurrentItemIndex(null); }}
        subAccounts={subAccounts}
        showFigures={canSeeBudgetFigures}
        selectedId={currentItemIndex !== null ? items[currentItemIndex]?.subAccountId : undefined}
        onSelect={selectAccount}
      />
      <EpisodeModal
        open={showEpisodeModal && episodeItemIndex !== null}
        onClose={() => { setShowEpisodeModal(false); setEpisodeItemIndex(null); }}
        baseAmount={episodeItemIndex !== null ? items[episodeItemIndex]?.baseAmount || 0 : 0}
        totalEpisodes={totalEpisodes}
        initial={episodeItemIndex !== null ? items[episodeItemIndex]?.episodes : undefined}
        label={episodeItemIndex !== null ? `Línea ${episodeItemIndex + 1}` : undefined}
        onSave={(dist) => saveEpisodeDistribution(dist)}
      />
    </div>
  );
}
