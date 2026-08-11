"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Plus, Search, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BudgetingAccount, BudgetingCategoryDef, BudgetingDetailLine, BudgetingDraft, BudgetingSubchapter,
  ICON_BTN_LIGHT, UNIT_SUGGESTIONS, categoriesEnabled, computeLineTotal, fmtCurrency, fmtDecimal, resolveCategories,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

interface LineForm { code: string; description: string; units: string; unit: string; multiplier: string; rate: string; supplier: string; notes: string; tags: string; }
const emptyForm: LineForm = { code: "", description: "", units: "1", unit: "", multiplier: "1", rate: "0", supplier: "", notes: "", tags: "" };

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

  const [rowEditor, setRowEditor] = useState<{ mode: "new" | "edit"; lineId?: string; form: LineForm } | null>(null);
  const [lineCodeError, setLineCodeError] = useState("");
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
  const total = lines.reduce((s, l) => s + (l.total || 0), 0);

  const catEnabled = categoriesEnabled(draft);
  const cats: BudgetingCategoryDef[] = catEnabled ? resolveCategories(draft) : [];
  const currentCategory = catEnabled && chapter ? cats.find((c) => c.id === chapter.category) : null;

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

  const openNewRow = () => { setRowEditor({ mode: "new", form: { ...emptyForm } }); setLineCodeError(""); };
  const openEditRow = (line: BudgetingDetailLine) => {
    setRowEditor({
      mode: "edit", lineId: line.id,
      form: {
        code: line.code, description: line.description, units: String(line.units), unit: line.unit || "",
        multiplier: String(line.multiplier), rate: String(line.rate),
        supplier: line.supplier || "", notes: line.notes || "", tags: (line.tags || []).join(", "),
      },
    });
    setLineCodeError("");
  };
  const closeRowEditor = () => setRowEditor(null);

  const rowEditorTotal = rowEditor ? computeLineTotal(parseFloat(rowEditor.form.units) || 0, parseFloat(rowEditor.form.multiplier) || 0, parseFloat(rowEditor.form.rate) || 0) : 0;

  const handleSaveRow = async () => {
    if (!rowEditor) return;
    const code = rowEditor.form.code.trim();
    const description = rowEditor.form.description.trim();
    if (!code || !description) { closeRowEditor(); return; }
    if (isLineCodeTaken(code, rowEditor.lineId)) {
      setLineCodeError("Ese código ya se usa en otra línea de este subcapítulo");
      return;
    }
    const units = parseFloat(rowEditor.form.units) || 0;
    const multiplier = parseFloat(rowEditor.form.multiplier) || 0;
    const rate = parseFloat(rowEditor.form.rate) || 0;
    const total = computeLineTotal(units, multiplier, rate);
    const tags = rowEditor.form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      const payload = {
        code, description, units, unit: rowEditor.form.unit.trim(), multiplier, rate, total,
        supplier: rowEditor.form.supplier.trim(), notes: rowEditor.form.notes.trim(), tags,
      };
      if (rowEditor.mode === "edit" && rowEditor.lineId) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, rowEditor.lineId), payload);
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), { ...payload, createdAt: Timestamp.now() });
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
        code, description: line.description, units: line.units, unit: line.unit || "",
        multiplier: line.multiplier, rate: line.rate, total: line.total,
        supplier: line.supplier || "", notes: line.notes || "", tags: line.tags || [],
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

  const cols = "grid-cols-[90px_1fr_50px_64px_34px_64px_74px_60px]";

  const LineRow = ({ line }: { line: BudgetingDetailLine }) => {
    const isEditing = rowEditor?.mode === "edit" && rowEditor.lineId === line.id;
    const isExpanded = expandedLine === line.id;
    if (isEditing) return <EditableRow />;
    return (
      <div>
        <div className={`grid ${cols} gap-1.5 items-center px-4 py-1 hover:bg-slate-50 group`}>
          <button onClick={() => openEditRow(line)} className="text-xs font-mono text-slate-500 text-left truncate hover:text-[#8DA7BE] transition-colors">{line.code}</button>
          <button onClick={() => openEditRow(line)} className="text-xs text-slate-800 text-left truncate hover:text-[#8DA7BE] transition-colors">{line.description}</button>
          <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.units)}</span>
          <span className="text-[11px] text-slate-400 truncate">{line.unit}</span>
          <span className="text-[11px] text-slate-400 text-right">×{fmtDecimal(line.multiplier)}</span>
          <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.rate)}</span>
          <span className="text-xs font-semibold text-slate-900 text-right">{fmt(line.total)}</span>
          <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => setExpandedLine(isExpanded ? null : line.id)} className={`p-1 rounded ${ICON_BTN_LIGHT}`} title="Proveedor / notas / etiquetas">
              <ChevronDown size={11} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
            </button>
            <button onClick={() => handleDuplicateLine(line)} className={`p-1 rounded ${ICON_BTN_LIGHT}`} title="Duplicar línea">
              <Copy size={11} />
            </button>
            <button onClick={() => setDeleteTarget(line)} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
              <Trash2 size={11} />
            </button>
          </span>
        </div>
        {isExpanded && (
          <div className="grid grid-cols-3 gap-3 px-4 pb-2 pl-[calc(90px+0.375rem)]">
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Proveedor</label>
              <input defaultValue={line.supplier || ""} onBlur={(e) => updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, line.id), { supplier: e.target.value.trim() })}
                className="w-full text-xs border-b border-slate-200 focus:outline-none focus:border-[#8DA7BE] bg-transparent py-0.5" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Notas</label>
              <input defaultValue={line.notes || ""} onBlur={(e) => updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, line.id), { notes: e.target.value.trim() })}
                className="w-full text-xs border-b border-slate-200 focus:outline-none focus:border-[#8DA7BE] bg-transparent py-0.5" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-0.5">Etiquetas (separadas por coma)</label>
              <input defaultValue={(line.tags || []).join(", ")} onBlur={(e) => updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, line.id), { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                className="w-full text-xs border-b border-slate-200 focus:outline-none focus:border-[#8DA7BE] bg-transparent py-0.5" />
            </div>
          </div>
        )}
      </div>
    );
  };

  const EditableRow = () => {
    if (!rowEditor) return null;
    const f = rowEditor.form;
    const set = (patch: Partial<LineForm>) => setRowEditor({ ...rowEditor, form: { ...f, ...patch } });
    return (
      <div className={`grid ${cols} gap-1.5 items-center px-4 py-1 bg-slate-50/60`}>
        <input autoFocus placeholder="Código" value={f.code} onChange={(e) => { set({ code: e.target.value }); setLineCodeError(""); }}
          onKeyDown={(e) => { if (e.key === "Escape") closeRowEditor(); }}
          className="text-xs font-mono border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 min-w-0" />
        <input placeholder="Descripción" value={f.description} onChange={(e) => set({ description: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Escape") closeRowEditor(); }}
          className="text-xs border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 min-w-0" />
        <input type="number" value={f.units} onChange={(e) => set({ units: e.target.value })}
          className="text-xs text-right border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 w-full" />
        <input list="unit-suggestions" placeholder="Unidad" value={f.unit} onChange={(e) => set({ unit: e.target.value })}
          className="text-[11px] border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 min-w-0" />
        <input type="number" value={f.multiplier} onChange={(e) => set({ multiplier: e.target.value })}
          className="text-[11px] text-right border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 w-full" />
        <input type="number" value={f.rate} onChange={(e) => set({ rate: e.target.value })}
          className="text-xs text-right border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5 w-full" />
        <span className="text-xs font-semibold text-slate-900 text-right">{fmt(rowEditorTotal)}</span>
        <span className="flex items-center justify-end gap-0.5">
          <button onClick={handleSaveRow} className={`p-1 rounded ${ICON_BTN_LIGHT}`}><Check size={12} /></button>
          <button onClick={closeRowEditor} className="p-1 text-slate-300 hover:text-slate-600 rounded"><X size={12} /></button>
        </span>
      </div>
    );
  };

  return (
    <div className="w-full px-10 py-6">
      {/* Breadcrumb — solo navegación de entrar/volver, sin desplegables */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#8DA7BE] transition-colors">{draft?.name}</Link>
        {currentCategory && (
          <>
            <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
            <span className="text-xs font-medium text-slate-500">{currentCategory.label}</span>
          </>
        )}
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
        <div className="min-w-[640px]">
          <div className={`grid ${cols} gap-1.5 px-4 py-1.5 border-b border-slate-100 text-[10px] text-slate-400`}>
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
            <div className="divide-y divide-slate-50">
              {lines.filter(matchesSearch).map((line) => <LineRow key={line.id} line={line} />)}
            </div>
          )}

          {rowEditor?.mode === "new" ? (
            <EditableRow />
          ) : (
            <div className="px-4 py-1.5 border-t border-slate-100">
              <button onClick={openNewRow} className={`flex items-center gap-1.5 text-xs font-medium py-1 rounded-lg ${ICON_BTN_LIGHT}`}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#8DA7BE" }}>
                  <Plus size={10} className="text-white" />
                </span>
                Añadir línea
              </button>
            </div>
          )}
          {lineCodeError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-2">
              <AlertCircle size={12} />
              {lineCodeError}
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
