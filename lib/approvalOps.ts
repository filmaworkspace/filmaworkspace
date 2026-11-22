// ─── Aprobar, rechazar y pedir información ───────────────────────────────────
// Lo mismo desde la bandeja de escritorio y desde el móvil. Todo en
// transacción (dos personas a la vez no se pisan; si el documento ya no está
// pendiente, se avisa) y, al terminar, el presupuesto se recalcula.

import { doc, runTransaction, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { applyApproval, applyRejection, stripUndefined } from "@/lib/approvalFlow";
import { syncBudget } from "@/lib/ledgerClient";
import type { PendingKind } from "@/lib/myPending";

const COLLECTION: Record<PendingKind, string> = { po: "pos", invoice: "invoices", card: "cardEnvelopes", transfer: "transferEnvelopes" };
export interface Actor { uid: string; name: string }
type AnyDoc = Record<string, any>;

function assertPending(kind: PendingKind, d: AnyDoc) {
  if (kind === "po" && d.status !== "pending") throw new Error("La PO ya no está pendiente de aprobación");
  if (kind === "invoice" && (d.approvedAt || d.status === "rejected" || d.approvalStatus === "rejected" || d.status === "cancelled")) throw new Error("La factura ya no está pendiente de aprobación");
  if ((kind === "card" || kind === "transfer") && d.status !== "pending_approval") throw new Error("El sobre ya no está pendiente de aprobación");
}

/** Aprueba el nivel actual. Devuelve si el documento queda aprobado del todo. */
export async function approveDoc(projectId: string, kind: PendingKind, id: string, actor: Actor, comment = ""): Promise<{ complete: boolean }> {
  const ref = doc(db, `projects/${projectId}/${COLLECTION[kind]}`, id);
  const at = Timestamp.now();
  const complete = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("El documento ya no existe");
    const d = snap.data();
    assertPending(kind, d);
    const r = applyApproval(d as never, actor.uid, actor.name, at);
    const upd: AnyDoc = { approvalSteps: stripUndefined(r.steps), currentApprovalStep: r.currentApprovalStep };
    if (comment.trim()) upd.comments = [...(d.comments || []), { id: `comment-${Date.now()}`, userId: actor.uid, userName: actor.name, text: comment.trim(), createdAt: at, type: "approval" }];
    if (r.complete) {
      upd.approvedAt = at; upd.approvedBy = actor.uid; upd.approvedByName = actor.name;
      if (kind === "po") {
        const base = (d.items || []).reduce((t: number, it: AnyDoc) => t + (it.baseAmount || (it.quantity && it.unitPrice ? it.quantity * it.unitPrice : 0)), 0) || d.baseAmount || 0;
        Object.assign(upd, { status: "approved", committedAmount: base, remainingAmount: base, previousCommittedItems: null });
      } else if (kind === "invoice") {
        Object.assign(upd, { status: "submitted", approvalStatus: "approved" });
      } else {
        upd.status = kind === "card" ? "reviewing" : "pending";
      }
    }
    tx.update(ref, upd);
    return r.complete;
  });
  if (complete) await syncBudget(projectId);
  return { complete };
}

/** Rechaza: el nivel actual y el documento quedan rechazados, con motivo. */
export async function rejectDoc(projectId: string, kind: PendingKind, id: string, actor: Actor, reason: string) {
  if (!reason.trim()) throw new Error("Escribe el motivo del rechazo");
  const ref = doc(db, `projects/${projectId}/${COLLECTION[kind]}`, id);
  const at = Timestamp.now();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("El documento ya no existe");
    const d = snap.data();
    assertPending(kind, d);
    const upd: AnyDoc = {
      // Los sobres vuelven a abiertos (tarjeta) o borrador (transferencia).
      status: kind === "card" ? "open" : kind === "transfer" ? "draft" : "rejected",
      rejectedAt: at, rejectedBy: actor.uid, rejectedByName: actor.name, rejectionReason: reason.trim(),
      // previousCommittedItems se conserva: si era la modificación de una PO
      // aprobada, la versión aprobada sigue comprometida.
    };
    if ((d.approvalSteps || []).length) upd.approvalSteps = stripUndefined(applyRejection(d as never, actor.uid, actor.name, at).steps);
    if (kind === "invoice") upd.approvalStatus = "rejected";
    tx.update(ref, upd);
  });
  if (kind === "po" || kind === "invoice") await syncBudget(projectId);
}

/** Pide información a quien creó el documento (queda como comentario). */
export async function requestInfo(projectId: string, kind: PendingKind, id: string, actor: Actor, message: string) {
  if (!message.trim()) throw new Error("Escribe qué información necesitas");
  const ref = doc(db, `projects/${projectId}/${COLLECTION[kind]}`, id);
  const at = Timestamp.now();
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("El documento ya no existe");
    const d = snap.data();
    tx.update(ref, {
      comments: [...(d.comments || []), { id: `info-request-${Date.now()}`, userId: actor.uid, userName: actor.name, text: message.trim(), createdAt: at, type: "info_request" }],
      infoRequested: true, infoRequestedBy: actor.uid, infoRequestedAt: at,
    });
  });
}
