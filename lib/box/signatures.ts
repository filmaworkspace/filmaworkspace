// ─── Firmas de caja en la app ────────────────────────────────────────────────
// Opcional. Desde el ordenador, en Efectivo o en Transferencias, «Firmar en
// app» deja una solicitud: la persona que recibe dinero o entrega tickets firma
// en el móvil del cajero, que ve el nombre, el importe y si recibe o entrega.
// La firma queda en la solicitud y en el movimiento o sobre, y sale en el vale.

import {
  addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type SignKind = "cash" | "transfer";
/** Desde el punto de vista de la persona que firma. */
export type SignDirection = "receives" | "delivers";
/** Qué se firma. */
export type SignMoment =
  | "cash_advance" | "cash_return" | "cash_reimbursement" | "cash_settlement"
  | "transfer_advance" | "transfer_tickets" | "transfer_settlement";

export const MOMENT_LABEL: Record<SignMoment, string> = {
  cash_advance: "Anticipo en efectivo",
  cash_return: "Devolución de anticipo",
  cash_reimbursement: "Reembolso",
  cash_settlement: "Entrega de tickets",
  transfer_advance: "Anticipo",
  transfer_tickets: "Entrega de tickets",
  transfer_settlement: "Liquidación",
};

export interface SignatureData {
  image: string;          // PNG en data URL
  signedAt: Date | null;
  cashierName: string;    // quién tenía el móvil
  requestId: string;
}

export interface BoxSignatureRequest {
  id: string;
  projectId: string;
  kind: SignKind;
  moment: SignMoment;
  direction: SignDirection;
  personName: string;
  personDepartment?: string;
  amount: number;
  detail: string;         // "4 tickets · CP-0012"
  reference: string;      // nº de vale o de sobre
  sourceId: string;       // cashMovements/{id} o transferEnvelopes/{id}
  status: "pending" | "signed" | "cancelled";
  requestedAt: Date | null;
  requestedByName: string;
  signedAt?: Date | null;
  image?: string;
  cashierName?: string;
  projectName?: string;
}

const col = (projectId: string) => collection(db, `projects/${projectId}/boxSignatures`);
const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

export function fromDoc(projectId: string, id: string, d: any): BoxSignatureRequest {
  return {
    id, projectId, kind: d.kind, moment: d.moment, direction: d.direction, personName: d.personName || "", personDepartment: d.personDepartment || "",
    amount: Number(d.amount) || 0, detail: d.detail || "", reference: d.reference || "", sourceId: d.sourceId, status: d.status || "pending",
    requestedAt: toDate(d.requestedAt), requestedByName: d.requestedByName || "", signedAt: toDate(d.signedAt), image: d.image, cashierName: d.cashierName,
  };
}

/** Dónde se guarda la firma en el origen. Transferencias: una por momento. */
const sourceRef = (projectId: string, kind: SignKind, sourceId: string) =>
  doc(db, `projects/${projectId}/${kind === "cash" ? "cashMovements" : "transferEnvelopes"}`, sourceId);
// Efectivo: signature / signatureRequest. Transferencias: signatures.<momento> / signatureRequests.<momento>.
const sourceField = (kind: SignKind, moment: SignMoment) => (kind === "cash" ? "signature" : `signatures.${moment}`);
const requestField = (kind: SignKind, moment: SignMoment) => (kind === "cash" ? "signatureRequest" : `signatureRequests.${moment}`);

/** Crea la solicitud (si ya hay una pendiente para lo mismo, la devuelve). */
export async function requestSignature(projectId: string, r: Omit<BoxSignatureRequest, "id" | "projectId" | "status" | "requestedAt" | "requestedByName">, by: { uid: string; name: string }) {
  const existing = await getDocs(query(col(projectId), where("sourceId", "==", r.sourceId), where("moment", "==", r.moment), where("status", "==", "pending")));
  if (!existing.empty) return existing.docs[0].id;
  const ref = await addDoc(col(projectId), { ...r, status: "pending", requestedAt: serverTimestamp(), requestedBy: by.uid, requestedByName: by.name });
  await updateDoc(sourceRef(projectId, r.kind, r.sourceId), { [requestField(r.kind, r.moment)]: { id: ref.id, status: "pending", at: Timestamp.now() } });
  return ref.id;
}

export async function cancelSignature(projectId: string, req: Pick<BoxSignatureRequest, "id" | "kind" | "moment" | "sourceId">) {
  const b = writeBatch(db);
  b.update(doc(db, `projects/${projectId}/boxSignatures`, req.id), { status: "cancelled", cancelledAt: serverTimestamp() });
  b.update(sourceRef(projectId, req.kind, req.sourceId), { [requestField(req.kind, req.moment)]: null });
  await b.commit();
}

/** Guarda la firma en la solicitud y en el movimiento o sobre. */
export async function signRequest(projectId: string, requestId: string, image: string, cashier: { uid: string; name: string }) {
  const reqRef = doc(db, `projects/${projectId}/boxSignatures`, requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) throw new Error("La solicitud ya no existe");
  const r = snap.data();
  if (r.status !== "pending") throw new Error(r.status === "signed" ? "Ya está firmada" : "La solicitud se ha cancelado");
  const now = Timestamp.now();
  const sig = { image, signedAt: now, cashierName: cashier.name, cashierId: cashier.uid, requestId };
  const b = writeBatch(db);
  b.update(reqRef, { status: "signed", image, signedAt: now, cashierName: cashier.name, cashierId: cashier.uid });
  const field = sourceField(r.kind, r.moment);
  b.update(sourceRef(projectId, r.kind, r.sourceId), { [field]: sig, [requestField(r.kind, r.moment)]: { id: requestId, status: "signed", at: now } });
  await b.commit();
}

export const directionLabel = (d: SignDirection) => (d === "receives" ? "Recibe" : "Entrega");
