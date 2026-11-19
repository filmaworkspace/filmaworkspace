import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";

/** Entrada en adminAuditLog desde el servidor (las del cliente las escribe el propio admin). */
export async function auditFromServer(adminUid: string, action: string, details: string) {
  try {
    const a = (await db.collection("users").doc(adminUid).get()).data() || {};
    await db.collection("adminAuditLog").add({
      action, details: details.slice(0, 1000), adminId: adminUid, adminName: a.name || a.email || "Admin",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) { console.error("[audit]", (e as Error).message); }
}
