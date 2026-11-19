// ─── Eventos de seguridad ────────────────────────────────────────────────────
// PINs fallidos, intentos bloqueados por límite, accesos denegados, "ver como",
// suspensiones… Se leen en admindashboard → Sistema → Seguridad.
import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { db } from "@/lib/firebase-admin";
import { clientIp } from "@/lib/rate-limit";

export type SecurityEventType =
  | "rate_limited"
  | "pin_failed"
  | "access_denied"
  | "impersonation_start"
  | "impersonation_end"
  | "account_suspended"
  | "account_reactivated"
  | "sessions_revoked"
  | "email_changed"
  | "data_exported"
  | "project_frozen"
  | "project_trashed"
  | "project_restored";

export async function logSecurityEvent(
  type: SecurityEventType,
  data: { req?: NextRequest; uid?: string | null; actorUid?: string | null; target?: string; details?: string } = {},
) {
  try {
    await db.collection("securityEvents").add({
      type,
      uid: data.uid || null,
      actorUid: data.actorUid || null,
      target: data.target || null,
      details: (data.details || "").slice(0, 500),
      ip: data.req ? clientIp(data.req) : null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[securityEvents]", (err as Error)?.message);
  }
}
