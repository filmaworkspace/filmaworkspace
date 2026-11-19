import { getStorage } from "firebase-admin/storage";
import { db } from "@/lib/firebase-admin";

async function deleteStorageFolder(bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>, prefix: string) {
  const [files] = await bucket.getFiles({ prefix });
  if (files.length === 0) return;
  await Promise.all(files.map((f) => f.delete().catch(() => {})));
}

/**
 * Borra un proyecto entero: documentos, accesos de los miembros y de las
 * productoras, invitaciones, archivos y la copia de la papelera del admin.
 * Lo usan /api/delete-project y el vaciado de la papelera (cron admin-digest).
 */
export async function purgeProject(projectId: string) {
  const projectRef = db.collection("projects").doc(projectId);

  // 1. Leer miembros y productoras asociadas ANTES de borrar nada. Evitamos
  //    collectionGroup("projects") (requiere un índice de collection group
  //    que no existe en producción y hacía fallar todo el borrado) usando
  //    en su lugar los datos que ya tenemos: el propio doc del proyecto
  //    (campo "producers") y su subcolección "members".
  const [projectSnap, membersSnap] = await Promise.all([
    projectRef.get(),
    projectRef.collection("members").get(),
  ]);
  const producerIds: string[] = projectSnap.data()?.producers || [];
  const memberIds = membersSnap.docs.map((d) => d.id);

  // 2. Borrar proyecto + todas sus subcollections recursivamente
  await db.recursiveDelete(projectRef);

  // 3. Quitar la referencia en userProjects de cada miembro
  await Promise.all(
    memberIds.map((uid) =>
      db.collection("userProjects").doc(uid).collection("projects").doc(projectId).delete().catch(() => {})
    )
  );

  // 4. Quitar la referencia en companyProjects de cada productora asociada
  await Promise.all(
    producerIds.map((producerId) =>
      db.collection("companyProjects").doc(producerId).collection("projects").doc(projectId).delete().catch(() => {})
    )
  );

  // 5. Borrar invitaciones pendientes del proyecto (best-effort)
  try {
    const invitationsSnap = await db.collection("invitations").where("projectId", "==", projectId).get();
    await Promise.all(invitationsSnap.docs.map((d) => d.ref.delete()));
  } catch (invErr) {
    console.warn("[delete-project] Invitations cleanup skipped:", invErr);
  }

  // 6. Borrar archivos de Storage bajo projects/{projectId}/
  try {
    const storage = getStorage();
    const bucket = storage.bucket();
    await deleteStorageFolder(bucket, `projects/${projectId}/`);
  } catch (storageErr) {
    // Storage puede no estar configurado en el proyecto — no es fatal
    console.warn("[delete-project] Storage cleanup skipped:", storageErr);
  }
  await db.collection("adminTrash").doc(projectId).delete().catch(() => {});
}
