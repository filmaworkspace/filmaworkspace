"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  CheckCircle,
  ChevronDown,
  Clock,
  Edit,
  Mail,
  MoreHorizontal,
  Search,
  Settings,
  Shield,
  Trash2,
  UserCog,
  UserPlus,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];
const DEPARTMENT_POSITIONS = ["HOD", "Coordinator", "Crew"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
}

interface PendingInvitation {
  id: string;
  invitedEmail: string;
  invitedName: string;
  roleType: "project" | "department";
  role?: string;
  department?: string;
  position?: string;
}

interface Department {
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ConfigUsers() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [hasConfigAccess, setHasConfigAccess] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [foundUser, setFoundUser] = useState<{ name: string; email: string } | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editPermissions, setEditPermissions] = useState({ config: false, accounting: false, team: false });
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    roleType: "project" as "project" | "department",
    role: "",
    department: "",
    position: "",
    permissions: { config: false, accounting: false, team: false }
  });

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(event.target as Node)) {
        setDepartmentDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) router.push("/");
      else {
        setUserId(u.uid);
        setUserName(u.displayName || u.email || "Usuario");
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
        if (!userProjectSnap.exists()) { setLoading(false); return; }
        const hasConfig = userProjectSnap.data().permissions?.config || false;
        setHasConfigAccess(hasConfig);
        if (!hasConfig) { setLoading(false); return; }

        const projectSnap = await getDoc(doc(db, "projects", id as string));
        if (projectSnap.exists()) {
          setProjectName(projectSnap.data().name);
          setDepartments((projectSnap.data().departments || []).map((d: string) => ({ name: d })));
        }

        const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
        setMembers(membersSnap.docs.map((d) => ({
          userId: d.id,
          name: d.data().name,
          email: d.data().email,
          role: d.data().role,
          department: d.data().department,
          position: d.data().position,
          permissions: d.data().permissions || { config: false, accounting: false, team: false }
        })));

        const invSnap = await getDocs(query(collection(db, "invitations"), where("projectId", "==", id), where("status", "==", "pending")));
        setPendingInvitations(invSnap.docs.map((d) => ({
          id: d.id,
          invitedEmail: d.data().invitedEmail,
          invitedName: d.data().invitedName,
          roleType: d.data().roleType || "project",
          role: d.data().role,
          department: d.data().department,
          position: d.data().position
        })));
        setLoading(false);
      } catch { showToast("error", "Error al cargar"); setLoading(false); }
    };
    loadData();
  }, [userId, id, router]);

  useEffect(() => {
    const checkUser = async () => {
      if (!inviteForm.email || inviteForm.email.length < 3) { setUserExists(null); setFoundUser(null); return; }
      try {
        const snap = await getDocs(query(collection(db, "users"), where("email", "==", inviteForm.email.toLowerCase().trim())));
        if (!snap.empty) {
          const d = snap.docs[0].data();
          setUserExists(true);
          setFoundUser({ name: d.name || d.email, email: d.email });
          setInviteForm((p) => ({ ...p, name: d.name || d.email }));
        } else { setUserExists(false); setFoundUser(null); }
      } catch {}
    };
    const t = setTimeout(checkUser, 500);
    return () => clearTimeout(t);
  }, [inviteForm.email]);

  const handleSendInvitation = async () => {
    if (!id || !inviteForm.email.trim() || !inviteForm.name.trim()) { showToast("error", "Email y nombre requeridos"); return; }
    if (inviteForm.roleType === "department" && (!inviteForm.department || !inviteForm.position)) { showToast("error", "Selecciona departamento y posición"); return; }
    if (inviteForm.roleType === "project" && !inviteForm.role) { showToast("error", "Selecciona un rol"); return; }
    setSaving(true);
    try {
      const email = inviteForm.email.trim().toLowerCase();
      if (members.find((m) => m.email === email)) { showToast("error", "Ya es usuario del proyecto"); setSaving(false); return; }
      if (pendingInvitations.find((i) => i.invitedEmail === email)) { showToast("error", "Invitación pendiente"); setSaving(false); return; }

      const usersSnap = await getDocs(query(collection(db, "users"), where("email", "==", email)));
      const inviteData: any = {
        projectId: id, projectName, invitedEmail: email, invitedName: inviteForm.name.trim(),
        invitedUserId: usersSnap.empty ? null : usersSnap.docs[0].id,
        invitedBy: userId, invitedByName: userName, status: "pending",
        createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        roleType: inviteForm.roleType
      };

      if (inviteForm.roleType === "project") {
        inviteData.role = inviteForm.role;
        inviteData.permissions = { config: inviteForm.permissions.config, accounting: inviteForm.permissions.accounting, team: inviteForm.permissions.team };
        if (inviteForm.permissions.accounting) {
          inviteData.accountingAccessLevel = "accounting_extended";
        }
      } else {
        inviteData.department = inviteForm.department;
        inviteData.position = inviteForm.position;
        inviteData.permissions = { config: inviteForm.permissions.config, accounting: inviteForm.permissions.accounting, team: inviteForm.permissions.team };
        if (inviteForm.permissions.accounting) {
          inviteData.accountingAccessLevel = "accounting_extended";
        }
      }

      await setDoc(doc(collection(db, "invitations")), inviteData);

      // Send invitation email (fire-and-forget)
      fetch("/api/send-project-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteeName:   inviteData.invitedName,
          invitedByName: inviteData.invitedByName,
          invitedEmail:  email,
          projectName:   inviteData.projectName,
          projectId:     id,
          role:          inviteData.role ?? inviteData.position ?? "",
          isExistingUser: inviteData.invitedUserId !== null,
        }),
      }).catch(console.error);

      showToast("success", "Invitación enviada");

      const invSnap = await getDocs(query(collection(db, "invitations"), where("projectId", "==", id), where("status", "==", "pending")));
      setPendingInvitations(invSnap.docs.map((d) => ({ id: d.id, invitedEmail: d.data().invitedEmail, invitedName: d.data().invitedName, roleType: d.data().roleType || "project", role: d.data().role, department: d.data().department, position: d.data().position })));
      closeModal();
    } catch { showToast("error", "Error al enviar"); } finally { setSaving(false); }
  };

  const handleCancelInvitation = async (invId: string) => {
    try {
      await deleteDoc(doc(db, "invitations", invId));
      setPendingInvitations(pendingInvitations.filter((i) => i.id !== invId));
      showToast("success", "Invitación cancelada");
    } catch { showToast("error", "Error"); }
  };

  const handleRemoveMember = async (memberId: string) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${id}/members`, memberId));
      await deleteDoc(doc(db, `userProjects/${memberId}/projects`, id as string));
      setMembers(members.filter((m) => m.userId !== memberId));
      showToast("success", "Usuario eliminado");
    } catch { showToast("error", "Error"); } finally { setSaving(false); setActiveMenu(null); }
  };

  const openEditPermissions = (member: Member) => {
    setEditingMember(member);
    setEditPermissions({ ...member.permissions });
    setActiveMenu(null);
  };

  const handleUpdatePermissions = async () => {
    if (!editingMember) return;
    setSaving(true);
    try {
      const updateData: any = { permissions: editPermissions };
      if (editPermissions.accounting) {
        updateData.accountingAccessLevel = "accounting_extended";
      } else {
        updateData.accountingAccessLevel = null;
      }
      await updateDoc(doc(db, `projects/${id}/members`, editingMember.userId), updateData);
      await updateDoc(doc(db, `userProjects/${editingMember.userId}/projects`, id as string), updateData);
      setMembers(members.map((m) => 
        m.userId === editingMember.userId ? { ...m, permissions: editPermissions } : m
      ));
      showToast("success", "Permisos actualizados");
      setEditingMember(null);
    } catch { 
      showToast("error", "Error al actualizar permisos"); 
    } finally { 
      setSaving(false); 
    }
  };

  const closeModal = () => {
    setShowInviteModal(false);
    setInviteForm({ email: "", name: "", roleType: "project", role: "", department: "", position: "", permissions: { config: false, accounting: false, team: false } });
    setUserExists(null); setFoundUser(null);
  };

  const filteredMembers = members.filter((m) => m.name.toLowerCase().includes(searchTerm.toLowerCase()) || m.email.toLowerCase().includes(searchTerm.toLowerCase()));
  const projectMembers = filteredMembers.filter((m) => PROJECT_ROLES.includes(m.role || ""));
  const deptMembers = filteredMembers.filter((m) => !PROJECT_ROLES.includes(m.role || "") && m.department);

  if (loading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasConfigAccess) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={28} className="text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">No tienes acceso a esta configuración</p>
        <Link href="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
          <ArrowLeft size={16} />
          Volver a Proyectos
        </Link>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Toast - bottom right */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 ${toast.type === "success" ? "bg-slate-900 text-white" : "bg-red-600 text-white"}`}>
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <UserCog size={24} className="text-slate-900" />
              <h1 className="text-2xl font-semibold text-slate-900">Usuarios del proyecto</h1>
            </div>
      
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors bg-slate-900"
            >
              <UserPlus size={16} strokeWidth={2.5} />
              Invitar
            </button>
          </div>
        </div>
      </div>
      
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8 space-y-6">
        {/* Pending Invitations */}
        {pendingInvitations.length > 0 && (
          <div className="rounded-2xl p-6" style={{ background: 'linear-gradient(to right, #0f172a, #334155)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Mail size={18} className="text-white" />
              </div>
              <h2 className="text-base font-semibold text-white">
                {pendingInvitations.length} invitación{pendingInvitations.length !== 1 ? "es" : ""} pendiente{pendingInvitations.length !== 1 ? "s" : ""}
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between bg-white rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                      {inv.invitedName?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{inv.invitedName}</p>
                      <p className="text-xs text-slate-500">{inv.roleType === "project" ? inv.role : `${inv.position} · ${inv.department}`}</p>
                    </div>
                  </div>
                  <button onClick={() => handleCancelInvitation(inv.id)} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200">
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        {members.length > 0 && (
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar usuario"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
            />
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Project Roles */}
          {projectMembers.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-visible flex-1 lg:max-w-[50%]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                <Shield size={18} className="text-slate-400" />
                <h3 className="font-semibold text-slate-900">Roles de proyecto</h3>
                <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{projectMembers.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {projectMembers.map((m) => {
                  return (
                    <div key={m.userId} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                          {m.name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{m.name}</p>
                            <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">
                              {m.role}
                            </span>
                            {m.userId === userId && <span className="text-xs text-slate-400">(tú)</span>}
                          </div>
                          <p className="text-sm text-slate-500">{m.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {m.permissions.config && (
                            <span className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-100 text-slate-600">
                              CFG
                            </span>
                          )}
                          {m.permissions.accounting && (
                            <span 
                              className="px-2 py-1 text-[10px] font-bold rounded-lg border"
                              style={{ backgroundColor: 'rgba(47, 82, 224, 0.1)', color: '#2F52E0', borderColor: 'rgba(47, 82, 224, 0.2)' }}
                            >
                              ACC
                            </span>
                          )}
                          {m.permissions.team && (
                            <span 
                              className="px-2 py-1 text-[10px] font-bold rounded-lg border"
                              style={{ backgroundColor: 'rgba(137, 211, 34, 0.15)', color: '#6BA319', borderColor: 'rgba(137, 211, 34, 0.3)' }}
                            >
                              TEAM
                            </span>
                          )}
                        </div>
                        {m.userId !== userId && (
                          <div className="relative">
                            <button onClick={() => setActiveMenu(activeMenu === m.userId ? null : m.userId)} className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors opacity-0 group-hover:opacity-100">
                              <MoreHorizontal size={16} />
                            </button>
                            {activeMenu === m.userId && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setActiveMenu(null)} />
                                <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl py-1.5 z-20">
                                  <button onClick={() => openEditPermissions(m)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                    <Settings size={14} />
                                    Editar permisos
                                  </button>
                                  <div className="border-t border-slate-100 my-1" />
                                  <button onClick={() => handleRemoveMember(m.userId)} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                    <Trash2 size={14} />
                                    Eliminar
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Department Members */}
          {deptMembers.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-visible flex-1 lg:max-w-[50%]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                <Briefcase size={18} className="text-slate-400" />
                <h3 className="font-semibold text-slate-900">Departamentos</h3>
                <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{deptMembers.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {deptMembers.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-sm">
                        {m.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-slate-900">{m.name}</p>
                          <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">
                            {m.position}
                          </span>
                          <span className="text-xs text-slate-400">{m.department}</span>
                          {m.userId === userId && <span className="text-xs text-slate-400">(tú)</span>}
                        </div>
                        <p className="text-sm text-slate-500">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        {m.permissions.config && (
                          <span className="px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-100 text-slate-600">
                            CFG
                          </span>
                        )}
                        {m.permissions.accounting && (
                          <span 
                            className="px-2 py-1 text-[10px] font-bold rounded-lg border"
                            style={{ backgroundColor: 'rgba(47, 82, 224, 0.1)', color: '#2F52E0', borderColor: 'rgba(47, 82, 224, 0.2)' }}
                          >
                            ACC
                          </span>
                        )}
                        {m.permissions.team && (
                          <span 
                            className="px-2 py-1 text-[10px] font-bold rounded-lg border"
                            style={{ backgroundColor: 'rgba(137, 211, 34, 0.15)', color: '#6BA319', borderColor: 'rgba(137, 211, 34, 0.3)' }}
                          >
                            TEAM
                          </span>
                        )}
                      </div>
                      {m.userId !== userId && (
                        <div className="relative">
                          <button onClick={() => setActiveMenu(activeMenu === m.userId ? null : m.userId)} className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors opacity-0 group-hover:opacity-100">
                            <MoreHorizontal size={16} />
                          </button>
                          {activeMenu === m.userId && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setActiveMenu(null)} />
                              <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl py-1.5 z-20">
                                <button onClick={() => openEditPermissions(m)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                  <Settings size={14} />
                                  Editar permisos
                                </button>
                                <div className="border-t border-slate-100 my-1" />
                                <button onClick={() => handleRemoveMember(m.userId)} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                                  <Trash2 size={14} />
                                  Eliminar
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Empty State */}
        {filteredMembers.length === 0 && (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <UserCog size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{searchTerm ? "Sin resultados" : "Sin usuarios"}</h3>
            <p className="text-slate-500 text-sm">{searchTerm ? "Prueba con otro término" : "Invita al primer usuario del equipo"}</p>
          </div>
        )}
      </main>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Invitar usuario</h3>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Email</label>
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm"
                />
                {userExists === true && <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={12} />Usuario registrado</p>}
                {userExists === false && inviteForm.email.length > 3 && <p className="mt-2 text-xs text-amber-600 flex items-center gap-1"><Clock size={12} />Se enviará invitación para registrarse</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Nombre</label>
                <input
                  type="text"
                  value={inviteForm.name}
                  onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                  disabled={userExists === true}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm disabled:bg-slate-100 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Tipo</label>
                <div className="flex gap-2">
                  <button onClick={() => setInviteForm({ ...inviteForm, roleType: "project", department: "", position: "" })} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${inviteForm.roleType === "project" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    Proyecto
                  </button>
                  <button onClick={() => setInviteForm({ ...inviteForm, roleType: "department", role: "" })} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-all ${inviteForm.roleType === "department" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                    Departamento
                  </button>
                </div>
              </div>
              {inviteForm.roleType === "project" && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Rol</label>
                  <div className="flex gap-2">
                    {PROJECT_ROLES.map((r) => {
                      const isSelected = inviteForm.role === r;
                      return (
                        <button key={r} onClick={() => setInviteForm({ ...inviteForm, role: r })} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${isSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {r}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {inviteForm.roleType === "department" && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Departamento</label>
                    <div className="relative" ref={departmentDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setDepartmentDropdownOpen(!departmentDropdownOpen)}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                      >
                        <span className={inviteForm.department ? "text-slate-900" : "text-slate-400"}>
                          {inviteForm.department || "Seleccionar"}
                        </span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${departmentDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {departmentDropdownOpen && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {departments.length > 0 ? (
                            departments.map((d) => (
                              <button
                                key={d.name}
                                type="button"
                                onClick={() => {
                                  setInviteForm({ ...inviteForm, department: d.name });
                                  setDepartmentDropdownOpen(false);
                                }}
                                className={`w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors ${inviteForm.department === d.name ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600"}`}
                              >
                                {d.name}
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-sm text-slate-400 text-center">Sin departamentos</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Posición</label>
                    <div className="flex gap-2">
                      {DEPARTMENT_POSITIONS.map((p) => (
                        <button key={p} onClick={() => setInviteForm({ ...inviteForm, position: p })} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${inviteForm.position === p ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Permisos</label>
                <div className="flex gap-2">
                  <label 
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border cursor-pointer transition-all ${inviteForm.permissions.config ? "border-slate-400 bg-slate-100" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <input type="checkbox" checked={inviteForm.permissions.config} onChange={(e) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, config: e.target.checked } })} className="sr-only" />
                    <Shield size={14} className={inviteForm.permissions.config ? "text-slate-600" : "text-slate-400"} />
                    <span className={`text-sm font-medium ${inviteForm.permissions.config ? "text-slate-700" : "text-slate-500"}`}>Config</span>
                  </label>
                  <label 
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border cursor-pointer transition-all ${inviteForm.permissions.accounting ? "border-[#2F52E0]/40 bg-[#2F52E0]/10" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <input type="checkbox" checked={inviteForm.permissions.accounting} onChange={(e) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, accounting: e.target.checked } })} className="sr-only" />
                    <span className={`text-sm font-medium ${inviteForm.permissions.accounting ? "text-[#2F52E0]" : "text-slate-500"}`}>Accounting</span>
                  </label>
                  <label 
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border cursor-pointer transition-all ${inviteForm.permissions.team ? "border-[#6BA319]/40 bg-[#6BA319]/10" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <input type="checkbox" checked={inviteForm.permissions.team} onChange={(e) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, team: e.target.checked } })} className="sr-only" />
                    <span className={`text-sm font-medium ${inviteForm.permissions.team ? "text-[#6BA319]" : "text-slate-500"}`}>Team</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50">
              <button onClick={closeModal} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors border border-slate-200">
                Cancelar
              </button>
              <button onClick={handleSendInvitation} disabled={saving} className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? "Enviando..." : "Enviar invitación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Permissions Modal */}
      {editingMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Editar permisos</h3>
                <p className="text-sm text-slate-500">{editingMember.name}</p>
              </div>
              <button onClick={() => setEditingMember(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4">Selecciona los permisos para este usuario:</p>
              <div className="space-y-3">
                <label className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${editPermissions.config ? "bg-slate-100 border-slate-300" : "bg-white border-slate-200 hover:bg-slate-50"}`}>
                  <input 
                    type="checkbox" 
                    checked={editPermissions.config} 
                    onChange={(e) => setEditPermissions({ ...editPermissions, config: e.target.checked })} 
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">Config</p>
                    <p className="text-xs text-slate-500">Configuración del proyecto</p>
                  </div>
                </label>
                <label 
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all`}
                  style={editPermissions.accounting ? { backgroundColor: 'rgba(47, 82, 224, 0.1)', borderColor: 'rgba(47, 82, 224, 0.3)' } : {}}
                >
                  <input 
                    type="checkbox" 
                    checked={editPermissions.accounting} 
                    onChange={(e) => setEditPermissions({ ...editPermissions, accounting: e.target.checked })} 
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div className="flex-1">
                    <p className="font-medium" style={editPermissions.accounting ? { color: '#2F52E0' } : { color: '#0f172a' }}>Accounting</p>
                    <p className="text-xs text-slate-500">Acceso a contabilidad</p>
                  </div>
                </label>
                <label 
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all`}
                  style={editPermissions.team ? { backgroundColor: 'rgba(137, 211, 34, 0.15)', borderColor: 'rgba(137, 211, 34, 0.4)' } : {}}
                >
                  <input 
                    type="checkbox" 
                    checked={editPermissions.team} 
                    onChange={(e) => setEditPermissions({ ...editPermissions, team: e.target.checked })} 
                    className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <div className="flex-1">
                    <p className="font-medium" style={editPermissions.team ? { color: '#6BA319' } : { color: '#0f172a' }}>Team</p>
                    <p className="text-xs text-slate-500">Gestión del equipo</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50">
              <button onClick={() => setEditingMember(null)} className="flex-1 py-2.5 text-slate-600 hover:bg-slate-200 rounded-xl text-sm font-medium transition-colors border border-slate-200">
                Cancelar
              </button>
              <button onClick={handleUpdatePermissions} disabled={saving} className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
