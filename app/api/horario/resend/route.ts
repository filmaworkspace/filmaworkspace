import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { horarioInviteHtml, horarioInviteText } from "@/lib/emails/horario-invite";

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, date, recipientUids } = await req.json();
    if (!projectId || !date) return NextResponse.json({ error: "projectId y date requeridos" }, { status: 400 });

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";

    const projectSnap = await db.collection("projects").doc(projectId).get();
    const projectName = projectSnap.data()?.name ?? "Proyecto";
    const prodSnap = await db.collection("projects").doc(projectId).collection("config").doc("production").get();
    const workingTitle = prodSnap.data()?.workingTitle ?? "";
    const projectLabel = workingTitle || projectName;

    const dayRef = db.collection("projects").doc(projectId).collection("horario").doc(date);
    const daySnap = await dayRef.get();
    if (!daySnap.exists) return NextResponse.json({ error: "Día no encontrado" }, { status: 404 });

    const dayData = daySnap.data()!;
    const jornada: number = dayData.jornada ?? 1;
    const formattedDate = formatDate(date);

    let recipients: { uid: string; name: string; email: string; role: string }[] = dayData.recipients ?? [];
    if (recipientUids && recipientUids.length > 0) {
      recipients = recipients.filter((r) => recipientUids.includes(r.uid));
    }

    const formsRef = db.collection("projects").doc(projectId).collection("horarioForms");
    const results: { email: string; formId: string; ok: boolean }[] = [];

    for (const recipient of recipients) {
      if (!recipient.email) continue;

      // Check if they already have an unsubmitted form today
      const existing = await formsRef
        .where("date", "==", date)
        .where("recipientUid", "==", recipient.uid)
        .where("submittedAt", "==", null)
        .limit(1)
        .get();

      let formId: string;
      if (!existing.empty) {
        formId = existing.docs[0].id;
        await existing.docs[0].ref.update({ sentAt: FieldValue.serverTimestamp() });
      } else {
        const formRef = formsRef.doc();
        formId = formRef.id;
        const payload = {
          projectId, projectName, projectLabel, date, jornada,
          recipientUid: recipient.uid, recipientName: recipient.name,
          recipientEmail: recipient.email, recipientRole: recipient.role,
          sentAt: FieldValue.serverTimestamp(), submittedAt: null,
          entrada: null, salida: null, comida: null, observaciones: "",
        };
        await formRef.set(payload);
        await db.collection("horarioForms").doc(formId).set(payload);
      }

      const formUrl = `${base}/timesheet/${formId}`;
      const subject = `${projectLabel} | Control horario ${formattedDate} #${jornada} (recordatorio)`;

      const { error } = await resend.emails.send({
        from: process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
        to: [recipient.email],
        subject,
        html: horarioInviteHtml({ recipientName: recipient.name, projectName, projectLabel, date: formattedDate, jornada, formUrl }),
        text: horarioInviteText({ recipientName: recipient.name, projectName, projectLabel, date: formattedDate, jornada, formUrl }),
        tags: [{ name: "type", value: "horario-resend" }],
      });

      results.push({ email: recipient.email, formId, ok: !error });
    }

    return NextResponse.json({ sent: results.filter((r) => r.ok).length, total: results.length });
  } catch (err: any) {
    console.error("[horario/resend]", err?.message);
    return NextResponse.json({ error: err?.message || "Error interno" }, { status: 500 });
  }
}
