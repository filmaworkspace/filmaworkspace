// ─── Envío de emails con registro ────────────────────────────────────────────
// Todos los correos salen por aquí: se envían con Resend (con la cabecera
// incrustada) y se apuntan en emailLog para el centro de emails del admin.
// El estado (entregado, rebotado, spam…) lo actualiza el webhook de Resend
// (app/api/webhooks/resend). Un fallo al registrar nunca bloquea el envío.
import { Resend } from "resend";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { emailAttachments } from "./headerImage";

const resend = new Resend(process.env.RESEND_API_KEY);
export const EMAIL_FROM = process.env.RESEND_FROM ?? "Filma Workspace <onboarding@resend.dev>";

// Plantillas cuyo contenido no se guarda: llevan códigos o enlaces de acceso.
const SENSITIVE = new Set(["reset-password", "verify-code"]);

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  tags?: { name: string; value: string }[];
}

const templateOf = (p: EmailPayload) => p.tags?.find((t) => t.name === "type")?.value || "otro";

function logEntry(p: EmailPayload, result: { id?: string | null; error?: string | null }, meta?: Record<string, unknown>, inline = true) {
  const template = templateOf(p);
  const keep = !SENSITIVE.has(template);
  return {
    to: Array.isArray(p.to) ? p.to : [p.to],
    subject: p.subject,
    template,
    status: result.error ? "failed" : "sent",
    error: result.error || null,
    resendId: result.id || null,
    html: keep ? p.html : null,
    text: keep ? p.text || null : null,
    inlineHeader: inline,
    meta: meta || {},
    events: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function writeLog(entries: ReturnType<typeof logEntry>[]) {
  try {
    for (let i = 0; i < entries.length; i += 400) {
      const batch = db.batch();
      entries.slice(i, i + 400).forEach((e) => batch.set(db.collection("emailLog").doc(), e));
      await batch.commit();
    }
  } catch (err) {
    console.error("[emailLog]", (err as Error)?.message);
  }
}

/** Envía un email (cabecera incrustada) y lo registra. Devuelve lo mismo que Resend. */
export async function sendEmail(p: EmailPayload, opts?: { idempotencyKey?: string }, meta?: Record<string, unknown>) {
  const res = await resend.emails.send(
    { from: p.from || EMAIL_FROM, to: p.to, subject: p.subject, html: p.html, text: p.text || "", tags: p.tags, attachments: emailAttachments() },
    opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
  );
  await writeLog([logEntry(p, { id: res.data?.id, error: res.error?.message }, meta)]);
  return res;
}

/**
 * Envío por lotes (comunicados). Resend no admite adjuntos en lote, así que
 * el HTML debe usar la cabecera remota (emailLayout({ remoteHeader: true })).
 */
export async function sendEmailBatch(items: EmailPayload[], meta?: Record<string, unknown>) {
  let sent = 0;
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const res = await resend.batch.send(chunk.map((p) => ({ from: p.from || EMAIL_FROM, to: p.to, subject: p.subject, html: p.html, text: p.text || "", tags: p.tags })));
    const ids = (res.data as { data?: { id: string }[] } | null)?.data || [];
    await writeLog(chunk.map((p, k) => logEntry(p, { id: ids[k]?.id, error: res.error?.message }, meta, false)));
    if (res.error) throw new Error(res.error.message);
    sent += chunk.length;
  }
  return sent;
}

/** Reenvía un email registrado (solo los que guardan contenido). */
export async function resendLogged(logId: string) {
  const snap = await db.collection("emailLog").doc(logId).get();
  const d = snap.data();
  if (!d || !d.html) throw new Error("Este email no se puede reenviar");
  return sendEmail(
    { to: d.to, subject: d.subject, html: d.html, text: d.text || "", tags: [{ name: "type", value: d.template }] },
    undefined,
    { ...(d.meta || {}), resentFrom: logId },
  );
}
