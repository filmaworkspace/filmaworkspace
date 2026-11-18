"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, RefObject } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchWords } from "@/lib/search";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Edit,
  Info,
  Package,
  Search,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UserX,
  MoreHorizontal,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];
const DEPARTMENT_POSITIONS = ["HOD", "Coordinator", "Crew"];

const ACCOUNTING_ACCESS_LEVELS = {
  visitor: { label: "Visitante", description: "Solo lectura del panel principal", permissions: { panel: true, suppliers: false, budget: false, users: false, reports: false }, color: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  user: { label: "Usuario", description: "Panel y Proveedores", permissions: { panel: true, suppliers: true, budget: false, users: false, reports: false }, color: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  accounting: { label: "Contabilidad", description: "Panel, Proveedores e Informes", permissions: { panel: true, suppliers: true, budget: false, users: false, reports: true }, color: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
  accounting_extended: { label: "Contabilidad ampliada", description: "Acceso completo", permissions: { panel: true, suppliers: true, budget: true, users: true, reports: true }, color: "bg-purple-50 text-purple-700", dot: "bg-purple-500" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface Member {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
  position?: string;
  permissions: { config: boolean; accounting: boolean; team: boolean };
  accountingAccessLevel?: "visitor" | "user" | "accounting" | "accounting_extended";
  boxAccess?: boolean;
  addedAt: any;
  addedBy?: string;
  addedByName?: string;
}

interface PendingInvitation {
  id: string;
  invitedEmail: string;
  invitedName: string;
  roleType: "project" | "department";
  role?: string;
  department?: string;
  position?: string;
  status: string;
  createdAt: any;
  invitedBy: string;
  invitedByName: string;
  accountingAccessLevel?: "visitor" | "user" | "accounting" | "accounting_extended";
  boxAccess?: boolean;
}

interface Department {
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AccountingUsersPage() {
  const { id } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [hasAccountingAccess, setHasAccountingAccess] = useState(false);
  const [isProjectRole, setIsProjectRole] = useState(false);
  const [isAccountingExtended, setIsAccountingExtended] = useState(false);
  const [currentUserAccessLevel, setCurrentUserAccessLevel] = useState<string>("user");
  const [projectName, setProjectName] = useState("");
  const [workingTitle, setWorkingTitle] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [accountingMembers, setAccountingMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchField, setSearchField] = useState<"all" | "name" | "email" | "department">("all");
  const [levelFilter, setLevelFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditAccessModal, setShowEditAccessModal] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [foundUser, setFoundUser] = useState<{ name: string; email: string } | null>(null);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(showInviteModal || showEditAccessModal || !!confirmDialog);

  const [inviteForm, setInviteForm] = useState({
    email: "", name: "", roleType: "project" as "project" | "department", role: "", department: "", position: "",
    accountingAccessLevel: "user" as "visitor" | "user" | "accounting" | "accounting_extended",
    boxAccess: false,
  });

  // Dropdowns personalizados
  const [showRoleTypeDropdown, setShowRoleTypeDropdown] = useState(false);
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const [showPositionDropdown, setShowPositionDropdown] = useState(false);
  const roleTypeDropdownRef = useRef<HTMLDivElement>(null);
  const roleDropdownRef = useRef<HTMLDivElement>(null);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const positionDropdownRef = useRef<HTMLDivElement>(null);
  // Posición fija de los desplegables del modal (evita que el overflow-y-auto del
  // modal los recorte); solo uno puede estar abierto a la vez, así que basta un state.
  const [inviteDropdownPos, setInviteDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const openInviteDropdown = (ref: RefObject<HTMLDivElement | null>, setShow: (v: boolean) => void, current: boolean) => {
    if (!current && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setInviteDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setShow(!current);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
      else { setUserId(user.uid); setUserName(user.displayName || user.email || "Usuario"); }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (roleTypeDropdownRef.current && !roleTypeDropdownRef.current.contains(target)) setShowRoleTypeDropdown(false);
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(target)) setShowRoleDropdown(false);
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(target)) setShowDepartmentDropdown(false);
      if (positionDropdownRef.current && !positionDropdownRef.current.contains(target)) setShowPositionDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!userId || !id) return;
    const loadData = async () => {
      try {
        const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
        const userProjectSnap = await getDoc(userProjectRef);
        if (!userProjectSnap.exists()) { setErrorMessage("No tienes acceso a este proyecto"); setLoading(false); return; }
        const userProjectData = userProjectSnap.data();
        const hasAccounting = userProjectData.permissions?.accounting || false;
        const accountingLevel = userProjectData.accountingAccessLevel;
        setHasAccountingAccess(hasAccounting);

        const memberRef = doc(db, `projects/${id}/members/${userId}`);
        const memberSnap = await getDoc(memberRef);
        const memberData = memberSnap.exists() ? memberSnap.data() : null;
        const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role || "");
        setIsProjectRole(isEPorPM || false);
        
        // Solo accounting_extended o EP/PM pueden acceder a esta página
        const hasExtendedAccess = accountingLevel === "accounting_extended";
        if (!hasAccounting || (!isEPorPM && !hasExtendedAccess)) {
          setErrorMessage("No tienes permisos para gestionar usuarios de contabilidad");
          setLoading(false);
          return;
        }
        setIsAccountingExtended(hasExtendedAccess);
        setCurrentUserAccessLevel(accountingLevel || "user");

        const projectRef = doc(db, "projects", id as string);
        const projectSnap = await getDoc(projectRef);
        if (projectSnap.exists()) { const projectData = projectSnap.data(); setProjectName(projectData.name); const depts = projectData.departments || []; setDepartments(depts.map((d: string) => ({ name: d }))); }
        const prodSnap = await getDoc(doc(db, `projects/${id}/config`, "production"));
        if (prodSnap.exists()) setWorkingTitle(prodSnap.data().workingTitle || "");

        const membersRef = collection(db, `projects/${id}/members`);
        const membersSnap = await getDocs(membersRef);
        const membersData: Member[] = membersSnap.docs.map((memberDoc) => {
          const data = memberDoc.data();
          return { userId: memberDoc.id, name: data.name, email: data.email, role: data.role, department: data.department, position: data.position, permissions: data.permissions || { config: false, accounting: false, team: false }, accountingAccessLevel: data.accountingAccessLevel || "user", boxAccess: data.boxAccess || false, addedAt: data.addedAt, addedBy: data.addedBy, addedByName: data.addedByName };
        });
        setMembers(membersData);
        setAccountingMembers(membersData.filter((m) => m.permissions.accounting));

        const invitationsRef = collection(db, "invitations");
        const q = query(invitationsRef, where("projectId", "==", id), where("status", "==", "pending"));
        const invitationsSnap = await getDocs(q);
        const invitationsData: PendingInvitation[] = invitationsSnap.docs.map((invDoc) => {
          const data = invDoc.data();
          return { id: invDoc.id, invitedEmail: data.invitedEmail, invitedName: data.invitedName, roleType: data.roleType || "project", role: data.role, department: data.department, position: data.position, status: data.status, createdAt: data.createdAt, invitedBy: data.invitedBy, invitedByName: data.invitedByName, permissions: data.permissions, accountingAccessLevel: data.accountingAccessLevel || "user", boxAccess: data.boxAccess || false };
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
        await updateDoc(doc(db, `projects/${id}/members`, memberWithoutAccounting.userId), { "permissions.accounting": true, accountingAccessLevel: inviteForm.accountingAccessLevel, boxAccess: inviteForm.boxAccess });
        await updateDoc(doc(db, `userProjects/${memberWithoutAccounting.userId}/projects`, id as string), { "permissions.accounting": true, accountingAccessLevel: inviteForm.accountingAccessLevel, boxAccess: inviteForm.boxAccess });
        setSuccessMessage(`Permiso de contabilidad añadido a ${memberWithoutAccounting.name}`); setTimeout(() => setSuccessMessage(""), 3000);
        const membersRef = collection(db, `projects/${id}/members`);
        const membersSnap = await getDocs(membersRef);
        const membersData: Member[] = membersSnap.docs.map((memberDoc) => { const data = memberDoc.data(); return { userId: memberDoc.id, name: data.name, email: data.email, role: data.role, department: data.department, position: data.position, permissions: data.permissions || { config: false, accounting: false, team: false }, accountingAccessLevel: data.accountingAccessLevel || "user", boxAccess: data.boxAccess || false, addedAt: data.addedAt, addedBy: data.addedBy, addedByName: data.addedByName }; });
        setMembers(membersData); setAccountingMembers(membersData.filter((m) => m.permissions.accounting)); setShowInviteModal(false); resetForm(); setSaving(false); return;
      }
      const existingInvite = pendingInvitations.find((inv) => inv.invitedEmail === email);
      if (existingInvite) { setErrorMessage("Ya existe una invitación pendiente para este email"); setSaving(false); setTimeout(() => setErrorMessage(""), 3000); return; }
      const usersRef = collection(db, "users");
      const q = query(usersRef, where("email", "==", email));
      const usersSnap = await getDocs(q);
      let invitedUserId: string | null = null;
      if (!usersSnap.empty) invitedUserId = usersSnap.docs[0].id;
      const inviteData: any = { projectId: id, projectName: projectName, invitedEmail: email, invitedName: inviteForm.name.trim(), invitedUserId: invitedUserId, invitedBy: userId, invitedByName: userName, status: "pending", createdAt: Timestamp.now(), expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)), roleType: inviteForm.roleType, accountingAccessLevel: inviteForm.accountingAccessLevel, boxAccess: inviteForm.boxAccess };
      if (inviteForm.roleType === "project") { inviteData.role = inviteForm.role; inviteData.permissions = { config: false, accounting: true, team: false }; }
      else { inviteData.department = inviteForm.department; inviteData.position = inviteForm.position; inviteData.permissions = { config: false, accounting: true, team: false }; }
      await setDoc(doc(collection(db, "invitations")), inviteData);

      // Send invitation email (fire-and-forget)
      const idToken = await auth.currentUser?.getIdToken();
      fetch("/api/send-project-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          inviteeName:    inviteData.invitedName,
          invitedByName:  inviteData.invitedByName,
          invitedEmail:   email,
          projectName:    inviteData.projectName,
          workingTitle,
          projectId:      id,
          role:           inviteData.role ?? inviteData.position ?? "",
          isExistingUser: invitedUserId !== null,
        }),
      }).catch(console.error);

      setSuccessMessage(`Invitación enviada correctamente a ${inviteForm.name}`); setTimeout(() => setSuccessMessage(""), 3000);
      const invitationsRef = collection(db, "invitations");
      const invQuery = query(invitationsRef, where("projectId", "==", id), where("status", "==", "pending"));
      const invitationsSnap = await getDocs(invQuery);
      const invitationsData: PendingInvitation[] = invitationsSnap.docs.map((invDoc) => { const data = invDoc.data(); return { id: invDoc.id, invitedEmail: data.invitedEmail, invitedName: data.invitedName, roleType: data.roleType || "project", role: data.role, department: data.department, position: data.position, status: data.status, createdAt: data.createdAt, invitedBy: data.invitedBy, invitedByName: data.invitedByName, permissions: data.permissions, accountingAccessLevel: data.accountingAccessLevel || "user", boxAccess: data.boxAccess || false }; }).filter((inv: any) => inv.permissions?.accounting === true);
      setPendingInvitations(invitationsData); resetForm(); setShowInviteModal(false);
    } catch (error) { console.error("Error enviando invitación:", error); setErrorMessage("Error al enviar la invitación"); setTimeout(() => setErrorMessage(""), 3000); } finally { setSaving(false); }
  };

  const ACCESS_LEVEL_RANK: Record<string, number> = { visitor: 1, user: 2, accounting: 3, accounting_extended: 4 };

  const handleUpdateAccessLevel = async () => {
    if (!editingMember) return;
    const newAccessLevel = editingMember.accountingAccessLevel || "user";
    const newBoxAccess = editingMember.boxAccess || false;

    // Si el usuario se edita a sí mismo y baja de nivel, ya fue confirmado en el modal
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${id}/members`, editingMember.userId), { accountingAccessLevel: newAccessLevel, boxAccess: newBoxAccess });
      await updateDoc(doc(db, `userProjects/${editingMember.userId}/projects`, id as string), { accountingAccessLevel: newAccessLevel, boxAccess: newBoxAccess });
      setAccountingMembers(accountingMembers.map((m) => (m.userId === editingMember.userId ? { ...m, accountingAccessLevel: newAccessLevel, boxAccess: newBoxAccess } : m)));
      if (editingMember.userId === userId) {
        setCurrentUserAccessLevel(newAccessLevel);
        setIsAccountingExtended(newAccessLevel === "accounting_extended");
      }
      setSuccessMessage("Nivel de acceso actualizado correctamente");
      setTimeout(() => setSuccessMessage(""), 3000);
      setShowEditAccessModal(false);
      setEditingMember(null);
    } catch (error) {
      console.error("Error actualizando acceso:", error);
      setErrorMessage("Error al actualizar el nivel de acceso");
      setTimeout(() => setErrorMessage(""), 3000);
    } finally {
      setSaving(false);
    }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleCancelInvitation = async (invitationId: string) => {
    openConfirm(
      "Cancelar invitación",
      "¿Estás seguro de que quieres cancelar esta invitación?",
      async () => {
        setConfirmDialog(null);
        try { await deleteDoc(doc(db, "invitations", invitationId)); setPendingInvitations(pendingInvitations.filter((inv) => inv.id !== invitationId)); setSuccessMessage("Invitación cancelada"); setTimeout(() => setSuccessMessage(""), 3000); }
        catch (error) { console.error("Error cancelando invitación:", error); setErrorMessage("Error al cancelar la invitación"); setTimeout(() => setErrorMessage(""), 3000); }
      },
      { danger: true, confirmLabel: "Cancelar invitación" }
    );
  };

  const handleRemoveAccountingAccess = async (member: Member) => {
    openConfirm(
      "Quitar acceso a contabilidad",
      `¿Quitar acceso a contabilidad de ${member.name || member.email}? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmDialog(null);
        setSaving(true);
        try {
          await updateDoc(doc(db, `projects/${id}/members`, member.userId), { "permissions.accounting": false, accountingAccessLevel: null, boxAccess: null });
          await updateDoc(doc(db, `userProjects/${member.userId}/projects`, id as string), { "permissions.accounting": false, accountingAccessLevel: null, boxAccess: null });
          setAccountingMembers(accountingMembers.filter((m) => m.userId !== member.userId));
          setMembers(members.map((m) => (m.userId === member.userId ? { ...m, permissions: { ...m.permissions, accounting: false }, accountingAccessLevel: undefined, boxAccess: undefined } : m)));
          setSuccessMessage("Acceso eliminado correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
        } catch (error) { console.error("Error eliminando acceso:", error); setErrorMessage("Error al eliminar el acceso"); setTimeout(() => setErrorMessage(""), 3000); } finally { setSaving(false); }
      },
      { danger: true, confirmLabel: "Quitar acceso" }
    );
  };

  const resetForm = () => { setInviteForm({ email: "", name: "", roleType: "project", role: "", department: "", position: "", accountingAccessLevel: "user", boxAccess: false }); setUserExists(null); setFoundUser(null); };

  const filteredMembers = accountingMembers.filter((member) => member.name.toLowerCase().includes(searchTerm.toLowerCase()) || member.email.toLowerCase().includes(searchTerm.toLowerCase()));

  const projectRoleMembers = filteredMembers.filter(m => PROJECT_ROLES.includes(m.role || ""));
  const departmentGroups = filteredMembers.filter(m => !PROJECT_ROLES.includes(m.role || "") && m.department).reduce((acc, member) => {
    const dept = member.department || "Sin departamento";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(member);
    return acc;
  }, {} as Record<string, Member[]>);
  const unassignedMembers = filteredMembers.filter(m => !PROJECT_ROLES.includes(m.role || "") && !m.department);

  // ── Búsqueda avanzada y filtros ───────────────────────────────────────────
  type UserField = "all" | "name" | "email" | "department";
  const USER_FIELDS: SearchField<UserField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Nombre, email o departamento" },
    { value: "name", label: "Nombre", placeholder: "Ej. Marta" },
    { value: "email", label: "Email", placeholder: "Ej. @productora.com" },
    { value: "department", label: "Departamento", placeholder: "Ej. Arte" },
  ];
  const userMatches = (m: Member) => {
    if (!searchTerm.trim()) return true;
    if (searchField === "name") return matchWords(searchTerm, m.name);
    if (searchField === "email") return matchWords(searchTerm, m.email);
    if (searchField === "department") return matchWords(searchTerm, m.department);
    return matchWords(searchTerm, m.name, m.email, m.role, m.department, m.position);
  };
  const groupOf = (m: Member) => (PROJECT_ROLES.includes(m.role || "") ? "Equipo de proyecto" : m.department || "Sin departamento");
  const groupOrder = (g: string) => (g === "Equipo de proyecto" ? "0" : g === "Sin departamento" ? "2" : "1" + g);
  const tableRows = accountingMembers
    .filter(userMatches)
    .filter((m) => levelFilter === "all" || (m.accountingAccessLevel || "user") === levelFilter)
    .filter((m) => groupFilter === "all" || groupOf(m) === groupFilter)
    .sort((a, b) => groupOrder(groupOf(a)).localeCompare(groupOrder(groupOf(b))) || (a.name || a.email).localeCompare(b.name || b.email));
  const groups = Array.from(new Set(accountingMembers.map(groupOf))).sort((a, b) => groupOrder(a).localeCompare(groupOrder(b)));
  const filtersActive = levelFilter !== "all" || groupFilter !== "all";
  const LevelDot = ({ level }: { level?: string }) => {
    const l = ACCOUNTING_ACCESS_LEVELS[(level || "user") as keyof typeof ACCOUNTING_ACCESS_LEVELS] || ACCOUNTING_ACCESS_LEVELS.user;
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700">
        <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} />
        {l.label}
      </span>
    );
  };
  const canManage = (m: Member) => (m.userId !== userId ? isProjectRole : isAccountingExtended);

  if (loading) return <PageLoading />;
  if (errorMessage && !hasAccountingAccess) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white px-6 ${inter.className}`}>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-slate-900">Sin acceso</p>
          <p className="mt-1 text-[13px] text-slate-500">{errorMessage}</p>
          <Link href="/dashboard" className={`${buttonClass("primary")} mt-5`}>Volver a proyectos</Link>
        </div>
      </div>
    );
  }

  // Modal de nivel de acceso
  const editModal = (() => {
    if (!editingMember) return null;
    const isSelf = editingMember.userId === userId;
    const selectedLevel = editingMember.accountingAccessLevel || "user";
    const isDowngrade = isSelf && ACCESS_LEVEL_RANK[selectedLevel] < ACCESS_LEVEL_RANK[currentUserAccessLevel];
    const currentPerms = ACCOUNTING_ACCESS_LEVELS[currentUserAccessLevel as keyof typeof ACCOUNTING_ACCESS_LEVELS]?.permissions || {};
    const newPerms = ACCOUNTING_ACCESS_LEVELS[selectedLevel as keyof typeof ACCOUNTING_ACCESS_LEVELS]?.permissions || {};
    const lostModules = [
      !newPerms.suppliers && currentPerms.suppliers ? "Proveedores" : null,
      !newPerms.budget && currentPerms.budget ? "Presupuesto" : null,
      !newPerms.users && currentPerms.users ? "Gestión de usuarios" : null,
      !newPerms.reports && currentPerms.reports ? "Informes" : null,
    ].filter(Boolean) as string[];
    return { isSelf, isDowngrade, lostModules };
  })();
  const closeEdit = () => { setShowEditAccessModal(false); setEditingMember(null); };
  const closeInvite = () => { setShowInviteModal(false); resetForm(); };

  const LevelOptions = ({ value, onChange, isDisabled }: { value: string; onChange: (v: string) => void; isDisabled?: (key: string) => boolean }) => (
    <div className="flex flex-col overflow-hidden rounded-md border border-slate-200">
      {Object.entries(ACCOUNTING_ACCESS_LEVELS).map(([key, l]) => {
        const disabled = isDisabled?.(key) || false;
        return (
          <label key={key} className={`flex items-start gap-2.5 border-b border-slate-100 px-3 py-2 last:border-0 ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-[#FAFAFA]"} ${value === key ? "bg-[#F7F7F8]" : ""}`}>
            <input type="radio" checked={value === key} disabled={disabled} onChange={() => !disabled && onChange(key)} className="mt-0.5 accent-slate-900" />
            <span className="flex flex-col">
              <span className="text-[13px] text-slate-900">{l.label}</span>
              <span className="text-[11px] text-slate-500">{l.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );

  return (
    <Page>
      <PageHeader
        title={<>Usuarios <span className="text-[15px] font-normal text-slate-400">{accountingMembers.length}</span></>}
        actions={<Button variant="primary" onClick={() => setShowInviteModal(true)}><UserPlus size={14} /> Dar acceso</Button>}
      />

      {pendingInvitations.length > 0 && (
        <section aria-labelledby="inv-title" className="mt-6 flex flex-col gap-2">
          <h2 id="inv-title" className="text-xs font-medium text-slate-500">Invitaciones pendientes · {pendingInvitations.length}</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[640px] border-collapse text-[13px]">
              <tbody>
                {pendingInvitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-1.5">
                      <span className="block">{inv.invitedName}</span>
                      <span className="block text-xs text-slate-500">{inv.invitedEmail}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{inv.roleType === "project" ? inv.role : [inv.department, inv.position].filter(Boolean).join(" · ")}</td>
                    <td className="px-3 py-1.5"><LevelDot level={inv.accountingAccessLevel} /></td>
                    <td className="px-4 py-1.5 text-right"><Button variant="ghost" size="sm" onClick={() => handleCancelInvitation(inv.id)}>Cancelar invitación</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={USER_FIELDS} field={searchField} onField={setSearchField} value={searchTerm} onChange={setSearchTerm} count={tableRows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="w-48">
          <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            <option value="all">Cualquier nivel</option>
            {Object.entries(ACCOUNTING_ACCESS_LEVELS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
          </Select>
        </div>
        <div className="w-48">
          <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">Todos los grupos</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </Select>
        </div>
        {filtersActive && <Button variant="ghost" size="sm" onClick={() => { setLevelFilter("all"); setGroupFilter("all"); }}>Quitar filtros</Button>}
        </div>
      </div>

      <div className="mt-4">
        {tableRows.length === 0 ? (
          <EmptyState title={searchTerm || filtersActive ? "Sin resultados" : "Nadie tiene acceso a contabilidad"} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-[42%] px-4 py-2 text-left font-medium">Usuario</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Grupo</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Rol o posición</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Nivel de acceso</th>
                  <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Cajas</th>
                  <th scope="col" className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {tableRows.map((m) => (
                  <tr key={m.userId} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                    <td className="px-4 py-1.5">
                      <span className="block truncate font-medium text-slate-900">
                        {m.name || m.email}
                        {m.userId === userId && <span className="ml-1.5 text-xs font-normal text-slate-500">(tú)</span>}
                      </span>
                      {m.name && <span className="block truncate text-xs text-slate-500">{m.email}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{groupOf(m)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{PROJECT_ROLES.includes(m.role || "") ? <span className="font-mono text-xs">{m.role}</span> : m.position || "—"}</td>
                    <td className="px-3 py-1.5"><LevelDot level={m.accountingAccessLevel} /></td>
                    <td className="px-3 py-1.5 text-slate-600">{m.boxAccess ? "Sí" : "—"}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {canManage(m) && (
                        <Menu trigger={(toggle) => <IconButton label="Acciones del usuario" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); setEditingMember(m); setShowEditAccessModal(true); }}>{m.userId === userId ? "Mis permisos" : "Cambiar nivel de acceso"}</MenuItem>
                              {m.userId !== userId && isProjectRole && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem danger onClick={() => { close(); handleRemoveAccountingAccess(m); }}>Quitar acceso</MenuItem>
                                </>
                              )}
                            </>
                          )}
                        </Menu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nivel de acceso */}
      <Modal
        open={showEditAccessModal && !!editingMember}
        onClose={closeEdit}
        title={editModal?.isSelf ? "Mis permisos de contabilidad" : "Nivel de acceso"}
        footer={
          <>
            <Button variant="secondary" onClick={closeEdit}>Cancelar</Button>
            <Button variant={editModal?.isDowngrade ? "danger" : "primary"} onClick={handleUpdateAccessLevel} disabled={saving}>
              {editModal?.isDowngrade ? "Bajar mi acceso" : "Guardar"}
            </Button>
          </>
        }
      >
        {editingMember && editModal && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-slate-900">
              {editingMember.name} <span className="text-slate-500">· {editingMember.email}</span>
            </p>
            <LevelOptions
              value={editingMember.accountingAccessLevel || "user"}
              onChange={(v) => setEditingMember({ ...editingMember, accountingAccessLevel: v as any })}
              isDisabled={(key) => editModal.isSelf && ACCESS_LEVEL_RANK[key] > ACCESS_LEVEL_RANK[currentUserAccessLevel]}
            />
            <Checkbox label="Acceso a cajas (BOX)" checked={editingMember.boxAccess || false} onChange={(v) => setEditingMember({ ...editingMember, boxAccess: v })} />
            {editModal.isDowngrade && editModal.lostModules.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Perderás acceso a {editModal.lostModules.join(", ")}. El cambio es inmediato y otra persona con permisos tendrá que devolvértelo.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Dar acceso */}
      <Modal
        open={showInviteModal}
        onClose={closeInvite}
        title="Dar acceso a contabilidad"
        width="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeInvite}>Cancelar</Button>
            <Button variant="primary" onClick={handleSendInvitation} disabled={saving}>Dar acceso</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Email">
            <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} autoFocus />
          </Field>
          {userExists === true && foundUser && <p className="-mt-2 text-xs text-emerald-800">Usuario registrado: {foundUser.name}</p>}
          {userExists === false && inviteForm.email.length > 3 && <p className="-mt-2 text-xs text-slate-500">No está registrado; recibirá una invitación.</p>}
          <Field label="Nombre">
            <Input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} disabled={userExists === true} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de rol">
              <Select value={inviteForm.roleType} onChange={(e) => setInviteForm({ ...inviteForm, roleType: e.target.value as any })}>
                <option value="project">Rol de proyecto</option>
                <option value="department">Rol de departamento</option>
              </Select>
            </Field>
            {inviteForm.roleType === "project" ? (
              <Field label="Rol">
                <Select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                  <option value="">Seleccionar</option>
                  {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="Posición">
                <Select value={inviteForm.position} onChange={(e) => setInviteForm({ ...inviteForm, position: e.target.value })}>
                  <option value="">Seleccionar</option>
                  {DEPARTMENT_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {inviteForm.roleType === "department" && (
            <Field label="Departamento">
              <Select value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })}>
                <option value="">Seleccionar</option>
                {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">Nivel de acceso</span>
            <LevelOptions value={inviteForm.accountingAccessLevel} onChange={(v) => setInviteForm({ ...inviteForm, accountingAccessLevel: v as any })} />
          </div>
          <Checkbox label="Acceso a cajas (BOX)" checked={inviteForm.boxAccess} onChange={(v) => setInviteForm({ ...inviteForm, boxAccess: v })} />
        </div>
      </Modal>

      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>

      {successMessage && (
        <div className="fixed bottom-4 left-4 z-[80] flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2.5 text-[13px] text-white shadow-lg">
          <CheckCircle2 size={15} />
          {successMessage}
        </div>
      )}
      {errorMessage && hasAccountingAccess && (
        <div className="fixed bottom-4 left-4 z-[80] flex items-center gap-2 rounded-md bg-red-600 px-3.5 py-2.5 text-[13px] text-white shadow-lg">
          <AlertCircle size={15} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} aria-label="Cerrar" className="ml-1 rounded p-0.5 hover:bg-white/20"><X size={13} /></button>
        </div>
      )}
    </Page>
  );
}
