"use client";

// ─── Admin · Proyectos ───────────────────────────────────────────────────────
// Todos los proyectos con su salud (actividad, uso de módulos, equipo),
// fase, cuenta y última actividad. Fila entera clicable → ficha 360º.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
import { Button, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Page, PageHeader, PageLoading, Select, useToast } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { AdminProject, healthLabel, useAdminData } from "@/components/admin/AdminData";
import { ProjectFormModal } from "@/components/admin/ProjectFormModal";
import { downloadCsv, HealthMeter, PHASE_DOT, PHASES, Pills, RowBar, timeAgo } from "@/components/admin/ui";

type Tab = "live" | "finished" | "frozen" | "trash" | "all";
type F = "all" | "name" | "account" | "member";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Nombre, ID, cuenta o miembro" },
  { value: "name", label: "Nombre o ID", placeholder: "Nombre o ID" },
  { value: "account", label: "Cuenta", placeholder: "Productora" },
  { value: "member", label: "Miembro", placeholder: "Nombre o email" },
];

function ProjectsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { loading, projects, producers, stats, reload, producerById } = useAdminData();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab>("live");
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState("");
  const [phase, setPhase] = useState("all");
  const [health, setHealth] = useState(params.get("health") || "all");
  const [account, setAccount] = useState("all");
  const [sort, setSort] = useState<"recent" | "activity" | "health">("recent");
  const [form, setForm] = useState<{ open: boolean; project: AdminProject | null }>({ open: params.get("new") === "1", project: null });

  useEffect(() => { if (params.get("new") === "1") setForm({ open: true, project: null }); }, [params]);

  const inTab = (p: AdminProject, t: Tab) =>
    t === "all" ? true :
    t === "trash" ? !!p.trashedAt :
    p.trashedAt ? false :
    t === "frozen" ? p.frozen :
    t === "finished" ? p.phase === "Finalizado" && !p.frozen :
    p.phase !== "Finalizado" && !p.frozen;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (!inTab(p, tab)) return false;
      if (phase !== "all" && p.phase !== phase) return false;
      if (account !== "all" && !(account === "none" ? p.producers.length === 0 : p.producers.includes(account))) return false;
      if (health !== "all" && healthLabel(stats[p.id]?.health, p.phase).tone !== health) return false;
      if (!t) return true;
      const name = `${p.name} ${p.id}`.toLowerCase();
      const acc = p.producers.map((id) => producerById(id)?.name || "").join(" ").toLowerCase();
      const mem = p.members.map((m) => `${m.name} ${m.email}`).join(" ").toLowerCase();
      return field === "name" ? name.includes(t) : field === "account" ? acc.includes(t) : field === "member" ? mem.includes(t) : `${name} ${acc} ${mem}`.includes(t);
    });
    const act = (p: AdminProject) => stats[p.id]?.lastActivityAt ?? 0;
    return list.sort((a, b) =>
      sort === "activity" ? act(b) - act(a) :
      sort === "health" ? (stats[a.id]?.health ?? 101) - (stats[b.id]?.health ?? 101) :
      (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, tab, phase, account, health, q, field, sort, stats]);

  if (loading) return <PageLoading />;

  const exportCsv = () => downloadCsv(`proyectos_${new Date().toISOString().slice(0, 10)}.csv`, [
    ["ID", "Nombre", "Fase", "Cuentas", "Miembros", "POs", "Facturas", "Crew", "Salud", "Última actividad"],
    ...rows.map((p) => [p.id, p.name, p.phase, p.producers.map((id) => producerById(id)?.name).join(" | "), p.members.length, stats[p.id]?.pos, stats[p.id]?.invoices, stats[p.id]?.crew, stats[p.id]?.health, stats[p.id]?.lastActivityAt ? new Date(stats[p.id].lastActivityAt!).toISOString() : ""]),
  ]);

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Proyectos <span className="text-[15px] font-normal text-slate-400">{projects.filter((p) => !p.trashedAt).length}</span></>}
        actions={
          <>
            <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => <MenuItem onClick={() => { close(); exportCsv(); }}>Exportar CSV</MenuItem>}
            </Menu>
            <Button variant="primary" onClick={() => setForm({ open: true, project: null })}><Plus size={14} /> Nuevo proyecto</Button>
          </>
        }
      />

      <div className="mt-6">
        <Pills value={tab} onChange={setTab} label="Estado" options={[
          { value: "live", label: "En curso", count: projects.filter((p) => inTab(p, "live")).length },
          { value: "finished", label: "Finalizados", count: projects.filter((p) => inTab(p, "finished")).length },
          { value: "frozen", label: "Congelados", count: projects.filter((p) => inTab(p, "frozen")).length },
          { value: "trash", label: "Papelera", count: projects.filter((p) => inTab(p, "trash")).length },
          { value: "all", label: "Todos", count: projects.length },
        ]} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={rows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="w-40"><Select value={phase} onChange={(e) => setPhase(e.target.value)}><option value="all">Todas las fases</option>{PHASES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>
          <div className="w-40"><Select value={health} onChange={(e) => setHealth(e.target.value)}><option value="all">Cualquier salud</option><option value="ok">Sanos</option><option value="warn">Atención</option><option value="bad">En riesgo</option></Select></div>
          <div className="w-44"><Select value={account} onChange={(e) => setAccount(e.target.value)}><option value="all">Todas las cuentas</option><option value="none">Sin cuenta</option>{producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div className="w-40"><Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="recent">Más recientes</option><option value="activity">Última actividad</option><option value="health">Peor salud</option></Select></div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4"><EmptyState title="No hay proyectos con estos filtros" /></div>
      ) : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead>
            <tr className="border-y border-slate-200 text-left text-[11px] uppercase tracking-[0.06em] text-slate-500">
              <th className="py-2 pl-4 pr-3 font-medium">Proyecto</th>
              <th className="w-36 px-3 py-2 font-medium">Fase</th>
              <th className="w-44 px-3 py-2 font-medium">Cuenta</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Miembros</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Docs 30 d</th>
              <th className="w-36 px-3 py-2 font-medium">Actividad</th>
              <th className="w-32 px-3 py-2 font-medium">Salud</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = stats[p.id];
              const h = healthLabel(s?.health, p.phase);
              return (
                <tr key={p.id} onClick={() => router.push(`/admindashboard/project/${p.id}`)} className="cursor-pointer border-b border-slate-100 hover:bg-[#FAFAFA]">
                  <td className="relative py-2 pl-4 pr-3">
                    <RowBar tone={p.trashedAt ? "none" : h.tone} />
                    <div className="truncate font-medium text-slate-900">{p.name}{p.frozen && !p.trashedAt && <span className="ml-2 text-[11px] font-normal text-sky-700">Congelado</span>}{p.trashedAt && <span className="ml-2 text-[11px] font-normal text-red-600">En papelera</span>}</div>
                    <div className="truncate font-mono text-[11px] text-slate-400">{p.id}</div>
                  </td>
                  <td className="px-3 py-2"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_DOT[p.phase] || "#94A3B8" }} />{p.phase}</span></td>
                  <td className="px-3 py-2 text-slate-600">{p.producers.map((id) => producerById(id)?.name || "—").join(", ") || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.members.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{s ? s.pos30 + s.invoices30 : "…"}</td>
                  <td className="px-3 py-2 text-slate-600">{s ? (s.lastActivityAt ? timeAgo(s.lastActivityAt) : "Sin actividad") : "…"}</td>
                  <td className="px-3 py-2" title={h.label}><HealthMeter value={p.phase === "Finalizado" ? undefined : s?.health} tone={h.tone} /></td>
                  <td className="px-1 py-2" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={(t) => <IconButton label="Acciones" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
                      {(close) => (
                        <>
                          <MenuItem onClick={() => { close(); router.push(`/admindashboard/project/${p.id}`); }}>Abrir ficha</MenuItem>
                          <MenuItem onClick={() => { close(); window.open(`/project/${p.id}`, "_blank"); }}>Ir al proyecto</MenuItem>
                          <MenuItem onClick={() => { close(); setForm({ open: true, project: p }); }}>Editar</MenuItem>
                          <MenuSeparator />
                          <MenuItem onClick={() => { close(); router.push(`/admindashboard/project/${p.id}?tab=summary&action=${p.trashedAt ? "restore" : p.frozen ? "unfreeze" : "freeze"}`); }}>{p.trashedAt ? "Restaurar…" : p.frozen ? "Descongelar…" : "Congelar…"}</MenuItem>
                          {!p.trashedAt && <MenuItem danger onClick={() => { close(); router.push(`/admindashboard/project/${p.id}?tab=summary&action=trash`); }}>Mover a la papelera…</MenuItem>}
                        </>
                      )}
                    </Menu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ProjectFormModal
        open={form.open}
        project={form.project}
        producers={producers}
        onClose={() => { setForm({ open: false, project: null }); if (params.get("new")) router.replace("/admindashboard/projects"); }}
        onSaved={(id) => { showToast("success", form.project ? "Proyecto actualizado" : "Proyecto creado"); reload(); if (!form.project) router.push(`/admindashboard/project/${id}`); }}
      />
    </Page>
  );
}

export default function ProjectsPage() {
  return <Suspense fallback={<PageLoading />}><ProjectsInner /></Suspense>;
}
