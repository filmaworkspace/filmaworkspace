// «Ver la demo como…»: cambia el rol del usuario demo en su proyecto de ejemplo.
// Solo para usuarios demo y solo en su propio proyecto de demo.
import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/require-auth";
import { DEMO_ROLES, type DemoRoleKey } from "@/lib/demoRoles";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const { role } = await req.json().catch(() => ({}));
  const preset = DEMO_ROLES[role as DemoRoleKey];
  if (!preset) return NextResponse.json({ error: "Rol no válido" }, { status: 400 });
  const user = (await db.collection("users").doc(auth.uid).get()).data();
  const projectId = user?.demoProjectId;
  if (!user?.isDemo || !projectId) return NextResponse.json({ error: "Solo disponible en la demo" }, { status: 403 });
  if (user.demoExpiresAt && user.demoExpiresAt.toMillis() < Date.now()) return NextResponse.json({ error: "La demo ha caducado" }, { status: 410 });
  const project = (await db.collection("projects").doc(projectId).get()).data();
  if (!project?.isDemo) return NextResponse.json({ error: "Solo disponible en la demo" }, { status: 403 });

  const data = { ...preset.member, updatedAt: Timestamp.now() };
  const batch = db.batch();
  batch.set(db.doc(`projects/${projectId}/members/${auth.uid}`), data, { merge: true });
  batch.set(db.doc(`userProjects/${auth.uid}/projects/${projectId}`), data, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
