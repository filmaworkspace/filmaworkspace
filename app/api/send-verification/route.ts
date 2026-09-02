import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db as adminDb } from "@/lib/firebase-admin";
import { verifyCodeHtml, verifyCodeText } from "@/lib/emails/verify-code";
import { Timestamp } from "firebase-admin/firestore";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_COOLDOWN_MS = 60 * 1000;

export async function POST(req: NextRequest) {
  const { name, email } = await req.json();

  if (!name || !email) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const ipAllowed = await rateLimit(`send-verification:${clientIp(req)}`, 10, 60 * 60 * 1000);
  if (!ipAllowed) return NextResponse.json({ error: "Demasiadas peticiones, inténtalo más tarde" }, { status: 429 });

  const existingRef = adminDb.collection("emailVerifications").doc(email);
  const existing = await existingRef.get();
  const existingData = existing.data();
  if (existingData?.lastSentAt && Date.now() - (existingData.lastSentAt as number) < RESEND_COOLDOWN_MS) {
    return NextResponse.json({ error: "Espera un momento antes de solicitar otro código" }, { status: 429 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000); // 10 min

  await existingRef.set({ code, name, expiresAt, attempts: 0, lastSentAt: Date.now() });

  const { data, error } = await resend.emails.send({
    from:    process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
    to:      [email],
    subject: `Filma Workspace | ${code} es tu código de verificación`,
    html:    verifyCodeHtml({ name, code }),
    text:    verifyCodeText({ name, code }),
    tags:    [{ name: "type", value: "verify-code" }],
  });

  if (error) {
    console.error("[send-verification]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
