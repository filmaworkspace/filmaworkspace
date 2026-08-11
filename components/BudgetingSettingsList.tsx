"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BTN_LIGHT, ICON_BTN_LIGHT, newBudgetingId } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Editor genérico de una lista con nombre guardada en budgetingDrafts/{id}:
// lo usan Globales, Seguridad Social (fringes) y Fases: mismo patrón de
// alta/edición/borrado, solo cambian los campos.
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsListField {
  key: string;
  label: string;
  type: "text" | "number";
  suffix?: string;
}

interface Props {
  draftId: string;
  arrayField: "globals" | "fringes" | "phases";
  fields: SettingsListField[];
  emptyLabel: string;
}

export default function BudgetingSettingsList({ draftId, arrayField, fields, emptyLabel }: Props) {
  const { user } = useUser();
  const [items, setItems] = useState<Record<string, any>[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalItem, setModalItem] = useState<Record<string, any> | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      const data = snap.data();
      setItems((data?.[arrayField] as Record<string, any>[]) || []);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId, arrayField]);

  const persist = async (next: Record<string, any>[]) => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { [arrayField]: next, updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const openCreate = () => {
    const initial: Record<string, string> = {};
    fields.forEach((f) => { initial[f.key] = ""; });
    setForm(initial);
    setModalItem(null);
  };

  const openEdit = (item: Record<string, any>) => {
    const initial: Record<string, string> = {};
    fields.forEach((f) => { initial[f.key] = String(item[f.key] ?? ""); });
    setForm(initial);
    setModalItem(item);
  };

  const canSave = fields.every((f) => form[f.key]?.trim());

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const value: Record<string, any> = { id: modalItem?.id ?? newBudgetingId() };
      fields.forEach((f) => { value[f.key] = f.type === "number" ? (parseFloat(form[f.key]) || 0) : form[f.key].trim(); });
      const next = modalItem
        ? items.map((it) => (it.id === modalItem.id ? value : it))
        : [...items, value];
      await persist(next);
      setModalItem(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await persist(items.filter((it) => it.id !== deleteTarget.id));
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

  return (
    <div className="w-full px-10 py-8 max-w-2xl">
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {items.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">{emptyLabel}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 group">
                <div className="flex items-center gap-3 min-w-0">
                  {fields.map((f, i) => (
                    <span key={f.key} className={i === 0 ? "text-sm font-medium text-slate-900 truncate" : "text-sm text-slate-500"}>
                      {i === 0 ? item[f.key] : `${item[f.key]}${f.suffix || ""}`}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button onClick={() => openEdit(item)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => setDeleteTarget(item)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Borrar">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="px-5 py-2.5 border-t border-slate-100">
          <button onClick={openCreate} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
            <Plus size={12} />
            Añadir
          </button>
        </div>
      </div>

      {/* ── Item modal ───────────────────────────────────────────────────── */}
      {modalItem !== undefined && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{modalItem ? "Editar" : "Añadir"}</h3>
              <button onClick={() => setModalItem(undefined)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {fields.map((f, i) => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">{f.label}</label>
                  <div className="relative">
                    <input
                      autoFocus={i === 0}
                      type={f.type === "number" ? "number" : "text"}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                      className={`w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${f.suffix ? "pr-8" : ""}`}
                    />
                    {f.suffix && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{f.suffix}</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setModalItem(undefined)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave || saving}
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
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar "{deleteTarget[fields[0].key]}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
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
