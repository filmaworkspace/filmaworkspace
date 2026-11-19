import { button, emailLayout, esc, facts, p } from "./layout";

export interface DigestData {
  date: string;
  rows: [string, string][];
  attention: string[];
  url: string;
}

export function adminDigestHtml(d: DigestData): string {
  return emailLayout({
    title: "Resumen diario de Filma Workspace",
    preheader: d.attention.length ? `${d.attention.length} cosas requieren atención` : "Todo en orden",
    eyebrow: "Resumen diario",
    heading: d.date,
    body:
      (d.attention.length
        ? p("<strong>Requiere atención</strong><br/>" + d.attention.map((a) => `· ${esc(a)}`).join("<br/>"))
        : p("Todo en orden: no hay nada pendiente.", { muted: true })) +
      facts(d.rows) +
      button(d.url, "Abrir el panel de administración"),
    footer: "Lo recibes porque eres administrador. Se desactiva en Administración → Sistema.",
  });
}

export function adminDigestText(d: DigestData): string {
  return [
    `Resumen diario · ${d.date}`, "",
    ...(d.attention.length ? ["Requiere atención:", ...d.attention.map((a) => `- ${a}`), ""] : ["Todo en orden.", ""]),
    ...d.rows.map(([k, v]) => `${k}: ${v}`), "", d.url,
  ].join("\n");
}
