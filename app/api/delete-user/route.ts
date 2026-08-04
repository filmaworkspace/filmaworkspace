import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  try {
    const { uid } = await req.json();
    if (!uid) return NextResponse.json({ error: "uid requerido" }, { status: 400 });

    // 1. Leer qué proyectos tiene el usuario ANTES de borrar nada. Usamos
    //    userProjects/{uid}/projects (ya indexado por defecto) en vez de un
    //    collectionGroup("members") — ese requeriría un índice de collection
    //    group que no existe en producción y hacía fallar todo el borrado.
    const userProjectsSnap = await db.collection("userProjects").doc(uid).collection("projects").get();
    const projectIds = userProjectsSnap.docs.map((d) => d.id);

    const userSnap = await db.collection("users").doc(uid).get().catch(() => null);
    const email = userSnap?.data()?.email;

    // 2. Quitar al usuario de projects/{id}/members para cada proyecto
    await Promise.all(
      projectIds.map((projectId) =>
        db.collection("projects").doc(projectId).collection("members").doc(uid).delete().catch(() => {})
      )
    );

    // 3. Borrar users/{uid} + subcollections (messages, etc.)
    await db.recursiveDelete(db.collection("users").doc(uid));

    // 4. Borrar userProjects/{uid} + subcollections
    await db.recursiveDelete(db.collection("userProjects").doc(uid));

    // 5. Cancelar invitaciones pendientes enviadas a este usuario (best-effort:
    //    si el índice compuesto no existe, no debe bloquear el borrado)
    if (email) {
      try {
        const invSnap = await db.collection("invitations").where("invitedEmail", "==", email).where("status", "==", "pending").get();
        await Promise.all(invSnap.docs.map((d) => d.ref.delete()));
      } catch (invErr) {
        console.warn("[delete-user] Invitations cleanup skipped:", invErr);
      }
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

    // 7. Borrar de Firebase Auth AL FINAL: si algún paso anterior falla, el
    //    usuario sigue existiendo en Auth y se puede reintentar sin toparse
    //    con "auth/user-not-found". Si ya no existe (por un intento previo
    //    parcial), no lo tratamos como error.
    try {
      await adminAuth.deleteUser(uid);
    } catch (authErr: any) {
      if (authErr?.code !== "auth/user-not-found") throw authErr;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[delete-user]", err?.code, err?.message);
    const msg = err?.code === "auth/user-not-found" ? "Usuario no encontrado en Auth" : err?.message || "Error al eliminar el usuario";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
