import { doc, getDoc, getDocs, collection, runTransaction, updateDoc, DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { 
  getCostSettings, 
  shouldCommitOnStatusChange, 
  shouldUncommitPO,
  shouldRealizeOnStatusChange,
  shouldUnrealizeInvoice,
  shouldRealizeBoxExpense
} from "./budgetRules";

interface BudgetItem {
  subAccountId: string;
  baseAmount: number;
  /**
   * Importe ya realizado (facturado y contabilizado) de este item.
   * Se usa en uncommitPO para no restar de committed lo que ya pasó a actual.
   * Si se omite se asume 0 (comportamiento anterior).
   */
  invoicedAmount?: number;
}

/**
 * Localiza la referencia de una subcuenta buscando en todas las cuentas del proyecto.
 * Devuelve null si no existe.
 */
async function findSubAccountRef(
  projectId: string,
  subAccountId: string
): Promise<DocumentReference | null> {
  const accountsSnapshot = await getDocs(collection(db, `projects/${projectId}/accounts`));
  for (const accountDoc of accountsSnapshot.docs) {
    const ref = doc(db, `projects/${projectId}/accounts/${accountDoc.id}/subaccounts`, subAccountId);
    const snap = await getDoc(ref);
    if (snap.exists()) return ref;
  }
  return null;
}

/**
 * Busca y actualiza una subcuenta en el presupuesto usando una transacción atómica,
 * eliminando la condición de carrera cuando dos usuarios modifican el mismo valor
 * simultáneamente (p.ej. dos aprobaciones concurrentes de PO).
 */
async function updateSubAccount(
  projectId: string,
  subAccountId: string,
  updateFn: (currentData: { committed: number; actual: number }) => { committed: number; actual: number }
): Promise<boolean> {
  if (!subAccountId) return false;

  const ref = await findSubAccountRef(projectId, subAccountId);
  if (!ref) return false;

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      const newValues = updateFn({
        committed: data.committed || 0,
        actual: data.actual || 0,
      });
      tx.update(ref, {
        committed: Math.max(0, newValues.committed),
        actual: Math.max(0, newValues.actual),
      });
    });
    return true;
  } catch (e) {
    console.error(`Error updating subaccount ${subAccountId}:`, e);
    return false;
  }
}

/**
 * Agrupa items por subAccountId y suma los importes base.
 */
function groupAmountsByAccount(items: BudgetItem[]): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const item of items) {
    if (item.subAccountId && item.baseAmount > 0) {
      amounts[item.subAccountId] = (amounts[item.subAccountId] || 0) + item.baseAmount;
    }
  }
  return amounts;
}

/**
 * Agrupa por subAccountId el importe que todavía está en committed
 * (baseAmount menos lo ya realizado/facturado).
 * Evita restar de committed importes que ya pasaron a actual.
 */
function groupUncommittableAmounts(items: BudgetItem[]): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const item of items) {
    if (!item.subAccountId) continue;
    const uncommittable = Math.max(0, item.baseAmount - (item.invoicedAmount ?? 0));
    if (uncommittable > 0) {
      amounts[item.subAccountId] = (amounts[item.subAccountId] || 0) + uncommittable;
    }
  }
  return amounts;
}

// ==================== OPERACIONES DE PO ====================

/**
 * Compromete presupuesto para una PO (suma a committed)
 */
export async function commitPO(
  projectId: string,
  poItems: BudgetItem[]
): Promise<void> {
  const amountsByAccount = groupAmountsByAccount(poItems);
  
  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
    await updateSubAccount(projectId, subAccountId, (current) => ({
      committed: current.committed + amount,
      actual: current.actual,
    }));
  }
}

/**
 * Descompromete presupuesto de una PO (resta de committed).
 *
 * Solo resta la porción que aún no ha sido realizada: si un item tiene
 * invoicedAmount > 0 esa parte ya pasó a actual mediante realizeInvoice y
 * no debe volver a restarse de committed, evitando que el balance quede negativo.
 */
export async function uncommitPO(
  projectId: string,
  poItems: BudgetItem[]
): Promise<void> {
  const amountsByAccount = groupUncommittableAmounts(poItems);

  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
    await updateSubAccount(projectId, subAccountId, (current) => ({
      committed: current.committed - amount,
      actual: current.actual,
    }));
  }
}

/**
 * Maneja el cambio de estado de una PO:
 * - Si pasa a estado que debe comprometer → suma a committed.
 * - Si pasa a rejected/cancelled → resta de committed SOLO la porción no realizada.
 * - Si tiene previousCommittedItems (edición de PO aprobada) → descompromete los
 *   items anteriores (respetando invoicedAmount) y compromete los nuevos.
 *
 * IMPORTANTE para el caller en el caso de edición (previousCommittedItems):
 * los items deben incluir el `invoicedAmount` actual de cada item para que
 * uncommitPO no reste importes que ya pasaron a `actual` vía facturas pagadas.
 */
export async function handlePOStatusChange(
  projectId: string,
  oldStatus: string,
  newStatus: string,
  poItems: BudgetItem[],
  previousCommittedItems?: BudgetItem[] | null
): Promise<void> {
  const costSettings = await getCostSettings(projectId);

  // Caso especial: edición de PO que tenía comprometido anterior.
  // previousCommittedItems DEBE llevar invoicedAmount por item para que
  // uncommitPO solo reste la porción no realizada.
  if (previousCommittedItems && previousCommittedItems.length > 0 && newStatus === "approved") {
    await uncommitPO(projectId, previousCommittedItems);
    await commitPO(projectId, poItems);
    return;
  }

  if (shouldCommitOnStatusChange(oldStatus, newStatus, costSettings)) {
    await commitPO(projectId, poItems);
    return;
  }

  // Al cancelar/rechazar, poItems debe llevar invoicedAmount por item.
  // uncommitPO solo restará baseAmount - invoicedAmount, preservando en
  // committed lo que ya pasó a actual mediante facturas realizadas.
  if (shouldUncommitPO(oldStatus, newStatus, costSettings)) {
    await uncommitPO(projectId, poItems);
    return;
  }
}

// ==================== OPERACIONES DE FACTURA ====================

/**
 * Realiza una factura: mueve de comprometido → realizado
 */
export async function realizeInvoice(
  projectId: string,
  invoiceItems: BudgetItem[]
): Promise<void> {
  const amountsByAccount = groupAmountsByAccount(invoiceItems);
  
  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
    await updateSubAccount(projectId, subAccountId, (current) => ({
      committed: current.committed - amount, // Resta de comprometido
      actual: current.actual + amount,        // Suma a realizado
    }));
  }
}

/**
 * Revierte la realización de una factura: mueve de realizado → comprometido
 */
export async function unrealizeInvoice(
  projectId: string,
  invoiceItems: BudgetItem[]
): Promise<void> {
  const amountsByAccount = groupAmountsByAccount(invoiceItems);
  
  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
    await updateSubAccount(projectId, subAccountId, (current) => ({
      committed: current.committed + amount, // Vuelve a comprometido
      actual: current.actual - amount,        // Resta de realizado
    }));
  }
}

/**
 * Maneja el cambio de estado de una factura
 * - Si pasa a estado que debe realizar → mueve de committed a actual
 * - Si pasa a rejected/void/cancelled → revierte (de actual a committed)
 */
export async function handleInvoiceStatusChange(
  projectId: string,
  oldStatus: string,
  newStatus: string,
  invoiceItems: BudgetItem[]
): Promise<void> {
  const costSettings = await getCostSettings(projectId);
  
  // ¿Hay que realizar?
  if (shouldRealizeOnStatusChange(oldStatus, newStatus, costSettings)) {
    await realizeInvoice(projectId, invoiceItems);
    return;
  }
  
  // ¿Hay que revertir la realización?
  if (shouldUnrealizeInvoice(oldStatus, newStatus, costSettings)) {
    await unrealizeInvoice(projectId, invoiceItems);
    return;
  }
}

// ==================== OPERACIONES DE ITEM INDIVIDUAL ====================

/**
 * Actualiza el comprometido cuando se modifica un item de PO
 * (útil cuando se edita una PO ya aprobada)
 */
export async function updateCommittedForItem(
  projectId: string,
  subAccountId: string,
  oldAmount: number,
  newAmount: number
): Promise<void> {
  const difference = newAmount - oldAmount;
  
  if (difference === 0 || !subAccountId) return;
  
  await updateSubAccount(projectId, subAccountId, (current) => ({
    committed: current.committed + difference,
    actual: current.actual,
  }));
}

/**
 * Cierra un item de PO: mueve el restante de comprometido a disponible
 * (resta del committed el importe no facturado)
 */
export async function closePoItem(
  projectId: string,
  subAccountId: string,
  uncommittedAmount: number
): Promise<void> {
  if (uncommittedAmount <= 0 || !subAccountId) return;
  
  await updateSubAccount(projectId, subAccountId, (current) => ({
    committed: current.committed - uncommittedAmount,
    actual: current.actual,
  }));
}

/**
 * Reabre un item de PO: vuelve a comprometer el importe
 */
export async function reopenPoItem(
  projectId: string,
  subAccountId: string,
  amountToRecommit: number
): Promise<void> {
  if (amountToRecommit <= 0 || !subAccountId) return;
  
  await updateSubAccount(projectId, subAccountId, (current) => ({
    committed: current.committed + amountToRecommit,
    actual: current.actual,
  }));
}

// ==================== OPERACIONES DE BOX (CAJA) ====================

interface BoxExpenseItem {
  subAccountCode: string;
  baseAmount: number;
}

/**
 * Busca subcuentas por código y actualiza el campo box usando transacciones atómicas.
 */
async function updateBoxByCode(
  projectId: string,
  amountsByCode: Record<string, number>,
  operation: "add" | "subtract"
): Promise<void> {
  const accountsSnapshot = await getDocs(collection(db, `projects/${projectId}/accounts`));

  // Recopilar todos los refs a actualizar antes de abrir transacciones
  const targets: { ref: DocumentReference; code: string }[] = [];
  for (const accountDoc of accountsSnapshot.docs) {
    const subAccountsSnapshot = await getDocs(
      collection(db, `projects/${projectId}/accounts/${accountDoc.id}/subaccounts`)
    );
    for (const subDoc of subAccountsSnapshot.docs) {
      const code = subDoc.data().code || "";
      if (amountsByCode[code]) {
        targets.push({
          ref: doc(db, `projects/${projectId}/accounts/${accountDoc.id}/subaccounts`, subDoc.id),
          code,
        });
      }
    }
  }

  // Una transacción por subcuenta afectada
  await Promise.all(
    targets.map(({ ref, code }) =>
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const currentBox = snap.data().box || 0;
        const newBox = operation === "add"
          ? currentBox + amountsByCode[code]
          : Math.max(0, currentBox - amountsByCode[code]);
        tx.update(ref, { box: newBox });
      })
    )
  );
}

/**
 * Realiza gastos de caja: suma directamente al "box" (sin pasar por comprometido)
 * Los gastos de caja van directamente a realizado cuando el sobre se cierra
 */
export async function realizeBoxExpenses(
  projectId: string,
  expenses: BoxExpenseItem[]
): Promise<void> {
  const amountsByCode: Record<string, number> = {};
  for (const exp of expenses) {
    if (exp.subAccountCode && exp.baseAmount > 0) {
      amountsByCode[exp.subAccountCode] = (amountsByCode[exp.subAccountCode] || 0) + exp.baseAmount;
    }
  }
  
  await updateBoxByCode(projectId, amountsByCode, "add");
}

/**
 * Revierte gastos de caja (cuando se reabre un sobre cerrado)
 */
export async function unrealizeBoxExpenses(
  projectId: string,
  expenses: BoxExpenseItem[]
): Promise<void> {
  const amountsByCode: Record<string, number> = {};
  for (const exp of expenses) {
    if (exp.subAccountCode && exp.baseAmount > 0) {
      amountsByCode[exp.subAccountCode] = (amountsByCode[exp.subAccountCode] || 0) + exp.baseAmount;
    }
  }
  
  await updateBoxByCode(projectId, amountsByCode, "subtract");
}

// ==================== OPERACIONES DE SOBRES DE TARJETA ====================

/**
 * Realiza un sobre de tarjeta completo
 * Suma todos los gastos del sobre al campo "box" de cada subcuenta
 */
export async function realizeCardEnvelope(
  projectId: string,
  envelopeId: string
): Promise<void> {
  const expensesSnapshot = await getDocs(
    collection(db, `projects/${projectId}/cardExpenses`)
  );
  
  const expenses: BoxExpenseItem[] = [];
  expensesSnapshot.docs.forEach(expDoc => {
    const expData = expDoc.data();
    if (expData.envelopeId === envelopeId && expData.subAccountCode) {
      expenses.push({
        subAccountCode: expData.subAccountCode,
        baseAmount: expData.baseAmount || 0,
      });
    }
  });
  
  await realizeBoxExpenses(projectId, expenses);
}

/**
 * Revierte un sobre de tarjeta (cuando se rechaza o reabre)
 */
export async function unrealizeCardEnvelope(
  projectId: string,
  envelopeId: string
): Promise<void> {
  const expensesSnapshot = await getDocs(
    collection(db, `projects/${projectId}/cardExpenses`)
  );
  
  const expenses: BoxExpenseItem[] = [];
  expensesSnapshot.docs.forEach(expDoc => {
    const expData = expDoc.data();
    if (expData.envelopeId === envelopeId && expData.subAccountCode) {
      expenses.push({
        subAccountCode: expData.subAccountCode,
        baseAmount: expData.baseAmount || 0,
      });
    }
  });
  
  await unrealizeBoxExpenses(projectId, expenses);
}

// ==================== OPERACIONES DE SOBRES DE TRANSFERENCIA ====================

/**
 * Realiza un sobre de transferencia completo
 * Suma todos los gastos del sobre al campo "box" de cada subcuenta
 */
export async function realizeTransferEnvelope(
  projectId: string,
  envelopeId: string
): Promise<void> {
  const expensesSnapshot = await getDocs(
    collection(db, `projects/${projectId}/transferExpenses`)
  );
  
  const expenses: BoxExpenseItem[] = [];
  expensesSnapshot.docs.forEach(expDoc => {
    const expData = expDoc.data();
    if (expData.envelopeId === envelopeId && expData.subAccountCode) {
      expenses.push({
        subAccountCode: expData.subAccountCode,
        baseAmount: expData.baseAmount || 0,
      });
    }
  });
  
  await realizeBoxExpenses(projectId, expenses);
}

/**
 * Revierte un sobre de transferencia (cuando se rechaza)
 */
export async function unrealizeTransferEnvelope(
  projectId: string,
  envelopeId: string
): Promise<void> {
  const expensesSnapshot = await getDocs(
    collection(db, `projects/${projectId}/transferExpenses`)
  );
  
  const expenses: BoxExpenseItem[] = [];
  expensesSnapshot.docs.forEach(expDoc => {
    const expData = expDoc.data();
    if (expData.envelopeId === envelopeId && expData.subAccountCode) {
      expenses.push({
        subAccountCode: expData.subAccountCode,
        baseAmount: expData.baseAmount || 0,
      });
    }
  });
  
  await unrealizeBoxExpenses(projectId, expenses);
}

// ==================== OPERACIONES DE PO ITEMS ====================

interface InvoiceItemForPO {
  poItemIndex?: number | null;
  baseAmount: number;
}

/**
 * Actualiza el invoicedAmount de cada item de una PO basándose en los items de una factura.
 * También actualiza el total invoicedAmount y remainingAmount de la PO.
 */
export async function updatePOItemsInvoiced(
  projectId: string,
  poId: string,
  invoiceItems: InvoiceItemForPO[],
  operation: "add" | "subtract" = "add"
): Promise<void> {
  const poRef = doc(db, `projects/${projectId}/pos`, poId);
  const poSnap = await getDoc(poRef);
  
  if (!poSnap.exists()) return;
  
  const poData = poSnap.data();
  const poItems = [...(poData.items || [])];
  let totalInvoicedDelta = 0;
  
  // Agrupar importes de factura por poItemIndex
  const amountsByIndex: Record<number, number> = {};
  for (const invItem of invoiceItems) {
    if (invItem.poItemIndex !== undefined && invItem.poItemIndex !== null && invItem.poItemIndex >= 0) {
      amountsByIndex[invItem.poItemIndex] = (amountsByIndex[invItem.poItemIndex] || 0) + invItem.baseAmount;
      totalInvoicedDelta += invItem.baseAmount;
    }
  }
  
  // Actualizar cada item de la PO
  for (const [indexStr, amount] of Object.entries(amountsByIndex)) {
    const index = parseInt(indexStr, 10);
    if (index >= 0 && index < poItems.length) {
      const currentInvoiced = poItems[index].invoicedAmount || 0;
      if (operation === "add") {
        poItems[index].invoicedAmount = currentInvoiced + amount;
      } else {
        poItems[index].invoicedAmount = Math.max(0, currentInvoiced - amount);
      }
    }
  }
  
  // Calcular nuevos totales de la PO
  const currentTotalInvoiced = poData.invoicedAmount || 0;
  const poBaseAmount = poData.baseAmount || 0;
  const newTotalInvoiced = operation === "add" 
    ? currentTotalInvoiced + totalInvoicedDelta
    : Math.max(0, currentTotalInvoiced - totalInvoicedDelta);
  
  await updateDoc(poRef, {
    items: poItems,
    invoicedAmount: newTotalInvoiced,
    remainingAmount: Math.max(0, poBaseAmount - newTotalInvoiced),
  });
}
