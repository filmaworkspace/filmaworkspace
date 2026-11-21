"use client";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { AccountPickerModal, EpisodeModal, SupplierPickerModal } from "@/components/accounting/Pickers";
import { documentTotals, lineAmounts } from "@/lib/amounts";
import { nextDocNumber } from "@/lib/docCounter";
import { approverIdsOf } from "@/lib/approvers";
import { ApprovalSteps } from "@/components/accounting/ApprovalFlow";
import { buildFlow, type ApprovalStepConfig, type FlowMember } from "@/lib/approvalFlow";
import { loadBudgetFigures } from "@/lib/budgetFigures";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  FileBox,
  FileUp,
  Hash,
  Info,
  Layers,
  Lock,
  Package,
  Plus,
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

// ─────────────────────────────────────────────────────────────────────────────

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
  // Los avisos van por lib/toast.
  const setSuccessMessage = (m: string) => { if (m) appToast.success(m); };
  const setErrorMessage = (m: string) => { if (m) appToast.error(m); };
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);

  // Sistema de borradores (localStorage)
  interface Draft {
    id: string;
    name: string;
    savedAt: string;
    formData: any;
    items: POItem[];
    noSupplier?: boolean;
    /** true = autoguardado (ver más abajo), no uno creado a mano con "Guardar borrador". */
    auto?: boolean;
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
  // PO "fantasma": sin proveedor asignado todavía (se resuelve más adelante,
  // p.ej. cuando aún no se sabe a quién se le va a comprar). Desmarca la
  // obligatoriedad del proveedor solo mientras esto está activo.
  const [noSupplier, setNoSupplier] = useState(false);

  // Dropdowns custom
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [showVatDropdown, setShowVatDropdown] = useState<number | null>(null);
  const [showIrpfDropdown, setShowIrpfDropdown] = useState<number | null>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const currencyDropdownRef = useRef<HTMLDivElement>(null);

  // Generador de título
  const [showTitleBuilder, setShowTitleBuilder] = useState(false);
  const [titleConcept, setTitleConcept] = useState("");
  const [titleReference, setTitleReference] = useState("");

  const TITLE_SUGGESTIONS: Record<string, string[]> = {
    rental:   ["ALQUILER CÁMARA", "ALQUILER ÓPTICA", "ALQUILER VEHÍCULO", "ALQUILER LOCALIZACIÓN", "ALQUILER EQUIPO LUZ", "ALQUILER SONIDO", "ALQUILER GRÚA"],
    purchase: ["COMPRA ATREZZO", "COMPRA VESTUARIO", "COMPRA MATERIAL", "COMPRA CONSUMIBLES", "COMPRA MAQUILLAJE", "COMPRA UTILERÍA"],
    service:  ["SERVICIOS PRODUCCIÓN", "SERVICIOS DIRECCIÓN", "CATERING", "TRANSPORTE", "SEGURIDAD", "LIMPIEZA", "POSTPRODUCCIÓN"],
    deposit:  ["FIANZA LOCALIZACIÓN", "FIANZA VEHÍCULO", "FIANZA ESPACIO", "FIANZA EQUIPO"],
  };

  const titlePreview =
    titleConcept && titleReference
      ? `${titleConcept.toUpperCase()} · ${titleReference.toUpperCase()}`
      : titleConcept
      ? titleConcept.toUpperCase()
      : "";

  const applyTitle = () => {
    if (!titlePreview) return;
    setFormData((prev) => ({ ...prev, generalDescription: titlePreview }));
    setTouched((prev) => ({ ...prev, generalDescription: true }));
    setShowTitleBuilder(false);
    setTitleConcept("");
    setTitleReference("");
  };

  // Configuración de episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [episodesRequired, setEpisodesRequired] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount" | "percentage">("equal");
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto (un solo lock,
  // vale para los cuatro: da igual cuál esté abierto).
  useBodyScrollLock(showSupplierModal || showCreateSupplierModal || showAccountModal || showEpisodeModal);

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
  const hasDraftableContent = () =>
    !!(formData.supplier || formData.supplierName || noSupplier || formData.generalDescription.trim() ||
       items.some((item) => item.description.trim() || item.unitPrice > 0));

  const saveDraft = () => {
    if (!hasDraftableContent()) {
      setErrorMessage("No hay contenido para guardar");
      return;
    }

    const newDraft: Draft = {
      id: `draft_${Date.now()}`,
      name: formData.supplierName || formData.generalDescription || `Borrador ${drafts.length + 1}`,
      savedAt: new Date().toISOString(),
      formData,
      items,
      noSupplier,
    };

    const updatedDrafts = [...drafts, newDraft];
    setDrafts(updatedDrafts);
    localStorage.setItem(`po_drafts_${id}`, JSON.stringify(updatedDrafts));
    setSuccessMessage("Borrador guardado");
    setShowDraftsPanel(false);
  };

  const loadDraft = (draft: Draft) => {
    setFormData(draft.formData);
    setItems(draft.items);
    setNoSupplier(!!draft.noSupplier);
    setShowDraftsPanel(false);
    setSuccessMessage("Borrador cargado");
  };

  const deleteDraft = (draftId: string) => {
    const updatedDrafts = drafts.filter(d => d.id !== draftId);
    setDrafts(updatedDrafts);
    localStorage.setItem(`po_drafts_${id}`, JSON.stringify(updatedDrafts));
  };

  // ─── Autoguardado (hooks/useFormAutosave) ────────────────────────────────
  // Guarda mientras se escribe y lo recupera solo al volver a la página.
  const initialForm = useRef({ formData, items, noSupplier });
  const autosave = useFormAutosave({
    key: id && permissions.userId ? `autosave:po:new:${permissions.userId}:${id}` : null,
    value: { formData, items, noSupplier },
    ready: !loading && !permissionsLoading,
    isEmpty: (v) => !(v.formData.supplier || v.formData.supplierName || v.noSupplier || v.formData.generalDescription.trim() ||
      v.items.some((it: POItem) => it.description.trim() || it.unitPrice > 0)),
    onRestore: (v) => { setFormData(v.formData); setItems(v.items); setNoSupplier(!!v.noSupplier); },
  });
  const clearAutoDraft = autosave.clear;

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
            name = userDoc.data().displayName || name;
          }
        } catch (e) {}
        membersData.push({
          userId: memberDocSnap.id,
          name,
          email: memberData.email,
          role: memberData.role,
          department: memberData.department,
          position: memberData.position,
          permissions: memberData.permissions || null,
          accountingAccessLevel: memberData.accountingAccessLevel || null,
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
      const figures = await loadBudgetFigures(id as string);
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
            budgeted: figures[subDoc.id] ?? data.budgeted ?? 0,
            committed: data.committed || 0,
            actual: data.actual || 0,
            available: (figures[subDoc.id] ?? data.budgeted ?? 0) - (data.committed || 0) - (data.actual || 0),
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
    setTotals(documentTotals(items));
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

  const createQuickSupplier = async (data: { fiscalName: string; taxId: string } = newSupplierData) => {
    if (!data.fiscalName.trim() || !data.taxId.trim()) return;
    setCreatingSupplier(true);
    try {
      const newSupplier = {
        fiscalName: data.fiscalName.trim(),
        commercialName: "",
        country: "ES",
        taxId: data.taxId.trim().toUpperCase(),
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
      const docRef = await addDoc(collection(db, `projects/${id}/suppliers`), newSupplier);
      
      // Seleccionar el nuevo proveedor y poner su método de pago por defecto
      setFormData({
        ...formData,
        supplier: docRef.id,
        supplierName: data.fiscalName.trim(),
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

  const saveEpisodeDistribution = (dist: EpisodeDistribution[] = tempEpisodeDistribution) => {
    if (episodeItemIndex === null) return;
    
    const newItems = [...items];
    const isGeneral = dist.length === 0 || dist.length === totalEpisodes;
    
    newItems[episodeItemIndex] = {
      ...newItems[episodeItemIndex],
      episodeAssignment: isGeneral ? "general" : "specific",
      episodes: dist.length > 0 && dist.length < totalEpisodes 
        ? dist 
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
    if (!noSupplier && !formData.supplier) newErrors.supplier = "Selecciona un proveedor";
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
      appToast.error("Solo PDF o imágenes hasta 10MB");
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



  const savePO = async (status: "draft" | "pending") => {
    if (status === "pending" && !validateForm()) return;
    setSaving(true);
    try {
      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      
      // Obtener siguiente número correlativo global
      const finalNumber = await nextDocNumber(id as string, "pos");

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
        // Marca explícita de "PO fantasma" (sin proveedor todavía): distingue
        // a propósito de un dato vacío por error, para poder filtrarlas o
        // avisarlas más adelante ("pendientes de proveedor").
        noSupplier,
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
          // Se guardan los pasos omitidos (con su motivo) para auditoría.
          if (approvalSteps.length) { poData.approvalSteps = approvalSteps; poData.approverIds = []; poData.currentApprovalStep = -1; }
          poData.committedAmount = totals.baseAmount;
          poData.remainingAmount = totals.baseAmount;
        } else {
          poData.status = "pending";
          poData.approvalSteps = approvalSteps;
          poData.approverIds = approverIdsOf(approvalSteps);
          poData.currentApprovalStep = approvalSteps.findIndex((x) => x.status === "pending");
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
      // La PO ya existe de verdad: el autoguardado local deja de tener sentido.
      clearAutoDraft();

      // Presupuesto: se recalcula desde los documentos (lib/budgetLedger).
      if (poData.status !== "draft") await syncBudget(id);

      setSuccessMessage(
        poData.status === "approved"
          ? "PO aprobada automáticamente"
          : poData.status === "pending"
          ? "PO enviada para aprobación"
          : "Borrador guardado"
      );
      setTimeout(() => router.push("/project/" + id + "/accounting/pos"), 1500);
    } catch (error: any) {
      appToast.error(error);
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
      useGrouping: "always",
    } as Intl.NumberFormatOptions).format(amount);

  const getApprovalPreview = () => {
    const steps = generateApprovalSteps(formData.department);
    const pending = steps.filter((s) => s.status === "pending").length;
    if (!pending) return { autoApprove: true, message: "Se aprobará automáticamente", steps };
    return { autoApprove: false, message: pending + " nivel" + (pending > 1 ? "es" : "") + " de aprobación", steps };
  };


  const getCompletionPercentage = () => {
    let completed = 0;
    let total = 4;
    if (formData.supplier || noSupplier) completed++;
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
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || !permissions.canCreatePO) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md">
          <div className="hidden">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para crear órdenes de compra"}</p>
          <Link
            href={"/project/" + id + "/accounting/pos"}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium transition-opacity"
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
      <div className="mt-[53px]">
        <div className="px-6 pt-8 sm:px-10">
          <div className="relative flex min-h-[44px] items-center justify-start border-b border-slate-200 pb-4">
            <Link
              href={"/project/" + id + "/accounting/pos"}
              className="mr-3 w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-[#F4F4F5] hover:text-slate-900 transition-colors"
            >
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">Nueva orden de compra</h1>
                <AutosaveStatus savedAt={autosave.savedAt} />
                {permissions.fixedDepartment && (
                  <span className="px-2 py-1 rounded-lg text-xs font-medium" style={{ backgroundColor: "rgba(47, 82, 224, 0.1)", color: "#2F52E0" }}>
                    {permissions.fixedDepartment}
                  </span>
                )}
              </div>
            </div>

            <div className="absolute right-0 flex items-center gap-2">
              {/* Botón de borradores */}
              <div className="relative">
                <button
                  onClick={() => setShowDraftsPanel(!showDraftsPanel)}
                  className={cx(
                    "flex items-center gap-2 px-3 py-1.5 border rounded-md text-[13px] font-medium transition-colors",
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
                    <AnchoredPanel className="w-72 bg-white border border-slate-200 rounded-md shadow-xl overflow-hidden" align="right" offsetTop={48}>
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 text-[13px]">Borradores</h3>
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
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-[13px] font-medium text-slate-900 truncate">{draft.name}</p>
                                    {draft.auto && (
                                      <span className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Auto</span>
                                    )}
                                  </div>
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
                            <p className="text-[13px] text-slate-500">No hay borradores</p>
                          </div>
                        )}
                      </div>

                      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
                        <button
                          onClick={saveDraft}
                          className="w-full px-3 py-2 rounded-lg text-xs font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
                        >
                          Guardar como borrador
                        </button>
                      </div>
                    </AnchoredPanel>
                  </>
                )}
              </div>

              <button
                onClick={() => savePO("pending")}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium transition-opacity disabled:opacity-50"
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

      <main className="px-6 sm:px-10 py-8">
        <AutosaveNotice restoredAt={autosave.restoredAt} onDiscard={() => {
          autosave.discard();
          setFormData(initialForm.current.formData); setItems(initialForm.current.items); setNoSupplier(initialForm.current.noSupplier);
        }} />
        <div className="grid grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>

              <div className="p-6 space-y-5">
                {/* Proveedor */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Proveedor {!noSupplier && "*"}</label>
                  <button
                    onClick={() => setShowSupplierModal(true)}
                    onBlur={() => handleBlur("supplier")}
                    className={cx(
                      "w-full px-4 py-1.5 border rounded-md hover:border-slate-300 transition-colors text-left flex items-center justify-between bg-white",
                      noSupplier
                        ? "border-dashed border-slate-300 bg-slate-50"
                        : hasError("supplier") ? "border-red-300 bg-red-50" : isValid("supplier") ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                    )}
                  >
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center", isValid("supplier") ? "bg-emerald-100" : "bg-slate-100")}>
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
                      <span className="text-slate-400">Seleccionar proveedor</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("supplier") && !noSupplier && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.supplier}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-5">
                  {/* Departamento - Custom Dropdown */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">
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
                          "w-full px-4 py-1.5 border rounded-md text-left flex items-center justify-between transition-colors",
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
                        <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-60 overflow-y-auto" match="width" gap={8}>
                          {availableDepartments.map((dept) => (
                            <button
                              key={dept}
                              onClick={() => {
                                setFormData({ ...formData, department: dept });
                                setTouched((prev) => ({ ...prev, department: true }));
                                setShowDepartmentDropdown(false);
                              }}
                              className={cx(
                                "w-full text-left px-4 py-1.5 text-[13px] transition-colors",
                                formData.department === dept ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                              )}
                            >
                              {dept}
                            </button>
                          ))}
                        </AnchoredPanel>
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
                    <label className="mb-1.5 block text-xs font-medium text-slate-600">Tipo de PO</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PO_TYPES.map((type) => {
                        const Icon = type.icon;
                        const isSelected = formData.poType === type.value;
                        return (
                          <button
                            key={type.value}
                            onClick={() => setFormData({ ...formData, poType: type.value as any })}
                            className={cx(
                              "px-3 py-1.5 rounded-md border transition-all flex items-center justify-center gap-2 text-[13px]",
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

                {/* Descripción general */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[13px] font-medium text-slate-700">Descripción general *</label>
                    <button
                      type="button"
                      onClick={() => setShowTitleBuilder(!showTitleBuilder)}
                      className={cx(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                        showTitleBuilder
                          ? "bg-slate-900 text-white border-slate-900"
                          : "text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700 bg-white"
                      )}
                    >
                      <Layers size={11} />
                      Generador
                    </button>
                  </div>

                  {/* Generador de título */}
                  {showTitleBuilder && (
                    <div className="mb-3 p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
                      {/* Sugerencias de concepto */}
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Concepto</p>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {TITLE_SUGGESTIONS[formData.poType]?.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setTitleConcept(s)}
                              className={cx(
                                "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                                titleConcept === s
                                  ? "bg-slate-900 text-white border-slate-900"
                                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          value={titleConcept}
                          onChange={(e) => setTitleConcept(e.target.value.toUpperCase())}
                          placeholder="O escribe el concepto"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 uppercase placeholder:normal-case"
                        />
                      </div>

                      {/* Referencia */}
                      <div>
                        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Referencia <span className="text-slate-400 normal-case font-normal">(set, personaje, elemento…)</span></p>
                        <input
                          type="text"
                          value={titleReference}
                          onChange={(e) => setTitleReference(e.target.value.toUpperCase())}
                          placeholder="CASA AZUL · PERSONAJE · SECUENCIA"
                          className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 uppercase placeholder:normal-case"
                        />
                      </div>

                      {/* Preview + acción */}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="flex-1 min-w-0">
                          {titlePreview ? (
                            <p className="text-xs tabular-nums font-semibold text-slate-800 truncate bg-white border border-slate-200 px-3 py-2 rounded-lg">
                              {titlePreview}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400 italic px-1">La previsualización aparece aquí</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={applyTitle}
                          disabled={!titlePreview}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-colors flex-shrink-0 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
                        >
                          <CheckCircle2 size={12} />
                          Aplicar
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="relative">
                    <textarea
                      value={formData.generalDescription}
                      onChange={(e) => setFormData({ ...formData, generalDescription: e.target.value.toUpperCase() })}
                      onBlur={() => handleBlur("generalDescription")}
                      placeholder="CONCEPTO DE LA ORDEN DE COMPRA"
                      rows={2}
                      className={cx(
                        "w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white resize-none text-[13px] pr-10 uppercase",
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
            <div className="bg-white border border-slate-200 rounded-lg">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">Items</h2>
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
                    {items.length}
                  </span>
                </div>
                <button
                  onClick={addItem}
                  className="flex items-center gap-1.5 px-4 py-2 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium transition-opacity"
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
                        "border rounded-md p-5 transition-all",
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
                            "w-full px-2.5 py-1.5 border rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white",
                            hasError("item_" + index + "_description") ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"
                          )}
                        />

                        <div>
                          <button
                            onClick={() => { setCurrentItemIndex(index); setShowAccountModal(true); }}
                            className={cx(
                              "w-full px-4 py-2 border rounded-md text-[13px] text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
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
                        </div>

                        {/* Asignación de capítulos */}
                        {episodesEnabled && totalEpisodes > 0 && (
                          <div>
                            <button
                              onClick={() => openEpisodeModal(index)}
                              className={cx(
                                "w-full px-4 py-2 border rounded-md text-[13px] text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
                                item.episodeAssignment === "general" ? "border-slate-200" : "border-slate-200 bg-[#F7F7F8]"
                              )}
                            >
                              {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                                <div className="flex items-center gap-2">
                                  <Layers size={14} className="text-slate-700" />
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
                                  <span key={ep.episode} className="text-xs bg-[#F1F1F3] text-slate-900 px-2 py-0.5 rounded-lg">
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
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                              className={cx("w-full px-2.5 py-1.5 border rounded-md text-[13px] bg-white", item.quantity > 0 ? "border-emerald-200" : "border-slate-200")}
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
                                className={cx("w-full pl-6 pr-3 py-1.5 border rounded-md text-[13px] bg-white", item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200")}
                              />
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{getCurrencySymbol()}</span>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">Base</label>
                            <div className="px-3 py-2.5 bg-slate-100 rounded-md text-[13px] font-medium text-slate-900">
                              {formatCurrency(item.baseAmount)} {getCurrencySymbol()}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                          <div className="relative">
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                            <button
                              type="button"
                              onClick={() => setShowVatDropdown(showVatDropdown === index ? null : index)}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                            >
                              <span>{VAT_RATES.find(r => r.value === item.vatRate)?.label || item.vatRate + "%"}</span>
                              <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showVatDropdown === index && "rotate-180")} />
                            </button>
                            {showVatDropdown === index && (
                              <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                {VAT_RATES.map((rate) => (
                                  <button
                                    key={rate.value}
                                    type="button"
                                    onClick={() => { updateItem(index, "vatRate", rate.value); setShowVatDropdown(null); }}
                                    className={cx("w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50", item.vatRate === rate.value && "bg-slate-50 font-medium")}
                                  >
                                    {rate.label}
                                  </button>
                                ))}
                              </AnchoredPanel>
                            )}
                          </div>
                          <div className="relative">
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">IRPF</label>
                            <button
                              type="button"
                              onClick={() => setShowIrpfDropdown(showIrpfDropdown === index ? null : index)}
                              className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                            >
                              <span>{IRPF_RATES.find(r => r.value === item.irpfRate)?.label || item.irpfRate + "%"}</span>
                              <ChevronDown size={14} className={cx("text-slate-400 transition-transform", showIrpfDropdown === index && "rotate-180")} />
                            </button>
                            {showIrpfDropdown === index && (
                              <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                {IRPF_RATES.map((rate) => (
                                  <button
                                    key={rate.value}
                                    type="button"
                                    onClick={() => { updateItem(index, "irpfRate", rate.value); setShowIrpfDropdown(null); }}
                                    className={cx("w-full px-3 py-2 text-left text-[13px] hover:bg-slate-50", item.irpfRate === rate.value && "bg-slate-50 font-medium")}
                                  >
                                    {rate.label}
                                  </button>
                                ))}
                              </AnchoredPanel>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">+IVA</label>
                            <div className="px-3 py-2.5 bg-emerald-50 rounded-md text-[13px] font-medium text-emerald-700">
                              +{formatCurrency(item.vatAmount)}
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">-IRPF</label>
                            <div className="px-3 py-2.5 bg-red-50 rounded-md text-[13px] font-medium text-red-700">
                              -{formatCurrency(item.irpfAmount)}
                            </div>
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
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                  className={cx(
                    "border-2 border-dashed rounded-md p-8 text-center transition-all",
                    isDragging ? "border-slate-400 bg-[#F7F7F8]" : uploadedFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                  )}
                  style={isDragging ? { borderColor: "#2F52E0", backgroundColor: "rgba(47, 82, 224, 0.05)" } : {}}
                >
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
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información adicional</h2>
              </div>

              <div className="p-6 space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Condiciones de pago</label>
                  <input
                    type="text"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder="Condiciones de pago"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white text-[13px]"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Notas internas</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Notas adicionales"
                    rows={2}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white resize-none text-[13px]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="col-span-1">
            <div className="space-y-4">
              {/* Progress */}
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-medium text-slate-700">Progreso</span>
                  <span className={cx("text-[13px] font-bold", completionPercentage === 100 ? "text-emerald-600" : "text-slate-900")}>
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
              <div className={cx("border rounded-lg overflow-hidden", approvalPreview.autoApprove ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <div className="px-5 py-4 border-b" style={{ borderColor: approvalPreview.autoApprove ? "#a7f3d0" : "#fcd34d" }}>
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
                      <p className={cx("font-semibold", approvalPreview.autoApprove ? "text-emerald-800" : "text-amber-800")}>
                        {approvalPreview.autoApprove ? "Aprobación automática" : "Requiere aprobación"}
                      </p>
                      <p className={cx("text-[13px]", approvalPreview.autoApprove ? "text-emerald-700" : "text-amber-700")}>
                        {approvalPreview.message}
                      </p>
                    </div>
                  </div>
                </div>

                {approvalPreview.steps.length > 0 && (
                  <div className="bg-white/60 px-5 py-4">
                    <ApprovalSteps steps={approvalPreview.steps} department={formData.department} preview />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Info size={14} className="text-slate-500" />
                  </div>
                  <div className="text-[13px] text-slate-600">
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

      <SupplierPickerModal
        open={showSupplierModal}
        onClose={() => { setShowSupplierModal(false); setSupplierSearch(""); }}
        suppliers={suppliers}
        onSelect={selectSupplier}
        onCreate={(data) => createQuickSupplier(data)}
        onNoSupplier={() => {
          setNoSupplier(true);
          setFormData((prev) => ({ ...prev, supplier: "", supplierName: "" }));
          setErrors((prev) => { const { supplier, ...rest } = prev; return rest; });
          setShowSupplierModal(false);
          setSupplierSearch("");
        }}
      />
      <AccountPickerModal
        open={showAccountModal}
        onClose={() => { setShowAccountModal(false); setAccountSearch(""); setCurrentItemIndex(null); }}
        subAccounts={subAccounts}
        showFigures={false}
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

      {/* Toast notifications */}
    </div>
  );
}
