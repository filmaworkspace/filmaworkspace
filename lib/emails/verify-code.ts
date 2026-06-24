interface VerifyCodeProps {
  name: string;
  code: string;
}

export function verifyCodeHtml({ name, code }: VerifyCodeProps): string {
  const BD     = "#342A21";
  const CREAM  = "#FAF8F5";
  const STONE  = "#78716c";
  const BORDER = "#e7e5e4";
  const firstName = name.split(" ")[0];

  const digits = code.split("").map(d => `
    <td style="padding:0 4px;">
      <div style="
        width:44px;height:52px;
        background-color:#fff;
        border:1.5px solid ${BORDER};
        border-radius:10px;
        font-size:26px;font-weight:700;
        color:${BD};
        text-align:center;line-height:52px;
        font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
      ">${d}</div>
    </td>`).join("");

  return /* html */`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Código de verificación — Filma Workspace</title>
</head>
<body style="margin:0;padding:0;background-color:#f1ede9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
    style="background-color:#f1ede9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width:560px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="background-color:${BD};border-radius:14px;padding:10px 20px;">
                    <span style="color:#FAF8F5;font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">FILMA</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:${CREAM};border-radius:20px;border:1px solid ${BORDER};overflow:hidden;">

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="background-color:${BD};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding:40px 40px 32px;">

                    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${BD};line-height:1.3;">
                      Hola, ${firstName} 👋
                    </p>
                    <p style="margin:0 0 32px;font-size:15px;color:${STONE};line-height:1.6;">
                      Introduce este código en la pantalla de verificación para completar
                      el registro en <strong style="color:${BD};">Filma Workspace</strong>.
                    </p>

                    <!-- Code display -->
                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 28px;">
                      <tr>${digits}</tr>
                    </table>

                    <!-- Expiry notice -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="background-color:#f5f2ef;border-radius:12px;padding:14px 16px;">
                          <p style="margin:0;font-size:12px;color:${STONE};text-align:center;line-height:1.5;">
                            ⏱ Este código caduca en <strong>10 minutos</strong>
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-top:1px solid ${BORDER};padding:20px 40px;background-color:#f5f2ef;">
                    <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.6;">
                      Si no solicitaste este código puedes ignorar este correo.<br/>
                      <strong style="color:${STONE};">Filma Workspace</strong>
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#a8a29e;">© Filma Workspace</p>
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

export function verifyCodeText({ name, code }: VerifyCodeProps): string {
  const firstName = name.split(" ")[0];
  return `
Hola ${firstName},

Tu código de verificación para Filma Workspace es:

${code}

Caduca en 10 minutos. Si no solicitaste este código puedes ignorar este correo.

— Filma Workspace
`.trim();
}
