"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal,
  NoAccess, Page, PageHeader, PageLoading, Segmented, Select, Table, Td, Th, Tr, tokens, useToast,
} from "@/components/ds";

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
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  MoreHorizontal,
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
  const [workingTitle, setWorkingTitle] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [foundUser, setFoundUser] = useState<{ name: string; email: string } | null>(null);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [editPermissions, setEditPermissions] = useState({ config: false, accounting: false, team: false });
  const [departmentDropdownOpen, setDepartmentDropdownOpen] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const [departmentDropdownPos, setDepartmentDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
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

  const [toastNode, showToast] = useToast();

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
        const prodSnap = await getDoc(doc(db, `projects/${id}/config`, "production"));
        if (prodSnap.exists()) setWorkingTitle(prodSnap.data().workingTitle || "");

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
      } catch { showToast("error", "No se ha podido cargar"); setLoading(false); }
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
      const idToken = await auth.currentUser?.getIdToken();
      fetch("/api/send-project-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          inviteeName:   inviteData.invitedName,
          invitedByName: inviteData.invitedByName,
          invitedEmail:  email,
          projectName:   inviteData.projectName,
          workingTitle,
          projectId:     id,
          role:          inviteData.role ?? inviteData.position ?? "",
          isExistingUser: inviteData.invitedUserId !== null,
        }),
      }).catch(console.error);

      showToast("success", "Invitación enviada");

      const invSnap = await getDocs(query(collection(db, "invitations"), where("projectId", "==", id), where("status", "==", "pending")));
      setPendingInvitations(invSnap.docs.map((d) => ({ id: d.id, invitedEmail: d.data().invitedEmail, invitedName: d.data().invitedName, roleType: d.data().roleType || "project", role: d.data().role, department: d.data().department, position: d.data().position })));
      closeModal();
    } catch { showToast("error", "No se ha podido enviar"); } finally { setSaving(false); }
  };

  const handleCancelInvitation = async (invId: string) => {
    try {
      await deleteDoc(doc(db, "invitations", invId));
      setPendingInvitations(pendingInvitations.filter((i) => i.id !== invId));
      showToast("success", "Invitación cancelada");
    } catch { showToast("error", "No se ha podido completar"); }
  };

  const handleRemoveMember = async (memberId: string) => {
    setSaving(true);
    try {
      await deleteDoc(doc(db, `projects/${id}/members`, memberId));
      await deleteDoc(doc(db, `userProjects/${memberId}/projects`, id as string));
      setMembers(members.filter((m) => m.userId !== memberId));
      showToast("success", "Usuario eliminado");
    } catch { showToast("error", "No se ha podido completar"); } finally { setSaving(false); setActiveMenu(null); }
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
      showToast("error", "No se ha podido actualizar permisos"); 
    } finally { 
      setSaving(false); 
    }
  };

  const closeModal = () => {
    setShowInviteModal(false);
    setInviteForm({ email: "", name: "", roleType: "project", role: "", department: "", position: "", permissions: { config: false, accounting: false, team: false } });
    setUserExists(null); setFoundUser(null);
  };

  const filteredMembers = members.filter((m) => (m.name || "").toLowerCase().includes(searchTerm.toLowerCase()) || (m.email || "").toLowerCase().includes(searchTerm.toLowerCase()));
  const projectMembers = filteredMembers.filter((m) => PROJECT_ROLES.includes(m.role || ""));
  const deptMembers = filteredMembers.filter((m) => !PROJECT_ROLES.includes(m.role || "") && m.department);

  const [confirmRemove, setConfirmRemove] = useState<Member | null>(null);

  if (loading) return <PageLoading />;
  if (!hasConfigAccess) return <NoAccess />;

  const roleLabel = (m: { role?: string; position?: string; department?: string }) =>
    PROJECT_ROLES.includes(m.role || "") ? m.role : [m.position, m.department].filter(Boolean).join(" · ") || m.role || "—";

  const accessBadges = (perm: Member["permissions"]) => (
    <div className="flex flex-wrap gap-1">
      {perm.config && <Badge>Configuración</Badge>}
      {perm.accounting && <Badge dot={tokens.module.accounting}>Contabilidad</Badge>}
      {perm.team && <Badge dot={tokens.module.team}>Equipo</Badge>}
      {!perm.config && !perm.accounting && !perm.team && <span className="text-slate-300">—</span>}
    </div>
  );

  const sortedMembers = [...filteredMembers].sort((a, b) => {
    const ap = PROJECT_ROLES.includes(a.role || "") ? 0 : 1;
    const bp = PROJECT_ROLES.includes(b.role || "") ? 0 : 1;
    return ap - bp || (a.name || "").localeCompare(b.name || "");
  });

  return (
    <Page>
      {toastNode}

      <PageHeader
        title="Usuarios"
        actions={<Button variant="primary" onClick={() => setShowInviteModal(true)}>Invitar</Button>}
      />

      <div className="mb-3 mt-6 flex items-center gap-3">
        <Input placeholder="Buscar por nombre o email" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="!w-72" />
      </div>

      {sortedMembers.length === 0 ? (
        <EmptyState title={searchTerm ? "Ningún usuario coincide con la búsqueda" : "Aún no hay usuarios en el proyecto"} />
      ) : (
        <Table>
          <thead>
            <tr><Th className="w-[45%]">Nombre</Th><Th>Rol</Th><Th>Accesos</Th><Th className="w-10" /></tr>
          </thead>
          <tbody>
            {sortedMembers.map((m) => (
              <Tr key={m.userId}>
                <Td>
                  <p className="font-medium text-slate-900">{m.name}{m.userId === userId && <span className="ml-1.5 text-[11px] font-normal text-slate-400">Tú</span>}</p>
                  <p className="text-xs text-slate-500">{m.email}</p>
                </Td>
                <Td className="whitespace-nowrap">{roleLabel(m)}</Td>
                <Td>{accessBadges(m.permissions)}</Td>
                <Td align="right">
                  <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                    {(close) => (
                      <>
                        <MenuItem onClick={() => { close(); openEditPermissions(m); }}>Editar accesos</MenuItem>
                        {m.userId !== userId && (
                          <>
                            <MenuSeparator />
                            <MenuItem danger onClick={() => { close(); setConfirmRemove(m); }}>Quitar del proyecto</MenuItem>
                          </>
                        )}
                      </>
                    )}
                  </Menu>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {pendingInvitations.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-[13px] font-semibold text-slate-900">Invitaciones pendientes</h2>
          <Table>
            <thead>
              <tr><Th>Invitado</Th><Th>Rol</Th><Th>Estado</Th><Th className="w-24" /></tr>
            </thead>
            <tbody>
              {pendingInvitations.map((inv) => (
                <Tr key={inv.id}>
                  <Td>
                    <p className="font-medium text-slate-900">{inv.invitedName}</p>
                    <p className="text-xs text-slate-500">{inv.invitedEmail}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{inv.roleType === "project" ? inv.role : [inv.position, inv.department].filter(Boolean).join(" · ")}</Td>
                  <Td><Badge tone="warning">Pendiente</Badge></Td>
                  <Td align="right"><Button size="sm" variant="ghost" onClick={() => handleCancelInvitation(inv.id)}>Cancelar</Button></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {/* ── Invitar ── */}
      <Modal
        open={showInviteModal}
        onClose={closeModal}
        title="Invitar al proyecto"
        footer={
          <>
            <Button variant="ghost" onClick={closeModal}>Cancelar</Button>
            <Button variant="primary" loading={saving} disabled={!inviteForm.email.trim() || !inviteForm.name.trim()} onClick={handleSendInvitation}>Enviar invitación</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email" hint={userExists === true ? "Ya tiene cuenta en Filma" : userExists === false ? "Recibirá un email para crear su cuenta" : undefined}>
            <Input type="email" autoFocus value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="nombre@productora.com" />
          </Field>
          <Field label="Nombre">
            <Input value={inviteForm.name} disabled={!!foundUser} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} />
          </Field>
          <Field label="Tipo">
            <div>
              <Segmented
                value={inviteForm.roleType}
                onChange={(v) => setInviteForm({ ...inviteForm, roleType: v, role: "", department: "", position: "" })}
                options={[{ value: "project", label: "Rol de proyecto" }, { value: "department", label: "Departamento" }]}
              />
            </div>
          </Field>
          {inviteForm.roleType === "project" ? (
            <Field label="Rol">
              <Select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                <option value="" disabled>Seleccionar</option>
                {PROJECT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Departamento" hint={departments.length === 0 ? "Crea departamentos en Configuración › Departamentos" : undefined}>
                <Select value={inviteForm.department} onChange={(e) => setInviteForm({ ...inviteForm, department: e.target.value })}>
                  <option value="" disabled>Seleccionar</option>
                  {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Posición">
                <Select value={inviteForm.position} onChange={(e) => setInviteForm({ ...inviteForm, position: e.target.value })}>
                  <option value="" disabled>Seleccionar</option>
                  {DEPARTMENT_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Accesos</span>
            <Checkbox label="Configuración" checked={inviteForm.permissions.config} onChange={(v) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, config: v } })} />
            <Checkbox label="Contabilidad" checked={inviteForm.permissions.accounting} onChange={(v) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, accounting: v } })} />
            <Checkbox label="Equipo" checked={inviteForm.permissions.team} onChange={(v) => setInviteForm({ ...inviteForm, permissions: { ...inviteForm.permissions, team: v } })} />
          </div>
        </div>
      </Modal>

      {/* ── Editar accesos ── */}
      <Modal
        open={!!editingMember}
        onClose={() => setEditingMember(null)}
        title={editingMember ? `Accesos de ${editingMember.name}` : "Accesos"}
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingMember(null)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={handleUpdatePermissions}>Guardar</Button>
          </>
        }
      >
        <Checkbox label="Configuración" hint="Datos del proyecto, usuarios y departamentos" checked={editPermissions.config} onChange={(v) => setEditPermissions({ ...editPermissions, config: v })} />
        <Checkbox label="Contabilidad" hint="Órdenes de compra, facturas, pagos y presupuesto" checked={editPermissions.accounting} onChange={(v) => setEditPermissions({ ...editPermissions, accounting: v })} />
        <Checkbox label="Equipo" hint="Crew, calendario, nóminas y control horario" checked={editPermissions.team} onChange={(v) => setEditPermissions({ ...editPermissions, team: v })} />
      </Modal>

      {/* ── Quitar del proyecto ── */}
      <Modal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        title="Quitar del proyecto"
        width="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>Cancelar</Button>
            <Button variant="danger" loading={saving} onClick={async () => { if (confirmRemove) await handleRemoveMember(confirmRemove.userId); setConfirmRemove(null); }}>Quitar</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600"><span className="font-medium text-slate-900">{confirmRemove?.name}</span> dejará de tener acceso al proyecto.</p>
      </Modal>
    </Page>
  );
}
