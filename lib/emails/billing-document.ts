import { emailLayout, escMultiline, facts, p, strong, esc } from "./layout";

export interface BillingDocumentEmail {
  kind: "invoice" | "quote" | "rectifying";
  number: string;
  clientName: string;
  issuerName: string;
  rows: [string, string][];
  message?: string;
}

const NOUN = { invoice: "la factura", quote: "el presupuesto", rectifying: "la factura rectificativa" };
const TITLE = { invoice: "Factura", quote: "Presupuesto", rectifying: "Factura rectificativa" };

export function billingDocumentHtml(d: BillingDocumentEmail): string {
  return emailLayout({
    title: `${TITLE[d.kind]} ${d.number}`,
    preheader: `${TITLE[d.kind]} ${d.number} de ${d.issuerName}`,
    eyebrow: TITLE[d.kind],
    heading: d.number,
    body:
      p(`Hola${d.clientName ? ` ${strong(esc(d.clientName))}` : ""}, te enviamos ${NOUN[d.kind]} ${strong(esc(d.number))}. ${d.kind === "quote" ? "Lo tienes adjunto" : "La tienes adjunta"} en PDF.`) +
      (d.message ? p(escMultiline(d.message)) : "") +
      facts(d.rows) +
      p("Si tienes cualquier duda, responde a este email.", { muted: true, small: true }),
    footer: `${esc(d.issuerName)} · Filma Workspace`,
  });
}

export function billingDocumentText(d: BillingDocumentEmail): string {
  return [`${TITLE[d.kind]} ${d.number}`, "", d.message || "", ...d.rows.map(([k, v]) => `${k}: ${v}`), "", "Adjunto en PDF."].join("\n");
}
