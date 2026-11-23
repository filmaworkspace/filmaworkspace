// Filma Sign dentro de un proyecto (Equipo): quién puede usarlo y a qué
// cuenta se imputa lo que se envía.
import { db } from "@/lib/firebase-admin";

export interface ProjectSignContext {
  projectId: string;
  projectName: string;
  producerId: string | null;
  user: { uid: string; name: string; email: string };
}

/** Misma regla que Equipo en Firestore: permiso de equipo, EP/PM/PC o admin; y el servicio contratado. */
export async function projectSignAccess(projectId: string, uid: string): Promise<ProjectSignContext | { error: string; status: number }> {
  const [p, m, up, u] = await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.doc(`projects/${projectId}/members/${uid}`).get(),
    db.doc(`userProjects/${uid}/projects/${projectId}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  if (!p.exists) return { error: "Proyecto no encontrado", status: 404 };
  const pd = p.data() || {};
  if (!pd.modules?.sign) return { error: "Filma Sign no está activado en este proyecto", status: 403 };
  const md = m.data() || {}, ud = u.data() || {};
  const isAdmin = ud.role === "admin";
  const team = !!(md.permissions?.team || up.data()?.permissions?.team || ["EP", "PM", "PC"].includes(md.role));
  if (!isAdmin && !(m.exists && team)) return { error: "No tienes acceso a Equipo en este proyecto", status: 403 };
  if (pd.frozen || pd.trashedAt) return { error: "El proyecto está cerrado", status: 403 };
  return {
    projectId, projectName: pd.name || projectId,
    producerId: pd.signBillTo || (pd.producers || [])[0] || null,
    user: { uid, name: md.name || ud.name || ud.email || "", email: ud.email || md.email || "" },
  };
}
