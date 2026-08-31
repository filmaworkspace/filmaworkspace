"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ChevronRight, Search, Trash2 } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BudgetingAccount, BudgetingDetailLine, BudgetingDraft, BudgetingFolder, BudgetingFringe, BudgetingFringeVisibility, BudgetingSubchapter, FringeGroupTarget,
  CELL_INPUT, DEFAULT_FRINGE_VISIBILITY, DEFAULT_TEXT_LINE_COLOR, clearBudgetingClipboard, fmtCurrency, focusBudgetingRowField, getBudgetingClipboard, groupFringeSumsByFolder, orderAfter, setBudgetingClipboard, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import BudgetingColumnsMenu from "@/components/BudgetingColumnsMenu";
import BudgetingFringeLineRow from "@/components/BudgetingFringeLineRow";
import BudgetingRowContextMenu, { BudgetingRowContextMenuState } from "@/components/BudgetingRowContextMenu";
import BudgetingPhantomRow from "@/components/BudgetingPhantomRow";
import BudgetingDragHandle from "@/components/BudgetingDragHandle";
import BudgetingFloatingMenu from "@/components/BudgetingFloatingMenu";
import { useRowDrag, resolveDragAfterId } from "@/hooks/useRowDrag";
import { useSlashCommands } from "@/hooks/useSlashCommands";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { subchapterId: string; label: string };
// Array siempre (aunque sea de una sola Cuenta), para poder borrar toda la
// selección múltiple de una vez, igual que copiar/cortar.
type DeleteTargets = DeleteTarget[];
const cols = "grid-cols-[20px_26px_100px_1fr_100px_40px]";
const dragIndicator = (pos: "before" | "after" | null) =>
  pos === "before" ? "border-t-2 border-[#E86F4A]" : pos === "after" ? "border-b-2 border-[#E86F4A]" : "";

/** Todo lo que hace falta para recrear una Cuenta entera al copiarla/cortarla: sus líneas de Detalle. */
interface SubLineClipboardData {
  code: string; description: string; units: number; unitsExpr: string | null; unit: string;
  multiplier: number; multiplierExpr: string | null; rate: number; rateExpr: string | null; total: number;
  notes: string; tags: string[]; fringeIds: string[];
  isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
}
interface SubClipboardData {
  code: string; description: string; isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
  lines: SubLineClipboardData[];
}

// ─── Fila de subcapítulo, siempre editable in situ (MMB-style): sin caja,
// sin placeholder, guarda sola al perder el foco. Componente de módulo
// estable: no se redefine entre renders, así los inputs no pierden el foco. ──
function SubRow({
  sub, draftId, accountId, fmt, total, subtotalValue, autoFocus, selected, dragOver,
  onCommit, onCommitTextLine, onDragStart, onDragOverRow, onDrop, onDragEnd, onDelete, onCreateTextAfter, onCreateSubtotalAfter, onContextMenu, onRowMouseDown,
}: {
  sub: BudgetingSubchapter; draftId: string; accountId: string; fmt: (n: number) => string; total: number; subtotalValue?: number; autoFocus?: boolean; selected?: boolean;
  dragOver: "before" | "after" | null;
  onCommit: (code: string, description: string) => void;
  onCommitTextLine: (patch: { description?: string; textBold?: boolean; textColor?: string }) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void; onDragOverRow: (e: React.DragEvent<HTMLDivElement>) => void; onDrop: (e: React.DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
  onDelete: () => void; onCreateTextAfter: () => void; onCreateSubtotalAfter: () => void;
  onContextMenu: (e: React.MouseEvent) => void; onRowMouseDown: (e: React.MouseEvent) => void;
}) {
  const [code, setCode] = useState(sub.code);
  const [description, setDescription] = useState(sub.description);
  const descWrapRef = useRef<HTMLDivElement>(null);

  // Las filas ya existen desde que se crean (botón "+ Añadir línea" o clic
  // derecho), así que cada campo se guarda por su cuenta al salir de la
  // celda: no hace falta rellenar código y descripción a la vez, o el otro
  // se borraba solo al perder el foco.
  const commit = () => onCommit(code.trim(), description.trim());
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "down"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "up"); }
    else if (e.key === "Escape") { setCode(sub.code); setDescription(sub.description); }
  };

  // Comandos "/" en Descripción: solo se disparan cuando "/" es lo primero
  // que hay en el campo (ver useSlashCommands).
  const { isCommand, matches } = useSlashCommands(description);
  const runSlashCommand = (cmd: string) => {
    setDescription("");
    if (cmd === "texto") onCreateTextAfter();
    else if (cmd === "subtotal") onCreateSubtotalAfter();
  };
  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && isCommand && matches.length > 0) { e.preventDefault(); runSlashCommand(matches[0].cmd); return; }
    // Escape con "/" a medio escribir: mismo revert completo que un Escape
    // normal, así una descripción real que ya hubiera antes de escribir "/"
    // no se pierde por el camino.
    handleKeyDown(e);
  };
  const handleDescriptionBlur = () => {
    if (isCommand) { setDescription(sub.description); return; }
    commit();
  };

  if (sub.isTextLine || sub.isSubtotal) {
    const isSubtotal = !!sub.isSubtotal;
    const commitText = () => {
      if (!description.trim()) { setDescription(sub.description); return; }
      if (description.trim() !== sub.description) onCommitTextLine({ description: description.trim() });
    };
    const handleTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") { e.preventDefault(); if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "down"); }
      else if (e.key === "ArrowUp") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "up"); }
      else if (e.key === "Escape") setDescription(sub.description);
    };
    return (
      <div data-budget-row className={`grid ${cols} gap-0 divide-x divide-slate-200 px-3 hover:bg-slate-50 group ${selected ? "bg-[#E86F4A]/[0.08]" : ""} ${dragIndicator(dragOver)}`} onContextMenu={onContextMenu} onMouseDown={onRowMouseDown} onDragOver={onDragOverRow} onDrop={onDrop}>
        <BudgetingDragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
        <span className="!border-l-0" />
        <input
          autoFocus={autoFocus}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitText}
          onKeyDown={handleTextKeyDown}
          placeholder={isSubtotal ? "Subtotal" : "Texto"}
          style={{ gridColumn: isSubtotal ? "3 / 5" : "3 / 6", color: sub.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: sub.textBold ? 700 : 400 }}
          className={`${CELL_INPUT} text-xs pl-2`}
        />
        {isSubtotal && (
          <span className="flex items-center justify-end text-xs pr-2" style={{ color: sub.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: sub.textBold ? 700 : 400 }}>
            {fmt(subtotalValue || 0)}
          </span>
        )}
        <span className="flex items-center justify-end pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
            <Trash2 size={11} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div data-budget-row className={`grid ${cols} gap-0 divide-x divide-slate-200 px-3 hover:bg-slate-50 group ${selected ? "bg-[#E86F4A]/[0.08]" : ""} ${dragIndicator(dragOver)}`} onContextMenu={onContextMenu} onMouseDown={onRowMouseDown} onDragOver={onDragOverRow} onDrop={onDrop}>
      <BudgetingDragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <Link href={`/budgeting/${draftId}/accounts/${accountId}/subchapters/${sub.id}`} className="flex items-center justify-center !border-l-0" title="Entrar">
        <ChevronRight size={13} className="text-slate-300 group-hover:text-[#E86F4A] group-hover:translate-x-0.5 transition-all" />
      </Link>
      <input autoFocus={autoFocus} value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`} />
      <div ref={descWrapRef} className="relative h-full">
        <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={handleDescriptionBlur} onKeyDown={handleDescriptionKeyDown}
          className={`${CELL_INPUT} text-xs pl-2`} />
        {isCommand && matches.length > 0 && (
          <BudgetingFloatingMenu anchorRef={descWrapRef} className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {matches.map((c) => (
              <button
                key={c.cmd}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runSlashCommand(c.cmd)}
                className="w-full flex flex-col items-start px-2.5 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="text-xs font-medium" style={{ color: "#E86F4A" }}>/{c.cmd}</span>
                <span className="text-[10px] text-slate-400">{c.hint}</span>
              </button>
            ))}
          </BudgetingFloatingMenu>
        )}
      </div>
      <span className="flex items-center justify-end text-xs font-medium text-slate-700 pr-2">{fmt(total)}</span>
      <span className="flex items-center justify-end pl-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onDelete} className="p-0.5 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar subcapítulo">
          <Trash2 size={11} />
        </button>
      </span>
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTargets | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [subMenu, setSubMenu] = useState<BudgetingRowContextMenuState | null>(null);
  // Selección múltiple de Cuentas (mismo patrón que en Detalle/Top Sheet):
  // shift = rango desde la última ancla, cmd/ctrl = suelta una a una.
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set());
  const [subSelectionAnchor, setSubSelectionAnchor] = useState<string | null>(null);

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
  const fringeFolders: BudgetingFolder[] = draft?.fringeFolders || [];
  const fringeVisibility: BudgetingFringeVisibility = draft?.fringeVisibility || DEFAULT_FRINGE_VISIBILITY;

  const subTotal = (sub: BudgetingSubchapter) => {
    const lines = linesBySubchapter[sub.id] || [];
    const subScoped = lines.reduce((s, l) => {
      const applied = (l.fringeIds || []).map((id) => fringes.find((f) => f.id === id)).filter((f): f is NonNullable<typeof f> => !!f && f.scope === "subchapter");
      return s + applied.reduce((s2, f) => s2 + (f.type === "percent" ? (l.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (l.units || 0)), 0);
    }, 0);
    return Math.round((subchapterTotal(sub, lines) + subScoped) * 100) / 100;
  };
  // Cargas sociales con alcance de capítulo: agrupadas por carpeta en una
  // sola línea de presupuesto (ver groupFringeSumsByFolder), debajo de los
  // subcapítulos; las que no tienen carpeta siguen apareciendo cada una con
  // su propio código.
  const chapterFringeBreakdown = (() => {
    const sums = new Map<string, number>();
    for (const lines of Object.values(linesBySubchapter)) {
      for (const l of lines) {
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (!f || f.scope !== "chapter") continue;
          const amount = f.type === "percent" ? (l.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (l.units || 0);
          sums.set(f.id, (sums.get(f.id) || 0) + amount);
        }
      }
    }
    return groupFringeSumsByFolder(sums, fringes, fringeFolders);
  })();
  const chapterFringes = Math.round(chapterFringeBreakdown.reduce((s, b) => s + b.amount, 0) * 100) / 100;
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

  // El código y el nombre de una fila de fringes se editan desde aquí mismo:
  // si la fila es una carpeta (varios fringes fundidos), edita esa carpeta;
  // si es un fringe sin carpeta, edita ese fringe. El importe de la fila no
  // se toca aquí, sale calculado de las líneas.
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

  // ── Línea de texto / subtotal (mismo doc de subcapítulo, marcado con
  // isTextLine/isSubtotal, para poder intercalarlas entre cuentas reales).
  // Se insertan justo debajo de la fila donde se abrió el menú contextual. ──
  const handleInsertSub = async (afterId: string | null, kind: "item" | "text" | "subtotal") => {
    const sorted = sortByOrder(subchapters);
    const order = orderAfter(sorted, afterId);
    const base: Record<string, unknown> = { order, createdAt: Timestamp.now(), code: "", description: "" };
    if (kind === "text") Object.assign(base, { isTextLine: true, textBold: false, textColor: DEFAULT_TEXT_LINE_COLOR });
    if (kind === "subtotal") Object.assign(base, { description: "Subtotal", isSubtotal: true, textBold: true, textColor: DEFAULT_TEXT_LINE_COLOR });
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), base);
    await touchDraft();
    setJustAddedId(ref.id);
  };
  /** Primera Cuenta de un Capítulo vacío: se crea de verdad en cuanto se escribe algo, no antes (ver BudgetingPhantomRow). */
  const handleCreateSubFromPhantom = async (code: string, description: string) => {
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), { order: orderAfter([], null), createdAt: Timestamp.now(), code, description });
    await touchDraft();
    setJustAddedId(ref.id);
  };
  const handleCommitTextSub = async (sub: BudgetingSubchapter, patch: { description?: string; textBold?: boolean; textColor?: string }) => {
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, sub.id), patch);
    await touchDraft();
  };
  /** Suma de los subcapítulos normales desde el subtotal anterior (o el principio) hasta `subtotalId`. */
  const subSubtotalValue = (subtotalId: string): number => {
    const sorted = sortByOrder(subchapters);
    const idx = sorted.findIndex((s) => s.id === subtotalId);
    if (idx < 0) return 0;
    let sum = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const s = sorted[i];
      if (s.isSubtotal) break;
      if (!s.isTextLine) sum += subTotal(s);
    }
    return Math.round(sum * 100) / 100;
  };

  const subDrag = useRowDrag();
  const handleReorderSub = async (subId: string, afterId: string | null) => {
    const siblings = subchapters.filter((s) => s.id !== subId);
    const order = orderAfter(siblings, afterId);
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, subId), { order });
    await touchDraft();
  };

  // ── Copiar/cortar/pegar una o varias Cuentas enteras, con sus líneas de
  // Detalle (misma simplificación que Capítulos: no se preserva `routedTo`
  // al copiar). Portapapeles compartido con Detalle/Top Sheet, "kind" propio. ──
  const subToClipboardData = (sub: BudgetingSubchapter): SubClipboardData => ({
    code: sub.code, description: sub.description,
    isTextLine: sub.isTextLine || false, isSubtotal: sub.isSubtotal || false,
    textBold: sub.textBold || false, textColor: sub.textColor || null,
    lines: (linesBySubchapter[sub.id] || []).map((line) => ({
      code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
      multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
      notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
      isTextLine: line.isTextLine || false, isSubtotal: line.isSubtotal || false, textBold: line.textBold || false, textColor: line.textColor || null,
    })),
  });

  const handleCopySubs = (list: BudgetingSubchapter[]) => {
    if (list.length === 0) return;
    setBudgetingClipboard<SubClipboardData[]>({ kind: "subchapter", mode: "copy", data: list.map(subToClipboardData) });
  };

  const handleCutSubs = async (list: BudgetingSubchapter[]) => {
    if (list.length === 0) return;
    setBudgetingClipboard<SubClipboardData[]>({ kind: "subchapter", mode: "cut", data: list.map(subToClipboardData) });
    setSaving(true);
    try {
      for (const sub of list) {
        const lines = linesBySubchapter[sub.id] || [];
        await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${sub.id}/detailLines`, l.id))));
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, sub.id));
      }
      await touchDraft();
      setSelectedSubIds(new Set());
    } finally {
      setSaving(false);
    }
  };

  /** Pega todas las Cuentas del portapapeles, con sus líneas, justo debajo de `afterId` (o al principio si es null). */
  const handlePasteSubs = async (afterId: string | null) => {
    const clip = getBudgetingClipboard<SubClipboardData[]>("subchapter");
    if (!clip || clip.data.length === 0) return;
    setSaving(true);
    try {
      const cursor: { id: string; order?: number; createdAt?: Timestamp | null }[] =
        sortByOrder(subchapters).map((s) => ({ id: s.id, order: s.order, createdAt: s.createdAt }));
      let anchorId = afterId;
      let firstNewId: string | null = null;
      for (const src of clip.data) {
        const order = orderAfter(cursor, anchorId);
        const subRef = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`), {
          code: src.code, description: src.description, order, createdAt: Timestamp.now(),
          isTextLine: src.isTextLine, isSubtotal: src.isSubtotal, textBold: src.textBold, textColor: src.textColor,
        });
        for (const line of src.lines) {
          await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subRef.id}/detailLines`), {
            code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr, unit: line.unit,
            multiplier: line.multiplier, multiplierExpr: line.multiplierExpr, rate: line.rate, rateExpr: line.rateExpr, total: line.total,
            notes: line.notes, tags: line.tags, fringeIds: line.fringeIds,
            isTextLine: line.isTextLine, isSubtotal: line.isSubtotal, textBold: line.textBold, textColor: line.textColor,
            createdAt: Timestamp.now(),
          });
        }
        cursor.splice(cursor.findIndex((c) => c.id === anchorId) + 1, 0, { id: subRef.id, order });
        anchorId = subRef.id;
        if (!firstNewId) firstNewId = subRef.id;
      }
      await touchDraft();
      if (firstNewId) setJustAddedId(firstNewId);
      setSelectedSubIds(new Set());
      if (clip.mode === "cut") clearBudgetingClipboard();
    } finally {
      setSaving(false);
    }
  };

  // ── Selección múltiple sobre las filas visibles: shift extiende el rango
  // desde la última ancla, cmd/ctrl suelta una a una, clic normal la limpia
  // sin robar el foco (pero recuerda la fila como ancla para un futuro
  // Shift+clic — así "de la primera a la última" funciona empezando con un
  // clic normal en la primera). Solo el botón izquierdo: el derecho también
  // dispara mousedown antes del contextmenu, y si no se ignora aquí, el clic
  // derecho para copiar/cortar varias Cuentas las deseleccionaba antes de
  // abrir el menú. ──────────────────────────────────────────────────────────
  const handleSubMouseDown = (sub: BudgetingSubchapter, visible: BudgetingSubchapter[], e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      const anchorId = subSelectionAnchor || sub.id;
      const anchorIdx = visible.findIndex((s) => s.id === anchorId);
      const clickedIdx = visible.findIndex((s) => s.id === sub.id);
      if (anchorIdx < 0 || clickedIdx < 0) { setSelectedSubIds(new Set([sub.id])); setSubSelectionAnchor(sub.id); return; }
      const [from, to] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
      setSelectedSubIds(new Set(visible.slice(from, to + 1).map((s) => s.id)));
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setSelectedSubIds((prev) => {
        const next = new Set(prev);
        if (next.has(sub.id)) next.delete(sub.id); else next.add(sub.id);
        return next;
      });
      setSubSelectionAnchor(sub.id);
    } else {
      setSubSelectionAnchor(sub.id);
      if (selectedSubIds.size > 0) setSelectedSubIds(new Set());
    }
  };

  // Cmd/Ctrl+C/X/V sobre la selección múltiple, igual que en Detalle/Top Sheet.
  useEffect(() => {
    const isEditable = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedSubIds.size > 0 && !isEditable(document.activeElement)) {
        setSelectedSubIds(new Set());
        setSubSelectionAnchor(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      if ((key === "c" || key === "x") && selectedSubIds.size === 0) return;
      const visible = sortByOrder(subchapters);
      if (key === "c") {
        e.preventDefault();
        handleCopySubs(visible.filter((s) => selectedSubIds.has(s.id)));
      } else if (key === "x") {
        e.preventDefault();
        handleCutSubs(visible.filter((s) => selectedSubIds.has(s.id)));
      } else if (key === "v") {
        const clip = getBudgetingClipboard<SubClipboardData[]>("subchapter");
        if (!clip) return;
        e.preventDefault();
        const selectedVisible = visible.filter((s) => selectedSubIds.has(s.id));
        const anchorId = selectedVisible.length > 0 ? selectedVisible[selectedVisible.length - 1].id : (visible.length > 0 ? visible[visible.length - 1].id : null);
        handlePasteSubs(anchorId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubIds, subchapters]);

  // Clic derecho sobre una Cuenta que ya forma parte de la selección actúa
  // sobre toda la selección; sobre una suelta, solo sobre esa.
  const openSubMenu = (sub: BudgetingSubchapter, visible: BudgetingSubchapter[], e: React.MouseEvent) => {
    e.preventDefault();
    const targetSubs = selectedSubIds.has(sub.id) && selectedSubIds.size > 1
      ? visible.filter((s) => selectedSubIds.has(s.id))
      : [sub];
    const canPaste = !!getBudgetingClipboard<SubClipboardData[]>("subchapter");
    setSubMenu({
      x: e.clientX, y: e.clientY, rowId: sub.id,
      style: (targetSubs.length === 1 && (sub.isTextLine || sub.isSubtotal)) ? {
        bold: !!sub.textBold, color: sub.textColor || DEFAULT_TEXT_LINE_COLOR,
        onChangeBold: (v) => handleCommitTextSub(sub, { textBold: v }),
        onChangeColor: (c) => handleCommitTextSub(sub, { textColor: c }),
      } : undefined,
      onDelete: () => setDeleteTarget(targetSubs.map((s) => ({ subchapterId: s.id, label: s.description }))),
      onCopy: () => handleCopySubs(targetSubs),
      onCut: () => handleCutSubs(targetSubs),
      onPaste: canPaste ? () => handlePasteSubs(sub.id) : undefined,
    });
  };

  // El icono de papelera de una fila: si esa fila forma parte de la
  // selección múltiple activa, borra toda la selección; si no, solo esa.
  const deleteTargetsFor = (sub: BudgetingSubchapter, visible: BudgetingSubchapter[]): DeleteTargets =>
    (selectedSubIds.has(sub.id) && selectedSubIds.size > 1
      ? visible.filter((s) => selectedSubIds.has(s.id))
      : [sub]
    ).map((s) => ({ subchapterId: s.id, label: s.description }));

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteTarget.length === 0) return;
    setSaving(true);
    try {
      for (const target of deleteTarget) {
        const lines = linesBySubchapter[target.subchapterId] || [];
        await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${target.subchapterId}/detailLines`, l.id))));
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, target.subchapterId));
      }
      await touchDraft();
      setDeleteTarget(null);
      setSelectedSubIds(new Set());
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
      {/* Breadcrumb: solo navegación de entrar/volver, sin categorías ni desplegables */}
      <div className="flex items-center gap-1.5 mb-4">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#E86F4A] transition-colors">{draft?.name}</Link>
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
        <div className={`grid ${cols} gap-0 px-3 border-b border-slate-200 divide-x divide-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
          <span></span>
          <span className="!border-l-0"></span>
          <span className="flex items-center py-2 pl-2">Código</span>
          <span className="flex items-center py-2 pl-2">Descripción</span>
          <span className="flex items-center justify-end py-2 pr-2">Total</span>
          <span className="flex items-center justify-end pl-2">
            <BudgetingColumnsMenu title="Columnas">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-700">Mostrar cargas sociales</span>
                <input type="checkbox" checked={fringeVisibility.chapter} onChange={(e) => updateFringeVisibility({ chapter: e.target.checked })} className="accent-[#E86F4A]" />
              </label>
            </BudgetingColumnsMenu>
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {(() => {
            const sorted = sortByOrder(subchapters.filter(matchesSearch));
            if (sorted.length === 0) {
              return !q ? (
                <BudgetingPhantomRow
                  cols={cols}
                  fmt={fmt}
                  onCreate={handleCreateSubFromPhantom}
                  onCreateText={() => handleInsertSub(null, "text")}
                  onCreateSubtotal={() => handleInsertSub(null, "subtotal")}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const canPaste = !!getBudgetingClipboard<SubClipboardData[]>("subchapter");
                    setSubMenu({ x: e.clientX, y: e.clientY, rowId: null, onPaste: canPaste ? () => handlePasteSubs(null) : undefined });
                  }}
                />
              ) : null;
            }
            return sorted.map((sub) => (
              <SubRow
                key={sub.id}
                sub={sub}
                draftId={draftId}
                accountId={accountId}
                fmt={fmt}
                total={subTotal(sub)}
                subtotalValue={sub.isSubtotal ? subSubtotalValue(sub.id) : undefined}
                autoFocus={sub.id === justAddedId}
                selected={selectedSubIds.has(sub.id)}
                dragOver={subDrag.dragOver?.id === sub.id ? subDrag.dragOver.position : null}
                onRowMouseDown={(e) => handleSubMouseDown(sub, sorted, e)}
                onCommit={(code, description) => handleCommitSub(sub, code, description)}
                onCommitTextLine={(patch) => handleCommitTextSub(sub, patch)}
                onDragStart={subDrag.onDragStart(sub.id)}
                onDragOverRow={subDrag.onDragOverRow(sub.id)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (subDrag.draggedId && subDrag.draggedId !== sub.id) {
                    handleReorderSub(subDrag.draggedId, resolveDragAfterId(sorted, subDrag.draggedId, subDrag.dragOver));
                  }
                  subDrag.reset();
                }}
                onDragEnd={subDrag.reset}
                onDelete={() => setDeleteTarget(deleteTargetsFor(sub, sorted))}
                onCreateTextAfter={() => handleInsertSub(sub.id, "text")}
                onCreateSubtotalAfter={() => handleInsertSub(sub.id, "subtotal")}
                onContextMenu={(e) => openSubMenu(sub, sorted, e)}
              />
            ));
          })()}
        </div>

        {fringeVisibility.chapter && chapterFringeBreakdown.length > 0 && (
          <div className="border-t border-slate-200">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Cargas sociales de este capítulo</p>
            <div className="divide-y divide-slate-100">
              {chapterFringeBreakdown.map((row) => (
                <BudgetingFringeLineRow
                  key={row.target.type === "folder" ? `folder:${row.target.folderId}` : `fringe:${row.target.fringeId}`}
                  code={row.code}
                  label={row.label}
                  amount={row.amount}
                  target={row.target}
                  fmt={fmt}
                  draftId={draftId}
                  cols={cols}
                  tooltip="Carga social de este capítulo"
                  onCommit={handleCommitFringeGroup}
                />
              ))}
            </div>
          </div>
        )}

        <div className={`grid ${cols} gap-1 items-center px-3 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
          <span />
          <span />
          <span />
          <span className="text-xs font-bold pl-2" style={{ color: "#1D201F" }}>Total</span>
          <span className="text-xs font-bold text-right pr-2" style={{ color: "#1D201F" }}>{fmt(chapterTotal)}</span>
          <span />
        </div>
      </div>

      {subMenu && (
        <BudgetingRowContextMenu
          state={subMenu}
          onClose={() => setSubMenu(null)}
          onInsertLine={() => handleInsertSub(subMenu.rowId, "item")}
          onInsertText={() => handleInsertSub(subMenu.rowId, "text")}
          onInsertSubtotal={() => handleInsertSub(subMenu.rowId, "subtotal")}
        />
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
              {deleteTarget.length === 1 ? `Borrar subcapítulo "${deleteTarget[0].label}"` : `Borrar ${deleteTarget.length} subcapítulos seleccionados`}
            </h3>
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
