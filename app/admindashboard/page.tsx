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
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"projects" | "users" | "producers" | "messages">("projects");

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

  const [newProject, setNewProject] = useState({ name: "", description: "", phase: "Desarrollo", producers: [] as string[], customId: "", useCustomId: false });
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
    duration: "indefinite" as "24h" | "7d" | "30d" | "indefinite",
    sendByEmail: false,
  });
  const [emailConfirmStep, setEmailConfirmStep] = useState(false);
  const [projectSearchInMessage, setProjectSearchInMessage] = useState("");

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
      
      setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false });
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
    if (!confirm(`¿Eliminar "${project.name}"? Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try {
      // Eliminar miembros del proyecto y sus referencias en userProjects
      const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
      for (const memberDoc of membersSnap.docs) {
        await deleteDoc(doc(db, `userProjects/${memberDoc.id}/projects/${projectId}`));
        await deleteDoc(memberDoc.ref);
      }
      
      // Eliminar de companyProjects de cada productora
      for (const producerId of project.producers || []) {
        await deleteDoc(doc(db, `companyProjects/${producerId}/projects`, projectId));
      }
      
      // Eliminar el proyecto
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
    if (!confirm("¿Quitar este usuario de la productora?")) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", odId), { companyId: null });
      showToast("success", "Usuario eliminado de productora");
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
        targetProjects: messageForm.sendToAll ? null : messageForm.selectedProjects,
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
        sendToAll: true,
        selectedProjects: [],
        duration: "indefinite",
        sendByEmail: false,
      });
      setProjectSearchInMessage("");
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
    if (!confirm("¿Eliminar este mensaje de todos los usuarios?")) return;
    
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
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-10 pb-6">
          <h1 className="text-3xl font-bold text-slate-900 text-center">Administración</h1>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
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
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1">
              {[
                { id: "projects", label: "Proyectos", icon: Briefcase, count: projects.length },
                { id: "users", label: "Usuarios", icon: Users, count: users.length },
                { id: "producers", label: "Productoras", icon: Building2, count: producers.length },
                { id: "messages", label: "Mensajes", icon: Bell, count: activeMessages.length },
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
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
              <div className="flex flex-col sm:flex-row gap-3 flex-1 w-full sm:w-auto">
                <div className="relative flex-1 sm:max-w-xs">
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
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center mb-6">
              <div className="relative flex-1 sm:max-w-xs">
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
                onClick={handleExportUsersCSV}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 ml-auto"
              >
                <Download size={14} />
                Exportar CSV
              </button>
            </div>

            {/* Users List */}
            {filteredUsers.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <Users size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900 mb-1">No hay usuarios</h3>
                <p className="text-slate-500 text-sm">No se encontraron usuarios con los filtros actuales</p>
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
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
              <div className="relative flex-1 sm:max-w-xs">
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
                <h3 className="font-semibold text-slate-900 mb-1">No hay productoras</h3>
                <p className="text-slate-500 text-sm mb-4">Crea tu primera productora</p>
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
                <h3 className="font-semibold text-slate-900 mb-1">No hay mensajes activos</h3>
                <p className="text-slate-500 text-sm mb-4">Envía un mensaje a los usuarios</p>
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
      </main>

      {/* ==================== MODALS ==================== */}

      {/* Create/Edit Project Modal */}
      {(showCreateProject || showEditProject) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
              <h3 className="text-lg font-semibold text-slate-900">
                {showEditProject ? "Editar proyecto" : "Nuevo proyecto"}
              </h3>
              <button
                onClick={() => {
                  setShowCreateProject(false);
                  setShowEditProject(null);
                  setNewProject({ name: "", description: "", phase: "Desarrollo", producers: [], customId: "", useCustomId: false });
                  setProducerModalSearch("");
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre *</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="Nombre del proyecto"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>

              {/* ID del proyecto — solo en creación */}
              {!showEditProject && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700">ID del proyecto</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{newProject.useCustomId ? "Personalizado" : "Automático"}</span>
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
                        placeholder="ej: mi-proyecto-2025"
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm font-mono"
                      />
                      {newProject.customId && (
                        <p className="mt-1.5 text-xs text-slate-400">
                          URL: <span className="font-mono text-slate-600">/project/{newProject.customId}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 px-1">Se generará un código aleatorio de 6 caracteres. Puedes activar el toggle para definirlo tú.</p>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                <textarea
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  placeholder="Descripción del proyecto"
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none transition-all"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fase</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PHASES.map((phase) => {
                    const config = phaseConfig[phase];
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
                        <div className={`w-2 h-2 rounded-full ${config.dot}`} />
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
                    placeholder="Buscar productora"
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
                  setEmailConfirmStep(false);
                  setMessageForm({ title: "", content: "", type: "info", sendToAll: true, selectedProjects: [], duration: "indefinite", sendByEmail: false });
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
                  placeholder="Escribe el contenido del mensaje"
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
                        placeholder="Buscar proyectos"
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

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Duración</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: "24h", label: "24 horas" },
                    { value: "7d", label: "7 días" },
                    { value: "30d", label: "30 días" },
                    { value: "indefinite", label: "Indefinido" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setMessageForm({ ...messageForm, duration: option.value as typeof messageForm.duration })}
                      className={`px-3 py-2 rounded-xl border text-sm font-medium ${
                        messageForm.duration === option.value
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {messageForm.duration === "indefinite"
                    ? "El mensaje permanecerá hasta que el usuario lo descarte o lo elimines"
                    : `El mensaje se eliminará automáticamente después de ${messageForm.duration === "24h" ? "24 horas" : messageForm.duration === "7d" ? "7 días" : "30 días"}`}
                </p>
              </div>

              {/* Send by email toggle */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Enviar también por email</p>
                    <p className="text-xs text-slate-500 mt-0.5">Además de en la plataforma, recibirán un email</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMessageForm({ ...messageForm, sendByEmail: !messageForm.sendByEmail });
                      setEmailConfirmStep(false);
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${messageForm.sendByEmail ? "bg-slate-900" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${messageForm.sendByEmail ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                {messageForm.sendByEmail && (
                  <div className="px-4 pb-4">
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                      <Mail size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">
                        Se enviará un email a los destinatarios. Esta acción no se puede deshacer.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            {emailConfirmStep ? (
              <div className="px-6 py-4 border-t border-slate-100 bg-amber-50 space-y-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">¿Enviar también por email?</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Este mensaje llegará a los destinatarios tanto en la plataforma como en su bandeja de entrada de correo. Esta acción no se puede deshacer.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setEmailConfirmStep(false)}
                    className="flex-1 px-4 py-2.5 border border-amber-300 bg-white text-amber-800 rounded-xl text-sm font-medium hover:bg-amber-50"
                  >
                    Cancelar
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
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button
                  onClick={() => {
                    setShowMessageModal(false);
                    setEmailConfirmStep(false);
                    setMessageForm({ title: "", content: "", type: "info", sendToAll: true, selectedProjects: [], duration: "indefinite", sendByEmail: false });
                    setProjectSearchInMessage("");
                  }}
                  className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    if (messageForm.sendByEmail) {
                      setEmailConfirmStep(true);
                    } else {
                      handleSendMessage();
                    }
                  }}
                  disabled={saving || !messageForm.title.trim() || !messageForm.content.trim() || (!messageForm.sendToAll && messageForm.selectedProjects.length === 0)}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={16} />
                  {saving ? "Enviando..." : "Enviar mensaje"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
