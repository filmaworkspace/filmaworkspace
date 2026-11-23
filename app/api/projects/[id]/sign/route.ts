import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/require-auth";
import { adminAction, createSignRequest } from "@/lib/server/sign";
import { projectSignAccess } from "@/lib/server/projectSign";
import type { SignRequest } from "@/lib/sign/types";

// Filma Sign en un proyecto (Equipo):
//   GET  → solicitudes del proyecto
//   POST { action: "create", title, body, signer, message, signature, issuerName, issuerRole }
//   POST { action: "cancel" | "remind" | "resend_copy", id }
// Todo lo que se envía se imputa a la cuenta del proyecto (factura por uso).

const meta = (req: NextRequest) => ({
  ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "",
  userAgent: req.headers.get("user-agent") || "",
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ctx = await projectSignAccess(id, auth.uid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const snap = await db.collection("signRequests").where("projectId", "==", id).get();
  const rows = snap.docs.map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tokenHashes, tokenIndex, ...rest } = d.data();
    return { id: d.id, ...rest } as SignRequest;
  }).sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ requests: rows, project: { name: ctx.projectName, billed: !!ctx.producerId } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ctx = await projectSignAccess(id, auth.uid);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "create") {
      const sig = b.signature || {};
      if (typeof sig.image !== "string" || !sig.image.startsWith("data:image/png;base64,") || sig.image.length > 400_000) throw new Error("Falta tu firma");
      if (!ctx.producerId) throw new Error("El proyecto no tiene una cuenta a la que imputar Filma Sign");
      const m = meta(req);
      const r = await createSignRequest({
        kind: "document", title: b.title, body: b.body, docType: typeof b.docType === "string" ? b.docType : null,
        signer: { name: String(b.signer?.name || ""), email: String(b.signer?.email || ""), role: b.signer?.role, taxId: b.signer?.taxId },
        issuer: {
          name: String(b.issuerName || ctx.user.name), email: ctx.user.email, role: String(b.issuerRole || ctx.projectName),
          signature: { image: sig.image, method: sig.method === "type" ? "type" : "draw", typedName: String(sig.typedName || ""), signedAt: Date.now(), ip: m.ip, userAgent: m.userAgent.slice(0, 300) },
        },
        message: b.message, expiresInDays: Number(b.expiresInDays) || 30, createdBy: auth.uid,
        billTo: { producerId: ctx.producerId, projectId: id, projectName: ctx.projectName },
      }, m);
      return NextResponse.json(r);
    }
    if (["cancel", "remind", "resend_copy"].includes(b.action) && typeof b.id === "string") {
      const r = (await db.doc(`signRequests/${b.id}`).get()).data();
      if (!r || r.projectId !== id) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
      const out = await adminAction(b.id, b.action, ctx.user.name);
      return NextResponse.json({ ok: true, ...out });
    }
    return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "No se pudo completar" }, { status: 400 });
  }
}
