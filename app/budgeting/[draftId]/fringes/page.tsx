"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Folder, Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BTN_LIGHT_ACTIVE, BudgetingDraft, BudgetingFolder, BudgetingFringe, FRINGE_PERIOD_LABELS, FRINGE_SCOPE_LABELS,
  FringePeriod, FringeScope, FringeType, ICON_BTN_LIGHT, newBudgetingId,
} from "@/lib/budgeting";
import BudgetingFolderPicker from "@/components/BudgetingFolderPicker";

// ─────────────────────────────────────────────────────────────────────────────
// Fringes / Seguridad Social del borrador: por porcentaje sobre la línea, o
// por importe fijo por periodo con tope opcional (p.ej. cotización topada
// mensualmente). Cada uno decide dónde computa su importe generado —
// subcapítulo, capítulo o total del presupuesto. Organizables en carpetas.
// ─────────────────────────────────────────────────────────────────────────────

interface FringeForm {
  label: string; folderId: string | null; type: FringeType;
  percent: string; amount: string; period: FringePeriod; capAmount: string; scope: FringeScope;
}
const emptyForm: FringeForm = { label: "", folderId: null, type: "percent", percent: "", amount: "", period: "month", capAmount: "", scope: "subchapter" };

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 p-0.5 border border-slate-200 rounded-lg bg-slate-50 w-fit">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${value === o.value ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function summarize(f: BudgetingFringe): string {
  if (f.type === "percent") return `${f.percent || 0}%`;
  const cap = f.capAmount != null ? ` · tope ${f.capAmount}` : "";
  return `${f.amount || 0}€ / ${FRINGE_PERIOD_LABELS[f.period || "month"].toLowerCase()}${cap}`;
}

function FringeRow({ f, onEdit, onDelete }: { f: BudgetingFringe; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 group">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-sm font-medium text-slate-900 truncate">{f.label}</span>
        <span className="text-xs text-slate-400">{summarize(f)}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-slate-200 text-slate-500">{FRINGE_SCOPE_LABELS[f.scope]}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar">
            <Pencil size={12} />
          </button>
          <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Borrar">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BudgetingFringesPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalItem, setModalItem] = useState<BudgetingFringe | null | undefined>(undefined);
  const [form, setForm] = useState<FringeForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingFringe | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId]);

  const fringes = draft?.fringes || [];
  const folders = draft?.fringeFolders || [];

  const persist = async (patch: Partial<BudgetingDraft>) => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { ...patch, updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const openCreate = (folderId: string | null = null) => { setForm({ ...emptyForm, folderId }); setFormError(""); setModalItem(null); };
  const openEdit = (f: BudgetingFringe) => {
    setForm({
      label: f.label, folderId: f.folderId ?? null, type: f.type,
      percent: f.percent != null ? String(f.percent) : "", amount: f.amount != null ? String(f.amount) : "",
      period: f.period || "month", capAmount: f.capAmount != null ? String(f.capAmount) : "", scope: f.scope,
    });
    setFormError("");
    setModalItem(f);
  };

  const handleSave = async () => {
    const label = form.label.trim();
    if (!label) { setFormError("Ponle un nombre"); return; }
    if (form.type === "percent" && !form.percent.trim()) { setFormError("Indica el porcentaje"); return; }
    if (form.type === "fixed_period" && !form.amount.trim()) { setFormError("Indica el importe"); return; }
    setSaving(true);
    try {
      const code = (modalItem?.code) || label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 20) || newBudgetingId().slice(0, 6);
      const entry: BudgetingFringe = {
        id: modalItem?.id ?? newBudgetingId(), code, label, folderId: form.folderId, type: form.type, scope: form.scope,
        ...(form.type === "percent"
          ? { percent: parseFloat(form.percent) || 0 }
          : { amount: parseFloat(form.amount) || 0, period: form.period, capAmount: form.capAmount.trim() ? parseFloat(form.capAmount) : null }),
      };
      const next = modalItem ? fringes.map((f) => (f.id === modalItem.id ? entry : f)) : [...fringes, entry];
      await persist({ fringes: next });
      setModalItem(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await persist({ fringes: fringes.filter((f) => f.id !== deleteTarget.id) });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFolder = async (label: string) => {
    const folder: BudgetingFolder = { id: newBudgetingId(), label };
    await persist({ fringeFolders: [...folders, folder] });
    setForm((f) => ({ ...f, folderId: folder.id }));
  };

  if (loading || !draft) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  const unfiled = fringes.filter((f) => !f.folderId);

  return (
    <div className="w-full px-10 py-8 max-w-2xl space-y-6">
      {folders.map((folder) => {
        const items = fringes.filter((f) => f.folderId === folder.id);
        return (
          <div key={folder.id}>
            <div className="flex items-center gap-1.5 mb-2">
              <Folder size={12} className="text-slate-400" />
              <p className="text-xs font-medium text-slate-500">{folder.label}</p>
            </div>
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              {items.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">Vacía</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {items.map((f) => <FringeRow key={f.id} f={f} onEdit={() => openEdit(f)} onDelete={() => setDeleteTarget(f)} />)}
                </div>
              )}
              <div className="px-5 py-2.5 border-t border-slate-100">
                <button onClick={() => openCreate(folder.id)} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
                  <Plus size={12} />
                  Añadir a esta carpeta
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div>
        {folders.length > 0 && <p className="text-xs font-medium text-slate-400 mb-2">Sin carpeta</p>}
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          {unfiled.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Sin conceptos de Seguridad Social todavía</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {unfiled.map((f) => <FringeRow key={f.id} f={f} onEdit={() => openEdit(f)} onDelete={() => setDeleteTarget(f)} />)}
            </div>
          )}
          <div className="px-5 py-2.5 border-t border-slate-100">
            <button onClick={() => openCreate(null)} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
              <Plus size={12} />
              Añadir fringe
            </button>
          </div>
        </div>
      </div>

      {/* ── Fringe modal ─────────────────────────────────────────────────── */}
      {modalItem !== undefined && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{modalItem ? "Editar fringe" : "Nuevo fringe"}</h3>
              <button onClick={() => setModalItem(undefined)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3.5">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre</label>
                <input autoFocus value={form.label} onChange={(e) => { setForm((f) => ({ ...f, label: e.target.value })); setFormError(""); }}
                  placeholder="Seguridad Social" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Tipo</label>
                <Segmented options={[{ value: "percent", label: "Porcentaje" }, { value: "fixed_period", label: "Importe fijo / periodo" }]} value={form.type} onChange={(type) => setForm((f) => ({ ...f, type }))} />
              </div>

              {form.type === "percent" ? (
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Porcentaje sobre la línea</label>
                  <div className="relative">
                    <input value={form.percent} onChange={(e) => { setForm((f) => ({ ...f, percent: e.target.value })); setFormError(""); }}
                      type="number" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 pr-8" />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-700 block mb-1.5">Importe</label>
                      <input value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value })); setFormError(""); }}
                        type="number" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-700 block mb-1.5">Tope (opcional)</label>
                      <input value={form.capAmount} onChange={(e) => setForm((f) => ({ ...f, capAmount: e.target.value }))}
                        type="number" placeholder="Sin tope" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Periodo</label>
                    <Segmented options={(["week", "month", "year"] as FringePeriod[]).map((p) => ({ value: p, label: FRINGE_PERIOD_LABELS[p] }))} value={form.period} onChange={(period) => setForm((f) => ({ ...f, period }))} />
                  </div>
                  <p className="text-[11px] text-slate-400">Se multiplica por la Cantidad de cada línea (asumiendo que ya representa el nº de periodos). El tope se aplica por línea.</p>
                </>
              )}

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Alcance — dónde suma el importe generado</label>
                <Segmented options={(["subchapter", "chapter", "total"] as FringeScope[]).map((s) => ({ value: s, label: FRINGE_SCOPE_LABELS[s] }))} value={form.scope} onChange={(scope) => setForm((f) => ({ ...f, scope }))} />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Carpeta</label>
                <BudgetingFolderPicker folders={folders} value={form.folderId} onChange={(id) => setForm((f) => ({ ...f, folderId: id }))} onCreateFolder={handleCreateFolder} />
              </div>

              {formError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle size={12} />
                  {formError}
                </div>
              )}
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
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar fringe "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Dejará de sumar en las líneas que lo tuvieran aplicado. Esta acción no se puede deshacer.</p>
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
