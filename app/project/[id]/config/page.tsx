"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import {
  Edit2,
  Save,
  Building2,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  Archive,
  Copy,
  Trash2,
  MoreHorizontal,
  Calendar,
  RefreshCw,
  X,
  Film,
  Tv,
  Clapperboard,
  Hash,
  Clock,
  Users,
  MapPin,
} from "lucide-react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc, collection, getDocs, Timestamp, deleteDoc, setDoc } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

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
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-2xl text-sm font-medium shadow-lg flex items-center gap-2 ${
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
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Configuración del proyecto</h1>
            </div>
      
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
                      onClick={copyProjectId}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-3 text-slate-700"
                    >
                      <Copy size={15} className="text-slate-400" /> Copiar ID
                    </button>
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

      {/* Content */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Panel: Información del proyecto + Productoras */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Información del proyecto</h2>
            {!editingProject && (
              <button
                onClick={() => setEditingProject(true)}
                className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-200"
              >
                <Edit2 size={14} />
                Editar
              </button>
            )}
          </div>

          <div className="p-6">
            {!editingProject ? (
              <div className="space-y-6">
                {/* Datos del proyecto */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Nombre</label>
                    <p className="text-lg font-semibold text-slate-900">{project?.name}</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Fase</label>
                    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium bg-slate-100 text-slate-700">
                      {project?.phase}
                    </span>
                  </div>
                  {project?.description && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Descripción</label>
                      <p className="text-slate-600 leading-relaxed">{project.description}</p>
                    </div>
                  )}
                </div>

                {/* Productoras */}
                <div className="pt-5 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Productoras</label>
                  {project?.producers && project.producers.length > 0 ? (
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
                    ) : (
                      <p className="text-sm text-slate-400">Sin productoras asociadas</p>
                    )}
                  </div>

                  {/* Fechas */}
                  <div className="flex items-center gap-6 pt-5 border-t border-slate-100">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Calendar size={14} />
                      Creado {formatDate(project?.createdAt!)}
                    </div>
                    {project?.updatedAt && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <RefreshCw size={14} />
                        Actualizado {formatDate(project.updatedAt)}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Nombre</label>
                    <input
                      type="text"
                      value={projectForm.name}
                      onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Fase</label>
                    <select
                      value={projectForm.phase}
                      onChange={(e) => setProjectForm({ ...projectForm, phase: e.target.value })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                    >
                      {PHASES.map((p) => (<option key={p} value={p}>{p}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Descripción</label>
                    <textarea
                      value={projectForm.description}
                      onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                      placeholder="Descripción del proyecto..."
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleSaveProject}
                      disabled={saving || !projectForm.name}
                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      <Save size={16} />
                      {saving ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingProject(false);
                        setProjectForm({ name: project?.name || "", phase: project?.phase || "", description: project?.description || "" });
                      }}
                      className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-200"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

        {/* Production Data Section */}
        <div className="mt-6">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Datos de producción</h2>
              {!editingProduction && productionData.projectType && (
                <button
                  onClick={() => setEditingProduction(true)}
                  className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-200"
                >
                  <Edit2 size={14} />
                  Editar
                </button>
              )}
            </div>

            <div className="p-6">
              {!editingProduction ? (
                productionData.projectType ? (
                  <div className="space-y-6">
                    {/* Tipo de proyecto */}
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${
                        productionData.projectType === "pelicula" ? "bg-violet-100" : "bg-blue-100"
                      }`}>
                        {productionData.projectType === "pelicula" && <Film size={24} className="text-violet-600" />}
                        {productionData.projectType === "serie" && <Tv size={24} className="text-blue-600" />}
                      </div>
                      <div>
                        <p className="text-lg font-semibold text-slate-900 capitalize">{productionData.projectType}</p>
                        {productionData.format && <p className="text-sm text-slate-500">{productionData.format}</p>}
                      </div>
                    </div>

                    {/* Info grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {productionData.projectType === "serie" && productionData.episodes && (
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-2 mb-1">
                            <Hash size={14} className="text-slate-400" />
                            <span className="text-xs font-medium text-slate-400 uppercase">Capítulos</span>
                          </div>
                          <p className="text-xl font-bold text-slate-900">{productionData.episodes}</p>
                        </div>
                      )}
                      {productionData.episodeDuration && (
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock size={14} className="text-slate-400" />
                            <span className="text-xs font-medium text-slate-400 uppercase">
                              {productionData.projectType === "serie" ? "Dur. capítulo" : "Duración"}
                            </span>
                          </div>
                          <p className="text-xl font-bold text-slate-900">{productionData.episodeDuration} min</p>
                        </div>
                      )}
                      {productionData.shootingDays && (
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-2 mb-1">
                            <Calendar size={14} className="text-slate-400" />
                            <span className="text-xs font-medium text-slate-400 uppercase">Días rodaje</span>
                          </div>
                          <p className="text-xl font-bold text-slate-900">{productionData.shootingDays}</p>
                        </div>
                      )}
                      {productionData.language && (
                        <div className="p-4 bg-slate-50 rounded-xl">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-slate-400 uppercase">Idioma</span>
                          </div>
                          <p className="text-xl font-bold text-slate-900">{productionData.language}</p>
                        </div>
                      )}
                    </div>

                    {/* Títulos */}
                    {(productionData.originalTitle || productionData.workingTitle) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                        {productionData.originalTitle && (
                          <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Título original</label>
                            <p className="text-sm font-medium text-slate-900">{productionData.originalTitle}</p>
                          </div>
                        )}
                        {productionData.workingTitle && (
                          <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Título de trabajo</label>
                            <p className="text-sm font-medium text-slate-900">{productionData.workingTitle}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Calendario de producción */}
                    {(productionData.preproductionStartDate || productionData.shootingStartDate || productionData.shootingEndDate || productionData.postproductionEndDate) && (
                      <div className="pt-4 border-t border-slate-100">
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Calendario de producción</label>
                        <div className="relative">
                          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />
                          <div className="space-y-4">
                            {productionData.preproductionStartDate && (
                              <div className="flex items-center gap-4 relative">
                                <div className="w-8 h-8 rounded-full bg-amber-100 border-2 border-amber-400 flex items-center justify-center z-10">
                                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-400 uppercase">Inicio preproducción</p>
                                  <p className="text-sm font-semibold text-slate-900">{new Date(productionData.preproductionStartDate).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p>
                                </div>
                              </div>
                            )}
                            {productionData.shootingStartDate && (
                              <div className="flex items-center gap-4 relative">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center z-10">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-400 uppercase">Inicio rodaje</p>
                                  <p className="text-sm font-semibold text-slate-900">{new Date(productionData.shootingStartDate).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p>
                                </div>
                              </div>
                            )}
                            {productionData.shootingEndDate && (
                              <div className="flex items-center gap-4 relative">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center z-10">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-400 uppercase">Fin rodaje</p>
                                  <p className="text-sm font-semibold text-slate-900">{new Date(productionData.shootingEndDate).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p>
                                </div>
                              </div>
                            )}
                            {productionData.postproductionEndDate && (
                              <div className="flex items-center gap-4 relative">
                                <div className="w-8 h-8 rounded-full bg-violet-100 border-2 border-violet-400 flex items-center justify-center z-10">
                                  <div className="w-2 h-2 rounded-full bg-violet-500" />
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-400 uppercase">Fin postproducción</p>
                                  <p className="text-sm font-semibold text-slate-900">{new Date(productionData.postproductionEndDate).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Clapperboard size={24} className="text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-500 mb-4">Configura los datos de tu producción</p>
                    <button
                      onClick={() => setEditingProduction(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
                    >
                      <Edit2 size={16} />
                      Configurar
                    </button>
                  </div>
                )
              ) : (
                <div className="space-y-6">
                  {/* Tipo de proyecto */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Tipo de proyecto</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: "pelicula", label: "Película", icon: Film, color: "violet" },
                        { value: "serie", label: "Serie", icon: Tv, color: "blue" },
                      ].map((type) => {
                        const Icon = type.icon;
                        const isSelected = productionForm.projectType === type.value;
                        return (
                          <button
                            key={type.value}
                            onClick={() => setProductionForm({ ...productionForm, projectType: type.value as ProductionData["projectType"] })}
                            className={`p-4 rounded-xl border-2 transition-all text-center ${
                              isSelected 
                                ? `border-${type.color}-400 bg-${type.color}-50` 
                                : "border-slate-200 hover:border-slate-300"
                            }`}
                            style={isSelected ? { 
                              borderColor: type.color === "violet" ? "#a78bfa" : "#60a5fa",
                              backgroundColor: type.color === "violet" ? "#f5f3ff" : "#eff6ff"
                            } : {}}
                          >
                            <Icon size={24} className={`mx-auto mb-2 ${isSelected ? `text-${type.color}-600` : "text-slate-400"}`} 
                              style={isSelected ? { 
                                color: type.color === "violet" ? "#7c3aed" : "#2563eb"
                              } : {}} />
                            <span className={`text-sm font-medium ${isSelected ? "text-slate-900" : "text-slate-600"}`}>
                              {type.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Campos condicionales según tipo */}
                  {productionForm.projectType && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {productionForm.projectType === "serie" && (
                        <div>
                          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Nº de capítulos</label>
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
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                          {productionForm.projectType === "serie" ? "Duración capítulo (min)" : "Duración (min)"}
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
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Días de rodaje</label>
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
                          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Idioma principal</label>
                          <button
                            type="button"
                            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm bg-white text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                          >
                            <span className={productionForm.language ? "text-slate-900" : "text-slate-400"}>
                              {productionForm.language || "Seleccionar idioma"}
                            </span>
                            <svg className={`w-4 h-4 text-slate-400 transition-transform ${showLanguageDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                          {showLanguageDropdown && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setShowLanguageDropdown(false)} />
                              <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-60 overflow-auto">
                                {LANGUAGES.map((lang) => (
                                  <button
                                    key={lang}
                                    type="button"
                                    onClick={() => {
                                      setProductionForm({ ...productionForm, language: lang });
                                      setShowLanguageDropdown(false);
                                    }}
                                    className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center justify-between ${
                                      productionForm.language === lang ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-700"
                                    }`}
                                  >
                                    {lang}
                                    {productionForm.language === lang && (
                                      <CheckCircle size={16} className="text-emerald-500" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                    </div>
                  )}

                  {/* Títulos */}
                  {productionForm.projectType && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Título original</label>
                        <input
                          type="text"
                          value={productionForm.originalTitle || ""}
                          onChange={(e) => setProductionForm({ ...productionForm, originalTitle: e.target.value })}
                          placeholder="Título original si difiere del nombre"
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Título de trabajo</label>
                        <input
                          type="text"
                          value={productionForm.workingTitle || ""}
                          onChange={(e) => setProductionForm({ ...productionForm, workingTitle: e.target.value })}
                          placeholder="Nombre interno del proyecto"
                          className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* Calendario de producción */}
                  {productionForm.projectType && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">Calendario de producción</label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1.5">Inicio preproducción</label>
                          <input
                            type="date"
                            value={productionForm.preproductionStartDate || ""}
                            onChange={(e) => setProductionForm({ ...productionForm, preproductionStartDate: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1.5">Inicio rodaje</label>
                          <input
                            type="date"
                            value={productionForm.shootingStartDate || ""}
                            onChange={(e) => setProductionForm({ ...productionForm, shootingStartDate: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1.5">Fin rodaje</label>
                          <input
                            type="date"
                            value={productionForm.shootingEndDate || ""}
                            onChange={(e) => setProductionForm({ ...productionForm, shootingEndDate: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1.5">Fin postproducción</label>
                          <input
                            type="date"
                            value={productionForm.postproductionEndDate || ""}
                            onChange={(e) => setProductionForm({ ...productionForm, postproductionEndDate: e.target.value })}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Botones de acción */}
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleSaveProduction}
                      disabled={savingProduction || !productionForm.projectType}
                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 hover:bg-slate-800"
                    >
                      <Save size={16} />
                      {savingProduction ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      onClick={() => {
                        setEditingProduction(false);
                        setProductionForm(productionData);
                      }}
                      className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors border border-slate-200"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
