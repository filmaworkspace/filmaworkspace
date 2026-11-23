// Admin · enlaces de demo: crear (y enviar por email), listar y revocar.
import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { auditFromServer } from "@/lib/server/audit";
import { hashToken, newToken } from "@/lib/server/demo";
import { sendEmail } from "@/lib/emails/send";
import { demoInviteHtml } from "@/lib/emails/demo-invite";

const origin = (req: NextRequest) => (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const snap = await db.collection("demoLinks").orderBy("createdAt", "desc").limit(200).get();
  return NextResponse.json({
    links: snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id, name: x.name, email: x.email || null, note: x.note || "", status: x.status, createdByName: x.createdByName || "",
        createdAt: iso(x.createdAt), expiresAt: iso(x.expiresAt), firstOpenedAt: iso(x.firstOpenedAt), lastOpenedAt: iso(x.lastOpenedAt),
        opens: x.opens || 0, projectId: x.projectId || null, sentAt: iso(x.sentAt),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120) || null;
  const days = Math.min(60, Math.max(1, Number(body.days) || 14));
  const note = String(body.note || "").trim().slice(0, 300);
  if (!name) return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email no válido" }, { status: 400 });
  if (body.send && !email) return NextResponse.json({ error: "Para enviarlo hace falta un email" }, { status: 400 });

  const adminDoc = await db.collection("users").doc(admin.uid).get();
  const adminName = adminDoc.data()?.name || "Filma";
  const token = newToken();
  const ref = db.collection("demoLinks").doc(hashToken(token));
  const expiresAt = Timestamp.fromMillis(Date.now() + days * 86400000);
  await ref.set({ name, email, note, status: "active", expiresAt, opens: 0, createdAt: FieldValue.serverTimestamp(), createdBy: admin.uid, createdByName: adminName });
  const url = `${origin(req)}/demo/${token}`;
  if (body.send && email) {
    await sendEmail({
      to: email,
      subject: `${adminName} te invita a probar Filma Workspace`,
      html: demoInviteHtml({ name, adminName, url, expiresAt: expiresAt.toDate() }),
      tags: [{ name: "type", value: "demo-invite" }],
    });
    await ref.update({ sentAt: FieldValue.serverTimestamp() });
  }
  await auditFromServer(admin.uid, "demo_link_created", `${name}${email ? ` <${email}>` : ""} · ${days} días`).catch(() => {});
  return NextResponse.json({ id: ref.id, url });
}

/** Revocar: el enlace deja de funcionar y el usuario demo se desactiva. */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { id, action } = await req.json().catch(() => ({}));
  if (!id || action !== "revoke") return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  const ref = db.collection("demoLinks").doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const uid = snap.data()?.uid;
  if (uid) await adminAuth.updateUser(uid, { disabled: true }).catch(() => {});
  await ref.update({ status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: admin.uid });
  await auditFromServer(admin.uid, "demo_link_revoked", snap.data()?.name || id).catch(() => {});
  return NextResponse.json({ ok: true });
}
