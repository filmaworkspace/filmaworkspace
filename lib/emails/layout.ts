// ─── Plantilla común de los emails ───────────────────────────────────────────
// Cabecera con el degradado del login (imagen public/email/header.jpg: los
// clientes de correo no pintan bien los degradados CSS ni los SVG), tarjeta
// blanca y tipografía del sistema. Todo lo que viene de datos del usuario pasa
// por esc() para que nadie pueda meter HTML en un correo con nuestra marca.

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://filmaworkspace.com").replace(/\/$/, "");

const INK = "#0F172A";
const TEXT = "#334155";
const MUTED = "#64748B";
const FAINT = "#94A3B8";
const LINE = "#E4E4E7";
const BG = "#F4F4F5";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif";

/** Escapa texto para meterlo en HTML (también en atributos). */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto de varias líneas escapado, con saltos de línea. */
export const escMultiline = (v: unknown) => esc(v).replace(/\r?\n/g, "<br/>");

/** Solo enlaces http(s) o mailto; cualquier otra cosa se anula. */
export function safeUrl(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url || "") ? esc(url) : "#";
}

export const p = (html: string, opts: { muted?: boolean; small?: boolean } = {}) =>
  `<p style="margin:0 0 16px;font-size:${opts.small ? 13 : 15}px;line-height:1.6;color:${opts.muted ? MUTED : TEXT};">${html}</p>`;

export const strong = (html: string) => `<strong style="color:${INK};font-weight:600;">${html}</strong>`;

/** Botón principal: oscuro para que destaque en cualquier cliente de correo. */
export const button = (url: string, label: string) => `
  <table cellpadding="0" cellspacing="0" role="presentation" style="margin:8px 0 24px;">
    <tr><td style="border-radius:8px;background:${INK};">
      <a href="${safeUrl(url)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${esc(label)}</a>
    </td></tr>
  </table>`;

/** "Si el botón no funciona, copia este enlace". */
export const linkFallback = (url: string) =>
  `<p style="margin:0 0 4px;font-size:12px;color:${FAINT};">Si el botón no funciona, copia este enlace en el navegador:</p>
   <p style="margin:0 0 16px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl(url)}" style="color:${MUTED};">${esc(url)}</a></p>`;

/** Caja con un código (PIN, verificación). */
export const codeBox = (code: string, caption?: string) => `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:4px 0 20px;">
    <tr><td align="center" style="background:${BG};border:1px solid ${LINE};border-radius:10px;padding:18px 12px;">
      <span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:28px;font-weight:600;letter-spacing:0.35em;color:${INK};">${esc(code)}</span>
      ${caption ? `<div style="margin-top:8px;font-size:12px;color:${MUTED};">${esc(caption)}</div>` : ""}
    </td></tr>
  </table>`;

/** Lista de datos (etiqueta · valor). */
export const facts = (rows: [string, string][]) => `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px;border-top:1px solid ${LINE};">
    ${rows.map(([k, v]) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${MUTED};width:38%;">${esc(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK};font-weight:500;">${esc(v)}</td>
    </tr>`).join("")}
  </table>`;

/**
 * Correo completo. `eyebrow` y `heading` se escapan; `body` es HTML ya
 * construido con las funciones de arriba (que escapan los datos).
 */
export function emailLayout({ title, preheader, eyebrow, heading, body, footer }: {
  title: string;
  preheader?: string;
  eyebrow?: string;
  heading: string;
  body: string;
  footer?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};-webkit-font-smoothing:antialiased;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;overflow:hidden;">
        <tr><td style="background:#24406E;line-height:0;font-size:0;">
          <img src="${APP_URL}/email/header.jpg" width="600" alt="Filma Workspace" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#FFFFFF;font-size:16px;font-weight:600;" />
        </td></tr>
        <tr><td style="padding:32px 36px 12px;">
          ${eyebrow ? `<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};">${esc(eyebrow)}</p>` : ""}
          <h1 style="margin:0 0 20px;font-size:21px;line-height:1.3;font-weight:600;color:${INK};">${esc(heading)}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 36px 22px;border-top:1px solid ${LINE};">
          <p style="margin:0;font-size:12px;line-height:1.6;color:${FAINT};">${footer || "Filma Workspace"}</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:${FAINT};">© ${new Date().getFullYear()} Filma Workspace</p>
    </td></tr>
  </table>
</body>
</html>`;
}
