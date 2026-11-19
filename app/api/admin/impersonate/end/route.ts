import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { logSecurityEvent } from "@/lib/server/securityLog";
import { auditFromServer } from "@/lib/server/audit";

// Fin de "Ver como": con el token de la sesión de solo lectura (que lleva
// impersonatedBy = uid del admin) devuelve un token para volver a la cuenta
// del admin, siempre que siga siendo admin.
export async function POST(req: NextRequest) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  try {
    const decoded = await adminAuth.verifyIdToken(m[1]);
    const adminUid = decoded.impersonatedBy as string | undefined;
    if (!adminUid) return NextResponse.json({ error: "No es una sesión de Ver como" }, { status: 400 });
    const a = (await db.collection("users").doc(adminUid).get()).data();
    if (a?.role !== "admin") return NextResponse.json({ error: "Ya no tienes permisos de admin" }, { status: 403 });
    const token = await adminAuth.createCustomToken(adminUid);
    await logSecurityEvent("impersonation_end", { req, uid: decoded.uid, actorUid: adminUid });
    await auditFromServer(adminUid, "impersonation_end", decoded.email || decoded.uid);
    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
}
