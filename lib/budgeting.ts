// ─────────────────────────────────────────────────────────────────────────────
// Budgeting: entorno independiente de proyecto para presupuestar una
// película/serie de cero (inspirado en Movie Magic Budgeting / Saturation).
// No cuelga de ningún proyecto: vive en `budgetingDrafts/{draftId}`, con un
// índice por usuario en `userBudgetingDrafts/{uid}/drafts/{draftId}` para
// listar rápido en el sidebar. Un borrador terminado se "envía" a un
// proyecto, que rellena su Accounting > Budget (ver accounting/budget/page.tsx
// para el modelo Account → SubAccount que se replica ahí).
//
// Jerarquía (de fuera a dentro): Categoría (apartado, opcional) → Capítulo →
// Cuenta (BudgetingSubchapter en el código) → Detalle. Al enviar a un
// proyecto, Capítulo pasa a ser la Account de Accounting y Cuenta su
// SubAccount, con el importe presupuestado sumado de sus líneas de detalle;
// el Detalle no se envía como entidad propia, solo cuenta para esa suma.
// ─────────────────────────────────────────────────────────────────────────────

import { Timestamp } from "firebase/firestore";
import type { FwbFile } from "./budgetingExport";

export const BUDGETING_ACCENT = "#8DA7BE";
export const BUDGETING_TEXT = "#1D201F";
/** Fondo tenue del acento, para chips/tints; nada de rellenos sólidos por defecto. */
export const BUDGETING_TINT = `${BUDGETING_ACCENT}1a`;

// ─── Categorías (apartado) ──────────────────────────────────────────────────
// Clásicas de presupuesto de estudio (Above/Below the line) por defecto, pero
// configurables por borrador: se pueden renombrar, añadir, quitar, o
// desactivar del todo (draft.categoriesEnabled = false → lista plana).

export interface BudgetingCategoryDef {
  id: string;
  code?: string;
  label: string;
}

export const DEFAULT_CATEGORIES: BudgetingCategoryDef[] = [
  { id: "atl", code: "ATL", label: "Above The Line" },
  { id: "btl_production", code: "BTL-P", label: "Below The Line · Producción" },
  { id: "btl_post", code: "BTL-Q", label: "Below The Line · Postproducción" },
  { id: "other", code: "OVH", label: "Otros / Overhead" },
];

/** Carpeta simple (sin anidar) para organizar Globales o Seguridad Social en su página de ajustes. */
export interface BudgetingFolder {
  id: string;
  label: string;
}

/**
 * Global: valor reutilizable en todo el borrador, identificado por `code`.
 * `value` es un número o una fórmula que puede referenciar el código de
 * otros globales (p.ej. "120 * DIAS_RODAJE + DIETA"), resuelta con
 * `resolveGlobals()`. `scenarioOverrides` permite que, bajo un escenario
 * concreto, este Global tome un valor/fórmula distinto: si no hay override
 * para el escenario activo, se usa `value` normal.
 */
export interface BudgetingGlobal {
  id: string;
  code: string;
  label: string;
  value: string;
  folderId?: string | null;
  scenarioOverrides?: Record<string, string>;
}

/** Escenario ("qué pasaría si..."): un juego alternativo de valores para ciertos Globales, sin duplicar el borrador. */
export interface BudgetingScenario {
  id: string;
  label: string;
}

export type FringeType = "percent" | "fixed_period";
export type FringePeriod = "week" | "month" | "year";
export type FringeScope = "total" | "chapter" | "subchapter";

export const FRINGE_PERIOD_LABELS: Record<FringePeriod, string> = {
  week: "Semana",
  month: "Mes",
  year: "Año",
};

export const FRINGE_SCOPE_LABELS: Record<FringeScope, string> = {
  subchapter: "Subcapítulo",
  chapter: "Capítulo",
  total: "Total del presupuesto",
};

/**
 * Concepto de Seguridad Social / fringe. Dos modos:
 *  - "percent": porcentaje sobre el total de la línea a la que se aplica.
 *  - "fixed_period": importe fijo por periodo (semana/mes/año), con tope
 *    opcional, p.ej. la cotización de la SS española, topada mensualmente.
 *    El importe fijo se multiplica por las `units` de la línea (asumiendo que
 *    ya representan el nº de periodos, p.ej. "3" meses); el tope se aplica
 *    por línea, ya que no hay todavía un modelo de "misma persona" entre
 *    líneas distintas para acumular el tope entre ellas (eso requeriría un
 *    sistema de contactos, fuera de alcance por ahora).
 * `scope` decide dónde computa el importe generado: en el propio subcapítulo
 * de la línea, en el capítulo (como partida aparte), o en el total del
 * presupuesto, igual que un "excl." que se puede rastrear hasta su destino.
 */
export interface BudgetingFringe {
  id: string;
  code: string;
  label: string;
  folderId?: string | null;
  type: FringeType;
  percent?: number;
  amount?: number;
  period?: FringePeriod;
  capAmount?: number | null;
  scope: FringeScope;
}

export interface BudgetingPhase {
  id: string;
  label: string;
}

/** Tamaño de letra del PDF exportado: escala cabeceras, tabla y totales juntos. */
export type PdfFontSize = "small" | "normal" | "large";
export const PDF_FONT_SIZE_LABELS: Record<PdfFontSize, string> = { small: "Pequeño", normal: "Normal", large: "Grande" };
export const PDF_FONT_SIZES: Record<PdfFontSize, { title: number; heading: number; label: number; body: number; total: number }> = {
  small: { title: 15, heading: 10.5, label: 7, body: 7.5, total: 10 },
  normal: { title: 18, heading: 12, label: 7.5, body: 8.5, total: 12 },
  large: { title: 21, heading: 13.5, label: 8, body: 10, total: 14 },
};

export interface BudgetingExportConfig {
  coverSheet: boolean;
  pageBreakPerChapter: boolean;
  pdfFontSize: PdfFontSize;
  fields: {
    unit: boolean;
    notes: boolean;
    tags: boolean;
  };
}

export const DEFAULT_EXPORT_CONFIG: BudgetingExportConfig = {
  coverSheet: true,
  pageBreakPerChapter: false,
  pdfFontSize: "normal",
  fields: { unit: true, notes: false, tags: false },
};

/**
 * Datos de producción para la portada del PDF exportado (estilo Top Sheet de
 * Movie Magic Budgeting): quedan guardados en el borrador y se editan desde
 * el menú de exportación, no hace falta rellenarlos cada vez que se exporta.
 */
export interface BudgetingProjectInfo {
  title?: string;
  productionCompany?: string;
  director?: string;
  producer?: string;
  format?: string;
  preparedBy?: string;
  dateLabel?: string;
}

/** Ancho de las columnas numéricas (Cant./Unidad/X/Tarifa) del nivel de Detalle, en px, elegido por el usuario. */
export type DetailStatColumnWidth = "compact" | "normal" | "wide";
export const DETAIL_STAT_COLUMN_PX: Record<DetailStatColumnWidth, number> = {
  compact: 56,
  normal: 72,
  wide: 96,
};

/** Qué columnas opcionales se ven en la tabla de Detalle y con qué ancho las columnas numéricas — configurable desde el menú de la cabecera. */
export interface BudgetingDetailColumnsConfig {
  showComment: boolean;
  showTags: boolean;
  statColumnWidth: DetailStatColumnWidth;
}

export const DEFAULT_DETAIL_COLUMNS_CONFIG: BudgetingDetailColumnsConfig = {
  showComment: true,
  showTags: false,
  statColumnWidth: "normal",
};

/**
 * Si se ven las cargas sociales como líneas propias (con su código) en cada
 * nivel, una por alcance: "total" en el Top Sheet, "chapter" en la página de
 * Capítulo, "subchapter" en la de Detalle. Configurable desde el menú de
 * columnas de cada nivel (mismo kebab que activa/desactiva columnas), para
 * poder verlas independientemente de dónde estén asignadas.
 */
export interface BudgetingFringeVisibility {
  topSheet: boolean;
  chapter: boolean;
  detail: boolean;
}

export const DEFAULT_FRINGE_VISIBILITY: BudgetingFringeVisibility = {
  topSheet: true,
  chapter: true,
  detail: true,
};

export interface BudgetingDraft {
  id: string;
  name: string;
  ownerUid: string;
  ownerName: string;
  currency: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  sentToProjectId: string | null;
  sentToProjectName: string | null;
  sentAt: Timestamp | null;
  /** Si es false, los capítulos no se agrupan por categoría: lista plana en el Budget. */
  categoriesEnabled?: boolean;
  categories?: BudgetingCategoryDef[];
  globals?: BudgetingGlobal[];
  globalFolders?: BudgetingFolder[];
  fringes?: BudgetingFringe[];
  fringeFolders?: BudgetingFolder[];
  phases?: BudgetingPhase[];
  exportConfig?: BudgetingExportConfig;
  scenarios?: BudgetingScenario[];
  /** Escenario que se está previsualizando ahora mismo (null/undefined = valores reales, sin overrides). */
  activeScenarioId?: string | null;
  detailColumnsConfig?: BudgetingDetailColumnsConfig;
  fringeVisibility?: BudgetingFringeVisibility;
  projectInfo?: BudgetingProjectInfo;
}

/** Doc índice en userBudgetingDrafts/{uid}/drafts/{draftId}, para listar rápido en el sidebar sin leer cada borrador entero. */
export interface BudgetingDraftIndex {
  id: string;
  name: string;
  updatedAt: Timestamp | null;
  status: "draft" | "sent";
  sentToProjectName: string | null;
}

/**
 * Plantilla reutilizable en userBudgetingTemplates/{uid}/templates/{id}: la
 * estructura completa de un borrador (categorías, capítulos, subcapítulos y
 * detalle) guardada con el mismo formato que un .fwb, para arrancar un
 * borrador nuevo ya montado en vez de partir de cero cada vez.
 */
export interface BudgetingTemplate {
  id: string;
  name: string;
  createdAt: Timestamp | null;
  chapterCount: number;
  lineCount: number;
  structure: FwbFile;
}

/** budgetingDrafts/{draftId}/accounts/{chapterId} (Capítulo): dentro de Budgeting es organizativo (agrupa Cuentas), pero es el nivel que se envía a Accounting como Account. */
/**
 * Paleta de colores para líneas de solo texto (ver `isTextLine` más abajo):
 * un puñado de opciones fijas en vez de un selector de color libre, para no
 * complicar la UI. El primero es el color de texto por defecto del nivel.
 */
export const TEXT_LINE_COLORS = ["#1D201F", "#8DA7BE", "#DC2626", "#059669", "#D97706", "#7C3AED"];
export const DEFAULT_TEXT_LINE_COLOR = TEXT_LINE_COLORS[0];

export interface BudgetingAccount {
  id: string;
  code: string;
  description: string;
  /** id de una BudgetingCategoryDef del borrador, o null si las categorías están desactivadas / sin asignar. */
  category: string | null;
  createdAt: Timestamp | null;
  /** Orden manual: por defecto el de creación, pero se puede reordenar libremente. */
  order?: number;
  /** Si es true, esta fila es solo una nota de texto (sin código ni importe): no suma, no se puede entrar dentro. */
  isTextLine?: boolean;
  textBold?: boolean;
  textColor?: string;
}

/** budgetingDrafts/{draftId}/accounts/{chapterId}/subchapters/{subchapterId} (Cuenta, "Subcapítulo" en el código): el nivel que se envía a Accounting como SubAccount, con su importe presupuestado sumado de sus líneas de detalle. */
export interface BudgetingSubchapter {
  id: string;
  code: string;
  description: string;
  createdAt: Timestamp | null;
  order?: number;
  /** Suma denormalizada de líneas de otros subcapítulos redirigidas aquí (ver BudgetingLineRoute). Mantenida con increment() al guardar/duplicar/borrar líneas. */
  receivedTotal?: number;
  /** Si es true, esta fila es solo una nota de texto (sin código ni importe): no suma, no se puede entrar dentro. */
  isTextLine?: boolean;
  textBold?: boolean;
  textColor?: string;
}

/**
 * Destino de una línea "redirigida": su importe deja de sumar en su propio
 * subcapítulo/capítulo y pasa a sumar en otro, p.ej. una línea de Catering
 * escrita dentro de Ayudante de Producción que en realidad debe computar en
 * la partida de Catering. La línea se sigue viendo y editando donde se
 * escribió (marcada "excl."), con un enlace directo a su destino.
 */
export interface BudgetingLineRoute {
  chapterId: string;
  chapterCode: string;
  chapterDescription: string;
  subchapterId: string;
  subchapterCode: string;
  subchapterDescription: string;
}

/**
 * .../subchapters/{subchapterId}/detailLines/{lineId} (Detalle): su código
 * es solo referencial dentro de Budgeting, no se envía a Accounting como
 * entidad propia. El código elegible en una PO es el de su Cuenta contenedora
 * (BudgetingSubchapter, equivale al SubAccount de Accounting > Budget), cuyo
 * importe presupuestado sale de sumar el total de todas sus líneas.
 * Importe calculado, no escrito a mano.
 *
 * `units`/`multiplier`/`rate` son siempre el número resuelto (lo que se usa
 * para calcular `total`); si el usuario ha escrito una fórmula referenciando
 * Globales en vez de un número suelto, el texto original se guarda en el
 * campo `*Expr` correspondiente para poder volver a mostrarlo al editar.
 */
export interface BudgetingDetailLine {
  id: string;
  code: string;
  description: string;
  units: number;
  unitsExpr?: string;
  /** Tipo de unidad (Día, Semana, Fijo...): solo descriptivo, no afecta al cálculo. */
  unit: string;
  multiplier: number;
  multiplierExpr?: string;
  rate: number;
  rateExpr?: string;
  total: number;
  /** Comentario, integrado en la propia línea (columna opcional, no en un panel aparte). */
  notes?: string;
  tags?: string[];
  /** Fringes/SS aplicados a esta línea (ids de BudgetingFringe del borrador). */
  fringeIds?: string[];
  /** Si está puesto, el total de esta línea NO suma aquí: suma en el subcapítulo indicado (ver BudgetingLineRoute). */
  routedTo?: BudgetingLineRoute | null;
  createdAt: Timestamp | null;
  order?: number;
  /** Si es true, esta fila es solo una nota de texto (sin código ni importe): no suma, no lleva cantidad/tarifa. */
  isTextLine?: boolean;
  textBold?: boolean;
  textColor?: string;
}

export const UNIT_SUGGESTIONS = ["Día", "Semana", "Mes", "Fijo", "Persona", "%", "Hora"];

export const CURRENCIES = [
  { code: "EUR", label: "€ Euro" },
  { code: "USD", label: "$ Dólar" },
  { code: "GBP", label: "£ Libra" },
  { code: "MXN", label: "$ Peso mexicano" },
  { code: "ARS", label: "$ Peso argentino" },
];

export function newBudgetingId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
}

/** Valor de orden para un elemento recién creado: monótono creciente, así entra siempre al final. */
export function nextOrderValue(): number {
  return Date.now();
}

/**
 * Orden por defecto: el campo `order` si existe, si no la fecha de creación
 * (para que documentos antiguos sin `order` no queden descolocados), si no 0.
 * El orden se reordena libremente después con moveOrder().
 */
export function sortByOrder<T extends { order?: number; createdAt?: { seconds: number } | Timestamp | null }>(items: T[]): T[] {
  const key = (item: T) => {
    if (item.order != null) return item.order;
    const c = item.createdAt as any;
    if (c && typeof c.seconds === "number") return c.seconds * 1000;
    if (c && typeof c.toMillis === "function") return c.toMillis();
    return 0;
  };
  return [...items].sort((a, b) => key(a) - key(b));
}

/** Calcula el intercambio de `order` necesario para mover un elemento un puesto arriba/abajo dentro de `items` (ya en su grupo, p.ej. capítulos de la misma categoría). Devuelve null si ya está en el extremo. */
export function computeReorder<T extends { id: string; order?: number }>(
  items: T[], id: string, direction: "up" | "down"
): { id: string; order: number }[] | null {
  const sorted = sortByOrder(items);
  const idx = sorted.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return null;
  const a = sorted[idx];
  const b = sorted[swapIdx];
  const orderA = a.order ?? idx;
  const orderB = b.order ?? swapIdx;
  return [{ id: a.id, order: orderB }, { id: b.id, order: orderA }];
}

export function computeLineTotal(units: number, multiplier: number, rate: number): number {
  const u = Number.isFinite(units) ? units : 0;
  const m = Number.isFinite(multiplier) ? multiplier : 0;
  const r = Number.isFinite(rate) ? rate : 0;
  return Math.round(u * m * r * 100) / 100;
}

export function resolveCategories(draft: BudgetingDraft | null): BudgetingCategoryDef[] {
  return draft?.categories ?? DEFAULT_CATEGORIES;
}

export function categoriesEnabled(draft: BudgetingDraft | null): boolean {
  return draft?.categoriesEnabled ?? true;
}

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", MXN: "$", ARS: "$" };

/**
 * `Intl.NumberFormat("es-ES")` no agrupa los miles para números de 4 cifras
 * (1000-9999): "6000,00" en vez de "6.000,00" (a partir de 10000 sí agrupa
 * bien). Es un comportamiento real del motor JS, no algo puntual de un
 * número raro, así que se agrupa a mano en vez de fiarse del locale.
 */
function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Los importes en Budgeting van siempre con dos decimales, nunca menos (0 se ve "0,00", no "0"). */
export function fmtDecimal(n: number): string {
  const v = Math.round((n || 0) * 100) / 100;
  const neg = v < 0;
  const [intPart, decPart] = Math.abs(v).toFixed(2).split(".");
  return `${neg ? "-" : ""}${groupThousands(intPart)},${decPart}`;
}

export function fmtCurrency(n: number, currency: string): string {
  return `${fmtDecimal(n)} ${CURRENCY_SYMBOLS[currency] || currency || "€"}`;
}

// ─── Motor de fórmulas ──────────────────────────────────────────────────────
// Evaluador propio (sin eval/Function) para: valores de Global que referencian
// otros Globales por su `code`, y campos Cantidad/X/Tarifa de una línea de
// Detalle que referencian Globales. Soporta +, -, *, /, (), decimales y
// nombres de variable tipo CODE_123. Nada más: no hay funciones ni
// condicionales, a propósito, para que quede predecible.

function tokenizeExpr(expr: string): string[] {
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|[0-9]+\.?[0-9]*|\.[0-9]+|[+\-*/()])\s*/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(expr))) {
    if (m.index !== lastIndex) {
      throw new Error(`Carácter inesperado cerca de "${expr.slice(lastIndex, Math.min(expr.length, m.index + 4))}"`);
    }
    tokens.push(m[1]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== expr.length) throw new Error("Carácter inesperado al final de la fórmula");
  return tokens;
}

/** Evalúa una expresión aritmética; `lookup` resuelve identificadores (códigos de Global). */
export function evaluateExpr(expr: string, lookup: (code: string) => number): number {
  const tokens = tokenizeExpr(expr.trim());
  if (tokens.length === 0) throw new Error("Fórmula vacía");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseUnary();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function parseUnary(): number {
    if (peek() === "-") { next(); return -parseUnary(); }
    if (peek() === "+") { next(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom(): number {
    const t = next();
    if (t === undefined) throw new Error("Fórmula incompleta");
    if (t === "(") {
      const v = parseExpr();
      if (next() !== ")") throw new Error("Falta un paréntesis de cierre");
      return v;
    }
    if (/^[0-9.]/.test(t)) {
      const n = parseFloat(t);
      if (Number.isNaN(n)) throw new Error(`Número inválido: "${t}"`);
      return n;
    }
    return lookup(t);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Fórmula mal formada");
  if (!Number.isFinite(result)) throw new Error("El resultado no es un número válido");
  return result;
}

/** true si el texto es directamente un número (sin fórmula): el camino rápido más habitual. */
export function isPlainNumber(text: string): boolean {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(text.trim());
}

export interface GlobalResolution {
  values: Record<string, number>;
  errors: Record<string, string>;
}

/** Resuelve todos los Globales de un borrador, permitiendo que unos referencien a otros por `code`. Detecta ciclos. */
export function resolveGlobals(globals: BudgetingGlobal[], activeScenarioId?: string | null): GlobalResolution {
  const byCode = new Map(globals.filter((g) => g.code).map((g) => [g.code, g]));
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const resolving = new Set<string>();

  function resolve(code: string): number {
    if (code in values) return values[code];
    if (code in errors) return 0;
    const g = byCode.get(code);
    if (!g) { errors[code] = "Código no encontrado"; return 0; }
    if (resolving.has(code)) { errors[code] = "Referencia circular"; return 0; }
    resolving.add(code);
    try {
      const raw = (activeScenarioId && g.scenarioOverrides?.[activeScenarioId]?.trim()) || g.value;
      const val = isPlainNumber(raw) ? parseFloat(raw) : evaluateExpr(raw, resolve);
      values[code] = val;
      return val;
    } catch (e: any) {
      errors[code] = e?.message || "Error en la fórmula";
      values[code] = 0;
      return 0;
    } finally {
      resolving.delete(code);
    }
  }

  globals.forEach((g) => { if (g.code) resolve(g.code); });
  return { values, errors };
}

/** Evalúa el texto de un campo Cantidad/X/Tarifa: número puro o fórmula referenciando Globales. */
export function evaluateFieldExpr(text: string, globalValues: Record<string, number>): { value: number; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: 0 };
  if (isPlainNumber(trimmed)) return { value: parseFloat(trimmed) };
  try {
    const value = evaluateExpr(trimmed, (code) => {
      if (!(code in globalValues)) throw new Error(`Global "${code}" no existe`);
      return globalValues[code];
    });
    return { value };
  } catch (e: any) {
    return { value: 0, error: e?.message || "Fórmula inválida" };
  }
}

/**
 * Recalcula el total de una línea bajo otro juego de valores de Globales,
 * usado para previsualizar un Escenario sin tocar lo guardado. Si la línea no
 * usa ninguna fórmula, su total no depende de Globales y se devuelve tal cual.
 */
export function computeLineTotalForScenario(line: BudgetingDetailLine, globalValues: Record<string, number>): number {
  if (!line.unitsExpr && !line.multiplierExpr && !line.rateExpr) return line.total || 0;
  const u = line.unitsExpr ? evaluateFieldExpr(line.unitsExpr, globalValues).value : line.units;
  const m = line.multiplierExpr ? evaluateFieldExpr(line.multiplierExpr, globalValues).value : line.multiplier;
  const r = line.rateExpr ? evaluateFieldExpr(line.rateExpr, globalValues).value : line.rate;
  return computeLineTotal(u, m, r);
}

export function effectiveLineUnits(line: BudgetingDetailLine, globalValues: Record<string, number>): number {
  return line.unitsExpr ? evaluateFieldExpr(line.unitsExpr, globalValues).value : (line.units || 0);
}

// ─── Fringes / Seguridad Social ─────────────────────────────────────────────

/** Importe que genera un fringe sobre una línea concreta. */
export function computeFringeAmountForLine(fringe: BudgetingFringe, line: { total: number; units: number }): number {
  if (fringe.type === "percent") {
    return Math.round((line.total || 0) * ((fringe.percent || 0) / 100) * 100) / 100;
  }
  const perPeriod = fringe.capAmount != null ? Math.min(fringe.amount || 0, fringe.capAmount) : (fringe.amount || 0);
  return Math.round(perPeriod * (line.units || 0) * 100) / 100;
}

export interface LineFringeAmount {
  fringe: BudgetingFringe;
  amount: number;
}

export function lineFringeBreakdown(line: BudgetingDetailLine, fringes: BudgetingFringe[]): LineFringeAmount[] {
  return (line.fringeIds || [])
    .map((id) => fringes.find((f) => f.id === id))
    .filter((f): f is BudgetingFringe => !!f)
    .map((fringe) => ({ fringe, amount: computeFringeAmountForLine(fringe, line) }));
}

export interface FringeExtras {
  /** Suma de fringes con scope "subchapter": se pliega directamente en el subtotal del propio subcapítulo. */
  subchapterScoped: number;
  /** Suma de fringes con scope "chapter": partida aparte a nivel de capítulo. */
  chapterScoped: number;
  /** Suma de fringes con scope "total": partida aparte a nivel de presupuesto entero. */
  totalScoped: number;
}

export function computeFringeExtras(lines: BudgetingDetailLine[], fringes: BudgetingFringe[]): FringeExtras {
  const extras: FringeExtras = { subchapterScoped: 0, chapterScoped: 0, totalScoped: 0 };
  for (const line of lines) {
    for (const { fringe, amount } of lineFringeBreakdown(line, fringes)) {
      if (fringe.scope === "subchapter") extras.subchapterScoped += amount;
      else if (fringe.scope === "chapter") extras.chapterScoped += amount;
      else extras.totalScoped += amount;
    }
  }
  extras.subchapterScoped = Math.round(extras.subchapterScoped * 100) / 100;
  extras.chapterScoped = Math.round(extras.chapterScoped * 100) / 100;
  extras.totalScoped = Math.round(extras.totalScoped * 100) / 100;
  return extras;
}

// ─── Redirección de líneas ("excl.") ────────────────────────────────────────
// Una línea con `routedTo` puesto se sigue viendo y editando en su
// subcapítulo físico, pero su total no cuenta ahí: cuenta en el subcapítulo
// destino (denormalizado en `receivedTotal`, ver BudgetingSubchapter). Estos
// helpers son puramente de lectura; quien escribe `routedTo` es responsable
// de mantener `receivedTotal` al día con increment()/writeBatch.

/** Suma directa de un conjunto de líneas, excluyendo las que están redirigidas a otro subcapítulo. */
export function sumOwnLineTotals(lines: BudgetingDetailLine[]): number {
  return Math.round(lines.filter((l) => !l.routedTo).reduce((s, l) => s + (l.total || 0), 0) * 100) / 100;
}

/** Total real de un subcapítulo: lo suyo propio (sin lo redirigido a otros) + lo que otros le han redirigido a él. */
export function subchapterTotal(sub: { receivedTotal?: number }, lines: BudgetingDetailLine[]): number {
  return Math.round((sumOwnLineTotals(lines) + (sub.receivedTotal || 0)) * 100) / 100;
}

// ─── Estilo: funcional, no "de color por todas partes". Fondo blanco/borde
// gris por defecto, se ilumina en el acento al hover o cuando está
// activo/seleccionado. Texto de énfasis en BUDGETING_TEXT, no slate-900. ────

export const BTN_LIGHT =
  "bg-white border border-slate-200 text-slate-700 hover:border-[#8DA7BE] hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.08] transition-colors";

export const BTN_LIGHT_ACTIVE = "border-[#8DA7BE] bg-[#8DA7BE]/[0.1] text-[#8DA7BE]";

export const ICON_BTN_LIGHT =
  "text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors";

/** Input de fila (spreadsheet-like): caja real con borde, no solo una línea inferior. Para paneles secundarios (proveedor, comentario, etiquetas...), no para las columnas principales de una tabla. */
export const ROW_INPUT =
  "border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#8DA7BE] focus:ring-2 focus:ring-[#8DA7BE]/20 transition-colors";

/**
 * Celda de tabla al estilo Excel: sin caja ni placeholder visible en reposo.
 * El padding vertical va en la propia celda (no en la fila contenedora) para
 * que sea justo eso lo que fija la altura de la fila entera: así las líneas
 * divisorias entre columnas (divide-x en el grid) van de verdad de arriba a
 * abajo, no solo del alto del texto. Al enfocar se sombrea entera y se le
 * marca el borde completo en el acento, como la celda activa seleccionada de
 * una hoja de cálculo. Al hacer clic el cursor se coloca donde se ha
 * pulsado (no selecciona todo el texto) para poder seguir escribiendo desde
 * ahí; seleccionar/copiar sigue funcionando igual que en cualquier campo de
 * texto normal (arrastrar, Cmd/Ctrl+A...). Guarda al perder el foco, sin
 * botón de confirmar.
 */
export const CELL_INPUT =
  "w-full h-full bg-transparent focus:outline-none focus:bg-slate-200/70 focus:ring-2 focus:ring-inset focus:ring-[#8DA7BE] px-1.5 py-2.5 transition-colors";

// ─── Snapshots / versiones ──────────────────────────────────────────────────
// budgetingDrafts/{draftId}/snapshots/{snapshotId}: una foto congelada del
// árbol completo (con los mismos ids de Firestore que tenía en ese momento,
// para poder comparar dos fotos, o una foto contra el estado actual).

export interface BudgetingSnapshotLine { id: string; code: string; description: string; total: number; }
export interface BudgetingSnapshotSubchapter { id: string; code: string; description: string; lines: BudgetingSnapshotLine[]; }
export interface BudgetingSnapshotChapter { id: string; code: string; description: string; category: string | null; subchapters: BudgetingSnapshotSubchapter[]; }

export interface BudgetingSnapshot {
  id: string;
  label: string;
  createdAt: Timestamp | null;
  createdBy: string;
  grandTotal: number;
  chapters: BudgetingSnapshotChapter[];
}

export interface SnapshotLineDiff {
  id: string;
  code: string;
  description: string;
  chapterLabel: string;
  subchapterLabel: string;
  kind: "added" | "removed" | "changed";
  oldTotal?: number;
  newTotal?: number;
}

export interface SnapshotDiff {
  lines: SnapshotLineDiff[];
  oldTotal: number;
  newTotal: number;
}

/** Compara dos árboles de snapshot (o un snapshot contra el estado actual, con la misma forma) línea a línea, por id. */
export function diffSnapshotTrees(oldChapters: BudgetingSnapshotChapter[], newChapters: BudgetingSnapshotChapter[]): SnapshotDiff {
  const flatten = (chapters: BudgetingSnapshotChapter[]) => {
    const map = new Map<string, { line: BudgetingSnapshotLine; chapterLabel: string; subchapterLabel: string }>();
    for (const c of chapters) {
      for (const s of c.subchapters) {
        for (const l of s.lines) {
          map.set(l.id, { line: l, chapterLabel: `${c.code} ${c.description}`, subchapterLabel: `${s.code} ${s.description}` });
        }
      }
    }
    return map;
  };
  const oldMap = flatten(oldChapters);
  const newMap = flatten(newChapters);
  const diffs: SnapshotLineDiff[] = [];
  const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
  for (const id of allIds) {
    const o = oldMap.get(id);
    const n = newMap.get(id);
    if (o && !n) {
      diffs.push({ id, code: o.line.code, description: o.line.description, chapterLabel: o.chapterLabel, subchapterLabel: o.subchapterLabel, kind: "removed", oldTotal: o.line.total });
    } else if (!o && n) {
      diffs.push({ id, code: n.line.code, description: n.line.description, chapterLabel: n.chapterLabel, subchapterLabel: n.subchapterLabel, kind: "added", newTotal: n.line.total });
    } else if (o && n && Math.round((o.line.total || 0) * 100) !== Math.round((n.line.total || 0) * 100)) {
      diffs.push({ id, code: n.line.code, description: n.line.description, chapterLabel: n.chapterLabel, subchapterLabel: n.subchapterLabel, kind: "changed", oldTotal: o.line.total, newTotal: n.line.total });
    }
  }
  const oldTotal = Math.round([...oldMap.values()].reduce((s, x) => s + (x.line.total || 0), 0) * 100) / 100;
  const newTotal = Math.round([...newMap.values()].reduce((s, x) => s + (x.line.total || 0), 0) * 100) / 100;
  return { lines: diffs, oldTotal, newTotal };
}
