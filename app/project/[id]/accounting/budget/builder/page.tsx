"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ArrowLeft, Plus, Trash2, Download, ChevronRight, ChevronDown, Calculator, X, FolderPlus,
  FileSpreadsheet, Variable, Layers, Home, Check, AlertCircle, Copy, Search, Settings2,
  MoreHorizontal, Users, Percent, DollarSign, Clock, Calendar, Film, Grid3X3, Eye, EyeOff,
  Lock, Unlock, MessageSquare, Hash, TrendingUp, ArrowUpDown, Filter, BarChart3, Zap,
  BookOpen, Tag, Columns, ChevronUp, GripVertical, RefreshCw, FileDown, Sparkles, PanelLeftClose,
  PanelLeft, Info, Edit3, AlertTriangle, CheckCircle, ChevronsUpDown,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface GlobalVariable {
  id: string;
  name: string;
  code: string;
  value: number;
  unit: "number" | "currency" | "days" | "weeks" | "hours" | "percent";
  category: "time" | "rates" | "multipliers" | "custom";
  description?: string;
}

interface Fringe {
  id: string;
  code: string;
  name: string;
  rate: number;
  type: "percent" | "flat";
  appliesTo: "all" | "labor" | "custom";
  ceiling?: number;
  enabled: boolean;
}

interface BudgetLine {
  id: string;
  code: string;
  description: string;
  account: string;
  units: number;
  unitType: string;
  rate: number;
  quantity: number;
  fringes: string[];
  formula?: string;
  notes?: string;
  locked?: boolean;
  contact?: string;
  tags?: string[];
}

interface BudgetCategory {
  id: string;
  code: string;
  name: string;
  lines: BudgetLine[];
  color?: string;
  icon?: string;
}

interface BudgetAccount {
  id: string;
  code: string;
  name: string;
  type: "atl" | "btl" | "post" | "other";
  categories: BudgetCategory[];
  collapsed?: boolean;
}

interface TopsheetItem {
  code: string;
  name: string;
  estimate: number;
  actual?: number;
  variance?: number;
}

type ViewMode = "topsheet" | "detail" | "category";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const UNIT_TYPES = [
  { value: "flat", label: "Fijo", short: "FLT" },
  { value: "day", label: "Día", short: "DÍA" },
  { value: "week", label: "Semana", short: "SEM" },
  { value: "hour", label: "Hora", short: "HR" },
  { value: "allow", label: "Alzado", short: "ALZ" },
  { value: "lot", label: "Lote", short: "LOT" },
  { value: "unit", label: "Unidad", short: "UNI" },
  { value: "page", label: "Página", short: "PÁG" },
  { value: "episode", label: "Capítulo", short: "CAP" },
];

const ACCOUNT_TYPES = [
  { value: "atl", label: "Above The Line", color: "bg-violet-500" },
  { value: "btl", label: "Below The Line", color: "bg-blue-500" },
  { value: "post", label: "Post-producción", color: "bg-emerald-500" },
  { value: "other", label: "Otros", color: "bg-slate-500" },
];

const VARIABLE_CATEGORIES = [
  { value: "time", label: "Tiempos", icon: Clock },
  { value: "rates", label: "Tarifas", icon: DollarSign },
  { value: "multipliers", label: "Multiplicadores", icon: Percent },
  { value: "custom", label: "Personalizadas", icon: Variable },
];

const DEFAULT_FRINGES: Fringe[] = [
  { id: "ss", code: "SS", name: "Seguridad Social", rate: 23.6, type: "percent", appliesTo: "labor", enabled: true },
  { id: "vacaciones", code: "VAC", name: "Vacaciones", rate: 8.33, type: "percent", appliesTo: "labor", enabled: true },
  { id: "pagas", code: "PE", name: "Pagas Extra", rate: 8.33, type: "percent", appliesTo: "labor", enabled: true },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BudgetBuilderPage() {
  const params = useParams();
  const projectId = params?.id as string;

  // Core Data
  const [projectName, setProjectName] = useState("Nuevo presupuesto");
  const [variables, setVariables] = useState<GlobalVariable[]>([]);
  const [fringes, setFringes] = useState<Fringe[]>(DEFAULT_FRINGES);
  const [accounts, setAccounts] = useState<BudgetAccount[]>([]);
  
  // Navigation
  const [viewMode, setViewMode] = useState<ViewMode>("topsheet");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  
  // Panels
  const [showGlobalsPanel, setShowGlobalsPanel] = useState(false);
  const [showFringesPanel, setShowFringesPanel] = useState(false);
  const [activeGlobalsTab, setActiveGlobalsTab] = useState<"variables" | "fringes">("variables");
  
  // Modals
  const [showNewVariableModal, setShowNewVariableModal] = useState(false);
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [showNewFringeModal, setShowNewFringeModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState<{ lineId: string; notes: string } | null>(null);
  
  // UI State
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; type: string; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  
  // Forms
  const [newVariableForm, setNewVariableForm] = useState({ name: "", code: "", value: 0, unit: "number" as GlobalVariable["unit"], category: "custom" as GlobalVariable["category"], description: "" });
  const [newAccountForm, setNewAccountForm] = useState({ code: "", name: "", type: "btl" as BudgetAccount["type"] });
  const [newCategoryForm, setNewCategoryForm] = useState({ code: "", name: "" });
  const [newFringeForm, setNewFringeForm] = useState({ code: "", name: "", rate: 0, type: "percent" as Fringe["type"], appliesTo: "labor" as Fringe["appliesTo"] });

  // Refs
  const tableRef = useRef<HTMLDivElement>(null);

  // Get selections
  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const selectedCategory = selectedAccount?.categories.find(c => c.id === selectedCategoryId);

  // ═══════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const formatCurrency = (amount: number): string => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const formatCompact = (amount: number): string => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
    return formatCurrency(amount);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // FORMULA ENGINE
  // ═══════════════════════════════════════════════════════════════════════════════

  const evaluateFormula = useCallback((formula: string): number => {
    if (!formula?.trim()) return 0;
    let expr = formula.toUpperCase();
    variables.forEach(v => {
      expr = expr.replace(new RegExp(`\\b${v.code}\\b`, "gi"), v.value.toString());
    });
    if (!/^[\d\s+\-*/().,%]+$/.test(expr)) return 0;
    try {
      expr = expr.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
      const result = Function(`"use strict"; return (${expr})`)();
      return typeof result === "number" && !isNaN(result) ? result : 0;
    } catch { return 0; }
  }, [variables]);

  const calculateLineFringes = useCallback((line: BudgetLine, baseAmount: number): number => {
    if (!line.fringes?.length) return 0;
    return line.fringes.reduce((total, fringeId) => {
      const fringe = fringes.find(f => f.id === fringeId && f.enabled);
      if (!fringe) return total;
      if (fringe.type === "percent") {
        const cap = fringe.ceiling ? Math.min(baseAmount, fringe.ceiling) : baseAmount;
        return total + (cap * fringe.rate / 100);
      }
      return total + fringe.rate;
    }, 0);
  }, [fringes]);

  const calculateLineTotal = useCallback((line: BudgetLine): { base: number; fringes: number; total: number } => {
    let base = 0;
    if (line.formula) {
      base = evaluateFormula(line.formula);
    }
    if (base === 0) {
      base = line.units * line.rate * line.quantity;
    }
    const fringeAmount = calculateLineFringes(line, base);
    return { base, fringes: fringeAmount, total: base + fringeAmount };
  }, [evaluateFormula, calculateLineFringes]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGGREGATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  const getCategoryTotals = (category: BudgetCategory) => {
    return category.lines.reduce((acc, line) => {
      const calc = calculateLineTotal(line);
      return { base: acc.base + calc.base, fringes: acc.fringes + calc.fringes, total: acc.total + calc.total };
    }, { base: 0, fringes: 0, total: 0 });
  };

  const getAccountTotals = (account: BudgetAccount) => {
    return account.categories.reduce((acc, cat) => {
      const calc = getCategoryTotals(cat);
      return { base: acc.base + calc.base, fringes: acc.fringes + calc.fringes, total: acc.total + calc.total };
    }, { base: 0, fringes: 0, total: 0 });
  };

  const getTypeTotals = (type: BudgetAccount["type"]) => {
    return accounts.filter(a => a.type === type).reduce((acc, account) => {
      const calc = getAccountTotals(account);
      return { base: acc.base + calc.base, fringes: acc.fringes + calc.fringes, total: acc.total + calc.total };
    }, { base: 0, fringes: 0, total: 0 });
  };

  const getGrandTotals = () => {
    return accounts.reduce((acc, account) => {
      const calc = getAccountTotals(account);
      return { base: acc.base + calc.base, fringes: acc.fringes + calc.fringes, total: acc.total + calc.total };
    }, { base: 0, fringes: 0, total: 0 });
  };

  const getTopsheet = (): TopsheetItem[] => {
    const items: TopsheetItem[] = [];
    
    // ATL
    const atlAccounts = accounts.filter(a => a.type === "atl");
    atlAccounts.forEach(acc => {
      items.push({ code: acc.code, name: acc.name, estimate: getAccountTotals(acc).total });
    });
    if (atlAccounts.length) {
      items.push({ code: "", name: "TOTAL ABOVE THE LINE", estimate: getTypeTotals("atl").total });
    }
    
    // BTL
    const btlAccounts = accounts.filter(a => a.type === "btl");
    btlAccounts.forEach(acc => {
      items.push({ code: acc.code, name: acc.name, estimate: getAccountTotals(acc).total });
    });
    if (btlAccounts.length) {
      items.push({ code: "", name: "TOTAL BELOW THE LINE", estimate: getTypeTotals("btl").total });
    }
    
    // Post
    const postAccounts = accounts.filter(a => a.type === "post");
    postAccounts.forEach(acc => {
      items.push({ code: acc.code, name: acc.name, estimate: getAccountTotals(acc).total });
    });
    if (postAccounts.length) {
      items.push({ code: "", name: "TOTAL POST-PRODUCCIÓN", estimate: getTypeTotals("post").total });
    }
    
    // Other
    const otherAccounts = accounts.filter(a => a.type === "other");
    otherAccounts.forEach(acc => {
      items.push({ code: acc.code, name: acc.name, estimate: getAccountTotals(acc).total });
    });
    
    return items;
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════════

  const addAccount = () => {
    if (!newAccountForm.code.trim() || !newAccountForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    const newAccount: BudgetAccount = { id: crypto.randomUUID(), code: newAccountForm.code.trim(), name: newAccountForm.name.trim().toUpperCase(), type: newAccountForm.type, categories: [] };
    setAccounts(prev => [...prev, newAccount].sort((a, b) => a.code.localeCompare(b.code)));
    setExpandedAccounts(prev => new Set(prev).add(newAccount.id));
    setNewAccountForm({ code: "", name: "", type: "btl" });
    setShowNewAccountModal(false);
    showToast("success", `Cuenta ${newAccount.code} creada`);
  };

  const deleteAccount = (id: string) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
    if (selectedAccountId === id) { setSelectedAccountId(null); setViewMode("topsheet"); }
    setContextMenu(null);
  };

  const toggleAccountExpand = (id: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
    setAccounts(prev => prev.map(acc => acc.id !== accountId ? acc : { ...acc, categories: acc.categories.filter(c => c.id !== categoryId) }));
    if (selectedCategoryId === categoryId) { setSelectedCategoryId(null); setViewMode("detail"); }
    setContextMenu(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - LINES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addLine = (accountId: string, categoryId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          const nextNum = cat.lines.length + 1;
          const newLine: BudgetLine = {
            id: crypto.randomUUID(),
            code: `${cat.code}-${String(nextNum).padStart(2, "0")}`,
            description: "",
            account: cat.code,
            units: 1,
            unitType: "flat",
            rate: 0,
            quantity: 1,
            fringes: [],
          };
          return { ...cat, lines: [...cat.lines, newLine] };
        }),
      };
    }));
  };

  const updateLine = (accountId: string, categoryId: string, lineId: string, updates: Partial<BudgetLine>) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          return { ...cat, lines: cat.lines.map(line => line.id === lineId ? { ...line, ...updates } : line) };
        }),
      };
    }));
  };

  const deleteLine = (accountId: string, categoryId: string, lineId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return { ...acc, categories: acc.categories.map(cat => cat.id !== categoryId ? cat : { ...cat, lines: cat.lines.filter(l => l.id !== lineId) }) };
    }));
    setContextMenu(null);
  };

  const duplicateLine = (accountId: string, categoryId: string, lineId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          const line = cat.lines.find(l => l.id === lineId);
          if (!line) return cat;
          const idx = cat.lines.findIndex(l => l.id === lineId);
          const newLine = { ...line, id: crypto.randomUUID(), code: `${line.code}-copy` };
          const newLines = [...cat.lines];
          newLines.splice(idx + 1, 0, newLine);
          return { ...cat, lines: newLines };
        }),
      };
    }));
    setContextMenu(null);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - VARIABLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addVariable = () => {
    if (!newVariableForm.code.trim() || !newVariableForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    if (variables.some(v => v.code.toUpperCase() === newVariableForm.code.toUpperCase())) { showToast("error", "Código duplicado"); return; }
    const newVar: GlobalVariable = {
      id: crypto.randomUUID(),
      name: newVariableForm.name.trim(),
      code: newVariableForm.code.toUpperCase().replace(/\s/g, "_"),
      value: newVariableForm.value,
      unit: newVariableForm.unit,
      category: newVariableForm.category,
      description: newVariableForm.description,
    };
    setVariables(prev => [...prev, newVar]);
    setNewVariableForm({ name: "", code: "", value: 0, unit: "number", category: "custom", description: "" });
    setShowNewVariableModal(false);
    showToast("success", `Variable ${newVar.code} creada`);
  };

  const updateVariable = (id: string, updates: Partial<GlobalVariable>) => setVariables(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
  const deleteVariable = (id: string) => setVariables(prev => prev.filter(v => v.id !== id));

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD - FRINGES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addFringe = () => {
    if (!newFringeForm.code.trim() || !newFringeForm.name.trim()) { showToast("error", "Código y nombre obligatorios"); return; }
    const newFringe: Fringe = {
      id: crypto.randomUUID(),
      code: newFringeForm.code.toUpperCase(),
      name: newFringeForm.name,
      rate: newFringeForm.rate,
      type: newFringeForm.type,
      appliesTo: newFringeForm.appliesTo,
      enabled: true,
    };
    setFringes(prev => [...prev, newFringe]);
    setNewFringeForm({ code: "", name: "", rate: 0, type: "percent", appliesTo: "labor" });
    setShowNewFringeModal(false);
    showToast("success", `Fringe ${newFringe.code} creado`);
  };

  const toggleFringe = (id: string) => setFringes(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
  const deleteFringe = (id: string) => setFringes(prev => prev.filter(f => f.id !== id));

  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════════

  const exportToCSV = () => {
    const rows: string[][] = [["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"]];
    accounts.forEach(acc => {
      rows.push([acc.code, acc.name, "cuenta", ""]);
      acc.categories.forEach(cat => {
        rows.push([cat.code, cat.name, "subcuenta", ""]);
        cat.lines.forEach(line => {
          const calc = calculateLineTotal(line);
          rows.push([line.code, line.description, "partida", calc.total.toFixed(2)]);
        });
      });
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/\s/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("success", "CSV exportado");
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "g") { e.preventDefault(); setShowGlobalsPanel(p => !p); }
        if (e.key === "e") { e.preventDefault(); exportToCSV(); }
        if (e.key === "k") { e.preventDefault(); document.getElementById("search-input")?.focus(); }
      }
      if (e.key === "?" && !e.metaKey) { setShowKeyboardShortcuts(p => !p); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [contextMenu]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMPUTED VALUES
  // ═══════════════════════════════════════════════════════════════════════════════

  const totals = getGrandTotals();
  const lineCount = accounts.reduce((sum, a) => sum + a.categories.reduce((s, c) => s + c.lines.length, 0), 0);
  const categoryCount = accounts.reduce((sum, a) => sum + a.categories.length, 0);

  // ═══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[100]">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === "success" ? "bg-emerald-600 text-white" : toast.type === "error" ? "bg-red-600 text-white" : "bg-blue-600 text-white"
          }`}>
            {toast.type === "success" ? <Check size={14} /> : toast.type === "error" ? <AlertCircle size={14} /> : <Info size={14} />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed bg-white border border-slate-200 rounded-xl shadow-xl py-1.5 z-[100] min-w-[160px]" style={{ top: contextMenu.y, left: contextMenu.x }} onClick={e => e.stopPropagation()}>
          {contextMenu.type === "line" && (
            <>
              <button onClick={() => duplicateLine(selectedAccountId!, selectedCategoryId!, contextMenu.id)} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Copy size={14} />Duplicar</button>
              <button onClick={() => setShowNotesModal({ lineId: contextMenu.id, notes: "" })} className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><MessageSquare size={14} />Notas</button>
              <div className="border-t border-slate-100 my-1" />
            </>
          )}
          <button onClick={() => {
            if (contextMenu.type === "account") deleteAccount(contextMenu.id);
            else if (contextMenu.type === "category") deleteCategory(selectedAccountId!, contextMenu.id);
            else if (contextMenu.type === "line") deleteLine(selectedAccountId!, selectedCategoryId!, contextMenu.id);
          }} className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14} />Eliminar</button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center gap-4">
          <Link href={`/project/${projectId}/accounting/budget`} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><ArrowLeft size={18} /></Link>
          
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Calculator size={18} className="text-white" />
            </div>
            <div>
              <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} className="text-sm font-semibold text-slate-900 bg-transparent border-none outline-none hover:bg-slate-100 focus:bg-slate-100 px-2 py-0.5 rounded -ml-2 w-64" />
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span>{accounts.length} cuentas</span>
                <span>·</span>
                <span>{categoryCount} subcuentas</span>
                <span>·</span>
                <span>{lineCount} partidas</span>
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input id="search-input" type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Buscar... (⌘K)" className="w-48 pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:border-slate-400 focus:ring-1 focus:ring-slate-400 outline-none" />
          </div>

          <div className="w-px h-6 bg-slate-200" />

          {/* View Mode Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button onClick={() => setViewMode("topsheet")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === "topsheet" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Topsheet</button>
            <button onClick={() => setViewMode("detail")} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === "detail" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Detalle</button>
          </div>

          <div className="w-px h-6 bg-slate-200" />

          {/* Globals Toggle */}
          <button onClick={() => setShowGlobalsPanel(p => !p)} className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${showGlobalsPanel ? "bg-amber-100 text-amber-700" : "text-slate-600 hover:bg-slate-100"}`}>
            <Sparkles size={14} />
            Globals
          </button>

          <button onClick={exportToCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"><Download size={14} />Exportar</button>
        </div>

        {/* Summary Bar */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-6 text-xs">
          <div className="flex items-center gap-4">
            {ACCOUNT_TYPES.map(type => {
              const t = getTypeTotals(type.value as BudgetAccount["type"]);
              if (t.total === 0) return null;
              return (
                <div key={type.value} className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${type.color}`} />
                  <span className="text-slate-500">{type.label}:</span>
                  <span className="font-semibold text-slate-700 tabular-nums">{formatCompact(t.total)} €</span>
                </div>
              );
            })}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 text-white rounded-lg">
            <span className="text-slate-400 text-[10px] uppercase">Total</span>
            <span className="font-bold tabular-nums">{formatCurrency(totals.total)} €</span>
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="flex">
        {/* Globals Panel */}
        {showGlobalsPanel && (
          <div className="w-80 bg-white border-r border-slate-200 h-[calc(100vh-8rem)] overflow-hidden flex flex-col flex-shrink-0">
            <div className="p-3 border-b border-slate-100">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button onClick={() => setActiveGlobalsTab("variables")} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeGlobalsTab === "variables" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                  <Variable size={12} className="inline mr-1.5" />Variables
                </button>
                <button onClick={() => setActiveGlobalsTab("fringes")} className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeGlobalsTab === "fringes" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                  <Percent size={12} className="inline mr-1.5" />Fringes
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {activeGlobalsTab === "variables" && (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">Variables globales</span>
                    <button onClick={() => setShowNewVariableModal(true)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Plus size={14} /></button>
                  </div>
                  {variables.length === 0 ? (
                    <div className="text-center py-8">
                      <Variable size={24} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-xs text-slate-400 mb-2">Sin variables</p>
                      <button onClick={() => setShowNewVariableModal(true)} className="text-xs text-amber-600 hover:text-amber-700">Crear variable</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {VARIABLE_CATEGORIES.map(cat => {
                        const catVars = variables.filter(v => v.category === cat.value);
                        if (!catVars.length) return null;
                        const Icon = cat.icon;
                        return (
                          <div key={cat.value}>
                            <div className="flex items-center gap-2 mb-2">
                              <Icon size={12} className="text-slate-400" />
                              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{cat.label}</span>
                            </div>
                            <div className="space-y-1">
                              {catVars.map(v => (
                                <div key={v.id} className="group p-2 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all">
                                  <div className="flex items-center justify-between mb-1">
                                    <code className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{v.code}</code>
                                    <button onClick={() => deleteVariable(v.id)} className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={10} /></button>
                                  </div>
                                  <input type="number" value={v.value} onChange={e => updateVariable(v.id, { value: parseFloat(e.target.value) || 0 })} className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm text-right font-medium focus:border-amber-400 outline-none" />
                                  <p className="text-[10px] text-slate-400 mt-1 truncate">{v.name}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeGlobalsTab === "fringes" && (
                <div className="p-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500">Cargas sociales</span>
                    <button onClick={() => setShowNewFringeModal(true)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg"><Plus size={14} /></button>
                  </div>
                  <div className="space-y-2">
                    {fringes.map(f => (
                      <div key={f.id} className={`group p-2 rounded-lg border transition-all ${f.enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button onClick={() => toggleFringe(f.id)} className={`w-4 h-4 rounded border flex items-center justify-center ${f.enabled ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                              {f.enabled && <Check size={10} className="text-white" />}
                            </button>
                            <code className="text-[10px] font-mono text-slate-500">{f.code}</code>
                          </div>
                          <button onClick={() => deleteFringe(f.id)} className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><X size={10} /></button>
                        </div>
                        <p className="text-xs text-slate-600 mt-1">{f.name}</p>
                        <p className="text-xs text-amber-600 font-medium">{f.rate}{f.type === "percent" ? "%" : "€"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 p-6 overflow-auto h-[calc(100vh-8rem)]" ref={tableRef}>
          {/* TOPSHEET VIEW */}
          {viewMode === "topsheet" && (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Topsheet</h2>
                  <p className="text-sm text-slate-500">Resumen ejecutivo del presupuesto</p>
                </div>
                <button onClick={() => setShowNewAccountModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors">
                  <Plus size={16} />Nueva cuenta
                </button>
              </div>

              {accounts.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                  <div className="w-20 h-20 bg-gradient-to-br from-amber-100 to-orange-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <FileSpreadsheet size={32} className="text-amber-600" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Comienza tu presupuesto</h3>
                  <p className="text-slate-500 mb-6 max-w-md mx-auto">Crea cuentas para estructurar tu presupuesto. Usa la estructura ATL/BTL estándar de la industria.</p>
                  <button onClick={() => setShowNewAccountModal(true)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white font-medium rounded-xl hover:bg-amber-600 transition-colors">
                    <Plus size={16} />Crear primera cuenta
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Código</th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Descripción</th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getTopsheet().map((item, idx) => {
                        const isTotal = !item.code;
                        return (
                          <tr key={idx} className={isTotal ? "bg-slate-100 font-bold border-t-2 border-slate-300" : "border-b border-slate-100 hover:bg-slate-50"}>
                            <td className="px-4 py-3 font-mono text-sm text-slate-500">{item.code}</td>
                            <td className={`px-4 py-3 text-sm ${isTotal ? "text-slate-900" : "text-slate-700"}`}>{item.name}</td>
                            <td className={`px-4 py-3 text-right tabular-nums ${isTotal ? "text-slate-900" : "text-slate-700"}`}>{formatCurrency(item.estimate)} €</td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-900 text-white">
                        <td className="px-4 py-4 font-mono text-sm"></td>
                        <td className="px-4 py-4 text-sm font-bold">TOTAL PRESUPUESTO</td>
                        <td className="px-4 py-4 text-right font-bold text-lg tabular-nums">{formatCurrency(totals.total)} €</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* DETAIL VIEW */}
          {viewMode === "detail" && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Presupuesto detallado</h2>
                  <p className="text-sm text-slate-500">Estructura completa con todas las partidas</p>
                </div>
                <button onClick={() => setShowNewAccountModal(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors">
                  <Plus size={16} />Nueva cuenta
                </button>
              </div>

              {accounts.length === 0 ? (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                  <Layers size={32} className="mx-auto text-slate-300 mb-4" />
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Sin cuentas</h3>
                  <p className="text-slate-500 mb-4">Crea tu primera cuenta para empezar</p>
                  <button onClick={() => setShowNewAccountModal(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl hover:bg-amber-600"><Plus size={16} />Crear cuenta</button>
                </div>
              ) : (
                <div className="space-y-4">
                  {accounts.map(account => {
                    const accTotals = getAccountTotals(account);
                    const isExpanded = expandedAccounts.has(account.id);
                    const typeConfig = ACCOUNT_TYPES.find(t => t.value === account.type);
                    
                    return (
                      <div key={account.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        {/* Account Header */}
                        <div
                          className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                          onClick={() => toggleAccountExpand(account.id)}
                          onContextMenu={e => { e.preventDefault(); setContextMenu({ id: account.id, type: "account", x: e.clientX, y: e.clientY }); }}
                        >
                          <div className="flex items-center gap-3">
                            <button className="p-1 text-slate-400">
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <div className={`w-2 h-8 rounded-full ${typeConfig?.color}`} />
                            <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600">{account.code}</div>
                            <div>
                              <h3 className="font-semibold text-slate-900">{account.name}</h3>
                              <p className="text-xs text-slate-500">{account.categories.length} subcuentas · {account.categories.reduce((s, c) => s + c.lines.length, 0)} partidas</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            {accTotals.fringes > 0 && <span className="text-xs text-slate-400">+{formatCompact(accTotals.fringes)} fringes</span>}
                            <span className="text-lg font-bold text-slate-900 tabular-nums">{formatCurrency(accTotals.total)} €</span>
                          </div>
                        </div>

                        {/* Categories */}
                        {isExpanded && (
                          <div className="border-t border-slate-100">
                            {account.categories.length === 0 ? (
                              <div className="p-6 text-center">
                                <p className="text-sm text-slate-400 mb-2">Sin subcuentas</p>
                                <button onClick={() => { setSelectedAccountId(account.id); setShowNewCategoryModal(true); }} className="text-xs text-amber-600 hover:text-amber-700">+ Añadir subcuenta</button>
                              </div>
                            ) : (
                              account.categories.map(category => {
                                const catTotals = getCategoryTotals(category);
                                return (
                                  <div key={category.id} className="border-b border-slate-50 last:border-b-0">
                                    {/* Category Header */}
                                    <div
                                      className="px-4 py-2 pl-14 flex items-center justify-between bg-slate-50/50 hover:bg-slate-50 cursor-pointer"
                                      onClick={() => { setSelectedAccountId(account.id); setSelectedCategoryId(category.id); }}
                                      onContextMenu={e => { e.preventDefault(); setSelectedAccountId(account.id); setContextMenu({ id: category.id, type: "category", x: e.clientX, y: e.clientY }); }}
                                    >
                                      <div className="flex items-center gap-3">
                                        <span className="text-xs font-mono text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{category.code}</span>
                                        <span className="text-sm font-medium text-slate-700">{category.name}</span>
                                        <span className="text-xs text-slate-400">{category.lines.length} partidas</span>
                                      </div>
                                      <span className="text-sm font-semibold text-slate-700 tabular-nums">{formatCurrency(catTotals.total)} €</span>
                                    </div>

                                    {/* Lines */}
                                    {category.lines.length > 0 && (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-slate-400">
                                            <th className="text-left px-4 py-1.5 pl-14 font-medium w-20">Código</th>
                                            <th className="text-left px-2 py-1.5 font-medium">Descripción</th>
                                            <th className="text-right px-2 py-1.5 font-medium w-16">Uds</th>
                                            <th className="text-center px-2 py-1.5 font-medium w-16">Tipo</th>
                                            <th className="text-right px-2 py-1.5 font-medium w-20">Precio</th>
                                            <th className="text-right px-2 py-1.5 font-medium w-16">Cant</th>
                                            <th className="text-right px-4 py-1.5 font-medium w-24">Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {category.lines.map(line => {
                                            const calc = calculateLineTotal(line);
                                            return (
                                              <tr
                                                key={line.id}
                                                className="border-t border-slate-50 hover:bg-blue-50/30 group"
                                                onContextMenu={e => { e.preventDefault(); setSelectedAccountId(account.id); setSelectedCategoryId(category.id); setContextMenu({ id: line.id, type: "line", x: e.clientX, y: e.clientY }); }}
                                              >
                                                <td className="px-4 py-1.5 pl-14 font-mono text-slate-400">{line.code}</td>
                                                <td className="px-2 py-1.5">
                                                  <input type="text" value={line.description} onChange={e => updateLine(account.id, category.id, line.id, { description: e.target.value })} placeholder="Descripción..." className="w-full bg-transparent outline-none text-slate-700" />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                  <input type="number" value={line.units || ""} onChange={e => updateLine(account.id, category.id, line.id, { units: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums" />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                  <select value={line.unitType} onChange={e => updateLine(account.id, category.id, line.id, { unitType: e.target.value })} className="w-full bg-transparent text-center outline-none text-slate-500 cursor-pointer">
                                                    {UNIT_TYPES.map(ut => <option key={ut.value} value={ut.value}>{ut.short}</option>)}
                                                  </select>
                                                </td>
                                                <td className="px-2 py-1.5">
                                                  <input type="number" value={line.rate || ""} onChange={e => updateLine(account.id, category.id, line.id, { rate: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums" step="0.01" />
                                                </td>
                                                <td className="px-2 py-1.5">
                                                  <input type="number" value={line.quantity || ""} onChange={e => updateLine(account.id, category.id, line.id, { quantity: parseFloat(e.target.value) || 0 })} className="w-full bg-transparent text-right outline-none tabular-nums" />
                                                </td>
                                                <td className="px-4 py-1.5 text-right font-medium tabular-nums text-slate-700">{formatCurrency(calc.total)} €</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}

                                    {/* Add Line */}
                                    <button onClick={() => addLine(account.id, category.id)} className="w-full px-4 py-1.5 pl-14 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 text-left flex items-center gap-1">
                                      <Plus size={12} />Añadir partida
                                    </button>
                                  </div>
                                );
                              })
                            )}
                            
                            {/* Add Category */}
                            <button onClick={() => { setSelectedAccountId(account.id); setShowNewCategoryModal(true); }} className="w-full px-4 py-2 pl-14 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50/50 text-left flex items-center gap-1 border-t border-slate-100">
                              <FolderPlus size={12} />Añadir subcuenta
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════════ */}
      {/* MODALS */}
      {/* ════════════════════════════════════════════════════════════════════════════ */}

      {/* New Variable Modal */}
      {showNewVariableModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewVariableModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva variable global</h3>
              <button onClick={() => setShowNewVariableModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label>
                  <input type="text" value={newVariableForm.name} onChange={e => setNewVariableForm(p => ({ ...p, name: e.target.value }))} placeholder="Días de rodaje" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none" autoFocus />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label>
                  <input type="text" value={newVariableForm.code} onChange={e => setNewVariableForm(p => ({ ...p, code: e.target.value.toUpperCase().replace(/\s/g, "_") }))} placeholder="SHOOT_DAYS" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-amber-400 focus:ring-1 focus:ring-amber-400 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Valor</label>
                  <input type="number" value={newVariableForm.value} onChange={e => setNewVariableForm(p => ({ ...p, value: parseFloat(e.target.value) || 0 }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-amber-400 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Unidad</label>
                  <select value={newVariableForm.unit} onChange={e => setNewVariableForm(p => ({ ...p, unit: e.target.value as GlobalVariable["unit"] }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-amber-400 outline-none">
                    <option value="number">Número</option>
                    <option value="currency">€</option>
                    <option value="days">Días</option>
                    <option value="weeks">Semanas</option>
                    <option value="hours">Horas</option>
                    <option value="percent">%</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Categoría</label>
                  <select value={newVariableForm.category} onChange={e => setNewVariableForm(p => ({ ...p, category: e.target.value as GlobalVariable["category"] }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-amber-400 outline-none">
                    {VARIABLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Descripción (opcional)</label>
                <input type="text" value={newVariableForm.description} onChange={e => setNewVariableForm(p => ({ ...p, description: e.target.value }))} placeholder="Número total de días de rodaje" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-amber-400 outline-none" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewVariableModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={addVariable} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600">Crear variable</button>
            </div>
          </div>
        </div>
      )}

      {/* New Account Modal */}
      {showNewAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewAccountModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva cuenta</h3>
              <button onClick={() => setShowNewAccountModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label>
                <input type="text" value={newAccountForm.code} onChange={e => setNewAccountForm(p => ({ ...p, code: e.target.value }))} placeholder="Ej: 01, 02, 100..." className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 outline-none" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label>
                <input type="text" value={newAccountForm.name} onChange={e => setNewAccountForm(p => ({ ...p, name: e.target.value }))} placeholder="GUIÓN Y DESARROLLO" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Tipo de cuenta</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACCOUNT_TYPES.map(type => (
                    <button key={type.value} onClick={() => setNewAccountForm(p => ({ ...p, type: type.value as BudgetAccount["type"] }))} className={`p-3 rounded-xl border text-left transition-all ${newAccountForm.type === type.value ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${type.color}`} />
                        <span className="text-sm font-medium text-slate-900">{type.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewAccountModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={addAccount} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">Crear cuenta</button>
            </div>
          </div>
        </div>
      )}

      {/* New Category Modal */}
      {showNewCategoryModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewCategoryModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva subcuenta</h3>
              <button onClick={() => setShowNewCategoryModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label><input type="text" value={newCategoryForm.code} onChange={e => setNewCategoryForm(p => ({ ...p, code: e.target.value }))} placeholder={`Ej: ${selectedAccount?.code || ""}-01`} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono focus:border-slate-400 outline-none" autoFocus /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label><input type="text" value={newCategoryForm.name} onChange={e => setNewCategoryForm(p => ({ ...p, name: e.target.value }))} placeholder="Guión original" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:border-slate-400 outline-none" /></div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewCategoryModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={addCategory} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">Crear subcuenta</button>
            </div>
          </div>
        </div>
      )}

      {/* New Fringe Modal */}
      {showNewFringeModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowNewFringeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo fringe</h3>
              <button onClick={() => setShowNewFringeModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Código</label><input type="text" value={newFringeForm.code} onChange={e => setNewFringeForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="SS" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono outline-none" autoFocus /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Nombre</label><input type="text" value={newFringeForm.name} onChange={e => setNewFringeForm(p => ({ ...p, name: e.target.value }))} placeholder="Seg. Social" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Tasa</label><input type="number" value={newFringeForm.rate} onChange={e => setNewFringeForm(p => ({ ...p, rate: parseFloat(e.target.value) || 0 }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl font-mono outline-none" step="0.01" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1.5">Tipo</label><select value={newFringeForm.type} onChange={e => setNewFringeForm(p => ({ ...p, type: e.target.value as Fringe["type"] }))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none"><option value="percent">Porcentaje (%)</option><option value="flat">Cantidad fija (€)</option></select></div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowNewFringeModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium">Cancelar</button>
              <button onClick={addFringe} className="px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600">Crear fringe</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
