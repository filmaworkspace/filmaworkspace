"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/chart-of-accounts/page.tsx

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, setDoc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { Search, Plus, Trash2, ChevronDown, ChevronRight, RefreshCw, Save, X } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface ChartAccount { code: string; name: string; type: string; group: string; parent?: string | null; }
interface JLine { id: string; code: string; name: string; debe: number; haber: number; }
interface Invoice { id: string; accounted: boolean; accountingEntryNumber?: string; invoiceDate: Date; description: string; displayNumber: string; items: any[]; journalLines?: JLine[]; vatAmount: number; irpfAmount: number; totalAmount: number; supplier: string; }
interface ManualEntry { id: string; lines: JLine[]; }
interface LiveBalance { code: string; totalDebe: number; totalHaber: number; saldo: number; }

const DEFAULT_PLAN: ChartAccount[] = [
  { code: "400", name: "Proveedores",                            type: "pasivo",  group: "4" },
  { code: "410", name: "Acreedores",                             type: "pasivo",  group: "4" },
  { code: "472", name: "H.P. IVA soportado",                     type: "activo",  group: "4" },
  { code: "473", name: "H.P. retenciones practicadas",           type: "pasivo",  group: "4" },
  { code: "570", name: "Caja, euros",                            type: "activo",  group: "5" },
  { code: "572", name: "Bancos c/c",                             type: "activo",  group: "5" },
  { code: "621", name: "Arrendamientos y cánones",               type: "gasto",   group: "6" },
  { code: "621.01", name: "Alquiler equipo cámara",              type: "gasto",   group: "6", parent: "621" },
  { code: "621.02", name: "Alquiler sala grabación",             type: "gasto",   group: "6", parent: "621" },
  { code: "621.03", name: "Alquiler localizaciones",             type: "gasto",   group: "6", parent: "621" },
  { code: "624", name: "Transportes",                            type: "gasto",   group: "6" },
  { code: "624.01", name: "Transporte equipo/material",          type: "gasto",   group: "6", parent: "624" },
  { code: "625", name: "Primas de seguros",                      type: "gasto",   group: "6" },
  { code: "625.01", name: "Seguro producción",                   type: "gasto",   group: "6", parent: "625" },
  { code: "629", name: "Otros servicios",                        type: "gasto",   group: "6" },
  { code: "629.01", name: "Catering",                            type: "gasto",   group: "6", parent: "629" },
  { code: "631", name: "Trabajos por otras empresas",            type: "gasto",   group: "6" },
  { code: "631.01", name: "Jefe de cámara",                      type: "gasto",   group: "6", parent: "631" },
  { code: "631.02", name: "Operador steadicam",                  type: "gasto",   group: "6", parent: "631" },
  { code: "631.03", name: "Técnico de sonido",                   type: "gasto",   group: "6", parent: "631" },
  { code: "631.04", name: "VFX supervisor",                      type: "gasto",   group: "6", parent: "631" },
  { code: "631.05", name: "Montaje y edición",                   type: "gasto",   group: "6", parent: "631" },
  { code: "700", name: "Ventas de mercaderías",                  type: "ingreso", group: "7" },
  { code: "705", name: "Prestaciones de servicios",              type: "ingreso", group: "7" },
];

const GROUP_NAMES: Record<string, string> = {
  "4": "Acreedores y deudores", "5": "Cuentas financieras",
  "6": "Compras y gastos",      "7": "Ventas e ingresos",
};
const TYPE_STYLE: Record<string, { bg: string; text: string }> = {
  gasto:   { bg: "bg-amber-100",   text: "text-amber-800"   },
  ingreso: { bg: "bg-emerald-100", text: "text-emerald-800" },
  activo:  { bg: "bg-blue-100",    text: "text-blue-800"    },
  pasivo:  { bg: "bg-pink-100",    text: "text-pink-800"    },
};
const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

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

// ─────────────────────────────────────────────────────────────────────────────

export default function ChartOfAccountsPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [plan,         setPlan]         = useState<ChartAccount[]>(DEFAULT_PLAN);
  const [invoices,     setInvoices]     = useState<Invoice[]>([]);
  const [manuals,      setManuals]      = useState<ManualEntry[]>([]);
  const [search,       setSearch]       = useState("");
  const [expanded,     setExpanded]     = useState<Record<string, boolean>>({ "4": true, "5": true, "6": true, "7": true });
  const [toast,        setToast]        = useState<{ msg: string; ok: boolean } | null>(null);
  const [showModal,    setShowModal]    = useState(false);
  const [editingCode,  setEditingCode]  = useState<string | null>(null);

  // Form state
  const [fCode,   setFCode]   = useState("");
  const [fName,   setFName]   = useState("");
  const [fType,   setFType]   = useState("gasto");
  const [fGroup,  setFGroup]  = useState("6");
  const [fParent, setFParent] = useState("");

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2500); };

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pd, prj] = await Promise.all([getDoc(doc(db, "producers", producerId)), getDoc(doc(db, "projects", projectId))]);
      if (!pd.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!prj.exists()) { router.push(`/companydashboard/${producerId}`); return; }

      const planDoc = await getDoc(doc(db, `projects/${projectId}/config/planCuentas`));
      if (planDoc.exists()) setPlan(planDoc.data().accounts || DEFAULT_PLAN);
      else setPlan(DEFAULT_PLAN);

      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
      ]);
      setInvoices(invSnap.docs.map(d => { const r = d.data(); return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null }; }));
      setManuals((manSnap as any).docs.map((d: any) => { const r = d.data(); return { id: d.id, lines: r.lines || [] }; }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── Live balances ─────────────────────────────────────────────────────────
  const liveBalances = useMemo((): Record<string, LiveBalance> => {
    const map: Record<string, { totalDebe: number; totalHaber: number }> = {};
    const ensure = (code: string) => { if (!map[code]) map[code] = { totalDebe: 0, totalHaber: 0 }; return map[code]; };
    invoices.filter(i => i.accounted && i.accountingEntryNumber).forEach(inv => {
      buildLines(inv).forEach(l => { ensure(l.code).totalDebe += l.debe || 0; ensure(l.code).totalHaber += l.haber || 0; });
    });
    manuals.forEach(me => me.lines.forEach(l => { ensure(l.code).totalDebe += l.debe || 0; ensure(l.code).totalHaber += l.haber || 0; }));
    return Object.fromEntries(Object.entries(map).map(([code, { totalDebe, totalHaber }]) => [code, { code, totalDebe, totalHaber, saldo: totalDebe - totalHaber }]));
  }, [invoices, manuals]);

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalGastos  = Object.entries(liveBalances).filter(([c]) => c.startsWith("6")).reduce((s, [, v]) => s + v.saldo, 0);
  const totalProveed = Math.abs(liveBalances["400"]?.saldo || 0);
  const totalIVA     = liveBalances["472"]?.saldo || 0;
  const totalRet     = Math.abs(liveBalances["473"]?.saldo || 0);

  // ── Persist plan ──────────────────────────────────────────────────────────
  const savePlan = async (newPlan: ChartAccount[]) => {
    setSaving(true);
    try {
      await setDoc(doc(db, `projects/${projectId}/config/planCuentas`), { accounts: newPlan, updatedAt: new Date() });
      setPlan(newPlan); showToast("Plan de cuentas guardado");
    } catch (err) { console.error(err); showToast("Error al guardar", false); }
    finally { setSaving(false); }
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditingCode(null); setFCode(""); setFName(""); setFType("gasto"); setFGroup("6"); setFParent(""); setShowModal(true); };
  const openEdit   = (acc: ChartAccount) => { setEditingCode(acc.code); setFCode(acc.code); setFName(acc.name); setFType(acc.type); setFGroup(acc.group); setFParent(acc.parent || ""); setShowModal(true); };

  const handleSave = async () => {
    if (!fCode.trim() || !fName.trim()) { showToast("Código y nombre son obligatorios", false); return; }
    let newPlan: ChartAccount[];
    if (editingCode) {
      newPlan = plan.map(a => a.code === editingCode ? { code: fCode.trim(), name: fName.trim(), type: fType, group: fGroup, parent: fParent || null } : a);
    } else {
      if (plan.find(a => a.code === fCode.trim())) { showToast("Ya existe esa cuenta", false); return; }
      newPlan = [...plan, { code: fCode.trim(), name: fName.trim(), type: fType, group: fGroup, parent: fParent || null }].sort((a, b) => a.code.localeCompare(b.code));
    }
    await savePlan(newPlan);
    setShowModal(false);
  };

  const handleDelete = async (code: string) => {
    const inUse = invoices.some(i => i.items.some((it: any) => it.subAccountCode === code) || i.journalLines?.some(l => l.code === code))
      || manuals.some(m => m.lines.some(l => l.code === code));
    if (inUse) { showToast("No se puede eliminar — cuenta con movimientos", false); return; }
    if (!confirm(`¿Eliminar la cuenta ${code}?`)) return;
    await savePlan(plan.filter(a => a.code !== code));
  };

  // ── Filtered plan ─────────────────────────────────────────────────────────
  const filteredPlan = useMemo(() =>
    search ? plan.filter(c => c.code.includes(search) || c.name.toLowerCase().includes(search.toLowerCase())) : plan,
    [plan, search]
  );

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 ${toast.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.ok ? "✓" : "✗"} {toast.msg}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900 text-sm">{editingCode ? `Editar cuenta — ${editingCode}` : "Nueva cuenta contable"}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Código *</label>
                <input value={fCode} onChange={e => setFCode(e.target.value)} placeholder="631.06"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
                <input value={fName} onChange={e => setFName(e.target.value)} placeholder="Director de arte"
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                <select value={fType} onChange={e => setFType(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">
                  {["gasto", "ingreso", "activo", "pasivo"].map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Grupo PGC</label>
                <select value={fGroup} onChange={e => setFGroup(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">
                  {["4","5","6","7"].map(g => <option key={g} value={g}>Grupo {g} — {GROUP_NAMES[g]}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta padre (opcional)</label>
                <select value={fParent} onChange={e => setFParent(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">
                  <option value="">— Ninguna (cuenta principal) —</option>
                  {plan.filter(a => !a.parent && a.group === fGroup).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 flex items-center gap-1.5">
                {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                {editingCode ? "Guardar cambios" : "Crear cuenta"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-16 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Plan General Contable</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">PGC 2007 · {plan.length} cuentas · Editable</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input placeholder="Filtrar código o nombre..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-60" />
            </div>
            <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700">
              <Plus size={13} />Nueva cuenta
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { l: "Total gastos",      v: totalGastos,  bg: "bg-amber-50",   border: "border-amber-200",  col: "text-amber-800"   },
            { l: "Saldo proveedores", v: totalProveed, bg: "bg-red-50",     border: "border-red-200",    col: "text-red-800"     },
            { l: "IVA soportado",     v: totalIVA,     bg: "bg-blue-50",    border: "border-blue-200",   col: "text-blue-800"    },
            { l: "Ret. practicadas",  v: totalRet,     bg: "bg-pink-50",    border: "border-pink-200",   col: "text-pink-800"    },
          ].map(s => (
            <div key={s.l} className={`${s.bg} border ${s.border} rounded-lg px-4 py-3`}>
              <p className={`text-[9px] font-mono uppercase tracking-widest ${s.col} opacity-60 mb-1`}>{s.l}</p>
              <p className={`font-mono text-xl font-bold ${s.col}`}>{fmt(s.v)} €</p>
            </div>
          ))}
        </div>

        {/* Account groups */}
        {["4", "5", "6", "7"].map(group => {
          const groupAccounts = filteredPlan.filter(c => c.group === group);
          if (groupAccounts.length === 0) return null;
          const isOpen = expanded[group] !== false;
          return (
            <div key={group} className="mb-4">
              <button onClick={() => setExpanded(p => ({ ...p, [group]: !isOpen }))}
                className={`w-full bg-slate-900 text-white px-4 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800 transition-colors ${isOpen ? "rounded-t-lg" : "rounded-lg"}`}>
                {isOpen ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                <span className="font-mono text-sm font-bold">Grupo {group}</span>
                <span className="text-slate-400 text-sm">—</span>
                <span className="text-slate-300 text-sm">{GROUP_NAMES[group]}</span>
                <span className="ml-auto font-mono text-[10px] text-slate-500">{groupAccounts.filter(c => !c.parent).length} cuentas principales</span>
              </button>

              {isOpen && (
                <div className="bg-white border border-slate-200 border-t-0 rounded-b-lg overflow-hidden">
                  {groupAccounts.map((c, i) => {
                    const isParent   = !c.parent;
                    const live       = liveBalances[c.code];
                    const typeStyle  = TYPE_STYLE[c.type] || { bg: "bg-slate-100", text: "text-slate-600" };
                    return (
                      <div key={c.code}
                        className={`flex items-center gap-3 ${isParent ? "px-4 py-2.5 bg-slate-50" : "px-4 py-2 pl-10"} ${i < groupAccounts.length - 1 ? "border-b border-slate-100" : ""} hover:bg-slate-50 transition-colors group`}>
                        <span className={`font-mono min-w-[72px] ${isParent ? "text-sm font-bold text-slate-900" : "text-xs text-slate-500"}`}>{c.code}</span>
                        <span className={`flex-1 ${isParent ? "text-sm font-semibold text-slate-800" : "text-xs text-slate-600"}`}>{c.name}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${typeStyle.bg} ${typeStyle.text} mr-2`}>{c.type}</span>

                        {live ? (
                          <div className="text-right min-w-[160px]">
                            <p className="font-mono text-[9px] text-slate-400 mb-0.5">D {fmt(live.totalDebe)} · H {fmt(live.totalHaber)}</p>
                            <p className={`font-mono text-sm font-bold ${live.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>
                              {live.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(live.saldo))} €
                            </p>
                          </div>
                        ) : (
                          <div className="text-right min-w-[160px]">
                            <span className="font-mono text-xs text-slate-300">Sin movimientos</span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(c)}
                            className="text-xs text-slate-500 hover:text-slate-900 border border-slate-200 rounded px-2 py-0.5 bg-white">
                            Editar
                          </button>
                          <button onClick={() => handleDelete(c.code)}
                            className="text-slate-400 hover:text-red-500 p-0.5">
                            <Trash2 size={12} />
                          </button>
                        </div>
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
