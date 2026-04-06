"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/companydashboard/[producerId]/accounts/[projectId]/ledger/page.tsx
// Libro Mayor — T-accounts con saldo progresivo, datos reales de Firebase
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { ArrowLeft, Building2, RefreshCw, Search, Download, CheckCircle } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ── Types ─────────────────────────────────────────────────────────────────────

interface InvoiceItem {
  description: string;
  subAccountCode: string;
  subAccountId: string;
  baseAmount: number;
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
  status: string;
  accounted: boolean;
  accountingEntryNumber?: string;
  invoiceDate: Date;
  items: InvoiceItem[];
}

interface EntryLine { cuenta: string; nombre: string; importe: number; }
interface JournalEntry { numero: string; fecha: Date; concepto: string; debe: EntryLine[]; haber: EntryLine[]; }

interface LedgerMovement {
  fecha: Date;
  concepto: string;
  entryNum: string;
  debe: number;
  haber: number;
  saldo: number;
}

interface LedgerAccount {
  code: string;
  nombre: string;
  movimientos: LedgerMovement[];
  totalDebe: number;
  totalHaber: number;
  saldoFinal: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNTING_NAV = [
  { id: "accounts",      label: "Cuentas",        icon: "📋", path: ""                  },
  { id: "journal",       label: "Libro Diario",   icon: "📔", path: "journal"            },
  { id: "ledger",        label: "Libro Mayor",    icon: "📚", path: "ledger"             },
  { id: "trial-balance", label: "Sumas y Saldos", icon: "⚖️", path: "trial-balance"     },
  { id: "chart",         label: "Plan Cuentas",   icon: "🗂️", path: "chart-of-accounts" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const fmtDate = (d: Date | undefined) =>
  d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d) : "—";

const buildEntries = (invoices: Invoice[]): JournalEntry[] =>
  invoices
    .filter((i) => i.accounted && i.accountingEntryNumber)
    .map((inv) => {
      const debe: EntryLine[] = [];
      const haber: EntryLine[] = [];
      inv.items.forEach((item) =>
        debe.push({ cuenta: item.subAccountCode, nombre: item.description, importe: item.baseAmount })
      );
      if (inv.vatAmount > 0)
        debe.push({ cuenta: "472", nombre: "H.P. IVA soportado", importe: inv.vatAmount });
      if (inv.irpfAmount < 0)
        haber.push({ cuenta: "473", nombre: "H.P. retenciones practicadas", importe: Math.abs(inv.irpfAmount) });
      const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
      haber.push({ cuenta: "400", nombre: "Proveedores — " + inv.supplier, importe: net });
      // Auto-cuadre
      const td = debe.reduce((s, x) => s + x.importe, 0);
      const th = haber.reduce((s, x) => s + x.importe, 0);
      const diff = td - th;
      if (Math.abs(diff) > 0.01) {
        if (diff > 0) haber[haber.length - 1].importe += diff;
        else          debe[debe.length  - 1].importe += Math.abs(diff);
      }
      return { numero: inv.accountingEntryNumber!, fecha: inv.invoiceDate, concepto: inv.description + " — " + inv.displayNumber, debe, haber };
    })
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

const buildLedger = (entries: JournalEntry[]): LedgerAccount[] => {
  const map: Record<string, LedgerAccount> = {};
  const ensure = (code: string, nombre: string) => {
    if (!map[code]) map[code] = { code, nombre, movimientos: [], totalDebe: 0, totalHaber: 0, saldoFinal: 0 };
    return map[code];
  };
  entries.forEach((entry) => {
    entry.debe.forEach(({ cuenta, nombre, importe }) => {
      const acc = ensure(cuenta, nombre);
      acc.movimientos.push({ fecha: entry.fecha, concepto: entry.concepto, entryNum: entry.numero, debe: importe, haber: 0, saldo: 0 });
      acc.totalDebe += importe;
    });
    entry.haber.forEach(({ cuenta, nombre, importe }) => {
      const acc = ensure(cuenta, nombre);
      acc.movimientos.push({ fecha: entry.fecha, concepto: entry.concepto, entryNum: entry.numero, debe: 0, haber: importe, saldo: 0 });
      acc.totalHaber += importe;
    });
  });
  Object.values(map).forEach((acc) => {
    acc.movimientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    let running = 0;
    acc.movimientos = acc.movimientos.map((m) => { running += m.debe - m.haber; return { ...m, saldo: running }; });
    acc.saldoFinal = acc.totalDebe - acc.totalHaber;
  });
  return Object.values(map).sort((a, b) => a.code.localeCompare(b.code));
};

const exportCSV = (rows: string[][], filename: string) => {
  const blob = new Blob([rows.map((r) => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,   setLoading]   = useState(true);
  const [producer,  setProducer]  = useState<{ id: string; name: string } | null>(null);
  const [project,   setProject]   = useState<{ id: string; name: string } | null>(null);
  const [invoices,  setInvoices]  = useState<Invoice[]>([]);
  const [search,    setSearch]    = useState("");
  const [selected,  setSelected]  = useState<LedgerAccount | null>(null);
  const [toast,     setToast]     = useState("");

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  useEffect(() => {
    if (!userLoading && !hasAccess) router.push("/dashboard");
  }, [contextUser, userLoading]);

  useEffect(() => {
    if (producerId && projectId && hasAccess) loadData();
  }, [producerId, projectId, hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const producerDoc = await getDoc(doc(db, "producers", producerId));
      if (!producerDoc.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      setProducer({ id: producerDoc.id, name: producerDoc.data().name });

      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) { router.push(`/companydashboard/${producerId}`); return; }
      setProject({ id: projectDoc.id, name: projectDoc.data().name });

      const snap = await getDocs(
        query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))
      );
      setInvoices(snap.docs.map((d) => {
        const r = d.data();
        return {
          id:                    d.id,
          displayNumber:         r.displayNumber || r.number,
          supplier:              r.supplier,
          description:           r.description,
          baseAmount:            r.baseAmount  || 0,
          vatAmount:             r.vatAmount   || 0,
          irpfAmount:            r.irpfAmount  || 0,
          totalAmount:           r.totalAmount || 0,
          status:                r.status,
          accounted:             r.accounted   || false,
          accountingEntryNumber: r.accountingEntryNumber,
          invoiceDate:           r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(),
          items:                 r.items || [],
        };
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const entries  = useMemo(() => buildEntries(invoices), [invoices]);
  const ledger   = useMemo(() => buildLedger(entries),   [entries]);
  const filtered = useMemo(() =>
    search ? ledger.filter((c) => c.code.includes(search) || c.nombre.toLowerCase().includes(search.toLowerCase())) : ledger,
    [ledger, search]
  );

  const handleExport = () => {
    const rows: string[][] = [["Cuenta", "Nombre", "Fecha", "Concepto", "Asiento", "Debe", "Haber", "Saldo"]];
    filtered.forEach((c) =>
      c.movimientos.forEach((m) =>
        rows.push([c.code, c.nombre, fmtDate(m.fecha), m.concepto, m.entryNum, fmt(m.debe), fmt(m.haber), fmt(m.saldo)])
      )
    );
    exportCSV(rows, "libro_mayor.csv");
    setToast("Libro Mayor exportado");
    setTimeout(() => setToast(""), 2500);
  };

  const base = `/companydashboard/${producerId}/accounts/${projectId}`;

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium bg-emerald-600 text-white">
          <CheckCircle size={15} /> {toast}
        </div>
      )}

      {/* Fixed top bar */}
      <div className="bg-white border-b border-slate-200 px-4 fixed top-16 left-0 right-0 z-40">
        <div className="flex items-center justify-between py-2 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <Link href={`/companydashboard/${producerId}`} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <ArrowLeft size={16} />
            </Link>
            <div className="flex items-center gap-2 text-sm">
              <Building2 size={14} className="text-slate-400" />
              <span className="font-medium text-slate-600">{producer?.name}</span>
              <span className="text-slate-300">/</span>
              <span className="font-semibold text-slate-900">{project?.name}</span>
              <span className="text-slate-300">·</span>
              <span className="text-xs text-slate-500">Libro Mayor</span>
            </div>
          </div>
          <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <nav className="flex">
          {ACCOUNTING_NAV.map((n) => (
            <Link key={n.id} href={`${base}/${n.path}`}
              className={`px-4 py-2 text-xs font-medium tracking-wide uppercase flex items-center gap-1.5 border-b-2 transition-colors ${
                n.id === "ledger" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <span className="text-sm">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-[137px] flex">
        {/* Main */}
        <div className={`flex-1 p-6 transition-all ${selected ? "mr-[400px]" : ""}`}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Libro Mayor</h1>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                {filtered.length} cuenta{filtered.length !== 1 ? "s" : ""} con movimientos
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  placeholder="Filtrar por código o nombre..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-60"
                />
              </div>
              <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700">
                <Download size={13} /> Exportar Mayor
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
              <p className="text-sm text-slate-500">No hay cuentas con movimientos.</p>
            </div>
          ) : (
            filtered.map((cuenta) => {
              const isSel = selected?.code === cuenta.code;
              return (
                <div key={cuenta.code}
                  onClick={() => setSelected(isSel ? null : cuenta)}
                  className={`bg-white rounded-lg overflow-hidden mb-3 cursor-pointer transition-all ${
                    isSel ? "border-2 border-slate-900 shadow-md" : "border border-slate-200 hover:border-slate-300"
                  }`}>

                  {/* Account header */}
                  <div className={`px-4 py-3 flex items-center gap-3 border-b border-slate-100 ${isSel ? "bg-slate-900" : "bg-slate-50"}`}>
                    <span className={`font-mono text-sm font-bold min-w-[64px] ${isSel ? "text-white" : "text-slate-900"}`}>
                      {cuenta.code}
                    </span>
                    <span className={`text-sm font-medium flex-1 ${isSel ? "text-slate-300" : "text-slate-700"}`}>
                      {cuenta.nombre}
                    </span>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className={`text-[9px] uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Debe</p>
                        <p className={`font-mono text-sm font-semibold ${isSel ? "text-white" : "text-slate-900"}`}>{fmt(cuenta.totalDebe)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-[9px] uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Haber</p>
                        <p className={`font-mono text-sm font-semibold ${isSel ? "text-red-400" : "text-red-600"}`}>{fmt(cuenta.totalHaber)}</p>
                      </div>
                      <div className="text-right min-w-[110px]">
                        <p className={`text-[9px] uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Saldo</p>
                        <p className={`font-mono text-base font-bold ${
                          isSel ? "text-white" : cuenta.saldoFinal >= 0 ? "text-slate-900" : "text-red-600"
                        }`}>
                          {cuenta.saldoFinal >= 0 ? "D " : "A "}{fmt(Math.abs(cuenta.saldoFinal))}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* T columns */}
                  <div className="grid grid-cols-2 divide-x divide-slate-100 text-xs">
                    <div className="p-3">
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Debe</p>
                      {cuenta.movimientos.filter((m) => m.debe > 0).map((m, i) => (
                        <div key={i} className="flex justify-between items-start py-1 border-b border-slate-50">
                          <div className="flex-1 pr-3">
                            <span className="font-mono text-[9px] text-slate-400 mr-2">{fmtDate(m.fecha)}</span>
                            <span className="text-slate-600">{m.concepto.length > 50 ? m.concepto.substring(0, 50) + "…" : m.concepto}</span>
                          </div>
                          <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">{fmt(m.debe)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="p-3">
                      <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Haber</p>
                      {cuenta.movimientos.filter((m) => m.haber > 0).map((m, i) => (
                        <div key={i} className="flex justify-between items-start py-1 border-b border-slate-50">
                          <div className="flex-1 pr-3">
                            <span className="font-mono text-[9px] text-slate-400 mr-2">{fmtDate(m.fecha)}</span>
                            <span className="text-slate-600">{m.concepto.length > 50 ? m.concepto.substring(0, 50) + "…" : m.concepto}</span>
                          </div>
                          <span className="font-mono font-semibold text-red-600 whitespace-nowrap">{fmt(m.haber)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="fixed right-0 top-16 bottom-0 w-[400px] bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col overflow-y-auto">
            <div className="bg-slate-900 px-5 py-4 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="font-mono text-2xl font-bold text-white">{selected.code}</p>
                <p className="text-slate-400 text-sm mt-0.5">{selected.nombre}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-slate-300 text-lg mt-1">✕</button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 border-b border-slate-200">
              {[
                { label: "Suma Debe",  value: selected.totalDebe,  color: "text-slate-900" },
                { label: "Suma Haber", value: selected.totalHaber, color: "text-red-600"   },
                { label: "Saldo",      value: selected.saldoFinal, color: selected.saldoFinal >= 0 ? "text-slate-900" : "text-red-600",
                  prefix: selected.saldoFinal >= 0 ? "D " : "A " },
              ].map((s) => (
                <div key={s.label} className="p-4 border-r border-slate-100 last:border-r-0">
                  <p className="text-[9px] text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
                  <p className={`font-mono text-sm font-bold ${s.color}`}>
                    {(s as any).prefix || ""}{fmt(Math.abs(s.value))}
                  </p>
                </div>
              ))}
            </div>

            {/* Progressive movements */}
            <div className="p-5 flex-1">
              <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                Movimientos cronológicos
              </p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left pb-2 font-medium text-slate-500">Fecha</th>
                    <th className="text-right pb-2 font-medium text-slate-500">Debe</th>
                    <th className="text-right pb-2 font-medium text-slate-500">Haber</th>
                    <th className="text-right pb-2 font-medium text-slate-500">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.movimientos.map((m, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2">
                        <p className="font-mono text-[10px] text-slate-700">{fmtDate(m.fecha)}</p>
                        <p className="text-[9px] text-slate-400">{m.entryNum}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{m.concepto.length > 28 ? m.concepto.substring(0, 28) + "…" : m.concepto}</p>
                      </td>
                      <td className="py-2 text-right">
                        {m.debe > 0
                          ? <span className="font-mono font-semibold text-slate-900">{fmt(m.debe)}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        {m.haber > 0
                          ? <span className="font-mono font-semibold text-red-600">{fmt(m.haber)}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="py-2 text-right">
                        <span className={`font-mono font-bold text-sm ${m.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>
                          {m.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(m.saldo))}
                        </span>
                      </td>
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
