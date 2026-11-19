// ─── Acciones sobre el flujo de aprobación (cliente, Firestore) ──────────────
// Todas pasan por updateFlow: transacción sobre el documento, registro en
// approvalLog (quién, qué, cuándo, motivo) y, si el cambio deja el documento
// aprobado, aplica los efectos de presupuesto una sola vez.

import { arrayUnion, doc, getDoc, getDocs, collection, runTransaction, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  approverIdsOf, buildFlow, rebuildFlow, repairFlow, stepComplete, stripUndefined,
  type ApprovalStepConfig, type ApprovalStepState, type FlowMember,
} from "@/lib/approvalFlow";
import { syncBudget } from "@/lib/ledgerClient";

export type FlowDocType = "po" | "invoice";
export const FLOW_COLLECTION: Record<FlowDocType, string> = { po: "pos", invoice: "invoices" };

export interface FlowActor { uid: string; name: string; admin?: boolean }

export type FlowAction =
  | "repair" | "rebuild" | "reassign" | "skip" | "force_approve" | "resume" | "approve" | "reject";

export const FLOW_ACTION_LABEL: Record<FlowAction, string> = {
  repair: "Flujo reparado", rebuild: "Flujo recalculado", reassign: "Aprobadores cambiados", skip: "Nivel omitido",
  force_approve: "Aprobación forzada", resume: "Flujo reanudado", approve: "Aprobado", reject: "Rechazado",
};

type AnyDoc = Record<string, any>;

/** ¿Está el documento esperando aprobación? */
export function isAwaitingApproval(type: FlowDocType, d: AnyDoc) {
  if (type === "po") return d.status === "pending";
  return !d.approvedAt && d.approvalStatus === "pending" && d.status !== "rejected" && !d.delegatedToAccounting;
}
export function isRejected(type: FlowDocType, d: AnyDoc) {
  return type === "po" ? d.status === "rejected" : d.status === "rejected" || d.approvalStatus === "rejected";
}

const itemBase = (it: AnyDoc) => it.baseAmount || (it.quantity && it.unitPrice ? it.quantity * it.unitPrice : 0);

/** Campos que se escriben cuando el flujo termina. */
function completionFields(type: FlowDocType, d: AnyDoc, at: Timestamp, actor: FlowActor) {
  const f: AnyDoc = { approvedAt: at, approvedBy: actor.uid, approvedByName: actor.name, currentApprovalStep: -1 };
  if (type === "po") {
    const base = (d.items || []).reduce((t: number, it: AnyDoc) => t + itemBase(it), 0) || d.baseAmount || 0;
    Object.assign(f, { status: "approved", committedAmount: base, remainingAmount: base, previousCommittedItems: null });
  } else {
    Object.assign(f, { status: "submitted", approvalStatus: "approved" });
  }
  return f;
}

/** Al quedar aprobado: el presupuesto se recalcula desde los documentos (lib/budgetLedger). */
export async function afterApprovalComplete(projectId: string, _type?: FlowDocType, _before?: AnyDoc, _at?: Timestamp) {
  await syncBudget(projectId);
}

export interface FlowChange {
  steps: ApprovalStepState[];
  /** Si no se da, se calcula: primer paso pendiente. */
  currentApprovalStep?: number;
  /** Personas que deben conservar acceso aunque ya no estén en el flujo. */
  keepAccess?: string[];
}

/**
 * Aplica un cambio al flujo de un documento dentro de una transacción.
 * `change` recibe el documento tal y como está ahora (no una copia antigua).
 */
export async function updateFlow(
  projectId: string, type: FlowDocType, docId: string,
  change: (d: AnyDoc) => FlowChange | null,
  log: { action: FlowAction; actor: FlowActor; note?: string; detail?: string },
): Promise<{ complete: boolean; resumed: boolean; changed: boolean }> {
  const ref = doc(db, `projects/${projectId}/${FLOW_COLLECTION[type]}`, docId);
  const at = Timestamp.now();
  const res = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("El documento ya no existe");
    const d = snap.data();
    const c = change(d);
    if (!c) return { complete: false, resumed: false, changed: false, before: d };
    const steps = c.steps;
    const current = c.currentApprovalStep ?? steps.findIndex((s) => s.status === "pending");
    const complete = current === -1 && !steps.some((s) => s.status === "rejected");
    const wasRejected = isRejected(type, d);
    const wasAwaiting = isAwaitingApproval(type, d);
    const upd: AnyDoc = {
      approvalSteps: stripUndefined(steps),
      currentApprovalStep: current,
      // Quien ya estaba conserva acceso de lectura (puede haber firmado).
      approverIds: [...new Set([...(d.approverIds || []), ...approverIdsOf(steps), ...(c.keepAccess || [])])],
      approvalLog: arrayUnion(stripUndefined({ action: log.action, by: log.actor.uid, byName: log.actor.name, admin: !!log.actor.admin, at, note: log.note || null, detail: log.detail || null })),
    };
    let resumed = false;
    if (wasRejected && !steps.some((s) => s.status === "rejected")) {
      // Un documento rechazado vuelve al circuito (o queda aprobado si ya no falta nadie).
      Object.assign(upd, { rejectedAt: null, rejectedBy: null, rejectedByName: null, rejectionReason: null });
      if (!complete) {
        resumed = true;
        if (type === "po") upd.status = "pending";
        else { upd.status = "submitted"; upd.approvalStatus = "pending"; }
      }
    }
    if (complete && (wasAwaiting || wasRejected)) Object.assign(upd, completionFields(type, d, at, log.actor));
    tx.update(ref, upd);
    return { complete: complete && (wasAwaiting || wasRejected), resumed, changed: true, before: d };
  });
  if (res.changed) await syncBudget(projectId);
  return { complete: res.complete, resumed: res.resumed, changed: res.changed };
}

// ── Datos que hacen falta para recalcular ─────────────────────────────────

export async function loadFlowContext(projectId: string) {
  const [cfg, mem] = await Promise.all([
    getDoc(doc(db, `projects/${projectId}/config/approvals`)),
    getDocs(collection(db, `projects/${projectId}/members`)),
  ]);
  const members: FlowMember[] = mem.docs.map((m) => {
    const d = m.data();
    return { userId: m.id, name: d.name || d.displayName || d.email || m.id, email: d.email, role: d.role || null, position: d.position || null, department: d.department || null, permissions: d.permissions || null, accountingAccessLevel: d.accountingAccessLevel || null };
  });
  const c = cfg.exists() ? cfg.data() : {};
  return {
    members,
    config: { po: (c.poApprovals || []) as ApprovalStepConfig[], invoice: (c.invoiceApprovals || []) as ApprovalStepConfig[] },
  };
}

/** Departamento y base del documento (para resolver HOD y umbrales). */
export const docFlowInputs = (d: AnyDoc) => ({ department: d.department || "", baseAmount: d.baseAmount || 0 });

// ── Acciones ──────────────────────────────────────────────────────────────

export const repairDoc = (projectId: string, type: FlowDocType, docId: string, actor: FlowActor) =>
  updateFlow(projectId, type, docId, (d) => {
    if (!isAwaitingApproval(type, d)) return null;
    const r = repairFlow({ ...d, ...docFlowInputs(d) });
    return r.changed ? { steps: r.steps } : null;
  }, { action: "repair", actor });

/** Recalcula con la configuración actual conservando aprobaciones válidas. */
export const rebuildDoc = (projectId: string, type: FlowDocType, docId: string, actor: FlowActor, ctx: Awaited<ReturnType<typeof loadFlowContext>>, note?: string) =>
  updateFlow(projectId, type, docId, (d) => ({ steps: rebuildFlow({ ...d, ...docFlowInputs(d) }, ctx.config[type], ctx.members).steps }), { action: "rebuild", actor, note });

/** Cambia las personas que aprueban un nivel (conserva las firmas de quien siga). */
export const reassignStep = (projectId: string, type: FlowDocType, docId: string, stepIndex: number, approvers: FlowMember[], requireAll: boolean, actor: FlowActor, note?: string) =>
  updateFlow(projectId, type, docId, (d) => {
    const steps: ApprovalStepState[] = (d.approvalSteps || []).map((s: ApprovalStepState) => ({ ...s }));
    const s = steps[stepIndex];
    if (!s) throw new Error("Ese nivel no existe");
    if (s.status === "approved") throw new Error("Ese nivel ya está aprobado");
    const ids = approvers.map((a) => a.userId);
    const keep = (s.approvedBy || []).filter((u) => ids.includes(u));
    const next: ApprovalStepState = {
      ...s, approverType: "fixed", approvers: ids, approverNames: approvers.map((a) => a.name || a.email || a.userId), requireAll,
      approvedBy: keep, approvedByNames: keep.map((u) => s.approvedByNames?.[(s.approvedBy || []).indexOf(u)] || u),
      rejectedBy: [], status: "pending", skipReason: null,
    };
    if (!ids.length) throw new Error("Elige al menos una persona");
    steps[stepIndex] = stepComplete(next) ? { ...next, status: "approved" } : next;
    return { steps, keepAccess: s.approvers || [] };
  }, { action: "reassign", actor, note, detail: `Nivel ${stepIndex + 1}: ${approvers.map((a) => a.name).join(", ")}` });

/** Omite un nivel con un motivo. */
export const skipStep = (projectId: string, type: FlowDocType, docId: string, stepIndex: number, actor: FlowActor, note: string) =>
  updateFlow(projectId, type, docId, (d) => {
    const steps: ApprovalStepState[] = (d.approvalSteps || []).map((s: ApprovalStepState) => ({ ...s }));
    if (!steps[stepIndex]) throw new Error("Ese nivel no existe");
    if (steps[stepIndex].status === "approved") throw new Error("Ese nivel ya está aprobado");
    steps[stepIndex] = { ...steps[stepIndex], status: "skipped", skipReason: `Omitido por ${actor.name}: ${note}` };
    return { steps };
  }, { action: "skip", actor, note, detail: `Nivel ${stepIndex + 1}` });

/** Aprueba de golpe todos los niveles que quedan (admin). */
export const forceApprove = (projectId: string, type: FlowDocType, docId: string, actor: FlowActor, note: string) =>
  updateFlow(projectId, type, docId, (d) => {
    const at = Timestamp.now();
    const steps: ApprovalStepState[] = (d.approvalSteps || []).map((s: ApprovalStepState) =>
      s.status === "pending" || s.status === "rejected"
        ? { ...s, status: "approved", approvedAt: at, approvals: [...(s.approvals || []), { uid: actor.uid, name: actor.name, at, by: "admin" }] }
        : s);
    return { steps, currentApprovalStep: -1 };
  }, { action: "force_approve", actor, note });

/** Reanuda un documento rechazado desde un nivel (ese y los siguientes vuelven a pendiente). */
export const resumeFrom = (projectId: string, type: FlowDocType, docId: string, fromIndex: number, actor: FlowActor, note: string) =>
  updateFlow(projectId, type, docId, (d) => {
    const steps: ApprovalStepState[] = (d.approvalSteps || []).map((s: ApprovalStepState, i: number) => {
      if (i < fromIndex) return s.status === "rejected" || s.status === "pending" ? { ...s, status: "skipped", skipReason: `Reanudado por ${actor.name} desde el nivel ${fromIndex + 1}` } : s;
      if (s.status === "skipped" && !(s.approvers || []).length) return s; // sigue sin aprobador
      return { ...s, status: (s.approvers || []).length ? "pending" : "skipped", approvedBy: [], approvedByNames: [], rejectedBy: [], approvals: (s.approvals || []).filter((a) => a.by === "rejected"), skipReason: (s.approvers || []).length ? null : "Sin aprobador" };
    });
    return { steps };
  }, { action: "resume", actor, note, detail: `Desde nivel ${fromIndex + 1}` });

/** Crea el flujo de un documento que no lo tenía (p. ej. enviado sin configuración). */
export const createFlow = (projectId: string, type: FlowDocType, docId: string, actor: FlowActor, ctx: Awaited<ReturnType<typeof loadFlowContext>>) =>
  updateFlow(projectId, type, docId, (d) => ({ steps: buildFlow(ctx.config[type], ctx.members, docFlowInputs(d)).steps }), { action: "rebuild", actor });

/**
 * Sustituye a una persona por otra en los niveles aún pendientes de un
 * documento (p. ej. un HOD que deja el proyecto). Devuelve null si no figura.
 */
export const replaceApprover = (projectId: string, type: FlowDocType, docId: string, from: string, to: FlowMember | null, actor: FlowActor, note?: string) =>
  updateFlow(projectId, type, docId, (d) => {
    let touched = false;
    const steps: ApprovalStepState[] = (d.approvalSteps || []).map((s: ApprovalStepState) => {
      if (s.status !== "pending" || !(s.approvers || []).includes(from) || (s.approvedBy || []).includes(from)) return s;
      touched = true;
      const keep = (s.approvers || []).map((u, k) => ({ u, n: s.approverNames?.[k] || u })).filter((x) => x.u !== from);
      if (to && !keep.some((x) => x.u === to.userId)) keep.push({ u: to.userId, n: to.name || to.email || to.userId });
      const next: ApprovalStepState = { ...s, approverType: "fixed", approvers: keep.map((x) => x.u), approverNames: keep.map((x) => x.n) };
      if (!next.approvers.length) return { ...next, status: "skipped", skipReason: `Sin aprobador tras quitar a ${s.approverNames?.[(s.approvers || []).indexOf(from)] || from}` };
      return stepComplete(next) ? { ...next, status: "approved" } : next;
    });
    if (!touched) return null;
    return { steps, keepAccess: [from] };
  }, { action: "reassign", actor, note, detail: `Sustituye ${from}${to ? ` → ${to.name}` : ""}` });
