import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { broadcastHtml, broadcastText } from "@/lib/emails/broadcast";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { to, title, content, type = "info" } = await req.json();

  if (!to || !Array.isArray(to) || to.length === 0 || !title || !content) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const emails = to.filter((e: string) => typeof e === "string" && e.includes("@"));
  if (emails.length === 0) {
    return NextResponse.json({ error: "No hay emails válidos" }, { status: 400 });
  }

  try {
    // Send in batches of 50
    const BATCH_SIZE = 50;
    let sent = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      await resend.emails.send({
        from: process.env.RESEND_FROM ?? "Filma Workspace <noreply@filmaworkspace.com>",
        to: batch,
        subject: title,
        html: broadcastHtml({ title, content, type }),
        text: broadcastText({ title, content, type }),
        tags: [{ name: "type", value: "broadcast" }],
      });
      sent += batch.length;
    }

    return NextResponse.json({ sent });
  } catch (error: any) {
    console.error("[send-broadcast]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
