import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { fichaInviteHtml, fichaInviteText } from "@/lib/emails/ficha-invite";
import { requireUser } from "@/lib/require-auth";
import { db } from "@/lib/firebase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const { to, name, formUrl, formId, projectName, workingTitle } = await req.json();

  const projectLabel = workingTitle || projectName;

  if (!to || !formUrl || !formId || !projectName) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const formSnap = await db.collection("forms").doc(formId).get();
  if (!formSnap.exists) {
    return NextResponse.json({ error: "Formulario no encontrado" }, { status: 404 });
  }
  const formData = formSnap.data()!;
  const pin = formData.pin as string;
  const role = formData.prefilled?.role || "";
  const senderName = formData.createdByName || "Filma Workspace";
  const firstName = name || formData.prefilled?.firstName || to;

  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Filma Workspace <noreply@filmaworkspace.com>",
    to: [to],
    subject: `${projectLabel} | Recordatorio: completa tu ficha`,
    html: fichaInviteHtml({ firstName, projectName, role, formUrl, pin, senderName }),
    text: fichaInviteText({ firstName, projectName, role, formUrl, pin, senderName }),
    tags: [{ name: "type", value: "form-reminder" }],
  });

  if (error) {
    console.error("[send-form-reminder]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data?.id });
}
