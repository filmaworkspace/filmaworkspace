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
import {
  AlertCircle, ArrowUpRight, Check, ChevronDown, ChevronRight, ChevronUp, Copy,
  MoreVertical, Percent, Search, Settings2, Sigma, SlidersHorizontal, Trash2, Type, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT_ACTIVE, BudgetingAccount, BudgetingDetailColumnsConfig, BudgetingDetailLine, BudgetingDraft, BudgetingFringe, BudgetingFringeVisibility,
  BudgetingLineRoute, BudgetingSubchapter, CELL_INPUT, DEFAULT_DETAIL_COLUMNS_CONFIG, DEFAULT_FRINGE_VISIBILITY, DEFAULT_TEXT_LINE_COLOR, DETAIL_STAT_COLUMN_PX, DetailStatColumnWidth,
  UNIT_SUGGESTIONS, computeFringeExtras, computeLineTotal, computeReorder, evaluateFieldExpr,
  fmtCurrency, fmtDecimal, isPlainNumber, lineFringeBreakdown, nextOrderValue, resolveGlobals, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import BudgetingFormulaInput from "@/components/BudgetingFormulaInput";
import BudgetingTextLineControls from "@/components/BudgetingTextLineControls";

// ─────────────────────────────────────────────────────────────────────────────

interface LineFields { code: string; description: string; units: string; unit: string; multiplier: string; rate: string; comment: string; tags: string; }
// X (multiplicador) empieza siempre en 1 por defecto: es el caso más común, y así no hace falta escribirlo a mano en cada línea nueva.
const emptyFields: LineFields = { code: "", description: "", units: "", unit: "", multiplier: "1", rate: "", comment: "", tags: "" };
const toFields = (l: BudgetingDetailLine): LineFields => ({
  code: l.code, description: l.description,
  units: l.unitsExpr ?? String(l.units), unit: l.unit || "",
  multiplier: l.multiplierExpr ?? String(l.multiplier), rate: l.rateExpr ?? String(l.rate),
  comment: l.notes || "", tags: (l.tags || []).join(", "),
});

/**
 * Ancho de columnas del grid como plantilla CSS de verdad (no una clase de
 * Tailwind construida a mano): las clases `grid-cols-[...]` arbitrarias solo
 * funcionan si aparecen completas y literales en el código fuente, porque
 * Tailwind las detecta escaneando el texto en build time — al construirlas
 * por interpolación en runtime (como aquí, que cambian con la configuración
 * del usuario) nunca se generaría el CSS y la fila se rompería. Por eso el
 * ancho va como `style={{ gridTemplateColumns }}` en vez de como clase.
 */
function colTemplate(cfg: BudgetingDetailColumnsConfig): string {
  const w = DETAIL_STAT_COLUMN_PX[cfg.statColumnWidth];
  // Tarifa y Total llevan importes con decimales: van un poco más anchas que
  // Cant./Unidad/X, y del mismo ancho entre sí.
  const wide = w + 24;
  const parts = ["90px", "1fr", `${w}px`, `${w}px`, `${w}px`, `${wide}px`, `${wide}px`];
  if (cfg.showComment) parts.push("160px");
  if (cfg.showTags) parts.push("160px");
  parts.push("120px");
  return parts.join(" ");
}

interface RouteTarget { chapterId: string; chapterCode: string; chapterDescription: string; sub: BudgetingSubchapter; }

// ─── Fila de una carga social ("fringe") con alcance de subcapítulo: aparece
// como una línea más de la tabla, alineada a las mismas columnas (con las de
// Cant./Unidad/X/Tarifa en blanco), con su código y nombre editables, pero
// el importe es de solo lectura porque sale calculado de las líneas. ───────
function SubchapterFringeRow({
  fringe, amount, draftId, template, columnsConfig, onCommit,
}: {
  fringe: BudgetingFringe; amount: number; draftId: string; template: string; columnsConfig: BudgetingDetailColumnsConfig;
  onCommit: (code: string, label: string) => void;
}) {
  const [code, setCode] = useState(fringe.code);
  const [label, setLabel] = useState(fringe.label);

  const commit = () => {
    if (!code.trim() || !label.trim()) { setCode(fringe.code); setLabel(fringe.label); return; }
    onCommit(code.trim(), label.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(fringe.code); setLabel(fringe.label); }
  };

  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4 hover:bg-slate-50 group" style={{ gridTemplateColumns: template }}>
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span />
      <span />
      <span />
      <span />
      <span className="flex items-center justify-end text-xs font-semibold pl-2 pr-2 text-slate-500" title="Importe calculado a partir de las líneas: no se edita aquí">
        {fmtDecimal(amount)}
      </span>
      {columnsConfig.showComment && <span />}
      {columnsConfig.showTags && <span />}
      <Link
        href={`/budgeting/${draftId}/fringes`}
        className="flex items-center justify-end gap-1 pl-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-[#8DA7BE]"
        title="Ver en Cargas sociales"
      >
        <Percent size={10} />
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}

// ─── Sidebar único: ajustes de columnas de la tabla arriba, y (si hay una
// línea elegida) sus Cargas sociales + Sumar en debajo — un solo panel, no
// un popover para uno y un cajón aparte para lo otro. ──────────────────────
function DetailSidebar({
  columnsConfig, onChangeColumns, showFringes, onToggleShowFringes, line, fringes, allSubchapters, currentSubchapterId, draftId,
  onClose, onToggleFringe, onSetRoute,
}: {
  columnsConfig: BudgetingDetailColumnsConfig; onChangeColumns: (patch: Partial<BudgetingDetailColumnsConfig>) => void;
  showFringes: boolean; onToggleShowFringes: (v: boolean) => void;
  line: BudgetingDetailLine | null; fringes: BudgetingFringe[]; allSubchapters: RouteTarget[]; currentSubchapterId: string; draftId: string;
  onClose: () => void; onToggleFringe: (fringeId: string) => void; onSetRoute: (target: RouteTarget | null) => void;
}) {
  const [routeSearch, setRouteSearch] = useState("");
  useEffect(() => { setRouteSearch(""); }, [line?.id]);

  const breakdown = line ? lineFringeBreakdown(line, fringes) : [];
  const query = routeSearch.trim().toLowerCase();
  const options = allSubchapters.filter((o) => o.sub.id !== currentSubchapterId);
  const filtered = query
    ? options.filter((o) => `${o.chapterCode} ${o.chapterDescription} ${o.sub.code} ${o.sub.description}`.toLowerCase().includes(query))
    : options;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[340px] bg-white border-l border-slate-200 shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <p className="text-sm font-semibold text-slate-900">Ajustes del detalle</p>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Columnas de la tabla */}
          <div className="px-5 py-4 border-b border-slate-100 space-y-3">
            <p className="text-xs font-medium text-slate-700">Columnas</p>
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Mostrar Comentario</span>
              <input type="checkbox" checked={columnsConfig.showComment} onChange={(e) => onChangeColumns({ showComment: e.target.checked })} className="accent-[#8DA7BE]" />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Mostrar Etiquetas</span>
              <input type="checkbox" checked={columnsConfig.showTags} onChange={(e) => onChangeColumns({ showTags: e.target.checked })} className="accent-[#8DA7BE]" />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">Mostrar cargas sociales</span>
              <input type="checkbox" checked={showFringes} onChange={(e) => onToggleShowFringes(e.target.checked)} className="accent-[#8DA7BE]" />
            </label>
            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Ancho de Cant./Unidad/X/Tarifa</p>
              <div className="flex items-center gap-1 p-0.5 border border-slate-200 rounded-lg bg-slate-50 w-fit">
                {(["compact", "normal", "wide"] as DetailStatColumnWidth[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => onChangeColumns({ statColumnWidth: w })}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${columnsConfig.statColumnWidth === w ? BTN_LIGHT_ACTIVE : "text-slate-500 hover:text-slate-700"}`}
                  >
                    {w === "compact" ? "Compacto" : w === "normal" ? "Normal" : "Ancho"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Línea seleccionada */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Línea seleccionada</p>
            {!line ? (
              <p className="text-xs text-slate-400 leading-relaxed">
                Pasa el ratón por una línea y pulsa su icono <SlidersHorizontal size={11} className="inline mx-0.5 -mt-0.5" /> para configurar sus cargas sociales o a qué cuenta suma.
              </p>
            ) : (
              <>
                <div className="mb-4 pb-3 border-b border-slate-100">
                  <p className="text-[10px] font-mono text-slate-400">{line.code || "(sin ID)"}</p>
                  <p className="text-sm font-medium text-slate-900 truncate">{line.description || "(sin descripción)"}</p>
                </div>

                <p className="text-xs font-medium text-slate-700 mb-2">Cargas sociales</p>
                {fringes.length === 0 ? (
                  <p className="text-xs text-slate-400 mb-4">Sin cargas sociales configuradas todavía.</p>
                ) : (
                  <div className="space-y-1 mb-4">
                    {fringes.map((f) => {
                      const checked = (line.fringeIds || []).includes(f.id);
                      const amount = breakdown.find((b) => b.fringe.id === f.id)?.amount;
                      return (
                        <button
                          key={f.id}
                          onClick={() => onToggleFringe(f.id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors ${checked ? "border-[#8DA7BE] bg-[#8DA7BE]/[0.06]" : "border-slate-200 hover:border-slate-300"}`}
                        >
                          <span className="text-xs text-slate-700 truncate">{f.label}</span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {checked && amount != null && <span className="text-xs font-medium text-slate-600">{fmtDecimal(amount)}</span>}
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${checked ? "border-[#8DA7BE]" : "border-slate-300"}`} style={{ background: checked ? "#8DA7BE" : "transparent" }}>
                              {checked && <Check size={9} className="text-white" />}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-xs font-medium text-slate-700 mb-2">Sumar en</p>
                {line.routedTo ? (
                  <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <Link
                      href={`/budgeting/${draftId}/accounts/${line.routedTo.chapterId}/subchapters/${line.routedTo.subchapterId}`}
                      className="text-xs hover:underline flex items-center gap-1"
                      style={{ color: "#8DA7BE" }}
                    >
                      {line.routedTo.chapterCode} · {line.routedTo.subchapterCode} {line.routedTo.subchapterDescription}
                      <ArrowUpRight size={11} />
                    </Link>
                    <button onClick={() => onSetRoute(null)} className="text-xs text-red-500 hover:underline">Quitar redirección</button>
                  </div>
                ) : (
                  <>
                    <input
                      value={routeSearch}
                      onChange={(e) => setRouteSearch(e.target.value)}
                      placeholder="Buscar cuenta destino..."
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-[#8DA7BE] mb-2"
                    />
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {filtered.length === 0 ? (
                        <p className="text-[11px] text-slate-400 text-center py-3">Sin resultados</p>
                      ) : (
                        filtered.map((o) => (
                          <button key={o.sub.id} onClick={() => onSetRoute(o)} className="w-full flex flex-col items-start px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-50">
                            <span className="text-xs text-slate-800 truncate">{o.sub.code} {o.sub.description}</span>
                            <span className="text-[10px] text-slate-400 truncate">{o.chapterCode} {o.chapterDescription}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Fila de campos, estilo Excel: sin caja, sin placeholder, guarda sola al
// perder el foco (sin botón de confirmar). Componente de módulo estable: no
// se redefine entre renders, así los inputs no pierden el foco al escribir. ──
function LineFieldsGrid({
  fields, onChange, onBlurAny, onEnter, onEscape, globals, totalPreview, muted, template, showComment, showTags, indicators, actions,
}: {
  fields: LineFields; onChange: (patch: Partial<LineFields>) => void; onBlurAny: () => void;
  onEnter: () => void; onEscape: () => void; globals: { code: string; label: string }[];
  totalPreview: number; muted: boolean; template: string; showComment: boolean; showTags: boolean;
  indicators?: React.ReactNode; actions?: React.ReactNode;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { onEnter(); }
    if (e.key === "Escape") { onEscape(); }
  };
  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4" style={{ gridTemplateColumns: template }}>
      <input value={fields.code} onChange={(e) => onChange({ code: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={fields.description} onChange={(e) => onChange({ description: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <BudgetingFormulaInput value={fields.units} onChange={(v) => onChange({ units: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-xs text-right pl-2`} />
      <input list="unit-suggestions" value={fields.unit} onChange={(e) => onChange({ unit: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-[11px] pl-2`} />
      <BudgetingFormulaInput value={fields.multiplier} onChange={(v) => onChange({ multiplier: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-[11px] text-right pl-2`} />
      <BudgetingFormulaInput value={fields.rate} onChange={(v) => onChange({ rate: v })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-xs text-right pl-2`} />
      <span className={`flex items-center justify-end text-xs font-semibold pl-2 pr-2 ${muted ? "text-slate-400 italic" : "text-slate-900"}`}>{fmtDecimal(totalPreview)}</span>
      {showComment && (
        <input value={fields.comment} onChange={(e) => onChange({ comment: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
          className={`${CELL_INPUT} text-xs pl-2`} />
      )}
      {showTags && (
        <input value={fields.tags} onChange={(e) => onChange({ tags: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
          className={`${CELL_INPUT} text-xs pl-2`} />
      )}
      <div className="flex items-center justify-end gap-1 pl-2">
        {indicators}
        {actions}
      </div>
    </div>
  );
}

function LineRow({
  line, fringes, globals, globalValues, columnsConfig, template, isFirst, isLast, error, sidebarOpen,
  onCommit, onDuplicate, onDelete, onMove, onOpenSidebar,
}: {
  line: BudgetingDetailLine; fringes: BudgetingFringe[];
  globals: { code: string; label: string }[]; globalValues: Record<string, number>;
  columnsConfig: BudgetingDetailColumnsConfig; template: string; isFirst: boolean; isLast: boolean; error?: string; sidebarOpen: boolean;
  onCommit: (fields: LineFields) => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: "up" | "down") => void; onOpenSidebar: () => void;
}) {
  const [fields, setFields] = useState<LineFields>(() => toFields(line));
  const hasFormula = !!(line.unitsExpr || line.multiplierExpr || line.rateExpr);
  const hasHiddenComment = !columnsConfig.showComment && !!line.notes;
  const hasFringesOrRoute = (line.fringeIds?.length || 0) > 0 || !!line.routedTo;
  const preview = computeLineTotal(
    evaluateFieldExpr(fields.units, globalValues).value,
    evaluateFieldExpr(fields.multiplier, globalValues).value,
    evaluateFieldExpr(fields.rate, globalValues).value
  );

  return (
    <div className="group">
      <LineFieldsGrid
        fields={fields}
        onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        onBlurAny={() => onCommit(fields)}
        onEnter={() => onCommit(fields)}
        onEscape={() => setFields(toFields(line))}
        globals={globals}
        totalPreview={preview}
        muted={!!line.routedTo}
        template={template}
        showComment={columnsConfig.showComment}
        showTags={columnsConfig.showTags}
        indicators={
          (hasFormula || hasHiddenComment) && (
            <span className="flex items-center gap-1">
              {hasFormula && <span title="Contiene fórmula"><Sigma size={10} className="text-[#8DA7BE]" /></span>}
              {hasHiddenComment && <span title={line.notes} className="text-[10px]">💬</span>}
            </span>
          )
        }
        actions={
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
              <ChevronUp size={11} />
            </button>
            <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
              <ChevronDown size={11} />
            </button>
            <button onClick={onOpenSidebar} className={`relative p-1 rounded transition-colors ${sidebarOpen ? "text-[#8DA7BE] bg-[#8DA7BE]/[0.1]" : "text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1]"}`} title="Cargas sociales y Sumar en">
              <SlidersHorizontal size={11} />
              {hasFringesOrRoute && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: "#8DA7BE" }} />}
            </button>
            <button onClick={onDuplicate} className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Duplicar línea">
              <Copy size={11} />
            </button>
            <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
              <Trash2 size={11} />
            </button>
          </span>
        }
      />
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-1.5 pt-0.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}

function NewLineRow({ globals, globalValues, columnsConfig, template, error, onCommit }: {
  globals: { code: string; label: string }[]; globalValues: Record<string, number>;
  columnsConfig: BudgetingDetailColumnsConfig; template: string; error?: string;
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
        template={template}
        showComment={columnsConfig.showComment}
        showTags={columnsConfig.showTags}
      />
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 px-4 pb-1.5 pt-0.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Línea de solo texto (nota, sin código ni importe): la descripción ocupa
// desde ID hasta Total, dejando Comentario/Etiquetas en blanco y las
// acciones en su columna habitual, para que la fila siga alineada con las
// demás pese al ancho de columnas dinámico. ────────────────────────────────
function TextLineRow({
  line, template, columnsConfig, isFirst, isLast, autoFocusText, onCommitTextLine, onMove, onDelete,
}: {
  line: BudgetingDetailLine; template: string; columnsConfig: BudgetingDetailColumnsConfig; isFirst: boolean; isLast: boolean; autoFocusText?: boolean;
  onCommitTextLine: (patch: { description?: string; textBold?: boolean; textColor?: string }) => void;
  onMove: (direction: "up" | "down") => void; onDelete: () => void;
}) {
  const [description, setDescription] = useState(line.description);
  const commit = () => {
    if (!description.trim()) { setDescription(line.description); return; }
    if (description.trim() !== line.description) onCommitTextLine({ description: description.trim() });
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") setDescription(line.description);
  };
  let actionsCol = 8;
  if (columnsConfig.showComment) actionsCol++;
  if (columnsConfig.showTags) actionsCol++;

  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4 group" style={{ gridTemplateColumns: template }}>
      <input
        autoFocus={autoFocusText}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="Texto..."
        style={{ gridColumn: "1 / 8", color: line.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: line.textBold ? 700 : 400 }}
        className={`${CELL_INPUT} text-xs`}
      />
      <span
        className="flex items-center justify-end gap-1 pl-2 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ gridColumn: `${actionsCol} / ${actionsCol + 1}` }}
      >
        <BudgetingTextLineControls
          bold={!!line.textBold}
          color={line.textColor || DEFAULT_TEXT_LINE_COLOR}
          onChangeBold={(v) => onCommitTextLine({ textBold: v })}
          onChangeColor={(c) => onCommitTextLine({ textColor: c })}
        />
        <button onClick={() => onMove("up")} disabled={isFirst} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Subir">
          <ChevronUp size={11} />
        </button>
        <button onClick={() => onMove("down")} disabled={isLast} className="p-0.5 text-slate-300 hover:text-[#8DA7BE] rounded transition-colors disabled:opacity-20 disabled:pointer-events-none" title="Bajar">
          <ChevronDown size={11} />
        </button>
        <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
          <Trash2 size={11} />
        </button>
      </span>
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarLineId, setSidebarLineId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDetailLine | null>(null);
  const [saving, setSaving] = useState(false);
  const [justAddedTextId, setJustAddedTextId] = useState<string | null>(null);

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

  // Todos los capítulos/subcapítulos del borrador: para el buscador de "Sumar en"
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

  // Las líneas de texto (sin importe) no son cuentas de verdad: no aparecen como destino de "Sumar en".
  const allSubchapters: RouteTarget[] = chapters.flatMap((c) =>
    (subchaptersByChapter[c.id] || []).filter((sub) => !sub.isTextLine).map((sub) => ({ chapterId: c.id, chapterCode: c.code, chapterDescription: c.description, sub }))
  );

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const fringes = draft?.fringes || [];
  const globals = draft?.globals || [];
  const globalOptions = useMemo(() => globals.map((g) => ({ code: g.code, label: g.label })), [globals]);
  const globalResolution = useMemo(() => resolveGlobals(globals), [JSON.stringify(globals)]);
  const columnsConfig = draft?.detailColumnsConfig || DEFAULT_DETAIL_COLUMNS_CONFIG;
  const template = colTemplate(columnsConfig);
  const fringeVisibility: BudgetingFringeVisibility = draft?.fringeVisibility || DEFAULT_FRINGE_VISIBILITY;

  const fringeExtras = computeFringeExtras(lines, fringes);
  const total = subchapter ? Math.round((subchapterTotal(subchapter, lines) + fringeExtras.subchapterScoped) * 100) / 100 : 0;

  // Cargas sociales con alcance de este subcapítulo: desglosadas una a una
  // (no en un único total agregado) porque cada una puede aparecer como su
  // propia línea, con su propio código, si el toggle "Mostrar cargas
  // sociales" está activado.
  const subchapterFringeBreakdown = (() => {
    const sums = new Map<string, number>();
    for (const line of lines) {
      for (const { fringe, amount } of lineFringeBreakdown(line, fringes)) {
        if (fringe.scope !== "subchapter") continue;
        sums.set(fringe.id, (sums.get(fringe.id) || 0) + amount);
      }
    }
    return fringes
      .filter((f) => sums.has(f.id))
      .map((f) => ({ fringe: f, amount: Math.round((sums.get(f.id) || 0) * 100) / 100 }));
  })();

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

  const updateColumnsConfig = async (patch: Partial<BudgetingDetailColumnsConfig>) => {
    const next: BudgetingDetailColumnsConfig = { ...columnsConfig, ...patch };
    await updateDoc(doc(db, "budgetingDrafts", draftId), { detailColumnsConfig: next, updatedAt: serverTimestamp() });
  };

  const updateFringeVisibility = async (patch: Partial<BudgetingFringeVisibility>) => {
    await updateDoc(doc(db, "budgetingDrafts", draftId), { fringeVisibility: { ...fringeVisibility, ...patch }, updatedAt: serverTimestamp() });
    await touchDraft();
  };

  // El código y el nombre de una fringe se pueden editar desde su propia
  // línea aquí (misma fringe, no una copia): actualiza la entrada en
  // draft.fringes. El importe de la fila no se toca, sale calculado.
  const handleCommitFringe = async (fringe: BudgetingFringe, code: string, label: string) => {
    if (code === fringe.code && label === fringe.label) return;
    const next = fringes.map((f) => (f.id === fringe.id ? { ...f, code, label } : f));
    await updateDoc(doc(db, "budgetingDrafts", draftId), { fringes: next, updatedAt: serverTimestamp() });
    await touchDraft();
  };

  const openSidebar = (lineId: string | null) => { setSidebarLineId(lineId); setSidebarOpen(true); };

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
        notes: fields.comment.trim(),
        tags: fields.tags.split(",").map((t) => t.trim()).filter(Boolean),
      },
    };
  };

  const handleCommitLine = async (line: BudgetingDetailLine, fields: LineFields) => {
    const code = fields.code.trim();
    if (isLineCodeTaken(code, line.id)) { setRowError(line.id, "Ese ID ya se usa en otra línea de este subcapítulo"); return; }
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
    if (isLineCodeTaken(code)) { setRowError("new", "Ese ID ya se usa en otra línea de este subcapítulo"); return false; }
    const { error, payload } = buildPayload(fields);
    if (error) { setRowError("new", error); return false; }
    clearRowError("new");
    await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), {
      ...payload, fringeIds: [], routedTo: null, order: nextOrderValue(), createdAt: Timestamp.now(),
    });
    await touchDraft();
    return true;
  };

  // ── Línea de texto (nota, sin código ni importe): mismo doc de Detalle,
  // marcado con isTextLine, para poder intercalarla entre líneas reales. ──
  const handleAddTextLine = async () => {
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), {
      code: "", description: "", units: 0, unit: "", multiplier: 0, rate: 0, total: 0,
      notes: "", tags: [], fringeIds: [], routedTo: null,
      isTextLine: true, textBold: false, textColor: DEFAULT_TEXT_LINE_COLOR,
      order: nextOrderValue(), createdAt: Timestamp.now(),
    });
    await touchDraft();
    setJustAddedTextId(ref.id);
  };
  const handleCommitTextLine = async (line: BudgetingDetailLine, patch: { description?: string; textBold?: boolean; textColor?: string }) => {
    await updateDoc(lineRef(line.id), patch);
    await touchDraft();
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
        notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [],
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

  const sidebarLine = sidebarLineId ? lines.find((l) => l.id === sidebarLineId) || null : null;

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
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative w-44">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar"
              className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300" />
          </div>
          <button onClick={() => openSidebar(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors" title="Ajustes del detalle">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Detail lines */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid gap-0 divide-x divide-slate-200 px-4 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60" style={{ gridTemplateColumns: template }}>
            <span className="flex items-center py-2" title="Referencial: el código que se asigna en PO/facturas de Accounting es el del subcapítulo">ID</span>
            <span className="flex items-center py-2 pl-2">Descripción</span>
            <span className="flex items-center justify-center py-2 pl-2">Cant.</span>
            <span className="flex items-center justify-center py-2 pl-2">Unidad</span>
            <span className="flex items-center justify-center py-2 pl-2">X</span>
            <span className="flex items-center justify-center py-2 pl-2">Tarifa</span>
            <span className="flex items-center justify-end py-2 pl-2 pr-2">Total</span>
            {columnsConfig.showComment && <span className="flex items-center py-2 pl-2">Comentario</span>}
            {columnsConfig.showTags && <span className="flex items-center py-2 pl-2">Etiquetas</span>}
            <span className="flex items-center justify-end pl-2">
              <button
                onClick={() => openSidebar(null)}
                className="p-1 rounded text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors normal-case"
                title="Mostrar/ocultar columnas"
              >
                <MoreVertical size={13} />
              </button>
            </span>
          </div>
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
          </datalist>

          <div className="divide-y divide-slate-100">
            {(() => {
              const sorted = sortByOrder(lines.filter(matchesSearch));
              return sorted.map((line, i) =>
                line.isTextLine ? (
                  <TextLineRow
                    key={line.id}
                    line={line}
                    template={template}
                    columnsConfig={columnsConfig}
                    isFirst={i === 0}
                    isLast={i === sorted.length - 1}
                    autoFocusText={line.id === justAddedTextId}
                    onCommitTextLine={(patch) => handleCommitTextLine(line, patch)}
                    onMove={(direction) => handleMoveLine(line, direction)}
                    onDelete={() => setDeleteTarget(line)}
                  />
                ) : (
                  <LineRow
                    key={line.id}
                    line={line}
                    fringes={fringes}
                    globals={globalOptions}
                    globalValues={globalResolution.values}
                    columnsConfig={columnsConfig}
                    template={template}
                    error={rowErrors[line.id]}
                    isFirst={i === 0}
                    isLast={i === sorted.length - 1}
                    sidebarOpen={sidebarOpen && sidebarLineId === line.id}
                    onCommit={(fields) => handleCommitLine(line, fields)}
                    onDuplicate={() => handleDuplicateLine(line)}
                    onDelete={() => setDeleteTarget(line)}
                    onMove={(direction) => handleMoveLine(line, direction)}
                    onOpenSidebar={() => openSidebar(line.id)}
                  />
                )
              );
            })()}
            {!q && <NewLineRow globals={globalOptions} globalValues={globalResolution.values} columnsConfig={columnsConfig} template={template} error={rowErrors["new"]} onCommit={handleCommitNewLine} />}
            {!q && (
              <button onClick={handleAddTextLine} className="flex items-center gap-1 px-4 py-1.5 text-[10px] text-slate-400 hover:text-[#8DA7BE] transition-colors">
                <Type size={10} /> Añadir línea de texto
              </button>
            )}
          </div>

          {fringeVisibility.detail && subchapterFringeBreakdown.length > 0 && (
            <div className="border-t border-slate-100">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Cargas sociales de este subcapítulo</p>
              <div className="divide-y divide-slate-100">
                {subchapterFringeBreakdown.map(({ fringe, amount }) => (
                  <SubchapterFringeRow
                    key={fringe.id}
                    fringe={fringe}
                    amount={amount}
                    draftId={draftId}
                    template={template}
                    columnsConfig={columnsConfig}
                    onCommit={(code, label) => handleCommitFringe(fringe, code, label)}
                  />
                ))}
              </div>
            </div>
          )}

          {(fringeExtras.subchapterScoped > 0 || fringeExtras.chapterScoped > 0 || fringeExtras.totalScoped > 0 || (subchapter.receivedTotal || 0) > 0) && (
            <div className="px-4 py-1.5 border-t border-slate-100 space-y-0.5">
              {fringeExtras.subchapterScoped > 0 && !(fringeVisibility.detail && subchapterFringeBreakdown.length > 0) && (
                <p className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>Cargas sociales</span>
                  <span className="text-slate-600 font-medium">{fmt(fringeExtras.subchapterScoped)}</span>
                </p>
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

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-200 bg-slate-50/70">
            <span className="text-xs font-bold" style={{ color: "#1D201F" }}>Total</span>
            <span className="text-xs font-bold" style={{ color: "#1D201F" }}>{fmt(total)}</span>
          </div>
        </div>
      </div>

      {/* ── Sidebar único: columnas + línea seleccionada ────────────────────── */}
      {sidebarOpen && (
        <DetailSidebar
          columnsConfig={columnsConfig}
          onChangeColumns={updateColumnsConfig}
          showFringes={fringeVisibility.detail}
          onToggleShowFringes={(v) => updateFringeVisibility({ detail: v })}
          line={sidebarLine}
          fringes={fringes}
          allSubchapters={allSubchapters}
          currentSubchapterId={subchapterId}
          draftId={draftId}
          onClose={() => setSidebarOpen(false)}
          onToggleFringe={(id) => sidebarLine && handleToggleFringe(sidebarLine, id)}
          onSetRoute={(target) => sidebarLine && handleSetRoute(sidebarLine, target)}
        />
      )}

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
