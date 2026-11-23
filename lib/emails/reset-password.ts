import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface ResetPasswordProps {
  name: string;
  resetUrl: string;
}

export function resetPasswordHtml({ name, resetUrl }: ResetPasswordProps, custom?: EmailTexts): string {
  const firstName = name ? name.split(" ")[0] : "";
  const v = { nombre: firstName };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("reset-password", f, custom);
  return emailLayout({
    title: "Restablecer contraseña",
    preheader: "Crea una nueva contraseña para tu cuenta",
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      button(resetUrl, fillText(T("button"), v)) +
      p("El enlace caduca en 1 hora. Si no lo usas, tendrás que pedir otro.", { muted: true, small: true }) +
      linkFallback(resetUrl),
    footer: fillInline(T("footer"), v),
  });
}

export function resetPasswordText({ name, resetUrl }: ResetPasswordProps): string {
  const firstName = name ? name.split(" ")[0] : "";
  return `
Hola${firstName ? ` ${firstName}` : ""},

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Filma Workspace.

Crea tu nueva contraseña aquí (caduca en 1 hora):
${resetUrl}

Si no solicitaste este cambio, ignora este correo.

— Filma Workspace
`.trim();
}
