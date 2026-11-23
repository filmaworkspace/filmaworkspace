// ─── Filma Sign (servidor) ───────────────────────────────────────────────────
// Crear solicitudes, abrirlas con el enlace personal, firmar o rechazar, y al
// completarse: el presupuesto queda aceptado y las dos partes reciben el PDF
// firmado con su certificado.

import { createHash, randomBytes } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { sendEmail, SIGN_EMAIL_FROM } from "@/lib/emails/send";
import { emailTexts } from "@/lib/emails/textsServer";
import { fillText, textOf } from "@/lib/emails/texts";

import { signRequestHtml, signRequestText, signCompletedHtml, signCompletedText } from "@/lib/emails/sign";
import { buildSignedPdf, signedFileName } from "@/lib/sign/render";
import { plain, stableJson } from "@/lib/sign/hash";
import { SIGN_DOC_TYPES, type SignDocType } from "@/lib/sign/types";
import type { PublicSignRequest, SignEvent, SignKind, SignParty, SignPayload, SignRequest, SignSignature } from "@/lib/sign/types";

const COL = "signRequests";
const DAY = 86_400_000;
export const APP_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://filmaworkspace.com").replace(/\/$/, "");

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
let headerCache: string | null | undefined;
async function headerDataUrl() {
  if (headerCache !== undefined) return headerCache;
  try { headerCache = `data:image/jpeg;base64,${(await readFile(path.join(process.cwd(), "public/email/header.jpg"))).toString("base64")}`; }
  catch { headerCache = null; }
  return headerCache;
}

export interface CreateInput {
  kind: SignKind;
  /** Presupuesto (kind quote). */
  quoteId?: string;
  /** Documento libre (kind document). */
  title?: string;
  body?: string;
  docType?: string | null;
  signer: { name: string; email: string; role?: string; taxId?: string };
  issuer: { name: string; email: string; role: string; signature: SignSignature };
  message?: string;
  expiresInDays?: number;
  createdBy: string;
  /** A qué cuenta/proyecto se imputa (Filma Sign por uso). */
  billTo?: { producerId?: string | null; projectId?: string | null; projectName?: string | null } | null;
}

export async function createSignRequest(input: CreateInput, meta: { ip: string; userAgent: string }) {
  let payload: SignPayload; let title: string; let reference: string | null = null; let refPath: string | null = null;
  if (input.kind === "quote") {
    if (!input.quoteId) throw new Error("Falta el presupuesto");
    const ref = db.collection("billingQuotes").doc(input.quoteId);
    const q = (await ref.get()).data();
    if (!q) throw new Error("Presupuesto no encontrado");
    if (q.status === "draft" || !q.number) throw new Error("Emite el presupuesto antes de enviarlo a firmar");
    if (q.status === "rejected") throw new Error("El presupuesto está rechazado");
    const settings = (await db.doc("adminConfig/billing").get()).data() || {};
    payload = { kind: "quote", quote: plain({ ...q, id: ref.id }) as Record<string, unknown>, settings: plain(settings) as Record<string, unknown> };
    title = `Presupuesto ${q.number}${q.projectName ? ` · ${q.projectName}` : ""}`;
    reference = q.number; refPath = ref.path;
  } else {
    if (!input.title?.trim() || !input.body?.trim()) throw new Error("Escribe el título y el texto del documento");
    const docType = input.docType && input.docType in SIGN_DOC_TYPES ? (input.docType as SignDocType) : "other";
    payload = { kind: "document", title: input.title.trim(), body: input.body.trim(), issuerName: input.issuer.name, reference: null, docType };
    title = input.title.trim();
  }
  const email = input.signer.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email del firmante no válido");
  if (!input.signer.name.trim()) throw new Error("Nombre del firmante");

  const now = Date.now();
  const token = randomBytes(24).toString("base64url");
  const parties: SignParty[] = [
    { id: "issuer", side: "issuer", name: input.issuer.name, email: input.issuer.email, role: input.issuer.role, status: "signed", signature: input.issuer.signature },
    { id: "signer", side: "signer", name: input.signer.name.trim(), email, role: input.signer.role?.trim() || "", taxId: input.signer.taxId?.trim() || "", status: "pending", signature: null },
  ];
  const ref = db.collection(COL).doc();
  const docHash = sha256(stableJson(payload));
  const events: SignEvent[] = [
    { at: now, type: "created", by: input.issuer.name, ip: meta.ip, userAgent: meta.userAgent },
    { at: now, type: "signed", party: "issuer", ip: meta.ip, userAgent: meta.userAgent },
  ];
  const data: Omit<SignRequest, "id"> & { tokenHashes: Record<string, string>; tokenIndex: string[] } = {
    kind: input.kind, status: "pending", title, reference, refPath, payload, docHash, parties,
    message: (input.message || "").slice(0, 2000), events, createdAt: now, createdBy: input.createdBy,
    docType: input.kind === "document" ? (payload as { docType?: SignDocType | null }).docType || "other" : null,
    producerId: input.billTo?.producerId || null, projectId: input.billTo?.projectId || null, projectName: input.billTo?.projectName || null,
    expiresAt: now + (input.expiresInDays || 30) * DAY, completedAt: null,
    tokenHashes: { signer: sha256(token) }, tokenIndex: [sha256(token)],
  };
  await ref.set(data);
  if (refPath) await db.doc(refPath).update({ signRequestId: ref.id, signStatus: "pending", updatedAt: FieldValue.serverTimestamp() });

  const url = `${APP_URL}/sign/${token}`;
  const txReq = await emailTexts("sign-request");
  const { error } = await sendEmail({
    to: email,
    subject: fillText(textOf("sign-request", "subject", txReq), { firmante: parties[1].name, emisor: input.issuer.name, documento: title }),
    html: signRequestHtml({ title, signerName: parties[1].name, issuerName: input.issuer.name, message: data.message, url, expiresAt: data.expiresAt }, txReq),
    text: signRequestText({ title, signerName: parties[1].name, issuerName: input.issuer.name, message: data.message, url, expiresAt: data.expiresAt }),
    tags: [{ name: "type", value: "sign-request" }],
    from: SIGN_EMAIL_FROM, replyTo: input.issuer.email || undefined,
  }, undefined, { signRequestId: ref.id });
  await ref.update({ events: FieldValue.arrayUnion({ at: Date.now(), type: "sent", party: "signer", detail: error ? `Error al enviar: ${error.message}` : email }) });
  return { id: ref.id, url, emailError: error?.message || null };
}

async function findByToken(token: string) {
  if (!token || token.length < 20) return null;
  const snap = await db.collection(COL).where("tokenIndex", "array-contains", sha256(token)).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as SignRequest & { tokenHashes: Record<string, string> };
  const partyId = Object.entries(data.tokenHashes || {}).find(([, h]) => h === sha256(token))?.[0];
  if (!partyId) return null;
  return { ref: d.ref, data: { ...data, id: d.id }, partyId };
}

export function publicView(r: SignRequest & { tokenHashes?: unknown; tokenIndex?: unknown }, you: string): PublicSignRequest {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tokenHashes, tokenIndex, createdBy, ...rest } = r as SignRequest & { tokenHashes?: unknown; tokenIndex?: unknown };
  const status = rest.status === "pending" && rest.expiresAt < Date.now() ? "expired" : rest.status;
  // IP y dispositivo de las otras partes no se enseñan en la página pública.
  const events = rest.events.map((e) => (e.party === you ? e : { ...e, ip: null, userAgent: null }));
  const parties = rest.parties.map((p) => (p.id === you || !p.signature ? p : { ...p, signature: { ...p.signature, ip: "", userAgent: "" } }));
  return { ...rest, events, parties, status, you };
}

/** Abrir el enlace: devuelve la solicitud y apunta la primera apertura (y las siguientes, como máximo una por hora). */
export async function openByToken(token: string, meta: { ip: string; userAgent: string }) {
  const f = await findByToken(token);
  if (!f) return null;
  const { ref, data, partyId } = f;
  const party = data.parties.find((p) => p.id === partyId)!;
  const lastView = [...data.events].reverse().find((e) => e.type === "viewed" && e.party === partyId);
  if (!lastView || Date.now() - lastView.at > 3_600_000) {
    const ev: SignEvent = { at: Date.now(), type: "viewed", party: partyId, ip: meta.ip, userAgent: meta.userAgent };
    const parties = data.parties.map((p) => (p.id === partyId && !p.viewedAt ? { ...p, viewedAt: ev.at } : p));
    await ref.update({ events: FieldValue.arrayUnion(ev), parties });
    data.events.push(ev); data.parties = parties;
  }
  void party;
  return publicView(data, partyId);
}

export async function actByToken(token: string, action: { type: "sign"; signature: Omit<SignSignature, "signedAt" | "ip" | "userAgent">; name?: string; taxId?: string; consent: boolean } | { type: "decline"; reason: string }, meta: { ip: string; userAgent: string }) {
  const f = await findByToken(token);
  if (!f) throw new Error("Enlace no válido");
  const { ref, partyId } = f;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = { ...(snap.data() as SignRequest), id: snap.id };
    if (data.status !== "pending") throw new Error("Esta solicitud ya no admite firmas");
    if (data.expiresAt < Date.now()) throw new Error("El enlace ha caducado. Pide uno nuevo.");
    const party = data.parties.find((p) => p.id === partyId);
    if (!party || party.status !== "pending") throw new Error("Ya has respondido a esta solicitud");
    // La huella tiene que seguir cuadrando con lo congelado.
    if (sha256(stableJson(data.payload)) !== data.docHash) throw new Error("El documento ha cambiado desde que se envió");
    const at = Date.now();
    let parties: SignParty[]; const events: SignEvent[] = [];
    if (action.type === "sign") {
      if (!action.consent) throw new Error("Tienes que aceptar el documento para firmarlo");
      const img = action.signature.image;
      if (typeof img !== "string" || !img.startsWith("data:image/png;base64,") || img.length > 400_000) throw new Error("Firma no válida");
      const sig: SignSignature = { image: img, method: action.signature.method === "type" ? "type" : "draw", typedName: String(action.signature.typedName || "").slice(0, 120), signedAt: at, ip: meta.ip, userAgent: meta.userAgent.slice(0, 300) };
      parties = data.parties.map((p) => (p.id === partyId ? { ...p, status: "signed" as const, signature: sig, name: action.name?.trim() || p.name, taxId: action.taxId?.trim() || p.taxId || "" } : p));
      events.push({ at, type: "signed", party: partyId, ip: meta.ip, userAgent: meta.userAgent.slice(0, 300) });
    } else {
      parties = data.parties.map((p) => (p.id === partyId ? { ...p, status: "declined" as const, declineReason: action.reason.slice(0, 500) } : p));
      events.push({ at, type: "declined", party: partyId, ip: meta.ip, userAgent: meta.userAgent.slice(0, 300), detail: action.reason.slice(0, 200) });
    }
    const complete = parties.every((p) => p.status === "signed");
    const status = action.type === "decline" ? "declined" : complete ? "completed" : "pending";
    if (complete) events.push({ at, type: "completed" });
    tx.update(ref, { parties, status, completedAt: complete ? at : null, events: FieldValue.arrayUnion(...events) });
    return { ...data, parties, status, completedAt: complete ? at : null, events: [...data.events, ...events] } as SignRequest;
  });

  if (result.refPath) {
    if (result.status === "completed") {
      await db.doc(result.refPath).update({ status: "accepted", acceptedAt: FieldValue.serverTimestamp(), signStatus: "signed", signedAt: result.completedAt, decisionNote: `Firmado con Filma Sign por ${result.parties.find((p) => p.side === "signer")?.name}`, updatedAt: FieldValue.serverTimestamp() });
    } else if (result.status === "declined") {
      await db.doc(result.refPath).update({ signStatus: "declined", updatedAt: FieldValue.serverTimestamp() });
    }
  }
  if (result.status === "completed") await sendSignedCopies(ref, result);
  return publicView(result, partyId);
}

/** Envía el PDF firmado por las dos partes a todas ellas. */
export async function sendSignedCopies(ref: FirebaseFirestore.DocumentReference, r: SignRequest) {
  let attachment: { filename: string; content: string; contentType: string } | undefined;
  try {
    const pdf = await buildSignedPdf(r, { header: await headerDataUrl() });
    attachment = { filename: signedFileName(r), content: Buffer.from(pdf.output("arraybuffer")).toString("base64"), contentType: "application/pdf" };
  } catch (e) { console.error("[sign] pdf", (e as Error).message); }
  const to = [...new Set(r.parties.map((p) => p.email).filter(Boolean))];
  const txDone = await emailTexts("sign-completed");
  const { error } = await sendEmail({
    to,
    subject: fillText(textOf("sign-completed", "subject", txDone), { documento: r.title }),
    html: signCompletedHtml({ title: r.title, parties: r.parties.map((p) => ({ name: p.name, at: p.signature?.signedAt || null })), docHash: r.docHash, attached: !!attachment }, txDone),
    text: signCompletedText({ title: r.title, parties: r.parties.map((p) => ({ name: p.name, at: p.signature?.signedAt || null })), docHash: r.docHash, attached: !!attachment }),
    tags: [{ name: "type", value: "sign-completed" }],
    from: SIGN_EMAIL_FROM, replyTo: r.parties.find((p) => p.side === "issuer")?.email || undefined,
    attachments: attachment ? [attachment] : undefined,
  }, undefined, { signRequestId: ref.id });
  await ref.update({ events: FieldValue.arrayUnion({ at: Date.now(), type: "copy_sent", detail: error ? `Error: ${error.message}` : to.join(", ") }) });
}

/** Acciones del admin sobre una solicitud. */
export async function adminAction(id: string, action: "cancel" | "remind" | "resend_copy", by: string) {
  const ref = db.collection(COL).doc(id);
  const data = { ...((await ref.get()).data() as SignRequest), id };
  if (!data.kind) throw new Error("No encontrada");
  if (action === "cancel") {
    if (data.status !== "pending") throw new Error("Solo se cancela una solicitud pendiente");
    await ref.update({ status: "cancelled", events: FieldValue.arrayUnion({ at: Date.now(), type: "cancelled", by }) });
    if (data.refPath) await db.doc(data.refPath).update({ signStatus: "cancelled" }).catch(() => {});
  } else if (action === "remind") {
    if (data.status !== "pending") throw new Error("Ya no está pendiente");
    // Nuevo enlace (el anterior deja de valer): el token no se guarda en claro.
    const token = randomBytes(24).toString("base64url");
    const signer = data.parties.find((p) => p.side === "signer")!;
    await ref.update({ "tokenHashes.signer": sha256(token), tokenIndex: [sha256(token)], expiresAt: Math.max(data.expiresAt, Date.now() + 7 * DAY) });
    const url = `${APP_URL}/sign/${token}`;
    const issuer = data.parties.find((p) => p.side === "issuer")!;
    const { error } = await sendEmail({
      to: signer.email, subject: `Recordatorio: ${data.title} pendiente de firma`,
      html: signRequestHtml({ title: data.title, signerName: signer.name, issuerName: issuer.name, message: data.message, url, expiresAt: Math.max(data.expiresAt, Date.now() + 7 * DAY), reminder: true }, await emailTexts("sign-request")),
      text: signRequestText({ title: data.title, signerName: signer.name, issuerName: issuer.name, message: data.message, url, expiresAt: data.expiresAt }),
      tags: [{ name: "type", value: "sign-request" }],
      from: SIGN_EMAIL_FROM, replyTo: issuer.email || undefined,
    }, undefined, { signRequestId: id });
    if (error) throw new Error(error.message);
    await ref.update({ events: FieldValue.arrayUnion({ at: Date.now(), type: "reminded", by, detail: signer.email }) });
    return { url };
  } else {
    if (data.status !== "completed") throw new Error("Aún no está firmado");
    await sendSignedCopies(ref, data);
  }
  return {};
}
