"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { UserCog, UserPlus, Search, Trash2, Shield, X, AlertCircle, CheckCircle2, UserCheck, UserX, Clock, Info, Edit, Building2, Users } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, getDocs, setDoc, deleteDoc, updateDoc, query, where, Timestamp } from "firebase/firestore";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];
const DEPARTMENT_POSITIONS = ["HOD", "Coordinator", "Crew"];

const ACCOUNTING_ACCESS_LEVELS = {
  visitor: { label: "Visitante", description: "Solo lectura del panel principal", permissions: { panel: true, suppliers: false, budget: false, users: false, reports: false }, color: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  user: { label: "Usuario", description: "Panel y Proveedores", permissions: { panel: true, suppliers: true, budget: false, users: false, reports: false }, color: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  accounting: { label: "Contabilidad", description: "Panel, Proveedores e Informes", permissions: { panel: true, suppliers: true, budget: false, users: false, reports: true }, color: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  accounting_extended: { label: "Contabilidad ampliada", description: "Acceso completo", permissions: { panel: true, suppliers: true, budget: true, users: true, reports: true }, color: "bg-purple-50 text-purple-700", dot: "bg-purple-500" },
};

interface Member { userId: string; name: string; email: string; role?: string; department?: string; position?: string; permissions: { config: boolean; accounting: boolean; team: boolean }; accountingAccessLevel?: "visitor" | "user" | "accounting" | "accounting_extended"; addedAt: any; addedBy?: string; addedByName?: string; }
interface PendingInvitation { id: string; invitedEmail: string; invitedName: string; roleType: "project" | "department"; role?: string; department?: string; position?: string; status: string; createdAt: any; invitedBy: string; invitedByName: string; accountingAccessLevel?: "visitor" | "user" | "accounting" | "accounting_extended"; }
interface Department { name: string; }

export default function AccountingUsersPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [hasAccountingAccess, setHasAccountingAccess] = useState(false);
  const [isProjectRole, setIsProjectRole] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [accountingMembers, setAccountingMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditAccessModal, setShowEditAccessModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [foundUser, setFoundUser] = useState<{ name: string; email: string } | null>(null);

  const [inviteForm, setInviteForm] = useState({
    email: "", name: "", roleType: "project" as "project" | "department", role: "", department: "", position: "",
    accountingAccessLevel: "user" as "visitor" | "user" | "accounting" | "accounting_extended",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
      else { setUserId(user.uid); setUserName(user.displayName || user.email || "Usuario"); }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
        const userProjectSnap = await getDoc(userProjectRef);
        if (!userProjectSnap.exists()) { setErrorMessage("No tienes acceso a este proyecto"); setLoading(false); return; }
        const userProjectData = userProjectSnap.data();
        const hasAccounting = userProjectData.permissions?.accounting || false;
        setHasAccountingAccess(hasAccounting);
        if (!hasAccounting) { setErrorMessage("No tienes permisos para acceder a contabilidad"); setLoading(false); return; }

        const memberRef = doc(db, `projects/${id}/members/${userId}`);
        const memberSnap = await getDoc(memberRef);
        if (memberSnap.exists()) { const memberData = memberSnap.data(); setIsProjectRole(PROJECT_ROLES.includes(memberData.role || "")); }

        const projectRef = doc(db, "projects", id as string);
        const projectSnap = await getDoc(projectRef);
        if (projectSnap.exists()) { const projectData = projectSnap.data(); setProjectName(projectData.name); const depts = projectData.departments || []; setDepartments(depts.map((d: string) => ({ name: d }))); }

        const membersRef = collection(db, `projects/${id}/members`);
        const membersSnap = await getDocs(membersRef);
        const membersData: Member[] = membersSnap.docs.map((memberDoc) => {
          const data = memberDoc.data();
          return { userId: memberDoc.id, name: data.name, email: data.email, role: data.role, department: data.department, position: data.position, permissions: data.permissions || { config: false, accounting: false, team: false }, accountingAccessLevel: data.accountingAccessLevel || "user", addedAt: data.addedAt, addedBy: data.addedBy, addedByName: data.addedByName };
        });
        setMembers(membersData);
        setAccountingMembers(membersData.filter((m) => m.permissions.accounting));

        const invitationsRef = collection(db, "invitations");
        const q = query(invitationsRef, where("projectId", "==", id), where("status", "==", "pending"));
        const invitationsSnap = await getDocs(q);
        const invitationsData: PendingInvitation[] = invitationsSnap.docs.map((invDoc) => {
          const data = invDoc.data();
          return { id: invDoc.id, invitedEmail: data.invitedEmail, invitedName: data.invitedName, roleType: data.roleType || "project", role: data.role, department: data.department, position: data.position, status: data.status, createdAt: data.createdAt, invitedBy: data.invitedBy, invitedByName: data.invitedByName, permissions: data.permissions, accountingAccessLevel: data.accountingAccessLevel || "user" };
        }).filter((inv: any) => inv.permissions?.accounting === true);
        setPendingInvitations(invitationsData);
        setLoading(false);
      } catch (error) { console.error("Error cargando datos:", error); setErrorMessage("Error al cargar los datos"); setLoading(false); }
    };
    loadData();
  }, [userId, id, router]);

  useEffect(() => {
    const checkUserExists = async () => {
      if (!inviteForm.email || inviteForm.email.length < 3) { setUserExists(null); setFoundUser(null); return; }
      try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", inviteForm.email.toLowerCase().trim()));
        const usersSnap = await getDocs(q);
        if (!usersSnap.empty) { const userData = usersSnap.docs[0].data(); setUserExists(true); setFoundUser({ name: userData.name || userData.email, email: userData.email }); setInviteForm((prev) => ({ ...prev, name: userData.name || userData.email })); }
        else { setUserExists(false); setFoundUser(null); }
      } catch (error) { console.error("Error buscando usuario:", error); }
    };
    const debounce = setTimeout(() => checkUserExists(), 500);
    return () => clearTimeout(debounce);
  }, [inviteForm.email]);

  const handleSendInvitation = async () => {
    if (!id || !inviteForm.email.trim() || !inviteForm.name.trim()) { setErrorMessage("Email y nombre son obligatorios"); setTimeout(() => setErrorMessage(""), 3000); return; }
    if (inviteForm.roleType === "department" && (!inviteForm.department || !inviteForm.position)) { setErrorMessage("Debes seleccionar departamento y posición"); setTimeout(() => setErrorMessage(""), 3000); return; }
    if (inviteForm.roleType === "project" && !inviteForm.role) { setErrorMessage("Debes seleccionar un rol de proyecto"); setTimeout(() => setErrorMessage(""), 3000); return; }
    setSaving(true); setErrorMessage("");
    try {
      const email = inviteForm.email.trim().toLowerCase();
      const existingMember = accountingMembers.find((m) => m.email === email);
      if (existingMember) { setErrorMessage("Este usuario ya tiene acceso a contabilidad"); setSaving(false); setTimeout(() => setErrorMessage(""), 3000); return; }
      const memberWithoutAccounting = members.find((m) => m.email === email && !m.permissions.accounting);
      if (memberWithoutAccounting) {
        await updateDoc(doc(db, `projects/${id}/members`, memberWithoutAccounting.userId), { "permissions.accounting": true, accountingAccessLevel: inviteForm.accountingAccessLevel });
        await updateDoc(doc(db, `userProjects/${memberWithoutAccounting.userId}/projects`, id as string), { "permissions.accounting": true, accountingAccessLevel: inviteForm.accountingAccessLevel });
        setSuccessMessage(`Permiso de contabilidad añadido a ${memberWithoutAccounting.name}`); setTimeout(() => setSuccessMessage(""), 3000);
        const membersRef = collection(db, `projects/${id}/members`);
        const membersSnap = await getDocs(membersRef);
        const membersData: Member[] = membersSnap.docs.map((memberDoc) => { const data = memberDoc.data(); return { userId: memberDoc.id, name: data.name, email: data.email, role: data.role, department: data.department, position: data.position, permissions: data.permissions || { config: false, accounting: false, team: false }, accountingAccessLevel: data.accountingAccessLevel || "user", addedAt: data.addedAt, addedBy: data.addedBy, addedByName: data.addedByName }; });
        setMembers(membersData); setAccountingMembers(membersData.filter((m) => m.permissions.accounting)); setShowInviteModal(false); resetForm(); setSaving(false); return;
      }
      const existingInvite = pendingInvitations.find((inv) => inv.invitedEmail === email);
      if (existingInvite) { setErrorMessage("Ya existe una invitación pendiente para este email"); setSaving(false); setTimeout(() => setErrorMessage(""), 3000); return; }
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email));
      const usersSnap = await getDocs(q);
      let invitedUserId: string | null = null;
      if (!usersSnap.empty) invitedUserId = usersSnap.docs[0].id;
      const inviteData: any = { projectId: id, projectName: projectName, invitedEmail: email, invitedName: inviteForm.name.trim(), invitedUserId: invitedUserId, invitedBy: userId, invitedByName: userName, status: "pending", createdAt: Timestamp.now(), expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), roleType: inviteForm.roleType, accountingAccessLevel: inviteForm.accountingAccessLevel };
      if (inviteForm.roleType === "project") { inviteData.role = inviteForm.role; inviteData.permissions = { config: false, accounting: true, team: false }; }
      else { inviteData.department = inviteForm.department; inviteData.position = inviteForm.position; inviteData.permissions = { config: false, accounting: true, team: false }; }
      await setDoc(doc(collection(db, "invitations")), inviteData);
      setSuccessMessage(`Invitación enviada correctamente a ${inviteForm.name}`); setTimeout(() => setSuccessMessage(""), 3000);
      const invitationsRef = collection(db, "invitations");
      const invQuery = query(invitationsRef, where("projectId", "==", id), where("status", "==", "pending"));
      const invitationsSnap = await getDocs(invQuery);
      const invitationsData: PendingInvitation[] = invitationsSnap.docs.map((invDoc) => { const data = invDoc.data(); return { id: invDoc.id, invitedEmail: data.invitedEmail, invitedName: data.invitedName, roleType: data.roleType || "project", role: data.role, department: data.department, position: data.position, status: data.status, createdAt: data.createdAt, invitedBy: data.invitedBy, invitedByName: data.invitedByName, permissions: data.permissions, accountingAccessLevel: data.accountingAccessLevel || "user" }; }).filter((inv: any) => inv.permissions?.accounting === true);
      setPendingInvitations(invitationsData); resetForm(); setShowInviteModal(false);
    } catch (error) { console.error("Error enviando invitación:", error); setErrorMessage("Error al enviar la invitación"); setTimeout(() => setErrorMessage(""), 3000); } finally { setSaving(false); }
  };

  const handleUpdateAccessLevel = async () => {
    if (!editingMember) return;
    setSaving(true);
    try {
      const newAccessLevel = editingMember.accountingAccessLevel || "user";
      await updateDoc(doc(db, `projects/${id}/members`, editingMember.userId), { accountingAccessLevel: newAccessLevel });
      await updateDoc(doc(db, `userProjects/${editingMember.userId}/projects`, id as string), { accountingAccessLevel: newAccessLevel });
      setAccountingMembers(accountingMembers.map((m) => (m.userId === editingMember.userId ? { ...m, accountingAccessLevel: newAccessLevel } : m)));
      setSuccessMessage("Nivel de acceso actualizado correctamente"); setTimeout(() => setSuccessMessage(""), 3000); setShowEditAccessModal(false); setEditingMember(null);
    } catch (error) { console.error("Error actualizando acceso:", error); setErrorMessage("Error al actualizar el nivel de acceso"); setTimeout(() => setErrorMessage(""), 3000); } finally { setSaving(false); }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!confirm("¿Cancelar esta invitación?")) return;
    try { await deleteDoc(doc(db, "invitations", invitationId)); setPendingInvitations(pendingInvitations.filter((inv) => inv.id !== invitationId)); setSuccessMessage("Invitación cancelada"); setTimeout(() => setSuccessMessage(""), 3000); }
    catch (error) { console.error("Error cancelando invitación:", error); setErrorMessage("Error al cancelar la invitación"); setTimeout(() => setErrorMessage(""), 3000); }
  };

  const handleRemoveAccountingAccess = async (member: Member) => {
    if (!confirm(`¿Quitar acceso a contabilidad de ${member.name || member.email}?`)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${id}/members`, member.userId), { "permissions.accounting": false, accountingAccessLevel: null });
      await updateDoc(doc(db, `userProjects/${member.userId}/projects`, id as string), { "permissions.accounting": false, accountingAccessLevel: null });
      setAccountingMembers(accountingMembers.filter((m) => m.userId !== member.userId));
      setMembers(members.map((m) => (m.userId === member.userId ? { ...m, permissions: { ...m.permissions, accounting: false }, accountingAccessLevel: undefined } : m)));
      setSuccessMessage("Acceso eliminado correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
    } catch (error) { console.error("Error eliminando acceso:", error); setErrorMessage("Error al eliminar el acceso"); setTimeout(() => setErrorMessage(""), 3000); } finally { setSaving(false); }
  };

  const resetForm = () => { setInviteForm({ email: "", name: "", roleType: "project", role: "", department: "", position: "", accountingAccessLevel: "user" }); setUserExists(null); setFoundUser(null); };

  const filteredMembers = accountingMembers.filter((member) => member.name.toLowerCase().includes(searchTerm.toLowerCase()) || member.email.toLowerCase().includes(searchTerm.toLowerCase()));

  const projectRoleMembers = filteredMembers.filter(m => PROJECT_ROLES.includes(m.role || ""));
  const departmentGroups = filteredMembers.filter(m => !PROJECT_ROLES.includes(m.role || "") && m.department).reduce((acc, member) => {
    const dept = member.department || "Sin departamento";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(member);
    return acc;
  }, {} as Record<string, Member[]>);
  const unassignedMembers = filteredMembers.filter(m => !PROJECT_ROLES.includes(m.role || "") && !m.department);

  const getAccessLevelBadge = (level: string | undefined) => {
    const accessLevel = ACCOUNTING_ACCESS_LEVELS[level as keyof typeof ACCOUNTING_ACCESS_LEVELS] || ACCOUNTING_ACCESS_LEVELS.user;
    return <span className={`text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap ${accessLevel.color}`}>{accessLevel.label}</span>;
  };

  const getAccessLevelDot = (level: string | undefined) => {
    const accessLevel = ACCOUNTING_ACCESS_LEVELS[level as keyof typeof ACCOUNTING_ACCESS_LEVELS] || ACCOUNTING_ACCESS_LEVELS.user;
    return <span className={`w-2 h-2 rounded-full ${accessLevel.dot}`}></span>;
  };

  if (loading) { return (<div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" /></div>); }
  if (errorMessage && !hasAccountingAccess) { return (<div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="text-center max-w-md"><AlertCircle size={48} className="mx-auto text-red-500 mb-4" /><p className="text-slate-700 mb-4">{errorMessage}</p><Link href="/dashboard" className="text-slate-900 hover:underline font-medium">Volver al panel principal</Link></div></div>); }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Users size={24} style={{ color: '#2F52E0' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Usuarios</h1>
            </div>
            <button onClick={() => setShowInviteModal(true)} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: '#2F52E0' }}>
              <UserPlus size={16} strokeWidth={2.5} />Dar acceso
            </button>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {/* Messages */}
        {successMessage && (<div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-700"><CheckCircle2 size={20} /><span>{successMessage}</span></div>)}
        {errorMessage && hasAccountingAccess && (<div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700"><AlertCircle size={20} /><span>{errorMessage}</span><button onClick={() => setErrorMessage("")} className="ml-auto"><X size={16} /></button></div>)}

        {/* Pending Invitations */}
        {pendingInvitations.length > 0 && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-center gap-2 mb-3"><Clock size={16} className="text-amber-600" /><h3 className="text-sm font-semibold text-amber-900">Invitaciones pendientes ({pendingInvitations.length})</h3></div>
            <div className="space-y-2">
              {pendingInvitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between bg-white p-3 rounded-lg border border-amber-200">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{inv.invitedName}</p>
                    <p className="text-xs text-slate-500">{inv.invitedEmail}</p>
                    <div className="flex items-center gap-2 mt-1">{getAccessLevelBadge(inv.accountingAccessLevel)}</div>
                  </div>
                  <button onClick={() => handleCancelInvitation(inv.id)} className="ml-3 px-3 py-1.5 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-medium">Cancelar</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Buscar usuarios" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" />
          </div>
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 font-medium">
              <X size={14} />Limpiar
            </button>
          )}
        </div>

        {/* Members Display */}
        {filteredMembers.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <UserCog size={32} className="text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900 mb-1">{searchTerm ? "No se encontraron usuarios" : "No hay usuarios con acceso"}</h3>
            <p className="text-slate-500 text-sm">{searchTerm ? "Intenta ajustar la búsqueda" : "Añade usuarios para dar acceso a contabilidad"}</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Project Roles */}
            {projectRoleMembers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center"><Shield size={16} className="text-white" /></div>
                  <h2 className="text-sm font-semibold text-slate-900">Equipo de proyecto</h2>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{projectRoleMembers.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {projectRoleMembers.map((member) => (
                    <div key={member.userId} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-all group">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 truncate">{member.name || member.email}</p>
                            <span className="text-xs font-medium bg-slate-900 text-white px-2 py-0.5 rounded">{member.role}</span>
                          </div>
                          {member.email && member.name && <p className="text-xs text-slate-500 truncate">{member.email}</p>}
                          <div className="flex items-center gap-2 mt-2">
                            {getAccessLevelDot(member.accountingAccessLevel)}
                            {getAccessLevelBadge(member.accountingAccessLevel)}
                          </div>
                        </div>
                      </div>
                      {member.userId !== userId && isProjectRole && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingMember(member); setShowEditAccessModal(true); }} className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 py-1.5 rounded-lg"><Edit size={12} />Cambiar</button>
                          <button onClick={() => handleRemoveAccountingAccess(member)} disabled={saving} className="flex-1 flex items-center justify-center gap-1 text-xs text-red-600 hover:bg-red-50 py-1.5 rounded-lg disabled:opacity-50"><Trash2 size={12} />Quitar</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Department Groups */}
            {Object.entries(departmentGroups).map(([deptName, deptMembers]) => (
              <div key={deptName}>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center"><Building2 size={16} className="text-slate-600" /></div>
                  <h2 className="text-sm font-semibold text-slate-900">{deptName}</h2>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{deptMembers.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {deptMembers.map((member) => (
                    <div key={member.userId} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-all group">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{member.name || member.email}</p>
                          {member.position && <p className="text-xs text-slate-600">{member.position}</p>}
                          {member.email && member.name && <p className="text-xs text-slate-500 truncate">{member.email}</p>}
                          <div className="flex items-center gap-2 mt-2">
                            {getAccessLevelDot(member.accountingAccessLevel)}
                            {getAccessLevelBadge(member.accountingAccessLevel)}
                          </div>
                        </div>
                      </div>
                      {member.userId !== userId && isProjectRole && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingMember(member); setShowEditAccessModal(true); }} className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 py-1.5 rounded-lg"><Edit size={12} />Cambiar</button>
                          <button onClick={() => handleRemoveAccountingAccess(member)} disabled={saving} className="flex-1 flex items-center justify-center gap-1 text-xs text-red-600 hover:bg-red-50 py-1.5 rounded-lg disabled:opacity-50"><Trash2 size={12} />Quitar</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Unassigned */}
            {unassignedMembers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center"><Users size={16} className="text-slate-500" /></div>
                  <h2 className="text-sm font-semibold text-slate-900">Sin asignar</h2>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{unassignedMembers.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {unassignedMembers.map((member) => (
                    <div key={member.userId} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-all group">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                          {member.name?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{member.name || member.email}</p>
                          {member.email && member.name && <p className="text-xs text-slate-500 truncate">{member.email}</p>}
                          <div className="flex items-center gap-2 mt-2">
                            {getAccessLevelDot(member.accountingAccessLevel)}
                            {getAccessLevelBadge(member.accountingAccessLevel)}
                          </div>
                        </div>
                      </div>
                      {member.userId !== userId && isProjectRole && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditingMember(member); setShowEditAccessModal(true); }} className="flex-1 flex items-center justify-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 py-1.5 rounded-lg"><Edit size={12} />Cambiar</button>
                          <button onClick={() => handleRemoveAccountingAccess(member)} disabled={saving} className="flex-1 flex items-center justify-center gap-1 text-xs text-red-600 hover:bg-red-50 py-1.5 rounded-lg disabled:opacity-50"><Trash2 size={12} />Quitar</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Edit Access Modal */}
      {showEditAccessModal && editingMember && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowEditAccessModal(false); setEditingMember(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Cambiar nivel de acceso</h3>
              <button onClick={() => { setShowEditAccessModal(false); setEditingMember(null); }} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6">
              <div className="mb-6">
                <p className="text-sm text-slate-500 mb-1">Usuario</p>
                <p className="text-base font-semibold text-slate-900">{editingMember.name}</p>
                <p className="text-xs text-slate-500">{editingMember.email}</p>
              </div>
              <div className="space-y-3 mb-6">
                <p className="text-sm font-medium text-slate-700">Seleccionar nivel</p>
                {Object.entries(ACCOUNTING_ACCESS_LEVELS).map(([key, value]) => (
                  <label key={key} className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-all ${editingMember.accountingAccessLevel === key ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <input type="radio" name="accessLevel" value={key} checked={editingMember.accountingAccessLevel === key} onChange={(e) => setEditingMember({ ...editingMember, accountingAccessLevel: e.target.value as any })} className="mt-1" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-900">{value.label}</p>
                      <p className="text-xs text-slate-500">{value.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowEditAccessModal(false); setEditingMember(null); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">Cancelar</button>
                <button onClick={handleUpdateAccessLevel} disabled={saving} className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium disabled:opacity-50">{saving ? "Guardando..." : "Guardar"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowInviteModal(false); resetForm(); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold text-slate-900">Dar acceso a contabilidad</h3>
              <button onClick={() => { setShowInviteModal(false); resetForm(); }} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex gap-2"><Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" /><p className="text-sm text-blue-700">Selecciona el nivel de acceso que tendrá el usuario.</p></div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Email del usuario</label>
                  <input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="usuario@ejemplo.com" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50" />
                  {userExists === true && foundUser && (<div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2"><UserCheck size={18} className="text-emerald-600 mt-0.5" /><div><p className="text-sm font-medium text-emerald-900">Usuario registrado</p><p className="text-xs text-emerald-700">{foundUser.name}</p></div></div>)}
                  {userExists === false && inviteForm.email.length > 3 && (<div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2"><UserX size={18} className="text-amber-600 mt-0.5" /><div><p className="text-sm font-medium text-amber-900">Usuario no registrado</p><p className="text-xs text-amber-700">Se enviará invitación</p></div></div>)}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nombre</label>
                  <input type="text" value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="Nombre completo" disabled={userExists === true} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50 disabled:bg-slate-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Nivel de acceso</label>
                  <div className="space-y-2">
                    {Object.entries(ACCOUNTING_ACCESS_LEVELS).map(([key, value]) => (
                      <label key={key} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer transition-all ${inviteForm.accountingAccessLevel === key ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                        <input type="radio" name="accountingAccessLevel" value={key} checked={inviteForm.accountingAccessLevel === key} onChange={(e) => setInviteForm({ ...inviteForm, accountingAccessLevel: e.target.value as any })} className="mt-1" />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-900">{value.label}</p>
                          <p className="text-xs text-slate-500">{value.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de rol</label>
                  <select value={inviteForm.roleType} onChange={(e) => setInviteForm({ ...inviteForm, roleType: e.target.value as "project" | "department" })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50">
                    <option value="project">Rol de proyecto</option>
                    <option value="department">Rol de departamento</option>
                  </select>
                </div>
                {inviteForm.roleType === "project" ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Rol de proyecto</label>
                    <select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50">
                      <option value="">Seleccionar</option>
                      {PROJECT_ROLES.map((role) => (<option key={role} value={role}>{role}</option>))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Departamento</label>
                      <select value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50">
                        <option value="">Seleccionar</option>
                        {departments.map((dept) => (<option key={dept.name} value={dept.name}>{dept.name}</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Posición</label>
                      <select value={inviteForm.position} onChange={(e) => setInviteForm({ ...inviteForm, position: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-slate-50">
                        <option value="">Seleccionar</option>
                        {DEPARTMENT_POSITIONS.map((pos) => (<option key={pos} value={pos}>{pos}</option>))}
                      </select>
                    </div>
                  </>
                )}
                <button onClick={handleSendInvitation} disabled={saving} className="w-full mt-4 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium disabled:opacity-50">{saving ? "Enviando..." : "Dar acceso a contabilidad"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
