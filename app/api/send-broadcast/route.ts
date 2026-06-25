import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { broadcastHtml, broadcastText } from "@/lib/emails/broadcast";
import { verifyRequestAuth } from "@/lib/serverAuth";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const auth = await verifyRequestAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { to, title, content, type = "info" } = await req.json();

  if (!to || !Array.isArray(to) || to.length === 0 || !title || !content) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const emails = (to as string[]).filter((e) => typeof e === "string" && e.includes("@"));
  if (emails.length === 0) {
    return NextResponse.json({ error: "No hay emails válidos" }, { status: 400 });
  }

  if (emails.length > 500) {
    return NextResponse.json({ error: "Demasiados destinatarios (máximo 500)" }, { status: 400 });
  }

  const html = broadcastHtml({ title, content, type });
  const text = broadcastText({ title, content, type });
  const from = process.env.RESEND_FROM ?? "Filma Workspace <noreply@filmaworkspace.com>";

  try {
    // resend.batch.send accepts up to 100 items per call.
    // Each item has its own `to` so recipients cannot see each other.
    const BATCH_SIZE = 100;
    let sent = 0;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE).map((email) => ({
        from,
        to: [email],
        subject: title,
        html,
        text,
        tags: [{ name: "type", value: "broadcast" }],
      }));

      await resend.batch.send(batch);
      sent += batch.length;
    }

    return NextResponse.json({ sent });
  } catch (error: any) {
    console.error("[send-broadcast]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
