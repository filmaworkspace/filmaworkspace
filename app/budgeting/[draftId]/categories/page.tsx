"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingCategoryDef, BudgetingDraft, CURRENCIES, ICON_BTN_LIGHT,
  categoriesEnabled, newBudgetingId, resolveCategories,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingCategoriesPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalCat, setModalCat] = useState<BudgetingCategoryDef | null | undefined>(undefined);
  const [labelInput, setLabelInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingCategoryDef | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId]);

  const cats = resolveCategories(draft);
  const enabled = categoriesEnabled(draft);

  const persist = async (patch: Partial<BudgetingDraft>) => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { ...patch, updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const openCreate = () => { setLabelInput(""); setModalCat(null); };
  const openEdit = (c: BudgetingCategoryDef) => { setLabelInput(c.label); setModalCat(c); };

  const handleSaveCategory = async () => {
    if (!labelInput.trim()) return;
    setSaving(true);
    try {
      const value: BudgetingCategoryDef = { id: modalCat?.id ?? newBudgetingId(), label: labelInput.trim() };
      const next = modalCat ? cats.map((c) => (c.id === modalCat.id ? value : c)) : [...cats, value];
      await persist({ categories: next });
      setModalCat(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await persist({ categories: cats.filter((c) => c.id !== deleteTarget.id) });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full px-10 py-8 max-w-2xl space-y-8">
      {/* Ajustes generales */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Ajustes generales</p>
        <div className="border border-slate-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">Moneda</p>
            <p className="text-xs text-slate-400 mt-0.5">Se aplica a todos los importes del presupuesto</p>
          </div>
          <select
            value={draft.currency}
            onChange={(e) => persist({ currency: e.target.value })}
            className="px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2"
          >
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Categorías */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Categorías</p>
          <button
            onClick={() => persist({ categoriesEnabled: !enabled })}
            className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0`}
            style={{ background: enabled ? "#5B57E0" : "#e2e8f0" }}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${enabled ? "left-5" : "left-1"}`} />
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          {enabled ? "Las cuentas del Top Sheet se agrupan por categoría." : "Desactivado. Las cuentas se ven en una lista plana en el Top Sheet."}
        </p>

        {enabled && (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            {cats.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">Sin categorías todavía</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {cats.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 group">
                    <span className="text-sm font-medium text-slate-900 truncate">{c.label}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={() => openEdit(c)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => setDeleteTarget(c)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Borrar">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-100">
              <button onClick={openCreate} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${BTN_LIGHT}`}>
                <Plus size={13} />
                Añadir categoría
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Category modal ───────────────────────────────────────────────── */}
      {modalCat !== undefined && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{modalCat ? "Editar categoría" : "Nueva categoría"}</h3>
              <button onClick={() => setModalCat(undefined)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre</label>
              <input
                autoFocus
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveCategory(); }}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
              />
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setModalCat(undefined)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={!labelInput.trim() || saving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar categoría "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Las cuentas que ya estaban en esta categoría quedarán sin categoría asignada. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteCategory} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
