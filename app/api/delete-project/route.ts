import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { getStorage } from "firebase-admin/storage";
import { FieldPath } from "firebase-admin/firestore";

async function deleteStorageFolder(bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>, prefix: string) {
  const [files] = await bucket.getFiles({ prefix });
  if (files.length === 0) return;
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
}

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();
    if (!projectId) return NextResponse.json({ error: "projectId requerido" }, { status: 400 });

    // 1. Borrar proyecto + todas sus subcollections recursivamente
    await db.recursiveDelete(db.collection("projects").doc(projectId));

    // 2. Borrar referencias en userProjects de todos los miembros
    //    (ya no existen los member docs, buscamos en invitations y userProjects directamente)
    const userProjectsQuery = await db.collectionGroup("projects").where(FieldPath.documentId(), "==", projectId).get();
    await Promise.all(userProjectsQuery.docs.map((d) => d.ref.delete()));

    // 3. Borrar invitaciones pendientes del proyecto
    const invitationsSnap = await db.collection("invitations").where("projectId", "==", projectId).get();
    await Promise.all(invitationsSnap.docs.map((d) => d.ref.delete()));

    // 4. Borrar referencias en companyProjects de cada productora
    const companySnap = await db.collectionGroup("projects").where("projectId", "==", projectId).get();
    await Promise.all(companySnap.docs.map((d) => d.ref.delete()));

    // 5. Borrar archivos de Storage bajo projects/{projectId}/
    try {
      const storage = getStorage();
      const bucket = storage.bucket();
      await deleteStorageFolder(bucket, `projects/${projectId}/`);
    } catch (storageErr) {
      // Storage puede no estar configurado en el proyecto — no es fatal
      console.warn("[delete-project] Storage cleanup skipped:", storageErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[delete-project]", err?.code, err?.message);
    return NextResponse.json({ error: err?.message || "Error al eliminar el proyecto" }, { status: 500 });
  }
}
