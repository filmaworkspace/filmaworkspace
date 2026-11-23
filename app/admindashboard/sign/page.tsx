"use client";

// ─── Admin · Filma Sign ──────────────────────────────────────────────────────
// Solicitudes de firma: estado, quién falta, auditoría completa, recordatorio
// (con enlace nuevo), cancelar, reenviar la copia firmada y descargar el PDF
// firmado. Desde aquí se crean documentos de texto para firmar; los
// presupuestos se envían desde el propio presupuesto.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { FileSignature, FileText, Plus } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button, Page, PageHeader } from "@/components/ds";
import { adminFetch, Pills, RowBar } from "@/components/admin/ui";
import { useAdminData } from "@/components/admin/AdminData";
import { SendToSignModal } from "@/components/sign/SendToSignModal";
import { SignRequestPanel } from "@/components/sign/SignRequestPanel";
import { docTypeLabel, fmtDateTime, SIGN_STATUS, SIGN_TEMPLATES, type SignRequest, type SignStatus } from "@/lib/sign/types";
import { toast } from "@/lib/toast";

type Filter = "all" | SignStatus;

export default function AdminSign() {
  const { producerById } = useAdminData();
  const [rows, setRows] = useState<SignRequest[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [newDoc, setNewDoc] = useState(false);
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
                      <td className="relative py-2 pl-4 pr-3"><RowBar tone={st.tone} /><div className="truncate font-medium text-slate-900">{r.title}</div><div className="truncate text-xs text-slate-500">{docTypeLabel(r.docType) || SIGN_TEMPLATES[r.kind].label}{r.reference ? <> · <span className="font-mono">{r.reference}</span></> : null}{r.producerId ? ` · ${producerById(r.producerId)?.name || "Cuenta"}${r.projectName ? ` / ${r.projectName}` : ""}` : ""}</div></td>
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

        {sel && <SignRequestPanel r={sel} busy={busy} admin onClose={() => setOpen(null)} onAction={action} />}
      </div>

      <SendToSignModal open={newDoc} onClose={() => setNewDoc(false)} kind="document" />

    </Page>
  );
}
