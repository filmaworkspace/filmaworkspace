"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select, buttonClass } from "@/components/ds";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
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
  MoreHorizontal,
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
  Landmark,
  Layers,
  Package,
  Plus,
  Receipt,
  Save,
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
  { value: "on_create", label: "Al enviar PO" },
  { value: "on_approve", label: "Al aprobar PO" },
];

const ACTUAL_TRIGGERS = [
  { value: "on_code", label: "Al codificar factura" },
  { value: "on_account", label: "Al contabilizar factura" },
];

const BOX_TRIGGERS = [
  { value: "on_create",  label: "Al codificar sobre" },
  { value: "on_account", label: "Al contabilizar sobre" },
];

interface CostSettings {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_code" | "on_account" | "on_create" | "on_approve";
  boxActualTrigger: "on_create" | "on_account" | "on_approve";
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

  // Bloquea el scroll de la página de detrás mientras el modal de cuenta
  // bancaria o el de confirmación están abiertos.
  useBodyScrollLock(showBankAccountModal || !!confirmDialog);

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
        // Migraciones de valores eliminados
        if (rawInvoice === "on_paid")    rawInvoice = "on_account";
        if (rawBox     === "on_paid")    rawBox     = "on_account";
        if (rawInvoice === "on_approve") rawInvoice = "on_code";
        if (rawBox     === "on_approve") rawBox     = "on_create";
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
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount);

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

  // ─── Interfaz ────────────────────────────────────────────────────────────

  type FlowKey = "po" | "invoice" | "box";
  const FLOWS: { key: FlowKey; label: string }[] = [
    { key: "po", label: "Órdenes de compra" },
    { key: "invoice", label: "Facturas" },
    { key: "box", label: "Cajas" },
  ];
  const stepsOf = (k: FlowKey) => (k === "po" ? poApprovals : k === "invoice" ? invoiceApprovals : boxApprovals);

  const memberName = (uid: string) => {
    const m = members.find((x) => x.userId === uid);
    return m?.name || m?.email || "Usuario";
  };
  const approverText = (s: ApprovalStep) => {
    if (s.approverType === "role") return s.roles?.length ? s.roles.join(", ") : "Sin roles";
    if (s.approverType === "fixed") return s.approvers?.length ? s.approvers.map(memberName).join(", ") : "Sin personas";
    if (s.approverType === "hod") return s.department ? `HOD de ${s.department}` : "HOD del departamento de la PO";
    return s.department ? `Coordinator de ${s.department}` : "Coordinator del departamento de la PO";
  };
  const conditionText = (s: ApprovalStep) => {
    if (!s.hasAmountThreshold || !s.amountThreshold) return "Siempre";
    const f = (n?: number) => `${formatCurrency(n || 0)} €`;
    if (s.amountCondition === "below") return `Base < ${f(s.amountThreshold)}`;
    if (s.amountCondition === "between") return `Base entre ${f(s.amountThreshold)} y ${f(s.amountThresholdMax)}`;
    return `Base > ${f(s.amountThreshold)}`;
  };

  const snapshot = JSON.stringify({ costSettings, poApprovals, invoiceApprovals, boxApprovals, projectSettings });
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  useEffect(() => { if (!loading && savedSnapshot === null) setSavedSnapshot(snapshot); }, [loading, savedSnapshot, snapshot]);
  const dirty = savedSnapshot !== null && savedSnapshot !== snapshot;
  const companyDirty = JSON.stringify(companyForm) !== JSON.stringify(companyData);

  const saveAll = async () => {
    await handleSave();
    if (projectType === "serie") await handleSaveProjectSettings();
    setSavedSnapshot(snapshot);
  };

  const [tab, setTab] = useState<"company" | "cost" | "approvals">("company");
  const [flow, setFlow] = useState<FlowKey>("po");
  const [editingStep, setEditingStep] = useState<{ flow: FlowKey; id: string } | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const editStep = editingStep ? stepsOf(editingStep.flow).find((s) => s.id === editingStep.id) || null : null;
  // Al añadir un nivel se abre su editor (cuando el estado ya incluye el nuevo nivel)
  const [openLast, setOpenLast] = useState<FlowKey | null>(null);
  useEffect(() => {
    if (!openLast) return;
    const list = stepsOf(openLast);
    if (list.length) setEditingStep({ flow: openLast, id: list[list.length - 1].id });
    setOpenLast(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLast, poApprovals, invoiceApprovals, boxApprovals]);

  const lastSaved = auditLog.approvals || auditLog.permissions;
  const H2 = ({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) => (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold text-slate-900">{children}{count !== undefined && <span className="ml-1.5 font-normal text-slate-400">{count}</span>}</h2>
      {action}
    </div>
  );
  const TH = "border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500";

  if (loading) return <PageLoading />;

  if (errorMessage && !hasAccess) {
    return (
      <Page>
        <PageHeader title="Configuración" />
        <div className="mt-6"><EmptyState title={errorMessage} action={<Link href={`/project/${id}/accounting`} className={buttonClass("secondary", "sm")}>Volver al panel</Link>} /></div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Configuración"
        actions={
          tab !== "company" ? (
            <>
              {lastSaved?.updatedAt && !dirty && (
                <span className="text-xs text-slate-400">Guardado {formatRelativeDate(lastSaved.updatedAt)}{lastSaved.updatedByName ? ` por ${lastSaved.updatedByName}` : ""}</span>
              )}
              {dirty && <span className="text-xs text-amber-800">Cambios sin guardar</span>}
              <Button variant="primary" onClick={saveAll} disabled={saving || !dirty}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
            </>
          ) : undefined
        }
      />

      <div className="mt-6">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[{ value: "company", label: "Empresa" }, { value: "cost", label: "Costes" }, { value: "approvals", label: "Aprobaciones" }]}
        />
      </div>

      {(successMessage || (errorMessage && hasAccess)) && (
        <p className={`mt-4 text-[13px] ${errorMessage ? "text-red-700" : "text-slate-600"}`}>{errorMessage || successMessage}</p>
      )}

      {/* ── Empresa ─────────────────────────────────────────────────────── */}
      {tab === "company" && (
        <div className="mt-6 flex flex-col gap-8">
          <section>
            <H2
              action={companyDirty ? (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCompanyForm(companyData)}>Descartar</Button>
                  <Button variant="primary" size="sm" onClick={handleSaveCompany} disabled={savingCompany}>{savingCompany ? "Guardando…" : "Guardar datos fiscales"}</Button>
                </div>
              ) : undefined}
            >
              Datos fiscales
            </H2>
            <p className="mb-3 text-xs text-slate-500">Aparecen en las POs y en los ficheros de remesa.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
              <Field label="Razón social" className="sm:col-span-4"><Input value={companyForm.fiscalName} onChange={(e) => setCompanyForm({ ...companyForm, fiscalName: e.target.value })} /></Field>
              <Field label="NIF" className="sm:col-span-2"><Input value={companyForm.taxId} onChange={(e) => setCompanyForm({ ...companyForm, taxId: e.target.value.toUpperCase() })} className="font-mono" /></Field>
              <Field label="Dirección" className="sm:col-span-4"><Input value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} /></Field>
              <Field label="Código postal" className="sm:col-span-2"><Input value={companyForm.postalCode} onChange={(e) => setCompanyForm({ ...companyForm, postalCode: e.target.value })} className="font-mono" /></Field>
              <Field label="Ciudad" className="sm:col-span-2"><Input value={companyForm.city} onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })} /></Field>
              <Field label="Provincia" className="sm:col-span-2"><Input value={companyForm.province} onChange={(e) => setCompanyForm({ ...companyForm, province: e.target.value })} /></Field>
              <Field label="País" className="sm:col-span-2"><Input value={companyForm.country} onChange={(e) => setCompanyForm({ ...companyForm, country: e.target.value })} /></Field>
            </div>
          </section>

          <section>
            <H2 count={bankAccounts.length} action={<Button variant="secondary" size="sm" onClick={openNewBankAccount}><Plus size={13} /> Añadir cuenta</Button>}>
              Cuentas bancarias
            </H2>
            <p className="mb-3 text-xs text-slate-500">Cuentas ordenantes para generar las remesas SEPA en Pagos.</p>
            {bankAccounts.length === 0 ? (
              <p className="border-y border-slate-200 py-8 text-center text-[13px] text-slate-500">Sin cuentas bancarias</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="tbl w-full min-w-[720px] border-collapse text-[13px]">
                  <thead>
                    <tr className={TH}>
                      <th scope="col" className="px-4 py-2 text-left font-medium">Cuenta</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Titular</th>
                      <th scope="col" className="w-[30%] px-3 py-2 text-left font-medium">IBAN</th>
                      <th scope="col" className="w-28 px-3 py-2 text-left font-medium">BIC</th>
                      <th scope="col" className="w-12 py-2 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map((acc) => (
                      <tr key={acc.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                        <td className="px-4 py-1.5">
                          <span className="font-medium text-slate-900">{acc.alias}</span>
                          {acc.isDefault && <span className="ml-2 text-xs text-slate-400">principal</span>}
                        </td>
                        <td className="px-3 py-1.5">{acc.fiscalName || "—"}<span className="ml-2 font-mono text-xs text-slate-400">{acc.taxId}</span></td>
                        <td className="px-3 py-1.5 font-mono text-xs">{formatIBAN(acc.iban)}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{acc.bic || "—"}</td>
                        <td className="py-1.5 pr-3 text-right">
                          <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                            {(close) => (
                              <>
                                <MenuItem onClick={() => { close(); openEditBankAccount(acc); }}>Editar</MenuItem>
                                <MenuSeparator />
                                <MenuItem danger onClick={() => { close(); handleDeleteBankAccount(acc.id); }}>Eliminar</MenuItem>
                              </>
                            )}
                          </Menu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── Costes ──────────────────────────────────────────────────────── */}
      {tab === "cost" && (
        <div className="mt-6">
          <p className="mb-3 text-xs text-slate-500">En qué momento cada documento empieza a contar en el presupuesto.</p>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {[
              {
                label: "Comprometido de las POs", hint: "Lo que una PO reserva del presupuesto.",
                control: <Segmented value={costSettings.poCommitmentTrigger} onChange={(v) => setCostSettings({ ...costSettings, poCommitmentTrigger: v as CostSettings["poCommitmentTrigger"] })} options={[{ value: "on_create", label: "Al enviarla" }, { value: "on_approve", label: "Al aprobarla" }]} />,
              },
              {
                label: "Realizado de las facturas", hint: "Cuándo una factura pasa a gasto real.",
                control: <Segmented value={costSettings.invoiceActualTrigger as "on_code" | "on_account"} onChange={(v) => setCostSettings({ ...costSettings, invoiceActualTrigger: v })} options={[{ value: "on_code", label: "Al codificarla" }, { value: "on_account", label: "Al contabilizarla" }]} />,
              },
              {
                label: "Realizado de las cajas", hint: "Gastos de tarjeta y transferencias.",
                control: <Segmented value={costSettings.boxActualTrigger as "on_create" | "on_account"} onChange={(v) => setCostSettings({ ...costSettings, boxActualTrigger: v })} options={[{ value: "on_create", label: "Al codificar el sobre" }, { value: "on_account", label: "Al contabilizarlo" }]} />,
              },
            ].map((r) => (
              <div key={r.label} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
                <div>
                  <p className="text-[13px] font-medium text-slate-900">{r.label}</p>
                  <p className="text-xs text-slate-500">{r.hint}</p>
                </div>
                {r.control}
              </div>
            ))}
            {projectType === "serie" && (
              <div className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-100 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-slate-900">Capítulos</p>
                  <p className="text-xs text-slate-500">Serie de {projectEpisodes} capítulos.</p>
                </div>
                <div className="flex flex-col gap-1">
                  <Checkbox checked={projectSettings.enableEpisodes} onChange={(v) => setProjectSettings({ ...projectSettings, enableEpisodes: v, requireEpisodeAssignment: v ? projectSettings.requireEpisodeAssignment : false })} label="Repartir POs y facturas por capítulo" />
                  {projectSettings.enableEpisodes && (
                    <Checkbox checked={projectSettings.requireEpisodeAssignment} onChange={(v) => setProjectSettings({ ...projectSettings, requireEpisodeAssignment: v })} label="Obligatorio en cada línea" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Aprobaciones ────────────────────────────────────────────────── */}
      {tab === "approvals" && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented value={flow} onChange={setFlow} options={FLOWS.map((f) => ({ value: f.key, label: `${f.label} · ${stepsOf(f.key).length}` }))} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { addApprovalStep(flow, false); setOpenLast(flow); }}
            >
              <Plus size={13} /> Añadir nivel
            </Button>
          </div>
          <p className="mb-3 mt-3 text-xs text-slate-500">
            Los niveles van en orden; los importes se miran sobre la base imponible. Un nivel sin nadie que pueda aprobar (p. ej. departamento sin HOD) se omite y el flujo sigue.
          </p>
          {stepsOf(flow).length === 0 ? (
            <p className="border-y border-slate-200 py-8 text-center text-[13px] text-slate-500">Sin niveles: los documentos se aprueban automáticamente</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="tbl w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className={TH}>
                    <th scope="col" className="w-20 px-4 py-2 text-left font-medium">Nivel</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Aprueba</th>
                    <th scope="col" className="w-56 px-3 py-2 text-left font-medium">Cuándo</th>
                    <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Firma</th>
                    <th scope="col" className="w-12 py-2 pr-3" />
                  </tr>
                </thead>
                <tbody>
                  {stepsOf(flow).map((s, i, list) => (
                    <tr key={s.id} onClick={() => setEditingStep({ flow, id: s.id })} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                      <td className="px-4 py-1.5 font-mono text-xs text-slate-500">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-slate-900">{approverText(s)}</span>
                        <span className="ml-2 text-xs text-slate-400">{APPROVER_TYPE_LABELS[s.approverType]}</span>
                      </td>
                      <td className={`px-3 py-1.5 text-xs ${s.hasAmountThreshold ? "text-slate-800" : "text-slate-500"}`}>{conditionText(s)}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-600">{s.requireAll ? "Todos" : "Uno cualquiera"}</td>
                      <td className="py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); setEditingStep({ flow, id: s.id }); }}>Editar</MenuItem>
                              {i > 0 && <MenuItem onClick={() => { close(); moveStep(flow, s.id, "up"); }}>Subir</MenuItem>}
                              {i < list.length - 1 && <MenuItem onClick={() => { close(); moveStep(flow, s.id, "down"); }}>Bajar</MenuItem>}
                              <MenuSeparator />
                              <MenuItem danger onClick={() => { close(); removeApprovalStep(flow, s.id); }}>Eliminar nivel</MenuItem>
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Editor de un nivel de aprobación (los cambios se guardan con "Guardar cambios") */}
      <Modal
        open={!!editStep}
        onClose={() => { setEditingStep(null); setMemberQuery(""); }}
        title={editStep && editingStep ? `Nivel ${stepsOf(editingStep.flow).findIndex((s) => s.id === editStep.id) + 1} · ${FLOWS.find((f) => f.key === editingStep.flow)?.label}` : ""}
        width="max-w-lg"
        footer={<Button variant="primary" onClick={() => { setEditingStep(null); setMemberQuery(""); }}>Hecho</Button>}
      >
        {editStep && editingStep && (() => {
          const k = editingStep.flow;
          const s = editStep;
          const q = memberQuery.trim().toLowerCase();
          const people = members.filter((m) => !q || (m.name || "").toLowerCase().includes(q) || (m.email || "").toLowerCase().includes(q));
          return (
            <div className="flex flex-col gap-4">
              <Field label="Quién aprueba">
                <Select value={s.approverType} onChange={(e) => updateStep(k, s.id, "approverType", e.target.value)}>
                  <option value="role">Por rol del proyecto</option>
                  <option value="fixed">Personas concretas</option>
                  <option value="hod">HOD del departamento</option>
                  <option value="coordinator">Coordinator del departamento</option>
                </Select>
              </Field>

              {s.approverType === "role" && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">Roles</p>
                  <div className="flex flex-wrap gap-x-5">
                    {PROJECT_ROLES.map((r) => (
                      <Checkbox key={r} checked={(s.roles || []).includes(r)} onChange={() => toggleRole(k, s.id, r)} label={`${r} · ${getMembersByRole(r).length}`} />
                    ))}
                  </div>
                </div>
              )}

              {s.approverType === "fixed" && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">Personas <span className="font-normal text-slate-400">{(s.approvers || []).length} seleccionadas</span></p>
                  <Input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Buscar por nombre o email" className="mb-2" />
                  <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 px-3 py-1">
                    {people.map((m) => (
                      <Checkbox
                        key={m.userId}
                        checked={(s.approvers || []).includes(m.userId)}
                        onChange={() => toggleApprover(k, s.id, m.userId)}
                        label={m.name || m.email}
                        hint={[m.role, m.position, m.department].filter(Boolean).join(" · ") || undefined}
                      />
                    ))}
                    {people.length === 0 && <p className="py-3 text-center text-xs text-slate-500">Sin resultados</p>}
                  </div>
                </div>
              )}

              {(s.approverType === "hod" || s.approverType === "coordinator") && (
                <Field label="Departamento">
                  <Select value={s.department || ""} onChange={(e) => updateStep(k, s.id, "department", e.target.value || undefined)}>
                    <option value="">El del documento</option>
                    {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
              )}

              <Field label="Firma">
                <Segmented
                  value={s.requireAll ? "all" : "any"}
                  onChange={(v) => updateStep(k, s.id, "requireAll", v === "all")}
                  options={[{ value: "any", label: "Basta con uno" }, { value: "all", label: "Tienen que aprobar todos" }]}
                />
              </Field>

              <div className="border-t border-slate-100 pt-4">
                <Checkbox
                  checked={s.hasAmountThreshold}
                  onChange={(v) => { updateStep(k, s.id, "hasAmountThreshold", v); if (v && !s.amountThreshold) updateStep(k, s.id, "amountThreshold", 5000); }}
                  label="Solo según el importe"
                  hint="Se aplica según la base imponible del documento."
                />
                {s.hasAmountThreshold && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <Field label="Condición">
                      <Select value={s.amountCondition || "above"} onChange={(e) => updateStep(k, s.id, "amountCondition", e.target.value)}>
                        <option value="above">Mayor que</option>
                        <option value="below">Menor que</option>
                        <option value="between">Entre</option>
                      </Select>
                    </Field>
                    <Field label={s.amountCondition === "between" ? "Desde (€)" : "Importe (€)"}>
                      <Input type="number" min="0" value={s.amountThreshold ?? ""} onChange={(e) => updateStep(k, s.id, "amountThreshold", e.target.value ? Number(e.target.value) : undefined)} className="text-right font-mono" />
                    </Field>
                    {s.amountCondition === "between" && (
                      <Field label="Hasta (€)">
                        <Input type="number" min="0" value={s.amountThresholdMax ?? ""} onChange={(e) => updateStep(k, s.id, "amountThresholdMax", e.target.value ? Number(e.target.value) : undefined)} className="text-right font-mono" />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Cuenta bancaria de la productora (remesas SEPA) */}
      <Modal
        open={showBankAccountModal}
        onClose={() => setShowBankAccountModal(false)}
        title={editingBankAccount ? "Editar cuenta bancaria" : "Nueva cuenta bancaria"}
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowBankAccountModal(false)}>Cancelar</Button>
            <Button variant="primary" onClick={handleSaveBankAccount} disabled={savingBankAccount || !bankAccountForm.alias || !bankAccountForm.iban}>
              {savingBankAccount ? "Guardando…" : editingBankAccount ? "Guardar cambios" : "Añadir cuenta"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Alias"><Input value={bankAccountForm.alias} onChange={(e) => setBankAccountForm({ ...bankAccountForm, alias: e.target.value })} placeholder="Ej. Cuenta de producción" autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Titular"><Input value={bankAccountForm.fiscalName} onChange={(e) => setBankAccountForm({ ...bankAccountForm, fiscalName: e.target.value })} placeholder="Razón social" /></Field>
            <Field label="NIF del titular"><Input value={bankAccountForm.taxId} onChange={(e) => setBankAccountForm({ ...bankAccountForm, taxId: e.target.value.toUpperCase() })} placeholder="B12345678" className="font-mono" /></Field>
          </div>
          <Field label="IBAN" hint="Si pegas los 20 dígitos de la cuenta, se calcula el ESxx automáticamente.">
            <Input value={bankAccountForm.iban} onChange={(e) => handleBankAccountIbanChange(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" className="font-mono" />
          </Field>
          <Field label="BIC / SWIFT (opcional)">
            <Input value={bankAccountForm.bic || ""} onChange={(e) => setBankAccountForm({ ...bankAccountForm, bic: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) })} maxLength={11} className="font-mono uppercase" />
          </Field>
          <Checkbox
            checked={bankAccountForm.isDefault || false}
            onChange={(v) => setBankAccountForm({ ...bankAccountForm, isDefault: v })}
            label="Cuenta principal"
            hint="Se propone por defecto al generar las remesas."
          />
        </div>
      </Modal>

      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>
    </Page>
  );
}
