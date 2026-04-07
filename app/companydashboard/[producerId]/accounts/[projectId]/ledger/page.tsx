"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/ledger/page.tsx

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { Search, Download, RefreshCw, CheckCircle } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface JLine  { id: string; code: string; name: string; debe: number; haber: number; }
interface Invoice { id: string; displayNumber: string; supplier: string; description: string; baseAmount: number; vatAmount: number; irpfAmount: number; totalAmount: number; accounted: boolean; accountingEntryNumber?: string; invoiceDate: Date; items: any[]; journalLines?: JLine[]; }
interface ManualEntry { id: string; numero: string; date: string; concepto: string; lines: JLine[]; }
interface LedgerMovement { fecha: string; concepto: string; entry: string; debe: number; haber: number; saldo: number; }
interface LedgerAccount { code: string; name: string; movimientos: LedgerMovement[]; totalDebe: number; totalHaber: number; saldoFinal: number; }

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

export default function LedgerPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,  setLoading]  = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [manuals,  setManuals]  = useState<ManualEntry[]>([]);
  const [search,   setSearch]   = useState("");
  const [selected, setSelected] = useState<LedgerAccount | null>(null);
  const [toast,    setToast]    = useState("");

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);

  const loadData = async () => {
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
  };

  const ledger = useMemo(() => {
    const map: Record<string, LedgerAccount> = {};
    const ensure = (code: string, name: string) => { if (!map[code]) map[code] = { code, name, movimientos: [], totalDebe: 0, totalHaber: 0, saldoFinal: 0 }; return map[code]; };
    invoices.filter(i => i.accounted && i.accountingEntryNumber).forEach(inv => {
      buildLines(inv).forEach(l => {
        const acc = ensure(l.code, l.name);
        if (l.debe  > 0) { acc.movimientos.push({ fecha: fmtDate(inv.invoiceDate), concepto: inv.description + " — " + inv.displayNumber, entry: inv.accountingEntryNumber!, debe: l.debe, haber: 0, saldo: 0 }); acc.totalDebe += l.debe; }
        if (l.haber > 0) { acc.movimientos.push({ fecha: fmtDate(inv.invoiceDate), concepto: inv.description + " — " + inv.displayNumber, entry: inv.accountingEntryNumber!, debe: 0, haber: l.haber, saldo: 0 }); acc.totalHaber += l.haber; }
      });
    });
    manuals.forEach(me => {
      me.lines.forEach(l => {
        const acc = ensure(l.code, l.name);
        if (l.debe  > 0) { acc.movimientos.push({ fecha: me.date, concepto: me.concepto, entry: me.numero, debe: l.debe, haber: 0, saldo: 0 }); acc.totalDebe += l.debe; }
        if (l.haber > 0) { acc.movimientos.push({ fecha: me.date, concepto: me.concepto, entry: me.numero, debe: 0, haber: l.haber, saldo: 0 }); acc.totalHaber += l.haber; }
      });
    });
    return Object.values(map).map(acc => {
      acc.movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha));
      let s = 0;
      acc.movimientos = acc.movimientos.map(m => { s += m.debe - m.haber; return { ...m, saldo: s }; });
      acc.saldoFinal = acc.totalDebe - acc.totalHaber;
      return acc;
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [invoices, manuals]);

  const filtered = useMemo(() => search ? ledger.filter(c => c.code.includes(search) || c.name.toLowerCase().includes(search.toLowerCase())) : ledger, [ledger, search]);

  const handleExport = () => {
    const rows: string[][] = [["Cuenta", "Nombre", "Fecha", "Concepto", "Asiento", "Debe", "Haber", "Saldo"]];
    filtered.forEach(c => c.movimientos.forEach(m => rows.push([c.code, c.name, m.fecha, m.concepto, m.entry, fmt(m.debe), fmt(m.haber), fmt(m.saldo)])));
    exportCSV(rows, "libro_mayor.csv"); setToast("Libro Mayor exportado"); setTimeout(() => setToast(""), 2500);
  };

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"><CheckCircle size={14} />{toast}</div>}

      <div className="mt-16 flex">
        {/* Main */}
        <div className={`flex-1 p-6 transition-all ${selected ? "mr-[400px]" : ""}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Libro Mayor</h1>
              <p className="font-mono text-xs text-slate-500 mt-0.5">{filtered.length} cuentas con movimientos</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input placeholder="Filtrar cuenta..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-56" />
              </div>
              <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white text-xs font-medium rounded-lg hover:bg-slate-50"><Download size={13} />Exportar Mayor</button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-12 text-center"><p className="text-sm text-slate-500">No hay movimientos contabilizados.</p></div>
          ) : filtered.map(cuenta => {
            const isSel = selected?.code === cuenta.code;
            return (
              <div key={cuenta.code} onClick={() => setSelected(isSel ? null : cuenta)}
                className={`bg-white rounded-lg overflow-hidden mb-3 cursor-pointer transition-all ${isSel ? "ring-2 ring-slate-900 shadow-md" : "border border-slate-200 hover:border-slate-300"}`}>
                {/* Account header */}
                <div className={`px-4 py-3 flex items-center gap-3 ${isSel ? "bg-slate-900" : "bg-slate-50 border-b border-slate-200"}`}>
                  <span className={`font-mono text-sm font-bold min-w-[64px] ${isSel ? "text-white" : "text-slate-900"}`}>{cuenta.code}</span>
                  <span className={`text-sm font-medium flex-1 ${isSel ? "text-slate-300" : "text-slate-700"}`}>{cuenta.name}</span>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Debe</p>
                      <p className={`font-mono text-sm font-semibold ${isSel ? "text-white" : "text-slate-900"}`}>{fmt(cuenta.totalDebe)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Haber</p>
                      <p className={`font-mono text-sm font-semibold ${isSel ? "text-red-400" : "text-red-600"}`}>{fmt(cuenta.totalHaber)}</p>
                    </div>
                    <div className="text-right min-w-[110px]">
                      <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Saldo</p>
                      <p className={`font-mono text-base font-bold ${isSel ? "text-white" : cuenta.saldoFinal >= 0 ? "text-slate-900" : "text-red-600"}`}>
                        {cuenta.saldoFinal >= 0 ? "D " : "A "}{fmt(Math.abs(cuenta.saldoFinal))}
                      </p>
                    </div>
                  </div>
                </div>
                {/* T-columns */}
                <div className="grid grid-cols-2 divide-x divide-slate-100 text-xs">
                  <div className="p-3">
                    <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-2">Debe</p>
                    {cuenta.movimientos.filter(m => m.debe > 0).map((m, i) => (
                      <div key={i} className="flex justify-between items-start py-1 border-b border-slate-50">
                        <div className="flex-1 pr-3 min-w-0">
                          <span className="font-mono text-[9px] text-slate-400 mr-2">{m.fecha}</span>
                          <span className="text-slate-600">{m.concepto.length > 50 ? m.concepto.slice(0, 50) + "…" : m.concepto}</span>
                        </div>
                        <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">{fmt(m.debe)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="p-3">
                    <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-2">Haber</p>
                    {cuenta.movimientos.filter(m => m.haber > 0).map((m, i) => (
                      <div key={i} className="flex justify-between items-start py-1 border-b border-slate-50">
                        <div className="flex-1 pr-3 min-w-0">
                          <span className="font-mono text-[9px] text-slate-400 mr-2">{m.fecha}</span>
                          <span className="text-slate-600">{m.concepto.length > 50 ? m.concepto.slice(0, 50) + "…" : m.concepto}</span>
                        </div>
                        <span className="font-mono font-semibold text-red-600 whitespace-nowrap">{fmt(m.haber)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="fixed right-0 top-16 bottom-0 w-[400px] bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col overflow-y-auto">
            <div className="bg-slate-900 px-5 py-4 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="font-mono text-2xl font-bold text-white">{selected.code}</p>
                <p className="text-slate-400 text-sm mt-0.5">{selected.name}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300 mt-1">✕</button>
            </div>
            <div className="grid grid-cols-3 border-b border-slate-200">
              {[
                { l: "Suma Debe",  v: selected.totalDebe,  c: "text-slate-900" },
                { l: "Suma Haber", v: selected.totalHaber, c: "text-red-600"   },
                { l: "Saldo",      v: selected.saldoFinal, c: selected.saldoFinal >= 0 ? "text-slate-900" : "text-red-600", p: selected.saldoFinal >= 0 ? "D " : "A " },
              ].map(s => (
                <div key={s.l} className="p-4 border-r border-slate-100 last:border-r-0">
                  <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest mb-1">{s.l}</p>
                  <p className={`font-mono text-sm font-bold ${s.c}`}>{(s as any).p || ""}{fmt(Math.abs(s.v))}</p>
                </div>
              ))}
            </div>
            <div className="p-5 flex-1">
              <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-4">Movimientos cronológicos</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-2 text-left text-[10px] font-medium text-slate-500">Fecha / Asiento</th>
                    <th className="pb-2 text-right text-[10px] font-medium text-slate-500">Debe</th>
                    <th className="pb-2 text-right text-[10px] font-medium text-slate-500">Haber</th>
                    <th className="pb-2 text-right text-[10px] font-medium text-slate-500">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.movimientos.map((m, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2">
                        <p className="font-mono text-[10px] text-slate-700">{m.fecha}</p>
                        <p className="text-[9px] text-slate-400">{m.entry}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{m.concepto.length > 28 ? m.concepto.slice(0, 28) + "…" : m.concepto}</p>
                      </td>
                      <td className="py-2 text-right">{m.debe > 0 ? <span className="font-mono font-semibold text-slate-900">{fmt(m.debe)}</span> : <span className="text-slate-200">—</span>}</td>
                      <td className="py-2 text-right">{m.haber > 0 ? <span className="font-mono font-semibold text-red-600">{fmt(m.haber)}</span> : <span className="text-slate-200">—</span>}</td>
                      <td className="py-2 text-right"><span className={`font-mono font-bold text-sm ${m.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>{m.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(m.saldo))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
