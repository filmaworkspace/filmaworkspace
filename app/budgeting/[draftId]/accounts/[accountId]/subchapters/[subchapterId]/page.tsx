"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Plus, Search, Sigma, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BudgetingAccount, BudgetingDetailLine, BudgetingDraft, BudgetingFringe, BudgetingSubchapter,
  ROW_INPUT, UNIT_SUGGESTIONS, computeFringeExtras, computeLineTotal, evaluateFieldExpr,
  fmtCurrency, fmtDecimal, isPlainNumber, lineFringeBreakdown, resolveGlobals,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

interface LineForm { code: string; description: string; units: string; unit: string; multiplier: string; rate: string; supplier: string; notes: string; tags: string; }
const emptyForm: LineForm = { code: "", description: "", units: "1", unit: "", multiplier: "1", rate: "0", supplier: "", notes: "", tags: "" };
const cols = "grid-cols-[90px_1fr_54px_64px_38px_70px_84px_78px]";

// ─── Fila en edición (alta/edición) — componente de módulo: nunca se
// redefine entre renders, así los inputs no pierden el foco al escribir. ────
function EditableLineRow({
  form, total, error, saving, onChange, onSave, onCancel,
}: {
  form: LineForm; total: number; error: string; saving: boolean;
  onChange: (patch: Partial<LineForm>) => void; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div>
      <div className={`grid ${cols} gap-1.5 items-center px-4 py-2 bg-[#8DA7BE]/[0.05]`}>
        <input autoFocus placeholder="Código" value={form.code} onChange={(e) => onChange({ code: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          className={`text-xs font-mono px-1.5 py-1 min-w-0 ${ROW_INPUT}`} />
        <input placeholder="Descripción" value={form.description} onChange={(e) => onChange({ description: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          className={`text-xs px-1.5 py-1 min-w-0 ${ROW_INPUT}`} />
        <input placeholder="Cant." value={form.units} onChange={(e) => onChange({ units: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          title="Número o fórmula con Globales, p.ej. DIAS_RODAJE"
          className={`text-xs text-right px-1.5 py-1 w-full ${ROW_INPUT}`} />
        <input list="unit-suggestions" placeholder="Unidad" value={form.unit} onChange={(e) => onChange({ unit: e.target.value })}
          className={`text-[11px] px-1.5 py-1 min-w-0 ${ROW_INPUT}`} />
        <input placeholder="X" value={form.multiplier} onChange={(e) => onChange({ multiplier: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          title="Número o fórmula con Globales"
          className={`text-[11px] text-right px-1.5 py-1 w-full ${ROW_INPUT}`} />
        <input placeholder="Tarifa" value={form.rate} onChange={(e) => onChange({ rate: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          title="Número o fórmula con Globales, p.ej. TARIFA_BASE * 1.2"
          className={`text-xs text-right px-1.5 py-1 w-full ${ROW_INPUT}`} />
        <span className="text-xs font-semibold text-slate-900 text-right">{fmtDecimal(total)}</span>
        <span className="flex items-center justify-end gap-0.5">
          <button onClick={onSave} disabled={saving} className="p-1.5 rounded-md text-white disabled:opacity-50" style={{ background: "#8DA7BE" }}><Check size={12} /></button>
          <button onClick={onCancel} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md"><X size={12} /></button>
        </span>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-2 pt-0.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}

function FringeChip({ fringe, amount, excluded }: { fringe: BudgetingFringe; amount: number; excluded: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border"
      style={{ borderColor: "#8DA7BE", color: "#1D201F", background: "#8DA7BE0d" }}
      title={excluded ? `No suma aquí — va a: ${fringe.scope === "chapter" ? "total del capítulo" : "total del presupuesto"}` : "Suma en este subcapítulo"}
    >
      {fringe.label} · {fmtDecimal(amount)}
      {excluded && <span className="text-[9px] text-slate-500 font-normal">excl.</span>}
    </span>
  );
}

function LineRow({
  line, fmt, fringes, isExpanded, fringePickerOpen,
  onEdit, onToggleExpand, onDuplicate, onDelete, onToggleFringePicker, onToggleFringe, onUpdateSecondary,
}: {
  line: BudgetingDetailLine; fmt: (n: number) => string; fringes: BudgetingFringe[];
  isExpanded: boolean; fringePickerOpen: boolean;
  onEdit: () => void; onToggleExpand: () => void; onDuplicate: () => void; onDelete: () => void;
  onToggleFringePicker: () => void; onToggleFringe: (id: string) => void;
  onUpdateSecondary: (patch: { supplier?: string; notes?: string; tags?: string[] }) => void;
}) {
  const breakdown = lineFringeBreakdown(line, fringes);
  const hasFormula = !!(line.unitsExpr || line.multiplierExpr || line.rateExpr);
  return (
    <div>
      <div className={`grid ${cols} gap-1.5 items-center px-4 py-1.5 hover:bg-slate-50 group`}>
        <button onClick={onEdit} className="text-xs font-mono text-slate-500 text-left truncate hover:text-[#8DA7BE] transition-colors">{line.code}</button>
        <button onClick={onEdit} className="text-xs text-slate-800 text-left truncate hover:text-[#8DA7BE] transition-colors flex items-center gap-1">
          {line.description}
          {hasFormula && <Sigma size={9} className="text-[#8DA7BE] flex-shrink-0" />}
        </button>
        <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.units)}</span>
        <span className="text-[11px] text-slate-400 truncate">{line.unit}</span>
        <span className="text-[11px] text-slate-400 text-right">×{fmtDecimal(line.multiplier)}</span>
        <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.rate)}</span>
        <span className="text-xs font-semibold text-slate-900 text-right">{fmt(line.total)}</span>
        <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onToggleExpand} className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Proveedor / notas / etiquetas / fringes">
            <ChevronDown size={11} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
          <button onClick={onDuplicate} className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Duplicar línea">
            <Copy size={11} />
          </button>
          <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
            <Trash2 size={11} />
          </button>
        </span>
      </div>
      {breakdown.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-1.5 pl-[calc(90px+0.375rem)]">
          {breakdown.map(({ fringe, amount }) => (
            <FringeChip key={fringe.id} fringe={fringe} amount={amount} excluded={fringe.scope !== "subchapter"} />
          ))}
        </div>
      )}
      {isExpanded && (
        <div className="px-4 pb-3 pl-[calc(90px+0.375rem)] space-y-2.5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Proveedor</label>
              <input defaultValue={line.supplier || ""} onBlur={(e) => onUpdateSecondary({ supplier: e.target.value.trim() })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Notas</label>
              <input defaultValue={line.notes || ""} onBlur={(e) => onUpdateSecondary({ notes: e.target.value.trim() })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Etiquetas (separadas por coma)</label>
              <input defaultValue={(line.tags || []).join(", ")} onBlur={(e) => onUpdateSecondary({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
          </div>
          <div className="relative">
            <label className="text-[10px] text-slate-400 block mb-1">Cargas sociales</label>
            <button onClick={onToggleFringePicker} className={`text-xs px-2.5 py-1 rounded-md ${ROW_INPUT} text-slate-600 hover:text-[#8DA7BE]`}>
              {line.fringeIds?.length ? `${line.fringeIds.length} aplicada(s) · añadir/quitar` : "Aplicar carga social..."}
            </button>
            {fringePickerOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 max-h-56 overflow-y-auto">
                {fringes.length === 0 ? (
                  <p className="text-[11px] text-slate-400 text-center py-3 px-3">Sin cargas sociales configuradas — añádelas en Cargas sociales.</p>
                ) : (
                  fringes.map((f) => {
                    const checked = (line.fringeIds || []).includes(f.id);
                    return (
                      <button key={f.id} onClick={() => onToggleFringe(f.id)} className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50">
                        <span className="text-xs text-slate-700 truncate">{f.label}</span>
                        <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${checked ? "border-[#8DA7BE]" : "border-slate-300"}`} style={{ background: checked ? "#8DA7BE" : "transparent" }}>
                          {checked && <Check size={9} className="text-white" />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BudgetingSubchapterPage() {
  const { draftId, accountId, subchapterId } = useParams() as { draftId: string; accountId: string; subchapterId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [chapter, setChapter] = useState<BudgetingAccount | null>(null);
  const [subchapter, setSubchapter] = useState<BudgetingSubchapter | null>(null);
  const [lines, setLines] = useState<BudgetingDetailLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [fringePickerFor, setFringePickerFor] = useState<string | null>(null);

  const [rowEditor, setRowEditor] = useState<{ mode: "new" | "edit"; lineId?: string; form: LineForm } | null>(null);
  const [lineError, setLineError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDetailLine | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, `budgetingDrafts/${draftId}/accounts`, accountId), (snap) => {
      if (snap.exists()) setChapter({ id: snap.id, ...snap.data() } as BudgetingAccount);
    });
    return () => unsub();
  }, [draftId, accountId]);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, subchapterId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setSubchapter({ id: snap.id, ...snap.data() } as BudgetingSubchapter);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId, accountId, subchapterId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), (snap) => {
      setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)));
    });
    return () => unsub();
  }, [draftId, accountId, subchapterId]);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const fringes = draft?.fringes || [];
  const globals = draft?.globals || [];
  const globalResolution = useMemo(() => resolveGlobals(globals), [JSON.stringify(globals)]);

  const linesTotal = lines.reduce((s, l) => s + (l.total || 0), 0);
  const fringeExtras = computeFringeExtras(lines, fringes);
  const total = Math.round((linesTotal + fringeExtras.subchapterScoped) * 100) / 100;

  const q = search.trim().toLowerCase();
  const matchesSearch = (l: BudgetingDetailLine) => !q || l.code.toLowerCase().includes(q) || l.description.toLowerCase().includes(q);

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const isLineCodeTaken = (code: string, excludeId?: string): boolean =>
    lines.some((l) => l.id !== excludeId && l.code.trim().toLowerCase() === code.trim().toLowerCase());

  const openNewRow = () => { setRowEditor({ mode: "new", form: { ...emptyForm } }); setLineError(""); };
  const openEditRow = (line: BudgetingDetailLine) => {
    setRowEditor({
      mode: "edit", lineId: line.id,
      form: {
        code: line.code, description: line.description,
        units: line.unitsExpr ?? String(line.units), unit: line.unit || "",
        multiplier: line.multiplierExpr ?? String(line.multiplier), rate: line.rateExpr ?? String(line.rate),
        supplier: line.supplier || "", notes: line.notes || "", tags: (line.tags || []).join(", "),
      },
    });
    setLineError("");
  };
  const closeRowEditor = () => { setRowEditor(null); setLineError(""); };

  const previewEval = (text: string) => evaluateFieldExpr(text, globalResolution.values).value;
  const rowEditorTotal = rowEditor
    ? computeLineTotal(previewEval(rowEditor.form.units), previewEval(rowEditor.form.multiplier), previewEval(rowEditor.form.rate))
    : 0;

  const handleSaveRow = async () => {
    if (!rowEditor) return;
    const code = rowEditor.form.code.trim();
    const description = rowEditor.form.description.trim();
    if (!code || !description) { closeRowEditor(); return; }
    if (isLineCodeTaken(code, rowEditor.lineId)) {
      setLineError("Ese código ya se usa en otra línea de este subcapítulo");
      return;
    }
    const unitsEval = evaluateFieldExpr(rowEditor.form.units, globalResolution.values);
    const multEval = evaluateFieldExpr(rowEditor.form.multiplier, globalResolution.values);
    const rateEval = evaluateFieldExpr(rowEditor.form.rate, globalResolution.values);
    const firstError = unitsEval.error || multEval.error || rateEval.error;
    if (firstError) { setLineError(firstError); return; }

    const total = computeLineTotal(unitsEval.value, multEval.value, rateEval.value);
    const tags = rowEditor.form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      const payload: any = {
        code, description,
        units: unitsEval.value, unitsExpr: isPlainNumber(rowEditor.form.units) ? null : rowEditor.form.units.trim(),
        unit: rowEditor.form.unit.trim(),
        multiplier: multEval.value, multiplierExpr: isPlainNumber(rowEditor.form.multiplier) ? null : rowEditor.form.multiplier.trim(),
        rate: rateEval.value, rateExpr: isPlainNumber(rowEditor.form.rate) ? null : rowEditor.form.rate.trim(),
        total,
        supplier: rowEditor.form.supplier.trim(), notes: rowEditor.form.notes.trim(), tags,
      };
      if (rowEditor.mode === "edit" && rowEditor.lineId) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, rowEditor.lineId), payload);
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), { ...payload, fringeIds: [], createdAt: Timestamp.now() });
      }
      await touchDraft();
      setRowEditor(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicateLine = async (line: BudgetingDetailLine) => {
    setSaving(true);
    try {
      let code = `${line.code}-copia`;
      let n = 2;
      while (isLineCodeTaken(code)) { code = `${line.code}-copia${n}`; n++; }
      await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), {
        code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
        multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
        supplier: line.supplier || "", notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
        createdAt: Timestamp.now(),
      });
      await touchDraft();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLine = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, deleteTarget.id));
      await touchDraft();
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFringe = async (line: BudgetingDetailLine, fringeId: string) => {
    const current = line.fringeIds || [];
    const next = current.includes(fringeId) ? current.filter((id) => id !== fringeId) : [...current, fringeId];
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, line.id), { fringeIds: next });
    await touchDraft();
  };

  const handleUpdateSecondary = async (line: BudgetingDetailLine, patch: { supplier?: string; notes?: string; tags?: string[] }) => {
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, line.id), patch);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !subchapter || !chapter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Este subcapítulo no existe.</p>
      </div>
    );
  }

  return (
    <div className="w-full px-10 py-6">
      {/* Breadcrumb — solo navegación de entrar/volver, sin categorías ni desplegables */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#8DA7BE] transition-colors">{draft?.name}</Link>
        <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
        <Link href={`/budgeting/${draftId}/accounts/${accountId}`} className="text-xs font-medium text-slate-600 hover:text-[#8DA7BE] transition-colors">{chapter.code} {chapter.description}</Link>
        <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
        <span className="text-xs font-semibold text-slate-900">{subchapter.code} {subchapter.description}</span>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-sm font-semibold" style={{ color: "#1D201F" }}>{subchapter.code} · {subchapter.description}</h1>
        <div className="relative w-44 flex-shrink-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar"
            className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
      </div>

      {/* Detail lines */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="min-w-[680px]">
          <div className={`grid ${cols} gap-1.5 px-4 py-2 border-b border-slate-200 divide-x divide-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
            <span>Código</span>
            <span>Descripción</span>
            <span className="text-right">Cant.</span>
            <span>Unidad</span>
            <span className="text-right">X</span>
            <span className="text-right">Tarifa</span>
            <span className="text-right">Total</span>
            <span></span>
          </div>
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
          </datalist>

          {lines.filter(matchesSearch).length === 0 && !q ? (
            <p className="text-xs text-slate-400 text-center py-6">Sin líneas de detalle todavía</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.filter(matchesSearch).map((line) => (
                rowEditor?.mode === "edit" && rowEditor.lineId === line.id ? (
                  <EditableLineRow
                    key={line.id}
                    form={rowEditor.form}
                    total={rowEditorTotal}
                    error={lineError}
                    saving={saving}
                    onChange={(patch) => setRowEditor({ ...rowEditor, form: { ...rowEditor.form, ...patch } })}
                    onSave={handleSaveRow}
                    onCancel={closeRowEditor}
                  />
                ) : (
                  <LineRow
                    key={line.id}
                    line={line}
                    fmt={fmt}
                    fringes={fringes}
                    isExpanded={expandedLine === line.id}
                    fringePickerOpen={fringePickerFor === line.id}
                    onEdit={() => openEditRow(line)}
                    onToggleExpand={() => setExpandedLine(expandedLine === line.id ? null : line.id)}
                    onDuplicate={() => handleDuplicateLine(line)}
                    onDelete={() => setDeleteTarget(line)}
                    onToggleFringePicker={() => setFringePickerFor(fringePickerFor === line.id ? null : line.id)}
                    onToggleFringe={(id) => handleToggleFringe(line, id)}
                    onUpdateSecondary={(patch) => handleUpdateSecondary(line, patch)}
                  />
                )
              ))}
            </div>
          )}

          {rowEditor?.mode === "new" ? (
            <EditableLineRow
              form={rowEditor.form}
              total={rowEditorTotal}
              error={lineError}
              saving={saving}
              onChange={(patch) => setRowEditor({ ...rowEditor, form: { ...rowEditor.form, ...patch } })}
              onSave={handleSaveRow}
              onCancel={closeRowEditor}
            />
          ) : (
            <div className="px-4 py-2 border-t border-slate-100">
              <button onClick={openNewRow} title="Añadir línea" className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-105" style={{ background: "#8DA7BE" }}>
                <Plus size={12} className="text-white" />
              </button>
            </div>
          )}

          {(fringeExtras.subchapterScoped > 0 || fringeExtras.chapterScoped > 0 || fringeExtras.totalScoped > 0) && (
            <div className="px-4 py-1.5 border-t border-slate-100 space-y-0.5">
              {fringeExtras.subchapterScoped > 0 && (
                <div className={`grid ${cols} gap-1.5 items-center`}>
                  <span /><span className="text-[11px] text-slate-500">Cargas sociales</span><span /><span /><span /><span />
                  <span className="text-[11px] text-slate-600 text-right">{fmt(fringeExtras.subchapterScoped)}</span><span />
                </div>
              )}
              {fringeExtras.chapterScoped > 0 && (
                <p className="text-[10px] text-slate-400">+{fmt(fringeExtras.chapterScoped)} en cargas sociales → total del capítulo</p>
              )}
              {fringeExtras.totalScoped > 0 && (
                <p className="text-[10px] text-slate-400">+{fmt(fringeExtras.totalScoped)} en cargas sociales → total del presupuesto</p>
              )}
            </div>
          )}

          <div className={`grid ${cols} gap-1.5 items-center px-4 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
            <span /><span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span><span /><span /><span />
            <span />
            <span className="text-xs font-bold text-right" style={{ color: "#1D201F" }}>{fmt(total)}</span>
            <span />
          </div>
        </div>
      </div>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar línea "{deleteTarget.description}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteLine} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
