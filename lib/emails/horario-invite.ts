import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface HorarioInviteProps {
  recipientName:    string;
  projectName:      string;  // full project name — shown in body and form
  projectLabel:     string;  // working title or name — used in subject only
  date:             string;  // "20/07/2026"
  jornada:          number;
  formUrl:          string;
  emailBody?:       string;  // custom message from coordinación
  contactName?:     string;  // coordinator contact name
  contactMail?:     string;  // coordinator contact email
}

const DEFAULT_BODY = "Por favor, completa tu parte del control horario de hoy. Solo te llevará un momento.";

export function horarioInviteHtml({
  recipientName, projectName, date, jornada, formUrl,
  emailBody, contactName, contactMail,
}: HorarioInviteProps): string {
  const body = emailBody?.trim() || DEFAULT_BODY;
  const contact = contactName || contactMail
    ? `Contacto: ${contactName ? esc(contactName) : ""}${contactName && contactMail ? " · " : ""}${contactMail ? `<a href="mailto:${esc(contactMail)}" style="color:#64748B;">${esc(contactMail)}</a>` : ""}<br/>`
    : "";
  return emailLayout({
    title: `Control horario ${date}`,
    preheader: `Rellena tu control horario del ${date}`,
    eyebrow: projectName,
    heading: `Control horario · ${date}`,
    body:
      p(`Hola ${strong(esc(recipientName))},`) +
      p(escMultiline(body)) +
      facts([["Fecha", date], ["Jornada", `#${jornada}`]]) +
      button(formUrl, "Rellenar control horario") +
      linkFallback(formUrl),
    footer: `${contact}Este enlace es personal: no lo reenvíes.`,
  });
}

export function horarioInviteText({
  recipientName, projectName, projectLabel, date, jornada, formUrl,
  emailBody, contactName, contactMail,
}: HorarioInviteProps): string {
  const body    = emailBody?.trim() || DEFAULT_BODY;
  const contact = contactName || contactMail
    ? `\n\nContacto: ${[contactName, contactMail].filter(Boolean).join(" · ")}`
    : "";
  return `${projectLabel} | Control horario ${date} #${jornada}\n\nHola ${recipientName},\n\n${body}\n\n${formUrl}${contact}\n\nFilma Workspace`;
}
