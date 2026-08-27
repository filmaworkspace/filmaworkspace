"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Folder, Pencil, Plus, Sigma, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingDraft, BudgetingFolder, BudgetingGlobal, BudgetingScenario, ICON_BTN_LIGHT,
  fmtDecimal, isPlainNumber, newBudgetingId, resolveGlobals,
} from "@/lib/budgeting";
import BudgetingFolderPicker from "@/components/BudgetingFolderPicker";
import BudgetingFormulaInput from "@/components/BudgetingFormulaInput";

// ─────────────────────────────────────────────────────────────────────────────
// Globales: valores reutilizables por todo el borrador, identificados por un
// código propio. El "Valor" puede ser un número directo o una fórmula que
// referencia el código de otros Globales (+, -, *, /, paréntesis); eso
// mismo código luego se puede escribir en Cantidad/X/Tarifa de una línea de
// Detalle. Organizables en carpetas para que la lista no sea un caos.
// Reutilizado como pestaña del modal de Librería (ver BudgetingLibraryModal).
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalForm { code: string; label: string; value: string; folderId: string | null; scenarioOverrides: Record<string, string>; }
const emptyForm: GlobalForm = { code: "", label: "", value: "", folderId: null, scenarioOverrides: {} };

function ScenariosBar({ scenarios, onAdd, onRename, onDelete }: {
  scenarios: BudgetingScenario[]; onAdd: (label: string) => void; onRename: (id: string, label: string) => void; onDelete: (id: string) => void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  return (
    <div>
      <p className="text-xs font-medium text-slate-400 mb-2">Escenarios</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {scenarios.map((sc) => (
          editingId === sc.id ? (
            <input key={sc.id} autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
              onBlur={() => { if (editLabel.trim()) onRename(sc.id, editLabel.trim()); setEditingId(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className="text-xs px-2.5 py-1 border border-[#A855F7] rounded-full focus:outline-none w-28" />
          ) : (
            <span key={sc.id} className="inline-flex items-center gap-1 text-xs pl-2.5 pr-1.5 py-1 rounded-full border border-slate-200 text-slate-600">
              <button onClick={() => { setEditingId(sc.id); setEditLabel(sc.label); }} className="hover:text-[#A855F7]">{sc.label}</button>
              <button onClick={() => onDelete(sc.id)} className="text-slate-300 hover:text-red-500"><X size={10} /></button>
            </span>
          )
        ))}
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) { onAdd(newLabel.trim()); setNewLabel(""); } }}
          placeholder="+ Nuevo escenario"
          className="text-xs px-2.5 py-1 rounded-full border border-dashed border-slate-300 focus:outline-none focus:border-[#A855F7] w-32"
        />
      </div>
    </div>
  );
}

function GlobalRow({
  g, error, value, onEdit, onDelete,
}: {
  g: BudgetingGlobal; error?: string; value?: number; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 group">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "#A855F71a", color: "#1D201F" }}>{g.code}</span>
        <span className="text-sm font-medium text-slate-900 truncate">{g.label}</span>
        {!isPlainNumber(g.value) && <span title="Fórmula"><Sigma size={11} className="text-[#A855F7] flex-shrink-0" /></span>}
        <span className="text-xs text-slate-400 truncate font-mono">{g.value}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {error ? (
          <span className="flex items-center gap-1 text-[11px] text-red-500"><AlertCircle size={11} />{error}</span>
        ) : (
          <span className="text-sm font-semibold text-slate-700">{fmtDecimal(value || 0)}</span>
        )}
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

export default function BudgetingGlobalsPanel({ draftId }: { draftId: string }) {
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [modalItem, setModalItem] = useState<BudgetingGlobal | null | undefined>(undefined);
  const [form, setForm] = useState<GlobalForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingGlobal | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId]);

  const globals = draft?.globals || [];
  const folders = draft?.globalFolders || [];
  const scenarios = draft?.scenarios || [];
  const resolution = useMemo(() => resolveGlobals(globals), [JSON.stringify(globals)]);

  const persist = async (patch: Partial<BudgetingDraft>) => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { ...patch, updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const openCreate = (folderId: string | null = null) => { setForm({ ...emptyForm, folderId }); setFormError(""); setModalItem(null); };
  const openEdit = (g: BudgetingGlobal) => { setForm({ code: g.code, label: g.label, value: g.value, folderId: g.folderId ?? null, scenarioOverrides: { ...(g.scenarioOverrides || {}) } }); setFormError(""); setModalItem(g); };

  const handleAddScenario = async (label: string) => {
    await persist({ scenarios: [...scenarios, { id: newBudgetingId(), label }] });
  };
  const handleRenameScenario = async (id: string, label: string) => {
    await persist({ scenarios: scenarios.map((s) => (s.id === id ? { ...s, label } : s)) });
  };
  const handleDeleteScenario = async (id: string) => {
    await persist({ scenarios: scenarios.filter((s) => s.id !== id), ...(draft?.activeScenarioId === id ? { activeScenarioId: null } : {}) });
  };

  const isCodeTaken = (code: string, excludeId?: string) =>
    globals.some((g) => g.id !== excludeId && g.code.trim().toLowerCase() === code.trim().toLowerCase());

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase().replace(/\s+/g, "_");
    const label = form.label.trim();
    const value = form.value.trim();
    if (!code || !label || !value) { setFormError("Rellena código, nombre y valor"); return; }
    if (isCodeTaken(code, modalItem?.id)) { setFormError("Ese código ya lo usa otro Global"); return; }
    if (!isPlainNumber(value)) {
      // Valida que la fórmula al menos parsee contra los valores ya resueltos (sin contar el propio, que aún no existe/se está editando)
      const others = globals.filter((g) => g.id !== modalItem?.id);
      const testResolution = resolveGlobals([...others, { id: modalItem?.id ?? "tmp", code, label, value, folderId: form.folderId }]);
      if (testResolution.errors[code]) { setFormError(testResolution.errors[code]); return; }
    }
    setSaving(true);
    try {
      const scenarioOverrides = Object.fromEntries(Object.entries(form.scenarioOverrides).filter(([, v]) => v.trim()));
      const entry: BudgetingGlobal = { id: modalItem?.id ?? newBudgetingId(), code, label, value, folderId: form.folderId, scenarioOverrides };
      const next = modalItem ? globals.map((g) => (g.id === modalItem.id ? entry : g)) : [...globals, entry];
      await persist({ globals: next });
      setModalItem(undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      await persist({ globals: globals.filter((g) => g.id !== deleteTarget.id) });
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFolder = async (label: string) => {
    const folder: BudgetingFolder = { id: newBudgetingId(), label };
    await persist({ globalFolders: [...folders, folder] });
    setForm((f) => ({ ...f, folderId: folder.id }));
  };

  if (loading || !draft) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  const unfiled = globals.filter((g) => !g.folderId);

  return (
    <div className="space-y-6">
      <ScenariosBar scenarios={scenarios} onAdd={handleAddScenario} onRename={handleRenameScenario} onDelete={handleDeleteScenario} />

      {folders.map((folder) => {
        const items = globals.filter((g) => g.folderId === folder.id);
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
                  {items.map((g) => <GlobalRow key={g.id} g={g} error={resolution.errors[g.code]} value={resolution.values[g.code]} onEdit={() => openEdit(g)} onDelete={() => setDeleteTarget(g)} />)}
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
            <p className="text-xs text-slate-400 text-center py-8">Sin globales todavía</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {unfiled.map((g) => <GlobalRow key={g.id} g={g} error={resolution.errors[g.code]} value={resolution.values[g.code]} onEdit={() => openEdit(g)} onDelete={() => setDeleteTarget(g)} />)}
            </div>
          )}
          <div className="px-5 py-2.5 border-t border-slate-100">
            <button onClick={() => openCreate(null)} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
              <Plus size={12} />
              Añadir global
            </button>
          </div>
        </div>
      </div>

      {/* ── Global modal ─────────────────────────────────────────────────── */}
      {modalItem !== undefined && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{modalItem ? "Editar global" : "Nuevo global"}</h3>
              <button onClick={() => setModalItem(undefined)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Código (se usa para referenciarlo)</label>
                <input
                  autoFocus
                  value={form.code}
                  onChange={(e) => { setForm((f) => ({ ...f, code: e.target.value })); setFormError(""); }}
                  placeholder="DIAS_RODAJE"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre</label>
                <input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Valor (número o fórmula con otros códigos)</label>
                <BudgetingFormulaInput
                  value={form.value}
                  onChange={(v) => { setForm((f) => ({ ...f, value: v })); setFormError(""); }}
                  globals={globals.filter((g) => g.id !== modalItem?.id).map((g) => ({ code: g.code, label: g.label }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Carpeta</label>
                <BudgetingFolderPicker folders={folders} value={form.folderId} onChange={(id) => setForm((f) => ({ ...f, folderId: id }))} onCreateFolder={handleCreateFolder} />
              </div>
              {scenarios.length > 0 && (
                <div className="border-t border-slate-100 pt-3 space-y-2.5">
                  <p className="text-xs font-medium text-slate-700">Valor por escenario (opcional: vacío = usa el de arriba)</p>
                  {scenarios.map((sc) => (
                    <div key={sc.id}>
                      <label className="text-[11px] text-slate-500 block mb-1">{sc.label}</label>
                      <BudgetingFormulaInput
                        value={form.scenarioOverrides[sc.id] || ""}
                        onChange={(v) => setForm((f) => ({ ...f, scenarioOverrides: { ...f.scenarioOverrides, [sc.id]: v } }))}
                        globals={globals.filter((g) => g.id !== modalItem?.id).map((g) => ({ code: g.code, label: g.label }))}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
                      />
                    </div>
                  ))}
                </div>
              )}
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
              <button
                onClick={handleSave}
                disabled={saving}
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar global "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Si otras fórmulas referencian su código "{deleteTarget.code}", dejarán de resolverse. Esta acción no se puede deshacer.</p>
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
