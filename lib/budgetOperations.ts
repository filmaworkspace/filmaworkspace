// ─── Operaciones de presupuesto ──────────────────────────────────────────────
// Antes cada pantalla sumaba y restaba contadores (committed / actual / box) a
// mano, con reglas distintas en cada sitio, y las cifras se desviaban
// (duplicados, importes que se perdían entre comprometido y realizado).
//
// Ahora el presupuesto se calcula siempre desde los documentos
// (lib/budgetLedger) en el servidor. Todas estas funciones hacen lo mismo:
// pedir el recálculo. Se conservan los nombres para no tocar cada llamada,
// pero DEBEN llamarse después de guardar el cambio en el documento.

import { syncBudget } from "@/lib/ledgerClient";

interface BudgetItem { subAccountId?: string; baseAmount?: number; invoicedAmount?: number; poItemIndex?: number | null }

const sync = async (projectId: string) => { await syncBudget(projectId); };

export const syncProjectBudget = sync;

export async function commitPO(projectId: string, _items?: BudgetItem[]) { await sync(projectId); }
export async function uncommitPO(projectId: string, _items?: BudgetItem[]) { await sync(projectId); }
export async function handlePOStatusChange(projectId: string, _old?: string, _new?: string, _items?: BudgetItem[], _prev?: BudgetItem[] | null) { await sync(projectId); }
export async function realizeInvoice(projectId: string, _items?: BudgetItem[]) { await sync(projectId); }
export async function unrealizeInvoice(projectId: string, _items?: BudgetItem[]) { await sync(projectId); }
export async function handleInvoiceStatusChange(projectId: string, _old?: string, _new?: string, _items?: BudgetItem[]) { await sync(projectId); }
export async function updateCommittedForItem(projectId: string, _sub?: string, _o?: number, _n?: number) { await sync(projectId); }
export async function closePoItem(projectId: string, _sub?: string, _amount?: number) { await sync(projectId); }
export async function reopenPoItem(projectId: string, _sub?: string, _amount?: number) { await sync(projectId); }
export async function realizeBoxExpenses(projectId: string, _e?: unknown[]) { await sync(projectId); }
export async function unrealizeBoxExpenses(projectId: string, _e?: unknown[]) { await sync(projectId); }
export async function realizeCardEnvelope(projectId: string, _id?: string) { await sync(projectId); }
export async function unrealizeCardEnvelope(projectId: string, _id?: string) { await sync(projectId); }
export async function realizeTransferEnvelope(projectId: string, _id?: string) { await sync(projectId); }
export async function unrealizeTransferEnvelope(projectId: string, _id?: string) { await sync(projectId); }
/** El facturado de cada línea de PO también lo recalcula el servidor. */
export async function updatePOItemsInvoiced(projectId: string, _poId?: string, _items?: unknown[], _op?: "add" | "subtract") { await sync(projectId); }
