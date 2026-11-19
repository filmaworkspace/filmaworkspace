import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";

// ─────────────────────────────────────────────────────────────────────────────
// Webhook de Resend: actualiza el estado de cada email de emailLog (entregado,
// rebotado, marcado como spam, abierto…). Configurar en Resend → Webhooks con
// la URL https://<dominio>/api/webhooks/resend y guardar el "signing secret"
// en RESEND_WEBHOOK_SECRET. La firma es la de Svix (la que usa Resend).
// ─────────────────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = {
  sent: 1, delivery_delayed: 2, delivered: 3, opened: 4, clicked: 5, failed: 6, bounced: 7, complained: 8,
};

function verify(body: string, req: NextRequest): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigs = req.headers.get("svix-signature");
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(" ").some((s) => {
    const [, sig] = s.split(",");
    if (!sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (!verify(body, req)) return NextResponse.json({ error: "Firma no válida" }, { status: 401 });

  let event: { type?: string; created_at?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try { event = JSON.parse(body); } catch { return NextResponse.json({ error: "JSON no válido" }, { status: 400 }); }

  const emailId = event.data?.email_id;
  const status = (event.type || "").replace(/^email\./, "");
  if (!emailId || !RANK[status]) return NextResponse.json({ ok: true, ignored: true });

  const snap = await db.collection("emailLog").where("resendId", "==", emailId).limit(1).get();
  if (snap.empty) return NextResponse.json({ ok: true, unknown: true });

  const ref = snap.docs[0].ref;
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    const update: Record<string, unknown> = {
      events: FieldValue.arrayUnion({ type: status, at: event.created_at || new Date().toISOString() }),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if ((RANK[status] || 0) > (RANK[cur.status as string] || 0)) update.status = status;
    if (status === "bounced") update.error = event.data?.bounce?.message || "Rebotado";
    tx.update(ref, update);
  });
  return NextResponse.json({ ok: true });
}
