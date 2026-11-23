import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { auditFromServer } from "@/lib/server/audit";
import { adminAction, createSignRequest } from "@/lib/server/sign";

// Filma Sign (admin):
//   POST { action: "create", kind, quoteId? | title+body?, signer, message, signature, issuerName, issuerRole }
//   POST { action: "cancel" | "remind" | "resend_copy", id }

const meta = (req: NextRequest) => ({
  ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "",
  userAgent: req.headers.get("user-agent") || "",
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const b = await req.json().catch(() => ({}));
  const me = (await db.doc(`users/${admin.uid}`).get()).data() || {};
  try {
    if (b.action === "create") {
      const sig = b.signature || {};
      if (typeof sig.image !== "string" || !sig.image.startsWith("data:image/png;base64,") || sig.image.length > 400_000) throw new Error("Falta tu firma");
      const settings = (await db.doc("adminConfig/billing").get()).data() || {};
      const m = meta(req);
      const r = await createSignRequest({
        kind: b.kind === "document" ? "document" : "quote",
        quoteId: b.quoteId, title: b.title, body: b.body,
        signer: { name: String(b.signer?.name || ""), email: String(b.signer?.email || ""), role: b.signer?.role, taxId: b.signer?.taxId },
        issuer: {
          name: String(b.issuerName || me.name || "Filma"), email: settings.email || me.email || "",
          role: String(b.issuerRole || settings.name || "Filma Workspace"),
          signature: { image: sig.image, method: sig.method === "type" ? "type" : "draw", typedName: String(sig.typedName || ""), signedAt: Date.now(), ip: m.ip, userAgent: m.userAgent.slice(0, 300) },
        },
        message: b.message, expiresInDays: Number(b.expiresInDays) || 30, createdBy: admin.uid,
      }, m);
      await auditFromServer(admin.uid, "sign_request_created", `${r.id} → ${b.signer?.email}`);
      return NextResponse.json(r);
    }
    if (["cancel", "remind", "resend_copy"].includes(b.action) && typeof b.id === "string") {
      const r = await adminAction(b.id, b.action, me.name || me.email || admin.uid);
      await auditFromServer(admin.uid, `sign_${b.action}`, b.id);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "No se pudo completar" }, { status: 400 });
  }
}
