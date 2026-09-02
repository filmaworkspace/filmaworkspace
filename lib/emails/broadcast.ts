interface BroadcastProps {
  content: string;
}

export function broadcastHtml({ content }: BroadcastProps): string {
  const accent = "#2F52E0";
  const accentBg = "#EFF2FF";

  return /* html */`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mensaje de Filma Workspace</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
    style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img src="https://filmaworkspace.com/logodark.svg" alt="Filma Workspace" width="140" height="28" style="display:block;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden;">

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="background-color:#0f172a;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:36px 40px 32px;">

                    <!-- Badge -->
                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:20px;">
                      <tr>
                        <td style="background-color:${accentBg};border-radius:8px;padding:6px 14px;">
                          <span style="font-size:12px;font-weight:700;color:${accent};text-transform:uppercase;letter-spacing:0.08em;">Mensaje</span>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0;font-size:15px;color:#475569;line-height:1.7;white-space:pre-wrap;">
                      ${content.replace(/\n/g, "<br/>")}
                    </p>

                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-top:1px solid #e2e8f0;padding:18px 40px;background-color:#f8fafc;">
                    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
                      Este mensaje ha sido enviado por el equipo de <strong style="color:#64748b;">Filma Workspace</strong>.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">© Filma Workspace</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
`.trim();
}

export function broadcastText({ content }: BroadcastProps): string {
  return `${content}\n\n— Filma Workspace`.trim();
}
