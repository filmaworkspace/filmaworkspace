"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  MoreHorizontal,
  Receipt,
  Star,
  Users,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { coverGradient } from "@/lib/projectCover";
import { MODULE_COLORS, ui } from "@/lib/ui";

// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectMembership {
  projectId: string;
  projectName: string;
  role: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
  notifications: { approvals: boolean; payments: boolean; invoices: boolean; team: boolean };
  archived: boolean;
  favorite: boolean;
  joinedAt: Date;
  phase?: string;
  coverUrl?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Keys match the Spanish values stored in Firestore
const NOTIFICATION_TYPES: { id: string; label: string; description: string; entorno: "accounting" | "team" }[] = [
  { id: "approvals", label: "Aprobaciones", description: "POs y facturas pendientes de aprobación", entorno: "accounting" },
  { id: "payments",  label: "Pagos",        description: "Vencimientos y pagos realizados",         entorno: "accounting" },
  { id: "invoices",  label: "Facturas",     description: "Nuevas facturas y cambios de estado",     entorno: "accounting" },
  { id: "team",      label: "Equipo",       description: "Altas y cambios en el equipo",            entorno: "team"       },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, updateUserName } = useUser();

  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [activeTab, setActiveTab]       = useState<"account" | "projects">("account");
  const [activeSection, setActiveSection] = useState<"profile" | "security">("profile");

  const [formData, setFormData]           = useState({ name: "", email: "" });
  const [passwordData, setPasswordData]   = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword]   = useState({ current: false, new: false, confirm: false });

  const [projects, setProjects]           = useState<ProjectMembership[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectFilter, setProjectFilter] = useState<"all" | "active" | "archived" | "favorites">("active");
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (user) {
      setFormData({ name: user.name || "", email: user.email || "" });
      loadProjects();
    }
  }, [user]);

  useEffect(() => {
    if (!isLoading && !user) router.push("/");
  }, [isLoading, user, router]);

  const loadProjects = async () => {
    if (!user?.uid) return;
    setLoadingProjects(true);
    try {
      const userProjectsSnap = await getDocs(collection(db, `userProjects/${user.uid}/projects`));

      const projectsData = await Promise.all(
        userProjectsSnap.docs.map(async (upDoc) => {
          const upData = upDoc.data();
          const [projectSnap, memberSnap] = await Promise.all([
            getDoc(doc(db, "projects", upDoc.id)),
            getDoc(doc(db, `projects/${upDoc.id}/members`, user.uid)),
          ]);
          if (!projectSnap.exists()) return null;

          const pData      = projectSnap.data();
          const memberData = memberSnap.exists() ? memberSnap.data() : {};

          return {
            projectId:   upDoc.id,
            projectName: pData.name || "Sin nombre",
            role:        memberData.role     || upData.role     || "",
            department:  memberData.department,
            position:    memberData.position,
            permissions: {
              config:     upData.permissions?.config     || false,
              accounting: upData.permissions?.accounting || false,
              team:       upData.permissions?.team       || false,
            },
            notifications: upData.notifications || { approvals: true, payments: true, invoices: true, team: true },
            archived:  upData.archived  || pData.archived || false,
            favorite:  upData.favorite  || false,
            joinedAt:  upData.joinedAt?.toDate() || new Date(),
            phase:     pData.phase,
            coverUrl:  pData.coverUrl || null,
          } as ProjectMembership;
        })
      );

      const valid = projectsData.filter((p): p is ProjectMembership => p !== null);
      valid.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return a.projectName.localeCompare(b.projectName);
      });
      setProjects(valid);
    } catch (error) {
      console.error("Error loading projects:", error);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser)           { showToast("error", "No hay usuario autenticado"); return; }
      if (!formData.name.trim())  { showToast("error", "El nombre no puede estar vacío"); return; }
      await updateProfile(currentUser, { displayName: formData.name.trim() });
      updateUserName(formData.name.trim());
      showToast("success", "Perfil actualizado");
    } catch (err: any) {
      showToast("error", err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser?.email)                                         { showToast("error", "No hay usuario autenticado"); return; }
      if (passwordData.newPassword.length < 6)                         { showToast("error", "Mínimo 6 caracteres"); return; }
      if (passwordData.newPassword !== passwordData.confirmPassword)   { showToast("error", "Las contraseñas no coinciden"); return; }
      const credential = EmailAuthProvider.credential(currentUser.email, passwordData.currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordData.newPassword);
      setPasswordData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      showToast("success", "Contraseña actualizada");
    } catch (err: any) {
      if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        showToast("error", "Contraseña actual incorrecta");
      } else {
        showToast("error", err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleProjectArchive = async (projectId: string) => {
    if (!user?.uid) return;
    const project = projects.find(p => p.projectId === projectId);
    if (!project) return;
    try {
      const newArchived = !project.archived;
      // Para uno mismo siempre; para todo el proyecto solo si se tiene permiso
      // de configuración (las reglas no dejan a los demás tocar el proyecto).
      await Promise.all([
        updateDoc(doc(db, `userProjects/${user.uid}/projects`, projectId), { archived: newArchived }),
        ...(project.permissions.config ? [updateDoc(doc(db, "projects", projectId), { archived: newArchived })] : []),
      ]);
      setProjects(projects.map(p => p.projectId === projectId ? { ...p, archived: newArchived } : p));
      showToast("success", project.archived ? "Proyecto restaurado" : "Proyecto archivado");
    } catch {
      showToast("error", "Error al actualizar");
    }
    setProjectMenuOpen(null);
  };

  const toggleProjectFavorite = async (projectId: string) => {
    if (!user?.uid) return;
    const project = projects.find(p => p.projectId === projectId);
    if (!project) return;
    try {
      await updateDoc(doc(db, `userProjects/${user.uid}/projects`, projectId), { favorite: !project.favorite });
      setProjects(projects.map(p => p.projectId === projectId ? { ...p, favorite: !p.favorite } : p));
    } catch {
      showToast("error", "Error al actualizar");
    }
  };

  const updateProjectNotification = async (projectId: string, notificationType: string, value: boolean) => {
    if (!user?.uid) return;
    const project = projects.find(p => p.projectId === projectId);
    if (!project) return;
    try {
      const newNotifications = { ...project.notifications, [notificationType]: value };
      await updateDoc(doc(db, `userProjects/${user.uid}/projects`, projectId), { notifications: newNotifications });
      setProjects(projects.map(p => p.projectId === projectId ? { ...p, notifications: newNotifications } : p));
    } catch {
      showToast("error", "Error al actualizar");
    }
  };

  const toggleAllNotifications = async (projectId: string, enable: boolean) => {
    if (!user?.uid) return;
    try {
      const newNotifications = { approvals: enable, payments: enable, invoices: enable, team: enable };
      await updateDoc(doc(db, `userProjects/${user.uid}/projects`, projectId), { notifications: newNotifications });
      setProjects(projects.map(p => p.projectId === projectId ? { ...p, notifications: newNotifications } : p));
      showToast("success", enable ? "Notificaciones activadas" : "Notificaciones silenciadas");
    } catch {
      showToast("error", "Error al actualizar");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch {
      showToast("error", "Error al cerrar sesión");
    }
  };

  const filteredProjects = projects.filter(p => {
    if (projectFilter === "active")    return !p.archived;
    if (projectFilter === "archived")  return  p.archived;
    if (projectFilter === "favorites") return  p.favorite && !p.archived;
    return true;
  });

  const activeProjects   = projects.filter(p => !p.archived).length;
  const archivedProjects = projects.filter(p =>  p.archived).length;
  const favoriteProjects = projects.filter(p =>  p.favorite && !p.archived).length;
  const userInitial      = formData.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U";

  // Función (no componente) para que el campo no se vuelva a montar en cada
  // pulsación y no pierda el foco.
  const passwordInput = (field: "current" | "new" | "confirm", value: string, onChange: (v: string) => void, autoComplete: string) => (
    <div className="relative">
      <input
        type={showPassword[field] ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder="••••••••"
        className={`${ui.input} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShowPassword({ ...showPassword, [field]: !showPassword[field] })}
        aria-label={showPassword[field] ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        {showPassword[field] ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );

  const Switch = ({ on }: { on: boolean }) => (
    <span className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${on ? "bg-slate-900" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </span>
  );

  if (isLoading) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* Aviso */}
      {toast && (
        <div className={`fixed bottom-6 left-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
          toast.type === "success" ? "bg-slate-900" : "bg-red-600"
        }`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      <main className={ui.page}>

        {/* Cabecera: franja con el degradado + avatar */}
        <div className="h-32 rounded-2xl" style={{ background: coverGradient(user?.uid) }} />
        <div className="-mt-10 flex flex-wrap items-start justify-between gap-4 px-2 sm:px-6">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border border-[#E4E4E7] bg-[#F1F1F3] text-2xl font-semibold text-slate-700 ring-4 ring-white">
              {userInitial}
            </div>
            <div className="pt-12">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{formData.name || "Usuario"}</h1>
              <p className="text-sm text-slate-500">{formData.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className={`${ui.softButton} mt-12`}>
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>

        {/* Pestañas */}
        <div className={`${ui.tabs} mt-10`}>
          <button onClick={() => setActiveTab("account")} className={ui.tab(activeTab === "account")}>Mi cuenta</button>
          <button onClick={() => setActiveTab("projects")} className={ui.tab(activeTab === "projects")}>
            Mis proyectos <span className="text-xs font-normal text-slate-400">{activeProjects}</span>
          </button>
        </div>

        {/* ── Mi cuenta ── */}
        {activeTab === "account" && (
          <div className="mt-8 space-y-6">
            <form onSubmit={handleProfileSubmit} className={`${ui.card} p-6`}>
              <h2 className="mb-5 text-[15px] font-semibold text-slate-900">Datos personales</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className={ui.label}>Nombre</label>
                  <input id="name" type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={ui.input} />
                </div>
                <div>
                  <label htmlFor="email" className={ui.label}>Email</label>
                  <div className="relative">
                    <input id="email" type="email" disabled value={formData.email} className={`${ui.input} pr-10`} />
                    <Lock size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button type="submit" disabled={saving} className={ui.softButton}>
                  {saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>

            <form onSubmit={handlePasswordSubmit} className={`${ui.card} p-6`}>
              <h2 className="mb-5 text-[15px] font-semibold text-slate-900">Contraseña</h2>
              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <label className={ui.label}>Actual</label>
                  {passwordInput("current", passwordData.currentPassword, (v) => setPasswordData({ ...passwordData, currentPassword: v }), "current-password")}
                </div>
                <div>
                  <label className={ui.label}>Nueva</label>
                  {passwordInput("new", passwordData.newPassword, (v) => setPasswordData({ ...passwordData, newPassword: v }), "new-password")}
                </div>
                <div>
                  <label className={ui.label}>Repetir nueva</label>
                  {passwordInput("confirm", passwordData.confirmPassword, (v) => setPasswordData({ ...passwordData, confirmPassword: v }), "new-password")}
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between gap-4">
                <p className="text-xs text-slate-400">Mínimo 6 caracteres</p>
                <button type="submit" disabled={saving} className={ui.softButton}>
                  {saving ? "Actualizando…" : "Cambiar contraseña"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Mis proyectos ── */}
        {activeTab === "projects" && (
          <div className="mt-6">
            <div className="mb-5 flex flex-wrap gap-1">
              {([
                { id: "active",    label: "Activos",    count: activeProjects   },
                { id: "favorites", label: "Favoritos",  count: favoriteProjects },
                { id: "archived",  label: "Archivados", count: archivedProjects },
                { id: "all",       label: "Todos",      count: projects.length  },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setProjectFilter(f.id)}
                  className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                    projectFilter === f.id ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {f.label}
                  {f.count > 0 && <span className="text-xs font-normal text-slate-400">{f.count}</span>}
                </button>
              ))}
            </div>

            {loadingProjects ? (
              <div className="flex justify-center py-12">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className={`${ui.card} px-4 py-12 text-center`}>
                <p className="text-sm text-slate-500">
                  {projectFilter === "archived" ? "No tienes proyectos archivados" :
                   projectFilter === "favorites" ? "No tienes proyectos favoritos" :
                   "No tienes proyectos"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProjects.map((project) => {
                  const isExpanded = expandedProject === project.projectId;
                  const allNotifOn = Object.values(project.notifications).every(Boolean);
                  const allNotifOff = Object.values(project.notifications).every((v) => !v);
                  const groups = [
                    project.permissions.accounting && { key: "accounting" as const, label: "Contabilidad" },
                    project.permissions.team && { key: "team" as const, label: "Equipo" },
                  ].filter(Boolean) as { key: "accounting" | "team"; label: string }[];

                  return (
                    <div key={project.projectId} className={`${ui.card} ${project.archived ? "opacity-70" : ""}`}>
                      <div className="flex items-center gap-4 p-3 pr-4">
                        {/* Miniatura de la portada */}
                        <Link
                          href={`/project/${project.projectId}`}
                          className={`h-14 w-24 flex-shrink-0 rounded-lg bg-cover bg-center ${project.archived ? "grayscale" : ""}`}
                          style={project.coverUrl ? { backgroundImage: `url("${project.coverUrl}")` } : { background: coverGradient(project.projectId) }}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Link href={`/project/${project.projectId}`} className="truncate text-sm font-semibold text-slate-900 hover:underline">
                              {project.projectName}
                            </Link>
                            {project.archived && <span className={ui.chip}>Archivado</span>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {[project.phase, project.role, project.department && `${project.department}${project.position ? ` · ${project.position}` : ""}`]
                              .filter(Boolean).join(" · ")}
                          </p>
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-1">
                          {project.permissions.accounting && (
                            <Link href={`/project/${project.projectId}/accounting`} className={ui.iconButton} title="Contabilidad">
                              <Receipt size={16} style={{ color: MODULE_COLORS.accounting }} />
                            </Link>
                          )}
                          {project.permissions.team && (
                            <Link href={`/project/${project.projectId}/team`} className={ui.iconButton} title="Equipo">
                              <Users size={16} style={{ color: MODULE_COLORS.team }} />
                            </Link>
                          )}
                          <span className="mx-1 h-5 w-px bg-slate-200" />
                          <button
                            onClick={() => toggleProjectFavorite(project.projectId)}
                            className={`${ui.iconButton} ${project.favorite ? "!text-amber-500" : ""}`}
                            title={project.favorite ? "Quitar de favoritos" : "Añadir a favoritos"}
                          >
                            <Star size={16} fill={project.favorite ? "currentColor" : "none"} />
                          </button>
                          <button
                            onClick={() => setExpandedProject(isExpanded ? null : project.projectId)}
                            className={`${ui.iconButton} ${isExpanded ? "bg-[#F1F1F3] !text-slate-900" : ""}`}
                            title="Notificaciones"
                          >
                            <Bell size={16} />
                          </button>
                          <div className="relative">
                            <button
                              onClick={() => setProjectMenuOpen(projectMenuOpen === project.projectId ? null : project.projectId)}
                              className={ui.iconButton}
                              title="Más"
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {projectMenuOpen === project.projectId && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(null)} />
                                <div className={ui.menu}>
                                  <Link href={`/project/${project.projectId}`} onClick={() => setProjectMenuOpen(null)} className={ui.menuItem}>
                                    <ExternalLink size={15} /> Ir al proyecto
                                  </Link>
                                  <button onClick={() => toggleProjectArchive(project.projectId)} className={ui.menuItem}>
                                    {project.archived ? <><ArchiveRestore size={15} /> Restaurar</> : <><Archive size={15} /> Archivar</>}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Notificaciones */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 px-4 py-4">
                          <div className="mb-3 flex items-center justify-between">
                            <p className="text-[13px] font-medium text-slate-900">Notificaciones</p>
                            {groups.length > 0 && (
                              <button
                                onClick={() => toggleAllNotifications(project.projectId, allNotifOff ? true : !allNotifOn)}
                                className="text-xs text-slate-500 hover:text-slate-900"
                              >
                                {allNotifOn ? "Silenciar todo" : "Activar todo"}
                              </button>
                            )}
                          </div>
                          {groups.length === 0 ? (
                            <p className="py-2 text-xs text-slate-400">No tienes acceso a ningún módulo de este proyecto.</p>
                          ) : (
                            <div className="space-y-4">
                              {groups.map((g) => (
                                <div key={g.key}>
                                  <p className="mb-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: MODULE_COLORS[g.key] }} />
                                    {g.label}
                                  </p>
                                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                                    {NOTIFICATION_TYPES.filter((nt) => nt.entorno === g.key).map((nt) => {
                                      const enabled = project.notifications[nt.id as keyof typeof project.notifications];
                                      return (
                                        <button
                                          key={nt.id}
                                          onClick={() => updateProjectNotification(project.projectId, nt.id, !enabled)}
                                          className="flex w-full items-center justify-between gap-4 px-3.5 py-2.5 text-left transition-colors hover:bg-[#F7F7F8]"
                                        >
                                          <span>
                                            <span className="block text-[13px] text-slate-900">{nt.label}</span>
                                            <span className="block text-xs text-slate-400">{nt.description}</span>
                                          </span>
                                          <Switch on={enabled} />
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
