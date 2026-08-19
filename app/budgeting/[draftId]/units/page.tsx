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
import { BTN_LIGHT, BudgetingDraft, BudgetingUnit, DEFAULT_UNITS, ICON_BTN_LIGHT, newBudgetingId } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Unidades del campo "Unidad" de una línea de Detalle (Día, Semana, Mes...),
// personalizables por borrador. Cada una lleva su forma en singular y en
// plural: en pantalla, PDF y Excel se muestra una u otra según la Cantidad
// de la línea (1 = singular, más de 1 = plural). El texto libre que no
// coincida con ninguna se deja tal cual, sin romper líneas ya escritas.
// ─────────────────────────────────────────────────────────────────────────────

interface UnitForm { singular: string; plural: string; }
const emptyForm: UnitForm = { singular: "", plural: "" };

function UnitRow({ u, onEdit, onDelete }: { u: BudgetingUnit; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 group">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-sm font-medium text-slate-900">{u.singular}</span>
        <span className="text-xs text-slate-400">/ {u.plural || u.singular}</span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar">
          <Pencil size={12} />
        </button>
        <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Borrar">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export default function BudgetingUnitsPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalItem, setModalItem] = useState<BudgetingUnit | null | undefined>(undefined);
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingUnit | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId]);

  const units = draft?.units ?? DEFAULT_UNITS;

  const persist = async (patch: Partial<BudgetingDraft>) => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { ...patch, updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  // Antes de la primera edición no hay `draft.units` en Firestore (se usan
  // los DEFAULT_UNITS de siempre, tal cual); en cuanto se toca algo, se
  // graba la lista completa explícita para que quede editable de verdad.
  const withSeededUnits = () => draft?.units ?? DEFAULT_UNITS;

  const openCreate = () => { setForm(emptyForm); setFormError(""); setModalItem(null); };
  const openEdit = (u: BudgetingUnit) => { setForm({ singular: u.singular, plural: u.plural }); setFormError(""); setModalItem(u); };

  const handleSave = async () => {
    const singular = form.singular.trim();
    const plural = form.plural.trim() || singular;
    if (!singular) { setFormError("Ponle un nombre"); return; }
    const current = withSeededUnits();
    if (current.some((u) => u.id !== modalItem?.id && u.singular.trim().toLowerCase() === singular.toLowerCase())) {
      setFormError("Ya hay una unidad con ese nombre");
      return;
    }
    setSaving(true);
    try {
      const entry: BudgetingUnit = { id: modalItem?.id ?? newBudgetingId(), singular, plural };
      const next = modalItem ? current.map((u) => (u.id === modalItem.id ? entry : u)) : [...current, entry];
      await persist({ units: next });
      setModalItem(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await persist({ units: withSeededUnits().filter((u) => u.id !== deleteTarget.id) });
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
    <div className="w-full px-10 py-8 max-w-2xl space-y-6">
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {units.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">Sin unidades todavía</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {units.map((u) => <UnitRow key={u.id} u={u} onEdit={() => openEdit(u)} onDelete={() => setDeleteTarget(u)} />)}
          </div>
        )}
        <div className="px-5 py-2.5 border-t border-slate-100">
          <button onClick={openCreate} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
            <Plus size={12} />
            Añadir unidad
          </button>
        </div>
      </div>

      {/* ── Unit modal ───────────────────────────────────────────────────── */}
      {modalItem !== undefined && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{modalItem ? "Editar unidad" : "Nueva unidad"}</h3>
              <button onClick={() => setModalItem(undefined)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Singular</label>
                <input autoFocus value={form.singular} onChange={(e) => { setForm((f) => ({ ...f, singular: e.target.value })); setFormError(""); }}
                  placeholder="Día" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Plural</label>
                <input value={form.plural} onChange={(e) => setForm((f) => ({ ...f, plural: e.target.value }))}
                  placeholder="Días" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
                <p className="text-[11px] text-slate-400 mt-1.5">Si se deja vacío, se usa el singular también en plural (como "Fijo").</p>
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setModalItem(undefined)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}>
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
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar unidad "{deleteTarget.singular}"</h3>
            <p className="text-xs text-slate-500 mb-4">Las líneas que ya tengan este texto en Unidad no cambian, solo deja de aparecer como sugerencia y de pluralizarse. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDelete} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
