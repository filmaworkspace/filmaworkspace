"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import {
  doc, getDoc, collection, getDocs, query, orderBy,
  writeBatch,
} from "firebase/firestore";
import {
  ArrowLeft, Plus, ChevronDown, ChevronRight, X,
  Eye, EyeOff, Calculator, AlertCircle, CheckCircle,
  FileSpreadsheet, Save, Upload, Loader2, ShieldAlert,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type Unit = "day" | "week" | "month" | "flat" | "unit" | "hour";
type SaveState = "idle" | "saving" | "saved" | "error";

interface DetailLine {
  id: string;
  description: string;
  quantity: number;
  periods: number;
  rate: number;
  unit: Unit;
  total: number;
}

interface SubAccount {
  id: string;
  code: string;
  description: string;
  budgeted: number;
  lines: DetailLine[];
}

interface Account {
  id: string;
  code: string;
  description: string;
  subAccounts: SubAccount[];
}

const UNIT_LABELS: Record<Unit, string> = {
  day: "día", week: "sem", month: "mes", flat: "pack", unit: "ud", hour: "h",
};
const UNIT_OPTIONS: Unit[] = ["day", "week", "month", "flat", "unit", "hour"];

const calcTotal = (q: number, p: number, r: number) => q * p * r;
const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const getAccountTotal = (a: Account) => a.subAccounts.reduce((s, sub) => s + sub.budgeted, 0);
const getGrandTotal = (accounts: Account[]) => accounts.reduce((s, a) => s + getAccountTotal(a), 0);

function EditableCell({ value, onChange, min = 0, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => { onChange(parseFloat(raw.replace(",", ".")) || 0); setEditing(false); };
  if (editing) return (
    <input ref={ref} type="number" value={raw} min={min} step={step}
      onChange={(e) => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { setRaw(String(value)); setEditing(false); }
      }}
      className="w-full text-right bg-blue-50 border border-blue-400 rounded px-1 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
  return (
    <div onClick={() => { setRaw(String(value)); setEditing(true); }}
      className="text-right px-1 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs font-mono select-none w-full">
      {value === 0 ? <span className="text-slate-300">0</span> : fmt(value)}
    </div>
  );
}

function EditableText({ value, onChange, placeholder = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const commit = () => { onChange(raw); setEditing(false); };
  if (editing) return (
    <input ref={ref} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setRaw(value); setEditing(false); }
      }}
      placeholder={placeholder}
      className="w-full bg-blue-50 border border-blue-400 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
  return (
    <div onClick={() => { setRaw(value); setEditing(true); }}
      className={`px-1.5 py-0.5 rounded cursor-text hover:bg-slate-100 text-xs truncate ${value ? "text-slate-800" : "text-slate-300"}`}>
      {value || placeholder}
    </div>
  );
}

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

function PublishModal({ accounts, onConfirm, onCancel, publishing }: {
  accounts: Account[]; onConfirm: () => void; onCancel: () => void; publishing: boolean;
}) {
  const grandTotal = getGrandTotal(accounts);
  const subCount = accounts.reduce((s, a) => s + a.subAccounts.length, 0);
  const lineCount = accounts.reduce((s, a) => s + a.subAccounts.reduce((ss, sub) => ss + sub.lines.length, 0), 0);
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#EEF1FD" }}>
              <Upload size={20} style={{ color: "#2F52E0" }} />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Publicar presupuesto</h2>
          </div>
          <p className="text-sm text-slate-500 mt-2 ml-[52px]">
            Actualizará el campo <strong>Presupuestado</strong> de cada subcuenta con el total calculado de sus líneas de detalle.
          </p>
        </div>
        <div className="px-6 py-4 grid grid-cols-3 gap-3">
          {[
            { label: "Cuentas", value: accounts.length },
            { label: "Subcuentas", value: subCount },
            { label: "Líneas", value: lineCount },
          ].map((s) => (
            <div key={s.label} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-200">
              <p className="text-xl font-bold text-slate-900">{s.value}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="px-6 pb-2">
          <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-slate-400">Total presupuestado</span>
            <span className="text-base font-bold text-white font-mono tabular-nums">{fmt(grandTotal)} €</span>
          </div>
        </div>
        <div className="px-6 py-3">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Solo se sobreescribe <strong>Presupuestado</strong>. Comprometido, realizado y caja no se modifican.</span>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
          <button onClick={onCancel} disabled={publishing}
            className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={publishing}
            className="px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
            style={{ backgroundColor: "#2F52E0" }}>
            {publishing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {publishing ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BudgetBuilderPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedSubAccounts, setExpandedSubAccounts] = useState<Set<string>>(new Set());
  const [dirtySubIds, setDirtySubIds] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => { if (u) setUserId(u.uid); });
    return () => unsub();
  }, []);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);

  useEffect(() => {
    if (dirtySubIds.size === 0) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { saveBuilderLines(dirtySubIds); }, 1200);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [dirtySubIds, accounts]);

  const loadData = async () => {
    try {
      setLoading(true);
      const upSnap = await getDoc(doc(db, `userProjects/${userId}/projects/${id}`));
      if (!upSnap.exists()) { setLoading(false); return; }
      const upData = upSnap.data();
      const hasAccounting = upData.permissions?.accounting || false;
      const level = upData.accountingAccessLevel;
      const memberSnap = await getDoc(doc(db, `projects/${id}/members`, userId!));
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role);
      const isExtended = level === "accounting_extended";
      if (!hasAccounting || (!isEPorPM && !isExtended)) { setLoading(false); return; }
      setHasAccess(true);
      const projSnap = await getDoc(doc(db, "projects", id));
      if (projSnap.exists()) setProjectName(projSnap.data().name || "Proyecto");
      const aSnap = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const loaded: Account[] = await Promise.all(
        aSnap.docs.map(async (aDoc) => {
          const sSnap = await getDocs(query(collection(db, `projects/${id}/accounts/${aDoc.id}/subaccounts`), orderBy("code", "asc")));
          const subs: SubAccount[] = sSnap.docs.map((sDoc) => {
            const sd = sDoc.data();
            const rawLines: any[] = sd.builderLines || [];
            const lines: DetailLine[] = rawLines.map((l: any) => ({
              id: l.id || crypto.randomUUID(),
              description: l.description || "",
              quantity: l.quantity ?? 1,
              periods: l.periods ?? 1,
              rate: l.rate ?? 0,
              unit: (l.unit as Unit) || "day",
              total: calcTotal(l.quantity ?? 1, l.periods ?? 1, l.rate ?? 0),
            }));
            const budgeted = lines.length > 0 ? lines.reduce((s, l) => s + l.total, 0) : (sd.budgeted || 0);
            return { id: sDoc.id, code: sd.code || "", description: sd.description || "", budgeted, lines };
          });
          return { id: aDoc.id, code: aDoc.data().code || "", description: aDoc.data().description || "", subAccounts: subs };
        })
      );
      setAccounts(loaded);
      setExpandedAccounts(new Set(loaded.map((a) => a.id)));
    } catch (err: any) {
      setErrorMessage(`Error al cargar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

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
        const subRef = doc(db, `projects/${id}/accounts/${foundAccountId}/subaccounts`, subId);
        batch.update(subRef, {
          builderLines: foundSub.lines.map((l) => ({
            id: l.id, description: l.description, quantity: l.quantity,
            periods: l.periods, rate: l.rate, unit: l.unit, total: l.total,
          })),
        });
      }
      await batch.commit();
      setDirtySubIds(new Set());
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
    } catch (err: any) {
      setSaveState("error");
      setErrorMessage(`Error al guardar: ${err.message}`);
    }
  }, [accounts, id]);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      const batch = writeBatch(db);
      for (const account of accounts) {
        for (const sub of account.subAccounts) {
          const subRef = doc(db, `projects/${id}/accounts/${account.id}/subaccounts`, sub.id);
          batch.update(subRef, {
            budgeted: sub.budgeted,
            builderLines: sub.lines.map((l) => ({
              id: l.id, description: l.description, quantity: l.quantity,
              periods: l.periods, rate: l.rate, unit: l.unit, total: l.total,
            })),
          });
        }
      }
      await batch.commit();
      setDirtySubIds(new Set());
      setSaveState("saved");
      setShowPublishModal(false);
      setSuccessMessage("Presupuesto publicado correctamente");
      setTimeout(() => { setSaveState("idle"); setSuccessMessage(""); }, 3000);
    } catch (err: any) {
      setErrorMessage(`Error al publicar: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const markDirty = (subAccountId: string) => {
    setDirtySubIds((prev) => new Set([...prev, subAccountId]));
    setSaveState("idle");
  };

  const addLine = (accountId: string, subAccountId: string) => {
    const newLine: DetailLine = { id: crypto.randomUUID(), description: "", quantity: 1, periods: 1, rate: 0, unit: "day", total: 0 };
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => s.id !== subAccountId ? s : { ...s, lines: [...s.lines, newLine] }),
    }));
    setExpandedSubAccounts((prev) => new Set([...prev, subAccountId]));
    markDirty(subAccountId);
  };

  const updateLine = (accountId: string, subAccountId: string, lineId: string, patch: Partial<DetailLine>) => {
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subAccountId) return s;
        const lines = s.lines.map((l) => {
          if (l.id !== lineId) return l;
          const u = { ...l, ...patch };
          u.total = calcTotal(u.quantity, u.periods, u.rate);
          return u;
        });
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    markDirty(subAccountId);
  };

  const deleteLine = (accountId: string, subAccountId: string, lineId: string) => {
    setAccounts((prev) => prev.map((a) => a.id !== accountId ? a : {
      ...a, subAccounts: a.subAccounts.map((s) => {
        if (s.id !== subAccountId) return s;
        const lines = s.lines.filter((l) => l.id !== lineId);
        return { ...s, lines, budgeted: lines.reduce((sum, l) => sum + l.total, 0) };
      }),
    }));
    markDirty(subAccountId);
  };

  const toggleAccount    = (aid: string) => setExpandedAccounts((p) => { const n = new Set(p); n.has(aid) ? n.delete(aid) : n.add(aid); return n; });
  const toggleSubAccount = (sid: string) => setExpandedSubAccounts((p) => { const n = new Set(p); n.has(sid) ? n.delete(sid) : n.add(sid); return n; });
  const expandAll  = () => { setExpandedAccounts(new Set(accounts.map((a) => a.id))); setExpandedSubAccounts(new Set(accounts.flatMap((a) => a.subAccounts.map((s) => s.id)))); };
  const collapseAll = () => { setExpandedAccounts(new Set()); setExpandedSubAccounts(new Set()); };

  const grandTotal = getGrandTotal(accounts);
  const cols = "32px 100px 1fr 72px 72px 110px 64px 110px 36px";

  if (loading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
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

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* HEADER */}
      <div className="mt-[4.5rem] border-b border-slate-200 bg-white sticky top-[4.5rem] z-20 shadow-sm">
        <div className="px-6 md:px-10 xl:px-16 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href={`/project/${id}/accounting/budget`}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div className="flex items-center gap-2">
              <Calculator size={18} style={{ color: "#2F52E0" }} />
              <span className="font-semibold text-slate-900 text-sm">Constructor</span>
              <span className="text-slate-300 text-sm">·</span>
              <span className="text-slate-500 text-sm">{projectName}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Save indicator */}
            <div className={`flex items-center gap-1.5 text-xs transition-opacity duration-300 ${saveState === "idle" ? "opacity-0" : "opacity-100"}`}>
              {saveState === "saving" && <><Loader2 size={12} className="animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
              {saveState === "saved"  && <><CheckCircle size={12} className="text-emerald-500" /><span className="text-emerald-600">Guardado</span></>}
              {saveState === "error"  && <><AlertCircle size={12} className="text-red-500" /><span className="text-red-600">Error al guardar</span></>}
            </div>

            <button onClick={expandAll}
              className="px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition-colors">
              <Eye size={13} /> Expandir
            </button>
            <button onClick={collapseAll}
              className="px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition-colors">
              <EyeOff size={13} /> Colapsar
            </button>

            <button onClick={() => saveBuilderLines(dirtySubIds)}
              disabled={dirtySubIds.size === 0 || saveState === "saving"}
              className="px-3 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Save size={13} />
              {dirtySubIds.size > 0 ? `Guardar (${dirtySubIds.size})` : "Guardado"}
            </button>

            <button onClick={() => setShowPublishModal(true)}
              className="px-4 py-1.5 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#2F52E0" }}>
              <Upload size={13} /> Publicar
            </button>

            <div className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-mono font-bold tabular-nums ml-1">
              {fmt(grandTotal)} €
            </div>
          </div>
        </div>
      </div>

      {/* TABLE */}
      <div className="px-6 md:px-10 xl:px-16 py-6">
        {accounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <FileSpreadsheet size={32} className="text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm mb-1">No hay cuentas creadas.</p>
            <p className="text-slate-400 text-xs mb-4">Créalas en la vista de presupuesto y vuelve aquí a detallar las partidas.</p>
            <Link href={`/project/${id}/accounting/budget`} className="text-blue-600 text-sm hover:underline">Ir al presupuesto →</Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">

            {/* Column headers */}
            <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: cols }}>
              {[
                { label: "", cls: "" }, { label: "Código", cls: "" },
                { label: "Descripción / Concepto", cls: "" },
                { label: "Cant.", cls: "text-right" }, { label: "Perío.", cls: "text-right" },
                { label: "Tarifa", cls: "text-right" }, { label: "Ud.", cls: "text-right" },
                { label: "Total", cls: "text-right" }, { label: "", cls: "" },
              ].map((col, i) => (
                <div key={i} className={`px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider ${col.cls}`}>
                  {col.label}
                </div>
              ))}
            </div>

            {accounts.map((account) => {
              const accountTotal = getAccountTotal(account);
              const isExpanded = expandedAccounts.has(account.id);
              return (
                <React.Fragment key={account.id}>

                  {/* Account row */}
                  <div className="grid border-b border-slate-200 bg-slate-50/80 hover:bg-slate-100/60 transition-colors"
                    style={{ gridTemplateColumns: cols }}>
                    <div className="flex items-center justify-center">
                      <button onClick={() => toggleAccount(account.id)} className="p-0.5 text-slate-400 hover:text-slate-900">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                    <div className="px-2 py-2.5 font-bold text-xs text-slate-900 flex items-center">{account.code}</div>
                    <div className="px-2 py-2.5 font-semibold text-xs text-slate-900 flex items-center">{account.description}</div>
                    <div className="col-span-4" />
                    <div className="px-2 py-2.5 font-bold text-xs text-slate-900 flex items-center justify-end font-mono tabular-nums">
                      {fmt(accountTotal)}
                    </div>
                    <div />
                  </div>

                  {isExpanded && account.subAccounts.map((sub) => {
                    const subExpanded = expandedSubAccounts.has(sub.id);
                    const isDirty = dirtySubIds.has(sub.id);
                    return (
                      <React.Fragment key={sub.id}>

                        {/* SubAccount row */}
                        <div className="grid border-b border-slate-100 hover:bg-slate-50/60 transition-colors group"
                          style={{ gridTemplateColumns: cols }}>
                          <div className="flex items-center justify-center pl-3">
                            <button onClick={() => toggleSubAccount(sub.id)} className="p-0.5 text-slate-300 hover:text-slate-700">
                              {subExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          </div>
                          <div className="px-2 py-2 text-xs text-slate-500 font-medium flex items-center">{sub.code}</div>
                          <div className="px-2 py-2 text-xs text-slate-700 font-medium flex items-center gap-1.5">
                            {sub.description}
                            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Cambios sin guardar" />}
                          </div>
                          <div className="col-span-4" />
                          <div className="px-2 py-2 text-right text-xs text-slate-700 font-semibold flex items-center justify-end font-mono tabular-nums">
                            {fmt(sub.budgeted)}
                          </div>
                          <div className="flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => addLine(account.id, sub.id)} title="Añadir línea"
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Detail lines */}
                        {subExpanded && (
                          <>
                            {sub.lines.length === 0 ? (
                              <div className="grid border-b border-slate-100 bg-slate-50/20" style={{ gridTemplateColumns: cols }}>
                                <div className="col-span-9 px-14 py-2.5">
                                  <button onClick={() => addLine(account.id, sub.id)}
                                    className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                                    <Plus size={12} /> Añadir primera línea de detalle
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {sub.lines.map((line, lineIdx) => (
                                  <div key={line.id}
                                    className="grid border-b border-slate-100 hover:bg-blue-50/20 transition-colors group/line"
                                    style={{ gridTemplateColumns: cols }}>
                                    <div className="flex items-center justify-end pr-2">
                                      <div className="w-2 h-px bg-slate-200" />
                                    </div>
                                    <div className="px-2 py-1.5 flex items-center">
                                      <span className="text-[10px] text-slate-300 font-mono select-none">
                                        {String(lineIdx + 1).padStart(2, "0")}
                                      </span>
                                    </div>
                                    <div className="px-1 py-1 flex items-center min-w-0">
                                      <EditableText value={line.description}
                                        onChange={(v) => updateLine(account.id, sub.id, line.id, { description: v })}
                                        placeholder="Descripción del concepto..." />
                                    </div>
                                    <div className="px-1 py-1 flex items-center">
                                      <EditableCell value={line.quantity} min={0} step={1}
                                        onChange={(v) => updateLine(account.id, sub.id, line.id, { quantity: v })} />
                                    </div>
                                    <div className="px-1 py-1 flex items-center">
                                      <EditableCell value={line.periods} min={0} step={1}
                                        onChange={(v) => updateLine(account.id, sub.id, line.id, { periods: v })} />
                                    </div>
                                    <div className="px-1 py-1 flex items-center">
                                      <EditableCell value={line.rate} min={0} step={0.01}
                                        onChange={(v) => updateLine(account.id, sub.id, line.id, { rate: v })} />
                                    </div>
                                    <div className="px-1 py-1 flex items-center">
                                      <UnitSelector value={line.unit}
                                        onChange={(u) => updateLine(account.id, sub.id, line.id, { unit: u })} />
                                    </div>
                                    <div className="px-2 py-1.5 flex items-center justify-end">
                                      <span className={`text-xs font-mono font-semibold tabular-nums ${line.total > 0 ? "text-slate-900" : "text-slate-300"}`}>
                                        {line.total > 0 ? fmt(line.total) : "—"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-center opacity-0 group-hover/line:opacity-100 transition-opacity">
                                      <button onClick={() => deleteLine(account.id, sub.id, line.id)}
                                        className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors" title="Eliminar línea">
                                        <X size={12} />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                <div className="grid border-b border-slate-100 bg-white" style={{ gridTemplateColumns: cols }}>
                                  <div className="col-span-9 px-14 py-1.5">
                                    <button onClick={() => addLine(account.id, sub.id)}
                                      className="text-[11px] text-slate-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors">
                                      <Plus size={11} /> añadir línea
                                    </button>
                                  </div>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* Grand total */}
            <div className="grid bg-slate-900 text-white" style={{ gridTemplateColumns: cols }}>
              <div />
              <div className="px-2 py-3 text-xs font-bold col-span-2 flex items-center">TOTAL PRESUPUESTO</div>
              <div className="col-span-4" />
              <div className="px-2 py-3 text-right text-xs font-bold font-mono tabular-nums flex items-center justify-end">
                {fmt(grandTotal)} €
              </div>
              <div />
            </div>
          </div>
        )}
      </div>

      {/* Publish modal */}
      {showPublishModal && (
        <PublishModal accounts={accounts} onConfirm={handlePublish}
          onCancel={() => setShowPublishModal(false)} publishing={publishing} />
      )}

      {/* Toasts */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle size={16} /> {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} /> {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
