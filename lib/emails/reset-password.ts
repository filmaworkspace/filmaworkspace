interface ResetPasswordProps {
  name: string;
  resetUrl: string;
}

export function resetPasswordHtml({ name, resetUrl }: ResetPasswordProps): string {
  const BD     = "#342A21";
  const CREAM  = "#FAF8F5";
  const STONE  = "#78716c";
  const BORDER = "#e7e5e4";
  const firstName = name ? name.split(" ")[0] : "hola";

  return /* html */`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Restablecer contraseña — Filma Workspace</title>
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
              <img src="https://filmaworkspace.com/logodark.svg" alt="Filma Workspace" width="140" height="28" style="display:block;" />
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
                      Restablecer contraseña
                    </p>
                    <p style="margin:0 0 28px;font-size:15px;color:${STONE};line-height:1.6;">
                      Hola${name ? `, <strong style="color:${BD};">${firstName}</strong>` : ""}. Hemos recibido una solicitud para restablecer
                      la contraseña de tu cuenta en Filma Workspace.
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="border-top:1px solid ${BORDER};font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>

                    <!-- CTA -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;">
                      <tr>
                        <td align="center">
                          <a href="${resetUrl}"
                            style="display:inline-block;background-color:${BD};color:#FAF8F5;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:12px;">
                            Crear nueva contraseña →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Expiry notice -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:24px;">
                      <tr>
                        <td style="background-color:#f5f2ef;border-radius:12px;padding:14px 16px;">
                          <p style="margin:0;font-size:12px;color:${STONE};line-height:1.5;">
                            ⏱ Este enlace caduca en <strong>1 hora</strong>. Si no lo usas tendrás que solicitar uno nuevo.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback URL -->
                    <p style="margin:20px 0 0;font-size:11px;color:#a8a29e;text-align:center;line-height:1.6;">
                      Si el botón no funciona, copia este enlace en tu navegador:<br/>
                      <a href="${resetUrl}" style="color:${STONE};word-break:break-all;">${resetUrl}</a>
                    </p>

                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-top:1px solid ${BORDER};padding:20px 40px;background-color:#f5f2ef;">
                    <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.6;">
                      Si no solicitaste este cambio, ignora este correo — tu contraseña no se modificará.<br/>
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

export function resetPasswordText({ name, resetUrl }: ResetPasswordProps): string {
  const firstName = name ? name.split(" ")[0] : "";
  return `
Hola${firstName ? ` ${firstName}` : ""},

Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Filma Workspace.

Crea tu nueva contraseña aquí (caduca en 1 hora):
${resetUrl}

Si no solicitaste este cambio, ignora este correo.

— Filma Workspace
`.trim();
}
