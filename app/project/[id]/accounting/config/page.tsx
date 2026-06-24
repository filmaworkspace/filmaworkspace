"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  Edit2,
  FileCheck,
  FileText,
  Film,
  Info,
  Landmark,
  Layers,
  Package,
  Plus,
  Receipt,
  Save,
  Settings,
  Shield,
  Star,
  Trash2,
  TrendingUp,
  UserCheck,
  Users,
  X,
  Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
  position?: string;
}

interface ApprovalStep {
  id: string;
  order: number;
  approverType: "fixed" | "hod" | "coordinator" | "role";
  approvers?: string[];
  roles?: string[];
  department?: string;
  requireAll: boolean;
  hasAmountThreshold: boolean;
  amountThreshold?: number;
  amountCondition?: "above" | "below" | "between";
  amountThresholdMax?: number;
}

interface CompanyData {
  fiscalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
}

interface BankAccount {
  id: string;
  alias: string;
  fiscalName: string;
  taxId: string;
  iban: string;
  bic?: string;
  isDefault?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const emptyCompanyData: CompanyData = {
  fiscalName: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  country: "España",
};

const emptyBankAccount: Omit<BankAccount, "id"> = {
  alias: "",
  fiscalName: "",
  taxId: "",
  iban: "",
  bic: "",
  isDefault: false,
};

const formatIBAN = (iban: string): string => {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join(" ") || clean;
};

const calculateSpanishIBANCheckDigits = (accountNumber: string): string => {
  const clean = accountNumber.replace(/\s/g, "");
  if (clean.length !== 20 || !/^\d{20}$/.test(clean)) return "";
  const numericString = clean + "142800";
  let remainder = 0;
  for (let i = 0; i < numericString.length; i++) {
    remainder = (remainder * 10 + parseInt(numericString[i])) % 97;
  }
  const checkDigits = (98 - remainder).toString().padStart(2, "0");
  return "ES" + checkDigits + clean;
};

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];
const APPROVER_TYPE_LABELS: Record<string, string> = {
  fixed: "Usuarios específicos",
  role: "Por rol",
  hod: "Head of Department",
  coordinator: "Coordinator",
};
const APPROVER_TYPE_ICONS: Record<string, any> = {
  fixed: Users,
  role: Shield,
  hod: Briefcase,
  coordinator: UserCheck,
};

const AMOUNT_CONDITIONS: Record<string, { label: string; description: string }> = {
  above: { label: "Superior a", description: "Se activa cuando el importe supera el umbral" },
  below: { label: "Inferior a", description: "Se activa cuando el importe es menor al umbral" },
  between: { label: "Entre", description: "Se activa cuando el importe está en el rango" },
};

const PRESET_THRESHOLDS = [1000, 2500, 5000, 10000, 25000, 50000];

// Secciones de configuración
const CONFIG_SECTIONS = [
  { id: "company", label: "Datos fiscales", icon: Building2, description: "Datos de la empresa y cuentas bancarias" },
  { id: "cost", label: "Coste", icon: TrendingUp, description: "Comportamiento del comprometido, realizado y capítulos" },
  { id: "approvals", label: "Aprobaciones", icon: FileCheck, description: "Flujos de aprobación para POs y facturas" },
  { id: "permissions", label: "Permisos", icon: Shield, description: "Quién puede realizar cada acción" },
];

// Opciones de comportamiento del presupuesto
const COMMITMENT_TRIGGERS = [
  { value: "on_create", label: "Al enviar a aprobación", description: "Se compromete cuando la PO se envía a aprobación (pendiente)" },
  { value: "on_approve", label: "Al aprobar", description: "Se compromete cuando la PO es aprobada" },
];

// "Al pagar" se elimina: la realización debe ocurrir antes del pago.
// "on_create" es la opción para cuando no hay aprobaciones configuradas.
const ACTUAL_TRIGGERS = [
  { value: "on_create",  label: "Al enviar (inmediato)",  description: "Pasa a realizado en cuanto se crea la factura — úsalo cuando no hay flujo de aprobación", requiresNoApprovals: true },
  { value: "on_approve", label: "Al aprobar factura",     description: "Pasa a realizado cuando la factura es aprobada — requiere pasos de aprobación configurados", requiresApprovals: true },
  { value: "on_account", label: "Al contabilizar",        description: "Pasa a realizado cuando se marca como contabilizada (recomendado)" },
];

const BOX_TRIGGERS = [
  { value: "on_create",  label: "Al enviar (inmediato)",  description: "Pasa a realizado en cuanto se abre el sobre — úsalo cuando no hay flujo de aprobación", requiresNoApprovals: true },
  { value: "on_approve", label: "Al aprobar sobre",       description: "Pasa a realizado cuando el sobre es aprobado — requiere pasos de aprobación configurados", requiresApprovals: true },
  { value: "on_account", label: "Al contabilizar",        description: "Pasa a realizado cuando se marca como contabilizado (recomendado)" },
];

interface CostSettings {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_create" | "on_approve" | "on_account";
  boxActualTrigger: "on_create" | "on_approve" | "on_account";
}

// Configuración específica del proyecto para contabilidad
interface ProjectSettings {
  enableEpisodes: boolean;
  requireEpisodeAssignment: boolean;
}

// Configuración de permisos por defecto
interface PermissionConfig {
  id: string;
  label: string;
  description: string;
  category: "po" | "invoice" | "general";
  defaultRoles: string[];
  allowCustomUsers: boolean;
}

const PERMISSION_CONFIGS: PermissionConfig[] = [
  // PO permissions
  { id: "po_cancel", label: "Anular POs", description: "Anular órdenes de compra aprobadas", category: "po", defaultRoles: ["EP", "PM"], allowCustomUsers: true },
  { id: "po_close", label: "Cerrar POs", description: "Cerrar órdenes de compra completadas", category: "po", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
  { id: "po_reopen", label: "Reabrir POs", description: "Reabrir órdenes de compra cerradas", category: "po", defaultRoles: ["EP", "PM"], allowCustomUsers: true },
  { id: "po_modify", label: "Modificar POs aprobadas", description: "Crear nuevas versiones de POs aprobadas", category: "po", defaultRoles: ["EP", "PM"], allowCustomUsers: true },
  { id: "po_delete_draft", label: "Eliminar borradores de PO", description: "Eliminar POs en estado borrador", category: "po", defaultRoles: ["EP", "PM", "Controller", "PC"], allowCustomUsers: false },
  
  // Invoice permissions
  { id: "invoice_void", label: "Anular facturas", description: "Anular facturas registradas", category: "invoice", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
  { id: "invoice_mark_paid", label: "Marcar como pagada", description: "Cambiar estado de factura a pagada", category: "invoice", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
  { id: "invoice_replace", label: "Sustituir proformas", description: "Subir factura definitiva para sustituir proforma", category: "invoice", defaultRoles: ["EP", "PM", "Controller", "PC"], allowCustomUsers: false },
  { id: "invoice_delete_draft", label: "Eliminar borradores", description: "Eliminar facturas en estado borrador", category: "invoice", defaultRoles: ["EP", "PM", "Controller", "PC"], allowCustomUsers: false },
  
  // General permissions
  { id: "view_all_departments", label: "Ver todos los departamentos", description: "Acceso a documentos de cualquier departamento", category: "general", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
  { id: "export_data", label: "Exportar datos", description: "Descargar informes y exportar a PDF/Excel", category: "general", defaultRoles: ["EP", "PM", "Controller", "PC"], allowCustomUsers: false },
  { id: "manage_suppliers", label: "Gestionar proveedores", description: "Crear, editar y eliminar proveedores", category: "general", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
  { id: "manage_payments", label: "Gestionar previsiones de pago", description: "Crear y gestionar remesas de pago", category: "general", defaultRoles: ["EP", "PM", "Controller"], allowCustomUsers: true },
];

interface PermissionSettings {
  [permissionId: string]: {
    roles: string[];
    users: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AccountingConfigPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState<"pelicula" | "serie" | null>(null);
  const [projectEpisodes, setProjectEpisodes] = useState<number>(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  
  // Sección activa
  const [activeSection, setActiveSection] = useState("company");
  
  // Configuración del proyecto
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
    enableEpisodes: false,
    requireEpisodeAssignment: false,
  });
  
  // Datos de empresa
  const [companyData, setCompanyData] = useState<CompanyData>(emptyCompanyData);
  const [companyForm, setCompanyForm] = useState<CompanyData>(emptyCompanyData);
  const [editingCompany, setEditingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  
  // Cuentas bancarias
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankAccountForm, setBankAccountForm] = useState<Omit<BankAccount, "id">>(emptyBankAccount);
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null);
  const [showBankAccountModal, setShowBankAccountModal] = useState(false);
  const [savingBankAccount, setSavingBankAccount] = useState(false);
  
  // Configuración de coste
  const [costSettings, setCostSettings] = useState<CostSettings>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_account",
    boxActualTrigger: "on_account",
  });
  
  // Tab de aprobaciones (PO vs Invoice)
  const [activeTab, setActiveTab] = useState<"po" | "invoice" | "box">("po");
  const [poApprovals, setPoApprovals] = useState<ApprovalStep[]>([]);
  const [invoiceApprovals, setInvoiceApprovals] = useState<ApprovalStep[]>([]);
  const [boxApprovals, setBoxApprovals] = useState<ApprovalStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  
  // Permisos
  const [permissionSettings, setPermissionSettings] = useState<PermissionSettings>({});
  const [expandedPermissions, setExpandedPermissions] = useState<Set<string>>(new Set());
  
  // Auditoría
  const [auditLog, setAuditLog] = useState<{
    approvals?: { updatedAt: any; updatedBy: string; updatedByName?: string };
    permissions?: { updatedAt: any; updatedBy: string; updatedByName?: string };
  }>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/");
      else setUserId(u.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (userId && id) loadData();
  }, [userId, id]);

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

  const toggleExpanded = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) newExpanded.delete(stepId);
    else newExpanded.add(stepId);
    setExpandedSteps(newExpanded);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
      const userProjectSnap = await getDoc(userProjectRef);
      if (!userProjectSnap.exists()) {
        setErrorMessage("No tienes acceso a este proyecto");
        setLoading(false);
        return;
      }

      const userProjectData = userProjectSnap.data();
      const hasAccountingAccess = userProjectData.permissions?.accounting || false;
      const accountingLevel = userProjectData.accountingAccessLevel;

      const memberRef = doc(db, `projects/${id}/members`, userId!);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role);
      const hasExtendedAccess = accountingLevel === "accounting_extended";

      setHasAccess(hasAccountingAccess && (isEPorPM || hasExtendedAccess));
      if (!hasAccountingAccess || (!isEPorPM && !hasExtendedAccess)) {
        setErrorMessage("No tienes permisos para acceder a la configuración de contabilidad");
        setLoading(false);
        return;
      }

      const projectRef = doc(db, "projects", id as string);
      const projectSnap = await getDoc(projectRef);
      if (projectSnap.exists()) {
        const d = projectSnap.data();
        setProjectName(d.name);
        setDepartments(d.departments || []);
      }

      // Cargar datos de producción (tipo de proyecto y episodios)
      const productionRef = doc(db, `projects/${id}/config/production`);
      const productionSnap = await getDoc(productionRef);
      if (productionSnap.exists()) {
        const prodData = productionSnap.data();
        setProjectType(prodData.projectType || null);
        setProjectEpisodes(prodData.episodes || 0);
      }

      // Cargar configuración del proyecto para contabilidad
      const projectConfigRef = doc(db, `projects/${id}/config/project`);
      const projectConfigSnap = await getDoc(projectConfigRef);
      if (projectConfigSnap.exists()) {
        const data = projectConfigSnap.data();
        setProjectSettings({
          enableEpisodes: data.enableEpisodes || false,
          requireEpisodeAssignment: data.requireEpisodeAssignment || false,
        });
      }

      const membersRef = collection(db, `projects/${id}/members`);
      const membersSnap = await getDocs(membersRef);
      setMembers(
        membersSnap.docs.map((d) => ({
          userId: d.id,
          name: d.data().name || d.data().email,
          email: d.data().email,
          role: d.data().role,
          department: d.data().department,
          position: d.data().position,
        }))
      );

      const approvalConfigRef = doc(db, `projects/${id}/config/approvals`);
      const approvalConfigSnap = await getDoc(approvalConfigRef);
      // Variables locales para poder usarlas en la migración de costSettings más abajo
      let localPoApprovals: ApprovalStep[] = [];
      let localInvoiceApprovals: ApprovalStep[] = [];
      let localBoxApprovals: ApprovalStep[] = [];

      if (approvalConfigSnap.exists()) {
        const c = approvalConfigSnap.data();
        const migrateSteps = (steps: any[]): ApprovalStep[] =>
          steps.map((s) => ({
            ...s,
            hasAmountThreshold: s.hasAmountThreshold || false,
            amountThreshold: s.amountThreshold || undefined,
            amountCondition: s.amountCondition || "above",
            amountThresholdMax: s.amountThresholdMax || undefined,
          }));
        localPoApprovals = migrateSteps(c.poApprovals || []);
        localInvoiceApprovals = migrateSteps(c.invoiceApprovals || []);
        localBoxApprovals = migrateSteps(c.boxApprovals || []);
        setPoApprovals(localPoApprovals);
        setInvoiceApprovals(localInvoiceApprovals);
        setBoxApprovals(localBoxApprovals);
        
        // Guardar info de auditoría
        if (c.updatedAt && c.updatedBy) {
          // Buscar nombre del usuario
          let updatedByName = c.updatedByName;
          if (!updatedByName) {
            const updaterMember = membersSnap.docs.find(d => d.id === c.updatedBy);
            updatedByName = updaterMember?.data()?.name || updaterMember?.data()?.email || "Usuario desconocido";
          }
          setAuditLog(prev => ({
            ...prev,
            approvals: { updatedAt: c.updatedAt, updatedBy: c.updatedBy, updatedByName }
          }));
        }
      } else {
        setPoApprovals([
          { id: "default-po-1", order: 1, approverType: "role", roles: ["PM", "EP"], requireAll: false, hasAmountThreshold: false },
        ]);
        setInvoiceApprovals([
          { id: "default-inv-1", order: 1, approverType: "role", roles: ["Controller", "PM", "EP"], requireAll: false, hasAmountThreshold: false },
        ]);
      }

      // Cargar configuración de permisos
      const permissionsConfigRef = doc(db, `projects/${id}/config/permissions`);
      const permissionsConfigSnap = await getDoc(permissionsConfigRef);
      if (permissionsConfigSnap.exists()) {
        const permData = permissionsConfigSnap.data();
        setPermissionSettings(permData.settings || {});
        
        // Guardar info de auditoría
        if (permData.updatedAt && permData.updatedBy) {
          let updatedByName = permData.updatedByName;
          if (!updatedByName) {
            const updaterMember = membersSnap.docs.find(d => d.id === permData.updatedBy);
            updatedByName = updaterMember?.data()?.name || updaterMember?.data()?.email || "Usuario desconocido";
          }
          setAuditLog(prev => ({
            ...prev,
            permissions: { updatedAt: permData.updatedAt, updatedBy: permData.updatedBy, updatedByName }
          }));
        }
      } else {
        // Inicializar con valores por defecto
        const defaultSettings: PermissionSettings = {};
        PERMISSION_CONFIGS.forEach((config) => {
          defaultSettings[config.id] = {
            roles: [...config.defaultRoles],
            users: [],
          };
        });
        setPermissionSettings(defaultSettings);
      }

      // Cargar datos de empresa
      const companyRef = doc(db, `projects/${id}/config`, "company");
      const companySnap = await getDoc(companyRef);
      if (companySnap.exists()) {
        const data = companySnap.data() as CompanyData;
        setCompanyData(data);
        setCompanyForm(data);
      }

      // Cargar cuentas bancarias
      try {
        const bankAccountsSnap = await getDocs(collection(db, `projects/${id}/config/company/bankAccounts`));
        const accounts = bankAccountsSnap.docs.map(d => ({
          id: d.id,
          ...d.data()
        })) as BankAccount[];
        setBankAccounts(accounts.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)));
      } catch (bankErr) {
        console.log("No bank accounts yet:", bankErr);
        setBankAccounts([]);
      }

      // Cargar configuración de coste
      const costConfigRef = doc(db, `projects/${id}/config/cost`);
      const costConfigSnap = await getDoc(costConfigRef);
      if (costConfigSnap.exists()) {
        const data = costConfigSnap.data();
        // Migrar valores obsoletos y ajustar según aprobaciones disponibles
        let rawInvoice = data.invoiceActualTrigger || "on_account";
        let rawBox     = data.boxActualTrigger     || "on_account";
        let rawPO      = data.poCommitmentTrigger  || "on_approve";
        // "on_paid" eliminado → "on_account"
        if (rawInvoice === "on_paid") rawInvoice = "on_account";
        if (rawBox     === "on_paid") rawBox     = "on_account";
        // "on_approve" sin aprobaciones → "on_create"
        if (rawInvoice === "on_approve" && localInvoiceApprovals.length === 0) rawInvoice = "on_create";
        if (rawBox     === "on_approve" && localBoxApprovals.length     === 0) rawBox     = "on_create";
        if (rawPO      === "on_approve" && localPoApprovals.length      === 0) rawPO      = "on_create";
        setCostSettings({
          poCommitmentTrigger: rawPO as any,
          invoiceActualTrigger: rawInvoice as any,
          boxActualTrigger: rawBox as any,
        });
      }

      setLoading(false);
    } catch (error: any) {
      setErrorMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const addApprovalStep = (type: "po" | "invoice" | "box", withThreshold: boolean = false) => {
    const current = type === "po" ? poApprovals : type === "invoice" ? invoiceApprovals : boxApprovals;
    const newStep: ApprovalStep = {
      id: `step-${Date.now()}`,
      order: current.length + 1,
      approverType: "fixed",
      approvers: [],
      requireAll: false,
      hasAmountThreshold: withThreshold,
      amountThreshold: withThreshold ? 5000 : undefined,
      amountCondition: "above",
    };
    if (type === "po") setPoApprovals([...current, newStep]);
    else if (type === "invoice") setInvoiceApprovals([...current, newStep]);
    else setBoxApprovals([...current, newStep]);
    setExpandedSteps(new Set([...expandedSteps, newStep.id]));
  };

  const removeApprovalStep = (type: "po" | "invoice" | "box", stepId: string) => {
    const current = type === "po" ? poApprovals : type === "invoice" ? invoiceApprovals : boxApprovals;
    const reordered = current.filter((s) => s.id !== stepId).map((s, i) => ({ ...s, order: i + 1 }));
    if (type === "po") setPoApprovals(reordered);
    else if (type === "invoice") setInvoiceApprovals(reordered);
    else setBoxApprovals(reordered);
  };

  const moveStep = (type: "po" | "invoice" | "box", stepId: string, direction: "up" | "down") => {
    const current = type === "po" ? [...poApprovals] : type === "invoice" ? [...invoiceApprovals] : [...boxApprovals];
    const index = current.findIndex((s) => s.id === stepId);
    if ((direction === "up" && index <= 0) || (direction === "down" && index >= current.length - 1)) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    [current[index], current[swapIndex]] = [current[swapIndex], current[index]];
    const reordered = current.map((s, i) => ({ ...s, order: i + 1 }));
    if (type === "po") setPoApprovals(reordered);
    else if (type === "invoice") setInvoiceApprovals(reordered);
    else setBoxApprovals(reordered);
  };

  // Funciones de configuración del proyecto
  const handleSaveProjectSettings = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const dataToSave = {
        ...projectSettings,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      };
      await setDoc(doc(db, `projects/${id}/config`, "project"), dataToSave);
      setSuccessMessage("Configuración del proyecto guardada");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setErrorMessage("Error al guardar configuración del proyecto");
    } finally {
      setSaving(false);
    }
  };

  // Funciones de datos de empresa
  const handleSaveCompany = async () => {
    if (!id) return;
    setSavingCompany(true);
    try {
      const dataToSave = {
        ...companyForm,
        updatedAt: Timestamp.now(),
      };
      await setDoc(doc(db, `projects/${id}/config`, "company"), dataToSave);
      setCompanyData(companyForm);
      setEditingCompany(false);
      setSuccessMessage("Datos fiscales guardados");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setErrorMessage("Error al guardar datos fiscales");
    } finally {
      setSavingCompany(false);
    }
  };

  const handleSaveBankAccount = async () => {
    if (!id || !bankAccountForm.alias || !bankAccountForm.iban) return;
    setSavingBankAccount(true);
    try {
      const dataToSave = {
        alias: bankAccountForm.alias.trim(),
        fiscalName: bankAccountForm.fiscalName.trim(),
        taxId: bankAccountForm.taxId.trim().toUpperCase(),
        iban: bankAccountForm.iban.replace(/\s/g, ""),
        bic: bankAccountForm.bic?.trim().toUpperCase() || "",
        isDefault: bankAccountForm.isDefault || false,
      };

      if (dataToSave.isDefault) {
        for (const acc of bankAccounts) {
          if (acc.isDefault && acc.id !== editingBankAccount?.id) {
            await updateDoc(doc(db, `projects/${id}/config/company/bankAccounts`, acc.id), { isDefault: false });
          }
        }
      }

      if (editingBankAccount) {
        await updateDoc(doc(db, `projects/${id}/config/company/bankAccounts`, editingBankAccount.id), dataToSave);
        setSuccessMessage("Cuenta actualizada");
      } else {
        await addDoc(collection(db, `projects/${id}/config/company/bankAccounts`), dataToSave);
        setSuccessMessage("Cuenta añadida");
      }

      const bankAccountsSnap = await getDocs(collection(db, `projects/${id}/config/company/bankAccounts`));
      const accounts = bankAccountsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
      setBankAccounts(accounts.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)));

      setShowBankAccountModal(false);
      setEditingBankAccount(null);
      setBankAccountForm(emptyBankAccount);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setErrorMessage("Error al guardar cuenta");
    } finally {
      setSavingBankAccount(false);
    }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDeleteBankAccount = async (accountId: string) => {
    if (!id) return;
    openConfirm(
      "Eliminar cuenta bancaria",
      "¿Estás seguro de que quieres eliminar esta cuenta bancaria? Esta acción no se puede deshacer.",
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${id}/config/company/bankAccounts`, accountId));
          setBankAccounts(bankAccounts.filter(a => a.id !== accountId));
          setSuccessMessage("Cuenta eliminada");
          setTimeout(() => setSuccessMessage(""), 3000);
        } catch {
          setErrorMessage("Error al eliminar");
        }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const openEditBankAccount = (account: BankAccount) => {
    setEditingBankAccount(account);
    setBankAccountForm({
      alias: account.alias,
      fiscalName: account.fiscalName,
      taxId: account.taxId,
      iban: formatIBAN(account.iban),
      bic: account.bic || "",
      isDefault: account.isDefault || false,
    });
    setShowBankAccountModal(true);
  };

  const openNewBankAccount = () => {
    setEditingBankAccount(null);
    setBankAccountForm({
      ...emptyBankAccount,
      fiscalName: companyData.fiscalName,
      taxId: companyData.taxId,
      isDefault: bankAccounts.length === 0,
    });
    setShowBankAccountModal(true);
  };

  const handleBankAccountIbanChange = (value: string) => {
    let clean = value.replace(/\s/g, "").toUpperCase();
    const withoutPrefix = clean.replace(/^ES\d{0,2}/, "");
    if (/^\d{20}$/.test(withoutPrefix)) {
      const fullIban = calculateSpanishIBANCheckDigits(withoutPrefix);
      if (fullIban) {
        setBankAccountForm({ ...bankAccountForm, iban: formatIBAN(fullIban) });
        return;
      }
    }
    if (/^\d/.test(clean)) clean = "ES" + clean;
    if (clean.length > 24) clean = clean.slice(0, 24);
    setBankAccountForm({ ...bankAccountForm, iban: formatIBAN(clean) });
  };

  const updateStep = (type: "po" | "invoice" | "box", stepId: string, field: keyof ApprovalStep, value: any) => {
    const current = type === "po" ? [...poApprovals] : type === "invoice" ? [...invoiceApprovals] : [...boxApprovals];
    const idx = current.findIndex((s) => s.id === stepId);
    if (idx === -1) return;
    current[idx] = { ...current[idx], [field]: value };
    if (field === "approverType") {
      current[idx].approvers = [];
      current[idx].roles = [];
      current[idx].department = undefined;
    }
    if (field === "hasAmountThreshold" && value === false) {
      current[idx].amountThreshold = undefined;
      current[idx].amountCondition = "above";
      current[idx].amountThresholdMax = undefined;
    }
    if (field === "amountCondition" && value !== "between") {
      current[idx].amountThresholdMax = undefined;
    }
    if (type === "po") setPoApprovals(current);
    else if (type === "invoice") setInvoiceApprovals(current);
    else setBoxApprovals(current);
  };

  const toggleApprover = (type: "po" | "invoice" | "box", stepId: string, approverId: string) => {
    const current = type === "po" ? [...poApprovals] : type === "invoice" ? [...invoiceApprovals] : [...boxApprovals];
    const idx = current.findIndex((s) => s.id === stepId);
    if (idx === -1) return;
    const approvers = current[idx].approvers || [];
    current[idx] = {
      ...current[idx],
      approvers: approvers.includes(approverId)
        ? approvers.filter((i) => i !== approverId)
        : [...approvers, approverId],
    };
    if (type === "po") setPoApprovals(current);
    else if (type === "invoice") setInvoiceApprovals(current);
    else setBoxApprovals(current);
  };

  const toggleRole = (type: "po" | "invoice" | "box", stepId: string, role: string) => {
    const current = type === "po" ? [...poApprovals] : type === "invoice" ? [...invoiceApprovals] : [...boxApprovals];
    const idx = current.findIndex((s) => s.id === stepId);
    if (idx === -1) return;
    const roles = current[idx].roles || [];
    current[idx] = {
      ...current[idx],
      roles: roles.includes(role) ? roles.filter((r) => r !== role) : [...roles, role],
    };
    if (type === "po") setPoApprovals(current);
    else if (type === "invoice") setInvoiceApprovals(current);
    else setBoxApprovals(current);
  };

  const cleanApprovalSteps = (steps: ApprovalStep[]): any[] =>
    steps.map((s) => {
      const clean: any = {
        id: s.id,
        order: s.order,
        approverType: s.approverType,
        requireAll: s.requireAll,
        hasAmountThreshold: s.hasAmountThreshold,
      };
      if (s.approverType === "fixed") {
        clean.approvers = s.approvers || [];
        // Guardar también los nombres para mostrar en el historial
        clean.approverNames = (s.approvers || []).map(uid => {
          const member = members.find(m => m.userId === uid);
          return member?.name || member?.email || uid;
        });
      }
      if (s.approverType === "role") clean.roles = s.roles || [];
      if ((s.approverType === "hod" || s.approverType === "coordinator") && s.department)
        clean.department = s.department;
      if (s.hasAmountThreshold) {
        clean.amountThreshold = s.amountThreshold;
        clean.amountCondition = s.amountCondition;
        if (s.amountCondition === "between") clean.amountThresholdMax = s.amountThresholdMax;
      }
      return clean;
    });

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const currentUserName = members.find(m => m.userId === userId)?.name || "Usuario";
      const now = Timestamp.now();
      
      // Guardar aprobaciones
      await setDoc(doc(db, `projects/${id}/config/approvals`), {
        poApprovals: cleanApprovalSteps(poApprovals),
        invoiceApprovals: cleanApprovalSteps(invoiceApprovals),
        boxApprovals: cleanApprovalSteps(boxApprovals),
        updatedAt: now,
        updatedBy: userId,
        updatedByName: currentUserName,
      });
      
      // Guardar permisos
      await setDoc(doc(db, `projects/${id}/config/permissions`), {
        settings: permissionSettings,
        updatedAt: now,
        updatedBy: userId,
        updatedByName: currentUserName,
      });
      
      // Guardar configuración de coste
      await setDoc(doc(db, `projects/${id}/config/cost`), {
        ...costSettings,
        updatedAt: now,
        updatedBy: userId,
        updatedByName: currentUserName,
      });
      
      // Actualizar auditoría local
      setAuditLog({
        approvals: { updatedAt: now, updatedBy: userId!, updatedByName: currentUserName },
        permissions: { updatedAt: now, updatedBy: userId!, updatedByName: currentUserName },
      });
      
      setSuccessMessage("Configuración guardada");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (e: any) {
      setErrorMessage(`Error: ${e.message}`);
      setTimeout(() => setErrorMessage(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  const getMembersByRole = (role: string) => members.filter((m) => m.role === role);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

  const formatRelativeDate = (timestamp: any): string => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return "hace un momento";
    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24) return `hace ${diffHours}h`;
    if (diffDays === 1) return "ayer";
    if (diffDays < 7) return `hace ${diffDays} días`;
    return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  };

  const getStepSummary = (step: ApprovalStep): string => {
    let base = "";
    if (step.approverType === "role" && step.roles?.length) base = step.roles.join(", ");
    else if (step.approverType === "fixed" && step.approvers?.length) {
      // Mostrar nombres de los usuarios seleccionados
      const names = step.approvers.map(uid => {
        const member = members.find(m => m.userId === uid);
        return member?.name || member?.email || "Usuario";
      });
      if (names.length <= 2) {
        base = names.join(", ");
      } else {
        base = `${names[0]}, ${names[1]} +${names.length - 2}`;
      }
    }
    else if (step.approverType === "hod") base = step.department ? `HOD de ${step.department}` : "HOD del solicitante";
    else if (step.approverType === "coordinator")
      base = step.department ? `Coord. de ${step.department}` : "Coord. del solicitante";
    else base = "Sin configurar";

    if (step.hasAmountThreshold && step.amountThreshold) {
      if (step.amountCondition === "above") return `${base} · >${formatCurrency(step.amountThreshold)}€`;
      if (step.amountCondition === "below") return `${base} · <${formatCurrency(step.amountThreshold)}€`;
      if (step.amountCondition === "between" && step.amountThresholdMax)
        return `${base} · ${formatCurrency(step.amountThreshold)}-${formatCurrency(step.amountThresholdMax)}€`;
    }
    return base;
  };

  const getThresholdBadge = (step: ApprovalStep) => {
    if (!step.hasAmountThreshold || !step.amountThreshold) return null;
    
    let text = "";
    if (step.amountCondition === "above") text = `> ${formatCurrency(step.amountThreshold)} €`;
    else if (step.amountCondition === "below") text = `< ${formatCurrency(step.amountThreshold)} €`;
    else if (step.amountCondition === "between" && step.amountThresholdMax)
      text = `${formatCurrency(step.amountThreshold)} - ${formatCurrency(step.amountThresholdMax)} €`;
    
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg font-medium">
        <DollarSign size={10} />
        {text}
      </span>
    );
  };

  const renderApprovalStep = (step: ApprovalStep, type: "po" | "invoice" | "box", index: number) => {
    const currentSteps = type === "po" ? poApprovals : type === "invoice" ? invoiceApprovals : boxApprovals;
    const isExpanded = expandedSteps.has(step.id);
    const Icon = APPROVER_TYPE_ICONS[step.approverType] || Users;

    return (
      <div
        key={step.id}
        className={`border rounded-2xl overflow-hidden transition-all ${
          isExpanded ? "border-slate-300 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
        }`}
      >
        {/* Header colapsado */}
        <div
          className="flex items-center gap-3 px-5 py-4 cursor-pointer"
          onClick={() => toggleExpanded(step.id)}
        >
          <button className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>

          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
            step.hasAmountThreshold ? "bg-amber-500 text-white" : "bg-slate-900 text-white"
          }`}>
            {step.order}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Icon size={14} className="text-slate-500" />
              <span className="text-sm font-medium text-slate-900">
                {APPROVER_TYPE_LABELS[step.approverType]}
              </span>
              {getThresholdBadge(step)}
              <span className="text-slate-300">•</span>
              <span className="text-sm text-slate-500 truncate">{getStepSummary(step)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => moveStep(type, step.id, "up")}
              disabled={index === 0}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={() => moveStep(type, step.id, "down")}
              disabled={index === currentSteps.length - 1}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"
            >
              <ArrowDown size={14} />
            </button>
            <button
              onClick={() => removeApprovalStep(type, step.id)}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Contenido expandido */}
        {isExpanded && (
          <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-5">
            {/* Umbral por importe */}
            <div className={`p-4 rounded-xl border-2 transition-all ${
              step.hasAmountThreshold ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
            }`}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.hasAmountThreshold}
                  onChange={(e) => updateStep(type, step.id, "hasAmountThreshold", e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-amber-600 border-slate-300 rounded focus:ring-amber-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={16} className={step.hasAmountThreshold ? "text-amber-600" : "text-slate-400"} />
                    <span className={`text-sm font-medium ${step.hasAmountThreshold ? "text-amber-800" : "text-slate-700"}`}>
                      Activar solo por importe
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Este nivel solo se activará cuando el documento cumpla la condición de importe
                  </p>
                </div>
              </label>

              {step.hasAmountThreshold && (
                <div className="mt-4 space-y-4 pl-7">
                  {/* Condición */}
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                      Condición
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.entries(AMOUNT_CONDITIONS) as [string, { label: string; description: string }][]).map(
                        ([key, { label }]) => (
                          <button
                            key={key}
                            onClick={() => updateStep(type, step.id, "amountCondition", key)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                              step.amountCondition === key
                                ? "border-amber-500 bg-amber-100 text-amber-800"
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                            }`}
                          >
                            {label}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Importe */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                        {step.amountCondition === "between" ? "Importe mínimo" : "Importe"}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={step.amountThreshold || ""}
                          onChange={(e) => updateStep(type, step.id, "amountThreshold", parseFloat(e.target.value) || 0)}
                          placeholder="5000"
                          className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-sm"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
                      </div>
                    </div>

                    {step.amountCondition === "between" && (
                      <div>
                        <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                          Importe máximo
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            value={step.amountThresholdMax || ""}
                            onChange={(e) => updateStep(type, step.id, "amountThresholdMax", parseFloat(e.target.value) || 0)}
                            placeholder="10000"
                            className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white text-sm"
                          />
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Presets */}
                  <div>
                    <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                      Importes predefinidos
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_THRESHOLDS.map((amount) => (
                        <button
                          key={amount}
                          onClick={() => updateStep(type, step.id, "amountThreshold", amount)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            step.amountThreshold === amount
                              ? "bg-amber-500 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          {formatCurrency(amount)} €
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="p-3 bg-amber-100 rounded-lg border border-amber-200">
                    <div className="flex items-start gap-2">
                      <Zap size={14} className="text-amber-600 mt-0.5" />
                      <p className="text-xs text-amber-800">
                        {step.amountCondition === "above" && step.amountThreshold && (
                          <>Este nivel se activará para {type === "po" ? "POs" : "facturas"} con importe <strong>superior a {formatCurrency(step.amountThreshold)} €</strong></>
                        )}
                        {step.amountCondition === "below" && step.amountThreshold && (
                          <>Este nivel se activará para {type === "po" ? "POs" : "facturas"} con importe <strong>inferior a {formatCurrency(step.amountThreshold)} €</strong></>
                        )}
                        {step.amountCondition === "between" && step.amountThreshold && step.amountThresholdMax && (
                          <>Este nivel se activará para {type === "po" ? "POs" : "facturas"} con importe <strong>entre {formatCurrency(step.amountThreshold)} € y {formatCurrency(step.amountThresholdMax)} €</strong></>
                        )}
                        {!step.amountThreshold && "Configura un importe para activar este nivel"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tipo de aprobador */}
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                Tipo de aprobador
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(["fixed", "role", "hod", "coordinator"] as const).map((t) => {
                  const TIcon = APPROVER_TYPE_ICONS[t];
                  return (
                    <button
                      key={t}
                      onClick={() => updateStep(type, step.id, "approverType", t)}
                      className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-left ${
                        step.approverType === t
                          ? "border-slate-900 bg-slate-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <TIcon
                        size={16}
                        className={step.approverType === t ? "text-slate-900" : "text-slate-400"}
                      />
                      <span
                        className={`text-sm ${
                          step.approverType === t ? "font-medium text-slate-900" : "text-slate-600"
                        }`}
                      >
                        {APPROVER_TYPE_LABELS[t]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Por rol */}
            {step.approverType === "role" && (
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Roles que pueden aprobar
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {PROJECT_ROLES.map((role) => {
                    const count = getMembersByRole(role).length;
                    return (
                      <label
                        key={role}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                          step.roles?.includes(role)
                            ? "border-slate-900 bg-slate-50"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={step.roles?.includes(role) || false}
                          onChange={() => toggleRole(type, step.id, role)}
                          className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-slate-500"
                        />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{role}</p>
                          <p className="text-xs text-slate-500">
                            {count} usuario{count !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {step.roles && step.roles.length > 0 && (
                  <div className="mt-3 bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 mb-2">Usuarios que podrán aprobar:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {step.roles.flatMap((r) =>
                        getMembersByRole(r).map((m) => (
                          <span
                            key={m.userId}
                            className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded-lg"
                          >
                            {m.name} ({r})
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Usuarios específicos */}
            {step.approverType === "fixed" && (
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Seleccionar aprobadores
                </label>
                <div className="border border-slate-200 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1 bg-slate-50">
                  {members.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">No hay miembros</p>
                  ) : (
                    members.map((m) => (
                      <label
                        key={m.userId}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all ${
                          step.approvers?.includes(m.userId)
                            ? "bg-white border border-slate-200"
                            : "hover:bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={step.approvers?.includes(m.userId) || false}
                          onChange={() => toggleApprover(type, step.id, m.userId)}
                          className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-slate-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{m.name}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {m.role || m.position || "Sin rol"}
                          </p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* HOD / Coordinator */}
            {(step.approverType === "hod" || step.approverType === "coordinator") && (
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Departamento
                </label>
                <div className="relative custom-dropdown">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === `dept-${step.id}` ? null : `dept-${step.id}`)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                  >
                    <span className="text-slate-900 truncate">{step.department || "Departamento del solicitante"}</span>
                    <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `dept-${step.id}` ? "rotate-180" : ""}`} />
                  </button>
                  {openDropdown === `dept-${step.id}` && (
                    <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => { updateStep(type, step.id, "department", ""); setOpenDropdown(null); }}
                        className={`w-full px-4 py-2 text-left text-sm transition-colors ${!step.department ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                      >
                        Departamento del solicitante
                      </button>
                      {departments.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => { updateStep(type, step.id, "department", d); setOpenDropdown(null); }}
                          className={`w-full px-4 py-2 text-left text-sm transition-colors ${step.department === d ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {step.department
                    ? `El ${step.approverType === "hod" ? "HOD" : "Coordinator"} de "${step.department}" aprobará`
                    : `Se asignará automáticamente según el departamento del solicitante`}
                </p>
              </div>
            )}

            {/* Require All */}
            {(step.approverType === "fixed" || step.approverType === "role") && (
              <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={step.requireAll}
                  onChange={(e) => updateStep(type, step.id, "requireAll", e.target.checked)}
                  className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-slate-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Requiere aprobación de todos</p>
                  <p className="text-xs text-slate-500">
                    {step.requireAll
                      ? "Todos deben aprobar para pasar al siguiente nivel"
                      : "Con una aprobación es suficiente"}
                  </p>
                </div>
              </label>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render de la sección de datos de empresa
  const renderCompanySection = () => (
    <div className="space-y-6">
      {/* Datos fiscales */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Datos fiscales de la empresa</h2>
          </div>
          {!editingCompany && companyData.fiscalName && (
            <button
              onClick={() => setEditingCompany(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <Edit2 size={14} />
              Editar
            </button>
          )}
        </div>

        <div className="p-6">
          {!editingCompany ? (
            companyData.fiscalName ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Razón social</p>
                    <p className="text-base font-medium text-slate-900">{companyData.fiscalName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">NIF/CIF</p>
                    <p className="text-base font-mono text-slate-900">{companyData.taxId}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Dirección</p>
                  <p className="text-sm text-slate-700">{companyData.address}</p>
                  <p className="text-sm text-slate-500">{companyData.postalCode} {companyData.city}, {companyData.province}</p>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                  <Building2 size={20} className="text-slate-400" />
                </div>
                <p className="text-sm text-slate-500 mb-4">No hay datos fiscales configurados</p>
                <button
                  onClick={() => setEditingCompany(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
                >
                  <Plus size={14} />
                  Añadir datos fiscales
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Razón social *</label>
                  <input
                    type="text"
                    value={companyForm.fiscalName}
                    onChange={(e) => setCompanyForm({ ...companyForm, fiscalName: e.target.value })}
                    placeholder="Nombre de la empresa"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">NIF/CIF *</label>
                  <input
                    type="text"
                    value={companyForm.taxId}
                    onChange={(e) => setCompanyForm({ ...companyForm, taxId: e.target.value.toUpperCase() })}
                    placeholder="B12345678"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Dirección *</label>
                <input
                  type="text"
                  value={companyForm.address}
                  onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                  placeholder="Calle, número, piso"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">C.P. *</label>
                  <input
                    type="text"
                    value={companyForm.postalCode}
                    onChange={(e) => setCompanyForm({ ...companyForm, postalCode: e.target.value })}
                    placeholder="28001"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Ciudad *</label>
                  <input
                    type="text"
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                    placeholder="Madrid"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Provincia</label>
                  <input
                    type="text"
                    value={companyForm.province}
                    onChange={(e) => setCompanyForm({ ...companyForm, province: e.target.value })}
                    placeholder="Madrid"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">País</label>
                  <input
                    type="text"
                    value={companyForm.country}
                    onChange={(e) => setCompanyForm({ ...companyForm, country: e.target.value })}
                    placeholder="España"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSaveCompany}
                  disabled={savingCompany || !companyForm.fiscalName || !companyForm.taxId || !companyForm.address || !companyForm.postalCode || !companyForm.city}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <Save size={16} />
                  {savingCompany ? "Guardando..." : "Guardar"}
                </button>
                <button
                  onClick={() => { setEditingCompany(false); setCompanyForm(companyData); }}
                  className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cuentas bancarias */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Landmark size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Cuentas bancarias</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{bankAccounts.length}</span>
          </div>
          <button
            onClick={openNewBankAccount}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <Plus size={14} />
            Añadir
          </button>
        </div>

        <div className="p-6">
          {bankAccounts.length > 0 ? (
            <div className="space-y-3">
              {bankAccounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-200">
                      <CreditCard size={18} className="text-slate-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900">{account.alias}</p>
                        {account.isDefault && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-lg">
                            <Star size={10} />
                            Principal
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{account.fiscalName} · {account.taxId}</p>
                      <p className="text-sm font-mono text-slate-600 mt-1">{formatIBAN(account.iban)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditBankAccount(account)}
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteBankAccount(account.id)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Landmark size={20} className="text-slate-400" />
              </div>
              <p className="text-sm text-slate-500 mb-4">No hay cuentas bancarias configuradas</p>
              <button
                onClick={openNewBankAccount}
                className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                <Plus size={14} />
                Añadir cuenta
              </button>
            </div>
          )}
          <p className="text-xs text-slate-400 mt-4">
            Estas cuentas se usan para generar ficheros de remesa SEPA en la sección de Pagos
          </p>
        </div>
      </div>
    </div>
  );

  // Render de la sección de coste
  const renderCostSection = () => (
    <div className="space-y-6">
      {/* Comprometido - POs */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Comprometido (POs)</h2>
          <p className="text-sm text-slate-500 mt-1">Define cuándo se suma el importe al presupuesto comprometido</p>
        </div>

        <div className="p-6">
          <div className="space-y-3">
            {COMMITMENT_TRIGGERS.map((trigger) => {
              const needsApprovals = trigger.value === "on_approve";
              const hasApprovals = poApprovals.length > 0;
              const isDisabled = needsApprovals && !hasApprovals;
              const isSelected = costSettings.poCommitmentTrigger === trigger.value;
              return (
                <label
                  key={trigger.value}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
                    isDisabled
                      ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                      : isSelected
                      ? "border-slate-900 bg-slate-50 cursor-pointer"
                      : "border-slate-200 hover:border-slate-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="poCommitmentTrigger"
                    value={trigger.value}
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={(e) => !isDisabled && setCostSettings({ ...costSettings, poCommitmentTrigger: e.target.value as any })}
                    className="mt-1 w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`font-medium ${isDisabled ? "text-slate-400" : "text-slate-900"}`}>{trigger.label}</p>
                      {isDisabled && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Sin aprobaciones configuradas</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">{trigger.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
          {costSettings.poCommitmentTrigger === "on_approve" && poApprovals.length === 0 && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertCircle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">No hay pasos de aprobación configurados para POs. Se usará <strong>Al enviar</strong> hasta que se configuren aprobaciones.</p>
            </div>
          )}
        </div>
      </div>

      {/* Realizado - Facturas */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Realizado (Facturas)</h2>
          <p className="text-sm text-slate-500 mt-1">Define cuándo el importe pasa de comprometido a realizado</p>
        </div>

        <div className="p-6">
          <div className="space-y-3">
            {ACTUAL_TRIGGERS.filter((trigger) => {
              if ((trigger as any).requiresNoApprovals) return invoiceApprovals.length === 0;
              if ((trigger as any).requiresApprovals)   return invoiceApprovals.length > 0;
              return true;
            }).map((trigger) => {
              const isDisabled = trigger.value === "on_approve" && invoiceApprovals.length === 0;
              const isSelected = costSettings.invoiceActualTrigger === trigger.value;
              return (
                <label
                  key={trigger.value}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
                    isDisabled
                      ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                      : isSelected
                      ? "border-slate-900 bg-slate-50 cursor-pointer"
                      : "border-slate-200 hover:border-slate-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="invoiceActualTrigger"
                    value={trigger.value}
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={(e) => !isDisabled && setCostSettings({ ...costSettings, invoiceActualTrigger: e.target.value as any })}
                    className="mt-1 w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-500"
                  />
                  <div className="flex-1">
                    <p className={`font-medium ${isDisabled ? "text-slate-400" : "text-slate-900"}`}>{trigger.label}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{trigger.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Realizado - BOX */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Realizado (BOX)</h2>
          <p className="text-sm text-slate-500 mt-1">Define cuándo los gastos de tarjeta y transferencia pasan a realizado</p>
        </div>

        <div className="p-6">
          <div className="space-y-3">
            {BOX_TRIGGERS.filter((trigger) => {
              if ((trigger as any).requiresNoApprovals) return boxApprovals.length === 0;
              if ((trigger as any).requiresApprovals)   return boxApprovals.length > 0;
              return true;
            }).map((trigger) => {
              const isDisabled = trigger.value === "on_approve" && boxApprovals.length === 0;
              const isSelected = costSettings.boxActualTrigger === trigger.value;
              return (
                <label
                  key={trigger.value}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
                    isDisabled
                      ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                      : isSelected
                      ? "border-slate-900 bg-slate-50 cursor-pointer"
                      : "border-slate-200 hover:border-slate-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="boxActualTrigger"
                    value={trigger.value}
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={(e) => !isDisabled && setCostSettings({ ...costSettings, boxActualTrigger: e.target.value as any })}
                    className="mt-1 w-4 h-4 text-slate-900 border-slate-300 focus:ring-slate-500"
                  />
                  <div className="flex-1">
                    <p className={`font-medium ${isDisabled ? "text-slate-400" : "text-slate-900"}`}>{trigger.label}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{trigger.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Asignación por capítulos - Solo para series */}
      {projectType === "serie" && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
            <Layers size={18} className="text-violet-500" />
            <div>
              <h2 className="font-semibold text-slate-900">Asignación por capítulos</h2>
              <p className="text-sm text-slate-500">{projectEpisodes} capítulos configurados</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <label className="flex items-center justify-between p-4 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
              <div>
                <p className="text-sm font-medium text-slate-900">Habilitar asignación a capítulos</p>
                <p className="text-xs text-slate-500">Permite asignar POs y facturas a capítulos específicos de la serie</p>
              </div>
              <input
                type="checkbox"
                checked={projectSettings.enableEpisodes}
                onChange={(e) => setProjectSettings({ ...projectSettings, enableEpisodes: e.target.checked })}
                className="w-5 h-5 text-slate-900 border-slate-300 rounded focus:ring-slate-500"
              />
            </label>
            
            {projectSettings.enableEpisodes && (
              <label className="flex items-center justify-between p-4 bg-amber-50 rounded-xl cursor-pointer border border-amber-200">
                <div>
                  <p className="text-sm font-medium text-amber-900">Requerir asignación obligatoria</p>
                  <p className="text-xs text-amber-700">No se podrán crear POs o facturas sin asignar un capítulo</p>
                </div>
                <input
                  type="checkbox"
                  checked={projectSettings.requireEpisodeAssignment}
                  onChange={(e) => setProjectSettings({ ...projectSettings, requireEpisodeAssignment: e.target.checked })}
                  className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                />
              </label>
            )}
          </div>
          
          {/* Botón guardar */}
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end">
            <button
              onClick={handleSaveProjectSettings}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? "Guardando..." : "Guardar capítulos"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Render de la sección de aprobaciones
  const renderApprovalsSection = () => (
    <div className="space-y-6">
      {/* Tabs PO/Invoice/BOX */}
      <div className="flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("po")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "po"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileText size={16} />
          Órdenes de compra
          {poApprovals.length > 0 && (
            <span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600">
              {poApprovals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("invoice")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "invoice"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Receipt size={16} />
          Facturas
          {invoiceApprovals.length > 0 && (
            <span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600">
              {invoiceApprovals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("box")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "box"
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Package size={16} />
          BOX
          {boxApprovals.length > 0 && (
            <span className="px-2 py-0.5 rounded-lg text-xs bg-slate-100 text-slate-600">
              {boxApprovals.length}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3">
        {activeTab === "po" ? (
          <>
            {poApprovals.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                <AlertCircle size={28} className="text-amber-600 mx-auto mb-3" />
                <p className="text-amber-800 font-medium">Sin niveles de aprobación</p>
                <p className="text-amber-700 text-sm mt-1">Las POs se aprobarán automáticamente</p>
              </div>
            ) : (
              poApprovals.map((step, i) => renderApprovalStep(step, "po", i))
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => addApprovalStep("po", false)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 rounded-2xl hover:border-slate-400 hover:bg-slate-50 text-slate-500 hover:text-slate-700 transition-colors text-sm"
              >
                <Plus size={18} />
                Añadir nivel de aprobación
              </button>
              <button
                onClick={() => addApprovalStep("po", true)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-amber-300 rounded-2xl hover:border-amber-400 hover:bg-amber-50 text-amber-600 hover:text-amber-700 transition-colors text-sm"
              >
                <DollarSign size={18} />
                Añadir nivel por importe
              </button>
            </div>
          </>
        ) : activeTab === "invoice" ? (
          <>
            {invoiceApprovals.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                <AlertCircle size={28} className="text-amber-600 mx-auto mb-3" />
                <p className="text-amber-800 font-medium">Sin niveles de aprobación</p>
                <p className="text-amber-700 text-sm mt-1">Las facturas se aprobarán automáticamente</p>
              </div>
            ) : (
              invoiceApprovals.map((step, i) => renderApprovalStep(step, "invoice", i))
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => addApprovalStep("invoice", false)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 rounded-2xl hover:border-slate-400 hover:bg-slate-50 text-slate-500 hover:text-slate-700 transition-colors text-sm"
              >
                <Plus size={18} />
                Añadir nivel de aprobación
              </button>
              <button
                onClick={() => addApprovalStep("invoice", true)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-amber-300 rounded-2xl hover:border-amber-400 hover:bg-amber-50 text-amber-600 hover:text-amber-700 transition-colors text-sm"
              >
                <DollarSign size={18} />
                Añadir nivel por importe
              </button>
            </div>
          </>
        ) : (
          <>
            {boxApprovals.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                <AlertCircle size={28} className="text-amber-600 mx-auto mb-3" />
                <p className="text-amber-800 font-medium">Sin niveles de aprobación</p>
                <p className="text-amber-700 text-sm mt-1">Los sobres se cerrarán sin aprobación</p>
              </div>
            ) : (
              boxApprovals.map((step, i) => renderApprovalStep(step, "box", i))
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => addApprovalStep("box", false)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-slate-300 rounded-2xl hover:border-slate-400 hover:bg-slate-50 text-slate-500 hover:text-slate-700 transition-colors text-sm"
              >
                <Plus size={18} />
                Añadir nivel de aprobación
              </button>
              <button
                onClick={() => addApprovalStep("box", true)}
                className="flex items-center justify-center gap-2 px-4 py-4 border-2 border-dashed border-amber-300 rounded-2xl hover:border-amber-400 hover:bg-amber-50 text-amber-600 hover:text-amber-700 transition-colors text-sm"
              >
                <DollarSign size={18} />
                Añadir nivel por importe
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Funciones para permisos
  const togglePermissionRole = (permissionId: string, role: string) => {
    setPermissionSettings((prev) => {
      const current = prev[permissionId] || { roles: [], users: [] };
      const roles = current.roles.includes(role)
        ? current.roles.filter((r) => r !== role)
        : [...current.roles, role];
      return { ...prev, [permissionId]: { ...current, roles } };
    });
  };

  const togglePermissionUser = (permissionId: string, usrId: string) => {
    setPermissionSettings((prev) => {
      const current = prev[permissionId] || { roles: [], users: [] };
      const users = current.users.includes(usrId)
        ? current.users.filter((u) => u !== usrId)
        : [...current.users, usrId];
      return { ...prev, [permissionId]: { ...current, users } };
    });
  };

  const resetPermissionToDefault = (permissionId: string) => {
    const config = PERMISSION_CONFIGS.find((c) => c.id === permissionId);
    if (!config) return;
    setPermissionSettings((prev) => ({
      ...prev,
      [permissionId]: { roles: [...config.defaultRoles], users: [] },
    }));
  };

  const toggleExpandedPermission = (permissionId: string) => {
    setExpandedPermissions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(permissionId)) newSet.delete(permissionId);
      else newSet.add(permissionId);
      return newSet;
    });
  };

  const getPermissionSummary = (permissionId: string): string => {
    const setting = permissionSettings[permissionId];
    if (!setting) return "Sin configurar";
    
    const parts: string[] = [];
    if (setting.roles.length > 0) {
      parts.push(setting.roles.join(", "));
    }
    if (setting.users.length > 0) {
      parts.push(`+${setting.users.length} usuario${setting.users.length > 1 ? "s" : ""}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "Ninguno";
  };

  // Render de la sección de permisos
  const renderPermissionsSection = () => {
    const poPermissions = PERMISSION_CONFIGS.filter((p) => p.category === "po");
    const invoicePermissions = PERMISSION_CONFIGS.filter((p) => p.category === "invoice");
    const generalPermissions = PERMISSION_CONFIGS.filter((p) => p.category === "general");

    const renderPermissionItem = (config: PermissionConfig) => {
      const setting = permissionSettings[config.id] || { roles: [], users: [] };
      const isExpanded = expandedPermissions.has(config.id);
      const isDefault = JSON.stringify(setting.roles.sort()) === JSON.stringify([...config.defaultRoles].sort()) && setting.users.length === 0;

      return (
        <div
          key={config.id}
          className={`border rounded-xl overflow-hidden transition-all ${
            isExpanded ? "border-slate-300 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div
            className="flex items-center gap-3 px-4 py-3 cursor-pointer"
            onClick={() => toggleExpandedPermission(config.id)}
          >
            <button className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{config.label}</span>
                {isDefault && (
                  <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Por defecto</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{getPermissionSummary(config.id)}</p>
            </div>
          </div>

          {isExpanded && (
            <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-4">
              <p className="text-xs text-slate-500">{config.description}</p>

              {/* Roles */}
              <div>
                <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                  Roles con este permiso
                </label>
                <div className="flex flex-wrap gap-2">
                  {PROJECT_ROLES.map((role) => {
                    const isSelected = setting.roles.includes(role);
                    const count = getMembersByRole(role).length;
                    return (
                      <button
                        key={role}
                        onClick={() => togglePermissionRole(config.id, role)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                          isSelected
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {role}
                        <span className={`ml-1.5 text-xs ${isSelected ? "text-slate-300" : "text-slate-400"}`}>
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Usuarios adicionales */}
              {config.allowCustomUsers && (
                <div>
                  <label className="block text-xs text-slate-500 uppercase tracking-wider mb-2">
                    Usuarios adicionales (sin el rol requerido)
                  </label>
                  <div className="border border-slate-200 rounded-xl p-2 max-h-36 overflow-y-auto space-y-1 bg-slate-50">
                    {members
                      .filter((m) => !setting.roles.includes(m.role || ""))
                      .map((m) => (
                        <label
                          key={m.userId}
                          className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${
                            setting.users.includes(m.userId) ? "bg-white border border-slate-200" : "hover:bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={setting.users.includes(m.userId)}
                            onChange={() => togglePermissionUser(config.id, m.userId)}
                            className="w-4 h-4 text-slate-900 border-slate-300 rounded focus:ring-slate-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">{m.name}</p>
                            <p className="text-xs text-slate-500">{m.role || "Sin rol"}</p>
                          </div>
                        </label>
                      ))}
                    {members.filter((m) => !setting.roles.includes(m.role || "")).length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-3">
                        Todos los usuarios ya tienen permiso por su rol
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Botón restaurar */}
              {!isDefault && (
                <button
                  onClick={() => resetPermissionToDefault(config.id)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Restaurar valores por defecto
                </button>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-8">
        {/* PO Permissions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FileText size={18} className="text-slate-600" />
            <h3 className="font-semibold text-slate-900">Órdenes de compra</h3>
          </div>
          <div className="space-y-2">
            {poPermissions.map(renderPermissionItem)}
          </div>
        </div>

        {/* Invoice Permissions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Receipt size={18} className="text-slate-600" />
            <h3 className="font-semibold text-slate-900">Facturas</h3>
          </div>
          <div className="space-y-2">
            {invoicePermissions.map(renderPermissionItem)}
          </div>
        </div>

        {/* General Permissions */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Settings size={18} className="text-slate-600" />
            <h3 className="font-semibold text-slate-900">General</h3>
          </div>
          <div className="space-y-2">
            {generalPermissions.map(renderPermissionItem)}
          </div>
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );

  if (errorMessage && !hasAccess)
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-red-600" />
          </div>
          <p className="text-slate-700 mb-6">{errorMessage}</p>
          <Link
            href={`/project/${id}/accounting`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Volver al Panel
          </Link>
        </div>
      </div>
    );

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          {/* Page header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <Settings size={24} style={{ color: "#2F52E0" }} />
              <h1 className="text-2xl font-semibold text-slate-900">Configuración de contabilidad</h1>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Guardar
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle2 size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && hasAccess && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />
          {errorMessage}
        </div>
      )}

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Layout con sidebar de secciones */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar de secciones - sticky que se mueve con el scroll */}
          <div className="lg:w-52 flex-shrink-0">
            <div className="lg:sticky lg:top-20">
              <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 bg-white lg:bg-transparent">
                {CONFIG_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all whitespace-nowrap ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <Icon size={16} className={isActive ? "text-white" : "text-slate-400"} />
                      <span className={`text-sm font-medium ${isActive ? "text-white" : ""}`}>{section.label}</span>
                    </button>
                  );
                })}
              </nav>
              
              {/* Auditoría - Solo visible en desktop */}
              {(auditLog.approvals || auditLog.permissions) && (
                <div className="hidden lg:block mt-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock size={12} className="text-slate-400" />
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Últimos cambios</p>
                  </div>
                  <div className="space-y-2">
                    {auditLog.approvals && (
                      <div className="text-[11px]">
                        <p className="text-slate-600 font-medium">Aprobaciones</p>
                        <p className="text-slate-400">{formatRelativeDate(auditLog.approvals.updatedAt)}</p>
                      </div>
                    )}
                    {auditLog.permissions && (
                      <div className="text-[11px]">
                        <p className="text-slate-600 font-medium">Permisos</p>
                        <p className="text-slate-400">{formatRelativeDate(auditLog.permissions.updatedAt)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contenido principal */}
          <div className="flex-1 min-w-0">
            {activeSection === "company" && renderCompanySection()}
            {activeSection === "cost" && renderCostSection()}
            {activeSection === "approvals" && renderApprovalsSection()}
            {activeSection === "permissions" && renderPermissionsSection()}
          </div>
        </div>
      </main>

      {/* Modal para cuenta bancaria */}
      {showBankAccountModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowBankAccountModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <CreditCard size={20} className="text-slate-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {editingBankAccount ? "Editar cuenta" : "Nueva cuenta bancaria"}
                  </h3>
                  <p className="text-xs text-slate-500">Para remesas SEPA</p>
                </div>
              </div>
              <button onClick={() => setShowBankAccountModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Alias *</label>
                <input
                  type="text"
                  value={bankAccountForm.alias}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, alias: e.target.value })}
                  placeholder="Cuenta principal, Cuenta rodaje"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Razón social titular</label>
                  <input
                    type="text"
                    value={bankAccountForm.fiscalName}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, fiscalName: e.target.value })}
                    placeholder="Nombre empresa"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">NIF/CIF titular</label>
                  <input
                    type="text"
                    value={bankAccountForm.taxId}
                    onChange={(e) => setBankAccountForm({ ...bankAccountForm, taxId: e.target.value.toUpperCase() })}
                    placeholder="B12345678"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">IBAN *</label>
                <input
                  type="text"
                  value={bankAccountForm.iban}
                  onChange={(e) => handleBankAccountIbanChange(e.target.value)}
                  placeholder="Pega 20 dígitos o IBAN completo"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">Pega 20 dígitos y se calcula ESXX automáticamente</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">BIC/SWIFT <span className="font-normal text-slate-400">(opcional)</span></label>
                <input
                  type="text"
                  value={bankAccountForm.bic || ""}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, bic: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) })}
                  placeholder="CAIXESBBXXX"
                  maxLength={11}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono uppercase"
                />
              </div>

              <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                <input
                  type="checkbox"
                  checked={bankAccountForm.isDefault || false}
                  onChange={(e) => setBankAccountForm({ ...bankAccountForm, isDefault: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Star size={14} className="text-amber-500" />
                    Cuenta principal
                  </p>
                  <p className="text-xs text-slate-500">Se usará por defecto en las remesas</p>
                </div>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowBankAccountModal(false)}
                className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveBankAccount}
                disabled={savingBankAccount || !bankAccountForm.alias || !bankAccountForm.iban}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                <Save size={16} />
                {savingBankAccount ? "Guardando..." : editingBankAccount ? "Guardar cambios" : "Añadir cuenta"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
