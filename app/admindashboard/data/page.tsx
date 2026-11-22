"use client";

// ─── Admin · Datos ───────────────────────────────────────────────────────────
// Reparar aprobaciones atascadas y recalcular el presupuesto de todos los
// proyectos (o de uno). Primero se simula y se ve qué cambiaría; aplicar pide
// la contraseña y queda en la auditoría.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Play, RotateCw } from "lucide-react";
import { Button, Page, PageHeader, Select } from "@/components/ds";
import { useAdminData } from "@/components/admin/AdminData";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { adminFetch, BlockTitle, downloadCsv } from "@/components/admin/ui";
import { toast } from "@/lib/toast";
import type { MaintenanceSummary } from "@/lib/server/maintenance";

export default function AdminData() {
  const { projects } = useAdminData();
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState<null | "sim" | "apply">(null);
  const [result, setResult] = useState<MaintenanceSummary | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [onlyChanges, setOnlyChanges] = useState(true);

  const live = useMemo(() => projects.filter((p) => !p.trashedAt).sort((a, b) => a.name.localeCompare(b.name)), [projects]);
  const body = (dryRun: boolean) => ({ dryRun, projectIds: scope === "all" ? undefined : [scope] });

  const simulate = async () => {
    setBusy("sim");
    try { setResult(await adminFetch<MaintenanceSummary>("/api/admin/maintenance", body(true))); }
    catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const apply = async () => {
    setBusy("apply");
    try {
      const r = await adminFetch<MaintenanceSummary>("/api/admin/maintenance", body(false));
      setResult(r);
      toast.success(`Hecho: ${r.totals.flowsRepaired} flujos reparados y ${r.totals.subaccountsUpdated} cifras corregidas`);
    } finally { setBusy(null); }
  };

  const rows = (result?.projects || []).filter((r) => !onlyChanges || r.flowsRepaired || r.subaccountsUpdated || r.error || r.issues);
  const pending = !!result?.dryRun && (result.totals.flowsRepaired > 0 || result.totals.subaccountsUpdated > 0);

  return (
    <Page>
      <PageHeader title="Datos" />

      <section className="mt-6 max-w-4xl">
        <BlockTitle>Presupuesto y aprobaciones</BlockTitle>
        <div className="rounded-lg border border-slate-200 p-4">
          <ul className="space-y-1 text-[13px] text-slate-600">
            <li>Repara los flujos de aprobación atascados: niveles sin aprobador, que no aplican por importe o ya completos.</li>
            <li>Recalcula comprometido, realizado y caja de cada subcuenta, y lo facturado de cada PO, desde los documentos.</li>
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Select value={scope} onChange={(e) => { setScope(e.target.value); setResult(null); }}>
                <option value="all">Todos los proyectos ({live.length})</option>
                {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <Button onClick={simulate} disabled={!!busy}><RotateCw size={14} className={busy === "sim" ? "animate-spin" : ""} /> {busy === "sim" ? "Simulando…" : "Simular"}</Button>
            <Button variant="primary" onClick={() => setConfirm(true)} disabled={!!busy || !pending}><Play size={14} /> {busy === "apply" ? "Aplicando…" : "Aplicar"}</Button>
          </div>
        </div>
      </section>

      {result && (
        <section className="mt-8 max-w-4xl">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-4">
            {[
              ["Proyectos", result.totals.projects],
              [result.dryRun ? "Flujos por reparar" : "Flujos reparados", result.totals.flowsRepaired],
              [result.dryRun ? "Quedarían aprobados" : "Aprobados", result.totals.flowsCompleted],
              [result.dryRun ? "Cifras por corregir" : "Cifras corregidas", result.totals.subaccountsUpdated],
            ].map(([l, v]) => (
              <div key={String(l)} className="bg-white px-4 py-3">
                <p className="text-xs text-slate-500">{l}</p>
                <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-slate-900">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              {result.dryRun ? "Simulación: no se ha cambiado nada" : "Aplicado"} · <span className="font-mono">{(result.ms / 1000).toFixed(1)} s</span>
              {result.totals.errors > 0 && <span className="ml-2 text-red-600">{result.totals.errors} con error</span>}
            </span>
            <span className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Solo con cambios</label>
              <button className="hover:text-slate-900" onClick={() => downloadCsv(`mantenimiento-${new Date().toISOString().slice(0, 10)}.csv`, [
                ["Proyecto", "Id", "Flujos", "Aprobados", "Cifras", "Líneas sin cuenta", "Error"],
                ...result.projects.map((r) => [r.name, r.projectId, r.flowsRepaired, r.flowsCompleted, r.subaccountsUpdated, r.issues, r.error || ""]),
              ])}>CSV</button>
            </span>
          </div>

          <table className="tbl mt-3 w-full table-fixed text-[13px]">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Proyecto</th>
                <th className="w-24 py-2 text-right font-medium">Flujos</th>
                <th className="w-24 py-2 text-right font-medium">Aprobados</th>
                <th className="w-24 py-2 text-right font-medium">Cifras</th>
                <th className="w-32 py-2 text-right font-medium">Sin cuenta</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Todo cuadra. No hay nada que cambiar.</td></tr>}
              {rows.map((r) => (
                <tr key={r.projectId} className="border-t border-slate-100">
                  <td className="truncate py-2">
                    <Link href={`/admindashboard/project/${r.projectId}`} className="text-slate-900 hover:underline">{r.name}</Link>
                    {r.error && <p className="truncate text-xs text-red-600">{r.error}</p>}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.flowsRepaired || <span className="text-slate-300">0</span>}</td>
                  <td className="py-2 text-right tabular-nums">{r.flowsCompleted || <span className="text-slate-300">0</span>}</td>
                  <td className="py-2 text-right tabular-nums">{r.subaccountsUpdated || <span className="text-slate-300">0</span>}</td>
                  <td className={`py-2 text-right tabular-nums ${r.issues ? "text-amber-700" : ""}`}>{r.issues || <span className="text-slate-300">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Aplicar cambios"
        danger={false}
        confirmLabel="Aplicar"
        notice={result ? `${result.totals.flowsRepaired} flujos y ${result.totals.subaccountsUpdated} cifras en ${scope === "all" ? "todos los proyectos" : live.find((p) => p.id === scope)?.name}.` : undefined}
        onConfirm={apply}
      />
    </Page>
  );
}
