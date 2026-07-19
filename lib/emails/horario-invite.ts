interface HorarioInviteProps {
  recipientName: string;
  projectName:   string; // full project name — shown in body and form
  projectLabel:  string; // working title or name — used in subject only
  date:          string; // "20/07/2026"
  jornada:       number;
  formUrl:       string;
}

export function horarioInviteHtml({ recipientName, projectName, date, jornada, formUrl }: HorarioInviteProps): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control horario</title></head>
<body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">
        <tr><td style="background:#6BA319;padding:28px 32px;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:.05em;text-transform:uppercase;">${projectName}</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:600;color:#ffffff;">Control horario ${date}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">Jornada #${jornada}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#363636;">Hola <strong>${recipientName}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.6;">Por favor, completa tu parte del control horario de hoy. Solo te llevará un momento.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${formUrl}" style="display:inline-block;background:#6BA319;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">Rellenar control horario</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#999;">O copia este enlace en tu navegador:</p>
          <p style="margin:0;font-size:12px;color:#6BA319;word-break:break-all;">${formUrl}</p>
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #f0f0f0;background:#fafafa;">
          <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">Filma Workspace · Este enlace es personal e intransferible</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function horarioInviteText({ recipientName, projectName, projectLabel, date, jornada, formUrl }: HorarioInviteProps): string {
  return `${projectLabel} | Control horario ${date} #${jornada}\n\nHola ${recipientName},\n\n${projectName} — por favor completa tu control horario de hoy:\n${formUrl}\n\nFilma Workspace`;
}
