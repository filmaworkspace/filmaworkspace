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

const URL = "https://filmaworkspace.com/ejemplo";

export const EMAIL_SAMPLES: { id: string; label: string; html: () => string }[] = [
  { id: "project-invite", label: "Invitación a proyecto", html: () => projectInviteHtml({ inviteeName: "Lucía Martín", invitedByName: "Ana García", projectName: "La última luz", role: "Jefa de producción", isExistingUser: false, registerUrl: URL, loginUrl: URL }) },
  { id: "ficha-invite", label: "Ficha de crew", html: () => fichaInviteHtml({ firstName: "Lucía", projectName: "La última luz", role: "Auxiliar de producción", formUrl: URL, pin: "4821", senderName: "Ana García" }) },
  { id: "horario", label: "Control horario", html: () => horarioInviteHtml({ recipientName: "Lucía Martín", projectName: "La última luz", projectLabel: "La última luz", date: "20/11/2026", jornada: 12, formUrl: URL, emailBody: "Recuerda indicar la hora de comida.", contactName: "Ana García", contactMail: "coordinacion@ejemplo.com" }) },
  { id: "horario-review", label: "Revisión de horarios", html: () => horarioReviewHtml({ recipientName: "Lucía Martín", projectName: "La última luz", reviewUrl: URL }) },
  { id: "reset-password", label: "Restablecer contraseña", html: () => resetPasswordHtml({ name: "Lucía Martín", resetUrl: URL }) },
  { id: "verify-code", label: "Código de verificación", html: () => verifyCodeHtml({ name: "Lucía Martín", code: "482913" }) },
  { id: "broadcast", label: "Comunicado", html: () => broadcastHtml({ content: "Hola:\n\nEste fin de semana mejoramos la velocidad de Contabilidad. No tienes que hacer nada.\n\nGracias." }) },
  { id: "billing-invoice", label: "Factura de Filma", html: () => billingDocumentHtml({ kind: "invoice", number: "F2026-0001", clientName: "Lumen Films Producciones S.L.", issuerName: "Filma Workspace S.L.", rows: [["Fecha", "19/11/2026"], ["Proyecto", "Kilómetro cero"], ["Total", "617,10 €"], ["Vencimiento", "19/12/2026"]] }) },
  { id: "billing-quote", label: "Presupuesto de Filma", html: () => billingDocumentHtml({ kind: "quote", number: "P2026-0001", clientName: "Lumen Films Producciones S.L.", issuerName: "Filma Workspace S.L.", rows: [["Proyecto", "Kilómetro cero"], ["Importe", "510,00 € + IVA al mes"], ["Válido hasta", "19/12/2026"]], message: "Te mandamos la propuesta que hablamos ayer." }) },
  { id: "admin-digest", label: "Resumen diario (admin)", html: () => adminDigestHtml({ date: "Miércoles, 18 de noviembre", rows: [["Usuarios nuevos", "3"], ["Proyectos nuevos", "1"], ["Tickets abiertos", "2"], ["Emails enviados", "41"], ["Errores sin revisar", "0"]], attention: ["1 ticket de soporte sin asignar"], url: URL }) },
];

/** En la vista previa la cabecera incrustada (cid:) se sustituye por la imagen pública. */
export const previewHtml = (html: string) => html.replace(/cid:filma-header/g, "/email/header.jpg").replace(/https?:\/\/[^"']+\/email\/header\.jpg/g, "/email/header.jpg");
