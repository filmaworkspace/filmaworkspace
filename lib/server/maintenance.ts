// ─── Mantenimiento de datos (servidor) ───────────────────────────────────────
// Para todos los proyectos o uno: repara los flujos de aprobación atascados
// (pasos sin aprobador, que no aplican por importe o ya completos) y vuelve a
// calcular el libro de presupuesto. Con `dryRun` solo cuenta lo que cambiaría.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { approverIdsOf, repairFlow, stripUndefined } from "@/lib/approvalFlow";
import { syncProjectLedger } from "@/lib/server/ledger";

type AnyDoc = Record<string, any>;
type Kind = "po" | "invoice";
const COLLECTION: Record<Kind, string> = { po: "pos", invoice: "invoices" };

const awaiting = (k: Kind, d: AnyDoc) =>
  k === "po" ? d.status === "pending" : !d.approvedAt && d.approvalStatus === "pending" && d.status !== "rejected" && d.status !== "cancelled" && !d.delegatedToAccounting;
const itemBase = (it: AnyDoc) => it.baseAmount || (it.quantity && it.unitPrice ? it.quantity * it.unitPrice : 0);

export interface ProjectMaintenance {
  projectId: string;
  name: string;
  flowsRepaired: number;
  flowsCompleted: number;
  /** Subcuentas y POs con cifras corregidas. */
  subaccountsUpdated: number;
  issues: number;
  error?: string;
}

export interface MaintenanceSummary {
  dryRun: boolean;
  projects: ProjectMaintenance[];
  totals: { projects: number; flowsRepaired: number; flowsCompleted: number; subaccountsUpdated: number; errors: number };
  ms: number;
}

async function repairProjectFlows(projectId: string, actor: { uid: string; name: string }, dryRun: boolean) {
  let repaired = 0, completed = 0;
  for (const kind of ["po", "invoice"] as Kind[]) {
    const snap = await db.collection(`projects/${projectId}/${COLLECTION[kind]}`).where(kind === "po" ? "status" : "approvalStatus", "==", "pending").get();
    for (const s of snap.docs) {
      const d = s.data();
      if (!awaiting(kind, d) || !(d.approvalSteps || []).length) continue;
      const r = repairFlow({ ...d, department: d.department || "", baseAmount: d.baseAmount || 0 } as never);
      if (!r.changed) continue;
      repaired++;
      if (r.complete) completed++;
      if (dryRun) continue;
      const at = Timestamp.now();
      const upd: AnyDoc = {
        approvalSteps: stripUndefined(r.steps),
        currentApprovalStep: r.currentApprovalStep,
        approverIds: [...new Set([...(d.approverIds || []), ...approverIdsOf(r.steps)])],
        approvalLog: FieldValue.arrayUnion({ action: "repair", by: actor.uid, byName: actor.name, admin: true, at, note: "Mantenimiento", detail: r.notes.join(" · ") || null }),
      };
      if (r.complete) {
        Object.assign(upd, { approvedAt: at, approvedBy: actor.uid, approvedByName: actor.name, currentApprovalStep: -1 });
        if (kind === "po") {
          const base = (d.items || []).reduce((t: number, it: AnyDoc) => t + itemBase(it), 0) || d.baseAmount || 0;
          Object.assign(upd, { status: "approved", committedAmount: base, remainingAmount: base, previousCommittedItems: null });
        } else Object.assign(upd, { status: "submitted", approvalStatus: "approved" });
      }
      await s.ref.update(upd);
    }
  }
  return { repaired, completed };
}

export async function runMaintenance(opts: { projectIds?: string[]; dryRun?: boolean; actor: { uid: string; name: string } }): Promise<MaintenanceSummary> {
  const t0 = Date.now();
  const dryRun = !!opts.dryRun;
  const projects = opts.projectIds?.length
    ? (await Promise.all(opts.projectIds.map((id) => db.doc(`projects/${id}`).get()))).filter((p) => p.exists)
    : (await db.collection("projects").get()).docs;

  const out: ProjectMaintenance[] = [];
  // De cuatro en cuatro: suficiente sin saturar Firestore.
  for (let i = 0; i < projects.length; i += 4) {
    const batch = await Promise.all(projects.slice(i, i + 4).map(async (p) => {
      const row: ProjectMaintenance = { projectId: p.id, name: (p.data() || {}).name || p.id, flowsRepaired: 0, flowsCompleted: 0, subaccountsUpdated: 0, issues: 0 };
      try {
        const f = await repairProjectFlows(p.id, opts.actor, dryRun);
        row.flowsRepaired = f.repaired; row.flowsCompleted = f.completed;
        const l = await syncProjectLedger(p.id, { write: !dryRun });
        row.subaccountsUpdated = l.changes;
        row.issues = l.ledger.issues?.length || 0;
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
      }
      return row;
    }));
    out.push(...batch);
  }
  const sum = (k: "flowsRepaired" | "flowsCompleted" | "subaccountsUpdated") => out.reduce((t, r) => t + r[k], 0);
  return {
    dryRun, projects: out, ms: Date.now() - t0,
    totals: { projects: out.length, flowsRepaired: sum("flowsRepaired"), flowsCompleted: sum("flowsCompleted"), subaccountsUpdated: sum("subaccountsUpdated"), errors: out.filter((r) => r.error).length },
  };
}
