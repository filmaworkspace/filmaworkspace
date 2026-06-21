"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, query, orderBy as fbOrderBy, setDoc, Timestamp,
} from "firebase/firestore";
import {
  AlertCircle, ArrowDown, ArrowUp, Banknote, Car, Check, CheckCircle2,
  ClipboardList, FileCheck, FileDown, Globe, GripVertical, Home,
  Info, Lock, Plane, Plus, Save, Settings, Shield, Trash2, Utensils,
  User, Users, X,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
}

interface ApprovalConfig {
  approverUserIds: string[];
  approverNames: Record<string, string>;
  requireApproval: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

interface ExportConfig {
  includePhoto: boolean;
  includePhone: boolean;
  includeEmail: boolean;
  includeAddress: boolean;
  includeDni: boolean;
  includeIban: boolean;
  includeSsNumber: boolean;
  includeSalary: boolean;
  includeNotes: boolean;
  groupBySection: boolean;
  groupByDepartment: boolean;
}

interface FormBuilderConfig {
  showPhoto: boolean;
  showLastName2: boolean;
  showArtisticName: boolean;
  showDocExpiry: boolean;
  showBirthPlace: boolean;
  showNationality: boolean;
  showProvince: boolean;
  showCountry: boolean;
  showIrpfRate: boolean;
  showContractReason: boolean;
  showBankName: boolean;
  showAccountHolder: boolean;
  showBankCert: boolean;
  showCv: boolean;
}

interface FormField {
  key: keyof FormBuilderConfig | null;
  label: string;
  description?: string;
  required?: boolean;
}

interface FormSection {
  id: string;
  label: string;
  fields: FormField[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const CONFIG_SECTIONS = [
  { id: "approvals",    label: "Aprobaciones",  icon: FileCheck,     description: "Flujo de aprobación para altas de crew" },
  { id: "departments",  label: "Departamentos", icon: GripVertical,  description: "Orden de los departamentos en listados" },
  { id: "payroll",      label: "Nóminas",       icon: Banknote,      description: "Tarifas globales de dietas y complementos" },
  { id: "form",         label: "Formulario",    icon: ClipboardList, description: "Preguntas del formulario de alta de crew" },
  { id: "export",       label: "Exportación",   icon: FileDown,      description: "Configuración de exportaciones de crew" },
];

interface PayrollRatesConfig {
  mealRate:                   number;
  halfPerDiemRate:            number;
  halfPerDiemRateArtistic:    number;
  perDiemRate:                number;
  perDiemRateArtistic:        number;
  halfIntlPerDiemRate:        number;
  halfIntlPerDiemRateArtistic:number;
  intlPerDiemRate:            number;
  intlPerDiemRateArtistic:    number;
  accommodationRate:          number;
  carRate:                    number;
}

const DEFAULT_PAYROLL_RATES: PayrollRatesConfig = {
  mealRate: 15,
  halfPerDiemRate: 18.5,    halfPerDiemRateArtistic: 18.5,
  perDiemRate: 37,          perDiemRateArtistic: 37,
  halfIntlPerDiemRate: 47.5, halfIntlPerDiemRateArtistic: 47.5,
  intlPerDiemRate: 95,      intlPerDiemRateArtistic: 95,
  accommodationRate: 80, carRate: 40,
};

const FORM_BUILDER_DEFAULTS: FormBuilderConfig = {
  showPhoto: true,
  showLastName2: true,
  showArtisticName: false,
  showDocExpiry: true,
  showBirthPlace: false,
  showNationality: true,
  showProvince: true,
  showCountry: true,
  showIrpfRate: true,
  showContractReason: false,
  showBankName: false,
  showAccountHolder: false,
  showBankCert: false,
  showCv: false,
};

const FORM_SECTIONS: FormSection[] = [
  {
    id: "identity",
    label: "Datos personales",
    fields: [
      { key: "showPhoto",        label: "Foto de perfil",           description: "El crew puede subir una foto" },
      { key: null,               label: "Nombre",                   required: true },
      { key: "showLastName2",    label: "Segundo apellido" },
      { key: "showArtisticName", label: "Nombre artístico / en créditos", description: "Nombre que aparecerá en los créditos" },
      { key: null,               label: "Tipo de documento",        required: true },
      { key: null,               label: "Número de documento",      required: true },
      { key: "showDocExpiry",    label: "Caducidad del documento" },
      { key: null,               label: "Fecha de nacimiento",      required: true },
      { key: "showBirthPlace",   label: "Lugar de nacimiento" },
      { key: "showNationality",  label: "Nacionalidad" },
    ],
  },
  {
    id: "contact",
    label: "Contacto",
    fields: [
      { key: null, label: "Email",          required: true },
      { key: null, label: "Teléfono",       required: true },
      { key: null, label: "Dirección",      required: true },
      { key: null, label: "Código postal",  required: true },
      { key: null, label: "Ciudad",         required: true },
      { key: "showProvince", label: "Provincia" },
      { key: "showCountry",  label: "País" },
    ],
  },
  {
    id: "fiscal",
    label: "Fiscal y bancario",
    fields: [
      { key: null, label: "Nº Seguridad Social", required: true },
      { key: null, label: "Régimen de la SS",    required: true },
      { key: "showIrpfRate",       label: "% IRPF aplicable" },
      { key: "showContractReason", label: "Causa del contrato" },
      { key: null, label: "IBAN", required: true },
      { key: "showBankName",       label: "Nombre del banco" },
      { key: "showAccountHolder",  label: "Titular de la cuenta" },
    ],
  },
  {
    id: "documents",
    label: "Documentos adjuntos",
    fields: [
      { key: null,             label: "DNI / NIE (anverso y reverso)", required: true },
      { key: "showBankCert",   label: "Certificado de cuenta bancaria" },
      { key: "showCv",         label: "Curriculum Vitae" },
    ],
  },
];

const DEFAULT_EXPORT: ExportConfig = {
  includePhoto: true,
  includePhone: true,
  includeEmail: true,
  includeAddress: false,
  includeDni: false,
  includeIban: false,
  includeSsNumber: false,
  includeSalary: false,
  includeNotes: true,
  groupBySection: true,
  groupByDepartment: true,
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamConfigPage() {
  const { id } = useParams();
  const router = useRouter();
  const projectId = id as string;
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading]                   = useState(true);
  const [saving, setSaving]                     = useState(false);
  const [successMessage, setSuccessMessage]     = useState("");
  const [errorMessage, setErrorMessage]         = useState("");
  const [activeSection, setActiveSection]       = useState("approvals");

  // Data
  const [members, setMembers]                   = useState<ProjectMember[]>([]);
  const [approvalConfig, setApprovalConfig]     = useState<ApprovalConfig>({
    approverUserIds: [], approverNames: {}, requireApproval: false,
  });
  const [departments, setDepartments]           = useState<string[]>([]);
  const [exportConfig, setExportConfig]         = useState<ExportConfig>(DEFAULT_EXPORT);
  const [formBuilderConfig, setFormBuilderConfig] = useState<FormBuilderConfig>(FORM_BUILDER_DEFAULTS);
  const [payrollRates, setPayrollRates]           = useState<PayrollRatesConfig>(DEFAULT_PAYROLL_RATES);
  const [showMemberPicker, setShowMemberPicker] = useState(false);

  const userId = user?.uid || "";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/"); return; }
      await loadData();
      setLoading(false);
    });
    return () => unsub();
  }, [projectId]);

  const loadData = async () => {
    try {
      // Members
      const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
      setMembers(membersSnap.docs.map((d) => ({
        userId: d.data().userId || d.id,
        name: d.data().name || d.data().displayName || "Usuario",
        email: d.data().email || "",
        role: d.data().role || "",
        department: d.data().department || "",
      })));

      // Approval config
      const appSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "approvals"));
      if (appSnap.exists()) {
        const d = appSnap.data();
        setApprovalConfig({
          approverUserIds: d.approverUserIds || [],
          approverNames: d.approverNames || {},
          requireApproval: d.requireApproval ?? false,
          updatedAt: d.updatedAt?.toDate(),
          updatedBy: d.updatedBy || "",
        });
      }

      // Departments — extract from crew members (same source as crew list)
      const SECTION_LABELS: Record<string, string> = {
        technical: "Equipo técnico", cast: "Cast", specialists: "Especialistas",
      };
      const crewSnap = await getDocs(
        query(collection(db, `projects/${projectId}/crew`), fbOrderBy("createdAt", "desc"))
      );
      const crewDepts = Array.from(
        new Set(
          crewSnap.docs
            .filter((d) => (d.data().status || "active") !== "inactive")
            .map((d) => {
              const dept = (d.data().department || "").trim();
              return dept || SECTION_LABELS[d.data().section || "technical"] || "Equipo técnico";
            })
        )
      );

      // Apply saved order
      const deptOrderSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "departmentOrder"));
      if (deptOrderSnap.exists()) {
        const savedOrder: string[] = deptOrderSnap.data().order || [];
        const ordered = [
          ...savedOrder.filter((d) => crewDepts.includes(d)),
          ...crewDepts.filter((d) => !savedOrder.includes(d)),
        ];
        setDepartments(ordered);
      } else {
        setDepartments(crewDepts);
      }

      // Export config
      const expSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "exportConfig"));
      if (expSnap.exists()) {
        setExportConfig({ ...DEFAULT_EXPORT, ...expSnap.data() });
      }

      // Form builder config
      const formSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "formConfig"));
      if (formSnap.exists()) {
        setFormBuilderConfig({ ...FORM_BUILDER_DEFAULTS, ...formSnap.data() });
      }

      // Payroll rates
      const payrollSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "payrollConfig"));
      if (payrollSnap.exists()) {
        setPayrollRates({ ...DEFAULT_PAYROLL_RATES, ...payrollSnap.data() });
      }
    } catch (e) { console.error(e); }
  };

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(""), 2500);
  };
  const showError = (msg: string) => {
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(""), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Approval config
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "approvals"), {
        ...approvalConfig,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      // Department order
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "departmentOrder"), {
        order: departments,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      // Export config
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "exportConfig"), {
        ...exportConfig,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      // Form builder config
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "formConfig"), {
        ...formBuilderConfig,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      // Payroll rates
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "payrollConfig"), {
        ...payrollRates,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      showSuccess("Configuración guardada");
    } catch (e) {
      console.error(e);
      showError("Error al guardar");
    } finally { setSaving(false); }
  };

  // Approvals helpers
  const addApprover = (m: ProjectMember) => {
    if (approvalConfig.approverUserIds.includes(m.userId)) return;
    setApprovalConfig((c) => ({
      ...c,
      approverUserIds: [...c.approverUserIds, m.userId],
      approverNames: { ...c.approverNames, [m.userId]: m.name },
    }));
    setShowMemberPicker(false);
  };
  const removeApprover = (uid: string) => {
    setApprovalConfig((c) => {
      const names = { ...c.approverNames };
      delete names[uid];
      return { ...c, approverUserIds: c.approverUserIds.filter((x) => x !== uid), approverNames: names };
    });
  };

  // Department order helpers
  const moveDept = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= departments.length) return;
    setDepartments((prev) => {
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next], arr[index]];
      return arr;
    });
  };

  // Export toggle helper
  const toggleExport = (key: keyof ExportConfig) =>
    setExportConfig((c) => ({ ...c, [key]: !c[key] }));

  // ── Render sections ────────────────────────────────────────────────────────

  const renderApprovals = () => (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <Shield size={18} className="text-amber-500" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Aprobación de altas</p>
            <p className="text-xs text-slate-500 mt-0.5">Requiere aprobación manual antes de activar una alta de crew</p>
          </div>
          <div className="ml-auto">
            <button
              onClick={() => setApprovalConfig((c) => ({ ...c, requireApproval: !c.requireApproval }))}
              className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${approvalConfig.requireApproval ? "" : "bg-slate-200"}`}
              style={approvalConfig.requireApproval ? { backgroundColor: TEAM_COLOR } : {}}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${approvalConfig.requireApproval ? "translate-x-5" : ""}`} />
            </button>
          </div>
        </div>
        {!approvalConfig.requireApproval && (
          <div className="px-6 py-4 flex items-start gap-2 bg-slate-50">
            <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-slate-500">Sin aprobación activa, las altas se crean directamente como activas.</p>
          </div>
        )}
      </div>

      {approvalConfig.requireApproval && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-slate-400" />
              <p className="text-sm font-semibold text-slate-900">Aprobadores</p>
            </div>
            <button onClick={() => setShowMemberPicker(true)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
              <Plus size={13} /> Añadir aprobador
            </button>
          </div>

          {approvalConfig.approverUserIds.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <User size={20} className="text-slate-400" />
              </div>
              <p className="text-sm text-slate-500">No hay aprobadores configurados</p>
              <p className="text-xs text-slate-400 mt-1">Añade al menos un aprobador para que el flujo funcione</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {approvalConfig.approverUserIds.map((uid) => {
                const member = members.find((m) => m.userId === uid);
                const name = approvalConfig.approverNames[uid] || member?.name || uid;
                return (
                  <div key={uid} className="flex items-center justify-between px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{name}</p>
                        {member?.role && <p className="text-xs text-slate-400">{member.role}</p>}
                      </div>
                    </div>
                    <button onClick={() => removeApprover(uid)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderDepartments = () => (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Orden de departamentos</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Define el orden en que aparecen en los listados y exportaciones.
          </p>
        </div>

        {departments.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-500">No hay crew con departamentos asignados</p>
            <p className="text-xs text-slate-400 mt-1">Añade miembros al crew y asígnales departamento</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {departments.map((dept, i) => {
              const canMoveUp = i > 0;
              const canMoveDown = i < departments.length - 1;
              return (
                <div key={dept} className="flex items-center gap-3 px-6 py-3">
                  <span className="w-5 text-center text-xs font-mono text-slate-400 flex-shrink-0">{i + 1}</span>
                  <div
                    className="w-0.5 h-6 rounded-full flex-shrink-0"
                    style={{ backgroundColor: TEAM_COLOR }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900">{dept}</p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => moveDept(i, -1)} disabled={!canMoveUp}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 transition-colors">
                      <ArrowUp size={13} />
                    </button>
                    <button onClick={() => moveDept(i, 1)} disabled={!canMoveDown}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 transition-colors">
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
        <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
        <span>Este orden se aplica automáticamente en los listados de crew y en las exportaciones PDF.</span>
      </div>
    </div>
  );

  const setPayrollRate = (key: keyof PayrollRatesConfig, value: number) =>
    setPayrollRates(r => ({ ...r, [key]: value }));

  const renderPayrollRates = () => {
    type RateGroup = {
      label: string; description: string; icon: React.ReactNode;
      fields: { key: keyof PayrollRatesConfig; badge: string; badgeColor: string }[];
    };
    const groups: RateGroup[] = [
      {
        label: "Comidas", description: "Por día o comida", icon: <Utensils size={15} className="text-orange-500" />,
        fields: [{ key: "mealRate", badge: "Todos", badgeColor: "bg-slate-100 text-slate-500" }],
      },
      {
        label: "Media dieta nacional", description: "Nacional — media dieta por día", icon: <Plane size={15} className="text-sky-300" />,
        fields: [
          { key: "halfPerDiemRate", badge: "R. General", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "halfPerDiemRateArtistic", badge: "R. Artistas", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Dieta nacional", description: "Nacional — dieta completa/día", icon: <Plane size={15} className="text-sky-500" />,
        fields: [
          { key: "perDiemRate", badge: "R. General", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "perDiemRateArtistic", badge: "R. Artistas", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Media dieta internacional", description: "Internacional — media dieta/día", icon: <Globe size={15} className="text-indigo-300" />,
        fields: [
          { key: "halfIntlPerDiemRate", badge: "R. General", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "halfIntlPerDiemRateArtistic", badge: "R. Artistas", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Dieta internacional", description: "Internacional — dieta completa", icon: <Globe size={15} className="text-indigo-500" />,
        fields: [
          { key: "intlPerDiemRate", badge: "R. General", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "intlPerDiemRateArtistic", badge: "R. Artistas", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Alojamiento", description: "Por noche", icon: <Home size={15} className="text-purple-500" />,
        fields: [{ key: "accommodationRate", badge: "Todos", badgeColor: "bg-slate-100 text-slate-500" }],
      },
      {
        label: "Vehículo", description: "Por día (o €/km si se prefiere)", icon: <Car size={15} className="text-emerald-500" />,
        fields: [{ key: "carRate", badge: "Todos", badgeColor: "bg-slate-100 text-slate-500" }],
      },
    ];
    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Tarifas globales</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Importes por defecto en Nóminas. Las dietas tienen tarifa separada para Equipo técnico (R. General) y Equipo artístico (R. Artistas).
            </p>
          </div>
          <div className="divide-y divide-slate-100">
            {groups.map(({ label, description, icon, fields }) => (
              <div key={label} className="flex items-center gap-4 px-6 py-3.5">
                <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {fields.map(({ key, badge, badgeColor }) => (
                    <div key={key} className="flex flex-col items-end gap-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${badgeColor}`}>{badge}</span>
                      <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-slate-300">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={payrollRates[key]}
                          onChange={e => setPayrollRate(key, parseFloat(e.target.value) || 0)}
                          className="w-20 text-sm text-right px-3 py-2 focus:outline-none text-slate-900 font-medium"
                        />
                        <span className="px-2.5 py-2 text-sm text-slate-400 bg-slate-50 border-l border-slate-200">€</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
          <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
          <span>
            Al modificar estas tarifas solo afecta a los nuevos registros. Los días ya guardados con importe personalizado mantienen su valor.
          </span>
        </div>
      </div>
    );
  };

  const toggleFormField = (key: keyof FormBuilderConfig) =>
    setFormBuilderConfig((c) => ({ ...c, [key]: !c[key] }));

  const renderFormBuilder = () => {
    const enabledCount = (Object.values(formBuilderConfig) as boolean[]).filter(Boolean).length;
    const totalToggleable = Object.keys(FORM_BUILDER_DEFAULTS).length;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-500">
            {enabledCount} de {totalToggleable} campos opcionales activos
          </p>
          <button
            onClick={() => setFormBuilderConfig(FORM_BUILDER_DEFAULTS)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Restaurar por defecto
          </button>
        </div>

        {FORM_SECTIONS.map((section) => (
          <div key={section.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-3.5 border-b border-slate-100 bg-slate-50">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{section.label}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {section.fields.map((field, idx) => {
                const isLocked = field.key === null || field.required;
                const isOn = field.key ? formBuilderConfig[field.key] : true;
                return (
                  <div key={idx} className="flex items-center gap-4 px-6 py-3.5">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isLocked && !isOn ? "text-slate-400" : "text-slate-900"}`}>
                        {field.label}
                      </p>
                      {field.description && (
                        <p className="text-xs text-slate-400 mt-0.5">{field.description}</p>
                      )}
                    </div>
                    {isLocked ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Lock size={11} className="text-slate-300" />
                        <span className="text-xs text-slate-300">Obligatorio</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => toggleFormField(field.key!)}
                        className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${isOn ? "" : "bg-slate-200"}`}
                        style={isOn ? { backgroundColor: TEAM_COLOR } : {}}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isOn ? "translate-x-5" : ""}`} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
          <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
          <span>Los cambios se aplican a todos los nuevos formularios enviados desde este proyecto. Los formularios ya enviados no se ven afectados.</span>
        </div>
      </div>
    );
  };

  const renderExport = () => {
    const fieldToggles: { key: keyof ExportConfig; label: string; description?: string }[] = [
      { key: "includePhoto",     label: "Foto de perfil",     description: "Incluye la foto en fichas PDF y exportaciones" },
      { key: "includePhone",     label: "Teléfono"            },
      { key: "includeEmail",     label: "Email"               },
      { key: "includeAddress",   label: "Dirección"           },
      { key: "includeDni",       label: "DNI / Pasaporte"     },
      { key: "includeSsNumber",  label: "Número Seguridad Social" },
      { key: "includeIban",      label: "IBAN / Cuenta bancaria" },
      { key: "includeSalary",    label: "Remuneración / Salario" },
      { key: "includeNotes",     label: "Notas internas"      },
    ];
    const structureToggles: { key: keyof ExportConfig; label: string; description: string }[] = [
      { key: "groupBySection",     label: "Agrupar por sección",     description: "Técnico / Cast / Especialistas" },
      { key: "groupByDepartment",  label: "Agrupar por departamento", description: "Usando el orden definido en Departamentos" },
    ];

    return (
      <div className="space-y-4">
        {/* Campos */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Campos a incluir</p>
            <p className="text-xs text-slate-500 mt-0.5">Selecciona qué campos aparecen en fichas PDF y listados exportados</p>
          </div>
          <div className="divide-y divide-slate-100">
            {fieldToggles.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between px-6 py-3.5 gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
                </div>
                <button onClick={() => toggleExport(key)}
                  className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${exportConfig[key] ? "" : "bg-slate-200"}`}
                  style={exportConfig[key] ? { backgroundColor: TEAM_COLOR } : {}}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${exportConfig[key] ? "translate-x-5" : ""}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Estructura */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-900">Estructura del listado</p>
            <p className="text-xs text-slate-500 mt-0.5">Cómo se organizan los miembros en los documentos exportados</p>
          </div>
          <div className="divide-y divide-slate-100">
            {structureToggles.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between px-6 py-3.5 gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{description}</p>
                </div>
                <button onClick={() => toggleExport(key)}
                  className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${exportConfig[key] ? "" : "bg-slate-200"}`}
                  style={exportConfig[key] ? { backgroundColor: TEAM_COLOR } : {}}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${exportConfig[key] ? "translate-x-5" : ""}`} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
          <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
          <span>Los cambios aquí afectan a las exportaciones de listado y a las fichas PDF generadas desde la app.</span>
        </div>
      </div>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <Settings size={24} style={{ color: TEAM_COLOR }} />
              <h1 className="text-2xl font-semibold text-slate-900">Configuración de team</h1>
            </div>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {saving
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Guardando...</>
                : <><Save size={16} />Guardar</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Toasts ─────────────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle2 size={16} /> {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} /> {errorMessage}
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="flex flex-col lg:flex-row gap-6">

          {/* Sidebar */}
          <div className="lg:w-52 flex-shrink-0">
            <div className="lg:sticky lg:top-20">
              <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
                {CONFIG_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeSection === section.id;
                  return (
                    <button key={section.id} onClick={() => setActiveSection(section.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all whitespace-nowrap ${
                        isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}>
                      <Icon size={16} className={isActive ? "text-white" : "text-slate-400"} />
                      <span className={`text-sm font-medium ${isActive ? "text-white" : ""}`}>{section.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === "approvals"   && renderApprovals()}
            {activeSection === "departments" && renderDepartments()}
            {activeSection === "payroll"     && renderPayrollRates()}
            {activeSection === "form"        && renderFormBuilder()}
            {activeSection === "export"      && renderExport()}
          </div>
        </div>
      </main>

      {/* Member picker modal */}
      {showMemberPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">Seleccionar aprobador</p>
              <button onClick={() => setShowMemberPicker(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {members.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">No hay miembros del proyecto</p>
              ) : members.map((m) => {
                const already = approvalConfig.approverUserIds.includes(m.userId);
                return (
                  <button key={m.userId} onClick={() => addApprover(m)} disabled={already}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 disabled:opacity-50 transition-colors border-b border-slate-50 last:border-0">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-slate-900">{m.name}</p>
                      {m.role && <p className="text-xs text-slate-400">{m.role}</p>}
                    </div>
                    {already && <Check size={14} style={{ color: TEAM_COLOR }} className="flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
