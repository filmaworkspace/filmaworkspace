// Modificar (revisar) una PO en cualquier estado. Pasa a borrador con una
// versión nueva; mientras se edita y aprueba, la versión vigente sigue
// contando en el presupuesto (previousCommittedItems, ver lib/budgetLedger).
import { deleteField, doc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { syncBudget } from "@/lib/ledgerClient";

type AnyPO = Record<string, any> & { id: string };

/** Lo que la versión vigente tiene comprometido por línea (índice = ítem). */
export function previousCommittedFor(po: AnyPO) {
  if (po.previousCommittedItems?.length) return po.previousCommittedItems; // ya en modificación
  const live = po.status === "approved" || po.status === "pending";
  const finished = po.status === "closed" || po.status === "cancelled";
  if (!live && !finished) return null; // borrador/rechazada: nada vigente
  return (po.items || []).map((it: AnyPO, index: number) => {
    const base = Number(it.baseAmount) || 0;
    // Línea o PO cerrada: solo cuenta lo ya facturado (el resto se liberó).
    const effective = finished || it.isClosed ? Math.min(base, Number(it.invoicedAmount) || 0) : base;
    return { index, subAccountId: it.subAccountId || "", subAccountCode: it.subAccountCode || "", baseAmount: effective, invoicedAmount: Number(it.invoicedAmount) || 0 };
  });
}

/** ¿Hace falta abrir versión nueva? (borrador o rechazada se editan sin más) */
export const needsNewVersion = (po: AnyPO) => !["draft", "rejected"].includes(po.status);

export async function revisePO(projectId: string, po: AnyPO, actor: { uid: string; name: string }, reason: string) {
  const prev = previousCommittedFor(po);
  await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
    version: (po.version || 1) + 1,
    status: "draft",
    modificationHistory: [
      ...(po.modificationHistory || []),
      { date: Timestamp.now(), userId: actor.uid, userName: actor.name, reason, previousVersion: po.version || 1, fromStatus: po.status },
    ],
    previousCommittedItems: prev?.length ? prev : deleteField(),
    approvedAt: deleteField(), approvedBy: deleteField(), approvedByName: deleteField(),
    approvalSteps: deleteField(), approverIds: [], currentApprovalStep: deleteField(),
    closedAt: null, closedBy: null, closedByName: null,
    cancelledAt: null, cancelledBy: null, cancelledByName: null, cancellationReason: null,
    rejectedAt: null, rejectedBy: null, rejectedByName: null, rejectionReason: null,
  });
  await syncBudget(projectId);
}
