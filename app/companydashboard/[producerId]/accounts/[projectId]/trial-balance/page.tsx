"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/companydashboard/[producerId]/accounts/[projectId]/trial-balance/page.tsx
// Balance de Comprobación de Sumas y Saldos — datos reales de Firebase
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { ArrowLeft, Building2, RefreshCw, Search, Download, CheckCircle, AlertCircle } from "lucide-react";

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

interface TrialRow {
  code: string;
  nombre: string;
  totalDebe: number;
  totalHaber: number;
  saldoDeudor: number;
  saldoAcreedor: number;
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

const buildTrialBalance = (invoices: Invoice[]): TrialRow[] => {
  const map: Record<string, { nombre: string; totalDebe: number; totalHaber: number }> = {};

  const ensure = (code: string, nombre: string) => {
    if (!map[code]) map[code] = { nombre, totalDebe: 0, totalHaber: 0 };
    return map[code];
  };

  invoices
    .filter((i) => i.accounted && i.accountingEntryNumber)
    .forEach((inv) => {
      // Debe: líneas analíticas
      inv.items.forEach((item) => {
        ensure(item.subAccountCode, item.description).totalDebe += item.baseAmount;
      });
      // Debe: IVA soportado
      if (inv.vatAmount > 0) ensure("472", "H.P. IVA soportado").totalDebe += inv.vatAmount;
      // Haber: retenciones
      if (inv.irpfAmount < 0) ensure("473", "H.P. retenciones practicadas").totalHaber += Math.abs(inv.irpfAmount);
      // Haber: proveedores
      const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
      // Auto-cuadre: ajuste en proveedores para equilibrar
      const td = inv.items.reduce((s, i) => s + i.baseAmount, 0) + (inv.vatAmount > 0 ? inv.vatAmount : 0);
      const th = (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0) + net;
      const diff = td - th;
      ensure("400", "Proveedores").totalHaber += net + (diff > 0 ? diff : 0);
    });

  return Object.entries(map)
    .map(([code, { nombre, totalDebe, totalHaber }]) => {
      const saldo = totalDebe - totalHaber;
      return {
        code,
        nombre,
        totalDebe,
        totalHaber,
        saldoDeudor:   saldo > 0 ? saldo : 0,
        saldoAcreedor: saldo < 0 ? Math.abs(saldo) : 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
};

const exportCSV = (rows: string[][], filename: string) => {
  const blob = new Blob([rows.map((r) => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TrialBalancePage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,  setLoading]  = useState(true);
  const [producer, setProducer] = useState<{ id: string; name: string } | null>(null);
  const [project,  setProject]  = useState<{ id: string; name: string } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search,   setSearch]   = useState("");
  const [toast,    setToast]    = useState("");

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

  const trialBalance = useMemo(() => buildTrialBalance(invoices), [invoices]);
  const filtered = useMemo(() =>
    search ? trialBalance.filter((r) => r.code.includes(search) || r.nombre.toLowerCase().includes(search.toLowerCase())) : trialBalance,
    [trialBalance, search]
  );

  const totals = useMemo(() => ({
    sumaDebe:      filtered.reduce((s, r) => s + r.totalDebe,      0),
    sumaHaber:     filtered.reduce((s, r) => s + r.totalHaber,     0),
    saldoDeudor:   filtered.reduce((s, r) => s + r.saldoDeudor,   0),
    saldoAcreedor: filtered.reduce((s, r) => s + r.saldoAcreedor, 0),
  }), [filtered]);

  const balanced =
    Math.abs(totals.sumaDebe - totals.sumaHaber) < 0.01 &&
    Math.abs(totals.saldoDeudor - totals.saldoAcreedor) < 0.01;

  const handleExport = () => {
    const rows: string[][] = [["Código", "Denominación", "Suma Debe", "Suma Haber", "Saldo Deudor", "Saldo Acreedor"]];
    filtered.forEach((r) => rows.push([r.code, r.nombre, fmt(r.totalDebe), fmt(r.totalHaber), fmt(r.saldoDeudor), fmt(r.saldoAcreedor)]));
    rows.push(["", "TOTALES", fmt(totals.sumaDebe), fmt(totals.sumaHaber), fmt(totals.saldoDeudor), fmt(totals.saldoAcreedor)]);
    exportCSV(rows, "balance_sumas_saldos.csv");
    setToast("Balance exportado");
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
              <span className="text-xs text-slate-500">Sumas y Saldos</span>
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
                n.id === "trial-balance" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <span className="text-sm">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-[137px] p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Balance de Comprobación de Sumas y Saldos</h1>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {filtered.length} cuenta{filtered.length !== 1 ? "s" : ""} · PGC 2007
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Filtrar cuenta..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-52"
              />
            </div>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700">
              <Download size={13} /> Exportar CSV
            </button>
          </div>
        </div>

        {/* Balance check */}
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border mb-5 ${
          balanced
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {balanced ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <div>
            <p className="text-sm font-semibold">
              {balanced ? "Balance cuadrado correctamente" : "El balance no cuadra — revisar asientos"}
            </p>
            <p className="text-xs mt-0.5 font-mono opacity-80">
              Σ Debe {fmt(totals.sumaDebe)} € = Σ Haber {fmt(totals.sumaHaber)} € &nbsp;·&nbsp;
              Σ Deudor {fmt(totals.saldoDeudor)} € = Σ Acreedor {fmt(totals.saldoAcreedor)} €
            </p>
          </div>
        </div>

        {/* Table */}
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
                <th className="px-4 py-2" />
                <th className="px-4 py-2" />
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400 border-l border-slate-700">Debe</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Haber</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400 border-l border-slate-700">Deudor</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-slate-400">Acreedor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">
                    No hay cuentas con movimientos. Contabiliza facturas primero.
                  </td>
                </tr>
              ) : filtered.map((row, i) => (
                <tr key={row.code} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs font-bold text-slate-900">{row.code}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-sm text-slate-700">{row.nombre}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right border-l border-slate-100">
                    <span className="font-mono text-xs text-slate-700">{fmt(row.totalDebe)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-xs text-red-600">{fmt(row.totalHaber)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right border-l border-slate-100">
                    {row.saldoDeudor > 0
                      ? <span className="font-mono text-xs font-bold text-slate-900">{fmt(row.saldoDeudor)}</span>
                      : <span className="text-slate-200">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.saldoAcreedor > 0
                      ? <span className="font-mono text-xs font-bold text-red-600">{fmt(row.saldoAcreedor)}</span>
                      : <span className="text-slate-200">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 border-t-2 border-slate-700">
                <td colSpan={2} className="px-4 py-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Totales generales</span>
                </td>
                <td className="px-4 py-3 text-right border-l border-slate-700">
                  <span className="font-mono text-sm font-bold text-white">{fmt(totals.sumaDebe)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-sm font-bold text-red-400">{fmt(totals.sumaHaber)}</span>
                </td>
                <td className="px-4 py-3 text-right border-l border-slate-700">
                  <span className="font-mono text-sm font-bold text-white">{fmt(totals.saldoDeudor)}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-sm font-bold text-red-400">{fmt(totals.saldoAcreedor)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
