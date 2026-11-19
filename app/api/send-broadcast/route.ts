import { NextRequest, NextResponse } from "next/server";
import { broadcastHtml, broadcastText } from "@/lib/emails/broadcast";
import { sendEmailBatch } from "@/lib/emails/send";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const { to, content, subject: customSubject } = await req.json();

  if (!to || !Array.isArray(to) || to.length === 0 || !content) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const emails = Array.from(new Set((to as string[]).filter((e) => typeof e === "string" && e.includes("@"))));
  if (emails.length === 0) {
    return NextResponse.json({ error: "No hay emails válidos" }, { status: 400 });
  }

  const subject = typeof customSubject === "string" && customSubject.trim() ? customSubject.trim().slice(0, 150) : "Mensaje de Filma Workspace";
  const html = broadcastHtml({ content });
  const text = broadcastText({ content });

  try {
    // Cada destinatario va en su propio envío: nadie ve a los demás.
    const sent = await sendEmailBatch(
      emails.map((email) => ({ to: [email], subject, html, text, tags: [{ name: "type", value: "broadcast" }] })),
      { sentBy: admin.uid },
    );
    return NextResponse.json({ sent });
  } catch (error: any) {
    console.error("[send-broadcast]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
