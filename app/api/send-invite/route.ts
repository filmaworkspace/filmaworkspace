import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";
import { verifyRequestAuth } from "@/lib/serverAuth";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await verifyRequestAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { to, firstName, projectName, role, formUrl, pin, senderName, memberId } =
    await req.json();

  if (!to || !firstName || !projectName || !formUrl || !memberId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
    to: [to],
    subject: `Completa tu ficha — ${projectName}`,
    html: fichaInviteHtml({ firstName, projectName, role, formUrl, pin, senderName }),
    text: fichaInviteText({ firstName, projectName, role, formUrl, pin, senderName }),
    tags: [{ name: "type", value: "ficha-invite" }],
  });

  if (error) {
    console.error("[send-invite]", error);
    return NextResponse.json({ error: "Error al enviar el email" }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
