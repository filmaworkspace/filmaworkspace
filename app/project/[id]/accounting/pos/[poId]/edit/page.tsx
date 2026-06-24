"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
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
import { getCostSettings, shouldCommitPO } from "@/lib/budgetRules";
import { commitPO } from "@/lib/budgetOperations";

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
  status: "pending" | "approved" | "rejected";
  requireAll: boolean;
  hasAmountThreshold?: boolean;
  amountThreshold?: number;
  amountCondition?: "above" | "below" | "between";
  amountThresholdMax?: number;
}

interface Member {
  userId: string;
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
  const [successMessage, setSuccessMessage] = useState("");
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

  // Dropdown de departamento
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    supplier: "", supplierName: "", department: "",
    poType: "service" as "rental" | "purchase" | "service" | "deposit",
    currency: "EUR", generalDescription: "", paymentTerms: "", notes: "",
  });

  const [items, setItems] = useState<POItem[]>([{
    id: "1", description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "",
    date: new Date().toISOString().split("T")[0], quantity: 1, unitPrice: 0, baseAmount: 0,
    vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general",
  }]);

  const [totals, setTotals] = useState({ baseAmount: 0, vatAmount: 0, irpfAmount: 0, totalAmount: 0 });
  
  // Estado para rastrear facturas asociadas a cada item (por índice)
  const [itemInvoiceStatus, setItemInvoiceStatus] = useState<Record<number, ItemInvoiceStatus>>({});
  
  // Items originales comprometidos (para mantener comprometido durante edición)
  const [originalCommittedItems, setOriginalCommittedItems] = useState<{subAccountId: string; baseAmount: number}[] | null>(null);
  const [wasApprovedBefore, setWasApprovedBefore] = useState(false);
  
  // Items originales con todas sus propiedades (para detectar cambios de cuenta)
  const [originalItems, setOriginalItems] = useState<{subAccountId: string; subAccountCode: string; subAccountDescription: string}[]>([]);

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
        setOriginalCommittedItems(hadCommittedItems.map((item: any) => ({
          subAccountId: item.subAccountId,
          baseAmount: item.baseAmount || 0,
        })).filter((item: any) => item.subAccountId && item.baseAmount > 0));
        setWasApprovedBefore(true);
      }

      setFormData({
        supplier: poData.supplierId || "", supplierName: poData.supplier || "",
        department: poData.department || "", poType: poData.poType || "service",
        currency: poData.currency || "EUR",
        generalDescription: poData.description || poData.generalDescription || "",
        paymentTerms: poData.paymentTerms || "", notes: poData.notes || "",
      });

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
          if (userDoc.exists()) name = userDoc.data().displayName || userDoc.data().email || name;
        } catch (e) {}
        membersData.push({ userId: memberDocSnap.id, name, email: memberData.email, role: memberData.role, department: memberData.department, position: memberData.position });
      }
      setMembers(membersData);

      const approvalConfigDoc = await getDoc(doc(db, `projects/${id}/config/approvals`));
      if (approvalConfigDoc.exists()) setApprovalConfig(approvalConfigDoc.data().poApprovals || []);

      const suppliersSnapshot = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName", "asc")));
      setSuppliers(suppliersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Supplier)));

      const accountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const allSubAccounts: SubAccount[] = [];
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        subAccountsSnapshot.docs.forEach((subDoc) => {
          const data = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id, code: data.code, description: data.description,
            budgeted: data.budgeted || 0, committed: data.committed || 0, actual: data.actual || 0,
            available: (data.budgeted || 0) - (data.committed || 0) - (data.actual || 0),
            accountId: accountDoc.id, accountCode: accountData.code, accountDescription: accountData.description,
          });
        });
      }
      setSubAccounts(allSubAccounts);

      // Cargar facturas asociadas a esta PO para verificar items con facturas contabilizadas
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
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


  const resolveApprovers = (step: ApprovalStep, dept?: string): { ids: string[]; names: string[] } => {
    let approverIds: string[] = [];
    switch (step.approverType) {
      case "fixed": approverIds = step.approvers || []; break;
      case "role": approverIds = members.filter((m) => m.role && step.roles?.includes(m.role)).map((m) => m.userId); break;
      case "hod": approverIds = members.filter((m) => m.position === "HOD" && m.department === (step.department || dept)).map((m) => m.userId); break;
      case "coordinator": approverIds = members.filter((m) => m.position === "Coordinator" && m.department === (step.department || dept)).map((m) => m.userId); break;
    }
    const approverNames = approverIds.map((id) => { const member = members.find((m) => m.userId === id); return member?.name || member?.email || id; });
    return { ids: approverIds, names: approverNames };
  };

  const generateApprovalSteps = (dept?: string): ApprovalStepStatus[] => {
    if (approvalConfig.length === 0) return [];
    return approvalConfig.map((step) => {
      const { ids, names } = resolveApprovers(step, dept);
      const stepData: any = { 
        id: step.id || "", 
        order: step.order || 0, 
        approverType: step.approverType || "role", 
        approvers: ids, 
        approverNames: names, 
        roles: step.roles || [], 
        department: step.department || "", 
        approvedBy: [], 
        rejectedBy: [], 
        status: "pending" as const, 
        requireAll: step.requireAll ?? false,
        hasAmountThreshold: step.hasAmountThreshold || false,
      };
      // Solo añadir campos de threshold si existen
      if (step.amountThreshold !== undefined) stepData.amountThreshold = step.amountThreshold;
      if (step.amountCondition !== undefined) stepData.amountCondition = step.amountCondition;
      if (step.amountThresholdMax !== undefined) stepData.amountThresholdMax = step.amountThresholdMax;
      return stepData;
    });
  };

  const shouldAutoApprove = (steps: ApprovalStepStatus[]): boolean => steps.length === 0 || steps.every((step) => step.approvers.length === 0);

  const calculateItemTotal = (item: POItem) => {
    const baseAmount = item.quantity * item.unitPrice;
    const vatAmount = baseAmount * (item.vatRate / 100);
    const irpfAmount = baseAmount * (item.irpfRate / 100);
    return { baseAmount, vatAmount, irpfAmount, totalAmount: baseAmount + vatAmount - irpfAmount };
  };

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

  const saveEpisodeDistribution = () => {
    if (episodeItemIndex === null) return;
    const newItems = [...items];
    const isGeneral = tempEpisodeDistribution.length === 0 || tempEpisodeDistribution.length === totalEpisodes;
    newItems[episodeItemIndex] = {
      ...newItems[episodeItemIndex],
      episodeAssignment: isGeneral ? "general" : "specific",
      episodes: tempEpisodeDistribution.length > 0 && tempEpisodeDistribution.length < totalEpisodes ? tempEpisodeDistribution : undefined,
    };
    setItems(newItems);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
    setTempEpisodeDistribution([]);
  };

  const getTotalDistributedPercentage = () => tempEpisodeDistribution.reduce((sum, e) => sum + e.percentage, 0);
  const getTotalDistributedAmount = () => tempEpisodeDistribution.reduce((sum, e) => sum + e.amount, 0);

  const calculateTotals = () => {
    setTotals({
      baseAmount: items.reduce((sum, item) => sum + item.baseAmount, 0),
      vatAmount: items.reduce((sum, item) => sum + item.vatAmount, 0),
      irpfAmount: items.reduce((sum, item) => sum + item.irpfAmount, 0),
      totalAmount: items.reduce((sum, item) => sum + item.totalAmount, 0),
    });
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
    if (!formData.supplier) newErrors.supplier = "Selecciona un proveedor";
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
      alert("Solo PDF o imágenes hasta 10MB"); return;
    }
    setUploadedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  }, []);

  const updateSubAccountsCommitted = async (itemsToCommit: POItem[]) => {
    // Preparar items para commitPO
    const budgetItems = itemsToCommit
      .filter(item => item.subAccountId && item.baseAmount > 0)
      .map(item => ({
        subAccountId: item.subAccountId,
        baseAmount: item.baseAmount,
      }));
    
    if (budgetItems.length > 0) {
      await commitPO(id, budgetItems);
    }
  };

  const savePO = async (sendForApproval: boolean) => {
    if (sendForApproval && !validateForm()) return;
    if (poStatus !== "draft" && poStatus !== "rejected") { alert("Solo se pueden editar borradores o rechazadas"); return; }

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
          poData.committedAmount = totals.baseAmount;
          poData.remainingAmount = totals.baseAmount;
          // Limpiar previousCommittedItems ya que se va a aprobar directamente
          poData.previousCommittedItems = deleteField();
        } else {
          poData.status = "pending";
          poData.approvalSteps = approvalSteps;
          poData.currentApprovalStep = 0;
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

      // Actualizar facturas vinculadas si cambiaron las cuentas de los items
      await updateLinkedInvoicesAccounts();

      // Comprometer según la configuración
      const finalStatus = poData.status;
      
      // Si se auto-aprueba y había items anteriores, hacer la diferencia
      if (finalStatus === "approved" && wasApprovedBefore && originalCommittedItems) {
        // Descomprometer los items anteriores
        await uncommitPOItems(originalCommittedItems);
        // Comprometer los nuevos items
        await updateSubAccountsCommitted(items);
      } else if (finalStatus === "approved" && !wasApprovedBefore) {
        // Nueva PO aprobada, comprometer normalmente
        if (shouldCommitPO(finalStatus, costSettings)) {
          await updateSubAccountsCommitted(items);
        }
      }
      // Si status es "pending" y había items anteriores, NO tocar el comprometido (se mantiene)

      setSuccessMessage(poData.status === "approved" ? "PO aprobada automáticamente" : poData.status === "pending" ? "PO enviada para aprobación" : "Borrador guardado");
      setTimeout(() => router.push(`/project/${id}/accounting/pos`), 1500);
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Helper para descomprometer items específicos
  const uncommitPOItems = async (itemsToUncommit: {subAccountId: string; baseAmount: number}[]) => {
    const accountsSnapshot = await getDocs(collection(db, `projects/${id}/accounts`));
    for (const item of itemsToUncommit) {
      if (!item.subAccountId || item.baseAmount <= 0) continue;
      for (const accountDoc of accountsSnapshot.docs) {
        const subAccountsSnapshot = await getDocs(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`));
        for (const subDoc of subAccountsSnapshot.docs) {
          if (subDoc.id === item.subAccountId) {
            const currentCommitted = subDoc.data().committed || 0;
            await updateDoc(doc(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`, subDoc.id), {
              committed: Math.max(0, currentCommitted - item.baseAmount),
            });
          }
        }
      }
    }
  };

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
    const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
    
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
  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

  const getApprovalPreview = () => {
    if (approvalConfig.length === 0) return { autoApprove: true, message: "Se aprobará automáticamente", steps: [] };
    const steps = generateApprovalSteps(formData.department);
    if (steps.every((s) => s.approvers.length === 0)) return { autoApprove: true, message: "Se aprobará automáticamente", steps: [] };
    return { autoApprove: false, message: `${steps.length} nivel${steps.length > 1 ? "es" : ""} de aprobación`, steps };
  };

  const getCompletionPercentage = () => {
    let completed = 0, total = 4;
    if (formData.supplier) completed++;
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
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || accessDenied) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para editar esta orden de compra"}</p>
          <Link
            href={`/project/${id}/accounting/pos`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
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
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-slate-400" />
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">Editar orden de compra</h1>
                <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-sm font-mono font-medium">
                  PO-{poNumber}
                </span>
                {poVersion > 1 && (
                  <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium">
                    V{String(poVersion).padStart(2, "0")}
                  </span>
                )}
                <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${poStatus === "draft" ? "bg-slate-100 text-slate-700" : poStatus === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {poStatus === "draft" ? "Borrador" : poStatus === "rejected" ? "Rechazada" : "Pendiente"}
                </span>
                {permissions.fixedDepartment && (
                  <span className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium">
                    {permissions.fixedDepartment}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link href={`/project/${id}/accounting/pos/${poId}`} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">
                <Eye size={16} />
                Ver
              </Link>
              {canEdit() && (
                <>
                  <button onClick={() => savePO(false)} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors disabled:opacity-50">
                    <Save size={16} />
                    Borrador
                  </button>
                  <button onClick={() => savePO(true)} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                    {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</> : <>{approvalPreview.autoApprove ? <CheckCircle size={16} /> : <Send size={16} />}{approvalPreview.autoApprove ? "Aprobar" : "Enviar"}</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3">
            <CheckCircle size={18} className="text-emerald-600" />
            <span className="text-sm text-emerald-700 font-medium">{successMessage}</span>
          </div>
        )}

        {!canEdit() && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600" />
            <span className="text-sm text-amber-700 font-medium">Esta PO está pendiente de aprobación y no se puede editar.</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor *</label>
                  <button onClick={() => canEdit() && setShowSupplierModal(true)} disabled={!canEdit()} onBlur={() => handleBlur("supplier")} className={`w-full px-4 py-3 border ${hasError("supplier") ? "border-red-300 bg-red-50" : isValid("supplier") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-xl hover:border-slate-300 transition-colors text-left flex items-center justify-between bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`}>
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 ${isValid("supplier") ? "bg-emerald-100" : "bg-slate-100"} rounded-lg flex items-center justify-center`}>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
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
                        className={`w-full px-4 py-3 border ${hasError("department") ? "border-red-300 bg-red-50" : isValid("department") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-xl text-left flex items-center justify-between bg-white disabled:bg-slate-50 text-sm disabled:cursor-not-allowed hover:border-slate-300 transition-colors`}
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
                        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
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
                        </div>
                      )}
                    </div>
                    {hasError("department") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.department}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de PO</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PO_TYPES.map((type) => {
                        const Icon = type.icon;
                        const isSelected = formData.poType === type.value;
                        return (
                          <button key={type.value} onClick={() => canEdit() && setFormData({ ...formData, poType: type.value as any })} disabled={!canEdit()} className={`px-3 py-2.5 rounded-xl border transition-all flex items-center gap-2 text-sm ${isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-600 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`} title={type.description}>
                            <Icon size={14} />
                            {type.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Moneda</label>
                  <div className="flex gap-2">
                    {CURRENCIES.map((currency) => (
                      <button key={currency.value} onClick={() => canEdit() && setFormData({ ...formData, currency: currency.value })} disabled={!canEdit()} className={`flex-1 px-4 py-2.5 rounded-xl border transition-all text-sm font-medium ${formData.currency === currency.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-600 bg-white"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                        {currency.symbol} {currency.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Descripción general *</label>
                  <div className="relative">
                    <textarea value={formData.generalDescription} onChange={(e) => setFormData({ ...formData, generalDescription: e.target.value })} onBlur={() => handleBlur("generalDescription")} disabled={!canEdit()} placeholder="Describe el propósito de esta orden de compra" rows={3} className={`w-full px-4 py-3 border ${hasError("generalDescription") ? "border-red-300 bg-red-50" : isValid("generalDescription") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm pr-10 disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                    {isValid("generalDescription") && <CheckCircle2 size={16} className="absolute right-4 top-4 text-emerald-600" />}
                  </div>
                  {hasError("generalDescription") && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{errors.generalDescription}</p>}
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
                {canEdit() && (
                  <button onClick={addItem} className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors">
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
                    <div key={item.id} className={`border rounded-xl p-5 transition-all ${itemHasAllFields ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50"}`}>
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
                        <input type="text" value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} onBlur={() => handleBlur(`item_${index}_description`)} disabled={!canEdit()} placeholder="Descripción del item" className={`w-full px-4 py-3 border ${hasError(`item_${index}_description`) ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />

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
                            onClick={() => { 
                              if (itemInvoiceStatus[index]?.hasAccountedInvoices) {
                                return; // Bloqueado
                              }
                              if (itemInvoiceStatus[index]?.hasInvoices && !confirm("Este item tiene facturas asignadas. ¿Deseas cambiar la cuenta analítica? Esto afectará a las facturas vinculadas.")) {
                                return;
                              }
                              setCurrentItemIndex(index); 
                              setShowAccountModal(true); 
                            }} 
                            disabled={!canEdit() || itemInvoiceStatus[index]?.hasAccountedInvoices} 
                            className={`w-full px-4 py-3 border ${hasError(`item_${index}_account`) ? "border-red-300 bg-red-50" : itemInvoiceStatus[index]?.hasAccountedInvoices ? "border-red-200 bg-red-50" : item.subAccountCode ? "border-emerald-200 bg-emerald-50" : "border-slate-200"} rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`}>
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
                          {permissions.isProjectRole && selectedAccount && (
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
                              onClick={() => {
                                if (itemInvoiceStatus[index]?.hasAccountedInvoices) {
                                  return; // Bloqueado
                                }
                                if (itemInvoiceStatus[index]?.hasInvoices && !confirm("Este item tiene facturas asignadas. ¿Deseas cambiar los capítulos? Esto afectará a las facturas vinculadas.")) {
                                  return;
                                }
                                openEpisodeModal(index);
                              }}
                              disabled={!canEdit() || itemInvoiceStatus[index]?.hasAccountedInvoices}
                              className={`w-full px-4 py-3 border rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white disabled:bg-slate-50 disabled:cursor-not-allowed ${
                                itemInvoiceStatus[index]?.hasAccountedInvoices ? "border-red-200 bg-red-50" : item.episodeAssignment === "general" ? "border-slate-200" : "border-violet-200 bg-violet-50"
                              }`}
                            >
                              {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                                <div className="flex items-center gap-2">
                                  {itemInvoiceStatus[index]?.hasAccountedInvoices ? (
                                    <Lock size={14} className="text-red-500" />
                                  ) : (
                                    <Layers size={14} className="text-violet-600" />
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
                                  <span key={ep.episode} className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-lg">
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
                            <input type="date" value={item.date} onChange={(e) => updateItem(index, "date", e.target.value)} disabled={!canEdit()} className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:cursor-not-allowed" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                            <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)} disabled={!canEdit()} className={`w-full px-3 py-2.5 border ${item.quantity > 0 ? "border-emerald-200" : "border-slate-200"} rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Precio unit.</label>
                            <div className="relative">
                              <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)} disabled={!canEdit()} className={`w-full pl-6 pr-3 py-2.5 border ${item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200"} rounded-xl text-sm bg-white disabled:bg-slate-50 disabled:cursor-not-allowed`} />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{getCurrencySymbol()}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Base</label>
                            <div className="px-3 py-2.5 bg-slate-100 rounded-xl text-sm font-medium text-slate-900">{formatCurrency(item.baseAmount)} {getCurrencySymbol()}</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                            <div className="relative custom-dropdown">
                              <button
                                type="button"
                                onClick={() => { if (canEdit()) setOpenDropdown(openDropdown === `vat-${index}` ? null : `vat-${index}`); }}
                                className={`w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${!canEdit() ? "opacity-50 cursor-not-allowed bg-slate-50" : ""}`}
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
                                onClick={() => { if (canEdit()) setOpenDropdown(openDropdown === `irpf-${index}` ? null : `irpf-${index}`); }}
                                className={`w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${!canEdit() ? "opacity-50 cursor-not-allowed bg-slate-50" : ""}`}
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
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">+IVA</label>
                            <div className="px-3 py-2.5 bg-emerald-50 rounded-xl text-sm font-medium text-emerald-700">+{formatCurrency(item.vatAmount)}</div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">-IRPF</label>
                            <div className="px-3 py-2.5 bg-red-50 rounded-xl text-sm font-medium text-red-700">-{formatCurrency(item.irpfAmount)}</div>
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <div className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm">
                            <span className="text-slate-400">Total:</span>
                            <span className="ml-2 font-semibold">{formatCurrency(item.totalAmount)} {getCurrencySymbol()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


            {/* File Upload */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Adjuntar presupuesto</h2>
                <p className="text-xs text-slate-500 mt-0.5">Opcional - PDF, JPG o PNG hasta 10MB</p>
              </div>

              <div className="p-6">
                {existingFileUrl && !uploadedFile && (
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <FileText size={18} className="text-indigo-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{existingFileName}</p>
                        <a href={existingFileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">Ver archivo actual</a>
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
                  <div onDrop={handleDrop} onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }} className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${isDragging ? "border-indigo-400 bg-indigo-50" : uploadedFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"}`}>
                    {uploadedFile ? (
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                            <FileUp size={18} className="text-emerald-600" />
                          </div>
                          <div className="text-left">
                            <span className="text-sm font-medium text-slate-900 block">{uploadedFile.name}</span>
                            <span className="text-xs text-slate-500">{(uploadedFile.size / 1024).toFixed(0)} KB</span>
                          </div>
                        </div>
                        <button onClick={() => setUploadedFile(null)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer block">
                        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                          <Upload size={20} className="text-slate-400" />
                        </div>
                        <p className="text-sm font-medium text-slate-700">Arrastra o haz clic para subir</p>
                        <p className="text-xs text-slate-400 mt-1">PDF, JPG, PNG (máx. 10MB)</p>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); }} className="hidden" />
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Additional Info */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información adicional</h2>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Condiciones de pago</label>
                  <input type="text" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} disabled={!canEdit()} placeholder="Condiciones de pago" className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm disabled:bg-slate-50 disabled:cursor-not-allowed" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Notas internas</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} disabled={!canEdit()} placeholder="Notas adicionales" rows={2} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm disabled:bg-slate-50 disabled:cursor-not-allowed" />
                </div>
              </div>
            </div>
          </div>


          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="space-y-4">
              {/* Progress */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-slate-700">Progreso</span>
                  <span className={`text-sm font-bold ${completionPercentage === 100 ? "text-emerald-600" : "text-slate-900"}`}>{completionPercentage}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-300 ${completionPercentage === 100 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${completionPercentage}%` }} />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {formData.supplier ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={formData.supplier ? "text-slate-700" : "text-slate-400"}>Proveedor</span>
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
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Total de la orden</h2>
                </div>
                <div className="p-6">
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Base imponible</span>
                      <span className="font-medium text-slate-900">{formatCurrency(totals.baseAmount)} {getCurrencySymbol()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">IVA</span>
                      <span className="font-medium text-emerald-600">+{formatCurrency(totals.vatAmount)} {getCurrencySymbol()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">IRPF</span>
                      <span className="font-medium text-red-600">-{formatCurrency(totals.irpfAmount)} {getCurrencySymbol()}</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-base font-semibold text-slate-900">Total</span>
                      <span className="text-xl font-bold text-slate-900">{formatCurrency(totals.totalAmount)} {getCurrencySymbol()}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Approval Preview */}
              {canEdit() && (
                <div className={`border rounded-2xl overflow-hidden ${approvalPreview.autoApprove ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                  <div className="px-5 py-4 border-b border-opacity-50" style={{ borderColor: approvalPreview.autoApprove ? "#a7f3d0" : "#fcd34d" }}>
                    <div className="flex items-center gap-3">
                      {approvalPreview.autoApprove ? (
                        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                          <CheckCircle size={20} className="text-emerald-600" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                          <Clock size={20} className="text-amber-600" />
                        </div>
                      )}
                      <div>
                        <p className={`font-semibold ${approvalPreview.autoApprove ? "text-emerald-800" : "text-amber-800"}`}>
                          {approvalPreview.autoApprove ? "Aprobación automática" : "Requiere aprobación"}
                        </p>
                        <p className={`text-sm ${approvalPreview.autoApprove ? "text-emerald-700" : "text-amber-700"}`}>{approvalPreview.message}</p>
                      </div>
                    </div>
                  </div>

                  {!approvalPreview.autoApprove && approvalPreview.steps && approvalPreview.steps.length > 0 && (
                    <div className="px-5 py-4">
                      <div className="space-y-3">
                        {approvalPreview.steps.map((step, idx) => (
                          <div key={step.id} className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-7 h-7 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                              {idx < approvalPreview.steps!.length - 1 && <div className="w-0.5 h-8 bg-amber-200 mt-1" />}
                            </div>
                            <div className="flex-1 pt-0.5">
                              <p className="text-sm font-medium text-amber-900">
                                {step.approverType === "role" && step.roles ? step.roles.join(", ") : step.approverType === "hod" ? "Jefe de departamento" : step.approverType === "coordinator" ? "Coordinador" : "Aprobador fijo"}
                              </p>
                              {step.approverNames.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {step.approverNames.slice(0, 3).map((name, i) => (
                                    <span key={i} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg">
                                      <Users size={10} />
                                      {name.split(" ")[0]}
                                    </span>
                                  ))}
                                  {step.approverNames.length > 3 && <span className="text-xs text-amber-700">+{step.approverNames.length - 3} más</span>}
                                </div>
                              )}
                              <p className="text-xs text-amber-700 mt-1">{step.requireAll ? "Todos deben aprobar" : `1 de ${step.approvers.length} debe aprobar`}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Info */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Info size={14} className="text-slate-500" />
                  </div>
                  <div className="text-sm text-slate-600">
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


      {/* Supplier Modal */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Seleccionar proveedor</h2>
              <button onClick={() => { setShowSupplierModal(false); setSupplierSearch(""); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="relative mb-4">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Buscar por nombre o NIF" className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" autoFocus />
              </div>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {filteredSuppliers.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3"><Building2 size={20} className="text-slate-400" /></div>
                    <p className="text-sm text-slate-500">No se encontraron proveedores</p>
                  </div>
                ) : (
                  filteredSuppliers.map((supplier) => (
                    <button key={supplier.id} onClick={() => selectSupplier(supplier)} className="w-full text-left p-4 border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-all group">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">{supplier.fiscalName}</p>
                          {supplier.commercialName && <p className="text-sm text-slate-500">{supplier.commercialName}</p>}
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                            <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded"><Hash size={10} />{supplier.taxId}</span>
                            <span>{supplier.country}</span>
                          </div>
                        </div>
                        <Building2 size={16} className="text-slate-300 group-hover:text-slate-400" />
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Modal */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Seleccionar cuenta presupuestaria</h2>
              <button onClick={() => { setShowAccountModal(false); setAccountSearch(""); setCurrentItemIndex(null); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="relative mb-4">
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="Buscar por código o descripción" className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" autoFocus />
              </div>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {filteredSubAccounts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3"><Hash size={20} className="text-slate-400" /></div>
                    <p className="text-sm text-slate-500">No se encontraron cuentas</p>
                  </div>
                ) : (
                  filteredSubAccounts.map((subAccount) => {
                    const isLowBudget = subAccount.available < subAccount.budgeted * 0.1;
                    const isOverBudget = subAccount.available < 0;
                    return (
                      <button key={subAccount.id} onClick={() => selectAccount(subAccount)} className={`w-full text-left p-4 border rounded-xl hover:bg-slate-50 transition-all ${isOverBudget ? "border-red-200 bg-red-50/50" : isLowBudget ? "border-amber-200 bg-amber-50/50" : "border-slate-200"}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-mono font-semibold text-slate-900">{subAccount.code}</p>
                              {isOverBudget && <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg"><AlertTriangle size={10} />Sin presupuesto</span>}
                              {!isOverBudget && isLowBudget && <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg"><AlertTriangle size={10} />Bajo</span>}
                            </div>
                            <p className="text-sm text-slate-700">{subAccount.description}</p>
                            <p className="text-xs text-slate-500 mt-1">{subAccount.accountCode} - {subAccount.accountDescription}</p>
                          </div>
                        </div>
                        {permissions.isProjectRole && (
                          <div className="grid grid-cols-4 gap-3 text-xs">
                            <div className="bg-slate-50 rounded-lg p-2"><p className="text-slate-500">Presupuestado</p><p className="font-semibold text-slate-900">{formatCurrency(subAccount.budgeted)} €</p></div>
                            <div className="bg-amber-50 rounded-lg p-2"><p className="text-amber-600">Comprometido</p><p className="font-semibold text-amber-700">{formatCurrency(subAccount.committed)} €</p></div>
                            <div className="bg-emerald-50 rounded-lg p-2"><p className="text-emerald-600">Realizado</p><p className="font-semibold text-emerald-700">{formatCurrency(subAccount.actual)} €</p></div>
                            <div className={`rounded-lg p-2 ${isOverBudget ? "bg-red-50" : isLowBudget ? "bg-amber-50" : "bg-emerald-50"}`}><p className={isOverBudget ? "text-red-600" : isLowBudget ? "text-amber-600" : "text-emerald-600"}>Disponible</p><p className={`font-semibold ${isOverBudget ? "text-red-700" : isLowBudget ? "text-amber-700" : "text-emerald-700"}`}>{formatCurrency(subAccount.available)} €</p></div>
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de asignación de capítulos */}
      {showEpisodeModal && episodeItemIndex !== null && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                  <Layers size={20} className="text-violet-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">Asignar capítulos</h2>
                  <p className="text-xs text-slate-500">Item {episodeItemIndex + 1}: {formatCurrency(items[episodeItemIndex].baseAmount)} {getCurrencySymbol()}</p>
                </div>
              </div>
              <button onClick={() => setShowEpisodeModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
              <button onClick={() => setTempEpisodeDistribution([])} className={`w-full px-4 py-4 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 border-2 ${tempEpisodeDistribution.length === 0 ? "bg-violet-50 border-violet-500 text-violet-700" : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempEpisodeDistribution.length === 0 ? "border-violet-500 bg-violet-500" : "border-slate-300"}`}>
                  {tempEpisodeDistribution.length === 0 && <CheckCircle2 size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium">General (todos los capítulos)</p>
                  <p className="text-xs text-slate-500">El importe se reparte equitativamente entre todos</p>
                </div>
              </button>

              <button onClick={() => { if (tempEpisodeDistribution.length === 0) { const item = items[episodeItemIndex]; setTempEpisodeDistribution([{ episode: 1, amount: item.baseAmount, percentage: 100 }]); }}} className={`w-full px-4 py-4 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 border-2 ${tempEpisodeDistribution.length > 0 ? "bg-violet-50 border-violet-500 text-violet-700" : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"}`}>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${tempEpisodeDistribution.length > 0 ? "border-violet-500 bg-violet-500" : "border-slate-300"}`}>
                  {tempEpisodeDistribution.length > 0 && <CheckCircle2 size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium">Capítulos específicos</p>
                  <p className="text-xs text-slate-500">Asignar a uno o varios capítulos concretos</p>
                </div>
              </button>

              {tempEpisodeDistribution.length > 0 && (
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Distribución</label>
                    <div className="flex gap-2">
                      <button onClick={() => { setEpisodeDistributionMode("equal"); applyEqualDistribution(); }} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${episodeDistributionMode === "equal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Partes iguales</button>
                      <button onClick={() => setEpisodeDistributionMode("amount")} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${episodeDistributionMode === "amount" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Por importe</button>
                      <button onClick={() => setEpisodeDistributionMode("percentage")} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${episodeDistributionMode === "percentage" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Por porcentaje</button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Capítulos</label>
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map((epNum) => {
                        const isSelected = tempEpisodeDistribution.some(e => e.episode === epNum);
                        return (
                          <button key={epNum} onClick={() => toggleEpisodeInDistribution(epNum)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isSelected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{epNum}</button>
                        );
                      })}
                    </div>
                  </div>

                  {tempEpisodeDistribution.length > 0 && episodeDistributionMode !== "equal" && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Importes</label>
                      <div className="space-y-2">
                        {tempEpisodeDistribution.map((ep) => (
                          <div key={ep.episode} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 w-12">{ep.episode}</span>
                            {episodeDistributionMode === "amount" ? (
                              <div className="flex-1 relative">
                                <input type="number" value={ep.amount || ""} onChange={(e) => updateEpisodeAmount(ep.episode, parseFloat(e.target.value) || 0)} className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="0.00" />
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">€</span>
                              </div>
                            ) : (
                              <div className="flex-1 relative">
                                <input type="number" value={ep.percentage || ""} onChange={(e) => updateEpisodePercentage(ep.episode, parseFloat(e.target.value) || 0)} className="w-full pr-8 pl-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="0" min="0" max="100" />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                              </div>
                            )}
                            <span className="text-xs text-slate-500 w-20 text-right">{episodeDistributionMode === "amount" ? `${ep.percentage.toFixed(1)}%` : `${formatCurrency(ep.amount)} €`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {tempEpisodeDistribution.length > 0 && (
                    <div className={`p-3 rounded-lg flex items-center justify-between ${Math.abs(getTotalDistributedPercentage() - 100) < 0.1 ? "bg-emerald-50" : "bg-amber-50"}`}>
                      <span className="text-sm font-medium text-slate-700">Total:</span>
                      <div className="text-right">
                        <p className={`text-sm font-semibold ${Math.abs(getTotalDistributedPercentage() - 100) < 0.1 ? "text-emerald-700" : "text-amber-700"}`}>{formatCurrency(getTotalDistributedAmount())} € ({getTotalDistributedPercentage().toFixed(1)}%)</p>
                        {Math.abs(getTotalDistributedPercentage() - 100) >= 0.1 && <p className="text-xs text-amber-600">Debe sumar 100%</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowEpisodeModal(false)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={saveEpisodeDistribution} disabled={tempEpisodeDistribution.length > 0 && Math.abs(getTotalDistributedPercentage() - 100) >= 0.1} className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
