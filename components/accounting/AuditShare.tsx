"use client";

// Compartir con auditor (Centro de documentación): crear el enlace con su
// alcance, caducidad y PIN, y gestionar los enlaces ya creados (accesos,
// registro y revocación).

import { useEffect, useState } from "react";
import { Copy, Mail } from "lucide-react";
import { Button, Checkbox, Field, Input, Modal, Segmented, Select, Textarea } from "@/components/ds";
import { toast } from "@/lib/toast";
import { auditAccessLog, createAuditLink, listAuditLinks, revokeAuditLink, type AuditLink } from "@/lib/audit/links";
import type { HubItem, HubProject } from "@/lib/docs/hub";

type Scope = "selection" | "folder" | "all";
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—");
const stamp = (d: Date | null | undefined) => (d ? d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const EVENT: Record<string, string> = { open: "Abrió el enlace", download: "Descargó", pin_failed: "PIN incorrecto" };

export function AuditShareModal({ open, onClose, projectId, project, all, folder, folderName, selection, user }: {
  open: boolean; onClose: () => void; projectId: string; project: HubProject | null;
  all: HubItem[]; folder: HubItem[]; folderName: string; selection: HubItem[]; user: { uid: string; name: string };
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [f, setF] = useState({ name: "", company: "", email: "", note: "", days: "15", pin: true });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ url: string; pin: string | null } | null>(null);
  useEffect(() => {
    if (!open) return;
    setResult(null); setProgress(null);
    setScope(selection.length ? "selection" : folder.length && folder.length < all.length ? "folder" : "all");
  }, [open, selection.length, folder.length, all.length]);
  const items = scope === "selection" ? selection : scope === "folder" ? folder : all;

  const create = async () => {
    if (!project || !items.length || !f.name.trim()) return;
    setProgress({ done: 0, total: items.length });
    try {
      const r = await createAuditLink({
        projectId, project, items, auditorName: f.name, auditorCompany: f.company, auditorEmail: f.email, note: f.note,
        days: Number(f.days), withPin: f.pin, user, onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult({ url: r.url, pin: r.pin });
      if (r.missing.length) toast.error(`Algunos originales no se pudieron añadir (${r.missing.length})`);
    } catch (e) { toast.error(e); } finally { setProgress(null); }
  };
  const copy = (t: string, what: string) => { void navigator.clipboard?.writeText(t); toast.success(`${what} copiado`); };

  if (result) {
    const mail = `mailto:${encodeURIComponent(f.email)}?subject=${encodeURIComponent(`Documentación de ${project?.name || "proyecto"} para auditoría`)}&body=${encodeURIComponent(`Hola ${f.name.split(" ")[0]},\n\nTe comparto la documentación de ${project?.name} para la auditoría. Estará disponible hasta el ${day(new Date(Date.now() + Number(f.days) * 86_400_000))}:\n\n${result.url}\n\n${result.pin ? "El PIN te lo envío por otro canal.\n\n" : ""}Un saludo,\n${user.name}`)}`;
    return (
      <Modal open={open} onClose={onClose} title="Enlace para auditor creado" width="max-w-lg"
        footer={<Button variant="primary" onClick={onClose}>Hecho</Button>}>
        <div className="space-y-4 text-[13px]">
          <Field label="Enlace">
            <div className="flex gap-2"><Input readOnly value={result.url} className="font-mono text-xs" /><Button onClick={() => copy(result.url, "Enlace")}><Copy size={13} /></Button></div>
          </Field>
          {result.pin && (
            <Field label="PIN">
              <div className="flex items-center gap-3"><span className="font-mono text-2xl tracking-[0.3em] text-slate-900">{result.pin}</span><Button size="sm" onClick={() => copy(result.pin!, "PIN")}><Copy size={13} /> Copiar</Button></div>
            </Field>
          )}
          <p className="text-xs text-slate-500">{result.pin ? "Envía el PIN por otro canal (teléfono o mensaje), no junto al enlace. " : ""}El PIN no se puede volver a ver. Desde «Enlaces de auditor» ves cada acceso y puedes revocarlo.</p>
          {f.email && <a href={mail} className="inline-flex items-center gap-1.5 text-[13px] text-slate-700 underline-offset-2 hover:underline"><Mail size={13} /> Preparar email a {f.email}</a>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={() => { if (!progress) onClose(); }} title="Compartir con auditor" width="max-w-lg"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={!!progress}>Cancelar</Button>
        <Button variant="primary" onClick={create} disabled={!!progress || !items.length || !f.name.trim()}>
          {progress ? `Preparando ${progress.done}/${progress.total}…` : `Crear enlace (${items.length})`}
        </Button>
      </>}>
      <div className="space-y-4">
        <Segmented value={scope} onChange={setScope} options={[
          ...(selection.length ? [{ value: "selection" as Scope, label: `Selección · ${selection.length}` }] : []),
          ...(folder.length && folder.length < all.length ? [{ value: "folder" as Scope, label: `${folderName} · ${folder.length}` }] : []),
          { value: "all" as Scope, label: `Todo · ${all.length}` },
        ]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Auditor"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Nombre y apellidos" /></Field>
          <Field label="Firma"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="Opcional" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Opcional" /></Field>
          <Field label="Disponible durante">
            <Select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
              {["7", "15", "30", "60", "90"].map((d) => <option key={d} value={d}>{d} días</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Nota para el auditor"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Opcional. Se ve al abrir el enlace." /></Field>
        <Checkbox checked={f.pin} onChange={(v) => setF({ ...f, pin: v })} label="Proteger con PIN" hint="Seis cifras que se envían por otro canal" />
        <p className="text-xs text-slate-500">Se comparte una copia de los documentos tal y como están hoy, con sus huellas. Solo lectura, con caducidad y registro de accesos.</p>
      </div>
    </Modal>
  );
}

export function AuditLinksModal({ open, onClose, projectId, userName }: { open: boolean; onClose: () => void; projectId: string; userName: string }) {
  const [links, setLinks] = useState<AuditLink[] | null>(null);
  const [log, setLog] = useState<{ link: AuditLink; rows: Awaited<ReturnType<typeof auditAccessLog>> } | null>(null);
  const load = () => listAuditLinks(projectId).then(setLinks).catch((e) => { toast.error(e); setLinks([]); });
  useEffect(() => { if (open) { setLinks(null); setLog(null); void load(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, projectId]);
  const now = Date.now();

  if (log) {
    return (
      <Modal open={open} onClose={() => setLog(null)} title={`Accesos · ${log.link.auditorName}`} width="max-w-lg" footer={<Button onClick={() => setLog(null)}>Volver</Button>}>
        {log.rows.length === 0 ? <p className="py-6 text-center text-[13px] text-slate-500">Todavía no ha abierto el enlace</p> : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            {log.rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-[13px] last:border-0">
                <span className={r.type === "pin_failed" ? "text-red-700" : "text-slate-800"}>{EVENT[r.type] || r.type}{r.number ? ` · ${r.number}` : ""}</span>
                <span className="text-xs tabular-nums text-slate-500">{stamp(r.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Enlaces de auditor" width="max-w-3xl" footer={<Button onClick={onClose}>Cerrar</Button>}>
      {!links ? <p className="py-8 text-center text-[13px] text-slate-500">Cargando…</p> : links.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-500">Todavía no se ha compartido nada</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-slate-200 bg-[#FAFAFA] text-xs text-slate-500">
              <th className="px-3 py-2 text-left font-medium">Auditor</th><th className="px-3 py-2 text-right font-medium">Docs</th>
              <th className="px-3 py-2 text-left font-medium">Hasta</th><th className="px-3 py-2 text-left font-medium">Accesos</th><th className="px-3 py-2 text-left font-medium">Estado</th><th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {links.map((l) => {
                const expired = l.expiresAt.getTime() < now;
                const status = l.revoked ? "Revocado" : expired ? "Caducado" : !l.ready ? "Preparando" : "Activo";
                return (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2"><span className="block text-slate-900">{l.auditorName}</span><span className="block text-xs text-slate-500">{[l.auditorCompany, `por ${l.createdByName} · ${day(l.createdAt)}`, l.hasPin ? "con PIN" : ""].filter(Boolean).join(" · ")}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.max(0, l.files.length - 1)}</td>
                    <td className="px-3 py-2 tabular-nums">{day(l.expiresAt)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{l.opens ? `${l.opens} ${l.opens === 1 ? "apertura" : "aperturas"} · ${l.downloads} desc.` : "Sin abrir"}{l.lastAccessAt ? <span className="block text-slate-400">Último: {stamp(l.lastAccessAt)}</span> : null}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center gap-1.5 text-xs ${status === "Activo" ? "text-slate-900" : "text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${status === "Activo" ? "bg-slate-900" : "bg-slate-300"}`} />{status}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={async () => setLog({ link: l, rows: await auditAccessLog(l.id) })}>Registro</Button>
                      {status === "Activo" && <Button size="sm" variant="ghost" onClick={async () => { try { await revokeAuditLink(l.id, userName); toast.success("Enlace revocado"); void load(); } catch (e) { toast.error(e); } }}>Revocar</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
