"use client";

// Vista del flujo de aprobación de un documento (PO / factura): pasos con su
// estado, quién falta, pasos omitidos con su motivo y flujo bloqueado.

import { Check, Minus, X, AlertTriangle, Clock } from "lucide-react";
import { pendingSummary, stepLabel, type ApprovalStepState } from "@/lib/approvalFlow";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const fmtAt = (at: unknown) => {
  const d = at && typeof (at as { toDate?: () => Date }).toDate === "function" ? (at as { toDate: () => Date }).toDate() : at instanceof Date ? at : null;
  return d ? d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
};

type StepLike = Partial<ApprovalStepState> & { approvers?: string[]; approverNames?: string[] };

/** Lista de pasos. `current` marca el paso en curso (doc ya enviado). */
export function ApprovalSteps({ steps, current, department, preview = false, action }: { steps: StepLike[]; current?: number | null; department?: string | null; preview?: boolean; action?: (step: StepLike, index: number) => React.ReactNode }) {
  if (!steps?.length) return null;
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const status = s.status || "pending";
        const isCurrent = !preview && status === "pending" && i === current;
        const approved = new Set(s.approvedBy || []);
        const names = s.approverNames || [];
        return (
          <li key={s.id || i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                status === "approved" && "bg-emerald-500 text-white",
                status === "rejected" && "bg-red-500 text-white",
                status === "skipped" && "bg-slate-100 text-slate-400",
                status === "pending" && (isCurrent ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"),
              )}>
                {status === "approved" ? <Check size={13} /> : status === "rejected" ? <X size={13} /> : status === "skipped" ? <Minus size={13} /> : i + 1}
              </span>
              {i < steps.length - 1 && <span className="my-1 w-px flex-1 bg-slate-200" />}
            </div>
            <div className={cx("min-w-0 flex-1 pb-3", status === "skipped" && "opacity-70")}>
              {action && <div className="float-right ml-2">{action(s, i)}</div>}
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className={cx("text-[13px] font-medium", status === "skipped" ? "text-slate-400 line-through decoration-slate-300" : "text-slate-800")}>
                  {stepLabel({ approverType: s.approverType || "role", roles: s.roles, department: s.department }, department)}
                </p>
                {status === "pending" && names.length > 0 && (
                  <span className="text-[11px] text-slate-400">{s.requireAll ? `Todos · ${approved.size}/${names.length}` : names.length > 1 ? "Basta uno" : ""}</span>
                )}
              </div>
              {status === "skipped" ? (
                <p className="text-[12px] text-slate-400">Se omite · {s.skipReason || "sin aprobador"}</p>
              ) : (
                names.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {names.map((n, k) => {
                      const uid = s.approvers?.[k];
                      const done = !!uid && approved.has(uid);
                      const rec = (s.approvals || []).find((a) => a.uid === uid && a.by !== "rejected");
                      const rej = !!uid && (s.rejectedBy || []).includes(uid);
                      return (
                        <span key={k} title={done && rec ? `Aprobado ${fmtAt(rec.at)}` : undefined}
                          className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                            done ? "bg-emerald-50 text-emerald-700" : rej ? "bg-red-50 text-red-700" : isCurrent ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600")}>
                          {done && <Check size={10} />}{rej && <X size={10} />}{n}
                          {done && rec?.by && rec.by !== "rejected" && <span className="text-emerald-500">· admin</span>}
                        </span>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Banda "Pendiente de: …" para la cabecera de un documento. */
export function PendingApprovalNotice({ doc, onRepair }: { doc: Parameters<typeof pendingSummary>[0]; onRepair?: () => void }) {
  const p = pendingSummary(doc);
  if (p.state === "pending") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
        <Clock size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <span className="font-medium">Pendiente de {p.waitingFor.map((w) => w.name).join(", ")}</span>
          <span className="text-amber-700"> · Nivel {p.currentIndex + 1} de {(doc.approvalSteps || []).length}{p.rule ? ` · ${p.rule}` : ""}{p.remainingSteps.length ? ` · faltan ${p.remainingSteps.length} nivel${p.remainingSteps.length > 1 ? "es" : ""} más` : ""}</span>
        </div>
      </div>
    );
  }
  if (p.state === "blocked") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
        <AlertTriangle size={15} className="shrink-0" />
        <span className="flex-1">Flujo bloqueado: {p.blockedReason}</span>
        {onRepair && <button onClick={onRepair} className="rounded-md bg-white px-2.5 py-1 text-[12px] font-medium text-red-800 ring-1 ring-red-200 hover:bg-red-100">Reparar flujo</button>}
      </div>
    );
  }
  return null;
}

/** Texto corto para tooltips de listas. */
export function pendingTooltip(doc: Parameters<typeof pendingSummary>[0]) {
  const p = pendingSummary(doc);
  if (p.state === "pending") return `Pendiente de ${p.waitingFor.map((w) => w.name).join(", ")} (nivel ${p.currentIndex + 1})`;
  if (p.state === "blocked") return `Bloqueado: ${p.blockedReason}`;
  return "";
}
