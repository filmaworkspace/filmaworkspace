"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import {
  User, ArrowLeft, CheckCircle, Lock, Eye, EyeOff, Bell, Shield, AlertCircle, LogOut,
  FolderOpen, Archive, ArchiveRestore, Settings, ChevronRight, BellOff, BellRing,
  FileText, Receipt, CreditCard, Users, Check, Sparkles, Calendar, Building2,
  MoreHorizontal, ExternalLink, Star, StarOff, Clock, Layers
} from "lucide-react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential, signOut } from "firebase/auth";
import { doc, getDoc, updateDoc, collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface ProjectMembership {
  projectId: string;
  projectName: string;
  role: string;
  department?: string;
  position?: string;
  permissions: {
    config: boolean;
    accounting: boolean;
    team: boolean;
  };
  notifications: {
    approvals: boolean;
    payments: boolean;
    invoices: boolean;
    team: boolean;
  };
  archived: boolean;
  favorite: boolean;
  joinedAt: Date;
  phase?: string;
}

const PHASES: Record<string, { label: string; color: string }> = {
  development: { label: "Desarrollo", color: "bg-violet-100 text-violet-700" },
  preproduction: { label: "Preproducción", color: "bg-amber-100 text-amber-700" },
  production: { label: "Producción", color: "bg-emerald-100 text-emerald-700" },
  postproduction: { label: "Postproducción", color: "bg-blue-100 text-blue-700" },
  delivery: { label: "Entrega", color: "bg-slate-100 text-slate-700" },
};

const NOTIFICATION_TYPES = [
  { id: "approvals", label: "Aprobaciones", description: "POs y facturas pendientes", icon: Check, color: "blue" },
  { id: "payments", label: "Pagos", description: "Vencimientos y pagos realizados", icon: CreditCard, color: "blue" },
  { id: "invoices", label: "Facturas", description: "Nuevas facturas y cambios", icon: Receipt, color: "blue" },
  { id: "team", label: "Equipo", description: "Cambios en el equipo", icon: Users, color: "green" },
];

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoading, updateUserName } = useUser();

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"account" | "projects">("account");
  const [activeSection, setActiveSection] = useState<"profile" | "security">("profile");

  const [formData, setFormData] = useState({ name: "", email: "" });
  const [passwordData, setPasswordData] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState({ current: false, new: false, confirm: false });

  const [projects, setProjects] = useState<ProjectMembership[]>([]);
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
      const userProjectsSnap = await getDocs(collection(db, `users/${user.uid}/projects`));
      const projectsData: ProjectMembership[] = [];

      for (const upDoc of userProjectsSnap.docs) {
        const upData = upDoc.data();
        const projectDoc = await getDoc(doc(db, "projects", upDoc.id));
        
        if (projectDoc.exists()) {
          const pData = projectDoc.data();
          const memberDoc = await getDoc(doc(db, `projects/${upDoc.id}/members`, user.uid));
          const memberData = memberDoc.exists() ? memberDoc.data() : {};

          projectsData.push({
            projectId: upDoc.id,
            projectName: pData.name || "Sin nombre",
            role: memberData.role || upData.role || "",
            department: memberData.department,
            position: memberData.position,
            permissions: {
              config: upData.permissions?.config || false,
              accounting: upData.permissions?.accounting || false,
              team: upData.permissions?.team || false,
            },
            notifications: upData.notifications || {
              approvals: true,
              payments: true,
              invoices: true,
              team: true,
            },
            archived: upData.archived || false,
            favorite: upData.favorite || false,
            joinedAt: upData.joinedAt?.toDate() || new Date(),
            phase: pData.phase,
          });
        }
      }

      // Ordenar: favoritos primero, luego por nombre
      projectsData.sort((a, b) => {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        return a.projectName.localeCompare(b.projectName);
      });

      setProjects(projectsData);
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
      if (!currentUser) { showToast("error", "No hay usuario autenticado"); setSaving(false); return; }
      if (!formData.name.trim()) { showToast("error", "El nombre no puede estar vacío"); setSaving(false); return; }
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
      if (!currentUser || !currentUser.email) { showToast("error", "No hay usuario autenticado"); setSaving(false); return; }
      if (passwordData.newPassword.length < 6) { showToast("error", "Mínimo 6 caracteres"); setSaving(false); return; }
      if (passwordData.newPassword !== passwordData.confirmPassword) { showToast("error", "Las contraseñas no coinciden"); setSaving(false); return; }
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
      await updateDoc(doc(db, `users/${user.uid}/projects`, projectId), {
        archived: !project.archived,
      });
      setProjects(projects.map(p => 
        p.projectId === projectId ? { ...p, archived: !p.archived } : p
      ));
      showToast("success", project.archived ? "Proyecto restaurado" : "Proyecto archivado");
    } catch (error) {
      showToast("error", "Error al actualizar");
    }
    setProjectMenuOpen(null);
  };

  const toggleProjectFavorite = async (projectId: string) => {
    if (!user?.uid) return;
    const project = projects.find(p => p.projectId === projectId);
    if (!project) return;

    try {
      await updateDoc(doc(db, `users/${user.uid}/projects`, projectId), {
        favorite: !project.favorite,
      });
      setProjects(projects.map(p => 
        p.projectId === projectId ? { ...p, favorite: !p.favorite } : p
      ));
    } catch (error) {
      showToast("error", "Error al actualizar");
    }
  };

  const updateProjectNotification = async (projectId: string, notificationType: string, value: boolean) => {
    if (!user?.uid) return;
    const project = projects.find(p => p.projectId === projectId);
    if (!project) return;

    try {
      const newNotifications = { ...project.notifications, [notificationType]: value };
      await updateDoc(doc(db, `users/${user.uid}/projects`, projectId), {
        notifications: newNotifications,
      });
      setProjects(projects.map(p => 
        p.projectId === projectId ? { ...p, notifications: newNotifications } : p
      ));
    } catch (error) {
      showToast("error", "Error al actualizar");
    }
  };

  const toggleAllNotifications = async (projectId: string, enable: boolean) => {
    if (!user?.uid) return;

    try {
      const newNotifications = {
        approvals: enable,
        payments: enable,
        invoices: enable,
        team: enable,
      };
      await updateDoc(doc(db, `users/${user.uid}/projects`, projectId), {
        notifications: newNotifications,
      });
      setProjects(projects.map(p => 
        p.projectId === projectId ? { ...p, notifications: newNotifications } : p
      ));
      showToast("success", enable ? "Notificaciones activadas" : "Notificaciones silenciadas");
    } catch (error) {
      showToast("error", "Error al actualizar");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch (err) {
      showToast("error", "Error al cerrar sesión");
    }
  };

  const filteredProjects = projects.filter(p => {
    if (projectFilter === "active") return !p.archived;
    if (projectFilter === "archived") return p.archived;
    if (projectFilter === "favorites") return p.favorite && !p.archived;
    return true;
  });

  const getRoleBadge = (role: string, department?: string, position?: string) => {
    // Roles de Accounting (violeta)
    if (["EP", "PM", "Controller", "PC"].includes(role)) {
      return <span className="text-xs font-medium text-violet-700 bg-violet-100 px-2 py-0.5 rounded-lg">{role}</span>;
    }
    // Roles de Team/Departamento (ámbar)
    if (department) {
      return (
        <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-lg">
          {department}{position ? ` · ${position}` : ""}
        </span>
      );
    }
    return null;
  };

  const getPermissionBadges = (project: ProjectMembership) => {
    const badges = [];
    if (project.permissions.config) {
      badges.push(
        <span key="config" className="text-xs font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
          Config
        </span>
      );
    }
    if (project.permissions.accounting) {
      badges.push(
        <span key="accounting" className="text-xs font-medium text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
          Accounting
        </span>
      );
    }
    if (project.permissions.team) {
      badges.push(
        <span key="team" className="text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
          Team
        </span>
      );
    }
    return badges;
  };

  if (isLoading) {
    return (
      <div className={`min-h-screen bg-slate-50 flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  const userInitial = formData.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U";
  const activeProjects = projects.filter(p => !p.archived).length;
  const archivedProjects = projects.filter(p => p.archived).length;

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header compacto */}
      <div className="mt-16 bg-white border-b border-slate-200">
        <div className="px-6 md:px-8 lg:px-12 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <ArrowLeft size={20} />
              </Link>
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-xl font-bold shadow-lg">
                {userInitial}
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{formData.name || "Usuario"}</h1>
                <p className="text-sm text-slate-500">{formData.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl text-sm font-medium transition-colors"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Cerrar sesión</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-6 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab("account")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "account" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <User size={16} />
              Mi cuenta
            </button>
            <button
              onClick={() => setActiveTab("projects")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === "projects" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <FolderOpen size={16} />
              Mis proyectos
              <span className="text-xs bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-md">{activeProjects}</span>
            </button>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 py-8">
        {/* TAB: MI CUENTA */}
        {activeTab === "account" && (
          <div className="max-w-3xl">
            {/* Sub-navigation */}
            <div className="flex gap-6 mb-8 border-b border-slate-200">
              <button
                onClick={() => setActiveSection("profile")}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === "profile" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Información personal
              </button>
              <button
                onClick={() => setActiveSection("security")}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeSection === "security" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                Seguridad
              </button>
            </div>

            {/* Perfil */}
            {activeSection === "profile" && (
              <form onSubmit={handleProfileSubmit} className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6">
                  <div className="flex items-center gap-5 pb-6 border-b border-slate-100">
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-3xl font-bold">
                      {userInitial}
                    </div>
                    <div className="flex-1">
                      <p className="text-lg font-semibold text-slate-900">{formData.name || "Usuario"}</p>
                      <p className="text-sm text-slate-500 mt-0.5">{formData.email}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg flex items-center gap-1">
                          <CheckCircle size={10} />
                          Verificado
                        </span>
                        <span className="text-xs text-slate-400">{activeProjects} proyectos activos</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 pt-6">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Nombre</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Email</label>
                      <div className="relative">
                        <input
                          type="email"
                          disabled
                          value={formData.email}
                          className="w-full px-4 py-2.5 border border-slate-200 bg-slate-50 rounded-xl text-sm text-slate-500 pr-10"
                        />
                        <Lock size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" />
                      </div>
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

            {/* Seguridad */}
            {activeSection === "security" && (
              <form onSubmit={handlePasswordSubmit} className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-6">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Contraseña actual</label>
                    <div className="relative">
                      <input
                        type={showPassword.current ? "text" : "password"}
                        value={passwordData.currentPassword}
                        onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword({ ...showPassword, current: !showPassword.current })}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showPassword.current ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Nueva contraseña</label>
                      <div className="relative">
                        <input
                          type={showPassword.new ? "text" : "password"}
                          value={passwordData.newPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword({ ...showPassword, new: !showPassword.new })}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword.new ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Confirmar</label>
                      <div className="relative">
                        <input
                          type={showPassword.confirm ? "text" : "password"}
                          value={passwordData.confirmPassword}
                          onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm pr-12"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword({ ...showPassword, confirm: !showPassword.confirm })}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showPassword.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
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

        {/* TAB: MIS PROYECTOS */}
        {activeTab === "projects" && (
          <div className="max-w-4xl">
            {/* Filtros */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-2">
                {[
                  { id: "active", label: "Activos", count: activeProjects },
                  { id: "favorites", label: "Favoritos", count: projects.filter(p => p.favorite && !p.archived).length },
                  { id: "archived", label: "Archivados", count: archivedProjects },
                  { id: "all", label: "Todos", count: projects.length },
                ].map((filter) => (
                  <button
                    key={filter.id}
                    onClick={() => setProjectFilter(filter.id as any)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      projectFilter === filter.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {filter.label}
                    {filter.count > 0 && (
                      <span className={`ml-1.5 text-xs ${projectFilter === filter.id ? "text-slate-300" : "text-slate-400"}`}>
                        {filter.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista de proyectos */}
            {loadingProjects ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  {projectFilter === "archived" ? <Archive size={24} className="text-slate-400" /> : <FolderOpen size={24} className="text-slate-400" />}
                </div>
                <p className="text-slate-500">
                  {projectFilter === "archived" ? "No tienes proyectos archivados" : 
                   projectFilter === "favorites" ? "No tienes proyectos favoritos" :
                   "No tienes proyectos"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredProjects.map((project) => (
                  <div
                    key={project.projectId}
                    className={`bg-white border rounded-2xl overflow-hidden transition-all ${
                      project.archived ? "border-slate-200 opacity-60" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Project Header */}
                    <div className="px-5 py-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => toggleProjectFavorite(project.projectId)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            project.favorite ? "text-amber-500 bg-amber-50" : "text-slate-300 hover:text-amber-400 hover:bg-amber-50"
                          }`}
                        >
                          {project.favorite ? <Star size={18} fill="currentColor" /> : <Star size={18} />}
                        </button>
                        
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{project.projectName}</h3>
                            {project.phase && PHASES[project.phase] && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${PHASES[project.phase].color}`}>
                                {PHASES[project.phase].label}
                              </span>
                            )}
                            {project.archived && (
                              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg flex items-center gap-1">
                                <Archive size={10} />
                                Archivado
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {getRoleBadge(project.role, project.department, project.position)}
                            {getPermissionBadges(project).length > 0 && (
                              <div className="flex items-center gap-1">
                                {getPermissionBadges(project)}
                              </div>
                            )}
                            <span className="text-xs text-slate-400">
                              Desde {project.joinedAt.toLocaleDateString("es-ES", { month: "short", year: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedProject(expandedProject === project.projectId ? null : project.projectId)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                            expandedProject === project.projectId
                              ? "bg-slate-900 text-white"
                              : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <Bell size={14} />
                          Notificaciones
                          <ChevronRight size={14} className={`transition-transform ${expandedProject === project.projectId ? "rotate-90" : ""}`} />
                        </button>

                        <div className="relative">
                          <button
                            onClick={() => setProjectMenuOpen(projectMenuOpen === project.projectId ? null : project.projectId)}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          
                          {projectMenuOpen === project.projectId && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(null)} />
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
                                <Link
                                  href={`/project/${project.projectId}`}
                                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  <ExternalLink size={14} className="text-slate-400" />
                                  Ir al proyecto
                                </Link>
                                <button
                                  onClick={() => toggleProjectArchive(project.projectId)}
                                  className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                >
                                  {project.archived ? (
                                    <>
                                      <ArchiveRestore size={14} className="text-slate-400" />
                                      Restaurar
                                    </>
                                  ) : (
                                    <>
                                      <Archive size={14} className="text-slate-400" />
                                      Archivar
                                    </>
                                  )}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Notifications Panel */}
                    {expandedProject === project.projectId && (
                      <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Notificaciones de este proyecto</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleAllNotifications(project.projectId, true)}
                              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                            >
                              <BellRing size={12} />
                              Activar todas
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              onClick={() => toggleAllNotifications(project.projectId, false)}
                              className="text-xs text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1"
                            >
                              <BellOff size={12} />
                              Silenciar
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {NOTIFICATION_TYPES.map((notif) => {
                            const Icon = notif.icon;
                            const isEnabled = project.notifications[notif.id as keyof typeof project.notifications];
                            const isBlue = notif.color === "blue";
                            return (
                              <button
                                key={notif.id}
                                onClick={() => updateProjectNotification(project.projectId, notif.id, !isEnabled)}
                                className="flex items-center gap-3 p-3 rounded-xl border transition-all"
                                style={isEnabled ? {
                                  backgroundColor: isBlue ? 'rgba(47, 82, 224, 0.08)' : 'rgba(137, 211, 34, 0.12)',
                                  borderColor: isBlue ? 'rgba(47, 82, 224, 0.25)' : 'rgba(137, 211, 34, 0.35)',
                                } : {
                                  backgroundColor: '#f8fafc',
                                  borderColor: 'transparent',
                                }}
                              >
                                <div 
                                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                                  style={isEnabled ? {
                                    backgroundColor: isBlue ? 'rgba(47, 82, 224, 0.15)' : 'rgba(137, 211, 34, 0.2)',
                                  } : {
                                    backgroundColor: '#e2e8f0',
                                  }}
                                >
                                  <Icon size={16} style={{ color: isEnabled ? (isBlue ? '#2F52E0' : '#6BA319') : '#94a3b8' }} />
                                </div>
                                <div className="text-left flex-1">
                                  <p className={`text-sm font-medium ${isEnabled ? "text-slate-900" : "text-slate-500"}`}>
                                    {notif.label}
                                  </p>
                                  <p className="text-xs text-slate-400">{notif.description}</p>
                                </div>
                                {isEnabled && (
                                  <CheckCircle size={16} style={{ color: isBlue ? '#2F52E0' : '#6BA319' }} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
