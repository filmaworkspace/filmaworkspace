// Textos personalizados de los emails (Admin › Emails › Plantillas), leídos
// en el servidor con una caché de un minuto.
import { db } from "@/lib/firebase-admin";
import type { EmailTexts, EmailTextsDoc, TextTemplateId } from "./texts";

let cache: { at: number; doc: EmailTextsDoc } | null = null;

export async function emailTexts(id: TextTemplateId): Promise<EmailTexts> {
  if (!cache || Date.now() - cache.at > 60_000) {
    let doc: EmailTextsDoc = {};
    try { doc = ((await db.doc("adminConfig/emailTemplates").get()).data() || {}) as EmailTextsDoc; } catch { /* textos por defecto */ }
    cache = { at: Date.now(), doc };
  }
  return cache.doc[id] || {};
}
