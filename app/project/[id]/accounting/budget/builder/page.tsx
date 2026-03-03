"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import {
  doc, getDoc, collection, getDocs, query, orderBy,
  writeBatch, updateDoc, deleteDoc, addDoc, setDoc, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, ChevronRight, X, Calculator, AlertCircle, CheckCircle,
  FileSpreadsheet, Save, Upload, Loader2, ShieldAlert, StickyNote,
  Trash2, Variable, Hash, Copy, Search, Download, History, MoreHorizontal,
  GripVertical, ChevronDown, FolderPlus, FilePlus, Edit2, Check, BarChart2,
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
  order: number;
}

interface SubAccount {
  id: string; code: string; description: string;
  budgeted: number; lines: DetailLine[];
}

interface Account {
  id: string; code: string; description: string; subAccounts: SubAccount[];
}

interface PublishVersion {
  id: string;
  publishedAt: Timestamp;
  total: number;
  publishedBy: string;
  label: string;
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const BRAND = "#2F52E0";

const UNIT_LABELS: Record<Unit, string> = {
  day: "día", week: "sem", month: "mes", flat: "pack", unit: "ud", hour: "h",
};
const UNIT_OPTIONS: Unit[] = ["day", "week", "month", "flat", "unit", "hour"];

const CATEGORY_CONFIG: Record<LineCategory, { label: string; color: string; bg: string; border: string; dot: string; hex: string }> = {
  personal:  { label: "Personal",  color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200",   dot: "bg-blue-400",    hex: "#3b82f6" },
  equipment: { label: "Equipo",    color: "text-violet-700",  bg: "bg-violet-50",  border: "border-violet-200", dot: "bg-violet-400",  hex: "#8b5cf6" },
  travel:    { label: "Viajes",    color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-400",   hex: "#f59e0b" },
  services:  { label: "Servicios", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",dot: "bg-emerald-400", hex: "#10b981" },
  post:      { label: "Post",      color: "text-rose-700",    bg: "bg-rose-50",    border: "border-rose-200",   dot: "bg-rose-400",    hex: "#f43f5e" },
  other:     { label: "Otro",      color: "text-slate-600",   bg: "bg-slate-100",  border: "border-slate-200",  dot: "bg-slate-400",   hex: "#94a3b8" },
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
const fmtShort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return fmt(n);
};
const getAccountTotal = (a: Account) => a.subAccounts.reduce((s, s2) => s + s2.budgeted, 0);
const getGrandTotal = (accounts: Account[]) => accounts.reduce((s, a) => s + getAccountTotal(a), 0);
const pct = (part: number, total: number) => (!total ? 0 : Math.round((part / total) * 100));

// ─────────────────────────────────────────────
// DONUT CHART
// ─────────────────────────────────────────────
function DonutChart({ accounts }: { accounts: Account[] }) {
  const grandTotal = getGrandTotal(accounts);
  if (!grandTotal || accounts.length === 0) return null;

  const COLORS = ["#2F52E0", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4", "#84cc16", "#ec4899"];
  const r = 40; const cx = 52; const cy = 52;
  const circumference = 2 * Math.PI * r;

  let cumulative = 0;
  const slices = accounts.map((a, i) => {
    const t = getAccountTotal(a);
    const fraction = t / grandTotal;
    const offset = circumference * (1 - cumulative);
    cumulative += fraction;
    return { fraction, offset, color: COLORS[i % COLORS.length], label: a.code, total: t };
  });

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex-shrink-0">
        <svg width={104} height={104} className="rotate-[-90deg]">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={14} />
          {slices.map((s, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={14}
              strokeDasharray={`${circumference * s.fraction} ${circumference * (1 - s.fraction)}`}
              strokeDashoffset={s.offset}
              strokeLinecap="butt"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
          <span className="text-[10px] text-slate-400 font-medium">TOTAL</span>
          <span className="text-xs font-bold text-slate-900 font-mono">{fmtShort(grandTotal)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        {slices.slice(0, 6).map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-slate-500 font-mono truncate">{s.label}</span>
            <span className="text-[10px] text-slate-400 ml-auto font-mono pl-2">{Math.round(s.fraction * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CATEGORY SUMMARY BAR
// ─────────────────────────────────────────────
function CategorySummary({ lines }: { lines: DetailLine[] }) {
  const total = lines.reduce((s, l) => s + l.total, 0);
  if (!total) return null;
  const byCategory = (Object.keys(CATEGORY_CONFIG) as LineCategory[]).map((cat) => {
    const catTotal = lines.filter((l) => l.category === cat).reduce((s, l) => s + l.total, 0);
    return { cat, total: catTotal, pct: pct(catTotal, total) };
  }).filter((c) => c.total > 0);

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <BarChart2 size={11} /> Desglose por categoría
      </p>
      <div className="flex h-2 rounded-full overflow-hidden mb-3 gap-px">
        {byCategory.map(({ cat, pct: p }) => (
          <div key={cat} className="h-full transition-all" style={{ width: `${p}%`, backgroundColor: CATEGORY_CONFIG[cat].hex }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {byCategory.map(({ cat, total: t, pct: p }) => {
          const cfg = CATEGORY_CONFIG[cat];
          return (
            <div key={cat} className={`${cfg.bg} rounded-lg px-2.5 py-2`}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                <span className={`text-[10px] font-medium ${cfg.color}`}>{cfg.label}</span>
              </div>
              <p className="text-xs font-bold text-slate-900 font-mono tabular-nums">{fmt(t)} €</p>
              <p className="text-[10px] text-slate-400">{p}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// FORMULA CELL
// ─────────────────────────────────────────────
function FormulaCell({ expr, evaluated, onChange, placeholder = "0" }: {
  expr: string; evaluated: number; onChange: (v: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(expr);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { ref.current?.select(); setRaw(expr); } }, [editing]);
  const commit = () => { onChange(raw); setEditing(false); };
  if (editing) return (
    <input ref={ref} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(); } if (e.key === "Escape") setEditing(false); }}
      className="w-full text-right bg-blue-50 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
  const hasFormula = expr && isNaN(Number(expr)) && expr.trim() !== "";
  return (
    <div onClick={() => setEditing(true)}
      className="text-right px-1 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs font-mono select-none w-full group relative">
      {hasFormula && <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[8px] text-blue-400 opacity-0 group-hover:opacity-100">ƒ</span>}
      {evaluated === 0 ? <span className="text-slate-300">{placeholder}</span> : fmt(evaluated)}
    </div>
  );
}

// ─────────────────────────────────────────────
// EDITABLE TEXT
// ─────────────────────────────────────────────
function EditableText({ value, onChange, placeholder = "", className = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const commit = () => { onChange(raw); setEditing(false); };
  if (editing) return (
    <input ref={ref} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setRaw(value); setEditing(false); } }}
      className={`w-full bg-blue-50 border border-blue-400 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
    />
  );
  return (
    <div onClick={() => { setRaw(value); setEditing(true); }}
      className={`px-1.5 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs truncate ${value ? "text-slate-800" : "text-slate-300"} ${className}`}>
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
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} className="relative flex justify-end">
      <button onClick={() => setOpen(!open)}
        className="text-[10px] text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-1.5 py-0.5 rounded border border-transparent hover:border-slate-200 transition-colors">
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
  globals: Global[]; onChange: (g: Global[]) => void; onClose: () => void;
}) {
  const [local, setLocal] = useState<Global[]>(globals);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const update = (idx: number, field: keyof Global, val: string) => {
    const next = local.map((g, i) => i !== idx ? g : { ...g, [field]: field === "value" ? parseFloat(val) || 0 : val });
    setLocal(next); onChange(next);
  };
  const add = () => {
    const next = [...local, { key: `var_${Date.now()}`, value: 0, label: "Nueva variable" }];
    setLocal(next); onChange(next);
  };
  const remove = (idx: number) => {
    const next = local.filter((_, i) => i !== idx);
    setLocal(next); onChange(next);
  };

  return (
    <div ref={ref} className="w-80 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <Variable size={14} className="text-blue-600" />
          <span className="text-xs font-semibold text-slate-700">Variables globales</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg"><X size={13} className="text-slate-400" /></button>
      </div>
      <div className="px-4 py-3 space-y-3 max-h-72 overflow-y-auto">
        {local.map((g, i) => (
          <div key={i} className="flex items-center gap-2 group">
            <div className="flex-1 min-w-0">
              <input value={g.label} onChange={(e) => update(i, "label", e.target.value)}
                className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none px-0.5 py-0.5 mb-1"
                placeholder="Etiqueta" />
              <div className="flex items-center gap-1.5">
                <input value={g.key} onChange={(e) => update(i, "key", e.target.value)}
                  className="text-[10px] font-mono text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded border-none focus:outline-none focus:ring-1 focus:ring-blue-400 w-28" />
                <span className="text-[10px] text-slate-300">=</span>
                <input type="number" value={g.value} onChange={(e) => update(i, "value", e.target.value)}
                  className="w-16 text-xs font-mono font-semibold text-slate-900 bg-transparent border-b border-slate-200 focus:border-blue-400 focus:outline-none px-0.5 text-right" />
              </div>
            </div>
            <button onClick={() => remove(i)} className="p-1 text-slate-200 hover:text-red-400 rounded opacity-0 group-hover:opacity-100 flex-shrink-0">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50">
        <button onClick={add} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
          <Plus size={11} /> Añadir variable
        </button>
      </div>
      <div className="px-4 py-2 border-t border-slate-100">
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Usa variables en fórmulas: <code className="bg-slate-100 px-1 rounded text-blue-500">semanas_rodaje * 800</code>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LINE SIDEBAR
// ─────────────────────────────────────────────
function LineSidebar({ line, onUpdate, onClose, onDuplicate, onDelete }: {
  line: DetailLine;
  onUpdate: (patch: Partial<DetailLine>) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const catCfg = CATEGORY_CONFIG[line.category];
  return (
    <div className="h-full bg-white border-l border-slate-200 flex flex-col shadow-xl">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0`} style={{ backgroundColor: catCfg.hex }} />
          <span className="text-xs font-semibold text-slate-700 truncate">Detalle de línea</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDuplicate} title="Duplicar línea"
            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
            <Copy size={12} />
          </button>
          <button onClick={onDelete} title="Eliminar línea"
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={12} />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors ml-1">
            <X size={13} className="text-slate-400" />
          </button>
        </div>
      </div>

      {/* Total */}
      <div className="px-4 py-4 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white flex-shrink-0">
        <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-0.5">Total calculado</p>
        <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{fmt(line.total)} €</p>
        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
          {fmt(line.quantity)} × {fmt(line.periods)} × {fmt(line.rate)} €/{UNIT_LABELS[line.unit]}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Description */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Descripción</label>
          <textarea value={line.description} onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Descripción del concepto..." rows={2}
            className="w-full text-xs text-slate-800 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>

        {/* Category */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Categoría</label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.entries(CATEGORY_CONFIG) as [LineCategory, typeof CATEGORY_CONFIG[LineCategory]][]).map(([cat, cfg]) => (
              <button key={cat} onClick={() => onUpdate({ category: cat })}
                className={`px-2 py-1.5 text-[10px] font-medium rounded-lg border transition-all ${
                  line.category === cat ? `${cfg.bg} ${cfg.border} ${cfg.color} border` : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}>
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Formulas */}
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
                  <FormulaCell expr={line[exprKey]} evaluated={line[valKey]}
                    onChange={(v) => onUpdate({ [exprKey]: v } as Partial<DetailLine>)} />
                </div>
                <span className="text-[10px] text-slate-400 font-mono w-14 text-right tabular-nums">{fmt(line[valKey])}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unit */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">Unidad</label>
          <div className="flex gap-1 flex-wrap">
            {UNIT_OPTIONS.map((u) => (
              <button key={u} onClick={() => onUpdate({ unit: u })}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-lg border transition-all ${
                  line.unit === u ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}>
                {UNIT_LABELS[u]}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
            <StickyNote size={10} /> Notas internas
          </label>
          <textarea value={line.note} onChange={(e) => onUpdate({ note: e.target.value })}
            placeholder="Referencias, condiciones, proveedor sugerido..." rows={3}
            className="w-full text-xs text-slate-700 border border-slate-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-slate-300" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PUBLISH MODAL
// ─────────────────────────────────────────────
function PublishModal({ accounts, onConfirm, onCancel, publishing, label, setLabel }: {
  accounts: Account[]; onConfirm: () => void; onCancel: () => void;
  publishing: boolean; label: string; setLabel: (v: string) => void;
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
              <Upload size={18} style={{ color: BRAND }} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Publicar presupuesto</h3>
              <p className="text-xs text-slate-500">Los importes presupuestados se actualizarán en el sistema</p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Label */}
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Etiqueta de versión (opcional)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej: v1.0 — Primera entrega"
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[{ label: "Cuentas", value: accounts.length }, { label: "Subcuentas", value: totalSubs }, { label: "Líneas", value: totalLines }].map(({ label: l, value: v }) => (
              <div key={l} className="bg-slate-50 rounded-xl px-3 py-3 text-center">
                <p className="text-xl font-bold text-slate-900 tabular-nums">{v}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium opacity-70">Total presupuestado</span>
            <span className="text-lg font-bold font-mono tabular-nums">{fmt(grandTotal)} €</span>
          </div>
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              Esto sobreescribirá el campo <strong>budgeted</strong> en todas las subcuentas con los totales del constructor.
            </p>
          </div>
        </div>
        <div className="px-6 pb-5 flex items-center justify-end gap-3">
          <button onClick={onCancel} disabled={publishing}
            className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={publishing}
            className="px-5 py-2 text-sm font-semibold text-white rounded-xl flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: BRAND }}>
            {publishing ? <><Loader2 size={14} className="animate-spin" /> Publicando...</> : <><Upload size={14} /> Publicar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CREATE ACCOUNT MODAL
// ─────────────────────────────────────────────
function CreateAccountModal({ type, onConfirm, onCancel, existingCodes }: {
  type: "account" | "subaccount";
  onConfirm: (code: string, description: string) => void;
  onCancel: () => void;
  existingCodes: string[];
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => { codeRef.current?.focus(); }, []);

  const handleConfirm = () => {
    if (!code.trim()) { setError("El código es obligatorio"); return; }
    if (!description.trim()) { setError("La descripción es obligatoria"); return; }
    if (existingCodes.includes(code.trim().toUpperCase())) { setError("Ya existe un elemento con ese código"); return; }
    onConfirm(code.trim().toUpperCase(), description.trim());
  };

  const isAccount = type === "account";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#EEF1FD" }}>
            {isAccount ? <FolderPlus size={16} style={{ color: BRAND }} /> : <FilePlus size={16} style={{ color: BRAND }} />}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{isAccount ? "Nueva cuenta" : "Nueva subcuenta"}</h3>
            <p className="text-xs text-slate-400">{isAccount ? "Capítulo principal" : "Partida de detalle"}</p>
          </div>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              Código {isAccount ? "(ej: 07)" : "(ej: 07.01.01)"}
            </label>
            <input ref={codeRef} value={code} onChange={(e) => { setCode(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder={isAccount ? "07" : "07.01.01"}
              className="w-full text-sm font-mono border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Descripción</label>
            <input value={description} onChange={(e) => { setDescription(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder={isAccount ? "Maquinaria y elementos de rodaje" : "Cámara principal"}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
        </div>
        <div className="px-6 pb-5 flex items-center justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancelar</button>
          <button onClick={handleConfirm}
            className="px-4 py-2 text-sm font-semibold text-white rounded-xl flex items-center gap-1.5 hover:opacity-90"
            style={{ backgroundColor: BRAND }}>
            <Check size={14} /> Crear
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GLOBAL SEARCH
// ─────────────────────────────────────────────
function GlobalSearch({ accounts, onNavigate, onClose }: {
  accounts: Account[];
  onNavigate: (accountId: string, subId?: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const out: { type: "account" | "subaccount" | "line"; label: string; sub: string; accountId: string; subId?: string }[] = [];
    for (const a of accounts) {
      if (a.code.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) {
        out.push({ type: "account", label: `${a.code} · ${a.description}`, sub: `${a.subAccounts.length} subcuentas`, accountId: a.id });
      }
      for (const s of a.subAccounts) {
        if (s.code.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)) {
          out.push({ type: "subaccount", label: `${s.code} · ${s.description}`, sub: `En ${a.code}`, accountId: a.id, subId: s.id });
        }
        for (const l of s.lines) {
          if (l.description.toLowerCase().includes(q)) {
            out.push({ type: "line", label: l.description, sub: `${s.code} · ${fmt(l.total)} €`, accountId: a.id, subId: s.id });
          }
        }
      }
    }
    return out.slice(0, 8);
  }, [query, accounts]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30 backdrop-blur-sm">
      <div ref={containerRef} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Search size={16} className="text-slate-400 flex-shrink-0" />
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cuentas, subcuentas, líneas..."
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none"
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          />
          <kbd className="text-[10px] text-slate-300 border border-slate-200 rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        {results.length > 0 ? (
          <div className="py-1.5 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <button key={i} onClick={() => { onNavigate(r.accountId, r.subId); onClose(); }}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-3 transition-colors">
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                  r.type === "account" ? "bg-blue-100 text-blue-700" :
                  r.type === "subaccount" ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-700"
                }`}>
                  {r.type === "account" ? "Cuenta" : r.type === "subaccount" ? "Subcuenta" : "Línea"}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-900 truncate">{r.label}</p>
                  <p className="text-[10px] text-slate-400">{r.sub}</p>
                </div>
                <ChevronRight size={13} className="text-slate-300 flex-shrink-0 ml-auto" />
              </button>
            ))}
          </div>
        ) : query.trim() ? (
          <div className="py-8 text-center">
            <p className="text-sm text-slate-400">Sin resultados para "{query}"</p>
          </div>
        ) : (
          <div className="py-6 text-center">
            <p className="text-xs text-slate-300">Escribe para buscar en el presupuesto</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EXPORT HELPER
// ─────────────────────────────────────────────
function exportToCSV(accounts: Account[]) {
  const rows: string[] = [
    ["Cuenta", "Código cuenta", "Subcuenta", "Código subcuenta", "Descripción línea", "Cantidad", "Periodos", "Tarifa", "Unidad", "Total", "Categoría", "Notas"].join(";")
  ];
  for (const a of accounts) {
    for (const s of a.subAccounts) {
      if (s.lines.length === 0) {
        rows.push([a.description, a.code, s.description, s.code, "", "", "", "", "", fmt(s.budgeted), "", ""].join(";"));
      } else {
        for (const l of s.lines) {
          rows.push([a.description, a.code, s.description, s.code, l.description,
            l.quantity, l.periods, l.rate, UNIT_LABELS[l.unit], l.total,
            CATEGORY_CONFIG[l.category].label, l.note].join(";"));
        }
      }
    }
  }
  const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `presupuesto_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// VERSION HISTORY PANEL
// ─────────────────────────────────────────────
function VersionHistoryPanel({ versions, onClose }: { versions: PublishVersion[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={ref} className="w-72 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <History size={14} className="text-slate-600" />
          <span className="text-xs font-semibold text-slate-700">Historial de versiones</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-lg"><X size={13} className="text-slate-400" /></button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-slate-400">Sin publicaciones anteriores</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {versions.map((v, i) => (
              <div key={v.id} className={`px-4 py-3 ${i === 0 ? "bg-blue-50/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {i === 0 && <span className="text-[9px] font-bold uppercase text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded mb-1 inline-block">Última</span>}
                    <p className="text-xs font-semibold text-slate-800 truncate">{v.label || `Publicación ${versions.length - i}`}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {v.publishedAt?.toDate?.()?.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) || "—"}
                    </p>
                    {v.publishedBy && <p className="text-[10px] text-slate-400">{v.publishedBy}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold font-mono text-slate-900 tabular-nums">{fmt(v.total)} €</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
  const [userId, setUserId]               = useState<string | null>(null);
  const [userEmail, setUserEmail]         = useState<string>("");
  const [accounts, setAccounts]           = useState<Account[]>([]);
  const [globals, setGlobals]             = useState<Global[]>(DEFAULT_GLOBALS);
  const [view, setView]                   = useState<View>("topsheet");
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeSubId, setActiveSubId]         = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId]   = useState<string | null>(null);
  const [showGlobals, setShowGlobals]         = useState(false);
  const [showSearch, setShowSearch]           = useState(false);
  const [showHistory, setShowHistory]         = useState(false);
  const [showPublish, setShowPublish]         = useState(false);
  const [showCreateAccount, setShowCreateAccount]    = useState(false);
  const [showCreateSubaccount, setShowCreateSubaccount] = useState(false);
  const [dirtySubIds, setDirtySubIds]     = useState<Set<string>>(new Set());
  const [saveState, setSaveState]         = useState<SaveState>("idle");
  const [publishing, setPublishing]       = useState(false);
  const [publishLabel, setPublishLabel]   = useState("");
  const [versions, setVersions]           = useState<PublishVersion[]>([]);
  const [successMsg, setSuccessMsg]       = useState("");
  const [errorMsg, setErrorMsg]           = useState("");
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [showBulkMenu, setShowBulkMenu]   = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const activeSub     = activeAccount?.subAccounts.find((s) => s.id === activeSubId) ?? null;
  const activeLine    = activeSub?.lines.find((l) => l.id === selectedLineId) ?? null;
  const grandTotal    = getGrandTotal(accounts);

  // ── Auth ──
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { if (u) { setUserId(u.uid); setUserEmail(u.email || ""); } });
    return () => unsub();
  }, []);
  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); }
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveBuilderLines(dirtySubIds); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [dirtySubIds]);

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
        if (projSnap.data().builderGlobals) setGlobals(projSnap.data().builderGlobals);
      }
      const aSnap = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const loaded: Account[] = await Promise.all(
        aSnap.docs.map(async (aDoc) => {
          const sSnap = await getDocs(query(collection(db, `projects/${id}/accounts/${aDoc.id}/subaccounts`), orderBy("code", "asc")));
          const subs: SubAccount[] = sSnap.docs.map((sDoc) => {
            const sd = sDoc.data();
            const rawLines: any[] = sd.builderLines || [];
            const lines: DetailLine[] = rawLines.map((l: any, idx: number) => {
              const q = evaluateExpr(l.quantityExpr ?? String(l.quantity ?? 1), DEFAULT_GLOBALS);
              const p = evaluateExpr(l.periodsExpr  ?? String(l.periods  ?? 1), DEFAULT_GLOBALS);
              const r = evaluateExpr(l.rateExpr     ?? String(l.rate     ?? 0), DEFAULT_GLOBALS);
              return {
                id: l.id || crypto.randomUUID(), description: l.description || "",
                quantityExpr: l.quantityExpr ?? String(l.quantity ?? 1),
                periodsExpr:  l.periodsExpr  ?? String(l.periods  ?? 1),
                rateExpr:     l.rateExpr     ?? String(l.rate     ?? 0),
                quantity: q, periods: p, rate: r,
                unit: (l.unit as Unit) || "day",
                total: calcTotal(q, p, r),
                note: l.note || "",
                category: (l.category as LineCategory) || "other",
                order: l.order ?? idx,
              };
            }).sort((a, b) => a.order - b.order);
            const budgeted = lines.length > 0 ? lines.reduce((s, l) => s + l.total, 0) : (sd.budgeted || 0);
            return { id: sDoc.id, code: sd.code || "", description: sd.description || "", budgeted, lines };
          });
          return { id: aDoc.id, code: aDoc.data().code || "", description: aDoc.data().description || "", subAccounts: subs };
        })
      );
      setAccounts(loaded);
      // Load versions
      try {
        const vSnap = await getDocs(query(collection(db, `projects/${id}/builderVersions`), orderBy("publishedAt", "desc")));
        setVersions(vSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PublishVersion)));
      } catch {}
    } catch (err: any) { setErrorMsg(`Error al cargar: ${err.message}`); }
    finally { setLoading(false); }
  };

  const reEvalAll = useCallback((currentAccounts: Account[], currentGlobals: Global[]) =>
    currentAccounts.map((a) => ({
      ...a, subAccounts: a.subAccounts.map((s) => {
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
        let foundAccountId = ""; let foundSub: SubAccount | undefined;
        for (const account of accounts) {
          const sub = account.subAccounts.find((s) => s.id === subId);
          if (sub) { foundAccountId = account.id; foundSub = sub; break; }
        }
        if (!foundAccountId || !foundSub) continue;
        batch.update(doc(db, `projects/${id}/accounts/${foundAccountId}/subaccounts`, subId), {
          builderLines: foundSub.lines.map((l, idx) => ({
            id: l.id, description: l.description,
            quantityExpr: l.quantityExpr, periodsExpr: l.periodsExpr, rateExpr: l.rateExpr,
            quantity: l.quantity, periods: l.periods, rate: l.rate,
            unit: l.unit, total: l.total, note: l.note, category: l.category, order: idx,
          })),
        });
      }
      await batch.commit();
      setDirtySubIds(new Set()); setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err: any) { setSaveState("error"); setErrorMsg(`Error al guardar: ${err.message}`); }
  }, [accounts, id]);

  // ── Publish ──
  const handlePublish = async () => {
    setPublishing(true);
    try {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const batch = writeBatch(db);
      for (const account of accounts)
        for (const sub of account.subAccounts)
          batch.update(doc(db, `projects/${id}/accounts/${account.id}/subaccounts`, sub.id), {
            budgeted: sub.budgeted,
            builderLines: sub.lines.map((l, idx) => ({
              id: l.id, description: l.description,
              quantityExpr: l.quantityExpr, periodsExpr: l.periodsExpr, rateExpr: l.rateExpr,
              quantity: l.quantity, periods: l.periods, rate: l.rate,
              unit: l.unit, total: l.total, note: l.note, category: l.category, order: idx,
            })),
          });
      await batch.commit();
      // Save version
      const vRef = doc(collection(db, `projects/${id}/builderVersions`));
      const newVersion: Omit<PublishVersion, "id"> = {
        publishedAt: Timestamp.now(), total: grandTotal,
        publishedBy: userEmail, label: publishLabel || "",
      };
      await setDoc(vRef, newVersion);
      setVersions((prev) => [{ id: vRef.id, ...newVersion }, ...prev]);
      setDirtySubIds(new Set()); setSaveState("saved"); setShowPublish(false); setPublishLabel("");
      setSuccessMsg("Presupuesto publicado");
      setTimeout(() => { setSaveState("idle"); setSuccessMsg(""); }, 3000);
    } catch (err: any) { setErrorMsg(`Error al publicar: ${err.message}`); }
    finally { setPublishing(false); }
  };

  // ── Create account/subaccount ──
  const handleCreateAccount = async (code: string, description: string) => {
    try {
      const ref = await addDoc(collection(db, `projects/${id}/accounts`), { code, description, createdAt: Timestamp.now() });
      const newAccount: Account = { id: ref.id, code, description, subAccounts: [] };
      setAccounts((prev) => [...prev, newAccount].sort((a, b) => a.code.localeCompare(b.code)));
      setShowCreateAccount(false);
      setSuccessMsg("Cuenta creada");
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (err: any) { setErrorMsg(`Error al crear: ${err.message}`); }
  };

  const handleCreateSubaccount = async (code: string, description: string) => {
    if (!activeAccountId) return;
    try {
      const ref = await addDoc(collection(db, `projects/${id}/accounts/${activeAccountId}/subaccounts`), {
        code, description, budgeted: 0, builderLines: [], createdAt: Timestamp.now(),
      });
      const newSub: SubAccount = { id: ref.id, code, description, budgeted: 0, lines: [] };
      setAccounts((prev) => prev.map((a) => a.id !== activeAccountId ? a : {
        ...a, subAccounts: [...a.subAccounts, newSub].sort((a, b) => a.code.localeCompare(b.code)),
      }));
      setShowCreateSubaccount(false);
      setSuccessMsg("Subcuenta creada");
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch (err: any) { setErrorMsg(`Error al crear: ${err.message}`); }
  };

  const handleDeleteAccount = async (accountId: string) => {
    if (!confirm("¿Eliminar esta cuenta y todas sus subcuentas? Esta acción no se puede deshacer.")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/accounts`, accountId));
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
      if (activeAccountId === accountId) { setView("topsheet"); setActiveAccountId(null); }
    } catch (err: any) { setErrorMsg(`Error al eliminar: ${err.message}`); }
  };

  const handleDeleteSubaccount = async (subId: string) => {
    if (!activeAccountId) return;
    if (!confirm("¿Eliminar esta subcuenta y todas sus líneas?")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/accounts/${activeAccountId}/subaccounts`, subId));
      setAccounts((prev) => prev.map((a) => a.id !== activeAccountId ? a : {
        ...a, subAccounts: a.subAccounts.filter((s) => s.id !== subId),
      }));
      if (activeSubId === subId) { setView("account"); setActiveSubId(null); }
    } catch (err: any) { setErrorMsg(`Error al eliminar: ${err.message}`); }
  };

  // ── Line mutations ──
  const markDirty = (subId: string) => { setDirtySubIds((p) => new Set([...p, subId])); setSaveState("idle"); };

  const addLine = (subId: string) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    const sub = accounts.find((a) => a.id === accountId)?.subAccounts.find((s) => s.id === subId);
    const newLine: DetailLine = {
      id: crypto.randomUUID(), description: "", quantityExpr: "1", periodsExpr: "1", rateExpr: "0",
      quantity: 1, periods: 1, rate: 0, unit: "day", total: 0, note: "", category: "other",
      order: sub?.lines.length ?? 0,
    };
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => s.id !== subId ? s : { ...s, lines: [...s.lines, newLine] }),
    }));
    markDirty(subId);
    setTimeout(() => setSelectedLineId(newLine.id), 50);
  };

  const updateLine = (subId: string, lineId: string, patch: Partial<DetailLine>) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => {
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

  const duplicateLine = (subId: string, lineId: string) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subId) return s;
        const idx = s.lines.findIndex((l) => l.id === lineId);
        if (idx === -1) return s;
        const original = s.lines[idx];
        const copy: DetailLine = { ...original, id: crypto.randomUUID(), description: `${original.description} (copia)`, order: s.lines.length };
        const lines = [...s.lines.slice(0, idx + 1), copy, ...s.lines.slice(idx + 1)];
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    markDirty(subId);
  };

  const deleteLine = (subId: string, lineId: string) => {
    const accountId = accounts.find((a) => a.subAccounts.some((s) => s.id === subId))?.id;
    if (!accountId) return;
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subId) return s;
        const lines = s.lines.filter((l) => l.id !== lineId);
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    if (selectedLineId === lineId) setSelectedLineId(null);
    setSelectedLines((prev) => { const n = new Set(prev); n.delete(lineId); return n; });
    markDirty(subId);
  };

  const bulkDeleteLines = (subId: string) => {
    if (!confirm(`¿Eliminar ${selectedLines.size} líneas seleccionadas?`)) return;
    for (const lineId of selectedLines) deleteLine(subId, lineId);
    setSelectedLines(new Set()); setShowBulkMenu(false);
  };

  const bulkSetCategory = (subId: string, category: LineCategory) => {
    for (const lineId of selectedLines) updateLine(subId, lineId, { category });
    setSelectedLines(new Set()); setShowBulkMenu(false);
  };

  // ── Navigation ──
  const goToAccount    = (accountId: string) => { setActiveAccountId(accountId); setActiveSubId(null); setSelectedLineId(null); setSelectedLines(new Set()); setView("account"); };
  const goToSubaccount = (subId: string)     => { setActiveSubId(subId); setSelectedLineId(null); setSelectedLines(new Set()); setView("subaccount"); };
  const goBack = () => {
    if (view === "subaccount") { setView("account"); setActiveSubId(null); setSelectedLineId(null); setSelectedLines(new Set()); }
    else if (view === "account") { setView("topsheet"); setActiveAccountId(null); }
  };

  const handleSearchNavigate = (accountId: string, subId?: string) => {
    setActiveAccountId(accountId);
    if (subId) { setActiveSubId(subId); setView("subaccount"); }
    else { setView("account"); }
  };

  // ── Toasts ──
  const Toasts = (
    <>
      {successMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          <CheckCircle size={16} />{successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />{errorMsg}
          <button onClick={() => setErrorMsg("")} className="ml-2 hover:bg-white/20 rounded p-0.5"><X size={14} /></button>
        </div>
      )}
    </>
  );

  if (loading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasAccess) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="text-center">
        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><ShieldAlert size={24} className="text-red-500" /></div>
        <p className="text-slate-700 font-medium mb-1">Acceso denegado</p>
        <p className="text-slate-400 text-sm mb-4">No tienes permisos para el constructor.</p>
        <Link href={`/project/${id}/accounting/budget`} className="text-blue-600 hover:underline text-sm">← Volver</Link>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────
  // HEADER
  // ─────────────────────────────────────────────
  const Header = (
    <div className="mt-[4.5rem] border-b border-slate-200 bg-white sticky top-[4.5rem] z-20 shadow-sm">
      <div className="px-6 md:px-10 xl:px-16 py-3 flex items-center justify-between gap-4">
        {/* Left */}
        <div className="flex items-center gap-2 min-w-0">
          {view === "topsheet"
            ? <Link href={`/project/${id}/accounting/budget`} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg flex-shrink-0"><ArrowLeft size={18} /></Link>
            : <button onClick={goBack} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg flex-shrink-0"><ArrowLeft size={18} /></button>
          }
          <div className="flex items-center gap-1.5 text-sm min-w-0 flex-wrap">
            <Calculator size={16} style={{ color: BRAND }} className="flex-shrink-0" />
            <button onClick={() => { setView("topsheet"); setActiveAccountId(null); setActiveSubId(null); }}
              className={`font-medium transition-colors ${view === "topsheet" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"}`}>
              Constructor
            </button>
            {activeAccount && (<>
              <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
              <button onClick={() => { setView("account"); setActiveSubId(null); setSelectedLineId(null); }}
                className={`transition-colors truncate max-w-[160px] ${view === "account" ? "text-slate-900 font-semibold" : "text-slate-400 hover:text-slate-600"}`}>
                {activeAccount.code} · {activeAccount.description}
              </button>
            </>)}
            {activeSub && (<>
              <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
              <span className="text-slate-900 font-semibold truncate max-w-[160px]">{activeSub.code} · {activeSub.description}</span>
            </>)}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Save state */}
          <div className={`flex items-center gap-1.5 text-xs transition-opacity duration-300 ${saveState === "idle" ? "opacity-0" : "opacity-100"}`}>
            {saveState === "saving" && <><Loader2 size={12} className="animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
            {saveState === "saved"  && <><CheckCircle size={12} className="text-emerald-500" /><span className="text-emerald-600">Guardado</span></>}
            {saveState === "error"  && <><AlertCircle size={12} className="text-red-500" /><span className="text-red-600">Error</span></>}
          </div>

          {/* Search */}
          <button onClick={() => setShowSearch(true)}
            className="px-2.5 py-1.5 text-xs border rounded-lg flex items-center gap-1.5 text-slate-500 border-slate-200 hover:bg-slate-50 transition-colors">
            <Search size={13} />
            <span className="hidden sm:inline">Buscar</span>
            <kbd className="text-[9px] text-slate-300 border border-slate-200 rounded px-1 hidden md:inline">⌘K</kbd>
          </button>

          {/* Globals */}
          <div className="relative">
            <button onClick={() => setShowGlobals(!showGlobals)}
              className={`px-2.5 py-1.5 text-xs border rounded-lg flex items-center gap-1.5 transition-colors ${showGlobals ? "bg-blue-50 border-blue-300 text-blue-700" : "text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
              <Variable size={13} /> Variables
            </button>
            {showGlobals && (
              <div className="absolute top-full right-0 mt-2 z-50">
                <GlobalsPanel globals={globals} onChange={handleGlobalsChange} onClose={() => setShowGlobals(false)} />
              </div>
            )}
          </div>

          {/* History */}
          <div className="relative">
            <button onClick={() => setShowHistory(!showHistory)}
              className={`p-1.5 text-xs border rounded-lg flex items-center gap-1.5 transition-colors ${showHistory ? "bg-slate-100 border-slate-300 text-slate-700" : "text-slate-500 border-slate-200 hover:bg-slate-50"}`}
              title="Historial de versiones">
              <History size={14} />
              {versions.length > 0 && <span className="text-[9px] font-bold text-slate-400">{versions.length}</span>}
            </button>
            {showHistory && (
              <div className="absolute top-full right-0 mt-2 z-50">
                <VersionHistoryPanel versions={versions} onClose={() => setShowHistory(false)} />
              </div>
            )}
          </div>

          {/* Export */}
          <button onClick={() => exportToCSV(accounts)} title="Exportar CSV"
            className="p-1.5 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            <Download size={14} />
          </button>

          {/* Save */}
          <button onClick={() => saveBuilderLines(dirtySubIds)} disabled={dirtySubIds.size === 0 || saveState === "saving"}
            className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <Save size={13} />{dirtySubIds.size > 0 ? `Guardar (${dirtySubIds.size})` : "Guardado"}
          </button>

          {/* Publish */}
          <button onClick={() => setShowPublish(true)}
            className="px-4 py-1.5 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:opacity-90"
            style={{ backgroundColor: BRAND }}>
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
  // TOPSHEET
  // ─────────────────────────────────────────────
  if (view === "topsheet") return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {Header}
      <div className="px-6 md:px-10 xl:px-16 py-6">
        {/* Top bar with chart + actions */}
        {accounts.length > 0 && (
          <div className="flex items-center justify-between mb-6 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex-1 max-w-xs">
              <DonutChart accounts={accounts} />
            </div>
            <div className="flex items-center gap-3 ml-auto">
              <button onClick={() => setShowCreateAccount(true)}
                className="px-4 py-2 text-xs font-semibold text-white rounded-xl flex items-center gap-1.5 hover:opacity-90 shadow-sm"
                style={{ backgroundColor: BRAND }}>
                <FolderPlus size={13} /> Nueva cuenta
              </button>
            </div>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center bg-white">
            <FileSpreadsheet size={32} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 text-sm mb-1 font-medium">Sin cuentas de presupuesto</p>
            <p className="text-slate-400 text-xs mb-5">Crea la primera cuenta o importa desde el presupuesto</p>
            <button onClick={() => setShowCreateAccount(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl hover:opacity-90"
              style={{ backgroundColor: BRAND }}>
              <FolderPlus size={15} /> Crear primera cuenta
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 80px" }}>
              {["Código", "Descripción", "Presupuestado", "% total", "Distribución", ""].map((h, i) => (
                <div key={i} className={`px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i >= 2 ? "text-right" : ""}`}>{h}</div>
              ))}
            </div>
            {accounts.map((account) => {
              const t = getAccountTotal(account);
              const p = pct(t, grandTotal);
              return (
                <div key={account.id}
                  className="grid border-b border-slate-100 hover:bg-slate-50/60 transition-colors group"
                  style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 80px" }}>
                  <div className="px-4 py-4 font-bold text-xs text-slate-900 flex items-center font-mono cursor-pointer" onClick={() => goToAccount(account.id)}>{account.code}</div>
                  <div className="px-4 py-4 font-semibold text-sm text-slate-900 flex items-center gap-2 cursor-pointer" onClick={() => goToAccount(account.id)}>
                    {account.description}
                    <span className="text-[10px] text-slate-400 font-normal">{account.subAccounts.length} sub.</span>
                  </div>
                  <div className="px-4 py-4 text-right font-bold text-sm text-slate-900 flex items-center justify-end font-mono tabular-nums cursor-pointer" onClick={() => goToAccount(account.id)}>{fmt(t)} €</div>
                  <div className="px-4 py-4 text-right text-sm text-slate-500 flex items-center justify-end tabular-nums cursor-pointer" onClick={() => goToAccount(account.id)}>{p}%</div>
                  <div className="px-4 py-4 flex items-center cursor-pointer" onClick={() => goToAccount(account.id)}>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: BRAND }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 px-3">
                    <button onClick={() => goToAccount(account.id)}
                      className="p-1.5 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <ChevronRight size={14} />
                    </button>
                    <button onClick={() => handleDeleteAccount(account.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Footer */}
            <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: "100px 1fr 140px 80px 160px 80px" }}>
              <div />
              <div className="px-4 py-3.5 text-xs font-bold flex items-center">TOTAL PRESUPUESTO</div>
              <div className="px-4 py-3.5 text-right text-sm font-bold font-mono tabular-nums flex items-center justify-end">{fmt(grandTotal)} €</div>
              <div className="px-4 py-3.5 text-right text-sm font-bold flex items-center justify-end">100%</div>
              <div /><div />
            </div>
          </div>
        )}

        {/* Add account inline button */}
        {accounts.length > 0 && (
          <button onClick={() => setShowCreateAccount(true)}
            className="mt-3 text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors">
            <Plus size={11} /> añadir cuenta
          </button>
        )}
      </div>

      {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} label={publishLabel} setLabel={setPublishLabel} />}
      {showCreateAccount && (
        <CreateAccountModal type="account" onConfirm={handleCreateAccount} onCancel={() => setShowCreateAccount(false)}
          existingCodes={accounts.map((a) => a.code)} />
      )}
      {showSearch && <GlobalSearch accounts={accounts} onNavigate={handleSearchNavigate} onClose={() => setShowSearch(false)} />}
      {Toasts}
    </div>
  );

  // ─────────────────────────────────────────────
  // ACCOUNT VIEW
  // ─────────────────────────────────────────────
  if (view === "account" && activeAccount) return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {Header}
      <div className="px-6 md:px-10 xl:px-16 py-6">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{activeAccount.code} · {activeAccount.description}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{activeAccount.subAccounts.length} subcuentas · {fmt(getAccountTotal(activeAccount))} € total</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCreateSubaccount(true)}
              className="px-4 py-2 text-xs font-semibold text-white rounded-xl flex items-center gap-1.5 hover:opacity-90"
              style={{ backgroundColor: BRAND }}>
              <FilePlus size={13} /> Nueva subcuenta
            </button>
            <button onClick={() => handleDeleteAccount(activeAccount.id)}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 rounded-xl transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {activeAccount.subAccounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center bg-white">
            <p className="text-slate-500 text-sm mb-4">Esta cuenta no tiene subcuentas todavía.</p>
            <button onClick={() => setShowCreateSubaccount(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-xl hover:opacity-90"
              style={{ backgroundColor: BRAND }}>
              <FilePlus size={13} /> Crear subcuenta
            </button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 80px" }}>
              {["Código", "Descripción", "Líneas", "Presupuestado", "% cuenta", "Distribución", ""].map((h, i) => (
                <div key={i} className={`px-4 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i >= 2 ? "text-right" : ""}`}>{h}</div>
              ))}
            </div>
            {activeAccount.subAccounts.map((sub) => {
              const accTotal = getAccountTotal(activeAccount);
              const p = pct(sub.budgeted, accTotal);
              return (
                <div key={sub.id}
                  className="grid border-b border-slate-100 hover:bg-slate-50/60 transition-colors group"
                  style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 80px" }}>
                  <div className="px-4 py-3.5 text-xs text-slate-500 font-mono font-medium flex items-center cursor-pointer" onClick={() => goToSubaccount(sub.id)}>{sub.code}</div>
                  <div className="px-4 py-3.5 text-sm text-slate-800 font-medium flex items-center gap-2 cursor-pointer" onClick={() => goToSubaccount(sub.id)}>
                    {sub.description}
                    {dirtySubIds.has(sub.id) && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
                  </div>
                  <div className="px-4 py-3.5 text-right text-xs text-slate-400 flex items-center justify-end cursor-pointer" onClick={() => goToSubaccount(sub.id)}>{sub.lines.length}</div>
                  <div className="px-4 py-3.5 text-right font-semibold text-sm text-slate-900 flex items-center justify-end font-mono tabular-nums cursor-pointer" onClick={() => goToSubaccount(sub.id)}>{fmt(sub.budgeted)} €</div>
                  <div className="px-4 py-3.5 text-right text-sm text-slate-500 flex items-center justify-end cursor-pointer" onClick={() => goToSubaccount(sub.id)}>{p}%</div>
                  <div className="px-4 py-3.5 flex items-center cursor-pointer" onClick={() => goToSubaccount(sub.id)}>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, backgroundColor: BRAND }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1 px-3">
                    <button onClick={() => goToSubaccount(sub.id)}
                      className="p-1.5 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <ChevronRight size={14} />
                    </button>
                    <button onClick={() => handleDeleteSubaccount(sub.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: "100px 1fr 80px 140px 80px 160px 80px" }}>
              <div /><div className="px-4 py-3 text-xs font-bold flex items-center">TOTAL {activeAccount.code}</div>
              <div />
              <div className="px-4 py-3 text-right text-sm font-bold font-mono tabular-nums flex items-center justify-end">{fmt(getAccountTotal(activeAccount))} €</div>
              <div className="px-4 py-3 text-right text-sm font-bold flex items-center justify-end">100%</div>
              <div /><div />
            </div>
          </div>
        )}
        {activeAccount.subAccounts.length > 0 && (
          <button onClick={() => setShowCreateSubaccount(true)}
            className="mt-3 text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors">
            <Plus size={11} /> añadir subcuenta
          </button>
        )}
      </div>

      {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} label={publishLabel} setLabel={setPublishLabel} />}
      {showCreateSubaccount && (
        <CreateAccountModal type="subaccount" onConfirm={handleCreateSubaccount} onCancel={() => setShowCreateSubaccount(false)}
          existingCodes={activeAccount.subAccounts.map((s) => s.code)} />
      )}
      {showSearch && <GlobalSearch accounts={accounts} onNavigate={handleSearchNavigate} onClose={() => setShowSearch(false)} />}
      {Toasts}
    </div>
  );

  // ─────────────────────────────────────────────
  // SUBACCOUNT VIEW
  // ─────────────────────────────────────────────
  if (view === "subaccount" && activeSub) {
    const cols = "24px 36px 1fr 90px 90px 110px 64px 110px 40px";
    const hasSelection = selectedLines.size > 0;

    return (
      <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
        {Header}
        <div className="flex" style={{ height: "calc(100vh - 4.5rem - 57px)" }}>
          {/* Main */}
          <div className={`flex-1 overflow-auto ${activeLine ? "mr-72" : ""}`}>
            <div className="px-6 md:px-8 py-5">
              {/* Sub header */}
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{activeSub.code} · {activeSub.description}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">{activeSub.lines.length} líneas de detalle</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Bulk action bar */}
                  {hasSelection && (
                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 relative">
                      <span className="text-xs font-semibold text-blue-700">{selectedLines.size} seleccionadas</span>
                      <button onClick={() => setShowBulkMenu(!showBulkMenu)}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border-l border-blue-200 pl-2">
                        Acción <ChevronDown size={11} />
                      </button>
                      {showBulkMenu && (
                        <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1.5 min-w-[180px]">
                          <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Cambiar categoría</div>
                          {(Object.entries(CATEGORY_CONFIG) as [LineCategory, typeof CATEGORY_CONFIG[LineCategory]][]).map(([cat, cfg]) => (
                            <button key={cat} onClick={() => bulkSetCategory(activeSub.id, cat)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${cfg.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} /> {cfg.label}
                            </button>
                          ))}
                          <div className="border-t border-slate-100 mt-1 pt-1">
                            <button onClick={() => bulkDeleteLines(activeSub.id)}
                              className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2">
                              <Trash2 size={11} /> Eliminar seleccionadas
                            </button>
                          </div>
                        </div>
                      )}
                      <button onClick={() => { setSelectedLines(new Set()); setShowBulkMenu(false); }}
                        className="ml-1 p-0.5 text-blue-400 hover:text-blue-700">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums">{fmt(activeSub.budgeted)} €</p>
                    <p className="text-xs text-slate-400">presupuestado</p>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: cols }}>
                  {/* Checkbox col header */}
                  <div className="px-2 py-2.5 flex items-center justify-center">
                    <input type="checkbox"
                      checked={selectedLines.size === activeSub.lines.length && activeSub.lines.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedLines(new Set(activeSub.lines.map((l) => l.id)));
                        else setSelectedLines(new Set());
                      }}
                      className="w-3 h-3 rounded accent-blue-600"
                    />
                  </div>
                  {["#", "Descripción", "Cant.", "Períodos", "Tarifa", "Ud.", "Total", ""].map((h, i) => (
                    <div key={i} className={`px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${i === 0 ? "text-center" : i >= 2 && i <= 6 ? "text-right" : ""}`}>{h}</div>
                  ))}
                </div>

                {activeSub.lines.length === 0 ? (
                  <div className="px-8 py-12 text-center">
                    <p className="text-sm text-slate-400 mb-3">No hay líneas de detalle.</p>
                    <button onClick={() => addLine(activeSub.id)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white rounded-xl hover:opacity-90"
                      style={{ backgroundColor: BRAND }}>
                      <Plus size={13} /> Añadir primera línea
                    </button>
                  </div>
                ) : (
                  <>
                    {activeSub.lines.map((line, idx) => {
                      const isSelected = selectedLineId === line.id;
                      const isChecked  = selectedLines.has(line.id);
                      const catCfg = CATEGORY_CONFIG[line.category];
                      return (
                        <div key={line.id}
                          className={`grid border-b border-slate-100 transition-colors group/line ${
                            isSelected ? "bg-blue-50/60 border-l-2 border-l-blue-400" :
                            isChecked  ? "bg-blue-50/30" : "hover:bg-slate-50/60"
                          }`}
                          style={{ gridTemplateColumns: cols }}>

                          {/* Checkbox */}
                          <div className="flex items-center justify-center py-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isChecked}
                              onChange={(e) => {
                                const n = new Set(selectedLines);
                                if (e.target.checked) n.add(line.id); else n.delete(line.id);
                                setSelectedLines(n);
                              }}
                              className="w-3 h-3 rounded accent-blue-600"
                            />
                          </div>

                          {/* # + dot */}
                          <div className="flex items-center justify-center gap-1 py-2 cursor-pointer" onClick={() => setSelectedLineId(isSelected ? null : line.id)}>
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: catCfg.hex }} />
                            <span className="text-[10px] text-slate-300 font-mono">{String(idx + 1).padStart(2, "0")}</span>
                          </div>

                          {/* Description */}
                          <div className="px-1 py-1.5 flex items-center min-w-0" onClick={(e) => e.stopPropagation()}>
                            <EditableText value={line.description}
                              onChange={(v) => updateLine(activeSub.id, line.id, { description: v })}
                              placeholder="Descripción del concepto..." />
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
                            <UnitSelector value={line.unit} onChange={(u) => updateLine(activeSub.id, line.id, { unit: u })} />
                          </div>

                          {/* Total */}
                          <div className="px-2 py-1.5 flex items-center justify-end cursor-pointer" onClick={() => setSelectedLineId(isSelected ? null : line.id)}>
                            <span className={`text-xs font-mono font-semibold tabular-nums ${line.total > 0 ? "text-slate-900" : "text-slate-300"}`}>
                              {line.total > 0 ? fmt(line.total) : "—"}
                            </span>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-center gap-0.5 opacity-0 group-hover/line:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => duplicateLine(activeSub.id, line.id)}
                              className="p-1 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors" title="Duplicar">
                              <Copy size={10} />
                            </button>
                            <button onClick={() => deleteLine(activeSub.id, line.id)}
                              className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Eliminar">
                              <X size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add line */}
                    <div className="px-8 py-2 border-b border-slate-100">
                      <button onClick={() => addLine(activeSub.id)}
                        className="text-[11px] text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                        <Plus size={11} /> añadir línea
                      </button>
                    </div>
                  </>
                )}

                {/* Subtotal */}
                <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: cols }}>
                  <div /><div />
                  <div className="px-2 py-3 text-xs font-bold col-span-2">SUBTOTAL {activeSub.code}</div>
                  <div className="col-span-3" />
                  <div className="px-2 py-3 text-right text-xs font-bold font-mono tabular-nums">{fmt(activeSub.budgeted)} €</div>
                  <div />
                </div>
              </div>

              {/* Category summary */}
              {activeSub.lines.length > 0 && <CategorySummary lines={activeSub.lines} />}

              {/* Formula hint */}
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <Hash size={12} />
                <span>Fórmulas: <code className="bg-slate-100 px-1 rounded text-blue-600">semanas_rodaje * 800</code> · <code className="bg-slate-100 px-1 rounded text-blue-600">dias_rodaje / 5</code> · <kbd className="bg-slate-100 px-1 rounded">⌘K</kbd> para buscar</span>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          {activeLine && (
            <div className="fixed right-0 top-[calc(4.5rem+57px)] bottom-0 w-72 z-10">
              <LineSidebar line={activeLine}
                onUpdate={(patch) => updateLine(activeSub.id, activeLine.id, patch)}
                onClose={() => setSelectedLineId(null)}
                onDuplicate={() => { duplicateLine(activeSub.id, activeLine.id); setSelectedLineId(null); }}
                onDelete={() => { deleteLine(activeSub.id, activeLine.id); }}
              />
            </div>
          )}
        </div>

        {showPublish && <PublishModal accounts={accounts} onConfirm={handlePublish} onCancel={() => setShowPublish(false)} publishing={publishing} label={publishLabel} setLabel={setPublishLabel} />}
        {showSearch && <GlobalSearch accounts={accounts} onNavigate={handleSearchNavigate} onClose={() => setShowSearch(false)} />}
        {Toasts}
      </div>
    );
  }

  return null;
}
