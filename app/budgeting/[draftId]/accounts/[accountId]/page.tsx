"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ChevronRight, Plus, Search, Trash2 } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BudgetingAccount, BudgetingDetailLine, BudgetingDraft, BudgetingSubchapter, CELL_INPUT, fmtCurrency, subchapterTotal } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { subchapterId: string; label: string };
const cols = "grid-cols-[110px_1fr_100px_36px]";

// ─── Fila de subcapítulo — siempre editable in situ (MMB-style): sin caja,
// sin placeholder, guarda sola al perder el foco. Componente de módulo
// estable: no se redefine entre renders, así los inputs no pierden el foco. ──
function SubRow({
  sub, draftId, accountId, fmt, total, onCommit, onDelete,
}: {
  sub: BudgetingSubchapter; draftId: string; accountId: string; fmt: (n: number) => string; total: number;
  onCommit: (code: string, description: string) => void; onDelete: () => void;
}) {
  const [code, setCode] = useState(sub.code);
  const [description, setDescription] = useState(sub.description);

  const commit = () => {
    if (!code.trim() || !description.trim()) { setCode(sub.code); setDescription(sub.description); return; }
    onCommit(code.trim(), description.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(sub.code); setDescription(sub.description); }
  };

  return (
    <div className={`grid ${cols} gap-2 items-center px-4 py-3 hover:bg-slate-50 group`}>
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs`} />
      <span className="text-xs font-medium text-slate-700 text-right justify-self-end">{fmt(total)}</span>
      <span className="flex items-center justify-end gap-0.5">
        <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100" title="Borrar subcapítulo">
          <Trash2 size={11} />
        </button>
        <Link href={`/budgeting/${draftId}/accounts/${accountId}/subchapters/${sub.id}`}>
          <ChevronRight size={13} className="text-slate-300 hover:text-[#8DA7BE] hover:translate-x-0.5 transition-all" />
        </Link>
      </span>
    </div>
  );
}

function NewSubRow({ onCommit }: { onCommit: (code: string, description: string) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const commit = async () => {
    if (!code.trim() || !description.trim()) return;
    const ok = await onCommit(code.trim(), description.trim());
    if (ok) { setCode(""); setDescription(""); }
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
  return (
    <div className={`grid ${cols} gap-2 items-center px-4 py-3`}>
      <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs`} />
      <span /><span />
    </div>
  );
}

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
  const [addingSub, setAddingSub] = useState(false);

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
  const fringes = draft?.fringes || [];

  const subTotal = (sub: BudgetingSubchapter) => {
    const lines = linesBySubchapter[sub.id] || [];
    const subScoped = lines.reduce((s, l) => {
      const applied = (l.fringeIds || []).map((id) => fringes.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f && f.scope === "subchapter");
      return s + applied.reduce((s2, f) => s2 + (f.type === "percent" ? (l.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (l.units || 0)), 0);
    }, 0);
    return Math.round((subchapterTotal(sub, lines) + subScoped) * 100) / 100;
  };
  const chapterFringesTotal = () => {
    let sum = 0;
    for (const lines of Object.values(linesBySubchapter)) {
      for (const l of lines) {
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (!f || f.scope !== "chapter") continue;
          sum += f.type === "percent" ? (l.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (l.units || 0);
        }
      }
    }
    return Math.round(sum * 100) / 100;
  };
  const chapterFringes = chapterFringesTotal();
  const chapterTotal = Math.round((subchapters.reduce((s, sub) => s + subTotal(sub), 0) + chapterFringes) * 100) / 100;

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

  const handleCommitSub = async (sub: BudgetingSubchapter, code: string, description: string) => {
    if (code === sub.code && description === sub.description) return;
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, sub.id), { code, description });
    await touchDraft();
  };

  const handleCommitNewSub = async (code: string, description: string): Promise<boolean> => {
    await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), { code, description, createdAt: Timestamp.now() });
    await touchDraft();
    return true;
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

  return (
    <div className="w-full px-10 py-6">
      {/* Breadcrumb — solo navegación de entrar/volver, sin categorías ni desplegables */}
      <div className="flex items-center gap-1.5 mb-4">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#8DA7BE] transition-colors">{draft?.name}</Link>
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
        <div className={`grid ${cols} gap-2 px-4 py-2 border-b border-slate-200 divide-x divide-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
          <span>Código</span>
          <span>Descripción</span>
          <span className="text-right">Total</span>
          <span></span>
        </div>

        {subchapters.filter(matchesSearch).length === 0 && !q && !addingSub ? (
          <p className="text-xs text-slate-400 text-center py-6">Sin subcapítulos todavía</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {subchapters.filter(matchesSearch).map((sub) => (
              <SubRow
                key={sub.id}
                sub={sub}
                draftId={draftId}
                accountId={accountId}
                fmt={fmt}
                total={subTotal(sub)}
                onCommit={(code, description) => handleCommitSub(sub, code, description)}
                onDelete={() => setDeleteTarget({ subchapterId: sub.id, label: sub.description })}
              />
            ))}
          </div>
        )}

        {addingSub ? (
          <NewSubRow onCommit={handleCommitNewSub} />
        ) : (
          <div className="px-4 py-2 border-t border-slate-100">
            <button onClick={() => setAddingSub(true)} title="Añadir subcapítulo" className="w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-105" style={{ background: "#8DA7BE" }}>
              <Plus size={12} className="text-white" />
            </button>
          </div>
        )}

        {chapterFringes > 0 && (
          <p className="text-[10px] text-slate-400 px-4 pt-1.5">+{fmt(chapterFringes)} en cargas sociales propias de este capítulo</p>
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
