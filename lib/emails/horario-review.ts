import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface HorarioReviewProps {
  recipientName: string;
  projectName:   string;
  reviewUrl:     string;
}

export function horarioReviewHtml({ recipientName, projectName, reviewUrl }: HorarioReviewProps): string {
  return emailLayout({
    title: "Resumen de control horario",
    preheader: "Revisa tus jornadas de control horario",
    eyebrow: projectName,
    heading: "Resumen de control horario",
    body:
      p(`Hola ${strong(esc(recipientName))},`) +
      p("Desde este enlace puedes revisar todos tus días de control horario del proyecto: los que has rellenado y los que te quedan pendientes.") +
      button(reviewUrl, "Ver mis jornadas") +
      linkFallback(reviewUrl),
    footer: "Este enlace es personal: no lo reenvíes.",
  });
}

export function horarioReviewText({ recipientName, projectName, reviewUrl }: HorarioReviewProps): string {
  return `${projectName} | Resumen de control horario\n\nHola ${recipientName},\n\nRevisa tus jornadas de control horario aquí:\n${reviewUrl}\n\nFilma Workspace`;
}
