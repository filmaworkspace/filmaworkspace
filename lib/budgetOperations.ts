import { doc, getDoc, getDocs, collection, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getCostSettings, shouldRealizeInvoice } from "./budgetRules";

/**
 * Mueve importe de comprometido → realizado cuando una factura cambia de estado
 */
export async function realizeInvoice(
  projectId: string,
  invoiceItems: Array<{ subAccountId: string; baseAmount: number }>
) {
  const amountsByAccount: Record<string, number> = {};
  
  for (const item of invoiceItems) {
    if (item.subAccountId && item.baseAmount > 0) {
      amountsByAccount[item.subAccountId] = 
        (amountsByAccount[item.subAccountId] || 0) + item.baseAmount;
    }
  }

  const accountsSnapshot = await getDocs(collection(db, `projects/${projectId}/accounts`));
  
  for (const [subAccountId, amount] of Object.entries(amountsByAccount)) {
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
          
          // Mover de comprometido → realizado
          await updateDoc(subAccountRef, {
            committed: Math.max(0, currentCommitted - amount),
            actual: currentActual + amount,
          });
          break;
        }
      } catch (e) {
        console.error(`Error updating subaccount ${subAccountId}:`, e);
      }
    }
  }
}

/**
 * Llama a esto cuando una factura cambie de estado
 */
export async function handleInvoiceStatusChange(
  projectId: string,
  invoiceId: string,
  newStatus: string,
  invoiceItems: Array<{ subAccountId: string; baseAmount: number }>
) {
  const costSettings = await getCostSettings(projectId);
  
  if (shouldRealizeInvoice(newStatus, costSettings)) {
    await realizeInvoice(projectId, invoiceItems);
  }
}
