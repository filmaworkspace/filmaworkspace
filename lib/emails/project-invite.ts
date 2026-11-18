import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface ProjectInviteProps {
  inviteeName: string;
  invitedByName: string;
  projectName: string;
  role: string;
  isExistingUser: boolean;
  loginUrl?: string;
  registerUrl?: string;
}

export function projectInviteHtml({
  inviteeName,
  invitedByName,
  projectName,
  role,
  isExistingUser,
  loginUrl    = "https://filmaworkspace.com/login",
  registerUrl = "https://filmaworkspace.com/register",
}: ProjectInviteProps): string {
  const firstName = (inviteeName || "").split(" ")[0];
  const ctaUrl = isExistingUser ? loginUrl : registerUrl;
  return emailLayout({
    title: `Invitación a ${projectName}`,
    preheader: `${invitedByName} te ha invitado a ${projectName}`,
    eyebrow: "Invitación",
    heading: projectName,
    body:
      p(`Hola${firstName ? ` ${strong(esc(firstName))}` : ""}, ${strong(esc(invitedByName))} te ha invitado a unirte al proyecto${role ? ` como ${strong(esc(role))}` : ""}.`) +
      p(isExistingUser
        ? "Ya tienes cuenta en Filma Workspace: entra para aceptar la invitación."
        : "Para unirte, crea tu cuenta en Filma Workspace. Es gratis y solo te llevará un momento.") +
      button(ctaUrl, isExistingUser ? "Ver mi invitación" : "Crear mi cuenta") +
      linkFallback(ctaUrl),
    footer: `Enviado por ${esc(invitedByName)} a través de Filma Workspace. Si no esperabas esta invitación, ignora este correo.`,
  });
}

export function projectInviteText({
  inviteeName,
  invitedByName,
  projectName,
  role,
  isExistingUser,
  loginUrl    = "https://filmaworkspace.com/login",
  registerUrl = "https://filmaworkspace.com/register",
}: ProjectInviteProps): string {
  const firstName = inviteeName.split(" ")[0];
  const ctaUrl = isExistingUser ? loginUrl : registerUrl;
  return `
Hola ${firstName},

${invitedByName} te ha invitado a unirte al proyecto "${projectName}"${role ? ` como ${role}` : ""}.

${isExistingUser
  ? `Ya tienes cuenta en Filma Workspace. Entra para ver tu invitación:\n${ctaUrl}`
  : `Para unirte crea tu cuenta gratuita en Filma Workspace:\n${ctaUrl}`}

Si no esperabas esta invitación puedes ignorar este correo.

— Filma Workspace
`.trim();
}
