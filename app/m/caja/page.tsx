"use client";

// App del cajero: firmas pendientes, saldo de las cajas y anticipos abiertos.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, PenLine } from "lucide-react";
import { useUser } from "@/contexts/UserContext";
import { loadCashier, type CashierData } from "@/lib/box/cashier";
import { directionLabel, MOMENT_LABEL } from "@/lib/box/signatures";
import { PullToRefresh } from "@/components/mobile/gestures";
import { Card, Empty, SectionTitle, ago, money } from "@/components/mobile/ui";

export default function MobileCashier() {
  const { user } = useUser();
  const [data, setData] = useState<CashierData | null>(null);
  const load = useCallback(async () => { if (user?.uid) setData(await loadCashier(user.uid)); }, [user?.uid]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [load]);

  if (!data) return <p className="py-16 text-center text-[13px] text-slate-400">Cargando…</p>;
  if (!data.projects.length) return <Empty>No llevas la caja de ningún proyecto</Empty>;
  const many = data.projects.length > 1;

  return (
    <PullToRefresh onRefresh={load}>
      <h1 className="mb-4 text-xl font-semibold tracking-tight">Caja</h1>

      <section className="mb-6">
        <SectionTitle count={data.pending.length}>Para firmar</SectionTitle>
        {data.pending.length === 0 ? <Empty>Nada pendiente de firma</Empty> : (
          <div className="space-y-2">
            {data.pending.map((r) => (
              <Link key={`${r.projectId}:${r.id}`} href={`/m/caja/${r.projectId}/${r.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 active:bg-slate-50">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-white"><PenLine size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-slate-900">{r.personName}</span>
                  <span className="block truncate text-xs text-slate-500">{MOMENT_LABEL[r.moment]} · {r.reference}{many && r.projectName ? ` · ${r.projectName}` : ""} · {ago(r.requestedAt)}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[15px] font-semibold tabular-nums">{money(r.amount)}</span>
                  <span className="block text-[11px] text-slate-500">{directionLabel(r.direction)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <SectionTitle count={data.floats.length}>Efectivo en caja</SectionTitle>
        {data.floats.length === 0 ? <Empty>Sin cajas de efectivo abiertas</Empty> : (
          <Card>
            {data.floats.map((f) => (
              <div key={`${f.projectId}:${f.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-slate-900">{f.name}</span>
                  <span className="block truncate text-xs text-slate-500">{[f.code, many ? f.projectName : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={`text-[15px] font-semibold tabular-nums ${f.balance < 0 ? "text-red-700" : "text-slate-900"}`}>{money(f.balance)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section>
        <SectionTitle count={data.advances.length}>Anticipos sin justificar</SectionTitle>
        {data.advances.length === 0 ? <Empty>Todo justificado</Empty> : (
          <Card>
            {data.advances.map((a) => {
              const days = Math.floor((Date.now() - new Date(`${a.date}T12:00:00`).getTime()) / 86_400_000);
              return (
                <Link key={`${a.projectId}:${a.id}`} href={`/project/${a.projectId}/accounting/box`} className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-900">{a.personName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      <span className="font-mono">{a.number}</span> · {a.floatName}{many ? ` · ${a.projectName}` : ""} · <span className={days > 7 ? "text-amber-700" : ""}>{days <= 0 ? "hoy" : `hace ${days} d`}</span>
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[13px] font-semibold tabular-nums">{money(a.outstanding)}</span>
                    {a.outstanding !== a.amount && <span className="block text-[11px] text-slate-500">de {money(a.amount)}</span>}
                  </span>
                  <ChevronRight size={16} className="text-slate-300" />
                </Link>
              );
            })}
          </Card>
        )}
      </section>
    </PullToRefresh>
  );
}
