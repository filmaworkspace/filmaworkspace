import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface CostSettings {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_code" | "on_account" | "on_create" | "on_approve" | "on_paid";
}

const DEFAULT_SETTINGS: CostSettings = {
  poCommitmentTrigger: "on_approve",
  invoiceActualTrigger: "on_account",
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
      const rawInvoice = data.invoiceActualTrigger || DEFAULT_SETTINGS.invoiceActualTrigger;
      const migratedInvoice = rawInvoice === "on_paid" ? "on_account"
        : rawInvoice === "on_approve" ? "on_code"
        : rawInvoice;
      return {
        poCommitmentTrigger: data.poCommitmentTrigger || DEFAULT_SETTINGS.poCommitmentTrigger,
        invoiceActualTrigger: migratedInvoice as CostSettings["invoiceActualTrigger"],
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
 * 
 * Estados de factura:
 * - draft: borrador (nunca realiza)
 * - pending_approval: pendiente de aprobación (nunca realiza)
 * - pending: aprobada, pendiente de pago (realiza si config es on_approve)
 * - approved: aprobada (realiza si config es on_approve) - estado alternativo
 * - accounted: contabilizada (realiza si config es on_approve o on_account)
 * - paid: pagada (siempre realiza)
 * - cancelled/rejected/void: anulada/rechazada (nunca realiza)
 */
export interface InvoiceTracks {
  codedAt?: any;
  accountedAt?: any;
  paidAt?: any;
  approvedAt?: any;
}

export function shouldRealizeInvoice(
  invoiceStatus: string,
  costSettings: CostSettings,
  tracks?: InvoiceTracks
): boolean {
  // Nunca realizar en estos estados
  if (invoiceStatus === "draft" || invoiceStatus === "pending_approval" ||
      invoiceStatus === "rejected" || invoiceStatus === "void" || invoiceStatus === "cancelled") {
    return false;
  }

  if (costSettings.invoiceActualTrigger === "on_create") {
    // submitted o cualquier estado activo (excepto los anulados ya filtrados arriba)
    return invoiceStatus !== "draft" &&
           invoiceStatus !== "rejected" &&
           invoiceStatus !== "void" &&
           invoiceStatus !== "cancelled";
  }

  if (costSettings.invoiceActualTrigger === "on_code") {
    // Nuevo modelo: realizar cuando existe codedAt. La página de presupuesto y los
    // flujos de cancelación comprueban codedAt directamente; aquí mantenemos compat
    // con valores de status antiguos.
    if (tracks?.codedAt || tracks?.accountedAt || tracks?.paidAt) return true;
    return invoiceStatus === "coded" || invoiceStatus === "accounted" || invoiceStatus === "paid";
  }

  if (costSettings.invoiceActualTrigger === "on_approve") {
    // Legado → migrado a on_code, mismo comportamiento
    if (tracks?.codedAt || tracks?.accountedAt || tracks?.paidAt || tracks?.approvedAt) return true;
    return invoiceStatus === "coded" || invoiceStatus === "pending" || invoiceStatus === "approved" ||
           invoiceStatus === "accounted" || invoiceStatus === "paid";
  }

  if (costSettings.invoiceActualTrigger === "on_account") {
    // Nuevo modelo: realizar cuando existe accountedAt; compat con status antiguos.
    if (tracks?.accountedAt || tracks?.paidAt) return true;
    return invoiceStatus === "accounted" || invoiceStatus === "paid";
  }

  // on_paid: legado
  if (tracks?.paidAt) return true;
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

// ==================== BOX EXPENSES ====================

/**
 * Determina si un gasto de caja (BOX) debe contar como realizado
 * Los gastos de caja se realizan cuando el sobre está cerrado (status: accounted)
 */
export function shouldRealizeBoxExpense(expenseStatus: string): boolean {
  return expenseStatus === "accounted";
}

// ==================== CARD ENVELOPES (SOBRES DE TARJETA) ====================

/**
 * Determina si un sobre de tarjeta debe afectar al presupuesto
 * Solo cuando el sobre está cerrado (closed) y aprobado
 */
export function shouldRealizeCardEnvelope(envelopeStatus: string): boolean {
  return envelopeStatus === "closed";
}

/**
 * Determina si un sobre de tarjeta necesita aprobación
 * Los sobres en estado "pending_approval" requieren aprobación
 */
export function cardEnvelopeNeedsApproval(envelopeStatus: string): boolean {
  return envelopeStatus === "pending_approval";
}

// ==================== TRANSFER ENVELOPES (SOBRES DE TRANSFERENCIA) ====================

/**
 * Determina si un sobre de transferencia debe afectar al presupuesto
 * Solo cuando el sobre está transferido
 */
export function shouldRealizeTransferEnvelope(envelopeStatus: string): boolean {
  return envelopeStatus === "transferred";
}

/**
 * Determina si un sobre de transferencia necesita aprobación
 * Los sobres en estado "pending" (enviados) requieren aprobación
 */
export function transferEnvelopeNeedsApproval(envelopeStatus: string): boolean {
  return envelopeStatus === "pending";
}
