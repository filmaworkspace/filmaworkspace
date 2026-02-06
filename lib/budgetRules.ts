import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface CostSettings {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_approve" | "on_paid";
}

const DEFAULT_SETTINGS: CostSettings = {
  poCommitmentTrigger: "on_approve",
  invoiceActualTrigger: "on_paid",
};

export async function getCostSettings(projectId: string): Promise<CostSettings> {
  try {
    const costConfigRef = doc(db, `projects/${projectId}/config/cost`);
    const costConfigSnap = await getDoc(costConfigRef);
    
    if (costConfigSnap.exists()) {
      const data = costConfigSnap.data();
      return {
        poCommitmentTrigger: data.poCommitmentTrigger || DEFAULT_SETTINGS.poCommitmentTrigger,
        invoiceActualTrigger: data.invoiceActualTrigger || DEFAULT_SETTINGS.invoiceActualTrigger,
      };
    }
    
    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Error loading cost settings:", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Determina si una PO debe comprometer presupuesto según su estado y la configuración
 */
export function shouldCommitPO(
  poStatus: string,
  costSettings: CostSettings
): boolean {
  if (poStatus === "draft" || poStatus === "rejected" || poStatus === "cancelled") {
    return false;
  }
  
  if (costSettings.poCommitmentTrigger === "on_create") {
    return poStatus === "pending" || poStatus === "approved";
  }
  
  // on_approve
  return poStatus === "approved";
}

/**
 * Determina si una factura debe pasar a realizado según su estado y la configuración
 */
export function shouldRealizeInvoice(
  invoiceStatus: string,
  costSettings: CostSettings
): boolean {
  if (invoiceStatus === "draft" || invoiceStatus === "rejected" || invoiceStatus === "void") {
    return false;
  }
  
  if (costSettings.invoiceActualTrigger === "on_approve") {
    return invoiceStatus === "approved" || invoiceStatus === "paid";
  }
  
  // on_paid
  return invoiceStatus === "paid";
}
