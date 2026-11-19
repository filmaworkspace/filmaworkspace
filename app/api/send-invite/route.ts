import { sendEmail } from "@/lib/emails/send";
import { NextRequest, NextResponse } from "next/server";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";
import { requireUser } from "@/lib/require-auth";


export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const { to, firstName, projectName, workingTitle, role, formUrl, pin, senderName, memberId } =
    await req.json();

  const projectLabel = workingTitle || projectName;

  if (!to || !firstName || !projectName || !formUrl || !memberId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data, error } = await sendEmail({
    to: [to],
    subject: `${projectLabel} | Completa tu ficha`,
    html: fichaInviteHtml({ firstName, projectName, role, formUrl, pin, senderName }),
    text: fichaInviteText({ firstName, projectName, role, formUrl, pin, senderName }),
    tags: [{ name: "type", value: "ficha-invite" }],
  }, { idempotencyKey: `ficha-invite/${memberId}/${Date.now()}` });

  if (error) {
    console.error("[send-invite]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
