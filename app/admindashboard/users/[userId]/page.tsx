"use client";

// ─── Admin · Ficha 360º de usuario ───────────────────────────────────────────
// Todo de una persona en una página: sus proyectos y rol en cada uno, último
// acceso, emails recibidos (con su estado), soporte, eventos de seguridad y
// borradores de Budgeting. Acciones de cuenta: Ver como (solo lectura),
// restablecer contraseña, verificar o cambiar email, cerrar sesiones,
// exportar datos (RGPD), suspender y eliminar.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { ArrowLeft, Eye, MoreHorizontal, Star } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Badge, Button, DataList, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select, useToast } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { RoleModal } from "@/components/admin/RoleModal";
import { adminFetch, BlockTitle, MiniEmpty, downloadJson, fmtDate, PHASE_DOT, ROLE_LABEL, RowBar, timeAgo } from "@/components/admin/ui";
import { EMAIL_STATUS } from "@/components/admin/emailStatus";

interface AuthInfo { exists: boolean; emailVerified: boolean; disabled: boolean; lastSignInTime: string | null; creationTime: string | null; providers: string[] }
interface MailRow { id: string; subject: string; template: string; status: string; createdAt: { toMillis: () => number } | null }
interface TicketRow { id: string; ticketNumber?: number; lastMessage?: string; closedAt?: { toMillis: () => number } | null; rating?: number; open?: boolean }
interface SecRow { id: string; type: string; details?: string; createdAt: { toMillis: () => number } | null }
interface DraftRow { id: string; name: string; status: string; updatedAt: { toMillis: () => number } | null }

const SEC_LABEL: Record<string, string> = {
  rate_limited: "Bloqueado por límite", pin_failed: "Código fallido", access_denied: "Acceso denegado",
  impersonation_start: "Un admin entró con «Ver como»", impersonation_end: "Fin de «Ver como»", account_suspended: "Cuenta suspendida",
  account_reactivated: "Cuenta reactivada", sessions_revoked: "Sesiones cerradas", email_changed: "Email cambiado", data_exported: "Datos exportados",
};

type Action = null | "impersonate" | "suspend" | "reactivate" | "revoke" | "delete" | "export";

function UserInner() {
  const { userId } = useParams() as { userId: string };
  const router = useRouter();
  const params = useSearchParams();
  const { user: me } = useUser();
  const { loading, userById, projectById, producers, producerById, reload } = useAdminData();
  const u = userById(userId);
  const [toast, showToast] = useToast();
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [mails, setMails] = useState<MailRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [security, setSecurity] = useState<SecRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [memberships, setMemberships] = useState<Record<string, { role?: string; position?: string; department?: string }>>({});
  const [action, setAction] = useState<Action>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");

  useEffect(() => {
    const a = params.get("action") as Action;
    if (params.get("impersonate") === "1") setAction("impersonate");
    else if (a) setAction(a);
  }, [params]);

  const loadExtra = useCallback(async () => {
    if (!u) return;
    adminFetch<AuthInfo>("/api/admin/users", { uid: userId, action: "info" }).then(setInfo).catch(() => {});
    const [mailSnap, chatSnap, archSnap, secSnap, upSnap, draftSnap] = await Promise.all([
      u.email ? getDocs(query(collection(db, "emailLog"), where("to", "array-contains", u.email), limit(60))).catch(() => null) : Promise.resolve(null),
      getDoc(doc(db, "supportChats", userId)).catch(() => null),
      getDocs(query(collection(db, "supportArchive"), where("userId", "==", userId), limit(50))).catch(() => null),
      getDocs(query(collection(db, "securityEvents"), where("uid", "==", userId), limit(50))).catch(() => null),
      getDocs(collection(db, `userProjects/${userId}/projects`)).catch(() => null),
      getDocs(collection(db, `userBudgetingDrafts/${userId}/drafts`)).catch(() => null),
    ]);
    const byTime = <T extends { createdAt?: { toMillis: () => number } | null; closedAt?: { toMillis: () => number } | null }>(a: T, b: T) =>
      ((b.createdAt || b.closedAt)?.toMillis() ?? 0) - ((a.createdAt || a.closedAt)?.toMillis() ?? 0);
    setMails((mailSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as MailRow)).sort(byTime));
    const t: TicketRow[] = (archSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as TicketRow));
    if (chatSnap?.exists()) t.unshift({ id: chatSnap.id, ...chatSnap.data(), open: true } as TicketRow);
    setTickets(t.sort((a, b) => (a.open ? -1 : b.open ? 1 : byTime(a, b))));
    setSecurity((secSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as SecRow)).sort(byTime));
    setMemberships(Object.fromEntries((upSnap?.docs || []).map((d) => [d.id, d.data()])));
    setDrafts((draftSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as DraftRow)));
  }, [u, userId]);

  useEffect(() => { loadExtra(); }, [loadExtra]);

  const months = useMemo(() => {
    const out: { key: string; label: string; on: boolean }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ key, label: d.toLocaleDateString("es-ES", { month: "short" }), on: !!u?.activeMonths.includes(key) });
    }
    return out;
  }, [u]);

  if (loading) return <PageLoading />;
  if (!u) return <Page><PageHeader title="Usuario no encontrado" /><div className="mt-6"><Link href="/admindashboard/users" className="text-[13px] text-slate-600 hover:text-slate-900">← Volver a usuarios</Link></div></Page>;

  const isSelf = u.id === me?.uid;
  const run = async (act: string, extra: Record<string, unknown> = {}, ok = "Hecho") => {
    await adminFetch("/api/admin/users", { uid: u.id, action: act, ...extra });
    showToast("success", ok);
    reload(); loadExtra();
  };
  const simple = async (act: string, ok: string) => { try { await run(act, {}, ok); } catch (e) { showToast("error", (e as Error).message); } };

  const toggleBudgeting = async () => {
    try { await updateDoc(doc(db, "users", u.id), { budgetingAccess: !u.budgetingAccess }); showToast("success", u.budgetingAccess ? "Budgeting retirado" : "Budgeting concedido"); reload(); }
    catch { showToast("error", "No se pudo cambiar"); }
  };
  const saveAccount = async () => {
    try { await updateDoc(doc(db, "users", u.id), { companyId: accountId || null }); showToast("success", "Cuenta actualizada"); setAccountOpen(false); reload(); }
    catch { showToast("error", "No se pudo cambiar"); }
  };

  return (
    <Page>
      {toast}
      <Link href="/admindashboard/users" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Usuarios</Link>
      <PageHeader
        title={
          <>
            {u.name}
            <span className="ml-1 flex items-center gap-1.5">
              <Badge>{ROLE_LABEL[u.role]}</Badge>
              {u.isDemo && <Badge tone="info">Demo</Badge>}
              {u.suspended && <Badge tone="danger">Suspendido</Badge>}
              {u.budgetingAccess && <Badge tone="warning">Budgeting</Badge>}
            </span>
          </>
        }
        actions={
          <>
            {u.role === "user" && !u.suspended && <Button onClick={() => setAction("impersonate")}><Eye size={14} /> Ver como</Button>}
            <Menu trigger={(t) => <IconButton label="Acciones" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  {!isSelf && <MenuItem onClick={() => { close(); setRoleOpen(true); }}>Cambiar rol…</MenuItem>}
                  <MenuItem onClick={() => { close(); toggleBudgeting(); }}>{u.budgetingAccess ? "Quitar Budgeting" : "Dar acceso a Budgeting"}</MenuItem>
                  <MenuItem onClick={() => { close(); setAccountId(u.companyId || ""); setAccountOpen(true); }}>Asignar a una cuenta…</MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => { close(); simple("send-reset", "Email para restablecer la contraseña enviado"); }}>Enviar restablecer contraseña</MenuItem>
                  {info && !info.emailVerified && <MenuItem onClick={() => { close(); simple("verify-email", "Email marcado como verificado"); }}>Marcar email como verificado</MenuItem>}
                  <MenuItem onClick={() => { close(); setNewEmail(u.email); setEmailOpen(true); }}>Cambiar email…</MenuItem>
                  <MenuItem onClick={() => { close(); setAction("revoke"); }}>Cerrar todas sus sesiones…</MenuItem>
                  <MenuItem onClick={() => { close(); setAction("export"); }}>Exportar sus datos (RGPD)…</MenuItem>
                  {!isSelf && (
                    <>
                      <MenuSeparator />
                      <MenuItem onClick={() => { close(); setAction(u.suspended ? "reactivate" : "suspend"); }}>{u.suspended ? "Reactivar cuenta…" : "Suspender cuenta…"}</MenuItem>
                      <MenuItem danger onClick={() => { close(); setAction("delete"); }}>Eliminar usuario…</MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
          </>
        }
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <section>
            <BlockTitle count={u.projectIds.length}>Proyectos</BlockTitle>
            {u.projectIds.length === 0 ? <MiniEmpty>No está en ningún proyecto</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Proyecto</th><th className="w-40 px-3">Rol</th><th className="w-36 px-3">Departamento</th><th className="w-36 px-3">Fase</th></tr></thead>
                <tbody>
                  {u.projectIds.map((id) => {
                    const p = projectById(id);
                    const m = p?.members.find((x) => x.uid === u.id);
                    const up = memberships[id] || {};
                    return (
                      <tr key={id} onClick={() => router.push(`/admindashboard/project/${id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                        <td className="py-1.5 pl-4 pr-3"><div className="truncate font-medium text-slate-900">{p?.name || id}</div></td>
                        <td className="px-3 text-slate-600">{m?.role || m?.position || up.role || up.position || "—"}</td>
                        <td className="px-3 text-slate-600">{m?.department || up.department || "—"}</td>
                        <td className="px-3"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_DOT[p?.phase || ""] || "#94A3B8" }} />{p?.phase || "—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <BlockTitle count={mails.length} action={<Link href={`/admindashboard/emails?q=${encodeURIComponent(u.email)}`} className="text-xs text-slate-500 hover:text-slate-900">Centro de emails →</Link>}>Emails recibidos</BlockTitle>
            {mails.length === 0 ? <MiniEmpty>Sin emails registrados</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <tbody>
                  {mails.slice(0, 12).map((m) => {
                    const st = EMAIL_STATUS[m.status] || EMAIL_STATUS.sent;
                    return (
                      <tr key={m.id} onClick={() => router.push(`/admindashboard/emails?open=${m.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                        <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={st.tone} /><div className="truncate text-slate-900">{m.subject}</div></td>
                        <td className="w-32 px-3 text-slate-600">{st.label}</td>
                        <td className="w-32 px-3 text-slate-500">{timeAgo(m.createdAt?.toMillis())}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <BlockTitle count={tickets.length}>Soporte</BlockTitle>
            {tickets.length === 0 ? <MiniEmpty>Nunca ha escrito a soporte</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <tbody>
                  {tickets.map((t) => (
                    <tr key={t.id} onClick={() => router.push("/admindashboard/support")} className="cursor-pointer hover:bg-[#FAFAFA]">
                      <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={t.open ? "warn" : "none"} /><div className="truncate text-slate-900">{t.ticketNumber ? `#${String(t.ticketNumber).padStart(5, "0")} · ` : ""}{t.lastMessage || "—"}</div></td>
                      <td className="w-28 px-3">{t.rating ? <span className="flex items-center gap-1 text-amber-700"><Star size={11} className="fill-amber-400 text-amber-400" />{t.rating}/5</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="w-32 px-3 text-slate-500">{t.open ? "Abierto" : timeAgo(t.closedAt?.toMillis())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {(security.length > 0) && (
            <section>
              <BlockTitle count={security.length}>Seguridad</BlockTitle>
              <table className="tbl w-full table-fixed text-[13px]">
                <tbody>
                  {security.slice(0, 15).map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 pl-4 pr-3"><div className="truncate text-slate-900">{SEC_LABEL[s.type] || s.type}{s.details ? <span className="ml-2 text-slate-500">{s.details}</span> : null}</div></td>
                      <td className="w-32 px-3 text-slate-500">{timeAgo(s.createdAt?.toMillis())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {u.budgetingAccess && (
            <section>
              <BlockTitle count={drafts.length}>Presupuestos de Budgeting</BlockTitle>
              {drafts.length === 0 ? <MiniEmpty>Sin borradores</MiniEmpty> : (
                <table className="tbl w-full table-fixed text-[13px]">
                  <tbody>
                    {drafts.map((d) => (
                      <tr key={d.id}>
                        <td className="py-1.5 pl-4 pr-3"><div className="truncate text-slate-900">{d.name || "Sin nombre"}</div></td>
                        <td className="w-32 px-3 text-slate-600">{d.status === "sent" ? "Enviado" : "Borrador"}</td>
                        <td className="w-32 px-3 text-slate-500">{timeAgo(d.updatedAt?.toMillis())}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-8">
          <section>
            <BlockTitle>Cuenta</BlockTitle>
            <DataList columns={2} items={[
              { label: "Email", value: <span title={u.email}>{u.email}</span> },
              { label: "Teléfono", value: u.phone },
              { label: "Cuenta", value: u.companyId ? <Link className="hover:underline" href={`/admindashboard/accounts/${u.companyId}`}>{producerById(u.companyId)?.name || u.companyId}</Link> : undefined },
              { label: "Email verificado", value: info ? (info.emailVerified ? "Sí" : "No") : "…" },
              { label: "Alta", value: fmtDate(u.createdAt) },
              { label: "Último acceso", value: u.lastSeenAt ? timeAgo(u.lastSeenAt) : "Sin datos" },
              { label: "Último inicio de sesión", value: info?.lastSignInTime ? timeAgo(new Date(info.lastSignInTime)) : "—" },
              { label: "Estado", value: u.suspended || info?.disabled ? <span className="text-red-600">Suspendida</span> : "Activa" },
            ]} />
          </section>
          <section>
            <BlockTitle>Meses con actividad</BlockTitle>
            <div className="flex gap-1">
              {months.map((m) => (
                <div key={m.key} className="flex flex-1 flex-col items-center gap-1" title={`${m.key}${m.on ? ": activo" : ""}`}>
                  <span className={`h-6 w-full rounded-sm ${m.on ? "bg-slate-800" : "bg-slate-100"}`} />
                  <span className="text-[9.5px] text-slate-400">{m.label.slice(0, 1).toUpperCase()}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Se registra desde la publicación de esta versión.</p>
          </section>
        </aside>
      </div>

      {/* Acciones */}
      <ConfirmModal
        open={action === "impersonate"}
        onClose={() => setAction(null)}
        title={`Ver Filma como ${u.name}`}
        danger={false}
        confirmLabel="Entrar en solo lectura"
        notice={<>Verás exactamente lo que ve {u.name.split(" ")[0]}, sin poder cambiar nada. Queda registrado en la auditoría. Para volver, pulsa «Volver a mi cuenta» en la barra inferior.</>}
        onConfirm={async () => {
          const { token } = await adminFetch<{ token: string }>("/api/admin/impersonate", { uid: u.id });
          await signInWithCustomToken(auth, token);
          window.location.href = "/dashboard";
        }}
      />
      <ConfirmModal
        open={action === "suspend"}
        onClose={() => setAction(null)}
        title={`Suspender a ${u.name}`}
        confirmLabel="Suspender cuenta"
        notice="No podrá iniciar sesión y se cerrarán sus sesiones abiertas. Sus datos y proyectos no se tocan; puedes reactivarla cuando quieras."
        reason={{ label: "Motivo (queda en la auditoría)", placeholder: "Opcional" }}
        onConfirm={async (reason) => { await run("suspend", { reason }, "Cuenta suspendida"); }}
      />
      <ConfirmModal
        open={action === "reactivate"}
        onClose={() => setAction(null)}
        title={`Reactivar a ${u.name}`}
        danger={false}
        password={false}
        confirmLabel="Reactivar cuenta"
        onConfirm={async () => { await run("reactivate", {}, "Cuenta reactivada"); }}
      />
      <ConfirmModal
        open={action === "revoke"}
        onClose={() => setAction(null)}
        title="Cerrar todas sus sesiones"
        danger={false}
        password={false}
        confirmLabel="Cerrar sesiones"
        notice="Tendrá que volver a iniciar sesión en todos sus dispositivos (en menos de una hora)."
        onConfirm={async () => { await run("revoke", {}, "Sesiones cerradas"); }}
      />
      <ConfirmModal
        open={action === "export"}
        onClose={() => setAction(null)}
        title="Exportar sus datos"
        danger={false}
        confirmLabel="Descargar JSON"
        notice="Perfil, cuenta, proyectos y permisos, soporte, emails recibidos y borradores de Budgeting, en un archivo. Queda registrado."
        onConfirm={async () => {
          const { data } = await adminFetch<{ data: unknown }>("/api/admin/users", { uid: u.id, action: "export" });
          downloadJson(`datos_${u.email || u.id}_${new Date().toISOString().slice(0, 10)}.json`, data);
          showToast("success", "Datos exportados");
        }}
      />
      <ConfirmModal
        open={action === "delete"}
        onClose={() => setAction(null)}
        title={`Eliminar a ${u.name}`}
        confirmLabel="Eliminar usuario"
        notice="Se borra su cuenta, su perfil, su acceso a los proyectos, sus invitaciones, su historial de soporte y sus borradores de Budgeting. No se puede deshacer. Si solo quieres impedirle el acceso, suspende la cuenta."
        onConfirm={async () => {
          await adminFetch("/api/delete-user", { uid: u.id });
          await reload();
          router.push("/admindashboard/users");
        }}
      />

      <RoleModal user={roleOpen ? u : null} onClose={() => setRoleOpen(false)} onDone={(m) => { showToast("success", m); reload(); }} />

      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="Cambiar email"
        footer={<><Button variant="ghost" onClick={() => setEmailOpen(false)}>Cancelar</Button><Button variant="primary" disabled={!newEmail.trim() || newEmail.trim() === u.email} onClick={() => { setEmailOpen(false); setAction(null); setPendingEmail(newEmail.trim()); }}>Continuar</Button></>}>
        <Field label="Nuevo email" hint="Con el que iniciará sesión a partir de ahora. Se actualiza también en sus proyectos.">
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoFocus />
        </Field>
      </Modal>
      <ConfirmModal
        open={!!pendingEmail}
        onClose={() => setPendingEmail("")}
        title="Confirmar cambio de email"
        danger={false}
        confirmLabel="Cambiar email"
        notice={<>{u.name} pasará de <strong>{u.email}</strong> a <strong>{pendingEmail}</strong>.</>}
        onConfirm={async () => { await run("change-email", { email: pendingEmail }, "Email cambiado"); }}
      />

      <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title="Cuenta del usuario"
        footer={<><Button variant="ghost" onClick={() => setAccountOpen(false)}>Cancelar</Button><Button variant="primary" onClick={saveAccount}>Guardar</Button></>}>
        <Field label="Cuenta (productora)" hint="Da acceso al panel de la productora con todos sus proyectos.">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Ninguna</option>
            {producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </Modal>
    </Page>
  );
}

export default function UserPage() {
  return <Suspense fallback={<PageLoading />}><UserInner /></Suspense>;
}
