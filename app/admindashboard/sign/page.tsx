"use client";

// ─── Admin · Filma Sign ──────────────────────────────────────────────────────
// Solicitudes de firma: estado, quién falta, auditoría completa, recordatorio
// (con enlace nuevo), cancelar, reenviar la copia firmada y descargar el PDF
// firmado. Desde aquí se crean documentos de texto para firmar; los
// presupuestos se envían desde el propio presupuesto.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { Bell, Download, FileSignature, FileText, Mail, Plus, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button, Page, PageHeader } from "@/components/ds";
import { adminFetch, BlockTitle, Pills, RowBar } from "@/components/admin/ui";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { useAdminData } from "@/components/admin/AdminData";
import { SendToSignModal } from "@/components/sign/SendToSignModal";
import { SignDocument } from "@/components/sign/SignDocument";
import { buildSignedPdf, signedFileName } from "@/lib/sign/render";
import { EVENT_LABEL, fmtDateTime, SIGN_STATUS, SIGN_TEMPLATES, type SignRequest, type SignStatus } from "@/lib/sign/types";
import { toast } from "@/lib/toast";

type Filter = "all" | SignStatus;

export default function AdminSign() {
  const { producerById } = useAdminData();
  const [rows, setRows] = useState<SignRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(query(collection(db, "signRequests"), orderBy("createdAt", "desc"), limit(300)),
    (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() } as SignRequest))), () => setRows([])), []);

  const now = Date.now();
  const statusOf = (r: SignRequest): SignStatus => (r.status === "pending" && r.expiresAt < now ? "expired" : r.status);
  const shown = useMemo(() => (rows || []).filter((r) => filter === "all" || statusOf(r) === filter), [rows, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = (rows || []).find((r) => r.id === open) || null;
  const count = (s: SignStatus) => (rows || []).filter((r) => statusOf(r) === s).length;

  const action = async (a: "remind" | "resend_copy" | "cancel") => {
    if (!sel) return;
    setBusy(true);
    try {
      await adminFetch("/api/admin/sign", { action: a, id: sel.id });
      toast.success(a === "remind" ? "Recordatorio enviado con un enlace nuevo" : a === "resend_copy" ? "Copia firmada reenviada" : "Solicitud cancelada");
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <Page>
      <PageHeader title={<><FileSignature size={18} className="text-slate-400" /> Filma Sign</>}
        actions={<Button variant="primary" onClick={() => setNewDoc(true)}><Plus size={14} /> Documento para firmar</Button>} />

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {(Object.keys(SIGN_TEMPLATES) as (keyof typeof SIGN_TEMPLATES)[]).map((k) => (
          <div key={k} className="flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3">
            <FileText size={16} className="mt-0.5 text-slate-400" />
            <div className="min-w-0 flex-1 text-[13px]">
              <p className="font-medium text-slate-900">{SIGN_TEMPLATES[k].label}</p>
              <p className="text-xs text-slate-500">{SIGN_TEMPLATES[k].description}</p>
            </div>
            {k === "quote"
              ? <Link href="/admindashboard/accounts/billing?tab=quotes" className="text-xs text-slate-500 hover:text-slate-900">Presupuestos →</Link>
              : <button onClick={() => setNewDoc(true)} className="text-xs text-slate-500 hover:text-slate-900">Nuevo →</button>}
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Pills value={filter} onChange={setFilter} label="Estado" options={[
          { value: "all", label: "Todas", count: rows?.length || 0 },
          ...(["pending", "completed", "declined", "expired", "cancelled"] as SignStatus[]).map((s) => ({ value: s, label: SIGN_STATUS[s].label, count: count(s) })),
        ]} />
      </div>

      <div className="mt-4 grid gap-8 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="min-w-0">
          {rows && shown.length === 0 && <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-400">Sin solicitudes</p>}
          {shown.length > 0 && (
            <table className="tbl w-full table-fixed text-[13px]">
              <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Documento</th><th className="w-44 px-3">Firmante</th><th className="w-36 px-3">Enviado</th><th className="w-36 px-3">Estado</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const st = SIGN_STATUS[statusOf(r)];
                  const signer = r.parties.find((p) => p.side === "signer");
                  return (
                    <tr key={r.id} onClick={() => setOpen(r.id)} className={`cursor-pointer hover:bg-[#FAFAFA] ${open === r.id ? "bg-[#FAFAFA]" : ""}`}>
                      <td className="relative py-2 pl-4 pr-3"><RowBar tone={st.tone} /><div className="truncate font-medium text-slate-900">{r.title}</div><div className="truncate text-xs text-slate-500">{SIGN_TEMPLATES[r.kind].label}{r.reference ? <> · <span className="font-mono">{r.reference}</span></> : null}{r.producerId ? ` · ${producerById(r.producerId)?.name || "Cuenta"}${r.projectName ? ` / ${r.projectName}` : ""}` : ""}</div></td>
                      <td className="px-3"><div className="truncate text-slate-900">{signer?.name}</div><div className="truncate text-xs text-slate-500">{signer?.email}</div></td>
                      <td className="px-3 text-slate-600">{fmtDateTime(r.createdAt)}</td>
                      <td className={`px-3 ${st.tone === "ok" ? "text-emerald-700" : st.tone === "bad" ? "text-red-600" : st.tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>{st.label}{signer?.viewedAt && statusOf(r) === "pending" ? <span className="block text-[11px] text-slate-400">Abierto {fmtDateTime(signer.viewedAt)}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {sel && (
          <aside className="min-w-0">
            <div className="sticky top-[64px] space-y-5 rounded-lg border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-slate-900">{sel.title}</p>
                  <p className="text-xs text-slate-500">{SIGN_STATUS[statusOf(sel)].label}{sel.completedAt ? ` · ${fmtDateTime(sel.completedAt)}` : ""}</p>
                </div>
                <button onClick={() => setOpen(null)} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={async () => { const pdf = await buildSignedPdf(sel); pdf.save(signedFileName(sel)); }}><Download size={13} /> PDF {sel.status === "completed" ? "firmado" : "con auditoría"}</Button>
                {statusOf(sel) === "pending" || statusOf(sel) === "expired" ? <Button size="sm" disabled={busy || sel.status !== "pending"} onClick={() => action("remind")}><Bell size={13} /> Recordar</Button> : null}
                {sel.status === "completed" && <Button size="sm" disabled={busy} onClick={() => action("resend_copy")}><Mail size={13} /> Reenviar copia</Button>}
                {sel.status === "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancel(true)}>Cancelar</Button>}
                {sel.refPath?.startsWith("billingQuotes/") && <Link href={`/admindashboard/accounts/billing/quotes/${sel.refPath.split("/")[1]}`} className="flex items-center px-2 text-xs text-slate-500 hover:text-slate-900">Ver presupuesto →</Link>}
              </div>

              <div>
                <BlockTitle>Partes</BlockTitle>
                <div className="space-y-2">
                  {sel.parties.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-md border border-slate-100 px-3 py-2">
                      <div className="min-w-0 flex-1 text-[13px]">
                        <p className="truncate font-medium text-slate-900">{p.name} <span className="font-normal text-slate-400">· {p.side === "issuer" ? "Filma" : "Firmante"}</span></p>
                        <p className="truncate text-xs text-slate-500">{[p.email, p.role, p.taxId && `NIF ${p.taxId}`].filter(Boolean).join(" · ")}</p>
                        <p className={`text-xs ${p.status === "signed" ? "text-emerald-700" : p.status === "declined" ? "text-red-600" : "text-amber-700"}`}>
                          {p.status === "signed" ? `Firmado ${fmtDateTime(p.signature?.signedAt)} · IP ${p.signature?.ip || "—"}` : p.status === "declined" ? `Rechazado${p.declineReason ? `: ${p.declineReason}` : ""}` : "Pendiente"}
                        </p>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.signature && <img src={p.signature.image} alt="" className="h-9 w-24 object-contain" />}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <BlockTitle>Auditoría</BlockTitle>
                <ol className="space-y-1.5">
                  {[...sel.events].sort((a, b) => a.at - b.at).map((e, i) => (
                    <li key={i} className="grid grid-cols-[112px_1fr] gap-2 text-[12px]">
                      <span className="tabular-nums text-slate-400">{fmtDateTime(e.at)}</span>
                      <span className="min-w-0 text-slate-700">
                        {EVENT_LABEL[e.type]}{sel.parties.find((p) => p.id === e.party) ? ` · ${sel.parties.find((p) => p.id === e.party)!.name}` : e.by ? ` · ${e.by}` : ""}
                        {e.detail && <span className="block truncate text-slate-400">{e.detail}</span>}
                        {e.ip && <span className="block truncate font-mono text-[10.5px] text-slate-400">{e.ip}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 break-all font-mono text-[10.5px] text-slate-400">SHA-256 {sel.docHash}</p>
              </div>

              <details>
                <summary className="cursor-pointer text-xs text-slate-500">Ver documento</summary>
                <div className="mt-3"><SignDocument r={sel} /></div>
              </details>
            </div>
          </aside>
        )}
      </div>

      <SendToSignModal open={newDoc} onClose={() => setNewDoc(false)} kind="document" />
      <ConfirmModal open={cancel} onClose={() => setCancel(false)} title="Cancelar la solicitud" password={false} confirmLabel="Cancelar solicitud"
        notice="El enlace deja de funcionar. Queda en la auditoría." onConfirm={async () => { await action("cancel"); }} />
    </Page>
  );
}
