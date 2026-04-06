"use client";

// ─────────────────────────────────────────────────────────────────────────────
// app/companydashboard/[producerId]/accounts/[projectId]/chart-of-accounts/page.tsx
// Plan General Contable — PGC 2007 con saldos vivos calculados desde Firebase
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { ArrowLeft, Building2, RefreshCw, Search, ChevronDown, ChevronRight } from "lucide-react";

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

interface ChartAccount {
  code: string;
  name: string;
  type: "gasto" | "ingreso" | "activo" | "pasivo";
  group: string;
  parent?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNTING_NAV = [
  { id: "accounts",      label: "Cuentas",        icon: "📋", path: ""                  },
  { id: "journal",       label: "Libro Diario",   icon: "📔", path: "journal"            },
  { id: "ledger",        label: "Libro Mayor",    icon: "📚", path: "ledger"             },
  { id: "trial-balance", label: "Sumas y Saldos", icon: "⚖️", path: "trial-balance"     },
  { id: "chart",         label: "Plan Cuentas",   icon: "🗂️", path: "chart-of-accounts" },
];

const PLAN_GENERAL: ChartAccount[] = [
  { code: "621",    name: "Arrendamientos y cánones",              type: "gasto",  group: "6" },
  { code: "621.01", name: "Alquiler equipo cámara",                type: "gasto",  group: "6", parent: "621" },
  { code: "621.02", name: "Alquiler sala grabación",               type: "gasto",  group: "6", parent: "621" },
  { code: "621.03", name: "Alquiler localizaciones",               type: "gasto",  group: "6", parent: "621" },
  { code: "624",    name: "Transportes",                           type: "gasto",  group: "6" },
  { code: "624.01", name: "Transporte equipo y material",          type: "gasto",  group: "6", parent: "624" },
  { code: "625",    name: "Primas de seguros",                     type: "gasto",  group: "6" },
  { code: "625.01", name: "Seguro producción",                     type: "gasto",  group: "6", parent: "625" },
  { code: "629",    name: "Otros servicios",                       type: "gasto",  group: "6" },
  { code: "629.01", name: "Catering",                              type: "gasto",  group: "6", parent: "629" },
  { code: "631",    name: "Trabajos realizados por otras empresas", type: "gasto", group: "6" },
  { code: "631.01", name: "Jefe de cámara",                        type: "gasto",  group: "6", parent: "631" },
  { code: "631.02", name: "Operador steadicam",                    type: "gasto",  group: "6", parent: "631" },
  { code: "631.03", name: "Técnico de sonido",                     type: "gasto",  group: "6", parent: "631" },
  { code: "631.04", name: "VFX supervisor",                        type: "gasto",  group: "6", parent: "631" },
  { code: "631.05", name: "Montaje y edición",                     type: "gasto",  group: "6", parent: "631" },
  { code: "400",    name: "Proveedores",                           type: "pasivo", group: "4" },
  { code: "410",    name: "Acreedores",                            type: "pasivo", group: "4" },
  { code: "472",    name: "H.P. IVA soportado",                    type: "activo", group: "4" },
  { code: "473",    name: "H.P. retenciones practicadas",          type: "pasivo", group: "4" },
  { code: "570",    name: "Caja, euros",                           type: "activo", group: "5" },
  { code: "572",    name: "Bancos e instituciones de crédito",     type: "activo", group: "5" },
  { code: "700",    name: "Ventas de mercaderías",                 type: "ingreso", group: "7" },
  { code: "705",    name: "Prestaciones de servicios",             type: "ingreso", group: "7" },
];

const GROUP_NAMES: Record<string, string> = {
  "4": "Acreedores y deudores",
  "5": "Cuentas financieras",
  "6": "Compras y gastos",
  "7": "Ventas e ingresos",
};

const TYPE_STYLE: Record<string, { bg: string; text: string }> = {
  gasto:   { bg: "bg-amber-100",  text: "text-amber-800"  },
  ingreso: { bg: "bg-emerald-100",text: "text-emerald-800"},
  activo:  { bg: "bg-blue-100",   text: "text-blue-800"   },
  pasivo:  { bg: "bg-pink-100",   text: "text-pink-800"   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

/** Compute live balances per account code from accounted invoices */
const buildLiveBalances = (invoices: Invoice[]): Record<string, { totalDebe: number; totalHaber: number; saldo: number }> => {
  const map: Record<string, { totalDebe: number; totalHaber: number }> = {};
  const ensure = (code: string) => { if (!map[code]) map[code] = { totalDebe: 0, totalHaber: 0 }; return map[code]; };

  invoices.filter((i) => i.accounted && i.accountingEntryNumber).forEach((inv) => {
    inv.items.forEach((item) => { ensure(item.subAccountCode).totalDebe += item.baseAmount; });
    if (inv.vatAmount > 0)  ensure("472").totalDebe  += inv.vatAmount;
    if (inv.irpfAmount < 0) ensure("473").totalHaber += Math.abs(inv.irpfAmount);
    const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
    const td  = inv.items.reduce((s, i) => s + i.baseAmount, 0) + (inv.vatAmount > 0 ? inv.vatAmount : 0);
    const th  = (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0) + net;
    ensure("400").totalHaber += net + Math.max(td - th, 0);
  });

  return Object.fromEntries(
    Object.entries(map).map(([code, { totalDebe, totalHaber }]) => [
      code,
      { totalDebe, totalHaber, saldo: totalDebe - totalHaber },
    ])
  );
};

// ─────────────────────────────────────────────────────────────────────────────

export default function ChartOfAccountsPage() {
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "4": true, "5": true, "6": true, "7": true });

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

  const liveBalances = useMemo(() => buildLiveBalances(invoices), [invoices]);

  const filteredPlan = useMemo(() =>
    search
      ? PLAN_GENERAL.filter((c) => c.code.includes(search) || c.name.toLowerCase().includes(search.toLowerCase()))
      : PLAN_GENERAL,
    [search]
  );

  // Summary stats
  const totalGastos   = Object.entries(liveBalances).filter(([code]) => code.startsWith("6")).reduce((s, [, v]) => s + v.saldo, 0);
  const totalProveed  = Math.abs(liveBalances["400"]?.saldo || 0);
  const totalIVA      = liveBalances["472"]?.saldo || 0;
  const totalRet      = Math.abs(liveBalances["473"]?.saldo || 0);

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
              <span className="text-xs text-slate-500">Plan de Cuentas</span>
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
                n.id === "chart" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              <span className="text-sm">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-[137px] p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Plan General Contable</h1>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">Cuentas analíticas del proyecto · PGC 2007</p>
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              placeholder="Filtrar código o nombre..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-60"
            />
          </div>
        </div>

        {/* Live summary cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total gastos",      value: totalGastos,  color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200" },
            { label: "Saldo proveedores", value: totalProveed, color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200"   },
            { label: "IVA soportado",     value: totalIVA,     color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200"  },
            { label: "Ret. practicadas",  value: totalRet,     color: "text-pink-700",    bg: "bg-pink-50",    border: "border-pink-200"  },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} border ${s.border} rounded-lg px-4 py-3`}>
              <p className={`text-[9px] uppercase tracking-widest font-semibold ${s.color} opacity-70 mb-1`}>{s.label}</p>
              <p className={`font-mono text-xl font-bold ${s.color}`}>{fmt(s.value)} €</p>
            </div>
          ))}
        </div>

        {/* Account groups */}
        {["4", "5", "6", "7"].map((group) => {
          const groupAccounts = filteredPlan.filter((c) => c.group === group);
          if (groupAccounts.length === 0) return null;
          const isOpen = expanded[group] !== false;

          return (
            <div key={group} className="mb-4">
              {/* Group header */}
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, [group]: !isOpen }))}
                className={`w-full bg-slate-900 text-white px-4 py-2.5 flex items-center gap-3 ${
                  isOpen ? "rounded-t-lg" : "rounded-lg"
                } text-left hover:bg-slate-800 transition-colors`}
              >
                {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <span className="font-mono text-sm font-bold">Grupo {group}</span>
                <span className="text-slate-400 text-sm">—</span>
                <span className="text-slate-300 text-sm">{GROUP_NAMES[group]}</span>
                <span className="ml-auto text-[10px] text-slate-500 font-mono">
                  {groupAccounts.filter((c) => !c.parent).length} cuentas
                </span>
              </button>

              {isOpen && (
                <div className="bg-white border border-slate-200 border-t-0 rounded-b-lg overflow-hidden">
                  {groupAccounts.map((c, i) => {
                    const isParent  = !c.parent;
                    const live      = liveBalances[c.code];
                    const typeStyle = TYPE_STYLE[c.type];

                    return (
                      <div
                        key={c.code}
                        className={`flex items-center gap-3 ${
                          isParent ? "px-4 py-2.5 bg-slate-50" : "px-4 py-2 pl-10"
                        } ${i < groupAccounts.length - 1 ? "border-b border-slate-100" : ""} hover:bg-slate-50 transition-colors`}
                      >
                        {/* Code */}
                        <span className={`font-mono min-w-[72px] ${isParent ? "text-sm font-bold text-slate-900" : "text-xs text-slate-500"}`}>
                          {c.code}
                        </span>

                        {/* Name */}
                        <span className={`flex-1 ${isParent ? "text-sm font-medium text-slate-800" : "text-xs text-slate-600"}`}>
                          {c.name}
                        </span>

                        {/* Type badge */}
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${typeStyle.bg} ${typeStyle.text}`}>
                          {c.type}
                        </span>

                        {/* Live balance */}
                        {live ? (
                          <div className="text-right min-w-[160px]">
                            <p className="text-[9px] text-slate-400 mb-0.5 font-mono">
                              D {fmt(live.totalDebe)} · H {fmt(live.totalHaber)}
                            </p>
                            <p className={`font-mono text-sm font-bold ${live.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>
                              {live.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(live.saldo))} €
                            </p>
                          </div>
                        ) : (
                          <div className="text-right min-w-[160px]">
                            <span className="text-xs text-slate-300 font-mono">Sin movimientos</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
