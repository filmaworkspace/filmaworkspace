import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface VerifyCodeProps {
  name: string;
  code: string;
}

export function verifyCodeHtml({ name, code }: VerifyCodeProps, custom?: EmailTexts): string {
  const firstName = (name || "").split(" ")[0];
  const v = { nombre: firstName, codigo: code };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("verify-code", f, custom);
  return emailLayout({
    title: "Código de verificación",
    preheader: `Tu código de verificación es ${code}`,
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      codeBox(code, "Caduca en 10 minutos"),
    footer: fillInline(T("footer"), v),
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
