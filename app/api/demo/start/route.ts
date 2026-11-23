// Entrada a la demo desde el enlace: la primera vez crea el usuario y el
// proyecto de ejemplo; después vuelve a entrar en el mismo. Devuelve un token
// de sesión (custom token) para iniciar sesión sin contraseña.
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createDemoProject, createDemoUser, hashToken, repairDemoApprovals } from "@/lib/server/demo";

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`demo-start:${clientIp(req)}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ error: "Demasiados intentos. Prueba en unos minutos." }, { status: 429 });
  }
  const { token, check } = await req.json().catch(() => ({}));
  if (!token || typeof token !== "string" || token.length > 100) return NextResponse.json({ error: "Enlace no válido" }, { status: 400 });
  const ref = db.collection("demoLinks").doc(hashToken(token));
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Este enlace de demo no existe." }, { status: 404 });
  const link = snap.data()!;
  if (link.status === "revoked") return NextResponse.json({ error: "Este enlace de demo ya no está activo." }, { status: 410 });
  if ((link.expiresAt as Timestamp).toMillis() < Date.now()) return NextResponse.json({ error: "Este enlace de demo ha caducado." }, { status: 410 });
  // Solo comprobar (la página lo usa para saludar antes de entrar).
  if (check) return NextResponse.json({ ok: true, name: link.name, expiresAt: (link.expiresAt as Timestamp).toDate().toISOString(), started: !!link.uid });

  try {
    let uid: string = link.uid, projectId: string = link.projectId;
    if (!uid) {
      // Reserva el enlace para no crear dos demos si se pulsa dos veces.
      const claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.data()?.creating || s.data()?.uid) return false;
        tx.update(ref, { creating: true });
        return true;
      });
      if (!claimed) return NextResponse.json({ error: "La demo se está preparando. Vuelve a intentarlo en unos segundos." }, { status: 409 });
      const user = await createDemoUser({ name: link.name, email: link.email, expiresAt: link.expiresAt });
      uid = user.uid;
      projectId = await createDemoProject(uid, { name: link.name, email: user.email });
      await db.collection("users").doc(uid).update({ demoProjectId: projectId, demoLinkId: ref.id });
      await ref.update({ uid, projectId, creating: FieldValue.delete(), firstOpenedAt: FieldValue.serverTimestamp() });
    } else {
      await repairDemoApprovals(projectId, uid).catch(() => {});
    }
    await ref.update({ lastOpenedAt: FieldValue.serverTimestamp(), opens: FieldValue.increment(1) });
    const customToken = await adminAuth.createCustomToken(uid, { demo: true });
    return NextResponse.json({ customToken, projectId });
  } catch (e) {
    console.error("[demo/start]", (e as Error).message);
    await ref.update({ creating: FieldValue.delete() }).catch(() => {});
    return NextResponse.json({ error: "No se ha podido preparar la demo." }, { status: 500 });
  }
}
