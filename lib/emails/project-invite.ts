interface ProjectInviteProps {
  inviteeName: string;
  invitedByName: string;
  projectName: string;
  role: string;
  isExistingUser: boolean;
  loginUrl?: string;
  registerUrl?: string;
}

export function projectInviteHtml({
  inviteeName,
  invitedByName,
  projectName,
  role,
  isExistingUser,
  loginUrl    = "https://filmaworkspace.com/login",
  registerUrl = "https://filmaworkspace.com/register",
}: ProjectInviteProps): string {
  const BD     = "#342A21";
  const CREAM  = "#FAF8F5";
  const STONE  = "#78716c";
  const BORDER = "#e7e5e4";
  const firstName = inviteeName.split(" ")[0];

  const ctaUrl   = isExistingUser ? loginUrl : registerUrl;
  const ctaLabel = isExistingUser ? "Ver mi invitación →" : "Crear mi cuenta →";
  const subtitle = isExistingUser
    ? `Entra en tu cuenta para aceptarla y empezar a colaborar en el proyecto.`
    : `Para unirte necesitas crear una cuenta gratuita en Filma Workspace. Solo te llevará un momento.`;

  return /* html */`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Te han invitado a ${projectName} — Filma Workspace</title>
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
              <img src="https://filmaworkspace.com/logodark.svg" alt="Filma Workspace" width="140" height="45" style="display:block;" />
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
                    <p style="margin:0 0 6px;font-size:15px;color:${STONE};line-height:1.6;">
                      <strong style="color:${BD};">${invitedByName}</strong> te ha invitado a unirte al proyecto
                    </p>

                    <!-- Project pill -->
                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 20px;">
                      <tr>
                        <td style="background-color:${BD};border-radius:10px;padding:8px 16px;">
                          <span style="color:#FAF8F5;font-size:15px;font-weight:700;">${projectName}</span>
                        </td>
                      </tr>
                    </table>

                    ${role ? `
                    <p style="margin:0 0 28px;font-size:14px;color:${STONE};line-height:1.6;">
                      Tu rol en el proyecto: <strong style="color:${BD};">${role}</strong>
                    </p>` : `<div style="margin-bottom:28px;"></div>`}

                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="border-top:1px solid ${BORDER};font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>

                    <!-- Existing vs new user message -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:24px;margin-bottom:28px;">
                      <tr>
                        <td style="background-color:#f5f2ef;border-radius:12px;padding:16px;">
                          <p style="margin:0;font-size:13px;color:${STONE};line-height:1.6;">
                            ${isExistingUser
                              ? `✅ Ya tienes cuenta en Filma Workspace. ${subtitle}`
                              : `👤 Aún no tienes cuenta en Filma Workspace. ${subtitle}`}
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td align="center">
                          <a href="${ctaUrl}"
                            style="display:inline-block;background-color:${BD};color:#FAF8F5;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:12px;">
                            ${ctaLabel}
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:20px 0 0;font-size:11px;color:#a8a29e;text-align:center;line-height:1.6;">
                      Si el botón no funciona, copia este enlace:<br/>
                      <a href="${ctaUrl}" style="color:${STONE};word-break:break-all;">${ctaUrl}</a>
                    </p>

                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-top:1px solid ${BORDER};padding:20px 40px;background-color:#f5f2ef;">
                    <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.6;">
                      Si no esperabas esta invitación puedes ignorar este correo.<br/>
                      Enviado por <strong style="color:${STONE};">${invitedByName}</strong>
                      a través de <strong style="color:${STONE};">Filma Workspace</strong>.
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

export function projectInviteText({
  inviteeName,
  invitedByName,
  projectName,
  role,
  isExistingUser,
  loginUrl    = "https://filmaworkspace.com/login",
  registerUrl = "https://filmaworkspace.com/register",
}: ProjectInviteProps): string {
  const firstName = inviteeName.split(" ")[0];
  const ctaUrl = isExistingUser ? loginUrl : registerUrl;
  return `
Hola ${firstName},

${invitedByName} te ha invitado a unirte al proyecto "${projectName}"${role ? ` como ${role}` : ""}.

${isExistingUser
  ? `Ya tienes cuenta en Filma Workspace. Entra para ver tu invitación:\n${ctaUrl}`
  : `Para unirte crea tu cuenta gratuita en Filma Workspace:\n${ctaUrl}`}

Si no esperabas esta invitación puedes ignorar este correo.

— Filma Workspace
`.trim();
}
