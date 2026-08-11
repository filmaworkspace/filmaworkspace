// ─────────────────────────────────────────────────────────────────────────────
// Budgeting: entorno independiente de proyecto para presupuestar una
// película/serie de cero (inspirado en Movie Magic Budgeting / Saturation).
// No cuelga de ningún proyecto — vive en `budgetingDrafts/{draftId}`, con un
// índice por usuario en `userBudgetingDrafts/{uid}/drafts/{draftId}` para
// listar rápido en el sidebar. Un borrador terminado se "envía" a un
// proyecto, que rellena su Accounting > Budget (ver lib/budgeting más
// adelante para la lógica de envío, y accounting/budget/page.tsx para el
// modelo Account → SubAccount que se replica ahí).
// ─────────────────────────────────────────────────────────────────────────────

import { Timestamp } from "firebase/firestore";

export const BUDGETING_ACCENT = "#5B57E0";
export const BUDGETING_ACCENT_DARK = "#4640C7";

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
}

/** Doc índice en userBudgetingDrafts/{uid}/drafts/{draftId} — para listar rápido en el sidebar sin leer cada borrador entero. */
export interface BudgetingDraftIndex {
  id: string;
  name: string;
  updatedAt: Timestamp | null;
  status: "draft" | "sent";
  sentToProjectName: string | null;
}

// ─── Categorías del Top Sheet (clásicas de presupuesto de estudio — Netflix,
// Disney, Movie Magic — no los departamentos de Config) ────────────────────

export type BudgetCategory = "atl" | "btl_production" | "btl_post" | "other";

export const BUDGET_CATEGORIES: BudgetCategory[] = ["atl", "btl_production", "btl_post", "other"];

export const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  atl:            "Above The Line",
  btl_production: "Below The Line · Producción",
  btl_post:       "Below The Line · Postproducción",
  other:          "Otros / Overhead",
};

/** budgetingDrafts/{draftId}/accounts/{accountId} — solo organizativa, equivale al Account de Accounting > Budget. */
export interface BudgetingAccount {
  id: string;
  code: string;
  description: string;
  category: BudgetCategory;
  createdAt: Timestamp | null;
}

/**
 * budgetingDrafts/{draftId}/accounts/{accountId}/detailLines/{lineId} — su
 * código es el que luego se elige en una PO (equivale al SubAccount de
 * Accounting > Budget). Importe calculado, no escrito a mano.
 */
export interface BudgetingDetailLine {
  id: string;
  code: string;
  description: string;
  units: number;
  multiplier: number;
  rate: number;
  total: number;
  createdAt: Timestamp | null;
}

export function computeLineTotal(units: number, multiplier: number, rate: number): number {
  const u = Number.isFinite(units) ? units : 0;
  const m = Number.isFinite(multiplier) ? multiplier : 0;
  const r = Number.isFinite(rate) ? rate : 0;
  return Math.round(u * m * r * 100) / 100;
}
