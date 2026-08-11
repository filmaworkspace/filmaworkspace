"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot,
  query, serverTimestamp, setDoc, Timestamp, updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle, Check, ChevronRight, Copy, Download, FileSpreadsheet,
  FileText, Plus, Search, Send, Trash2, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingDraft, BudgetingCategoryDef, BudgetingAccount, BudgetingSubchapter, BudgetingDetailLine,
  categoriesEnabled, resolveCategories, fmtCurrency, ICON_BTN_LIGHT,
} from "@/lib/budgeting";
import { buildFwbFromDraft, downloadFwb } from "@/lib/budgetingExport";
import { downloadBudgetExcel, downloadBudgetPdf } from "@/lib/budgetingReports";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { chapterId: string; label: string };
type EligibleProject = { id: string; name: string };
type RowEditor = { mode: "new" | "edit"; category: string | null; chapterId?: string; code: string; description: string };

export default function BudgetingTopPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();
  const router = useRouter();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [chapters, setChapters] = useState<BudgetingAccount[]>([]);
  const [subchaptersByChapter, setSubchaptersByChapter] = useState<Record<string, BudgetingSubchapter[]>>({});
  const [linesBySubchapter, setLinesBySubchapter] = useState<Record<string, BudgetingDetailLine[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [search, setSearch] = useState("");

  const [rowEditor, setRowEditor] = useState<RowEditor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Enviar a proyecto
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendStep, setSendStep] = useState<"pick" | "confirm" | "done">("pick");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<EligibleProject | null>(null);
  const [projectStatus, setProjectStatus] = useState<Record<string, "checking" | "empty" | "occupied">>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "budgetingDrafts", draftId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
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

  const catEnabled = categoriesEnabled(draft);
  const cats: BudgetingCategoryDef[] = catEnabled ? resolveCategories(draft) : [];

  const chaptersByCategory = (categoryId: string | null) => chapters.filter((c) => c.category === categoryId);
  const chapterTotal = (chapterId: string) => (subchaptersByChapter[chapterId] || []).reduce((s, sub) => s + (linesBySubchapter[sub.id] || []).reduce((s2, l) => s2 + (l.total || 0), 0), 0);
  const categoryTotal = (categoryId: string) => chaptersByCategory(categoryId).reduce((s, c) => s + chapterTotal(c.id), 0);
  const grandTotal = catEnabled
    ? cats.reduce((s, c) => s + categoryTotal(c.id), 0)
    : chapters.reduce((s, c) => s + chapterTotal(c.id), 0);
  const totalLines = Object.values(linesBySubchapter).reduce((s, lines) => s + lines.length, 0);
  const totalSubchapters = allSubchapters.length;

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);

  const q = search.trim().toLowerCase();
  const matchesSearch = (c: BudgetingAccount) => !q || c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const handleDuplicateDraft = async () => {
    if (!draft || !user) return;
    setDuplicating(true);
    try {
      const newName = `${draft.name} (copia)`;
      const newRef = doc(collection(db, "budgetingDrafts"));
      const now = serverTimestamp();
      await setDoc(newRef, {
        name: newName, ownerUid: user.uid, ownerName: user.name, currency: draft.currency,
        createdAt: now, updatedAt: now, sentToProjectId: null, sentToProjectName: null, sentAt: null,
        categoriesEnabled: draft.categoriesEnabled ?? true,
        categories: draft.categories ?? [],
        globals: draft.globals ?? [], fringes: draft.fringes ?? [], phases: draft.phases ?? [],
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, newRef.id), {
        name: newName, updatedAt: now, status: "draft", sentToProjectName: null,
      });
      for (const chapter of chapters) {
        const newChapterRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts`), {
          code: chapter.code, description: chapter.description, category: chapter.category, createdAt: Timestamp.now(),
        });
        for (const sub of subchaptersByChapter[chapter.id] || []) {
          const newSubRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newChapterRef.id}/subchapters`), {
            code: sub.code, description: sub.description, createdAt: Timestamp.now(),
          });
          for (const line of linesBySubchapter[sub.id] || []) {
            await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newChapterRef.id}/subchapters/${newSubRef.id}/detailLines`), {
              code: line.code, description: line.description, units: line.units, unit: line.unit || "",
              multiplier: line.multiplier, rate: line.rate, total: line.total,
              supplier: line.supplier || "", notes: line.notes || "", tags: line.tags || [],
              createdAt: Timestamp.now(),
            });
          }
        }
      }
      router.push(`/budgeting/${newRef.id}`);
    } catch (e) {
      console.error("[Budgeting] Error duplicando borrador:", e);
    } finally {
      setDuplicating(false);
    }
  };

  const reportParams = () => ({
    draftName: draft?.name || "Presupuesto",
    currency,
    categoriesEnabled: catEnabled,
    categories: cats,
    chaptersByCategory: (categoryId: string | null) => chaptersByCategory(categoryId).map((c) => ({ id: c.id, code: c.code, description: c.description })),
    subchaptersByChapter: Object.fromEntries(Object.entries(subchaptersByChapter).map(([k, v]) => [k, v.map((s) => ({ id: s.id, code: s.code, description: s.description }))])),
    linesBySubchapter: Object.fromEntries(Object.entries(linesBySubchapter).map(([k, v]) => [k, v.map((l) => ({ code: l.code, description: l.description, units: l.units, unit: l.unit, multiplier: l.multiplier, rate: l.rate, total: l.total }))])),
    grandTotal,
  });

  const handleExportFwb = () => {
    if (!draft) return;
    const { draftName, ...rest } = reportParams();
    const fwb = buildFwbFromDraft({ name: draftName, ...rest });
    downloadFwb(fwb, draft.name.replace(/[^\w\-]+/g, "_"));
  };
  const handleExportExcel = () => downloadBudgetExcel(reportParams());
  const handleExportPdf = () => downloadBudgetPdf(reportParams());

  // ── Capítulos: fila inline (sin modal) ──────────────────────────────────
  const openNewChapterRow = (category: string | null) => setRowEditor({ mode: "new", category, code: "", description: "" });
  const openEditChapterRow = (chapter: BudgetingAccount) => setRowEditor({ mode: "edit", category: chapter.category, chapterId: chapter.id, code: chapter.code, description: chapter.description });
  const closeRowEditor = () => setRowEditor(null);

  const handleSaveRow = async () => {
    if (!rowEditor || !rowEditor.code.trim() || !rowEditor.description.trim()) { closeRowEditor(); return; }
    setSaving(true);
    try {
      if (rowEditor.mode === "edit" && rowEditor.chapterId) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, rowEditor.chapterId), {
          code: rowEditor.code.trim(), description: rowEditor.description.trim(),
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), {
          code: rowEditor.code.trim(), description: rowEditor.description.trim(),
          category: rowEditor.category, createdAt: Timestamp.now(),
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
      const subs = subchaptersByChapter[deleteTarget.chapterId] || [];
      for (const sub of subs) {
        const lines = linesBySubchapter[sub.id] || [];
        await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.chapterId}/subchapters/${sub.id}/detailLines`, l.id))));
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.chapterId}/subchapters`, sub.id));
      }
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, deleteTarget.chapterId));
      await touchDraft();
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  // ── Enviar a proyecto ────────────────────────────────────────────────────
  const openSendModal = async () => {
    setShowSendModal(true);
    setSendStep("pick");
    setSelectedProject(null);
    setSendError("");
    if (!user) return;
    setLoadingProjects(true);
    try {
      const upSnap = await getDocs(collection(db, `userProjects/${user.uid}/projects`));
      const eligible: EligibleProject[] = [];
      for (const d of upSnap.docs) {
        const data = d.data();
        if (!data.permissions?.accounting) continue;
        const projSnap = await getDoc(doc(db, "projects", d.id));
        if (projSnap.exists()) eligible.push({ id: d.id, name: projSnap.data().name || "Proyecto" });
      }
      setEligibleProjects(eligible);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handlePickProject = async (project: EligibleProject) => {
    setSelectedProject(project);
    setProjectStatus((p) => ({ ...p, [project.id]: "checking" }));
    const [accSnap, posSnap, invSnap] = await Promise.all([
      getDocs(query(collection(db, `projects/${project.id}/accounts`), limit(1))),
      getDocs(query(collection(db, `projects/${project.id}/pos`), limit(1))),
      getDocs(query(collection(db, `projects/${project.id}/invoices`), limit(1))),
    ]);
    const empty = accSnap.empty && posSnap.empty && invSnap.empty;
    setProjectStatus((p) => ({ ...p, [project.id]: empty ? "empty" : "occupied" }));
    if (empty) setSendStep("confirm");
  };

  const handleSendToProject = async () => {
    if (!selectedProject || !draft || !user) return;
    setSending(true);
    setSendError("");
    try {
      for (const sub of allSubchapters) {
        const accountRef = await addDoc(collection(db, `projects/${selectedProject.id}/accounts`), {
          code: sub.sub.code, description: sub.sub.description, createdAt: Timestamp.now(), createdBy: user.uid,
        });
        for (const line of linesBySubchapter[sub.sub.id] || []) {
          await addDoc(collection(db, `projects/${selectedProject.id}/accounts/${accountRef.id}/subaccounts`), {
            code: line.code, description: line.description, budgeted: line.total || 0,
            committed: 0, actual: 0, accountId: accountRef.id, createdAt: Timestamp.now(), createdBy: user.uid,
          });
        }
      }
      const now = serverTimestamp();
      await updateDoc(doc(db, "budgetingDrafts", draftId), {
        sentToProjectId: selectedProject.id, sentToProjectName: selectedProject.name, sentAt: now, updatedAt: now,
      });
      await updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), {
        status: "sent", sentToProjectName: selectedProject.name, updatedAt: now,
      });
      setSendStep("done");
    } catch (e: any) {
      setSendError(e?.message || "Error al enviar el presupuesto");
    } finally {
      setSending(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !draft || draft.ownerUid !== user?.uid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Este presupuesto no existe o no tienes acceso.</p>
      </div>
    );
  }

  const cols = "grid-cols-[110px_1fr_90px_70px]";

  const ChapterRow = ({ chapter }: { chapter: BudgetingAccount }) => {
    const isEditing = rowEditor?.mode === "edit" && rowEditor.chapterId === chapter.id;
    if (isEditing) {
      return (
        <div className={`grid ${cols} gap-2 items-center pl-7 pr-3 py-1`}>
          <input
            autoFocus
            value={rowEditor.code}
            onChange={(e) => setRowEditor({ ...rowEditor, code: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
            className="text-xs font-mono border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5"
          />
          <input
            value={rowEditor.description}
            onChange={(e) => setRowEditor({ ...rowEditor, description: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
            onBlur={handleSaveRow}
            className="text-xs border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5"
          />
          <span />
          <span className="flex items-center justify-end gap-0.5">
            <button onClick={handleSaveRow} className={`p-1 rounded ${ICON_BTN_LIGHT}`}><Check size={12} /></button>
            <button onClick={closeRowEditor} className="p-1 text-slate-300 hover:text-slate-600 rounded"><X size={12} /></button>
          </span>
        </div>
      );
    }
    return (
      <div className={`grid ${cols} gap-2 items-center pl-7 pr-3 py-1 hover:bg-white group`}>
        <button onClick={() => openEditChapterRow(chapter)} className="text-xs font-mono text-slate-400 text-left hover:text-[#8DA7BE] transition-colors">{chapter.code}</button>
        <Link href={`/budgeting/${draftId}/accounts/${chapter.id}`} className="text-xs text-slate-800 truncate group-hover:text-[#8DA7BE] transition-colors">
          {chapter.description}
        </Link>
        <span className="text-xs font-medium text-slate-700 text-right justify-self-end">{fmt(chapterTotal(chapter.id))}</span>
        <span className="flex items-center justify-end gap-0.5">
          <button
            onClick={() => setDeleteTarget({ chapterId: chapter.id, label: chapter.description })}
            className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Borrar capítulo"
          >
            <Trash2 size={11} />
          </button>
          <Link href={`/budgeting/${draftId}/accounts/${chapter.id}`}>
            <ChevronRight size={13} className="text-slate-300 group-hover:text-[#8DA7BE] group-hover:translate-x-0.5 transition-all" />
          </Link>
        </span>
      </div>
    );
  };

  const NewChapterRow = ({ category }: { category: string | null }) => {
    if (rowEditor?.mode !== "new" || rowEditor.category !== category) {
      return (
        <button onClick={() => openNewChapterRow(category)} className={`flex items-center gap-1.5 text-xs font-medium pl-7 pr-3 py-1.5 rounded-lg ${ICON_BTN_LIGHT}`}>
          <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#8DA7BE" }}>
            <Plus size={10} className="text-white" />
          </span>
          Añadir capítulo
        </button>
      );
    }
    return (
      <div className={`grid ${cols} gap-2 items-center pl-7 pr-3 py-1`}>
        <input
          autoFocus
          placeholder="Código"
          value={rowEditor.code}
          onChange={(e) => setRowEditor({ ...rowEditor, code: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
          className="text-xs font-mono border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5"
        />
        <input
          placeholder="Descripción"
          value={rowEditor.description}
          onChange={(e) => setRowEditor({ ...rowEditor, description: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSaveRow(); if (e.key === "Escape") closeRowEditor(); }}
          onBlur={handleSaveRow}
          className="text-xs border-b border-[#8DA7BE] focus:outline-none bg-transparent px-0.5 py-0.5"
        />
        <span />
        <span className="flex items-center justify-end gap-0.5">
          <button onClick={handleSaveRow} className={`p-1 rounded ${ICON_BTN_LIGHT}`}><Check size={12} /></button>
          <button onClick={closeRowEditor} className="p-1 text-slate-300 hover:text-slate-600 rounded"><X size={12} /></button>
        </span>
      </div>
    );
  };

  return (
    <div className="w-full px-10 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-sm font-semibold" style={{ color: "#1D201F" }}>{draft.name}</h1>
        <div className="flex items-center gap-3 flex-shrink-0">
          {draft.sentToProjectId && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <Check size={10} /> Enviado a {draft.sentToProjectName}
            </span>
          )}
          <div className="relative w-44">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar"
              className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleExportFwb} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Descargar .fwb">
              <Download size={14} />
            </button>
            <button onClick={handleExportExcel} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Descargar Excel">
              <FileSpreadsheet size={14} />
            </button>
            <button onClick={handleExportPdf} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Descargar PDF">
              <FileText size={14} />
            </button>
            <button onClick={handleDuplicateDraft} disabled={duplicating} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT} disabled:opacity-50`} title="Duplicar presupuesto">
              <Copy size={14} />
            </button>
            <button onClick={openSendModal} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Enviar a proyecto">
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Budget */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {catEnabled ? (
          <>
            {cats.map((cat) => {
              const catChapters = chaptersByCategory(cat.id).filter(matchesSearch);
              if (q && catChapters.length === 0) return null;
              return (
                <div key={cat.id} className="border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50/70">
                    {cat.code && <span className="text-[10px] font-mono text-slate-400">{cat.code}</span>}
                    <span className="text-xs font-semibold" style={{ color: "#1D201F" }}>{cat.label}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{fmt(categoryTotal(cat.id))}</span>
                  </div>

                  <div>
                    {catChapters.map((chapter) => <ChapterRow key={chapter.id} chapter={chapter} />)}
                    <div className="py-1">
                      <NewChapterRow category={cat.id} />
                    </div>
                  </div>
                </div>
              );
            })}

            <div className={`grid ${cols} gap-2 items-center px-4 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
              <span />
              <span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span>
              <span className="text-xs font-bold text-right justify-self-end" style={{ color: "#1D201F" }}>{fmt(grandTotal)}</span>
              <span />
            </div>
          </>
        ) : (
          <>
            {chapters.filter(matchesSearch).map((chapter) => <ChapterRow key={chapter.id} chapter={chapter} />)}
            <div className="py-1">
              <NewChapterRow category={null} />
            </div>
            <div className={`grid ${cols} gap-2 items-center px-4 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
              <span />
              <span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span>
              <span className="text-xs font-bold text-right justify-self-end" style={{ color: "#1D201F" }}>{fmt(grandTotal)}</span>
              <span />
            </div>
          </>
        )}
      </div>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar capítulo "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Se borrarán también sus subcapítulos y líneas de detalle. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Send to project modal ────────────────────────────────────────── */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">
                {sendStep === "pick" && "Enviar a proyecto"}
                {sendStep === "confirm" && "Confirmar envío"}
                {sendStep === "done" && "Enviado"}
              </h3>
              <button onClick={() => setShowSendModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>

            {sendStep === "pick" && (
              <div className="px-5 py-4">
                {loadingProjects ? (
                  <p className="text-xs text-slate-400 text-center py-6">Cargando proyectos...</p>
                ) : eligibleProjects.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No tienes proyectos con acceso a Accounting.</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {eligibleProjects.map((p) => {
                      const status = projectStatus[p.id];
                      return (
                        <button
                          key={p.id}
                          onClick={() => handlePickProject(p)}
                          disabled={status === "checking"}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 border border-slate-200 rounded-xl text-left hover:border-[#8DA7BE] transition-colors disabled:opacity-60"
                        >
                          <span className="text-sm text-slate-800 truncate">{p.name}</span>
                          {status === "checking" && <span className="text-[11px] text-slate-400 flex-shrink-0">Comprobando...</span>}
                          {status === "occupied" && <span className="text-[11px] text-amber-600 flex-shrink-0">Ya tiene actividad</span>}
                        </button>
                      );
                    })}
                    {Object.values(projectStatus).includes("occupied") && (
                      <p className="text-[11px] text-slate-400 pt-1">
                        Los proyectos con actividad en Accounting no se pueden rellenar así — contacta con el equipo de Filma Workspace para cargarlo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {sendStep === "confirm" && selectedProject && (
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm text-slate-600">
                  Se creará el presupuesto en <span className="font-medium text-slate-900">{selectedProject.name}</span>:
                </p>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Cuentas (subcapítulos)</span>
                    <span className="font-medium text-slate-900">{totalSubchapters}</span>
                  </div>
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Detail lines</span>
                    <span className="font-medium text-slate-900">{totalLines}</span>
                  </div>
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Total</span>
                    <span className="font-semibold text-slate-900">{fmt(grandTotal)}</span>
                  </div>
                </div>
                {sendError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} />
                    {sendError}
                  </div>
                )}
              </div>
            )}

            {sendStep === "done" && (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                  <Check size={18} className="text-emerald-600" />
                </div>
                <p className="text-sm text-slate-700">Enviado a {selectedProject?.name}</p>
              </div>
            )}

            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              {sendStep === "confirm" && (
                <>
                  <button onClick={() => setSendStep("pick")} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Volver
                  </button>
                  <button
                    onClick={handleSendToProject}
                    disabled={sending}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
                  >
                    {sending ? "Enviando..." : "Confirmar"}
                  </button>
                </>
              )}
              {(sendStep === "pick" || sendStep === "done") && (
                <button onClick={() => setShowSendModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
