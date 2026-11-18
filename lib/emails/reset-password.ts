import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface ResetPasswordProps {
  name: string;
  resetUrl: string;
}

export function resetPasswordHtml({ name, resetUrl }: ResetPasswordProps): string {
  const firstName = name ? name.split(" ")[0] : "";
  return emailLayout({
    title: "Restablecer contraseña",
    preheader: "Crea una nueva contraseña para tu cuenta",
    heading: "Restablecer contraseña",
    body:
      p(`Hola${firstName ? ` ${strong(esc(firstName))}` : ""}, hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Filma Workspace.`) +
      button(resetUrl, "Crear nueva contraseña") +
      p("El enlace caduca en 1 hora. Si no lo usas, tendrás que pedir otro.", { muted: true, small: true }) +
      linkFallback(resetUrl),
    footer: "Si no has pedido este cambio, ignora este correo: tu contraseña no se modifica.",
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
