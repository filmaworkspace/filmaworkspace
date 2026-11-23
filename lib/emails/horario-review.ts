import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface HorarioReviewProps {
  recipientName: string;
  projectName:   string;
  reviewUrl:     string;
}

export function horarioReviewHtml({ recipientName, projectName, reviewUrl }: HorarioReviewProps, custom?: EmailTexts): string {
  const v = { nombre: recipientName, proyecto: projectName };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("horario-review", f, custom);
  return emailLayout({
    title: "Resumen de control horario",
    preheader: "Revisa tus jornadas de control horario",
    eyebrow: projectName,
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      button(reviewUrl, fillText(T("button"), v)) +
      linkFallback(reviewUrl),
    footer: fillInline(T("footer"), v),
  });
}

export function horarioReviewText({ recipientName, projectName, reviewUrl }: HorarioReviewProps): string {
  return `${projectName} | Resumen de control horario\n\nHola ${recipientName},\n\nRevisa tus jornadas de control horario aquí:\n${reviewUrl}\n\nFilma Workspace`;
}
