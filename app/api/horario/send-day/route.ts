import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { adminAuth, db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { horarioInviteHtml, horarioInviteText } from "@/lib/emails/horario-invite";

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, date } = await req.json();
    if (!projectId || !date) return NextResponse.json({ error: "projectId y date requeridos" }, { status: 400 });

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";

    // Load project label
    const projectSnap = await db.collection("projects").doc(projectId).get();
    const projectName = projectSnap.data()?.name ?? "Proyecto";
    const prodSnap = await db.collection("projects").doc(projectId).collection("config").doc("production").get();
    const workingTitle = prodSnap.data()?.workingTitle ?? "";
    const projectLabel = workingTitle || projectName;

    // Load horario config (email customisation)
    const cfgSnap = await db.collection("projects").doc(projectId).collection("horario").doc("__config__").get();
    const cfg = cfgSnap.data() ?? {};
    const emailBody    = cfg.emailBody    as string | undefined;
    const contactName  = cfg.emailContactName as string | undefined;
    const contactMail  = cfg.emailContactMail as string | undefined;

    // Load day config — days stored as docs in projects/{id}/horario, docId = date
    const dayRef = db.collection("projects").doc(projectId).collection("horario").doc(date);
    const daySnap = await dayRef.get();
    if (!daySnap.exists) return NextResponse.json({ error: "Día no configurado" }, { status: 404 });

    const dayData = daySnap.data()!;
    const jornada: number = dayData.jornada ?? 1;
    const recipients: { uid: string; name: string; email: string; role: string }[] = dayData.recipients ?? [];

    if (recipients.length === 0) return NextResponse.json({ error: "No hay destinatarios para este día" }, { status: 400 });

    const formattedDate = formatDate(date);
    const results: { email: string; formId: string; ok: boolean }[] = [];

    for (const recipient of recipients) {
      if (!recipient.email) continue;

      // Create form doc in projects/{id}/horarioForms
      const formRef = db.collection("projects").doc(projectId).collection("horarioForms").doc();
      const formId = formRef.id;

      const formPayload = {
        projectId,
        projectName,
        projectLabel,
        date,
        jornada,
        recipientUid:   recipient.uid,
        recipientName:  recipient.name,
        recipientEmail: recipient.email,
        recipientRole:  recipient.role,
        sentAt:         FieldValue.serverTimestamp(),
        submittedAt:    null,
        entrada:        null,
        salida:         null,
        comida:         null,
        observaciones:  "",
      };
      await formRef.set(formPayload);
      // Mirror to top-level collection for easy public lookup by formId
      await db.collection("horarioForms").doc(formId).set(formPayload);

      const formUrl = `${base}/timesheet/${formId}`;
      const subject = `${projectLabel} | Control horario ${formattedDate} #${jornada}`;

      const { error } = await resend.emails.send({
        from:    process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
        to:      [recipient.email],
        subject,
        html:    horarioInviteHtml({ recipientName: recipient.name, projectName, projectLabel, date: formattedDate, jornada, formUrl, emailBody, contactName, contactMail }),
        text:    horarioInviteText({ recipientName: recipient.name, projectName, projectLabel, date: formattedDate, jornada, formUrl, emailBody, contactName, contactMail }),
        tags:    [{ name: "type", value: "horario" }],
      });

      results.push({ email: recipient.email, formId, ok: !error });
      if (error) console.error("[send-day] Resend error for", recipient.email, error);
    }

    // Mark day as sent
    await dayRef.update({ status: "sent", sentAt: FieldValue.serverTimestamp() });

    return NextResponse.json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err: any) {
    console.error("[horario/send-day]", err?.message);
    return NextResponse.json({ error: err?.message || "Error interno" }, { status: 500 });
  }
}
