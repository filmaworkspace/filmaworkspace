// Emails de Filma Sign: solicitud de firma (con el enlace personal) y copia
// firmada por todas las partes.
import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
import { button, emailLayout, esc, escMultiline, facts, linkFallback, p, strong } from "./layout";

const day = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "—");

interface RequestEmail { title: string; signerName: string; issuerName: string; message: string; url: string; expiresAt: number; reminder?: boolean }

export function signRequestHtml(d: RequestEmail, custom?: EmailTexts) {
  const v = { firmante: d.signerName, emisor: d.issuerName, documento: d.title };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("sign-request", f, custom);
  return emailLayout({
    title: d.title,
    preheader: `${d.issuerName} te ha enviado ${d.title} para firmar`,
    eyebrow: d.reminder ? "Filma Sign · Recordatorio" : "Filma Sign",
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      (d.message ? p(escMultiline(d.message)) : "") +
      button(d.url, fillText(T("button"), v)) +
      p(`El enlace es personal y vale hasta el ${esc(day(d.expiresAt))}. Al firmar recibirás una copia en PDF firmada por las dos partes.`, { muted: true, small: true }) +
      linkFallback(d.url),
    footer: fillInline(T("footer"), v),
  });
}

export function signRequestText(d: RequestEmail) {
  return [`${d.issuerName} te ha enviado ${d.title} para firmar.`, d.message, "", `Revisar y firmar: ${d.url}`, `Válido hasta el ${day(d.expiresAt)}.`].filter((x) => x !== undefined).join("\n");
}

interface CompletedEmail { title: string; parties: { name: string; at: number | null }[]; docHash: string; attached: boolean }

export function signCompletedHtml(d: CompletedEmail, custom?: EmailTexts) {
  const v = { documento: d.title };
  const T = (f: Parameters<typeof textOf>[1]) => textOf("sign-completed", f, custom);
  return emailLayout({
    title: `Firmado: ${d.title}`,
    preheader: `${d.title} está firmado por todas las partes`,
    eyebrow: "Filma Sign · Firmado",
    heading: fillText(T("heading"), v),
    body:
      fillRich(T("intro"), v, (h) => p(h)) +
      (d.attached ? p("Tienes adjunta la copia en PDF con las firmas y el certificado de auditoría.") : "") +
      facts([...d.parties.map((x) => [x.name, when(x.at)] as [string, string]), ["Huella SHA-256", `${d.docHash.slice(0, 16)}…`]]) +
      p("Guarda este correo: es tu copia del documento firmado.", { muted: true, small: true }),
    footer: fillInline(T("footer"), v),
  });
}

export function signCompletedText(d: CompletedEmail) {
  return [`${d.title}: firmado por todas las partes.`, ...d.parties.map((x) => `${x.name}: ${when(x.at)}`), `SHA-256: ${d.docHash}`].join("\n");
}
