import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { sendEmail } from "@/lib/emails/send";
import { emailTexts } from "@/lib/emails/textsServer";
import { fillText, textOf } from "@/lib/emails/texts";

import { billingDocumentHtml, billingDocumentText } from "@/lib/emails/billing-document";
import { auditFromServer } from "@/lib/server/audit";

// Envía por email una factura o un presupuesto ya emitidos, con su PDF
// (generado en el navegador con el mismo diseño de la vista previa).

const eur = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);
const day = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "—");

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { type, id, to, pdfBase64, message } = await req.json().catch(() => ({}));
  if (!["invoice", "quote"].includes(type) || typeof id !== "string") return NextResponse.json({ error: "Documento no válido" }, { status: 400 });
  const emails = String(to || "").split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (!emails.length) return NextResponse.json({ error: "Escribe al menos un email válido" }, { status: 400 });
  if (typeof pdfBase64 !== "string" || pdfBase64.length < 100 || pdfBase64.length > 8_000_000) return NextResponse.json({ error: "PDF no válido" }, { status: 400 });

  const ref = db.collection(type === "invoice" ? "billingInvoices" : "billingQuotes").doc(id);
  const d = (await ref.get()).data();
  if (!d) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (d.status === "draft" || !d.number) return NextResponse.json({ error: "Emítelo antes de enviarlo" }, { status: 400 });

  const kind = type === "quote" ? "quote" : d.kind === "rectifying" ? "rectifying" : "invoice";
  const rows: [string, string][] = type === "quote"
    ? [["Proyecto", d.projectName || "—"], ["Importe", `${eur(d.baseAmount)} + IVA${d.billingMode === "monthly" ? " al mes" : ""}`], ["Válido hasta", day(d.validUntil)]]
    : [["Fecha", day(d.issueDate)], ...(d.projectName ? [["Proyecto", d.projectName] as [string, string]] : []), ["Total", eur(d.totalAmount)], ...(kind === "invoice" ? [["Vencimiento", day(d.dueDate)] as [string, string]] : [])];
  const data = { kind, number: d.number, clientName: d.client?.name || "", issuerName: d.issuer?.name || "Filma Workspace", rows, message: typeof message === "string" ? message.slice(0, 2000) : "" } as const;

  const tid = kind === "quote" ? "billing-quote" : "billing-invoice";
  const tx = kind === "rectifying" ? {} : await emailTexts(tid);
  const { error } = await sendEmail({
    to: emails,
    subject: kind === "rectifying" ? `Factura rectificativa ${d.number} · ${data.issuerName}` : fillText(textOf(tid, "subject", tx), { cliente: data.clientName, numero: d.number, emisor: data.issuerName }),
    html: billingDocumentHtml(data, tx),
    text: billingDocumentText(data),
    tags: [{ name: "type", value: type === "quote" ? "billing-quote" : "billing-invoice" }],
    attachments: [{ filename: `${d.number}.pdf`, content: pdfBase64, contentType: "application/pdf" }],
  }, undefined, { [type === "quote" ? "quoteId" : "invoiceId"]: id, producerId: d.producerId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await ref.update({ sentAt: FieldValue.serverTimestamp(), sentTo: emails.join(", "), updatedAt: FieldValue.serverTimestamp() });
  await auditFromServer(admin.uid, type === "quote" ? "quote_sent" : "invoice_sent", `${d.number} → ${emails.join(", ")}`);
  return NextResponse.json({ ok: true });
}
