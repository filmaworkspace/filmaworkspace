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
  AlertCircle, Building2, BookmarkPlus, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Download, FileDown, FileSpreadsheet,
  FileText, FolderOutput, History, MoreHorizontal, Search, Share2, Trash2, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BTN_LIGHT_ACTIVE, BudgetingDraft, BudgetingCategoryDef, BudgetingAccount, BudgetingSubchapter, BudgetingDetailLine, BudgetingExportConfig, BudgetingFolder, BudgetingFringe, BudgetingFringeVisibility, BudgetingProjectInfo, FringeGroupTarget,
  CELL_INPUT, DEFAULT_EXPORT_CONFIG, DEFAULT_FRINGE_VISIBILITY, DEFAULT_TEXT_LINE_COLOR, DEFAULT_UNITS, PDF_FONT_SIZE_LABELS, PDF_LANGUAGE_LABELS, PdfFontSize, PdfLanguage, categoriesEnabled, clearBudgetingClipboard, computeLineTotalForScenario, computeReorder, effectiveLineUnits, focusBudgetingRowField, getBudgetingClipboard, groupFringeSumsByFolder, orderAfter, resolveCategories, resolveGlobals, setBudgetingClipboard, fmtCurrency, ICON_BTN_LIGHT, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import { buildFwbFromDraft, downloadFwb } from "@/lib/budgetingExport";
import { downloadBudgetExcel, downloadBudgetPdf } from "@/lib/budgetingReports";
import BudgetingColumnsMenu from "@/components/BudgetingColumnsMenu";
import BudgetingFringeLineRow from "@/components/BudgetingFringeLineRow";
import BudgetingRowContextMenu, { BudgetingRowContextMenuState } from "@/components/BudgetingRowContextMenu";
import BudgetLevelMappingChoice, { BudgetSubaccountLevel } from "@/components/BudgetLevelMappingChoice";
import BudgetingShareModal from "@/components/BudgetingShareModal";
import BudgetingPhantomRow from "@/components/BudgetingPhantomRow";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { chapterId: string; label: string };
// Array siempre (aunque sea de un solo capítulo), para poder borrar toda la
// selección múltiple de una vez, igual que copiar/cortar.
type DeleteTargets = DeleteTarget[];
type EligibleProject = { id: string; name: string };
const cols = "grid-cols-[26px_100px_1fr_100px_58px]";

/** Todo lo que hace falta para recrear un Capítulo entero al copiarlo/cortarlo: sus Cuentas y las líneas de Detalle de cada una. */
interface ChapterLineClipboardData {
  code: string; description: string; units: number; unitsExpr: string | null; unit: string;
  multiplier: number; multiplierExpr: string | null; rate: number; rateExpr: string | null; total: number;
  notes: string; tags: string[]; fringeIds: string[];
  isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
}
interface ChapterSubClipboardData {
  code: string; description: string; isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
  lines: ChapterLineClipboardData[];
}
interface ChapterClipboardData {
  code: string; description: string; isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
  subchapters: ChapterSubClipboardData[];
}

// ─── Fila de capítulo, siempre editable in situ (MMB-style): sin caja, sin
// placeholder, guarda sola al perder el foco. Componentes de módulo
// estables: no se redefinen entre renders, así los inputs no pierden el foco. ──
function ChapterRow({
  chapter, draftId, fmt, total, subtotalValue, isFirst, isLast, autoFocus, selected, onCommit, onCommitTextLine, onMove, onDelete, onContextMenu, onRowMouseDown,
}: {
  chapter: BudgetingAccount; draftId: string; fmt: (n: number) => string; total: number; subtotalValue?: number; isFirst: boolean; isLast: boolean; autoFocus?: boolean; selected?: boolean;
  onCommit: (code: string, description: string) => void;
  onCommitTextLine: (patch: { description?: string; textBold?: boolean; textColor?: string }) => void;
  onMove: (direction: "up" | "down") => void; onDelete: () => void; onContextMenu: (e: React.MouseEvent) => void; onRowMouseDown: (e: React.MouseEvent) => void;
}) {
  const [code, setCode] = useState(chapter.code);
  const [description, setDescription] = useState(chapter.description);

  // Las filas ya existen desde que se crean (botón "+ Añadir línea" o clic
  // derecho), así que cada campo se guarda por su cuenta al salir de la
  // celda: no hace falta rellenar código y descripción a la vez, o el otro
  // se borraba solo al perder el foco.
  const commit = () => onCommit(code.trim(), description.trim());
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "down"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "up"); }
    else if (e.key === "Escape") { setCode(chapter.code); setDescription(chapter.description); }
  };

  if (chapter.isTextLine || chapter.isSubtotal) {
    const isSubtotal = !!chapter.isSubtotal;
    const commitText = () => {
      if (!description.trim()) { setDescription(chapter.description); return; }
      if (description.trim() !== chapter.description) onCommitTextLine({ description: description.trim() });
    };
    const handleTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "down"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "up"); }
      else if (e.key === "Escape") setDescription(chapter.description);
    };
    return (
      <div data-budget-row className={`grid ${cols} gap-0 divide-x divide-slate-200 pl-3 pr-3 hover:bg-white group ${selected ? "bg-[#E86F4A]/[0.08]" : ""}`} onContextMenu={onContextMenu} onMouseDown={onRowMouseDown}>
        <span />
        <input
          autoFocus={autoFocus}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitText}
          onKeyDown={handleTextKeyDown}
          placeholder={isSubtotal ? "Subtotal" : "Texto"}
          style={{ gridColumn: isSubtotal ? "2 / 4" : "2 / 5", color: chapter.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: chapter.textBold ? 700 : 400 }}
          className={`${CELL_INPUT} text-xs pl-2`}
        />
        {isSubtotal && (
          <span className="flex items-center justify-end text-xs pr-2" style={{ color: chapter.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: chapter.textBold ? 700 : 400 }}>
            {fmt(subtotalValue || 0)}
          </span>
        )}
        <span className="flex items-center justify-end gap-1 pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#E86F4A] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
            <ChevronUp size={11} />
          </button>
          <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#E86F4A] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
            <ChevronDown size={11} />
          </button>
          <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
            <Trash2 size={11} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div data-budget-row className={`grid ${cols} gap-0 divide-x divide-slate-200 pl-3 pr-3 hover:bg-white group ${selected ? "bg-[#E86F4A]/[0.08]" : ""}`} onContextMenu={onContextMenu} onMouseDown={onRowMouseDown}>
      <Link href={`/budgeting/${draftId}/accounts/${chapter.id}`} className="flex items-center justify-center" title="Entrar">
        <ChevronRight size={13} className="text-slate-300 group-hover:text-[#E86F4A] group-hover:translate-x-0.5 transition-all" />
      </Link>
      <input autoFocus={autoFocus} value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`} />
      <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span className="flex items-center justify-end text-xs font-medium text-slate-700 pr-2">{fmt(total)}</span>
      <span className="flex items-center justify-end gap-0 pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#E86F4A] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
          <ChevronUp size={11} />
        </button>
        <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#E86F4A] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
          <ChevronDown size={11} />
        </button>
        <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar capítulo">
          <Trash2 size={11} />
        </button>
      </span>
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

  const [deleteTarget, setDeleteTarget] = useState<DeleteTargets | null>(null);
  // id de la última línea de texto recién creada, para autoenfocarla al aparecer
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  // Menú de clic derecho: la categoría se guarda aparte porque el componente
  // compartido no la conoce, solo hace falta para saber dónde insertar.
  const [chapterMenu, setChapterMenu] = useState<BudgetingRowContextMenuState | null>(null);
  const [chapterMenuCategory, setChapterMenuCategory] = useState<string | null>(null);
  // Selección múltiple de Capítulos (mismo patrón que en Detalle): shift =
  // rango desde la última ancla, cmd/ctrl = suelta una a una. La ancla
  // guarda también la categoría, porque el rango solo tiene sentido dentro
  // de la lista de esa categoría (o la lista plana si no hay categorías).
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [chapterSelectionAnchor, setChapterSelectionAnchor] = useState<{ id: string; category: string | null } | null>(null);

  // Enviar a proyecto
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendStep, setSendStep] = useState<"pick" | "mapping" | "confirm" | "done">("pick");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<EligibleProject | null>(null);
  const [projectStatus, setProjectStatus] = useState<Record<string, "checking" | "empty" | "occupied">>({});
  const [sending, setSending] = useState(false);
  // Budgeting tiene 3 niveles (Capítulo→Cuenta→Detalle), Accounting solo 2
  // (Cuenta→Subcuenta): hay que elegir cuál se queda como código operativo.
  const [subaccountLevel, setSubaccountLevel] = useState<BudgetSubaccountLevel>("subchapter");
  const [sendError, setSendError] = useState("");

  // Snapshots / versiones
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  // Exportar: un solo botón desplegable con las descargas (.fwb/Excel/PDF) y,
  // debajo, la configuración (portada, paginación, campos) de ese mismo menú.
  const [exportPanelOpen, setExportPanelOpen] = useState(false);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (exportPanelRef.current && !exportPanelRef.current.contains(e.target as Node)) setExportPanelOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // "···" Más acciones: agrupa lo que antes eran 5 iconos sueltos (plantilla,
  // versiones, guardar versión, duplicar) para no saturar la barra superior;
  // "Enviar a proyecto" se queda fuera, como botón propio, por ser la acción
  // principal de cierre de un presupuesto.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Compartir: envía una copia completa e independiente a otro usuario (ver
  // BudgetingShareModal y app/api/budgeting/share/route.ts) — no es un link en vivo.
  const [showShareModal, setShowShareModal] = useState(false);

  // Guardar como plantilla: estructura reutilizable para arrancar otro borrador
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState("");

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
  const fringeFolders: BudgetingFolder[] = draft?.fringeFolders || [];
  const fringeVisibility: BudgetingFringeVisibility = draft?.fringeVisibility || DEFAULT_FRINGE_VISIBILITY;
  const scenarios = draft?.scenarios || [];

  // Escenarios: solo una previsualización en vivo, recalcula el total de las
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
  // Cargas sociales con alcance de todo el presupuesto: agrupadas por
  // carpeta en una sola línea de presupuesto (ver groupFringeSumsByFolder);
  // las que no tienen carpeta siguen apareciendo cada una con su propio código.
  const topFringeBreakdown = (() => {
    const sums = new Map<string, number>();
    for (const sub of allSubchapters) {
      for (const l of effectiveLines(sub.sub.id)) {
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (!f || f.scope !== "total") continue;
          sums.set(f.id, (sums.get(f.id) || 0) + fringeAmount(f, l));
        }
      }
    }
    return groupFringeSumsByFolder(sums, fringes, fringeFolders);
  })();

  const chaptersByCategory = (categoryId: string | null) => sortByOrder(chapters.filter((c) => c.category === categoryId));
  const chapterTotal = (chapterId: string) => Math.round(((subchaptersByChapter[chapterId] || []).reduce((s, sub) => s + subTotal(sub), 0) + chapterFringesTotal(chapterId)) * 100) / 100;
  const categoryTotal = (categoryId: string) => chaptersByCategory(categoryId).reduce((s, c) => s + chapterTotal(c.id), 0);
  const grandTotalFringes = Math.round(topFringeBreakdown.reduce((s, b) => s + b.amount, 0) * 100) / 100;
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

  // El código y el nombre de una fila de fringes se editan desde su propia
  // línea en el Top Sheet: si la fila es una carpeta (varios fringes
  // fundidos), edita esa carpeta; si es un fringe sin carpeta, edita ese
  // fringe. El importe de la fila no se toca aquí, sale calculado.
  const handleCommitFringeGroup = async (target: FringeGroupTarget, code: string, label: string) => {
    if (target.type === "folder") {
      const folder = fringeFolders.find((fo) => fo.id === target.folderId);
      if (folder && code === (folder.code || "") && label === folder.label) return;
      const next = fringeFolders.map((fo) => (fo.id === target.folderId ? { ...fo, code, label } : fo));
      await updateDoc(doc(db, "budgetingDrafts", draftId), { fringeFolders: next, updatedAt: serverTimestamp() });
    } else {
      const fringe = fringes.find((f) => f.id === target.fringeId);
      if (fringe && code === fringe.code && label === fringe.label) return;
      const next = fringes.map((f) => (f.id === target.fringeId ? { ...f, code, label } : f));
      await updateDoc(doc(db, "budgetingDrafts", draftId), { fringes: next, updatedAt: serverTimestamp() });
    }
    await touchDraft();
  };

  const updateFringeVisibility = async (patch: Partial<BudgetingFringeVisibility>) => {
    await updateDoc(doc(db, "budgetingDrafts", draftId), { fringeVisibility: { ...fringeVisibility, ...patch }, updatedAt: serverTimestamp() });
    await touchDraft();
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
        detailColumnsConfig: draft.detailColumnsConfig ?? null,
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, newRef.id), {
        name: newName, updatedAt: now, status: "draft", sentToProjectName: null,
      });
      // Nota: la copia no preserva redirecciones entre líneas (routedTo); se copian como líneas normales, sin redirigir.
      for (const chapter of chapters) {
        const newChapterRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts`), {
          code: chapter.code, description: chapter.description, category: chapter.category, createdAt: Timestamp.now(),
          isTextLine: chapter.isTextLine || false, isSubtotal: chapter.isSubtotal || false, textBold: chapter.textBold || false, textColor: chapter.textColor || null,
        });
        for (const sub of subchaptersByChapter[chapter.id] || []) {
          const newSubRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newChapterRef.id}/subchapters`), {
            code: sub.code, description: sub.description, createdAt: Timestamp.now(),
            isTextLine: sub.isTextLine || false, isSubtotal: sub.isSubtotal || false, textBold: sub.textBold || false, textColor: sub.textColor || null,
          });
          for (const line of linesBySubchapter[sub.id] || []) {
            await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newChapterRef.id}/subchapters/${newSubRef.id}/detailLines`), {
              code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
              multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
              notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
              isTextLine: line.isTextLine || false, isSubtotal: line.isSubtotal || false, textBold: line.textBold || false, textColor: line.textColor || null,
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

  // Las líneas de texto son solo notas dentro de la app: no se mandan a
  // Excel/.fwb (ahí no tienen importe ni código que mostrar). El PDF sí las
  // incluye, con su negrita/color, porque ahí se ve el presupuesto completo
  // tal cual está montado en pantalla.
  const buildReportParams = (includeTextLines: boolean) => ({
    draftName: draft?.name || "Presupuesto",
    currency,
    categoriesEnabled: catEnabled,
    categories: cats,
    chaptersByCategory: (categoryId: string | null) => chaptersByCategory(categoryId)
      .filter((c) => includeTextLines || (!c.isTextLine && !c.isSubtotal))
      .map((c) => ({ id: c.id, code: c.code, description: c.description, isTextLine: c.isTextLine || false, isSubtotal: c.isSubtotal || false, textBold: c.textBold || false, textColor: c.textColor || null })),
    // `subchaptersByChapter`/`linesBySubchapter` vienen de onSnapshot en el
    // orden que Firestore quiera darlos, no en el orden manual de la app
    // (campo `order`): hay que ordenarlos aquí igual que en pantalla, o el
    // export sale con las filas descolocadas frente a lo que se ve.
    subchaptersByChapter: Object.fromEntries(Object.entries(subchaptersByChapter).map(([k, v]) => [k, sortByOrder(v)
      .filter((s) => includeTextLines || (!s.isTextLine && !s.isSubtotal))
      .map((s) => ({
        id: s.id, code: s.code, description: s.description, receivedTotal: s.receivedTotal || 0,
        // Sin valor por defecto en español aquí: si no se ha puesto uno propio,
        // el builder del PDF rellena el texto por defecto en el idioma elegido.
        receivedCode: s.receivedCode || "", receivedLabel: s.receivedLabel || "",
        isTextLine: s.isTextLine || false, isSubtotal: s.isSubtotal || false, textBold: s.textBold || false, textColor: s.textColor || null,
      }))])),
    linesBySubchapter: Object.fromEntries(Object.entries(linesBySubchapter).map(([k, v]) => [k, sortByOrder(v)
      .filter((l) => includeTextLines || (!l.isTextLine && !l.isSubtotal))
      .map((l) => ({
        id: l.id, code: l.code, description: l.description, units: l.units, unit: l.unit, multiplier: l.multiplier, rate: l.rate, total: l.total,
        notes: l.notes, tags: l.tags, fringeIds: l.fringeIds || [],
        routedTo: l.routedTo ? { subchapterCode: l.routedTo.subchapterCode } : null,
        isTextLine: l.isTextLine || false, isSubtotal: l.isSubtotal || false, textBold: l.textBold || false, textColor: l.textColor || null,
      }))])),
    fringes,
    fringeFolders,
    units: draft?.units ?? DEFAULT_UNITS,
    projectInfo: draft?.projectInfo,
    grandTotal,
    exportConfig: draft?.exportConfig,
  });
  const reportParams = () => buildReportParams(false);
  const pdfReportParams = () => buildReportParams(true);

  const handleExportFwb = () => {
    if (!draft) return;
    const { draftName, ...rest } = reportParams();
    const fwb = buildFwbFromDraft({ name: draftName, ...rest });
    downloadFwb(fwb, draft.name.replace(/[^\w\-]+/g, "_"));
  };
  const handleExportExcel = () => downloadBudgetExcel(reportParams());
  const handleExportPdf = () => downloadBudgetPdf(pdfReportParams());

  // ── Guardar como plantilla: misma estructura que un .fwb, pero se queda
  // guardada en la cuenta del usuario para arrancar otro borrador desde ahí. ──
  const handleSaveTemplate = async () => {
    if (!user || !draft || !templateName.trim()) return;
    setSavingTemplate(true);
    setTemplateError("");
    try {
      const { draftName, ...rest } = reportParams();
      const structure = buildFwbFromDraft({ name: templateName.trim(), ...rest });
      await addDoc(collection(db, `userBudgetingTemplates/${user.uid}/templates`), {
        name: templateName.trim(),
        structure,
        chapterCount: chapters.length,
        lineCount: totalLines,
        createdAt: Timestamp.now(),
      });
      setShowTemplateModal(false);
      setTemplateName("");
    } catch (e: any) {
      console.error("[Budgeting] Error guardando plantilla:", e);
      setTemplateError(e?.message || "No se pudo guardar la plantilla");
    } finally {
      setSavingTemplate(false);
    }
  };

  const exportConfig: BudgetingExportConfig = draft?.exportConfig || DEFAULT_EXPORT_CONFIG;
  const updateExportConfig = async (patch: { coverSheet?: boolean; pageBreakPerChapter?: boolean; pdfFontSize?: PdfFontSize; pdfLanguage?: PdfLanguage; hideZeroTotalSubchapters?: boolean; fields?: Partial<BudgetingExportConfig["fields"]> }) => {
    const next: BudgetingExportConfig = { ...exportConfig, ...patch, fields: { ...exportConfig.fields, ...(patch.fields || {}) } };
    await updateDoc(doc(db, "budgetingDrafts", draftId), { exportConfig: next, updatedAt: serverTimestamp() });
  };

  // ── Datos de producción para la portada del PDF (ver lib/budgetingReports.ts) ──
  const projectInfo: BudgetingProjectInfo = draft?.projectInfo || {};
  const [showProjectInfoModal, setShowProjectInfoModal] = useState(false);
  const [projectInfoForm, setProjectInfoForm] = useState<BudgetingProjectInfo>({});
  const openProjectInfoModal = () => { setProjectInfoForm(projectInfo); setShowProjectInfoModal(true); };
  const [savingProjectInfo, setSavingProjectInfo] = useState(false);
  const handleSaveProjectInfo = async () => {
    setSavingProjectInfo(true);
    try {
      await updateDoc(doc(db, "budgetingDrafts", draftId), { projectInfo: projectInfoForm, updatedAt: serverTimestamp() });
      setShowProjectInfoModal(false);
    } finally {
      setSavingProjectInfo(false);
    }
  };

  // ── Snapshots / versiones: foto congelada del árbol, sin duplicar el borrador ──
  const handleSaveSnapshot = async () => {
    if (!user || !snapshotLabel.trim()) return;
    setSavingSnapshot(true);
    try {
      // Mismo orden que en pantalla (campo `order`), no el que devuelva
      // Firestore, para que el comparador de versiones no salga descolocado.
      const tree = sortByOrder(chapters).map((chapter) => ({
        id: chapter.id, code: chapter.code, description: chapter.description, category: chapter.category,
        subchapters: sortByOrder(subchaptersByChapter[chapter.id] || []).map((sub) => ({
          id: sub.id, code: sub.code, description: sub.description,
          lines: sortByOrder(linesBySubchapter[sub.id] || []).map((l) => ({ id: l.id, code: l.code, description: l.description, total: l.total || 0 })),
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

  // ── Línea de texto / subtotal (mismo doc de capítulo, marcado con
  // isTextLine/isSubtotal, para poder intercalarlas entre capítulos reales).
  // Se insertan justo debajo de la fila donde se abrió el menú contextual. ──
  const handleInsertChapter = async (afterId: string | null, category: string | null, kind: "item" | "text" | "subtotal") => {
    const siblings = chaptersByCategory(category);
    const order = orderAfter(siblings, afterId);
    const base: Record<string, unknown> = { category, order, createdAt: Timestamp.now(), code: "", description: "" };
    if (kind === "text") Object.assign(base, { isTextLine: true, textBold: false, textColor: DEFAULT_TEXT_LINE_COLOR });
    if (kind === "subtotal") Object.assign(base, { description: "Subtotal", isSubtotal: true, textBold: true, textColor: DEFAULT_TEXT_LINE_COLOR });
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), base);
    await touchDraft();
    setJustAddedId(ref.id);
  };
  /** Primera fila de una categoría (o de la lista plana) vacía: se crea de verdad en cuanto se escribe algo, no antes (ver BudgetingPhantomRow). */
  const handleCreateChapterFromPhantom = async (category: string | null, code: string, description: string) => {
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), { category, order: orderAfter([], null), createdAt: Timestamp.now(), code, description });
    await touchDraft();
    setJustAddedId(ref.id);
  };
  const handleCommitTextChapter = async (chapter: BudgetingAccount, patch: { description?: string; textBold?: boolean; textColor?: string }) => {
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, chapter.id), patch);
    await touchDraft();
  };
  /** Suma de los capítulos normales desde el subtotal anterior (o el principio) hasta `subtotalId`, dentro de la misma categoría. */
  const chapterSubtotalValue = (category: string | null, subtotalId: string): number => {
    const siblings = chaptersByCategory(category);
    const idx = siblings.findIndex((c) => c.id === subtotalId);
    if (idx < 0) return 0;
    let sum = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const c = siblings[i];
      if (c.isSubtotal) break;
      if (!c.isTextLine) sum += chapterTotal(c.id);
    }
    return Math.round(sum * 100) / 100;
  };

  const handleMoveChapter = async (chapter: BudgetingAccount, direction: "up" | "down") => {
    const siblings = chaptersByCategory(chapter.category);
    const swaps = computeReorder(siblings, chapter.id, direction);
    if (!swaps) return;
    await Promise.all(swaps.map((s) => updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, s.id), { order: s.order })));
    await touchDraft();
  };

  // ── Copiar/cortar/pegar uno o varios Capítulos enteros, con sus Cuentas y
  // líneas de Detalle (mismo árbol que handleDuplicateDraft, incluida la
  // simplificación de no preservar `routedTo` entre líneas al copiar).
  // Portapapeles compartido con Detalle: mismo mecanismo, "kind" distinto. ──
  const chapterToClipboardData = (chapter: BudgetingAccount): ChapterClipboardData => ({
    code: chapter.code, description: chapter.description,
    isTextLine: chapter.isTextLine || false, isSubtotal: chapter.isSubtotal || false,
    textBold: chapter.textBold || false, textColor: chapter.textColor || null,
    subchapters: (subchaptersByChapter[chapter.id] || []).map((sub) => ({
      code: sub.code, description: sub.description,
      isTextLine: sub.isTextLine || false, isSubtotal: sub.isSubtotal || false,
      textBold: sub.textBold || false, textColor: sub.textColor || null,
      lines: (linesBySubchapter[sub.id] || []).map((line) => ({
        code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
        multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
        notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
        isTextLine: line.isTextLine || false, isSubtotal: line.isSubtotal || false, textBold: line.textBold || false, textColor: line.textColor || null,
      })),
    })),
  });

  const handleCopyChapters = (list: BudgetingAccount[]) => {
    if (list.length === 0) return;
    setBudgetingClipboard<ChapterClipboardData[]>({ kind: "chapter", mode: "copy", data: list.map(chapterToClipboardData) });
  };

  const handleCutChapters = async (list: BudgetingAccount[]) => {
    if (list.length === 0) return;
    setBudgetingClipboard<ChapterClipboardData[]>({ kind: "chapter", mode: "cut", data: list.map(chapterToClipboardData) });
    setSaving(true);
    try {
      for (const chapter of list) {
        const subs = subchaptersByChapter[chapter.id] || [];
        for (const sub of subs) {
          const lines = linesBySubchapter[sub.id] || [];
          await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${chapter.id}/subchapters/${sub.id}/detailLines`, l.id))));
          await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${chapter.id}/subchapters`, sub.id));
        }
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, chapter.id));
      }
      await touchDraft();
      setSelectedChapterIds(new Set());
    } finally {
      setSaving(false);
    }
  };

  /** Pega todos los Capítulos del portapapeles, con sus Cuentas y líneas, justo debajo de `afterId` (o al principio si es null), dentro de `category`. */
  const handlePasteChapters = async (afterId: string | null, category: string | null) => {
    const clip = getBudgetingClipboard<ChapterClipboardData[]>("chapter");
    if (!clip || clip.data.length === 0) return;
    setSaving(true);
    try {
      const cursor: { id: string; order?: number; createdAt?: Timestamp | null }[] =
        sortByOrder(chaptersByCategory(category)).map((c) => ({ id: c.id, order: c.order, createdAt: c.createdAt }));
      let anchorId = afterId;
      let firstNewId: string | null = null;
      for (const src of clip.data) {
        const order = orderAfter(cursor, anchorId);
        const chapterRef = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), {
          code: src.code, description: src.description, category, order, createdAt: Timestamp.now(),
          isTextLine: src.isTextLine, isSubtotal: src.isSubtotal, textBold: src.textBold, textColor: src.textColor,
        });
        for (const sub of src.subchapters) {
          const subRef = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${chapterRef.id}/subchapters`), {
            code: sub.code, description: sub.description, createdAt: Timestamp.now(),
            isTextLine: sub.isTextLine, isSubtotal: sub.isSubtotal, textBold: sub.textBold, textColor: sub.textColor,
          });
          for (const line of sub.lines) {
            await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${chapterRef.id}/subchapters/${subRef.id}/detailLines`), {
              code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr, unit: line.unit,
              multiplier: line.multiplier, multiplierExpr: line.multiplierExpr, rate: line.rate, rateExpr: line.rateExpr, total: line.total,
              notes: line.notes, tags: line.tags, fringeIds: line.fringeIds,
              isTextLine: line.isTextLine, isSubtotal: line.isSubtotal, textBold: line.textBold, textColor: line.textColor,
              createdAt: Timestamp.now(),
            });
          }
        }
        cursor.splice(cursor.findIndex((c) => c.id === anchorId) + 1, 0, { id: chapterRef.id, order });
        anchorId = chapterRef.id;
        if (!firstNewId) firstNewId = chapterRef.id;
      }
      await touchDraft();
      if (firstNewId) setJustAddedId(firstNewId);
      setSelectedChapterIds(new Set());
      if (clip.mode === "cut") clearBudgetingClipboard();
    } finally {
      setSaving(false);
    }
  };

  // ── Selección múltiple sobre las filas visibles de una categoría (o la
  // lista plana): shift extiende el rango desde la última ancla, cmd/ctrl
  // suelta una a una, clic normal la limpia sin robar el foco. ─────────────
  const handleChapterMouseDown = (chapter: BudgetingAccount, category: string | null, visible: BudgetingAccount[], e: React.MouseEvent) => {
    // Solo el botón izquierdo: el derecho también dispara mousedown antes del
    // contextmenu, y si no se ignora aquí, el clic derecho para copiar/cortar
    // varios capítulos los deseleccionaba justo antes de abrir el menú.
    if (e.button !== 0) return;
    if (e.shiftKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      const anchor = chapterSelectionAnchor && chapterSelectionAnchor.category === category ? chapterSelectionAnchor.id : chapter.id;
      const anchorIdx = visible.findIndex((c) => c.id === anchor);
      const clickedIdx = visible.findIndex((c) => c.id === chapter.id);
      if (anchorIdx < 0 || clickedIdx < 0) { setSelectedChapterIds(new Set([chapter.id])); setChapterSelectionAnchor({ id: chapter.id, category }); return; }
      const [from, to] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
      setSelectedChapterIds(new Set(visible.slice(from, to + 1).map((c) => c.id)));
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setSelectedChapterIds((prev) => {
        const next = new Set(prev);
        if (next.has(chapter.id)) next.delete(chapter.id); else next.add(chapter.id);
        return next;
      });
      setChapterSelectionAnchor({ id: chapter.id, category });
    } else {
      // Clic normal: no roba el foco, pero recuerda esta fila como
      // referencia para un Shift+clic posterior ("de la primera a la
      // última" empezando con un clic normal en la primera).
      setChapterSelectionAnchor({ id: chapter.id, category });
      if (selectedChapterIds.size > 0) setSelectedChapterIds(new Set());
    }
  };

  // Cmd/Ctrl+C/X/V sobre la selección múltiple, igual que en Detalle: se
  // ignora si el foco está en un input/textarea.
  useEffect(() => {
    const isEditable = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedChapterIds.size > 0 && !isEditable(document.activeElement)) {
        setSelectedChapterIds(new Set());
        setChapterSelectionAnchor(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if ((key === "c" || key === "x") && selectedChapterIds.size === 0) return;
      const category = chapterSelectionAnchor?.category ?? null;
      const visible = chaptersByCategory(category);
      if (key === "c") {
        e.preventDefault();
        handleCopyChapters(visible.filter((c) => selectedChapterIds.has(c.id)));
      } else if (key === "x") {
        e.preventDefault();
        handleCutChapters(visible.filter((c) => selectedChapterIds.has(c.id)));
      } else if (key === "v") {
        const clip = getBudgetingClipboard<ChapterClipboardData[]>("chapter");
        if (!clip) return;
        e.preventDefault();
        const selectedVisible = visible.filter((c) => selectedChapterIds.has(c.id));
        const anchorId = selectedVisible.length > 0 ? selectedVisible[selectedVisible.length - 1].id : (visible.length > 0 ? visible[visible.length - 1].id : null);
        handlePasteChapters(anchorId, category);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChapterIds, chapterSelectionAnchor, chapters]);

  // Clic derecho sobre un capítulo que ya forma parte de la selección actúa
  // sobre toda la selección; sobre uno suelto, solo sobre ese (igual que en
  // Detalle/Finder/Sheets). Compartido por la vista categorizada y la plana.
  const openChapterMenu = (chapter: BudgetingAccount, category: string | null, visible: BudgetingAccount[], e: React.MouseEvent) => {
    e.preventDefault();
    setChapterMenuCategory(category);
    const targetChapters = selectedChapterIds.has(chapter.id) && selectedChapterIds.size > 1
      ? visible.filter((c) => selectedChapterIds.has(c.id))
      : [chapter];
    const canPaste = !!getBudgetingClipboard<ChapterClipboardData[]>("chapter");
    setChapterMenu({
      x: e.clientX, y: e.clientY, rowId: chapter.id,
      style: (targetChapters.length === 1 && (chapter.isTextLine || chapter.isSubtotal)) ? {
        bold: !!chapter.textBold, color: chapter.textColor || DEFAULT_TEXT_LINE_COLOR,
        onChangeBold: (v) => handleCommitTextChapter(chapter, { textBold: v }),
        onChangeColor: (c) => handleCommitTextChapter(chapter, { textColor: c }),
      } : undefined,
      onDelete: () => setDeleteTarget(targetChapters.map((c) => ({ chapterId: c.id, label: c.description }))),
      onCopy: () => handleCopyChapters(targetChapters),
      onCut: () => handleCutChapters(targetChapters),
      onPaste: canPaste ? () => handlePasteChapters(chapter.id, category) : undefined,
    });
  };

  // El icono de papelera de una fila: si esa fila forma parte de la
  // selección múltiple activa, borra toda la selección; si no, solo esa.
  const deleteTargetsFor = (chapter: BudgetingAccount, visible: BudgetingAccount[]): DeleteTargets =>
    (selectedChapterIds.has(chapter.id) && selectedChapterIds.size > 1
      ? visible.filter((c) => selectedChapterIds.has(c.id))
      : [chapter]
    ).map((c) => ({ chapterId: c.id, label: c.description }));

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteTarget.length === 0) return;
    setSaving(true);
    try {
      for (const target of deleteTarget) {
        const subs = subchaptersByChapter[target.chapterId] || [];
        for (const sub of subs) {
          const lines = linesBySubchapter[sub.id] || [];
          await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${target.chapterId}/subchapters/${sub.id}/detailLines`, l.id))));
          await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${target.chapterId}/subchapters`, sub.id));
        }
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, target.chapterId));
      }
      await touchDraft();
      setDeleteTarget(null);
      setSelectedChapterIds(new Set());
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
    setSubaccountLevel("subchapter");
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
    if (empty) setSendStep("mapping");
  };

  const handleSendToProject = async () => {
    if (!selectedProject || !draft || !user) return;
    setSending(true);
    setSendError("");
    try {
      // Accounting solo tiene dos niveles (Cuenta → Subcuenta) y Budgeting
      // tres (Capítulo → Cuenta → Detalle): según lo elegido en el paso
      // anterior, o bien Capítulo→Cuenta/Cuenta→Subcuenta (de siempre), o
      // bien Cuenta→Cuenta/Detalle→Subcuenta (el Capítulo no se conserva).
      if (subaccountLevel === "detailLine") {
        for (const sub of allSubchapters.filter((s) => !s.sub.isTextLine && !s.sub.isSubtotal)) {
          const accountRef = await addDoc(collection(db, `projects/${selectedProject.id}/accounts`), {
            code: sub.sub.code, description: sub.sub.description, createdAt: Timestamp.now(), createdBy: user.uid,
          });
          // El código de la línea es referencial y puede venir vacío: si no
          // tiene, se usa su posición dentro de la Cuenta para no perderla.
          // La redirección "Sumar en" no tiene un destino de nivel línea
          // claro aquí, así que no se traslada: cada línea queda en su
          // Cuenta física con su propio importe.
          const lines = sortByOrder(linesBySubchapter[sub.sub.id] || []).filter((l) => !l.isTextLine && !l.isSubtotal);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            await addDoc(collection(db, `projects/${selectedProject.id}/accounts/${accountRef.id}/subaccounts`), {
              code: line.code?.trim() || String(i + 1).padStart(2, "0"), description: line.description,
              budgeted: Math.round((line.total || 0) * 100) / 100,
              committed: 0, actual: 0, accountId: accountRef.id, createdAt: Timestamp.now(), createdBy: user.uid,
            });
          }
        }
      } else {
        // Las líneas de detalle no se envían como entidades propias, solo su
        // suma; una línea con `routedTo` suma en la Cuenta destino, no en la física.
        const sumBySubId: Record<string, number> = {};
        for (const sub of allSubchapters) sumBySubId[sub.sub.id] = 0;
        for (const sub of allSubchapters) {
          for (const line of linesBySubchapter[sub.sub.id] || []) {
            const targetSubId = line.routedTo?.subchapterId ?? sub.sub.id;
            sumBySubId[targetSubId] = (sumBySubId[targetSubId] || 0) + (line.total || 0);
          }
        }

        const accountIdByChapterId: Record<string, string> = {};
        for (const chapter of chapters.filter((c) => !c.isTextLine && !c.isSubtotal)) {
          const accountRef = await addDoc(collection(db, `projects/${selectedProject.id}/accounts`), {
            code: chapter.code, description: chapter.description, createdAt: Timestamp.now(), createdBy: user.uid,
          });
          accountIdByChapterId[chapter.id] = accountRef.id;
        }
        for (const sub of allSubchapters.filter((s) => !s.sub.isTextLine && !s.sub.isSubtotal)) {
          const accountId = accountIdByChapterId[sub.chapterId];
          if (!accountId) continue;
          await addDoc(collection(db, `projects/${selectedProject.id}/accounts/${accountId}/subaccounts`), {
            code: sub.sub.code, description: sub.sub.description,
            budgeted: Math.round((sumBySubId[sub.sub.id] || 0) * 100) / 100,
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
      {/* Top bar: título, luego acciones, y Buscar cerrando la barra del todo a la derecha */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-sm font-semibold flex-shrink-0" style={{ color: "#1D201F" }}>{draft.name}</h1>
        <div className="flex items-center gap-3 flex-1 min-w-0 justify-end">
          {draft.sentToProjectId && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 flex-shrink-0">
              <Check size={10} /> Enviado a {draft.sentToProjectName}
            </span>
          )}
          {scenarios.length > 0 && (
            <div className="flex items-center gap-1 p-0.5 border border-slate-200 rounded-lg bg-slate-50 flex-shrink-0" title="Vista previa de escenario: no cambia lo guardado">
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

          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Exportar: un solo botón, el desplegable trae las descargas y su configuración */}
            <div ref={exportPanelRef} className="relative">
              <button onClick={() => setExportPanelOpen((o) => !o)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Exportar">
                <FileDown size={14} />
              </button>
              {exportPanelOpen && (
                <div className="absolute z-30 top-full right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-3.5 space-y-3">
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Descargar</p>
                  <div className="space-y-0.5">
                    <button onClick={handleExportPdf} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                      <FileText size={13} className="text-slate-400" /> PDF
                    </button>
                    <button onClick={handleExportExcel} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                      <FileSpreadsheet size={13} className="text-slate-400" /> Excel
                    </button>
                    <button onClick={handleExportFwb} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                      <Download size={13} className="text-slate-400" /> Archivo .fwb
                    </button>
                  </div>
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Configuración Excel / PDF</p>
                    <label className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs text-slate-700">Top Sheet (portada)</span>
                      <input type="checkbox" checked={exportConfig.coverSheet} onChange={(e) => updateExportConfig({ coverSheet: e.target.checked })} className="accent-[#E86F4A]" />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700">Salto de página por capítulo</span>
                      <input type="checkbox" checked={exportConfig.pageBreakPerChapter} onChange={(e) => updateExportConfig({ pageBreakPerChapter: e.target.checked })} className="accent-[#E86F4A]" />
                    </label>
                  </div>
                  <div className="border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Campos visibles</p>
                    <div className="space-y-1.5">
                      {([["unit", "Unidad"], ["notes", "Comentario"], ["tags", "Etiquetas"]] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-700">{label}</span>
                          <input type="checkbox" checked={exportConfig.fields[key]} onChange={(e) => updateExportConfig({ fields: { [key]: e.target.checked } as Partial<BudgetingExportConfig["fields"]> })} className="accent-[#E86F4A]" />
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-2.5 space-y-2">
                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">PDF</p>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700">Tamaño de letra</span>
                      <div className="flex items-center gap-0.5 p-0.5 border border-slate-200 rounded-lg bg-slate-50">
                        {(["small", "normal", "large"] as PdfFontSize[]).map((size) => (
                          <button
                            key={size}
                            onClick={() => updateExportConfig({ pdfFontSize: size })}
                            className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-colors ${exportConfig.pdfFontSize === size ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
                          >
                            {PDF_FONT_SIZE_LABELS[size]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700">Idioma</span>
                      <div className="flex items-center gap-0.5 p-0.5 border border-slate-200 rounded-lg bg-slate-50">
                        {(["es", "en"] as PdfLanguage[]).map((lang) => (
                          <button
                            key={lang}
                            onClick={() => updateExportConfig({ pdfLanguage: lang })}
                            className={`px-2 py-1 rounded-md text-[10.5px] font-medium transition-colors ${exportConfig.pdfLanguage === lang ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
                          >
                            {PDF_LANGUAGE_LABELS[lang]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-700">Ocultar Cuentas con total 0€</span>
                      <input type="checkbox" checked={exportConfig.hideZeroTotalSubchapters} onChange={(e) => updateExportConfig({ hideZeroTotalSubchapters: e.target.checked })} className="accent-[#E86F4A]" />
                    </label>
                    <button
                      onClick={() => { setExportPanelOpen(false); openProjectInfoModal(); }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50 border border-slate-200"
                    >
                      <Building2 size={13} className="text-slate-400" /> Datos de producción
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* "···" Más acciones: Guardar como plantilla, Versiones, Guardar versión, Duplicar */}
            <div ref={moreMenuRef} className="relative">
              <button onClick={() => setMoreMenuOpen((o) => !o)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Más acciones">
                <MoreHorizontal size={14} />
              </button>
              {moreMenuOpen && (
                <div className="absolute z-30 top-full right-0 mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5">
                  <button
                    onClick={() => { setMoreMenuOpen(false); setTemplateError(""); setShowTemplateModal(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <BookmarkPlus size={13} className="text-slate-400" /> Guardar como plantilla
                  </button>
                  <Link
                    href="?library=versions"
                    onClick={() => setMoreMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <History size={13} className="text-slate-400" /> Versiones
                  </Link>
                  <button
                    onClick={() => { setMoreMenuOpen(false); setShowSnapshotModal(true); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Check size={13} className="text-slate-400" /> Guardar versión
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => { setMoreMenuOpen(false); handleDuplicateDraft(); }}
                    disabled={duplicating}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Copy size={13} className="text-slate-400" /> {duplicating ? "Duplicando..." : "Duplicar presupuesto"}
                  </button>
                </div>
              )}
            </div>

            {/* Compartir: copia independiente a otro usuario, distinto de "Enviar a proyecto" */}
            <button onClick={() => setShowShareModal(true)} className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`} title="Compartir con otro usuario">
              <Share2 size={13} />
              Compartir
            </button>

            {/* Botón propio (no el de enviar mensaje): esto manda el presupuesto a un proyecto, no a una persona.
                Se queda fuera del "···" a propósito: es la acción principal de cierre de un presupuesto. */}
            <button onClick={openSendModal} className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`} title="Enviar a proyecto">
              <FolderOutput size={13} />
              Enviar
            </button>
          </div>

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
      </div>

      {activeScenarioId && (
        <div className="flex items-center gap-1.5 mb-3 text-[11px] font-medium" style={{ color: "#E86F4A" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#E86F4A" }} />
          Previsualizando "{scenarios.find((s) => s.id === activeScenarioId)?.label}": los totales de abajo son una simulación, no se ha guardado nada.
        </div>
      )}

      {/* Budget */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <div className={`grid ${cols} gap-0 pl-3 pr-3 border-b border-slate-200 divide-x divide-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
          <span></span>
          <span className="flex items-center py-2 pl-2">Código</span>
          <span className="flex items-center py-2 pl-2">Descripción</span>
          <span className="flex items-center justify-end py-2 pr-2">Total</span>
          <span className="flex items-center justify-end pl-2">
            <BudgetingColumnsMenu title="Columnas">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-700">Mostrar cargas sociales</span>
                <input type="checkbox" checked={fringeVisibility.topSheet} onChange={(e) => updateFringeVisibility({ topSheet: e.target.checked })} className="accent-[#E86F4A]" />
              </label>
            </BudgetingColumnsMenu>
          </span>
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
                        subtotalValue={chapter.isSubtotal ? chapterSubtotalValue(cat.id, chapter.id) : undefined}
                        isFirst={i === 0}
                        isLast={i === catChapters.length - 1}
                        autoFocus={chapter.id === justAddedId}
                        selected={selectedChapterIds.has(chapter.id)}
                        onCommit={(code, description) => handleCommitChapter(chapter, code, description)}
                        onCommitTextLine={(patch) => handleCommitTextChapter(chapter, patch)}
                        onMove={(direction) => handleMoveChapter(chapter, direction)}
                        onDelete={() => setDeleteTarget(deleteTargetsFor(chapter, catChapters))}
                        onContextMenu={(e) => openChapterMenu(chapter, cat.id, catChapters, e)}
                        onRowMouseDown={(e) => handleChapterMouseDown(chapter, cat.id, catChapters, e)}
                      />
                    ))}
                    {catChapters.length === 0 && (
                      q ? (
                        <div className="px-3 py-3 text-[10px] text-slate-300 italic select-none">Sin resultados</div>
                      ) : (
                        <BudgetingPhantomRow
                          cols={cols}
                          onCreate={(code, description) => handleCreateChapterFromPhantom(cat.id, code, description)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setChapterMenuCategory(cat.id);
                            setChapterMenu({ x: e.clientX, y: e.clientY, rowId: null, onPaste: getBudgetingClipboard<ChapterClipboardData[]>("chapter") ? () => handlePasteChapters(null, cat.id) : undefined });
                          }}
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })}

            {fringeVisibility.topSheet && topFringeBreakdown.length > 0 && (
              <div className="border-t border-slate-200">
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Cargas sociales de todo el presupuesto</p>
                <div className="divide-y divide-slate-100">
                  {topFringeBreakdown.map((row) => (
                    <BudgetingFringeLineRow
                      key={row.target.type === "folder" ? `folder:${row.target.folderId}` : `fringe:${row.target.fringeId}`}
                      code={row.code}
                      label={row.label}
                      amount={row.amount}
                      target={row.target}
                      fmt={fmt}
                      draftId={draftId}
                      cols={cols}
                      tooltip="Carga social de todo el presupuesto"
                      onCommit={handleCommitFringeGroup}
                    />
                  ))}
                </div>
              </div>
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
                if (flatSorted.length === 0) {
                  return q ? (
                    <div className="px-3 py-3 text-[10px] text-slate-300 italic select-none">Sin resultados</div>
                  ) : (
                    <BudgetingPhantomRow
                      cols={cols}
                      onCreate={(code, description) => handleCreateChapterFromPhantom(null, code, description)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setChapterMenuCategory(null);
                        setChapterMenu({ x: e.clientX, y: e.clientY, rowId: null, onPaste: getBudgetingClipboard<ChapterClipboardData[]>("chapter") ? () => handlePasteChapters(null, null) : undefined });
                      }}
                    />
                  );
                }
                return flatSorted.map((chapter, i) => (
                  <ChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    draftId={draftId}
                    fmt={fmt}
                    total={chapterTotal(chapter.id)}
                    subtotalValue={chapter.isSubtotal ? chapterSubtotalValue(null, chapter.id) : undefined}
                    isFirst={i === 0}
                    isLast={i === flatSorted.length - 1}
                    autoFocus={chapter.id === justAddedId}
                    selected={selectedChapterIds.has(chapter.id)}
                    onCommit={(code, description) => handleCommitChapter(chapter, code, description)}
                    onCommitTextLine={(patch) => handleCommitTextChapter(chapter, patch)}
                    onMove={(direction) => handleMoveChapter(chapter, direction)}
                    onDelete={() => setDeleteTarget(deleteTargetsFor(chapter, flatSorted))}
                    onContextMenu={(e) => openChapterMenu(chapter, null, flatSorted, e)}
                    onRowMouseDown={(e) => handleChapterMouseDown(chapter, null, flatSorted, e)}
                  />
                ));
              })()}
            </div>
            {fringeVisibility.topSheet && topFringeBreakdown.length > 0 && (
              <div className="border-t border-slate-200">
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Cargas sociales de todo el presupuesto</p>
                <div className="divide-y divide-slate-100">
                  {topFringeBreakdown.map((row) => (
                    <BudgetingFringeLineRow
                      key={row.target.type === "folder" ? `folder:${row.target.folderId}` : `fringe:${row.target.fringeId}`}
                      code={row.code}
                      label={row.label}
                      amount={row.amount}
                      target={row.target}
                      fmt={fmt}
                      draftId={draftId}
                      cols={cols}
                      tooltip="Carga social de todo el presupuesto"
                      onCommit={handleCommitFringeGroup}
                    />
                  ))}
                </div>
              </div>
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

      {chapterMenu && (
        <BudgetingRowContextMenu
          state={chapterMenu}
          onClose={() => setChapterMenu(null)}
          onInsertLine={() => handleInsertChapter(chapterMenu.rowId, chapterMenuCategory, "item")}
          onInsertText={() => handleInsertChapter(chapterMenu.rowId, chapterMenuCategory, "text")}
          onInsertSubtotal={() => handleInsertChapter(chapterMenu.rowId, chapterMenuCategory, "subtotal")}
        />
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
              {deleteTarget.length === 1 ? `Borrar capítulo "${deleteTarget[0].label}"` : `Borrar ${deleteTarget.length} capítulos seleccionados`}
            </h3>
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

      {/* ── Guardar como plantilla ───────────────────────────────────────── */}
      <BudgetingShareModal
        draftId={draftId}
        sharedWith={draft.sharedWith || []}
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
      />

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Guardar como plantilla</h3>
              <button onClick={() => setShowTemplateModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-slate-500 mb-3">Guarda la estructura de este presupuesto (categorías, capítulos, subcapítulos y detalle) para arrancar otro desde aquí más adelante.</p>
              <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre de la plantilla</label>
              <input
                autoFocus
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && templateName.trim()) handleSaveTemplate(); }}
                placeholder={draft.name}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
              />
              {templateError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 mt-2.5">
                  <AlertCircle size={12} />
                  {templateError}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowTemplateModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSaveTemplate} disabled={!templateName.trim() || savingTemplate} className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}>
                {savingTemplate ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Datos de producción (portada del PDF) ────────────────────────── */}
      {showProjectInfoModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Datos de producción</h3>
              <button onClick={() => setShowProjectInfoModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-slate-500">Aparecen en la portada del PDF exportado. Se quedan guardados en este presupuesto, no hace falta rellenarlos cada vez.</p>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Título de producción</label>
                <input
                  value={projectInfoForm.title || ""}
                  onChange={(e) => setProjectInfoForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={draft.name}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Formato</label>
                <div className="flex items-center gap-0.5 p-0.5 border border-slate-200 rounded-lg bg-slate-50 w-fit">
                  {(["Película", "Serie"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setProjectInfoForm((f) => ({ ...f, format: opt }))}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${projectInfoForm.format === opt ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {projectInfoForm.format === "Serie" ? (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      value={projectInfoForm.episodeCount || ""}
                      onChange={(e) => setProjectInfoForm((f) => ({ ...f, episodeCount: e.target.value }))}
                      placeholder="Nº de capítulos"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                    />
                    <input
                      value={projectInfoForm.episodeDuration || ""}
                      onChange={(e) => setProjectInfoForm((f) => ({ ...f, episodeDuration: e.target.value }))}
                      placeholder="Duración de los capítulos"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                ) : projectInfoForm.format === "Película" ? (
                  <input
                    value={projectInfoForm.filmDuration || ""}
                    onChange={(e) => setProjectInfoForm((f) => ({ ...f, filmDuration: e.target.value }))}
                    placeholder="Duración de la película"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 mt-2"
                  />
                ) : null}
              </div>

              {([
                ["version", "Versión #", "v1"],
                ["dateLabel", "Fecha presupuesto", "Se usa la de hoy si se deja en blanco"],
                ["director", "Dirección", ""],
                ["producer", "Producción", ""],
                ["preparedBy", "Preparado por", ""],
              ] as const).map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">{label}</label>
                  <input
                    value={projectInfoForm[key] || ""}
                    onChange={(e) => setProjectInfoForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Notas</label>
                <textarea
                  value={projectInfoForm.notes || ""}
                  onChange={(e) => setProjectInfoForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Cualquier otra información importante para la portada"
                  rows={3}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 resize-none"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowProjectInfoModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSaveProjectInfo} disabled={savingProjectInfo} className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}>
                {savingProjectInfo ? "Guardando..." : "Guardar"}
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
                {sendStep === "mapping" && "Cuentas y subcuentas"}
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
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 border border-slate-200 rounded-xl text-left hover:border-[#E86F4A] transition-colors disabled:opacity-60"
                        >
                          <span className="text-sm text-slate-800 truncate">{p.name}</span>
                          {status === "checking" && <span className="text-[11px] text-slate-400 flex-shrink-0">Comprobando...</span>}
                          {status === "occupied" && <span className="text-[11px] text-amber-600 flex-shrink-0">Ya tiene actividad</span>}
                        </button>
                      );
                    })}
                    {Object.values(projectStatus).includes("occupied") && (
                      <p className="text-[11px] text-slate-400 pt-1">
                        Los proyectos con actividad en Accounting no se pueden rellenar así: contacta con el equipo de Filma Workspace para cargarlo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {sendStep === "mapping" && (
              <div className="px-5 py-4 space-y-3">
                <p className="text-xs text-slate-500">
                  Accounting solo tiene dos niveles (Cuenta y Subcuenta), Budgeting tiene tres. Elige qué código quieres que se pueda asignar en PO, facturas y cajas.
                </p>
                <BudgetLevelMappingChoice value={subaccountLevel} onChange={setSubaccountLevel} />
              </div>
            )}

            {sendStep === "confirm" && selectedProject && (
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm text-slate-600">
                  Se creará el presupuesto en <span className="font-medium text-slate-900">{selectedProject.name}</span>:
                </p>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  {subaccountLevel === "detailLine" ? (
                    <>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Cuentas (cuentas de Budgeting)</span>
                        <span className="font-medium text-slate-900">{totalSubchapters}</span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Subcuentas (líneas de detalle)</span>
                        <span className="font-medium text-slate-900">{totalLines}</span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Capítulos</span>
                        <span className="font-medium text-slate-400">no se conservan</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Cuentas (capítulos)</span>
                        <span className="font-medium text-slate-900">{chapters.length}</span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Subcuentas (cuentas)</span>
                        <span className="font-medium text-slate-900">{totalSubchapters}</span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                        <span className="text-slate-500">Líneas de detalle (se suman en cada subcuenta)</span>
                        <span className="font-medium text-slate-900">{totalLines}</span>
                      </div>
                    </>
                  )}
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
              {sendStep === "mapping" && (
                <>
                  <button onClick={() => setSendStep("pick")} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Volver
                  </button>
                  <button onClick={() => setSendStep("confirm")} className={`flex-1 py-2.5 rounded-xl text-sm font-medium ${BTN_LIGHT}`}>
                    Continuar
                  </button>
                </>
              )}
              {sendStep === "confirm" && (
                <>
                  <button onClick={() => setSendStep("mapping")} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
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
