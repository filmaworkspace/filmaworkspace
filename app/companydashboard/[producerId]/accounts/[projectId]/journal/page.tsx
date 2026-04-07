"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/journal/page.tsx

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { Search, Download, CheckCircle, RefreshCw, Plus, Trash2, X } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ── Types ─────────────────────────────────────────────────────────────────────
interface JLine  { id: string; code: string; name: string; debe: number; haber: number; }
interface Invoice { id: string; displayNumber: string; supplier: string; description: string; baseAmount: number; vatAmount: number; irpfAmount: number; totalAmount: number; accounted: boolean; accountingEntryNumber?: string; invoiceDate: Date; items: any[]; journalLines?: JLine[]; }
interface ManualEntry { id: string; numero: string; date: string; concepto: string; lines: JLine[]; createdAt: Date; }
interface ChartAccount { code: string; name: string; }

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: Date | undefined) => d ? new Intl.DateTimeFormat("es-ES").format(d) : "—";

const DEFAULT_PLAN: ChartAccount[] = [
  { code: "400", name: "Proveedores" }, { code: "410", name: "Acreedores" },
  { code: "472", name: "H.P. IVA soportado" }, { code: "473", name: "H.P. retenciones" },
  { code: "570", name: "Caja" }, { code: "572", name: "Bancos c/c" },
  { code: "621", name: "Arrendamientos" }, { code: "621.01", name: "Alquiler equipo cámara" },
  { code: "621.02", name: "Alquiler sala" }, { code: "621.03", name: "Localizaciones" },
  { code: "624", name: "Transportes" }, { code: "624.01", name: "Transporte equipo" },
  { code: "625", name: "Seguros" }, { code: "625.01", name: "Seguro producción" },
  { code: "629", name: "Otros servicios" }, { code: "629.01", name: "Catering" },
  { code: "631", name: "Trabajos por otras empresas" }, { code: "631.01", name: "Jefe de cámara" },
  { code: "631.02", name: "Steadicam" }, { code: "631.03", name: "Técnico sonido" },
  { code: "631.04", name: "VFX supervisor" }, { code: "631.05", name: "Montaje" },
  { code: "700", name: "Ventas" }, { code: "705", name: "Prestaciones de servicios" },
];

function buildLines(inv: Invoice): JLine[] {
  if (inv.journalLines?.length) return inv.journalLines;
  const lines: JLine[] = [];
  inv.items.forEach((item: any, i: number) => {
    if (item.subAccountCode) lines.push({ id: `i${i}`, code: item.subAccountCode, name: item.description || item.subAccountCode, debe: item.baseAmount || 0, haber: 0 });
  });
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

export default function JournalPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,   setLoading]   = useState(true);
  const [invoices,  setInvoices]  = useState<Invoice[]>([]);
  const [manuals,   setManuals]   = useState<ManualEntry[]>([]);
  const [planCuentas, setPlan]    = useState<ChartAccount[]>(DEFAULT_PLAN);
  const [search,    setSearch]    = useState("");
  const [toast,     setToast]     = useState("");
  const [showModal, setShowModal] = useState(false);

  // Modal state
  const [mNum,     setMNum]     = useState("");
  const [mDate,    setMDate]    = useState(new Date().toLocaleDateString("es-ES"));
  const [mConcept, setMConcept] = useState("");
  const [mLines,   setMLines]   = useState<JLine[]>([
    { id: "1", code: "400", name: "", debe: 0, haber: 0 },
    { id: "2", code: "572", name: "", debe: 0, haber: 0 },
  ]);

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [producerDoc, projectDoc] = await Promise.all([
        getDoc(doc(db, "producers", producerId)),
        getDoc(doc(db, "projects", projectId)),
      ]);
      if (!producerDoc.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!projectDoc.exists()) { router.push(`/companydashboard/${producerId}`); return; }

      const planDoc = await getDoc(doc(db, `projects/${projectId}/config/planCuentas`));
      if (planDoc.exists()) setPlan(planDoc.data().accounts || DEFAULT_PLAN);

      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))),
      ]);
      setInvoices(invSnap.docs.map(d => {
        const r = d.data();
        return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null };
      }));
      setManuals(manSnap.docs.map(d => {
        const r = d.data();
        return { id: d.id, numero: r.numero, date: r.date, concepto: r.concepto, lines: r.lines || [], createdAt: r.createdAt?.toDate?.() || new Date() };
      }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── All entries merged ─────────────────────────────────────────────────────
  const allEntries = useMemo(() => {
    type Entry = { id: string; numero: string; fecha: string; concepto: string; lines: JLine[]; isManual: boolean };
    const inv: Entry[] = invoices.filter(i => i.accounted && i.accountingEntryNumber).map(i => ({
      id: i.id, numero: i.accountingEntryNumber!, fecha: fmtDate(i.invoiceDate), concepto: i.description + " — " + i.displayNumber, lines: buildLines(i), isManual: false,
    }));
    const man: Entry[] = manuals.map(m => ({ id: m.id, numero: m.numero, fecha: m.date, concepto: m.concepto, lines: m.lines, isManual: true }));
    return [...inv, ...man].sort((a, b) => a.numero.localeCompare(b.numero));
  }, [invoices, manuals]);

  const filtered = useMemo(() => search
    ? allEntries.filter(e => e.numero.toLowerCase().includes(search.toLowerCase()) || e.concepto.toLowerCase().includes(search.toLowerCase()))
    : allEntries, [allEntries, search]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  // ── Save manual entry ──────────────────────────────────────────────────────
  const saveManual = async () => {
    if (!mNum.trim() || !mConcept.trim()) { showToast("Número y concepto son obligatorios"); return; }
    const td = mLines.reduce((s, l) => s + (l.debe || 0), 0);
    const th = mLines.reduce((s, l) => s + (l.haber || 0), 0);
    if (Math.abs(td - th) > 0.01) { showToast(`El asiento no cuadra — dif. ${fmt(Math.abs(td - th))} €`); return; }
    try {
      const id = `M-${Date.now()}`;
      await setDoc(doc(db, `projects/${projectId}/manualEntries`, id), {
        numero: mNum.trim(), date: mDate, concepto: mConcept.trim(), lines: mLines.filter(l => l.code && (l.debe > 0 || l.haber > 0)), createdAt: new Date(),
      });
      showToast("Asiento manual guardado");
      setShowModal(false); setMNum(""); setMConcept(""); setMLines([{ id: "1", code: "400", name: "", debe: 0, haber: 0 }, { id: "2", code: "572", name: "", debe: 0, haber: 0 }]);
      await loadData();
    } catch (err) { console.error(err); showToast("Error al guardar"); }
  };

  const deleteManual = async (id: string) => {
    if (!confirm("¿Eliminar este asiento manual?")) return;
    await deleteDoc(doc(db, `projects/${projectId}/manualEntries`, id));
    showToast("Asiento eliminado"); await loadData();
  };

  const updateMLine = (id: string, field: keyof JLine, val: string | number) => {
    setMLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === "code") { const acc = planCuentas.find(a => a.code === val); return { ...l, code: val as string, name: acc?.name || l.name }; }
      return { ...l, [field]: val };
    }));
  };

  const handleExport = () => {
    const rows: string[][] = [["Asiento", "Fecha", "Concepto", "Cuenta", "Nombre", "Debe", "Haber"]];
    filtered.forEach(e => e.lines.forEach(l => rows.push([e.numero, e.fecha, e.concepto, l.code, l.name, fmt(l.debe), fmt(l.haber)])));
    exportCSV(rows, "libro_diario.csv"); showToast("Libro Diario exportado");
  };

  const mDebe  = mLines.reduce((s, l) => s + (l.debe || 0), 0);
  const mHaber = mLines.reduce((s, l) => s + (l.haber || 0), 0);
  const mOk    = Math.abs(mDebe - mHaber) < 0.01;

  const totalDebe  = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.debe, 0), 0);
  const totalHaber = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.haber, 0), 0);

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2">
          <CheckCircle size={14} />{toast}
        </div>
      )}

      {/* Modal — new manual entry */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900 text-sm">Nuevo asiento manual</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nº Asiento *</label>
                  <input value={mNum} onChange={e => setMNum(e.target.value)} placeholder="M-2024-001"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                  <input value={mDate} onChange={e => setMDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Concepto *</label>
                  <input value={mConcept} onChange={e => setMConcept(e.target.value)} placeholder="Describe el asiento"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Líneas del asiento</label>
                  <button onClick={() => setMLines(p => [...p, { id: Date.now().toString(), code: "400", name: "", debe: 0, haber: 0 }])}
                    className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded px-2 py-0.5">
                    <Plus size={10} />Línea
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase w-[90px]">Cuenta</th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase">Descripción</th>
                        <th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-[80px]">Debe</th>
                        <th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-[80px]">Haber</th>
                        <th className="w-7" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mLines.map(line => (
                        <tr key={line.id}>
                          <td className="px-2 py-1">
                            <select value={line.code} onChange={e => updateMLine(line.id, "code", e.target.value)}
                              className="font-mono text-[10px] border border-slate-200 rounded px-1 py-0.5 w-full bg-white focus:border-slate-400 outline-none">
                              {planCuentas.map(a => <option key={a.code} value={a.code}>{a.code}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <input value={line.name} onChange={e => updateMLine(line.id, "name", e.target.value)} placeholder={planCuentas.find(a => a.code === line.code)?.name || ""}
                              className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" value={line.debe || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "debe", parseFloat(e.target.value) || 0)}
                              className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" value={line.haber || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "haber", parseFloat(e.target.value) || 0)}
                              className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-1">
                            <button onClick={() => setMLines(p => p.filter(l => l.id !== line.id))} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                      <tr>
                        <td colSpan={2} className={`px-2 py-1.5 font-mono text-[10px] font-bold ${mOk ? "text-emerald-600" : "text-red-600"}`}>
                          {mOk ? "✓ Cuadrado" : `✗ Dif. ${fmt(Math.abs(mDebe - mHaber))} €`}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-slate-900">{fmt(mDebe)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-red-600">{fmt(mHaber)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={saveManual} disabled={!mOk || !mNum || !mConcept}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40">Guardar asiento</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-16 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Libro Diario</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">{filtered.length} asientos · {manuals.length} manuales</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input placeholder="Buscar asiento..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-56" />
            </div>
            <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700"><Plus size={13} />Asiento manual</button>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white text-xs font-medium rounded-lg hover:bg-slate-50"><Download size={13} />Exportar</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
            <p className="text-sm text-slate-500">No hay asientos. Contabiliza facturas primero.</p>
          </div>
        ) : (
          <>
            {filtered.map(entry => {
              const td = entry.lines.reduce((s, l) => s + l.debe, 0);
              const th = entry.lines.reduce((s, l) => s + l.haber, 0);
              const ok = Math.abs(td - th) < 0.01;
              return (
                <div key={entry.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-3">
                    <span className="font-mono text-xs font-bold bg-slate-900 text-white px-2.5 py-1 rounded">{entry.numero}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.fecha}</span>
                    <span className="text-sm text-slate-700 flex-1 truncate">{entry.concepto}</span>
                    <span className="font-mono text-xs text-slate-400">Σ {fmt(td)} €</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{ok ? "Cuadrado" : "Descuadrado"}</span>
                    {entry.isManual && <button onClick={() => deleteManual(entry.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>}
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-100">
                    {/* Debe */}
                    <div className="p-4">
                      <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-3">Debe</p>
                      <div className="space-y-2">
                        {entry.lines.filter(l => l.debe > 0).map(l => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">{l.code}</span>
                              <span className="text-xs text-slate-600 truncate">{l.name}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">{fmt(l.debe)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Total Debe</span>
                        <span className="font-mono text-sm font-bold text-slate-900">{fmt(td)} €</span>
                      </div>
                    </div>
                    {/* Haber */}
                    <div className="p-4">
                      <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-3">Haber</p>
                      <div className="space-y-2">
                        {entry.lines.filter(l => l.haber > 0).map(l => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">{l.code}</span>
                              <span className="text-xs text-slate-600 truncate">{l.name}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-red-600 whitespace-nowrap">{fmt(l.haber)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Total Haber</span>
                        <span className="font-mono text-sm font-bold text-red-600">{fmt(th)} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Grand totals */}
            <div className="bg-slate-900 text-white rounded-lg px-6 py-4 flex items-center justify-between mt-4">
              <span className="font-mono text-xs tracking-widest uppercase text-slate-400">Totales Diario — {filtered.length} asientos</span>
              <div className="flex gap-12">
                <div className="text-right"><p className="text-[9px] text-slate-500 uppercase font-mono mb-1">Total Debe</p><p className="font-mono text-base font-bold">{fmt(totalDebe)} €</p></div>
                <div className="text-right"><p className="text-[9px] text-slate-500 uppercase font-mono mb-1">Total Haber</p><p className="font-mono text-base font-bold text-red-400">{fmt(totalHaber)} €</p></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
