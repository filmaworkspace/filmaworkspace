"use client";
import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft,
  Briefcase,
  Users,
  Trash2,
  CheckCircle,
  AlertCircle,
  X,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  Send,
  Info,
  AlertTriangle,
  Clock,
  Calendar,
  Edit2,
  UserPlus,
  Shield,
  Settings,
  FolderOpen,
  Building2,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];

const phaseConfig: Record<string, { bg: string; text: string }> = {
  Desarrollo: { bg: "bg-sky-50", text: "text-sky-700" },
  Preproducción: { bg: "bg-amber-50", text: "text-amber-700" },
  Rodaje: { bg: "bg-rose-50", text: "text-rose-700" },
  Postproducción: { bg: "bg-violet-50", text: "text-violet-700" },
  Finalizado: { bg: "bg-emerald-50", text: "text-emerald-700" },
};

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC", "Supervisor"];

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
}

interface DepartmentData {
  id: string;
  name: string;
  color: string;
  memberCount: number;
}

export default function AdminProjectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [members, setMembers] = useState<MemberData[]>([]);
  const [departments, setDepartments] = useState<DepartmentData[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; email: string }[]>([]);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Modals
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  // Message form
  const [messageForm, setMessageForm] = useState({
    title: "",
    content: "",
    type: "info" as "info" | "warning" | "success",
  });

  // Edit form
  const [editForm, setEditForm] = useState({
    name: "",
    phase: "",
    description: "",
  });

  // Add member form
  const [addMemberForm, setAddMemberForm] = useState({
    odId: "",
    role: "",
    searchQuery: "",
  });

  // Close project
  const [closeDays, setCloseDays] = useState(30);

  const isAdmin = contextUser?.role === "admin";

  useEffect(() => {
    if (!userLoading && !isAdmin) {
      router.push("/dashboard");
    }
  }, [contextUser, userLoading, router, isAdmin]);

  useEffect(() => {
    if (projectId && isAdmin) loadData();
  }, [projectId, isAdmin]);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    try {
      setLoading(true);

      // Project info
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
        };
      });
      setMembers(membersData);

      // Departments - cargar del documento del proyecto (array departments)
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (projectDoc.exists()) {
        const projectData = projectDoc.data();
        const depts = projectData.departments || [];
        const deptsWithCount = depts.map((deptName: string) => ({
          id: deptName,
          name: deptName,
          color: "#6B7280",
          memberCount: membersData.filter((m) => m.department === deptName).length,
        }));
        setDepartments(deptsWithCount);
      }

      // All users for adding members
      const usersSnap = await getDocs(collection(db, "users"));
      const usersData = usersSnap.docs.map((userDoc) => ({
        id: userDoc.id,
        name: userDoc.data().name,
        email: userDoc.data().email,
      }));
      setAllUsers(usersData);

      setLoading(false);
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error al cargar los datos");
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Send message to project members
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

      // Send to each member
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

  // Update project
  const handleUpdateProject = async () => {
    if (!editForm.name.trim()) {
      showToast("error", "El nombre es obligatorio");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "projects", projectId), {
        name: editForm.name.trim(),
        phase: editForm.phase,
        description: editForm.description.trim(),
      });
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

  // Initiate project closure
  const handleInitiateClose = async () => {
    setSaving(true);
    try {
      const closingDate = new Date();
      closingDate.setDate(closingDate.getDate() + closeDays);

      await updateDoc(doc(db, "projects", projectId), {
        closingAt: Timestamp.fromDate(closingDate),
        closingInitiatedBy: contextUser?.uid,
      });

      // Send notification to all members
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
        const messageRef = doc(collection(db, `users/${member.id}/messages`));
        await setDoc(messageRef, messageData);
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

  // Cancel project closure
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

  // Remove member
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

  // Add member
  const handleAddMember = async () => {
    if (!addMemberForm.odId || !addMemberForm.role) {
      showToast("error", "Selecciona usuario y rol");
      return;
    }

    const selectedUser = allUsers.find((u) => u.id === addMemberForm.odId);
    if (!selectedUser) return;

    // Check if already member
    if (members.find((m) => m.id === addMemberForm.odId)) {
      showToast("error", "Este usuario ya es miembro");
      return;
    }

    setSaving(true);
    try {
      const memberData = {
        odId: addMemberForm.odId,
        name: selectedUser.name,
        email: selectedUser.email,
        role: addMemberForm.role,
        permissions: {
          config: ["EP", "PM"].includes(addMemberForm.role),
          accounting: ["EP", "PM", "Controller", "PC"].includes(addMemberForm.role),
          team: ["EP", "PM"].includes(addMemberForm.role),
        },
        addedAt: serverTimestamp(),
        addedBy: contextUser?.uid,
      };

      await setDoc(doc(db, `projects/${projectId}/members`, addMemberForm.odId), memberData);

      await setDoc(doc(db, `userProjects/${addMemberForm.odId}/projects`, projectId), {
        projectId,
        role: addMemberForm.role,
        permissions: memberData.permissions,
        addedAt: serverTimestamp(),
      });

      setAddMemberForm({ odId: "", role: "", searchQuery: "" });
      setShowAddMemberModal(false);
      showToast("success", "Miembro añadido");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al añadir miembro");
    } finally {
      setSaving(false);
    }
  };

  // Calculate days until closing
  const getDaysUntilClose = () => {
    if (!project?.closingAt) return null;
    const now = new Date();
    const closeDate = project.closingAt.toDate();
    const diffTime = closeDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const filteredUsersForAdd = allUsers.filter(
    (u) =>
      !members.find((m) => m.id === u.id) &&
      (u.name.toLowerCase().includes(addMemberForm.searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(addMemberForm.searchQuery.toLowerCase()))
  );

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
          {/* Breadcrumb */}
          <div className="mb-6">
            <Link
              href="/admindashboard"
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft size={14} />
              Volver a Administración
            </Link>
          </div>

          {/* Title row */}
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
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-6">
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

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-6 mb-8 text-sm">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <span className="text-slate-600">{members.length} miembros</span>
          </div>
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-slate-400" />
            <span className="text-slate-600">{departments.length} departamentos</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Project Info */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Información</h2>
                <button
                  onClick={() => setShowEditModal(true)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  <Edit2 size={14} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Nombre</p>
                  <p className="text-sm font-medium text-slate-900">{project.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Fase</p>
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-lg ${phase.bg} ${phase.text}`}>
                    {project.phase}
                  </span>
                </div>
                {project.description && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Descripción</p>
                    <p className="text-sm text-slate-600">{project.description}</p>
                  </div>
                )}
                {project.producerNames && project.producerNames.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Productoras</p>
                    <p className="text-sm text-slate-600">{project.producerNames.join(", ")}</p>
                  </div>
                )}
              </div>

              {/* Danger zone */}
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
                <p className="text-xs font-medium text-slate-500 mb-3">Zona de peligro</p>
                {daysUntilClose === null ? (
                  <button
                    onClick={() => setShowCloseModal(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-medium hover:bg-red-100"
                  >
                    <Clock size={14} />
                    Programar cierre
                  </button>
                ) : (
                  <p className="text-xs text-slate-500 text-center">Cierre ya programado</p>
                )}
              </div>
            </div>
          </div>

          {/* Members */}
          <div className="lg:col-span-2">
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">Miembros</h2>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    {members.length}
                  </span>
                </div>
                <button
                  onClick={() => setShowAddMemberModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800"
                >
                  <UserPlus size={12} />
                  Añadir
                </button>
              </div>

              {members.length === 0 ? (
                <div className="p-12 text-center">
                  <Users size={24} className="text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No hay miembros</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {members.map((member) => (
                    <div key={member.id} className="px-5 py-3 flex items-center justify-between hover:bg-slate-50">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-600 text-sm font-medium">
                          {member.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{member.name}</p>
                          <p className="text-xs text-slate-500">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {member.role && (
                          <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded">
                            {member.role}
                          </span>
                        )}
                        {member.department && (
                          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                            {member.department}
                          </span>
                        )}
                        {member.permissions.accounting && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">
                            Accounting
                          </span>
                        )}
                        <button
                          onClick={() => handleRemoveMember(member.id, member.name)}
                          disabled={saving}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Departments */}
            {departments.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden mt-6">
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-900">Departamentos</h2>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      {departments.length}
                    </span>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex flex-wrap gap-2">
                    {departments.map((dept) => (
                      <div
                        key={dept.id}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                      >
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: dept.color }}
                        />
                        <span className="text-sm text-slate-700">{dept.name}</span>
                        <span className="text-xs text-slate-400">{dept.memberCount}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Send Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Enviar mensaje al equipo</h3>
              <button
                onClick={() => setShowMessageModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Type */}
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
                          isSelected
                            ? `bg-${type.color}-50 border-${type.color}-200 text-${type.color}-700`
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
                <label className="block text-sm font-medium text-slate-700 mb-2">Título</label>
                <input
                  type="text"
                  value={messageForm.title}
                  onChange={(e) => setMessageForm({ ...messageForm, title: e.target.value })}
                  placeholder="Asunto del mensaje"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Mensaje</label>
                <textarea
                  value={messageForm.content}
                  onChange={(e) => setMessageForm({ ...messageForm, content: e.target.value })}
                  placeholder="Escribe tu mensaje..."
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm resize-none"
                />
              </div>

              <p className="text-xs text-slate-500">
                Se enviará a {members.length} miembro{members.length !== 1 ? "s" : ""} del proyecto
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button
                onClick={() => setShowMessageModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
              >
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
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
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
                          editForm.phase === p
                            ? `${pConfig.bg} ${pConfig.text} border-current`
                            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
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
                onClick={() => setShowEditModal(false)}
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
              <button
                onClick={() => setShowCloseModal(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
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
                      El proyecto y todos sus datos se eliminarán permanentemente después del período de gracia. Se notificará a todos los miembros.
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
                        closeDays === days
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
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
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
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
      {showAddMemberModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Añadir miembro</h3>
              <button
                onClick={() => {
                  setShowAddMemberModal(false);
                  setAddMemberForm({ odId: "", role: "", searchQuery: "" });
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Search user */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Usuario</label>
                <input
                  type="text"
                  value={addMemberForm.searchQuery}
                  onChange={(e) => setAddMemberForm({ ...addMemberForm, searchQuery: e.target.value, odId: "" })}
                  placeholder="Buscar por nombre o email..."
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                {addMemberForm.searchQuery && (
                  <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                    {filteredUsersForAdd.length === 0 ? (
                      <p className="p-3 text-sm text-slate-500 text-center">No se encontraron usuarios</p>
                    ) : (
                      filteredUsersForAdd.slice(0, 5).map((user) => (
                        <button
                          key={user.id}
                          onClick={() =>
                            setAddMemberForm({ ...addMemberForm, odId: user.id, searchQuery: user.name })
                          }
                          className={`w-full px-3 py-2 text-left hover:bg-slate-50 ${
                            addMemberForm.odId === user.id ? "bg-slate-50" : ""
                          }`}
                        >
                          <p className="text-sm font-medium text-slate-900">{user.name}</p>
                          <p className="text-xs text-slate-500">{user.email}</p>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Rol</label>
                <div className="grid grid-cols-3 gap-2">
                  {PROJECT_ROLES.map((role) => (
                    <button
                      key={role}
                      onClick={() => setAddMemberForm({ ...addMemberForm, role })}
                      className={`px-3 py-2 rounded-xl border text-sm font-medium ${
                        addMemberForm.role === role
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
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
                onClick={() => {
                  setShowAddMemberModal(false);
                  setAddMemberForm({ odId: "", role: "", searchQuery: "" });
                }}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddMember}
                disabled={saving || !addMemberForm.odId || !addMemberForm.role}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Añadiendo..." : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
