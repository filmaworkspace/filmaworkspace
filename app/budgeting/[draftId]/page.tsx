"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
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
  AlertCircle, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Download, FileSpreadsheet,
  FileText, History, Search, Send, SlidersHorizontal, Trash2, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BTN_LIGHT_ACTIVE, BudgetingDraft, BudgetingCategoryDef, BudgetingAccount, BudgetingSubchapter, BudgetingDetailLine, BudgetingExportConfig, BudgetingFringe,
  CELL_INPUT, DEFAULT_EXPORT_CONFIG, categoriesEnabled, computeLineTotalForScenario, computeReorder, effectiveLineUnits, nextOrderValue, resolveCategories, resolveGlobals, fmtCurrency, ICON_BTN_LIGHT, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import { buildFwbFromDraft, downloadFwb } from "@/lib/budgetingExport";
import { downloadBudgetExcel, downloadBudgetPdf } from "@/lib/budgetingReports";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { chapterId: string; label: string };
type EligibleProject = { id: string; name: string };
const cols = "grid-cols-[26px_100px_1fr_100px_58px]";

// ─── Fila de capítulo — siempre editable in situ (MMB-style): sin caja, sin
// placeholder, guarda sola al perder el foco. Componentes de módulo
// estables: no se redefinen entre renders, así los inputs no pierden el foco. ──
function ChapterRow({
  chapter, draftId, fmt, total, isFirst, isLast, onCommit, onMove, onDelete,
}: {
  chapter: BudgetingAccount; draftId: string; fmt: (n: number) => string; total: number; isFirst: boolean; isLast: boolean;
  onCommit: (code: string, description: string) => void; onMove: (direction: "up" | "down") => void; onDelete: () => void;
}) {
  const [code, setCode] = useState(chapter.code);
  const [description, setDescription] = useState(chapter.description);

  const commit = () => {
    if (!code.trim() || !description.trim()) { setCode(chapter.code); setDescription(chapter.description); return; }
    onCommit(code.trim(), description.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(chapter.code); setDescription(chapter.description); }
  };

  return (
    <div className={`grid ${cols} gap-1 items-center divide-x divide-slate-100 pl-3 pr-3 py-3 hover:bg-white group`}>
      <Link href={`/budgeting/${draftId}/accounts/${chapter.id}`} className="flex items-center justify-center" title="Entrar">
        <ChevronRight size={13} className="text-slate-300 group-hover:text-[#8DA7BE] group-hover:translate-x-0.5 transition-all" />
      </Link>
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span className="text-xs font-medium text-slate-700 text-right justify-self-end pr-2">{fmt(total)}</span>
      <span className="flex items-center justify-end gap-0 pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
          <ChevronUp size={11} />
        </button>
        <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
          <ChevronDown size={11} />
        </button>
        <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar capítulo">
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  );
}

function NewChapterRow({ onCommit }: { onCommit: (code: string, description: string) => Promise<boolean> }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const commit = async () => {
    if (!code.trim() || !description.trim()) return;
    const ok = await onCommit(code.trim(), description.trim());
    if (ok) { setCode(""); setDescription(""); }
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
  return (
    <div className={`grid ${cols} gap-1 items-center divide-x divide-slate-100 pl-3 pr-3 py-3`}>
      <span />
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span /><span />
    </div>
  );
}

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

  // Snapshots / versiones
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  // Configuración de exportación (portada, paginación, campos)
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (exportPanelRef.current && !exportPanelRef.current.contains(e.target as Node)) setExportPanelOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
  const fringes: BudgetingFringe[] = draft?.fringes || [];
  const scenarios = draft?.scenarios || [];

  // Escenarios: solo una previsualización en vivo — recalcula el total de las
  // líneas con fórmula bajo otro juego de Globales, sin escribir nada. Las
  // líneas sin fórmula (número suelto) no cambian entre escenarios.
  const activeScenarioId = draft?.activeScenarioId || null;
  const scenarioGlobalValues = useMemo(
    () => resolveGlobals(draft?.globals || [], activeScenarioId).values,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft?.globals), activeScenarioId]
  );
  const effectiveLines = (subId: string): BudgetingDetailLine[] => {
    const raw = linesBySubchapter[subId] || [];
    if (!activeScenarioId) return raw;
    return raw.map((l) => ({ ...l, total: computeLineTotalForScenario(l, scenarioGlobalValues), units: effectiveLineUnits(l, scenarioGlobalValues) }));
  };
  const setActiveScenario = async (id: string | null) => {
    await updateDoc(doc(db, "budgetingDrafts", draftId), { activeScenarioId: id, updatedAt: serverTimestamp() });
  };

  const fringeAmount = (f: BudgetingFringe, line: BudgetingDetailLine) =>
    f.type === "percent" ? (line.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (line.units || 0);

  const subTotal = (sub: BudgetingSubchapter) => {
    const lines = effectiveLines(sub.id);
    const subScoped = lines.reduce((s, l) => s + (l.fringeIds || [])
      .map((id) => fringes.find((f) => f.id === id))
      .filter((f): f is BudgetingFringe => !!f && f.scope === "subchapter")
      .reduce((s2, f) => s2 + fringeAmount(f, l), 0), 0);
    return subchapterTotal(sub, lines) + subScoped;
  };
  const chapterFringesTotal = (chapterId: string) => {
    const subs = subchaptersByChapter[chapterId] || [];
    let sum = 0;
    for (const sub of subs) {
      for (const l of effectiveLines(sub.id)) {
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (f && f.scope === "chapter") sum += fringeAmount(f, l);
        }
      }
    }
    return sum;
  };
  const totalScopedFringes = () => {
    let sum = 0;
    for (const sub of allSubchapters) {
      for (const l of effectiveLines(sub.sub.id)) {
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (f && f.scope === "total") sum += fringeAmount(f, l);
        }
      }
    }
    return Math.round(sum * 100) / 100;
  };

  const chaptersByCategory = (categoryId: string | null) => sortByOrder(chapters.filter((c) => c.category === categoryId));
  const chapterTotal = (chapterId: string) => Math.round(((subchaptersByChapter[chapterId] || []).reduce((s, sub) => s + subTotal(sub), 0) + chapterFringesTotal(chapterId)) * 100) / 100;
  const categoryTotal = (categoryId: string) => chaptersByCategory(categoryId).reduce((s, c) => s + chapterTotal(c.id), 0);
  const grandTotalFringes = totalScopedFringes();
  const grandTotal = (catEnabled
    ? cats.reduce((s, c) => s + categoryTotal(c.id), 0)
    : chapters.reduce((s, c) => s + chapterTotal(c.id), 0)) + grandTotalFringes;
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
        globals: draft.globals ?? [], globalFolders: draft.globalFolders ?? [],
        fringes: draft.fringes ?? [], fringeFolders: draft.fringeFolders ?? [],
        phases: draft.phases ?? [], exportConfig: draft.exportConfig ?? null,
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, newRef.id), {
        name: newName, updatedAt: now, status: "draft", sentToProjectName: null,
      });
      // Nota: la copia no preserva redirecciones entre líneas (routedTo) — se copian como líneas normales, sin redirigir.
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
              code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
              multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
              supplier: line.supplier || "", notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
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
    linesBySubchapter: Object.fromEntries(Object.entries(linesBySubchapter).map(([k, v]) => [k, v.map((l) => ({
      code: l.code, description: l.description, units: l.units, unit: l.unit, multiplier: l.multiplier, rate: l.rate, total: l.total,
      supplier: l.supplier, notes: l.notes, tags: l.tags,
      routedTo: l.routedTo ? { subchapterCode: l.routedTo.subchapterCode } : null,
    }))])),
    grandTotal,
    exportConfig: draft?.exportConfig,
  });

  const handleExportFwb = () => {
    if (!draft) return;
    const { draftName, ...rest } = reportParams();
    const fwb = buildFwbFromDraft({ name: draftName, ...rest });
    downloadFwb(fwb, draft.name.replace(/[^\w\-]+/g, "_"));
  };
  const handleExportExcel = () => downloadBudgetExcel(reportParams());
  const handleExportPdf = () => downloadBudgetPdf(reportParams());

  const exportConfig: BudgetingExportConfig = draft?.exportConfig || DEFAULT_EXPORT_CONFIG;
  const updateExportConfig = async (patch: { coverSheet?: boolean; pageBreakPerChapter?: boolean; fields?: Partial<BudgetingExportConfig["fields"]> }) => {
    const next: BudgetingExportConfig = { ...exportConfig, ...patch, fields: { ...exportConfig.fields, ...(patch.fields || {}) } };
    await updateDoc(doc(db, "budgetingDrafts", draftId), { exportConfig: next, updatedAt: serverTimestamp() });
  };

  // ── Snapshots / versiones — foto congelada del árbol, sin duplicar el borrador ──
  const handleSaveSnapshot = async () => {
    if (!user || !snapshotLabel.trim()) return;
    setSavingSnapshot(true);
    try {
      const tree = chapters.map((chapter) => ({
        id: chapter.id, code: chapter.code, description: chapter.description, category: chapter.category,
        subchapters: (subchaptersByChapter[chapter.id] || []).map((sub) => ({
          id: sub.id, code: sub.code, description: sub.description,
          lines: (linesBySubchapter[sub.id] || []).map((l) => ({ id: l.id, code: l.code, description: l.description, total: l.total || 0 })),
        })),
      }));
      await addDoc(collection(db, `budgetingDrafts/${draftId}/snapshots`), {
        label: snapshotLabel.trim(), createdAt: Timestamp.now(), createdBy: user.uid, grandTotal, chapters: tree,
      });
      setShowSnapshotModal(false);
      setSnapshotLabel("");
    } finally {
      setSavingSnapshot(false);
    }
  };

  // ── Capítulos: fila siempre editable, sin modal ─────────────────────────
  const handleCommitChapter = async (chapter: BudgetingAccount, code: string, description: string) => {
    if (code === chapter.code && description === chapter.description) return;
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, chapter.id), { code, description });
    await touchDraft();
  };

  const handleCommitNewChapter = async (category: string | null, code: string, description: string): Promise<boolean> => {
    await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), { code, description, category, order: nextOrderValue(), createdAt: Timestamp.now() });
    await touchDraft();
    return true;
  };

  const handleMoveChapter = async (chapter: BudgetingAccount, direction: "up" | "down") => {
    const siblings = chaptersByCategory(chapter.category);
    const swaps = computeReorder(siblings, chapter.id, direction);
    if (!swaps) return;
    await Promise.all(swaps.map((s) => updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, s.id), { order: s.order })));
    await touchDraft();
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
      // Dos pasadas: primero una Account por cada Subcapítulo, luego las SubAccounts —
      // así una línea con `routedTo` puede colocarse bajo la Account de su destino
      // real en vez de la de su ubicación física.
      const accountIdBySubchapterId: Record<string, string> = {};
      for (const sub of allSubchapters) {
        const accountRef = await addDoc(collection(db, `projects/${selectedProject.id}/accounts`), {
          code: sub.sub.code, description: sub.sub.description, createdAt: Timestamp.now(), createdBy: user.uid,
        });
        accountIdBySubchapterId[sub.sub.id] = accountRef.id;
      }
      for (const sub of allSubchapters) {
        for (const line of linesBySubchapter[sub.sub.id] || []) {
          const targetSubId = line.routedTo?.subchapterId ?? sub.sub.id;
          const accountId = accountIdBySubchapterId[targetSubId] ?? accountIdBySubchapterId[sub.sub.id];
          await addDoc(collection(db, `projects/${selectedProject.id}/accounts/${accountId}/subaccounts`), {
            code: line.code, description: line.description, budgeted: line.total || 0,
            committed: 0, actual: 0, accountId, createdAt: Timestamp.now(), createdBy: user.uid,
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
          {scenarios.length > 0 && (
            <div className="flex items-center gap-1 p-0.5 border border-slate-200 rounded-lg bg-slate-50" title="Vista previa de escenario — no cambia lo guardado">
              <button onClick={() => setActiveScenario(null)} className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${!activeScenarioId ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}>
                Real
              </button>
              {scenarios.map((sc) => (
                <button key={sc.id} onClick={() => setActiveScenario(sc.id)} className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${activeScenarioId === sc.id ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}>
                  {sc.label}
                </button>
              ))}
            </div>
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
            <div ref={exportPanelRef} className="relative">
              <button onClick={() => setExportPanelOpen((o) => !o)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Configurar exportación">
                <SlidersHorizontal size={14} />
              </button>
              {exportPanelOpen && (
                <div className="absolute z-30 top-full right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3.5 space-y-3">
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Exportación Excel / PDF</p>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-700">Portada con totales</span>
                    <input type="checkbox" checked={exportConfig.coverSheet} onChange={(e) => updateExportConfig({ coverSheet: e.target.checked })} className="accent-[#8DA7BE]" />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-700">Salto de página por capítulo</span>
                    <input type="checkbox" checked={exportConfig.pageBreakPerChapter} onChange={(e) => updateExportConfig({ pageBreakPerChapter: e.target.checked })} className="accent-[#8DA7BE]" />
                  </label>
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Campos visibles</p>
                    <div className="space-y-1.5">
                      {([["unit", "Unidad"], ["supplier", "Proveedor"], ["notes", "Notas"], ["tags", "Etiquetas"]] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-700">{label}</span>
                          <input type="checkbox" checked={exportConfig.fields[key]} onChange={(e) => updateExportConfig({ fields: { [key]: e.target.checked } as Partial<BudgetingExportConfig["fields"]> })} className="accent-[#8DA7BE]" />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Link href={`/budgeting/${draftId}/versions`} className={`p-1.5 rounded-lg inline-flex ${ICON_BTN_LIGHT}`} title="Versiones">
              <History size={14} />
            </Link>
            <button onClick={() => setShowSnapshotModal(true)} className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`} title="Guardar una foto del presupuesto actual">
              Guardar versión
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

      {activeScenarioId && (
        <div className="flex items-center gap-1.5 mb-3 text-[11px] font-medium" style={{ color: "#8DA7BE" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#8DA7BE" }} />
          Previsualizando "{scenarios.find((s) => s.id === activeScenarioId)?.label}" — los totales de abajo son una simulación, no se ha guardado nada.
        </div>
      )}

      {/* Budget */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <div className={`grid ${cols} gap-1 pl-3 pr-3 py-2 border-b border-slate-200 divide-x divide-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
          <span></span>
          <span className="pl-2">Código</span>
          <span className="pl-2">Descripción</span>
          <span className="text-right pr-2">Total</span>
          <span></span>
        </div>
        {catEnabled && cats.length > 0 ? (
          <>
            {cats.map((cat) => {
              const catChapters = chaptersByCategory(cat.id).filter(matchesSearch);
              if (q && catChapters.length === 0) return null;
              return (
                <div key={cat.id} className="border-b border-slate-100 last:border-0">
                  <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/70">
                    {cat.code && <span className="text-[10px] font-mono text-slate-400">{cat.code}</span>}
                    <span className="text-xs font-semibold" style={{ color: "#1D201F" }}>{cat.label}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{fmt(categoryTotal(cat.id))}</span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {catChapters.map((chapter, i) => (
                      <ChapterRow
                        key={chapter.id}
                        chapter={chapter}
                        draftId={draftId}
                        fmt={fmt}
                        total={chapterTotal(chapter.id)}
                        isFirst={i === 0}
                        isLast={i === catChapters.length - 1}
                        onCommit={(code, description) => handleCommitChapter(chapter, code, description)}
                        onMove={(direction) => handleMoveChapter(chapter, direction)}
                        onDelete={() => setDeleteTarget({ chapterId: chapter.id, label: chapter.description })}
                      />
                    ))}
                    <NewChapterRow onCommit={(code, description) => handleCommitNewChapter(cat.id, code, description)} />
                  </div>
                </div>
              );
            })}

            {grandTotalFringes > 0 && (
              <p className="text-[10px] text-slate-400 px-4 pt-1.5">+{fmt(grandTotalFringes)} en cargas sociales del presupuesto entero</p>
            )}
            <div className={`grid ${cols} gap-1 items-center pl-3 pr-3 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
              <span />
              <span />
              <span className="text-xs font-bold pl-2" style={{ color: "#1D201F" }}>Total</span>
              <span className="text-xs font-bold text-right pr-2" style={{ color: "#1D201F" }}>{fmt(grandTotal)}</span>
              <span />
            </div>
          </>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {(() => {
                const flatSorted = sortByOrder(chapters.filter(matchesSearch));
                return flatSorted.map((chapter, i) => (
                  <ChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    draftId={draftId}
                    fmt={fmt}
                    total={chapterTotal(chapter.id)}
                    isFirst={i === 0}
                    isLast={i === flatSorted.length - 1}
                    onCommit={(code, description) => handleCommitChapter(chapter, code, description)}
                    onMove={(direction) => handleMoveChapter(chapter, direction)}
                    onDelete={() => setDeleteTarget({ chapterId: chapter.id, label: chapter.description })}
                  />
                ));
              })()}
            </div>
            <NewChapterRow onCommit={(code, description) => handleCommitNewChapter(null, code, description)} />
            {grandTotalFringes > 0 && (
              <p className="text-[10px] text-slate-400 px-4 pt-1.5">+{fmt(grandTotalFringes)} en cargas sociales del presupuesto entero</p>
            )}
            <div className={`grid ${cols} gap-1 items-center pl-3 pr-3 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
              <span />
              <span />
              <span className="text-xs font-bold pl-2" style={{ color: "#1D201F" }}>Total</span>
              <span className="text-xs font-bold text-right pr-2" style={{ color: "#1D201F" }}>{fmt(grandTotal)}</span>
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

      {/* ── Guardar versión ──────────────────────────────────────────────── */}
      {showSnapshotModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Guardar versión</h3>
              <button onClick={() => setShowSnapshotModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre de esta versión</label>
              <input
                autoFocus
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && snapshotLabel.trim()) handleSaveSnapshot(); }}
                placeholder="Cierre semana 3"
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
              />
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowSnapshotModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSaveSnapshot} disabled={!snapshotLabel.trim() || savingSnapshot} className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}>
                {savingSnapshot ? "Guardando..." : "Guardar"}
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
