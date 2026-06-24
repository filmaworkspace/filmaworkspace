import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { to, firstName, projectName, role, formUrl, senderName, memberId } =
    await req.json();

  if (!to || !firstName || !projectName || !formUrl || !memberId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
    to: [to],
    subject: `Completa tu ficha — ${projectName}`,
    html: fichaInviteHtml({ firstName, projectName, role, formUrl, senderName }),
    text: fichaInviteText({ firstName, projectName, role, formUrl, senderName }),
    idempotencyKey: `ficha-invite/${memberId}/${Date.now()}`,
    tags: [{ name: "type", value: "ficha-invite" }],
  });

  if (error) {
    console.error("[send-invite]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
