"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, query, orderBy as fbOrderBy, setDoc, deleteDoc, where, Timestamp,
} from "firebase/firestore";
import {
  AlertCircle, ArrowDown, ArrowUp, Banknote, Car, Check, CheckCircle2,
  ClipboardList, Copy, ExternalLink, FileCheck, FileDown, Globe, GripVertical, Home,
  Info, Link2, Lock, Plane, Plus, Save, Settings, Shield, Trash2, Utensils,
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

type AKey = "meals"|"halfPerDiem"|"perDiem"|"halfIntlPerDiem"|"intlPerDiem"|"accommodation"|"car";

const ACCESS_ALLOWANCES: { key: AKey; label: string }[] = [
  { key: "meals",           label: "Comidas"               },
  { key: "halfPerDiem",     label: "½ Dieta nacional"      },
  { key: "perDiem",         label: "Dieta nacional"        },
  { key: "halfIntlPerDiem", label: "½ Dieta internacional" },
  { key: "intlPerDiem",     label: "Dieta internacional"   },
  { key: "accommodation",   label: "Alojamiento"           },
  { key: "car",             label: "Vehículo"              },
];

interface AccessEntry {
  id: string;
  name: string;
  people: Array<{ memberId: string; firstName: string; lastName1: string; department?: string; section?: string }>;
  pin: string | null;
  allowedTypes: AKey[];
  active: boolean;
  createdAt?: Date;
}

interface CrewEntry {
  id: string;
  firstName: string;
  lastName1: string;
  role: string;
  department?: string;
  section: string;
  status: string;
}

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const CONFIG_SECTIONS = [
  { id: "approvals",    label: "Aprobaciones",  icon: FileCheck,     description: "Flujo de aprobación para altas de crew" },
  { id: "departments",  label: "Departamentos", icon: GripVertical,  description: "Orden de los departamentos en listados" },
  { id: "payroll",      label: "Nóminas",       icon: Banknote,      description: "Tarifas globales de dietas y complementos" },
  { id: "accesos",      label: "Accesos",       icon: Link2,         description: "Links de coordinación para marcar complementos" },
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

  // Accesos
  const [accesos,          setAccesos]          = useState<AccessEntry[]>([]);
  const [crew,             setCrew]             = useState<CrewEntry[]>([]);
  const [projectName,      setProjectName]      = useState("");
  const [showAccessModal,  setShowAccessModal]  = useState(false);
  const [accessDraftName,  setAccessDraftName]  = useState("");
  const [accessDraftPeople,setAccessDraftPeople]= useState<Set<string>>(new Set());
  const [accessDraftPIN,   setAccessDraftPIN]   = useState("");
  const [accessDraftUsePIN,setAccessDraftUsePIN]= useState(false);
  const [accessDraftTypes, setAccessDraftTypes] = useState<Set<AKey>>(new Set(ACCESS_ALLOWANCES.map(a => a.key)));
  const [savingAccess,     setSavingAccess]     = useState(false);
  const [confirmDialog,    setConfirmDialog]    = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);

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

      // Project name
      const projSnap = await getDoc(doc(db, "projects", projectId));
      if (projSnap.exists()) setProjectName(projSnap.data().name || projSnap.data().title || "");

      // Crew list for people picker
      const crewSnap2 = await getDocs(collection(db, `projects/${projectId}/crew`));
      setCrew(crewSnap2.docs
        .filter(d => (d.data().status || "active") !== "inactive")
        .map(d => ({
          id: d.id,
          firstName:  d.data().firstName  || d.data().name || "",
          lastName1:  d.data().lastName1  || "",
          role:       d.data().role       || "",
          department: d.data().department || "",
          section:    d.data().section    || "technical",
          status:     d.data().status     || "active",
        }))
        .sort((a, b) => `${a.firstName} ${a.lastName1}`.localeCompare(`${b.firstName} ${b.lastName1}`)));

      // Accesos
      await loadAccesos();
    } catch (e) { console.error(e); }
  };

  const loadAccesos = async () => {
    try {
      const snap = await getDocs(query(collection(db, "access"), where("projectId", "==", projectId)));
      setAccesos(snap.docs.map(d => ({
        id:           d.id,
        name:         d.data().name         || "",
        people:       d.data().people       || [],
        pin:          d.data().pin          || null,
        allowedTypes: d.data().allowedTypes || [],
        active:       d.data().active       ?? true,
        createdAt:    d.data().createdAt?.toDate(),
      })).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)));
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

  // ── Access helpers ─────────────────────────────────────────────────────────

  const openCreateAccess = () => {
    setAccessDraftName("");
    setAccessDraftPeople(new Set());
    setAccessDraftPIN("");
    setAccessDraftUsePIN(false);
    setAccessDraftTypes(new Set(ACCESS_ALLOWANCES.map(a => a.key)));

    setShowAccessModal(true);
  };

  const saveAccess = async () => {
    if (!accessDraftName.trim() || accessDraftPeople.size === 0) return;
    setSavingAccess(true);
    try {
      const code = genCode();
      const people = crew
        .filter(m => accessDraftPeople.has(m.id))
        .map(m => ({
          memberId:   m.id,
          firstName:  m.firstName,
          lastName1:  m.lastName1,
          department: m.department || "",
          section:    m.section    || "",
        }));
      await setDoc(doc(db, "access", code), {
        code,
        name:         accessDraftName.trim(),
        projectId,
        projectName,
        color:        TEAM_COLOR,
        people,
        pin:          accessDraftUsePIN && accessDraftPIN.trim() ? accessDraftPIN.trim() : null,
        allowedTypes: Array.from(accessDraftTypes),
        active:       true,
        createdAt:    Timestamp.now(),
        createdBy:    userId,
      });
      setShowAccessModal(false);
      await loadAccesos();
    } catch (e) { console.error(e); showError("Error al crear el acceso"); }
    finally { setSavingAccess(false); }
  };

  const toggleAccessActive = async (entry: AccessEntry) => {
    await setDoc(doc(db, "access", entry.id), { active: !entry.active }, { merge: true });
    await loadAccesos();
  };

  const deleteAccess = (id: string, name: string) => {
    setConfirmDialog({
      title: "Eliminar acceso",
      message: `¿Eliminar "${name}"? El enlace dejará de funcionar y no se puede deshacer.`,
      confirmLabel: "Eliminar",
      onConfirm: async () => {
        setConfirmDialog(null);
        await deleteDoc(doc(db, "access", id));
        await loadAccesos();
      },
    });
  };

  const copyLink = (entry: AccessEntry) => {
    const url = `${window.location.origin}/access/${entry.id}`;
    const lines = [
      `Hola, aquí tienes el enlace para marcar los complementos:`,
      ``,
      url,
    ];
    if (entry.pin) {
      lines.push(``, `PIN: ${entry.pin}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    showSuccess("Mensaje copiado");
  };

  const toggleAccessType = (key: AKey) => {
    setAccessDraftTypes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAccessPerson = (id: string) => {
    setAccessDraftPeople(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

const renderAccesos = () => (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Accesos de coordinación</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Links para que coordinadores marquen complementos sin acceso a la plataforma
            </p>
          </div>
          <button
            onClick={openCreateAccess}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: TEAM_COLOR }}>
            <Plus size={13} /> Nuevo acceso
          </button>
        </div>

        {accesos.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Link2 size={20} className="text-slate-400" />
            </div>
            <p className="text-sm text-slate-500">No hay accesos creados</p>
            <p className="text-xs text-slate-400 mt-1">
              Crea un acceso y comparte el enlace con tu coordinador
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {accesos.map(entry => (
              <div key={entry.id} className={`px-6 py-4 ${!entry.active ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-4">
                  {/* Color dot + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-900">{entry.name}</p>
                      {!entry.active && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full uppercase tracking-wide">
                          Inactivo
                        </span>
                      )}
                      {entry.pin && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-600 rounded-full flex items-center gap-1">
                          <Lock size={9} /> PIN
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {entry.people.length} {entry.people.length === 1 ? "persona" : "personas"} ·{" "}
                      {entry.allowedTypes.length} complemento{entry.allowedTypes.length !== 1 ? "s" : ""}
                    </p>
                    <p className="text-[10px] font-mono text-slate-300 mt-1 truncate">
                      /access/{entry.id}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Copy link */}
                    <button
                      onClick={() => copyLink(entry)}
                      title="Copiar mensaje con enlace"
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                      <Copy size={14} />
                    </button>
                    {/* Open */}
                    <a
                      href={`/access/${entry.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir acceso"
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                      <ExternalLink size={14} />
                    </a>
                    {/* Toggle active */}
                    <button
                      onClick={() => toggleAccessActive(entry)}
                      title={entry.active ? "Desactivar" : "Activar"}
                      className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ml-1"
                      style={{ backgroundColor: entry.active ? TEAM_COLOR : "#e2e8f0" }}>
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${entry.active ? "left-0.5 translate-x-4" : "left-0.5"}`} />
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => deleteAccess(entry.id, entry.name)}
                      title="Eliminar"
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors ml-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* People pills */}
                {entry.people.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {entry.people.slice(0, 8).map(p => (
                      <span key={p.memberId}
                        className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                        {p.firstName} {p.lastName1}
                      </span>
                    ))}
                    {entry.people.length > 8 && (
                      <span className="text-[11px] font-medium px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full">
                        +{entry.people.length - 8} más
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

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
          { key: "halfPerDiemRate", badge: "Técnicos", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "halfPerDiemRateArtistic", badge: "Actores", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Dieta nacional", description: "Nacional — dieta completa/día", icon: <Plane size={15} className="text-sky-500" />,
        fields: [
          { key: "perDiemRate", badge: "Técnicos", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "perDiemRateArtistic", badge: "Actores", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Media dieta internacional", description: "Internacional — media dieta/día", icon: <Globe size={15} className="text-indigo-300" />,
        fields: [
          { key: "halfIntlPerDiemRate", badge: "Técnicos", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "halfIntlPerDiemRateArtistic", badge: "Actores", badgeColor: "bg-violet-50 text-violet-600" },
        ],
      },
      {
        label: "Dieta internacional", description: "Internacional — dieta completa", icon: <Globe size={15} className="text-indigo-500" />,
        fields: [
          { key: "intlPerDiemRate", badge: "Técnicos", badgeColor: "bg-blue-50 text-blue-600" },
          { key: "intlPerDiemRateArtistic", badge: "Actores", badgeColor: "bg-violet-50 text-violet-600" },
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
              Importes por defecto en Nóminas. Las dietas tienen tarifa separada para Técnicos y Actores.
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
        <div className="px-24 py-6">
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
      <main className="px-24 py-8">
        <div className="flex flex-row gap-6">

          {/* Sidebar */}
          <div className="w-52 flex-shrink-0">
            <div className="sticky top-20">
              <nav className="flex flex-col gap-1 overflow-x-auto overflow-x-visible pb-2 pb-0">
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
            {activeSection === "accesos"     && renderAccesos()}
            {activeSection === "form"        && renderFormBuilder()}
            {activeSection === "export"      && renderExport()}
          </div>
        </div>
      </main>

      {/* ── Create access modal ─────────────────────────────────────────── */}
      {showAccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-0 p-4">
          <div className="bg-white rounded-t-3xl rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <p className="text-base font-bold text-slate-900">Nuevo acceso</p>
              <button onClick={() => setShowAccessModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nombre del acceso</label>
                <input
                  type="text"
                  value={accessDraftName}
                  onChange={e => setAccessDraftName(e.target.value)}
                  placeholder="Título del evento"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>

              {/* People */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Personas ({accessDraftPeople.size} seleccionadas)
                </label>
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                  {crew.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-slate-400">No hay crew activo</p>
                  ) : crew.map(m => {
                    const sel = accessDraftPeople.has(m.id);
                    return (
                      <button key={m.id} onClick={() => toggleAccessPerson(m.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-0 ${sel ? "bg-green-50" : "hover:bg-slate-50"}`}>
                        <div className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${sel ? "border-transparent" : "border-slate-300"}`}
                          style={sel ? { backgroundColor: TEAM_COLOR } : {}}>
                          {sel && <Check size={12} className="text-white" strokeWidth={2.5} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{m.firstName} {m.lastName1}</p>
                          {(m.role || m.department) && (
                            <p className="text-xs text-slate-400 truncate">{m.role}{m.department ? ` · ${m.department}` : ""}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Complement types */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Complementos visibles</label>
                <div className="flex flex-wrap gap-2">
                  {ACCESS_ALLOWANCES.map(a => {
                    const on = accessDraftTypes.has(a.key);
                    return (
                      <button key={a.key} onClick={() => toggleAccessType(a.key)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${on ? "border-transparent text-white" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
                        style={on ? { backgroundColor: TEAM_COLOR } : {}}>
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PIN */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Proteger con PIN</p>
                    <p className="text-xs text-slate-400 mt-0.5">El coordinador deberá introducir un PIN para acceder</p>
                  </div>
                  <button onClick={() => {
                    const next = !accessDraftUsePIN;
                    setAccessDraftUsePIN(next);
                    if (next && !accessDraftPIN) {
                      setAccessDraftPIN(String(Math.floor(1000 + Math.random() * 9000)));
                    }
                  }}
                    className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                    style={{ backgroundColor: accessDraftUsePIN ? TEAM_COLOR : "#e2e8f0" }}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${accessDraftUsePIN ? "left-0.5 translate-x-5" : "left-0.5"}`} />
                  </button>
                </div>
                {accessDraftUsePIN && (
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    value={accessDraftPIN}
                    onChange={e => setAccessDraftPIN(e.target.value.replace(/\D/g, ""))}
                    placeholder="PIN numérico"
                    className="w-full text-sm font-mono tracking-widest border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                  />
                )}
              </div>

            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 flex-shrink-0 bg-white">
              <button onClick={() => setShowAccessModal(false)}
                className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
                Cancelar
              </button>
              <button
                onClick={saveAccess}
                disabled={savingAccess || !accessDraftName.trim() || accessDraftPeople.size === 0}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: TEAM_COLOR }}>
                {savingAccess ? (
                  <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Creando…</>
                ) : (
                  <><Link2 size={14} /> Crear acceso</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ── Confirm dialog ─────────────────────────────────────────────────── */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                Cancelar
              </button>
              <button onClick={confirmDialog.onConfirm}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
