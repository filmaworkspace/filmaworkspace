"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  addDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Clock,
  Crown,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Info,
  LayoutDashboard,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Square,
  Trash2,
  TrendingUp,
  UserPlus,
  Users,
  X,
  HeadphonesIcon,
  CheckCheck,
  Circle,
  Loader2,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200", dot: "bg-sky-500" },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", dot: "bg-amber-500" },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", dot: "bg-rose-500" },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200", dot: "bg-violet-500" },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-500" },
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

// ─── Types ───────────────────────────────────────────────────────────────────

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
  stats?: { poCount: number; invoiceCount: number; budgetTotal: number };
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
  phone?: string;
  role: string;
  isDemo?: boolean;
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
  users?: { id: string; name: string; email: string }[];
}

interface SupportChat {
  id:            string;
  userId:        string;
  userName:      string;
  userEmail:     string;
  status:        "open" | "resolved";
  lastMessage:   string;
  lastMessageAt: Timestamp | null;
  unreadAdmin:   number;
}

interface SupportMessage {
  id:         string;
  text:       string;
  sender:     "user" | "admin";
  senderName: string;
  createdAt:  Timestamp | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "users" | "producers" | "messages" | "support">("projects");

  // Support
  const [supportChats,      setSupportChats]      = useState<SupportChat[]>([]);
  const [activeChatId,      setActiveChatId]      = useState<string | null>(null);
  const [chatMessages,      setChatMessages]       = useState<SupportMessage[]>([]);
  const [supportInput,      setSupportInput]       = useState("");
  const [supportSending,    setSupportSending]     = useState(false);
  const [totalUnreadSupport, setTotalUnreadSupport] = useState(0);
  const supportMsgsRef = useRef<HTMLDivElement>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [activeMessages, setActiveMessages] = useState<{
    id: string;
    odId: string;
    title: string;
    content: string;
    type: "info" | "warning" | "success";
    sentAt: Timestamp;
    expiresAt: Timestamp | null;
    sentByName: string;
    targetProjects: string[] | null;
    recipientCount: number;
  }[]>([]);

  const [projectSearch, setProjectSearch] = useState("");
  const [projectPhaseFilter, setProjectPhaseFilter] = useState("all");
  const [showPhaseDropdown, setShowPhaseDropdown] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [producerSearch, setProducerSearch] = useState("");
  const [producerModalSearch, setProducerModalSearch] = useState("");

  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateProducer, setShowCreateProducer] = useState(false);
  const [showEditProducer, setShowEditProducer] = useState<string | null>(null);
  const [showUserDetails, setShowUserDetails] = useState<string | null>(null);
  const [showAssignUser, setShowAssignUser] = useState<string | null>(null);
  const [showEditProject, setShowEditProject] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [showAssignCompanyUser, setShowAssignCompanyUser] = useState<string | null>(null);
  const [companyUserSearch, setCompanyUserSearch] = useState("");

  const [newProject, setNewProject] = useState({ name: "", description: "", phase: "Desarrollo", producers: [] as string[], customId: "", useCustomId: false, language: "es" });
  const [newProducer, setNewProducer] = useState({ name: "" });
  const [assignUserForm, setAssignUserForm] = useState({ odId: "", role: "" });

  // Demo user modal
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoForm, setDemoForm] = useState({ name: "", email: "", password: "" });
  const [demoCreated, setDemoCreated] = useState<{ email: string; password: string } | null>(null);
  const [demoSaving, setDemoSaving] = useState(false);
  const [demoError, setDemoError] = useState("");

  // Message modal states
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageForm, setMessageForm] = useState({
    title: "",
    content: "",
    type: "info" as "info" | "warning" | "success",
    recipientMode: "all" as "all" | "projects" | "users",
    selectedProjects: [] as string[],
    selectedUsers: [] as string[],
    duration: "indefinite" as "24h" | "7d" | "30d" | "indefinite",
    sendByEmail: false,
  });
  const [emailConfirmStep, setEmailConfirmStep] = useState(false);
  const [projectSearchInMessage, setProjectSearchInMessage] = useState("");
  const [userSearchInMessage, setUserSearchInMessage] = useState("");
  const [messageTab, setMessageTab] = useState<"compose" | "history">("compose");

  // Custom confirm dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const showConfirmDialog = (title: string, message: string, onConfirm: () => void, options?: { confirmLabel?: string; danger?: boolean }) => {
    setConfirmDialog({ title, message, onConfirm, danger: options?.danger ?? true, confirmLabel: options?.confirmLabel });
  };

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);


  const menuRef = useRef<HTMLDivElement>(null);
  const phaseDropdownRef = useRef<HTMLDivElement>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

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
      if (phaseDropdownRef.current && !phaseDropdownRef.current.contains(e.target as Node)) {
        setShowPhaseDropdown(false);
      }
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setShowRoleDropdown(false);
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
            phone: data.phone || "",
            role: data.role || "user",
            isDemo: data.isDemo || false,
            projectCount: userProjectsSnap.size,
            projects: userProjects,
          };
        })
      );
      setUsers(usersData);

      // Assign users to producers based on companyId
      producersData.forEach((p) => {
        p.users = usersData
          .filter((u) => {
            const userData = usersSnap.docs.find((d) => d.id === u.id)?.data();
            return userData?.companyId === p.id;
          })
          .map((u) => ({ id: u.id, name: u.name, email: u.email }));
      });
      setProducers(producersData);

      // Load active messages from all users
      const messagesMap = new Map<string, {
        id: string;
        odId: string;
        title: string;
        content: string;
        type: "info" | "warning" | "success";
        sentAt: Timestamp;
        expiresAt: Timestamp | null;
        sentByName: string;
        targetProjects: string[] | null;
        recipientCount: number;
      }>();

      for (const user of usersData) {
        const userMessagesSnap = await getDocs(collection(db, `users/${user.id}/messages`));
        for (const msgDoc of userMessagesSnap.docs) {
          const msgData = msgDoc.data();
          // Use title+content+sentAt as unique key to group same messages
          const key = `${msgData.title}-${msgData.sentAt?.toMillis()}`;
          
          if (messagesMap.has(key)) {
            const existing = messagesMap.get(key)!;
            existing.recipientCount++;
          } else {
            // Check if expired
            if (msgData.expiresAt && msgData.expiresAt.toDate() < new Date()) {
              // Delete expired message
              await deleteDoc(doc(db, `users/${user.id}/messages`, msgDoc.id));
              continue;
            }
            
            messagesMap.set(key, {
              id: msgDoc.id,
              odId: user.id,
              title: msgData.title,
              content: msgData.content,
              type: msgData.type || "info",
              sentAt: msgData.sentAt,
              expiresAt: msgData.expiresAt || null,
              sentByName: msgData.sentByName || "Admin",
              targetProjects: msgData.targetProjects || null,
              recipientCount: 1,
            });
          }
        }
      }

      const messagesData = Array.from(messagesMap.values()).sort(
        (a, b) => (b.sentAt?.toMillis() || 0) - (a.sentAt?.toMillis() || 0)
      );
      setActiveMessages(messagesData);

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

  // Real-time support chats listener
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(collection(db, "supportChats"), (snap) => {
      const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportChat));
      chats.sort((a, b) => (b.lastMessageAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? 0));
      setSupportChats(chats);
      setTotalUnreadSupport(chats.reduce((sum, c) => sum + (c.unreadAdmin > 0 ? 1 : 0), 0));
    });
    return () => unsub();
  }, [isAdmin]);

  // Load messages when active chat changes
  useEffect(() => {
    if (!activeChatId) { setChatMessages([]); return; }
    const q = query(
      collection(db, `supportChats/${activeChatId}/messages`),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportMessage)));
      setTimeout(() => supportMsgsRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    });
    // Mark as read
    updateDoc(doc(db, "supportChats", activeChatId), { unreadAdmin: 0 }).catch(() => {});
    return () => unsub();
  }, [activeChatId]);

  const handleSupportReply = async () => {
    const text = supportInput.trim();
    if (!text || !activeChatId || supportSending) return;
    setSupportSending(true);
    setSupportInput("");
    try {
      await addDoc(collection(db, `supportChats/${activeChatId}/messages`), {
        text, sender: "admin", senderName: "Soporte Filma", createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportChats", activeChatId), {
        lastMessage: text, lastMessageAt: serverTimestamp(), unreadUser: 1,
      });
    } finally {
      setSupportSending(false);
    }
  };

  const handleResolveChat = async (chatId: string) => {
    await updateDoc(doc(db, "supportChats", chatId), { status: "resolved", unreadAdmin: 0 });
    if (activeChatId === chatId) setActiveChatId(null);
  };

  const handleReopenChat = async (chatId: string) => {
    await updateDoc(doc(db, "supportChats", chatId), { status: "open" });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    showToast("success", "Datos actualizados");
  };

  // Generar ID corto de 6 caracteres
  const generateShortId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    if (newProject.useCustomId) {
      const raw = newProject.customId.trim();
      if (!raw) { showToast("error", "Introduce un ID para el proyecto"); return; }
      if (!/^[a-zA-Z0-9_-]+$/.test(raw)) { showToast("error", "El ID solo puede contener letras, números, guiones y guiones bajos"); return; }
      const existing = await getDoc(doc(db, "projects", raw));
      if (existing.exists()) { showToast("error", `Ya existe un proyecto con el ID "${raw}"`); return; }
    }
    setSaving(true);
    try {
      const projectId = newProject.useCustomId ? newProject.customId.trim() : generateShortId();
      const projectRef = doc(db, "projects", projectId);
      
      // Crear proyecto con departamentos como array (igual que el resto de la app)
      await setDoc(projectRef, {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
        departments: DEFAULT_DEPARTMENTS.map(d => d.name),
        language: newProject.language,
        createdAt: serverTimestamp(),
      });

      // Sincronizar companyProjects para cada productora asignada
      for (const producerId of newProject.producers) {
        await setDoc(doc(db, `companyProjects/${producerId}/projects`, projectId), {
          projectId,
          name: newProject.name.trim(),
          phase: newProject.phase,
          addedAt: serverTimestamp(),
        });
      }
      
      setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false, language: "es" });
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
      const oldProject = projects.find(p => p.id === showEditProject);
      const oldProducers = oldProject?.producers || [];
      const newProducers = newProject.producers;

      await updateDoc(doc(db, "projects", showEditProject), {
        name: newProject.name.trim(),
        description: newProject.description.trim(),
        phase: newProject.phase,
        producers: newProject.producers,
        language: newProject.language,
      });

      // Sincronizar companyProjects
      // Eliminar de productoras que ya no están asignadas
      for (const producerId of oldProducers) {
        if (!newProducers.includes(producerId)) {
          await deleteDoc(doc(db, `companyProjects/${producerId}/projects`, showEditProject));
        }
      }
      
      // Añadir/actualizar en productoras asignadas
      for (const producerId of newProducers) {
        await setDoc(doc(db, `companyProjects/${producerId}/projects`, showEditProject), {
          projectId: showEditProject,
          name: newProject.name.trim(),
          phase: newProject.phase,
          addedAt: serverTimestamp(),
        });
      }

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
    showConfirmDialog(`Eliminar "${project.name}"`, "Esta acción eliminará el proyecto y todos sus miembros. No se puede deshacer.", () => _doDeleteProject(projectId));
  };
  const _doDeleteProject = async (projectId: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/delete-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al eliminar");
      showToast("success", "Proyecto eliminado completamente");
      setActiveMenu(null);
      setConfirmDialog(null);
      await loadData();
    } catch (error: any) {
      console.error(error);
      showToast("error", error.message || "Error al eliminar");
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
    showConfirmDialog(`Eliminar "${producer.name}"`, "Se eliminará la productora permanentemente.", () => _doDeleteProducer(producerId));
  };
  const _doDeleteProducer = async (producerId: string) => {
    const producer = producers.find((p) => p.id === producerId);
    if (!producer) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, "producers", producerId));
      showToast("success", "Productora eliminada");
      setConfirmDialog(null);
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
    showConfirmDialog("Eliminar usuario del proyecto", "El usuario perderá acceso a este proyecto.", () => _doRemoveUserFromProject(projectId, odId));
  };
  const _doRemoveUserFromProject = async (projectId: string, odId: string) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${projectId}/members`, odId));
      await deleteDoc(doc(db, `userProjects/${odId}/projects/${projectId}`));
      showToast("success", "Usuario eliminado del proyecto");
      setConfirmDialog(null);
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
    const user = users.find(u => u.id === odId);
    showConfirmDialog(
      newRole === "admin" ? "Hacer administrador" : "Quitar administrador",
      newRole === "admin"
        ? `${user?.name} tendrá acceso completo al panel de administración.`
        : `${user?.name} dejará de ser administrador.`,
      () => _doToggleUserRole(odId, newRole),
      { danger: newRole !== "admin", confirmLabel: newRole === "admin" ? "Hacer admin" : "Quitar admin" }
    );
  };
  const _doToggleUserRole = async (odId: string, newRole: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { role: newRole });
      showToast("success", "Rol actualizado");
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    showConfirmDialog(
      `Eliminar "${user.name}"`,
      `Se eliminará el usuario de Firebase Auth y Firestore. Sus proyectos quedarán intactos pero sin este miembro. Esta acción no se puede deshacer.`,
      () => _doDeleteUser(userId),
      { danger: true, confirmLabel: "Eliminar usuario" }
    );
  };
  const _doDeleteUser = async (userId: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: userId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Error al eliminar");
      showToast("success", "Usuario eliminado completamente");
      setConfirmDialog(null);
      setShowUserDetails(null);
      await loadData();
    } catch (error: any) {
      console.error(error);
      showToast("error", error.message || "Error al eliminar");
    } finally {
      setSaving(false);
    }
  };

  const handleAssignCompanyUser = async (odId: string, producerId: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { companyId: producerId });
      setShowAssignCompanyUser(null);
      setCompanyUserSearch("");
      showToast("success", "Usuario asignado a productora");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al asignar usuario");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCompanyUser = async (odId: string) => {
    const user = users.find(u => u.id === odId);
    showConfirmDialog("Quitar de productora", `${user?.name} dejará de tener acceso al panel de la productora.`, () => _doRemoveCompanyUser(odId));
  };
  const _doRemoveCompanyUser = async (odId: string) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { companyId: null });
      showToast("success", "Usuario eliminado de productora");
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar usuario");
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
    if (messageForm.recipientMode === "projects" && messageForm.selectedProjects.length === 0) {
      showToast("error", "Selecciona al menos un proyecto");
      return;
    }
    if (messageForm.recipientMode === "users" && messageForm.selectedUsers.length === 0) {
      showToast("error", "Selecciona al menos un usuario");
      return;
    }

    setSaving(true);
    try {
      // Determine which users to send to
      let targetUserIds: string[] = [];

      if (messageForm.recipientMode === "all") {
        targetUserIds = users.map((u) => u.id);
      } else if (messageForm.recipientMode === "projects") {
        const selectedProjectsData = projects.filter((p) => messageForm.selectedProjects.includes(p.id));
        const userIdSet = new Set<string>();
        selectedProjectsData.forEach((project) => {
          project.members?.forEach((member) => { userIdSet.add(member.odId); });
        });
        targetUserIds = Array.from(userIdSet);
      } else {
        targetUserIds = messageForm.selectedUsers;
      }

      // Calculate expiration
      let expiresAt: Date | null = null;
      if (messageForm.duration !== "indefinite") {
        expiresAt = new Date();
        if (messageForm.duration === "24h") expiresAt.setHours(expiresAt.getHours() + 24);
        else if (messageForm.duration === "7d") expiresAt.setDate(expiresAt.getDate() + 7);
        else if (messageForm.duration === "30d") expiresAt.setDate(expiresAt.getDate() + 30);
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
        targetProjects: messageForm.recipientMode === "projects" ? messageForm.selectedProjects : null,
        expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : null,
      };

      // Save message to each user's messages subcollection
      for (const odId of targetUserIds) {
        const messageRef = doc(collection(db, `users/${odId}/messages`));
        await setDoc(messageRef, messageData);
      }

      // Fire-and-forget email broadcast if requested
      if (messageForm.sendByEmail) {
        const emails = targetUserIds.map((id) => users.find((u) => u.id === id)?.email).filter(Boolean) as string[];
        fetch("/api/send-broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: emails, title: messageForm.title.trim(), content: messageForm.content.trim(), type: messageForm.type }),
        }).catch(console.error);
      }

      // Reset form and close modal
      setEmailConfirmStep(false);
      setMessageForm({
        title: "",
        content: "",
        type: "info",
        recipientMode: "all",
        selectedProjects: [],
        selectedUsers: [],
        duration: "indefinite",
        sendByEmail: false,
      });
      setProjectSearchInMessage("");
      setUserSearchInMessage("");
      setShowMessageModal(false);
      showToast("success", `Mensaje enviado a ${targetUserIds.length} usuario${targetUserIds.length !== 1 ? "s" : ""}${messageForm.sendByEmail ? " (+ email)" : ""}`);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al enviar el mensaje");
    } finally {
      setSaving(false);
    }
  };

  // Delete message from all users
  const handleDeleteMessage = async (messageTitle: string, messageSentAt: Timestamp) => {
    showConfirmDialog("Eliminar mensaje", "Se eliminará de todos los usuarios que lo hayan recibido.", () => _doDeleteMessage(messageTitle, messageSentAt));
  };
  const _doDeleteMessage = async (messageTitle: string, messageSentAt: Timestamp) => {
    
    setSaving(true);
    try {
      let deletedCount = 0;
      for (const user of users) {
        const userMessagesSnap = await getDocs(collection(db, `users/${user.id}/messages`));
        for (const msgDoc of userMessagesSnap.docs) {
          const msgData = msgDoc.data();
          if (msgData.title === messageTitle && msgData.sentAt?.toMillis() === messageSentAt?.toMillis()) {
            await deleteDoc(doc(db, `users/${user.id}/messages`, msgDoc.id));
            deletedCount++;
          }
        }
      }
      showToast("success", `Mensaje eliminado de ${deletedCount} usuario${deletedCount !== 1 ? "s" : ""}`);
      setConfirmDialog(null);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar el mensaje");
    } finally {
      setSaving(false);
    }
  };


  // Export users to CSV
  const handleExportUsersCSV = () => {
    const header = ["Nombre", "Email", "Teléfono", "Rol", "Nº proyectos", "Proyectos"];
    const rows = filteredUsers.map((u) => [
      u.name,
      u.email,
      u.phone || "",
      u.role === "admin" ? "Administrador" : "Usuario",
      String(u.projectCount),
      u.projects.map((p) => p.name).join(" | "),
    ]);
    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `usuarios_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("success", "CSV exportado");
  };

  const openDemoModal = () => {
    const rand = Math.random().toString(36).slice(2, 7);
    const pw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5).toUpperCase() + "!1";
    setDemoForm({ name: "", email: `demo.${rand}@filmaworkspace.demo`, password: pw });
    setDemoCreated(null);
    setDemoError("");
    setShowDemoModal(true);
  };

  const handleCreateDemoUser = async () => {
    if (!demoForm.name.trim()) { setDemoError("El nombre es obligatorio"); return; }
    setDemoSaving(true);
    setDemoError("");
    try {
      const res = await fetch("/api/create-demo-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: demoForm.name.trim(), email: demoForm.email, password: demoForm.password }),
      });
      const body = await res.json();
      if (!res.ok) { setDemoError(body.error || "Error al crear el usuario"); return; }
      setDemoCreated({ email: demoForm.email, password: demoForm.password });
      await loadData();
    } catch {
      setDemoError("Error de red");
    } finally {
      setDemoSaving(false);
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

  const toggleUserInMessage = (userId: string) => {
    setMessageForm((prev) => ({
      ...prev,
      selectedUsers: prev.selectedUsers.includes(userId)
        ? prev.selectedUsers.filter((id) => id !== userId)
        : [...prev.selectedUsers, userId],
    }));
  };

  const filteredProjectsForMessage = projects.filter((p) =>
    p.name.toLowerCase().includes(projectSearchInMessage.toLowerCase())
  );

  const filteredUsersForMessage = users.filter((u) =>
    u.name.toLowerCase().includes(userSearchInMessage.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearchInMessage.toLowerCase())
  );

  const recipientCount = (() => {
    if (messageForm.recipientMode === "all") return users.length;
    if (messageForm.recipientMode === "users") return messageForm.selectedUsers.length;
    const userIdSet = new Set<string>();
    projects.filter((p) => messageForm.selectedProjects.includes(p.id)).forEach((project) => {
      project.members?.forEach((member) => userIdSet.add(member.odId));
    });
    return userIdSet.size;
  })();

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
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
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
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center">Administración</h1>
        </div>
      </div>

      <main className="px-24 py-6">
        {/* Stats row - minimal */}
        <div className="flex flex-wrap items-center justify-center gap-6 mb-8 text-sm">
          <div className="flex items-center gap-2">
            <Briefcase size={16} className="text-slate-400" />
            <span className="text-slate-600">{projects.length} proyectos</span>
            <span className="text-slate-400">·</span>
            <span className="text-blue-600">{activeProjects} activos</span>
          </div>
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <span className="text-slate-600">{users.length} usuarios</span>
            <span className="text-slate-400">·</span>
            <span className="text-violet-600">{adminUsers} admins</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-slate-400" />
            <span className="text-slate-600">{producers.length} productoras</span>
          </div>
        </div>

        {/* Toolbar con tabs y acciones */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6">
          <div className="flex flex-row gap-4 items-center justify-between">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
              {[
                { id: "projects",  label: "Proyectos",   icon: Briefcase,       count: projects.length },
                { id: "users",     label: "Usuarios",    icon: Users,           count: users.length },
                { id: "producers", label: "Productoras", icon: Building2,       count: producers.length },
                { id: "messages",  label: "Mensajes",    icon: Bell,            count: activeMessages.length },
                { id: "support",   label: "Soporte",     icon: HeadphonesIcon,  count: totalUnreadSupport },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                    activeTab === tab.id
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <tab.icon size={14} />
                  {tab.label}
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs ${
                      activeTab === tab.id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowMessageModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <MessageSquare size={14} />
                Mensaje
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>

        {/* ==================== PROJECTS TAB ==================== */}
        {activeTab === "projects" && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center justify-between mb-6">
              <div className="flex flex-row gap-3 flex-1 w-auto">
                <div className="relative flex-1 max-w-xs">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar proyectos"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                  />
                </div>
                {/* Phase Dropdown */}
                <div className="relative" ref={phaseDropdownRef}>
                  <button
                    onClick={() => setShowPhaseDropdown(!showPhaseDropdown)}
                    className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[160px] ${
                      projectPhaseFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                    }`}
                  >
                    <span className="flex-1 text-left truncate">{projectPhaseFilter === "all" ? "Todas las fases" : projectPhaseFilter}</span>
                    <ChevronDown size={14} className={`transition-transform ${showPhaseDropdown ? "rotate-180" : ""} ${projectPhaseFilter !== "all" ? "text-white" : "text-slate-400"}`} />
                  </button>
                  {showPhaseDropdown && (
                    <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                      <button
                        onClick={() => { setProjectPhaseFilter("all"); setShowPhaseDropdown(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                          projectPhaseFilter === "all" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        Todas las fases
                      </button>
                      {PHASES.map((phase) => (
                        <button
                          key={phase}
                          onClick={() => { setProjectPhaseFilter(phase); setShowPhaseDropdown(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                            projectPhaseFilter === phase ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          {phase}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={() => setShowCreateProject(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium"
              >
                <FolderPlus size={14} />
                Crear proyecto
              </button>
            </div>

            {/* Projects Content */}
            {filteredProjects.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <FolderOpen size={28} className="text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-6">No hay proyectos</h3>
                <button
                  onClick={() => setShowCreateProject(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <FolderPlus size={16} />
                  Crear proyecto
                </button>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-4">
                {filteredProjects.map((project) => {
                  const phase = phaseConfig[project.phase] || phaseConfig["Desarrollo"];
                  return (
                    <div
                      key={project.id}
                      className="group bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-slate-300"
                    >
                      {/* Header con fase y menú */}
                      <div className="flex items-center justify-between mb-3">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-lg ${phase.bg} ${phase.text}`}>
                          {project.phase}
                        </span>
                        <div className="relative" ref={activeMenu === project.id ? menuRef : null}>
                          <button
                            onClick={() => setActiveMenu(activeMenu === project.id ? null : project.id)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {activeMenu === project.id && (
                            <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1">
                              <button
                                onClick={() => {
                                  setNewProject({
                                    name: project.name,
                                    description: project.description || "",
                                    phase: project.phase,
                                    producers: project.producers || [],
                                    customId: "",
                                    useCustomId: false,
                                    language: (project as any).language || "es",
                                  });
                                  setShowEditProject(project.id);
                                  setActiveMenu(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <Edit2 size={14} className="text-slate-400" />
                                Editar
                              </button>
                              <button
                                onClick={() => {
                                  setShowAssignUser(project.id);
                                  setActiveMenu(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <UserPlus size={14} className="text-slate-400" />
                                Asignar usuario
                              </button>
                              <Link
                                href={`/project/${project.id}/config`}
                                onClick={() => setActiveMenu(null)}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <Settings size={14} className="text-slate-400" />
                                Config
                              </Link>
                              <div className="border-t border-slate-100 my-1" />
                              <button
                                onClick={() => handleDeleteProject(project.id)}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                              >
                                <Trash2 size={14} />
                                Eliminar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Nombre */}
                      <h3 className="font-semibold text-slate-900 mb-2 line-clamp-1">{project.name}</h3>

                      {/* Info */}
                      <div className="space-y-1.5 text-xs text-slate-500 mb-4">
                        {project.producerNames && project.producerNames.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Building2 size={12} className="text-slate-400" />
                            <span className="truncate">{project.producerNames.join(", ")}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-slate-400" />
                          <span>{project.memberCount} miembros</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-3 border-t border-slate-100">
                        <Link
                          href={`/admindashboard/project/${project.id}`}
                          className="flex-1 flex items-center justify-center gap-1.5 p-2 bg-slate-900 text-white rounded-xl text-xs font-medium hover:bg-slate-800"
                        >
                          <Eye size={12} />
                          Gestionar
                        </Link>
                        <Link
                          href={`/project/${project.id}`}
                          className="p-2 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50"
                          title="Ir al proyecto"
                        >
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== USERS TAB ==================== */}
        {activeTab === "users" && (
          <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center mb-6">
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar usuarios"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                />
              </div>
              {/* Role Dropdown */}
              <div className="relative" ref={roleDropdownRef}>
                <button
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[160px] ${
                    userRoleFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  }`}
                >
                  <span className="flex-1 text-left truncate">{userRoleFilter === "all" ? "Todos los roles" : userRoleFilter === "admin" ? "Administradores" : "Usuarios"}</span>
                  <ChevronDown size={14} className={`transition-transform ${showRoleDropdown ? "rotate-180" : ""} ${userRoleFilter !== "all" ? "text-white" : "text-slate-400"}`} />
                </button>
                {showRoleDropdown && (
                  <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                    <button
                      onClick={() => { setUserRoleFilter("all"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "all" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todos los roles
                    </button>
                    <button
                      onClick={() => { setUserRoleFilter("admin"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "admin" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Administradores
                    </button>
                    <button
                      onClick={() => { setUserRoleFilter("user"); setShowRoleDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        userRoleFilter === "user" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Usuarios
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={openDemoModal}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-700 ml-auto"
              >
                <UserPlus size={14} />
                Usuario demo
              </button>
              <button
                onClick={handleExportUsersCSV}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download size={14} />
                Exportar CSV
              </button>
            </div>

            {/* Users List */}
            {filteredUsers.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Users size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900">No hay usuarios</h3>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between px-5 py-4 hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 text-sm font-medium">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-slate-900">{user.name}</h3>
                            {user.role === "admin" && (
                              <span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-medium">
                                Admin
                              </span>
                            )}
                            {user.isDemo && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">
                                Demo
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500">{user.email}</p>
                          {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowUserDetails(user.id)}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          {user.projectCount} proyecto{user.projectCount !== 1 ? "s" : ""}
                        </button>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => setShowUserDetails(user.id)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => handleToggleUserRole(user.id, user.role)}
                            disabled={saving}
                            className={`p-1.5 rounded-lg ${
                              user.role === "admin"
                                ? "text-violet-600 hover:bg-violet-50"
                                : "text-slate-400 hover:text-violet-600 hover:bg-violet-50"
                            }`}
                            title={user.role === "admin" ? "Quitar admin" : "Hacer admin"}
                          >
                            <Shield size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(user.id)}
                            disabled={saving}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Eliminar usuario"
                          >
                            <Trash2 size={14} />
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
          <div>
            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center justify-between mb-6">
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar productoras"
                  value={producerSearch}
                  onChange={(e) => setProducerSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                />
              </div>
              <button
                onClick={() => setShowCreateProducer(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium"
              >
                <Plus size={14} />
                Nueva productora
              </button>
            </div>

            {/* Producers Grid */}
            {filteredProducers.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Building2 size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900 mb-4">No hay productoras</h3>
                <button
                  onClick={() => setShowCreateProducer(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <Plus size={14} />
                  Nueva
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {filteredProducers.map((producer) => (
                    <div
                      key={producer.id}
                      className="px-5 py-4 hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Building2 size={16} className="text-slate-400" />
                          <div>
                            <h3 className="text-sm font-medium text-slate-900">{producer.name}</h3>
                            <p className="text-xs text-slate-500">
                              {producer.projectCount} proyecto{producer.projectCount !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/companydashboard/${producer.id}`}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                            title="Ver panel de productora"
                          >
                            <Eye size={14} />
                          </Link>
                          <button
                            onClick={() => setShowAssignCompanyUser(producer.id)}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg"
                            title="Añadir usuario de productora"
                          >
                            <UserPlus size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setNewProducer({ name: producer.name });
                              setShowEditProducer(producer.id);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteProducer(producer.id)}
                            disabled={saving || producer.projectCount > 0}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            title={producer.projectCount > 0 ? "Tiene proyectos" : "Eliminar"}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      
                      {/* Usuarios de productora */}
                      {producer.users && producer.users.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">Usuarios de productora</p>
                          <div className="flex flex-wrap gap-2">
                            {producer.users.map((user) => (
                              <div
                                key={user.id}
                                className="flex items-center gap-2 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg group"
                              >
                                <div className="w-5 h-5 bg-emerald-100 rounded flex items-center justify-center text-emerald-700 text-[10px] font-medium">
                                  {user.name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs text-emerald-700">{user.name}</span>
                                <button
                                  onClick={() => handleRemoveCompanyUser(user.id)}
                                  className="p-0.5 text-emerald-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== MESSAGES TAB ==================== */}
        {activeTab === "messages" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <p className="text-sm text-slate-500">
                Mensajes enviados a usuarios. Los mensajes expirados se eliminan automáticamente.
              </p>
              <button
                onClick={() => setShowMessageModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium"
              >
                <Send size={14} />
                Nuevo mensaje
              </button>
            </div>

            {activeMessages.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Bell size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900 mb-4">No hay mensajes activos</h3>
                <button
                  onClick={() => setShowMessageModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                >
                  <Send size={14} />
                  Enviar mensaje
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {activeMessages.map((message) => {
                    const typeConfig = {
                      info: { icon: Info, bg: "bg-blue-50", text: "text-blue-700" },
                      warning: { icon: AlertTriangle, bg: "bg-amber-50", text: "text-amber-700" },
                      success: { icon: CheckCircle, bg: "bg-emerald-50", text: "text-emerald-700" },
                    }[message.type];
                    const Icon = typeConfig.icon;

                    const getExpiryText = () => {
                      if (!message.expiresAt) return "Indefinido";
                      const now = new Date();
                      const expires = message.expiresAt.toDate();
                      const diffMs = expires.getTime() - now.getTime();
                      const diffHours = Math.floor(diffMs / 3600000);
                      const diffDays = Math.floor(diffMs / 86400000);
                      if (diffDays > 0) return `${diffDays} día${diffDays > 1 ? "s" : ""}`;
                      if (diffHours > 0) return `${diffHours}h`;
                      return "< 1h";
                    };

                    return (
                      <div key={`${message.title}-${message.sentAt?.toMillis()}`} className="px-5 py-4 hover:bg-slate-50">
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${typeConfig.bg}`}>
                            <Icon size={18} className={typeConfig.text} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold text-slate-900">{message.title}</h3>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeConfig.bg} ${typeConfig.text}`}>
                                {message.type}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 line-clamp-2 mb-2">{message.content}</p>
                            <div className="flex items-center gap-4 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <Users size={12} />
                                {message.recipientCount} destinatario{message.recipientCount !== 1 ? "s" : ""}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock size={12} />
                                Expira: {getExpiryText()}
                              </span>
                              {message.targetProjects && (
                                <span className="flex items-center gap-1">
                                  <Briefcase size={12} />
                                  {message.targetProjects.length} proyecto{message.targetProjects.length !== 1 ? "s" : ""}
                                </span>
                              )}
                              <span>Por: {message.sentByName}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteMessage(message.title, message.sentAt)}
                            disabled={saving}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"
                            title="Eliminar de todos los usuarios"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== SUPPORT TAB ==================== */}
        {activeTab === "support" && (
          <div className="flex gap-4 h-[620px]">

            {/* Chat list */}
            <div className="w-72 flex-shrink-0 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden">
              <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Conversaciones</p>
                <span className="text-xs text-slate-400">{supportChats.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
                {supportChats.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                    <HeadphonesIcon size={24} className="text-slate-300" />
                    <p className="text-xs text-slate-400">Sin conversaciones todavía</p>
                  </div>
                )}
                {supportChats.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => setActiveChatId(chat.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors hover:bg-slate-50 ${
                      activeChatId === chat.id ? "bg-slate-50 border-l-2 border-slate-800" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 truncate">{chat.userName}</p>
                          {chat.status === "resolved" && (
                            <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                              Cerrado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate mt-0.5">{chat.lastMessage || "Sin mensajes"}</p>
                      </div>
                      {chat.unreadAdmin > 0 && (
                        <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    {chat.lastMessageAt && (
                      <p className="text-[10px] text-slate-300 mt-1">
                        {chat.lastMessageAt.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}
                        {" · "}
                        {chat.lastMessageAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation */}
            {activeChatId ? (() => {
              const activeChat = supportChats.find((c) => c.id === activeChatId);
              return (
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden">
                  {/* Conv header */}
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{activeChat?.userName}</p>
                      <p className="text-xs text-slate-400">{activeChat?.userEmail}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeChat?.status === "open" ? (
                        <button
                          onClick={() => handleResolveChat(activeChatId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          <CheckCheck size={13} />
                          Cerrar conversación
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReopenChat(activeChatId)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                        >
                          <Circle size={11} />
                          Reabrir
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-5 py-5 space-y-3 bg-slate-50">
                    {chatMessages.map((msg) => {
                      const isAdmin = msg.sender === "admin";
                      return (
                        <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[70%] ${!isAdmin ? "flex items-end gap-2" : ""}`}>
                            {!isAdmin && (
                              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 mb-0.5">
                                <span className="text-[10px] font-semibold text-slate-600">
                                  {msg.senderName?.[0]?.toUpperCase() ?? "U"}
                                </span>
                              </div>
                            )}
                            <div>
                              <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                                isAdmin
                                  ? "bg-slate-800 text-white rounded-br-sm"
                                  : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                              }`}>
                                {msg.text}
                              </div>
                              <p className={`text-[10px] text-slate-400 mt-1 ${isAdmin ? "text-right" : "text-left"}`}>
                                {msg.createdAt
                                  ? msg.createdAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={supportMsgsRef} />
                  </div>

                  {/* Reply input */}
                  {activeChat?.status === "open" ? (
                    <div className="px-4 py-3.5 border-t border-slate-100 bg-white flex items-end gap-3">
                      <textarea
                        rows={1}
                        value={supportInput}
                        onChange={(e) => setSupportInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSupportReply(); } }}
                        placeholder="Escribe una respuesta..."
                        className="flex-1 resize-none text-sm px-3.5 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent leading-relaxed"
                        style={{ maxHeight: 100 }}
                      />
                      <button
                        onClick={handleSupportReply}
                        disabled={!supportInput.trim() || supportSending}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
                      >
                        {supportSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Enviar
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 py-3 border-t border-slate-100 bg-white">
                      <p className="text-xs text-center text-slate-400">Conversación cerrada</p>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-center">
                <HeadphonesIcon size={32} className="text-slate-300" />
                <p className="text-sm font-medium text-slate-500">Selecciona una conversación</p>
                <p className="text-xs text-slate-400">Las respuestas llegan al usuario en tiempo real</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ==================== MODALS ==================== */}

      {/* Create/Edit Project Modal */}
      {(showCreateProject || showEditProject) && (() => {
        const isEdit = !!showEditProject;
        const phase = phaseConfig[newProject.phase] || phaseConfig["Desarrollo"];
        const LANGUAGES = [
          { code: "es", flag: "🇪🇸", label: "Español", available: true },
          { code: "en", flag: "🇬🇧", label: "English",  available: false },
          { code: "fr", flag: "🇫🇷", label: "Français", available: false },
          { code: "de", flag: "🇩🇪", label: "Deutsch",  available: false },
          { code: "pt", flag: "🇵🇹", label: "Português", available: false },
        ];
        const closeModal = () => {
          setShowCreateProject(false);
          setShowEditProject(null);
          setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false, language: "es" });
          setProducerModalSearch("");
        };
        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-flex flex-col">

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                  <FolderPlus size={16} className="text-slate-700" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{isEdit ? "Editar proyecto" : "Nuevo proyecto"}</h3>
                </div>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            {/* Body — two columns */}
            <div className="flex-1 overflow-flex">

              {/* ── Left: form ── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5">

                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Nombre del proyecto *</label>
                  <input
                    type="text"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    placeholder="Nombre del proyecto"
                    autoFocus
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>

                {/* Custom ID — creation only */}
                {!isEdit && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ID del proyecto</label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{newProject.useCustomId ? "Personalizado" : "Automático"}</span>
                        <button
                          type="button"
                          onClick={() => setNewProject({ ...newProject, useCustomId: !newProject.useCustomId, customId: "" })}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${newProject.useCustomId ? "bg-slate-900" : "bg-slate-200"}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${newProject.useCustomId ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                        </button>
                      </div>
                    </div>
                    {newProject.useCustomId ? (
                      <div>
                        <input
                          type="text"
                          value={newProject.customId}
                          onChange={(e) => setNewProject({ ...newProject, customId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, "") })}
                          placeholder="nombre-del-proyecto"
                          className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                        />
                        {newProject.customId && (
                          <p className="mt-1.5 text-xs text-slate-400">
                            URL: <span className="font-mono text-slate-600">/project/{newProject.customId}</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <Hash size={13} className="text-slate-400" />
                        <p className="text-xs text-slate-500">Se generará un código de 6 caracteres automáticamente</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Descripción</label>
                  <textarea
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    placeholder="Sinopsis o notas del proyecto"
                    rows={3}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                </div>

                {/* Phase */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Fase de producción</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PHASES.map((p) => {
                      const cfg = phaseConfig[p];
                      return (
                        <button
                          key={p}
                          onClick={() => setNewProject({ ...newProject, phase: p })}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            newProject.phase === p ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Language */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Idioma de la plataforma</label>
                  <div className="grid grid-cols-5 gap-2">
                    {LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        type="button"
                        disabled={!lang.available}
                        onClick={() => lang.available && setNewProject({ ...newProject, language: lang.code })}
                        className={`relative flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all
                          ${!lang.available ? "opacity-40 cursor-not-allowed border-slate-100 bg-slate-50" :
                            newProject.language === lang.code
                              ? "bg-slate-900 border-slate-900 text-white"
                              : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                      >
                        <span className="text-xl leading-none">{lang.flag}</span>
                        <span className="text-[10px]">{lang.label}</span>
                        {!lang.available && (
                          <span className="absolute -top-1.5 -right-1 text-[8px] bg-slate-300 text-slate-600 px-1 py-0.5 rounded font-semibold leading-none">
                            Soon
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Producers */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Productoras</label>
                  {newProject.producers.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {newProject.producers.map((prodId) => {
                        const prod = producers.find((p) => p.id === prodId);
                        if (!prod) return null;
                        return (
                          <span key={prodId} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium">
                            <Building2 size={11} />
                            {prod.name}
                            <button onClick={() => setNewProject({ ...newProject, producers: newProject.producers.filter((id) => id !== prodId) })} className="hover:text-slate-300 ml-0.5">
                              <X size={11} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={producerModalSearch}
                      onChange={(e) => setProducerModalSearch(e.target.value)}
                      placeholder="Buscar y añadir productora"
                      className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 outline-none text-sm"
                    />
                  </div>
                  {producerModalSearch.length >= 1 && (
                    <div className="mt-2 border border-slate-200 rounded-xl max-h-36 overflow-y-auto">
                      {producers.filter((p) => p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) && !newProject.producers.includes(p.id)).slice(0, 6).map((producer) => (
                        <button
                          key={producer.id}
                          onClick={() => { setNewProject({ ...newProject, producers: [...newProject.producers, producer.id] }); setProducerModalSearch(""); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-b-0"
                        >
                          <Building2 size={13} className="text-slate-400" />
                          <span className="text-slate-700 flex-1">{producer.name}</span>
                          <span className="text-xs text-slate-400">{producer.projectCount} proyectos</span>
                        </button>
                      ))}
                      {producers.filter((p) => p.name.toLowerCase().includes(producerModalSearch.toLowerCase()) && !newProject.producers.includes(p.id)).length === 0 && (
                        <div className="px-4 py-3 text-xs text-slate-500 text-center">Sin resultados</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Right: summary card ── */}
              <div className="w-64 flex-shrink-0 bg-slate-50 border-l border-slate-100 p-5 flex flex-col gap-4 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vista previa</p>

                {/* Project card preview */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg ${phase.bg} ${phase.text}`}>
                      {newProject.phase}
                    </span>
                    {newProject.language && (
                      <span className="text-xs">{LANGUAGES.find(l => l.code === newProject.language)?.flag}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 line-clamp-2 leading-snug">
                      {newProject.name || <span className="text-slate-300 font-normal">Nombre del proyecto</span>}
                    </p>
                    {newProject.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">{newProject.description}</p>
                    )}
                  </div>
                  {newProject.producers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {newProject.producers.map((pid) => {
                        const prod = producers.find(p => p.id === pid);
                        return prod ? (
                          <span key={pid} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">{prod.name}</span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>

                {/* Config summary */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">ID</span>
                    <span className="text-xs font-mono text-slate-700">
                      {newProject.useCustomId && newProject.customId ? newProject.customId : "auto"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">Idioma</span>
                    <span className="text-xs text-slate-700">
                      {LANGUAGES.find(l => l.code === newProject.language)?.flag}{" "}
                      {LANGUAGES.find(l => l.code === newProject.language)?.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-slate-200">
                    <span className="text-xs text-slate-500">Productoras</span>
                    <span className="text-xs text-slate-700">{newProject.producers.length || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-slate-500">Departamentos</span>
                    <span className="text-xs text-slate-700">{DEFAULT_DEPARTMENTS.length} por defecto</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 flex gap-3">
              <button onClick={closeModal} className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={isEdit ? handleEditProject : handleCreateProject}
                disabled={saving || !newProject.name.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FolderPlus size={14} />
                {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear proyecto"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

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
                  placeholder="Productora Films S.L."
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

      {/* Assign Company User Modal */}
      {showAssignCompanyUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <Building2 size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Añadir usuario de productora</h3>
                  <p className="text-xs text-slate-500">
                    {producers.find((p) => p.id === showAssignCompanyUser)?.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowAssignCompanyUser(null);
                  setCompanyUserSearch("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-4">
                Este usuario podrá acceder al panel de la productora y ver todos sus proyectos.
              </p>
              <div className="relative mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar usuario"
                  value={companyUserSearch}
                  onChange={(e) => setCompanyUserSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {users
                  .filter((u) => {
                    // Exclude users already assigned to any company
                    const userData = u;
                    const hasCompany = producers.some((p) => p.users?.some((pu) => pu.id === u.id));
                    if (hasCompany) return false;
                    // Filter by search
                    if (!companyUserSearch) return true;
                    return (
                      u.name.toLowerCase().includes(companyUserSearch.toLowerCase()) ||
                      u.email.toLowerCase().includes(companyUserSearch.toLowerCase())
                    );
                  })
                  .map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleAssignCompanyUser(user.id, showAssignCompanyUser)}
                      disabled={saving}
                      className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-xl text-left transition-colors disabled:opacity-50"
                    >
                      <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 text-sm font-medium">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
                        <p className="text-xs text-slate-500 truncate">{user.email}</p>
                      </div>
                    </button>
                  ))}
                {users.filter((u) => !producers.some((p) => p.users?.some((pu) => pu.id === u.id))).length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">No hay usuarios disponibles</p>
                )}
              </div>
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
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white appearance-none cursor-pointer pr-8 bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%2364748b%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3e%3cpolyline points=%276 9 12 15 18 9%27%3e%3c/polyline%3e%3c/svg%3e')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat"
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
                <div className="grid grid-cols-3 gap-2">
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
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-flex flex-col">
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

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                  <button
                    onClick={() => setShowUserDetails(null)}
                    className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={() => { setShowUserDetails(null); handleDeleteUser(user.id); }}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                    Eliminar usuario
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Send Message Modal */}
      {showMessageModal && (() => {
        const typeConfig = {
          info: { icon: Info, accent: "#2F52E0", accentBg: "#EFF2FF", label: "Información", badgeBg: "bg-blue-50", badgeText: "text-blue-700", badgeBorder: "border-blue-200" },
          warning: { icon: AlertTriangle, accent: "#D97706", accentBg: "#FEF3C7", label: "Aviso", badgeBg: "bg-amber-50", badgeText: "text-amber-700", badgeBorder: "border-amber-200" },
          success: { icon: CheckCircle, accent: "#059669", accentBg: "#D1FAE5", label: "Actualización", badgeBg: "bg-emerald-50", badgeText: "text-emerald-700", badgeBorder: "border-emerald-200" },
        }[messageForm.type];
        const TypeIcon = typeConfig.icon;
        const canSend = messageForm.title.trim() && messageForm.content.trim() &&
          (messageForm.recipientMode === "all" ||
          (messageForm.recipientMode === "projects" && messageForm.selectedProjects.length > 0) ||
          (messageForm.recipientMode === "users" && messageForm.selectedUsers.length > 0));

        return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-flex flex-col">

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center">
                  <MessageSquare size={16} className="text-slate-700" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Nuevo mensaje</h3>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setEmailConfirmStep(false);
                  setMessageForm({ title: "", content: "", type: "info", recipientMode: "all", selectedProjects: [], selectedUsers: [], duration: "indefinite", sendByEmail: false });
                  setProjectSearchInMessage("");
                  setUserSearchInMessage("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body — two columns */}
            <div className="flex-1 overflow-flex">

              {/* ── Left: compose ── */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 border-r border-slate-100">

                {/* Type */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Tipo</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "info", label: "Informativo", icon: Info, bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
                      { value: "warning", label: "Aviso", icon: AlertTriangle, bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
                      { value: "success", label: "Logro", icon: CheckCircle, bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
                    ].map((t) => {
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.value}
                          onClick={() => setMessageForm({ ...messageForm, type: t.value as typeof messageForm.type })}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                            messageForm.type === t.value ? `${t.bg} ${t.text} ${t.border}` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <Icon size={14} />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Título *</label>
                  <input
                    type="text"
                    value={messageForm.title}
                    onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value })}
                    placeholder="Nueva funcionalidad disponible"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>

                {/* Content */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Mensaje *</label>
                  <textarea
                    value={messageForm.content}
                    onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })}
                    placeholder="Escribe el contenido del mensaje"
                    rows={4}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                  />
                </div>

                {/* Recipients */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Destinatarios</label>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { mode: "all", label: "Todos", sublabel: `${users.length} usuarios`, icon: Users },
                      { mode: "projects", label: "Por proyecto", sublabel: "Uno o varios", icon: Briefcase },
                      { mode: "users", label: "Usuarios", sublabel: "Específicos", icon: UserPlus },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      const active = messageForm.recipientMode === opt.mode;
                      return (
                        <button
                          key={opt.mode}
                          onClick={() => setMessageForm({ ...messageForm, recipientMode: opt.mode as typeof messageForm.recipientMode, selectedProjects: [], selectedUsers: [] })}
                          className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all ${active ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                        >
                          <Icon size={16} className={active ? "text-white" : "text-slate-400"} />
                          <span className="text-xs font-semibold">{opt.label}</span>
                          <span className={`text-[10px] ${active ? "text-slate-300" : "text-slate-400"}`}>{opt.sublabel}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Project picker */}
                  {messageForm.recipientMode === "projects" && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={projectSearchInMessage}
                          onChange={(e) => setProjectSearchInMessage(e.target.value)}
                          placeholder="Buscar proyecto"
                          className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-xs"
                        />
                      </div>
                      {messageForm.selectedProjects.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {messageForm.selectedProjects.map((pid) => {
                            const p = projects.find((x) => x.id === pid);
                            return p ? (
                              <span key={pid} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 text-white rounded-lg text-xs">
                                {p.name}
                                <button onClick={() => toggleProjectInMessage(pid)} className="hover:text-slate-300"><X size={10} /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                        {filteredProjectsForMessage.map((p) => {
                          const sel = messageForm.selectedProjects.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              onClick={() => toggleProjectInMessage(p.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${sel ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}
                            >
                              {sel ? <CheckSquare size={12} /> : <Square size={12} className="text-slate-400" />}
                              <span className="flex-1 truncate font-medium">{p.name}</span>
                              <span className={sel ? "text-slate-300" : "text-slate-400"}>{p.memberCount}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* User picker */}
                  {messageForm.recipientMode === "users" && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={userSearchInMessage}
                          onChange={(e) => setUserSearchInMessage(e.target.value)}
                          placeholder="Buscar usuario"
                          className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 outline-none text-xs"
                        />
                      </div>
                      {messageForm.selectedUsers.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {messageForm.selectedUsers.map((uid) => {
                            const u = users.find((x) => x.id === uid);
                            return u ? (
                              <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 bg-slate-900 text-white rounded-lg text-xs">
                                {u.name}
                                <button onClick={() => toggleUserInMessage(uid)} className="hover:text-slate-300"><X size={10} /></button>
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="max-h-36 overflow-y-auto space-y-0.5">
                        {filteredUsersForMessage.map((u) => {
                          const sel = messageForm.selectedUsers.includes(u.id);
                          return (
                            <button
                              key={u.id}
                              onClick={() => toggleUserInMessage(u.id)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors ${sel ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"}`}
                            >
                              {sel ? <CheckSquare size={12} /> : <Square size={12} className="text-slate-400" />}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{u.name}</p>
                                <p className={`truncate ${sel ? "text-slate-300" : "text-slate-400"}`}>{u.email}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Visibilidad</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { value: "24h", label: "24h" },
                      { value: "7d", label: "7 días" },
                      { value: "30d", label: "30 días" },
                      { value: "indefinite", label: "Siempre" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setMessageForm({ ...messageForm, duration: opt.value as typeof messageForm.duration })}
                        className={`py-2 rounded-xl border text-xs font-medium transition-all ${
                          messageForm.duration === opt.value ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    {messageForm.duration === "indefinite" ? "El mensaje no expira automáticamente" : `Se elimina automáticamente tras ${messageForm.duration === "24h" ? "24 horas" : messageForm.duration === "7d" ? "7 días" : "30 días"}`}
                  </p>
                </div>

                {/* Email toggle */}
                <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${messageForm.sendByEmail ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-center gap-3">
                    <Mail size={15} className={messageForm.sendByEmail ? "text-amber-600" : "text-slate-400"} />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Enviar por email</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setMessageForm({ ...messageForm, sendByEmail: !messageForm.sendByEmail }); setEmailConfirmStep(false); }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${messageForm.sendByEmail ? "bg-amber-500" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${messageForm.sendByEmail ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
              </div>

              {/* ── Right: preview ── */}
              <div className="w-72 flex-shrink-0 bg-slate-50 p-5 flex flex-col gap-4 overflow-y-auto">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Vista previa</p>

                {/* Notification bell preview */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                    <Bell size={12} className="text-slate-400" />
                    <span className="text-[10px] text-slate-400 font-medium">Notificación en plataforma</span>
                  </div>
                  <div className="p-3 flex gap-2.5">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: typeConfig.accentBg }}
                    >
                      <TypeIcon size={14} style={{ color: typeConfig.accent }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 leading-snug line-clamp-1">
                        {messageForm.title || "Título del mensaje"}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-3 leading-relaxed">
                        {messageForm.content || "El contenido del mensaje aparecerá aquí..."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Recipient summary */}
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Alcance</p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
                      <Users size={14} className="text-white" />
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-900 leading-none">{recipientCount}</p>
                      <p className="text-[11px] text-slate-500">destinatario{recipientCount !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  {messageForm.recipientMode === "projects" && messageForm.selectedProjects.length > 0 && (
                    <p className="text-[11px] text-slate-400">De {messageForm.selectedProjects.length} proyecto{messageForm.selectedProjects.length !== 1 ? "s" : ""}</p>
                  )}
                  {messageForm.sendByEmail && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
                      <Mail size={11} className="text-amber-500" />
                      <p className="text-[11px] text-amber-600 font-medium">+ email a cada destinatario</p>
                    </div>
                  )}
                </div>

                {/* Duration badge */}
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl">
                  <Clock size={12} className="text-slate-400" />
                  <span className="text-xs text-slate-600">
                    {messageForm.duration === "indefinite" ? "Sin expiración" : `Expira en ${messageForm.duration === "24h" ? "24 h" : messageForm.duration === "7d" ? "7 días" : "30 días"}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            {emailConfirmStep ? (
              <div className="px-6 py-4 border-t border-amber-200 bg-amber-50 flex-shrink-0 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">¿Confirmas el envío por email?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Se enviarán {recipientCount} email{recipientCount !== 1 ? "s" : ""} individuales. Esta acción no se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setEmailConfirmStep(false)} className="flex-1 px-4 py-2.5 border border-amber-300 bg-white text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-50">
                    Volver
                  </button>
                  <button
                    onClick={handleSendMessage}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
                  >
                    <Send size={14} />
                    {saving ? "Enviando..." : "Confirmar y enviar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex-shrink-0 flex gap-3">
                <button
                  onClick={() => {
                    setShowMessageModal(false);
                    setEmailConfirmStep(false);
                    setMessageForm({ title: "", content: "", type: "info", recipientMode: "all", selectedProjects: [], selectedUsers: [], duration: "indefinite", sendByEmail: false });
                    setProjectSearchInMessage("");
                    setUserSearchInMessage("");
                  }}
                  className="px-5 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => messageForm.sendByEmail ? setEmailConfirmStep(true) : handleSendMessage()}
                  disabled={saving || !canSend}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  {saving ? "Enviando..." : `Enviar a ${recipientCount} usuario${recipientCount !== 1 ? "s" : ""}${messageForm.sendByEmail ? " + email" : ""}`}
                </button>
              </div>
            )}
          </div>
        </div>
        );
      })()}
      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-500 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white transition-colors ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Demo User Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Crear usuario demo</h2>
                <p className="text-xs text-slate-500 mt-0.5">Sin email real ni teléfono. Solo para pruebas.</p>
              </div>
              <button onClick={() => setShowDemoModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {!demoCreated ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Nombre</label>
                    <input
                      type="text"
                      placeholder="Ej: Usuario Demo 1"
                      value={demoForm.name}
                      onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Email (auto-generado)</label>
                    <input
                      type="text"
                      value={demoForm.email}
                      onChange={(e) => setDemoForm({ ...demoForm, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Contraseña (auto-generada)</label>
                    <input
                      type="text"
                      value={demoForm.password}
                      onChange={(e) => setDemoForm({ ...demoForm, password: e.target.value })}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent font-mono text-slate-600"
                    />
                  </div>
                  {demoError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
                      <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                      <span className="text-xs text-red-600">{demoError}</span>
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowDemoModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cancelar
                    </button>
                    <button
                      onClick={handleCreateDemoUser}
                      disabled={demoSaving}
                      className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-700 font-medium text-sm disabled:opacity-50"
                    >
                      {demoSaving ? "Creando..." : "Crear usuario"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl mb-2">
                    <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
                    <span className="text-sm text-green-700 font-medium">Usuario demo creado</span>
                  </div>
                  <div className="space-y-3 bg-slate-50 rounded-xl p-4">
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Email</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{demoCreated.email}</code>
                        <button onClick={() => navigator.clipboard.writeText(demoCreated!.email)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">Contraseña</p>
                      <div className="flex items-center justify-between gap-2">
                        <code className="text-sm text-slate-900 font-mono">{demoCreated.password}</code>
                        <button onClick={() => navigator.clipboard.writeText(demoCreated!.password)} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1 rounded-lg hover:bg-slate-200">
                          Copiar
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setShowDemoModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                      Cerrar
                    </button>
                    <button onClick={openDemoModal} className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-700 font-medium text-sm">
                      Crear otro
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
