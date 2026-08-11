"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, increment, onSnapshot, serverTimestamp, Timestamp, updateDoc, writeBatch,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ArrowUpRight, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Search, Sigma, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BudgetingAccount, BudgetingDetailLine, BudgetingDraft, BudgetingFringe, BudgetingLineRoute, BudgetingSubchapter,
  CELL_INPUT, ROW_INPUT, UNIT_SUGGESTIONS, computeFringeExtras, computeLineTotal, computeReorder, evaluateFieldExpr,
  fmtCurrency, fmtDecimal, isPlainNumber, lineFringeBreakdown, nextOrderValue, resolveGlobals, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import BudgetingFormulaInput from "@/components/BudgetingFormulaInput";

// ─────────────────────────────────────────────────────────────────────────────

interface LineFields { code: string; description: string; units: string; unit: string; multiplier: string; rate: string; }
const emptyFields: LineFields = { code: "", description: "", units: "", unit: "", multiplier: "", rate: "" };
const cols = "grid-cols-[90px_1fr_60px_70px_44px_76px_90px_82px]";
const toFields = (l: BudgetingDetailLine): LineFields => ({
  code: l.code, description: l.description,
  units: l.unitsExpr ?? String(l.units), unit: l.unit || "",
  multiplier: l.multiplierExpr ?? String(l.multiplier), rate: l.rateExpr ?? String(l.rate),
});

function FringeChip({ fringe, amount, excluded }: { fringe: BudgetingFringe; amount: number; excluded: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border"
      style={{ borderColor: "#8DA7BE", color: "#1D201F", background: "#8DA7BE0d" }}
      title={excluded ? `No suma aquí: va a ${fringe.scope === "chapter" ? "total del capítulo" : "total del presupuesto"}` : "Suma en este subcapítulo"}
    >
      {fringe.label} · {fmtDecimal(amount)}
      {excluded && <span className="text-[9px] text-slate-500 font-normal">excl.</span>}
    </span>
  );
}

interface RouteTarget { chapterId: string; chapterCode: string; chapterDescription: string; sub: BudgetingSubchapter; }

function RouteBadge({ route, draftId }: { route: BudgetingLineRoute; draftId: string }) {
  return (
    <Link
      href={`/budgeting/${draftId}/accounts/${route.chapterId}/subchapters/${route.subchapterId}`}
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border hover:bg-[#8DA7BE]/[0.08] transition-colors"
      style={{ borderColor: "#8DA7BE", color: "#1D201F" }}
      title={`No suma aquí: va a ${route.chapterCode} ${route.chapterDescription} · ${route.subchapterCode} ${route.subchapterDescription}`}
    >
      excl. <ArrowUpRight size={10} /> {route.subchapterCode}
    </Link>
  );
}

function RoutePicker({
  currentSubchapterId, allSubchapters, onPick, onClear, hasRoute,
}: {
  currentSubchapterId: string; allSubchapters: RouteTarget[]; onPick: (target: RouteTarget) => void; onClear: () => void; hasRoute: boolean;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const options = allSubchapters.filter((o) => o.sub.id !== currentSubchapterId);
  const filtered = query
    ? options.filter((o) => `${o.chapterCode} ${o.chapterDescription} ${o.sub.code} ${o.sub.description}`.toLowerCase().includes(query))
    : options;
  return (
    <div className="absolute z-20 top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5">
      <div className="px-2 pb-1.5">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cuenta destino..."
          className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-[#8DA7BE]" />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {hasRoute && (
          <button onClick={onClear} className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
            Quitar redirección
          </button>
        )}
        {filtered.length === 0 ? (
          <p className="text-[11px] text-slate-400 text-center py-3 px-3">Sin resultados</p>
        ) : (
          filtered.map((o) => (
            <button key={o.sub.id} onClick={() => onPick(o)} className="w-full flex flex-col items-start px-3 py-1.5 text-left hover:bg-slate-50">
              <span className="text-xs text-slate-800 truncate">{o.sub.code} {o.sub.description}</span>
              <span className="text-[10px] text-slate-400 truncate">{o.chapterCode} {o.chapterDescription}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Fila de campos, estilo MMB: sin caja, sin placeholder, guarda sola al
// perder el foco (sin botón de confirmar). Componente de módulo estable: no
// se redefine entre renders, así los inputs no pierden el foco al escribir. ──
function LineFieldsGrid({
  fields, onChange, onBlurAny, onEnter, onEscape, globals, totalPreview, muted,
}: {
  fields: LineFields; onChange: (patch: Partial<LineFields>) => void; onBlurAny: () => void;
  onEnter: () => void; onEscape: () => void; globals: { code: string; label: string }[];
  totalPreview: number; muted: boolean;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { onEnter(); }
    if (e.key === "Escape") { onEscape(); }
  };
  return (
    <div className={`grid ${cols} gap-0 divide-x divide-slate-200 px-4`}>
      <input value={fields.code} onChange={(e) => onChange({ code: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown} onFocus={(e) => e.target.select()}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={fields.description} onChange={(e) => onChange({ description: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown} onFocus={(e) => e.target.select()}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <BudgetingFormulaInput value={fields.units} onChange={(v) => onChange({ units: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-xs text-right pl-2`} />
      <input list="unit-suggestions" value={fields.unit} onChange={(e) => onChange({ unit: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown} onFocus={(e) => e.target.select()}
        className={`${CELL_INPUT} text-[11px] pl-2`} />
      <BudgetingFormulaInput value={fields.multiplier} onChange={(v) => onChange({ multiplier: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-[11px] text-right pl-2`} />
      <BudgetingFormulaInput value={fields.rate} onChange={(v) => onChange({ rate: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-xs text-right pl-2`} />
      <span className={`flex items-center justify-end text-xs font-semibold pl-2 ${muted ? "text-slate-400 italic" : "text-slate-900"}`}>{fmtDecimal(totalPreview)}</span>
    </div>
  );
}

function LineRow({
  line, fmt, fringes, globals, globalValues, draftId, allSubchapters, currentSubchapterId,
  isExpanded, fringePickerOpen, routePickerOpen, error, isFirst, isLast,
  onCommit, onToggleExpand, onDuplicate, onDelete, onMove, onToggleFringePicker, onToggleFringe,
  onToggleRoutePicker, onSetRoute, onUpdateSecondary,
}: {
  line: BudgetingDetailLine; fmt: (n: number) => string; fringes: BudgetingFringe[];
  globals: { code: string; label: string }[]; globalValues: Record<string, number>; draftId: string;
  allSubchapters: RouteTarget[]; currentSubchapterId: string;
  isExpanded: boolean; fringePickerOpen: boolean; routePickerOpen: boolean; error?: string; isFirst: boolean; isLast: boolean;
  onCommit: (fields: LineFields) => void; onToggleExpand: () => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: "up" | "down") => void;
  onToggleFringePicker: () => void; onToggleFringe: (id: string) => void;
  onToggleRoutePicker: () => void; onSetRoute: (target: RouteTarget | null) => void;
  onUpdateSecondary: (patch: { supplier?: string; notes?: string; tags?: string[] }) => void;
}) {
  const [fields, setFields] = useState<LineFields>(() => toFields(line));
  const breakdown = lineFringeBreakdown(line, fringes);
  const hasFormula = !!(line.unitsExpr || line.multiplierExpr || line.rateExpr);
  const hasComment = !!line.notes;
  const preview = computeLineTotal(
    evaluateFieldExpr(fields.units, globalValues).value,
    evaluateFieldExpr(fields.multiplier, globalValues).value,
    evaluateFieldExpr(fields.rate, globalValues).value
  );

  return (
    <div>
      <div className="group relative">
        <LineFieldsGrid
          fields={fields}
          onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
          onBlurAny={() => onCommit(fields)}
          onEnter={() => onCommit(fields)}
          onEscape={() => setFields(toFields(line))}
          globals={globals}
          totalPreview={preview}
          muted={!!line.routedTo}
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white">
          {hasFormula && <span title="Contiene fórmula"><Sigma size={10} className="text-[#8DA7BE]" /></span>}
          {hasComment && <span title={line.notes} className="text-[10px]">💬</span>}
          <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
            <ChevronUp size={11} />
          </button>
          <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
            <ChevronDown size={11} />
          </button>
          <button onClick={onToggleExpand} className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Proveedor / comentario / etiquetas / fringes / redirección">
            <ChevronDown size={11} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
          <button onClick={onDuplicate} className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Duplicar línea">
            <Copy size={11} />
          </button>
          <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
            <Trash2 size={11} />
          </button>
        </span>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
      {(breakdown.length > 0 || line.routedTo) && (
        <div className="flex flex-wrap gap-1 px-4 pb-1.5">
          {line.routedTo && <RouteBadge route={line.routedTo} draftId={draftId} />}
          {breakdown.map(({ fringe, amount }) => (
            <FringeChip key={fringe.id} fringe={fringe} amount={amount} excluded={fringe.scope !== "subchapter"} />
          ))}
        </div>
      )}
      {isExpanded && (
        <div className="px-4 pb-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Proveedor</label>
              <input defaultValue={line.supplier || ""} onBlur={(e) => onUpdateSecondary({ supplier: e.target.value.trim() })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Comentario</label>
              <input defaultValue={line.notes || ""} onBlur={(e) => onUpdateSecondary({ notes: e.target.value.trim() })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Etiquetas (separadas por coma)</label>
              <input defaultValue={(line.tags || []).join(", ")} onBlur={(e) => onUpdateSecondary({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                className={`w-full text-xs px-2 py-1 ${ROW_INPUT}`} />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <label className="text-[10px] text-slate-400 block mb-1">Cargas sociales</label>
              <button onClick={onToggleFringePicker} className={`text-xs px-2.5 py-1 rounded-md ${ROW_INPUT} text-slate-600 hover:text-[#8DA7BE]`}>
                {line.fringeIds?.length ? `${line.fringeIds.length} aplicada(s) · añadir/quitar` : "Aplicar carga social..."}
              </button>
              {fringePickerOpen && (
                <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 max-h-56 overflow-y-auto">
                  {fringes.length === 0 ? (
                    <p className="text-[11px] text-slate-400 text-center py-3 px-3">Sin cargas sociales configuradas: añádelas en Cargas sociales.</p>
                  ) : (
                    fringes.map((f) => {
                      const checked = (line.fringeIds || []).includes(f.id);
                      return (
                        <button key={f.id} onClick={() => onToggleFringe(f.id)} className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-slate-50">
                          <span className="text-xs text-slate-700 truncate">{f.label}</span>
                          <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${checked ? "border-[#8DA7BE]" : "border-slate-300"}`} style={{ background: checked ? "#8DA7BE" : "transparent" }}>
                            {checked && <Check size={9} className="text-white" />}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
            <div className="relative flex-1">
              <label className="text-[10px] text-slate-400 block mb-1">Contabilizar en</label>
              <button onClick={onToggleRoutePicker} className={`text-xs px-2.5 py-1 rounded-md ${ROW_INPUT} text-slate-600 hover:text-[#8DA7BE] w-full text-left truncate`}>
                {line.routedTo ? `${line.routedTo.chapterCode} · ${line.routedTo.subchapterCode} ${line.routedTo.subchapterDescription}` : "Aquí (sin redirigir)"}
              </button>
              {routePickerOpen && (
                <RoutePicker
                  currentSubchapterId={currentSubchapterId}
                  allSubchapters={allSubchapters}
                  hasRoute={!!line.routedTo}
                  onPick={onSetRoute}
                  onClear={() => onSetRoute(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NewLineRow({ globals, globalValues, error, onCommit }: {
  globals: { code: string; label: string }[]; globalValues: Record<string, number>; error?: string;
  onCommit: (fields: LineFields) => Promise<boolean>;
}) {
  const [fields, setFields] = useState<LineFields>(emptyFields);
  const preview = computeLineTotal(
    evaluateFieldExpr(fields.units, globalValues).value,
    evaluateFieldExpr(fields.multiplier, globalValues).value,
    evaluateFieldExpr(fields.rate, globalValues).value
  );
  const commit = async () => {
    const ok = await onCommit(fields);
    if (ok) setFields(emptyFields);
  };
  return (
    <div>
      <LineFieldsGrid
        fields={fields}
        onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        onBlurAny={commit}
        onEnter={commit}
        onEscape={() => setFields(emptyFields)}
        globals={globals}
        totalPreview={preview}
        muted={false}
      />
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}

export default function BudgetingSubchapterPage() {
  const { draftId, accountId, subchapterId } = useParams() as { draftId: string; accountId: string; subchapterId: string };
  const { user } = useUser();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [chapter, setChapter] = useState<BudgetingAccount | null>(null);
  const [subchapter, setSubchapter] = useState<BudgetingSubchapter | null>(null);
  const [lines, setLines] = useState<BudgetingDetailLine[]>([]);
  const [chapters, setChapters] = useState<BudgetingAccount[]>([]);
  const [subchaptersByChapter, setSubchaptersByChapter] = useState<Record<string, BudgetingSubchapter[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [fringePickerFor, setFringePickerFor] = useState<string | null>(null);
  const [routePickerFor, setRoutePickerFor] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDetailLine | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, `budgetingDrafts/${draftId}/accounts`, accountId), (snap) => {
      if (snap.exists()) setChapter({ id: snap.id, ...snap.data() } as BudgetingAccount);
    });
    return () => unsub();
  }, [draftId, accountId]);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, subchapterId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setSubchapter({ id: snap.id, ...snap.data() } as BudgetingSubchapter);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId, accountId, subchapterId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), (snap) => {
      setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)));
    });
    return () => unsub();
  }, [draftId, accountId, subchapterId]);

  // Todos los capítulos/subcapítulos del borrador: para el buscador de "Contabilizar en"
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

  const allSubchapters: RouteTarget[] = chapters.flatMap((c) =>
    (subchaptersByChapter[c.id] || []).map((sub) => ({ chapterId: c.id, chapterCode: c.code, chapterDescription: c.description, sub }))
  );

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const fringes = draft?.fringes || [];
  const globals = draft?.globals || [];
  const globalOptions = useMemo(() => globals.map((g) => ({ code: g.code, label: g.label })), [globals]);
  const globalResolution = useMemo(() => resolveGlobals(globals), [JSON.stringify(globals)]);

  const fringeExtras = computeFringeExtras(lines, fringes);
  const total = subchapter ? Math.round((subchapterTotal(subchapter, lines) + fringeExtras.subchapterScoped) * 100) / 100 : 0;

  const q = search.trim().toLowerCase();
  const matchesSearch = (l: BudgetingDetailLine) => !q || l.code.toLowerCase().includes(q) || l.description.toLowerCase().includes(q);

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const isLineCodeTaken = (code: string, excludeId?: string): boolean =>
    !!code && lines.some((l) => l.id !== excludeId && l.code.trim().toLowerCase() === code.trim().toLowerCase());

  const setRowError = (id: string, msg: string) => setRowErrors((prev) => ({ ...prev, [id]: msg }));
  const clearRowError = (id: string) => setRowErrors((prev) => { const { [id]: _, ...rest } = prev; return rest; });

  const lineRef = (lineId: string) => doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`, lineId);

  const buildPayload = (fields: LineFields) => {
    const unitsEval = evaluateFieldExpr(fields.units, globalResolution.values);
    const multEval = evaluateFieldExpr(fields.multiplier, globalResolution.values);
    const rateEval = evaluateFieldExpr(fields.rate, globalResolution.values);
    const error = unitsEval.error || multEval.error || rateEval.error;
    const total = computeLineTotal(unitsEval.value, multEval.value, rateEval.value);
    return {
      error,
      total,
      payload: {
        code: fields.code.trim(), description: fields.description.trim(),
        units: unitsEval.value, unitsExpr: isPlainNumber(fields.units) ? null : (fields.units.trim() || null),
        unit: fields.unit.trim(),
        multiplier: multEval.value, multiplierExpr: isPlainNumber(fields.multiplier) ? null : (fields.multiplier.trim() || null),
        rate: rateEval.value, rateExpr: isPlainNumber(fields.rate) ? null : (fields.rate.trim() || null),
        total,
      },
    };
  };

  const handleCommitLine = async (line: BudgetingDetailLine, fields: LineFields) => {
    const code = fields.code.trim();
    if (isLineCodeTaken(code, line.id)) { setRowError(line.id, "Ese código ya se usa en otra línea de este subcapítulo"); return; }
    const { error, total, payload } = buildPayload(fields);
    if (error) { setRowError(line.id, error); return; }
    clearRowError(line.id);
    const ref = lineRef(line.id);
    if (line.routedTo && total !== line.total) {
      const batch = writeBatch(db);
      batch.update(ref, payload);
      const targetRef = doc(db, `budgetingDrafts/${draftId}/accounts/${line.routedTo.chapterId}/subchapters`, line.routedTo.subchapterId);
      batch.update(targetRef, { receivedTotal: increment(total - (line.total || 0)) });
      await batch.commit();
    } else {
      await updateDoc(ref, payload);
    }
    await touchDraft();
  };

  const handleCommitNewLine = async (fields: LineFields): Promise<boolean> => {
    const code = fields.code.trim();
    const description = fields.description.trim();
    if (!code && !description) return false;
    if (isLineCodeTaken(code)) { setRowError("new", "Ese código ya se usa en otra línea de este subcapítulo"); return false; }
    const { error, payload } = buildPayload(fields);
    if (error) { setRowError("new", error); return false; }
    clearRowError("new");
    await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), {
      ...payload, supplier: "", notes: "", tags: [], fringeIds: [], routedTo: null, order: nextOrderValue(), createdAt: Timestamp.now(),
    });
    await touchDraft();
    return true;
  };

  const handleMoveLine = async (line: BudgetingDetailLine, direction: "up" | "down") => {
    const swaps = computeReorder(lines, line.id, direction);
    if (!swaps) return;
    await Promise.all(swaps.map((s) => updateDoc(lineRef(s.id), { order: s.order })));
    await touchDraft();
  };

  const handleDuplicateLine = async (line: BudgetingDetailLine) => {
    setSaving(true);
    try {
      let code = line.code ? `${line.code}-copia` : "";
      if (code) { let n = 2; while (isLineCodeTaken(code)) { code = `${line.code}-copia${n}`; n++; } }
      const newRef = doc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`));
      const payload = {
        code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
        multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
        supplier: line.supplier || "", notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
        routedTo: line.routedTo || null, order: nextOrderValue(), createdAt: Timestamp.now(),
      };
      if (line.routedTo) {
        const batch = writeBatch(db);
        batch.set(newRef, payload);
        const targetRef = doc(db, `budgetingDrafts/${draftId}/accounts/${line.routedTo.chapterId}/subchapters`, line.routedTo.subchapterId);
        batch.update(targetRef, { receivedTotal: increment(line.total || 0) });
        await batch.commit();
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), payload);
      }
      await touchDraft();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLine = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.routedTo) {
        const batch = writeBatch(db);
        batch.delete(lineRef(deleteTarget.id));
        const targetRef = doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.routedTo.chapterId}/subchapters`, deleteTarget.routedTo.subchapterId);
        batch.update(targetRef, { receivedTotal: increment(-(deleteTarget.total || 0)) });
        await batch.commit();
      } else {
        await deleteDoc(lineRef(deleteTarget.id));
      }
      await touchDraft();
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFringe = async (line: BudgetingDetailLine, fringeId: string) => {
    const current = line.fringeIds || [];
    const next = current.includes(fringeId) ? current.filter((id) => id !== fringeId) : [...current, fringeId];
    await updateDoc(lineRef(line.id), { fringeIds: next });
    await touchDraft();
  };

  const handleSetRoute = async (line: BudgetingDetailLine, target: RouteTarget | null) => {
    const newRoute: BudgetingLineRoute | null = target ? {
      chapterId: target.chapterId, chapterCode: target.chapterCode, chapterDescription: target.chapterDescription,
      subchapterId: target.sub.id, subchapterCode: target.sub.code, subchapterDescription: target.sub.description,
    } : null;
    const batch = writeBatch(db);
    batch.update(lineRef(line.id), { routedTo: newRoute });
    if (line.routedTo) {
      const oldRef = doc(db, `budgetingDrafts/${draftId}/accounts/${line.routedTo.chapterId}/subchapters`, line.routedTo.subchapterId);
      batch.update(oldRef, { receivedTotal: increment(-(line.total || 0)) });
    }
    if (newRoute) {
      const newTargetRef = doc(db, `budgetingDrafts/${draftId}/accounts/${newRoute.chapterId}/subchapters`, newRoute.subchapterId);
      batch.update(newTargetRef, { receivedTotal: increment(line.total || 0) });
    }
    await batch.commit();
    await touchDraft();
    setRoutePickerFor(null);
  };

  const handleUpdateSecondary = async (line: BudgetingDetailLine, patch: { supplier?: string; notes?: string; tags?: string[] }) => {
    await updateDoc(lineRef(line.id), patch);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !subchapter || !chapter) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Este subcapítulo no existe.</p>
      </div>
    );
  }

  return (
    <div className="w-full px-10 py-6">
      {/* Breadcrumb: solo navegación de entrar/volver, sin categorías ni desplegables */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#8DA7BE] transition-colors">{draft?.name}</Link>
        <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
        <Link href={`/budgeting/${draftId}/accounts/${accountId}`} className="text-xs font-medium text-slate-600 hover:text-[#8DA7BE] transition-colors">{chapter.code} {chapter.description}</Link>
        <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
        <span className="text-xs font-semibold text-slate-900">{subchapter.code} {subchapter.description}</span>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-sm font-semibold" style={{ color: "#1D201F" }}>{subchapter.code} · {subchapter.description}</h1>
        <div className="relative w-44 flex-shrink-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar"
            className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300" />
        </div>
      </div>

      {/* Detail lines */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={`grid ${cols} gap-0 divide-x divide-slate-200 px-4 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60`}>
            <span className="flex items-center py-2">Código</span>
            <span className="flex items-center py-2 pl-2">Descripción</span>
            <span className="flex items-center justify-end py-2 pl-2">Cant.</span>
            <span className="flex items-center py-2 pl-2">Unidad</span>
            <span className="flex items-center justify-end py-2 pl-2">X</span>
            <span className="flex items-center justify-end py-2 pl-2">Tarifa</span>
            <span className="flex items-center justify-end py-2 pl-2">Total</span>
          </div>
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
          </datalist>

          <div className="divide-y divide-slate-100">
            {(() => {
              const sorted = sortByOrder(lines.filter(matchesSearch));
              return sorted.map((line, i) => (
                <LineRow
                  key={line.id}
                  line={line}
                  fmt={fmt}
                  fringes={fringes}
                  globals={globalOptions}
                  globalValues={globalResolution.values}
                  draftId={draftId}
                  allSubchapters={allSubchapters}
                  currentSubchapterId={subchapterId}
                  isExpanded={expandedLine === line.id}
                  fringePickerOpen={fringePickerFor === line.id}
                  routePickerOpen={routePickerFor === line.id}
                  error={rowErrors[line.id]}
                  isFirst={i === 0}
                  isLast={i === sorted.length - 1}
                  onCommit={(fields) => handleCommitLine(line, fields)}
                  onToggleExpand={() => setExpandedLine(expandedLine === line.id ? null : line.id)}
                  onDuplicate={() => handleDuplicateLine(line)}
                  onDelete={() => setDeleteTarget(line)}
                  onMove={(direction) => handleMoveLine(line, direction)}
                  onToggleFringePicker={() => setFringePickerFor(fringePickerFor === line.id ? null : line.id)}
                  onToggleFringe={(id) => handleToggleFringe(line, id)}
                  onToggleRoutePicker={() => setRoutePickerFor(routePickerFor === line.id ? null : line.id)}
                  onSetRoute={(target) => handleSetRoute(line, target)}
                  onUpdateSecondary={(patch) => handleUpdateSecondary(line, patch)}
                />
              ));
            })()}
            {!q && <NewLineRow globals={globalOptions} globalValues={globalResolution.values} error={rowErrors["new"]} onCommit={handleCommitNewLine} />}
          </div>

          {(fringeExtras.subchapterScoped > 0 || fringeExtras.chapterScoped > 0 || fringeExtras.totalScoped > 0 || (subchapter.receivedTotal || 0) > 0) && (
            <div className="px-4 py-1.5 border-t border-slate-100 space-y-0.5">
              {fringeExtras.subchapterScoped > 0 && (
                <div className={`grid ${cols} gap-1 items-center`}>
                  <span /><span className="text-[11px] text-slate-500">Cargas sociales</span><span /><span /><span /><span />
                  <span className="text-[11px] text-slate-600 text-right">{fmt(fringeExtras.subchapterScoped)}</span>
                </div>
              )}
              {fringeExtras.chapterScoped > 0 && (
                <p className="text-[10px] text-slate-400">+{fmt(fringeExtras.chapterScoped)} en cargas sociales → total del capítulo</p>
              )}
              {fringeExtras.totalScoped > 0 && (
                <p className="text-[10px] text-slate-400">+{fmt(fringeExtras.totalScoped)} en cargas sociales → total del presupuesto</p>
              )}
              {(subchapter.receivedTotal || 0) > 0 && (
                <p className="text-[10px] text-slate-400">Incl. {fmt(subchapter.receivedTotal || 0)} redirigidos desde otras cuentas</p>
              )}
            </div>
          )}

          <div className={`grid ${cols} gap-1 items-center px-4 py-2.5 border-t border-slate-200 bg-slate-50/70`}>
            <span /><span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span><span /><span /><span />
            <span />
            <span className="text-xs font-bold text-right" style={{ color: "#1D201F" }}>{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar línea "{deleteTarget.description}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteLine} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
