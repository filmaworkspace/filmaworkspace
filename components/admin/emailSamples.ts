// Vista previa de cada plantilla de email con datos de ejemplo (centro de emails).
import { horarioInviteHtml } from "@/lib/emails/horario-invite";
import { horarioReviewHtml } from "@/lib/emails/horario-review";
import { projectInviteHtml } from "@/lib/emails/project-invite";
import { fichaInviteHtml } from "@/lib/emails/ficha-invite";
import { resetPasswordHtml } from "@/lib/emails/reset-password";
import { verifyCodeHtml } from "@/lib/emails/verify-code";
import { broadcastHtml } from "@/lib/emails/broadcast";
import { adminDigestHtml } from "@/lib/emails/admin-digest";

const URL = "https://filmaworkspace.com/ejemplo";

export const EMAIL_SAMPLES: { id: string; label: string; html: () => string }[] = [
  { id: "project-invite", label: "Invitación a proyecto", html: () => projectInviteHtml({ inviteeName: "Lucía Martín", invitedByName: "Ana García", projectName: "La última luz", role: "Jefa de producción", isExistingUser: false, registerUrl: URL, loginUrl: URL }) },
  { id: "ficha-invite", label: "Ficha de crew", html: () => fichaInviteHtml({ firstName: "Lucía", projectName: "La última luz", role: "Auxiliar de producción", formUrl: URL, pin: "4821", senderName: "Ana García" }) },
  { id: "horario", label: "Control horario", html: () => horarioInviteHtml({ recipientName: "Lucía Martín", projectName: "La última luz", projectLabel: "La última luz", date: "20/11/2026", jornada: 12, formUrl: URL, emailBody: "Recuerda indicar la hora de comida.", contactName: "Ana García", contactMail: "coordinacion@ejemplo.com" }) },
  { id: "horario-review", label: "Revisión de horarios", html: () => horarioReviewHtml({ recipientName: "Lucía Martín", projectName: "La última luz", reviewUrl: URL }) },
  { id: "reset-password", label: "Restablecer contraseña", html: () => resetPasswordHtml({ name: "Lucía Martín", resetUrl: URL }) },
  { id: "verify-code", label: "Código de verificación", html: () => verifyCodeHtml({ name: "Lucía Martín", code: "482913" }) },
  { id: "broadcast", label: "Comunicado", html: () => broadcastHtml({ content: "Hola:\n\nEste fin de semana mejoramos la velocidad de Contabilidad. No tienes que hacer nada.\n\nGracias." }) },
  { id: "admin-digest", label: "Resumen diario (admin)", html: () => adminDigestHtml({ date: "Miércoles, 18 de noviembre", rows: [["Usuarios nuevos", "3"], ["Proyectos nuevos", "1"], ["Tickets abiertos", "2"], ["Emails enviados", "41"], ["Errores sin revisar", "0"]], attention: ["1 ticket de soporte sin asignar"], url: URL }) },
];

/** En la vista previa la cabecera incrustada (cid:) se sustituye por la imagen pública. */
export const previewHtml = (html: string) => html.replace(/cid:filma-header/g, "/email/header.jpg").replace(/https?:\/\/[^"']+\/email\/header\.jpg/g, "/email/header.jpg");
