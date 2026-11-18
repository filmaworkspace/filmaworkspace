import { button, codeBox, emailLayout, esc, escMultiline, facts, linkFallback, p, safeUrl, strong } from "./layout";

interface BroadcastProps {
  content: string;
}

export function broadcastHtml({ content }: BroadcastProps): string {
  return emailLayout({
    title: "Mensaje de Filma Workspace",
    eyebrow: "Mensaje",
    heading: "Novedades de Filma Workspace",
    body: p(escMultiline(content)),
    footer: "Este mensaje lo envía el equipo de Filma Workspace.",
  });
}

export function broadcastText({ content }: BroadcastProps): string {
  return `${content}\n\n— Filma Workspace`.trim();
}
