"use client";

// ─── Admin · Facturación ─────────────────────────────────────────────────────
// Presupuestos y facturas de Filma a sus cuentas. Los presupuestos van por
// proyecto (cuota mensual o pago único) y de ellos salen las facturas.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, FileText, Plus, Settings } from "lucide-react";
import { Button, EmptyState, IconButton, Page, PageHeader, PageLoading, Select } from "@/components/ds";
import SearchBar, { SearchField } from "@/components/SearchBar";
import { useAdminData } from "@/components/admin/AdminData";
import { downloadCsv, Pills, RowBar } from "@/components/admin/ui";
import { BillingSettingsModal } from "@/components/admin/billing/BillingSettingsModal";
import { NewDocModal } from "@/components/admin/billing/NewDocModal";
import { invoiceState, useBilling } from "@/components/admin/billing/useBilling";
import { countsAsBilled, eur, fmtDay, invoiceTotals, monthName, QUOTE_STATUS, quoteGrandTotal, todayIso } from "@/lib/billing";

type Tab = "invoices" | "quotes";
type InvFilter = "all" | "draft" | "pending" | "overdue" | "paid" | "voided";
type QuoteFilter = "all" | "draft" | "sent" | "accepted" | "rejected";
type F = "all" | "number" | "client" | "project";
const FIELDS: SearchField<F>[] = [
  { value: "all", label: "Buscar en todo", placeholder: "Número, cliente o proyecto" },
  { value: "number", label: "Número", placeholder: "F2026-0001", mono: true },
  { value: "client", label: "Cliente", placeholder: "Productora" },
  { value: "project", label: "Proyecto", placeholder: "Proyecto" },
];

function BillingInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { loading: adminLoading, producers, producerById } = useAdminData();
  const { invoices, quotes, settings, setSettings, loading } = useBilling();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "quotes" ? "quotes" : "invoices");
  const [invFilter, setInvFilter] = useState<InvFilter>("all");
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>("all");
  const [field, setField] = useState<F>("all");
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("all");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newDoc, setNewDoc] = useState<null | "quote" | "invoice">(null);

  const years = useMemo(() => Array.from(new Set([new Date().getFullYear(), ...invoices.map((i) => Number(i.issueDate.slice(0, 4))), ...quotes.map((x) => Number(x.issueDate.slice(0, 4)))])).sort((a, b) => b - a), [invoices, quotes]);
  const match = (number: string | null, client: string, project: string | null, producerId: string, date: string) => {
    if (account !== "all" && producerId !== account) return false;
    if (year !== "all" && !date.startsWith(year)) return false;
    const t = q.trim().toLowerCase();
    if (!t) return true;
    const v = field === "number" ? number || "" : field === "client" ? client : field === "project" ? project || "" : `${number || ""} ${client} ${project || ""}`;
    return v.toLowerCase().includes(t);
  };
  const clientName = (producerId: string, fallback: string) => producerById(producerId)?.name || fallback;

  const invBase = useMemo(() => invoices.filter((i) => match(i.number, clientName(i.producerId, i.client.name), i.projectName, i.producerId, i.issueDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoices, q, field, account, year, producers]);
  const invInFilter = (i: (typeof invoices)[number], f: InvFilter) => {
    const s = invoiceState(i).label;
    return f === "all" ? true : f === "draft" ? i.status === "draft" : f === "pending" ? s === "Pendiente de cobro" || s === "Vencida" : f === "overdue" ? s === "Vencida" : f === "paid" ? s === "Cobrada" : i.status === "voided" || i.kind === "rectifying";
  };
  const invRows = invBase.filter((i) => invInFilter(i, invFilter));

  const quoteBase = useMemo(() => quotes.filter((x) => match(x.number, clientName(x.producerId, x.client.name), x.projectName, x.producerId, x.issueDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotes, q, field, account, year, producers]);
  const quoteRows = quoteBase.filter((x) => quoteFilter === "all" || x.status === quoteFilter);

  const kpi = useMemo(() => {
    const month = todayIso().slice(0, 7);
    // Emitidas, anuladas y rectificativas: la anulada y su rectificativa se compensan.
    const billedMonth = invoices.filter((i) => i.status !== "draft" && i.issueDate.startsWith(month)).reduce((s, i) => s + i.baseAmount, 0);
    const pending = invoices.filter((i) => ["Pendiente de cobro", "Vencida"].includes(invoiceState(i).label));
    const overdue = pending.filter((i) => invoiceState(i).label === "Vencida");
    const billedYear = invoices.filter((i) => i.status !== "draft" && i.issueDate.startsWith(String(new Date().getFullYear()))).reduce((s, i) => s + i.baseAmount, 0);
    return { billedMonth, billedYear, pending: pending.reduce((s, i) => s + i.totalAmount, 0), overdue: overdue.reduce((s, i) => s + i.totalAmount, 0), overdueN: overdue.length };
  }, [invoices]);

  if (loading || adminLoading) return <PageLoading />;

  const exportCsv = () => downloadCsv(`facturas_${year}.csv`, [
    ["Número", "Fecha", "Cliente", "NIF", "Proyecto", "Periodo", "Presupuesto", "Base", "IVA", "Total", "Estado", "Cobrada el"],
    ...invRows.filter((i) => i.status !== "draft").map((i) => [i.number, fmtDay(i.issueDate), i.client.name, i.client.taxId, i.projectName, i.periodMonth ? monthName(i.periodMonth) : "", i.quoteNumber, i.baseAmount, i.vatAmount, i.totalAmount, invoiceState(i).label, i.paidAt ? fmtDay(i.paidAt) : ""]),
  ]);

  return (
    <Page>
      <Link href="/admindashboard/accounts" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft size={12} /> Cuentas</Link>
      <PageHeader
        title="Facturación"
        actions={
          <>
            <span className="mr-2 hidden items-center gap-4 text-xs text-slate-500 xl:flex">
              <span>Este mes <strong className="font-medium text-slate-900">{eur(kpi.billedMonth)}</strong></span>
              <span>{new Date().getFullYear()} <strong className="font-medium text-slate-900">{eur(kpi.billedYear)}</strong></span>
              <span>Por cobrar <strong className="font-medium text-slate-900">{eur(kpi.pending)}</strong></span>
              {kpi.overdueN > 0 && <span>Vencido <strong className="font-medium text-red-600">{eur(kpi.overdue)}</strong></span>}
            </span>
            <IconButton label="Datos fiscales de Filma" onClick={() => setSettingsOpen(true)}><Settings size={15} /></IconButton>
            <Button onClick={() => setNewDoc("quote")}><FileText size={14} /> Nuevo presupuesto</Button>
            <Button variant="primary" onClick={() => setNewDoc("invoice")}><Plus size={14} /> Nueva factura</Button>
          </>
        }
      />

      {(!settings.name || !settings.taxId) && (
        <button onClick={() => setSettingsOpen(true)} className="mt-4 w-full rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2 text-left text-xs text-amber-900">
          Antes de emitir, completa los datos fiscales de Filma (razón social, NIF, dirección e IBAN). <span className="font-medium underline">Completar</span>
        </button>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Pills value={tab} onChange={setTab} label="Documentos" options={[{ value: "invoices", label: "Facturas", count: invBase.length }, { value: "quotes", label: "Presupuestos", count: quoteBase.length }]} />
        {tab === "invoices" ? (
          <Pills value={invFilter} onChange={setInvFilter} label="Estado" options={[
            { value: "all", label: "Todas", count: invBase.length },
            { value: "draft", label: "Borradores", count: invBase.filter((i) => invInFilter(i, "draft")).length },
            { value: "pending", label: "Por cobrar", count: invBase.filter((i) => invInFilter(i, "pending")).length },
            { value: "overdue", label: "Vencidas", count: invBase.filter((i) => invInFilter(i, "overdue")).length },
            { value: "paid", label: "Cobradas", count: invBase.filter((i) => invInFilter(i, "paid")).length },
            { value: "voided", label: "Anuladas y rectificativas", count: invBase.filter((i) => invInFilter(i, "voided")).length },
          ]} />
        ) : (
          <Pills value={quoteFilter} onChange={setQuoteFilter} label="Estado" options={[
            { value: "all", label: "Todos", count: quoteBase.length },
            ...([["draft", "Borradores"], ["sent", "Enviados"], ["accepted", "Aceptados"], ["rejected", "Rechazados"]] as const).map(([s, label]) => ({ value: s, label, count: quoteBase.filter((x) => x.status === s).length })),
          ]} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={FIELDS} field={field} onField={setField} value={q} onChange={setQ} count={tab === "invoices" ? invRows.length : quoteRows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="w-48"><Select value={account} onChange={(e) => setAccount(e.target.value)}><option value="all">Todas las cuentas</option>{producers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div className="w-32"><Select value={year} onChange={(e) => setYear(e.target.value)}><option value="all">Todos los años</option>{years.map((y) => <option key={y} value={String(y)}>{y}</option>)}</Select></div>
          {tab === "invoices" && <IconButton label="Exportar CSV (para la gestoría)" onClick={exportCsv}><Download size={15} /></IconButton>}
        </div>
      </div>

      {tab === "invoices" ? (
        invRows.length === 0 ? <div className="mt-4"><EmptyState title={invoices.length ? "Ninguna factura con estos filtros" : "Todavía no hay facturas"} action={<Button onClick={() => setNewDoc("invoice")}><Plus size={14} /> Nueva factura</Button>} /></div> : (
          <table className="tbl mt-4 w-full table-fixed text-[13px]">
            <thead>
              <tr className="text-left">
                <th className="w-36 py-2 pl-4 pr-3">Número</th>
                <th className="px-3">Cliente y proyecto</th>
                <th className="w-28 px-3">Fecha</th>
                <th className="w-28 px-3">Vence</th>
                <th className="w-28 px-3 text-right">Base</th>
                <th className="w-28 px-3 text-right">Total</th>
                <th className="w-40 px-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {invRows.map((i) => {
                const s = invoiceState(i);
                const t = i.status === "draft" ? invoiceTotals(i.lines) : i;
                return (
                  <tr key={i.id} onClick={() => router.push(`/admindashboard/accounts/billing/invoices/${i.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                    <td className="relative py-1.5 pl-4 pr-3 font-mono text-[12px] text-slate-900"><RowBar tone={s.tone} />{i.number || <span className="font-sans text-slate-400">Borrador</span>}</td>
                    <td className="px-3">
                      <div className={`truncate ${i.status === "voided" ? "text-slate-400 line-through" : "font-medium text-slate-900"}`}>{clientName(i.producerId, i.client.name)}</div>
                      <div className="truncate text-xs text-slate-500">{[i.projectName, i.periodMonth && monthName(i.periodMonth), i.quoteNumber].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-3 text-slate-600">{fmtDay(i.issueDate)}</td>
                    <td className={`px-3 ${s.tone === "bad" ? "text-red-600" : "text-slate-600"}`}>{i.kind === "standard" ? fmtDay(i.dueDate) : "—"}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{eur(t.baseAmount)}</td>
                    <td className="px-3 text-right font-mono tabular-nums text-slate-900">{eur(t.totalAmount)}</td>
                    <td className={`px-3 ${s.tone === "bad" ? "text-red-600" : s.tone === "ok" ? "text-emerald-700" : s.tone === "warn" ? "text-amber-700" : "text-slate-500"}`}>{s.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : quoteRows.length === 0 ? <div className="mt-4"><EmptyState title={quotes.length ? "Ningún presupuesto con estos filtros" : "Todavía no hay presupuestos"} action={<Button onClick={() => setNewDoc("quote")}><Plus size={14} /> Nuevo presupuesto</Button>} /></div> : (
        <table className="tbl mt-4 w-full table-fixed text-[13px]">
          <thead>
            <tr className="text-left">
              <th className="w-36 py-2 pl-4 pr-3">Número</th>
              <th className="px-3">Cliente y proyecto</th>
              <th className="w-44 px-3">Cobro</th>
              <th className="w-32 px-3 text-right">Importe</th>
              <th className="w-48 px-3">Facturado</th>
              <th className="w-28 px-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {quoteRows.map((x) => {
              const st = QUOTE_STATUS[x.status];
              const t = x.status === "draft" ? invoiceTotals(x.lines) : x;
              const grand = quoteGrandTotal({ ...x, ...t });
              const billed = invoices.filter((i) => i.quoteId === x.id && countsAsBilled(i)).reduce((s, i) => s + i.baseAmount, 0);
              const pct = grand.base > 0 ? Math.min(100, Math.round((billed / grand.base) * 100)) : 0;
              return (
                <tr key={x.id} onClick={() => router.push(`/admindashboard/accounts/billing/quotes/${x.id}`)} className="cursor-pointer hover:bg-[#FAFAFA]">
                  <td className="relative py-1.5 pl-4 pr-3 font-mono text-[12px] text-slate-900"><RowBar tone={st.tone} />{x.number || <span className="font-sans text-slate-400">Borrador</span>}</td>
                  <td className="px-3">
                    <div className="truncate font-medium text-slate-900">{clientName(x.producerId, x.client.name)}</div>
                    <div className="truncate text-xs text-slate-500">{x.projectName}{x.title ? ` · ${x.title}` : ""}</div>
                  </td>
                  <td className="px-3 text-slate-600">{x.billingMode === "monthly" ? `Mensual · ${x.months || "?"} meses` : "Pago único"}</td>
                  <td className="px-3 text-right font-mono tabular-nums text-slate-900">{eur(t.baseAmount)}{x.billingMode === "monthly" && <span className="font-sans text-[11px] text-slate-400">/mes</span>}</td>
                  <td className="px-3">
                    {x.status === "draft" ? <span className="text-slate-300">—</span> : (
                      <span className="flex items-center gap-2">
                        <span className="h-1 w-20 overflow-hidden rounded-full bg-slate-100"><span className="block h-full" style={{ width: `${pct}%`, background: "#24406E" }} /></span>
                        <span className="font-mono text-[11px] tabular-nums text-slate-500">{pct} %</span>
                      </span>
                    )}
                  </td>
                  <td className={`px-3 ${st.tone === "ok" ? "text-emerald-700" : st.tone === "bad" ? "text-red-600" : st.tone === "info" ? "text-blue-700" : "text-slate-500"}`}>{st.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <BillingSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSaved={setSettings} />
      <NewDocModal open={!!newDoc} onClose={() => setNewDoc(null)} kind={newDoc || "invoice"} settings={settings} quotes={quotes} invoices={invoices} />
    </Page>
  );
}

export default function BillingPage() {
  return <Suspense fallback={<PageLoading />}><BillingInner /></Suspense>;
}
