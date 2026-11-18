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
}: FichaInviteProps): string {
  return emailLayout({
    title: `Tu ficha para ${projectName}`,
    preheader: `${senderName} te ha invitado al equipo de ${projectName}`,
    eyebrow: projectName,
    heading: "Completa tu ficha de alta",
    body:
      p(`Hola ${strong(esc(firstName))}, ${strong(esc(senderName))} te ha invitado a formar parte del equipo de ${strong(esc(projectName))}${role ? ` como ${strong(esc(role))}` : ""}.`) +
      p("Abre el formulario, introduce este PIN cuando te lo pida, rellena tus datos y envíalo.") +
      codeBox(pin, "Tu PIN de acceso al formulario") +
      button(formUrl, "Completar mi ficha") +
      linkFallback(formUrl),
    footer: `Enviado por ${esc(senderName)} a través de Filma Workspace. El enlace es personal: no lo reenvíes.`,
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
