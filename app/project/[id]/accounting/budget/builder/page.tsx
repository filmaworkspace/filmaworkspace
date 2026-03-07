"use client";

import React, { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ArrowLeft, Plus, Trash2, Download, ChevronRight, ChevronLeft,
  X, Search, Calculator, FolderOpen, Euro, Variable, Check, Copy,
  Percent, FileText, Layers, MoreHorizontal, AlertCircle,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface GlobalVar { id: string; code: string; value: number; }
interface Fringe { id: string; code: string; rate: number; on: boolean; }
interface Line { id: string; acct: string; desc: string; amt: number; x: number; rate: number; fringes: string[]; }
interface Category { id: string; acct: string; name: string; lines: Line[]; }
interface Account { id: string; acct: string; name: string; cats: Category[]; }

export default function BudgetBuilderPage() {
  const params = useParams();
  const projectId = params?.id as string;

  const [title, setTitle] = useState("PRESUPUESTO");
  const [globals, setGlobals] = useState<GlobalVar[]>([]);
  const [fringes, setFringes] = useState<Fringe[]>([
    { id: "ss", code: "SS", rate: 23.6, on: true },
    { id: "vac", code: "VAC", rate: 8.33, on: true },
  ]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [showGlobals, setShowGlobals] = useState(false);
  const [globTab, setGlobTab] = useState<"v" | "f">("v");
  const [modal, setModal] = useState<string | null>(null);
  const [form, setForm] = useState({ acct: "", name: "", code: "", val: 0 });
  const [toast, setToast] = useState<{ type: string; msg: string } | null>(null);

  const fmt = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const showToast = (type: string, msg: string) => { setToast({ type, msg }); setTimeout(() => setToast(null), 2500); };

  const calcFringes = useCallback((line: Line) => {
    const base = line.amt * line.x * line.rate;
    return line.fringes.reduce((s, fid) => { const f = fringes.find(x => x.id === fid && x.on); return f ? s + base * f.rate / 100 : s; }, 0);
  }, [fringes]);

  const lineTotal = useCallback((l: Line) => l.amt * l.x * l.rate + calcFringes(l), [calcFringes]);
  const catTotal = (c: Category) => c.lines.reduce((s, l) => s + lineTotal(l), 0);
  const accTotal = (a: Account) => a.cats.reduce((s, c) => s + catTotal(c), 0);
  const grandTotal = () => accounts.reduce((s, a) => s + accTotal(a), 0);

  // Sync helpers
  const syncAccount = (acc: Account) => {
    setAccounts(p => p.map(a => a.id === acc.id ? acc : a));
    if (selectedAccount?.id === acc.id) setSelectedAccount(acc);
  };

  const syncCategory = (cat: Category) => {
    if (!selectedAccount) return;
    const newCats = selectedAccount.cats.map(c => c.id === cat.id ? cat : c);
    const newAcc = { ...selectedAccount, cats: newCats };
    syncAccount(newAcc);
    if (selectedCategory?.id === cat.id) setSelectedCategory(cat);
  };

  // CRUD
  const addAccount = () => {
    if (!form.acct || !form.name) return;
    const acc: Account = { id: crypto.randomUUID(), acct: form.acct.toUpperCase(), name: form.name.toUpperCase(), cats: [] };
    setAccounts(p => [...p, acc].sort((a, b) => a.acct.localeCompare(b.acct)));
    setForm({ acct: "", name: "", code: "", val: 0 });
    setModal(null);
    showToast("success", "Cuenta creada");
  };

  const deleteAccount = (id: string) => {
    setAccounts(p => p.filter(a => a.id !== id));
    if (selectedAccount?.id === id) { setSelectedAccount(null); setSelectedCategory(null); }
  };

  const addCategory = () => {
    if (!selectedAccount || !form.acct || !form.name) return;
    const cat: Category = { id: crypto.randomUUID(), acct: form.acct.toUpperCase(), name: form.name.toUpperCase(), lines: [] };
    const newAcc = { ...selectedAccount, cats: [...selectedAccount.cats, cat].sort((a, b) => a.acct.localeCompare(b.acct)) };
    syncAccount(newAcc);
    setForm({ acct: "", name: "", code: "", val: 0 });
    setModal(null);
    showToast("success", "Subcuenta creada");
  };

  const deleteCategory = (catId: string) => {
    if (!selectedAccount) return;
    const newAcc = { ...selectedAccount, cats: selectedAccount.cats.filter(c => c.id !== catId) };
    syncAccount(newAcc);
    if (selectedCategory?.id === catId) setSelectedCategory(null);
  };

  const addLine = () => {
    if (!selectedAccount || !selectedCategory) return;
    const line: Line = { id: crypto.randomUUID(), acct: `${selectedCategory.acct}-${String(selectedCategory.lines.length + 1).padStart(2, "0")}`, desc: "", amt: 1, x: 1, rate: 0, fringes: [] };
    const newCat = { ...selectedCategory, lines: [...selectedCategory.lines, line] };
    syncCategory(newCat);
  };

  const updateLine = (lineId: string, updates: Partial<Line>) => {
    if (!selectedCategory) return;
    const newCat = { ...selectedCategory, lines: selectedCategory.lines.map(l => l.id === lineId ? { ...l, ...updates } : l) };
    syncCategory(newCat);
  };

  const deleteLine = (lineId: string) => {
    if (!selectedCategory) return;
    const newCat = { ...selectedCategory, lines: selectedCategory.lines.filter(l => l.id !== lineId) };
    syncCategory(newCat);
  };

  const duplicateLine = (lineId: string) => {
    if (!selectedCategory) return;
    const idx = selectedCategory.lines.findIndex(l => l.id === lineId);
    const line = selectedCategory.lines[idx];
    if (!line) return;
    const newLine = { ...line, id: crypto.randomUUID(), acct: `${line.acct}C` };
    const newLines = [...selectedCategory.lines];
    newLines.splice(idx + 1, 0, newLine);
    const newCat = { ...selectedCategory, lines: newLines };
    syncCategory(newCat);
  };

  const addVariable = () => {
    if (!form.code) return;
    setGlobals(p => [...p, { id: crypto.randomUUID(), code: form.code.toUpperCase(), value: form.val }]);
    setForm({ acct: "", name: "", code: "", val: 0 });
    setModal(null);
  };

  const exportCSV = () => {
    const rows: string[][] = [["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"]];
    accounts.forEach(a => { rows.push([a.acct, a.name, "cuenta", ""]); a.cats.forEach(c => { rows.push([c.acct, c.name, "subcuenta", ""]); c.lines.forEach(l => rows.push([l.acct, l.desc, "partida", lineTotal(l).toFixed(2)])); }); });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${title}_${new Date().toISOString().split("T")[0]}.csv`; a.click();
    showToast("success", "Exportado");
  };

  const openAccount = (acc: Account) => { setSelectedAccount(acc); setSelectedCategory(null); };
  const openCategory = (cat: Category) => setSelectedCategory(cat);
  const goBack = () => { if (selectedCategory) setSelectedCategory(null); else if (selectedAccount) setSelectedAccount(null); };

  const currentIdx = selectedAccount ? accounts.findIndex(a => a.id === selectedAccount.id) : -1;
  const goPrev = () => { if (currentIdx > 0) openAccount(accounts[currentIdx - 1]); };
  const goNext = () => { if (currentIdx < accounts.length - 1) openAccount(accounts[currentIdx + 1]); };

  const filteredAccounts = accounts.filter(a => a.acct.toLowerCase().includes(searchTerm.toLowerCase()) || a.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const total = grandTotal();
  const lineCount = accounts.reduce((s, a) => s + a.cats.reduce((x, c) => x + c.lines.length, 0), 0);
  const catCount = accounts.reduce((s, a) => s + a.cats.length, 0);

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
            {toast.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}{toast.msg}
          </div>
        </div>
      )}

      <div className="mt-16 flex h-[calc(100vh-4rem)]">
        {/* Left Panel - Main List */}
        <div className={`flex-1 flex flex-col transition-all duration-200 ${selectedAccount ? "mr-[50%]" : ""}`}>
          {/* Header */}
          <div className="bg-white border-b border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href={`/project/${projectId}/accounting/budget`} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                  <ArrowLeft size={18} />
                </Link>
                <div className="flex items-center gap-2">
                  <Calculator size={16} className="text-amber-500" />
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="text-sm font-semibold text-slate-900 bg-transparent outline-none" />
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-500">Builder</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowGlobals(!showGlobals)} className={`p-1.5 rounded-lg ${showGlobals ? "bg-amber-100 text-amber-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`}>
                  <Variable size={16} />
                </button>
                <button onClick={exportCSV} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                  <Download size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-1.5">
                <Layers size={12} className="text-slate-400" />
                <span className="text-slate-500">{accounts.length} cuentas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <FolderOpen size={12} className="text-slate-400" />
                <span className="text-slate-500">{catCount} subcuentas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <FileText size={12} className="text-slate-400" />
                <span className="text-slate-500">{lineCount} líneas</span>
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-1.5">
                <Euro size={12} className="text-slate-400" />
                <span className="font-semibold text-slate-900">{fmt(total)} €</span>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none" />
              </div>
              <button onClick={() => setModal("account")} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800">
                <Plus size={14} />Nueva cuenta
              </button>
            </div>
          </div>

          {/* Accounts Table */}
          <div className="flex-1 overflow-auto p-4">
            {filteredAccounts.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                <FolderOpen size={24} className="text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500 mb-3">No hay cuentas</p>
                <button onClick={() => setModal("account")} className="text-sm text-amber-600 hover:text-amber-700">+ Crear primera cuenta</button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-2.5 w-24">Código</th>
                      <th className="px-4 py-2.5">Nombre</th>
                      <th className="px-4 py-2.5 w-28 text-center">Subcuentas</th>
                      <th className="px-4 py-2.5 w-28 text-center">Líneas</th>
                      <th className="px-4 py-2.5 w-36 text-right">Total</th>
                      <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAccounts.map(acc => {
                      const isSelected = selectedAccount?.id === acc.id;
                      const t = accTotal(acc);
                      const lc = acc.cats.reduce((s, c) => s + c.lines.length, 0);
                      return (
                        <tr key={acc.id} className={`hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50" : ""}`} onClick={() => openAccount(acc)}>
                          <td className="px-4 py-3"><span className="font-mono font-semibold text-slate-700">{acc.acct}</span></td>
                          <td className="px-4 py-3 font-medium text-slate-900">{acc.name}</td>
                          <td className="px-4 py-3 text-center text-slate-500">{acc.cats.length}</td>
                          <td className="px-4 py-3 text-center text-slate-500">{lc}</td>
                          <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">{fmt(t)} €</td>
                          <td className="px-4 py-3 text-right"><ChevronRight size={16} className="text-slate-400" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Side Panel */}
        {selectedAccount && (
          <div className="fixed right-0 top-16 bottom-0 w-1/2 bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col">
            {/* Panel Header */}
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {selectedCategory ? (
                  <button onClick={goBack} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><ArrowLeft size={18} /></button>
                ) : (
                  <>
                    <button onClick={goPrev} disabled={currentIdx <= 0} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronLeft size={18} /></button>
                    <span className="text-xs text-slate-500">{currentIdx + 1} / {accounts.length}</span>
                    <button onClick={goNext} disabled={currentIdx >= accounts.length - 1} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={18} /></button>
                  </>
                )}
              </div>
              <button onClick={() => { setSelectedAccount(null); setSelectedCategory(null); }} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {/* Title */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-lg font-bold text-slate-900">{selectedCategory ? selectedCategory.acct : selectedAccount.acct}</span>
                  </div>
                  <p className="text-sm text-slate-600">{selectedCategory ? selectedCategory.name : selectedAccount.name}</p>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-1">{selectedCategory ? "Líneas" : "Subcuentas"}</div>
                  <p className="text-lg font-semibold text-slate-900">{selectedCategory ? selectedCategory.lines.length : selectedAccount.cats.length}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-1">Total</div>
                  <p className="text-lg font-semibold text-slate-900">{fmt(selectedCategory ? catTotal(selectedCategory) : accTotal(selectedAccount))} €</p>
                </div>
              </div>

              {/* CATEGORIES VIEW */}
              {!selectedCategory && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Subcuentas</h4>
                    <button onClick={() => setModal("category")} className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"><Plus size={12} />Añadir</button>
                  </div>

                  {selectedAccount.cats.length === 0 ? (
                    <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center">
                      <p className="text-sm text-slate-400 mb-2">Sin subcuentas</p>
                      <button onClick={() => setModal("category")} className="text-xs text-amber-600">+ Crear subcuenta</button>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-slate-500">
                            <th className="px-3 py-2 font-medium">Código</th>
                            <th className="px-3 py-2 font-medium">Nombre</th>
                            <th className="px-3 py-2 text-center font-medium">Líneas</th>
                            <th className="px-3 py-2 text-right font-medium">Total</th>
                            <th className="px-3 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedAccount.cats.map(cat => (
                            <tr key={cat.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => openCategory(cat)}>
                              <td className="px-3 py-2 font-mono text-slate-600">{cat.acct}</td>
                              <td className="px-3 py-2 text-slate-900">{cat.name}</td>
                              <td className="px-3 py-2 text-center text-slate-500">{cat.lines.length}</td>
                              <td className="px-3 py-2 text-right font-mono text-slate-900">{fmt(catTotal(cat))} €</td>
                              <td className="px-3 py-2">
                                <button onClick={e => { e.stopPropagation(); deleteCategory(cat.id); }} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <button onClick={() => deleteAccount(selectedAccount.id)} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} />Eliminar cuenta</button>
                  </div>
                </>
              )}

              {/* LINES VIEW */}
              {selectedCategory && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Líneas</h4>
                    <button onClick={addLine} className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"><Plus size={12} />Añadir</button>
                  </div>

                  {selectedCategory.lines.length === 0 ? (
                    <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center">
                      <p className="text-sm text-slate-400 mb-2">Sin líneas</p>
                      <button onClick={addLine} className="text-xs text-amber-600">+ Crear línea</button>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr className="text-left text-slate-500">
                            <th className="px-3 py-2 font-medium w-16">Acct</th>
                            <th className="px-3 py-2 font-medium">Descripción</th>
                            <th className="px-3 py-2 text-right font-medium w-12">Amt</th>
                            <th className="px-3 py-2 text-center font-medium w-10">X</th>
                            <th className="px-3 py-2 text-right font-medium w-16">Rate</th>
                            <th className="px-3 py-2 text-right font-medium w-20">Total</th>
                            <th className="px-3 py-2 w-14"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedCategory.lines.map(line => {
                            const t = line.amt * line.x * line.rate;
                            return (
                              <tr key={line.id} className="group">
                                <td className="px-3 py-1.5 font-mono text-slate-400 text-[10px]">{line.acct}</td>
                                <td className="px-1 py-1.5">
                                  <input type="text" value={line.desc} onChange={e => updateLine(line.id, { desc: e.target.value })} className="w-full bg-transparent outline-none text-slate-900" placeholder="..." />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="number" value={line.amt || ""} onChange={e => updateLine(line.id, { amt: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="number" value={line.x || ""} onChange={e => updateLine(line.id, { x: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-center outline-none tabular-nums" />
                                </td>
                                <td className="px-1 py-1.5">
                                  <input type="number" value={line.rate || ""} onChange={e => updateLine(line.id, { rate: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums" step="0.01" />
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono text-slate-700 tabular-nums">{fmt(t)}</td>
                                <td className="px-2 py-1.5">
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                                    <button onClick={() => duplicateLine(line.id)} className="p-1 text-slate-400 hover:text-slate-600"><Copy size={11} /></button>
                                    <button onClick={() => deleteLine(line.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={11} /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200">
                          <tr>
                            <td colSpan={5} className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{fmt(catTotal(selectedCategory))} €</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  <button onClick={addLine} className="w-full mt-2 py-2 border border-dashed border-slate-200 rounded-lg text-xs text-slate-400 hover:text-slate-600 hover:border-slate-300 flex items-center justify-center gap-1">
                    <Plus size={12} />Nueva línea
                  </button>

                  <div className="mt-6 pt-4 border-t border-slate-200">
                    <button onClick={() => { deleteCategory(selectedCategory.id); setSelectedCategory(null); }} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"><Trash2 size={12} />Eliminar subcuenta</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Globals Panel (only when no account selected) */}
        {showGlobals && !selectedAccount && (
          <div className="w-56 border-l border-slate-200 bg-slate-50 flex-shrink-0 flex flex-col">
            <div className="flex border-b border-slate-200">
              <button onClick={() => setGlobTab("v")} className={`flex-1 px-3 py-2 text-xs font-medium ${globTab === "v" ? "bg-white border-b-2 border-amber-500" : "text-slate-500"}`}>Variables</button>
              <button onClick={() => setGlobTab("f")} className={`flex-1 px-3 py-2 text-xs font-medium ${globTab === "f" ? "bg-white border-b-2 border-amber-500" : "text-slate-500"}`}>Fringes</button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              {globTab === "v" && (
                <>
                  <button onClick={() => setModal("variable")} className="w-full mb-2 py-1.5 border border-dashed border-slate-300 rounded text-xs text-slate-500 hover:border-slate-400 flex items-center justify-center gap-1"><Plus size={10} />Variable</button>
                  {globals.map(v => (
                    <div key={v.id} className="mb-2 p-2 bg-white border border-slate-200 rounded">
                      <div className="flex items-center justify-between mb-1">
                        <code className="text-[10px] text-amber-600 font-mono">{v.code}</code>
                        <button onClick={() => setGlobals(p => p.filter(x => x.id !== v.id))} className="text-slate-400 hover:text-red-500"><X size={10} /></button>
                      </div>
                      <input type="number" value={v.value} onChange={e => setGlobals(p => p.map(x => x.id === v.id ? { ...x, value: parseFloat(e.target.value) || 0 } : x))} className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right font-mono" />
                    </div>
                  ))}
                </>
              )}
              {globTab === "f" && fringes.map(f => (
                <div key={f.id} className={`mb-2 p-2 border rounded flex items-center justify-between ${f.on ? "bg-white border-slate-200" : "bg-slate-100 border-slate-100 opacity-50"}`}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setFringes(p => p.map(x => x.id === f.id ? { ...x, on: !x.on } : x))} className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${f.on ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>{f.on && <Check size={8} className="text-white" />}</button>
                    <code className="text-[10px] font-mono text-slate-600">{f.code}</code>
                  </div>
                  <span className="text-xs font-medium text-amber-600">{f.rate}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal === "account" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white rounded-lg shadow-xl w-80" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold">Nueva cuenta</span>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-xs text-slate-600 mb-1">Código</label><input type="text" value={form.acct} onChange={e => setForm(p => ({ ...p, acct: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="01" autoFocus /></div>
              <div><label className="block text-xs text-slate-600 mb-1">Nombre</label><input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="GUIÓN" /></div>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button onClick={addAccount} className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800">Crear</button>
            </div>
          </div>
        </div>
      )}

      {modal === "category" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white rounded-lg shadow-xl w-80" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold">Nueva subcuenta</span>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-xs text-slate-600 mb-1">Código</label><input type="text" value={form.acct} onChange={e => setForm(p => ({ ...p, acct: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder={`${selectedAccount?.acct}-01`} autoFocus /></div>
              <div><label className="block text-xs text-slate-600 mb-1">Nombre</label><input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="GUIONISTA" /></div>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button onClick={addCategory} className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800">Crear</button>
            </div>
          </div>
        </div>
      )}

      {modal === "variable" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setModal(null)}>
          <div className="bg-white rounded-lg shadow-xl w-80" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-semibold">Nueva variable</span>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-xs text-slate-600 mb-1">Código</label><input type="text" value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" placeholder="SHOOT_DAYS" autoFocus /></div>
              <div><label className="block text-xs text-slate-600 mb-1">Valor</label><input type="number" value={form.val} onChange={e => setForm(p => ({ ...p, val: parseFloat(e.target.value) || 0 }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono" /></div>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
              <button onClick={addVariable} className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800">Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
