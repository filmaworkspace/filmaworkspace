import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface VerifyCodeProps {
  name: string;
  code: string;
}

export function verifyCodeHtml({ name, code }: VerifyCodeProps): string {
  const firstName = (name || "").split(" ")[0];
  return emailLayout({
    title: "Código de verificación",
    preheader: `Tu código de verificación es ${code}`,
    heading: "Tu código de verificación",
    body:
      p(`Hola${firstName ? ` ${strong(esc(firstName))}` : ""}, introduce este código en la pantalla de verificación para completar el registro.`) +
      codeBox(code, "Caduca en 10 minutos"),
    footer: "Si no has pedido este código, ignora este correo.",
  });
}

export function verifyCodeText({ name, code }: VerifyCodeProps): string {
  const firstName = name.split(" ")[0];
  return `
Hola ${firstName},

Tu código de verificación para Filma Workspace es:

${code}

Caduca en 10 minutos. Si no solicitaste este código puedes ignorar este correo.

— Filma Workspace
`.trim();
}
