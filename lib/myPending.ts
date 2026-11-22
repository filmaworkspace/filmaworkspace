// ─── "Pendiente de ti" ───────────────────────────────────────────────────────
// Lo que espera a la persona en todos sus proyectos: aprobaciones (POs,
// facturas y sobres de caja), invitaciones y el estado de los documentos que
// ha creado (rechazados, esperando aprobación…). Lo usan el dashboard de
// escritorio y el inicio móvil.
//
// Solo se consultan documentos que las reglas dejan leer: los que tienen a la
// persona en approverIds o los que ha creado ella.

import { collection, doc, getDoc, getDocs, query, where, type DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { canApprove, pendingSummary, withNames, type FlowMember } from "@/lib/approvalFlow";

export type PendingKind = "po" | "invoice" | "card" | "transfer";
export const KIND_LABEL: Record<PendingKind, string> = { po: "PO", invoice: "Factura", card: "Sobre de tarjeta", transfer: "Sobre de transferencia" };
const COLLECTION: Record<PendingKind, string> = { po: "pos", invoice: "invoices", card: "cardEnvelopes", transfer: "transferEnvelopes" };

export interface PendingApprovalItem {
  kind: PendingKind;
  id: string;
  projectId: string;
  projectName: string;
  number: string;
  supplier: string;
  base: number;
  total: number;
  currency: string;
  department?: string;
  /** Nivel actual / total, y la regla ("Basta uno", "Todos (1 de 2)"). */
  level: string;
  rule: string;
  createdAt: Date | null;
  createdByName: string;
}

export interface MyDocItem {
  kind: "po" | "invoice";
  id: string;
  projectId: string;
  projectName: string;
  number: string;
  supplier: string;
  base: number;
  state: "pending" | "rejected" | "approved" | "draft";
  /** "Pendiente de Ana Pérez", "Rechazada: falta el presupuesto"… */
  detail: string;
  updatedAt: Date | null;
}

export interface ProjectLite { id: string; name: string; archived?: boolean }

export interface MyPending {
  approvals: PendingApprovalItem[];
  myDocs: MyDocItem[];
  projects: ProjectLite[];
}

const toDate = (v: any): Date | null => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : Number(v) || 0);

export function docNumber(kind: PendingKind, d: DocumentData) {
  if (d.displayNumber) return String(d.displayNumber);
  const n = String(d.number ?? "").padStart(4, "0");
  return kind === "po" ? `PO-${n}` : kind === "invoice" ? `FRA-${n}` : n;
}

async function safeDocs(q: ReturnType<typeof query>) {
  try { return (await getDocs(q)).docs; } catch { return []; }
}

/** Aprobaciones que esperan a `uid` en un proyecto. */
export async function projectApprovals(uid: string, project: ProjectLite): Promise<PendingApprovalItem[]> {
  const out: PendingApprovalItem[] = [];
  for (const kind of ["po", "invoice", "card", "transfer"] as PendingKind[]) {
    const docs = await safeDocs(query(collection(db, `projects/${project.id}/${COLLECTION[kind]}`), where("approverIds", "array-contains", uid)));
    for (const s of docs) {
      const d = s.data() as DocumentData;
      if (kind === "po" && d.status !== "pending") continue;
      if (kind === "invoice" && (d.approvedAt || d.status === "rejected" || d.approvalStatus === "rejected" || d.status === "cancelled")) continue;
      if ((kind === "card" || kind === "transfer") && d.status !== "pending_approval") continue;
      if (!canApprove(d, uid)) continue;
      const p = pendingSummary(d);
      out.push({
        kind, id: s.id, projectId: project.id, projectName: project.name,
        number: docNumber(kind, d),
        supplier: d.supplier || d.supplierName || d.boxCode || d.personName || "—",
        base: num(d.baseAmount ?? d.totalBase), total: num(d.totalAmount),
        currency: d.currency || "EUR", department: d.department || undefined,
        level: p.currentIndex >= 0 ? `${p.currentIndex + 1}/${(d.approvalSteps || []).length}` : "",
        rule: p.rule, createdAt: toDate(d.createdAt), createdByName: d.createdByName || "",
      });
    }
  }
  return out;
}

/** Documentos que ha creado `uid` y que aún le importan (pendientes, rechazados, borradores, recién aprobados). */
async function projectMyDocs(uid: string, project: ProjectLite): Promise<MyDocItem[]> {
  const out: MyDocItem[] = [];
  // Nombres de los miembros: documentos antiguos guardan solo el id del aprobador.
  let members: FlowMember[] | null = null;
  const named = async (d: DocumentData) => {
    if (!members) members = (await safeDocs(query(collection(db, `projects/${project.id}/members`)))).map((m) => ({ userId: m.id, name: (m.data() as DocumentData).name || (m.data() as DocumentData).email }));
    return withNames(d, members);
  };
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const kind of ["po", "invoice"] as const) {
    const docs = await safeDocs(query(collection(db, `projects/${project.id}/${COLLECTION[kind]}`), where("createdBy", "==", uid)));
    for (const s of docs) {
      const d = s.data() as DocumentData;
      const rejected = d.status === "rejected" || d.approvalStatus === "rejected";
      const approvedAt = toDate(d.approvedAt);
      const pending = !rejected && (kind === "po" ? d.status === "pending" : !d.approvedAt && d.approvalStatus === "pending" && d.status !== "cancelled");
      const draft = d.status === "draft";
      let state: MyDocItem["state"] | null = null, detail = "";
      if (rejected) { state = "rejected"; detail = d.rejectionReason ? `Rechazada: ${d.rejectionReason}` : "Rechazada"; }
      else if (pending) {
        const p = pendingSummary(await named(d));
        state = "pending";
        detail = p.state === "pending" ? `Pendiente de ${p.waitingFor.map((w) => w.name).join(", ")}` : p.state === "blocked" ? "Flujo bloqueado" : "Pendiente de aprobación";
      } else if (draft) { state = "draft"; detail = "Borrador sin enviar"; }
      else if (approvedAt && approvedAt.getTime() > weekAgo) { state = "approved"; detail = `Aprobada${d.approvedByName ? ` por ${d.approvedByName}` : ""}`; }
      if (!state) continue;
      out.push({
        kind, id: s.id, projectId: project.id, projectName: project.name, number: docNumber(kind, d),
        supplier: d.supplier || "—", base: num(d.baseAmount), state, detail,
        updatedAt: toDate(d.rejectedAt) || toDate(d.approvedAt) || toDate(d.updatedAt) || toDate(d.createdAt),
      });
    }
  }
  return out;
}

/** Proyectos de la persona (activos). */
export async function myProjects(uid: string): Promise<ProjectLite[]> {
  const ups = await getDocs(collection(db, `userProjects/${uid}/projects`));
  const list = await Promise.all(ups.docs.map(async (u) => {
    const p = await getDoc(doc(db, "projects", u.id)).catch(() => null);
    if (!p?.exists()) return null;
    const d = p.data();
    return { id: p.id, name: d.name || "Proyecto", archived: !!(d.archived || u.data().archived) } as ProjectLite;
  }));
  return list.filter((p): p is ProjectLite => !!p && !p.archived);
}

export async function loadMyPending(uid: string, projects?: ProjectLite[]): Promise<MyPending> {
  const ps = projects || (await myProjects(uid));
  const [apps, docs] = await Promise.all([
    Promise.all(ps.map((p) => projectApprovals(uid, p))),
    Promise.all(ps.map((p) => projectMyDocs(uid, p))),
  ]);
  const order = { rejected: 0, pending: 1, draft: 2, approved: 3 } as const;
  return {
    projects: ps,
    approvals: apps.flat().sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)),
    myDocs: docs.flat().sort((a, b) => order[a.state] - order[b.state] || (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0)),
  };
}

/** Enlace de escritorio al documento. */
export function desktopHref(it: { kind: PendingKind; id: string; projectId: string }) {
  if (it.kind === "po") return `/project/${it.projectId}/accounting/pos/${it.id}`;
  if (it.kind === "invoice") return `/project/${it.projectId}/accounting/invoices/${it.id}`;
  return `/project/${it.projectId}/accounting/approvals`;
}
