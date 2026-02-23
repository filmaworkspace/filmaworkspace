"use client";
import React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect, useCallback, useRef } from "react";
import { auth, db, storage } from "@/lib/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  FileText,
  ArrowLeft,
  Save,
  Send,
  Building2,
  AlertCircle,
  Info,
  Upload,
  X,
  Plus,
  Trash2,
  Search,
  Hash,
  FileUp,
  ShoppingCart,
  Package,
  Wrench,
  Shield,
  CheckCircle,
  CheckCircle2,
  Clock,
  Users,
  ChevronRight,
  AlertTriangle,
  Circle,
  ShieldAlert,
  Lock,
  ChevronDown,
  Layers,
  Percent,
  FileBox,
  RotateCcw,
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { getCostSettings, shouldCommitPO } from "@/lib/budgetRules";
import { commitPO } from "@/lib/budgetOperations";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// Helper para clases condicionales
function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

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
  episodes?: EpisodeDistribution[];
  episodeAssignment?: "general" | "specific"; // general = todos los caps, specific = caps específicos
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

const VAT_RATES = [
  { value: 0, label: "0%" },
  { value: 4, label: "4%" },
  { value: 10, label: "10%" },
  { value: 21, label: "21%" },
];

const IRPF_RATES = [
  { value: 0, label: "0%" },
  { value: 7, label: "7%" },
  { value: 15, label: "15%" },
  { value: 19, label: "19%" },
];

export default function NewPOPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const {
    loading: permissionsLoading,
    error: permissionsError,
    permissions,
    getAvailableDepartments,
  } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [nextPONumber, setNextPONumber] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);

  // Sistema de borradores (localStorage)
  interface Draft {
    id: string;
    name: string;
    savedAt: string;
    formData: any;
    items: POItem[];
  }
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showCreateSupplierModal, setShowCreateSupplierModal] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newSupplierData, setNewSupplierData] = useState({ fiscalName: "", taxId: "" });

  // Dropdowns custom
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const currencyDropdownRef = useRef<HTMLDivElement>(null);

  // Configuración de episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [episodesRequired, setEpisodesRequired] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount" | "percentage">("equal");
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);

  const [formData, setFormData] = useState({
    supplier: "",
    supplierName: "",
    department: "",
    poType: "rental" as "rental" | "purchase" | "service" | "deposit",
    currency: "EUR",
    generalDescription: "",
    paymentTerms: "",
    notes: "",
  });

  const [items, setItems] = useState<POItem[]>([
    {
      id: "1",
      description: "",
      subAccountId: "",
      subAccountCode: "",
      subAccountDescription: "",
      date: new Date().toISOString().split("T")[0],
      quantity: 1,
      unitPrice: 0,
      baseAmount: 0,
      vatRate: 21,
      vatAmount: 0,
      irpfRate: 0,
      irpfAmount: 0,
      totalAmount: 0,
      episodeAssignment: "general",
    },
  ]);

  const [totals, setTotals] = useState({
    baseAmount: 0,
    vatAmount: 0,
    irpfAmount: 0,
    totalAmount: 0,
  });

  // Click outside para cerrar dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(target)) {
        setShowDepartmentDropdown(false);
      }
      if (currencyDropdownRef.current && !currencyDropdownRef.current.contains(target)) {
        setShowCurrencyDropdown(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!permissionsLoading && permissions.fixedDepartment) {
      setFormData((prev) => ({ ...prev, department: permissions.fixedDepartment || "" }));
    }
  }, [permissionsLoading, permissions.fixedDepartment]);

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    calculateTotals();
  }, [items]);

  // Cargar borradores desde localStorage
  useEffect(() => {
    if (id) {
      const savedDrafts = localStorage.getItem(`po_drafts_${id}`);
      if (savedDrafts) {
        try {
          setDrafts(JSON.parse(savedDrafts));
        } catch (e) {}
      }
    }
  }, [id]);

  // Funciones de borradores
  const saveDraft = () => {
    const hasContent = formData.supplier || formData.generalDescription || 
                       items.some(item => item.description || item.unitPrice > 0);
    if (!hasContent) {
      setErrorMessage("No hay contenido para guardar");
      setTimeout(() => setErrorMessage(""), 2000);
      return;
    }

    const newDraft: Draft = {
      id: `draft_${Date.now()}`,
      name: formData.supplierName || formData.generalDescription || `Borrador ${drafts.length + 1}`,
      savedAt: new Date().toISOString(),
      formData,
      items,
    };
    
    const updatedDrafts = [...drafts, newDraft];
    setDrafts(updatedDrafts);
    localStorage.setItem(`po_drafts_${id}`, JSON.stringify(updatedDrafts));
    setSuccessMessage("Borrador guardado");
    setTimeout(() => setSuccessMessage(""), 2000);
    setShowDraftsPanel(false);
  };

  const loadDraft = (draft: Draft) => {
    setFormData(draft.formData);
    setItems(draft.items);
    setShowDraftsPanel(false);
    setSuccessMessage("Borrador cargado");
    setTimeout(() => setSuccessMessage(""), 2000);
  };

  const deleteDraft = (draftId: string) => {
    const updatedDrafts = drafts.filter(d => d.id !== draftId);
    setDrafts(updatedDrafts);
    localStorage.setItem(`po_drafts_${id}`, JSON.stringify(updatedDrafts));
  };

  useEffect(() => {
    if (Object.keys(touched).length > 0) {
      validateForm(true);
    }
  }, [formData, items, uploadedFile]);

  const loadData = async () => {
    try {
      setLoading(true);

      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
        setDepartments(projectDoc.data().departments || []);
      }

      const membersSnapshot = await getDocs(collection(db, "projects/" + id + "/members"));
      const membersData: Member[] = [];
      for (const memberDocSnap of membersSnapshot.docs) {
        const memberData = memberDocSnap.data();
        let name = memberData.name || memberData.email || memberDocSnap.id;
        try {
          const userDoc = await getDoc(doc(db, "users", memberDocSnap.id));
          if (userDoc.exists()) {
            name = userDoc.data().displayName || userDoc.data().email || name;
          }
        } catch (e) {}
        membersData.push({
          userId: memberDocSnap.id,
          name,
          email: memberData.email,
          role: memberData.role,
          department: memberData.department,
          position: memberData.position,
        });
      }
      setMembers(membersData);

      const approvalConfigDoc = await getDoc(doc(db, "projects/" + id + "/config/approvals"));
      if (approvalConfigDoc.exists()) {
        setApprovalConfig(approvalConfigDoc.data().poApprovals || []);
      } else {
        setApprovalConfig([
          { id: "default-1", order: 1, approverType: "role", roles: ["PM", "EP"], requireAll: false },
        ]);
      }

      // Cargar configuración de episodios
      const productionDoc = await getDoc(doc(db, "projects/" + id + "/config/production"));
      if (productionDoc.exists()) {
        const prodData = productionDoc.data();
        if (prodData.projectType === "serie") {
          setTotalEpisodes(prodData.episodes || 0);
          
          // Cargar configuración de asignación de episodios
          const projectConfigDoc = await getDoc(doc(db, "projects/" + id + "/config/project"));
          if (projectConfigDoc.exists()) {
            const configData = projectConfigDoc.data();
            setEpisodesEnabled(configData.enableEpisodes || false);
            setEpisodesRequired(configData.requireEpisodeAssignment || false);
          }
        }
      }

      const suppliersSnapshot = await getDocs(
        query(collection(db, "projects/" + id + "/suppliers"), orderBy("fiscalName", "asc"))
      );
      setSuppliers(
        suppliersSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as Supplier))
      );

      const accountsSnapshot = await getDocs(
        query(collection(db, "projects/" + id + "/accounts"), orderBy("code", "asc"))
      );
      const allSubAccounts: SubAccount[] = [];
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(
          query(
            collection(db, "projects/" + id + "/accounts/" + accountDoc.id + "/subaccounts"),
            orderBy("code", "asc")
          )
        );
        subAccountsSnapshot.docs.forEach((subDoc) => {
          const data = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id,
            code: data.code,
            description: data.description,
            budgeted: data.budgeted || 0,
            committed: data.committed || 0,
            actual: data.actual || 0,
            available: (data.budgeted || 0) - (data.committed || 0) - (data.actual || 0),
            accountId: accountDoc.id,
            accountCode: accountData.code,
            accountDescription: accountData.description,
          });
        });
      }
      setSubAccounts(allSubAccounts);

      // No asignamos número hasta el envío - mostramos NUEVO
      setNextPONumber("NUEVO");
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const resolveApprovers = (step: ApprovalStep, dept?: string): { ids: string[]; names: string[] } => {
    let approverIds: string[] = [];
    let approverNames: string[] = [];
    
    switch (step.approverType) {
      case "fixed":
        approverIds = step.approvers || [];
        // Si ya tenemos los nombres guardados, usarlos; sino, buscarlos en members
        approverNames = approverIds.map((uid) => {
          const member = members.find((m) => m.userId === uid);
          return member?.name || member?.email || uid;
        });
        break;
      case "role":
        const roleMembers = members.filter((m) => m.role && step.roles?.includes(m.role));
        approverIds = roleMembers.map((m) => m.userId);
        approverNames = roleMembers.map((m) => m.name || m.email || m.userId);
        break;
      case "hod":
        const hodMembers = members.filter((m) => m.position === "HOD" && m.department === (step.department || dept));
        approverIds = hodMembers.map((m) => m.userId);
        approverNames = hodMembers.map((m) => m.name || m.email || m.userId);
        break;
      case "coordinator":
        const coordMembers = members.filter((m) => m.position === "Coordinator" && m.department === (step.department || dept));
        approverIds = coordMembers.map((m) => m.userId);
        approverNames = coordMembers.map((m) => m.name || m.email || m.userId);
        break;
    }
    
    return { ids: approverIds, names: approverNames };
  };

  const generateApprovalSteps = (dept?: string): ApprovalStepStatus[] => {
    if (approvalConfig.length === 0) return [];
    return approvalConfig.map((step) => {
      const { ids, names } = resolveApprovers(step, dept);
      const stepData: ApprovalStepStatus = {
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
      // Solo añadir campos opcionales si tienen valor definido
      if (step.amountThreshold !== undefined) {
        stepData.amountThreshold = step.amountThreshold;
      }
      if (step.amountCondition !== undefined) {
        stepData.amountCondition = step.amountCondition;
      }
      if (step.amountThresholdMax !== undefined) {
        stepData.amountThresholdMax = step.amountThresholdMax;
      }
      return stepData;
    });
  };

  const shouldAutoApprove = (steps: ApprovalStepStatus[]): boolean => {
    return steps.length === 0 || steps.every((step) => step.approvers.length === 0);
  };

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
    setTouched((prev) => ({ ...prev, ["item_" + index + "_" + field]: true }));
  };

  const addItem = () => {
    setItems([
      ...items,
      {
        id: String(items.length + 1),
        description: "",
        subAccountId: "",
        subAccountCode: "",
        subAccountDescription: "",
        date: new Date().toISOString().split("T")[0],
        quantity: 1,
        unitPrice: 0,
        baseAmount: 0,
        vatRate: 21,
        vatAmount: 0,
        irpfRate: 0,
        irpfAmount: 0,
        totalAmount: 0,
        episodeAssignment: "general",
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateTotals = () => {
    setTotals({
      baseAmount: items.reduce((sum, item) => sum + item.baseAmount, 0),
      vatAmount: items.reduce((sum, item) => sum + item.vatAmount, 0),
      irpfAmount: items.reduce((sum, item) => sum + item.irpfAmount, 0),
      totalAmount: items.reduce((sum, item) => sum + item.totalAmount, 0),
    });
  };

  const selectSupplier = (supplier: Supplier) => {
    setFormData({
      ...formData,
      supplier: supplier.id,
      supplierName: supplier.fiscalName,
      paymentTerms: supplier.paymentMethod,
    });
    setTouched((prev) => ({ ...prev, supplier: true }));
    setShowSupplierModal(false);
    setSupplierSearch("");
  };

  const createQuickSupplier = async () => {
    if (!newSupplierData.fiscalName.trim() || !newSupplierData.taxId.trim()) return;
    setCreatingSupplier(true);
    try {
      const newSupplier = {
        fiscalName: newSupplierData.fiscalName.trim(),
        commercialName: "",
        country: "ES",
        taxId: newSupplierData.taxId.trim().toUpperCase(),
        address: { street: "", number: "", city: "", province: "", postalCode: "" },
        contact: { name: "", email: "", phone: "" },
        paymentMethod: "transferencia",
        bankAccount: "",
        bic: "",
        certificates: {
          bankOwnership: { uploaded: false, expiryDate: null, fileName: "", verified: false },
          contractorsCertificate: { uploaded: false, expiryDate: null, fileName: "", verified: false, aeatVerified: false },
        },
        createdAt: Timestamp.now(),
        createdBy: permissions.userId || "",
        hasAssignedPOs: false,
        hasAssignedInvoices: false,
      };
      const docRef = await addDoc(collection(db, `projects/${projectId}/suppliers`), newSupplier);
      
      // Seleccionar el nuevo proveedor y poner su método de pago por defecto
      setFormData({
        ...formData,
        supplier: docRef.id,
        supplierName: newSupplierData.fiscalName.trim(),
        paymentTerms: "transferencia",
      });
      setTouched((prev) => ({ ...prev, supplier: true }));
      
      // Añadir a la lista local
      setSuppliers([...suppliers, { id: docRef.id, ...newSupplier } as Supplier]);
      
      // Cerrar modales
      setShowCreateSupplierModal(false);
      setShowSupplierModal(false);
      setNewSupplierData({ fiscalName: "", taxId: "" });
      setSupplierSearch("");
    } catch (error) {
      console.error("Error creating supplier:", error);
    } finally {
      setCreatingSupplier(false);
    }
  };

  const selectAccount = (subAccount: SubAccount) => {
    if (currentItemIndex !== null) {
      const newItems = [...items];
      newItems[currentItemIndex] = {
        ...newItems[currentItemIndex],
        subAccountId: subAccount.id,
        subAccountCode: subAccount.code,
        subAccountDescription: subAccount.description,
      };
      setItems(newItems);
      setTouched((prev) => ({ ...prev, ["item_" + currentItemIndex + "_account"]: true }));
    }
    setShowAccountModal(false);
    setAccountSearch("");
    setCurrentItemIndex(null);
  };

  // Funciones para manejo de episodios
  const openEpisodeModal = (index: number) => {
    setEpisodeItemIndex(index);
    const item = items[index];
    if (item.episodes && item.episodes.length > 0) {
      setTempEpisodeDistribution([...item.episodes]);
      // Detectar modo basado en distribución existente
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
      // Recalcular distribución
      recalculateDistribution(newDist, item.baseAmount);
    }
  };

  const recalculateDistribution = (dist: EpisodeDistribution[], totalAmount: number) => {
    if (dist.length === 0) {
      setTempEpisodeDistribution([]);
      return;
    }
    
    if (episodeDistributionMode === "equal") {
      const equalPercentage = 100 / dist.length;
      const equalAmount = totalAmount / dist.length;
      setTempEpisodeDistribution(dist.map(e => ({
        ...e,
        percentage: equalPercentage,
        amount: equalAmount,
      })));
    } else {
      setTempEpisodeDistribution(dist);
    }
  };

  const updateEpisodeAmount = (episodeNum: number, amount: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const newDist = tempEpisodeDistribution.map(e => {
      if (e.episode === episodeNum) {
        return { ...e, amount, percentage: (amount / item.baseAmount) * 100 };
      }
      return e;
    });
    setTempEpisodeDistribution(newDist);
  };

  const updateEpisodePercentage = (episodeNum: number, percentage: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const newDist = tempEpisodeDistribution.map(e => {
      if (e.episode === episodeNum) {
        return { ...e, percentage, amount: (percentage / 100) * item.baseAmount };
      }
      return e;
    });
    setTempEpisodeDistribution(newDist);
  };

  const applyEqualDistribution = () => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item || tempEpisodeDistribution.length === 0) return;
    
    const equalPercentage = 100 / tempEpisodeDistribution.length;
    const equalAmount = item.baseAmount / tempEpisodeDistribution.length;
    setTempEpisodeDistribution(tempEpisodeDistribution.map(e => ({
      ...e,
      percentage: equalPercentage,
      amount: equalAmount,
    })));
  };

  const selectAllEpisodes = () => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const equalPercentage = 100 / totalEpisodes;
    const equalAmount = item.baseAmount / totalEpisodes;
    
    const allEpisodes: EpisodeDistribution[] = Array.from({ length: totalEpisodes }, (_, i) => ({
      episode: i + 1,
      amount: equalAmount,
      percentage: equalPercentage,
    }));
    
    setTempEpisodeDistribution(allEpisodes);
    setEpisodeDistributionMode("equal");
  };

  const saveEpisodeDistribution = () => {
    if (episodeItemIndex === null) return;
    
    const newItems = [...items];
    const isGeneral = tempEpisodeDistribution.length === 0 || tempEpisodeDistribution.length === totalEpisodes;
    
    newItems[episodeItemIndex] = {
      ...newItems[episodeItemIndex],
      episodeAssignment: isGeneral ? "general" : "specific",
      episodes: tempEpisodeDistribution.length > 0 && tempEpisodeDistribution.length < totalEpisodes 
        ? tempEpisodeDistribution 
        : undefined,
    };
    setItems(newItems);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
    setTempEpisodeDistribution([]);
  };

  const getTotalDistributedPercentage = () => {
    return tempEpisodeDistribution.reduce((sum, e) => sum + e.percentage, 0);
  };

  const getTotalDistributedAmount = () => {
    return tempEpisodeDistribution.reduce((sum, e) => sum + e.amount, 0);
  };

  const validateForm = (silent = false) => {
    const newErrors: Record<string, string> = {};
    if (!formData.supplier) newErrors.supplier = "Selecciona un proveedor";
    if (!formData.department) newErrors.department = "Selecciona un departamento";
    if (!formData.generalDescription.trim()) newErrors.generalDescription = "Descripción obligatoria";
    items.forEach((item, index) => {
      if (!item.description.trim()) newErrors["item_" + index + "_description"] = "Obligatorio";
      if (!item.subAccountId) newErrors["item_" + index + "_account"] = "Obligatorio";
      if (item.quantity <= 0) newErrors["item_" + index + "_quantity"] = "Debe ser > 0";
      if (item.unitPrice <= 0) newErrors["item_" + index + "_unitPrice"] = "Debe ser > 0";
    });
    if (!silent) setErrors(newErrors);
    else setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleBlur = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleFileUpload = (file: File) => {
    if (
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      alert("Solo PDF o imágenes hasta 10MB");
      return;
    }
    setUploadedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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

  const savePO = async (status: "draft" | "pending") => {
    if (status === "pending" && !validateForm()) return;
    setSaving(true);
    try {
      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      
      // Obtener siguiente número correlativo global
      const posSnapshot = await getDocs(collection(db, "projects/" + id + "/pos"));
      let maxNumber = 0;
      posSnapshot.docs.forEach((d) => {
        const num = parseInt(d.data().number || "0", 10);
        if (num > maxNumber) maxNumber = num;
      });
      const finalNumber = String(maxNumber + 1).padStart(4, "0");

      let fileUrl = "";
      if (uploadedFile) {
        const fileRef = ref(storage, "projects/" + id + "/pos/PO-" + finalNumber + "/" + uploadedFile.name);
        await uploadBytes(fileRef, uploadedFile);
        fileUrl = await getDownloadURL(fileRef);
      }

      const itemsData = items.map((item) => ({
        description: (item.description || "").trim(),
        subAccountId: item.subAccountId || "",
        subAccountCode: item.subAccountCode || "",
        subAccountDescription: item.subAccountDescription || "",
        date: item.date || "",
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        baseAmount: item.baseAmount || 0,
        vatRate: item.vatRate || 0,
        vatAmount: item.vatAmount || 0,
        irpfRate: item.irpfRate || 0,
        irpfAmount: item.irpfAmount || 0,
        totalAmount: item.totalAmount || 0,
        episodeAssignment: item.episodeAssignment || "general",
        ...(item.episodes && item.episodes.length > 0 && { episodes: item.episodes }),
      }));

      const poData: any = {
        number: finalNumber,
        supplier: formData.supplierName,
        supplierId: formData.supplier,
        department: formData.department,
        poType: formData.poType,
        currency: formData.currency,
        generalDescription: formData.generalDescription.trim(),
        paymentTerms: formData.paymentTerms,
        notes: formData.notes.trim(),
        items: itemsData,
        baseAmount: totals.baseAmount,
        vatAmount: totals.vatAmount,
        irpfAmount: totals.irpfAmount,
        totalAmount: totals.totalAmount,
        attachmentUrl: fileUrl || "",
        attachmentFileName: uploadedFile?.name || "",
        createdAt: Timestamp.now(),
        createdBy: permissions.userId || "",
        createdByName: permissions.userName || "",
        version: 1,
      };

      if (status === "pending") {
        const approvalSteps = generateApprovalSteps(formData.department);
        if (shouldAutoApprove(approvalSteps)) {
          poData.status = "approved";
          poData.approvedAt = Timestamp.now();
          poData.approvedBy = permissions.userId || "";
          poData.approvedByName = permissions.userName || "";
          poData.autoApproved = true;
          poData.committedAmount = totals.baseAmount;
          poData.remainingAmount = totals.baseAmount;
        } else {
          poData.status = "pending";
          poData.approvalSteps = approvalSteps;
          poData.currentApprovalStep = 0;
          // Si la configuración es on_create, también comprometer en pending
          if (costSettings.poCommitmentTrigger === "on_create") {
            poData.committedAmount = totals.baseAmount;
            poData.remainingAmount = totals.baseAmount;
          }
        }
      } else {
        poData.status = "draft";
      }

      // Función para eliminar campos undefined recursivamente
      const removeUndefined = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(item => removeUndefined(item));
        }
        if (obj !== null && typeof obj === 'object' && !(obj instanceof Date) && !(obj.toDate)) {
          return Object.entries(obj).reduce((acc, [key, value]) => {
            if (value !== undefined) {
              acc[key] = removeUndefined(value);
            }
            return acc;
          }, {} as any);
        }
        return obj;
      };

      const cleanPoData = removeUndefined(poData);
      await addDoc(collection(db, "projects/" + id + "/pos"), cleanPoData);

      // Comprometer según la configuración
      const finalStatus = poData.status;
      if (shouldCommitPO(finalStatus, costSettings)) {
        await updateSubAccountsCommitted(items);
      }

      setSuccessMessage(
        poData.status === "approved"
          ? "PO aprobada automáticamente"
          : poData.status === "pending"
          ? "PO enviada para aprobación"
          : "Borrador guardado"
      );
      setTimeout(() => router.push("/project/" + id + "/accounting/pos"), 1500);
    } catch (error: any) {
      alert("Error: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const getCurrencySymbol = () =>
    CURRENCIES.find((c) => c.value === formData.currency)?.symbol || "€";

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);

  const getApprovalPreview = () => {
    if (approvalConfig.length === 0)
      return { autoApprove: true, message: "Se aprobará automáticamente", steps: [] };
    const steps = generateApprovalSteps(formData.department);
    if (steps.every((s) => s.approvers.length === 0))
      return { autoApprove: true, message: "Se aprobará automáticamente", steps: [] };
    return {
      autoApprove: false,
      message: steps.length + " nivel" + (steps.length > 1 ? "es" : "") + " de aprobación",
      steps,
    };
  };

  const getCompletionPercentage = () => {
    let completed = 0;
    let total = 4;
    if (formData.supplier) completed++;
    if (formData.department) completed++;
    if (formData.generalDescription.trim()) completed++;
    const validItems = items.filter(
      (item) => item.description.trim() && item.subAccountId && item.quantity > 0 && item.unitPrice > 0
    );
    if (validItems.length > 0) completed++;
    return Math.round((completed / total) * 100);
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) ||
      s.commercialName?.toLowerCase().includes(supplierSearch.toLowerCase()) ||
      s.taxId.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const filteredSubAccounts = subAccounts.filter(
    (s) =>
      s.code.toLowerCase().includes(accountSearch.toLowerCase()) ||
      s.description.toLowerCase().includes(accountSearch.toLowerCase())
  );

  const availableDepartments = getAvailableDepartments(departments);
  const approvalPreview = getApprovalPreview();
  const completionPercentage = getCompletionPercentage();
  const hasError = (field: string) => touched[field] && errors[field];
  const isValid = (field: string) => touched[field] && !errors[field];

  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || !permissions.canCreatePO) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para crear órdenes de compra"}</p>
          <Link
            href={"/project/" + id + "/accounting/pos"}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#2F52E0" }}
          >
            <ArrowLeft size={16} />
            Volver a POs
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
            <div className="flex items-center gap-4">
              <Link
                href={"/project/" + id + "/accounting/pos"}
                className="w-10 h-10 rounded-xl flex items-center justify-center border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft size={18} className="text-slate-600" />
              </Link>
              <FileText size={24} style={{ color: "#2F52E0" }} />
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">Nueva orden de compra</h1>
                {permissions.fixedDepartment && (
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={{ backgroundColor: "rgba(47, 82, 224, 0.1)", color: "#2F52E0" }}>
                    {permissions.fixedDepartment}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Botón de borradores */}
              <div className="relative">
                <button
                  onClick={() => setShowDraftsPanel(!showDraftsPanel)}
                  className={cx(
                    "flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm font-medium transition-colors",
                    drafts.length > 0
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <FileBox size={16} />
                  {drafts.length > 0 && (
                    <span className="w-5 h-5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center">
                      {drafts.length}
                    </span>
                  )}
                </button>

                {/* Panel de borradores */}
                {showDraftsPanel && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDraftsPanel(false)} />
                    <div className="absolute right-0 top-12 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 text-sm">Borradores</h3>
                        <button onClick={() => setShowDraftsPanel(false)} className="text-slate-400 hover:text-slate-600">
                          <X size={16} />
                        </button>
                      </div>
                      
                      <div className="max-h-64 overflow-y-auto">
                        {drafts.length > 0 ? (
                          drafts.map((draft) => (
                            <div key={draft.id} className="p-3 border-b border-slate-100 hover:bg-slate-50 group">
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadDraft(draft)}>
                                  <p className="text-sm font-medium text-slate-900 truncate">{draft.name}</p>
                                  <p className="text-xs text-slate-400">
                                    {new Date(draft.savedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                </div>
                                <button
                                  onClick={() => deleteDraft(draft.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-6 text-center">
                            <FileBox size={24} className="text-slate-300 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">No hay borradores</p>
                          </div>
                        )}
                      </div>

                      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
                        <button
                          onClick={saveDraft}
                          className="w-full px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800"
                        >
                          Guardar como borrador
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => savePO("pending")}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium transition-opacity disabled:opacity-50 hover:opacity-90"
                style={{ backgroundColor: "#2F52E0" }}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    {approvalPreview.autoApprove ? <CheckCircle size={16} /> : <Send size={16} />}
                    {approvalPreview.autoApprove ? "Crear PO" : "Enviar"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>

              <div className="p-6 space-y-5">
                {/* Proveedor */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor *</label>
                  <button
                    onClick={() => setShowSupplierModal(true)}
                    onBlur={() => handleBlur("supplier")}
                    className={cx(
                      "w-full px-4 py-2.5 border rounded-xl hover:border-slate-300 transition-colors text-left flex items-center justify-between bg-white",
                      hasError("supplier") ? "border-red-300 bg-red-50" : isValid("supplier") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                    )}
                  >
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center", isValid("supplier") ? "bg-emerald-100" : "bg-slate-100")}>
                          {isValid("supplier") ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Building2 size={16} className="text-slate-500" />}
                        </div>
                        <span className="font-medium text-slate-900">{formData.supplierName}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Seleccionar proveedor</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("supplier") && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.supplier}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Departamento - Custom Dropdown */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Departamento *
                      {permissions.fixedDepartment && (
                        <span className="ml-2 text-xs text-slate-400 font-normal">(asignado)</span>
                      )}
                    </label>
                    <div className="relative" ref={departmentDropdownRef}>
                      <button
                        onClick={() => !permissions.fixedDepartment && setShowDepartmentDropdown(!showDepartmentDropdown)}
                        disabled={!!permissions.fixedDepartment}
                        className={cx(
                          "w-full px-4 py-2.5 border rounded-xl text-left flex items-center justify-between transition-colors",
                          hasError("department") ? "border-red-300 bg-red-50" : isValid("department") ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white",
                          permissions.fixedDepartment ? "cursor-not-allowed bg-slate-50" : "hover:border-slate-300"
                        )}
                      >
                        <span className={formData.department ? "text-slate-900" : "text-slate-400"}>
                          {formData.department || "Seleccionar"}
                        </span>
                        <div className="flex items-center gap-2">
                          {permissions.fixedDepartment && <Lock size={14} className="text-slate-400" />}
                          {isValid("department") && !permissions.fixedDepartment && <CheckCircle2 size={16} className="text-emerald-600" />}
                          {!permissions.fixedDepartment && <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showDepartmentDropdown && "rotate-180")} />}
                        </div>
                      </button>
                      {showDepartmentDropdown && (
                        <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                          {availableDepartments.map((dept) => (
                            <button
                              key={dept}
                              onClick={() => {
                                setFormData({ ...formData, department: dept });
                                setTouched((prev) => ({ ...prev, department: true }));
                                setShowDepartmentDropdown(false);
                              }}
                              className={cx(
                                "w-full text-left px-4 py-2.5 text-sm transition-colors",
                                formData.department === dept ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {dept}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {hasError("department") && (
                      <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                        <AlertCircle size={12} />
                        {errors.department}
                      </p>
                    )}
                  </div>

                  {/* Tipo de PO */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de PO</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PO_TYPES.map((type) => {
                        const Icon = type.icon;
                        const isSelected = formData.poType === type.value;
                        return (
                          <button
                            key={type.value}
                            onClick={() => setFormData({ ...formData, poType: type.value as any })}
                            className={cx(
                              "px-3 py-2.5 rounded-xl border transition-all flex items-center justify-center gap-2 text-sm",
                              isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-600 bg-white"
                            )}
                            title={type.description}
                          >
                            <Icon size={14} />
                            {type.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Moneda - Custom Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Moneda</label>
                  <div className="relative" ref={currencyDropdownRef}>
                    <button
                      onClick={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between bg-white hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{CURRENCIES.find((c) => c.value === formData.currency)?.symbol}</span>
                        <span className="text-slate-600">{formData.currency}</span>
                      </div>
                      <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showCurrencyDropdown && "rotate-180")} />
                    </button>
                    {showCurrencyDropdown && (
                      <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
                        {CURRENCIES.map((currency) => (
                          <button
                            key={currency.value}
                            onClick={() => {
                              setFormData({ ...formData, currency: currency.value });
                              setShowCurrencyDropdown(false);
                            }}
                            className={cx(
                              "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2",
                              formData.currency === currency.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                            )}
                          >
                            <span className="font-medium">{currency.symbol}</span>
                            <span>{currency.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Descripción general */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Descripción general *</label>
                  <div className="relative">
                    <textarea
                      value={formData.generalDescription}
                      onChange={(e) => setFormData({ ...formData, generalDescription: e.target.value.toUpperCase() })}
                      onBlur={() => handleBlur("generalDescription")}
                      placeholder="DESCRIBE EL PROPÓSITO DE ESTA ORDEN DE COMPRA"
                      rows={3}
                      className={cx(
                        "w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm pr-10 uppercase",
                        hasError("generalDescription") ? "border-red-300 bg-red-50" : isValid("generalDescription") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                      )}
                    />
                    {isValid("generalDescription") && (
                      <CheckCircle2 size={16} className="absolute right-4 top-4 text-emerald-600" />
                    )}
                  </div>
                  {hasError("generalDescription") && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.generalDescription}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">Items</h2>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
                    {items.length}
                  </span>
                </div>
                <button
                  onClick={addItem}
                  className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-medium transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  <Plus size={14} />
                  Añadir
                </button>
              </div>

              <div className="p-6 space-y-4">
                {items.map((item, index) => {
                  const itemHasAllFields = item.description.trim() && item.subAccountId && item.quantity > 0 && item.unitPrice > 0;
                  const selectedAccount = subAccounts.find((a) => a.id === item.subAccountId);
                  
                  return (
                    <div
                      key={item.id}
                      className={cx(
                        "border rounded-xl p-5 transition-all",
                        itemHasAllFields ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50"
                      )}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            {itemHasAllFields ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Hash size={12} />}
                            Item {index + 1}
                          </span>
                          {itemHasAllFields && (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-medium">Completo</span>
                          )}
                        </div>
                        {items.length > 1 && (
                          <button onClick={() => removeItem(index)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>

                      <div className="space-y-4">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(index, "description", e.target.value)}
                          onBlur={() => handleBlur("item_" + index + "_description")}
                          placeholder="Descripción del item"
                          className={cx(
                            "w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white",
                            hasError("item_" + index + "_description") ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"
                          )}
                        />

                        <div>
                          <button
                            onClick={() => { setCurrentItemIndex(index); setShowAccountModal(true); }}
                            className={cx(
                              "w-full px-4 py-3 border rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
                              hasError("item_" + index + "_account") ? "border-red-300 bg-red-50" : item.subAccountCode ? "border-emerald-200 bg-emerald-50" : "border-slate-200"
                            )}
                          >
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
                          {permissions.isProjectRole && selectedAccount && (
                            <div className="mt-2 p-2 bg-slate-50 rounded-lg flex items-center justify-between text-xs">
                              <span className="text-slate-500">Disponible:</span>
                              <span className={cx(
                                "font-medium",
                                selectedAccount.available < item.baseAmount ? "text-red-600" : selectedAccount.available < selectedAccount.budgeted * 0.2 ? "text-amber-600" : "text-emerald-600"
                              )}>
                                {formatCurrency(selectedAccount.available)} €
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Asignación de capítulos */}
                        {episodesEnabled && totalEpisodes > 0 && (
                          <div>
                            <button
                              onClick={() => openEpisodeModal(index)}
                              className={cx(
                                "w-full px-4 py-3 border rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
                                item.episodeAssignment === "general" ? "border-slate-200" : "border-violet-200 bg-violet-50"
                              )}
                            >
                              {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                                <div className="flex items-center gap-2">
                                  <Layers size={14} className="text-violet-600" />
                                  <span className="text-slate-900">
                                    {item.episodes.length === 1 
                                      ? `${item.episodes[0].episode}`
                                      : `${item.episodes.length} capítulos`
                                    }
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <Layers size={14} className="text-slate-400" />
                                  <span className="text-slate-600">General (todos los capítulos)</span>
                                </div>
                              )}
                              <ChevronDown size={14} className="text-slate-400" />
                            </button>
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
                        )}

                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Fecha</label>
                            <input
                              type="date"
                              value={item.date}
                              onChange={(e) => updateItem(index, "date", e.target.value)}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                              className={cx("w-full px-3 py-2.5 border rounded-xl text-sm bg-white", item.quantity > 0 ? "border-emerald-200" : "border-slate-200")}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Precio unit.</label>
                            <div className="relative">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                                className={cx("w-full pl-6 pr-3 py-2.5 border rounded-xl text-sm bg-white", item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200")}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{getCurrencySymbol()}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Base</label>
                            <div className="px-3 py-2.5 bg-slate-100 rounded-xl text-sm font-medium text-slate-900">
                              {formatCurrency(item.baseAmount)} {getCurrencySymbol()}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                            <select
                              value={item.vatRate}
                              onChange={(e) => updateItem(index, "vatRate", parseFloat(e.target.value))}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white"
                            >
                              {VAT_RATES.map((rate) => (<option key={rate.value} value={rate.value}>{rate.label}</option>))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IRPF</label>
                            <select
                              value={item.irpfRate}
                              onChange={(e) => updateItem(index, "irpfRate", parseFloat(e.target.value))}
                              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white"
                            >
                              {IRPF_RATES.map((rate) => (<option key={rate.value} value={rate.value}>{rate.label}</option>))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">+IVA</label>
                            <div className="px-3 py-2.5 bg-emerald-50 rounded-xl text-sm font-medium text-emerald-700">
                              +{formatCurrency(item.vatAmount)}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">-IRPF</label>
                            <div className="px-3 py-2.5 bg-red-50 rounded-xl text-sm font-medium text-red-700">
                              -{formatCurrency(item.irpfAmount)}
                            </div>
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
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  className={cx(
                    "border-2 border-dashed rounded-xl p-8 text-center transition-all",
                    isDragging ? "border-blue-400 bg-blue-50" : uploadedFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                  )}
                  style={isDragging ? { borderColor: "#2F52E0", backgroundColor: "rgba(47, 82, 224, 0.05)" } : {}}
                >
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
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); }}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
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
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder="Ej: Transferencia 30 días"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Notas internas</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Notas adicionales"
                    rows={2}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white resize-none text-sm"
                  />
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
                  <span className={cx("text-sm font-bold", completionPercentage === 100 ? "text-emerald-600" : "text-slate-900")}>
                    {completionPercentage}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cx("h-full transition-all duration-300", completionPercentage === 100 ? "bg-emerald-500" : "")}
                    style={{ width: completionPercentage + "%", backgroundColor: completionPercentage < 100 ? "#2F52E0" : undefined }}
                  />
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
              <div className={cx("border rounded-2xl overflow-hidden", approvalPreview.autoApprove ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <div className="px-5 py-4 border-b" style={{ borderColor: approvalPreview.autoApprove ? "#a7f3d0" : "#fcd34d" }}>
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
                      <p className={cx("font-semibold", approvalPreview.autoApprove ? "text-emerald-800" : "text-amber-800")}>
                        {approvalPreview.autoApprove ? "Aprobación automática" : "Requiere aprobación"}
                      </p>
                      <p className={cx("text-sm", approvalPreview.autoApprove ? "text-emerald-700" : "text-amber-700")}>
                        {approvalPreview.message}
                      </p>
                    </div>
                  </div>
                </div>

                {!approvalPreview.autoApprove && approvalPreview.steps && approvalPreview.steps.length > 0 && (
                  <div className="px-5 py-4">
                    <div className="space-y-3">
                      {approvalPreview.steps.map((step, idx) => (
                        <div key={step.id} className="flex items-start gap-3">
                          <div className="flex flex-col items-center">
                            <div className="w-7 h-7 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-bold">
                              {idx + 1}
                            </div>
                            {idx < approvalPreview.steps!.length - 1 && (
                              <div className="w-0.5 h-8 bg-amber-200 mt-1" />
                            )}
                          </div>
                          <div className="flex-1 pt-0.5">
                            <p className="text-sm font-medium text-amber-900">
                              {step.approverType === "role" && step.roles
                                ? step.roles.join(", ")
                                : step.approverType === "hod"
                                ? "Jefe de departamento"
                                : step.approverType === "coordinator"
                                ? "Coordinador"
                                : "Aprobador fijo"}
                            </p>
                            {step.approverNames.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {step.approverNames.slice(0, 3).map((name, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg">
                                    <Users size={10} />
                                    {name.split(" ")[0]}
                                  </span>
                                ))}
                                {step.approverNames.length > 3 && (
                                  <span className="text-xs text-amber-700">+{step.approverNames.length - 3} más</span>
                                )}
                              </div>
                            )}
                            <p className="text-xs text-amber-700 mt-1">
                              {step.requireAll ? "Todos deben aprobar" : "1 de " + step.approvers.length + " debe aprobar"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Info size={14} className="text-slate-500" />
                  </div>
                  <div className="text-sm text-slate-600">
                    <p className="font-medium text-slate-700 mb-2">Proceso de la PO</p>
                    <ul className="space-y-1.5 text-slate-500">
                      <li className="flex items-start gap-2">
                        <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Los borradores no comprometen presupuesto</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Una vez aprobada, se compromete el presupuesto</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Las facturas se vinculan a la PO aprobada</span>
                      </li>
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
              <div className="flex gap-2 mb-4">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    placeholder="Buscar por nombre o NIF"
                    className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm"
                    autoFocus
                  />
                </div>
                <button
                  onClick={() => setShowCreateSupplierModal(true)}
                  className="px-4 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <Plus size={16} />
                  Nuevo
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-2">
                {filteredSuppliers.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Building2 size={20} className="text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 mb-3">No se encontraron proveedores</p>
                    <button
                      onClick={() => setShowCreateSupplierModal(true)}
                      className="text-sm text-slate-900 font-medium hover:underline"
                    >
                      Crear nuevo proveedor
                    </button>
                  </div>
                ) : (
                  filteredSuppliers.map((supplier) => (
                    <button
                      key={supplier.id}
                      onClick={() => selectSupplier(supplier)}
                      className="w-full text-left p-4 border border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50 transition-all group"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">{supplier.fiscalName}</p>
                          {supplier.commercialName && (<p className="text-sm text-slate-500">{supplier.commercialName}</p>)}
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                            <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded">
                              <Hash size={10} />
                              {supplier.taxId}
                            </span>
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

      {/* Create Supplier Modal */}
      {showCreateSupplierModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-slate-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Nuevo proveedor</h2>
                  <p className="text-xs text-slate-500">Datos básicos · Completa el resto en Proveedores</p>
                </div>
              </div>
              <button onClick={() => { setShowCreateSupplierModal(false); setNewSupplierData({ fiscalName: "", taxId: "" }); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre fiscal *</label>
                <input
                  type="text"
                  value={newSupplierData.fiscalName}
                  onChange={(e) => setNewSupplierData({ ...newSupplierData, fiscalName: e.target.value })}
                  placeholder="Nombre o razón social"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">NIF/CIF *</label>
                <input
                  type="text"
                  value={newSupplierData.taxId}
                  onChange={(e) => setNewSupplierData({ ...newSupplierData, taxId: e.target.value })}
                  placeholder="B12345678"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowCreateSupplierModal(false); setNewSupplierData({ fiscalName: "", taxId: "" }); }}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={createQuickSupplier}
                  disabled={creatingSupplier || !newSupplierData.fiscalName.trim() || !newSupplierData.taxId.trim()}
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium disabled:opacity-50"
                >
                  {creatingSupplier ? "Creando..." : "Crear y seleccionar"}
                </button>
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
                <input
                  type="text"
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Buscar por código o descripción"
                  className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm"
                  autoFocus
                />
              </div>

              <div className="max-h-80 overflow-y-auto space-y-2">
                {filteredSubAccounts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                      <Hash size={20} className="text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500">No se encontraron cuentas</p>
                  </div>
                ) : (
                  filteredSubAccounts.map((subAccount) => {
                    const isLowBudget = subAccount.available < subAccount.budgeted * 0.1;
                    const isOverBudget = subAccount.available < 0;
                    
                    return (
                      <button
                        key={subAccount.id}
                        onClick={() => selectAccount(subAccount)}
                        className={cx(
                          "w-full text-left p-4 border rounded-xl hover:bg-slate-50 transition-all",
                          isOverBudget ? "border-red-200 bg-red-50/50" : isLowBudget ? "border-amber-200 bg-amber-50/50" : "border-slate-200"
                        )}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-mono font-semibold text-slate-900">{subAccount.code}</p>
                              {isOverBudget && (
                                <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg">
                                  <AlertTriangle size={10} />
                                  Sin presupuesto
                                </span>
                              )}
                              {!isOverBudget && isLowBudget && (
                                <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg">
                                  <AlertTriangle size={10} />
                                  Bajo
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-700">{subAccount.description}</p>
                            <p className="text-xs text-slate-500 mt-1">{subAccount.accountCode} - {subAccount.accountDescription}</p>
                          </div>
                        </div>
                        {permissions.isProjectRole && (
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div className="bg-amber-50 rounded-lg p-2">
                              <p className="text-amber-600">Comprometido</p>
                              <p className="font-semibold text-amber-700">{formatCurrency(subAccount.committed)} €</p>
                            </div>
                            <div className="bg-emerald-50 rounded-lg p-2">
                              <p className="text-emerald-600">Realizado</p>
                              <p className="font-semibold text-emerald-700">{formatCurrency(subAccount.actual)} €</p>
                            </div>
                            <div className={cx("rounded-lg p-2", isOverBudget ? "bg-red-50" : isLowBudget ? "bg-amber-50" : "bg-emerald-50")}>
                              <p className={isOverBudget ? "text-red-600" : isLowBudget ? "text-amber-600" : "text-emerald-600"}>Disponible</p>
                              <p className={cx("font-semibold", isOverBudget ? "text-red-700" : isLowBudget ? "text-amber-700" : "text-emerald-700")}>
                                {formatCurrency(subAccount.available)} €
                              </p>
                            </div>
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
                  <p className="text-xs text-slate-500">Item {episodeItemIndex + 1}: {formatCurrency(items[episodeItemIndex].baseAmount)} €</p>
                </div>
              </div>
              <button onClick={() => setShowEpisodeModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={20} className="text-slate-500" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Opción General */}
              <button
                onClick={() => setTempEpisodeDistribution([])}
                className={cx(
                  "w-full px-4 py-4 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 border-2",
                  tempEpisodeDistribution.length === 0
                    ? "bg-violet-50 border-violet-500 text-violet-700" 
                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                )}
              >
                <div className={cx(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                  tempEpisodeDistribution.length === 0 ? "border-violet-500 bg-violet-500" : "border-slate-300"
                )}>
                  {tempEpisodeDistribution.length === 0 && <CheckCircle2 size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium">General (todos los capítulos)</p>
                  <p className="text-xs text-slate-500">El importe se reparte equitativamente entre todos</p>
                </div>
              </button>

              {/* Opción Específico */}
              <button
                onClick={() => {
                  if (tempEpisodeDistribution.length === 0) {
                    // Seleccionar el primer capítulo por defecto
                    const item = items[episodeItemIndex];
                    setTempEpisodeDistribution([{ episode: 1, amount: item.baseAmount, percentage: 100 }]);
                  }
                }}
                className={cx(
                  "w-full px-4 py-4 rounded-xl text-sm font-medium transition-colors flex items-center gap-3 border-2",
                  tempEpisodeDistribution.length > 0
                    ? "bg-violet-50 border-violet-500 text-violet-700" 
                    : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                )}
              >
                <div className={cx(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                  tempEpisodeDistribution.length > 0 ? "border-violet-500 bg-violet-500" : "border-slate-300"
                )}>
                  {tempEpisodeDistribution.length > 0 && <CheckCircle2 size={12} className="text-white" />}
                </div>
                <div className="text-left">
                  <p className="font-medium">Capítulos específicos</p>
                  <p className="text-xs text-slate-500">Asignar a uno o varios capítulos concretos</p>
                </div>
              </button>

              {/* Selección de capítulos específicos */}
              {tempEpisodeDistribution.length > 0 && (
                <div className="space-y-4 pt-2">
                  {/* Modo de distribución */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Distribución</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEpisodeDistributionMode("equal"); applyEqualDistribution(); }}
                        className={cx(
                          "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                          episodeDistributionMode === "equal" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        Partes iguales
                      </button>
                      <button
                        onClick={() => setEpisodeDistributionMode("amount")}
                        className={cx(
                          "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                          episodeDistributionMode === "amount" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        Por importe
                      </button>
                      <button
                        onClick={() => setEpisodeDistributionMode("percentage")}
                        className={cx(
                          "flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                          episodeDistributionMode === "percentage" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        Por porcentaje
                      </button>
                    </div>
                  </div>

                  {/* Selección de capítulos */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Capítulos</label>
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map((epNum) => {
                        const isSelected = tempEpisodeDistribution.some(e => e.episode === epNum);
                        return (
                          <button
                            key={epNum}
                            onClick={() => toggleEpisodeInDistribution(epNum)}
                            className={cx(
                              "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                              isSelected ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                            )}
                          >
                            {epNum}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Distribución detallada */}
                  {tempEpisodeDistribution.length > 0 && episodeDistributionMode !== "equal" && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Importes</label>
                      <div className="space-y-2">
                        {tempEpisodeDistribution.map((ep) => (
                          <div key={ep.episode} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                            <span className="text-sm font-medium text-slate-700 w-16">Cap {ep.episode}</span>
                            {episodeDistributionMode === "amount" ? (
                              <div className="flex-1 relative">
                                <input
                                  type="number"
                                  value={ep.amount || ""}
                                  onChange={(e) => updateEpisodeAmount(ep.episode, parseFloat(e.target.value) || 0)}
                                  className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg text-sm"
                                  placeholder="0.00"
                                />
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">€</span>
                              </div>
                            ) : (
                              <div className="flex-1 relative">
                                <input
                                  type="number"
                                  value={ep.percentage || ""}
                                  onChange={(e) => updateEpisodePercentage(ep.episode, parseFloat(e.target.value) || 0)}
                                  className="w-full pr-8 pl-3 py-2 border border-slate-200 rounded-lg text-sm"
                                  placeholder="0"
                                  min="0"
                                  max="100"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                              </div>
                            )}
                            <span className="text-xs text-slate-500 w-20 text-right">
                              {episodeDistributionMode === "amount" 
                                ? `${ep.percentage.toFixed(1)}%`
                                : `${formatCurrency(ep.amount)} €`
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Resumen */}
                  {tempEpisodeDistribution.length > 0 && (
                    <div className={cx(
                      "p-3 rounded-lg flex items-center justify-between",
                      Math.abs(getTotalDistributedPercentage() - 100) < 0.1 ? "bg-emerald-50" : "bg-amber-50"
                    )}>
                      <span className="text-sm font-medium text-slate-700">Total:</span>
                      <div className="text-right">
                        <p className={cx(
                          "text-sm font-semibold",
                          Math.abs(getTotalDistributedPercentage() - 100) < 0.1 ? "text-emerald-700" : "text-amber-700"
                        )}>
                          {formatCurrency(getTotalDistributedAmount())} € ({getTotalDistributedPercentage().toFixed(1)}%)
                        </p>
                        {Math.abs(getTotalDistributedPercentage() - 100) >= 0.1 && (
                          <p className="text-xs text-amber-600">Debe sumar 100%</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => setShowEpisodeModal(false)}
                className="flex-1 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={saveEpisodeDistribution}
                disabled={tempEpisodeDistribution.length > 0 && Math.abs(getTotalDistributedPercentage() - 100) >= 0.1}
                className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
