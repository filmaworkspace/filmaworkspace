import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";

export type AdminCheckResult =
  | { ok: true; uid: string }
  | { ok: false; response: NextResponse };

/**
 * Verifies the Firebase ID token sent in the Authorization: Bearer header
 * and confirms the caller's Firestore user doc has role "admin".
 * Use at the top of any API route that only admins should be able to call.
 */
export async function requireAdmin(req: NextRequest): Promise<AdminCheckResult> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    if (userDoc.data()?.role !== "admin") {
      return { ok: false, response: NextResponse.json({ error: "No autorizado" }, { status: 403 }) };
    }
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Token inválido" }, { status: 401 }) };
  }
}
