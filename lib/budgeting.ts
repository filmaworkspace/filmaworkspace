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

export interface BudgetingGlobal {
  id: string;
  code: string;
  label: string;
  value: string;
  /** id de otro Global referenciado en `value`, si se usa como fórmula — informativo, sin motor de cálculo todavía. */
  parentId?: string | null;
}

export interface BudgetingFringe {
  id: string;
  label: string;
  percent: number;
}

export interface BudgetingPhase {
  id: string;
  label: string;
}

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
  fringes?: BudgetingFringe[];
  phases?: BudgetingPhase[];
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
 */
export interface BudgetingDetailLine {
  id: string;
  code: string;
  description: string;
  units: number;
  /** Tipo de unidad (Día, Semana, Fijo...) — solo descriptivo, no afecta al cálculo. */
  unit: string;
  multiplier: number;
  rate: number;
  total: number;
  supplier?: string;
  notes?: string;
  tags?: string[];
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

// ─── Estilo — funcional, no "de color por todas partes": fondo blanco/borde
// gris por defecto, se ilumina en el acento al hover o cuando está
// activo/seleccionado. Texto de énfasis en BUDGETING_TEXT, no slate-900. ────

export const BTN_LIGHT =
  "bg-white border border-slate-200 text-slate-700 hover:border-[#8DA7BE] hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.08] transition-colors";

export const BTN_LIGHT_ACTIVE = "border-[#8DA7BE] bg-[#8DA7BE]/[0.1] text-[#8DA7BE]";

export const ICON_BTN_LIGHT =
  "text-slate-400 hover:text-[#8DA7BE] hover:bg-[#8DA7BE]/[0.1] transition-colors";
