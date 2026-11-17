import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/require-auth";

// ─────────────────────────────────────────────────────────────────────────────
// Aceptar una invitación a un proyecto.
//
// Antes se hacía desde el cliente: el invitado escribía su propio doc en
// projects/{id}/members y userProjects/{uid}/projects/{id}. Eso obligaba a que
// las reglas de Firestore dejaran a cualquier usuario crearse esos docs con
// los permisos que quisiera (y por tanto entrar en cualquier proyecto). Ahora
// lo hace el servidor, copiando los permisos de la invitación, y las reglas
// ya no permiten que un usuario se añada a sí mismo.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const uid = auth.uid;

  try {
    const { invitationId } = await req.json();
    if (!invitationId || typeof invitationId !== "string") {
      return NextResponse.json({ error: "Falta invitationId" }, { status: 400 });
    }

    const invRef = db.collection("invitations").doc(invitationId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) {
      return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 });
    }
    const inv = invSnap.data()!;

    // La invitación tiene que ser para quien llama (por uid o por email).
    const userRecord = await adminAuth.getUser(uid);
    const email = (userRecord.email || "").toLowerCase();
    const isInvitee =
      inv.invitedUserId === uid ||
      (!!email && typeof inv.invitedEmail === "string" && inv.invitedEmail.toLowerCase() === email);
    if (!isInvitee) {
      return NextResponse.json({ error: "Esta invitación no es para ti" }, { status: 403 });
    }

    if (inv.status !== "pending") {
      return NextResponse.json({ error: "La invitación ya no está pendiente" }, { status: 409 });
    }

    const expiresAt: Date | null =
      inv.expiresAt instanceof Timestamp ? inv.expiresAt.toDate()
      : inv.expiresAt ? new Date(inv.expiresAt)
      : null;
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return NextResponse.json({ error: "La invitación ha caducado" }, { status: 410 });
    }

    const projectId: string = inv.projectId;
    if (!projectId) {
      return NextResponse.json({ error: "Invitación sin proyecto" }, { status: 400 });
    }

    const userSnap = await db.collection("users").doc(uid).get();
    const userName: string = userSnap.data()?.name || userRecord.displayName || "";
    const userEmail: string = userSnap.data()?.email || userRecord.email || "";

    const permissions = {
      config: !!inv.permissions?.config,
      accounting: !!inv.permissions?.accounting,
      team: !!inv.permissions?.team,
    };
    const shared = {
      role: inv.role || null,
      department: inv.department || null,
      position: inv.position || null,
      permissions,
      ...(inv.accountingAccessLevel ? { accountingAccessLevel: inv.accountingAccessLevel } : {}),
      ...(inv.boxAccess !== undefined ? { boxAccess: !!inv.boxAccess } : {}),
      addedAt: Timestamp.now(),
    };

    const batch = db.batch();
    batch.update(invRef, { status: "accepted", respondedAt: Timestamp.now(), invitedUserId: uid });
    batch.set(db.collection("projects").doc(projectId).collection("members").doc(uid), {
      userId: uid,
      name: userName,
      email: userEmail,
      ...shared,
    });
    batch.set(db.collection("userProjects").doc(uid).collection("projects").doc(projectId), {
      projectId,
      ...shared,
    });
    batch.set(db.collection("projects").doc(projectId).collection("logs").doc(), {
      type: "invitation_accepted",
      actorName: userName,
      actorEmail: userEmail,
      createdAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ ok: true, projectId });
  } catch (err: any) {
    console.error("[accept-invitation]", err?.message);
    return NextResponse.json({ error: "Error al aceptar la invitación" }, { status: 500 });
  }
}
