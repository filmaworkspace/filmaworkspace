"use client";

// Bandeja de aprobaciones móvil: todo lo que espera a la persona, por
// proyecto. Deslizar una fila hacia la derecha descubre «Aprobar»; con
// «Seleccionar» se aprueban varias de una vez (con el total en base imponible).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { approveDoc } from "@/lib/approvalOps";
import { toast, errorText } from "@/lib/toast";
import { useMobileData } from "@/components/mobile/MobileData";
import { haptic, PullToRefresh, SwipeRow } from "@/components/mobile/gestures";
import { ApprovalRow, Card, Empty, SectionTitle, approvalHref, money } from "@/components/mobile/ui";
import type { PendingApprovalItem } from "@/lib/myPending";

const key = (a: PendingApprovalItem) => `${a.kind}:${a.projectId}:${a.id}`;

export default function MobileApprovals() {
  const router = useRouter();
  const { user } = useUser();
  const { data, loading, reload } = useMobileData();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const approvals = data?.approvals || [];
  const actor = { uid: user?.uid || "", name: user?.name || user?.email || "" };

  const byProject = new Map<string, { name: string; items: PendingApprovalItem[] }>();
  for (const a of approvals) {
    const g = byProject.get(a.projectId) || { name: a.projectName, items: [] };
    g.items.push(a);
    byProject.set(a.projectId, g);
  }

  const approveOne = async (a: PendingApprovalItem) => {
    setBusy(key(a));
    try {
      const r = await approveDoc(a.projectId, a.kind, a.id, actor);
      haptic([10, 40, 10]);
      toast.success(r.complete ? `${a.number} aprobada` : `${a.number}: aprobación registrada`);
      await reload();
    } catch (e) { toast.error(errorText(e, "No se ha podido aprobar")); } finally { setBusy(null); }
  };

  const chosen = approvals.filter((a) => picked.has(key(a)));
  const approveMany = async () => {
    setConfirm(false); setBusy("bulk");
    let ok = 0; const failed: string[] = [];
    for (const a of chosen) {
      try { await approveDoc(a.projectId, a.kind, a.id, actor); ok++; } catch { failed.push(a.number); }
    }
    haptic([10, 40, 10]);
    if (ok) toast.success(`${ok} aprobada${ok === 1 ? "" : "s"}`);
    if (failed.length) toast.error(`No se han podido aprobar: ${failed.join(", ")}`);
    setPicked(new Set()); setSelecting(false); setBusy(null);
    await reload();
  };
  const toggle = (a: PendingApprovalItem) => setPicked((s) => { const n = new Set(s); if (n.has(key(a))) n.delete(key(a)); else n.add(key(a)); return n; });

  return (
    <PullToRefresh onRefresh={reload}>
      <div className="space-y-6 pb-16">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Aprobaciones{approvals.length > 0 && <span className="ml-2 text-base font-normal tabular-nums text-slate-400">{approvals.length}</span>}
          </h1>
          {approvals.length > 1 && (
            <button onClick={() => { setSelecting(!selecting); setPicked(new Set()); }} className="text-[14px] font-medium text-slate-700">
              {selecting ? "Cancelar" : "Seleccionar"}
            </button>
          )}
        </div>
        {loading && !data ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : approvals.length === 0 ? (
          <Empty>Nada pendiente de aprobar</Empty>
        ) : (
          [...byProject.entries()].map(([pid, g]) => (
            <section key={pid}>
              <SectionTitle count={g.items.length} action={
                selecting
                  ? <button onClick={() => setPicked((s) => { const n = new Set(s); const all = g.items.every((a) => n.has(key(a))); g.items.forEach((a) => (all ? n.delete(key(a)) : n.add(key(a)))); return n; })} className="text-xs font-medium text-slate-600">Todas</button>
                  : <span className="text-xs tabular-nums text-slate-400">{money(g.items.reduce((t, a) => t + a.base, 0))}</span>
              }>{g.name}</SectionTitle>
              <Card>
                {g.items.map((a) => selecting ? (
                  <div key={key(a)} role="checkbox" aria-checked={picked.has(key(a))} tabIndex={0} onClick={() => toggle(a)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(a); } }} className="flex w-full cursor-pointer items-center gap-3 pl-4 text-left active:bg-slate-50">
                    <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${picked.has(key(a)) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>
                      {picked.has(key(a)) && <Check size={13} strokeWidth={3} />}
                    </span>
                    <div className="pointer-events-none min-w-0 flex-1" aria-hidden="true"><ApprovalRow a={a} showProject={false} /></div>
                  </div>
                ) : (
                  <SwipeRow key={key(a)}
                    left={{ label: busy === key(a) ? "…" : "Aprobar", className: "bg-emerald-600", onClick: () => approveOne(a) }}
                    right={{ label: "Revisar", className: "bg-slate-500", onClick: () => router.push(approvalHref(a)) }}>
                    <ApprovalRow a={a} showProject={false} />
                  </SwipeRow>
                ))}
              </Card>
            </section>
          ))
        )}
        {!selecting && approvals.length > 0 && <p className="text-center text-[11px] text-slate-400">Desliza una fila a la derecha para aprobar sin abrirla</p>}
      </div>

      {selecting && picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{picked.size} seleccionada{picked.size === 1 ? "" : "s"}</p>
              <p className="text-xs tabular-nums text-slate-500">{money(chosen.reduce((t, a) => t + a.base, 0))} en base imponible</p>
            </div>
            <button disabled={busy === "bulk"} onClick={() => setConfirm(true)} className="h-11 rounded-xl bg-slate-900 px-5 text-[15px] font-medium text-white disabled:opacity-50">
              {busy === "bulk" ? "Aprobando…" : "Aprobar"}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-end bg-slate-900/30" onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirm(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Aprobar varias" className="w-full rounded-t-2xl bg-white px-4 pt-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
            <p className="text-[15px] font-semibold">¿Aprobar {picked.size} documento{picked.size === 1 ? "" : "s"}?</p>
            <div className="mt-3 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {chosen.map((a) => (
                <div key={key(a)} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <span className="font-mono text-[11px] text-slate-500">{a.number}</span>
                  <span className="min-w-0 flex-1 truncate">{a.supplier}</span>
                  <span className="tabular-nums">{money(a.base, a.currency)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setConfirm(false)} className="h-11 flex-1 rounded-xl border border-slate-200 text-[15px]">Cancelar</button>
              <button onClick={approveMany} className="h-11 flex-1 rounded-xl bg-slate-900 text-[15px] font-medium text-white">Aprobar</button>
            </div>
          </div>
        </div>
      )}
    </PullToRefresh>
  );
}
