import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface CostSettings {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_approve" | "on_account" | "on_paid";
}

const DEFAULT_SETTINGS: CostSettings = {
  poCommitmentTrigger: "on_approve",
  invoiceActualTrigger: "on_paid",
};

/**
 * Obtiene la configuración de costes del proyecto
 */
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
  // Nunca comprometer en estos estados
  if (poStatus === "draft" || poStatus === "rejected" || poStatus === "cancelled") {
    return false;
  }
  
  if (costSettings.poCommitmentTrigger === "on_create") {
    // Comprometer cuando se crea (pending) o cuando se aprueba
    return poStatus === "pending" || poStatus === "approved";
  }
  
  // on_approve: solo comprometer cuando está aprobada
  return poStatus === "approved";
}

/**
 * Determina si una PO debe descomprometer (quitar del comprometido)
 * Esto ocurre cuando una PO pasa a rechazada o cancelada
 */
export function shouldUncommitPO(
  oldStatus: string,
  newStatus: string,
  costSettings: CostSettings
): boolean {
  // Si el nuevo estado es rejected o cancelled, hay que descomprometer
  if (newStatus !== "rejected" && newStatus !== "cancelled") {
    return false;
  }
  
  // Solo descomprometer si antes estaba comprometida
  return shouldCommitPO(oldStatus, costSettings);
}

/**
 * Determina si una PO necesita comprometer al cambiar de estado
 * (por ejemplo, de pending a approved cuando la config es on_approve)
 */
export function shouldCommitOnStatusChange(
  oldStatus: string,
  newStatus: string,
  costSettings: CostSettings
): boolean {
  const wasCommitted = shouldCommitPO(oldStatus, costSettings);
  const shouldBeCommitted = shouldCommitPO(newStatus, costSettings);
  
  // Solo comprometer si antes no estaba comprometida y ahora sí debe estarlo
  return !wasCommitted && shouldBeCommitted;
}

/**
 * Determina si una factura debe pasar a realizado según su estado y la configuración
 */
export function shouldRealizeInvoice(
  invoiceStatus: string,
  costSettings: CostSettings
): boolean {
  // Nunca realizar en estos estados
  if (invoiceStatus === "draft" || invoiceStatus === "rejected" || invoiceStatus === "void" || invoiceStatus === "cancelled") {
    return false;
  }
  
  if (costSettings.invoiceActualTrigger === "on_approve") {
    // Realizar cuando se aprueba, contabiliza o paga
    return invoiceStatus === "approved" || invoiceStatus === "accounted" || invoiceStatus === "paid";
  }
  
  if (costSettings.invoiceActualTrigger === "on_account") {
    // Realizar cuando se contabiliza o paga
    return invoiceStatus === "accounted" || invoiceStatus === "paid";
  }
  
  // on_paid: solo realizar cuando está pagada
  return invoiceStatus === "paid";
}

/**
 * Determina si una factura necesita realizarse al cambiar de estado
 */
export function shouldRealizeOnStatusChange(
  oldStatus: string,
  newStatus: string,
  costSettings: CostSettings
): boolean {
  const wasRealized = shouldRealizeInvoice(oldStatus, costSettings);
  const shouldBeRealized = shouldRealizeInvoice(newStatus, costSettings);
  
  // Solo realizar si antes no estaba realizada y ahora sí debe estarlo
  return !wasRealized && shouldBeRealized;
}

/**
 * Determina si una factura debe revertir el realizado (quitar del actual)
 * Esto ocurre cuando una factura pasa a rechazada o anulada
 */
export function shouldUnrealizeInvoice(
  oldStatus: string,
  newStatus: string,
  costSettings: CostSettings
): boolean {
  // Si el nuevo estado es rejected, void o cancelled, hay que desrealizar
  if (newStatus !== "rejected" && newStatus !== "void" && newStatus !== "cancelled") {
    return false;
  }
  
  // Solo desrealizar si antes estaba realizada
  return shouldRealizeInvoice(oldStatus, costSettings);
}
