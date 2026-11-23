// Vista previa de cada plantilla de email con datos de ejemplo (centro de emails).
import { horarioInviteHtml } from "@/lib/emails/horario-invite";
import { horarioReviewHtml } from "@/lib/emails/horario-review";
import { projectInviteHtml } from "@/lib/emails/project-invite";
import { fichaInviteHtml } from "@/lib/emails/ficha-invite";
import { resetPasswordHtml } from "@/lib/emails/reset-password";
import { verifyCodeHtml } from "@/lib/emails/verify-code";
import { broadcastHtml } from "@/lib/emails/broadcast";
import { adminDigestHtml } from "@/lib/emails/admin-digest";
import { billingDocumentHtml } from "@/lib/emails/billing-document";
import { signCompletedHtml, signRequestHtml } from "@/lib/emails/sign";
import type { EmailTexts, TextTemplateId } from "@/lib/emails/texts";

const URL = "https://filmaworkspace.com/ejemplo";

export interface EmailSample {
  id: string;
  label: string;
  /** Plantilla con textos editables (y variables de ejemplo para el asunto). */
  texts?: TextTemplateId;
  vars?: Record<string, string | number>;
  html: (t?: EmailTexts) => string;
}

export const EMAIL_SAMPLES: EmailSample[] = [
  { id: "project-invite", texts: "project-invite", label: "Invitación a proyecto", vars: { nombre: "Lucía", invitador: "Ana García", proyecto: "La última luz", rol: "Jefa de producción" },
    html: (t) => projectInviteHtml({ inviteeName: "Lucía Martín", invitedByName: "Ana García", projectName: "La última luz", role: "Jefa de producción", isExistingUser: false, registerUrl: URL, loginUrl: URL }, t) },
  { id: "ficha-invite", texts: "ficha-invite", label: "Ficha de crew", vars: { nombre: "Lucía", invitador: "Ana García", proyecto: "La última luz", rol: "Auxiliar de producción" },
    html: (t) => fichaInviteHtml({ firstName: "Lucía", projectName: "La última luz", role: "Auxiliar de producción", formUrl: URL, pin: "4821", senderName: "Ana García" }, t) },
  { id: "horario", texts: "horario", label: "Control horario", vars: { nombre: "Lucía Martín", proyecto: "La última luz", fecha: "20/11/2026", jornada: 12 },
    html: (t) => horarioInviteHtml({ recipientName: "Lucía Martín", projectName: "La última luz", projectLabel: "La última luz", date: "20/11/2026", jornada: 12, formUrl: URL, contactName: "Ana García", contactMail: "coordinacion@ejemplo.com" }, t) },
  { id: "horario-review", texts: "horario-review", label: "Revisión de horarios", vars: { nombre: "Lucía Martín", proyecto: "La última luz" },
    html: (t) => horarioReviewHtml({ recipientName: "Lucía Martín", projectName: "La última luz", reviewUrl: URL }, t) },
  { id: "reset-password", texts: "reset-password", label: "Restablecer contraseña", vars: { nombre: "Lucía" },
    html: (t) => resetPasswordHtml({ name: "Lucía Martín", resetUrl: URL }, t) },
  { id: "verify-code", texts: "verify-code", label: "Código de verificación", vars: { nombre: "Lucía", codigo: "482913" },
    html: (t) => verifyCodeHtml({ name: "Lucía Martín", code: "482913" }, t) },
  { id: "billing-invoice", texts: "billing-invoice", label: "Factura de Filma", vars: { cliente: "Lumen Films Producciones S.L.", numero: "F2026-0001", emisor: "Filma Workspace S.L." },
    html: (t) => billingDocumentHtml({ kind: "invoice", number: "F2026-0001", clientName: "Lumen Films Producciones S.L.", issuerName: "Filma Workspace S.L.", rows: [["Fecha", "19/11/2026"], ["Proyecto", "Kilómetro cero"], ["Total", "617,10 €"], ["Vencimiento", "19/12/2026"]] }, t) },
  { id: "billing-quote", texts: "billing-quote", label: "Presupuesto de Filma", vars: { cliente: "Lumen Films Producciones S.L.", numero: "P2026-0001", emisor: "Filma Workspace S.L." },
    html: (t) => billingDocumentHtml({ kind: "quote", number: "P2026-0001", clientName: "Lumen Films Producciones S.L.", issuerName: "Filma Workspace S.L.", rows: [["Proyecto", "Kilómetro cero"], ["Importe", "510,00 € + IVA al mes"], ["Válido hasta", "19/12/2026"]], message: "Te mandamos la propuesta que hablamos ayer." }, t) },
  { id: "sign-request", texts: "sign-request", label: "Filma Sign · para firmar", vars: { firmante: "Lucía Martín", emisor: "Ana García", documento: "Contrato laboral · Ayudante de dirección" },
    html: (t) => signRequestHtml({ title: "Contrato laboral · Ayudante de dirección", signerName: "Lucía Martín", issuerName: "Ana García", message: "", url: URL, expiresAt: Date.now() + 30 * 86_400_000 }, t) },
  { id: "sign-completed", texts: "sign-completed", label: "Filma Sign · firmado", vars: { documento: "Contrato laboral · Ayudante de dirección" },
    html: (t) => signCompletedHtml({ title: "Contrato laboral · Ayudante de dirección", parties: [{ name: "Ana García", at: Date.now() - 3_600_000 }, { name: "Lucía Martín", at: Date.now() }], docHash: "f24523c6e7a2063701966993f2e1a69bea897d3948c76a69", attached: true }, t) },
  { id: "broadcast", label: "Comunicado", html: () => broadcastHtml({ content: "Hola:\n\nEste fin de semana mejoramos la velocidad de Contabilidad. No tienes que hacer nada.\n\nGracias." }) },
  { id: "admin-digest", label: "Resumen diario (admin)", html: () => adminDigestHtml({ date: "Miércoles, 18 de noviembre", rows: [["Usuarios nuevos", "3"], ["Proyectos nuevos", "1"], ["Tickets abiertos", "2"], ["Emails enviados", "41"], ["Errores sin revisar", "0"]], attention: ["1 ticket de soporte sin asignar"], url: URL }) },
];

/** En la vista previa la cabecera incrustada (cid:) se sustituye por la imagen pública. */
export const previewHtml = (html: string) => html.replace(/cid:filma-header/g, "/email/header.jpg").replace(/https?:\/\/[^"']+\/email\/header\.jpg/g, "/email/header.jpg");
