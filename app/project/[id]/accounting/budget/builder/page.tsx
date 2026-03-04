"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Download,
  Save,
  Copy,
  ChevronRight,
  ChevronDown,
  Calculator,
  DollarSign,
  Percent,
  Hash,
  Clock,
  Users,
  Calendar,
  Film,
  Clapperboard,
  Settings2,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle,
  X,
  GripVertical,
  FolderPlus,
  FileSpreadsheet,
  Variable,
  Sigma,
  RefreshCw,
  Upload,
  Layers,
  Lock,
  Unlock,
} from "lucide-react";

const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const ibmPlex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface Variable {
  id: string;
  name: string;
  code: string;
  value: number;
  unit: "number" | "currency" | "days" | "weeks" | "percent";
  description?: string;
  locked?: boolean;
}

interface BudgetLine {
  id: string;
  code: string;
  description: string;
  formula: string;
  calculatedValue: number;
  units: number;
  unitType: string;
  rate: number;
  quantity: number;
  notes?: string;
  locked?: boolean;
}

interface BudgetCategory {
  id: string;
  code: string;
  name: string;
  lines: BudgetLine[];
  expanded: boolean;
  locked?: boolean;
}

interface BudgetAccount {
  id: string;
  code: string;
  name: string;
  categories: BudgetCategory[];
  expanded: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT DATA
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_VARIABLES: Variable[] = [
  { id: "v1", name: "Días de rodaje", code: "SHOOT_DAYS", value: 30, unit: "days", description: "Número total de días de rodaje" },
  { id: "v2", name: "Semanas de prep", code: "PREP_WEEKS", value: 6, unit: "weeks", description: "Semanas de preproducción" },
  { id: "v3", name: "Semanas de post", code: "POST_WEEKS", value: 12, unit: "weeks", description: "Semanas de postproducción" },
  { id: "v4", name: "Días por semana", code: "DAYS_WEEK", value: 5, unit: "days", description: "Días laborables por semana" },
  { id: "v5", name: "Horas extra %", code: "OT_RATE", value: 50, unit: "percent", description: "Porcentaje de horas extra estimado" },
  { id: "v6", name: "Contingencia", code: "CONTINGENCY", value: 10, unit: "percent", description: "Porcentaje de contingencia" },
  { id: "v7", name: "Capítulos", code: "EPISODES", value: 1, unit: "number", description: "Número de capítulos" },
];

const UNIT_TYPES = [
  { value: "flat", label: "Fijo" },
  { value: "day", label: "Día" },
  { value: "week", label: "Semana" },
  { value: "hour", label: "Hora" },
  { value: "unit", label: "Unidad" },
  { value: "page", label: "Página" },
  { value: "episode", label: "Capítulo" },
  { value: "allow", label: "Alzado" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function BudgetBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;

  // State
  const [projectName, setProjectName] = useState("Nuevo presupuesto");
  const [variables, setVariables] = useState<Variable[]>(DEFAULT_VARIABLES);
  const [accounts, setAccounts] = useState<BudgetAccount[]>([]);
  const [showVariablesPanel, setShowVariablesPanel] = useState(true);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [showNewVariableModal, setShowNewVariableModal] = useState(false);
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [newVariableForm, setNewVariableForm] = useState({ name: "", code: "", value: 0, unit: "number" as Variable["unit"], description: "" });
  const [newAccountForm, setNewAccountForm] = useState({ code: "", name: "" });
  const [editingCell, setEditingCell] = useState<{ lineId: string; field: string } | null>(null);
  const [draggedLine, setDraggedLine] = useState<string | null>(null);

  // Refs
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Toast helper
  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // FORMULA PARSER
  // ═══════════════════════════════════════════════════════════════════════════════

  const evaluateFormula = useCallback((formula: string, vars: Variable[]): number => {
    if (!formula || formula.trim() === "") return 0;
    
    let expression = formula.toUpperCase();
    
    // Replace variable codes with values
    vars.forEach(v => {
      const regex = new RegExp(`\\b${v.code}\\b`, "gi");
      expression = expression.replace(regex, v.value.toString());
    });
    
    // Only allow safe characters
    if (!/^[\d\s+\-*/().,%]+$/.test(expression)) {
      return 0;
    }
    
    try {
      // Handle percentages
      expression = expression.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
      const result = Function(`"use strict"; return (${expression})`)();
      return typeof result === "number" && !isNaN(result) ? result : 0;
    } catch {
      return 0;
    }
  }, []);

  const calculateLineTotal = useCallback((line: BudgetLine): number => {
    const formulaValue = evaluateFormula(line.formula, variables);
    if (formulaValue > 0) return formulaValue;
    return line.units * line.rate * line.quantity;
  }, [variables, evaluateFormula]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // CALCULATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  const getCategoryTotal = (category: BudgetCategory): number => {
    return category.lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
  };

  const getAccountTotal = (account: BudgetAccount): number => {
    return account.categories.reduce((sum, cat) => sum + getCategoryTotal(cat), 0);
  };

  const getGrandTotal = (): number => {
    return accounts.reduce((sum, acc) => sum + getAccountTotal(acc), 0);
  };

  const getContingency = (): number => {
    const contingencyVar = variables.find(v => v.code === "CONTINGENCY");
    return contingencyVar ? (getGrandTotal() * contingencyVar.value / 100) : 0;
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  const addAccount = () => {
    if (!newAccountForm.code.trim() || !newAccountForm.name.trim()) {
      showToast("error", "Código y nombre son obligatorios");
      return;
    }
    
    const newAccount: BudgetAccount = {
      id: crypto.randomUUID(),
      code: newAccountForm.code.trim(),
      name: newAccountForm.name.trim(),
      categories: [],
      expanded: true,
    };
    
    setAccounts(prev => [...prev, newAccount].sort((a, b) => a.code.localeCompare(b.code)));
    setNewAccountForm({ code: "", name: "" });
    setShowNewAccountModal(false);
    showToast("success", `Cuenta ${newAccount.code} creada`);
  };

  const addCategory = (accountId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      const nextNum = acc.categories.length + 1;
      const newCat: BudgetCategory = {
        id: crypto.randomUUID(),
        code: `${acc.code}.${String(nextNum).padStart(2, "0")}`,
        name: "Nueva subcuenta",
        lines: [],
        expanded: true,
      };
      return { ...acc, categories: [...acc.categories, newCat] };
    }));
  };

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
            code: `${cat.code}.${String(nextNum).padStart(3, "0")}`,
            description: "",
            formula: "",
            calculatedValue: 0,
            units: 1,
            unitType: "flat",
            rate: 0,
            quantity: 1,
          };
          return { ...cat, lines: [...cat.lines, newLine] };
        }),
      };
    }));
  };

  const updateLine = (accountId: string, categoryId: string, lineId: string, field: string, value: any) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          return {
            ...cat,
            lines: cat.lines.map(line => {
              if (line.id !== lineId) return line;
              return { ...line, [field]: value };
            }),
          };
        }),
      };
    }));
  };

  const updateCategory = (accountId: string, categoryId: string, field: string, value: any) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          return { ...cat, [field]: value };
        }),
      };
    }));
  };

  const updateAccount = (accountId: string, field: string, value: any) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return { ...acc, [field]: value };
    }));
  };

  const deleteLine = (accountId: string, categoryId: string, lineId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return {
        ...acc,
        categories: acc.categories.map(cat => {
          if (cat.id !== categoryId) return cat;
          return { ...cat, lines: cat.lines.filter(l => l.id !== lineId) };
        }),
      };
    }));
  };

  const deleteCategory = (accountId: string, categoryId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id !== accountId) return acc;
      return { ...acc, categories: acc.categories.filter(c => c.id !== categoryId) };
    }));
  };

  const deleteAccount = (accountId: string) => {
    setAccounts(prev => prev.filter(a => a.id !== accountId));
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // VARIABLES
  // ═══════════════════════════════════════════════════════════════════════════════

  const addVariable = () => {
    if (!newVariableForm.code.trim() || !newVariableForm.name.trim()) {
      showToast("error", "Código y nombre son obligatorios");
      return;
    }
    
    const exists = variables.some(v => v.code.toUpperCase() === newVariableForm.code.toUpperCase());
    if (exists) {
      showToast("error", "Ya existe una variable con ese código");
      return;
    }
    
    const newVar: Variable = {
      id: crypto.randomUUID(),
      name: newVariableForm.name.trim(),
      code: newVariableForm.code.toUpperCase().replace(/\s/g, "_"),
      value: newVariableForm.value,
      unit: newVariableForm.unit,
      description: newVariableForm.description,
    };
    
    setVariables(prev => [...prev, newVar]);
    setNewVariableForm({ name: "", code: "", value: 0, unit: "number", description: "" });
    setShowNewVariableModal(false);
    showToast("success", `Variable ${newVar.code} creada`);
  };

  const updateVariable = (id: string, value: number) => {
    setVariables(prev => prev.map(v => v.id === id ? { ...v, value } : v));
  };

  const deleteVariable = (id: string) => {
    const v = variables.find(v => v.id === id);
    if (v?.locked) {
      showToast("error", "No se puede eliminar una variable bloqueada");
      return;
    }
    setVariables(prev => prev.filter(v => v.id !== id));
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════════════════════

  const exportToCSV = () => {
    const rows: string[][] = [];
    
    // Header
    rows.push(["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"]);
    
    // Data
    accounts.forEach(acc => {
      // Account row
      rows.push([acc.code, acc.name, "cuenta", ""]);
      
      acc.categories.forEach(cat => {
        // Category row
        rows.push([cat.code, cat.name, "subcuenta", ""]);
        
        cat.lines.forEach(line => {
          const total = calculateLineTotal(line);
          rows.push([line.code, line.description, "partida", total.toFixed(2)]);
        });
      });
    });
    
    // CSV content
    const csvContent = rows.map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    
    // Download
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `presupuesto_${projectName.replace(/\s/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    showToast("success", "Presupuesto exportado");
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // FORMAT HELPERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  };

  const formatCompact = (amount: number): string => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
    return formatCurrency(amount);
  };

  const getUnitLabel = (unit: Variable["unit"]): string => {
    switch (unit) {
      case "days": return "días";
      case "weeks": return "sem";
      case "percent": return "%";
      case "currency": return "€";
      default: return "";
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════════

  const grandTotal = getGrandTotal();
  const contingency = getContingency();
  const finalTotal = grandTotal + contingency;

  return (
    <div className={`min-h-screen bg-[#0a0a0f] text-slate-300 ${jetbrains.className}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded text-sm font-medium shadow-lg border ${
            toast.type === "success" ? "bg-emerald-950 border-emerald-800 text-emerald-400" :
            toast.type === "error" ? "bg-red-950 border-red-800 text-red-400" :
            "bg-blue-950 border-blue-800 text-blue-400"
          }`}>
            {toast.type === "success" ? <CheckCircle size={14} /> : toast.type === "error" ? <AlertTriangle size={14} /> : <Calculator size={14} />}
            {toast.message}
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="fixed top-0 left-0 right-0 h-12 bg-[#12121a] border-b border-slate-800 z-40 flex items-center px-4">
        <div className="flex items-center gap-4 flex-1">
          <Link href={`/project/${projectId}/accounting/budget`} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div className="h-5 w-px bg-slate-800" />
          <div className="flex items-center gap-2">
            <Calculator size={14} className="text-amber-500" />
            <span className={`text-sm font-semibold text-slate-200 ${ibmPlex.className}`}>BUDGET BUILDER</span>
          </div>
          <div className="h-5 w-px bg-slate-800" />
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="bg-transparent text-sm text-slate-400 hover:text-slate-200 focus:text-slate-200 outline-none border-none px-2 py-1 rounded hover:bg-slate-800 focus:bg-slate-800 transition-colors"
            placeholder="Nombre del proyecto"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVariablesPanel(!showVariablesPanel)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              showVariablesPanel ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Variable size={12} />
            Variables
          </button>
          <div className="h-5 w-px bg-slate-800" />
          <button
            onClick={exportToCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
          >
            <Download size={12} />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="pt-12 flex">
        {/* Variables Panel */}
        {showVariablesPanel && (
          <div className="w-64 bg-[#0d0d14] border-r border-slate-800 h-[calc(100vh-3rem)] overflow-y-auto flex-shrink-0">
            <div className="p-3 border-b border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Variables globales</span>
                <button
                  onClick={() => setShowNewVariableModal(true)}
                  className="p-1 text-slate-500 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            
            <div className="p-2 space-y-1">
              {variables.map(v => (
                <div key={v.id} className="group p-2 rounded bg-slate-900/50 hover:bg-slate-800/50 border border-transparent hover:border-slate-700 transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono text-amber-500/80">{v.code}</span>
                    {!v.locked && (
                      <button
                        onClick={() => deleteVariable(v.id)}
                        className="p-0.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={v.value}
                      onChange={(e) => updateVariable(v.id, parseFloat(e.target.value) || 0)}
                      className="flex-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-right font-mono text-slate-200 focus:border-amber-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 w-8">{getUnitLabel(v.unit)}</span>
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1 truncate">{v.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-[calc(100vh-3rem)] overflow-hidden">
          {/* Toolbar */}
          <div className="bg-[#0d0d14] border-b border-slate-800 px-4 py-2 flex items-center gap-3">
            <button
              onClick={() => setShowNewAccountModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded border border-slate-700 transition-colors"
            >
              <FolderPlus size={12} />
              Nueva cuenta
            </button>
            <div className="h-4 w-px bg-slate-800" />
            <div className="flex-1" />
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-mono text-slate-400">{formatCurrency(grandTotal)} €</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-600">Contingencia:</span>
                <span className="font-mono text-amber-500">{formatCurrency(contingency)} €</span>
              </div>
              <div className="h-4 w-px bg-slate-700" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">TOTAL:</span>
                <span className="font-mono text-lg font-bold text-emerald-400">{formatCurrency(finalTotal)} €</span>
              </div>
            </div>
          </div>

          {/* Budget Grid */}
          <div className="flex-1 overflow-auto">
            {accounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-16 h-16 rounded-xl bg-slate-800/50 border border-slate-700 flex items-center justify-center mb-4">
                  <FileSpreadsheet size={24} className="text-slate-600" />
                </div>
                <p className={`text-slate-400 mb-1 ${ibmPlex.className}`}>Sin cuentas presupuestarias</p>
                <p className="text-xs text-slate-600 mb-4">Crea tu primera cuenta para empezar</p>
                <button
                  onClick={() => setShowNewAccountModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm rounded border border-amber-500/30 transition-colors"
                >
                  <FolderPlus size={14} />
                  Nueva cuenta
                </button>
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-[#0d0d14] z-10">
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-3 py-2 text-slate-500 font-medium w-8"></th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium w-24">CÓDIGO</th>
                    <th className="text-left px-3 py-2 text-slate-500 font-medium">DESCRIPCIÓN</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium w-20">UDS</th>
                    <th className="text-center px-3 py-2 text-slate-500 font-medium w-20">TIPO</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium w-24">PRECIO</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium w-16">CANT</th>
                    <th className="text-right px-3 py-2 text-slate-500 font-medium w-28">TOTAL</th>
                    <th className="w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(account => (
                    <React.Fragment key={account.id}>
                      {/* Account Row */}
                      <tr className="bg-slate-800/30 border-b border-slate-800 hover:bg-slate-800/50 group">
                        <td className="px-3 py-2">
                          <button
                            onClick={() => updateAccount(account.id, "expanded", !account.expanded)}
                            className="p-0.5 text-slate-500 hover:text-slate-300"
                          >
                            {account.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-mono font-semibold text-amber-500">{account.code}</span>
                        </td>
                        <td className="px-3 py-2 font-semibold text-slate-200" colSpan={5}>
                          <input
                            type="text"
                            value={account.name}
                            onChange={(e) => updateAccount(account.id, "name", e.target.value)}
                            className="bg-transparent w-full outline-none hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-200">
                          {formatCurrency(getAccountTotal(account))} €
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => addCategory(account.id)}
                              className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-slate-700 rounded"
                              title="Añadir subcuenta"
                            >
                              <Plus size={12} />
                            </button>
                            <button
                              onClick={() => deleteAccount(account.id)}
                              className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded"
                              title="Eliminar cuenta"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      
                      {/* Categories */}
                      {account.expanded && account.categories.map(category => (
                        <React.Fragment key={category.id}>
                          {/* Category Row */}
                          <tr className="bg-slate-900/30 border-b border-slate-800/50 hover:bg-slate-800/30 group">
                            <td className="px-3 py-1.5 pl-6">
                              <button
                                onClick={() => updateCategory(account.id, category.id, "expanded", !category.expanded)}
                                className="p-0.5 text-slate-600 hover:text-slate-400"
                              >
                                {category.expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                              </button>
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="font-mono text-slate-400">{category.code}</span>
                            </td>
                            <td className="px-3 py-1.5 text-slate-300" colSpan={5}>
                              <input
                                type="text"
                                value={category.name}
                                onChange={(e) => updateCategory(account.id, category.id, "name", e.target.value)}
                                className="bg-transparent w-full outline-none hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded text-sm"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono text-slate-400">
                              {formatCurrency(getCategoryTotal(category))} €
                            </td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => addLine(account.id, category.id)}
                                  className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-slate-700 rounded"
                                  title="Añadir partida"
                                >
                                  <Plus size={10} />
                                </button>
                                <button
                                  onClick={() => deleteCategory(account.id, category.id)}
                                  className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-700 rounded"
                                  title="Eliminar subcuenta"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          
                          {/* Lines */}
                          {category.expanded && category.lines.map(line => {
                            const lineTotal = calculateLineTotal(line);
                            return (
                              <tr 
                                key={line.id} 
                                className={`border-b border-slate-800/30 hover:bg-slate-800/20 group ${selectedLine === line.id ? "bg-amber-500/5" : ""}`}
                                onClick={() => setSelectedLine(line.id)}
                              >
                                <td className="px-3 py-1 pl-10">
                                  <GripVertical size={10} className="text-slate-700 opacity-0 group-hover:opacity-100 cursor-grab" />
                                </td>
                                <td className="px-3 py-1">
                                  <span className="font-mono text-slate-500 text-[10px]">{line.code}</span>
                                </td>
                                <td className="px-3 py-1">
                                  <input
                                    type="text"
                                    value={line.description}
                                    onChange={(e) => updateLine(account.id, category.id, line.id, "description", e.target.value)}
                                    placeholder="Descripción..."
                                    className="bg-transparent w-full outline-none text-slate-300 placeholder-slate-600 hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded"
                                  />
                                </td>
                                <td className="px-3 py-1">
                                  <input
                                    type="number"
                                    value={line.units || ""}
                                    onChange={(e) => updateLine(account.id, category.id, line.id, "units", parseFloat(e.target.value) || 0)}
                                    className="bg-transparent w-full text-right outline-none text-slate-300 hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded font-mono"
                                  />
                                </td>
                                <td className="px-3 py-1">
                                  <select
                                    value={line.unitType}
                                    onChange={(e) => updateLine(account.id, category.id, line.id, "unitType", e.target.value)}
                                    className="bg-slate-800 text-slate-300 text-center w-full outline-none rounded px-1 py-0.5 border border-slate-700 focus:border-amber-500"
                                  >
                                    {UNIT_TYPES.map(ut => (
                                      <option key={ut.value} value={ut.value}>{ut.label}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-1">
                                  <input
                                    type="number"
                                    value={line.rate || ""}
                                    onChange={(e) => updateLine(account.id, category.id, line.id, "rate", parseFloat(e.target.value) || 0)}
                                    className="bg-transparent w-full text-right outline-none text-slate-300 hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded font-mono"
                                    step="0.01"
                                  />
                                </td>
                                <td className="px-3 py-1">
                                  <input
                                    type="number"
                                    value={line.quantity || ""}
                                    onChange={(e) => updateLine(account.id, category.id, line.id, "quantity", parseFloat(e.target.value) || 0)}
                                    className="bg-transparent w-full text-right outline-none text-slate-300 hover:bg-slate-800 focus:bg-slate-800 px-1 py-0.5 rounded font-mono"
                                  />
                                </td>
                                <td className="px-3 py-1 text-right">
                                  <span className={`font-mono ${lineTotal > 0 ? "text-emerald-400" : "text-slate-600"}`}>
                                    {formatCurrency(lineTotal)} €
                                  </span>
                                </td>
                                <td className="px-3 py-1">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); deleteLine(account.id, category.id, line.id); }}
                                    className="p-1 text-slate-600 hover:text-red-400 hover:bg-slate-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          
                          {/* Add Line Button */}
                          {category.expanded && (
                            <tr className="border-b border-slate-800/30">
                              <td colSpan={9} className="px-3 py-1 pl-10">
                                <button
                                  onClick={() => addLine(account.id, category.id)}
                                  className="flex items-center gap-1 text-slate-600 hover:text-amber-400 text-[10px] transition-colors"
                                >
                                  <Plus size={10} />
                                  Añadir partida
                                </button>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Summary */}
          <div className="bg-[#0d0d14] border-t border-slate-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6 text-xs">
                <div className="flex items-center gap-2">
                  <Layers size={12} className="text-slate-600" />
                  <span className="text-slate-500">{accounts.length} cuentas</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{accounts.reduce((sum, a) => sum + a.categories.length, 0)} subcuentas</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{accounts.reduce((sum, a) => sum + a.categories.reduce((s, c) => s + c.lines.length, 0), 0)} partidas</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className={`text-right ${ibmPlex.className}`}>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider">Total presupuesto</p>
                  <p className="text-xl font-bold text-emerald-400 tabular-nums">{formatCurrency(finalTotal)} €</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* New Variable Modal */}
      {showNewVariableModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNewVariableModal(false)}>
          <div className="bg-[#12121a] border border-slate-800 rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className={`text-sm font-semibold text-slate-200 ${ibmPlex.className}`}>Nueva variable</h3>
              <button onClick={() => setShowNewVariableModal(false)} className="p-1 text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Nombre</label>
                <input
                  type="text"
                  value={newVariableForm.name}
                  onChange={(e) => setNewVariableForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: Días de rodaje"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Código</label>
                <input
                  type="text"
                  value={newVariableForm.code}
                  onChange={(e) => setNewVariableForm(prev => ({ ...prev, code: e.target.value.toUpperCase().replace(/\s/g, "_") }))}
                  placeholder="Ej: SHOOT_DAYS"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-amber-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Valor</label>
                  <input
                    type="number"
                    value={newVariableForm.value}
                    onChange={(e) => setNewVariableForm(prev => ({ ...prev, value: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-amber-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Unidad</label>
                  <select
                    value={newVariableForm.unit}
                    onChange={(e) => setNewVariableForm(prev => ({ ...prev, unit: e.target.value as Variable["unit"] }))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-amber-500 outline-none"
                  >
                    <option value="number">Número</option>
                    <option value="currency">Moneda (€)</option>
                    <option value="days">Días</option>
                    <option value="weeks">Semanas</option>
                    <option value="percent">Porcentaje (%)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Descripción (opcional)</label>
                <input
                  type="text"
                  value={newVariableForm.description}
                  onChange={(e) => setNewVariableForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descripción de la variable"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-300 focus:border-amber-500 outline-none"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowNewVariableModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={addVariable}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded transition-colors"
              >
                Crear variable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Account Modal */}
      {showNewAccountModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNewAccountModal(false)}>
          <div className="bg-[#12121a] border border-slate-800 rounded-lg w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className={`text-sm font-semibold text-slate-200 ${ibmPlex.className}`}>Nueva cuenta</h3>
              <button onClick={() => setShowNewAccountModal(false)} className="p-1 text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Código</label>
                <input
                  type="text"
                  value={newAccountForm.code}
                  onChange={(e) => setNewAccountForm(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="Ej: 01, 02, 03..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 font-mono focus:border-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 uppercase tracking-wider mb-1">Nombre</label>
                <input
                  type="text"
                  value={newAccountForm.name}
                  onChange={(e) => setNewAccountForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: GUIÓN Y DESARROLLO"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:border-amber-500 outline-none"
                />
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowNewAccountModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={addAccount}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded transition-colors"
              >
                Crear cuenta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
