// ─── Flujo de aprobación de POs y facturas ───────────────────────────────────
// Un único sitio con toda la lógica (antes estaba copiada en cuatro páginas
// con diferencias). Reglas:
//
//  · El flujo se construye a partir de la configuración del proyecto
//    (config/approvals: poApprovals / invoiceApprovals), por orden.
//  · Un paso que no aplica por importe (umbral sobre la BASE IMPONIBLE) o que
//    no tiene a nadie que pueda aprobarlo (p. ej. "HOD" en un departamento sin
//    HOD) se marca como OMITIDO con su motivo y el flujo sigue. Nunca se queda
//    un documento bloqueado en un paso sin aprobador.
//  · Solo aprueban personas con acceso a contabilidad (si no, no podrían ni
//    ver el documento).
//  · Los aprobadores de cada paso se fijan al crear el flujo (y se guardan en
//    approverIds para las reglas). Quién puede aprobar sale de esa lista.
//  · "Todos" = todas las personas del paso; si no, basta una.
//  · Si no queda ningún paso pendiente, el documento queda aprobado.

export type ApproverType = "fixed" | "role" | "hod" | "coordinator";

export interface ApprovalStepConfig {
  id: string;
  order: number;
  approverType: ApproverType;
  approvers?: string[];
  roles?: string[];
  department?: string;
  requireAll: boolean;
  hasAmountThreshold?: boolean;
  amountThreshold?: number;
  amountCondition?: "above" | "below" | "between";
  amountThresholdMax?: number;
}

export type StepStatus = "pending" | "approved" | "rejected" | "skipped";

export interface ApprovalRecord { uid: string; name: string; at: Date | { toDate: () => Date } | null; by?: string }

export interface ApprovalStepState extends ApprovalStepConfig {
  approvers: string[];
  approverNames: string[];
  approvedBy: string[];
  approvedByNames?: string[];
  rejectedBy: string[];
  status: StepStatus;
  /** Por qué se omitió (sin aprobador, no aplica por importe, omitido por un admin…). */
  skipReason?: string | null;
  approvals?: ApprovalRecord[];
  approvedAt?: unknown;
}

export interface FlowMember {
  userId: string;
  name?: string;
  email?: string;
  role?: string | null;
  position?: string | null;
  department?: string | null;
  permissions?: { accounting?: boolean } | null;
  accountingAccessLevel?: string | null;
}

const PROJECT_ROLES = ["EP", "PM", "Controller", "PC"];

/** Puede ver documentos de contabilidad (las reglas no dejarían a nadie más). */
export const hasAccountingAccess = (m: FlowMember) =>
  PROJECT_ROLES.includes(m.role || "") || !!m.permissions?.accounting;

const memberName = (m?: FlowMember | null, uid?: string) => m?.name || m?.email || uid || "—";

export const APPROVER_TYPE_LABEL: Record<ApproverType, string> = {
  fixed: "Personas concretas", role: "Rol de proyecto", hod: "Jefe de departamento", coordinator: "Coordinación",
};

/** Descripción corta del paso: "HOD de Arte", "EP, PM"… */
export function stepLabel(s: Pick<ApprovalStepConfig, "approverType" | "roles" | "department">, docDepartment?: string | null) {
  const dept = s.department || docDepartment || "";
  if (s.approverType === "role") return (s.roles || []).join(", ") || "Rol de proyecto";
  if (s.approverType === "hod") return dept ? `HOD de ${dept}` : "HOD del departamento";
  if (s.approverType === "coordinator") return dept ? `Coordinación de ${dept}` : "Coordinación del departamento";
  return "Personas designadas";
}

/** ¿Aplica el paso a este importe? (umbral sobre la base imponible) */
export function stepApplies(s: ApprovalStepConfig, baseAmount: number): boolean {
  if (!s.hasAmountThreshold || !s.amountThreshold) return true;
  const a = baseAmount || 0, t = s.amountThreshold;
  if (s.amountCondition === "below") return a < t;
  if (s.amountCondition === "between") return a >= t && a <= (s.amountThresholdMax ?? Infinity);
  return a > t; // "above" (por defecto)
}

/** Personas que pueden aprobar el paso y, si no hay ninguna, por qué. */
export function resolveStep(s: ApprovalStepConfig, members: FlowMember[], docDepartment?: string | null): { ids: string[]; names: string[]; reason?: string } {
  const dept = s.department || docDepartment || "";
  let candidates: FlowMember[] = [];
  let emptyReason = "";
  switch (s.approverType) {
    case "fixed":
      candidates = (s.approvers || []).map((uid) => members.find((m) => m.userId === uid) || ({ userId: uid } as FlowMember)).filter((m) => members.some((x) => x.userId === m.userId));
      emptyReason = (s.approvers || []).length ? "Las personas designadas ya no están en el proyecto" : "No hay personas designadas";
      break;
    case "role":
      candidates = members.filter((m) => m.role && (s.roles || []).includes(m.role));
      emptyReason = `Nadie tiene el rol ${(s.roles || []).join(" / ") || "indicado"}`;
      break;
    case "hod":
      if (!dept) { emptyReason = "El documento no tiene departamento"; break; }
      candidates = members.filter((m) => m.position === "HOD" && m.department === dept);
      emptyReason = `${dept} no tiene HOD`;
      break;
    case "coordinator":
      if (!dept) { emptyReason = "El documento no tiene departamento"; break; }
      candidates = members.filter((m) => m.position === "Coordinator" && m.department === dept);
      emptyReason = `${dept} no tiene coordinación`;
      break;
  }
  const withAccess = candidates.filter(hasAccountingAccess);
  if (!withAccess.length) {
    const reason = candidates.length ? `${candidates.map((m) => memberName(m)).join(", ")} no ${candidates.length > 1 ? "tienen" : "tiene"} acceso a contabilidad` : emptyReason;
    return { ids: [], names: [], reason };
  }
  return { ids: withAccess.map((m) => m.userId), names: withAccess.map((m) => memberName(m, m.userId)) };
}

export interface BuiltFlow {
  steps: ApprovalStepState[];
  currentApprovalStep: number;   // -1 si no queda nada pendiente
  complete: boolean;             // aprobado (todo omitido o ningún paso)
  approverIds: string[];
}

/** Construye el flujo de un documento a partir de la configuración. */
export function buildFlow(config: ApprovalStepConfig[], members: FlowMember[], doc: { department?: string | null; baseAmount: number }): BuiltFlow {
  const steps: ApprovalStepState[] = [...(config || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((c, i) => {
      const base: ApprovalStepState = {
        ...stripUndefined(c),
        id: c.id || `step-${i + 1}`,
        order: i + 1,
        approverType: c.approverType || "role",
        roles: c.roles || [],
        department: c.department || "",
        requireAll: !!c.requireAll,
        approvers: [], approverNames: [], approvedBy: [], approvedByNames: [], rejectedBy: [], approvals: [],
        status: "pending", skipReason: null,
      };
      if (!stepApplies(c, doc.baseAmount)) return { ...base, status: "skipped", skipReason: "No aplica por importe" };
      const r = resolveStep(c, members, doc.department);
      if (!r.ids.length) return { ...base, status: "skipped", skipReason: r.reason || "Sin aprobador" };
      return { ...base, approvers: r.ids, approverNames: r.names };
    });
  return finishFlow(steps);
}

function finishFlow(steps: ApprovalStepState[]): BuiltFlow {
  const current = steps.findIndex((s) => s.status === "pending");
  return { steps, currentApprovalStep: current, complete: current === -1 && !steps.some((s) => s.status === "rejected"), approverIds: approverIdsOf(steps) };
}

export function approverIdsOf(steps: { approvers?: string[] }[] | null | undefined): string[] {
  const ids = new Set<string>();
  for (const s of steps || []) for (const id of s.approvers || []) if (id) ids.add(id);
  return [...ids];
}

/** ¿Está completo el paso con estas aprobaciones? */
export function stepComplete(s: Pick<ApprovalStepState, "requireAll" | "approvers" | "approvedBy">) {
  const approved = new Set(s.approvedBy || []);
  if (s.requireAll) return (s.approvers || []).length > 0 && (s.approvers || []).every((a) => approved.has(a));
  return (s.approvedBy || []).length > 0;
}

type FlowDoc = { approvalSteps?: ApprovalStepState[] | null; currentApprovalStep?: number | null; baseAmount?: number; department?: string | null };

/** Paso actual (o null si no hay nada pendiente). */
export function currentStep(doc: FlowDoc): ApprovalStepState | null {
  const steps = doc.approvalSteps || [];
  const i = doc.currentApprovalStep ?? -1;
  const s = i >= 0 ? steps[i] : undefined;
  return s && s.status === "pending" ? s : null;
}

/** ¿Puede esta persona aprobar ahora el documento? (sale de la lista fijada en el flujo) */
export function canApprove(doc: FlowDoc, uid: string): boolean {
  const s = currentStep(doc);
  if (!s || !uid) return false;
  if ((s.approvedBy || []).includes(uid) || (s.rejectedBy || []).includes(uid)) return false;
  return (s.approvers || []).includes(uid);
}

/**
 * Registra una aprobación y avanza el flujo (saltando pasos ya omitidos).
 * Pura: devuelve el nuevo estado; quien llama lo guarda en una transacción.
 */
export function applyApproval(doc: FlowDoc, uid: string, name: string, at: unknown) {
  const steps = (doc.approvalSteps || []).map((s) => ({ ...s }));
  const i = doc.currentApprovalStep ?? -1;
  const s = steps[i];
  if (!s || s.status !== "pending") throw new Error("Este documento ya no está pendiente de este paso");
  if (!(s.approvers || []).includes(uid)) throw new Error("No eres aprobador de este paso");
  if ((s.approvedBy || []).includes(uid)) throw new Error("Ya lo has aprobado");
  s.approvedBy = [...(s.approvedBy || []), uid];
  s.approvedByNames = [...(s.approvedByNames || []), name];
  s.approvals = [...(s.approvals || []), { uid, name, at: at as ApprovalRecord["at"] }];
  if (stepComplete(s)) { s.status = "approved"; s.approvedAt = at; }
  steps[i] = s;
  const flow = finishFlow(steps);
  return { ...flow, stepCompleted: s.status === "approved" };
}

/** Rechazo: el paso actual queda rechazado y el documento también. */
export function applyRejection(doc: FlowDoc, uid: string, name: string, at: unknown) {
  const steps = (doc.approvalSteps || []).map((s) => ({ ...s }));
  const i = doc.currentApprovalStep ?? -1;
  if (steps[i]) {
    steps[i] = { ...steps[i], status: "rejected", rejectedBy: [...(steps[i].rejectedBy || []), uid], approvals: [...(steps[i].approvals || []), { uid, name, at: at as ApprovalRecord["at"], by: "rejected" }] };
  }
  return { steps, approverIds: approverIdsOf(steps) };
}

export interface PendingSummary {
  state: "approved" | "rejected" | "pending" | "blocked" | "none";
  /** Quién tiene que aprobar ahora (sin los que ya lo han hecho). */
  waitingFor: { uid: string; name: string }[];
  current: ApprovalStepState | null;
  currentIndex: number;
  /** "Basta uno" o "Todos (2 de 3)". */
  rule: string;
  remainingSteps: ApprovalStepState[];
  blockedReason?: string;
}

/** Quién queda por aprobar y qué falta (para enseñar en cada documento). */
export function pendingSummary(doc: FlowDoc & { status?: string; approvedAt?: unknown }): PendingSummary {
  const steps = doc.approvalSteps || [];
  if (!steps.length) return { state: doc.approvedAt ? "approved" : "none", waitingFor: [], current: null, currentIndex: -1, rule: "", remainingSteps: [] };
  if (steps.some((s) => s.status === "rejected") || doc.status === "rejected") return { state: "rejected", waitingFor: [], current: null, currentIndex: -1, rule: "", remainingSteps: [] };
  const i = doc.currentApprovalStep ?? -1;
  const s = i >= 0 ? steps[i] : null;
  if (!s) {
    const anyPending = steps.findIndex((x) => x.status === "pending");
    if (anyPending >= 0) return { state: "blocked", waitingFor: [], current: steps[anyPending], currentIndex: anyPending, rule: "", remainingSteps: steps.slice(anyPending), blockedReason: "El flujo no apunta a ningún paso pendiente" };
    return { state: "approved", waitingFor: [], current: null, currentIndex: -1, rule: "", remainingSteps: [] };
  }
  if (s.status !== "pending") return { state: "blocked", waitingFor: [], current: s, currentIndex: i, rule: "", remainingSteps: steps.slice(i), blockedReason: "El paso actual ya no está pendiente" };
  if (!(s.approvers || []).length) return { state: "blocked", waitingFor: [], current: s, currentIndex: i, rule: "", remainingSteps: steps.slice(i), blockedReason: "El paso actual no tiene aprobadores" };
  const approved = new Set(s.approvedBy || []);
  const waitingFor = (s.approvers || []).map((uid, k) => ({ uid, name: s.approverNames?.[k] || uid })).filter((a) => !approved.has(a.uid));
  return {
    state: "pending", waitingFor, current: s, currentIndex: i,
    rule: s.requireAll ? `Todos (${approved.size} de ${(s.approvers || []).length})` : "Basta uno",
    remainingSteps: steps.slice(i + 1).filter((x) => x.status === "pending"),
  };
}

/**
 * Repara un flujo heredado (creado con la lógica antigua): omite pasos sin
 * aprobador o que no aplican por importe, corrige el paso actual y dice si ya
 * está todo aprobado. Las aprobaciones ya hechas se conservan.
 */
export function repairFlow(doc: FlowDoc): BuiltFlow & { changed: boolean; notes: string[] } {
  const notes: string[] = [];
  const steps = (doc.approvalSteps || []).map((s) => ({ ...s, approvers: s.approvers || [], approvedBy: s.approvedBy || [], rejectedBy: s.rejectedBy || [] }));
  steps.forEach((s, k) => {
    if (s.status !== "pending") return;
    if (!stepApplies(s, doc.baseAmount || 0)) { steps[k] = { ...s, status: "skipped", skipReason: "No aplica por importe" }; notes.push(`Nivel ${k + 1}: no aplica por importe`); return; }
    if (!s.approvers.length) { steps[k] = { ...s, status: "skipped", skipReason: "Sin aprobador" }; notes.push(`Nivel ${k + 1}: sin aprobador`); return; }
    if (stepComplete(s)) { steps[k] = { ...s, status: "approved" }; notes.push(`Nivel ${k + 1}: ya estaba completo`); }
  });
  const flow = finishFlow(steps);
  const changed = notes.length > 0 || flow.currentApprovalStep !== (doc.currentApprovalStep ?? -1);
  return { ...flow, changed, notes };
}

/**
 * Recalcula el flujo con la configuración actual del proyecto, conservando
 * las aprobaciones ya hechas por quienes siguen siendo aprobadores del mismo
 * paso (mismo id de paso).
 */
export function rebuildFlow(doc: FlowDoc, config: ApprovalStepConfig[], members: FlowMember[]): BuiltFlow {
  const fresh = buildFlow(config, members, { department: doc.department, baseAmount: doc.baseAmount || 0 });
  const prev = new Map((doc.approvalSteps || []).map((s) => [s.id, s]));
  const steps = fresh.steps.map((s) => {
    const old = prev.get(s.id);
    if (!old || s.status !== "pending") return s;
    const keep = (old.approvedBy || []).filter((uid) => s.approvers.includes(uid));
    if (!keep.length) return s;
    const names = keep.map((uid) => old.approvedByNames?.[(old.approvedBy || []).indexOf(uid)] || s.approverNames[s.approvers.indexOf(uid)] || uid);
    const next = { ...s, approvedBy: keep, approvedByNames: names, approvals: (old.approvals || []).filter((a) => keep.includes(a.uid)) };
    return stepComplete(next) ? { ...next, status: "approved" as const, approvedAt: old.approvedAt || null } : next;
  });
  return finishFlow(steps);
}

/** Firestore no admite undefined. */
export function stripUndefined<T>(obj: T): T {
  if (Array.isArray(obj)) return obj.map((x) => stripUndefined(x)) as unknown as T;
  if (obj && typeof obj === "object" && !(obj instanceof Date) && typeof (obj as { toDate?: unknown }).toDate !== "function") {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)])) as T;
  }
  return obj;
}
