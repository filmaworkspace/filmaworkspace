"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import ProjectCover from "@/components/ProjectCover";
import {
  Badge, Button, DataList, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal,
  NoAccess, Page, PageHeader, PageLoading, Section, Segmented, Select, Textarea, useToast,
} from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  MoreHorizontal,
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
  coverUrl?: string | null;
  coverPath?: string | null;
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
  const [projectForm, setProjectForm] = useState({ name: "", phase: "", description: "" });
  const [productionData, setProductionData] = useState<ProductionData>(emptyProductionData);
  const [productionForm, setProductionForm] = useState<ProductionData>(emptyProductionData);
  const [editingProduction, setEditingProduction] = useState(false);
  const [savingProduction, setSavingProduction] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const LANGUAGES = [
    "Español", "Inglés", "Francés", "Alemán", "Italiano", 
    "Portugués", "Catalán", "Euskera", "Gallego"
  ];

  const [toastNode, showToast] = useToast();

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
            coverUrl: d.coverUrl || null,
            coverPath: d.coverPath || null,
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

  // Borrado en el servidor: elimina el proyecto con todas sus subcolecciones,
  // archivos y accesos (un deleteDoc desde aquí dejaba todo eso huérfano).
  const deleteProject = async () => {
    if (!id) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/delete-project", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId: id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast("error", data.error || "Error al eliminar");
        return;
      }
      router.push("/dashboard");
    } catch {
      showToast("error", "Error al eliminar");
    }
  };

  const formatDate = (ts: Timestamp) => {
    if (!ts) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(ts.toDate());
  };

  const fmtDay = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : undefined;

  const openEditProject = () => {
    setProjectForm({ name: project?.name || "", phase: project?.phase || "", description: project?.description || "" });
    setEditingProject(true);
  };
  const openEditProduction = () => {
    setProductionForm(productionData);
    setEditingProduction(true);
  };
  const num = (v: string) => (v ? parseInt(v) || undefined : undefined);
  const producerNames = (project?.producers || [])
    .map((pid) => allProducers.find((p) => p.id === pid)?.name)
    .filter(Boolean) as string[];
  const isSerie = productionData.projectType === "serie";

  if (loading) return <PageLoading />;
  if (!hasConfigAccess) return <NoAccess />;

  return (
    <Page>
      {toastNode}

      <PageHeader
        title={<>General{project?.archived && <Badge tone="warning">Archivado</Badge>}</>}
        actions={
          <Menu
            trigger={(toggle) => (
              <IconButton label="Más acciones" onClick={toggle}><MoreHorizontal size={16} /></IconButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); copyProjectId(); }}>Copiar ID del proyecto</MenuItem>
                <MenuItem onClick={() => { close(); archiveProject(); }}>{project?.archived ? "Restaurar proyecto" : "Archivar proyecto"}</MenuItem>
                <MenuSeparator />
                <MenuItem danger onClick={() => { close(); setShowDeleteConfirm(true); }}>Eliminar proyecto</MenuItem>
              </>
            )}
          </Menu>
        }
      />

      <Section title="Proyecto" action={<Button size="sm" onClick={openEditProject}>Editar</Button>}>
        <DataList
          columns={3}
          items={[
            { label: "Nombre", value: project?.name },
            { label: "Fase", value: project?.phase },
            { label: "ID", value: <span className="tabular-nums text-xs text-slate-600">{String(id).slice(0, 12)}</span> },
          ]}
        />
        {project?.description && (
          <div className="mt-5">
            <p className="text-xs text-slate-500">Descripción</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-900">{project.description}</p>
          </div>
        )}
      </Section>

      <Section title="Portada">
        <ProjectCover
          projectId={id as string}
          coverUrl={project?.coverUrl}
          coverPath={project?.coverPath}
          editable
          alwaysShowControls
          className="aspect-[16/5] max-w-xl rounded-lg"
          onChange={(cover) => {
            setProject((prev) => (prev ? { ...prev, coverUrl: cover.url, coverPath: cover.path } : prev));
            showToast("success", cover.url ? "Portada actualizada" : "Portada eliminada");
          }}
          onError={(msg) => showToast("error", msg)}
        />
      </Section>

      <Section title="Producción" action={<Button size="sm" onClick={openEditProduction}>Editar</Button>}>
        <DataList
          columns={4}
          items={[
            { label: "Tipo", value: productionData.projectType === "serie" ? "Serie" : productionData.projectType === "pelicula" ? "Película" : undefined },
            ...(isSerie ? [{ label: "Capítulos", value: productionData.episodes }] : []),
            { label: isSerie ? "Duración por capítulo" : "Duración", value: productionData.episodeDuration ? `${productionData.episodeDuration} min` : undefined },
            { label: "Días de rodaje", value: productionData.shootingDays },
            { label: "Idioma", value: productionData.language },
            { label: "Título original", value: productionData.originalTitle },
            { label: "Título de trabajo", value: productionData.workingTitle },
          ]}
        />
      </Section>

      <Section title="Calendario" action={<Button size="sm" onClick={openEditProduction}>Editar</Button>}>
        <DataList
          columns={4}
          items={[
            { label: "Inicio preproducción", value: fmtDay(productionData.preproductionStartDate) },
            { label: "Inicio rodaje", value: fmtDay(productionData.shootingStartDate) },
            { label: "Fin rodaje", value: fmtDay(productionData.shootingEndDate) },
            { label: "Fin postproducción", value: fmtDay(productionData.postproductionEndDate) },
          ]}
        />
      </Section>

      <Section title="Productoras">
        {producerNames.length ? (
          <div className="flex flex-wrap gap-1.5">{producerNames.map((n) => <Badge key={n}>{n}</Badge>)}</div>
        ) : (
          <p className="text-[13px] text-slate-400">Sin productoras asignadas</p>
        )}
      </Section>

      <Section title="Registro">
        <DataList
          columns={3}
          items={[
            { label: "Creado", value: project?.createdAt ? formatDate(project.createdAt) : undefined },
            { label: "Última modificación", value: project?.updatedAt ? formatDate(project.updatedAt) : undefined },
          ]}
        />
      </Section>

      {/* ── Editar proyecto ── */}
      <Modal
        open={editingProject && !editingProduction}
        onClose={() => setEditingProject(false)}
        title="Editar proyecto"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingProject(false)}>Cancelar</Button>
            <Button variant="primary" loading={saving} disabled={!projectForm.name.trim()} onClick={handleSaveProject}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre">
            <Input value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Fase">
            <Select value={projectForm.phase} onChange={(e) => setProjectForm({ ...projectForm, phase: e.target.value })}>
              <option value="" disabled>Seleccionar</option>
              {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Descripción">
            <Textarea rows={3} value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* ── Editar producción y calendario ── */}
      <Modal
        open={editingProduction && !editingProject}
        onClose={() => setEditingProduction(false)}
        title="Editar producción"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingProduction(false)}>Cancelar</Button>
            <Button variant="primary" loading={savingProduction} onClick={handleSaveProduction}>Guardar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tipo">
            <div>
              <Segmented
                value={productionForm.projectType || ""}
                onChange={(v) => setProductionForm({ ...productionForm, projectType: v as ProductionData["projectType"] })}
                options={[{ value: "pelicula", label: "Película" }, { value: "serie", label: "Serie" }]}
              />
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            {productionForm.projectType === "serie" && (
              <Field label="Capítulos">
                <Input type="number" min={1} value={productionForm.episodes ?? ""} onChange={(e) => setProductionForm({ ...productionForm, episodes: num(e.target.value) })} />
              </Field>
            )}
            <Field label={productionForm.projectType === "serie" ? "Min. por capítulo" : "Duración (min)"}>
              <Input type="number" min={1} value={productionForm.episodeDuration ?? ""} onChange={(e) => setProductionForm({ ...productionForm, episodeDuration: num(e.target.value) })} />
            </Field>
            <Field label="Días de rodaje">
              <Input type="number" min={1} value={productionForm.shootingDays ?? ""} onChange={(e) => setProductionForm({ ...productionForm, shootingDays: num(e.target.value) })} />
            </Field>
          </div>
          <Field label="Idioma">
            <Select value={productionForm.language || ""} onChange={(e) => setProductionForm({ ...productionForm, language: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Título original">
              <Input value={productionForm.originalTitle || ""} onChange={(e) => setProductionForm({ ...productionForm, originalTitle: e.target.value })} />
            </Field>
            <Field label="Título de trabajo">
              <Input value={productionForm.workingTitle || ""} onChange={(e) => setProductionForm({ ...productionForm, workingTitle: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <Field label="Inicio preproducción">
              <Input type="date" value={productionForm.preproductionStartDate || ""} onChange={(e) => setProductionForm({ ...productionForm, preproductionStartDate: e.target.value })} />
            </Field>
            <Field label="Inicio rodaje">
              <Input type="date" value={productionForm.shootingStartDate || ""} onChange={(e) => setProductionForm({ ...productionForm, shootingStartDate: e.target.value })} />
            </Field>
            <Field label="Fin rodaje">
              <Input type="date" value={productionForm.shootingEndDate || ""} onChange={(e) => setProductionForm({ ...productionForm, shootingEndDate: e.target.value })} />
            </Field>
            <Field label="Fin postproducción">
              <Input type="date" value={productionForm.postproductionEndDate || ""} onChange={(e) => setProductionForm({ ...productionForm, postproductionEndDate: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      {/* ── Eliminar ── */}
      <Modal
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Eliminar proyecto"
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
            <Button variant="danger" onClick={deleteProject}>Eliminar</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">Se eliminará <span className="font-medium text-slate-900">{project?.name}</span>. Esta acción no se puede deshacer.</p>
      </Modal>
    </Page>
  );
}
