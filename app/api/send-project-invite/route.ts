import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { projectInviteHtml, projectInviteText } from "@/lib/emails/project-invite";
import { verifyRequestAuth } from "@/lib/serverAuth";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await verifyRequestAuth(req);
  if (auth instanceof NextResponse) return auth;

  const {
    inviteeName,
    invitedByName,
    invitedEmail,
    projectName,
    projectId,
    role,
    isExistingUser,
  } = await req.json();

  if (!invitedEmail || !inviteeName || !projectName || !projectId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const base        = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";
  const loginUrl    = `${base}/login`;
  const registerUrl = `${base}/register`;

  const { data, error } = await resend.emails.send({
    from:           process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
    to:             [invitedEmail],
    subject:        `${invitedByName} te ha invitado a "${projectName}" — Filma Workspace`,
    html:           projectInviteHtml({ inviteeName, invitedByName, projectName, role: role ?? "", isExistingUser, loginUrl, registerUrl }),
    text:           projectInviteText({ inviteeName, invitedByName, projectName, role: role ?? "", isExistingUser, loginUrl, registerUrl }),
    idempotencyKey: `project-invite/${projectId}/${invitedEmail}`,
    tags:           [{ name: "type", value: "project-invite" }],
  });

  if (error) {
    console.error("[send-project-invite]", error);
    return NextResponse.json({ error: "Error al enviar el email" }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
