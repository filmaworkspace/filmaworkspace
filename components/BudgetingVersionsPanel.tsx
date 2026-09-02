"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import {
  BudgetingAccount, BudgetingDetailLine, BudgetingDraft, BudgetingSnapshot, BudgetingSnapshotChapter, BudgetingSubchapter,
  diffSnapshotTrees, fmtCurrency, fmtDecimal, ICON_BTN_LIGHT,
} from "@/lib/budgeting";
import BudgetingDropdown from "@/components/BudgetingDropdown";

// ─────────────────────────────────────────────────────────────────────────────
// Comparador de versiones: elige dos puntos en el tiempo (una versión
// guardada, o "Actual" en vivo) y ve qué líneas se añadieron, se quitaron o
// cambiaron de importe entre ellos. Reutilizado como pestaña del modal de
// Librería (ver BudgetingLibraryModal).
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT = "__current__";

export default function BudgetingVersionsPanel({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [snapshots, setSnapshots] = useState<BudgetingSnapshot[]>([]);
  const [chapters, setChapters] = useState<BudgetingAccount[]>([]);
  const [subchaptersByChapter, setSubchaptersByChapter] = useState<Record<string, BudgetingSubchapter[]>>({});
  const [linesBySubchapter, setLinesBySubchapter] = useState<Record<string, BudgetingDetailLine[]>>({});
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>(CURRENT);
  const [deleteTarget, setDeleteTarget] = useState<BudgetingSnapshot | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
      setLoading(false);
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, `budgetingDrafts/${draftId}/snapshots`), orderBy("createdAt", "desc")), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingSnapshot));
      setSnapshots(list);
      setFromId((prev) => prev || (list[1]?.id ?? list[0]?.id ?? ""));
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts`), (snap) => {
      setChapters(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingAccount)));
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsubs: Record<string, () => void> = {};
    chapters.forEach((c) => {
      unsubs[c.id] = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${c.id}/subchapters`), (snap) => {
        setSubchaptersByChapter((prev) => ({ ...prev, [c.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingSubchapter)) }));
      });
    });
    return () => { Object.values(unsubs).forEach((fn) => fn()); };
  }, [chapters, draftId]);

  const allSubchapters = Object.entries(subchaptersByChapter).flatMap(([chapterId, subs]) => subs.map((s) => ({ chapterId, sub: s })));

  useEffect(() => {
    const unsubs: Record<string, () => void> = {};
    allSubchapters.forEach(({ chapterId, sub }) => {
      unsubs[sub.id] = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${chapterId}/subchapters/${sub.id}/detailLines`), (snap) => {
        setLinesBySubchapter((prev) => ({ ...prev, [sub.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)) }));
      });
    });
    return () => { Object.values(unsubs).forEach((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allSubchapters.map((s) => s.sub.id)), draftId]);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);

  const currentTree: BudgetingSnapshotChapter[] = useMemo(() => chapters.map((chapter) => ({
    id: chapter.id, code: chapter.code, description: chapter.description, category: chapter.category,
    subchapters: (subchaptersByChapter[chapter.id] || []).map((sub) => ({
      id: sub.id, code: sub.code, description: sub.description,
      lines: (linesBySubchapter[sub.id] || []).map((l) => ({ id: l.id, code: l.code, description: l.description, total: l.total || 0 })),
    })),
  })), [chapters, subchaptersByChapter, linesBySubchapter]);

  const treeFor = (id: string): BudgetingSnapshotChapter[] | null => {
    if (id === CURRENT) return currentTree;
    return snapshots.find((s) => s.id === id)?.chapters ?? null;
  };

  const fromTree = treeFor(fromId);
  const toTree = treeFor(toId);
  const diff = fromTree && toTree ? diffSnapshotTrees(fromTree, toTree) : null;

  const options = [
    { value: CURRENT, label: "Actual (en vivo)" },
    ...snapshots.map((s) => ({ value: s.id, label: s.label })),
  ];

  const handleDeleteSnapshot = async () => {
    if (!deleteTarget) return;
    await deleteDoc(doc(db, `budgetingDrafts/${draftId}/snapshots`, deleteTarget.id));
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {snapshots.length === 0 ? (
        <div className="border border-slate-200 rounded-2xl py-10 text-center">
          <p className="text-xs text-slate-400">Sin versiones guardadas todavía: usa "Guardar versión" desde el Presupuesto.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1">
              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block mb-1">Desde</label>
              <BudgetingDropdown value={fromId} options={options} onChange={setFromId} buttonClassName="w-full flex items-center justify-between gap-2 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors" />
            </div>
            <ArrowRight size={14} className="text-slate-300 mt-4 flex-shrink-0" />
            <div className="flex-1">
              <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide block mb-1">Hasta</label>
              <BudgetingDropdown value={toId} options={options} onChange={setToId} buttonClassName="w-full flex items-center justify-between gap-2 px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors" />
            </div>
          </div>

          {diff && (
            <div className="border border-slate-200 rounded-2xl overflow-hidden mb-6">
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50/70 border-b border-slate-200">
                <span className="text-xs font-medium text-slate-500">Total</span>
                <span className="text-sm font-semibold text-slate-900">
                  {fmt(diff.oldTotal)} <ArrowRight size={11} className="inline mx-1 text-slate-400" /> {fmt(diff.newTotal)}
                  <span className={`ml-2 text-xs font-medium ${diff.newTotal - diff.oldTotal > 0 ? "text-red-500" : diff.newTotal - diff.oldTotal < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                    ({diff.newTotal - diff.oldTotal >= 0 ? "+" : ""}{fmt(diff.newTotal - diff.oldTotal)})
                  </span>
                </span>
              </div>
              {diff.lines.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">Sin cambios entre estos dos puntos.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {diff.lines.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${d.kind === "added" ? "bg-emerald-100 text-emerald-600" : d.kind === "removed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                          {d.kind === "added" ? <Plus size={10} /> : d.kind === "removed" ? <Minus size={10} /> : <ArrowRight size={9} />}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-800 truncate">{d.description || d.code || "(sin descripción)"}</p>
                          <p className="text-[10px] text-slate-400 truncate">{d.chapterLabel} · {d.subchapterLabel}</p>
                        </div>
                      </div>
                      <span className="text-xs font-medium text-right flex-shrink-0">
                        {d.kind === "added" && <span className="text-emerald-600">+{fmt(d.newTotal || 0)}</span>}
                        {d.kind === "removed" && <span className="text-red-500">-{fmt(d.oldTotal || 0)}</span>}
                        {d.kind === "changed" && (
                          <span className="text-slate-600">{fmtDecimal(d.oldTotal || 0)} → {fmtDecimal(d.newTotal || 0)}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-xs font-medium text-slate-400 mb-2">Todas las versiones</p>
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {snapshots.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">Sin versiones todavía</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 group">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 truncate">{s.label}</p>
                  <p className="text-[10px] text-slate-400">{s.createdAt ? new Date((s.createdAt as any).seconds * 1000).toLocaleString("es-ES") : ""}</p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs font-medium text-slate-600">{fmt(s.grandTotal)}</span>
                  <button onClick={() => setDeleteTarget(s)} className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${ICON_BTN_LIGHT}`} title="Borrar versión">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar versión "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteSnapshot} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
