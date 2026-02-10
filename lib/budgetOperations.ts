import { doc, getDoc, getDocs, collection, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { 
  getCostSettings, 
  shouldCommitOnStatusChange, 
  shouldUncommitPO,
  shouldRealizeOnStatusChange,
  shouldUnrealizeInvoice 
} from "./budgetRules";

interface BudgetItem {
  subAccountId: string;
  baseAmount: number;
}

/**
 * Busca y actualiza una subcuenta en el presupuesto
 */
async function updateSubAccount(
  projectId: string,
  subAccountId: string,
  updateFn: (currentData: { committed: number; actual: number }) => { committed: number; actual: number }
): Promise<boolean> {
  if (!subAccountId) return false;
  
  const accountsSnapshot = await getDocs(collection(db, `projects/${projectId}/accounts`));
  
  for (const accountDoc of accountsSnapshot.docs) {
    try {
      const subAccountRef = doc(
        db,
        `projects/${projectId}/accounts/${accountDoc.id}/subaccounts`,
        subAccountId
      );
      const subAccountSnap = await getDoc(subAccountRef);
      
      if (subAccountSnap.exists()) {
        const data = subAccountSnap.data();
        const currentCommitted = data.committed || 0;
        const currentActual = data.actual || 0;
        
        const newValues = updateFn({ committed: currentCommitted, actual: currentActual });
        
        await updateDoc(subAccountRef, {
          committed: Math.max(0, newValues.committed),
          actual: Math.max(0, newValues.actual),
        });
        
        return true;
      }
    } catch (e) {
      console.error(`Error updating subaccount ${subAccountId}:`, e);
    }
  }
  
  return false;
}

/**
 * Agrupa items por subAccountId y suma los importes
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
 * Descompromete presupuesto de una PO (resta de committed)
 */
export async function uncommitPO(
  projectId: string,
  poItems: BudgetItem[]
): Promise<void> {
  const amountsByAccount = groupAmountsByAccount(poItems);
  
  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
    await updateSubAccount(projectId, subAccountId, (current) => ({
      committed: current.committed - amount,
      actual: current.actual,
    }));
  }
}

/**
 * Maneja el cambio de estado de una PO
 * - Si pasa a estado que debe comprometer → suma a committed
 * - Si pasa a rejected/cancelled → resta de committed
 * - Si tiene previousCommittedItems (edición de PO aprobada), hace la diferencia
 */
export async function handlePOStatusChange(
  projectId: string,
  oldStatus: string,
  newStatus: string,
  poItems: BudgetItem[],
  previousCommittedItems?: BudgetItem[] | null
): Promise<void> {
  const costSettings = await getCostSettings(projectId);
  
  // Caso especial: edición de PO que tenía comprometido anterior
  if (previousCommittedItems && previousCommittedItems.length > 0 && newStatus === "approved") {
    // Descomprometer los items anteriores
    await uncommitPO(projectId, previousCommittedItems);
    // Comprometer los nuevos items
    await commitPO(projectId, poItems);
    return;
  }
  
  // ¿Hay que comprometer?
  if (shouldCommitOnStatusChange(oldStatus, newStatus, costSettings)) {
    await commitPO(projectId, poItems);
    return;
  }
  
  // ¿Hay que descomprometer?
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
