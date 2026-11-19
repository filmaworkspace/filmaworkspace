import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { logSecurityEvent } from "@/lib/server/securityLog";
import { auditFromServer } from "@/lib/server/audit";

// ─────────────────────────────────────────────────────────────────────────────
// "Ver como": un admin entra en la app como otro usuario para ver lo mismo que
// él, en SOLO LECTURA. Se le da un token personalizado del usuario con la
// marca impersonatedBy; las reglas de Firestore/Storage y las APIs rechazan
// cualquier escritura con esa marca (ver isSignedIn() en firestore.rules).
// Queda en la auditoría y en los eventos de seguridad.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, { recentAuthMinutes: 5 });
  if (!admin.ok) return admin.response;

  const { uid } = await req.json().catch(() => ({}));
  if (!uid || typeof uid !== "string") return NextResponse.json({ error: "uid requerido" }, { status: 400 });
  if (uid === admin.uid) return NextResponse.json({ error: "Ya eres tú" }, { status: 400 });

  const target = (await db.collection("users").doc(uid).get()).data();
  if (!target) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  if (target.role === "admin" || target.role === "support_agent") {
    return NextResponse.json({ error: "No se puede ver como otro admin o agente" }, { status: 403 });
  }
  const authUser = await adminAuth.getUser(uid).catch(() => null);
  if (!authUser) return NextResponse.json({ error: "La cuenta no existe en Auth" }, { status: 404 });
  if (authUser.disabled) return NextResponse.json({ error: "La cuenta está suspendida" }, { status: 400 });

  const token = await adminAuth.createCustomToken(uid, { impersonatedBy: admin.uid });
  await logSecurityEvent("impersonation_start", { req, uid, actorUid: admin.uid, target: target.email });
  await auditFromServer(admin.uid, "impersonation_start", `${target.name || uid} (${target.email || ""})`);
  return NextResponse.json({ token });
}
