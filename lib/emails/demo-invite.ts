// Invitación a la demo guiada (enlace que envía el admin).
import { button, emailLayout, esc, linkFallback, p, strong } from "./layout";

export function demoInviteHtml({ name, adminName, url, expiresAt }: { name: string; adminName: string; url: string; expiresAt: Date }) {
  const first = (name || "").split(" ")[0];
  const until = expiresAt.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  return emailLayout({
    title: "Demo de Filma Workspace",
    preheader: `${adminName} te ha preparado una demo de Filma Workspace`,
    eyebrow: "Demo",
    heading: first ? `Hola, ${first}` : "Hola",
    body:
      p(`${esc(adminName)} te ha preparado una demo de ${strong("Filma Workspace")}: un proyecto de ejemplo con presupuesto, órdenes de compra, facturas y equipo, con datos ficticios, para que lo pruebes con calma.`) +
      p("No necesitas crear una cuenta ni contraseña: entra con el botón.") +
      button(url, "Entrar en la demo") +
      p(`El enlace es personal y funciona hasta el ${esc(until)}.`, { muted: true, small: true }) +
      linkFallback(url),
  });
}
