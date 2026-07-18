import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";

export async function POST(req: NextRequest) {
  try {
    const { uid } = await req.json();
    if (!uid) return NextResponse.json({ error: "uid requerido" }, { status: 400 });

    // 1. Borrar de Firebase Auth
    await adminAuth.deleteUser(uid);

    // 2. Borrar users/{uid} + subcollections (messages, etc.)
    await db.recursiveDelete(db.collection("users").doc(uid));

    // 3. Borrar userProjects/{uid} + subcollections
    await db.recursiveDelete(db.collection("userProjects").doc(uid));

    // 4. Quitar al usuario de todos los projects/{id}/members donde aparezca
    const memberDocs = await db.collectionGroup("members").where("userId", "==", uid).get();
    await Promise.all(memberDocs.docs.map((d) => d.ref.delete()));

    // 5. Cancelar invitaciones pendientes enviadas a este usuario
    const userDoc = await db.collection("users").doc(uid).get().catch(() => null);
    const email = userDoc?.data()?.email;
    if (email) {
      const invSnap = await db.collection("invitations").where("invitedEmail", "==", email).where("status", "==", "pending").get();
      await Promise.all(invSnap.docs.map((d) => d.ref.delete()));
    }

    // 6. Borrar archivos de Storage bajo users/{uid}/ si existen
    try {
      const storage = getStorage();
      const bucket = storage.bucket();
      const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
      await Promise.all(files.map((f) => f.delete().catch(() => {})));
    } catch (storageErr) {
      console.warn("[delete-user] Storage cleanup skipped:", storageErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[delete-user]", err?.code, err?.message);
    const msg = err?.code === "auth/user-not-found" ? "Usuario no encontrado en Auth" : err?.message || "Error al eliminar el usuario";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
