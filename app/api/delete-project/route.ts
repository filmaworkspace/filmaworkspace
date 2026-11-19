import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { purgeProject } from "@/lib/server/deleteProject";
import { requireUser } from "@/lib/require-auth";

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { projectId } = await req.json();
    if (!projectId || typeof projectId !== "string") return NextResponse.json({ error: "projectId requerido" }, { status: 400 });

    // Puede borrar un proyecto un administrador de Filma o el EP del proyecto.
    const [userSnap, memberSnap] = await Promise.all([
      db.collection("users").doc(auth.uid).get(),
      db.collection("projects").doc(projectId).collection("members").doc(auth.uid).get(),
    ]);
    const isAdmin = userSnap.data()?.role === "admin";
    const isEP = memberSnap.exists && memberSnap.data()?.role === "EP";
    if (!isAdmin && !isEP) {
      return NextResponse.json({ error: "Solo el EP del proyecto o un administrador pueden eliminarlo" }, { status: 403 });
    }

    await purgeProject(projectId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[delete-project]", err?.code, err?.message);
    return NextResponse.json({ error: err?.message || "Error al eliminar el proyecto" }, { status: 500 });
  }
}
