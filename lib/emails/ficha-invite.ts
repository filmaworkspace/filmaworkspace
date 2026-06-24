interface FichaInviteProps {
  firstName: string;
  projectName: string;
  role: string;
  formUrl: string;
  senderName: string;
}

export function fichaInviteHtml({
  firstName,
  projectName,
  role,
  formUrl,
  senderName,
}: FichaInviteProps): string {
  const BD      = "#342A21";
  const CREAM   = "#FAF8F5";
  const STONE   = "#78716c";
  const BORDER  = "#e7e5e4";
  const BTN_BG  = "#342A21";

  return /* html */`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Completa tu ficha — ${projectName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1ede9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
    style="background-color:#f1ede9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width:560px;width:100%;">

          <!-- Logo / header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <img src="https://filmaworkspace.com/logodark.svg" alt="Filma Workspace" width="140" height="45" style="display:block;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="
              background-color:${CREAM};
              border-radius:20px;
              border:1px solid ${BORDER};
              overflow:hidden;
            ">

              <!-- Top accent bar -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="background-color:${BD};height:4px;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Body -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:40px 40px 32px;">

                    <!-- Greeting -->
                    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${BD};line-height:1.3;">
                      Hola, ${firstName} 👋
                    </p>
                    <p style="margin:0 0 28px;font-size:15px;color:${STONE};line-height:1.6;">
                      ${senderName} te ha invitado a formar parte del equipo de
                      <strong style="color:${BD};">${projectName}</strong>
                      como <strong style="color:${BD};">${role}</strong>.
                    </p>

                    <!-- Divider -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="border-top:1px solid ${BORDER};font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>

                    <!-- What to do -->
                    <p style="margin:24px 0 16px;font-size:13px;font-weight:700;color:${STONE};
                      text-transform:uppercase;letter-spacing:0.08em;">
                      Qué necesitas hacer
                    </p>

                    <!-- Steps -->
                    ${[
                      ["1", "Abre el formulario con el botón de abajo"],
                      ["2", "Rellena tus datos personales, DNI y cuenta bancaria"],
                      ["3", "Firma y envía — listo en menos de 3 minutos"],
                    ].map(([num, text]) => `
                    <table cellpadding="0" cellspacing="0" role="presentation"
                      style="margin-bottom:12px;">
                      <tr>
                        <td style="
                          width:28px;height:28px;
                          background-color:${BD};
                          border-radius:8px;
                          text-align:center;
                          vertical-align:middle;
                          font-size:12px;font-weight:700;color:#FAF8F5;
                        ">${num}</td>
                        <td style="padding-left:12px;font-size:14px;color:${BD};vertical-align:middle;">
                          ${text}
                        </td>
                      </tr>
                    </table>`).join("")}

                    <!-- CTA button -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                      style="margin-top:32px;">
                      <tr>
                        <td align="center">
                          <a href="${formUrl}"
                            style="
                              display:inline-block;
                              background-color:${BTN_BG};
                              color:#FAF8F5;
                              font-size:15px;
                              font-weight:600;
                              text-decoration:none;
                              padding:14px 36px;
                              border-radius:12px;
                              letter-spacing:0.01em;
                            ">
                            Completar mi ficha →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback URL -->
                    <p style="margin:20px 0 0;font-size:11px;color:#a8a29e;text-align:center;line-height:1.6;">
                      Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                      <a href="${formUrl}" style="color:${STONE};word-break:break-all;">${formUrl}</a>
                    </p>

                  </td>
                </tr>
              </table>

              <!-- Footer inside card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="
                    border-top:1px solid ${BORDER};
                    padding:20px 40px;
                    background-color:#f5f2ef;
                  ">
                    <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.6;">
                      Este enlace es personal e intransferible. Si no esperabas este
                      correo puedes ignorarlo sin problema.<br/>
                      Enviado por <strong style="color:${STONE};">${senderName}</strong>
                      a través de <strong style="color:${STONE};">Filma Workspace</strong>.
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Bottom spacer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#a8a29e;">
                © Filma Workspace
              </p>
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

export function fichaInviteText({
  firstName,
  projectName,
  role,
  formUrl,
  senderName,
}: FichaInviteProps): string {
  return `
Hola ${firstName},

${senderName} te ha invitado a formar parte del equipo de "${projectName}" como ${role}.

Para completar tu ficha de alta accede al siguiente enlace:
${formUrl}

Solo te llevará unos minutos — rellena tus datos personales, DNI y cuenta bancaria y envía el formulario.

Si no esperabas este correo puedes ignorarlo.

— Filma Workspace
`.trim();
}
