import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";
import { verifyRequestAuth } from "@/lib/serverAuth";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await verifyRequestAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { to, name, formUrl, projectName } = await req.json();

  if (!to || !formUrl || !projectName) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Filma Workspace <noreply@filmaworkspace.com>",
    to: [to],
    subject: `Recordatorio: completa tu ficha — ${projectName}`,
    html: fichaInviteHtml({ firstName: name || to, projectName, formUrl }),
    text: fichaInviteText({ firstName: name || to, projectName, formUrl }),
    tags: [{ name: "type", value: "form-reminder" }],
  });

  if (error) {
    console.error("[send-form-reminder]", error);
    return NextResponse.json({ error: "Error al enviar el email" }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
