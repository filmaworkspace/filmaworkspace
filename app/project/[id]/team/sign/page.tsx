"use client";

// ─── Equipo · Filma Sign ─────────────────────────────────────────────────────
// Documentos para firmar del proyecto (contratos, NDA, cesiones…): enviar,
// seguir su estado y su auditoría, recordar, cancelar y descargar el PDF
// firmado. Todo se imputa a la cuenta del proyecto y se factura por uso
// (firmados y caducados o rechazados).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { FileSignature, Plus, Search } from "lucide-react";
import { Button, EmptyState, Page, PageHeader, PageLoading, Select } from "@/components/ds";
import { adminFetch, Pills, RowBar } from "@/components/admin/ui";
import { SendToSignModal } from "@/components/sign/SendToSignModal";
import { SignRequestPanel, signStatusOf } from "@/components/sign/SignRequestPanel";
import { docTypeLabel, fmtDateTime, SIGN_DOC_TYPES, SIGN_STATUS, type SignDocType, type SignRequest, type SignStatus } from "@/lib/sign/types";
import { toast } from "@/lib/toast";

type Filter = "all" | SignStatus;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function TeamSign() {
  const { id } = useParams() as { id: string };
  const [rows, setRows] = useState<SignRequest[] | null>(null);
  const [projectName, setProjectName] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState<"all" | SignDocType>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminFetch<{ requests: SignRequest[]; project: { name: string } }>(`/api/projects/${id}/sign`, undefined, "GET");
      setRows(r.requests); setProjectName(r.project.name); setBlocked(null);
    } catch (e) { setBlocked((e as Error).message); setRows([]); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows || []).filter((r) => {
    if (filter !== "all" && signStatusOf(r) !== filter) return false;
    if (type !== "all" && (r.docType || "other") !== type) return false;
    const t = norm(q.trim());
    if (!t) return true;
    const signer = r.parties.find((p) => p.side === "signer");
    return norm(`${r.title} ${signer?.name || ""} ${signer?.email || ""} ${docTypeLabel(r.docType) || ""}`).includes(t);
  }), [rows, filter, type, q]);
  const count = (s: SignStatus) => (rows || []).filter((r) => signStatusOf(r) === s).length;
  const sel = (rows || []).find((r) => r.id === open) || null;

  // Lo que va a factura este mes (firmados y caducados o rechazados).
  const month = useMemo(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const a = start.getTime();
    let signed = 0, expired = 0;
    for (const r of rows || []) {
      if (r.status === "completed" && (r.completedAt || 0) >= a) signed++;
      else if (r.status === "declined" && ([...r.events].reverse().find((e) => e.type === "declined")?.at || 0) >= a) expired++;
      else if (r.status === "pending" && r.expiresAt < Date.now() && r.expiresAt >= a) expired++;
    }
    return { signed, expired };
  }, [rows]);

  const action = async (a: "remind" | "resend_copy" | "cancel") => {
    if (!sel) return;
    setBusy(true);
    try {
      await adminFetch(`/api/projects/${id}/sign`, { action: a, id: sel.id });
      toast.success(a === "remind" ? "Recordatorio enviado con un enlace nuevo" : a === "resend_copy" ? "Copia firmada reenviada" : "Solicitud cancelada");
      await load();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  if (rows === null) return <PageLoading />;
  if (blocked) return (
    <Page>
      <PageHeader title={<><FileSignature size={18} className="text-slate-400" /> Filma Sign</>} />
      <div className="mt-8"><EmptyState title={blocked} /></div>
    </Page>
  );

  return (
    <Page>
      <PageHeader title={<><FileSignature size={18} className="text-slate-400" /> Filma Sign</>}
        actions={<Button variant="primary" onClick={() => setSending(true)}><Plus size={14} /> Enviar a firmar</Button>} />

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
        {[
          ["Pendientes", count("pending")],
          ["Firmados", count("completed")],
          ["Caducados o rechazados", count("expired") + count("declined")],
          ["Facturable este mes", month.signed + month.expired],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-white px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Pills value={filter} onChange={setFilter} label="Estado" options={[
          { value: "all", label: "Todos", count: rows.length },
          ...(["pending", "completed", "declined", "expired", "cancelled"] as SignStatus[]).map((s) => ({ value: s, label: SIGN_STATUS[s].label, count: count(s) })),
        ]} />
        <div className="flex items-center gap-2">
          <div className="w-52">
            <Select value={type} onChange={(e) => setType(e.target.value as "all" | SignDocType)}>
              <option value="all">Todos los tipos</option>
              {(Object.keys(SIGN_DOC_TYPES) as SignDocType[]).map((k) => <option key={k} value={k}>{SIGN_DOC_TYPES[k]}</option>)}
            </Select>
          </div>
          <div className="relative w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Documento o firmante"
              className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-[13px] focus:border-slate-400 focus:outline-none" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-8 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="min-w-0">
          {rows.length === 0 ? (
            <EmptyState title="Aún no hay documentos" action={<Button onClick={() => setSending(true)}><Plus size={14} /> Enviar a firmar</Button>} />
          ) : shown.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-400">Nada con estos filtros</p>
          ) : (
            <table className="tbl w-full table-fixed text-[13px]">
              <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Documento</th><th className="w-48 px-3">Firmante</th><th className="w-36 px-3">Enviado</th><th className="w-40 px-3">Estado</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const st = SIGN_STATUS[signStatusOf(r)];
                  const signer = r.parties.find((p) => p.side === "signer");
                  return (
                    <tr key={r.id} onClick={() => setOpen(r.id)} className={`cursor-pointer hover:bg-[#FAFAFA] ${open === r.id ? "bg-[#FAFAFA]" : ""}`}>
                      <td className="relative py-2 pl-4 pr-3"><RowBar tone={st.tone} /><div className="truncate font-medium text-slate-900">{r.title}</div><div className="truncate text-xs text-slate-500">{docTypeLabel(r.docType) || "Documento"}</div></td>
                      <td className="px-3"><div className="truncate text-slate-900">{signer?.name}</div><div className="truncate text-xs text-slate-500">{signer?.email}</div></td>
                      <td className="px-3 text-slate-600">{fmtDateTime(r.createdAt)}</td>
                      <td className={`px-3 ${st.tone === "ok" ? "text-emerald-700" : st.tone === "bad" ? "text-red-600" : st.tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>
                        {st.label}{signer?.viewedAt && signStatusOf(r) === "pending" ? <span className="block text-[11px] text-slate-400">Abierto {fmtDateTime(signer.viewedAt)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {sel && <SignRequestPanel r={sel} busy={busy} onClose={() => setOpen(null)} onAction={action} />}
      </div>

      <SendToSignModal open={sending} onClose={() => setSending(false)} kind="document" projectId={id} issuerRole={projectName} onSent={() => load()} />
    </Page>
  );
}
