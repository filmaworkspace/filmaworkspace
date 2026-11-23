import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface FichaInviteProps {
  firstName: string;
  projectName: string;
  role: string;
  formUrl: string;
  pin: string;
  senderName: string;
}

export function fichaInviteHtml({
  firstName,
  projectName,
  role,
  formUrl,
  pin,
  senderName,
}: FichaInviteProps, custom?: EmailTexts): string {
  const v = { nombre: firstName, invitador: senderName, proyecto: projectName, rol: role };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("ficha-invite", f, custom);
  return emailLayout({
    title: `Tu ficha para ${projectName}`,
    preheader: `${senderName} te ha invitado al equipo de ${projectName}`,
    eyebrow: projectName,
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      codeBox(pin, "Tu PIN de acceso al formulario") +
      button(formUrl, fillText(T("button"), v)) +
      linkFallback(formUrl),
    footer: fillInline(T("footer"), v),
  });
}

export function fichaInviteText({
  firstName,
  projectName,
  role,
  formUrl,
  pin,
  senderName,
}: FichaInviteProps): string {
  return `
Hola ${firstName},

${senderName} te ha invitado a formar parte del equipo de "${projectName}" como ${role}.

Tu código PIN para acceder al formulario: ${pin}

Completa tu ficha aquí:
${formUrl}

Guarda el PIN — lo necesitarás al abrir el formulario.

— Filma Workspace
`.trim();
}
