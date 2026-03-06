"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { ArrowLeft, Plus, Trash2, Download, ChevronRight, ChevronDown, X, Variable, Check, Copy, GripVertical } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface GlobalVar { id: string; code: string; value: number; }
interface Fringe { id: string; code: string; rate: number; on: boolean; }
interface Line { id: string; acct: string; desc: string; amt: number; x: number; rate: number; fringes: string[]; }
interface Category { id: string; acct: string; name: string; lines: Line[]; }
interface Account { id: string; acct: string; name: string; cats: Category[]; }

export default function BudgetBuilderPage() {
  const params = useParams();
  const projectId = params?.id as string;

  const [title, setTitle] = useState("BUDGET");
  const [globals, setGlobals] = useState<GlobalVar[]>([]);
  const [fringes, setFringes] = useState<Fringe[]>([{ id: "ss", code: "SS", rate: 23.6, on: true }, { id: "vac", code: "VAC", rate: 8.33, on: true }]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expCats, setExpCats] = useState<Set<string>>(new Set());
  const [showGlobals, setShowGlobals] = useState(false);
  const [globTab, setGlobTab] = useState<"v" | "f">("v");
  const [ctx, setCtx] = useState<{ id: string; t: string; x: number; y: number } | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [selAcc, setSelAcc] = useState<string | null>(null);
  const [form, setForm] = useState({ acct: "", name: "", code: "", val: 0 });

  const fmt = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const calcFringes = useCallback((line: Line) => {
    const base = line.amt * line.x * line.rate;
    return line.fringes.reduce((s, fid) => { const f = fringes.find(x => x.id === fid && x.on); return f ? s + base * f.rate / 100 : s; }, 0);
  }, [fringes]);

  const lineTotal = useCallback((l: Line) => l.amt * l.x * l.rate + calcFringes(l), [calcFringes]);
  const catTotal = (c: Category) => c.lines.reduce((s, l) => s + lineTotal(l), 0);
  const accTotal = (a: Account) => a.cats.reduce((s, c) => s + catTotal(c), 0);
  const grandTotal = () => accounts.reduce((s, a) => s + accTotal(a), 0);

  const addAcc = () => { if (!form.acct || !form.name) return; const a: Account = { id: crypto.randomUUID(), acct: form.acct.toUpperCase(), name: form.name.toUpperCase(), cats: [] }; setAccounts(p => [...p, a].sort((x, y) => x.acct.localeCompare(y.acct))); setExpanded(p => new Set(p).add(a.id)); setForm({ acct: "", name: "", code: "", val: 0 }); setModal(null); };
  const addCat = () => { if (!selAcc || !form.acct || !form.name) return; setAccounts(p => p.map(a => a.id !== selAcc ? a : { ...a, cats: [...a.cats, { id: crypto.randomUUID(), acct: form.acct.toUpperCase(), name: form.name.toUpperCase(), lines: [] }].sort((x, y) => x.acct.localeCompare(y.acct)) })); setExpCats(p => new Set(p).add(form.acct.toUpperCase())); setForm({ acct: "", name: "", code: "", val: 0 }); setModal(null); };
  const addLine = (aId: string, cId: string) => setAccounts(p => p.map(a => a.id !== aId ? a : { ...a, cats: a.cats.map(c => c.id !== cId ? c : { ...c, lines: [...c.lines, { id: crypto.randomUUID(), acct: `${c.acct}-${String(c.lines.length + 1).padStart(2, "0")}`, desc: "", amt: 1, x: 1, rate: 0, fringes: [] }] }) }));
  const updLine = (aId: string, cId: string, lId: string, u: Partial<Line>) => setAccounts(p => p.map(a => a.id !== aId ? a : { ...a, cats: a.cats.map(c => c.id !== cId ? c : { ...c, lines: c.lines.map(l => l.id !== lId ? l : { ...l, ...u }) }) }));
  const delLine = (aId: string, cId: string, lId: string) => { setAccounts(p => p.map(a => a.id !== aId ? a : { ...a, cats: a.cats.map(c => c.id !== cId ? c : { ...c, lines: c.lines.filter(l => l.id !== lId) }) })); setCtx(null); };
  const delCat = (aId: string, cId: string) => { setAccounts(p => p.map(a => a.id !== aId ? a : { ...a, cats: a.cats.filter(c => c.id !== cId) })); setCtx(null); };
  const delAcc = (aId: string) => { setAccounts(p => p.filter(a => a.id !== aId)); setCtx(null); };
  const dupLine = (aId: string, cId: string, lId: string) => { setAccounts(p => p.map(a => a.id !== aId ? a : { ...a, cats: a.cats.map(c => { if (c.id !== cId) return c; const i = c.lines.findIndex(l => l.id === lId); const l = c.lines[i]; if (!l) return c; const n = [...c.lines]; n.splice(i + 1, 0, { ...l, id: crypto.randomUUID(), acct: `${l.acct}C` }); return { ...c, lines: n }; }) })); setCtx(null); };
  const addGlobal = () => { if (!form.code) return; setGlobals(p => [...p, { id: crypto.randomUUID(), code: form.code.toUpperCase(), value: form.val }]); setForm({ acct: "", name: "", code: "", val: 0 }); setModal(null); };

  const exportCSV = () => {
    const rows: string[][] = [["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"]];
    accounts.forEach(a => { rows.push([a.acct, a.name, "cuenta", ""]); a.cats.forEach(c => { rows.push([c.acct, c.name, "subcuenta", ""]); c.lines.forEach(l => rows.push([l.acct, l.desc, "partida", lineTotal(l).toFixed(2)])); }); });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${title}_${new Date().toISOString().split("T")[0]}.csv`; a.click();
  };

  useEffect(() => { const h = () => setCtx(null); if (ctx) window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [ctx]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "g") { e.preventDefault(); setShowGlobals(p => !p); } if ((e.metaKey || e.ctrlKey) && e.key === "e") { e.preventDefault(); exportCSV(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);

  return (
    <div className={`min-h-screen bg-white ${inter.className} text-[11px] mt-16`}>
      {ctx && (
        <div className="fixed bg-white border border-slate-300 shadow py-0.5 z-[100]" style={{ top: ctx.y, left: ctx.x }} onClick={e => e.stopPropagation()}>
          {ctx.t === "line" && <button onClick={() => dupLine(selAcc!, ctx.id.split(":")[0], ctx.id.split(":")[1])} className="w-full px-3 py-1 text-left hover:bg-slate-100 flex items-center gap-2"><Copy size={10} />Duplicar</button>}
          <button onClick={() => { if (ctx.t === "acc") delAcc(ctx.id); else if (ctx.t === "cat") delCat(selAcc!, ctx.id); else delLine(selAcc!, ctx.id.split(":")[0], ctx.id.split(":")[1]); }} className="w-full px-3 py-1 text-left text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={10} />Eliminar</button>
        </div>
      )}

      {/* TOOLBAR */}
      <div className="h-8 bg-[#e8e8e8] border-b border-[#c0c0c0] flex items-center px-1 gap-1 sticky top-0 z-40">
        <Link href={`/project/${projectId}/accounting/budget`} className="p-1 hover:bg-[#d0d0d0] rounded"><ArrowLeft size={12} /></Link>
        <div className="w-px h-4 bg-[#c0c0c0]" />
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="bg-transparent font-semibold text-slate-800 outline-none px-1 w-40 text-xs" />
        <div className="flex-1" />
        <button onClick={() => setShowGlobals(p => !p)} className={`px-2 py-0.5 rounded flex items-center gap-1 ${showGlobals ? "bg-amber-200" : "hover:bg-[#d0d0d0]"}`}><Variable size={10} />Globals</button>
        <button onClick={exportCSV} className="px-2 py-0.5 hover:bg-[#d0d0d0] rounded flex items-center gap-1"><Download size={10} />CSV</button>
      </div>

      <div className="flex">
        {/* GLOBALS */}
        {showGlobals && (
          <div className="w-48 border-r border-[#c0c0c0] bg-[#f5f5f5] flex-shrink-0">
            <div className="flex border-b border-[#c0c0c0]">
              <button onClick={() => setGlobTab("v")} className={`flex-1 px-2 py-1 text-[10px] font-medium ${globTab === "v" ? "bg-white" : ""}`}>Variables</button>
              <button onClick={() => setGlobTab("f")} className={`flex-1 px-2 py-1 text-[10px] font-medium ${globTab === "f" ? "bg-white" : ""}`}>Fringes</button>
            </div>
            <div className="p-1">
              {globTab === "v" && (
                <>
                  <button onClick={() => setModal("var")} className="w-full mb-1 px-2 py-1 border border-dashed border-slate-400 text-slate-500 hover:border-slate-500 flex items-center justify-center gap-1 text-[10px]"><Plus size={9} />Variable</button>
                  {globals.map(v => (
                    <div key={v.id} className="mb-1 p-1.5 bg-white border border-slate-200">
                      <div className="flex items-center justify-between mb-0.5">
                        <code className="text-[9px] text-amber-700 font-mono">{v.code}</code>
                        <button onClick={() => setGlobals(p => p.filter(x => x.id !== v.id))} className="text-slate-400 hover:text-red-500"><X size={8} /></button>
                      </div>
                      <input type="number" value={v.value} onChange={e => setGlobals(p => p.map(x => x.id === v.id ? { ...x, value: parseFloat(e.target.value) || 0 } : x))} className="w-full border border-slate-200 px-1 py-0.5 text-right font-mono text-[10px]" />
                    </div>
                  ))}
                </>
              )}
              {globTab === "f" && fringes.map(f => (
                <div key={f.id} className={`mb-1 p-1.5 border flex items-center justify-between ${f.on ? "bg-white border-slate-200" : "bg-slate-100 border-slate-200 opacity-50"}`}>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setFringes(p => p.map(x => x.id === f.id ? { ...x, on: !x.on } : x))} className={`w-3 h-3 rounded-sm border flex items-center justify-center ${f.on ? "bg-emerald-500 border-emerald-500" : "border-slate-400"}`}>{f.on && <Check size={7} className="text-white" />}</button>
                    <code className="text-[9px] font-mono text-slate-600">{f.code}</code>
                  </div>
                  <span className="text-[10px] font-medium text-amber-700">{f.rate}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TABLE */}
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#d4d4d4] border-b border-[#a0a0a0] text-[9px] font-semibold text-slate-700 uppercase">
                <th className="w-6 border-r border-[#b0b0b0]"></th>
                <th className="w-16 px-1 py-1 text-left border-r border-[#b0b0b0]">Acct</th>
                <th className="px-1 py-1 text-left border-r border-[#b0b0b0] min-w-[180px]">Description</th>
                <th className="w-12 px-1 py-1 text-right border-r border-[#b0b0b0]">Amt</th>
                <th className="w-10 px-1 py-1 text-center border-r border-[#b0b0b0]">X</th>
                <th className="w-16 px-1 py-1 text-right border-r border-[#b0b0b0]">Rate</th>
                <th className="w-20 px-1 py-1 text-right border-r border-[#b0b0b0]">Total</th>
                <th className="w-16 px-1 py-1 text-right">Fringes</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => {
                const exp = expanded.has(acc.id);
                return (
                  <React.Fragment key={acc.id}>
                    <tr className="bg-[#c8c8c8] border-b border-[#a0a0a0] cursor-pointer select-none hover:bg-[#bfbfbf]" onClick={() => setExpanded(p => { const n = new Set(p); if (n.has(acc.id)) n.delete(acc.id); else n.add(acc.id); return n; })} onContextMenu={e => { e.preventDefault(); setCtx({ id: acc.id, t: "acc", x: e.clientX, y: e.clientY }); }}>
                      <td className="px-1 py-0.5 text-center border-r border-[#a0a0a0]">{exp ? <ChevronDown size={10} /> : <ChevronRight size={10} />}</td>
                      <td className="px-1 py-0.5 font-mono font-bold text-slate-800 border-r border-[#a0a0a0]">{acc.acct}</td>
                      <td className="px-1 py-0.5 font-bold text-slate-800 border-r border-[#a0a0a0]">{acc.name}</td>
                      <td className="border-r border-[#a0a0a0]"></td>
                      <td className="border-r border-[#a0a0a0]"></td>
                      <td className="border-r border-[#a0a0a0]"></td>
                      <td className="px-1 py-0.5 text-right font-bold text-slate-800 tabular-nums border-r border-[#a0a0a0]">{fmt(accTotal(acc))}</td>
                      <td></td>
                    </tr>
                    {exp && acc.cats.map(cat => {
                      const catExp = expCats.has(cat.acct);
                      return (
                        <React.Fragment key={cat.id}>
                          <tr className="bg-[#e0e0e0] border-b border-[#c0c0c0] cursor-pointer select-none hover:bg-[#d8d8d8]" onClick={() => setExpCats(p => { const n = new Set(p); if (n.has(cat.acct)) n.delete(cat.acct); else n.add(cat.acct); return n; })} onContextMenu={e => { e.preventDefault(); setSelAcc(acc.id); setCtx({ id: cat.id, t: "cat", x: e.clientX, y: e.clientY }); }}>
                            <td className="px-1 py-0.5 text-center border-r border-[#c0c0c0] pl-3">{catExp ? <ChevronDown size={9} /> : <ChevronRight size={9} />}</td>
                            <td className="px-1 py-0.5 font-mono text-slate-600 border-r border-[#c0c0c0]">{cat.acct}</td>
                            <td className="px-1 py-0.5 font-medium text-slate-700 border-r border-[#c0c0c0]">{cat.name}</td>
                            <td className="border-r border-[#c0c0c0]"></td>
                            <td className="border-r border-[#c0c0c0]"></td>
                            <td className="border-r border-[#c0c0c0]"></td>
                            <td className="px-1 py-0.5 text-right font-semibold text-slate-700 tabular-nums border-r border-[#c0c0c0]">{fmt(catTotal(cat))}</td>
                            <td></td>
                          </tr>
                          {catExp && cat.lines.map(line => {
                            const base = line.amt * line.x * line.rate;
                            const fr = calcFringes(line);
                            return (
                              <tr key={line.id} className="border-b border-slate-200 hover:bg-blue-50/30 group" onContextMenu={e => { e.preventDefault(); setSelAcc(acc.id); setCtx({ id: `${cat.id}:${line.id}`, t: "line", x: e.clientX, y: e.clientY }); }}>
                                <td className="px-1 py-px text-center border-r border-slate-200"><GripVertical size={8} className="text-slate-300 opacity-0 group-hover:opacity-100" /></td>
                                <td className="px-1 py-px font-mono text-[9px] text-slate-400 border-r border-slate-200">{line.acct}</td>
                                <td className="px-0.5 py-px border-r border-slate-200"><input type="text" value={line.desc} onChange={e => updLine(acc.id, cat.id, line.id, { desc: e.target.value })} className="w-full bg-transparent outline-none px-0.5" placeholder="..." /></td>
                                <td className="px-0.5 py-px border-r border-slate-200"><input type="number" value={line.amt || ""} onChange={e => updLine(acc.id, cat.id, line.id, { amt: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums px-0.5" /></td>
                                <td className="px-0.5 py-px border-r border-slate-200"><input type="number" value={line.x || ""} onChange={e => updLine(acc.id, cat.id, line.id, { x: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-center outline-none tabular-nums px-0.5" /></td>
                                <td className="px-0.5 py-px border-r border-slate-200"><input type="number" value={line.rate || ""} onChange={e => updLine(acc.id, cat.id, line.id, { rate: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums px-0.5" step="0.01" /></td>
                                <td className="px-1 py-px text-right tabular-nums text-slate-700 border-r border-slate-200">{fmt(base)}</td>
                                <td className="px-1 py-px text-right tabular-nums text-slate-400 text-[9px]">{fr > 0 ? fmt(fr) : ""}</td>
                              </tr>
                            );
                          })}
                          {catExp && <tr className="border-b border-slate-200"><td></td><td colSpan={7} className="px-1 py-0.5"><button onClick={() => addLine(acc.id, cat.id)} className="text-[9px] text-slate-400 hover:text-slate-600 flex items-center gap-0.5"><Plus size={8} />line</button></td></tr>}
                        </React.Fragment>
                      );
                    })}
                    {exp && <tr className="border-b border-[#c0c0c0] bg-[#e8e8e8]"><td></td><td colSpan={7} className="px-1 py-0.5"><button onClick={() => { setSelAcc(acc.id); setModal("cat"); }} className="text-[9px] text-amber-700 hover:text-amber-800 flex items-center gap-0.5"><Plus size={8} />subcuenta</button></td></tr>}
                  </React.Fragment>
                );
              })}
              <tr className="border-b border-[#c0c0c0]"><td></td><td colSpan={7} className="px-1 py-1"><button onClick={() => setModal("acc")} className="text-[10px] text-slate-600 hover:text-slate-800 flex items-center gap-0.5"><Plus size={9} />cuenta</button></td></tr>
            </tbody>
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-800 text-white font-bold">
                <td className="border-r border-slate-700"></td>
                <td className="px-1 py-1 border-r border-slate-700"></td>
                <td className="px-1 py-1 border-r border-slate-700">TOTAL</td>
                <td className="border-r border-slate-700"></td>
                <td className="border-r border-slate-700"></td>
                <td className="border-r border-slate-700"></td>
                <td className="px-1 py-1 text-right tabular-nums border-r border-slate-700">{fmt(grandTotal())}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* MODALS */}
      {modal === "acc" && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white border border-slate-400 shadow-lg w-64" onClick={e => e.stopPropagation()}>
            <div className="px-3 py-2 bg-[#e0e0e0] border-b border-slate-400 flex items-center justify-between text-xs font-semibold">Nueva cuenta<button onClick={() => setModal(null)}><X size={12} /></button></div>
            <div className="p-3 space-y-2">
              <input type="text" value={form.acct} onChange={e => setForm(p => ({ ...p, acct: e.target.value }))} className="w-full border border-slate-300 px-2 py-1 text-xs font-mono" placeholder="Código (ej: 01)" autoFocus />
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-300 px-2 py-1 text-xs" placeholder="Nombre" />
            </div>
            <div className="px-3 py-2 bg-[#f0f0f0] border-t border-slate-300 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-2 py-1 text-xs hover:bg-slate-200">Cancelar</button>
              <button onClick={addAcc} className="px-2 py-1 text-xs bg-slate-800 text-white">OK</button>
            </div>
          </div>
        </div>
      )}
      {modal === "cat" && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white border border-slate-400 shadow-lg w-64" onClick={e => e.stopPropagation()}>
            <div className="px-3 py-2 bg-[#e0e0e0] border-b border-slate-400 flex items-center justify-between text-xs font-semibold">Nueva subcuenta<button onClick={() => setModal(null)}><X size={12} /></button></div>
            <div className="p-3 space-y-2">
              <input type="text" value={form.acct} onChange={e => setForm(p => ({ ...p, acct: e.target.value }))} className="w-full border border-slate-300 px-2 py-1 text-xs font-mono" placeholder="Código" autoFocus />
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-300 px-2 py-1 text-xs" placeholder="Nombre" />
            </div>
            <div className="px-3 py-2 bg-[#f0f0f0] border-t border-slate-300 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-2 py-1 text-xs hover:bg-slate-200">Cancelar</button>
              <button onClick={addCat} className="px-2 py-1 text-xs bg-slate-800 text-white">OK</button>
            </div>
          </div>
        </div>
      )}
      {modal === "var" && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white border border-slate-400 shadow-lg w-64" onClick={e => e.stopPropagation()}>
            <div className="px-3 py-2 bg-[#e0e0e0] border-b border-slate-400 flex items-center justify-between text-xs font-semibold">Nueva variable<button onClick={() => setModal(null)}><X size={12} /></button></div>
            <div className="p-3 space-y-2">
              <input type="text" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="w-full border border-slate-300 px-2 py-1 text-xs font-mono" placeholder="SHOOT_DAYS" autoFocus />
              <input type="number" value={form.val} onChange={e => setForm(p => ({ ...p, val: parseFloat(e.target.value) || 0 }))} className="w-full border border-slate-300 px-2 py-1 text-xs font-mono" placeholder="Valor" />
            </div>
            <div className="px-3 py-2 bg-[#f0f0f0] border-t border-slate-300 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-2 py-1 text-xs hover:bg-slate-200">Cancelar</button>
              <button onClick={addGlobal} className="px-2 py-1 text-xs bg-slate-800 text-white">OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
