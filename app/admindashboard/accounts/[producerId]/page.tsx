"use client";

// ─── Admin · Ficha de cuenta ─────────────────────────────────────────────────
// Productora → proyectos (con su salud) → usuarios, plan y límites con su uso,
// actividad y notas internas (CRM ligero: llamadas, acuerdos, incidencias).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Badge, Button, DataList, Field, IconButton, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Select, Textarea, useToast } from "@/components/ds";
import { healthLabel, useAdminData } from "@/components/admin/AdminData";
import { AccountFormModal } from "@/components/admin/AccountFormModal";
import { accountActivity } from "@/components/admin/accountRisk";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { BlockTitle, MiniEmpty, fmtDate, HealthMeter, PHASE_DOT, ROLE_LABEL, RowBar, timeAgo } from "@/components/admin/ui";

interface Note { id: string; text: string; authorName: string; createdAt: Timestamp | null }

export default function AccountPage() {
  const { producerId } = useParams() as { producerId: string };
  const router = useRouter();
  const { user: me } = useUser();
  const { loading, producerById, producers, projects, users, stats, reload } = useAdminData();
  const a = producerById(producerId);
  const [toast, showToast] = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [addUser, setAddUser] = useState(false);
  const [userToAdd, setUserToAdd] = useState("");
  const [del, setDel] = useState(false);

  const loadNotes = useCallback(async () => {
    const snap = await getDocs(query(collection(db, `producers/${producerId}/notes`), orderBy("createdAt", "desc"))).catch(() => null);
    setNotes((snap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as Note)));
  }, [producerId]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const own = useMemo(() => projects.filter((p) => p.producers.includes(producerId) && !p.trashedAt), [projects, producerId]);
  const people = useMemo(() => users.filter((u) => u.companyId === producerId), [users, producerId]);
  const crewTotal = useMemo(() => new Set(own.flatMap((p) => p.members.map((m) => m.uid))).size, [own]);

  if (loading) return <PageLoading />;
  if (!a) return <Page><PageHeader title="Cuenta no encontrada" /><Link href="/admindashboard/accounts" className="mt-6 inline-block text-[13px] text-slate-600">← Volver</Link></Page>;

  const act = accountActivity(a, projects, stats);
  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await addDoc(collection(db, `producers/${producerId}/notes`), { text: note.trim(), authorId: me?.uid, authorName: me?.name || me?.email || "Admin", createdAt: serverTimestamp() });
      setNote(""); loadNotes();
    } catch { showToast("error", "No se pudo guardar la nota"); }
  };
  const removeNote = async (id: string) => { await deleteDoc(doc(db, `producers/${producerId}/notes/${id}`)).catch(() => {}); loadNotes(); };
  const assign = async () => {
    if (!userToAdd) return;
    try { await updateDoc(doc(db, "users", userToAdd), { companyId: producerId }); setAddUser(false); setUserToAdd(""); showToast("success", "Usuario añadido a la cuenta"); reload(); }
    catch { showToast("error", "No se pudo añadir"); }
  };
  const unassign = async (uid: string) => {
    try { await updateDoc(doc(db, "users", uid), { companyId: null }); showToast("success", "Usuario quitado de la cuenta"); reload(); }
    catch { showToast("error", "No se pudo quitar"); }
  };
  const grantBudgeting = async () => {
    await Promise.all(people.filter((u) => !u.budgetingAccess).map((u) => updateDoc(doc(db, "users", u.id), { budgetingAccess: true }).catch(() => {})));
    showToast("success", "Budgeting activado para los usuarios de la cuenta"); reload();
  };

  const mods = [a.modules?.accounting !== false && "Contabilidad", a.modules?.team !== false && "Equipo", a.modules?.budgeting && "Budgeting"].filter(Boolean).join(", ");

  return (
    <Page>
      {toast}
      <Link href="/admindashboard/accounts" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Cuentas</Link>
      <PageHeader
        title={<>{a.name}<span className="ml-1 flex gap-1.5"><Badge>{a.plan || "Sin plan"}</Badge><Badge tone={act.risk.tone === "bad" ? "danger" : act.risk.tone === "warn" ? "warning" : act.risk.tone === "ok" ? "success" : "neutral"}>{act.risk.label}</Badge></span></>}
        actions={
          <>
            <Button onClick={() => setEditOpen(true)}><Pencil size={13} /> Editar</Button>
            <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); window.open(`/companydashboard/${a.id}`, "_blank"); }}>Abrir su panel de productora</MenuItem>
                  {people.length > 0 && <MenuItem onClick={() => { close(); grantBudgeting(); }}>Dar Budgeting a todos sus usuarios</MenuItem>}
                  <MenuSeparator />
                  <MenuItem danger onClick={() => { close(); if (own.length) showToast("error", "Tiene proyectos asignados: quítaselos antes"); else setDel(true); }}>Eliminar cuenta…</MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <section>
            <BlockTitle count={own.length}>Proyectos</BlockTitle>
            {own.length === 0 ? <MiniEmpty>Sin proyectos</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Proyecto</th><th className="w-36 px-3">Fase</th><th className="w-24 px-3 text-right">Miembros</th><th className="w-32 px-3">Actividad</th><th className="w-32 px-3">Salud</th></tr></thead>
                <tbody>
                  {own.map((p) => {
                    const h = healthLabel(stats[p.id]?.health, p.phase);
                    return (
                      <tr key={p.id} onClick={() => router.push(`/admindashboard/project/${p.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                        <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={h.tone} /><div className="truncate font-medium text-slate-900">{p.name}</div></td>
                        <td className="px-3"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_DOT[p.phase] }} />{p.phase}</span></td>
                        <td className="px-3 text-right tabular-nums">{p.members.length}</td>
                        <td className="px-3 text-slate-600">{stats[p.id]?.lastActivityAt ? timeAgo(stats[p.id].lastActivityAt) : "—"}</td>
                        <td className="px-3"><HealthMeter value={p.phase === "Finalizado" ? undefined : stats[p.id]?.health} tone={h.tone} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <BlockTitle count={people.length} action={<Button size="sm" onClick={() => setAddUser(true)}><Plus size={13} /> Añadir</Button>}>Usuarios de la cuenta</BlockTitle>
            {people.length === 0 ? <MiniEmpty>Nadie tiene acceso al panel de esta productora</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <tbody>
                  {people.map((u) => (
                    <tr key={u.id} onClick={() => router.push(`/admindashboard/users/${u.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                      <td className="py-1.5 pl-4 pr-3"><div className="truncate font-medium text-slate-900">{u.name}</div><div className="truncate text-xs text-slate-500">{u.email}</div></td>
                      <td className="w-28 px-3 text-slate-600">{ROLE_LABEL[u.role]}</td>
                      <td className="w-36 px-3 text-slate-600">{u.lastSeenAt ? timeAgo(u.lastSeenAt) : "—"}</td>
                      <td className="w-10 px-1" onClick={(e) => e.stopPropagation()}><IconButton label="Quitar de la cuenta" onClick={() => unassign(u.id)}><Trash2 size={13} /></IconButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <BlockTitle count={notes.length}>Notas internas</BlockTitle>
            <div className="flex gap-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Llamada, acuerdo, incidencia… (solo lo ven los admins)" className="flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addNote(); }} />
              <Button variant="primary" onClick={addNote} disabled={!note.trim()}>Añadir</Button>
            </div>
            <div className="mt-4 space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="group flex gap-3 border-l-2 border-slate-200 pl-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-[13px] text-slate-800">{n.text}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{n.authorName} · {fmtDate(n.createdAt, true)}</p>
                  </div>
                  <IconButton label="Borrar nota" onClick={() => removeNote(n.id)} className="opacity-0 group-hover:opacity-100"><Trash2 size={13} /></IconButton>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-8">
          <section>
            <BlockTitle>Plan</BlockTitle>
            <DataList columns={2} items={[
              { label: "Plan", value: a.plan || "Sin plan" },
              { label: "Módulos", value: mods || "Ninguno" },
              { label: "Proyectos", value: `${own.length}${a.maxProjects ? ` de ${a.maxProjects}` : ""}` },
              { label: "Usuarios de cuenta", value: `${people.length}${a.maxUsers ? ` de ${a.maxUsers}` : ""}` },
              { label: "Personas en proyectos", value: crewTotal },
              { label: "Renovación", value: a.renewalAt ? `${fmtDate(a.renewalAt)} (${timeAgo(a.renewalAt)})` : undefined },
              { label: "Cliente desde", value: fmtDate(a.createdAt) },
            ]} />
            {a.maxProjects && own.length > a.maxProjects && <p className="mt-3 text-xs text-red-600">Supera su límite de proyectos.</p>}
          </section>
          <section>
            <BlockTitle>Actividad</BlockTitle>
            <DataList columns={2} items={[
              { label: "POs y facturas (30 d)", value: act.now },
              { label: "30 días anteriores", value: act.prev },
              { label: "Proyectos en curso", value: act.live },
              { label: "Tendencia", value: act.risk.label },
            ]} />
          </section>
          <section>
            <BlockTitle>Contacto</BlockTitle>
            <DataList columns={2} items={[
              { label: "Nombre", value: a.contactName },
              { label: "NIF / CIF", value: a.taxId },
              { label: "Email", value: a.contactEmail ? <a href={`mailto:${a.contactEmail}`} className="hover:underline">{a.contactEmail}</a> : undefined },
              { label: "Teléfono", value: a.contactPhone },
            ]} />
          </section>
        </aside>
      </div>

      <AccountFormModal open={editOpen} account={a} projects={projects} producers={producers} onClose={() => setEditOpen(false)} onSaved={() => { showToast("success", "Cuenta guardada"); reload(); }} />

      <Modal open={addUser} onClose={() => setAddUser(false)} title="Añadir usuario a la cuenta"
        footer={<><Button variant="ghost" onClick={() => setAddUser(false)}>Cancelar</Button><Button variant="primary" onClick={assign} disabled={!userToAdd}>Añadir</Button></>}>
        <Field label="Usuario" hint="Tendrá acceso al panel de la productora, con todos sus proyectos.">
          <Select value={userToAdd} onChange={(e) => setUserToAdd(e.target.value)}>
            <option value="" disabled>Elige un usuario</option>
            {users.filter((u) => u.companyId !== producerId && u.role === "user").map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
          </Select>
        </Field>
      </Modal>

      <ConfirmModal open={del} onClose={() => setDel(false)} title={`Eliminar ${a.name}`} confirmLabel="Eliminar cuenta"
        notice="Se borra la cuenta y sus notas. Sus usuarios dejan de tener acceso al panel de la productora."
        onConfirm={async () => {
          await Promise.all(people.map((u) => updateDoc(doc(db, "users", u.id), { companyId: null }).catch(() => {})));
          await deleteDoc(doc(db, "producers", a.id));
          await reload();
          router.push("/admindashboard/accounts");
        }} />
    </Page>
  );
}
