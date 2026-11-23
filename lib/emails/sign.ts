// Emails de Filma Sign: solicitud de firma (con el enlace personal) y copia
// firmada por todas las partes.
import { button, emailLayout, esc, escMultiline, facts, linkFallback, p, strong } from "./layout";

const day = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "—");

interface RequestEmail { title: string; signerName: string; issuerName: string; message: string; url: string; expiresAt: number; reminder?: boolean }

export function signRequestHtml(d: RequestEmail) {
  return emailLayout({
    title: d.title,
    preheader: `${d.issuerName} te ha enviado ${d.title} para firmar`,
    eyebrow: d.reminder ? "Filma Sign · Recordatorio" : "Filma Sign",
    heading: d.title,
    body:
      p(`Hola ${strong(esc(d.signerName))}, ${esc(d.issuerName)} te ha enviado este documento para que lo revises y lo firmes. Ya está firmado por su parte.`) +
      (d.message ? p(escMultiline(d.message)) : "") +
      button(d.url, "Revisar y firmar") +
      p(`El enlace es personal y vale hasta el ${esc(day(d.expiresAt))}. Al firmar recibirás una copia en PDF firmada por las dos partes.`, { muted: true, small: true }) +
      linkFallback(d.url),
    footer: "Filma Sign · Filma Workspace",
  });
}

export function signRequestText(d: RequestEmail) {
  return [`${d.issuerName} te ha enviado ${d.title} para firmar.`, d.message, "", `Revisar y firmar: ${d.url}`, `Válido hasta el ${day(d.expiresAt)}.`].filter((x) => x !== undefined).join("\n");
}

interface CompletedEmail { title: string; parties: { name: string; at: number | null }[]; docHash: string; attached: boolean }

export function signCompletedHtml(d: CompletedEmail) {
  return emailLayout({
    title: `Firmado: ${d.title}`,
    preheader: `${d.title} está firmado por todas las partes`,
    eyebrow: "Filma Sign · Firmado",
    heading: d.title,
    body:
      p(`El documento está firmado por todas las partes.${d.attached ? " Tienes adjunta la copia en PDF con las firmas y el certificado de auditoría." : ""}`) +
      facts([...d.parties.map((x) => [x.name, when(x.at)] as [string, string]), ["Huella SHA-256", `${d.docHash.slice(0, 16)}…`]]) +
      p("Guarda este correo: es tu copia del documento firmado.", { muted: true, small: true }),
    footer: "Filma Sign · Filma Workspace",
  });
}

export function signCompletedText(d: CompletedEmail) {
  return [`${d.title}: firmado por todas las partes.`, ...d.parties.map((x) => `${x.name}: ${when(x.at)}`), `SHA-256: ${d.docHash}`].join("\n");
}
