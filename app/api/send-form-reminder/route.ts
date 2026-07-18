import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { to, name, formUrl, projectName, workingTitle } = await req.json();

  const projectLabel = workingTitle || projectName;

  if (!to || !formUrl || !projectName) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Filma Workspace <noreply@filmaworkspace.com>",
    to: [to],
    subject: `${projectLabel} | Recordatorio: completa tu ficha`,
    html: fichaInviteHtml({ firstName: name || to, projectName, formUrl }),
    text: fichaInviteText({ firstName: name || to, projectName, formUrl }),
    tags: [{ name: "type", value: "form-reminder" }],
  });

  if (error) {
    console.error("[send-form-reminder]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
