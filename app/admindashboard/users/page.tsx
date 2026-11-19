"use client";

// ─── Admin · Usuarios ────────────────────────────────────────────────────────
// Todos los usuarios con su último acceso, rol, cuenta y proyectos; además
// las invitaciones pendientes. Fila entera → ficha 360º del usuario.

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { Copy, MoreHorizontal, Plus } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Button, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select, useToast } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { AdminUser, STALE_INVITE_DAYS, useAdminData } from "@/components/admin/AdminData";
import { adminFetch, daysSince, downloadCsv, fmtDate, Pills, ROLE_LABEL, RowBar, timeAgo, Tone } from "@/components/admin/ui";
import { RoleModal } from "@/components/admin/RoleModal";

type Tab = "all" | "active" | "inactive" | "staff" | "demo" | "suspended" | "invites";
type F = "all" | "name" | "email" | "phone" | "project";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Nombre, email, teléfono o proyecto" },
  { value: "name", label: "Nombre", placeholder: "Nombre" },
  { value: "email", label: "Email", placeholder: "Email" },
  { value: "phone", label: "Teléfono", placeholder: "Teléfono", mono: true },
  { value: "project", label: "Proyecto", placeholder: "Nombre del proyecto" },
];

const DAY = 86_400_000;
const activityTone = (u: AdminUser): Tone => {
  if (u.suspended) return "bad";
  const d = daysSince(u.lastSeenAt);
  return d === null ? "none" : d <= 7 ? "ok" : d <= 30 ? "warn" : "none";
};

const genPassword = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5).toUpperCase() + "!1";

function UsersInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user: me } = useUser();
  const { loading, users, projects, producers, invitations, reload, projectById, producerById } = useAdminData();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || (params.get("active") ? "active" : "all"));
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("all");
  const [account, setAccount] = useState("all");
  const [budgeting, setBudgeting] = useState("all");
  const [roleFor, setRoleFor] = useState<AdminUser | null>(null);
  const [create, setCreate] = useState<null | "demo" | "agent">(null);
  const [createForm, setCreateForm] = useState({ name: "", email: "", password: "", specialty: "both" });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [createError, setCreateError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeDays = Number(params.get("active") || 30);

  const inTab = (u: AdminUser, t: Tab) => {
    const d = daysSince(u.lastSeenAt);
    return t === "all" ? true
      : t === "active" ? d !== null && d <= activeDays && !u.suspended
      : t === "inactive" ? (d === null || d > 30) && !u.suspended
      : t === "staff" ? u.role !== "user"
      : t === "demo" ? u.isDemo
      : t === "suspended" ? u.suspended
      : false;
  };

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter((u) => {
      if (!inTab(u, tab)) return false;
      if (role !== "all" && u.role !== role) return false;
      if (account !== "all" && (account === "none" ? !!u.companyId : u.companyId !== account)) return false;
      if (budgeting !== "all" && u.budgetingAccess !== (budgeting === "yes")) return false;
      if (!t) return true;
      const pj = u.projectIds.map((id) => projectById(id)?.name || "").join(" ").toLowerCase();
      const v = field === "name" ? u.name : field === "email" ? u.email : field === "phone" ? u.phone || "" : field === "project" ? pj : `${u.name} ${u.email} ${u.phone || ""} ${pj}`;
      return v.toLowerCase().includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, tab, role, account, budgeting, q, field, activeDays]);

  const invites = useMemo(() => {
    const t = q.trim().toLowerCase();
    return invitations
      .filter((i) => !t || `${i.email} ${projectById(i.projectId)?.name || ""}`.toLowerCase().includes(t))
      .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitations, q]);

  if (loading) return <PageLoading />;

  const toggleBudgeting = async (u: AdminUser) => {
    try {
      await updateDoc(doc(db, "users", u.id), { budgetingAccess: !u.budgetingAccess });
      showToast("success", !u.budgetingAccess ? "Acceso a Budgeting concedido" : "Acceso a Budgeting retirado");
      reload();
    } catch { showToast("error", "No se pudo cambiar"); }
  };

  const openCreate = (kind: "demo" | "agent") => {
    const rand = Math.random().toString(36).slice(2, 7);
    setCreateForm({ name: "", email: kind === "demo" ? `demo.${rand}@filmaworkspace.demo` : `agente.${rand}@filmaworkspace.com`, password: genPassword(), specialty: "both" });
    setCreated(null); setCreateError(""); setCreate(kind);
  };
  const doCreate = async () => {
    if (!createForm.name.trim()) { setCreateError("El nombre es obligatorio"); return; }
    setBusy(true); setCreateError("");
    try {
      await adminFetch(create === "demo" ? "/api/create-demo-user" : "/api/create-support-agent", { name: createForm.name.trim(), email: createForm.email, password: createForm.password, ...(create === "agent" ? { specialty: createForm.specialty } : {}) });
      setCreated({ email: createForm.email, password: createForm.password });
      reload();
    } catch (e) { setCreateError((e as Error).message); } finally { setBusy(false); }
  };

  const cancelInvite = async (id: string) => {
    try { await deleteDoc(doc(db, "invitations", id)); showToast("success", "Invitación cancelada"); reload(); }
    catch { showToast("error", "No se pudo cancelar"); }
  };

  const exportCsv = () => downloadCsv(`usuarios_${new Date().toISOString().slice(0, 10)}.csv`, [
    ["Nombre", "Email", "Teléfono", "Rol", "Cuenta", "Proyectos", "Último acceso", "Alta", "Budgeting", "Suspendido"],
    ...rows.map((u) => [u.name, u.email, u.phone, ROLE_LABEL[u.role], producerById(u.companyId || "")?.name, u.projectIds.map((id) => projectById(id)?.name).join(" | "), u.lastSeenAt ? u.lastSeenAt.toDate().toISOString() : "", u.createdAt ? u.createdAt.toDate().toISOString() : "", u.budgetingAccess ? "Sí" : "No", u.suspended ? "Sí" : "No"]),
  ]);

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Usuarios <span className="text-[15px] font-normal text-slate-400">{users.length}</span></>}
        actions={
          <>
            <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); exportCsv(); }}>Exportar CSV</MenuItem>
                  <MenuItem onClick={() => { close(); openCreate("agent"); }}>Crear agente de soporte</MenuItem>
                </>
              )}
            </Menu>
            <Button variant="primary" onClick={() => openCreate("demo")}><Plus size={14} /> Usuario demo</Button>
          </>
        }
      />

      <div className="mt-6">
        <Pills value={tab} onChange={setTab} label="Grupo" options={[
          { value: "all", label: "Todos", count: users.length },
          { value: "active", label: `Activos ${activeDays} d`, count: users.filter((u) => inTab(u, "active")).length },
          { value: "inactive", label: "Inactivos", count: users.filter((u) => inTab(u, "inactive")).length },
          { value: "staff", label: "Admin y soporte", count: users.filter((u) => inTab(u, "staff")).length },
          { value: "demo", label: "Demo", count: users.filter((u) => u.isDemo).length },
          { value: "suspended", label: "Suspendidos", count: users.filter((u) => u.suspended).length },
          { value: "invites", label: "Invitaciones", count: invitations.length },
        ]} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={tab === "invites" ? invites.length : rows.length} />
        {tab !== "invites" && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="w-36"><Select value={role} onChange={(e) => setRole(e.target.value)}><option value="all">Todos los roles</option><option value="user">Usuario</option><option value="admin">Admin</option><option value="support_agent">Soporte</option></Select></div>
            <div className="w-44"><Select value={account} onChange={(e) => setAccount(e.target.value)}><option value="all">Todas las cuentas</option><option value="none">Sin cuenta</option>{producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
            <div className="w-40"><Select value={budgeting} onChange={(e) => setBudgeting(e.target.value)}><option value="all">Budgeting: todos</option><option value="yes">Con Budgeting</option><option value="no">Sin Budgeting</option></Select></div>
          </div>
        )}
      </div>

      {tab === "invites" ? (
        invites.length === 0 ? <div className="mt-4"><EmptyState title="No hay invitaciones pendientes" /></div> : (
          <table className="tbl mt-4 w-full table-fixed text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="py-2 pl-4 pr-3">Email</th>
                <th className="w-72 px-3">Proyecto</th>
                <th className="w-40 px-3">Enviada</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => {
                const stale = (i.createdAt?.toMillis?.() ?? Date.now()) < Date.now() - STALE_INVITE_DAYS * DAY;
                return (
                  <tr key={i.id} className="hover:bg-[#FAFAFA]">
                    <td className="relative py-2 pl-4 pr-3"><RowBar tone={stale ? "warn" : "none"} /><span className="truncate font-medium text-slate-900">{i.email}</span></td>
                    <td className="px-3 text-slate-600">{projectById(i.projectId)?.name || "Proyecto eliminado"}</td>
                    <td className={`px-3 ${stale ? "text-amber-700" : "text-slate-600"}`}>{timeAgo(i.createdAt)}</td>
                    <td className="px-1">
                      <Menu trigger={(t) => <IconButton label="Acciones" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                        {(close) => (
                          <>
                            <MenuItem onClick={() => { close(); navigator.clipboard.writeText(i.email); showToast("success", "Email copiado"); }}><Copy size={13} /> Copiar email</MenuItem>
                            {projectById(i.projectId) && <MenuItem onClick={() => { close(); router.push(`/admindashboard/project/${i.projectId}`); }}>Abrir proyecto</MenuItem>}
                            <MenuSeparator />
                            <MenuItem danger onClick={() => { close(); cancelInvite(i.id); }}>Cancelar invitación</MenuItem>
                          </>
                        )}
                      </Menu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : rows.length === 0 ? (
        <div className="mt-4"><EmptyState title="No hay usuarios con estos filtros" /></div>
      ) : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left">
              <th className="py-2 pl-4 pr-3">Usuario</th>
              <th className="w-28 px-3">Rol</th>
              <th className="w-44 px-3">Cuenta</th>
              <th className="w-24 px-3 text-right">Proyectos</th>
              <th className="w-36 px-3">Último acceso</th>
              <th className="w-32 px-3">Alta</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} onClick={() => router.push(`/admindashboard/users/${u.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                <td className="relative py-1.5 pl-4 pr-3">
                  <RowBar tone={activityTone(u)} />
                  <div className="truncate font-medium text-slate-900">
                    {u.name}
                    {u.isDemo && <span className="ml-2 text-[11px] font-normal text-violet-600">Demo</span>}
                    {u.suspended && <span className="ml-2 text-[11px] font-normal text-red-600">Suspendido</span>}
                    {u.budgetingAccess && <span className="ml-2 text-[11px] font-normal text-orange-600">Budgeting</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{u.email}</div>
                </td>
                <td className="px-3 text-slate-600">{ROLE_LABEL[u.role] || u.role}</td>
                <td className="px-3 text-slate-600">{producerById(u.companyId || "")?.name || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 text-right tabular-nums">{u.projectIds.length}</td>
                <td className="px-3 text-slate-600">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : <span className="text-slate-300">Sin datos</span>}</td>
                <td className="px-3 text-slate-600">{fmtDate(u.createdAt)}</td>
                <td className="px-1" onClick={(e) => e.stopPropagation()}>
                  <Menu trigger={(t) => <IconButton label="Acciones" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                    {(close) => (
                      <>
                        <MenuItem onClick={() => { close(); router.push(`/admindashboard/users/${u.id}`); }}>Abrir ficha</MenuItem>
                        {u.role === "user" && !u.suspended && <MenuItem onClick={() => { close(); router.push(`/admindashboard/users/${u.id}?impersonate=1`); }}>Ver como {u.name.split(" ")[0]}…</MenuItem>}
                        {u.id !== me?.uid && <MenuItem onClick={() => { close(); setRoleFor(u); }}>Cambiar rol…</MenuItem>}
                        <MenuItem onClick={() => { close(); toggleBudgeting(u); }}>{u.budgetingAccess ? "Quitar Budgeting" : "Dar acceso a Budgeting"}</MenuItem>
                        {u.id !== me?.uid && (
                          <>
                            <MenuSeparator />
                            <MenuItem onClick={() => { close(); router.push(`/admindashboard/users/${u.id}?action=${u.suspended ? "reactivate" : "suspend"}`); }}>{u.suspended ? "Reactivar…" : "Suspender…"}</MenuItem>
                            <MenuItem danger onClick={() => { close(); router.push(`/admindashboard/users/${u.id}?action=delete`); }}>Eliminar…</MenuItem>
                          </>
                        )}
                      </>
                    )}
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <RoleModal user={roleFor} onClose={() => setRoleFor(null)} onDone={(msg) => { showToast("success", msg); reload(); }} />

      <Modal
        open={!!create}
        onClose={() => setCreate(null)}
        title={create === "demo" ? "Nuevo usuario demo" : "Nuevo agente de soporte"}
        footer={created
          ? <Button variant="primary" onClick={() => setCreate(null)}>Hecho</Button>
          : <><Button variant="ghost" onClick={() => setCreate(null)}>Cancelar</Button><Button variant="primary" onClick={doCreate} disabled={busy}>{busy ? "Creando…" : "Crear"}</Button></>}
      >
        {created ? (
          <div className="flex flex-col gap-3 text-[13px]">
            <p className="text-slate-600">Cuenta creada. Copia los datos: la contraseña no se vuelve a mostrar.</p>
            <div className="rounded-md border border-slate-200 bg-[#F7F7F8] p-3 font-mono text-xs">
              <div>{created.email}</div><div>{created.password}</div>
            </div>
            <Button onClick={() => { navigator.clipboard.writeText(`${created.email}\n${created.password}`); showToast("success", "Copiado"); }}><Copy size={13} /> Copiar</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field label="Nombre"><Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} autoFocus /></Field>
            <Field label="Email"><Input value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} /></Field>
            <Field label="Contraseña"><Input value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} className="tabular-nums" /></Field>
            {create === "agent" && (
              <Field label="Especialidad">
                <Select value={createForm.specialty} onChange={(e) => setCreateForm({ ...createForm, specialty: e.target.value })}>
                  <option value="both">Ventas y técnico</option><option value="sales">Ventas</option><option value="technical">Técnico</option>
                </Select>
              </Field>
            )}
            {createError && <p className="text-xs text-red-700">{createError}</p>}
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default function UsersPage() {
  return <Suspense fallback={<PageLoading />}><UsersInner /></Suspense>;
}
