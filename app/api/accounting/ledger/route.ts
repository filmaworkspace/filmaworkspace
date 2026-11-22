import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/require-auth";
import { db } from "@/lib/firebase-admin";
import { syncProjectLedger, type LedgerResult } from "@/lib/server/ledger";
import { rateLimit } from "@/lib/rate-limit";

// En la misma instancia, peticiones simultáneas del mismo proyecto comparten
// un recálculo; si llega otra mientras tanto, se hace uno más al terminar.
const inflight = new Map<string, { run: Promise<LedgerResult>; again: Promise<LedgerResult> | null }>();
function coalesced(projectId: string): Promise<LedgerResult> {
  const cur = inflight.get(projectId);
  if (cur) {
    if (!cur.again) cur.again = cur.run.catch(() => null).then(() => syncProjectLedger(projectId));
    return cur.again;
  }
  const entry = { run: syncProjectLedger(projectId), again: null as Promise<LedgerResult> | null };
  inflight.set(projectId, entry);
  entry.run.finally(() => {
    if (!entry.again) { inflight.delete(projectId); return; }
    const next = { run: entry.again, again: null as Promise<LedgerResult> | null };
    inflight.set(projectId, next);
    next.run.finally(() => { if (inflight.get(projectId) === next) inflight.delete(projectId); });
  });
  return entry.run;
}

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
  // Límite por persona y proyecto: cada recálculo relee el proyecto entero.
  if (!(await rateLimit(`ledger:${auth.uid}:${projectId}`, 60, 60_000))) {
    return NextResponse.json({ error: "Demasiados recálculos seguidos. Espera un momento" }, { status: 429 });
  }
  try {
    const r = await coalesced(projectId);
    return NextResponse.json({
      settings: r.settings, bySubId: r.bySubId, bySub: r.ledger.bySub, totals: r.ledger.totals,
      pos: r.ledger.pos, invoiceRealized: r.ledger.invoiceRealized, issues: r.ledger.issues, written: r.written,
    });
  } catch (e) {
    console.error("ledger", e);
    return NextResponse.json({ error: "No se pudo calcular el presupuesto" }, { status: 500 });
  }
}
