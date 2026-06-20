"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
import {
  AlertCircle, ArrowDown, ArrowUp, Check, CheckCircle2,
  FileCheck, FileDown, GripVertical, Info, Plus,
  Save, Settings, Shield, Trash2, User, Users, X,
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

interface Department {
  id: string;
  name: string;
  section?: string;
  order?: number;
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

// ─── Constants ───────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const CONFIG_SECTIONS = [
  { id: "approvals",    label: "Aprobaciones", icon: FileCheck, description: "Flujo de aprobación para altas de crew" },
  { id: "departments",  label: "Departamentos", icon: GripVertical, description: "Orden de los departamentos en listados" },
  { id: "export",       label: "Exportación",  icon: FileDown, description: "Configuración de exportaciones de crew" },
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
  const [departments, setDepartments]           = useState<Department[]>([]);
  const [exportConfig, setExportConfig]         = useState<ExportConfig>(DEFAULT_EXPORT);
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

      // Departments — load from project departments collection, apply saved order
      const deptSnap = await getDocs(collection(db, `projects/${projectId}/departments`));
      const rawDepts: Department[] = deptSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name || d.id,
        section: d.data().section || "",
        order: d.data().order ?? 999,
      }));

      // Load saved crew department order
      const deptOrderSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "departmentOrder"));
      if (deptOrderSnap.exists()) {
        const savedOrder: string[] = deptOrderSnap.data().order || [];
        const ordered = [...rawDepts].sort((a, b) => {
          const ai = savedOrder.indexOf(a.id);
          const bi = savedOrder.indexOf(b.id);
          if (ai === -1 && bi === -1) return (a.order || 0) - (b.order || 0);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
        setDepartments(ordered);
      } else {
        setDepartments([...rawDepts].sort((a, b) => (a.order || 0) - (b.order || 0)));
      }

      // Export config
      const expSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "exportConfig"));
      if (expSnap.exists()) {
        setExportConfig({ ...DEFAULT_EXPORT, ...expSnap.data() });
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
        order: departments.map((d) => d.id),
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      // Export config
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "exportConfig"), {
        ...exportConfig,
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
            Define el orden en que aparecen los departamentos en los listados y exportaciones de crew
          </p>
        </div>

        {departments.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-slate-500">No hay departamentos configurados</p>
            <p className="text-xs text-slate-400 mt-1">Crea departamentos en la configuración del proyecto</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {departments.map((dept, i) => (
              <div key={dept.id} className="flex items-center gap-3 px-6 py-3">
                <span className="w-5 text-center text-xs font-mono text-slate-400 flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{dept.name}</p>
                  {dept.section && <p className="text-xs text-slate-400 capitalize">{dept.section}</p>}
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => moveDept(i, -1)} disabled={i === 0}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 transition-colors">
                    <ArrowUp size={13} />
                  </button>
                  <button onClick={() => moveDept(i, 1)} disabled={i === departments.length - 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-20 transition-colors">
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 text-xs text-slate-500 px-1">
        <Info size={13} className="flex-shrink-0 mt-0.5 text-slate-400" />
        <span>Este orden se aplica en los listados de crew y en todas las exportaciones. Los departamentos sin asignar aparecen al final.</span>
      </div>
    </div>
  );

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
