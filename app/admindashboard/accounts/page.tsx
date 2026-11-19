"use client";

// ─── Admin · Cuentas ─────────────────────────────────────────────────────────
// Las productoras como clientes: plan, uso frente a sus límites, actividad del
// último mes frente al anterior (riesgo de abandono) y renovación.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal, Plus, Receipt } from "lucide-react";
import { Button, EmptyState, IconButton, Menu, MenuItem, Page, PageHeader, PageLoading, useToast } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { AdminProducer, useAdminData } from "@/components/admin/AdminData";
import { AccountFormModal } from "@/components/admin/AccountFormModal";
import { accountActivity } from "@/components/admin/accountRisk";
import { downloadCsv, fmtDate, Pills, RowBar, timeAgo } from "@/components/admin/ui";

type Tab = "all" | "risk" | "renewal" | "empty";
type F = "all" | "name" | "contact" | "taxId";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Nombre, contacto o NIF" },
  { value: "name", label: "Nombre", placeholder: "Productora" },
  { value: "contact", label: "Contacto", placeholder: "Nombre o email" },
  { value: "taxId", label: "NIF / CIF", placeholder: "NIF", mono: true },
];
const DAY = 86_400_000;

function Usage({ used, max }: { used: number; max?: number | null }) {
  if (!max) return <span className="tabular-nums">{used}</span>;
  const over = used > max;
  return <span className={`tabular-nums ${over ? "font-medium text-red-600" : used === max ? "text-amber-700" : ""}`}>{used} <span className="text-slate-400">/ {max}</span></span>;
}

function AccountsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { loading, producers, projects, users, stats, reload } = useAdminData();
  const [toast, showToast] = useToast();
  const [tab, setTab] = useState<Tab>(params.get("filter") === "empty" ? "empty" : "all");
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState<{ open: boolean; account: AdminProducer | null }>({ open: params.get("new") === "1", account: null });
  useEffect(() => { if (params.get("new") === "1") setForm({ open: true, account: null }); }, [params]);

  const enriched = useMemo(() => producers.map((a) => ({
    a,
    projects: projects.filter((p) => p.producers.includes(a.id) && !p.trashedAt).length,
    users: users.filter((u) => u.companyId === a.id).length,
    act: accountActivity(a, projects, stats),
  })), [producers, projects, users, stats]);

  const inTab = (e: (typeof enriched)[number], t: Tab) =>
    t === "all" ? true :
    t === "risk" ? e.act.risk.tone === "bad" || e.act.risk.tone === "warn" :
    t === "renewal" ? !!e.a.renewalAt && e.a.renewalAt.toMillis() < Date.now() + 60 * DAY :
    e.users === 0;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return enriched.filter((e) => {
      if (!inTab(e, tab)) return false;
      if (!t) return true;
      const v = field === "name" ? e.a.name : field === "contact" ? `${e.a.contactName || ""} ${e.a.contactEmail || ""}` : field === "taxId" ? e.a.taxId || "" : `${e.a.name} ${e.a.contactName || ""} ${e.a.contactEmail || ""} ${e.a.taxId || ""}`;
      return v.toLowerCase().includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enriched, tab, q, field]);

  if (loading) return <PageLoading />;

  const exportCsv = () => downloadCsv(`cuentas_${new Date().toISOString().slice(0, 10)}.csv`, [
    ["Cuenta", "Plan", "Proyectos", "Máx. proyectos", "Usuarios", "Máx. usuarios", "Docs 30 d", "Docs 30 d anteriores", "Estado", "Renovación", "Contacto", "Email", "NIF"],
    ...rows.map((e) => [e.a.name, e.a.plan, e.projects, e.a.maxProjects, e.users, e.a.maxUsers, e.act.now, e.act.prev, e.act.risk.label, e.a.renewalAt ? e.a.renewalAt.toDate().toISOString().slice(0, 10) : "", e.a.contactName, e.a.contactEmail, e.a.taxId]),
  ]);

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Cuentas <span className="text-[15px] font-normal text-slate-400">{producers.length}</span></>}
        actions={
          <>
            <Menu trigger={(t) => <IconButton label="Más" onClick={t}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => <MenuItem onClick={() => { close(); exportCsv(); }}>Exportar CSV</MenuItem>}
            </Menu>
            <Button onClick={() => router.push("/admindashboard/accounts/billing")}><Receipt size={14} /> Facturación</Button>
            <Button variant="primary" onClick={() => setForm({ open: true, account: null })}><Plus size={14} /> Nueva cuenta</Button>
          </>
        }
      />

      <div className="mt-6">
        <Pills value={tab} onChange={setTab} label="Filtro" options={[
          { value: "all", label: "Todas", count: enriched.length },
          { value: "risk", label: "En riesgo", count: enriched.filter((e) => inTab(e, "risk")).length },
          { value: "renewal", label: "Renuevan en 60 d", count: enriched.filter((e) => inTab(e, "renewal")).length },
          { value: "empty", label: "Sin usuarios", count: enriched.filter((e) => e.users === 0).length },
        ]} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={rows.length} />
      </div>

      {rows.length === 0 ? <div className="mt-4"><EmptyState title="No hay cuentas con estos filtros" /></div> : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left">
              <th className="py-2 pl-4 pr-3">Cuenta</th>
              <th className="w-28 px-3 text-right">Proyectos</th>
              <th className="w-28 px-3 text-right">Usuarios</th>
              <th className="w-40 px-3 text-right">Docs 30 d</th>
              <th className="w-36 px-3">Tendencia</th>
              <th className="w-36 px-3">Renovación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, projects: np, users: nu, act }) => {
              const renewSoon = a.renewalAt && a.renewalAt.toMillis() < Date.now() + 30 * DAY;
              return (
                <tr key={a.id} onClick={() => router.push(`/admindashboard/accounts/${a.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="relative py-1.5 pl-4 pr-3">
                    <RowBar tone={act.risk.tone} />
                    <div className="truncate font-medium text-slate-900">{a.name}</div>
                    <div className="truncate text-xs text-slate-500">{[a.plan || "Sin plan", a.contactName, a.contactEmail].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 text-right"><Usage used={np} max={a.maxProjects} /></td>
                  <td className="px-3 text-right"><Usage used={nu} max={a.maxUsers} /></td>
                  <td className="px-3 text-right font-mono tabular-nums">{act.now} <span className="text-slate-400">· antes {act.prev}</span></td>
                  <td className={`px-3 ${act.risk.tone === "bad" ? "text-red-600" : act.risk.tone === "warn" ? "text-amber-700" : "text-slate-600"}`}>{act.risk.label}</td>
                  <td className={`px-3 ${renewSoon ? "text-amber-700" : "text-slate-600"}`} title={fmtDate(a.renewalAt)}>{a.renewalAt ? timeAgo(a.renewalAt) : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <AccountFormModal
        open={form.open}
        account={form.account}
        projects={projects}
        producers={producers}
        onClose={() => { setForm({ open: false, account: null }); if (params.get("new")) router.replace("/admindashboard/accounts"); }}
        onSaved={(id) => { showToast("success", "Cuenta guardada"); reload(); if (!form.account) router.push(`/admindashboard/accounts/${id}`); }}
      />
    </Page>
  );
}

export default function AccountsPage() {
  return <Suspense fallback={<PageLoading />}><AccountsInner /></Suspense>;
}
