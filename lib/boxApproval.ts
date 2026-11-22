// ─── Aprobación de sobres de caja ────────────────────────────────────────────
// Usa los niveles de "Sobres de caja" de Ajustes › Aprobaciones (boxApprovals)
// con las mismas reglas que POs y facturas (lib/approvalFlow).
//  · Tarjeta: al cerrar el sobre. Transferencia: al liquidarlo.
//  · Si no hay niveles, o todos se omiten, se sigue como siempre.
//  · Si el importe cambia después de aprobarlo, hay que volver a aprobar.

import { collection, doc, getDoc, getDocs, Timestamp, updateDoc, deleteField } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildFlow, stripUndefined, type ApprovalStepConfig, type FlowMember } from "@/lib/approvalFlow";

export type EnvelopeKind = "card" | "transfer";
const COLL: Record<EnvelopeKind, string> = { card: "cardEnvelopes", transfer: "transferEnvelopes" };

type Env = Record<string, any> & { id: string };

/** ¿Está aprobado para el importe actual? */
export function envelopeApproved(env: Env) {
  if (!env.approvedAt) return false;
  const base = Number(env.totalBase) || 0;
  return env.approvalBase === undefined || Math.abs((Number(env.approvalBase) || 0) - base) < 0.005;
}

/**
 * Manda el sobre a aprobación si hace falta. Devuelve true si se ha enviado
 * (y entonces no se debe cerrar ni liquidar todavía).
 */
export async function sendEnvelopeToApproval(projectId: string, kind: EnvelopeKind, env: Env, department: string | undefined, actor: { uid: string; name: string }): Promise<boolean> {
  if (envelopeApproved(env)) return false;
  const [cfg, mem] = await Promise.all([
    getDoc(doc(db, `projects/${projectId}/config/approvals`)),
    getDocs(collection(db, `projects/${projectId}/members`)),
  ]);
  const config = ((cfg.exists() ? cfg.data().boxApprovals : null) || []) as ApprovalStepConfig[];
  if (!config.length) return false;
  const members: FlowMember[] = mem.docs.map((m) => {
    const d = m.data();
    return { userId: m.id, name: d.name || d.email || m.id, email: d.email, role: d.role || null, position: d.position || null, department: d.department || null, permissions: d.permissions || null, accountingAccessLevel: d.accountingAccessLevel || null };
  });
  const base = Number(env.totalBase) || 0;
  const flow = buildFlow(config, members, { department: department || "", baseAmount: base });
  if (flow.complete) return false; // todos los niveles se omiten
  const at = Timestamp.now();
  await updateDoc(doc(db, `projects/${projectId}/${COLL[kind]}`, env.id), {
    status: "pending_approval",
    approvalSteps: stripUndefined(flow.steps),
    currentApprovalStep: flow.currentApprovalStep,
    approverIds: flow.approverIds,
    approvalBase: base,
    sentToApprovalAt: at, sentToApprovalBy: actor.uid, sentToApprovalByName: actor.name,
    approvedAt: deleteField(), approvedBy: deleteField(), approvedByName: deleteField(),
    rejectedAt: deleteField(), rejectedBy: deleteField(), rejectedByName: deleteField(), rejectionReason: deleteField(),
  });
  return true;
}
