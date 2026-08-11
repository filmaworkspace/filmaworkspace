// ─────────────────────────────────────────────────────────────────────────────
// Budgeting: entorno independiente de proyecto para presupuestar una
// película/serie de cero (inspirado en Movie Magic Budgeting / Saturation).
// No cuelga de ningún proyecto — vive en `budgetingDrafts/{draftId}`, con un
// índice por usuario en `userBudgetingDrafts/{uid}/drafts/{draftId}` para
// listar rápido en el sidebar. Un borrador terminado se "envía" a un
// proyecto, que rellena su Accounting > Budget (ver accounting/budget/page.tsx
// para el modelo Account → SubAccount que se replica ahí).
//
// Jerarquía (de fuera a dentro): Categoría (apartado, opcional) → Capítulo →
// Subcapítulo → Detalle (la única con código elegible en una PO).
// ─────────────────────────────────────────────────────────────────────────────

import { Timestamp } from "firebase/firestore";

export const BUDGETING_ACCENT = "#8DA7BE";
export const BUDGETING_TEXT = "#1D201F";
/** Fondo tenue del acento, para chips/tints — nada de rellenos sólidos por defecto. */
export const BUDGETING_TINT = `${BUDGETING_ACCENT}1a`;

// ─── Categorías (apartado) ──────────────────────────────────────────────────
// Clásicas de presupuesto de estudio (Above/Below the line) por defecto, pero
// configurables por borrador — se pueden renombrar, añadir, quitar, o
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
 * `resolveGlobals()`.
 */
export interface BudgetingGlobal {
  id: string;
  code: string;
  label: string;
  value: string;
  folderId?: string | null;
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
 *    opcional — p.ej. la cotización de la SS española, topada mensualmente.
 *    El importe fijo se multiplica por las `units` de la línea (asumiendo que
 *    ya representan el nº de periodos, p.ej. "3" meses); el tope se aplica
 *    por línea — no hay todavía un modelo de "misma persona" entre líneas
 *    distintas para acumular el tope entre ellas (eso requeriría un sistema
 *    de contactos, fuera de alcance por ahora).
 * `scope` decide dónde computa el importe generado: en el propio subcapítulo
 * de la línea, en el capítulo (como partida aparte), o en el total del
 * presupuesto — igual que un "excl." que se puede rastrear hasta su destino.
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

export interface BudgetingExportConfig {
  coverSheet: boolean;
  pageBreakPerChapter: boolean;
  fields: {
    unit: boolean;
    supplier: boolean;
    notes: boolean;
    tags: boolean;
  };
}

export const DEFAULT_EXPORT_CONFIG: BudgetingExportConfig = {
  coverSheet: true,
  pageBreakPerChapter: false,
  fields: { unit: true, supplier: false, notes: false, tags: false },
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
  /** Si es false, los capítulos no se agrupan por categoría — lista plana en el Budget. */
  categoriesEnabled?: boolean;
  categories?: BudgetingCategoryDef[];
  globals?: BudgetingGlobal[];
  globalFolders?: BudgetingFolder[];
  fringes?: BudgetingFringe[];
  fringeFolders?: BudgetingFolder[];
  phases?: BudgetingPhase[];
  exportConfig?: BudgetingExportConfig;
}

/** Doc índice en userBudgetingDrafts/{uid}/drafts/{draftId} — para listar rápido en el sidebar sin leer cada borrador entero. */
export interface BudgetingDraftIndex {
  id: string;
  name: string;
  updatedAt: Timestamp | null;
  status: "draft" | "sent";
  sentToProjectName: string | null;
}

/** budgetingDrafts/{draftId}/accounts/{chapterId} — Capítulo: solo organizativo. */
export interface BudgetingAccount {
  id: string;
  code: string;
  description: string;
  /** id de una BudgetingCategoryDef del borrador, o null si las categorías están desactivadas / sin asignar. */
  category: string | null;
  createdAt: Timestamp | null;
}

/** budgetingDrafts/{draftId}/accounts/{chapterId}/subchapters/{subchapterId} — Subcapítulo: también organizativo. */
export interface BudgetingSubchapter {
  id: string;
  code: string;
  description: string;
  createdAt: Timestamp | null;
}

/**
 * .../subchapters/{subchapterId}/detailLines/{lineId} — Detalle: su código es
 * el que luego se elige en una PO (equivale al SubAccount de Accounting >
 * Budget). Importe calculado, no escrito a mano.
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
  /** Tipo de unidad (Día, Semana, Fijo...) — solo descriptivo, no afecta al cálculo. */
  unit: string;
  multiplier: number;
  multiplierExpr?: string;
  rate: number;
  rateExpr?: string;
  total: number;
  supplier?: string;
  notes?: string;
  tags?: string[];
  /** Fringes/SS aplicados a esta línea (ids de BudgetingFringe del borrador). */
  fringeIds?: string[];
  createdAt: Timestamp | null;
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

export function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

export function fmtDecimal(n: number): string {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n || 0);
}

// ─── Motor de fórmulas ──────────────────────────────────────────────────────
// Evaluador propio (sin eval/Function) para: valores de Global que referencian
// otros Globales por su `code`, y campos Cantidad/X/Tarifa de una línea de
// Detalle que referencian Globales. Soporta +, -, *, /, (), decimales y
// nombres de variable tipo CODE_123. Nada más — no hay funciones ni
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

/** true si el texto es directamente un número (sin fórmula) — el camino rápido más habitual. */
export function isPlainNumber(text: string): boolean {
  return /^-?[0-9]+(\.[0-9]+)?$/.test(text.trim());
}

export interface GlobalResolution {
  values: Record<string, number>;
  errors: Record<string, string>;
}

/** Resuelve todos los Globales de un borrador, permitiendo que unos referencien a otros por `code`. Detecta ciclos. */
export function resolveGlobals(globals: BudgetingGlobal[]): GlobalResolution {
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
      const val = isPlainNumber(g.value) ? parseFloat(g.value) : evaluateExpr(g.value, resolve);
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
  /** Suma de fringes con scope "subchapter" — se pliega directamente en el subtotal del propio subcapítulo. */
  subchapterScoped: number;
  /** Suma de fringes con scope "chapter" — partida aparte a nivel de capítulo. */
  chapterScoped: number;
  /** Suma de fringes con scope "total" — partida aparte a nivel de presupuesto entero. */
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

// ─── Estilo — funcional, no "de color por todas partes": fondo blanco/borde
// gris por defecto, se ilumina en el acento al hover o cuando está
// activo/seleccionado. Texto de énfasis en BUDGETING_TEXT, no slate-900. ────

export const BTN_LIGHT =
  "bg-white border border-slate-200 text-slate-700 hover:border-[#8DA7BE] hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.08] transition-colors";

export const BTN_LIGHT_ACTIVE = "border-[#8DA7BE] bg-[#8DA7BE]/[0.1] text-[#8DA7BE]";

export const ICON_BTN_LIGHT =
  "text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors";

/** Input de fila (spreadsheet-like): caja real con borde, no solo una línea inferior. */
export const ROW_INPUT =
  "border border-slate-300 rounded-md bg-white focus:outline-none focus:border-[#8DA7BE] focus:ring-2 focus:ring-[#8DA7BE]/20 transition-colors";
