"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Check, ChevronRight, Plus, Search, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BudgetingAccount, BudgetingCategoryDef, BudgetingDetailLine, BudgetingDraft, BudgetingSubchapter,
  ICON_BTN_LIGHT, categoriesEnabled, fmtCurrency, resolveCategories,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

type RowEditor = { mode: "new" | "edit"; subchapterId?: string; code: string; description: string };
type DeleteTarget = { subchapterId: string; label: string };

export default function BudgetingChapterPage() {
  const { draftId, accountId } = useParams() as { draftId: string; accountId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [chapter, setChapter] = useState<BudgetingAccount | null>(null);
  const [subchapters, setSubchapters] = useState<BudgetingSubchapter[]>([]);
  const [linesBySubchapter, setLinesBySubchapter] = useState<Record<string, BudgetingDetailLine[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const [rowEditor, setRowEditor] = useState<RowEditor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, `budgetingDrafts/${draftId}/accounts`, accountId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setChapter({ id: snap.id, ...snap.data() } as BudgetingAccount);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId, accountId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), (snap) => {
      setSubchapters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingSubchapter)));
    });
    return () => unsub();
  }, [draftId, accountId]);

  useEffect(() => {
    const unsubs: Record<string, () => void> = {};
    subchapters.forEach((s) => {
      unsubs[s.id] = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${s.id}/detailLines`), (snap) => {
        setLinesBySubchapter((prev) => ({ ...prev, [s.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)) }));
      });
    });
    return () => { Object.values(unsubs).forEach((fn) => fn()); };
  }, [subchapters, draftId, accountId]);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const subTotal = (subchapterId: string) => (linesBySubchapter[subchapterId] || []).reduce((s, l) => s + (l.total || 0), 0);
  const chapterTotal = subchapters.reduce((s, sub) => s + subTotal(sub.id), 0);

  const catEnabled = categoriesEnabled(draft);
  const cats: BudgetingCategoryDef[] = catEnabled ? resolveCategories(draft) : [];
  const currentCategory = catEnabled && chapter ? cats.find((c) => c.id === chapter.category) : null;

  const q = search.trim().toLowerCase();
  const matchesSearch = (s: BudgetingSubchapter) => !q || s.code.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const openNewRow = () => setRowEditor({ mode: "new", code: "", description: "" });
  const openEditRow = (sub: BudgetingSubchapter) => setRowEditor({ mode: "edit", subchapterId: sub.id, code: sub.code, description: sub.description });
  const closeRowEditor = () => setRowEditor(null);

  const handleSaveRow = async () => {
    if (!rowEditor || !rowEditor.code.trim() || !rowEditor.description.trim()) { closeRowEditor(); return; }
    setSaving(true);
    try {
      if (rowEditor.mode === "edit" && rowEditor.subchapterId) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, rowEditor.subchapterId), {
          code: rowEditor.code.trim(), description: rowEditor.description.trim(),
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), {
          code: rowEditor.code.trim(), description: rowEditor.description.trim(), createdAt: Timestamp.now(),
        });
      }
      await touchDraft();
    } finally {
      setSaving(false);
      setRowEditor(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const lines = linesBySubchapter[deleteTarget.subchapterId] || [];
      await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${deleteTarget.subchapterId}/detailLines`, l.id))));
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, deleteTarget.subchapterId));
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

  if (notFound || !chapter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Este capítulo no existe.</p>
      </div>
    );
  }

  const cols = "grid-cols-[110px_1fr_90px_70px]";

  const SubRow = ({ sub }: { sub: BudgetingSubchapter }) => {
    const isEditing = rowEditor?.mode === "edit" && rowEditor.subchapterId === sub.id;
    if (isEditing) {
      return (
        <div className={`grid ${cols} gap-2 items-center px-4 py-1`}>
          <input autoFocus value={rowEditor.code} onChange={(e) => setRowEditor({ ...rowEditor, code: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
            className="text-xs font-mono border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5" />
          <input value={rowEditor.description} onChange={(e) => setRowEditor({ ...rowEditor, description: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
            onBlur={handleSaveRow}
            className="text-xs border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5" />
          <span />
          <span className="flex items-center justify-end gap-0.5">
            <button onClick={handleSaveRow} className={`p-1 rounded ${ICON_BTN_LIGHT}`}><Check size={12} /></button>
            <button onClick={closeRowEditor} className="p-1 text-slate-300 hover:text-slate-600 rounded"><X size={12} /></button>
          </span>
        </div>
      );
    }
    return (
      <div className={`grid ${cols} gap-2 items-center px-4 py-1 hover:bg-slate-50 group`}>
        <button onClick={() => openEditRow(sub)} className="text-xs font-mono text-slate-400 text-left hover:text-[#8DA7BE] transition-colors">{sub.code}</button>
        <Link href={`/budgeting/${draftId}/accounts/${accountId}/subchapters/${sub.id}`} className="text-xs text-slate-800 truncate group-hover:text-[#8DA7BE] transition-colors">
          {sub.description}
        </Link>
        <span className="text-xs font-medium text-slate-700 text-right justify-self-end">{fmt(subTotal(sub.id))}</span>
        <span className="flex items-center justify-end gap-0.5">
          <button onClick={() => setDeleteTarget({ subchapterId: sub.id, label: sub.description })} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100" title="Borrar subcapítulo">
            <Trash2 size={11} />
          </button>
          <Link href={`/budgeting/${draftId}/accounts/${accountId}/subchapters/${sub.id}`}>
            <ChevronRight size={13} className="text-slate-300 group-hover:text-[#8DA7BE] group-hover:translate-x-0.5 transition-all" />
          </Link>
        </span>
      </div>
    );
  };

  return (
    <div className="w-full px-10 py-6">
      {/* Breadcrumb — solo navegación de entrar/volver, sin desplegables */}
      <div className="flex items-center gap-1.5 mb-4">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#8DA7BE] transition-colors">{draft?.name}</Link>
        {currentCategory && (
          <>
            <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
            <span className="text-xs font-medium text-slate-500">{currentCategory.label}</span>
          </>
        )}
        <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
        <span className="text-xs font-semibold text-slate-900">{chapter.code} {chapter.description}</span>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-sm font-semibold" style={{ color: "#1D201F" }}>{chapter.code} · {chapter.description}</h1>
        <div className="relative w-44 flex-shrink-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
      </div>

      {/* Subcapítulos */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {subchapters.filter(matchesSearch).length === 0 && !q ? (
          <p className="text-xs text-slate-400 text-center py-6">Sin subcapítulos todavía</p>
        ) : (
          subchapters.filter(matchesSearch).map((sub) => <SubRow key={sub.id} sub={sub} />)
        )}

        {rowEditor?.mode === "new" ? (
          <div className={`grid ${cols} gap-2 items-center px-4 py-1`}>
            <input autoFocus placeholder="Código" value={rowEditor.code} onChange={(e) => setRowEditor({ ...rowEditor, code: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
              className="text-xs font-mono border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5" />
            <input placeholder="Descripción" value={rowEditor.description} onChange={(e) => setRowEditor({ ...rowEditor, description: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
              onBlur={handleSaveRow}
              className="text-xs border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5" />
            <span />
            <span className="flex items-center justify-end gap-0.5">
              <button onClick={handleSaveRow} className={`p-1 rounded ${ICON_BTN_LIGHT}`}><Check size={12} /></button>
              <button onClick={closeRowEditor} className="p-1 text-slate-300 hover:text-slate-600 rounded"><X size={12} /></button>
            </span>
          </div>
        ) : (
          <div className="px-4 py-1.5 border-t border-slate-100">
            <button onClick={openNewRow} className={`flex items-center gap-1.5 text-xs font-medium py-1 rounded-lg ${ICON_BTN_LIGHT}`}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#8DA7BE" }}>
                <Plus size={10} className="text-white" />
              </span>
              Añadir subcapítulo
            </button>
          </div>
        )}

        <div className={`grid ${cols} gap-2 items-center px-4 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
          <span />
          <span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span>
          <span className="text-xs font-bold text-right justify-self-end" style={{ color: "#1D201F" }}>{fmt(chapterTotal)}</span>
          <span />
        </div>
      </div>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar subcapítulo "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Se borrarán también todas sus líneas de detalle. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleConfirmDelete} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
