import type { Tone } from "./ui";

export const EMAIL_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Enviado", tone: "none" },
  delivery_delayed: { label: "Retrasado", tone: "warn" },
  delivered: { label: "Entregado", tone: "ok" },
  opened: { label: "Abierto", tone: "ok" },
  clicked: { label: "Pulsado", tone: "ok" },
  failed: { label: "Fallido", tone: "bad" },
  bounced: { label: "Rebotado", tone: "bad" },
  complained: { label: "Marcado como spam", tone: "bad" },
};

export const TEMPLATE_LABEL: Record<string, string> = {
  "horario": "Control horario",
  "horario-resend": "Control horario (reenvío)",
  "horario-review": "Revisión de horarios",
  "project-invite": "Invitación a proyecto",
  "ficha-invite": "Ficha de crew",
  "form-reminder": "Recordatorio de ficha",
  "reset-password": "Restablecer contraseña",
  "verify-code": "Código de verificación",
  "broadcast": "Comunicado",
  "admin-digest": "Resumen diario (admin)",
};
