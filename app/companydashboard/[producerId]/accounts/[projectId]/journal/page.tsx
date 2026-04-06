"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/companydashboard/[producerId]/accounts/[projectId]/journal/page.tsx
// Libro Diario — asientos contables generados desde las facturas de Firebase
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import {
  ArrowLeft, Building2, RefreshCw, Search, Download,
  AlertCircle, CheckCircle,
} from "lucide-react";

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
  dueDate: Date;
  createdAt: Date;
  items: InvoiceItem[];
}

interface EntryLine { cuenta: string; nombre: string; importe: number; }
interface JournalEntry {
  id: number;
  numero: string;
  fecha: Date;
  concepto: string;
  supplier: string;
  debe: EntryLine[];
  haber: EntryLine[];
  totalDebe: number;
  totalHaber: number;
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

const generateEntries = (invoices: Invoice[]): JournalEntry[] => {
  const entries: JournalEntry[] = [];
  let seq = 1;
  invoices
    .filter((i) => i.accounted && i.accountingEntryNumber)
    .forEach((inv) => {
      const debe: EntryLine[] = [];
      const haber: EntryLine[] = [];

      inv.items.forEach((item) =>
        debe.push({ cuenta: item.subAccountCode, nombre: item.description, importe: item.baseAmount })
      );
      if (inv.vatAmount > 0)
        debe.push({ cuenta: "472", nombre: "H.P. IVA soportado", importe: inv.vatAmount });
      if (inv.irpfAmount < 0)
        haber.push({ cuenta: "473", nombre: "H.P. retenciones practicadas", importe: Math.abs(inv.irpfAmount) });

      const netProveedores = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
      haber.push({ cuenta: "400", nombre: "Proveedores — " + inv.supplier, importe: netProveedores });

      // Auto-cuadre
      const td = debe.reduce((s, x) => s + x.importe, 0);
      const th = haber.reduce((s, x) => s + x.importe, 0);
      const diff = td - th;
      if (Math.abs(diff) > 0.01) {
        if (diff > 0) haber[haber.length - 1].importe += diff;
        else          debe[debe.length  - 1].importe += Math.abs(diff);
      }

      entries.push({
        id: seq++,
        numero:     inv.accountingEntryNumber!,
        fecha:      inv.invoiceDate,
        concepto:   inv.description + " — " + inv.displayNumber,
        supplier:   inv.supplier,
        debe,
        haber,
        totalDebe:  debe.reduce((s, x)  => s + x.importe, 0),
        totalHaber: haber.reduce((s, x) => s + x.importe, 0),
      });
    });
  return entries.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
};

const exportCSV = (rows: string[][], filename: string) => {
  const csv  = rows.map((r) => r.join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function JournalPage() {
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
          dueDate:               r.dueDate?.toDate?.()     || new Date(),
          createdAt:             r.createdAt?.toDate?.()   || new Date(),
          items:                 r.items || [],
        };
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const entries  = useMemo(() => generateEntries(invoices), [invoices]);
  const filtered = useMemo(() =>
    search
      ? entries.filter((e) =>
          e.numero.toLowerCase().includes(search.toLowerCase()) ||
          e.concepto.toLowerCase().includes(search.toLowerCase()) ||
          e.supplier.toLowerCase().includes(search.toLowerCase())
        )
      : entries,
    [entries, search]
  );

  const handleExport = () => {
    const rows: string[][] = [["Nº Asiento", "Fecha", "Concepto", "Tipo", "Cuenta", "Nombre", "Importe"]];
    filtered.forEach((e) => {
      e.debe.forEach( (d) => rows.push([e.numero, fmtDate(e.fecha), e.concepto, "DEBE",  d.cuenta, d.nombre, fmt(d.importe)]));
      e.haber.forEach((h) => rows.push([e.numero, fmtDate(e.fecha), e.concepto, "HABER", h.cuenta, h.nombre, fmt(h.importe)]));
    });
    exportCSV(rows, "libro_diario.csv");
    setToast("Libro Diario exportado");
    setTimeout(() => setToast(""), 2500);
  };

  const base = `/companydashboard/${producerId}/accounts/${projectId}`;
  const totalDebe  = filtered.reduce((s, e) => s + e.totalDebe,  0);
  const totalHaber = filtered.reduce((s, e) => s + e.totalHaber, 0);

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium bg-emerald-600 text-white">
          <CheckCircle size={15} /> {toast}
        </div>
      )}

      {/* Fixed top bar */}
      <div className="bg-white border-b border-slate-200 px-4 fixed top-16 left-0 right-0 z-40">
        {/* Breadcrumb */}
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
              <span className="text-xs text-slate-500">Libro Diario</span>
            </div>
          </div>
          <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {/* Sub-nav */}
        <nav className="flex">
          {ACCOUNTING_NAV.map((n) => (
            <Link key={n.id} href={`${base}/${n.path}`}
              className={`px-4 py-2 text-xs font-medium tracking-wide uppercase flex items-center gap-1.5 border-b-2 transition-colors ${
                n.id === "journal" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <span className="text-sm">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-[137px] p-6">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Libro Diario</h1>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">
              {filtered.length} asiento{filtered.length !== 1 ? "s" : ""} · {invoices.filter(i => i.accounted).length} facturas contabilizadas
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Buscar asiento, concepto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-64"
              />
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700"
            >
              <Download size={13} /> Exportar CSV
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
            <p className="text-sm text-slate-500">No hay asientos contables. Contabiliza facturas primero.</p>
          </div>
        ) : (
          <>
            {/* Journal entries */}
            {filtered.map((entry) => {
              const balanced = Math.abs(entry.totalDebe - entry.totalHaber) < 0.01;
              return (
                <div key={entry.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3">
                  {/* Entry header */}
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-4">
                    <span className="font-mono text-xs font-bold bg-slate-900 text-white px-2.5 py-1 rounded">
                      {entry.numero}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{fmtDate(entry.fecha)}</span>
                    <span className="text-sm text-slate-700 flex-1">{entry.concepto}</span>
                    <span className="font-mono text-xs text-slate-400">Σ {fmt(entry.totalDebe)} €</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      balanced ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}>
                      {balanced ? "✓ Cuadrado" : "✗ Descuadrado"}
                    </span>
                  </div>

                  {/* T layout */}
                  <div className="grid grid-cols-2 divide-x divide-slate-100">
                    {/* Debe */}
                    <div className="p-4">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Debe</p>
                      <div className="space-y-2">
                        {entry.debe.map((d, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{d.cuenta}</span>
                              <span className="text-xs text-slate-600">{d.nombre}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-slate-900 ml-3 whitespace-nowrap">{fmt(d.importe)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-100 mt-3 pt-2 flex justify-between">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total debe</span>
                        <span className="font-mono text-sm font-bold text-slate-900">{fmt(entry.totalDebe)} €</span>
                      </div>
                    </div>

                    {/* Haber */}
                    <div className="p-4">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Haber</p>
                      <div className="space-y-2">
                        {entry.haber.map((h, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{h.cuenta}</span>
                              <span className="text-xs text-slate-600">{h.nombre}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-red-600 ml-3 whitespace-nowrap">{fmt(h.importe)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-100 mt-3 pt-2 flex justify-between">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total haber</span>
                        <span className="font-mono text-sm font-bold text-red-600">{fmt(entry.totalHaber)} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Grand totals */}
            <div className="bg-slate-900 text-white rounded-lg px-6 py-4 flex items-center justify-between mt-4">
              <span className="text-xs font-semibold tracking-widest uppercase text-slate-400">
                Totales Diario — {filtered.length} asiento{filtered.length !== 1 ? "s" : ""}
              </span>
              <div className="flex gap-12">
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Debe</p>
                  <p className="font-mono text-lg font-bold">{fmt(totalDebe)} €</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Total Haber</p>
                  <p className="font-mono text-lg font-bold text-red-400">{fmt(totalHaber)} €</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
