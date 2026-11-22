"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { KIND_LABEL, type MyDocItem, type PendingApprovalItem } from "@/lib/myPending";

export const money = (n: number, currency = "EUR") =>
  `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0)} ${currency === "USD" ? "$" : currency === "GBP" ? "£" : "€"}`;

export const ago = (d: Date | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "hoy" : days === 1 ? "ayer" : `hace ${days} d`;
};

export function SectionTitle({ children, count, action }: { children: React.ReactNode; count?: number; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-medium text-slate-500">
        {children}
        {count !== undefined && <span className="ml-1.5 tabular-nums text-slate-400">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-[13px] text-slate-400">{children}</p>;
}

export const approvalHref = (a: Pick<PendingApprovalItem, "projectId" | "kind" | "id">) => `/m/aprobaciones/${a.projectId}/${a.kind}/${a.id}`;

/** Fila de una aprobación pendiente: número, proveedor y base imponible. */
export function ApprovalRow({ a, showProject = true }: { a: PendingApprovalItem; showProject?: boolean }) {
  return (
    <Link href={approvalHref(a)} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-slate-500">{a.number}</span>
          <span className="truncate text-[11px] text-slate-400">{[showProject ? a.projectName : null, a.kind === "card" || a.kind === "transfer" ? KIND_LABEL[a.kind] : null].filter(Boolean).join(" · ")}</span>
        </div>
        <p className="truncate text-[15px] font-medium text-slate-900">{a.supplier}</p>
        <p className="text-xs text-slate-400">{[a.createdByName, ago(a.createdAt)].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="text-right">
        <p className="text-[15px] font-semibold tabular-nums text-slate-900">{money(a.base, a.currency)}</p>
        {a.level && <p className="text-[11px] text-slate-400">Nivel {a.level}</p>}
      </div>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </Link>
  );
}

const STATE_DOT: Record<MyDocItem["state"], string> = { rejected: "bg-red-500", pending: "bg-amber-500", draft: "bg-slate-300", approved: "bg-emerald-500" };

/** Fila de un documento propio con su estado (abre el detalle). */
export function DocRow({ d, showProject = true }: { d: MyDocItem; showProject?: boolean }) {
  return (
    <Link href={`/m/aprobaciones/${d.projectId}/${d.kind}/${d.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[d.state]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-slate-500">{d.number}</span>
          {showProject && <span className="truncate text-[11px] text-slate-400">{d.projectName}</span>}
        </div>
        <p className="truncate text-[14px] font-medium text-slate-900">{d.supplier}</p>
        <p className={`truncate text-xs ${d.state === "rejected" ? "text-red-600" : "text-slate-500"}`}>{d.detail}</p>
      </div>
      <p className="text-[14px] font-medium tabular-nums text-slate-900">{money(d.base)}</p>
      <ChevronRight size={16} className="shrink-0 text-slate-300" />
    </Link>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">{children}</div>;
}
