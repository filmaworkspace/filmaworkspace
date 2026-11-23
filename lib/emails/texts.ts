// ─── Textos personalizables de los emails ────────────────────────────────────
// Cada plantilla tiene textos por defecto (los de siempre) que el admin puede
// cambiar en Admin › Emails › Plantillas: asunto, título, texto principal,
// botón y pie. Se guardan en adminConfig/emailTemplates y lo que no se toca
// sigue con el texto por defecto.
//
// Variables: {nombre}, {proyecto}… Un tramo entre corchetes solo aparece si
// sus variables tienen valor: "Hola[ {nombre}]," → "Hola," si no hay nombre.
// Las variables se escapan siempre (y van en negrita en el texto principal).

import { esc, strong } from "./layout";

export type TextField = "subject" | "heading" | "intro" | "button" | "footer";
export type EmailTexts = Partial<Record<TextField, string>>;

export const FIELD_LABEL: Record<TextField, string> = {
  subject: "Asunto", heading: "Título", intro: "Texto", button: "Botón", footer: "Pie",
};

export interface TemplateDef {
  label: string;
  vars: Record<string, string>;
  defaults: Required<Pick<EmailTexts, "subject" | "heading" | "intro">> & EmailTexts;
}

export const EMAIL_TEXT_DEFS = {
  "project-invite": {
    label: "Invitación a proyecto",
    vars: { nombre: "Nombre de quien recibe", invitador: "Quien invita", proyecto: "Proyecto", rol: "Rol" },
    defaults: {
      subject: "{proyecto} | {invitador} te ha invitado",
      heading: "{proyecto}",
      intro: "Hola[ {nombre}], {invitador} te ha invitado a unirte al proyecto[ como {rol}].",
      footer: "Enviado por {invitador} a través de Filma Workspace. Si no esperabas esta invitación, ignora este correo.",
    },
  },
  "ficha-invite": {
    label: "Ficha de crew",
    vars: { nombre: "Nombre", invitador: "Quien invita", proyecto: "Proyecto", rol: "Puesto" },
    defaults: {
      subject: "{proyecto} | Completa tu ficha",
      heading: "Completa tu ficha de alta",
      intro: "Hola {nombre}, {invitador} te ha invitado a formar parte del equipo de {proyecto}[ como {rol}].\n\nAbre el formulario, introduce este PIN cuando te lo pida, rellena tus datos y envíalo.",
      button: "Completar mi ficha",
      footer: "Enviado por {invitador} a través de Filma Workspace. El enlace es personal: no lo reenvíes.",
    },
  },
  "horario": {
    label: "Control horario",
    vars: { nombre: "Nombre", proyecto: "Proyecto", fecha: "Fecha", jornada: "Nº de jornada" },
    defaults: {
      subject: "{proyecto} | Control horario {fecha} #{jornada}",
      heading: "Control horario · {fecha}",
      intro: "Por favor, completa tu parte del control horario de hoy. Solo te llevará un momento.",
      button: "Rellenar control horario",
      footer: "Este enlace es personal: no lo reenvíes.",
    },
  },
  "horario-review": {
    label: "Revisión de horarios",
    vars: { nombre: "Nombre", proyecto: "Proyecto" },
    defaults: {
      subject: "{proyecto} | Resumen de control horario",
      heading: "Resumen de control horario",
      intro: "Hola {nombre},\n\nDesde este enlace puedes revisar todos tus días de control horario del proyecto: los que has rellenado y los que te quedan pendientes.",
      button: "Ver mis jornadas",
      footer: "Este enlace es personal: no lo reenvíes.",
    },
  },
  "reset-password": {
    label: "Restablecer contraseña",
    vars: { nombre: "Nombre" },
    defaults: {
      subject: "Filma Workspace | Restablecer tu contraseña",
      heading: "Restablecer contraseña",
      intro: "Hola[ {nombre}], hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Filma Workspace.",
      button: "Crear nueva contraseña",
      footer: "Si no has pedido este cambio, ignora este correo: tu contraseña no se modifica.",
    },
  },
  "verify-code": {
    label: "Código de verificación",
    vars: { nombre: "Nombre", codigo: "Código" },
    defaults: {
      subject: "Filma Workspace | {codigo} es tu código de verificación",
      heading: "Tu código de verificación",
      intro: "Hola[ {nombre}], introduce este código en la pantalla de verificación para completar el registro.",
      footer: "Si no has pedido este código, ignora este correo.",
    },
  },
  "billing-invoice": {
    label: "Factura de Filma",
    vars: { cliente: "Cliente", numero: "Número", emisor: "Emisor" },
    defaults: {
      subject: "Factura {numero} · {emisor}",
      heading: "{numero}",
      intro: "Hola[ {cliente}], te enviamos la factura {numero}. La tienes adjunta en PDF.",
      footer: "{emisor} · Filma Workspace",
    },
  },
  "billing-quote": {
    label: "Presupuesto de Filma",
    vars: { cliente: "Cliente", numero: "Número", emisor: "Emisor" },
    defaults: {
      subject: "Presupuesto {numero} · {emisor}",
      heading: "{numero}",
      intro: "Hola[ {cliente}], te enviamos el presupuesto {numero}. Lo tienes adjunto en PDF.",
      footer: "{emisor} · Filma Workspace",
    },
  },
  "sign-request": {
    label: "Filma Sign · para firmar",
    vars: { firmante: "Firmante", emisor: "Quien envía", documento: "Documento" },
    defaults: {
      subject: "Para firmar: {documento}",
      heading: "{documento}",
      intro: "Hola {firmante}, {emisor} te ha enviado este documento para que lo revises y lo firmes. Ya está firmado por su parte.",
      button: "Revisar y firmar",
      footer: "Filma Sign · Filma Workspace",
    },
  },
  "sign-completed": {
    label: "Filma Sign · firmado",
    vars: { documento: "Documento" },
    defaults: {
      subject: "Firmado: {documento}",
      heading: "{documento}",
      intro: "El documento está firmado por todas las partes.",
      footer: "Filma Sign · Filma Workspace",
    },
  },
} satisfies Record<string, TemplateDef>;

export type TextTemplateId = keyof typeof EMAIL_TEXT_DEFS;
export type EmailTextsDoc = Partial<Record<TextTemplateId, EmailTexts>>;
type Vars = Record<string, string | number | null | undefined>;

/** Campos editables de una plantilla (los que tienen texto por defecto). */
export const fieldsOf = (id: TextTemplateId) => (Object.keys(FIELD_LABEL) as TextField[]).filter((f) => (EMAIL_TEXT_DEFS[id].defaults as EmailTexts)[f] !== undefined);

/** Texto final de un campo: el personalizado o el de por defecto. */
export function textOf(id: TextTemplateId, field: TextField, custom?: EmailTexts | null) {
  const c = custom?.[field];
  return c && c.trim() ? c : ((EMAIL_TEXT_DEFS[id].defaults as EmailTexts)[field] || "");
}

const val = (vars: Vars, k: string) => { const v = vars[k]; return v === null || v === undefined ? "" : String(v); };

/** Quita los tramos [ ... ] cuyas variables estén vacías. */
function optionals(t: string, vars: Vars) {
  return t.replace(/\[([^[\]]*)\]/g, (_, inner: string) => {
    const keys = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return keys.length && keys.every((k) => val(vars, k).trim()) ? inner : "";
  });
}

/** Texto plano (asunto, texto de los emails en texto). */
export function fillText(t: string, vars: Vars) {
  return optionals(t, vars).replace(/\{(\w+)\}/g, (_, k: string) => val(vars, k)).replace(/[ \t]+([,.])/g, "$1").trim();
}

/** HTML de una línea (título, botón, pie): todo escapado. */
export function fillInline(t: string, vars: Vars) {
  return esc(fillText(t, vars));
}

/** HTML del texto principal: párrafos, saltos de línea y variables en negrita. */
export function fillRich(t: string, vars: Vars, paragraph: (html: string) => string) {
  const text = optionals(t, vars);
  return text.split(/\n\s*\n/).map((para) => {
    const html = para.trim().split(/(\{\w+\})/g).map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (m) { const v = val(vars, m[1]); return v ? strong(esc(v)) : ""; }
      return esc(part).replace(/\r?\n/g, "<br/>");
    }).join("").replace(/\s+([,.])/g, "$1");
    return html ? paragraph(html) : "";
  }).join("");
}
