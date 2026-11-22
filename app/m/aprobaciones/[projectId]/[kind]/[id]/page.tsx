"use client";

// Detalle de una aprobación en el móvil: base imponible en grande, proveedor,
// líneas, documento y circuito. Aprobar, rechazar (con motivo) o pedir
// información. Al terminar pasa a la siguiente pendiente.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, getDocs, query, where, type DocumentData } from "firebase/firestore";
import { ArrowLeft, FileText, MessageCircle } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { canApprove, pendingSummary, withNames } from "@/lib/approvalFlow";
import { approveDoc, rejectDoc, requestInfo } from "@/lib/approvalOps";
import { docNumber, KIND_LABEL, type PendingKind } from "@/lib/myPending";
import { toast, errorText } from "@/lib/toast";
import { useMobileData } from "@/components/mobile/MobileData";
import { ApprovalSteps, PendingApprovalNotice } from "@/components/accounting/ApprovalFlow";
import { approvalHref, Card, money } from "@/components/mobile/ui";

const COLLECTION: Record<PendingKind, string> = { po: "pos", invoice: "invoices", card: "cardEnvelopes", transfer: "transferEnvelopes" };
const EXPENSES: Partial<Record<PendingKind, string>> = { card: "cardExpenses", transfer: "transferExpenses" };

interface Line { description: string; code: string; base: number }

export default function MobileApprovalDetail() {
  const { projectId, kind, id } = useParams() as { projectId: string; kind: PendingKind; id: string };
  const router = useRouter();
  const { user } = useUser();
  const { data, reload } = useMobileData();
  const [d, setD] = useState<DocumentData | null | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<null | "reject" | "info">(null);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    if (!COLLECTION[kind]) { setD(null); return; }
    try {
      const snap = await getDoc(doc(db, `projects/${projectId}/${COLLECTION[kind]}`, id));
      if (!snap.exists()) { setD(null); return; }
      const raw = snap.data();
      const members = await getDocs(collection(db, `projects/${projectId}/members`)).then((m) => m.docs.map((x) => ({ userId: x.id, name: x.data().name || x.data().email }))).catch(() => []);
      setD(withNames(raw, members));
      if (EXPENSES[kind]) {
        const ex = await getDocs(query(collection(db, `projects/${projectId}/${EXPENSES[kind]}`), where("envelopeId", "==", id))).catch(() => null);
        setLines((ex?.docs || []).map((e) => { const x = e.data(); return { description: x.supplier || x.description || "Gasto", code: x.subAccountCode || "", base: x.baseAmount || 0 }; }));
      } else {
        setLines((raw.items || []).map((it: DocumentData) => ({ description: it.description || "—", code: it.subAccountCode || "", base: it.baseAmount || 0 })));
      }
    } catch { setD(null); }
  }, [projectId, kind, id]);
  useEffect(() => { load(); }, [load]);

  const actor = { uid: user?.uid || "", name: user?.name || user?.email || "" };
  const mine = !!d && !!user?.uid && canApprove(d, user.uid);
  const next = (data?.approvals || []).find((a) => !(a.id === id && a.kind === kind));

  const finish = async (msg: string, ok = true) => {
    if (ok) toast.success(msg); else toast.info(msg);
    await reload();
    router.replace(next ? approvalHref(next) : "/m/aprobaciones");
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error(errorText(e, "No se ha podido completar")); await load(); } finally { setBusy(false); }
  };

  if (d === undefined) return <div className="space-y-3 pt-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>;
  if (d === null) return (
    <div className="space-y-4 pt-6 text-center">
      <p className="text-[15px]">Este documento ya no está disponible.</p>
      <Link href="/m/aprobaciones" className="text-[13px] font-medium text-slate-700">Volver a aprobaciones</Link>
    </div>
  );

  const number = docNumber(kind, d);
  const base = d.baseAmount ?? d.totalBase ?? 0;
  const p = pendingSummary(d);
  const attachment: string | undefined = d.attachmentUrl || d.documentUrl;

  return (
    <div className="space-y-5 pb-20">
      <Link href="/m/aprobaciones" className="-ml-1 inline-flex h-9 items-center gap-1 text-[13px] text-slate-500"><ArrowLeft size={16} /> Aprobaciones</Link>

      <div>
        <div className="flex items-baseline gap-2 text-[12px] text-slate-500">
          <span className="font-mono">{number}</span>
          {(kind === "card" || kind === "transfer") && <span>{KIND_LABEL[kind]}</span>}
          {d.department && <span>· {d.department}</span>}
        </div>
        <h1 className="mt-0.5 text-[20px] font-semibold leading-tight tracking-tight">{d.supplier || d.boxCode || d.personName || "—"}</h1>
        <p className="mt-3 text-[32px] font-semibold leading-none tracking-tight tabular-nums">{money(base, d.currency)}</p>
        <p className="mt-1 text-[13px] tabular-nums text-slate-500">
          Base imponible · Total {money(d.totalAmount || 0, d.currency)}
        </p>
      </div>

      {(d.generalDescription || d.description) && <p className="text-[15px] text-slate-700">{d.generalDescription || d.description}</p>}

      {attachment && (
        <a href={attachment} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-[15px] active:bg-slate-50">
          <FileText size={16} className="text-slate-500" />
          <span className="min-w-0 flex-1 truncate">{d.attachmentFileName || "Ver documento"}</span>
        </a>
      )}

      {lines.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-medium text-slate-500">{lines.length} línea{lines.length === 1 ? "" : "s"}</h2>
          <Card>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">{l.description}</p>
                  {l.code && <p className="font-mono text-[11px] text-slate-400">{l.code}</p>}
                </div>
                <p className="text-[14px] tabular-nums">{money(l.base, d.currency)}</p>
              </div>
            ))}
          </Card>
        </section>
      )}

      {(d.approvalSteps || []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-medium text-slate-500">Circuito</h2>
          {p.state !== "pending" || !mine ? <PendingApprovalNotice doc={d} /> : null}
          <ApprovalSteps steps={d.approvalSteps} current={d.currentApprovalStep} department={d.department} />
        </section>
      )}

      <p className="text-xs text-slate-400">{[d.createdByName && `Creado por ${d.createdByName}`, d.createdAt?.toDate && d.createdAt.toDate().toLocaleDateString("es-ES")].filter(Boolean).join(" · ")}</p>

      {/* Acciones (encima de la barra inferior) */}
      {mine && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-3">
            <button aria-label="Pedir información" disabled={busy} onClick={() => { setText(""); setSheet("info"); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 disabled:opacity-50">
              <MessageCircle size={18} />
            </button>
            <button disabled={busy} onClick={() => { setText(""); setSheet("reject"); }} className="h-11 flex-1 rounded-xl border border-red-200 text-[15px] font-medium text-red-600 active:bg-red-50 disabled:opacity-50">Rechazar</button>
            <button disabled={busy} onClick={() => run(async () => {
              const r = await approveDoc(projectId, kind, id, actor);
              await finish(r.complete ? `${number} aprobada` : "Aprobación registrada");
            })} className="h-11 flex-[1.4] rounded-xl bg-slate-900 text-[15px] font-medium text-white active:bg-slate-800 disabled:opacity-50">
              {busy ? "Guardando…" : "Aprobar"}
            </button>
          </div>
        </div>
      )}

      {/* Hoja inferior: motivo del rechazo o petición de información */}
      {sheet && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/30" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setSheet(null); }}>
          <div role="dialog" aria-modal="true" aria-label={sheet === "reject" ? "Rechazar" : "Pedir información"} className="w-full rounded-t-2xl bg-white px-4 pt-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
            <p className="text-[15px] font-semibold">{sheet === "reject" ? `Rechazar ${number}` : "Pedir información"}</p>
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
              placeholder={sheet === "reject" ? "Motivo del rechazo" : "Qué necesitas saber"}
              className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-[15px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
            <div className="mt-3 flex gap-2">
              <button disabled={busy} onClick={() => setSheet(null)} className="h-11 flex-1 rounded-xl border border-slate-200 text-[15px]">Cancelar</button>
              <button disabled={busy || !text.trim()} onClick={() => run(async () => {
                if (sheet === "reject") { await rejectDoc(projectId, kind, id, actor, text); setSheet(null); await finish(`${number} rechazada`, false); }
                else { await requestInfo(projectId, kind, id, actor, text); setSheet(null); toast.success("Petición enviada"); }
              })} className={`h-11 flex-1 rounded-xl text-[15px] font-medium text-white disabled:opacity-50 ${sheet === "reject" ? "bg-red-600" : "bg-slate-900"}`}>
                {sheet === "reject" ? "Rechazar" : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
