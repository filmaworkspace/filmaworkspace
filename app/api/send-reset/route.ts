import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { adminAuth } from "@/lib/firebase-admin";
import { resetPasswordHtml, resetPasswordText } from "@/lib/emails/reset-password";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }

    // Lookup user — only swallow "user not found" to avoid leaking existence
    let name = "";
    try {
      const user = await adminAuth.getUserByEmail(email);
      name = user.displayName ?? "";
    } catch (err: any) {
      if (err?.code === "auth/user-not-found") {
        return NextResponse.json({ ok: true });
      }
      // Any other error (bad credentials, SDK init failure, network) → surface it
      console.error("[send-reset] adminAuth.getUserByEmail failed:", err?.code, err?.message);
      throw err;
    }

    // Generate branded reset link via Firebase Admin
    let resetUrl: string;
    try {
      resetUrl = await adminAuth.generatePasswordResetLink(email, {
        url: `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com"}/login`,
      });
    } catch (err: any) {
      console.error("[send-reset] generatePasswordResetLink failed:", err?.code, err?.message);
      throw err;
    }

    const { data, error } = await resend.emails.send({
      from:           process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
      to:             [email],
      subject:        "Restablecer tu contraseña — Filma Workspace",
      html:           resetPasswordHtml({ name, resetUrl }),
      text:           resetPasswordText({ name, resetUrl }),
      idempotencyKey: `reset-password/${email}/${Date.now()}`,
      tags:           [{ name: "type", value: "reset-password" }],
    });

    if (error) {
      console.error("[send-reset] Resend error:", error);
      return NextResponse.json({ error: "No se pudo enviar el email. Inténtalo más tarde." }, { status: 500 });
    }

    return NextResponse.json({ id: data?.id });
  } catch (err) {
    console.error("[send-reset] Unexpected error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
