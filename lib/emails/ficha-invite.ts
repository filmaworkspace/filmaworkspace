interface FichaInviteProps {
  firstName: string;
  projectName: string;
  role: string;
  formUrl: string;
  pin: string;
  senderName: string;
}

export function fichaInviteHtml({
  firstName,
  projectName,
  role,
  formUrl,
  pin,
  senderName,
}: FichaInviteProps): string {
  const BD     = "#342A21";
  const CREAM  = "#FAF8F5";
  const STONE  = "#78716c";
  const BORDER = "#e7e5e4";

  const pinDigits = pin.split("").map(d => `
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
  <title>Completa tu ficha — ${projectName}</title>
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
                    <p style="margin:0 0 28px;font-size:15px;color:${STONE};line-height:1.6;">
                      ${senderName} te ha invitado a formar parte del equipo de
                      <strong style="color:${BD};">${projectName}</strong>
                      como <strong style="color:${BD};">${role}</strong>.
                    </p>

                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="border-top:1px solid ${BORDER};font-size:0;line-height:0;">&nbsp;</td></tr>
                    </table>

                    <!-- Steps -->
                    <p style="margin:24px 0 16px;font-size:13px;font-weight:700;color:${STONE};text-transform:uppercase;letter-spacing:0.08em;">
                      Qué necesitas hacer
                    </p>

                    ${[
                      ["1", `Abre el formulario con el botón de abajo. Cuando te pida la clave, introduce <strong style="color:${BD};">${pin}</strong>`],
                      ["2", "Rellena tus datos"],
                      ["3", "Firma y envía"],
                    ].map(([num, text]) => `
                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:12px;">
                      <tr>
                        <td style="width:28px;height:28px;background-color:${BD};border-radius:8px;text-align:center;vertical-align:middle;font-size:12px;font-weight:700;color:#FAF8F5;">${num}</td>
                        <td style="padding-left:12px;font-size:14px;color:${BD};vertical-align:middle;">${text}</td>
                      </tr>
                    </table>`).join("")}

                    <!-- PIN block -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;">
                      <tr>
                        <td style="background-color:#f5f2ef;border-radius:14px;padding:20px;">
                          <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:${STONE};text-transform:uppercase;letter-spacing:0.08em;text-align:center;">
                            Tu código PIN
                          </p>
                          <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                            <tr>${pinDigits}</tr>
                          </table>
                          <p style="margin:12px 0 0;font-size:11px;color:#a8a29e;text-align:center;">
                            Guarda este código — lo necesitarás para acceder al formulario
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA button -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;">
                      <tr>
                        <td align="center">
                          <a href="${formUrl}"
                            style="display:inline-block;background-color:${BD};color:#FAF8F5;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:12px;">
                            Completar mi ficha →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:20px 0 0;font-size:11px;color:#a8a29e;text-align:center;line-height:1.6;">
                      Si el botón no funciona, copia este enlace:<br/>
                      <a href="${formUrl}" style="color:${STONE};word-break:break-all;">${formUrl}</a>
                    </p>

                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-top:1px solid ${BORDER};padding:20px 40px;background-color:#f5f2ef;">
                    <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.6;">
                      Este enlace es personal e intransferible. Si no esperabas este correo puedes ignorarlo.<br/>
                      Enviado por <strong style="color:${STONE};">${senderName}</strong>
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

export function fichaInviteText({
  firstName,
  projectName,
  role,
  formUrl,
  pin,
  senderName,
}: FichaInviteProps): string {
  return `
Hola ${firstName},

${senderName} te ha invitado a formar parte del equipo de "${projectName}" como ${role}.

Tu código PIN para acceder al formulario: ${pin}

Completa tu ficha aquí:
${formUrl}

Guarda el PIN — lo necesitarás al abrir el formulario.

— Filma Workspace
`.trim();
}
