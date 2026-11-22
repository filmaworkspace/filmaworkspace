import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { auditFromServer } from "@/lib/server/audit";
import { runMaintenance } from "@/lib/server/maintenance";

// POST { dryRun?: boolean, projectIds?: string[] }
// Repara flujos de aprobación atascados y recalcula el presupuesto de todos
// los proyectos (o de los indicados). Con dryRun solo cuenta.

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;
  // Simular no cambia nada; aplicar exige haber confirmado la contraseña.
  const admin = await requireAdmin(req, dryRun ? {} : { recentAuthMinutes: 5 });
  if (!admin.ok) return admin.response;
  const projectIds = Array.isArray(body.projectIds) ? body.projectIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : undefined;

  const me = (await db.doc(`users/${admin.uid}`).get()).data() || {};
  const summary = await runMaintenance({ dryRun, projectIds, actor: { uid: admin.uid, name: me.name || me.email || "Admin" } });
  if (!dryRun) {
    const t = summary.totals;
    await auditFromServer(admin.uid, "maintenance_run", `${t.projects} proyectos · ${t.flowsRepaired} flujos reparados (${t.flowsCompleted} aprobados) · ${t.subaccountsUpdated} cifras corregidas · ${t.errors} errores`);
  }
  return NextResponse.json(summary);
}
