"use client";

// ─── Ficha 360º de proyecto: Resumen ─────────────────────────────────────────
// Salud desglosada, cifras, miembros con "Ver como", línea de tiempo y
// acciones de ciclo de vida: congelar, copia de seguridad, duplicar como
// plantilla, papelera (30 días) y borrado definitivo.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Archive, Check, Copy, Download, Eye, RotateCcw, Snowflake, Trash2, X } from "lucide-react";
import { Button, DataList, IconButton, useToast } from "@/components/ds";
import { healthLabel, STALE_INVITE_DAYS, useAdminData } from "./AdminData";
import { ConfirmModal } from "./ConfirmModal";
import { adminFetch, BlockTitle, MiniEmpty, downloadJson, fmtDate, HealthMeter, timeAgo } from "./ui";

const DAY = 86_400_000;
type Act = null | "freeze" | "unfreeze" | "trash" | "restore" | "purge";

export function ProjectSummary({ projectId, onClone, onChanged }: { projectId: string; onClone: () => void; onChanged: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const { projectById, userById, stats, invitations, feed, reload } = useAdminData();
  const p = projectById(projectId);
  const s = stats[projectId];
  const [toast, showToast] = useToast();
  const [act, setAct] = useState<Act>(null);
  const [backingUp, setBackingUp] = useState(false);

  useEffect(() => {
    const a = params.get("action") as Act;
    if (a) setAct(a);
  }, [params]);

  const timeline = useMemo(() => {
    if (!p) return [];
    const items: { at: number; text: string }[] = [];
    if (p.createdAt) items.push({ at: p.createdAt.toMillis(), text: "Proyecto creado" });
    feed.filter((f) => f.projectId === projectId).forEach((f) => items.push({ at: f.at, text: f.title }));
    if (p.closingAt) items.push({ at: p.closingAt.toMillis(), text: "Eliminación programada" });
    if (p.trashedAt) items.push({ at: p.trashedAt.toMillis(), text: "Movido a la papelera" });
    return items.sort((a, b) => b.at - a.at).slice(0, 12);
  }, [p, feed, projectId]);

  if (!p) return <MiniEmpty>Cargando…</MiniEmpty>;

  const h = healthLabel(s?.health, p.phase);
  const staleInvites = invitations.filter((i) => i.projectId === projectId && (i.createdAt?.toMillis?.() ?? Date.now()) < Date.now() - STALE_INVITE_DAYS * DAY).length;
  const days = s?.lastActivityAt ? (Date.now() - s.lastActivityAt) / DAY : Infinity;
  const checks: [boolean, string, string][] = [
    [days < 30, "Actividad en el último mes", s?.lastActivityAt ? `Última ${timeAgo(s.lastActivityAt)}` : "Sin actividad registrada"],
    [!!s && s.pos + s.invoices > 0, "Usa Contabilidad", s ? `${s.pos} POs · ${s.invoices} facturas` : "…"],
    [!!s && s.crew > 0, "Usa Equipo", s ? `${s.crew} personas en crew` : "…"],
    [!!s && s.horarioDays > 0, "Usa Control horario", s ? `${s.horarioDays} día${s.horarioDays === 1 ? "" : "s"}` : "…"],
    [p.members.length >= 3, "Equipo con acceso", `${p.members.length} miembro${p.members.length === 1 ? "" : "s"}`],
    [staleInvites === 0, "Invitaciones al día", staleInvites ? `${staleInvites} sin aceptar desde hace +${STALE_INVITE_DAYS} d` : "Ninguna olvidada"],
  ];

  const run = async (action: string, reason?: string) => {
    await adminFetch("/api/admin/projects", { projectId, action, reason });
    await reload();
    onChanged();
  };
  const backup = async () => {
    setBackingUp(true);
    try {
      const { backup } = await adminFetch<{ backup: { documents: number; truncated: boolean } }>("/api/admin/projects", { projectId, action: "backup" });
      downloadJson(`copia_${projectId}_${new Date().toISOString().slice(0, 10)}.json`, backup);
      showToast("success", `Copia descargada (${backup.documents} documentos${backup.truncated ? ", recortada" : ""})`);
    } catch (e) { showToast("error", (e as Error).message); } finally { setBackingUp(false); }
  };
  const close = () => { setAct(null); if (params.get("action")) router.replace(`/admindashboard/project/${projectId}?tab=summary`); };

  return (
    <div>
      {toast}
      {(p.frozen || p.trashedAt) && (
        <div className={`mb-6 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${p.trashedAt ? "border-red-200 bg-red-50/50" : "border-sky-200 bg-sky-50/50"}`}>
          <div className="text-[13px]">
            <p className="font-medium text-slate-900">{p.trashedAt ? "En la papelera" : "Proyecto congelado"}</p>
            <p className="text-xs text-slate-600">
              {p.trashedAt
                ? `Sus miembros ya no lo ven. Se borrará definitivamente ${timeAgo(p.trashedAt.toMillis() + 30 * DAY)}.`
                : "Todos lo ven pero nadie puede cambiar nada (salvo los admins)."}
            </p>
          </div>
          <Button onClick={() => setAct(p.trashedAt ? "restore" : "unfreeze")}>{p.trashedAt ? <><RotateCcw size={13} /> Restaurar</> : <><Snowflake size={13} /> Descongelar</>}</Button>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-10">
          <section>
            <BlockTitle action={<HealthMeter value={p.phase === "Finalizado" ? undefined : s?.health} tone={h.tone} />}>Salud · <span className="text-slate-900">{h.label}</span></BlockTitle>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {checks.map(([ok, label, detail]) => (
                <div key={label} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
                  {ok ? <Check size={14} className="text-emerald-600" /> : <X size={14} className="text-slate-300" />}
                  <span className={`flex-1 text-[13px] ${ok ? "text-slate-900" : "text-slate-500"}`}>{label}</span>
                  <span className="text-xs text-slate-500">{detail}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <BlockTitle count={p.members.length}>Miembros</BlockTitle>
            {p.members.length === 0 ? <MiniEmpty>Sin miembros</MiniEmpty> : (
              <table className="tbl w-full table-fixed text-[13px]">
                <tbody>
                  {p.members.map((m) => {
                    const u = userById(m.uid);
                    return (
                      <tr key={m.uid} onClick={() => router.push(`/admindashboard/users/${m.uid}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                        <td className="py-1.5 pl-4 pr-3"><div className="truncate font-medium text-slate-900">{m.name}</div><div className="truncate text-xs text-slate-500">{m.email}</div></td>
                        <td className="w-40 px-3 text-slate-600">{m.role || m.position || "—"}</td>
                        <td className="w-32 px-3 text-slate-600">{m.department || "—"}</td>
                        <td className="w-32 px-3 text-slate-500">{u?.lastSeenAt ? timeAgo(u.lastSeenAt) : "—"}</td>
                        <td className="w-10 px-1" onClick={(e) => e.stopPropagation()}>
                          {u?.role === "user" && !u.suspended && (
                            <IconButton label={`Ver como ${m.name}`} onClick={() => router.push(`/admindashboard/users/${m.uid}?impersonate=1`)}><Eye size={14} /></IconButton>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <BlockTitle>Línea de tiempo</BlockTitle>
            <div className="space-y-2.5 border-l border-slate-200 pl-4">
              {timeline.map((t, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-[19.5px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-slate-400" />
                  <p className="text-[13px] text-slate-800">{t.text}</p>
                  <p className="text-[11px] text-slate-400">{fmtDate(t.at, true)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-8">
          <section>
            <BlockTitle>Cifras</BlockTitle>
            <DataList columns={2} items={[
              { label: "POs (30 d)", value: s ? `${s.pos30} de ${s.pos}` : "…" },
              { label: "Facturas (30 d)", value: s ? `${s.invoices30} de ${s.invoices}` : "…" },
              { label: "Proveedores", value: s?.suppliers ?? "…" },
              { label: "Crew", value: s?.crew ?? "…" },
              { label: "Días de horario", value: s?.horarioDays ?? "…" },
              { label: "Creado", value: fmtDate(p.createdAt) },
            ]} />
          </section>
          <section>
            <BlockTitle>Acciones</BlockTitle>
            <div className="flex flex-col items-stretch gap-2">
              <Button onClick={backup} disabled={backingUp}><Download size={13} /> {backingUp ? "Preparando copia…" : "Descargar copia de seguridad"}</Button>
              <Button onClick={onClone}><Copy size={13} /> Duplicar como plantilla</Button>
              <Link href={`/admindashboard/announcements?new=banner&project=${projectId}`} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 text-[13px] font-medium text-slate-700 hover:bg-[#F7F7F8]">Publicar un aviso a su equipo</Link>
              {!p.trashedAt && (p.frozen
                ? <Button onClick={() => setAct("unfreeze")}><Snowflake size={13} /> Descongelar</Button>
                : <Button onClick={() => setAct("freeze")}><Snowflake size={13} /> Congelar (solo lectura)</Button>)}
              {p.trashedAt
                ? <><Button onClick={() => setAct("restore")}><RotateCcw size={13} /> Restaurar</Button><Button variant="danger" onClick={() => setAct("purge")}><Trash2 size={13} /> Eliminar ya, definitivamente</Button></>
                : <Button variant="danger" onClick={() => setAct("trash")}><Archive size={13} /> Mover a la papelera</Button>}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate-400">La copia incluye todos los documentos del proyecto (no los archivos adjuntos).</p>
          </section>
        </aside>
      </div>

      <ConfirmModal open={act === "freeze"} onClose={close} title={`Congelar ${p.name}`} danger={false} confirmLabel="Congelar"
        notice="Sus miembros lo seguirán viendo, pero nadie podrá crear ni cambiar nada (POs, facturas, crew, horarios…). Útil para producciones terminadas. Se puede descongelar cuando quieras."
        reason={{ label: "Motivo", placeholder: "Opcional" }}
        onConfirm={async (r) => { await run("freeze", r); showToast("success", "Proyecto congelado"); }} />
      <ConfirmModal open={act === "unfreeze"} onClose={close} title={`Descongelar ${p.name}`} danger={false} password={false} confirmLabel="Descongelar"
        onConfirm={async () => { await run("unfreeze"); showToast("success", "Proyecto descongelado"); }} />
      <ConfirmModal open={act === "trash"} onClose={close} title={`Mover ${p.name} a la papelera`} confirmLabel="Mover a la papelera"
        notice="Desaparece de la lista de sus miembros y de su productora y queda congelado. Se borra definitivamente a los 30 días; hasta entonces se puede restaurar tal cual."
        reason={{ label: "Motivo", placeholder: "Opcional" }}
        onConfirm={async (r) => { await run("trash", r); showToast("success", "Movido a la papelera"); }} />
      <ConfirmModal open={act === "restore"} onClose={close} title={`Restaurar ${p.name}`} danger={false} password={false} confirmLabel="Restaurar"
        notice="Vuelve a aparecer para todos sus miembros y su productora, y se descongela."
        onConfirm={async () => { await run("restore"); showToast("success", "Proyecto restaurado"); }} />
      <ConfirmModal open={act === "purge"} onClose={close} title={`Eliminar ${p.name} definitivamente`} confirmLabel="Eliminar para siempre"
        notice="Se borran todos sus documentos y archivos. No se puede deshacer. Descarga antes una copia de seguridad si la necesitas."
        onConfirm={async () => { await adminFetch("/api/delete-project", { projectId }); await reload(); router.push("/admindashboard/projects"); }} />
    </div>
  );
}
