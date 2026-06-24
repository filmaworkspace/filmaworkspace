"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  FolderOpen,
  FolderPlus,
  Info,
  Layers,
  Link2,
  Mail,
  MessageSquare,
  Package,
  RefreshCw,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700" },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700" },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700" },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700" },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700" },
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

interface ProjectData {
  id: string;
  name: string;
  phase: string;
  description?: string;
  producers?: string[];
  producerNames?: string[];
  closingAt?: Timestamp;
  closingInitiatedBy?: string;
}

interface MemberData {
  id: string;
  name: string;
  email: string;
  role?: string;
  position?: string;
  department?: string;
  permissions: {
    config?: boolean;
    accounting?: boolean;
    team?: boolean;
  };
  accountingAccessLevel?: "user" | "accounting" | "accounting_extended";
}

interface DepartmentData {
  id: string;
  name: string;
  color: string;
  memberCount: number;
}

interface AccountingStats {
  accountCount: number;
  supplierCount: number;
  invoiceCount: number;
  poCount: number;
}

interface TeamStats {
  totalForms: number;
  pendingForms: number;
  completedForms: number;
  signedForms: number;
  totalInvitations: number;
  forms: Array<{ id: string; firstName?: string; lastName1?: string; email?: string; status: string; createdAt?: Timestamp }>;
  invitations: Array<{ id: string; email: string; status: string; createdAt?: Timestamp }>;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "accounting" | "team" | "logs">("general");
  const [logs, setLogs] = useState<Array<{
    id: string;
    type: string;
    actorName: string;
    actorEmail?: string;
    targetName?: string;
    targetEmail?: string;
    meta?: string;
    createdAt: Timestamp;
  }>>([]);
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);

  const [project, setProject] = useState<ProjectData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [departments, setDepartments] = useState<DepartmentData[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [allProjects, setAllProjects] = useState<{ id: string; name: string }[]>([]);
  const [accountingStats, setAccountingStats] = useState<AccountingStats>({
    accountCount: 0,
    supplierCount: 0,
    invoiceCount: 0,
    poCount: 0,
  });
  const [teamStats, setTeamStats] = useState<TeamStats>({
    totalForms: 0,
    pendingForms: 0,
    completedForms: 0,
    signedForms: 0,
    totalInvitations: 0,
    forms: [],
    invitations: [],
  });

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Modals
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState<MemberData | null>(null);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showCopySuppliersModal, setShowCopySuppliersModal] = useState(false);
  const [showCopyBudgetModal, setShowCopyBudgetModal] = useState(false);

  // Forms
  const [editMemberForm, setEditMemberForm] = useState({
    config: false,
    accounting: false,
    team: false,
    accountingAccessLevel: "accounting_extended" as "user" | "accounting" | "accounting_extended",
  });
  const [messageForm, setMessageForm] = useState({
    title: "",
    content: "",
    type: "info" as "info" | "warning" | "success",
  });
  const [editForm, setEditForm] = useState({ name: "", phase: "", description: "", producers: [] as string[] });
  const [allProducers, setAllProducers] = useState<{ id: string; name: string }[]>([]);
  const [producerSearch, setProducerSearch] = useState("");
  const [addMemberForm, setAddMemberForm] = useState({ odId: "", role: "", searchQuery: "", inviteName: "" });
  const [closeDays, setCloseDays] = useState(30);

  // Clone
  const [cloneName, setCloneName] = useState("");
  const [cloneIncludeBudget, setCloneIncludeBudget] = useState(true);
  const [cloneIncludeSuppliers, setCloneIncludeSuppliers] = useState(true);

  // Departments
  const [newDeptName, setNewDeptName] = useState("");

  // Copy suppliers
  const [copySupplierTargetId, setCopySupplierTargetId] = useState("");
  const [copySupplierSearch, setCopySupplierSearch] = useState("");

  // Copy budget
  const [copyBudgetTargetId, setCopyBudgetTargetId] = useState("");
  const [copyBudgetAmounts, setCopyBudgetAmounts] = useState(true);
  const [copyBudgetSearch, setCopyBudgetSearch] = useState("");

  const isAdmin = contextUser?.role === "admin";

  useEffect(() => {
    if (!userLoading && !isAdmin) router.push("/dashboard");
  }, [contextUser, userLoading, router, isAdmin]);

  useEffect(() => {
    if (projectId && isAdmin) loadData();
  }, [projectId, isAdmin]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const generateShortId = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  };

  const loadData = async () => {
    try {
      setLoading(true);

      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) {
        router.push("/admindashboard");
        return;
      }

      const projectData = projectDoc.data();
      let producerNames: string[] = [];
      if (projectData.producers && Array.isArray(projectData.producers)) {
        for (const producerId of projectData.producers) {
          const producerDoc = await getDoc(doc(db, "producers", producerId));
          if (producerDoc.exists()) producerNames.push(producerDoc.data().name);
        }
      }

      setProject({
        id: projectDoc.id,
        name: projectData.name,
        phase: projectData.phase,
        description: projectData.description,
        producers: projectData.producers,
        producerNames,
        closingAt: projectData.closingAt,
        closingInitiatedBy: projectData.closingInitiatedBy,
      });

      setEditForm({
        name: projectData.name,
        phase: projectData.phase,
        description: projectData.description || "",
        producers: projectData.producers || [],
      });

      // Members
      const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
      const membersData: MemberData[] = membersSnap.docs.map((memDoc) => {
        const data = memDoc.data();
        return {
          id: memDoc.id,
          name: data.name,
          email: data.email,
          role: data.role,
          position: data.position,
          department: data.department,
          permissions: data.permissions || {},
          accountingAccessLevel: data.accountingAccessLevel || "user",
        };
      });
      setMembers(membersData);

      // Departments
      const depts = projectData.departments || [];
      const deptsWithCount = depts.map((deptName: string) => ({
        id: deptName,
        name: deptName,
        color: "#6B7280",
        memberCount: membersData.filter((m) => m.department === deptName).length,
      }));
      setDepartments(deptsWithCount);

      // All users for adding members
      const usersSnap = await getDocs(collection(db, "users"));
      setAllUsers(
        usersSnap.docs.map((userDoc) => ({
          id: userDoc.id,
          name: userDoc.data().name,
          email: userDoc.data().email,
        }))
      );

      // All producers for editing
      const producersSnap = await getDocs(collection(db, "producers"));
      setAllProducers(producersSnap.docs.map((d) => ({ id: d.id, name: d.data().name })));

      // All projects for copy targets
      const projectsSnap = await getDocs(collection(db, "projects"));
      setAllProjects(
        projectsSnap.docs
          .filter((d) => d.id !== projectId)
          .map((d) => ({ id: d.id, name: d.data().name }))
      );

      // Accounting + team stats + logs (parallel)
      const [accountsSnap, suppliersSnap, invoicesSnap, posSnap, formsSnap, invitationsSnap, logsSnap] = await Promise.all([
        getDocs(collection(db, `projects/${projectId}/accounts`)),
        getDocs(collection(db, `projects/${projectId}/suppliers`)),
        getDocs(collection(db, `projects/${projectId}/invoices`)),
        getDocs(collection(db, `projects/${projectId}/pos`)),
        getDocs(query(collection(db, "forms"), where("projectId", "==", projectId))),
        getDocs(query(collection(db, "invitations"), where("projectId", "==", projectId))),
        getDocs(collection(db, `projects/${projectId}/logs`)),
      ]);
      setAccountingStats({
        accountCount: accountsSnap.size,
        supplierCount: suppliersSnap.size,
        invoiceCount: invoicesSnap.size,
        poCount: posSnap.size,
      });

      const formsData = formsSnap.docs.map((d) => ({
        id: d.id,
        firstName: d.data().prefilled?.firstName || d.data().firstName || "",
        lastName1: d.data().prefilled?.lastName1 || d.data().lastName1 || "",
        email: d.data().prefilled?.email || d.data().email || "",
        status: d.data().status || "pending",
        createdAt: d.data().createdAt,
      }));
      const invitationsData = invitationsSnap.docs.map((d) => ({
        id: d.id,
        email: d.data().email || "",
        status: d.data().status || "pending",
        createdAt: d.data().createdAt,
      }));
      setTeamStats({
        totalForms: formsData.length,
        pendingForms: formsData.filter((f) => f.status === "pending").length,
        completedForms: formsData.filter((f) => f.status === "completed").length,
        signedForms: formsData.filter((f) => f.status === "signed").length,
        totalInvitations: invitationsData.length,
        forms: formsData,
        invitations: invitationsData,
      });

      const logsData = logsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .sort((a: any, b: any) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setLogs(logsData);

      setLoading(false);
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error al cargar los datos");
      setLoading(false);
    }
  };

  const writeLog = async (type: string, data: Record<string, any>) => {
    try {
      const logRef = doc(collection(db, `projects/${projectId}/logs`));
      await setDoc(logRef, {
        type,
        ...data,
        createdAt: serverTimestamp(),
        createdBy: contextUser?.uid || null,
      });
    } catch (_) {}
  };

  const copyFormLink = async (formId: string) => {
    const url = `${window.location.origin}/form/${formId}`;
    await navigator.clipboard.writeText(url);
    setCopiedFormId(formId);
    setTimeout(() => setCopiedFormId(null), 2000);
    showToast("success", "Link copiado");
  };

  const resendFormEmail = async (form: { id: string; email?: string; firstName?: string; lastName1?: string }) => {
    if (!form.email) { showToast("error", "Esta ficha no tiene email"); return; }
    try {
      const url = `${window.location.origin}/form/${form.id}`;
      await fetch("/api/send-form-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: form.email,
          name: `${form.firstName || ""} ${form.lastName1 || ""}`.trim() || form.email,
          formUrl: url,
          projectName: project?.name || "",
        }),
      });
      showToast("success", `Email reenviado a ${form.email}`);
      await writeLog("form_reminder_sent", { targetEmail: form.email, formId: form.id, actorName: contextUser?.name || contextUser?.email || "Admin" });
    } catch {
      showToast("error", "Error al reenviar el email");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Message ──────────────────────────────────────────────────────────────────

  const handleSendMessage = async () => {
    if (!messageForm.title.trim() || !messageForm.content.trim()) {
      showToast("error", "Título y mensaje son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const messageData = {
        title: messageForm.title.trim(),
        content: messageForm.content.trim(),
        type: messageForm.type,
        sentAt: serverTimestamp(),
        sentBy: contextUser?.uid,
        sentByName: contextUser?.name || contextUser?.email || "Admin",
        read: false,
        targetProjects: [projectId],
      };
      for (const member of members) {
        const messageRef = doc(collection(db, `users/${member.id}/messages`));
        await setDoc(messageRef, messageData);
      }
      setMessageForm({ title: "", content: "", type: "info" });
      setShowMessageModal(false);
      showToast("success", `Mensaje enviado a ${members.length} miembro${members.length !== 1 ? "s" : ""}`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al enviar el mensaje");
    } finally {
      setSaving(false);
    }
  };

  // ── Edit project ─────────────────────────────────────────────────────────────

  const handleUpdateProject = async () => {
    if (!editForm.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const oldProducers = project?.producers || [];
      const newProducers = editForm.producers;

      await updateDoc(doc(db, "projects", projectId), {
        name: editForm.name.trim(),
        phase: editForm.phase,
        description: editForm.description.trim(),
        producers: newProducers,
      });

      // Sync companyProjects
      for (const pid of oldProducers) {
        if (!newProducers.includes(pid)) {
          await deleteDoc(doc(db, `companyProjects/${pid}/projects`, projectId));
        }
      }
      for (const pid of newProducers) {
        await setDoc(doc(db, `companyProjects/${pid}/projects`, projectId), {
          projectId,
          name: editForm.name.trim(),
          phase: editForm.phase,
          addedAt: serverTimestamp(),
        });
      }

      setShowEditModal(false);
      showToast("success", "Proyecto actualizado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar");
    } finally {
      setSaving(false);
    }
  };

  // ── Close / Cancel close ──────────────────────────────────────────────────────

  const handleInitiateClose = async () => {
    setSaving(true);
    try {
      const closingDate = new Date();
      closingDate.setDate(closingDate.getDate() + closeDays);
      await updateDoc(doc(db, "projects", projectId), {
        closingAt: Timestamp.fromDate(closingDate),
        closingInitiatedBy: contextUser?.uid,
      });
      const messageData = {
        title: `⚠️ Proyecto "${project?.name}" se cerrará`,
        content: `El administrador ha iniciado el cierre de este proyecto. Se eliminará en ${closeDays} días (${closingDate.toLocaleDateString("es-ES")}). Asegúrate de descargar cualquier información que necesites conservar.`,
        type: "warning",
        sentAt: serverTimestamp(),
        sentBy: contextUser?.uid,
        sentByName: "Sistema",
        read: false,
        targetProjects: [projectId],
      };
      for (const member of members) {
        await setDoc(doc(collection(db, `users/${member.id}/messages`)), messageData);
      }
      setShowCloseModal(false);
      showToast("success", `Cierre programado para ${closeDays} días`);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al programar el cierre");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelClose = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", projectId), {
        closingAt: null,
        closingInitiatedBy: null,
      });
      showToast("success", "Cierre cancelado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al cancelar");
    } finally {
      setSaving(false);
    }
  };

  // ── Members ──────────────────────────────────────────────────────────────────

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!confirm(`¿Eliminar a ${memberName} del proyecto?`)) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${projectId}/members`, memberId));
      await deleteDoc(doc(db, `userProjects/${memberId}/projects`, projectId));
      showToast("success", "Miembro eliminado");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al eliminar miembro");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMember = async () => {
    if (!addMemberForm.role) {
      showToast("error", "Selecciona un rol");
      return;
    }

    // Determine whether we're inviting a registered user or a new email
    const selectedUser = allUsers.find((u) => u.id === addMemberForm.odId);
    const emailRaw = selectedUser ? selectedUser.email : addMemberForm.searchQuery.trim().toLowerCase();
    const inviteeName = selectedUser ? selectedUser.name : addMemberForm.inviteName.trim();

    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      showToast("error", "Email no válido");
      return;
    }
    if (!inviteeName) {
      showToast("error", "Introduce el nombre del invitado");
      return;
    }
    if (members.find((m) => m.email?.toLowerCase() === emailRaw)) {
      showToast("error", "Este usuario ya es miembro");
      return;
    }

    setSaving(true);
    try {
      const hasAccounting = ["EP", "PM", "Controller", "PC"].includes(addMemberForm.role);
      const inviteData: any = {
        projectId,
        projectName: project?.name || "",
        invitedEmail: emailRaw,
        invitedName: inviteeName,
        invitedUserId: selectedUser ? selectedUser.id : null,
        invitedBy: contextUser?.uid || null,
        invitedByName: "Equipo de Filma Workspace",
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        roleType: "project",
        role: addMemberForm.role,
        permissions: {
          config: ["EP", "PM"].includes(addMemberForm.role),
          accounting: hasAccounting,
          team: ["EP", "PM"].includes(addMemberForm.role),
        },
        ...(hasAccounting && { accountingAccessLevel: "accounting_extended" }),
      };

      await addDoc(collection(db, "invitations"), inviteData);

      // Send invitation email (fire-and-forget)
      fetch("/api/send-project-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteeName,
          invitedByName: "Equipo de Filma Workspace",
          invitedEmail: emailRaw,
          projectName: project?.name || "",
          projectId,
          role: addMemberForm.role,
          isExistingUser: !!selectedUser,
        }),
      }).catch(console.error);

      setAddMemberForm({ odId: "", role: "", searchQuery: "", inviteName: "" });
      setShowAddMemberModal(false);
      showToast("success", "Invitación enviada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al enviar invitación");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateMemberPermissions = async () => {
    if (!showEditMemberModal) return;
    setSaving(true);
    try {
      const updatedPermissions = {
        config: editMemberForm.config,
        accounting: editMemberForm.accounting,
        team: editMemberForm.team,
      };
      await updateDoc(doc(db, `projects/${projectId}/members`, showEditMemberModal.id), {
        permissions: updatedPermissions,
        accountingAccessLevel: editMemberForm.accounting ? editMemberForm.accountingAccessLevel : "user",
      });
      await updateDoc(doc(db, `userProjects/${showEditMemberModal.id}/projects`, projectId), {
        permissions: updatedPermissions,
        accountingAccessLevel: editMemberForm.accounting ? editMemberForm.accountingAccessLevel : "user",
      });
      setShowEditMemberModal(null);
      showToast("success", "Permisos actualizados");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al actualizar permisos");
    } finally {
      setSaving(false);
    }
  };

  // ── Departments ──────────────────────────────────────────────────────────────

  const handleAddDepartment = async () => {
    const name = newDeptName.trim();
    if (!name) return;
    if (departments.find((d) => d.name.toLowerCase() === name.toLowerCase())) {
      showToast("error", "Ya existe ese departamento");
      return;
    }
    setSaving(true);
    try {
      const newDepts = [...departments.map((d) => d.name), name];
      await updateDoc(doc(db, "projects", projectId), { departments: newDepts });
      setNewDeptName("");
      showToast("success", "Departamento añadido");
      await loadData();
    } catch (error) {
      showToast("error", "Error al añadir departamento");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveDepartment = async (deptName: string) => {
    const dept = departments.find((d) => d.name === deptName);
    if (dept && dept.memberCount > 0) {
      showToast("error", "El departamento tiene miembros asignados");
      return;
    }
    setSaving(true);
    try {
      const newDepts = departments.map((d) => d.name).filter((n) => n !== deptName);
      await updateDoc(doc(db, "projects", projectId), { departments: newDepts });
      showToast("success", "Departamento eliminado");
      await loadData();
    } catch (error) {
      showToast("error", "Error al eliminar departamento");
    } finally {
      setSaving(false);
    }
  };

  // ── Clone project ─────────────────────────────────────────────────────────────

  const handleCloneProject = async () => {
    if (!cloneName.trim()) {
      showToast("error", "Introduce un nombre para el proyecto clonado");
      return;
    }
    setSaving(true);
    try {
      const newId = generateShortId();
      await setDoc(doc(db, "projects", newId), {
        name: cloneName.trim(),
        description: project?.description || "",
        phase: project?.phase || "Desarrollo",
        producers: project?.producers || [],
        departments: DEFAULT_DEPARTMENTS.map((d) => d.name),
        createdAt: serverTimestamp(),
      });
      for (const producerId of project?.producers || []) {
        await setDoc(doc(db, `companyProjects/${producerId}/projects`, newId), {
          projectId: newId,
          name: cloneName.trim(),
          phase: project?.phase || "Desarrollo",
          addedAt: serverTimestamp(),
        });
      }
      try {
        const depsSnap = await getDocs(collection(db, `projects/${projectId}/departments`));
        for (const depDoc of depsSnap.docs) {
          await setDoc(doc(db, `projects/${newId}/departments`, depDoc.id), depDoc.data());
        }
      } catch {
        // departments may not exist as subcollection
      }
      if (cloneIncludeBudget) {
        const accountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
        for (const accDoc of accountsSnap.docs) {
          const accData = accDoc.data();
          await setDoc(doc(db, `projects/${newId}/accounts`, accDoc.id), {
            code: accData.code,
            description: accData.description,
            createdAt: serverTimestamp(),
            createdBy: accData.createdBy || "",
          });
          const subSnap = await getDocs(collection(db, `projects/${projectId}/accounts/${accDoc.id}/subaccounts`));
          for (const subDoc of subSnap.docs) {
            const subData = subDoc.data();
            await setDoc(doc(db, `projects/${newId}/accounts/${accDoc.id}/subaccounts`, subDoc.id), {
              code: subData.code,
              description: subData.description,
              budgeted: subData.budgeted || 0,
              committed: 0,
              actual: 0,
              box: 0,
              accountId: accDoc.id,
              createdAt: serverTimestamp(),
            });
          }
        }
      }
      if (cloneIncludeSuppliers) {
        const suppliersSnap = await getDocs(collection(db, `projects/${projectId}/suppliers`));
        for (const supDoc of suppliersSnap.docs) {
          await setDoc(doc(db, `projects/${newId}/suppliers`, supDoc.id), supDoc.data());
        }
      }
      setShowCloneModal(false);
      setCloneName("");
      setCloneIncludeBudget(true);
      setCloneIncludeSuppliers(true);
      showToast("success", `Proyecto "${cloneName.trim()}" creado`);
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al clonar el proyecto");
    } finally {
      setSaving(false);
    }
  };

  // ── Copy suppliers ────────────────────────────────────────────────────────────

  const handleCopySuppliers = async () => {
    if (!copySupplierTargetId) {
      showToast("error", "Selecciona un proyecto destino");
      return;
    }
    setSaving(true);
    try {
      const sourceSnap = await getDocs(collection(db, `projects/${projectId}/suppliers`));
      const targetSnap = await getDocs(collection(db, `projects/${copySupplierTargetId}/suppliers`));
      const existingKeys = new Set(targetSnap.docs.map((d) => d.data().taxId || d.data().fiscalName || d.id));
      let copied = 0;
      for (const supplierDoc of sourceSnap.docs) {
        const data = supplierDoc.data();
        const key = data.taxId || data.fiscalName || supplierDoc.id;
        if (!existingKeys.has(key)) {
          await setDoc(doc(db, `projects/${copySupplierTargetId}/suppliers`, supplierDoc.id), data);
          copied++;
        }
      }
      setShowCopySuppliersModal(false);
      setCopySupplierTargetId("");
      setCopySupplierSearch("");
      showToast("success", `${copied} proveedor${copied !== 1 ? "es" : ""} copiado${copied !== 1 ? "s" : ""}`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al copiar proveedores");
    } finally {
      setSaving(false);
    }
  };

  // ── Copy budget ───────────────────────────────────────────────────────────────

  const handleCopyBudget = async () => {
    if (!copyBudgetTargetId) {
      showToast("error", "Selecciona un proyecto destino");
      return;
    }
    setSaving(true);
    try {
      const sourceAccountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
      const targetAccountsSnap = await getDocs(collection(db, `projects/${copyBudgetTargetId}/accounts`));
      const overwrite =
        targetAccountsSnap.size > 0
          ? confirm(`El proyecto destino ya tiene ${targetAccountsSnap.size} cuenta(s). ¿Sobreescribir?`)
          : false;
      if (overwrite) {
        for (const accDoc of targetAccountsSnap.docs) {
          const subSnap = await getDocs(collection(db, `projects/${copyBudgetTargetId}/accounts/${accDoc.id}/subaccounts`));
          for (const subDoc of subSnap.docs) {
            await deleteDoc(doc(db, `projects/${copyBudgetTargetId}/accounts/${accDoc.id}/subaccounts`, subDoc.id));
          }
          await deleteDoc(doc(db, `projects/${copyBudgetTargetId}/accounts`, accDoc.id));
        }
      }
      for (const accDoc of sourceAccountsSnap.docs) {
        const accData = accDoc.data();
        await setDoc(doc(db, `projects/${copyBudgetTargetId}/accounts`, accDoc.id), {
          code: accData.code,
          description: accData.description,
          createdAt: serverTimestamp(),
          createdBy: accData.createdBy || "",
        });
        const subSnap = await getDocs(collection(db, `projects/${projectId}/accounts/${accDoc.id}/subaccounts`));
        for (const subDoc of subSnap.docs) {
          const subData = subDoc.data();
          await setDoc(doc(db, `projects/${copyBudgetTargetId}/accounts/${accDoc.id}/subaccounts`, subDoc.id), {
            code: subData.code,
            description: subData.description,
            budgeted: copyBudgetAmounts ? subData.budgeted || 0 : 0,
            committed: 0,
            actual: 0,
            box: 0,
            accountId: accDoc.id,
            createdAt: serverTimestamp(),
          });
        }
      }
      setShowCopyBudgetModal(false);
      setCopyBudgetTargetId("");
      setCopyBudgetSearch("");
      showToast("success", "Presupuesto copiado correctamente");
    } catch (error) {
      console.error(error);
      showToast("error", "Error al copiar presupuesto");
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const getDaysUntilClose = () => {
    if (!project?.closingAt) return null;
    const diffTime = project.closingAt.toDate().getTime() - Date.now();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const filteredUsersForAdd = allUsers.filter(
    (u) =>
      !members.find((m) => m.id === u.id) &&
      (u.name.toLowerCase().includes(addMemberForm.searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(addMemberForm.searchQuery.toLowerCase()))
  );

  const filteredProjectsForSupplierCopy = allProjects.filter((p) =>
    p.name.toLowerCase().includes(copySupplierSearch.toLowerCase())
  );

  const filteredProjectsForBudgetCopy = allProjects.filter((p) =>
    p.name.toLowerCase().includes(copyBudgetSearch.toLowerCase())
  );

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading || userLoading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  const daysUntilClose = getDaysUntilClose();
  const phase = phaseConfig[project.phase] || phaseConfig["Desarrollo"];

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
          <div className="mb-6">
            <Link
              href="/admindashboard"
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft size={14} />
              Volver a Administración
            </Link>
          </div>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-slate-900">{project.name}</h1>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${phase.bg} ${phase.text}`}>
                  {project.phase}
                </span>
              </div>
              {project.producerNames && project.producerNames.length > 0 && (
                <p className="text-sm text-slate-500 flex items-center gap-1.5">
                  <Building2 size={14} className="text-slate-400" />
                  {project.producerNames.join(", ")}
                </p>
              )}
            </div>

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
              <Link
                href={`/project/${projectId}`}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
              >
                <ExternalLink size={14} />
                Ir al proyecto
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Closing warning banner */}
      {daysUntilClose !== null && (
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                  <Clock size={18} className="text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-red-900">
                    Cierre programado en {daysUntilClose} día{daysUntilClose !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-red-600">
                    El proyecto se eliminará el {project.closingAt?.toDate().toLocaleDateString("es-ES")}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelClose}
                disabled={saving}
                className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-2">
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 w-fit">
          {[
            { id: "general", label: "General", icon: Settings },
            { id: "accounting", label: "Accounting", icon: BarChart3 },
            { id: "team", label: "Team", icon: Users },
            { id: "logs", label: "Logs", icon: Activity },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">

        {/* ══════════════════════════════════ GENERAL TAB ══════════════════════════════════ */}
        {activeTab === "general" && (
          <div className="space-y-5">

            {/* ── Main grid: users (left 2/3) + info+departments (right 1/3) ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

              {/* Users — prominent left column */}
              <div className="lg:col-span-2">
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden h-full">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">Usuarios del proyecto</h2>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{members.length}</span>
                    </div>
                    <button
                      onClick={() => setShowAddMemberModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800"
                    >
                      <UserPlus size={12} />
                      Añadir usuario
                    </button>
                  </div>
                  {members.length === 0 ? (
                    <div className="p-12 text-center">
                      <Users size={28} className="text-slate-300 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-700 mb-1">Sin usuarios asignados</p>
                      <p className="text-xs text-slate-400">Añade el primer usuario para que pueda acceder al proyecto</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {members.map((member) => (
                        <div key={member.id} className="px-5 py-4 flex items-center justify-between hover:bg-slate-50 group">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 text-sm font-semibold">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900">{member.name}</p>
                              <p className="text-xs text-slate-400">{member.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {member.role && (
                              <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded-lg">{member.role}</span>
                            )}
                            <div className="flex items-center gap-1">
                              {member.permissions.config && (
                                <span className="text-[10px] bg-violet-50 text-violet-700 border border-violet-100 px-1.5 py-0.5 rounded">Config</span>
                              )}
                              {member.permissions.accounting && (
                                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded">
                                  {member.accountingAccessLevel === "accounting_extended" ? "Acc+" : member.accountingAccessLevel === "accounting" ? "Acc" : "Acc·U"}
                                </span>
                              )}
                              {member.permissions.team && (
                                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded">Team</span>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  setShowEditMemberModal(member);
                                  setEditMemberForm({
                                    config: member.permissions.config || false,
                                    accounting: member.permissions.accounting || false,
                                    team: member.permissions.team || false,
                                    accountingAccessLevel: member.accountingAccessLevel || "user",
                                  });
                                }}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                                title="Editar permisos"
                              >
                                <Shield size={14} />
                              </button>
                              <button
                                onClick={() => handleRemoveMember(member.id, member.name)}
                                disabled={saving}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                title="Eliminar del proyecto"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right column: project info + departments */}
              <div className="lg:col-span-1 space-y-4">

                {/* Project info — compact */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">Proyecto</h2>
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                      title="Editar"
                    >
                      <Edit2 size={13} />
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    <div>
                      <p className="text-xs text-slate-400 mb-0.5">Nombre</p>
                      <p className="text-sm font-medium text-slate-900">{project.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">Fase</p>
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-lg ${phase.bg} ${phase.text}`}>
                          {project.phase}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">ID</p>
                        <p className="text-xs font-mono text-slate-500">{project.id}</p>
                      </div>
                    </div>
                    {project.producerNames && project.producerNames.length > 0 && (
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">Productoras</p>
                        <p className="text-sm text-slate-600">{project.producerNames.join(", ")}</p>
                      </div>
                    )}
                    {project.description && (
                      <div>
                        <p className="text-xs text-slate-400 mb-0.5">Descripción</p>
                        <p className="text-xs text-slate-500 leading-relaxed">{project.description}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Departments — editable */}
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                    <Layers size={14} className="text-slate-400" />
                    <h2 className="text-sm font-semibold text-slate-900">Departamentos</h2>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{departments.length}</span>
                  </div>
                  <div className="p-4 space-y-3">
                    {departments.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {departments.map((dept) => (
                          <div
                            key={dept.id}
                            className="group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700"
                          >
                            <span>{dept.name}</span>
                            {dept.memberCount > 0 && (
                              <span className="text-[10px] text-slate-400">{dept.memberCount}</span>
                            )}
                            <button
                              onClick={() => handleRemoveDepartment(dept.name)}
                              disabled={saving || dept.memberCount > 0}
                              className="p-0.5 text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                              title={dept.memberCount > 0 ? "Tiene miembros asignados" : "Eliminar"}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Sin departamentos</p>
                    )}
                    {/* Add department */}
                    <div className="flex gap-2 pt-1">
                      <input
                        type="text"
                        value={newDeptName}
                        onChange={(e) => setNewDeptName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddDepartment()}
                        placeholder="Nuevo departamento"
                        className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-xs"
                      />
                      <button
                        onClick={handleAddDepartment}
                        disabled={saving || !newDeptName.trim()}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 disabled:opacity-40"
                      >
                        Añadir
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Admin actions strip — compact, secondary ── */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                onClick={() => {
                  setCloneName(project.name + " (copia)");
                  setCloneIncludeBudget(true);
                  setCloneIncludeSuppliers(true);
                  setShowCloneModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300"
              >
                <FolderPlus size={14} />
                Clonar proyecto
              </button>

              {daysUntilClose === null ? (
                <button
                  onClick={() => setShowCloseModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white border border-red-200 rounded-xl text-sm text-red-600 hover:bg-red-50"
                >
                  <Clock size={14} />
                  Programar cierre
                </button>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
                  <Clock size={14} className="text-red-500 flex-shrink-0" />
                  <span className="text-sm text-red-700">Cierre en {daysUntilClose} días ({project.closingAt?.toDate().toLocaleDateString("es-ES")})</span>
                  <button
                    onClick={handleCancelClose}
                    disabled={saving}
                    className="ml-auto text-xs text-red-600 hover:text-red-900 font-medium underline underline-offset-2 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ ACCOUNTING TAB ══════════════════════════════════ */}
        {activeTab === "accounting" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Cuentas presup.", value: accountingStats.accountCount, icon: BarChart3, color: "text-blue-600", bg: "bg-blue-50" },
                { label: "Proveedores", value: accountingStats.supplierCount, icon: Building2, color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Facturas", value: accountingStats.invoiceCount, icon: FileText, color: "text-violet-600", bg: "bg-violet-50" },
                { label: "POs", value: accountingStats.poCount, icon: ShoppingCart, color: "text-amber-600", bg: "bg-amber-50" },
              ].map((stat) => (
                <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-5">
                  <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
                    <stat.icon size={18} className={stat.color} />
                  </div>
                  <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Quick links */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-900">Acceso rápido</h2>
              </div>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Presupuesto", href: `/project/${projectId}/accounting/budget`, icon: BarChart3 },
                  { label: "Proveedores", href: `/project/${projectId}/accounting/suppliers`, icon: Building2 },
                  { label: "Facturas", href: `/project/${projectId}/accounting/invoices`, icon: FileText },
                  { label: "POs", href: `/project/${projectId}/accounting/pos`, icon: ShoppingCart },
                ].map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="flex items-center gap-2 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 text-sm font-medium text-slate-700"
                  >
                    <link.icon size={14} className="text-slate-400" />
                    {link.label}
                    <ExternalLink size={11} className="text-slate-300 ml-auto" />
                  </Link>
                ))}
              </div>
            </div>

            {/* Copy operations */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Copy suppliers */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-slate-900">Copiar proveedores</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Copia los {accountingStats.supplierCount} proveedores de este proyecto a otro</p>
                </div>
                <div className="p-5">
                  <button
                    onClick={() => {
                      setCopySupplierTargetId("");
                      setCopySupplierSearch("");
                      setShowCopySuppliersModal(true);
                    }}
                    disabled={accountingStats.supplierCount === 0}
                    className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
                  >
                    <Copy size={14} />
                    Copiar proveedores a otro proyecto
                  </button>
                </div>
              </div>

              {/* Copy budget */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-slate-900">Copiar presupuesto</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Copia las {accountingStats.accountCount} cuentas de este proyecto a otro</p>
                </div>
                <div className="p-5">
                  <button
                    onClick={() => {
                      setCopyBudgetTargetId("");
                      setCopyBudgetSearch("");
                      setCopyBudgetAmounts(true);
                      setShowCopyBudgetModal(true);
                    }}
                    disabled={accountingStats.accountCount === 0}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
                  >
                    <Copy size={14} />
                    Copiar presupuesto a otro proyecto
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ TEAM TAB ══════════════════════════════════ */}
        {activeTab === "team" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: "Fichas creadas", value: teamStats.totalForms, icon: FileText, color: "text-blue-600", bg: "bg-blue-50" },
                { label: "Pendientes", value: teamStats.pendingForms, icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
                { label: "Completadas", value: teamStats.completedForms, icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
                { label: "Firmadas", value: teamStats.signedForms, icon: Shield, color: "text-violet-600", bg: "bg-violet-50" },
              ].map((stat) => (
                <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-5">
                  <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
                    <stat.icon size={18} className={stat.color} />
                  </div>
                  <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Fichas list */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <FileText size={15} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-900">Fichas de crew</h2>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{teamStats.totalForms}</span>
              </div>
              {teamStats.forms.length === 0 ? (
                <div className="p-10 text-center">
                  <FileText size={24} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No hay fichas creadas para este proyecto</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {teamStats.forms.map((form) => {
                    const statusConfig = {
                      pending: { label: "Pendiente", bg: "bg-amber-50", text: "text-amber-700" },
                      completed: { label: "Completada", bg: "bg-emerald-50", text: "text-emerald-700" },
                      signed: { label: "Firmada", bg: "bg-violet-50", text: "text-violet-700" },
                    }[form.status] || { label: form.status, bg: "bg-slate-100", text: "text-slate-600" };
                    const isCopied = copiedFormId === form.id;
                    return (
                      <div key={form.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 group">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {form.firstName || form.lastName1 ? `${form.firstName} ${form.lastName1}`.trim() : "Sin nombre"}
                          </p>
                          {form.email && <p className="text-xs text-slate-500">{form.email}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${statusConfig.bg} ${statusConfig.text}`}>
                            {statusConfig.label}
                          </span>
                          {form.createdAt && (
                            <span className="text-xs text-slate-400">
                              {form.createdAt.toDate().toLocaleDateString("es-ES")}
                            </span>
                          )}
                          {/* Copy link */}
                          <button
                            onClick={() => copyFormLink(form.id)}
                            className={`p-1.5 rounded-lg transition-colors ${isCopied ? "bg-emerald-50 text-emerald-600" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100 opacity-0 group-hover:opacity-100"}`}
                            title="Copiar link de la ficha"
                          >
                            {isCopied ? <CheckCircle size={14} /> : <Link2 size={14} />}
                          </button>
                          {/* Resend email */}
                          {form.email && (
                            <button
                              onClick={() => resendFormEmail(form)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                              title={`Reenviar email a ${form.email}`}
                            >
                              <Mail size={14} />
                            </button>
                          )}
                          {/* Open form */}
                          <a
                            href={`/form/${form.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Abrir ficha"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════ LOGS TAB ══════════════════════════════════ */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-500">Registro de actividad del proyecto</p>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{logs.length} eventos</span>
            </div>

            {logs.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
                <Activity size={28} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-700 mb-1">Sin actividad registrada</p>
                <p className="text-xs text-slate-400">Los eventos aparecerán aquí a medida que ocurran</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {logs.map((log) => {
                    const logConfig: Record<string, { label: string; icon: any; iconBg: string; iconColor: string }> = {
                      invitation_sent:      { label: "Invitación enviada",        icon: Send,      iconBg: "bg-blue-50",    iconColor: "text-blue-600" },
                      invitation_accepted:  { label: "Invitación aceptada",       icon: UserCheck, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
                      invitation_rejected:  { label: "Invitación rechazada",      icon: X,         iconBg: "bg-red-50",     iconColor: "text-red-600" },
                      user_registered:      { label: "Usuario registrado",        icon: UserPlus,  iconBg: "bg-violet-50",  iconColor: "text-violet-600" },
                      user_joined:          { label: "Usuario se unió",           icon: UserCheck, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
                      user_removed:         { label: "Usuario eliminado",         icon: Trash2,    iconBg: "bg-slate-100",  iconColor: "text-slate-500" },
                      member_added:         { label: "Miembro añadido",           icon: UserPlus,  iconBg: "bg-blue-50",    iconColor: "text-blue-600" },
                      form_created:         { label: "Ficha creada",              icon: FileText,  iconBg: "bg-blue-50",    iconColor: "text-blue-600" },
                      form_submitted:       { label: "Ficha completada",          icon: CheckCircle, iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
                      form_signed:          { label: "Ficha firmada",             icon: Shield,    iconBg: "bg-violet-50",  iconColor: "text-violet-600" },
                      form_reminder_sent:   { label: "Recordatorio de ficha enviado", icon: Mail, iconBg: "bg-amber-50",   iconColor: "text-amber-600" },
                      message_sent:         { label: "Mensaje enviado",           icon: MessageSquare, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
                    };
                    const cfg = logConfig[log.type] || { label: log.type, icon: Activity, iconBg: "bg-slate-100", iconColor: "text-slate-500" };
                    const Icon = cfg.icon;
                    return (
                      <div key={log.id} className="px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconBg}`}>
                          <Icon size={14} className={cfg.iconColor} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900">{cfg.label}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            {log.actorName && (
                              <span className="text-xs text-slate-500">
                                Por: <span className="font-medium text-slate-700">{log.actorName}</span>
                              </span>
                            )}
                            {log.targetEmail && (
                              <span className="text-xs text-slate-500">
                                → <span className="font-medium text-slate-700">{log.targetEmail}</span>
                              </span>
                            )}
                            {log.targetName && !log.targetEmail && (
                              <span className="text-xs text-slate-500">
                                → <span className="font-medium text-slate-700">{log.targetName}</span>
                              </span>
                            )}
                            {log.meta && (
                              <span className="text-xs text-slate-400">{log.meta}</span>
                            )}
                          </div>
                        </div>
                        {log.createdAt && (
                          <span className="text-xs text-slate-400 flex-shrink-0 mt-0.5">
                            {log.createdAt.toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}{" "}
                            {log.createdAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ══════════════════════════════════ MODALS ══════════════════════════════════ */}

      {/* Send Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Enviar mensaje al equipo</h3>
              <button onClick={() => setShowMessageModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "info", label: "Info", icon: Info, color: "blue" },
                    { value: "warning", label: "Aviso", icon: AlertTriangle, color: "amber" },
                    { value: "success", label: "Éxito", icon: CheckCircle, color: "emerald" },
                  ].map((type) => {
                    const Icon = type.icon;
                    const isSelected = messageForm.type === type.value;
                    return (
                      <button
                        key={type.value}
                        onClick={() => setMessageForm({ ...messageForm, type: type.value as typeof messageForm.type })}
                        className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${
                          isSelected ? `bg-${type.color}-50 border-${type.color}-200 text-${type.color}-700` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <Icon size={14} />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Título</label>
                <input
                  type="text"
                  value={messageForm.title}
                  onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value })}
                  placeholder="Asunto del mensaje"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje</label>
                <textarea
                  value={messageForm.content}
                  onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })}
                  placeholder="Escribe tu mensaje"
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                />
              </div>
              <p className="text-xs text-slate-500">
                Se enviará a {members.length} miembro{members.length !== 1 ? "s" : ""} del proyecto
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowMessageModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSendMessage}
                disabled={saving || !messageForm.title.trim() || !messageForm.content.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                <Send size={14} />
                {saving ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Editar proyecto</h3>
              <button onClick={() => setShowEditModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fase</label>
                <div className="grid grid-cols-3 gap-2">
                  {PHASES.map((p) => {
                    const pConfig = phaseConfig[p] || phaseConfig["Desarrollo"];
                    return (
                      <button
                        key={p}
                        onClick={() => setEditForm({ ...editForm, phase: p })}
                        className={`px-3 py-2 rounded-xl border text-xs font-medium ${
                          editForm.phase === p ? `${pConfig.bg} ${pConfig.text} border-current` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Productoras */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Productoras</label>
                {editForm.producers.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editForm.producers.map((pid) => {
                      const prod = allProducers.find((p) => p.id === pid);
                      return prod ? (
                        <span key={pid} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-sm">
                          <Building2 size={12} />
                          {prod.name}
                          <button
                            onClick={() => setEditForm({ ...editForm, producers: editForm.producers.filter((id) => id !== pid) })}
                            className="ml-1 text-amber-400 hover:text-amber-700"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
                <input
                  type="text"
                  value={producerSearch}
                  onChange={(e) => setProducerSearch(e.target.value)}
                  placeholder="Buscar productora"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                {producerSearch.length >= 1 && (
                  <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                    {allProducers
                      .filter((p) => p.name.toLowerCase().includes(producerSearch.toLowerCase()) && !editForm.producers.includes(p.id))
                      .map((prod) => (
                        <button
                          key={prod.id}
                          onClick={() => {
                            setEditForm({ ...editForm, producers: [...editForm.producers, prod.id] });
                            setProducerSearch("");
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-100 last:border-0"
                        >
                          <Building2 size={13} className="text-amber-500" />
                          {prod.name}
                        </button>
                      ))}
                    {allProducers.filter((p) => p.name.toLowerCase().includes(producerSearch.toLowerCase()) && !editForm.producers.includes(p.id)).length === 0 && (
                      <p className="px-4 py-3 text-sm text-slate-400 text-center">Sin resultados</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => { setShowEditModal(false); setProducerSearch(""); }}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdateProject}
                disabled={saving || !editForm.name.trim()}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close Project Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Programar cierre</h3>
              <button onClick={() => setShowCloseModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">¿Estás seguro?</p>
                    <p className="text-xs mt-1">
                      El proyecto y todos sus datos se eliminarán permanentemente. Se notificará a todos los miembros.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Días hasta el cierre</label>
                <div className="flex items-center gap-3">
                  {[7, 14, 30, 60].map((days) => (
                    <button
                      key={days}
                      onClick={() => setCloseDays(days)}
                      className={`px-4 py-2 rounded-xl border text-sm font-medium ${
                        closeDays === days ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {days}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  El proyecto se eliminará el{" "}
                  {new Date(Date.now() + closeDays * 24 * 60 * 60 * 1000).toLocaleDateString("es-ES")}
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCloseModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                  Cancelar
                </button>
                <button
                  onClick={handleInitiateClose}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {saving ? "Programando..." : "Programar cierre"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMemberModal && (() => {
        const selectedUser = allUsers.find((u) => u.id === addMemberForm.odId);
        const isManualEmail = !selectedUser && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addMemberForm.searchQuery.trim());
        const canSubmit = !saving && addMemberForm.role && (
          selectedUser || (isManualEmail && addMemberForm.inviteName.trim())
        );
        return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Invitar miembro</h3>
                <p className="text-xs text-slate-500 mt-0.5">El usuario recibirá un email y tendrá que aceptar la invitación</p>
              </div>
              <button
                onClick={() => { setShowAddMemberModal(false); setAddMemberForm({ odId: "", role: "", searchQuery: "", inviteName: "" }); }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Usuario o email</label>
                <input
                  type="text"
                  value={addMemberForm.searchQuery}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, searchQuery: e.target.value, odId: "", inviteName: "" })}
                  placeholder="Buscar por nombre, email o escribe un email"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                {addMemberForm.searchQuery && !addMemberForm.odId && (
                  <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredUsersForAdd.length > 0 ? (
                      filteredUsersForAdd.slice(0, 5).map((user) => (
                        <button
                          key={user.id}
                          onClick={() => setAddMemberForm({ ...addMemberForm, odId: user.id, searchQuery: user.name, inviteName: user.name })}
                          className="w-full px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <p className="text-sm font-medium text-slate-900">{user.name}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </button>
                      ))
                    ) : isManualEmail ? (
                      <div className="px-3 py-2.5 text-sm text-slate-600 flex items-center gap-2">
                        <Mail size={14} className="text-slate-400 flex-shrink-0" />
                        Invitar a <span className="font-medium">{addMemberForm.searchQuery.trim()}</span>
                      </div>
                    ) : (
                      <p className="p-3 text-sm text-slate-500 text-center">Sin resultados — escribe un email para invitar</p>
                    )}
                  </div>
                )}
                {selectedUser && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center text-xs font-semibold text-slate-600">
                      {selectedUser.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{selectedUser.name}</p>
                      <p className="text-xs text-slate-500 truncate">{selectedUser.email}</p>
                    </div>
                    <button onClick={() => setAddMemberForm({ ...addMemberForm, odId: "", searchQuery: "", inviteName: "" })} className="text-slate-400 hover:text-slate-600">
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Name field for non-registered users */}
              {isManualEmail && !selectedUser && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nombre</label>
                  <input
                    type="text"
                    value={addMemberForm.inviteName}
                    onChange={(e) => setAddMemberForm({ ...addMemberForm, inviteName: e.target.value })}
                    placeholder="Nombre completo"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rol</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROJECT_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => setAddMemberForm({ ...addMemberForm, role })}
                      className={`px-3 py-2 rounded-xl border text-sm font-medium ${
                        addMemberForm.role === role ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => { setShowAddMemberModal(false); setAddMemberForm({ odId: "", role: "", searchQuery: "", inviteName: "" }); }}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddMember}
                disabled={!canSubmit}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Enviando..." : "Enviar invitación"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Edit Member Permissions Modal */}
      {showEditMemberModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Editar permisos</h3>
                <p className="text-sm text-slate-500">{showEditMemberModal.name}</p>
              </div>
              <button onClick={() => setShowEditMemberModal(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">Acceso a entornos</label>
                <div className="space-y-2">
                  {[
                    { key: "config" as const, label: "Config", desc: "Configuración del proyecto" },
                    { key: "team" as const, label: "Team", desc: "Gestión de equipo" },
                    { key: "accounting" as const, label: "Accounting", desc: "Contabilidad del proyecto" },
                  ].map((item) => (
                    <label key={item.key} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={editMemberForm[item.key]}
                        onChange={(e) => setEditMemberForm({ ...editMemberForm, [item.key]: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500">{item.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {editMemberForm.accounting && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-3">Nivel de acceso en Accounting</label>
                  <div className="space-y-2">
                    {[
                      { value: "user" as const, label: "Usuario", desc: "Solo visualización" },
                      { value: "accounting" as const, label: "Contabilidad", desc: "Crear y gestionar facturas y pagos" },
                      { value: "accounting_extended" as const, label: "Contabilidad avanzada", desc: "Acceso completo incluyendo anulaciones" },
                    ].map((level) => (
                      <label key={level.value} className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                        <input
                          type="radio"
                          name="accountingLevel"
                          checked={editMemberForm.accountingAccessLevel === level.value}
                          onChange={() => setEditMemberForm({ ...editMemberForm, accountingAccessLevel: level.value })}
                          className="w-4 h-4 border-slate-300 text-slate-900 focus:ring-slate-900"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-900">{level.label}</p>
                          <p className="text-xs text-slate-500">{level.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowEditMemberModal(null)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleUpdateMemberPermissions}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Project Modal */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Clonar proyecto</h3>
              <button onClick={() => setShowCloneModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del nuevo proyecto</label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="Nombre del proyecto clonado"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Incluir</p>
                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={cloneIncludeBudget}
                    onChange={(e) => setCloneIncludeBudget(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Presupuesto</p>
                    <p className="text-xs text-slate-500">{accountingStats.accountCount} cuentas</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={cloneIncludeSuppliers}
                    onChange={(e) => setCloneIncludeSuppliers(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">Proveedores</p>
                    <p className="text-xs text-slate-500">{accountingStats.supplierCount} proveedores</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowCloneModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleCloneProject}
                disabled={saving || !cloneName.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                <FolderPlus size={14} />
                {saving ? "Clonando..." : "Clonar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Suppliers Modal */}
      {showCopySuppliersModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Copiar proveedores</h3>
                <p className="text-sm text-slate-500">Desde: {project.name}</p>
              </div>
              <button onClick={() => setShowCopySuppliersModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Proyecto destino</label>
                <input
                  type="text"
                  value={copySupplierSearch}
                  onChange={(e) => { setCopySupplierSearch(e.target.value); setCopySupplierTargetId(""); }}
                  placeholder="Buscar proyecto destino"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filteredProjectsForSupplierCopy.length === 0 ? (
                    <p className="p-3 text-sm text-slate-500 text-center">No hay otros proyectos</p>
                  ) : (
                    filteredProjectsForSupplierCopy.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setCopySupplierTargetId(p.id); setCopySupplierSearch(p.name); }}
                        className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${copySupplierTargetId === p.id ? "bg-emerald-50 text-emerald-700 font-medium" : "text-slate-700"}`}
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
              {copySupplierTargetId && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
                  Se copiarán {accountingStats.supplierCount} proveedores. Los ya existentes no se duplicarán.
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowCopySuppliersModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleCopySuppliers}
                disabled={saving || !copySupplierTargetId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                <Copy size={14} />
                {saving ? "Copiando..." : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy Budget Modal */}
      {showCopyBudgetModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Copiar presupuesto</h3>
                <p className="text-sm text-slate-500">Desde: {project.name}</p>
              </div>
              <button onClick={() => setShowCopyBudgetModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Proyecto destino</label>
                <input
                  type="text"
                  value={copyBudgetSearch}
                  onChange={(e) => { setCopyBudgetSearch(e.target.value); setCopyBudgetTargetId(""); }}
                  placeholder="Buscar proyecto destino"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {filteredProjectsForBudgetCopy.length === 0 ? (
                    <p className="p-3 text-sm text-slate-500 text-center">No hay otros proyectos</p>
                  ) : (
                    filteredProjectsForBudgetCopy.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setCopyBudgetTargetId(p.id); setCopyBudgetSearch(p.name); }}
                        className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${copyBudgetTargetId === p.id ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-700"}`}
                      >
                        {p.name}
                      </button>
                    ))
                  )}
                </div>
              </div>
              <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={copyBudgetAmounts}
                  onChange={(e) => setCopyBudgetAmounts(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">Copiar importes presupuestados</p>
                  <p className="text-xs text-slate-500">Si no, se copian solo las cuentas con importes en cero</p>
                </div>
              </label>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button onClick={() => setShowCopyBudgetModal(false)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleCopyBudget}
                disabled={saving || !copyBudgetTargetId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                <Copy size={14} />
                {saving ? "Copiando..." : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
