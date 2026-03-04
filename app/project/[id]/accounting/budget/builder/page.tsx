"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Download,
  ChevronRight,
  Calculator,
  X,
  FolderPlus,
  FileSpreadsheet,
  Variable,
  Layers,
  Home,
  Check,
  AlertCircle,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface VariableType {
  id: string;
  name: string;
  code: string;
  value: number;
  unit: "number" | "currency" | "days" | "weeks" | "percent";
}

interface BudgetLine {
  id: string;
  code: string;
  description: string;
  units: number;
  unitType: string;
  rate: number;
  quantity: number;
  formula?: string;
}

interface BudgetCategory {
  id: string;
  code: string;
  name: string;
  lines: BudgetLine[];
}

interface BudgetAccount {
  id: string;
  code: string;
  name: string;
  categories: BudgetCategory[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const UNIT_TYPES = [
  { value: "flat", label: "Fijo" },
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "hour", label: "Hora" },
  { value: "unit", label: "Unidad" },
  { value: "allow", label: "Alzado" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BudgetBuilderPage() {
  const params = useParams();
  const projectId = params?.id as string;

  // Data State
  const [projectName, setProjectName] = useState("Nuevo presupuesto");
  const [variables, setVariables] = useState<VariableType[]>([]);
  const [accounts, setAccounts] = useState<BudgetAccount[]>([]);
  
  // Navigation State
  const [currentView, setCurrentView] = useState<"accounts" | "account" | "category">("accounts");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  
  // UI State
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [showNewVariableModal, setShowNewVariableModal] = useState(false);
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; type: "account" | "category" | "line"; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
  // Form State
  const [newVariableForm, setNewVariableForm] = useState({ name: "", code: "", value: 0, unit: "number" as VariableType["unit"] });
  const [newAccountForm, setNewAccountForm] = useState({ code: "", name: "" });
  const [newCategoryForm, setNewCategoryForm] = useState({ code: "", name: "" });

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const selectedCategory = selectedAccount?.categories.find(c => c.id === selectedCategoryId);

  // ═══════════════════════════════════════════════════════════════════════════════
  // FORMULA PARSER
  // ═══════════════════════════════════════════════════════════════════════════════

  const evaluateFormula = useCallback((formula: string): number => {
    if (!formula || formula.trim() === "") return 0;
    let expression = formula.toUpperCase();
    variables.forEach(v => {
      const regex = new RegExp(`\\b${v.code}\\b`, "gi");
      expression = expression.replace(regex, v.value.toString());
    });
    if (!/^[\d\s+\-*/().,%]+$/.test(expression)) return 0;
    try {
      expression = expression.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
      const result = Function(`"use strict"; return (${expression})`)();
      return typeof result === "number" && !isNaN(result) ? result : 0;
    } catch { return 0; }
  }, [variables]);

  const calculateLineTotal = useCallback((line: BudgetLine): number => {
    if (line.formula) {
      const formulaValue = evaluateFormula(line.formula);
      if (formulaValue > 0) return formulaValue;
    }
    return line.units * line.rate * line.quantity;
  }, [evaluateFormula]);

  const getCategoryTotal = (category: BudgetCategory): number => category.lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
  const getAccountTotal = (account: BudgetAccount): number => account.categories.reduce((sum, cat) => sum + getCategoryTotal(cat), 0);
  const getGrandTotal = (): number => accounts.reduce((sum, acc) => sum + getAccountTotal(acc), 0);

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════════

  const addAccount = () => {
    if (!newAccountForm.code.trim() || !newAccountForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    const newAccount: BudgetAccount = { id: crypto.randomUUID(), code: newAccountForm.code.trim(), name: newAccountForm.name.trim(), categories: [] };
    setAccounts(prev => [...prev, newAccount].sort((a, b) => a.code.localeCompare(b.code)));
    setNewAccountForm({ code: "", name: "" });
    setShowNewAccountModal(false);
    showToast("success", `Cuenta ${newAccount.code} creada`);
  };

  const deleteAccount = (accountId: string) => {
    setAccounts(prev => prev.filter(a => a.id !== accountId));
    if (selectedAccountId === accountId) { setSelectedAccountId(null); setCurrentView("accounts"); }
    setContextMenu(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - CATEGORIES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addCategory = () => {
    if (!selectedAccountId) return;
    if (!newCategoryForm.code.trim() || !newCategoryForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== selectedAccountId) return acc;
      const newCat: BudgetCategory = { id: crypto.randomUUID(), code: newCategoryForm.code.trim(), name: newCategoryForm.name.trim(), lines: [] };
      return { ...acc, categories: [...acc.categories, newCat].sort((a, b) => a.code.localeCompare(b.code)) };
    }));
    setNewCategoryForm({ code: "", name: "" });
    setShowNewCategoryModal(false);
    showToast("success", "Subcuenta creada");
  };

  const deleteCategory = (accountId: string, categoryId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return { ...acc, categories: acc.categories.filter(c => c.id !== categoryId) };
    }));
    if (selectedCategoryId === categoryId) { setSelectedCategoryId(null); setCurrentView("account"); }
    setContextMenu(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - LINES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addLine = () => {
    if (!selectedAccountId || !selectedCategoryId) return;
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== selectedAccountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== selectedCategoryId) return cat;
          const nextNum = cat.lines.length + 1;
          const newLine: BudgetLine = { id: crypto.randomUUID(), code: `${cat.code}.${String(nextNum).padStart(3, "0")}`, description: "", units: 1, unitType: "flat", rate: 0, quantity: 1 };
          return { ...cat, lines: [...cat.lines, newLine] };
        }),
      };
    }));
  };

  const updateLine = (lineId: string, field: string, value: any) => {
    if (!selectedAccountId || !selectedCategoryId) return;
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== selectedAccountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== selectedCategoryId) return cat;
          return { ...cat, lines: cat.lines.map(line => line.id === lineId ? { ...line, [field]: value } : line) };
        }),
      };
    }));
  };

  const deleteLine = (lineId: string) => {
    if (!selectedAccountId || !selectedCategoryId) return;
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== selectedAccountId) return acc;
      return { ...acc, categories: acc.categories.map(cat => cat.id !== selectedCategoryId ? cat : { ...cat, lines: cat.lines.filter(l => l.id !== lineId) }) };
    }));
    setContextMenu(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - VARIABLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addVariable = () => {
    if (!newVariableForm.code.trim() || !newVariableForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    if (variables.some(v => v.code.toUpperCase() === newVariableForm.code.toUpperCase())) { showToast("error", "Variable duplicada"); return; }
    const newVar: VariableType = { id: crypto.randomUUID(), name: newVariableForm.name.trim(), code: newVariableForm.code.toUpperCase().replace(/\s/g, "_"), value: newVariableForm.value, unit: newVariableForm.unit };
    setVariables(prev => [...prev, newVar]);
    setNewVariableForm({ name: "", code: "", value: 0, unit: "number" });
    setShowNewVariableModal(false);
    showToast("success", `Variable ${newVar.code} creada`);
  };

  const updateVariable = (id: string, value: number) => setVariables(prev => prev.map(v => v.id === id ? { ...v, value } : v));
  const deleteVariable = (id: string) => setVariables(prev => prev.filter(v => v.id !== id));

  // ═══════════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════════════

  const navigateToAccounts = () => { setCurrentView("accounts"); setSelectedAccountId(null); setSelectedCategoryId(null); };
  const navigateToAccount = (accountId: string) => { setSelectedAccountId(accountId); setSelectedCategoryId(null); setCurrentView("account"); };
  const navigateToCategory = (categoryId: string) => { setSelectedCategoryId(categoryId); setCurrentView("category"); };

  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════════

  const exportToCSV = () => {
    const rows: string[][] = [["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"]];
    accounts.forEach(acc => {
      rows.push([acc.code, acc.name, "cuenta", ""]);
      acc.categories.forEach(cat => {
        rows.push([cat.code, cat.name, "subcuenta", ""]);
        cat.lines.forEach(line => rows.push([line.code, line.description, "partida", calculateLineTotal(line).toFixed(2)]));
      });
    });
    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `presupuesto_${projectName.replace(/\s/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("success", "Presupuesto exportado");
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu]);

  const grandTotal = getGrandTotal();

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
            {toast.type === "success" ? <Check size={14} /> : <AlertCircle size={14} />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 min-w-[140px]" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { if (contextMenu.type === "account") deleteAccount(contextMenu.id); else if (contextMenu.type === "category") deleteCategory(selectedAccountId!, contextMenu.id); else if (contextMenu.type === "line") deleteLine(contextMenu.id); }} className="w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
            <Trash2 size={12} />Eliminar
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/project/${projectId}/accounting/budget`} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <Calculator size={16} className="text-white" />
              </div>
              <div>
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="text-sm font-semibold text-slate-900 bg-transparent border-none outline-none hover:bg-slate-100 focus:bg-slate-100 px-1 py-0.5 rounded -ml-1" placeholder="Nombre del proyecto" />
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Budget Builder</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button onClick={() => setShowVariablesPanel(!showVariablesPanel)} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${showVariablesPanel ? "bg-amber-100 text-amber-700 border border-amber-200" : "text-slate-600 hover:bg-slate-100 border border-transparent"}`}>
              <Variable size={14} />Variables {variables.length > 0 && `(${variables.length})`}
            </button>
            <div className="w-px h-6 bg-slate-200" />
            <button onClick={exportToCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <Download size={14} />Exportar
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-1 text-sm">
          <button onClick={navigateToAccounts} className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${currentView === "accounts" ? "text-slate-900 font-medium" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
            <Home size={12} />Cuentas
          </button>
          {selectedAccount && (
            <>
              <ChevronRight size={14} className="text-slate-300" />
              <button onClick={() => navigateToAccount(selectedAccount.id)} className={`px-2 py-1 rounded transition-colors ${currentView === "account" ? "text-slate-900 font-medium" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
                {selectedAccount.code} {selectedAccount.name}
              </button>
            </>
          )}
          {selectedCategory && (
            <>
              <ChevronRight size={14} className="text-slate-300" />
              <span className="px-2 py-1 text-slate-900 font-medium">{selectedCategory.code} {selectedCategory.name}</span>
            </>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-3 text-xs">
            <span className="text-slate-400">Total:</span>
            <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(grandTotal)} €</span>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex">
        {/* Variables Panel */}
        {showVariablesPanel && (
          <div className="w-72 bg-white border-r border-slate-200 h-[calc(100vh-7rem)] overflow-y-auto flex-shrink-0">
            <div className="p-4 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Variables</h3>
                <button onClick={() => setShowNewVariableModal(true)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"><Plus size={14} /></button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Usa códigos en fórmulas</p>
            </div>
            
            {variables.length === 0 ? (
              <div className="p-4 text-center">
                <Variable size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-xs text-slate-400">Sin variables</p>
                <button onClick={() => setShowNewVariableModal(true)} className="mt-2 text-xs text-amber-600 hover:text-amber-700">Crear primera variable</button>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {variables.map(v => (
                  <div key={v.id} className="group p-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{v.code}</span>
                      <button onClick={() => deleteVariable(v.id)} className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><X size={12} /></button>
                    </div>
                    <p className="text-xs text-slate-600 mb-2">{v.name}</p>
                    <input type="number" value={v.value} onChange={(e) => updateVariable(v.id, parseFloat(e.target.value) || 0)} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-right font-medium text-slate-900 focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 p-6">
          {/* ACCOUNTS VIEW */}
          {currentView === "accounts" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Cuentas</h2>
                  <p className="text-sm text-slate-500">Estructura del presupuesto</p>
                </div>
                <button onClick={() => setShowNewAccountModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors">
                  <Plus size={16} />Nueva cuenta
                </button>
              </div>

              {accounts.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Layers size={28} className="text-slate-400" /></div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">Sin cuentas</h3>
                  <p className="text-sm text-slate-500 mb-4">Crea tu primera cuenta para empezar el presupuesto</p>
                  <button onClick={() => setShowNewAccountModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition-colors"><Plus size={16} />Crear cuenta</button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {accounts.map(account => (
                    <div key={account.id} onClick={() => navigateToAccount(account.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ id: account.id, type: "account", x: e.clientX, y: e.clientY }); }} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm cursor-pointer transition-all group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600">{account.code}</div>
                          <div>
                            <h3 className="font-medium text-slate-900">{account.name}</h3>
                            <p className="text-xs text-slate-500">{account.categories.length} subcuentas</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-semibold text-slate-900 tabular-nums">{formatCurrency(getAccountTotal(account))} €</span>
                          <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ACCOUNT VIEW */}
          {currentView === "account" && selectedAccount && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selectedAccount.code} · {selectedAccount.name}</h2>
                  <p className="text-sm text-slate-500">Subcuentas</p>
                </div>
                <button onClick={() => setShowNewCategoryModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"><Plus size={16} />Nueva subcuenta</button>
              </div>

              {selectedAccount.categories.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><FolderPlus size={28} className="text-slate-400" /></div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">Sin subcuentas</h3>
                  <p className="text-sm text-slate-500 mb-4">Añade subcuentas para desglosar</p>
                  <button onClick={() => setShowNewCategoryModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition-colors"><Plus size={16} />Crear subcuenta</button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {selectedAccount.categories.map(category => (
                    <div key={category.id} onClick={() => navigateToCategory(category.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ id: category.id, type: "category", x: e.clientX, y: e.clientY }); }} className="bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 hover:shadow-sm cursor-pointer transition-all group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-xs font-bold text-amber-600">{category.code}</div>
                          <div>
                            <h3 className="font-medium text-slate-900">{category.name}</h3>
                            <p className="text-xs text-slate-500">{category.lines.length} partidas</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-semibold text-slate-900 tabular-nums">{formatCurrency(getCategoryTotal(category))} €</span>
                          <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500 transition-colors" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedAccount.categories.length > 0 && (
                <div className="mt-6 bg-slate-900 rounded-xl p-4 flex items-center justify-between">
                  <span className="text-sm text-slate-400">Total {selectedAccount.name}</span>
                  <span className="text-xl font-bold text-white tabular-nums">{formatCurrency(getAccountTotal(selectedAccount))} €</span>
                </div>
              )}
            </div>
          )}

          {/* CATEGORY VIEW - Spreadsheet */}
          {currentView === "category" && selectedAccount && selectedCategory && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selectedCategory.code} · {selectedCategory.name}</h2>
                  <p className="text-sm text-slate-500">Partidas presupuestarias</p>
                </div>
                <button onClick={addLine} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors"><Plus size={16} />Nueva partida</button>
              </div>

              {selectedCategory.lines.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><FileSpreadsheet size={28} className="text-slate-400" /></div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-1">Sin partidas</h3>
                  <p className="text-sm text-slate-500 mb-4">Añade partidas para presupuestar</p>
                  <button onClick={addLine} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600 transition-colors"><Plus size={16} />Crear partida</button>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Código</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Descripción</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Uds</th>
                        <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Tipo</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Precio</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Cant</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Total</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedCategory.lines.map(line => {
                        const lineTotal = calculateLineTotal(line);
                        return (
                          <tr key={line.id} className="hover:bg-slate-50 group" onContextMenu={(e) => { e.preventDefault(); setContextMenu({ id: line.id, type: "line", x: e.clientX, y: e.clientY }); }}>
                            <td className="px-4 py-2"><span className="font-mono text-xs text-slate-400">{line.code}</span></td>
                            <td className="px-4 py-2"><input type="text" value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} placeholder="Descripción..." className="w-full bg-transparent outline-none text-slate-900 placeholder-slate-400" /></td>
                            <td className="px-4 py-2"><input type="number" value={line.units || ""} onChange={(e) => updateLine(line.id, "units", parseFloat(e.target.value) || 0)} className="w-full bg-transparent text-right outline-none text-slate-900 tabular-nums" /></td>
                            <td className="px-4 py-2"><select value={line.unitType} onChange={(e) => updateLine(line.id, "unitType", e.target.value)} className="w-full bg-transparent text-center outline-none text-slate-600 cursor-pointer">{UNIT_TYPES.map(ut => <option key={ut.value} value={ut.value}>{ut.label}</option>)}</select></td>
                            <td className="px-4 py-2"><input type="number" value={line.rate || ""} onChange={(e) => updateLine(line.id, "rate", parseFloat(e.target.value) || 0)} className="w-full bg-transparent text-right outline-none text-slate-900 tabular-nums" step="0.01" /></td>
                            <td className="px-4 py-2"><input type="number" value={line.quantity || ""} onChange={(e) => updateLine(line.id, "quantity", parseFloat(e.target.value) || 0)} className="w-full bg-transparent text-right outline-none text-slate-900 tabular-nums" /></td>
                            <td className="px-4 py-2 text-right"><span className={`font-semibold tabular-nums ${lineTotal > 0 ? "text-emerald-600" : "text-slate-400"}`}>{formatCurrency(lineTotal)} €</span></td>
                            <td className="px-2 py-2"><button onClick={() => deleteLine(line.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={14} /></button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={6} className="px-4 py-3 text-right text-sm font-medium text-slate-600">Total {selectedCategory.name}</td>
                        <td className="px-4 py-3 text-right"><span className="font-bold text-slate-900 tabular-nums">{formatCurrency(getCategoryTotal(selectedCategory))} €</span></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                  <button onClick={addLine} className="w-full px-4 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 border-t border-slate-100 flex items-center justify-center gap-1.5 transition-colors"><Plus size={14} />Añadir partida</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      {showNewVariableModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewVariableModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva variable</h3>
              <button onClick={() => setShowNewVariableModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label><input type="text" value={newVariableForm.name} onChange={(e) => setNewVariableForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ej: Días de rodaje" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label><input type="text" value={newVariableForm.code} onChange={(e) => setNewVariableForm(prev => ({ ...prev, code: e.target.value.toUpperCase().replace(/\s/g, "_") }))} placeholder="Ej: SHOOT_DAYS" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" /><p className="text-xs text-slate-500 mt-1">Usa este código en fórmulas</p></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Valor</label><input type="number" value={newVariableForm.value} onChange={(e) => setNewVariableForm(prev => ({ ...prev, value: parseFloat(e.target.value) || 0 }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Unidad</label><select value={newVariableForm.unit} onChange={(e) => setNewVariableForm(prev => ({ ...prev, unit: e.target.value as VariableType["unit"] }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none"><option value="number">Número</option><option value="currency">Moneda (€)</option><option value="days">Días</option><option value="weeks">Semanas</option><option value="percent">Porcentaje (%)</option></select></div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewVariableModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={addVariable} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">Crear variable</button>
            </div>
          </div>
        </div>
      )}

      {showNewAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewAccountModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva cuenta</h3>
              <button onClick={() => setShowNewAccountModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label><input type="text" value={newAccountForm.code} onChange={(e) => setNewAccountForm(prev => ({ ...prev, code: e.target.value }))} placeholder="Ej: 01" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" autoFocus /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label><input type="text" value={newAccountForm.name} onChange={(e) => setNewAccountForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ej: GUIÓN Y DESARROLLO" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewAccountModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={addAccount} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">Crear cuenta</button>
            </div>
          </div>
        </div>
      )}

      {showNewCategoryModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewCategoryModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva subcuenta</h3>
              <button onClick={() => setShowNewCategoryModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label><input type="text" value={newCategoryForm.code} onChange={(e) => setNewCategoryForm(prev => ({ ...prev, code: e.target.value }))} placeholder={`Ej: ${selectedAccount?.code || ""}.01`} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" autoFocus /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label><input type="text" value={newCategoryForm.name} onChange={(e) => setNewCategoryForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Ej: Guión original" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewCategoryModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors">Cancelar</button>
              <button onClick={addCategory} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">Crear subcuenta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
