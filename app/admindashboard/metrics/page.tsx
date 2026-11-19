"use client";

// ─── Admin · Métricas ────────────────────────────────────────────────────────
// Embudo de activación, retención por cohortes (meses con actividad de cada
// usuario), uso de cada módulo, crecimiento y proyectos con más actividad.

import { useMemo } from "react";
import Link from "next/link";
import { Page, PageHeader, PageLoading } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { Bars, BlockTitle } from "@/components/admin/ui";

const DAY = 86_400_000;
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k: string) => new Date(`${k}-15`).toLocaleDateString("es-ES", { month: "short", year: "2-digit" });

export default function MetricsPage() {
  const { loading, statsLoading, users, projects, stats } = useAdminData();

  const m = useMemo(() => {
    const now = Date.now();
    const regular = users.filter((u) => u.role === "user" && !u.isDemo);
    const live = projects.filter((p) => !p.trashedAt && p.phase !== "Finalizado");
    const usingAcc = new Set(projects.filter((p) => (stats[p.id]?.pos ?? 0) + (stats[p.id]?.invoices ?? 0) > 0).map((p) => p.id));
    const inUsedProject = regular.filter((u) => u.projectIds.some((id) => usingAcc.has(id)));

    const funnel = [
      { label: "Registrados", n: regular.length },
      { label: "En algún proyecto", n: regular.filter((u) => u.projectIds.length > 0).length },
      { label: "En un proyecto que usa Contabilidad", n: inUsedProject.length },
      { label: "Activos en los últimos 30 días", n: regular.filter((u) => (u.lastSeenAt?.toMillis?.() ?? 0) > now - 30 * DAY).length },
    ];

    // Cohortes: 6 últimos meses de alta × meses desde el alta
    const today = new Date();
    const cohorts = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - (5 - i), 1);
      const key = monthKey(d);
      const members = regular.filter((u) => u.createdAt && monthKey(u.createdAt.toDate()) === key);
      const cells = Array.from({ length: 6 - i }, (_, k) => {
        const mk = monthKey(new Date(d.getFullYear(), d.getMonth() + k, 1));
        const active = members.filter((u) => u.activeMonths.includes(mk)).length;
        return members.length ? Math.round((active / members.length) * 100) : null;
      });
      return { key, size: members.length, cells };
    });
    const hasActivityData = regular.some((u) => u.activeMonths.length > 0);

    const adoption = [
      { label: "Contabilidad", n: live.filter((p) => (stats[p.id]?.pos ?? 0) + (stats[p.id]?.invoices ?? 0) > 0).length, of: live.length, unit: "proyectos en curso" },
      { label: "Equipo (crew)", n: live.filter((p) => (stats[p.id]?.crew ?? 0) > 0).length, of: live.length, unit: "proyectos en curso" },
      { label: "Control horario", n: live.filter((p) => (stats[p.id]?.horarioDays ?? 0) > 0).length, of: live.length, unit: "proyectos en curso" },
      { label: "Budgeting", n: regular.filter((u) => u.budgetingAccess).length, of: regular.length, unit: "usuarios" },
    ];

    const months12 = Array.from({ length: 12 }, (_, i) => monthKey(new Date(today.getFullYear(), today.getMonth() - (11 - i), 1)));
    const usersByMonth = months12.map((k) => users.filter((u) => u.createdAt && monthKey(u.createdAt.toDate()) === k).length);
    const projectsByMonth = months12.map((k) => projects.filter((p) => p.createdAt && monthKey(p.createdAt.toDate()) === k).length);
    const activeByMonth = months12.map((k) => users.filter((u) => u.activeMonths.includes(k)).length);

    const top = projects
      .filter((p) => !p.trashedAt)
      .map((p) => ({ p, n: (stats[p.id]?.pos30 ?? 0) + (stats[p.id]?.invoices30 ?? 0) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);

    return { funnel, cohorts, hasActivityData, adoption, months12, usersByMonth, projectsByMonth, activeByMonth, top };
  }, [users, projects, stats]);

  if (loading) return <PageLoading />;
  const maxTop = Math.max(1, ...m.top.map((t) => t.n));
  const labels = m.months12.map(monthLabel);

  return (
    <Page>
      <PageHeader title={<>Métricas {statsLoading && <span className="text-xs font-normal text-slate-400">actualizando…</span>}</>} />

      <div className="mt-8 grid gap-12 lg:grid-cols-2">
        <section>
          <BlockTitle>Embudo de activación <span className="text-[11px] text-slate-400">· sin admins ni demo</span></BlockTitle>
          <div className="space-y-2.5">
            {m.funnel.map((f, i) => {
              const pct = m.funnel[0].n ? Math.round((f.n / m.funnel[0].n) * 100) : 0;
              const prev = i ? m.funnel[i - 1].n : f.n;
              const step = prev ? Math.round((f.n / prev) * 100) : 0;
              return (
                <div key={f.label}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span className="text-slate-700">{f.label}</span>
                    <span className="tabular-nums text-slate-900">{f.n} <span className="text-xs text-slate-400">{pct} %{i > 0 ? ` · ${step} % del paso anterior` : ""}</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-800" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <BlockTitle>Uso de los módulos</BlockTitle>
          <div className="space-y-2.5">
            {m.adoption.map((a) => {
              const pct = a.of ? Math.round((a.n / a.of) * 100) : 0;
              return (
                <div key={a.label}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span className="text-slate-700">{a.label}</span>
                    <span className="tabular-nums text-slate-900">{pct} % <span className="text-xs text-slate-400">{a.n} de {a.of} {a.unit}</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#2F52E0]" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="lg:col-span-2">
          <BlockTitle>Retención por cohortes <span className="text-[11px] text-slate-400">· % de cada mes de alta que sigue entrando</span></BlockTitle>
          {!m.hasActivityData && <p className="mb-3 text-xs text-slate-500">Los meses con actividad se registran desde esta versión: la tabla se irá llenando sola.</p>}
          <table className="tbl w-full table-fixed text-[13px]">
            <thead>
              <tr className="text-left"><th className="w-32 py-2 pl-4 pr-3">Alta</th><th className="w-24 px-3 text-right">Usuarios</th>{Array.from({ length: 6 }, (_, k) => <th key={k} className="px-1 text-center">{k === 0 ? "Mes 0" : `+${k}`}</th>)}</tr>
            </thead>
            <tbody>
              {m.cohorts.map((c) => (
                <tr key={c.key}>
                  <td className="py-1.5 pl-4 pr-3 capitalize">{monthLabel(c.key)}</td>
                  <td className="px-3 text-right tabular-nums">{c.size}</td>
                  {Array.from({ length: 6 }, (_, k) => {
                    const v = c.cells[k];
                    return (
                      <td key={k} className="px-1 py-1">
                        {v === undefined ? null : (
                          <div className="flex h-7 items-center justify-center rounded text-[11px] tabular-nums"
                            style={{ background: v === null ? "transparent" : `rgba(15,23,42,${0.06 + (v / 100) * 0.8})`, color: v !== null && v > 45 ? "#fff" : "#334155" }}>
                            {v === null ? "—" : `${v} %`}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <BlockTitle>Altas de usuarios por mes</BlockTitle>
          <Bars data={m.usersByMonth} labels={labels} height={72} />
        </section>
        <section>
          <BlockTitle>Usuarios activos por mes</BlockTitle>
          <Bars data={m.activeByMonth} labels={labels} height={72} tone="#2F52E0" />
        </section>
        <section>
          <BlockTitle>Proyectos creados por mes</BlockTitle>
          <Bars data={m.projectsByMonth} labels={labels} height={72} />
        </section>

        <section>
          <BlockTitle>Proyectos con más actividad <span className="text-[11px] text-slate-400">· POs y facturas, 30 días</span></BlockTitle>
          {m.top.length === 0 ? <p className="text-[13px] text-slate-400">{statsLoading ? "Calculando…" : "Sin actividad este mes"}</p> : (
            <div className="space-y-1.5">
              {m.top.map(({ p, n }) => (
                <Link key={p.id} href={`/admindashboard/project/${p.id}`} className="group flex items-center gap-3 text-[13px]">
                  <span className="w-44 truncate text-slate-700 group-hover:text-slate-900">{p.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-slate-800" style={{ width: `${(n / maxTop) * 100}%` }} /></span>
                  <span className="w-8 text-right tabular-nums text-slate-900">{n}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </Page>
  );
}
