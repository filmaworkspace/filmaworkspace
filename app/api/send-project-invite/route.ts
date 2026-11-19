import { sendEmail } from "@/lib/emails/send";
import { NextRequest, NextResponse } from "next/server";
import { projectInviteHtml, projectInviteText } from "@/lib/emails/project-invite";
import { requireUser } from "@/lib/require-auth";


export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const {
    inviteeName,
    invitedByName,
    invitedEmail,
    projectName,
    workingTitle,
    projectId,
    role,
    isExistingUser,
  } = await req.json();

  const projectLabel = workingTitle || projectName;

  if (!invitedEmail || !inviteeName || !projectName || !projectId) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const base        = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";
  const loginUrl    = `${base}/login`;
  const registerUrl = `${base}/register`;

  const { data, error } = await sendEmail({
    to:             [invitedEmail],
    subject:        `${projectLabel} | ${invitedByName} te ha invitado`,
    html:           projectInviteHtml({ inviteeName, invitedByName, projectName, role: role ?? "", isExistingUser, loginUrl, registerUrl }),
    text:           projectInviteText({ inviteeName, invitedByName, projectName, role: role ?? "", isExistingUser, loginUrl, registerUrl }),
    tags:           [{ name: "type", value: "project-invite" }],
  }, { idempotencyKey: `project-invite/${projectId}/${invitedEmail}` });

  if (error) {
    console.error("[send-project-invite]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
