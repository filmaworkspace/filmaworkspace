import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-auth";
import { db } from "@/lib/firebase-admin";
import { syncProjectLedger } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

/** ¿Puede esta persona ver el presupuesto del proyecto? (miembro con contabilidad, admin o su productora) */
async function canUse(uid: string, projectId: string) {
  const [user, member] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`projects/${projectId}/members/${uid}`).get()]);
  if (user.data()?.role === "admin") return true;
  const m = member.data();
  if (m && (["EP", "PM", "Controller", "PC"].includes(m.role) || m.permissions?.accounting)) return true;
  const companyId = user.data()?.companyId;
  if (companyId && (await db.doc(`companyProjects/${companyId}/projects/${projectId}`).get()).exists) return true;
  return false;
}

/**
 * POST { projectId } → recalcula comprometido / realizado / caja desde los
 * documentos, lo guarda y lo devuelve. Idempotente: llamarlo de más no
 * cambia nada.
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const { projectId } = await req.json().catch(() => ({}));
  if (!projectId || typeof projectId !== "string" || projectId.includes("/")) return NextResponse.json({ error: "Falta el proyecto" }, { status: 400 });
  if (!(await canUse(auth.uid, projectId))) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  try {
    const r = await syncProjectLedger(projectId);
    return NextResponse.json({
      settings: r.settings, bySubId: r.bySubId, bySub: r.ledger.bySub, totals: r.ledger.totals,
      pos: r.ledger.pos, invoiceRealized: r.ledger.invoiceRealized, issues: r.ledger.issues, written: r.written,
    });
  } catch (e) {
    console.error("ledger", e);
    return NextResponse.json({ error: "No se pudo calcular el presupuesto" }, { status: 500 });
  }
}
