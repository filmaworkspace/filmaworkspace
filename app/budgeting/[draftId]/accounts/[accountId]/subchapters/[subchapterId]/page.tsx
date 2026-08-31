"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, increment, onSnapshot, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle, AlignLeft, Asterisk, ArrowUpRight, Box, Check, ChevronLeft, ChevronRight, Copy,
  DollarSign, Equal, Eye, EyeOff, Hash, Lock, MessageSquare, MoreVertical, Percent, Ruler, Search, Settings2, Sigma, SlidersHorizontal, Tag, Trash2, X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT_ACTIVE, BudgetingAccount, BudgetingDetailColumnsConfig, BudgetingDetailLine, BudgetingDraft, BudgetingFolder, BudgetingFringe, BudgetingFringeVisibility,
  BudgetingLineRoute, BudgetingSubchapter, CELL_INPUT, DEFAULT_DETAIL_COLUMNS_CONFIG, DEFAULT_FRINGE_VISIBILITY, DEFAULT_RECEIVED_LABEL, DEFAULT_TEXT_LINE_COLOR, DETAIL_STAT_COLUMN_PX, DetailStatColumnWidth, FringeGroupTarget,
  BudgetingUnit, DEFAULT_UNITS, clearBudgetingClipboard, computeFringeExtras, computeLineTotal, evaluateFieldExpr,
  fmtCurrency, fmtDecimal, focusBudgetingRowField, getBudgetingClipboard, groupFringeSumsByFolder, isPlainNumber, lineFringeBreakdown, nextOrderValue, orderAfter, pluralizeUnit, resolveGlobals, setBudgetingClipboard, sortByOrder, subchapterTotal,
} from "@/lib/budgeting";
import BudgetingFormulaInput from "@/components/BudgetingFormulaInput";
import BudgetingUnitInput from "@/components/BudgetingUnitInput";
import BudgetingRowContextMenu, { BudgetingRowContextMenuState } from "@/components/BudgetingRowContextMenu";
import BudgetingDragHandle from "@/components/BudgetingDragHandle";
import BudgetingFloatingMenu from "@/components/BudgetingFloatingMenu";
import { useRowDrag, resolveDragAfterId } from "@/hooks/useRowDrag";
import { useSlashCommands } from "@/hooks/useSlashCommands";

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
  const parts = ["20px", "90px", "1fr", `${w}px`, `${w}px`, `${w}px`, `${wide}px`, `${wide}px`];
  if (cfg.showComment) parts.push("160px");
  if (cfg.showTags) parts.push("160px");
  parts.push("120px");
  return parts.join(" ");
}

/** Borde que marca dónde caería la fila arrastrada al soltar (ver useRowDrag). */
const dragIndicator = (pos: "before" | "after" | null) =>
  pos === "before" ? "border-t-2 border-[#E86F4A]" : pos === "after" ? "border-b-2 border-[#E86F4A]" : "";

/** Comandos "/" en Descripción de la fila fantasma: mismo mini-menú que BudgetingPhantomRow (ver ahí el porqué). */
/**
 * Primera línea de un Detalle vacío: Código/Descripción ya editables, sin
 * tener que crearla antes con el menú contextual (ver BudgetingPhantomRow,
 * la versión compartida de Capítulo/Cuenta; esta va aparte porque su grid
 * tiene más columnas y anchos dinámicos vía `template`). No existe en
 * Firestore hasta que se escribe algo y se sale de la celda. Escribir "/" en
 * Descripción abre los mismos comandos rápidos (texto/subtotal). El resto de
 * columnas enseña ya los valores por defecto de una línea real recién creada
 * (Cant. 0, X 1, Tarifa 0, Total 0,00): así no se distingue de una añadida
 * con "Añadir línea" hasta que se empieza a escribir.
 */
function PhantomLineRow({
  template, columnsConfig, onCreate, onCreateText, onCreateSubtotal, onContextMenu,
}: {
  template: string; columnsConfig: BudgetingDetailColumnsConfig;
  onCreate: (code: string, description: string) => void; onCreateText: () => void; onCreateSubtotal: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const descWrapRef = useRef<HTMLDivElement>(null);

  const { isCommand, matches } = useSlashCommands(description);
  const runCommand = (cmd: string) => {
    setDescription("");
    if (cmd === "texto") onCreateText();
    else if (cmd === "subtotal") onCreateSubtotal();
  };

  const commit = () => {
    if (isCommand) { setDescription(""); return; }
    if (!code.trim() && !description.trim()) return;
    onCreate(code.trim(), description.trim());
    setCode("");
    setDescription("");
  };
  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };
  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && isCommand && matches.length > 0) { e.preventDefault(); runCommand(matches[0].cmd); return; }
    if (e.key === "Escape" && isCommand) { setDescription(""); return; }
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };
  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4 bg-white" style={{ gridTemplateColumns: template }} onContextMenu={onContextMenu}>
      <span />
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleCodeKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <div ref={descWrapRef} className="relative h-full">
        <input value={description} onChange={(e) => setDescription(e.target.value)} onBlur={commit} onKeyDown={handleDescriptionKeyDown}
          className={`${CELL_INPUT} text-xs pl-2`} />
        {isCommand && matches.length > 0 && (
          <BudgetingFloatingMenu anchorRef={descWrapRef} className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {matches.map((c) => (
              <button
                key={c.cmd}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand(c.cmd)}
                className="w-full flex flex-col items-start px-2.5 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="text-xs font-medium" style={{ color: "#E86F4A" }}>/{c.cmd}</span>
                <span className="text-[10px] text-slate-400">{c.hint}</span>
              </button>
            ))}
          </BudgetingFloatingMenu>
        )}
      </div>
      <span className="flex items-center justify-end text-xs pl-2 pr-2">0</span>
      <span />
      <span className="flex items-center justify-end text-[11px] pl-2 pr-2">1</span>
      <span className="flex items-center justify-end text-xs pl-2 pr-2">0</span>
      <span className="flex items-center justify-end text-xs font-semibold pl-2 pr-2">{fmtDecimal(0)}</span>
      {columnsConfig.showComment && <span />}
      {columnsConfig.showTags && <span />}
      <div />
    </div>
  );
}

interface RouteTarget { chapterId: string; chapterCode: string; chapterDescription: string; sub: BudgetingSubchapter; }

/** Todo lo que hace falta para recrear una línea entera al pegarla (copiar/cortar), sin id/order/createdAt. */
interface LineClipboardData {
  code: string; description: string; units: number; unitsExpr: string | null; unit: string;
  multiplier: number; multiplierExpr: string | null; rate: number; rateExpr: string | null; total: number;
  notes: string; tags: string[]; fringeIds: string[]; routedTo: BudgetingLineRoute | null;
  isTextLine: boolean; isSubtotal: boolean; textBold: boolean; textColor: string | null;
}

// ─── Fila de una carga social ("fringe") con alcance de subcapítulo: aparece
// como una línea más de la tabla, alineada a las mismas columnas (con las de
// Cant./Unidad/X/Tarifa en blanco), con su código y nombre editables, pero
// el importe es de solo lectura porque sale calculado de las líneas. ───────
function SubchapterFringeRow({
  code: initialCode, label: initialLabel, amount, target, draftId, template, columnsConfig, onCommit,
}: {
  code: string; label: string; amount: number; target: FringeGroupTarget; draftId: string; template: string; columnsConfig: BudgetingDetailColumnsConfig;
  onCommit: (target: FringeGroupTarget, code: string, label: string) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState(initialLabel);

  const commit = () => {
    if (!code.trim() || !label.trim()) { setCode(initialCode); setLabel(initialLabel); return; }
    onCommit(target, code.trim(), label.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(initialCode); setLabel(initialLabel); }
  };

  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4 hover:bg-slate-50 group" style={{ gridTemplateColumns: template }}>
      <span />
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span />
      <span />
      <span />
      <span className="flex items-center justify-end text-xs font-semibold pl-2 pr-2 text-slate-500" title="Importe calculado a partir de las líneas: no se edita aquí">
        {fmtDecimal(amount)}
      </span>
      {columnsConfig.showComment && <span />}
      {columnsConfig.showTags && <span />}
      <Link
        href="?library=fringes"
        className="flex items-center justify-end gap-1 pl-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-[#E86F4A]"
        title="Ver en Cargas sociales"
      >
        <Percent size={10} />
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}

// ─── Fila que representa `receivedTotal`: lo que otras líneas han "sumado
// aquí" (routedTo) desde otras Cuentas. Antes era un textito suelto; ahora
// es una fila real de la tabla, como las de cargas sociales fundidas, con su
// propio código/descripción editables (el "item" al que se refería el
// usuario) aunque el importe no se edite aquí (es la suma de otras líneas). ──
function ReceivedTotalRow({
  code: initialCode, label: initialLabel, amount, template, columnsConfig, onCommit,
}: {
  code: string; label: string; amount: number; template: string; columnsConfig: BudgetingDetailColumnsConfig;
  onCommit: (code: string, label: string) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState(initialLabel);

  const commit = () => {
    if (!label.trim()) { setCode(initialCode); setLabel(initialLabel); return; }
    onCommit(code.trim(), label.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(initialCode); setLabel(initialLabel); }
  };

  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4 hover:bg-slate-50 group" style={{ gridTemplateColumns: template }}>
      <span />
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span />
      <span />
      <span />
      <span className="flex items-center justify-end text-xs font-semibold pl-2 pr-2 text-slate-500" title="Importe calculado a partir de líneas redirigidas desde otras cuentas: no se edita aquí">
        {fmtDecimal(amount)}
      </span>
      {columnsConfig.showComment && <span />}
      {columnsConfig.showTags && <span />}
      <span />
    </div>
  );
}

// ─── Sidebar único: ajustes de columnas de la tabla arriba, y (si hay una
// línea elegida) sus Cargas sociales + Sumar en debajo — un solo panel, no
// un popover para uno y un cajón aparte para lo otro. ──────────────────────
// Campos fijos de una línea de Detalle, siempre visibles (no hay forma de
// ocultarlos sin romper la tabla): se listan igualmente en "Ajustes del
// detalle" — con un candado en vez de un interruptor — para que de un
// vistazo se vea el juego completo de campos, fijos y opcionales juntos.
const FIXED_DETAIL_FIELDS = [
  { key: "code", label: "Código", icon: Hash },
  { key: "description", label: "Descripción", icon: AlignLeft },
  { key: "units", label: "Cantidad", icon: Ruler },
  { key: "unit", label: "Unidad", icon: Box },
  { key: "multiplier", label: "Multiplicador (X)", icon: Asterisk },
  { key: "rate", label: "Tarifa", icon: DollarSign },
  { key: "total", label: "Total", icon: Equal },
] as const;

/** Fila de "Ajustes del detalle": un campo opcional con su icono, nombre y el ojo que lo muestra/oculta. */
function OptionalFieldRow({ icon: Icon, label, visible, onToggle }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; visible: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors">
      <Icon size={13} className={visible ? "text-[#E86F4A] flex-shrink-0" : "text-slate-300 flex-shrink-0"} />
      <span className={`text-xs flex-1 text-left ${visible ? "text-slate-900 font-medium" : "text-slate-400"}`}>{label}</span>
      {visible ? <Eye size={13} className="text-[#E86F4A] flex-shrink-0" /> : <EyeOff size={13} className="text-slate-300 flex-shrink-0" />}
    </button>
  );
}

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
          {/* Columnas de la tabla: todos los campos de una línea, fijos y
              opcionales, en una sola lista tipo "gestor de campos". */}
          <div className="px-5 py-4 border-b border-slate-100 space-y-4">
            <p className="text-xs font-medium text-slate-700">Columnas</p>

            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Campos fijos</p>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {FIXED_DETAIL_FIELDS.map((f) => (
                  <div key={f.key} className="flex items-center gap-2.5 px-3 py-2">
                    <f.icon size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-700 flex-1">{f.label}</span>
                    <span title="Siempre visible" className="flex-shrink-0"><Lock size={11} className="text-slate-300" /></span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Campos opcionales</p>
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                <OptionalFieldRow icon={MessageSquare} label="Comentario" visible={columnsConfig.showComment} onToggle={() => onChangeColumns({ showComment: !columnsConfig.showComment })} />
                <OptionalFieldRow icon={Tag} label="Etiquetas" visible={columnsConfig.showTags} onToggle={() => onChangeColumns({ showTags: !columnsConfig.showTags })} />
                <OptionalFieldRow icon={Percent} label="Cargas sociales" visible={showFringes} onToggle={() => onToggleShowFringes(!showFringes)} />
              </div>
            </div>

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
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-colors ${checked ? "border-[#E86F4A] bg-[#E86F4A]/[0.06]" : "border-slate-200 hover:border-slate-300"}`}
                        >
                          <span className="text-xs text-slate-700 truncate">{f.label}</span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            {checked && amount != null && <span className="text-xs font-medium text-slate-600">{fmtDecimal(amount)}</span>}
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${checked ? "border-[#E86F4A]" : "border-slate-300"}`} style={{ background: checked ? "#E86F4A" : "transparent" }}>
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
                      style={{ color: "#E86F4A" }}
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
                      placeholder="Buscar cuenta destino"
                      className="w-full text-xs px-2.5 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-[#E86F4A] mb-2"
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

/**
 * Qué enseñar en un campo Cantidad/X/Tarifa: si se está editando ese campo
 * ahora mismo, el texto tal cual (fórmula o código de Global incluido, para
 * poder seguir tocándolo); si no, y es un número suelto, el número tal cual;
 * si no, y es una fórmula/Global, el valor ya resuelto — nunca el ID del
 * Global ni la fórmula en crudo fuera de edición.
 */
function displayFieldValue(raw: string, key: "units" | "multiplier" | "rate", focusedField: "units" | "multiplier" | "rate" | "unit" | null, globalValues: Record<string, number>): string {
  if (focusedField === key) return raw;
  if (isPlainNumber(raw)) return raw;
  const evaluated = evaluateFieldExpr(raw, globalValues);
  return evaluated.error ? raw : fmtDecimal(evaluated.value);
}

// ─── Fila de campos, estilo Excel: sin caja, sin placeholder, guarda sola al
// perder el foco (sin botón de confirmar). Componente de módulo estable: no
// se redefine entre renders, así los inputs no pierden el foco al escribir. ──
function LineFieldsGrid({
  fields, displayValues, onChange, onFocusField, onBlurAny, onEscape, globals, units, totalPreview, muted, template, showComment, showTags, autoFocus, indicators, actions, onDragStart, onDragEnd, onCreateTextAfter, onCreateSubtotalAfter,
}: {
  fields: LineFields; displayValues: { units: string; multiplier: string; rate: string; unit: string };
  onChange: (patch: Partial<LineFields>) => void; onFocusField: (key: "units" | "multiplier" | "rate" | "unit") => void; onBlurAny: () => void;
  onEscape: () => void; globals: { code: string; label: string }[]; units: { id: string; singular: string }[];
  totalPreview: number; muted: boolean; template: string; showComment: boolean; showTags: boolean; autoFocus?: boolean;
  indicators?: React.ReactNode; actions?: React.ReactNode;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
  onCreateTextAfter: () => void; onCreateSubtotalAfter: () => void;
}) {
  const descWrapRef = useRef<HTMLDivElement>(null);
  const { isCommand, matches } = useSlashCommands(fields.description);
  const runSlashCommand = (cmd: string) => {
    onChange({ description: "" });
    if (cmd === "texto") onCreateTextAfter();
    else if (cmd === "subtotal") onCreateSubtotalAfter();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Mover el foco a la fila de abajo ya dispara el guardado solo (blur
      // -> onBlurAny -> onCommit); si no hay fila siguiente, se guarda igual
      // quitando el foco a mano, como antes.
      e.preventDefault();
      if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusBudgetingRowField(e.currentTarget, "down");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusBudgetingRowField(e.currentTarget, "up");
    } else if (e.key === "Escape") {
      onEscape();
    }
  };
  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && isCommand && matches.length > 0) { e.preventDefault(); runSlashCommand(matches[0].cmd); return; }
    // Escape con "/" a medio escribir: mismo revert completo que un Escape
    // normal (onEscape ya deshace todos los campos, no solo la descripción),
    // así una descripción real que ya hubiera antes de escribir "/" no se
    // pierde por el camino.
    handleKeyDown(e);
  };
  // Con "/" a medio escribir no se guarda eso como descripción al perder el
  // foco: o se elige un comando de la lista, o se borra la "/" (igual que en
  // BudgetingPhantomRow/PhantomLineRow).
  const handleDescriptionBlur = () => {
    if (isCommand) { onEscape(); return; }
    onBlurAny();
  };
  return (
    <div className="grid gap-0 divide-x divide-slate-200 px-4" style={{ gridTemplateColumns: template }}>
      <BudgetingDragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <input autoFocus={autoFocus} value={fields.code} onChange={(e) => onChange({ code: e.target.value })} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs`} />
      <div ref={descWrapRef} className="relative h-full">
        <input value={fields.description} onChange={(e) => onChange({ description: e.target.value })} onBlur={handleDescriptionBlur} onKeyDown={handleDescriptionKeyDown}
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
      <BudgetingFormulaInput value={displayValues.units} onChange={(v) => onChange({ units: v })} onFocus={() => onFocusField("units")} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-xs text-right pl-2`} />
      <BudgetingUnitInput value={displayValues.unit} onChange={(v) => onChange({ unit: v })} onFocus={() => onFocusField("unit")} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        units={units} className={`${CELL_INPUT} text-[11px] pl-2`} />
      <BudgetingFormulaInput value={displayValues.multiplier} onChange={(v) => onChange({ multiplier: v })} onFocus={() => onFocusField("multiplier")} onBlur={onBlurAny} onKeyDown={handleKeyDown}
        globals={globals} title="Número o fórmula con Globales" className={`${CELL_INPUT} text-[11px] text-right pl-2`} />
      <BudgetingFormulaInput value={displayValues.rate} onChange={(v) => onChange({ rate: v })} onFocus={() => onFocusField("rate")} onBlur={onBlurAny} onKeyDown={handleKeyDown}
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
  line, fringes, globals, globalValues, units, columnsConfig, template, autoFocus, error, sidebarOpen, selected, dragOver,
  onCommit, onDuplicate, onDelete, onOpenSidebar, onContextMenu, onRowMouseDown, onDragStart, onDragOverRow, onDrop, onDragEnd, onCreateTextAfter, onCreateSubtotalAfter,
}: {
  line: BudgetingDetailLine; fringes: BudgetingFringe[];
  globals: { code: string; label: string }[]; globalValues: Record<string, number>; units: BudgetingUnit[];
  columnsConfig: BudgetingDetailColumnsConfig; template: string; autoFocus?: boolean; error?: string; sidebarOpen: boolean; selected?: boolean;
  dragOver: "before" | "after" | null;
  onCommit: (fields: LineFields) => void; onDuplicate: () => void; onDelete: () => void; onOpenSidebar: () => void;
  onContextMenu: (e: React.MouseEvent) => void; onRowMouseDown: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void; onDragOverRow: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
  onCreateTextAfter: () => void; onCreateSubtotalAfter: () => void;
}) {
  const [fields, setFields] = useState<LineFields>(() => toFields(line));
  // Mientras se edita un campo con fórmula/Global, se ve y se toca el texto
  // tal cual se escribió; en cuanto se sale de ahí, se enseña el número
  // resuelto (no el ID del Global ni la fórmula en crudo) — igual que una
  // celda de hoja de cálculo. La Unidad sigue el mismo patrón: en edición,
  // el singular tal cual se escribió; fuera de edición, en plural si la
  // Cantidad de la línea es más de 1 (ver pluralizeUnit).
  const [focusedField, setFocusedField] = useState<"units" | "multiplier" | "rate" | "unit" | null>(null);
  const currentUnitsQty = evaluateFieldExpr(fields.units, globalValues).value;
  const displayValues = {
    units: displayFieldValue(fields.units, "units", focusedField, globalValues),
    multiplier: displayFieldValue(fields.multiplier, "multiplier", focusedField, globalValues),
    rate: displayFieldValue(fields.rate, "rate", focusedField, globalValues),
    unit: focusedField === "unit" ? fields.unit : pluralizeUnit(fields.unit, currentUnitsQty, units),
  };
  const hasFormula = !!(line.unitsExpr || line.multiplierExpr || line.rateExpr);
  const hasHiddenComment = !columnsConfig.showComment && !!line.notes;
  const hasFringesOrRoute = (line.fringeIds?.length || 0) > 0 || !!line.routedTo;
  const preview = computeLineTotal(
    evaluateFieldExpr(fields.units, globalValues).value,
    evaluateFieldExpr(fields.multiplier, globalValues).value,
    evaluateFieldExpr(fields.rate, globalValues).value
  );

  return (
    <div
      data-budget-row
      className={`group ${selected ? "bg-[#E86F4A]/[0.08]" : ""} ${dragIndicator(dragOver)}`}
      onContextMenu={onContextMenu}
      onMouseDown={onRowMouseDown}
      onDragOver={onDragOverRow}
      onDrop={onDrop}
    >
      <LineFieldsGrid
        fields={fields}
        displayValues={displayValues}
        onChange={(patch) => setFields((f) => ({ ...f, ...patch }))}
        onFocusField={setFocusedField}
        onBlurAny={() => { setFocusedField(null); onCommit(fields); }}
        onEscape={() => setFields(toFields(line))}
        globals={globals}
        units={units}
        totalPreview={preview}
        muted={!!line.routedTo}
        template={template}
        showComment={columnsConfig.showComment}
        showTags={columnsConfig.showTags}
        autoFocus={autoFocus}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onCreateTextAfter={onCreateTextAfter}
        onCreateSubtotalAfter={onCreateSubtotalAfter}
        indicators={
          (hasFormula || hasHiddenComment) && (
            <span className="flex items-center gap-1">
              {hasFormula && <span title="Contiene fórmula"><Sigma size={10} className="text-[#E86F4A]" /></span>}
              {hasHiddenComment && <span title={line.notes} className="text-[10px]">💬</span>}
            </span>
          )
        }
        actions={
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onOpenSidebar} className={`relative p-1 rounded transition-colors ${sidebarOpen ? "text-[#E86F4A] bg-[#E86F4A]/[0.1]" : "text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1]"}`} title="Cargas sociales y Sumar en">
              <SlidersHorizontal size={11} />
              {hasFringesOrRoute && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: "#E86F4A" }} />}
            </button>
            <button onClick={onDuplicate} className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors" title="Duplicar línea">
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


// ─── Línea de solo texto (nota, sin código ni importe): la descripción ocupa
// desde ID hasta Total, dejando Comentario/Etiquetas en blanco y las
// acciones en su columna habitual, para que la fila siga alineada con las
// demás pese al ancho de columnas dinámico. ────────────────────────────────
function TextLineRow({
  line, template, columnsConfig, dragOver, subtotalValue, autoFocus, selected, onCommitTextLine, onDelete, onContextMenu, onRowMouseDown, onDragStart, onDragOverRow, onDrop, onDragEnd,
}: {
  line: BudgetingDetailLine; template: string; columnsConfig: BudgetingDetailColumnsConfig; dragOver: "before" | "after" | null; subtotalValue?: number; autoFocus?: boolean; selected?: boolean;
  onCommitTextLine: (patch: { description?: string; textBold?: boolean; textColor?: string }) => void;
  onDelete: () => void; onContextMenu: (e: React.MouseEvent) => void; onRowMouseDown: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void; onDragOverRow: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void; onDragEnd: () => void;
}) {
  const isSubtotal = !!line.isSubtotal;
  const [description, setDescription] = useState(line.description);
  const commit = () => {
    if (!description.trim()) { setDescription(line.description); return; }
    if (description.trim() !== line.description) onCommitTextLine({ description: description.trim() });
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (!focusBudgetingRowField(e.currentTarget, "down")) e.currentTarget.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "down"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusBudgetingRowField(e.currentTarget, "up"); }
    else if (e.key === "Escape") setDescription(line.description);
  };
  let actionsCol = 9;
  if (columnsConfig.showComment) actionsCol++;
  if (columnsConfig.showTags) actionsCol++;

  return (
    <div
      data-budget-row
      className={`grid gap-0 divide-x divide-slate-200 px-4 group ${selected ? "bg-[#E86F4A]/[0.08]" : ""} ${dragIndicator(dragOver)}`}
      style={{ gridTemplateColumns: template }}
      onContextMenu={onContextMenu}
      onMouseDown={onRowMouseDown}
      onDragOver={onDragOverRow}
      onDrop={onDrop}
    >
      <BudgetingDragHandle onDragStart={onDragStart} onDragEnd={onDragEnd} />
      <input
        autoFocus={autoFocus}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder={isSubtotal ? "Subtotal" : "Texto"}
        style={{ gridColumn: isSubtotal ? "2 / 8" : "2 / 9", color: line.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: line.textBold ? 700 : 400 }}
        className={`${CELL_INPUT} text-xs`}
      />
      {isSubtotal && (
        <span
          className="flex items-center justify-end text-xs pl-2 pr-2"
          style={{ gridColumn: "8 / 9", color: line.textColor || DEFAULT_TEXT_LINE_COLOR, fontWeight: line.textBold ? 700 : 400 }}
        >
          {fmtDecimal(subtotalValue || 0)}
        </span>
      )}
      <span
        className="flex items-center justify-end gap-1 pl-2 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ gridColumn: `${actionsCol} / ${actionsCol + 1}` }}
      >
        <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
          <Trash2 size={11} />
        </button>
      </span>
    </div>
  );
}

export default function BudgetingSubchapterPage() {
  const { draftId, accountId, subchapterId } = useParams() as { draftId: string; accountId: string; subchapterId: string };
  const router = useRouter();
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
  // Array siempre (aunque sea de una sola línea), para poder borrar toda la
  // selección múltiple de una vez, igual que copiar/cortar.
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDetailLine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [lineMenu, setLineMenu] = useState<BudgetingRowContextMenuState | null>(null);
  // Selección múltiple de líneas (para copiar/cortar/pegar varias a la vez):
  // shift = rango desde la última tocada, cmd/ctrl = suelta una a una, igual
  // que en Finder/Sheets.
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);

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

  // Las líneas de texto (sin importe) no son cuentas de verdad: no aparecen como destino de "Sumar en"
  // ni en el navegador de cuentas de la cabecera. Mismo orden que en Capítulo/Top Sheet.
  const allSubchapters: RouteTarget[] = sortByOrder(chapters).flatMap((c) =>
    sortByOrder((subchaptersByChapter[c.id] || []).filter((sub) => !sub.isTextLine && !sub.isSubtotal)).map((sub) => ({ chapterId: c.id, chapterCode: c.code, chapterDescription: c.description, sub }))
  );
  const accountNavIndex = allSubchapters.findIndex((o) => o.sub.id === subchapterId);
  const goToAccount = (target: RouteTarget) => router.push(`/budgeting/${draftId}/accounts/${target.chapterId}/subchapters/${target.sub.id}`);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const fringes = draft?.fringes || [];
  const fringeFolders: BudgetingFolder[] = draft?.fringeFolders || [];
  const units: BudgetingUnit[] = draft?.units ?? DEFAULT_UNITS;
  const globals = draft?.globals || [];
  const globalOptions = useMemo(() => globals.map((g) => ({ code: g.code, label: g.label })), [globals]);
  const globalResolution = useMemo(() => resolveGlobals(globals), [JSON.stringify(globals)]);
  const columnsConfig = draft?.detailColumnsConfig || DEFAULT_DETAIL_COLUMNS_CONFIG;
  const template = colTemplate(columnsConfig);
  const fringeVisibility: BudgetingFringeVisibility = draft?.fringeVisibility || DEFAULT_FRINGE_VISIBILITY;

  const fringeExtras = computeFringeExtras(lines, fringes);
  const total = subchapter ? Math.round((subchapterTotal(subchapter, lines) + fringeExtras.subchapterScoped) * 100) / 100 : 0;

  // Cargas sociales con alcance de este subcapítulo: agrupadas por carpeta en
  // una sola línea de presupuesto (ver groupFringeSumsByFolder) si el toggle
  // "Mostrar cargas sociales" está activado; las que no tienen carpeta
  // siguen apareciendo cada una con su propio código.
  const subchapterFringeBreakdown = (() => {
    const sums = new Map<string, number>();
    for (const line of lines) {
      for (const { fringe, amount } of lineFringeBreakdown(line, fringes)) {
        if (fringe.scope !== "subchapter") continue;
        sums.set(fringe.id, (sums.get(fringe.id) || 0) + amount);
      }
    }
    return groupFringeSumsByFolder(sums, fringes, fringeFolders);
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

  // El código y el nombre de una fila de fringes se editan desde su propia
  // línea aquí: si la fila es una carpeta (varios fringes fundidos), edita
  // esa carpeta; si es un fringe sin carpeta, edita ese fringe. El importe
  // de la fila no se toca, sale calculado.
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

  // Código/descripción de la fila que representa `receivedTotal` (ver ReceivedTotalRow).
  const handleCommitReceived = async (code: string, label: string) => {
    if (!subchapter) return;
    if (code === (subchapter.receivedCode || "") && label === (subchapter.receivedLabel || DEFAULT_RECEIVED_LABEL)) return;
    await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters`, subchapterId), { receivedCode: code, receivedLabel: label });
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

  // ── Línea de texto / subtotal (mismo doc de Detalle, marcado con
  // isTextLine/isSubtotal, para poder intercalarlas entre líneas reales). Se
  // insertan justo debajo de la fila donde se abrió el menú contextual. ──
  const handleInsertLine = async (afterId: string | null, kind: "item" | "text" | "subtotal") => {
    const sorted = sortByOrder(lines);
    const order = orderAfter(sorted, afterId);
    const base: Record<string, unknown> = {
      code: "", description: "", units: 0, unit: "", multiplier: 1, rate: 0, total: 0,
      notes: "", tags: [], fringeIds: [], routedTo: null, order, createdAt: Timestamp.now(),
    };
    if (kind === "text") Object.assign(base, { isTextLine: true, textBold: false, textColor: DEFAULT_TEXT_LINE_COLOR });
    if (kind === "subtotal") Object.assign(base, { description: "Subtotal", isSubtotal: true, textBold: true, textColor: DEFAULT_TEXT_LINE_COLOR });
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), base);
    await touchDraft();
    setJustAddedId(ref.id);
  };
  /** Primera línea de un Detalle vacío: se crea de verdad en cuanto se escribe algo, no antes (ver PhantomLineRow). */
  const handleCreateLineFromPhantom = async (code: string, description: string) => {
    const ref = await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`), {
      code, description, units: 0, unit: "", multiplier: 1, rate: 0, total: 0,
      notes: "", tags: [], fringeIds: [], routedTo: null, order: orderAfter([], null), createdAt: Timestamp.now(),
    });
    await touchDraft();
    setJustAddedId(ref.id);
  };
  const handleCommitTextLine = async (line: BudgetingDetailLine, patch: { description?: string; textBold?: boolean; textColor?: string }) => {
    await updateDoc(lineRef(line.id), patch);
    await touchDraft();
  };
  /** Suma de las líneas normales desde el subtotal anterior (o el principio) hasta `subtotalId`. */
  const lineSubtotalValue = (subtotalId: string): number => {
    const sorted = sortByOrder(lines);
    const idx = sorted.findIndex((l) => l.id === subtotalId);
    if (idx < 0) return 0;
    let sum = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const l = sorted[i];
      if (l.isSubtotal) break;
      if (!l.isTextLine) sum += l.total || 0;
    }
    return Math.round(sum * 100) / 100;
  };

  const lineDrag = useRowDrag();
  const handleReorderLine = async (lineId: string, afterId: string | null) => {
    const siblings = sortByOrder(lines.filter((l) => l.id !== lineId));
    const order = orderAfter(siblings, afterId);
    await updateDoc(lineRef(lineId), { order });
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

  // ── Copiar/cortar/pegar una o varias líneas enteras (código, cantidades,
  // notas, etiquetas, fringes, redirección...) desde el menú de clic derecho
  // o con Cmd/Ctrl+C/X/V sobre la selección múltiple. Portapapeles en
  // sessionStorage como un array (aunque sea de una sola línea): sobrevive a
  // navegar a otra Cuenta, así se puede copiar aquí y pegar en el
  // subcapítulo de al lado. ──────────────────────────────────────────────
  const lineToClipboardData = (line: BudgetingDetailLine): LineClipboardData => ({
    code: line.code, description: line.description, units: line.units, unitsExpr: line.unitsExpr ?? null, unit: line.unit || "",
    multiplier: line.multiplier, multiplierExpr: line.multiplierExpr ?? null, rate: line.rate, rateExpr: line.rateExpr ?? null, total: line.total,
    notes: line.notes || "", tags: line.tags || [], fringeIds: line.fringeIds || [], routedTo: line.routedTo || null,
    isTextLine: line.isTextLine || false, isSubtotal: line.isSubtotal || false, textBold: line.textBold || false, textColor: line.textColor || null,
  });

  const handleCopyLines = (linesToCopy: BudgetingDetailLine[]) => {
    if (linesToCopy.length === 0) return;
    setBudgetingClipboard<LineClipboardData[]>({ kind: "line", mode: "copy", data: linesToCopy.map(lineToClipboardData) });
  };

  const handleCutLines = async (linesToCut: BudgetingDetailLine[]) => {
    if (linesToCut.length === 0) return;
    setBudgetingClipboard<LineClipboardData[]>({ kind: "line", mode: "cut", data: linesToCut.map(lineToClipboardData) });
    setSaving(true);
    try {
      const batch = writeBatch(db);
      // Varias líneas cortadas pueden redirigir ("Sumar en") a la misma
      // Cuenta destino: se agregan los decrementos por destino para no
      // escribir dos veces sobre el mismo documento en el mismo batch.
      const decrements = new Map<string, number>();
      for (const line of linesToCut) {
        batch.delete(lineRef(line.id));
        if (line.routedTo) {
          const key = `${line.routedTo.chapterId}/${line.routedTo.subchapterId}`;
          decrements.set(key, (decrements.get(key) || 0) + (line.total || 0));
        }
      }
      for (const [key, amount] of decrements) {
        const [chapterId, subId] = key.split("/");
        batch.update(doc(db, `budgetingDrafts/${draftId}/accounts/${chapterId}/subchapters`, subId), { receivedTotal: increment(-amount) });
      }
      await batch.commit();
      await touchDraft();
      setSelectedLineIds(new Set());
    } finally {
      setSaving(false);
    }
  };

  /** Pega todas las líneas del portapapeles, en orden, justo debajo de `afterId` (o al principio si es null), igual que "Insertar línea". */
  const handlePasteLines = async (afterId: string | null) => {
    const clip = getBudgetingClipboard<LineClipboardData[]>("line");
    if (!clip || clip.data.length === 0) return;
    setSaving(true);
    try {
      // Cursor local con solo lo que orderAfter necesita: se va actualizando
      // según se pega cada línea, para que la siguiente se encadene justo
      // detrás sin esperar a que Firestore refresque `lines`.
      const cursor: { id: string; order?: number; createdAt?: Timestamp | null }[] =
        sortByOrder(lines).map((l) => ({ id: l.id, order: l.order, createdAt: l.createdAt }));
      const usedCodes = new Set(lines.map((l) => l.code.trim().toLowerCase()).filter(Boolean));
      const routedIncrements = new Map<string, number>();
      let anchorId = afterId;
      let firstNewId: string | null = null;
      for (const src of clip.data) {
        // El código solo se toca si ya está en uso (por una línea existente
        // o por otra recién pegada en esta misma pasada).
        let code = (src.code || "").trim();
        if (code && usedCodes.has(code.toLowerCase())) {
          let candidate = `${code}-copia`;
          let n = 2;
          while (usedCodes.has(candidate.toLowerCase())) { candidate = `${code}-copia${n}`; n++; }
          code = candidate;
        }
        if (code) usedCodes.add(code.toLowerCase());
        const order = orderAfter(cursor, anchorId);
        const newRef = doc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/subchapters/${subchapterId}/detailLines`));
        const payload = {
          code, description: src.description, units: src.units, unitsExpr: src.unitsExpr, unit: src.unit,
          multiplier: src.multiplier, multiplierExpr: src.multiplierExpr, rate: src.rate, rateExpr: src.rateExpr, total: src.total,
          notes: src.notes, tags: src.tags, fringeIds: src.fringeIds, routedTo: src.routedTo,
          isTextLine: src.isTextLine, isSubtotal: src.isSubtotal, textBold: src.textBold, textColor: src.textColor,
          order, createdAt: Timestamp.now(),
        };
        await setDoc(newRef, payload);
        if (src.routedTo) {
          const key = `${src.routedTo.chapterId}/${src.routedTo.subchapterId}`;
          routedIncrements.set(key, (routedIncrements.get(key) || 0) + (src.total || 0));
        }
        cursor.splice(cursor.findIndex((c) => c.id === anchorId) + 1, 0, { id: newRef.id, order });
        anchorId = newRef.id;
        if (!firstNewId) firstNewId = newRef.id;
      }
      if (routedIncrements.size > 0) {
        const batch = writeBatch(db);
        for (const [key, amount] of routedIncrements) {
          const [chapterId, subId] = key.split("/");
          batch.update(doc(db, `budgetingDrafts/${draftId}/accounts/${chapterId}/subchapters`, subId), { receivedTotal: increment(amount) });
        }
        await batch.commit();
      }
      await touchDraft();
      if (firstNewId) setJustAddedId(firstNewId);
      setSelectedLineIds(new Set());
      if (clip.mode === "cut") clearBudgetingClipboard();
    } finally {
      setSaving(false);
    }
  };

  // ── Selección múltiple sobre las filas visibles (`visible`, ya ordenadas
  // y filtradas por el buscador): shift extiende el rango desde la última
  // ancla, cmd/ctrl suelta una a una, un clic normal la limpia (sin robarle
  // el foco a la celda que se está editando). preventDefault en el
  // mousedown es lo que evita que el clic con modificador enfoque el input
  // de la fila en vez de seleccionarla. ──────────────────────────────────
  const handleRowMouseDown = (line: BudgetingDetailLine, visible: BudgetingDetailLine[], e: React.MouseEvent) => {
    // Solo el botón izquierdo: el derecho también dispara mousedown antes del
    // contextmenu, y si no se ignora aquí, el clic derecho para copiar/cortar
    // varias líneas las deseleccionaba justo antes de abrir el menú.
    if (e.button !== 0) return;
    if (e.shiftKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      const anchorId = selectionAnchorId || line.id;
      const anchorIdx = visible.findIndex((l) => l.id === anchorId);
      const clickedIdx = visible.findIndex((l) => l.id === line.id);
      if (anchorIdx < 0 || clickedIdx < 0) { setSelectedLineIds(new Set([line.id])); setSelectionAnchorId(line.id); return; }
      const [from, to] = anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
      setSelectedLineIds(new Set(visible.slice(from, to + 1).map((l) => l.id)));
    } else if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setSelectedLineIds((prev) => {
        const next = new Set(prev);
        if (next.has(line.id)) next.delete(line.id); else next.add(line.id);
        return next;
      });
      setSelectionAnchorId(line.id);
    } else {
      // Clic normal: no roba el foco (no preventDefault, se puede seguir
      // editando la celda con normalidad), pero recuerda esta fila como
      // referencia para un Shift+clic posterior — así "de la primera a la
      // última" funciona empezando con un clic normal en la primera, sin
      // tener que mantener pulsado Shift también en ese primer clic.
      setSelectionAnchorId(line.id);
      if (selectedLineIds.size > 0) setSelectedLineIds(new Set());
    }
  };

  // ── Cmd/Ctrl+C/X/V sobre la selección múltiple, igual que en Finder/Sheets.
  // Se ignora por completo si el foco está en un input/textarea (para no
  // robarle el copiar/pegar de texto normal), y Copiar/Cortar solo actúan si
  // hay algo seleccionado; Pegar funciona igual con o sin selección activa.
  useEffect(() => {
    const isEditable = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedLineIds.size > 0 && !isEditable(document.activeElement)) {
        setSelectedLineIds(new Set());
        setSelectionAnchorId(null);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      const sortedNow = sortByOrder(lines);
      if (key === "c" && selectedLineIds.size > 0) {
        e.preventDefault();
        handleCopyLines(sortedNow.filter((l) => selectedLineIds.has(l.id)));
      } else if (key === "x" && selectedLineIds.size > 0) {
        e.preventDefault();
        handleCutLines(sortedNow.filter((l) => selectedLineIds.has(l.id)));
      } else if (key === "v") {
        const clip = getBudgetingClipboard<LineClipboardData[]>("line");
        if (!clip) return;
        e.preventDefault();
        const selectedVisible = sortedNow.filter((l) => selectedLineIds.has(l.id));
        const anchorId = selectedVisible.length > 0 ? selectedVisible[selectedVisible.length - 1].id : (sortedNow.length > 0 ? sortedNow[sortedNow.length - 1].id : null);
        handlePasteLines(anchorId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineIds, lines]);

  const handleDeleteLine = async () => {
    if (!deleteTarget || deleteTarget.length === 0) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      // Varias líneas seleccionadas pueden redirigir al mismo subcapítulo: se
      // acumula el decremento por destino para no tocar el mismo doc dos
      // veces dentro de un mismo batch (Firestore no lo permite).
      const decrements = new Map<string, number>();
      for (const target of deleteTarget) {
        batch.delete(lineRef(target.id));
        if (target.routedTo) {
          const key = `${target.routedTo.chapterId}/${target.routedTo.subchapterId}`;
          decrements.set(key, (decrements.get(key) || 0) + (target.total || 0));
        }
      }
      for (const [key, amount] of decrements) {
        const [chapterId, subchapterId] = key.split("/");
        const targetRef = doc(db, `budgetingDrafts/${draftId}/accounts/${chapterId}/subchapters`, subchapterId);
        batch.update(targetRef, { receivedTotal: increment(-amount) });
      }
      await batch.commit();
      await touchDraft();
      setDeleteTarget(null);
      setSelectedLineIds(new Set());
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
      {/* Breadcrumb: solo navegación de entrar/volver, sin categorías ni desplegables. A la
          derecha, un navegador para saltar directamente a otra Cuenta del presupuesto. */}
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Link href={`/budgeting/${draftId}`} className="text-xs text-slate-400 hover:text-[#E86F4A] transition-colors">{draft?.name}</Link>
          <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
          <Link href={`/budgeting/${draftId}/accounts/${accountId}`} className="text-xs font-medium text-slate-600 hover:text-[#E86F4A] transition-colors">{chapter.code} {chapter.description}</Link>
          <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />
          <span className="text-xs font-semibold text-slate-900">{subchapter.code} {subchapter.description}</span>
        </div>

        {allSubchapters.length > 1 && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => accountNavIndex > 0 && goToAccount(allSubchapters[accountNavIndex - 1])}
              disabled={accountNavIndex <= 0}
              className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="Cuenta anterior"
            >
              <ChevronLeft size={13} />
            </button>
            <select
              value={subchapterId}
              onChange={(e) => {
                const target = allSubchapters.find((o) => o.sub.id === e.target.value);
                if (target) goToAccount(target);
              }}
              className="max-w-[220px] text-xs text-slate-600 border border-slate-200 rounded-lg pl-2 pr-1 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300 bg-white"
              title="Ir a otra cuenta del presupuesto"
            >
              {allSubchapters.map((o) => (
                <option key={o.sub.id} value={o.sub.id}>{o.chapterCode} · {o.sub.code} {o.sub.description}</option>
              ))}
            </select>
            <button
              onClick={() => accountNavIndex >= 0 && accountNavIndex < allSubchapters.length - 1 && goToAccount(allSubchapters[accountNavIndex + 1])}
              disabled={accountNavIndex < 0 || accountNavIndex >= allSubchapters.length - 1}
              className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors disabled:opacity-20 disabled:pointer-events-none"
              title="Cuenta siguiente"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
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
          <button onClick={() => openSidebar(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors" title="Ajustes del detalle">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      {/* Detail lines */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid gap-0 divide-x divide-slate-200 px-4 border-b border-slate-200 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50/60" style={{ gridTemplateColumns: template }}>
            <span />
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
                className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors normal-case"
                title="Mostrar/ocultar columnas"
              >
                <MoreVertical size={13} />
              </button>
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {(() => {
              const sorted = sortByOrder(lines.filter(matchesSearch));
              const canPaste = !!getBudgetingClipboard<LineClipboardData[]>("line");
              // Clic derecho sobre una fila que ya forma parte de la
              // selección actúa sobre toda la selección; sobre una fila
              // suelta, actúa solo sobre esa (igual que Finder/Sheets).
              const openLineMenu = (line: BudgetingDetailLine, e: React.MouseEvent) => {
                e.preventDefault();
                const targetLines = selectedLineIds.has(line.id) && selectedLineIds.size > 1
                  ? sorted.filter((l) => selectedLineIds.has(l.id))
                  : [line];
                setLineMenu({
                  x: e.clientX, y: e.clientY, rowId: line.id,
                  style: (targetLines.length === 1 && (line.isTextLine || line.isSubtotal)) ? {
                    bold: !!line.textBold, color: line.textColor || DEFAULT_TEXT_LINE_COLOR,
                    onChangeBold: (v) => handleCommitTextLine(line, { textBold: v }),
                    onChangeColor: (c) => handleCommitTextLine(line, { textColor: c }),
                  } : undefined,
                  onDelete: () => setDeleteTarget(targetLines),
                  onCopy: () => handleCopyLines(targetLines),
                  onCut: () => handleCutLines(targetLines),
                  onPaste: canPaste ? () => handlePasteLines(line.id) : undefined,
                });
              };
              // El icono de papelera de una fila: si esa fila forma parte de
              // la selección múltiple activa, borra toda la selección; si
              // no, solo esa fila (igual que el menú contextual).
              const deleteTargetsFor = (ln: BudgetingDetailLine): BudgetingDetailLine[] =>
                selectedLineIds.has(ln.id) && selectedLineIds.size > 1
                  ? sorted.filter((l) => selectedLineIds.has(l.id))
                  : [ln];
              if (sorted.length === 0) {
                return !q ? (
                  <PhantomLineRow
                    template={template}
                    columnsConfig={columnsConfig}
                    onCreate={handleCreateLineFromPhantom}
                    onCreateText={() => handleInsertLine(null, "text")}
                    onCreateSubtotal={() => handleInsertLine(null, "subtotal")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setLineMenu({ x: e.clientX, y: e.clientY, rowId: null, onPaste: canPaste ? () => handlePasteLines(null) : undefined });
                    }}
                  />
                ) : null;
              }
              return sorted.map((line, i) =>
                line.isTextLine || line.isSubtotal ? (
                  <TextLineRow
                    key={line.id}
                    line={line}
                    template={template}
                    columnsConfig={columnsConfig}
                    dragOver={lineDrag.dragOver?.id === line.id ? lineDrag.dragOver.position : null}
                    autoFocus={line.id === justAddedId}
                    selected={selectedLineIds.has(line.id)}
                    subtotalValue={line.isSubtotal ? lineSubtotalValue(line.id) : undefined}
                    onCommitTextLine={(patch) => handleCommitTextLine(line, patch)}
                    onDelete={() => setDeleteTarget(deleteTargetsFor(line))}
                    onContextMenu={(e) => openLineMenu(line, e)}
                    onRowMouseDown={(e) => handleRowMouseDown(line, sorted, e)}
                    onDragStart={lineDrag.onDragStart(line.id)}
                    onDragOverRow={lineDrag.onDragOverRow(line.id)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (lineDrag.draggedId && lineDrag.draggedId !== line.id) {
                        handleReorderLine(lineDrag.draggedId, resolveDragAfterId(sorted, lineDrag.dragOver));
                      }
                      lineDrag.reset();
                    }}
                    onDragEnd={lineDrag.reset}
                  />
                ) : (
                  <LineRow
                    key={line.id}
                    line={line}
                    fringes={fringes}
                    globals={globalOptions}
                    globalValues={globalResolution.values}
                    units={units}
                    columnsConfig={columnsConfig}
                    template={template}
                    error={rowErrors[line.id]}
                    dragOver={lineDrag.dragOver?.id === line.id ? lineDrag.dragOver.position : null}
                    autoFocus={line.id === justAddedId}
                    selected={selectedLineIds.has(line.id)}
                    sidebarOpen={sidebarOpen && sidebarLineId === line.id}
                    onCommit={(fields) => handleCommitLine(line, fields)}
                    onDuplicate={() => handleDuplicateLine(line)}
                    onDelete={() => setDeleteTarget(deleteTargetsFor(line))}
                    onCreateTextAfter={() => handleInsertLine(line.id, "text")}
                    onCreateSubtotalAfter={() => handleInsertLine(line.id, "subtotal")}
                    onOpenSidebar={() => openSidebar(line.id)}
                    onContextMenu={(e) => openLineMenu(line, e)}
                    onRowMouseDown={(e) => handleRowMouseDown(line, sorted, e)}
                    onDragStart={lineDrag.onDragStart(line.id)}
                    onDragOverRow={lineDrag.onDragOverRow(line.id)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (lineDrag.draggedId && lineDrag.draggedId !== line.id) {
                        handleReorderLine(lineDrag.draggedId, resolveDragAfterId(sorted, lineDrag.dragOver));
                      }
                      lineDrag.reset();
                    }}
                    onDragEnd={lineDrag.reset}
                  />
                )
              );
            })()}
          </div>

          {fringeVisibility.detail && subchapterFringeBreakdown.length > 0 && (
            <div className="border-t border-slate-100">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Cargas sociales de este subcapítulo</p>
              <div className="divide-y divide-slate-100">
                {subchapterFringeBreakdown.map((row) => (
                  <SubchapterFringeRow
                    key={row.target.type === "folder" ? `folder:${row.target.folderId}` : `fringe:${row.target.fringeId}`}
                    code={row.code}
                    label={row.label}
                    amount={row.amount}
                    target={row.target}
                    draftId={draftId}
                    template={template}
                    columnsConfig={columnsConfig}
                    onCommit={handleCommitFringeGroup}
                  />
                ))}
              </div>
            </div>
          )}

          {(subchapter.receivedTotal || 0) > 0 && (
            <div className="border-t border-slate-100">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-4 pt-2 pb-1">Redirigido desde otras cuentas</p>
              <div className="divide-y divide-slate-100">
                <ReceivedTotalRow
                  code={subchapter.receivedCode || ""}
                  label={subchapter.receivedLabel || DEFAULT_RECEIVED_LABEL}
                  amount={subchapter.receivedTotal || 0}
                  template={template}
                  columnsConfig={columnsConfig}
                  onCommit={handleCommitReceived}
                />
              </div>
            </div>
          )}

          {(fringeExtras.subchapterScoped > 0 || fringeExtras.chapterScoped > 0 || fringeExtras.totalScoped > 0) && (
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

      {lineMenu && (
        <BudgetingRowContextMenu
          state={lineMenu}
          onClose={() => setLineMenu(null)}
          onInsertLine={() => handleInsertLine(lineMenu.rowId, "item")}
          onInsertText={() => handleInsertLine(lineMenu.rowId, "text")}
          onInsertSubtotal={() => handleInsertLine(lineMenu.rowId, "subtotal")}
        />
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
              {deleteTarget.length === 1 ? `Borrar línea "${deleteTarget[0].description}"` : `Borrar ${deleteTarget.length} líneas seleccionadas`}
            </h3>
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
