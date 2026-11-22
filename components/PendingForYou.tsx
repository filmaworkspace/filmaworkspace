"use client";

// Dashboard de escritorio · "Pendiente de ti": aprobaciones que te esperan en
// todos tus proyectos y el estado de tus documentos. Mismo cargador que el
// inicio móvil (lib/myPending).

import { useEffect, useState } from "react";
import Link from "next/link";
import { desktopHref, KIND_LABEL, loadMyPending, type MyPending, type ProjectLite } from "@/lib/myPending";

const money = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
const ago = (d: Date | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "hoy" : days === 1 ? "ayer" : `hace ${days} d`;
};
const DOT = { rejected: "bg-red-500", pending: "bg-amber-500", draft: "bg-slate-300", approved: "bg-emerald-500" } as const;

export default function PendingForYou({ uid, projects }: { uid: string; projects: ProjectLite[] }) {
  const [data, setData] = useState<MyPending | null>(null);
  const key = projects.map((p) => p.id).join(",");
  useEffect(() => {
    if (!uid || !projects.length) return;
    let alive = true;
    loadMyPending(uid, projects.filter((p) => !p.archived)).then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  if (!data || (!data.approvals.length && !data.myDocs.length)) return null;
  const apps = data.approvals.slice(0, 6);
  const docs = data.myDocs.slice(0, 6);

  return (
    <section className="mb-10 grid gap-6 lg:grid-cols-2">
      <div className="min-w-0">
        <h2 className="mb-3 text-[13px] font-medium text-slate-500">
          Pendiente de ti <span className="ml-1 tabular-nums text-slate-400">{data.approvals.length}</span>
        </h2>
        {apps.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-[13px] text-slate-400">Nada pendiente de aprobar</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {apps.map((a) => (
              <Link key={`${a.kind}:${a.id}`} href={`/project/${a.projectId}/accounting/approvals`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FAFAFA]">
                <span className="w-20 shrink-0 font-mono text-[11px] text-slate-500">{a.number}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">{a.supplier}</p>
                  <p className="truncate text-xs text-slate-500">{[a.projectName, a.kind === "card" || a.kind === "transfer" ? KIND_LABEL[a.kind] : null, a.level && `nivel ${a.level}`, ago(a.createdAt)].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="text-[13px] font-medium tabular-nums text-slate-900">{money(a.base)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <h2 className="mb-3 text-[13px] font-medium text-slate-500">
          Tus documentos <span className="ml-1 tabular-nums text-slate-400">{data.myDocs.length}</span>
        </h2>
        {docs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-[13px] text-slate-400">No tienes documentos en curso</p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {docs.map((d) => (
              <Link key={`${d.kind}:${d.id}`} href={desktopHref(d)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FAFAFA]">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[d.state]}`} />
                <span className="w-20 shrink-0 font-mono text-[11px] text-slate-500">{d.number}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-slate-900">{d.supplier}</p>
                  <p className={`truncate text-xs ${d.state === "rejected" ? "text-red-600" : "text-slate-500"}`}>{[d.projectName, d.detail].join(" · ")}</p>
                </div>
                <span className="text-[13px] tabular-nums text-slate-700">{money(d.base)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
