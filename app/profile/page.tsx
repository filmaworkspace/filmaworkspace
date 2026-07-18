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
  BarChart3,
  Bell,
  CheckCircle,
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Lock,
  LogOut,
  MoreHorizontal,
  Star,
  Users,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

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
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Keys match the Spanish values stored in Firestore
const PHASES: Record<string, { bg: string; text: string }> = {
  Desarrollo:      { bg: "bg-sky-50",     text: "text-sky-700"     },
  Preproducción:   { bg: "bg-amber-50",   text: "text-amber-700"   },
  Rodaje:          { bg: "bg-indigo-50",  text: "text-indigo-700"  },
  Postproducción:  { bg: "bg-purple-50",  text: "text-purple-700"  },
  Finalizado:      { bg: "bg-emerald-50", text: "text-emerald-700" },
};

const NOTIFICATION_TYPES = [
  { id: "approvals", label: "Aprobaciones", description: "POs y facturas pendientes de aprobación" },
  { id: "payments",  label: "Pagos",        description: "Vencimientos y pagos realizados"        },
  { id: "invoices",  label: "Facturas",     description: "Nuevas facturas y cambios de estado"    },
  { id: "team",      label: "Equipo",       description: "Cambios en el equipo del proyecto"      },
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
      await Promise.all([
        updateDoc(doc(db, `userProjects/${user.uid}/projects`, projectId), { archived: newArchived }),
        updateDoc(doc(db, "projects", projectId), { archived: newArchived }),
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

  if (isLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 transition-all ${
          toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        }`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-0">
          <div className="flex items-center justify-between mb-8">
            {/* Avatar + info */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-xl font-bold">
                {userInitial}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{formData.name || "Usuario"}</h1>
                <p className="text-sm text-slate-500">{formData.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl text-sm font-medium transition-colors"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab("account")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "account" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Mi cuenta
            </button>
            <button
              onClick={() => setActiveTab("projects")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "projects" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Mis proyectos
              <span className={`text-xs px-1.5 py-0.5 rounded-md ${activeTab === "projects" ? "bg-slate-100 text-slate-600" : "bg-slate-200 text-slate-500"}`}>
                {activeProjects}
              </span>
            </button>
          </div>
        </div>
      </div>

      <main className="px-24 py-8">

        {/* ── TAB: MI CUENTA ─────────────────────────────────────────────────── */}
        {activeTab === "account" && (
          <div className="max-w-2xl">
            {/* Sub-nav */}
            <div className="flex gap-6 mb-8 border-b border-slate-200">
              {(["profile", "security"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSection(s)}
                  className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeSection === s
                      ? "border-slate-900 text-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {s === "profile" ? "Información personal" : "Seguridad"}
                </button>
              ))}
            </div>

            {/* ─ Perfil ─ */}
            {activeSection === "profile" && (
              <form onSubmit={handleProfileSubmit} className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
                  {/* Avatar row */}
                  <div className="flex items-center gap-4 pb-5 border-b border-slate-100">
                    <div className="w-16 h-16 rounded-full bg-slate-900 text-white flex items-center justify-center text-2xl font-bold">
                      {userInitial}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{formData.name || "Usuario"}</p>
                      <p className="text-sm text-slate-500 mt-0.5">{formData.email}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg flex items-center gap-1">
                          <CheckCircle size={10} />
                          Verificado
                        </span>
                        <span className="text-xs text-slate-400">{activeProjects} proyecto{activeProjects !== 1 ? "s" : ""} activo{activeProjects !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Nombre</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Email</label>
                      <div className="relative">
                        <input
                          type="email"
                          disabled
                          value={formData.email}
                          className="w-full px-4 py-2.5 border border-slate-200 bg-slate-50 rounded-xl text-sm text-slate-400 pr-10"
                        />
                        <Lock size={13} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5">El email no se puede cambiar</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {saving ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </form>
            )}

            {/* ─ Seguridad ─ */}
            {activeSection === "security" && (
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Contraseña actual</label>
                    <div className="relative">
                      <input
                        type={showPassword.current ? "text" : "password"}
                        value={passwordData.currentPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                        placeholder="••••••••"
                      />
                      <button type="button" onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        {showPassword.current ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Nueva contraseña</label>
                      <div className="relative">
                        <input
                          type={showPassword.new ? "text" : "password"}
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                          placeholder="••••••••"
                        />
                        <button type="button" onClick={() => setShowPassword({ ...showPassword, new: !showPassword.new })}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showPassword.new ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Confirmar</label>
                      <div className="relative">
                        <input
                          type={showPassword.confirm ? "text" : "password"}
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                          placeholder="••••••••"
                        />
                        <button type="button" onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showPassword.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">Mínimo 6 caracteres</p>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                  >
                    {saving ? "Actualizando..." : "Cambiar contraseña"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── TAB: MIS PROYECTOS ─────────────────────────────────────────────── */}
        {activeTab === "projects" && (
          <div className="max-w-3xl">
            {/* Filtros */}
            <div className="flex gap-2 mb-6">
              {([
                { id: "active",    label: "Activos",    count: activeProjects   },
                { id: "favorites", label: "Favoritos",  count: favoriteProjects },
                { id: "archived",  label: "Archivados", count: archivedProjects },
                { id: "all",       label: "Todos",      count: projects.length  },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setProjectFilter(f.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    projectFilter === f.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {f.label}
                  {f.count > 0 && (
                    <span className={`text-xs ${projectFilter === f.id ? "text-slate-300" : "text-slate-400"}`}>
                      {f.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Lista */}
            {loadingProjects ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center">
                <FolderOpen size={28} className="text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">
                  {projectFilter === "archived"  ? "No tienes proyectos archivados" :
                   projectFilter === "favorites" ? "No tienes proyectos favoritos"  :
                   "No tienes proyectos"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProjects.map((project) => {
                  const phaseStyle  = project.phase ? PHASES[project.phase] : null;
                  const isExpanded  = expandedProject === project.projectId;
                  const allNotifOn  = Object.values(project.notifications).every(Boolean);
                  const allNotifOff = Object.values(project.notifications).every(v => !v);

                  return (
                    <div
                      key={project.projectId}
                      className={`bg-white border rounded-2xl transition-all ${
                        project.archived ? "border-slate-200 opacity-70" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {/* ─ Card header ─ */}
                      <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">

                          {/* Left: star + info */}
                          <div className="flex items-start gap-3 flex-1 min-w-0">
                            <button
                              onClick={() => toggleProjectFavorite(project.projectId)}
                              className={`mt-0.5 p-1 rounded-lg transition-colors flex-shrink-0 ${
                                project.favorite ? "text-amber-500" : "text-slate-300 hover:text-amber-400"
                              }`}
                            >
                              <Star size={16} fill={project.favorite ? "currentColor" : "none"} />
                            </button>

                            <div className="flex-1 min-w-0">
                              {/* Name + badges */}
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-slate-900 text-sm">{project.projectName}</h3>
                                {phaseStyle && (
                                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-lg ${phaseStyle.bg} ${phaseStyle.text}`}>
                                    {project.phase}
                                  </span>
                                )}
                                {project.archived && (
                                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 flex items-center gap-1">
                                    <Archive size={9} />
                                    Archivado
                                  </span>
                                )}
                              </div>

                              {/* Role */}
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {project.role && (
                                  <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-lg">
                                    {project.role}
                                  </span>
                                )}
                                {project.department && (
                                  <span className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-lg">
                                    {project.department}{project.position ? ` · ${project.position}` : ""}
                                  </span>
                                )}
                                <span className="text-[11px] text-slate-400">
                                  desde {project.joinedAt.toLocaleDateString("es-ES", { month: "short", year: "numeric" })}
                                </span>
                              </div>

                              {/* ─ Entornos ─ */}
                              {(project.permissions.accounting || project.permissions.team) && (
                                <div className="mt-3">
                                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Entornos</p>
                                  <div className="flex gap-2">
                                    {project.permissions.accounting && (
                                      <Link href={`/project/${project.projectId}/accounting`}>
                                        <div
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors hover:opacity-80"
                                          style={{
                                            backgroundColor: "rgba(47, 82, 224, 0.08)",
                                            borderColor:     "rgba(47, 82, 224, 0.25)",
                                            color:           "#2F52E0",
                                          }}
                                        >
                                          <BarChart3 size={11} />
                                          Accounting
                                        </div>
                                      </Link>
                                    )}
                                    {project.permissions.team && (
                                      <Link href={`/project/${project.projectId}/team`}>
                                        <div
                                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors hover:opacity-80"
                                          style={{
                                            backgroundColor: "rgba(137, 211, 34, 0.12)",
                                            borderColor:     "rgba(137, 211, 34, 0.35)",
                                            color:           "#6BA319",
                                          }}
                                        >
                                          <Users size={11} />
                                          Team
                                        </div>
                                      </Link>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: actions */}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => setExpandedProject(isExpanded ? null : project.projectId)}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                isExpanded ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
                              }`}
                            >
                              <Bell size={13} />
                              <ChevronDown size={12} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </button>

                            <div className="relative">
                              <button
                                onClick={() => setProjectMenuOpen(projectMenuOpen === project.projectId ? null : project.projectId)}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                <MoreHorizontal size={16} />
                              </button>
                              {projectMenuOpen === project.projectId && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(null)} />
                                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                                    <Link
                                      href={`/project/${project.projectId}`}
                                      onClick={() => setProjectMenuOpen(null)}
                                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    >
                                      <ExternalLink size={13} className="text-slate-400" />
                                      Ir al proyecto
                                    </Link>
                                    <button
                                      onClick={() => toggleProjectArchive(project.projectId)}
                                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    >
                                      {project.archived ? (
                                        <><ArchiveRestore size={13} className="text-slate-400" />Restaurar</>
                                      ) : (
                                        <><Archive size={13} className="text-slate-400" />Archivar</>
                                      )}
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ─ Notificaciones expandidas ─ */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/60 rounded-b-2xl">
                          <div className="flex items-center justify-between mb-3">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Notificaciones</p>
                            <button
                              onClick={() => toggleAllNotifications(project.projectId, allNotifOff ? true : !allNotifOn)}
                              className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                            >
                              {allNotifOn ? "Silenciar todo" : "Activar todo"}
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {NOTIFICATION_TYPES.map((nt) => {
                              const enabled = project.notifications[nt.id as keyof typeof project.notifications];
                              return (
                                <button
                                  key={nt.id}
                                  onClick={() => updateProjectNotification(project.projectId, nt.id, !enabled)}
                                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all ${
                                    enabled
                                      ? "bg-white border-slate-200 hover:border-slate-300"
                                      : "bg-slate-100/60 border-slate-200 opacity-60 hover:opacity-80"
                                  }`}
                                >
                                  <div>
                                    <p className="text-xs font-medium text-slate-800">{nt.label}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{nt.description}</p>
                                  </div>
                                  <div className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 ml-3 relative ${
                                    enabled ? "bg-slate-900" : "bg-slate-300"
                                  }`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${
                                      enabled ? "left-4" : "left-0.5"
                                    }`} />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
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
