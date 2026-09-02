interface HorarioReviewProps {
  recipientName: string;
  projectName:   string;
  reviewUrl:     string;
}

export function horarioReviewHtml({ recipientName, projectName, reviewUrl }: HorarioReviewProps): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Control horario — resumen</title></head>
<body style="margin:0;padding:0;background:#f8f8f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5e5;">
        <tr><td style="background:#6BA319;padding:28px 32px;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:.05em;text-transform:uppercase;">${projectName}</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:600;color:#ffffff;">Resumen de control horario</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#363636;">Hola <strong>${recipientName}</strong>,</p>
          <p style="margin:0 0 28px;font-size:14px;color:#666;line-height:1.6;">Desde este enlace puedes revisar todos los días de control horario del proyecto: cuáles has rellenado y si te queda alguno pendiente.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <a href="${reviewUrl}" style="display:inline-block;background:#6BA319;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;text-decoration:none;">Ver mis jornadas</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:12px;color:#999;">O copia este enlace en tu navegador:</p>
          <p style="margin:0;font-size:12px;color:#6BA319;word-break:break-all;">${reviewUrl}</p>
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

export function horarioReviewText({ recipientName, projectName, reviewUrl }: HorarioReviewProps): string {
  return `${projectName} | Resumen de control horario\n\nHola ${recipientName},\n\nRevisa tus jornadas de control horario aquí:\n${reviewUrl}\n\nFilma Workspace`;
}
