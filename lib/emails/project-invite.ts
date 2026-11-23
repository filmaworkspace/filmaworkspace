import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
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
}: ProjectInviteProps, custom?: EmailTexts): string {
  const firstName = (inviteeName || "").split(" ")[0];
  const ctaUrl = isExistingUser ? loginUrl : registerUrl;
  const v = { nombre: firstName, invitador: invitedByName, proyecto: projectName, rol: role };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("project-invite", f, custom);
  return emailLayout({
    title: `Invitación a ${projectName}`,
    preheader: `${invitedByName} te ha invitado a ${projectName}`,
    eyebrow: "Invitación",
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      p(isExistingUser
        ? "Ya tienes cuenta en Filma Workspace: entra para aceptar la invitación."
        : "Para unirte, crea tu cuenta en Filma Workspace. Es gratis y solo te llevará un momento.") +
      button(ctaUrl, isExistingUser ? "Ver mi invitación" : "Crear mi cuenta") +
      linkFallback(ctaUrl),
    footer: fillInline(T("footer"), v),
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
