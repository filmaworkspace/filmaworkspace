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

export const BUDGETING_ACCENT = "#C08A2E";

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
