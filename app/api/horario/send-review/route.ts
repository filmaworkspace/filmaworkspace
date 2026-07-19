import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/lib/firebase-admin";
import { horarioReviewHtml, horarioReviewText } from "@/lib/emails/horario-review";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { projectId, recipientUid, recipientName, recipientEmail } = await req.json();
    if (!projectId || !recipientUid || !recipientEmail) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";

    // Load project name
    const projectSnap = await db.collection("projects").doc(projectId).get();
    const projectName = projectSnap.data()?.name ?? "Proyecto";

    // Deterministic code — same formula as the client so the link is always the same
    const raw  = Buffer.from(`${projectId}:${recipientUid}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);

    // Upsert the access doc
    await db.collection("horarioAccess").doc(raw).set({
      projectId,
      projectName,
      recipientUid,
      recipientName,
      active:    true,
      createdAt: new Date().toISOString(),
    }, { merge: true });

    const reviewUrl = `${base}/timesheet-review/${raw}`;
    const subject   = `${projectName} | Resumen de control horario`;

    const { error } = await resend.emails.send({
      from:    process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>",
      to:      [recipientEmail],
      subject,
      html:    horarioReviewHtml({ recipientName, projectName, reviewUrl }),
      text:    horarioReviewText({ recipientName, projectName, reviewUrl }),
      tags:    [{ name: "type", value: "horario-review" }],
    });

    if (error) {
      console.error("[send-review] Resend error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, reviewUrl });
  } catch (err: any) {
    console.error("[horario/send-review]", err?.message);
    return NextResponse.json({ error: err?.message || "Error interno" }, { status: 500 });
  }
}
