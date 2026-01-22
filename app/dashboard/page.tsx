"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { Folder, Search, Users, Settings, Clock, Mail, Check, X as XIcon, Building2, Sparkles, BarChart3, Archive, ChevronDown, FolderOpen, Filter, ArrowUpDown, KeyRound, AlertCircle, Bell, Info, AlertTriangle, CheckCircle, MessageSquare } from "lucide-react";
import Link from "next/link";
import { db, auth } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { collection, getDocs, getDoc, doc, query, where, updateDoc, setDoc, Timestamp, DocumentData, QueryDocumentSnapshot, orderBy, deleteDoc } from "firebase/firestore";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const phaseColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  Desarrollo: { bg: "bg-sky-50", border: "border-sky-200", text: "text-sky-700", dot: "bg-sky-500" },
  Preproducción: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" },
  Rodaje: { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", dot: "bg-indigo-500" },
  Postproducción: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700", dot: "bg-purple-500" },
  Finalizado: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
};

const PHASE_OPTIONS = [
  { value: "all", label: "Todas las fases" },
  { value: "Desarrollo", label: "Desarrollo" },
  { value: "Preproducción", label: "Preproducción" },
  { value: "Rodaje", label: "Rodaje" },
  { value: "Postproducción", label: "Postproducción" },
  { value: "Finalizado", label: "Finalizado" },
];

const SORT_OPTIONS = [
  { value: "recent", label: "Recientes" },
  { value: "name", label: "Nombre" },
  { value: "phase", label: "Fase" },
];

interface Project {
  id: string;
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  producerNames?: string[];
  role: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
  createdAt: Timestamp | null;
  addedAt: Timestamp | null;
  memberCount?: number;
  archived?: boolean;
  closingAt?: Timestamp | null;
}

interface Invitation {
  id: string;
  projectId: string;
  projectName: string;
  invitedBy: string;
  invitedByName: string;
  roleType: "project" | "department";
  role?: string;
  department?: string;
  position?: string;
  permissions: { config?: boolean; accounting: boolean; team: boolean };
  status: string;
  createdAt: Date | Timestamp;
  expiresAt: Date | Timestamp;
}

interface AdminMessage {
  id: string;
  title: string;
  content: string;
  type: "info" | "warning" | "success";
  sentAt: Timestamp;
  sentByName: string;
  read: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, isLoading: userLoading } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingInvite, setProcessingInvite] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPhase, setSelectedPhase] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "phase">("recent");
  const [showArchived, setShowArchived] = useState(false);
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [pendingConfigProjectId, setPendingConfigProjectId] = useState<string | null>(null);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);
  const phaseDropdownRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const userId = user?.uid || null;
  const userName = user?.name || "Usuario";
  const userEmail = user?.email || "";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (phaseDropdownRef.current && !phaseDropdownRef.current.contains(event.target as Node)) {
        setShowPhaseDropdown(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/");
      return;
    }
    if (!userLoading && user?.role === "admin") router.push("/admindashboard");
  }, [user, userLoading, router]);

  useEffect(() => {
    if (!userId) return;
    const loadData = async () => {
      try {
        const userProjectsRef = collection(db, `userProjects/${userId}/projects`);
        const userProjectsSnapshot = await getDocs(userProjectsRef);
        const projectsData: Project[] = [];

        for (const userProjectDoc of userProjectsSnapshot.docs) {
          const userProjectData = userProjectDoc.data();
          const projectId = userProjectDoc.id;
          const projectRef = doc(db, "projects", projectId);
          const projectSnapshot = await getDoc(projectRef);

          if (projectSnapshot.exists()) {
            const projectData = projectSnapshot.data();
            let producerNames: string[] = [];
            if (projectData.producers && Array.isArray(projectData.producers)) {
              for (const producerId of projectData.producers) {
                const producerDoc = await getDoc(doc(db, "producers", producerId));
                if (producerDoc.exists()) producerNames.push(producerDoc.data().name);
              }
            }
            const membersSnapshot = await getDocs(collection(db, `projects/${projectId}/members`));

            projectsData.push({
              id: projectSnapshot.id,
              name: projectData.name,
              phase: projectData.phase,
              description: projectData.description || "",
              producers: projectData.producers || [],
              producerNames: producerNames.length > 0 ? producerNames : undefined,
              role: userProjectData.role,
              department: userProjectData.department,
              position: userProjectData.position,
              permissions: userProjectData.permissions || { config: false, accounting: false, team: false },
              createdAt: projectData.createdAt || null,
              addedAt: userProjectData.addedAt || null,
              memberCount: membersSnapshot.size,
              archived: projectData.archived || false,
              closingAt: projectData.closingAt || null,
            });
          }
        }

        projectsData.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
        setProjects(projectsData);
        setFilteredProjects(projectsData.filter((p) => !p.archived));

        const invitationsRef = collection(db, "invitations");
        const q = query(invitationsRef, where("invitedEmail", "==", userEmail), where("status", "==", "pending"));
        const invitationsSnapshot = await getDocs(q);
        const invitationsData: Invitation[] = invitationsSnapshot.docs.map((invDoc: QueryDocumentSnapshot<DocumentData>) => {
          const data = invDoc.data();
          return {
            id: invDoc.id,
            projectId: data.projectId,
            projectName: data.projectName,
            invitedBy: data.invitedBy,
            invitedByName: data.invitedByName,
            roleType: data.roleType,
            role: data.role,
            department: data.department,
            position: data.position,
            permissions: data.permissions,
            status: data.status,
            createdAt: data.createdAt,
            expiresAt: data.expiresAt,
          };
        });
        setInvitations(invitationsData);

        // Load admin messages
        const messagesRef = collection(db, `users/${userId}/messages`);
        const messagesQuery = query(messagesRef, orderBy("sentAt", "desc"));
        const messagesSnapshot = await getDocs(messagesQuery);
        const messagesData: AdminMessage[] = messagesSnapshot.docs.map((msgDoc) => {
          const data = msgDoc.data();
          return {
            id: msgDoc.id,
            title: data.title,
            content: data.content,
            type: data.type || "info",
            sentAt: data.sentAt,
            sentByName: data.sentByName,
            read: data.read || false,
          };
        });
        setMessages(messagesData);
      } catch (error) {
        console.error("Error al cargar datos:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [userId, userEmail]);

  useEffect(() => {
    let filtered = [...projects].filter((p) => !p.archived);
    if (searchTerm) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.producerNames?.some((name) => name.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    if (selectedPhase !== "all") {
      filtered = filtered.filter((p) => p.phase === selectedPhase);
    }
    switch (sortBy) {
      case "name":
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "phase":
        filtered.sort((a, b) => a.phase.localeCompare(b.phase));
        break;
      default:
        filtered.sort((a, b) => (b.addedAt?.toMillis() || 0) - (a.addedAt?.toMillis() || 0));
    }
    setFilteredProjects(filtered);
  }, [searchTerm, selectedPhase, sortBy, projects]);

  const archivedProjects = projects.filter((p) => p.archived);
  const activeProjectsCount = projects.filter((p) => !p.archived).length;

  const handleAcceptInvitation = async (invitation: Invitation) => {
    if (!userId) return;
    setProcessingInvite(invitation.id);
    try {
      await updateDoc(doc(db, "invitations", invitation.id), { status: "accepted", respondedAt: new Date() });
      await setDoc(doc(db, `projects/${invitation.projectId}/members`, userId), {
        userId,
        name: userName,
        email: userEmail,
        role: invitation.role || null,
        department: invitation.department || null,
        position: invitation.position || null,
        permissions: {
          config: invitation.permissions.config || false,
          accounting: invitation.permissions.accounting,
          team: invitation.permissions.team,
        },
        addedAt: new Date(),
      });
      await setDoc(doc(db, `userProjects/${userId}/projects/${invitation.projectId}`), {
        projectId: invitation.projectId,
        role: invitation.role || null,
        department: invitation.department || null,
        position: invitation.position || null,
        permissions: {
          config: invitation.permissions.config || false,
          accounting: invitation.permissions.accounting,
          team: invitation.permissions.team,
        },
        addedAt: new Date(),
      });
      window.location.reload();
    } catch (error) {
      console.error("Error aceptando invitación:", error);
      alert("Error al aceptar la invitación");
      setProcessingInvite(null);
    }
  };

  const handleRejectInvitation = async (invitationId: string) => {
    if (!confirm("¿Estás seguro de que deseas rechazar esta invitación?")) return;
    setProcessingInvite(invitationId);
    try {
      await updateDoc(doc(db, "invitations", invitationId), { status: "rejected", respondedAt: new Date() });
      setInvitations(invitations.filter((i) => i.id !== invitationId));
      setProcessingInvite(null);
    } catch (error) {
      console.error("Error rechazando invitación:", error);
      alert("Error al rechazar la invitación");
      setProcessingInvite(null);
    }
  };

  // Message handlers
  const handleMarkMessageAsRead = async (messageId: string) => {
    if (!userId) return;
    try {
      await updateDoc(doc(db, `users/${userId}/messages`, messageId), { read: true });
      setMessages(messages.map((m) => (m.id === messageId ? { ...m, read: true } : m)));
    } catch (error) {
      console.error("Error marking message as read:", error);
    }
  };

  const handleDismissMessage = async (messageId: string) => {
    if (!userId) return;
    try {
      await deleteDoc(doc(db, `users/${userId}/messages`, messageId));
      setMessages(messages.filter((m) => m.id !== messageId));
      if (expandedMessage === messageId) setExpandedMessage(null);
    } catch (error) {
      console.error("Error dismissing message:", error);
    }
  };

  const unreadMessagesCount = messages.filter((m) => !m.read).length;

  const getMessageConfig = (type: AdminMessage["type"]) => {
    switch (type) {
      case "warning":
        return { icon: AlertTriangle, bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", iconBg: "bg-amber-100" };
      case "success":
        return { icon: CheckCircle, bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", iconBg: "bg-emerald-100" };
      default:
        return { icon: Info, bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", iconBg: "bg-blue-100" };
    }
  };

  const getPhaseLabel = () => {
    const opt = PHASE_OPTIONS.find((o) => o.value === selectedPhase);
    return opt?.label || "Todas las fases";
  };

  const getSortLabel = () => {
    const opt = SORT_OPTIONS.find((o) => o.value === sortBy);
    return opt?.label || "Recientes";
  };

  const handleConfigClick = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingConfigProjectId(projectId);
    setShowPasswordModal(true);
    setPasswordInput("");
    setPasswordError("");
  };

  const verifyPasswordAndNavigate = async () => {
    if (!passwordInput.trim()) {
      setPasswordError("Introduce tu contraseña");
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      setPasswordError("No hay usuario autenticado");
      return;
    }
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, passwordInput);
      await reauthenticateWithCredential(currentUser, credential);
      setShowPasswordModal(false);
      setPasswordInput("");
      setPasswordError("");
      if (pendingConfigProjectId) {
        router.push("/project/" + pendingConfigProjectId + "/config");
      }
    } catch (error: any) {
      if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        setPasswordError("Contraseña incorrecta");
      } else {
        setPasswordError("Error de autenticación");
      }
    }
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
    setPasswordInput("");
    setPasswordError("");
    setPendingConfigProjectId(null);
  };

  // Helper para calcular días hasta el cierre
  const getDaysUntilClose = (closingAt: Timestamp | null | undefined) => {
    if (!closingAt) return null;
    const now = new Date();
    const closeDate = closingAt.toDate();
    const diffTime = closeDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const renderProjectCard = (project: Project) => {
    const hasConfig = project.permissions.config;
    const hasAccounting = project.permissions.accounting;
    const hasTeam = project.permissions.team;
    const daysUntilClose = getDaysUntilClose(project.closingAt);

    return (
      <div key={project.id} className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 hover:shadow-lg">
        {/* Aviso de cierre */}
        {daysUntilClose !== null && (
          <div className="mb-3 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <Clock size={12} className="text-red-500" />
            <span className="text-[10px] font-medium text-red-700">
              Cierra en {daysUntilClose} día{daysUntilClose !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {/* Nombre y fase */}
        <div className="flex items-start justify-between mb-2">
          <h2 className="text-base font-semibold text-slate-900 truncate flex-1 min-w-0">{project.name}</h2>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-slate-100 text-slate-500 ml-2 flex-shrink-0">
            {project.phase}
          </span>
        </div>

        {/* Productoras */}
        {project.producerNames && project.producerNames.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2">
            <Building2 size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 truncate">{project.producerNames.join(", ")}</span>
          </div>
        )}

        {/* Rol */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {project.role && (
            <span className="text-[10px] text-slate-600 bg-slate-100 rounded-lg px-2 py-0.5">{project.role}</span>
          )}
          {project.position && (
            <span className="text-[10px] text-slate-600 bg-slate-100 rounded-lg px-2 py-0.5">{project.position}</span>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-2 pt-3 border-t border-slate-100">
          {hasConfig && (
            <button onClick={(e) => handleConfigClick(e, project.id)} className="flex-1">
              <div className="flex items-center justify-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 text-slate-600 text-xs font-medium">
                <Settings size={12} />
                Config
              </div>
            </button>
          )}
          {hasAccounting && (
            <Link href={`/project/${project.id}/accounting`} className="flex-1">
              <div 
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-medium border"
                style={{ 
                  backgroundColor: 'rgba(47, 82, 224, 0.1)',
                  borderColor: 'rgba(47, 82, 224, 0.3)',
                  color: '#2F52E0'
                }}
              >
                <BarChart3 size={12} />
                Accounting
              </div>
            </Link>
          )}
          {hasTeam && (
            <Link href={`/project/${project.id}/team`} className="flex-1">
              <div 
                className="flex items-center justify-center gap-1.5 p-2 rounded-xl text-xs font-medium border"
                style={{ 
                  backgroundColor: 'rgba(137, 211, 34, 0.15)',
                  borderColor: 'rgba(137, 211, 34, 0.4)',
                  color: '#6BA319'
                }}
              >
                <Users size={12} />
                Team
              </div>
            </Link>
          )}
        </div>
      </div>
    );
  };

  const renderArchivedCard = (project: Project) => {
    const hasConfig = project.permissions.config;
    const hasAccounting = project.permissions.accounting;
    const hasTeam = project.permissions.team;

    return (
      <div key={project.id} className="group bg-slate-50/50 border border-slate-200 rounded-2xl p-5 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all">
        {/* Nombre y badge archivado */}
        <div className="flex items-start justify-between mb-2">
          <h2 className="text-base font-semibold text-slate-600 truncate flex-1 min-w-0">{project.name}</h2>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 ml-2 flex-shrink-0">
            Archivado
          </span>
        </div>

        {/* Productoras */}
        {project.producerNames && project.producerNames.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2">
            <Building2 size={11} className="text-slate-400" />
            <span className="text-[11px] text-slate-400 truncate">{project.producerNames.join(", ")}</span>
          </div>
        )}

        {/* Fase y rol */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400">
            {project.phase}
          </span>
          {project.role && (
            <span className="text-[10px] text-slate-500 bg-slate-100 rounded-lg px-2 py-0.5">{project.role}</span>
          )}
          {project.position && (
            <span className="text-[10px] text-slate-500 bg-slate-100 rounded-lg px-2 py-0.5">{project.position}</span>
          )}
        </div>

        {/* Botones */}
        <div className="flex gap-2 pt-3 border-t border-slate-200">
          {hasConfig && (
            <button onClick={(e) => handleConfigClick(e, project.id)} className="flex-1">
              <div className="flex items-center justify-center gap-1.5 p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-500 text-xs font-medium">
                <Settings size={12} />
                Config
              </div>
            </button>
          )}
          {hasAccounting && (
            <Link href={`/project/${project.id}/accounting`} className="flex-1">
              <div className="flex items-center justify-center gap-1.5 p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-500 text-xs font-medium">
                <BarChart3 size={12} />
                Accounting
              </div>
            </Link>
          )}
          {hasTeam && (
            <Link href={`/project/${project.id}/team`} className="flex-1">
              <div className="flex items-center justify-center gap-1.5 p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-500 text-xs font-medium">
                <Users size={12} />
                Team
              </div>
            </Link>
          )}
        </div>
      </div>
    );
  };

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Notification Banners - Fixed at top */}
      {messages.length > 0 && (
        <div className="fixed top-[4.5rem] left-0 right-0 z-40 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-3 space-y-2 bg-gradient-to-b from-white via-white to-transparent pointer-events-none">
          {messages.slice(0, 3).map((message) => {
            const config = getMessageConfig(message.type);
            const Icon = config.icon;

            return (
              <div
                key={message.id}
                className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-sm ${config.bg} ${config.border}`}
              >
                <Icon size={16} className={config.text} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${config.text}`}>{message.title}</p>
                  {expandedMessage === message.id && (
                    <p className="text-xs text-slate-600 mt-1">{message.content}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {expandedMessage !== message.id && (
                    <button
                      onClick={() => {
                        setExpandedMessage(message.id);
                        if (!message.read) handleMarkMessageAsRead(message.id);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      Ver
                    </button>
                  )}
                  <button
                    onClick={() => handleDismissMessage(message.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              </div>
            );
          })}
          {messages.length > 3 && (
            <p className="pointer-events-auto text-xs text-slate-500 text-center">
              +{messages.length - 3} notificación{messages.length - 3 !== 1 ? "es" : ""} más
            </p>
          )}
        </div>
      )}

      {/* Header con título centrado */}
      <div className={messages.length > 0 ? "mt-[4.5rem] pt-20" : "mt-[4.5rem]"}>
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-10 pb-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center">Panel de proyectos</h1>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {/* Invitaciones */}
        {invitations.length > 0 && (
          <div className="mb-6">
            <div className="rounded-2xl p-6 shadow-lg" style={{ background: 'linear-gradient(to right, #2F52E0, #4F6FE8)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                  <Mail size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    Tienes {invitations.length} {invitations.length === 1 ? "invitación pendiente" : "invitaciones pendientes"}
                  </h2>
                  <p className="text-sm text-white/70">Te han invitado a unirte a nuevos proyectos</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="bg-white rounded-2xl p-4 shadow-sm">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <Folder size={18} className="text-slate-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">{invitation.projectName}</h3>
                        <p className="text-xs text-slate-500">Invitado por {invitation.invitedByName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-medium text-slate-700 bg-slate-100 rounded-lg px-2 py-1">
                        {invitation.roleType === "project" ? invitation.role : invitation.position}
                      </span>
                      {invitation.permissions.accounting && (
                        <span 
                          className="text-xs px-2 py-1 rounded-lg"
                          style={{ backgroundColor: 'rgba(47, 82, 224, 0.1)', color: '#2F52E0' }}
                        >
                          Accounting
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAcceptInvitation(invitation)}
                        disabled={processingInvite === invitation.id}
                        className="flex-1 flex items-center justify-center gap-1.5 font-medium rounded-xl py-2 text-sm transition-all disabled:opacity-50"
                        style={{ backgroundColor: '#463E39', color: '#F4F3EE' }}
                      >
                        <Check size={14} />
                        {processingInvite === invitation.id ? "..." : "Aceptar"}
                      </button>
                      <button
                        onClick={() => handleRejectInvitation(invitation.id)}
                        disabled={processingInvite === invitation.id}
                        className="flex items-center justify-center px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl py-2 transition-all disabled:opacity-50"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {projects.length === 0 && invitations.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl">
            <div className="flex items-center justify-center py-20">
              <div className="text-center max-w-md">
                <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Sparkles size={32} className="text-slate-400" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">Bienvenido a tu espacio de trabajo</h2>
                <p className="text-sm text-slate-600 leading-relaxed mb-6">
                  Aún no tienes proyectos asignados. Cuando un administrador te añada a un proyecto, aparecerá aquí automáticamente.
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <Clock size={14} />
                  <span>Las invitaciones a proyectos también aparecerán aquí</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Barra de filtros */}
            {activeProjectsCount > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6">
                <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
                  {/* Buscador */}
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Buscar proyectos"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                    />
                  </div>

                  {/* Filtros */}
                  <div className="flex flex-wrap gap-2 lg:flex-shrink-0">
                    {/* Phase Dropdown */}
                    <div className="relative" ref={phaseDropdownRef}>
                      <button
                        onClick={() => {
                          setShowPhaseDropdown(!showPhaseDropdown);
                          setShowSortDropdown(false);
                        }}
                        className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[160px] ${
                          selectedPhase !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                        }`}
                      >
                        <Filter size={14} className={selectedPhase !== "all" ? "text-white" : "text-slate-400"} />
                        <span className="flex-1 text-left truncate">{getPhaseLabel()}</span>
                        <ChevronDown size={14} className={`transition-transform ${showPhaseDropdown ? "rotate-180" : ""} ${selectedPhase !== "all" ? "text-white" : "text-slate-400"}`} />
                      </button>
                      {showPhaseDropdown && (
                        <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                          {PHASE_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSelectedPhase(option.value);
                                setShowPhaseDropdown(false);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                                selectedPhase === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative" ref={sortDropdownRef}>
                      <button
                        onClick={() => {
                          setShowSortDropdown(!showSortDropdown);
                          setShowPhaseDropdown(false);
                        }}
                        className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium bg-white hover:border-slate-300 transition-colors"
                      >
                        <ArrowUpDown size={14} className="text-slate-400" />
                        <span className="text-slate-700">{getSortLabel()}</span>
                        <ChevronDown size={14} className={`text-slate-400 transition-transform ${showSortDropdown ? "rotate-180" : ""}`} />
                      </button>
                      {showSortDropdown && (
                        <div className="absolute top-full right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                          {SORT_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => {
                                setSortBy(option.value as "recent" | "name" | "phase");
                                setShowSortDropdown(false);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                                sortBy === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Limpiar filtros */}
                    {(searchTerm || selectedPhase !== "all") && (
                      <button
                        onClick={() => {
                          setSearchTerm("");
                          setSelectedPhase("all");
                        }}
                        className="flex items-center gap-1.5 px-4 py-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
                      >
                        <XIcon size={14} />
                        Limpiar
                      </button>
                    )}

                    {/* Archivados toggle */}
                    {archivedProjects.length > 0 && (
                      <button
                        onClick={() => setShowArchived(!showArchived)}
                        className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          showArchived 
                            ? "bg-amber-100 text-amber-700 border border-amber-200" 
                            : "text-slate-600 hover:text-slate-700 hover:bg-slate-100 bg-white border border-slate-200"
                        }`}
                      >
                        <Archive size={14} />
                        <span>{archivedProjects.length} archivado{archivedProjects.length !== 1 ? "s" : ""}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Proyectos activos */}
            {activeProjectsCount > 0 && (
              <>
                {filteredProjects.length === 0 ? (
                  <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl">
                    <FolderOpen size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm font-medium mb-2">No se encontraron proyectos</p>
                    <button
                      onClick={() => {
                        setSearchTerm("");
                        setSelectedPhase("all");
                      }}
                      className="text-sm text-slate-700 hover:text-slate-900 font-medium underline"
                    >
                      Limpiar filtros
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredProjects.map((project) => renderProjectCard(project))}
                  </div>
                )}
              </>
            )}

            {/* Proyectos archivados - Siempre visibles si existen */}
            {archivedProjects.length > 0 && (
              <div className={`mt-10 ${!showArchived ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex items-center gap-3 mb-5 group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Archive size={18} className="text-amber-600" />
                    <span className="text-base font-semibold text-slate-700">Proyectos archivados</span>
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                      {archivedProjects.length}
                    </span>
                  </div>
                  <ChevronDown 
                    size={16} 
                    className={`text-slate-400 transition-transform ${showArchived ? 'rotate-180' : ''}`} 
                  />
                </button>
                
                {showArchived && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {archivedProjects.map((project) => renderArchivedCard(project))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal de contraseña para Config */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closePasswordModal}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                <Settings size={20} className="text-slate-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Acceso a Configuración</h3>
                <p className="text-xs text-slate-500">Confirma tu identidad para continuar</p>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") verifyPasswordAndNavigate(); }}
                  placeholder="Tu contraseña de usuario"
                  className={"w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm " + (passwordError ? "border-red-300 bg-red-50" : "border-slate-200")}
                  autoFocus
                />
                {passwordError && (
                  <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {passwordError}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-2">Usuario: {userEmail}</p>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={closePasswordModal} 
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={verifyPasswordAndNavigate} 
                  disabled={!passwordInput.trim()} 
                  className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium transition-opacity disabled:opacity-50 hover:bg-slate-800"
                >
                  Acceder
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
