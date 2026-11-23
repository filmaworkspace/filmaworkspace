import { fillInline, fillRich, fillText, textOf, type EmailTexts } from "./texts";
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

export function billingDocumentHtml(d: BillingDocumentEmail, custom?: EmailTexts): string {
  const id = d.kind === "quote" ? "billing-quote" : "billing-invoice";
  const v = { cliente: d.clientName, numero: d.number, emisor: d.issuerName };
  // Las rectificativas usan siempre el texto de por defecto.
  const T = (f: Parameters<typeof textOf>[1]) => textOf(id, f, d.kind === "rectifying" ? null : custom);
  return emailLayout({
    title: `${TITLE[d.kind]} ${d.number}`,
    preheader: `${TITLE[d.kind]} ${d.number} de ${d.issuerName}`,
    eyebrow: TITLE[d.kind],
    heading: fillText(T("heading"), v),
    body:
      (d.kind === "rectifying"
        ? p(`Hola${d.clientName ? ` ${strong(esc(d.clientName))}` : ""}, te enviamos ${NOUN[d.kind]} ${strong(esc(d.number))}. La tienes adjunta en PDF.`)
        : fillRich(T("intro"), v, (h) => p(h))) +
      (d.message ? p(escMultiline(d.message)) : "") +
      facts(d.rows) +
      p("Si tienes cualquier duda, responde a este email.", { muted: true, small: true }),
    footer: fillInline(T("footer"), v),
  });
}

export function billingDocumentText(d: BillingDocumentEmail): string {
  return [`${TITLE[d.kind]} ${d.number}`, "", d.message || "", ...d.rows.map(([k, v]) => `${k}: ${v}`), "", "Adjunto en PDF."].join("\n");
}
