"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, Timestamp, serverTimestamp } from "firebase/firestore";
import {
  LayoutDashboard,
  FolderPlus,
  Users,
  Building2,
  Search,
  X,
  Edit2,
  Trash2,
  UserPlus,
  Briefcase,
  CheckCircle,
  AlertCircle,
  Shield,
  Plus,
  Eye,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Clock,
  LayoutGrid,
  List,
  FolderOpen,
  Folder,
  MoreHorizontal,
  Settings,
  TrendingUp,
  Activity,
  Film,
  Clapperboard,
  Sparkles,
  ArrowRight,
  Crown,
  Mail,
  Hash,
  Calendar,
  MessageSquare,
  Send,
  Bell,
  Info,
  AlertTriangle,
  CheckSquare,
  Square,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string; border: string; dot: string; icon: typeof Clock }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-500", icon: Sparkles },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500", icon: Clock },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500", icon: Clapperboard },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500", icon: Film },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500", icon: CheckCircle },
};

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC", "Supervisor"];

const DEFAULT_DEPARTMENTS = [
  { name: "Producción", color: "#3B82F6" },
  { name: "Dirección", color: "#8B5CF6" },
  { name: "Fotografía", color: "#F59E0B" },
  { name: "Arte", color: "#10B981" },
  { name: "Sonido", color: "#EC4899" },
  { name: "Vestuario", color: "#6366F1" },
  { name: "Maquillaje", color: "#14B8A6" },
  { name: "Localizaciones", color: "#F97316" },
];

interface Project {
  id: string;
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  producerNames?: string[];
  createdAt: Timestamp;
  memberCount: number;
  members?: Member[];
}

interface Member {
  odId: string;
  name: string;
  email: string;
  role?: string;
  position?: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  projectCount: number;
  projects: UserProject[];
}

interface UserProject {
  id: string;
  name: string;
  role?: string;
  position?: string;
}

interface Producer {
  id: string;
  name: string;
  createdAt: Timestamp;
  projectCount: number;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "users" | "producers">("projects");

  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);

  const [projectSearch, setProjectSearch] = useState("");
  const [projectPhaseFilter, setProjectPhaseFilter] = useState("all");
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [producerSearch, setProducerSearch] = useState("");
  const [producerModalSearch, setProducerModalSearch] = useState("");

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateProducer, setShowCreateProducer] = useState(false);
  const [showEditProducer, setShowEditProducer] = useState<string | null>(null);
  const [showUserDetails, setShowUserDetails] = useState<string | null>(null);
  const [showAssignUser, setShowAssignUser] = useState<string | null>(null);
  const [showEditProject, setShowEditProject] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const [newProject, setNewProject] = useState({ name: "", description: "", phase: "Desarrollo", producers: [] as string[] });
  const [newProducer, setNewProducer] = useState({ name: "" });
  const [assignUserForm, setAssignUserForm] = useState({ odId: "", role: "" });

  // Message modal states
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageForm, setMessageForm] = useState({
    title: "",
    content: "",
    type: "info" as "info" | "warning" | "success",
    sendToAll: true,
    selectedProjects: [] as string[],
  });
  const [projectSearchInMessage, setProjectSearchInMessage] = useState("");

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = contextUser?.role === "admin" || contextUser?.email === "admin@filmaworkspace.com";

  useEffect(() => {
    if (!userLoading && !isAdmin) {
      router.push("/dashboard");
    }
  }, [contextUser, userLoading, router, isAdmin]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    if (!contextUser?.uid) return;
    try {
      const producersSnap = await getDocs(collection(db, "producers"));
      const producersData: Producer[] = producersSnap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        createdAt: d.data().createdAt,
        projectCount: 0,
      }));

      const projectsSnap = await getDocs(collection(db, "projects"));
      const projectsData: Project[] = await Promise.all(
        projectsSnap.docs.map(async (projectDoc) => {
          const data = projectDoc.data();
          const producerIds = data.producers || [];
          const producerNames = producerIds.map((pid: string) => producersData.find((p) => p.id === pid)?.name || "Eliminada");
          const membersSnap = await getDocs(collection(db, `projects/${projectDoc.id}/members`));
          const members: Member[] = membersSnap.docs.map((m) => ({
            odId: m.id,
            name: m.data().name,
            email: m.data().email,
            role: m.data().role,
            position: m.data().position,
          }));
          return {
            id: projectDoc.id,
            name: data.name,
            phase: data.phase,
            description: data.description || "",
            producers: producerIds,
            producerNames,
            createdAt: data.createdAt,
            memberCount: membersSnap.size,
            members,
          };
        })
      );

      producersData.forEach((p) => {
        p.projectCount = projectsData.filter((pr) => pr.producers?.includes(p.id)).length;
      });
      setProjects(projectsData);
      setProducers(producersData);

      const usersSnap = await getDocs(collection(db, "users"));
      const usersData: User[] = await Promise.all(
        usersSnap.docs.map(async (userDoc) => {
          const data = userDoc.data();
          const userProjectsSnap = await getDocs(collection(db, `userProjects/${userDoc.id}/projects`));
          const userProjects: UserProject[] = await Promise.all(
            userProjectsSnap.docs.map(async (upDoc) => {
              const upData = upDoc.data();
              const projectDoc = await getDoc(doc(db, "projects", upDoc.id));
              return {
                id: upDoc.id,
                name: projectDoc.exists() ? projectDoc.data().name : "Eliminado",
                role: upData.role,
                position: upData.position,
              };
            })
          );
          return {
            id: userDoc.id,
            name: data.name || data.email,
            email: data.email,
            role: data.role || "user",
            projectCount: userProjectsSnap.size,
            projects: userProjects,
          };
        })
      );
      setUsers(usersData);
      setLoading(false);
      setRefreshing(false);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al cargar los datos");
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (contextUser?.uid && isAdmin) loadData();
  }, [contextUser?.uid, isAdmin]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    showToast("success", "Datos actualizados");
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const projectRef = doc(collection(db, "projects"));
      await setDoc(projectRef, {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
        createdAt: serverTimestamp(),
      });
      for (const dept of DEFAULT_DEPARTMENTS) {
        const deptRef = doc(collection(db, `projects/${projectRef.id}/departments`));
        await setDoc(deptRef, { name: dept.name, color: dept.color, createdAt: serverTimestamp() });
      }
      setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [] });
      setShowCreateProject(false);
      showToast("success", "Proyecto creado correctamente");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al crear el proyecto");
    } finally {
      setSaving(false);
    }
  };

  const handleEditProject = async () => {
    if (!showEditProject) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", showEditProject), {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
      });
      setShowEditProject(null);
      showToast("success", "Proyecto actualizado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    if (!confirm(`¿Eliminar "${project.name}"? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try {
      const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
      for (const memberDoc of membersSnap.docs) {
        await deleteDoc(doc(db, `userProjects/${memberDoc.id}/projects/${projectId}`));
        await deleteDoc(memberDoc.ref);
      }
      const deptsSnap = await getDocs(collection(db, `projects/${projectId}/departments`));
      for (const deptDoc of deptsSnap.docs) {
        await deleteDoc(deptDoc.ref);
      }
      await deleteDoc(doc(db, "projects", projectId));
      showToast("success", "Proyecto eliminado");
      setActiveMenu(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateProducer = async () => {
    if (!newProducer.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const producerRef = doc(collection(db, "producers"));
      await setDoc(producerRef, { name: newProducer.name.trim(), createdAt: serverTimestamp() });
      setNewProducer({ name: "" });
      setShowCreateProducer(false);
      showToast("success", "Productora creada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al crear");
    } finally {
      setSaving(false);
    }
  };

  const handleEditProducer = async () => {
    if (!showEditProducer) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "producers", showEditProducer), { name: newProducer.name.trim() });
      setShowEditProducer(null);
      setNewProducer({ name: "" });
      showToast("success", "Productora actualizada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProducer = async (producerId: string) => {
    const producer = producers.find((p) => p.id === producerId);
    if (!producer) return;
    if (producer.projectCount > 0) {
      showToast("error", `"${producer.name}" tiene proyectos asignados`);
      return;
    }
    if (!confirm(`¿Eliminar "${producer.name}"?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "producers", producerId));
      showToast("success", "Productora eliminada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleAssignUser = async () => {
    if (!assignUserForm.odId || !assignUserForm.role || !showAssignUser) {
      showToast("error", "Selecciona usuario y rol");
      return;
    }
    setSaving(true);
    try {
      const user = users.find((u) => u.id === assignUserForm.odId);
      const project = projects.find((p) => p.id === showAssignUser);
      if (!user || !project) return;
      if (project.members?.some((m) => m.odId === user.id)) {
        showToast("error", "Usuario ya asignado");
        setSaving(false);
        return;
      }
      await setDoc(doc(db, `projects/${showAssignUser}/members`, user.id), {
        odId: user.id,
        name: user.name,
        email: user.email,
        role: assignUserForm.role,
        permissions: { config: true, accounting: true, team: true },
        accountingAccessLevel: "accounting_extended",
        addedAt: serverTimestamp(),
      });
      await setDoc(doc(db, `userProjects/${user.id}/projects/${showAssignUser}`), {
        projectId: showAssignUser,
        role: assignUserForm.role,
        permissions: { config: true, accounting: true, team: true },
        accountingAccessLevel: "accounting_extended",
        addedAt: serverTimestamp(),
      });
      setAssignUserForm({ odId: "", role: "" });
      setShowAssignUser(null);
      showToast("success", "Usuario asignado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al asignar");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveUserFromProject = async (projectId: string, odId: string) => {
    if (!confirm("¿Eliminar este usuario del proyecto?")) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${projectId}/members`, odId));
      await deleteDoc(doc(db, `userProjects/${odId}/projects/${projectId}`));
      showToast("success", "Usuario eliminado del proyecto");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserRole = async (odId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "user" : "admin";
    if (!confirm(`¿Cambiar rol a ${newRole === "admin" ? "Administrador" : "Usuario"}?`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { role: newRole });
      showToast("success", "Rol actualizado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  // Send message to users
  const handleSendMessage = async () => {
    if (!messageForm.title.trim() || !messageForm.content.trim()) {
      showToast("error", "Título y mensaje son obligatorios");
      return;
    }
    if (!messageForm.sendToAll && messageForm.selectedProjects.length === 0) {
      showToast("error", "Selecciona al menos un proyecto");
      return;
    }

    setSaving(true);
    try {
      // Determine which users to send to
      let targetUserIds: string[] = [];

      if (messageForm.sendToAll) {
        // All users
        targetUserIds = users.map((u) => u.id);
      } else {
        // Users from selected projects
        const selectedProjectsData = projects.filter((p) => messageForm.selectedProjects.includes(p.id));
        const userIdSet = new Set<string>();
        selectedProjectsData.forEach((project) => {
          project.members?.forEach((member) => {
            userIdSet.add(member.odId);
          });
        });
        targetUserIds = Array.from(userIdSet);
      }

      // Create a message for each user
      const messageData = {
        title: messageForm.title.trim(),
        content: messageForm.content.trim(),
        type: messageForm.type,
        sentAt: serverTimestamp(),
        sentBy: contextUser?.uid,
        sentByName: contextUser?.name || contextUser?.email || "Admin",
        read: false,
        targetProjects: messageForm.sendToAll ? null : messageForm.selectedProjects,
      };

      // Save message to each user's messages subcollection
      for (const odId of targetUserIds) {
        const messageRef = doc(collection(db, `users/${odId}/messages`));
        await setDoc(messageRef, messageData);
      }

      // Reset form and close modal
      setMessageForm({
        title: "",
        content: "",
        type: "info",
        sendToAll: true,
        selectedProjects: [],
      });
      setProjectSearchInMessage("");
      setShowMessageModal(false);
      showToast("success", `Mensaje enviado a ${targetUserIds.length} usuario${targetUserIds.length !== 1 ? "s" : ""}`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al enviar el mensaje");
    } finally {
      setSaving(false);
    }
  };

  const toggleProjectInMessage = (projectId: string) => {
    setMessageForm((prev) => ({
      ...prev,
      selectedProjects: prev.selectedProjects.includes(projectId)
        ? prev.selectedProjects.filter((id) => id !== projectId)
        : [...prev.selectedProjects, projectId],
    }));
  };

  const filteredProjectsForMessage = projects.filter((p) =>
    p.name.toLowerCase().includes(projectSearchInMessage.toLowerCase())
  );

  const filteredProjects = projects.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(projectSearch.toLowerCase());
    const matchesPhase = projectPhaseFilter === "all" || p.phase === projectPhaseFilter;
    return matchesSearch && matchesPhase;
  });

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase());
    const matchesRole = userRoleFilter === "all" || u.role === userRoleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredProducers = producers.filter((p) => p.name.toLowerCase().includes(producerSearch.toLowerCase()));

  // Stats
  const activeProjects = projects.filter((p) => p.phase !== "Finalizado").length;
  const adminUsers = users.filter((u) => u.role === "admin").length;
  const totalAssignments = projects.reduce((acc, p) => acc + p.memberCount, 0);

  // Loading
  if (loading || userLoading) {
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
        <div className="fixed top-20 right-6 z-50">
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${
              toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
            } text-white`}
          >
            {toast.type === "success" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem] bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Shield size={28} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-slate-900">Panel de administración</h1>
                  <span className="px-2.5 py-1 bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold">ADMIN</span>
                </div>
                <p className="text-slate-500">Gestiona proyectos, usuarios y productoras de la plataforma</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMessageModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
              >
                <MessageSquare size={16} />
                Enviar mensaje
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50"
              >
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                Actualizar
              </button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                  <Briefcase size={20} className="text-white" />
                </div>
                <TrendingUp size={16} className="text-blue-500" />
              </div>
              <p className="text-3xl font-bold text-slate-900">{projects.length}</p>
              <p className="text-sm text-slate-600 mt-1">Proyectos totales</p>
              <p className="text-xs text-blue-600 mt-2 font-medium">{activeProjects} activos</p>
            </div>

            <div className="bg-gradient-to-br from-violet-50 to-violet-100/50 border border-violet-200/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-violet-500 rounded-xl flex items-center justify-center">
                  <Users size={20} className="text-white" />
                </div>
                <Activity size={16} className="text-violet-500" />
              </div>
              <p className="text-3xl font-bold text-slate-900">{users.length}</p>
              <p className="text-sm text-slate-600 mt-1">Usuarios registrados</p>
              <p className="text-xs text-violet-600 mt-2 font-medium">{adminUsers} administradores</p>
            </div>

            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-white" />
                </div>
                <Sparkles size={16} className="text-amber-500" />
              </div>
              <p className="text-3xl font-bold text-slate-900">{producers.length}</p>
              <p className="text-sm text-slate-600 mt-1">Productoras</p>
            </div>

            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200/50 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                  <UserPlus size={20} className="text-white" />
                </div>
                <Hash size={16} className="text-emerald-500" />
              </div>
              <p className="text-3xl font-bold text-slate-900">{totalAssignments}</p>
              <p className="text-sm text-slate-600 mt-1">Asignaciones</p>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-6 md:px-8 lg:px-12 py-8">
        {/* Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
            {[
              { id: "projects", label: "Proyectos", icon: Briefcase, count: projects.length },
              { id: "users", label: "Usuarios", icon: Users, count: users.length },
              { id: "producers", label: "Productoras", icon: Building2, count: producers.length },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
                <span
                  className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${
                    activeTab === tab.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ==================== PROJECTS TAB ==================== */}
        {activeTab === "projects" && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full">
                  <div className="relative flex-1 max-w-md">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar proyectos..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent focus:bg-white outline-none text-sm transition-all"
                    />
                  </div>
                  <select
                    value={projectPhaseFilter}
                    onChange={(e) => setProjectPhaseFilter(e.target.value)}
                    className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                  >
                    <option value="all">Todas las fases</option>
                    {PHASES.map((phase) => (
                      <option key={phase} value={phase}>
                        {phase}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                    <button
                      onClick={() => setViewMode("grid")}
                      className={`p-2 rounded-lg transition-all ${
                        viewMode === "grid" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <LayoutGrid size={16} />
                    </button>
                    <button
                      onClick={() => setViewMode("list")}
                      className={`p-2 rounded-lg transition-all ${
                        viewMode === "list" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <List size={16} />
                    </button>
                  </div>
                  <button
                    onClick={() => setShowCreateProject(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
                  >
                    <FolderPlus size={16} />
                    Crear proyecto
                  </button>
                </div>
              </div>
            </div>

            {/* Projects Content */}
            {filteredProjects.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen size={28} className="text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No hay proyectos</h3>
                <p className="text-slate-500 text-sm mb-6">Crea tu primer proyecto para empezar</p>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <FolderPlus size={16} />
                  Crear proyecto
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((project) => {
                  const phase = phaseConfig[project.phase] || phaseConfig["Desarrollo"];
                  const PhaseIcon = phase.icon;
                  return (
                    <div
                      key={project.id}
                      className="group bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all"
                    >
                      {/* Header con fase */}
                      <div className={`px-5 py-3 ${phase.bg} border-b ${phase.border}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <PhaseIcon size={14} className={phase.text} />
                            <span className={`text-xs font-semibold ${phase.text}`}>{project.phase}</span>
                          </div>
                          <div className="relative" ref={activeMenu === project.id ? menuRef : null}>
                            <button
                              onClick={() => setActiveMenu(activeMenu === project.id ? null : project.id)}
                              className={`p-1.5 rounded-lg transition-colors ${phase.text} hover:bg-white/50`}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                            {activeMenu === project.id && (
                              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                                <button
                                  onClick={() => {
                                    setNewProject({
                                      name: project.name,
                                      description: project.description || "",
                                      phase: project.phase,
                                      producers: project.producers || [],
                                    });
                                    setShowEditProject(project.id);
                                    setActiveMenu(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                                >
                                  <Edit2 size={14} className="text-slate-400" />
                                  Editar proyecto
                                </button>
                                <button
                                  onClick={() => {
                                    setShowAssignUser(project.id);
                                    setActiveMenu(null);
                                  }}
                                  className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                                >
                                  <UserPlus size={14} className="text-slate-400" />
                                  Asignar usuario
                                </button>
                                <Link
                                  href={`/project/${project.id}/config`}
                                  onClick={() => setActiveMenu(null)}
                                  className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                                >
                                  <Settings size={14} className="text-slate-400" />
                                  Configuración
                                </Link>
                                <div className="border-t border-slate-100 my-1" />
                                <button
                                  onClick={() => handleDeleteProject(project.id)}
                                  className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                                >
                                  <Trash2 size={14} />
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="p-5">
                        <h3 className="text-lg font-semibold text-slate-900 mb-2 line-clamp-1">{project.name}</h3>
                        {project.description && (
                          <p className="text-sm text-slate-500 mb-4 line-clamp-2">{project.description}</p>
                        )}

                        {/* Productoras */}
                        {project.producerNames && project.producerNames.length > 0 && (
                          <div className="flex items-center gap-2 mb-4">
                            <Building2 size={14} className="text-amber-500" />
                            <span className="text-sm text-slate-600 truncate">{project.producerNames.join(", ")}</span>
                          </div>
                        )}

                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-slate-500 mb-5">
                          <span className="flex items-center gap-1.5">
                            <Users size={14} />
                            {project.memberCount} miembros
                          </span>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <Link
                            href={`/admindashboard/project/${project.id}`}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
                          >
                            <Eye size={14} />
                            Gestionar
                          </Link>
                          <Link
                            href={`/project/${project.id}`}
                            className="px-3 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-colors"
                            title="Ir al proyecto"
                          >
                            <ExternalLink size={14} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* List View */
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="divide-y divide-slate-100">
                  {filteredProjects.map((project) => {
                    const phase = phaseConfig[project.phase] || phaseConfig["Desarrollo"];
                    const PhaseIcon = phase.icon;
                    const isExpanded = expandedProject === project.id;

                    return (
                      <div key={project.id}>
                        <div className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            {project.memberCount > 0 && (
                              <button
                                onClick={() => setExpandedProject(isExpanded ? null : project.id)}
                                className="p-1 text-slate-400 hover:text-slate-600"
                              >
                                <ChevronRight
                                  size={16}
                                  className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                />
                              </button>
                            )}
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${phase.bg}`}>
                              <PhaseIcon size={18} className={phase.text} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-3">
                                <h3 className="font-semibold text-slate-900 truncate">{project.name}</h3>
                                <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${phase.bg} ${phase.text}`}>
                                  {project.phase}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                                {project.producerNames && project.producerNames.length > 0 && (
                                  <span className="truncate max-w-[200px]">{project.producerNames.join(", ")}</span>
                                )}
                                <span className="flex items-center gap-1">
                                  <Users size={12} />
                                  {project.memberCount}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Link
                              href={`/admindashboard/project/${project.id}`}
                              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                            >
                              <Eye size={14} />
                              Gestionar
                            </Link>
                            <button
                              onClick={() => {
                                setNewProject({
                                  name: project.name,
                                  description: project.description || "",
                                  phase: project.phase,
                                  producers: project.producers || [],
                                });
                                setShowEditProject(project.id);
                              }}
                              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button
                              onClick={() => setShowAssignUser(project.id)}
                              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl"
                            >
                              <UserPlus size={16} />
                            </button>
                          </div>
                        </div>

                        {/* Expanded members */}
                        {isExpanded && project.members && project.members.length > 0 && (
                          <div className="px-5 pb-5 pt-0">
                            <div className="ml-14 bg-slate-50 rounded-xl p-4">
                              <p className="text-xs font-semibold text-slate-500 uppercase mb-3">
                                Miembros del equipo ({project.members.length})
                              </p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {project.members.map((member) => (
                                  <div
                                    key={member.odId}
                                    className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center text-slate-600 text-xs font-semibold">
                                        {member.name.charAt(0).toUpperCase()}
                                      </div>
                                      <div>
                                        <p className="text-sm font-medium text-slate-900">{member.name}</p>
                                        <p className="text-xs text-slate-500">{member.email}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
                                        {member.role || member.position}
                                      </span>
                                      <button
                                        onClick={() => handleRemoveUserFromProject(project.id, member.odId)}
                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== USERS TAB ==================== */}
        {activeTab === "users" && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
                <div className="relative flex-1 max-w-md">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar usuarios..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent focus:bg-white outline-none text-sm transition-all"
                  />
                </div>
                <select
                  value={userRoleFilter}
                  onChange={(e) => setUserRoleFilter(e.target.value)}
                  className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                >
                  <option value="all">Todos los roles</option>
                  <option value="admin">Administradores</option>
                  <option value="user">Usuarios</option>
                </select>
              </div>
            </div>

            {/* Users List */}
            {filteredUsers.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users size={28} className="text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No hay usuarios</h3>
                <p className="text-slate-500 text-sm">No se encontraron usuarios con los filtros actuales</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-slate-200 to-slate-300 rounded-xl flex items-center justify-center text-slate-600 font-semibold text-lg">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900">{user.name}</h3>
                            {user.role === "admin" && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold">
                                <Crown size={10} />
                                Admin
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                            <Mail size={12} />
                            {user.email}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => setShowUserDetails(user.id)}
                          className="text-sm text-blue-600 hover:text-blue-700 font-medium hover:underline"
                        >
                          {user.projectCount} proyecto{user.projectCount !== 1 ? "s" : ""}
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setShowUserDetails(user.id)}
                            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                            title="Ver detalles"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            onClick={() => handleToggleUserRole(user.id, user.role)}
                            disabled={saving}
                            className={`p-2 rounded-xl transition-colors ${
                              user.role === "admin"
                                ? "text-violet-600 bg-violet-50 hover:bg-violet-100"
                                : "text-slate-400 hover:text-violet-600 hover:bg-violet-50"
                            }`}
                            title={user.role === "admin" ? "Quitar admin" : "Hacer admin"}
                          >
                            <Shield size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== PRODUCERS TAB ==================== */}
        {activeTab === "producers" && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                <div className="relative flex-1 max-w-md">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar productoras..."
                    value={producerSearch}
                    onChange={(e) => setProducerSearch(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent focus:bg-white outline-none text-sm transition-all"
                  />
                </div>
                <button
                  onClick={() => setShowCreateProducer(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors shadow-sm"
                >
                  <Plus size={16} />
                  Nueva productora
                </button>
              </div>
            </div>

            {/* Producers Grid */}
            {filteredProducers.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Building2 size={28} className="text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">No hay productoras</h3>
                <p className="text-slate-500 text-sm mb-6">Crea tu primera productora</p>
                <button
                  onClick={() => setShowCreateProducer(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <Plus size={16} />
                  Nueva productora
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredProducers.map((producer) => (
                  <div
                    key={producer.id}
                    className="group bg-white border border-slate-200 rounded-2xl p-6 hover:shadow-lg hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-amber-100 to-amber-200 rounded-xl flex items-center justify-center">
                        <Building2 size={22} className="text-amber-600" />
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setNewProducer({ name: producer.name });
                            setShowEditProducer(producer.id);
                          }}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteProducer(producer.id)}
                          disabled={saving || producer.projectCount > 0}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                          title={producer.projectCount > 0 ? "Tiene proyectos asignados" : "Eliminar"}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-slate-900 mb-1">{producer.name}</h3>
                    <p className="text-sm text-slate-500">
                      {producer.projectCount} proyecto{producer.projectCount !== 1 ? "s" : ""} asignado
                      {producer.projectCount !== 1 ? "s" : ""}
                    </p>

                    {producer.projectCount > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-100">
                        <p className="text-xs text-slate-400">Proyectos:</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {projects
                            .filter((p) => p.producers?.includes(producer.id))
                            .slice(0, 3)
                            .map((p) => (
                              <span
                                key={p.id}
                                className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs truncate max-w-[120px]"
                              >
                                {p.name}
                              </span>
                            ))}
                          {projects.filter((p) => p.producers?.includes(producer.id)).length > 3 && (
                            <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs">
                              +{projects.filter((p) => p.producers?.includes(producer.id)).length - 3}
                            </span>
                          )}
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

      {/* ==================== MODALS ==================== */}

      {/* Create/Edit Project Modal */}
      {(showCreateProject || showEditProject) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <FolderPlus size={20} className="text-slate-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {showEditProject ? "Editar proyecto" : "Nuevo proyecto"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowCreateProject(false);
                  setShowEditProject(null);
                  setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [] });
                  setProducerModalSearch("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del proyecto *</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="Mi nuevo proyecto"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Descripción del proyecto..."
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fase</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PHASES.map((phase) => {
                    const config = phaseConfig[phase];
                    const PhaseIcon = config.icon;
                    return (
                      <button
                        key={phase}
                        onClick={() => setNewProject({ ...newProject, phase })}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                          newProject.phase === phase
                            ? `${config.bg} ${config.text} ${config.border}`
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <PhaseIcon size={14} />
                        {phase}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Productoras */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Productoras</label>

                {newProject.producers.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {newProject.producers.map((prodId) => {
                      const prod = producers.find((p) => p.id === prodId);
                      if (!prod) return null;
                      return (
                        <span
                          key={prodId}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm"
                        >
                          <Building2 size={14} />
                          {prod.name}
                          <button
                            onClick={() =>
                              setNewProject({
                                ...newProject,
                                producers: newProject.producers.filter((id) => id !== prodId),
                              })
                            }
                            className="ml-1 text-amber-500 hover:text-amber-700"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={producerModalSearch}
                    onChange={(e) => setProducerModalSearch(e.target.value)}
                    placeholder="Buscar productora..."
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                  />
                </div>

                {producerModalSearch.length >= 2 && (
                  <div className="mt-2 border border-slate-200 rounded-xl max-h-40 overflow-y-auto">
                    {producers
                      .filter(
                        (p) =>
                          p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) &&
                          !newProject.producers.includes(p.id)
                      )
                      .slice(0, 5)
                      .map((producer) => (
                        <button
                          key={producer.id}
                          onClick={() => {
                            setNewProject({ ...newProject, producers: [...newProject.producers, producer.id] });
                            setProducerModalSearch("");
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                        >
                          <Building2 size={14} className="text-amber-600" />
                          <span className="text-slate-700">{producer.name}</span>
                          <span className="text-xs text-slate-400 ml-auto">{producer.projectCount} proyectos</span>
                        </button>
                      ))}
                    {producers.filter(
                      (p) =>
                        p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) &&
                        !newProject.producers.includes(p.id)
                    ).length === 0 && (
                      <div className="px-4 py-3 text-sm text-slate-500 text-center">No se encontraron productoras</div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={showEditProject ? handleEditProject : handleCreateProject}
                disabled={saving || !newProject.name.trim()}
                className="w-full px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Guardando..." : showEditProject ? "Guardar cambios" : "Crear proyecto"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Producer Modal */}
      {(showCreateProducer || showEditProducer) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {showEditProducer ? "Editar productora" : "Nueva productora"}
                </h3>
              </div>
              <button
                onClick={() => {
                  setShowCreateProducer(false);
                  setShowEditProducer(null);
                  setNewProducer({ name: "" });
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre de la productora *</label>
                <input
                  type="text"
                  value={newProducer.name}
                  onChange={(e) => setNewProducer({ ...newProducer, name: e.target.value })}
                  placeholder="Ej: Productora Films S.L."
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <button
                onClick={showEditProducer ? handleEditProducer : handleCreateProducer}
                disabled={saving || !newProducer.name.trim()}
                className="w-full px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? "Guardando..." : showEditProducer ? "Guardar cambios" : "Crear productora"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign User Modal */}
      {showAssignUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <UserPlus size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Asignar usuario</h3>
                  <p className="text-xs text-slate-500">
                    {projects.find((p) => p.id === showAssignUser)?.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAssignUser(null);
                  setAssignUserForm({ odId: "", role: "" });
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Usuario *</label>
                <select
                  value={assignUserForm.odId}
                  onChange={(e) => setAssignUserForm({ ...assignUserForm, odId: e.target.value })}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                >
                  <option value="">Seleccionar usuario...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rol en el proyecto *</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PROJECT_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => setAssignUserForm({ ...assignUserForm, role })}
                      className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        assignUserForm.role === role
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleAssignUser}
                disabled={saving || !assignUserForm.odId || !assignUserForm.role}
                className="w-full px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving ? "Asignando..." : "Asignar usuario"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Details Modal */}
      {showUserDetails &&
        (() => {
          const user = users.find((u) => u.id === showUserDetails);
          if (!user) return null;
          return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">Detalles del usuario</h3>
                  <button
                    onClick={() => setShowUserDetails(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  {/* User Header */}
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
                    <div className="w-16 h-16 bg-gradient-to-br from-slate-200 to-slate-300 rounded-2xl flex items-center justify-center text-slate-600 text-2xl font-semibold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-xl font-semibold text-slate-900">{user.name}</h4>
                        {user.role === "admin" && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold">
                            <Crown size={10} />
                            Admin
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 mt-1">{user.email}</p>
                    </div>
                  </div>

                  {/* Projects */}
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-3">
                      Proyectos asignados ({user.projectCount})
                    </p>
                    {user.projects && user.projects.length > 0 ? (
                      <div className="space-y-2">
                        {user.projects.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                <Briefcase size={14} className="text-blue-600" />
                              </div>
                              <span className="font-medium text-slate-900">{project.name}</span>
                            </div>
                            <span className="px-2.5 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-medium">
                              {project.role || project.position}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
                        <FolderOpen size={24} className="text-slate-300 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">Sin proyectos asignados</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50">
                  <button
                    onClick={() => setShowUserDetails(null)}
                    className="w-full px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Send Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <MessageSquare size={20} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Enviar mensaje</h3>
                  <p className="text-xs text-slate-500">Notifica a los usuarios de la plataforma</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setMessageForm({ title: "", content: "", type: "info", sendToAll: true, selectedProjects: [] });
                  setProjectSearchInMessage("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Message Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de mensaje</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "info", label: "Informativo", icon: Info, bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
                    { value: "warning", label: "Aviso", icon: AlertTriangle, bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
                    { value: "success", label: "Éxito", icon: CheckCircle, bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
                  ].map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        onClick={() => setMessageForm({ ...messageForm, type: type.value as typeof messageForm.type })}
                        className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium ${
                          messageForm.type === type.value
                            ? `${type.bg} ${type.text} ${type.border}`
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Icon size={14} />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Título *</label>
                <input
                  type="text"
                  value={messageForm.title}
                  onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value })}
                  placeholder="Ej: Actualización importante"
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje *</label>
                <textarea
                  value={messageForm.content}
                  onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })}
                  placeholder="Escribe el contenido del mensaje..."
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                />
              </div>

              {/* Recipients */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Destinatarios</label>
                
                {/* Send to all toggle */}
                <div className="space-y-3">
                  <button
                    onClick={() => setMessageForm({ ...messageForm, sendToAll: true, selectedProjects: [] })}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left ${
                      messageForm.sendToAll
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      messageForm.sendToAll ? "border-white" : "border-slate-300"
                    }`}>
                      {messageForm.sendToAll && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Todos los usuarios</p>
                      <p className={`text-xs ${messageForm.sendToAll ? "text-slate-300" : "text-slate-500"}`}>
                        Enviar a los {users.length} usuarios registrados
                      </p>
                    </div>
                    <Users size={18} className={messageForm.sendToAll ? "text-white" : "text-slate-400"} />
                  </button>

                  <button
                    onClick={() => setMessageForm({ ...messageForm, sendToAll: false })}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border text-left ${
                      !messageForm.sendToAll
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      !messageForm.sendToAll ? "border-white" : "border-slate-300"
                    }`}>
                      {!messageForm.sendToAll && <div className="w-2.5 h-2.5 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">Usuarios de proyectos específicos</p>
                      <p className={`text-xs ${!messageForm.sendToAll ? "text-slate-300" : "text-slate-500"}`}>
                        Selecciona uno o más proyectos
                      </p>
                    </div>
                    <Briefcase size={18} className={!messageForm.sendToAll ? "text-white" : "text-slate-400"} />
                  </button>
                </div>

                {/* Project selection */}
                {!messageForm.sendToAll && (
                  <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="relative mb-3">
                      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={projectSearchInMessage}
                        onChange={(e) => setProjectSearchInMessage(e.target.value)}
                        placeholder="Buscar proyectos..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                      />
                    </div>

                    {/* Selected projects */}
                    {messageForm.selectedProjects.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {messageForm.selectedProjects.map((projectId) => {
                          const project = projects.find((p) => p.id === projectId);
                          if (!project) return null;
                          return (
                            <span
                              key={projectId}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-sm"
                            >
                              <Briefcase size={12} />
                              {project.name}
                              <button
                                onClick={() => toggleProjectInMessage(projectId)}
                                className="ml-1 text-blue-500 hover:text-blue-700"
                              >
                                <X size={14} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Project list */}
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {filteredProjectsForMessage.map((project) => {
                        const isSelected = messageForm.selectedProjects.includes(project.id);
                        return (
                          <button
                            key={project.id}
                            onClick={() => toggleProjectInMessage(project.id)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left text-sm ${
                              isSelected
                                ? "bg-blue-50 border border-blue-200"
                                : "bg-white border border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare size={16} className="text-blue-600" />
                            ) : (
                              <Square size={16} className="text-slate-400" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className={`font-medium truncate ${isSelected ? "text-blue-900" : "text-slate-900"}`}>
                                {project.name}
                              </p>
                              <p className={`text-xs ${isSelected ? "text-blue-600" : "text-slate-500"}`}>
                                {project.memberCount} miembro{project.memberCount !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                      {filteredProjectsForMessage.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-4">No se encontraron proyectos</p>
                      )}
                    </div>

                    {/* Summary */}
                    {messageForm.selectedProjects.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-xs text-slate-600">
                          Se enviará a{" "}
                          <span className="font-semibold">
                            {(() => {
                              const userIdSet = new Set<string>();
                              projects
                                .filter((p) => messageForm.selectedProjects.includes(p.id))
                                .forEach((project) => {
                                  project.members?.forEach((member) => userIdSet.add(member.odId));
                                });
                              return userIdSet.size;
                            })()}{" "}
                            usuario(s)
                          </span>{" "}
                          de {messageForm.selectedProjects.length} proyecto(s)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setMessageForm({ title: "", content: "", type: "info", sendToAll: true, selectedProjects: [] });
                  setProjectSearchInMessage("");
                }}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={saving || !messageForm.title.trim() || !messageForm.content.trim() || (!messageForm.sendToAll && messageForm.selectedProjects.length === 0)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={16} />
                {saving ? "Enviando..." : "Enviar mensaje"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
