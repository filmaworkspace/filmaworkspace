import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { adminAuth } from "@/lib/firebase-admin";
import { resetPasswordHtml, resetPasswordText } from "@/lib/emails/reset-password";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email requerido" }, { status: 400 });
  }

  // Lookup user name from Firebase Admin
  let name = "";
  try {
    const user = await adminAuth.getUserByEmail(email);
    name = user.displayName ?? "";
  } catch {
    // User not found — still return 200 to avoid leaking existence
    return NextResponse.json({ ok: true });
  }

  // Generate branded reset link via Firebase Admin
  const resetUrl = await adminAuth.generatePasswordResetLink(email, {
    url: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com"}/login`,
  });

  const { data, error } = await resend.emails.send({
    from:           process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
    to:             [email],
    subject:        "Restablecer tu contraseña — Filma Workspace",
    html:           resetPasswordHtml({ name, resetUrl }),
    text:           resetPasswordText({ name, resetUrl }),
    tags:           [{ name: "type", value: "reset-password" }],
  });

  if (error) {
    console.error("[send-reset]", error);
    return NextResponse.json({ error: "Error al enviar el email" }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
