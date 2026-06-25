"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  CheckCircle,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface JLine {
  id: string;
  code: string;
  name: string;
  debe: number;
  haber: number;
}

interface Invoice {
  id: string;
  displayNumber: string;
  supplier: string;
  description: string;
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  accounted: boolean;
  accountingEntryNumber?: string;
  invoiceDate: Date;
  items: any[];
  journalLines?: JLine[];
}

interface ManualEntry {
  id: string;
  numero: string;
  date: string;
  concepto: string;
  lines: JLine[];
}

interface TrialRow {
  code: string;
  name: string;
  totalDebe: number;
  totalHaber: number;
  saldoDeudor: number;
  saldoAcreedor: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: Date | undefined) => d ? new Intl.DateTimeFormat("es-ES").format(d) : "—";

function buildLines(inv: Invoice): JLine[] {
  if (inv.journalLines?.length) return inv.journalLines;
  const lines: JLine[] = [];
  inv.items.forEach((item: any, i: number) => { if (item.subAccountCode) lines.push({ id: `i${i}`, code: item.subAccountCode, name: item.description || item.subAccountCode, debe: item.baseAmount || 0, haber: 0 }); });
  if (inv.vatAmount > 0)  lines.push({ id: "iva",  code: "472", name: "H.P. IVA soportado", debe: inv.vatAmount, haber: 0 });
  if (inv.irpfAmount < 0) lines.push({ id: "irpf", code: "473", name: "H.P. retenciones", debe: 0, haber: Math.abs(inv.irpfAmount) });
  const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
  lines.push({ id: "prov", code: "400", name: `Proveedores — ${inv.supplier}`, debe: 0, haber: net });
  return lines;
}

const exportCSV = (rows: string[][], filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }));
  a.download = filename; a.click();
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TrialBalancePage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,  setLoading]  = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [manuals,  setManuals]  = useState<ManualEntry[]>([]);
  const [search,   setSearch]   = useState("");
  const [toast,    setToast]    = useState("");

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [pd, prj] = await Promise.all([getDoc(doc(db, "producers", producerId)), getDoc(doc(db, "projects", projectId))]);
      if (!pd.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!prj.exists()) { router.push(`/companydashboard/${producerId}`); return; }
      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
      ]);
      setInvoices(invSnap.docs.map(d => { const r = d.data(); return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null }; }));
      setManuals((manSnap as any).docs.map((d: any) => { const r = d.data(); return { id: d.id, numero: r.numero, date: r.date, concepto: r.concepto, lines: r.lines || [] }; }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [producerId, projectId, router, isAdmin]);

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [userLoading, hasAccess, router]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess, loadData]);

  const trialBalance = useMemo((): TrialRow[] => {
    const map: Record<string, { name: string; totalDebe: number; totalHaber: number }> = {};
    const ensure = (code: string, name: string) => { if (!map[code]) map[code] = { name, totalDebe: 0, totalHaber: 0 }; return map[code]; };
    invoices.filter(i => i.accounted && i.accountingEntryNumber).forEach(inv => {
      buildLines(inv).forEach(l => {
        const acc = ensure(l.code, l.name);
        acc.totalDebe  += l.debe  || 0;
        acc.totalHaber += l.haber || 0;
      });
    });
    manuals.forEach(me => me.lines.forEach(l => { const acc = ensure(l.code, l.name); acc.totalDebe += l.debe || 0; acc.totalHaber += l.haber || 0; }));
    return Object.entries(map).map(([code, { name, totalDebe, totalHaber }]) => {
      const saldo = totalDebe - totalHaber;
      return { code, name, totalDebe, totalHaber, saldoDeudor: saldo > 0 ? saldo : 0, saldoAcreedor: saldo < 0 ? Math.abs(saldo) : 0 };
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [invoices, manuals]);

  const filtered = useMemo(() => search ? trialBalance.filter(r => r.code.includes(search) || r.name.toLowerCase().includes(search.toLowerCase())) : trialBalance, [trialBalance, search]);

  const totals = useMemo(() => ({
    sumaDebe:      filtered.reduce((s, r) => s + r.totalDebe,      0),
    sumaHaber:     filtered.reduce((s, r) => s + r.totalHaber,     0),
    saldoDeudor:   filtered.reduce((s, r) => s + r.saldoDeudor,   0),
    saldoAcreedor: filtered.reduce((s, r) => s + r.saldoAcreedor, 0),
  }), [filtered]);

  const balanced = Math.abs(totals.sumaDebe - totals.sumaHaber) < 0.01 && Math.abs(totals.saldoDeudor - totals.saldoAcreedor) < 0.01;

  const handleExport = () => {
    const rows: string[][] = [["Código", "Denominación", "Suma Debe", "Suma Haber", "Saldo Deudor", "Saldo Acreedor"]];
    filtered.forEach(r => rows.push([r.code, r.name, fmt(r.totalDebe), fmt(r.totalHaber), fmt(r.saldoDeudor), fmt(r.saldoAcreedor)]));
    rows.push(["", "TOTALES", fmt(totals.sumaDebe), fmt(totals.sumaHaber), fmt(totals.saldoDeudor), fmt(totals.saldoAcreedor)]);
    exportCSV(rows, "balance_sumas_saldos.csv"); setToast("Balance exportado"); setTimeout(() => setToast(""), 2500);
  };

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50 bg-emerald-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"><CheckCircle size={14} />{toast}</div>}

      <div className="mt-16 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Balance de Comprobación de Sumas y Saldos</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">{filtered.length} cuentas · PGC 2007</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input placeholder="Filtrar cuenta" value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-52" />
            </div>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white text-xs font-medium rounded-lg hover:bg-slate-50"><Download size={13} />Exportar CSV</button>
          </div>
        </div>

        {/* Balance check */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border mb-5 ${balanced ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
          {balanced ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <div>
            <p className="text-sm font-semibold">{balanced ? "Balance cuadrado correctamente" : "El balance no cuadra — revisar asientos"}</p>
            <p className="font-mono text-xs mt-0.5 opacity-80">
              Σ Debe {fmt(totals.sumaDebe)} € = Σ Haber {fmt(totals.sumaHaber)} € &nbsp;·&nbsp;
              Σ Deudor {fmt(totals.saldoDeudor)} € = Σ Acreedor {fmt(totals.saldoAcreedor)} €
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 w-24">Código</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Denominación</th>
                <th colSpan={2} className="px-4 py-3 text-center text-xs font-semibold border-l border-slate-700">SUMAS</th>
                <th colSpan={2} className="px-4 py-3 text-center text-xs font-semibold border-l border-slate-700">SALDOS</th>
              </tr>
              <tr className="bg-slate-800 border-b-2 border-slate-900">
                <th className="px-4 py-2" /><th className="px-4 py-2" />
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400 border-l border-slate-700">Debe</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Haber</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400 border-l border-slate-700">Deudor</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Acreedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">Sin movimientos. Contabiliza facturas primero.</td></tr>
              ) : filtered.map((row, i) => (
                <tr key={row.code} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-4 py-2.5"><span className="font-mono text-xs font-bold text-slate-900">{row.code}</span></td>
                  <td className="px-4 py-2.5 text-sm text-slate-700">{row.name}</td>
                  <td className="px-4 py-2.5 text-right border-l border-slate-100"><span className="font-mono text-xs text-slate-700">{fmt(row.totalDebe)}</span></td>
                  <td className="px-4 py-2.5 text-right"><span className="font-mono text-xs text-red-600">{fmt(row.totalHaber)}</span></td>
                  <td className="px-4 py-2.5 text-right border-l border-slate-100">
                    {row.saldoDeudor > 0 ? <span className="font-mono text-xs font-bold text-slate-900">{fmt(row.saldoDeudor)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.saldoAcreedor > 0 ? <span className="font-mono text-xs font-bold text-red-600">{fmt(row.saldoAcreedor)}</span> : <span className="text-slate-200">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 border-t-2 border-slate-700">
                <td colSpan={2} className="px-4 py-3"><span className="font-mono text-xs font-semibold text-slate-400 uppercase tracking-widest">Totales generales</span></td>
                <td className="px-4 py-3 text-right border-l border-slate-700"><span className="font-mono text-sm font-bold text-white">{fmt(totals.sumaDebe)}</span></td>
                <td className="px-4 py-3 text-right"><span className="font-mono text-sm font-bold text-red-400">{fmt(totals.sumaHaber)}</span></td>
                <td className="px-4 py-3 text-right border-l border-slate-700"><span className="font-mono text-sm font-bold text-white">{fmt(totals.saldoDeudor)}</span></td>
                <td className="px-4 py-3 text-right"><span className="font-mono text-sm font-bold text-red-400">{fmt(totals.saldoAcreedor)}</span></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
