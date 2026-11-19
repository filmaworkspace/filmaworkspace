"use client";

// ─── Admin · Emails ──────────────────────────────────────────────────────────
// Registro de todos los emails que envía Filma (a quién, qué plantilla,
// cuándo) con su estado de entrega desde Resend (entregado, rebotado, spam,
// abierto…), detalle con vista previa y reenvío, y vista previa de todas las
// plantillas con datos de ejemplo.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { collection, getDocs, limit, orderBy, query, Timestamp } from "firebase/firestore";
import { Eye, RefreshCw, Send } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button, DataList, EmptyState, IconButton, Modal, Page, PageHeader, PageLoading, Select, useToast } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { EMAIL_STATUS, TEMPLATE_LABEL } from "@/components/admin/emailStatus";
import { EMAIL_SAMPLES, previewHtml } from "@/components/admin/emailSamples";
import { adminFetch, fmtDate, Pills, RowBar, timeAgo } from "@/components/admin/ui";

interface Mail {
  id: string;
  to: string[];
  subject: string;
  template: string;
  status: string;
  error?: string | null;
  html?: string | null;
  events?: { type: string; at: string }[];
  meta?: Record<string, unknown>;
  createdAt: Timestamp | null;
}

type Tab = "all" | "problems" | "delivered" | "opened" | "sent";
type F = "all" | "to" | "subject";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Destinatario o asunto" },
  { value: "to", label: "Destinatario", placeholder: "Email" },
  { value: "subject", label: "Asunto", placeholder: "Asunto" },
];
const PROBLEMS = ["failed", "bounced", "complained"];
const DAY = 86_400_000;

function EmailsInner() {
  const params = useSearchParams();
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [mails, setMails] = useState<Mail[]>([]);
  const [tab, setTab] = useState<Tab>(params.get("status") === "problems" ? "problems" : "all");
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState(params.get("q") || "");
  const [template, setTemplate] = useState("all");
  const [period, setPeriod] = useState("30");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    const snap = await getDocs(query(collection(db, "emailLog"), orderBy("createdAt", "desc"), limit(1000))).catch(() => null);
    setMails((snap?.docs || []).map((d) => ({ id: d.id, ...d.data() } as Mail)));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const inPeriod = (m: Mail) => period === "all" || (m.createdAt?.toMillis?.() ?? 0) > Date.now() - Number(period) * DAY;
  const inTab = (m: Mail, t: Tab) =>
    t === "all" ? true : t === "problems" ? PROBLEMS.includes(m.status) : t === "delivered" ? ["delivered", "opened", "clicked"].includes(m.status) : t === "opened" ? ["opened", "clicked"].includes(m.status) : m.status === "sent" || m.status === "delivery_delayed";

  const base = useMemo(() => mails.filter((m) => inPeriod(m) && (template === "all" || m.template === template)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mails, period, template]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return base.filter((m) => inTab(m, tab) && (!t || (field === "to" ? m.to.join(" ") : field === "subject" ? m.subject : `${m.to.join(" ")} ${m.subject}`).toLowerCase().includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, tab, q, field]);

  const kpi = useMemo(() => {
    const n = base.length || 1;
    const delivered = base.filter((m) => ["delivered", "opened", "clicked"].includes(m.status)).length;
    const opened = base.filter((m) => ["opened", "clicked"].includes(m.status)).length;
    const problems = base.filter((m) => PROBLEMS.includes(m.status)).length;
    const tracked = base.some((m) => (m.events || []).length > 0);
    return { delivered: Math.round((delivered / n) * 100), opened: Math.round((opened / n) * 100), problems, tracked };
  }, [base]);

  const templates = useMemo(() => Array.from(new Set(mails.map((m) => m.template))).sort(), [mails]);
  const open = mails.find((m) => m.id === openId) || null;

  const resend = async (m: Mail) => {
    setSending(true);
    try { await adminFetch("/api/admin/emails", { logId: m.id }); showToast("success", "Email reenviado"); load(); }
    catch (e) { showToast("error", (e as Error).message); } finally { setSending(false); }
  };

  if (loading) return <PageLoading />;

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Emails <span className="text-[15px] font-normal text-slate-400">{base.length}</span></>}
        actions={
          <>
            {kpi.tracked && (
              <span className="mr-2 hidden items-center gap-4 text-xs text-slate-500 lg:flex">
                <span>Entregados <strong className="font-medium text-slate-900">{kpi.delivered} %</strong></span>
                <span>Abiertos <strong className="font-medium text-slate-900">{kpi.opened} %</strong></span>
                <span>Con problemas <strong className={`font-medium ${kpi.problems ? "text-red-600" : "text-slate-900"}`}>{kpi.problems}</strong></span>
              </span>
            )}
            <IconButton label="Actualizar" onClick={load}><RefreshCw size={15} /></IconButton>
            <Button onClick={() => setPreview(EMAIL_SAMPLES[0].id)}><Eye size={14} /> Plantillas</Button>
          </>
        }
      />

      {!kpi.tracked && base.length > 0 && (
        <p className="mt-4 rounded-md border border-slate-200 bg-[#F7F7F8] px-3 py-2 text-xs text-slate-600">
          Para ver si cada email se entrega, rebota o se abre, configura el webhook de Resend apuntando a <code className="tabular-nums">/api/webhooks/resend</code> y guarda su clave en <code className="tabular-nums">RESEND_WEBHOOK_SECRET</code>.
        </p>
      )}

      <div className="mt-6">
        <Pills value={tab} onChange={setTab} label="Estado" options={[
          { value: "all", label: "Todos", count: base.length },
          { value: "problems", label: "Con problemas", count: base.filter((m) => inTab(m, "problems")).length },
          { value: "delivered", label: "Entregados", count: base.filter((m) => inTab(m, "delivered")).length },
          { value: "opened", label: "Abiertos", count: base.filter((m) => inTab(m, "opened")).length },
          { value: "sent", label: "Sin confirmar", count: base.filter((m) => inTab(m, "sent")).length },
        ]} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={rows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="w-52"><Select value={template} onChange={(e) => setTemplate(e.target.value)}><option value="all">Todas las plantillas</option>{templates.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t] || t}</option>)}</Select></div>
          <div className="w-40"><Select value={period} onChange={(e) => setPeriod(e.target.value)}><option value="1">Últimas 24 h</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="all">Todo</option></Select></div>
        </div>
      </div>

      {rows.length === 0 ? <div className="mt-4"><EmptyState title={mails.length ? "Ningún email con estos filtros" : "Todavía no hay emails registrados (se registran desde esta versión)"} /></div> : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead><tr className="text-left"><th className="py-2 pl-4 pr-3">Asunto y destinatario</th><th className="w-52 px-3">Plantilla</th><th className="w-40 px-3">Estado</th><th className="w-36 px-3">Enviado</th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((m) => {
              const st = EMAIL_STATUS[m.status] || EMAIL_STATUS.sent;
              return (
                <tr key={m.id} onClick={() => setOpenId(m.id)} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="relative py-1.5 pl-4 pr-3"><RowBar tone={st.tone} /><div className="truncate text-slate-900">{m.subject}</div><div className="truncate text-xs text-slate-500">{m.to.join(", ")}</div></td>
                  <td className="px-3 text-slate-600">{TEMPLATE_LABEL[m.template] || m.template}</td>
                  <td className={`px-3 ${st.tone === "bad" ? "text-red-600" : st.tone === "ok" ? "text-emerald-700" : "text-slate-600"}`}>{st.label}</td>
                  <td className="px-3 text-slate-500" title={fmtDate(m.createdAt, true)}>{timeAgo(m.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > 300 && <p className="mt-2 text-xs text-slate-400">Se muestran los 300 más recientes. Afina la búsqueda para ver otros.</p>}

      <Modal open={!!open} onClose={() => setOpenId(null)} title={open?.subject || "Email"} width="max-w-3xl"
        footer={open && <><Button variant="ghost" onClick={() => setOpenId(null)}>Cerrar</Button>{open.html && <Button variant="primary" onClick={() => resend(open)} disabled={sending}><Send size={13} /> {sending ? "Reenviando…" : "Reenviar"}</Button>}</>}>
        {open && (
          <div className="flex flex-col gap-5">
            <DataList columns={3} items={[
              { label: "Para", value: open.to.join(", ") },
              { label: "Plantilla", value: TEMPLATE_LABEL[open.template] || open.template },
              { label: "Estado", value: (EMAIL_STATUS[open.status] || EMAIL_STATUS.sent).label },
              { label: "Enviado", value: fmtDate(open.createdAt, true) },
              { label: "Error", value: open.error || undefined },
            ]} />
            {(open.events || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-slate-500">Historial</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
                  {(open.events || []).map((e, i) => <span key={i}>{(EMAIL_STATUS[e.type] || { label: e.type }).label} · {fmtDate(new Date(e.at), true)}</span>)}
                </div>
              </div>
            )}
            {open.html
              ? <iframe title="Vista previa" srcDoc={previewHtml(open.html)} className="h-[420px] w-full rounded-md border border-slate-200 bg-[#F4F4F5]" sandbox="" />
              : <p className="rounded-md border border-slate-200 bg-[#F7F7F8] px-3 py-2 text-xs text-slate-600">El contenido de este email no se guarda (lleva un código o un enlace de acceso), así que no se puede ver ni reenviar.</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Plantillas" width="max-w-3xl">
        <div className="flex flex-col gap-3">
          <div className="w-72">
            <Select value={preview || ""} onChange={(e) => setPreview(e.target.value)}>
              {EMAIL_SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </div>
          {preview && <iframe title="Plantilla" srcDoc={previewHtml(EMAIL_SAMPLES.find((s) => s.id === preview)!.html())} className="h-[520px] w-full rounded-md border border-slate-200 bg-[#F4F4F5]" sandbox="" />}
          <p className="text-xs text-slate-400">Con datos de ejemplo. Los datos reales de cada envío se escapan antes de meterlos en el email.</p>
        </div>
      </Modal>
    </Page>
  );
}

export default function EmailsPage() {
  return <Suspense fallback={<PageLoading />}><EmailsInner /></Suspense>;
}
