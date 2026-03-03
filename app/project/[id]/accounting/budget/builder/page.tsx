"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import {
  doc, getDoc, collection, getDocs, query, orderBy,
  writeBatch, updateDoc,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, ChevronRight, X, Eye, EyeOff, Calculator,
  AlertCircle, CheckCircle, FileSpreadsheet, Save, Upload,
  Loader2, ShieldAlert, StickyNote, Tag, Trash2, Variable, Hash,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
type Unit = "day" | "week" | "month" | "flat" | "unit" | "hour";
type SaveState = "idle" | "saving" | "saved" | "error";
type View = "topsheet" | "account" | "subaccount";
type LineCategory = "personal" | "equipment" | "travel" | "services" | "post" | "other";

interface Global { key: string; value: number; label: string; }

interface DetailLine {
  id: string;
  description: string;
  quantityExpr: string;
  periodsExpr: string;
  rateExpr: string;
  quantity: number;
  periods: number;
  rate: number;
  unit: Unit;
  total: number;
  note: string;
  category: LineCategory;
}

interface SubAccount {
  id: string; code: string; description: string;
  budgeted: number; lines: DetailLine[];
}

interface Account {
  id: string; code: string; description: string; subAccounts: SubAccount[];
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const UNIT_LABELS: Record<Unit, string> = {
  day: "día", week: "sem", month: "mes", flat: "pack", unit: "ud", hour: "h",
};
const UNIT_OPTIONS: Unit[] = ["day", "week", "month", "flat", "unit", "hour"];

const CATEGORY_CONFIG: Record<LineCategory, { label: string; color: string; bg: string; border: string; dot: string }> = {
  personal:  { label: "Personal",  color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-300",   dot: "bg-blue-400" },
  equipment: { label: "Equipo",    color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-300", dot: "bg-violet-400" },
  travel:    { label: "Viajes",    color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-300",  dot: "bg-amber-400" },
  services:  { label: "Servicios", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-300",dot: "bg-emerald-400" },
  post:      { label: "Post",      color: "text-rose-700",    bg: "bg-rose-50",    border: "border-rose-300",   dot: "bg-rose-400" },
  other:     { label: "Otro",      color: "text-slate-600",   bg: "bg-slate-100",  border: "border-slate-300",  dot: "bg-slate-400" },
};

const DEFAULT_GLOBALS: Global[] = [
  { key: "semanas_rodaje", value: 6,  label: "Semanas de rodaje" },
  { key: "dias_rodaje",    value: 30, label: "Días de rodaje" },
  { key: "semanas_prep",   value: 4,  label: "Semanas de preparación" },
  { key: "semanas_post",   value: 8,  label: "Semanas de postproducción" },
];

// ─────────────────────────────────────────────
// FORMULA EVALUATOR
// ─────────────────────────────────────────────
function evaluateExpr(expr: string, globals: Global[]): number {
  if (!expr || expr.trim() === "") return 0;
  let str = expr.trim();
  const sorted = [...globals].sort((a, b) => b.key.length - a.key.length);
  for (const g of sorted) str = str.replace(new RegExp(`\\b${g.key}\\b`, "g"), String(g.value));
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(str)) return parseFloat(str) || 0;
  try { return new Function(`"use strict"; return (${str})`)() || 0; } catch { return 0; }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const calcTotal = (q: number, p: number, r: number) => q * p * r;
const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const getAccountTotal = (a: Account) => a.subAccounts.reduce((s, s2) => s + s2.budgeted, 0);
const getGrandTotal = (accounts: Account[]) => accounts.reduce((s, a) => s + getAccountTotal(a), 0);
const pct = (part: number, total: number) => (!total ? 0 : Math.round((part / total) * 100));

// ─────────────────────────────────────────────
// FORMULA CELL
// ─────────────────────────────────────────────
function FormulaCell({ expr, evaluated, onChange, placeholder = "0" }: {
  expr: string; evaluated: number; onChange: (v: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(expr);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { ref.current?.select(); setRaw(expr); }
  }, [editing]);

  const commit = () => { onChange(raw); setEditing(false); };

  if (editing) return (
    <input ref={ref} value={raw} onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(); }
        if (e.key === "Escape") setEditing(false);
      }}
      placeholder={placeholder}
      className="w-full text-right bg-blue-50 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );

  const hasFormula = expr && isNaN(Number(expr)) && expr.trim() !== "";
  return (
    <div
      onClick={() => setEditing(true)}
      className="text-right px-1 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs font-mono select-none w-full group relative"
    >
      {hasFormula && (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] text-blue-400 opacity-0 group-hover:opacity-100">ƒ</span>
      )}
      {evaluated === 0
        ? <span className="text-slate-300">{placeholder}</span>
        : fmt(evaluated)}
    </div>
  );
}

// ─────────────────────────────────────────────
// EDITABLE TEXT
// ─────────────────────────────────────────────
function EditableText({ value, onChange, placeholder = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => { onChange(raw); setEditing(false); };

  if (editing) return (
    <input ref={ref} value={raw} onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setRaw(value); setEditing(false); }
      }}
      placeholder={placeholder}
      className="w-full bg-blue-50 border border-blue-400 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );

  return (
    <div
      onClick={() => { setRaw(value); setEditing(true); }}
      className={`px-1.5 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs truncate ${value ? "text-slate-800" : "text-slate-300"}`}
    >
      {value || placeholder}
    </div>
  );
}

// ─────────────────────────────────────────────
// UNIT SELECTOR
// ─────────────────────────────────────────────
function UnitSelector({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 transition-colors"
      >
        {UNIT_LABELS[value]}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[80px]">
          {UNIT_OPTIONS.map((u) => (
            <button key={u} onClick={() => { onChange(u); setOpen(false); }}
              className={`w-full text-left px-3 py-1 text-xs hover:bg-slate-50 ${value === u ? "font-semibold text-blue-600" : "text-slate-700"}`}>
              {UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// GLOBALS PANEL
// ─────────────────────────────────────────────
function GlobalsPanel({ globals, onChange, onClose }: {
  globals: Global[];
  onChange: (g: Global[]) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Global[]>(globals);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const update = (idx: number, field: keyof Global, val: string) => {
    const next = local.map((g, i) =>
      i !== idx ? g : { ...g, [field]: field === "value" ? parseFloat(val) || 0 : val }
    );
    setLocal(next);
    onChange(next);
  };

  const add = () => {
    const next = [...local, { key: `var_${Date.now()}`, value: 0, label: "Nueva variable" }];
    setLocal(next);
    onChange(next);
  };

  const remove = (idx: number) => {
    const next = local.filter((_, i) => i !== idx);
    setLocal(next);
    onChange(next);
  };

  return (
    <div ref={ref} className="w-80 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <Variable size={14} className="text-blue-600" />
          <span className="text-xs font-semibold text-slate-700">Variables globales</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
          <X size={13} className="text-slate-400" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-2 max-h-72 overflow-y-auto">
        {local.map((g, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <div className="flex-1 min-w-0">
              <input
                value={g.label}
                onChange={(e) => update(i, "label", e.target.value)}
                className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none px-0.5 py-0.5 mb-0.5 transition-colors"
                placeholder="Etiqueta"
              />
              <div className="flex items-center gap-1">
                <code className="text-[10px] text-blue-500 font-mono bg-blue-50 px-1 rounded truncate max-w-[100px]">{g.key}</code>
                <span className="text-[10px] text-slate-300">=</span>
                <input
                  type="number"
                  value={g.value}
                  onChange={(e) => update(i, "value", e.target.value)}
                  className="w-16 text-xs font-mono font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none px-0.5 py-0.5 text-right transition-colors"
                />
              </div>
            </div>
            <button
              onClick={() => remove(i)}
              className="p-1 text-slate-200 hover:text-red-400 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
        <button
          onClick={add}
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
        >
          <Plus size={11} /> Añadir variable
        </button>
      </div>

      <div className="px-4 py-2 border-t border-slate-100">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Usa estas variables en las fórmulas de cantidad, periodos o tarifa.<br />
          Ej: <code className="bg-slate-100 px-1 rounded text-blue-500">semanas_rodaje * 800</code>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LINE SIDEBAR
// ─────────────────────────────────────────────
function LineSidebar({ line, onUpdate, onClose }: {
  line: DetailLine;
  onUpdate: (patch: Partial<DetailLine>) => void;
  onClose: () => void;
}) {
  const catCfg = CATEGORY_CONFIG[line.category];

  return (
    <div className="h-full bg-white border-l border-slate-200 flex flex-col shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full ${catCfg.dot} flex-shrink-0`} />
          <span className="text-xs font-semibold text-slate-700 truncate">Detalle de línea</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg transition-colors flex-shrink-0">
          <X size={13} className="text-slate-400" />
        </button>
      </div>

      {/* Total highlight */}
      <div className="px-4 py-4 border-b border-slate-100 bg-slate-50 flex-shrink-0">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Total calculado</p>
        <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{fmt(line.total)} €</p>
        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
          {fmt(line.quantity)} × {fmt(line.periods)} × {fmt(line.rate)} €/{UNIT_LABELS[line.unit]}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* Description */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Descripción</label>
          <textarea
            value={line.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Descripción del concepto..."
            rows={2}
            className="w-full text-xs text-slate-800 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Category */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Categoría</label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.entries(CATEGORY_CONFIG) as [LineCategory, typeof CATEGORY_CONFIG[LineCategory]][]).map(([cat, cfg]) => (
              <button
                key={cat}
                onClick={() => onUpdate({ category: cat })}
                className={`px-2 py-1.5 text-[10px] font-medium rounded-lg border transition-all ${
                  line.category === cat
                    ? `${cfg.bg} ${cfg.border} ${cfg.color} border`
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Formula fields */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-2">Fórmulas</label>
          <div className="space-y-2">
            {[
              { label: "Cantidad", exprKey: "quantityExpr" as const, valKey: "quantity" as const },
              { label: "Períodos", exprKey: "periodsExpr"  as const, valKey: "periods"  as const },
              { label: "Tarifa",   exprKey: "rateExpr"     as const, valKey: "rate"     as const },
            ].map(({ label, exprKey, valKey }) => (
              <div key={exprKey} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-14 flex-shrink-0">{label}</span>
                <div className="flex-1 border border-slate-200 rounded-lg overflow-hidden">
                  <FormulaCell
                    expr={line[exprKey]}
                    evaluated={line[valKey]}
                    onChange={(v) => onUpdate({ [exprKey]: v } as Partial<DetailLine>)}
                    placeholder="0"
                  />
                </div>
                <span className="text-[10px] text-slate-400 font-mono w-12 text-right">{fmt(line[valKey])}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unit */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Unidad</label>
          <div className="flex gap-1 flex-wrap">
            {UNIT_OPTIONS.map((u) => (
              <button
                key={u}
                onClick={() => onUpdate({ unit: u })}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-all ${
                  line.unit === u
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {UNIT_LABELS[u]}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
            <StickyNote size={10} /> Notas
          </label>
          <textarea
            value={line.note}
            onChange={(e) => onUpdate({ note: e.target.value })}
            placeholder="Añade notas o referencias..."
            rows={3}
            className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300"
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PUBLISH MODAL
// ─────────────────────────────────────────────
function PublishModal({ accounts, onConfirm, onCancel, publishing }: {
  accounts: Account[];
  onConfirm: () => void;
  onCancel: () => void;
  publishing: boolean;
}) {
  const grandTotal = getGrandTotal(accounts);
  const totalLines = accounts.reduce((s, a) => s + a.subAccounts.reduce((s2, sub) => s2 + sub.lines.length, 0), 0);
  const totalSubs  = accounts.reduce((s, a) => s + a.subAccounts.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#EEF1FD" }}>
              <Upload size={18} style={{ color: "#2F52E0" }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Publicar presupuesto</h3>
              <p className="text-xs text-slate-500">Los importes presupuestados se actualizarán en el sistema</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Cuentas",     value: accounts.length },
              { label: "Subcuentas",  value: totalSubs },
              { label: "Líneas",      value: totalLines },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-50 rounded-xl px-3 py-3 text-center">
                <p className="text-xl font-bold text-slate-900 tabular-nums">{value}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium opacity-70">Total presupuestado</span>
            <span className="text-lg font-bold font-mono tabular-nums">{fmt(grandTotal)} €</span>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              Esto sobreescribirá el campo <strong>budgeted</strong> en todas las subcuentas con los totales calculados del constructor.
            </p>
          </div>
        </div>

        <div className="px-6 pb-5 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={publishing}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={publishing}
            className="px-5 py-2 text-sm font-semibold text-white rounded-xl flex items-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: "#2F52E0" }}
          >
            {publishing
              ? <><Loader2 size={14} className="animate-spin" /> Publicando...</>
              : <><Upload size={14} /> Publicar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function BudgetBuilderPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading]             = useState(true);
  const [hasAccess, setHasAccess]         = useState(false);
  const [projectName, setProjectName]     = useState("");
  const [userId, setUserId]               = useState<string | null>(null);
  const [accounts, setAccounts]           = useState<Account[]>([]);
  const [globals, setGlobals]             = useState<Global[]>(DEFAULT_GLOBALS);
  const [view, setView]                   = useState<View>("topsheet");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeSubId, setActiveSubId]         = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId]   = useState<string | null>(null);
  const [showGlobals, setShowGlobals]         = useState(false);
  const [dirtySubIds, setDirtySubIds]     = useState<Set<string>>(new Set());
  const [saveState, setSaveState]         = useState<SaveState>("idle");
  const [showPublish, setShowPublish]     = useState(false);
  const [publishing, setPublishing]       = useState(false);
  const [successMsg, setSuccessMsg]       = useState("");
  const [errorMsg, setErrorMsg]           = useState("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const activeSub     = activeAccount?.subAccounts.find((s) => s.id === activeSubId) ?? null;
  const activeLine    = activeSub?.lines.find((l) => l.id === selectedLineId) ?? null;
  const grandTotal    = getGrandTotal(accounts);

  // ── Auth ──
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { if (u) setUserId(u.uid); });
    return () => unsub();
  }, []);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);

  // ── Auto-save ──
  useEffect(() => {
    if (dirtySubIds.size === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveBuilderLines(dirtySubIds), 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [dirtySubIds, accounts]);

  // ── Load ──
  const loadData = async () => {
    try {
      setLoading(true);
      const upSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
      if (!upSnap.exists()) { setLoading(false); return; }
      const upData = upSnap.data();
      const memberSnap = await getDoc(doc(db, `projects/${id}/members`, userId!));
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM   = memberData && ["EP", "PM"].includes(memberData.role);
      const isExtended = upData.accountingAccessLevel === "accounting_extended";
      if (!upData.permissions?.accounting || (!isEPorPM && !isExtended)) { setLoading(false); return; }
      setHasAccess(true);
      const projSnap = await getDoc(doc(db, "projects", id));
      if (projSnap.exists()) {
        setProjectName(projSnap.data().name || "Proyecto");
        if (projSnap.data().builderGlobals) setGlobals(projSnap.data().builderGlobals);
      }
      const aSnap = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const loaded: Account[] = await Promise.all(
        aSnap.docs.map(async (aDoc) => {
          const sSnap = await getDocs(
            query(collection(db, `projects/${id}/accounts/${aDoc.id}/subaccounts`), orderBy("code", "asc"))
          );
          const subs: SubAccount[] = sSnap.docs.map((sDoc) => {
            const sd = sDoc.data();
            const rawLines: any[] = sd.builderLines || [];
            const lines: DetailLine[] = rawLines.map((l: any) => {
              const q = evaluateExpr(l.quantityExpr ?? String(l.quantity ?? 1), DEFAULT_GLOBALS);
              const p = evaluateExpr(l.periodsExpr  ?? String(l.periods  ?? 1), DEFAULT_GLOBALS);
              const r = evaluateExpr(l.rateExpr     ?? String(l.rate     ?? 0), DEFAULT_GLOBALS);
              return {
                id: l.id || crypto.randomUUID(),
                description: l.description || "",
                quantityExpr: l.quantityExpr ?? String(l.quantity ?? 1),
                periodsExpr:  l.periodsExpr  ?? String(l.periods  ?? 1),
                rateExpr:     l.rateExpr     ?? String(l.rate     ?? 0),
                quantity: q, periods: p, rate: r,
                unit: (l.unit as Unit) || "day",
                total: calcTotal(q, p, r),
                note: l.note || "",
                category: (l.category as LineCategory) || "other",
              };
            });
            const budgeted = lines.length > 0
              ? lines.reduce((s, l) => s + l.total, 0)
              : (sd.budgeted || 0);
            return { id: sDoc.id, code: sd.code || "", description: sd.description || "", budgeted, lines };
          });
          return {
            id: aDoc.id,
            code: aDoc.data().code || "",
            description: aDoc.data().description || "",
            subAccounts: subs,
          };
        })
      );
      setAccounts(loaded);
    } catch (err: any) {
      setErrorMsg(`Error al cargar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Re-evaluate all on globals change ──
  const reEvalAll = useCallback((currentAccounts: Account[], currentGlobals: Global[]) =>
    currentAccounts.map((a) => ({
      ...a,
      subAccounts: a.subAccounts.map((s) => {
        const lines = s.lines.map((l) => {
          const q = evaluateExpr(l.quantityExpr, currentGlobals);
          const p = evaluateExpr(l.periodsExpr,  currentGlobals);
          const r = evaluateExpr(l.rateExpr,     currentGlobals);
          return { ...l, quantity: q, periods: p, rate: r, total: calcTotal(q, p, r) };
        });
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    })), []);

  const handleGlobalsChange = (newGlobals: Global[]) => {
    setGlobals(newGlobals);
    setAccounts((prev) => reEvalAll(prev, newGlobals));
    updateDoc(doc(db, "projects", id), { builderGlobals: newGlobals }).catch(() => {});
  };

  // ── Save ──
  const saveBuilderLines = useCallback(async (subIds: Set<string>) => {
    if (subIds.size === 0) return;
    setSaveState("saving");
    try {
      const batch = writeBatch(db);
      for (const subId of subIds) {
        let foundAccountId = "";
        let foundSub: SubAccount | undefined;
        for (const account of accounts) {
          const sub = account.subAccounts.find((s) => s.id === subId);
          if (sub) { foundAccountId = account.id; foundSub = sub; break; }
        }
        if (!foundAccountId || !foundSub) continue;
        batch.update(
          doc(db, `projects/${id}/accounts/${foundAccountId}/subaccounts`, subId),
          {
            builderLines: foundSub.lines.map((l) => ({
              id: l.id, description: l.description,
              quantityExpr: l.quantityExpr, periodsExpr: l.periodsExpr, rateExpr: l.rateExpr,
              quantity: l.quantity, periods: l.periods, rate: l.rate,
              unit: l.unit, total: l.total, note: l.note, category: l.category,
            })),
          }
        );
      }
      await batch.commit();
      setDirtySubIds(new Set());
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err: any) {
      setSaveState("error");
      setErrorMsg(`Error al guardar: ${err.message}`);
    }
  }, [accounts, id]);

  // ── Publish ──
  const handlePublish = async () => {
    setPublishing(true);
    try {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const batch = writeBatch(db);
      for (const account of accounts) {
        for (const sub of account.subAccounts) {
          batch.update(
            doc(db, `projects/${id}/accounts/${account.id}/subaccounts`, sub.id),
            {
              budgeted: sub.budgeted,
              builderLines: sub.lines.map((l) => ({
                id: l.id, description: l.description,
                quantityExpr: l.quantityExpr, periodsExpr: l.periodsExpr, rateExpr: l.rateExpr,
                quantity: l.quantity, periods: l.periods, rate: l.rate,
                unit: l.unit, total: l.total, note: l.note, category: l.category,
              })),
            }
          );
        }
      }
      await batch.commit();
      setDirtySubIds(new Set());
      setSaveState("saved");
      setShowPublish(false);
      setSuccessMsg("Presupuesto publicado");
      setTimeout(() => { setSaveState("idle"); setSuccessMsg(""); }, 3000);
    } catch (err: any) {
      setErrorMsg(`Error al publicar: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  // ── Line mutations ──
  const markDirty = (subId: string) => {
    setDirtySubIds((p) => new Set([...p, subId]));
    setSaveState("idle");
  };

  const addLine = (subId: string) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    const newLine: DetailLine = {
      id: crypto.randomUUID(), description: "",
      quantityExpr: "1", periodsExpr: "1", rateExpr: "0",
      quantity: 1, periods: 1, rate: 0,
      unit: "day", total: 0, note: "", category: "other",
    };
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a,
      subAccounts: a.subAccounts.map((s) => s.id !== subId ? s : { ...s, lines: [...s.lines, newLine] }),
    }));
    markDirty(subId);
    setTimeout(() => setSelectedLineId(newLine.id), 50);
  };

  const updateLine = (subId: string, lineId: string, patch: Partial<DetailLine>) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a,
      subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subId) return s;
        const lines = s.lines.map((l) => {
          if (l.id !== lineId) return l;
          const u = { ...l, ...patch };
          if (patch.quantityExpr !== undefined) u.quantity = evaluateExpr(u.quantityExpr, globals);
          if (patch.periodsExpr  !== undefined) u.periods  = evaluateExpr(u.periodsExpr,  globals);
          if (patch.rateExpr     !== undefined) u.rate     = evaluateExpr(u.rateExpr,     globals);
          u.total = calcTotal(u.quantity, u.periods, u.rate);
          return u;
        });
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    markDirty(subId);
  };

  const deleteLine = (subId: string, lineId: string) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a,
      subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subId) return s;
        const lines = s.lines.filter((l) => l.id !== lineId);
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    if (selectedLineId === lineId) setSelectedLineId(null);
    markDirty(subId);
  };

  // ── Navigation ──
  const goToAccount = (accountId: string) => {
    setActiveAccountId(accountId); setActiveSubId(null); setSelectedLineId(null); setView("account");
  };
  const goToSubaccount = (subId: string) => {
    setActiveSubId(subId); setSelectedLineId(null); setView("subaccount");
  };
  const goBack = () => {
    if (view === "subaccount") { setView("account"); setActiveSubId(null); setSelectedLineId(null); }
    else if (view === "account") { setView("topsheet"); setActiveAccountId(null); }
  };

  // ── Toasts ──
  const Toasts = (
    <>
      {successMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle size={16} />{successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />{errorMsg}
          <button onClick={() => setErrorMsg("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );

  // ── Loading / Access ──
  if (loading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasAccess) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="text-center">
        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ShieldAlert size={24} className="text-red-500" />
        </div>
        <p className="text-slate-700 font-medium mb-1">Acceso denegado</p>
        <p className="text-slate-400 text-sm mb-4">No tienes permisos para el constructor.</p>
        <Link href={`/project/${id}/accounting/budget`} className="text-blue-600 hover:underline text-sm">← Volver</Link>
      </div>
    </div>
  );

  // ── Header ──
  const Header = (
    <div className="mt-[4.5rem] border-b border-slate-200 bg-white sticky top-[4.5rem] z-20 shadow-sm">
      <div className="px-6 md:px-10 xl:px-16 py-3 flex items-center justify-between gap-4">
        {/* Left: breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          {view === "topsheet"
            ? <Link href={`/project/${id}/accounting/budget`} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg flex-shrink-0"><ArrowLeft size={18} /></Link>
            : <button onClick={goBack} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg flex-shrink-0"><ArrowLeft size={18} /></button>
          }
          <div className="flex items-center gap-1.5 text-sm min-w-0 flex-wrap">
            <Calculator size={16} style={{ color: "#2F52E0" }} className="flex-shrink-0" />
            <button
              onClick={() => { setView("topsheet"); setActiveAccountId(null); setActiveSubId(null); }}
              className={`font-medium transition-colors ${view === "topsheet" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"}`}
            >
              Constructor
            </button>
            {activeAccount && (
              <>
                <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                <button
                  onClick={() => { setView("account"); setActiveSubId(null); }}
                  className={`transition-colors truncate max-w-[160px] ${view === "account" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"}`}
                >
                  {activeAccount.code} · {activeAccount.description}
                </button>
              </>
            )}
            {activeSub && (
              <>
                <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                <span className="text-slate-900 font-semibold truncate max-w-[160px]">{activeSub.code} · {activeSub.description}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Save indicator */}
          <div className={`flex items-center gap-1.5 text-xs transition-opacity duration-300 ${saveState === "idle" ? "opacity-0" : "opacity-100"}`}>
            {saveState === "saving" && <><Loader2 size={12} className="animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
            {saveState === "saved"  && <><CheckCircle size={12} className="text-emerald-500" /><span className="text-emerald-600">Guardado</span></>}
            {saveState === "error"  && <><AlertCircle size={12} className="text-red-500" /><span className="text-red-600">Error</span></>}
          </div>

          {/* Globals */}
          <div className="relative">
            <button
              onClick={() => setShowGlobals(!showGlobals)}
              className={`px-2.5 py-1.5 text-xs border rounded-lg flex items-center gap-1.5 transition-colors ${showGlobals ? "bg-blue-50 border-blue-300 text-blue-700" : "text-slate-600 border-slate-200 hover:bg-slate-50"}`}
            >
              <Variable size={13} /> Variables
            </button>
            {showGlobals && (
              <div className="absolute top-full right-0 mt-2 z-50">
                <GlobalsPanel globals={globals} onChange={handleGlobalsChange} onClose={() => setShowGlobals(false)} />
              </div>
            )}
          </div>

          {/* Manual save */}
          <button
            onClick={() => saveBuilderLines(dirtySubIds)}
            disabled={dirtySubIds.size === 0 || saveState === "saving"}
            className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save size={13} />
            {dirtySubIds.size > 0 ? `Guardar (${dirtySubIds.size})` : "Guardado"}
          </button>

          {/* Publish */}
          <button
            onClick={() => setShowPublish(true)}
            className="px-4 py-1.5 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:opacity-90"
            style={{ backgroundColor: "#2F52E0" }}
          >
            <Upload size={13} /> Publicar
          </button>

          {/* Grand total */}
          <div className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-mono font-bold tabular-nums ml-1">
            {fmt(grandTotal)} €
          </div>
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // VIEW: TOPSHEET
  // ─────────────────────────────────────────────
  if (view === "topsheet") return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {Header}
      <div className="px-6 md:px-10 xl:px-16 py-6">
        {accounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <FileSpreadsheet size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm mb-1">No hay cuentas creadas.</p>
            <Link href={`/project/${id}/accounting/budget`} className="text-blue-600 text-sm hover:underline">Ir al presupuesto →</Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 48px" }}>
              {["Código", "Descripción", "Presupuestado", "% total", "Distribución", ""].map((h, i) => (
                <div key={i} className={`px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i >= 2 ? "text-right" : ""}`}>{h}</div>
              ))}
            </div>

            {accounts.map((account) => {
              const t = getAccountTotal(account);
              const p = pct(t, grandTotal);
              return (
                <div
                  key={account.id}
                  onClick={() => goToAccount(account.id)}
                  className="grid border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
                  style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 48px" }}
                >
                  <div className="px-4 py-4 font-bold text-xs text-slate-900 flex items-center font-mono">{account.code}</div>
                  <div className="px-4 py-4 font-semibold text-sm text-slate-900 flex items-center gap-2">
                    {account.description}
                    <span className="text-[10px] text-slate-400">
                      {account.subAccounts.length} subcuenta{account.subAccounts.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="px-4 py-4 text-right font-bold text-sm text-slate-900 flex items-center justify-end font-mono tabular-nums">{fmt(t)} €</div>
                  <div className="px-4 py-4 text-right text-sm text-slate-500 flex items-center justify-end tabular-nums">{p}%</div>
                  <div className="px-4 py-4 flex items-center">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: "#2F52E0" }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight size={16} className="text-slate-400" />
                  </div>
                </div>
              );
            })}

            {/* Footer total */}
            <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 48px" }}>
              <div />
              <div className="px-4 py-3.5 text-xs font-bold flex items-center">TOTAL PRESUPUESTO</div>
              <div className="px-4 py-3.5 text-right text-sm font-bold font-mono tabular-nums flex items-center justify-end">{fmt(grandTotal)} €</div>
              <div className="px-4 py-3.5 text-right text-sm font-bold flex items-center justify-end">100%</div>
              <div /><div />
            </div>
          </div>
        )}
      </div>
      {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} />}
      {Toasts}
    </div>
  );

  // ─────────────────────────────────────────────
  // VIEW: ACCOUNT
  // ─────────────────────────────────────────────
  if (view === "account" && activeAccount) return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {Header}
      <div className="px-6 md:px-10 xl:px-16 py-6">
        <div className="mb-5 pb-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">{activeAccount.code} · {activeAccount.description}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeAccount.subAccounts.length} subcuentas · {fmt(getAccountTotal(activeAccount))} € total
          </p>
        </div>

        {activeAccount.subAccounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <p className="text-slate-500 text-sm">Esta cuenta no tiene subcuentas.</p>
            <Link href={`/project/${id}/accounting/budget`} className="text-blue-600 text-sm hover:underline mt-2 inline-block">
              Créalas en el presupuesto →
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 48px" }}>
              {["Código", "Descripción", "Líneas", "Presupuestado", "% cuenta", "Distribución", ""].map((h, i) => (
                <div key={i} className={`px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i >= 2 ? "text-right" : ""}`}>{h}</div>
              ))}
            </div>

            {activeAccount.subAccounts.map((sub) => {
              const accTotal = getAccountTotal(activeAccount);
              const p = pct(sub.budgeted, accTotal);
              return (
                <div
                  key={sub.id}
                  onClick={() => goToSubaccount(sub.id)}
                  className="grid border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors group"
                  style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 48px" }}
                >
                  <div className="px-4 py-3.5 text-xs text-slate-500 font-mono font-medium flex items-center">{sub.code}</div>
                  <div className="px-4 py-3.5 text-sm text-slate-800 font-medium flex items-center gap-2">
                    {sub.description}
                    {dirtySubIds.has(sub.id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
                  </div>
                  <div className="px-4 py-3.5 text-right text-xs text-slate-400 flex items-center justify-end">{sub.lines.length}</div>
                  <div className="px-4 py-3.5 text-right font-semibold text-sm text-slate-900 flex items-center justify-end font-mono tabular-nums">{fmt(sub.budgeted)} €</div>
                  <div className="px-4 py-3.5 text-right text-sm text-slate-500 flex items-center justify-end">{p}%</div>
                  <div className="px-4 py-3.5 flex items-center">
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: "#2F52E0" }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <ChevronRight size={16} className="text-slate-400" />
                  </div>
                </div>
              );
            })}

            <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 48px" }}>
              <div />
              <div className="px-4 py-3 text-xs font-bold flex items-center">TOTAL {activeAccount.code}</div>
              <div />
              <div className="px-4 py-3 text-right text-sm font-bold font-mono tabular-nums flex items-center justify-end">{fmt(getAccountTotal(activeAccount))} €</div>
              <div className="px-4 py-3 text-right text-sm font-bold flex items-center justify-end">100%</div>
              <div /><div />
            </div>
          </div>
        )}
      </div>
      {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} />}
      {Toasts}
    </div>
  );

  // ─────────────────────────────────────────────
  // VIEW: SUBACCOUNT
  // ─────────────────────────────────────────────
  if (view === "subaccount" && activeSub) {
    const cols = "32px 1fr 90px 90px 110px 64px 110px 36px";
    return (
      <div className={`min-h-screen bg-white ${inter.className}`}>
        {Header}
        <div className="flex" style={{ height: "calc(100vh - 4.5rem - 57px)" }}>
          {/* Main area */}
          <div className={`flex-1 overflow-auto ${activeLine ? "mr-72" : ""}`}>
            <div className="px-6 md:px-8 py-5">
              {/* Sub header */}
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{activeSub.code} · {activeSub.description}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{activeSub.lines.length} líneas de detalle</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{fmt(activeSub.budgeted)} €</p>
                  <p className="text-xs text-slate-400">presupuestado</p>
                </div>
              </div>

              {/* Lines table */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: cols }}>
                  {["#", "Descripción", "Cant.", "Períodos", "Tarifa", "Ud.", "Total", ""].map((h, i) => (
                    <div key={i} className={`px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i === 0 ? "text-center" : i >= 2 && i <= 6 ? "text-right" : ""}`}>{h}</div>
                  ))}
                </div>

                {activeSub.lines.length === 0 ? (
                  <div className="px-8 py-10 text-center">
                    <p className="text-sm text-slate-400 mb-3">No hay líneas de detalle.</p>
                    <button
                      onClick={() => addLine(activeSub.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white rounded-xl hover:opacity-90"
                      style={{ backgroundColor: "#2F52E0" }}
                    >
                      <Plus size={13} /> Añadir primera línea
                    </button>
                  </div>
                ) : (
                  <>
                    {activeSub.lines.map((line, idx) => {
                      const isSelected = selectedLineId === line.id;
                      const catCfg = CATEGORY_CONFIG[line.category];
                      return (
                        <div
                          key={line.id}
                          onClick={() => setSelectedLineId(isSelected ? null : line.id)}
                          className={`grid border-b border-slate-100 cursor-pointer transition-colors group/line ${
                            isSelected ? "bg-blue-50/60 border-l-2 border-l-blue-400" : "hover:bg-slate-50/60"
                          }`}
                          style={{ gridTemplateColumns: cols }}
                        >
                          {/* # + category dot */}
                          <div className="flex items-center justify-center gap-1 py-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${catCfg.dot}`} />
                            <span className="text-[10px] text-slate-300 font-mono">{String(idx + 1).padStart(2, "0")}</span>
                          </div>

                          {/* Description */}
                          <div className="px-1 py-1.5 flex items-center min-w-0" onClick={(e) => e.stopPropagation()}>
                            <EditableText
                              value={line.description}
                              onChange={(v) => updateLine(activeSub.id, line.id, { description: v })}
                              placeholder="Descripción del concepto..."
                            />
                          </div>

                          {/* Qty */}
                          <div className="px-1 py-1.5 flex items-center" onClick={(e) => e.stopPropagation()}>
                            <FormulaCell expr={line.quantityExpr} evaluated={line.quantity}
                              onChange={(v) => updateLine(activeSub.id, line.id, { quantityExpr: v })} />
                          </div>

                          {/* Periods */}
                          <div className="px-1 py-1.5 flex items-center" onClick={(e) => e.stopPropagation()}>
                            <FormulaCell expr={line.periodsExpr} evaluated={line.periods}
                              onChange={(v) => updateLine(activeSub.id, line.id, { periodsExpr: v })} />
                          </div>

                          {/* Rate */}
                          <div className="px-1 py-1.5 flex items-center" onClick={(e) => e.stopPropagation()}>
                            <FormulaCell expr={line.rateExpr} evaluated={line.rate}
                              onChange={(v) => updateLine(activeSub.id, line.id, { rateExpr: v })} />
                          </div>

                          {/* Unit */}
                          <div className="px-1 py-1.5 flex items-center" onClick={(e) => e.stopPropagation()}>
                            <UnitSelector value={line.unit}
                              onChange={(u) => updateLine(activeSub.id, line.id, { unit: u })} />
                          </div>

                          {/* Total */}
                          <div className="px-2 py-1.5 flex items-center justify-end">
                            <span className={`text-xs font-mono font-semibold tabular-nums ${line.total > 0 ? "text-slate-900" : "text-slate-300"}`}>
                              {line.total > 0 ? fmt(line.total) : "—"}
                            </span>
                          </div>

                          {/* Delete */}
                          <div className="flex items-center justify-center opacity-0 group-hover/line:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => deleteLine(activeSub.id, line.id)}
                              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add line */}
                    <div className="px-8 py-2 border-b border-slate-100">
                      <button
                        onClick={() => addLine(activeSub.id)}
                        className="text-[11px] text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors"
                      >
                        <Plus size={11} /> añadir línea
                      </button>
                    </div>
                  </>
                )}

                {/* Subtotal footer */}
                <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: cols }}>
                  <div />
                  <div className="px-2 py-3 text-xs font-bold col-span-2">SUBTOTAL {activeSub.code}</div>
                  <div className="col-span-3" />
                  <div className="px-2 py-3 text-right text-xs font-bold font-mono tabular-nums">{fmt(activeSub.budgeted)} €</div>
                  <div />
                </div>
              </div>

              {/* Formula hint */}
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <Hash size={12} />
                <span>
                  Fórmulas disponibles:{" "}
                  <code className="bg-slate-100 px-1 rounded text-blue-600">semanas_rodaje * 800</code>
                  {" · "}
                  <code className="bg-slate-100 px-1 rounded text-blue-600">dias_rodaje / 5</code>
                </span>
              </div>
            </div>
          </div>

          {/* Line sidebar */}
          {activeLine && (
            <div className="fixed right-0 top-[calc(4.5rem+57px)] bottom-0 w-72 z-10">
              <LineSidebar
                line={activeLine}
                onUpdate={(patch) => updateLine(activeSub.id, activeLine.id, patch)}
                onClose={() => setSelectedLineId(null)}
              />
            </div>
          )}
        </div>

        {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} />}
        {Toasts}
      </div>
    );
  }

  return null;
}
