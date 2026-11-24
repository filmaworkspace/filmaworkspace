"use client";

// ─── Admin · Demos ───────────────────────────────────────────────────────────
// Enlaces personales a la demo guiada: quien lo abre entra en un proyecto de
// ejemplo con datos ficticios, con su propio usuario desechable. Solo lo ve
// quien recibe el enlace; caduca y se puede revocar.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, MoreHorizontal, Plus } from "lucide-react";
import { Button, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Textarea } from "@/components/ds";
import { adminFetch, Pills, RowBar } from "@/components/admin/ui";
import { useUser } from "@/contexts/UserContext";
import { toast } from "@/lib/toast";

interface DemoLink {
  id: string; name: string; email: string | null; note: string; status: "active" | "revoked" | "expired"; createdByName: string; senderName: string;
  createdAt: string | null; expiresAt: string | null; firstOpenedAt: string | null; lastOpenedAt: string | null; opens: number; projectId: string | null; sentAt: string | null;
}
type Filter = "all" | "active" | "used" | "ended";

const d = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : "—");
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const stateOf = (l: DemoLink) => (l.status === "revoked" ? "revoked" : l.expiresAt && new Date(l.expiresAt) < new Date() ? "expired" : l.firstOpenedAt ? "used" : "pending");
const STATE = {
  pending: { label: "Sin abrir", tone: "none" as const, cls: "text-slate-600" },
  used: { label: "En uso", tone: "ok" as const, cls: "text-slate-900" },
  expired: { label: "Caducada", tone: "none" as const, cls: "text-slate-500" },
  revoked: { label: "Revocada", tone: "bad" as const, cls: "text-red-700" },
};

export default function AdminDemosPage() {
  const [links, setLinks] = useState<DemoLink[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState(false);
  const { user } = useUser();
  const [form, setForm] = useState({ name: "", email: "", days: "14", note: "", senderName: "" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; sent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState<DemoLink | null>(null);

  const load = useCallback(() => adminFetch<{ links: DemoLink[] }>("/api/admin/demo-links", undefined, "GET").then((r) => setLinks(r.links)).catch((e) => { toast.error(e); setLinks([]); }), []);
  useEffect(() => { load(); }, [load]);

  const create = async (send: boolean) => {
    setBusy(true);
    try {
      const r = await adminFetch<{ url: string }>("/api/admin/demo-links", { ...form, days: Number(form.days), send });
      setCreated({ url: r.url, sent: send });
      await load();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const copy = (url: string) => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const doRevoke = async () => {
    if (!revoke) return;
    try { await adminFetch("/api/admin/demo-links", { id: revoke.id, action: "revoke" }, "PATCH"); toast.success("Enlace revocado"); setRevoke(null); load(); } catch (e) { toast.error(e); }
  };

  if (!links) return <PageLoading />;
  const counts = { all: links.length, active: links.filter((l) => ["pending", "used"].includes(stateOf(l))).length, used: links.filter((l) => !!l.firstOpenedAt).length, ended: links.filter((l) => ["expired", "revoked"].includes(stateOf(l))).length };
  const rows = links.filter((l) => {
    const s = stateOf(l);
    return filter === "all" || (filter === "active" && (s === "pending" || s === "used")) || (filter === "used" && !!l.firstOpenedAt) || (filter === "ended" && (s === "expired" || s === "revoked"));
  });

  return (
    <Page>
      <PageHeader title={<>Demos <span className="text-[15px] font-normal text-slate-400">{links.length}</span></>}
        actions={<Button variant="primary" onClick={() => { setForm({ name: "", email: "", days: "14", note: "", senderName: user?.name || "" }); setCreated(null); setModal(true); }}><Plus size={14} /> Nuevo enlace</Button>} />

      <div className="mt-6">
        <Pills value={filter} onChange={setFilter} options={[
          { value: "all", label: "Todos", count: counts.all }, { value: "active", label: "Activos", count: counts.active },
          { value: "used", label: "Abiertos", count: counts.used }, { value: "ended", label: "Cerrados", count: counts.ended },
        ]} />
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title={links.length ? "Sin resultados" : "Sin enlaces de demo"} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-600">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Para</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Estado</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Creado</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Caduca</th>
                  <th scope="col" className="w-40 px-3 py-2 text-left font-medium">Último acceso</th>
                  <th scope="col" className="w-20 px-3 py-2 text-right font-medium">Accesos</th>
                  <th scope="col" className="w-12 py-2 pr-3"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const s = STATE[stateOf(l)];
                  return (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                      <td className="relative px-4 py-1.5">
                        <RowBar tone={s.tone} />
                        <p className="font-medium text-slate-900">{l.name}</p>
                        <p className="text-xs text-slate-500">{l.email || "Sin email"}{l.sentAt ? ` · enviado por email${l.senderName ? ` en nombre de ${l.senderName}` : ""}` : ""}{l.note ? ` · ${l.note}` : ""}</p>
                      </td>
                      <td className={`px-3 py-1.5 text-xs ${s.cls}`}>{s.label}</td>
                      <td className="px-3 py-1.5 text-slate-600" title={l.createdByName ? `Por ${l.createdByName}` : undefined}>{d(l.createdAt)}</td>
                      <td className="px-3 py-1.5 text-slate-600">{d(l.expiresAt)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-slate-600">{dt(l.lastOpenedAt)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.opens}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              {l.projectId && <MenuItem onClick={() => { close(); window.location.href = `/admindashboard/project/${l.projectId}`; }}>Ver el proyecto de la demo</MenuItem>}
                              {l.status !== "revoked" && (
                                <>
                                  {l.projectId && <MenuSeparator />}
                                  <MenuItem danger onClick={() => { close(); setRevoke(l); }}>Revocar</MenuItem>
                                </>
                              )}
                              {l.status === "revoked" && !l.projectId && <MenuItem onClick={close}>Sin acciones</MenuItem>}
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">El enlace solo se muestra al crearlo. Una semana después de caducar se borran el usuario y su proyecto de ejemplo.</p>
      </div>

      {/* Nuevo enlace */}
      <Modal open={modal} onClose={() => setModal(false)} title={created ? "Enlace de demo" : "Nuevo enlace de demo"}
        footer={created ? <Button variant="primary" onClick={() => setModal(false)}>Hecho</Button> : (
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={() => create(false)} disabled={busy || !form.name.trim()}>Crear enlace</Button>
            <Button variant="primary" onClick={() => create(true)} disabled={busy || !form.name.trim() || !form.email.trim()}>{busy ? "Creando…" : "Crear y enviar"}</Button>
          </>
        )}>
        {created ? (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-700">{created.sent ? `Enviado a ${form.email}. ` : ""}Copia el enlace ahora: no se vuelve a mostrar.</p>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-[#F7F7F8] px-2.5 py-1.5">
              <span className="flex-1 truncate font-mono text-xs text-slate-800">{created.url}</span>
              <IconButton label="Copiar enlace" onClick={() => copy(created.url)}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
              <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Opcional si no lo envías" /></Field>
            </div>
            <Field label="Lo envía" hint={`Asunto: «${form.senderName.trim() || user?.name || "…"} te invita a probar Filma Workspace»`}>
              <Input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} placeholder={user?.name || "Nombre"} />
            </Field>
            <Field label="Validez">
              <Segmented value={form.days} onChange={(v) => setForm({ ...form, days: v })} options={[{ value: "7", label: "7 días" }, { value: "14", label: "14 días" }, { value: "30", label: "30 días" }]} />
            </Field>
            <Field label="Nota interna"><Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Productora, contexto…" /></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!revoke} onClose={() => setRevoke(null)} title="Revocar enlace"
        footer={<><Button variant="ghost" onClick={() => setRevoke(null)}>Cancelar</Button><Button variant="danger" onClick={doRevoke}>Revocar</Button></>}>
        <p className="text-[13px] text-slate-700">El enlace de {revoke?.name} dejará de funcionar{revoke?.projectId ? " y su usuario demo se desactivará" : ""}.</p>
      </Modal>
    </Page>
  );
}
