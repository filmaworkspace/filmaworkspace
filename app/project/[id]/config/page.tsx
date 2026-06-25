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
  Archive,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  Clapperboard,
  Clock,
  Copy,
  Edit2,
  Hash,
  MapPin,
  MoreHorizontal,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectData {
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  archived?: boolean;
}

interface Producer {
  id: string;
  name: string;
}

interface ProductionData {
  projectType: "pelicula" | "serie" | "";
  episodes?: number;
  episodeDuration?: number;
  totalDuration?: number;
  shootingDays?: number;
  shootingStartDate?: string;
  shootingEndDate?: string;
  preproductionStartDate?: string;
  postproductionEndDate?: string;
  language?: string;
  originalTitle?: string;
  workingTitle?: string;
}

const emptyProductionData: ProductionData = {
  projectType: "",
  episodes: undefined,
  episodeDuration: undefined,
  totalDuration: undefined,
  shootingDays: undefined,
  shootingStartDate: "",
  shootingEndDate: "",
  preproductionStartDate: "",
  postproductionEndDate: "",
  language: "Español",
  originalTitle: "",
  workingTitle: "",
};

// ─────────────────────────────────────────────────────────────────────────────

export default function ConfigGeneral() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasConfigAccess, setHasConfigAccess] = useState(false);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [allProducers, setAllProducers] = useState<Producer[]>([]);
  const [editingProject, setEditingProject] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [projectForm, setProjectForm] = useState({ name: "", phase: "", description: "" });
  const [productionData, setProductionData] = useState<ProductionData>(emptyProductionData);
  const [productionForm, setProductionForm] = useState<ProductionData>(emptyProductionData);
  const [editingProduction, setEditingProduction] = useState(false);
  const [savingProduction, setSavingProduction] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);

  const LANGUAGES = [
    "Español", "Inglés", "Francés", "Alemán", "Italiano", 
    "Portugués", "Catalán", "Euskera", "Gallego"
  ];

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/");
      else setUserId(u.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
        if (!userProjectSnap.exists()) {
          setLoading(false);
          return;
        }
        const hasConfig = userProjectSnap.data().permissions?.config || false;
        setHasConfigAccess(hasConfig);
        if (!hasConfig) {
          setLoading(false);
          return;
        }

        const projectSnap = await getDoc(doc(db, "projects", id as string));
        if (projectSnap.exists()) {
          const d = projectSnap.data();
          setProject({
            name: d.name,
            phase: d.phase,
            description: d.description || "",
            producers: d.producers || [],
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
            archived: d.archived || false,
          });
          setProjectForm({ name: d.name, phase: d.phase, description: d.description || "" });
        }

        const productionSnap = await getDoc(doc(db, `projects/${id}/config`, "production"));
        if (productionSnap.exists()) {
          const data = productionSnap.data() as ProductionData;
          setProductionData(data);
          setProductionForm(data);
        }

        const producersSnap = await getDocs(collection(db, "producers"));
        setAllProducers(producersSnap.docs.map((d) => ({ id: d.id, name: d.data().name })));
        setLoading(false);
      } catch {
        showToast("error", "Error al cargar los datos");
        setLoading(false);
      }
    };
    loadData();
  }, [userId, id, router]);

  const handleSaveProject = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", id as string), {
        name: projectForm.name,
        phase: projectForm.phase,
        description: projectForm.description,
        updatedAt: Timestamp.now()
      });
      setProject({
        ...project!,
        name: projectForm.name,
        phase: projectForm.phase,
        description: projectForm.description,
        updatedAt: Timestamp.now()
      });
      setEditingProject(false);
      showToast("success", "Cambios guardados");
    } catch {
      showToast("error", "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProduction = async () => {
    if (!id) return;
    setSavingProduction(true);
    try {
      // Limpiar valores undefined antes de guardar
      const dataToSave: Record<string, any> = {
        projectType: productionForm.projectType,
        updatedAt: Timestamp.now(),
      };
      
      if (productionForm.episodes) dataToSave.episodes = productionForm.episodes;
      if (productionForm.episodeDuration) dataToSave.episodeDuration = productionForm.episodeDuration;
      if (productionForm.totalDuration) dataToSave.totalDuration = productionForm.totalDuration;
      if (productionForm.shootingDays) dataToSave.shootingDays = productionForm.shootingDays;
      if (productionForm.shootingStartDate) dataToSave.shootingStartDate = productionForm.shootingStartDate;
      if (productionForm.shootingEndDate) dataToSave.shootingEndDate = productionForm.shootingEndDate;
      if (productionForm.preproductionStartDate) dataToSave.preproductionStartDate = productionForm.preproductionStartDate;
      if (productionForm.postproductionEndDate) dataToSave.postproductionEndDate = productionForm.postproductionEndDate;
      if (productionForm.language) dataToSave.language = productionForm.language;
      if (productionForm.originalTitle) dataToSave.originalTitle = productionForm.originalTitle;
      if (productionForm.workingTitle) dataToSave.workingTitle = productionForm.workingTitle;

      await setDoc(doc(db, `projects/${id}/config`, "production"), dataToSave);
      setProductionData(productionForm);
      setEditingProduction(false);
      showToast("success", "Datos de producción guardados");
    } catch (err: any) {
      console.error("Error saving production data:", err);
      console.error("Error code:", err?.code);
      console.error("Error message:", err?.message);
      showToast("error", err?.message || "Error al guardar datos de producción");
    } finally {
      setSavingProduction(false);
    }
  };

  const copyProjectId = () => {
    navigator.clipboard.writeText(id as string);
    showToast("success", "ID copiado al portapapeles");
    setShowActions(false);
  };

  const archiveProject = async () => {
    if (!id || !project) return;
    try {
      await updateDoc(doc(db, "projects", id as string), {
        archived: !project.archived,
        updatedAt: Timestamp.now(),
      });
      setProject({ ...project, archived: !project.archived });
      showToast("success", project.archived ? "Proyecto restaurado" : "Proyecto archivado");
      setShowActions(false);
    } catch {
      showToast("error", "Error");
    }
  };

  const deleteProject = async () => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "projects", id as string));
      router.push("/dashboard");
    } catch {
      showToast("error", "Error al eliminar");
    }
  };

  const formatDate = (ts: Timestamp) => {
    if (!ts) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(ts.toDate());
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasConfigAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} className="text-slate-400" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">No tienes acceso a esta configuración</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Volver a Proyectos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-2xl text-sm font-medium shadow-lg flex items-center gap-2 ${
          toast.type === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">¿Eliminar proyecto?</h3>
              <button onClick={() => setShowDeleteConfirm(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-6">Esta acción no se puede deshacer. Se eliminarán todos los datos del proyecto.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={deleteProject}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Settings size={24} className="text-slate-900" />
              <h1 className="text-2xl font-semibold text-slate-900">Configuración del proyecto</h1>
            </div>
      
            <div className="flex items-center gap-2">
              {!editingProject && !editingProduction && (
                <button
                  onClick={() => { setEditingProject(true); setEditingProduction(true); }}
                  className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors bg-slate-900"
                >
                  <Edit2 size={16} />
                  Editar
                </button>
              )}
              <div className="relative">
                <button
                  onClick={() => setShowActions(!showActions)}
                  className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                >
                  <MoreHorizontal size={20} className="text-slate-500" />
                </button>
      
                {showActions && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowActions(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-20">
                      <button
                        onClick={archiveProject}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                      >
                        <Archive size={15} className="text-slate-400" /> {project?.archived ? "Restaurar" : "Archivar"}
                      </button>
                      <div className="border-t border-slate-100 my-1" />
                      <button
                        onClick={() => { setShowActions(false); setShowDeleteConfirm(true); }}
                        className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                      >
                        <Trash2 size={15} /> Eliminar proyecto
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="px-24 py-8">
        {!editingProject && !editingProduction ? (
          /* VIEW MODE */
          <div className="space-y-8">
            {/* Project Identity */}
            <section>
              <div className="flex items-baseline gap-4 mb-1">
                <h2 className="text-3xl font-bold text-slate-900">{project?.name}</h2>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">{project?.phase}</span>
              </div>
              {project?.description && (
                <p className="text-slate-500 mt-2 max-w-2xl">{project.description}</p>
              )}
              <div className="flex items-center gap-4 mt-4">
                <button
                  onClick={copyProjectId}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Copy size={12} />
                  <span className="font-mono">{id?.toString().substring(0, 8)}...</span>
                </button>
                <span className="text-slate-200">|</span>
                <span className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Calendar size={12} />
                  Creado {formatDate(project?.createdAt!)}
                </span>
                {project?.updatedAt && (
                  <>
                    <span className="text-slate-200">|</span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                      <RefreshCw size={12} />
                      Actualizado {formatDate(project.updatedAt)}
                    </span>
                  </>
                )}
              </div>
            </section>

            {/* Divider */}
            <div className="border-t border-slate-100" />

            {/* Production Type & Stats */}
            {productionData.projectType ? (
              <section>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full table-fixed">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Tipo</th>
                        {productionData.projectType === "serie" && productionData.episodes && (
                          <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Capítulos</th>
                        )}
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">
                          {productionData.projectType === "serie" ? "Dur. capítulo" : "Duración"}
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Días de rodaje</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Idioma</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-4 py-3 text-base font-semibold text-slate-900 capitalize">{productionData.projectType}</td>
                        {productionData.projectType === "serie" && productionData.episodes && (
                          <td className="px-4 py-3 text-base font-semibold text-slate-900">{productionData.episodes}</td>
                        )}
                        <td className="px-4 py-3 text-base font-semibold text-slate-900">
                          {productionData.episodeDuration ? `${productionData.episodeDuration} min` : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-base font-semibold text-slate-900">
                          {productionData.shootingDays || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-base font-semibold text-slate-900">
                          {productionData.language || <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="py-6 text-center">
                <Clapperboard size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-400 mb-4">Aún no has configurado los datos de producción</p>
                <button
                  onClick={() => setEditingProduction(true)}
                  className="text-sm font-medium text-slate-900 hover:text-slate-700 transition-colors"
                >
                  Añadir datos de producción →
                </button>
              </section>
            )}

            {/* Titles */}
            {(productionData.originalTitle || productionData.workingTitle) && (
              <>
                <div className="border-t border-slate-100" />
                <section className="flex flex-wrap gap-x-12 gap-y-4">
                  {productionData.originalTitle && (
                    <div>
                      <span className="text-xs text-slate-400 uppercase tracking-wide">Título original</span>
                      <p className="text-lg font-medium text-slate-900">{productionData.originalTitle}</p>
                    </div>
                  )}
                  {productionData.workingTitle && (
                    <div>
                      <span className="text-xs text-slate-400 uppercase tracking-wide">Título de trabajo</span>
                      <p className="text-lg font-medium text-slate-900">{productionData.workingTitle}</p>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Timeline */}
            {(productionData.preproductionStartDate || productionData.shootingStartDate || productionData.shootingEndDate || productionData.postproductionEndDate) && (
              <>
                <div className="border-t border-slate-100" />
                <section>
                  <h3 className="text-xs text-slate-400 uppercase tracking-wide mb-4">Calendario</h3>
                  <div className="flex flex-wrap gap-6">
                    {productionData.preproductionStartDate && (
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                        <div>
                          <p className="text-xs text-slate-400">Preproducción</p>
                          <p className="text-sm font-medium text-slate-900">
                            {new Date(productionData.preproductionStartDate).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    )}
                    {productionData.shootingStartDate && (
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <div>
                          <p className="text-xs text-slate-400">Inicio rodaje</p>
                          <p className="text-sm font-medium text-slate-900">
                            {new Date(productionData.shootingStartDate).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    )}
                    {productionData.shootingEndDate && (
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <div>
                          <p className="text-xs text-slate-400">Fin rodaje</p>
                          <p className="text-sm font-medium text-slate-900">
                            {new Date(productionData.shootingEndDate).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    )}
                    {productionData.postproductionEndDate && (
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-violet-500" />
                        <div>
                          <p className="text-xs text-slate-400">Fin postproducción</p>
                          <p className="text-sm font-medium text-slate-900">
                            {new Date(productionData.postproductionEndDate).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* Producers */}
            {project?.producers && project.producers.length > 0 && (
              <>
                <div className="border-t border-slate-100" />
                <section>
                  <h3 className="text-xs text-slate-400 uppercase tracking-wide mb-3">Productoras</h3>
                  <div className="flex flex-wrap gap-2">
                    {project.producers.map((producerId) => {
                      const producer = allProducers.find((p) => p.id === producerId);
                      if (!producer) return null;
                      return (
                        <div key={producer.id} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
                          <Building2 size={14} className="text-amber-600" />
                          <span className="text-sm font-medium text-amber-700">{producer.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
          </div>
        ) : (
          /* EDIT MODE */
          <div className="space-y-8">
            {/* Project Info */}
            <section className="space-y-5">
              <h3 className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Información básica</h3>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del proyecto</label>
                  <input
                    type="text"
                    value={projectForm.name}
                    onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Fase actual</label>
                  <button
                    type="button"
                    onClick={() => setShowPhaseDropdown(!showPhaseDropdown)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                  >
                    <span className={projectForm.phase ? "text-slate-900" : "text-slate-400"}>
                      {projectForm.phase || "Seleccionar"}
                    </span>
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${showPhaseDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showPhaseDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowPhaseDropdown(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
                        {PHASES.map((p) => (
                          <button
                            key={p}
                            onClick={() => { setProjectForm({ ...projectForm, phase: p }); setShowPhaseDropdown(false); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${projectForm.phase === p ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                <textarea
                  value={projectForm.description}
                  onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  placeholder="Breve descripción del proyecto"
                />
              </div>
            </section>

            <div className="border-t border-slate-100" />

            {/* Production Data */}
            <section className="space-y-5">
              <h3 className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Datos de producción</h3>
              
              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de proyecto</label>
                <div className="flex gap-3">
                  {[
                    { value: "pelicula", label: "Película" },
                    { value: "serie", label: "Serie" },
                  ].map((type) => {
                    const isSelected = productionForm.projectType === type.value;
                    return (
                      <button
                        key={type.value}
                        onClick={() => setProductionForm({ ...productionForm, projectType: type.value as ProductionData["projectType"] })}
                        className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isSelected 
                            ? "bg-slate-900 text-white" 
                            : "border border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-4 gap-4">
                {productionForm.projectType === "serie" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Capítulos</label>
                    <input
                      type="number"
                      min="1"
                      value={productionForm.episodes || ""}
                      onChange={(e) => setProductionForm({ ...productionForm, episodes: parseInt(e.target.value) || undefined })}
                      placeholder="10"
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {productionForm.projectType === "serie" ? "Duración cap. (min)" : "Duración (min)"}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={productionForm.episodeDuration || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, episodeDuration: parseInt(e.target.value) || undefined })}
                    placeholder={productionForm.projectType === "serie" ? "45" : "120"}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Días de rodaje</label>
                  <input
                    type="number"
                    min="1"
                    value={productionForm.shootingDays || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, shootingDays: parseInt(e.target.value) || undefined })}
                    placeholder="30"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-2">Idioma</label>
                  <button
                    type="button"
                    onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                  >
                    <span className={productionForm.language ? "text-slate-900" : "text-slate-400"}>
                      {productionForm.language || "Seleccionar"}
                    </span>
                    <svg className={`w-4 h-4 text-slate-400 transition-transform ${showLanguageDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showLanguageDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowLanguageDropdown(false)} />
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 max-h-48 overflow-y-auto">
                        {["Español", "Inglés", "Catalán", "Euskera", "Gallego", "Francés", "Portugués", "Alemán", "Italiano"].map((lang) => (
                          <button
                            key={lang}
                            onClick={() => { setProductionForm({ ...productionForm, language: lang }); setShowLanguageDropdown(false); }}
                            className={`w-full text-left px-4 py-2 text-sm transition-colors ${productionForm.language === lang ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
                          >
                            {lang}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Titles */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Título original</label>
                  <input
                    type="text"
                    value={productionForm.originalTitle || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, originalTitle: e.target.value })}
                    placeholder="Si difiere del nombre"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Título de trabajo</label>
                  <input
                    type="text"
                    value={productionForm.workingTitle || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, workingTitle: e.target.value })}
                    placeholder="Nombre interno"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Inicio preproducción</label>
                  <input
                    type="date"
                    value={productionForm.preproductionStartDate || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, preproductionStartDate: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Inicio rodaje</label>
                  <input
                    type="date"
                    value={productionForm.shootingStartDate || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, shootingStartDate: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Fin rodaje</label>
                  <input
                    type="date"
                    value={productionForm.shootingEndDate || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, shootingEndDate: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Fin postproducción</label>
                  <input
                    type="date"
                    value={productionForm.postproductionEndDate || ""}
                    onChange={(e) => setProductionForm({ ...productionForm, postproductionEndDate: e.target.value })}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
              </div>
            </section>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                onClick={async () => {
                  await handleSaveProject();
                  await handleSaveProduction();
                  setEditingProject(false);
                  setEditingProduction(false);
                }}
                disabled={saving || savingProduction || !projectForm.name}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 bg-slate-900"
              >
                <Save size={16} />
                {saving || savingProduction ? "Guardando..." : "Guardar cambios"}
              </button>
              <button
                onClick={() => {
                  setEditingProject(false);
                  setEditingProduction(false);
                  setProjectForm({ name: project?.name || "", phase: project?.phase || "", description: project?.description || "" });
                  setProductionForm(productionData);
                }}
                className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
