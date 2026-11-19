import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { logSecurityEvent } from "@/lib/server/securityLog";
import { auditFromServer } from "@/lib/server/audit";
import { sendEmail } from "@/lib/emails/send";
import { resetPasswordHtml, resetPasswordText } from "@/lib/emails/reset-password";

// ─────────────────────────────────────────────────────────────────────────────
// Acciones sobre la cuenta de un usuario (ficha 360º del admin):
//   info · suspend · reactivate · revoke · change-email · verify-email ·
//   send-reset · export
// Las delicadas exigen haber confirmado la contraseña hace menos de 5 min.
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE = new Set(["suspend", "change-email", "export"]);
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";

const plain = (v: unknown): unknown => {
  if (v && typeof v === "object") {
    if (typeof (v as { toDate?: () => Date }).toDate === "function") return (v as { toDate: () => Date }).toDate().toISOString();
    if (Array.isArray(v)) return v.map(plain);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { uid, action } = body as { uid?: string; action?: string };
  const admin = await requireAdmin(req, SENSITIVE.has(action || "") ? { recentAuthMinutes: 5 } : {});
  if (!admin.ok) return admin.response;
  if (!uid || typeof uid !== "string") return NextResponse.json({ error: "uid requerido" }, { status: 400 });

  const userRef = db.collection("users").doc(uid);
  const target = (await userRef.get()).data() || {};
  const label = `${target.name || uid} (${target.email || ""})`;
  const isStaff = target.role === "admin" || target.role === "support_agent";

  try {
    switch (action) {
      case "info": {
        const u = await adminAuth.getUser(uid).catch(() => null);
        return NextResponse.json({
          exists: !!u,
          emailVerified: u?.emailVerified ?? false,
          disabled: u?.disabled ?? false,
          lastSignInTime: u?.metadata.lastSignInTime || null,
          lastRefreshTime: u?.metadata.lastRefreshTime || null,
          creationTime: u?.metadata.creationTime || null,
          providers: u?.providerData.map((p) => p.providerId) || [],
        });
      }

      case "suspend": {
        if (uid === admin.uid) return NextResponse.json({ error: "No puedes suspenderte a ti mismo" }, { status: 400 });
        if (isStaff) return NextResponse.json({ error: "Quítale antes el rol de admin o soporte" }, { status: 400 });
        await adminAuth.updateUser(uid, { disabled: true });
        await adminAuth.revokeRefreshTokens(uid);
        await userRef.set({ suspended: true, suspendedAt: FieldValue.serverTimestamp(), suspendedBy: admin.uid, suspendedReason: String(body.reason || "").slice(0, 300) }, { merge: true });
        await logSecurityEvent("account_suspended", { req, uid, actorUid: admin.uid, target: target.email, details: body.reason || "" });
        await auditFromServer(admin.uid, "user_suspended", `${label}${body.reason ? ` — ${body.reason}` : ""}`);
        return NextResponse.json({ ok: true });
      }

      case "reactivate": {
        await adminAuth.updateUser(uid, { disabled: false });
        await userRef.set({ suspended: false, suspendedAt: null, suspendedBy: null, suspendedReason: null }, { merge: true });
        await logSecurityEvent("account_reactivated", { req, uid, actorUid: admin.uid, target: target.email });
        await auditFromServer(admin.uid, "user_reactivated", label);
        return NextResponse.json({ ok: true });
      }

      case "revoke": {
        await adminAuth.revokeRefreshTokens(uid);
        await logSecurityEvent("sessions_revoked", { req, uid, actorUid: admin.uid, target: target.email });
        await auditFromServer(admin.uid, "user_sessions_revoked", label);
        return NextResponse.json({ ok: true });
      }

      case "verify-email": {
        await adminAuth.updateUser(uid, { emailVerified: true });
        await auditFromServer(admin.uid, "user_email_verified", label);
        return NextResponse.json({ ok: true });
      }

      case "change-email": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Email no válido" }, { status: 400 });
        const taken = await adminAuth.getUserByEmail(email).catch(() => null);
        if (taken && taken.uid !== uid) return NextResponse.json({ error: "Ese email ya lo usa otra cuenta" }, { status: 409 });
        await adminAuth.updateUser(uid, { email, emailVerified: true });
        await userRef.set({ email }, { merge: true });
        // También en la ficha de miembro de cada proyecto
        const ups = await db.collection("userProjects").doc(uid).collection("projects").get();
        await Promise.all(ups.docs.map((d) => db.collection("projects").doc(d.id).collection("members").doc(uid).set({ email }, { merge: true }).catch(() => {})));
        await logSecurityEvent("email_changed", { req, uid, actorUid: admin.uid, target: email, details: `${target.email} → ${email}` });
        await auditFromServer(admin.uid, "user_email_changed", `${target.name || uid}: ${target.email} → ${email}`);
        return NextResponse.json({ ok: true });
      }

      case "send-reset": {
        if (!target.email) return NextResponse.json({ error: "El usuario no tiene email" }, { status: 400 });
        const resetUrl = await adminAuth.generatePasswordResetLink(target.email, { url: `${BASE_URL}/login` });
        const { error } = await sendEmail({
          to: [target.email],
          subject: "Filma Workspace | Restablecer tu contraseña",
          html: resetPasswordHtml({ name: target.name || "", resetUrl }),
          text: resetPasswordText({ name: target.name || "", resetUrl }),
          tags: [{ name: "type", value: "reset-password" }],
        }, undefined, { userId: uid, sentByAdmin: admin.uid });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        await auditFromServer(admin.uid, "user_reset_sent", label);
        return NextResponse.json({ ok: true });
      }

      case "export": {
        const [ups, chat, archive, mails, drafts] = await Promise.all([
          db.collection("userProjects").doc(uid).collection("projects").get(),
          db.collection("supportChats").doc(uid).get(),
          db.collection("supportArchive").where("userId", "==", uid).get(),
          target.email ? db.collection("emailLog").where("to", "array-contains", target.email).get() : Promise.resolve(null),
          db.collection("userBudgetingDrafts").doc(uid).collection("drafts").get(),
        ]);
        const members = await Promise.all(ups.docs.map(async (d) => {
          const m = await db.collection("projects").doc(d.id).collection("members").doc(uid).get();
          const p = await db.collection("projects").doc(d.id).get();
          return { projectId: d.id, projectName: p.data()?.name || null, membership: m.data() || null, access: d.data() };
        }));
        const authUser = await adminAuth.getUser(uid).catch(() => null);
        const data = plain({
          exportedAt: new Date().toISOString(),
          profile: target,
          account: authUser ? { email: authUser.email, emailVerified: authUser.emailVerified, disabled: authUser.disabled, metadata: authUser.metadata } : null,
          projects: members,
          supportOpen: chat.data() || null,
          supportClosed: archive.docs.map((d) => ({ id: d.id, ...d.data() })),
          emails: (mails?.docs || []).map((d) => { const x = d.data(); return { subject: x.subject, template: x.template, status: x.status, createdAt: x.createdAt }; }),
          budgetingDrafts: drafts.docs.map((d) => ({ id: d.id, ...d.data() })),
        });
        await logSecurityEvent("data_exported", { req, uid, actorUid: admin.uid, target: target.email });
        await auditFromServer(admin.uid, "user_data_exported", label);
        return NextResponse.json({ data });
      }

      default:
        return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }
  } catch (err) {
    console.error("[admin/users]", action, (err as Error)?.message);
    return NextResponse.json({ error: (err as Error)?.message || "Error" }, { status: 500 });
  }
}
