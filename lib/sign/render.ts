// ─── Filma Sign: documento y PDF firmado ─────────────────────────────────────
// Lo mismo en el navegador y en el servidor: la vista del documento según su
// plantilla, con las firmas puestas, y el PDF final con una última página de
// certificado (partes, firmas, huella SHA-256 y registro de auditoría).

import jsPDF from "jspdf";
import { quoteView, buildDocPdf, type DocView } from "@/lib/billingPdf";
import type { BillingQuote, BillingSettings } from "@/lib/billing";
import { EVENT_LABEL, fmtDateTime, type SignParty, type SignRequest } from "./types";

type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];
const TEXT: RGB = [51, 65, 85];
const MUTED: RGB = [100, 116, 139];
const FAINT: RGB = [148, 163, 184];
const LINE: RGB = [226, 232, 240];
const ACCENT: RGB = [36, 64, 110];

/** Lo que hace falta para pintar y certificar (sin datos internos). */
export type SignDoc = Omit<SignRequest, "createdBy">;

const sigOf = (p: SignParty, label: string) => p.signature
  ? { label, name: p.name, role: p.role, image: p.signature.image, date: fmtDateTime(p.signature.signedAt) }
  : null;

/** Vista del presupuesto con las firmas (si es de presupuesto). */
export function signQuoteView(r: Pick<SignRequest, "payload" | "parties">): DocView | null {
  if (r.payload.kind !== "quote") return null;
  const v = quoteView(r.payload.quote as unknown as BillingQuote, r.payload.settings as unknown as BillingSettings);
  const issuer = r.parties.find((p) => p.side === "issuer");
  const signer = r.parties.find((p) => p.side === "signer");
  const signatures = [issuer && sigOf(issuer, "Por Filma"), signer && sigOf(signer, "Aceptado por el cliente")].filter(Boolean) as NonNullable<DocView["signatures"]>;
  return { ...v, signatures: signatures.length ? signatures : undefined };
}

/** PDF de un documento de texto (plantilla "document"). */
async function textDocPdf(r: SignDoc, header: string | null | undefined): Promise<jsPDF> {
  const p = r.payload as Extract<SignRequest["payload"], { kind: "document" }>;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 18;
  const set = (size: number, color: RGB, style: "normal" | "bold" = "normal") => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  if (header) pdf.addImage(header, "JPEG", 0, 0, W, 42); else { pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 42, "F"); }
  set(9, [255, 255, 255]); pdf.text("DOCUMENTO", W - M, 17, { align: "right" });
  set(15, [255, 255, 255], "bold"); pdf.text(p.reference || "Filma Sign", W - M, 26, { align: "right" });
  let y = 58;
  set(16, INK, "bold");
  const t = pdf.splitTextToSize(p.title, W - 2 * M); pdf.text(t, M, y); y += t.length * 7 + 4;
  set(10, TEXT);
  for (const para of p.body.split(/\n{2,}/)) {
    const lines = pdf.splitTextToSize(para.trim(), W - 2 * M);
    for (const l of lines) { if (y > 260) { pdf.addPage(); y = 24; } pdf.text(l, M, y); y += 5; }
    y += 3;
  }
  const sigs = r.parties.map((x) => sigOf(x, x.side === "issuer" ? `Por ${p.issuerName}` : "Firmante")).filter(Boolean) as NonNullable<DocView["signatures"]>;
  if (sigs.length) {
    if (y > 230) { pdf.addPage(); y = 24; }
    y += 6;
    const colW = (W - 2 * M - 10) / 2;
    sigs.forEach((sg, i) => {
      const x = M + i * (colW + 10);
      set(7.5, FAINT, "bold"); pdf.text(sg.label.toUpperCase(), x, y);
      try { pdf.addImage(sg.image, "PNG", x, y + 2, 50, 17); } catch { /* sin imagen */ }
      pdf.setDrawColor(...LINE); pdf.line(x, y + 21, x + colW, y + 21);
      set(9, INK, "bold"); pdf.text(sg.name, x, y + 26);
      set(7.5, MUTED); pdf.text([sg.role, sg.date].filter(Boolean).join(" · "), x, y + 30.5);
    });
  }
  return pdf;
}

/** Página final: certificado de firma con la auditoría. */
function certificatePage(pdf: jsPDF, r: SignDoc) {
  const W = 210, M = 18;
  const set = (size: number, color: RGB, style: "normal" | "bold" = "normal") => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  pdf.addPage();
  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 26, "F");
  set(8, [255, 255, 255]); pdf.text("FILMA SIGN", M, 11);
  set(14, [255, 255, 255], "bold"); pdf.text("Certificado de firma", M, 19);
  set(8, [255, 255, 255]); pdf.text(r.status === "completed" ? "FIRMADO POR TODAS LAS PARTES" : r.status.toUpperCase(), W - M, 19, { align: "right" });
  let y = 38;
  const kv = (k: string, v: string, mono = false) => {
    set(7.5, FAINT, "bold"); pdf.text(k.toUpperCase(), M, y);
    pdf.setFont(mono ? "courier" : "helvetica", "normal"); pdf.setFontSize(mono ? 8 : 9.5); pdf.setTextColor(...INK);
    const t = pdf.splitTextToSize(v, W - 2 * M - 42); pdf.text(t, M + 42, y); y += Math.max(5.5, t.length * 4.4) + 1;
  };
  kv("Documento", `${r.title}${r.reference && !r.title.includes(r.reference) ? ` (${r.reference})` : ""}`);
  kv("Identificador", r.id, true);
  kv("Huella SHA-256", r.docHash, true);
  kv("Creado", fmtDateTime(r.createdAt));
  if (r.completedAt) kv("Completado", fmtDateTime(r.completedAt));
  y += 4;
  for (const p of r.parties) {
    if (y > 240) { pdf.addPage(); y = 24; }
    pdf.setDrawColor(...LINE); pdf.roundedRect(M, y, W - 2 * M, 34, 1.5, 1.5, "S");
    set(7.5, FAINT, "bold"); pdf.text(p.side === "issuer" ? "EMISOR" : "FIRMANTE", M + 4, y + 6);
    set(10, INK, "bold"); pdf.text(p.name, M + 4, y + 12);
    set(8, TEXT); pdf.text([p.role, p.email, p.taxId && `NIF ${p.taxId}`].filter(Boolean).join(" · "), M + 4, y + 17);
    if (p.signature) {
      set(8, MUTED);
      pdf.text(`Firmado el ${fmtDateTime(p.signature.signedAt)} · ${p.signature.method === "draw" ? "firma manuscrita" : "firma por nombre"}`, M + 4, y + 23);
      pdf.text(`IP ${p.signature.ip || "—"}`, M + 4, y + 27.5);
      pdf.text(pdf.splitTextToSize(p.signature.userAgent || "", 100).slice(0, 1), M + 4, y + 31.5);
      try { pdf.addImage(p.signature.image, "PNG", W - M - 58, y + 5, 52, 18); } catch { /* sin imagen */ }
    } else {
      set(8, MUTED); pdf.text(p.status === "declined" ? `Rechazado${p.declineReason ? `: ${p.declineReason}` : ""}` : "Pendiente de firma", M + 4, y + 23);
    }
    y += 40;
  }
  y += 2;
  set(7.5, FAINT, "bold"); pdf.text("REGISTRO DE AUDITORÍA", M, y); y += 5;
  for (const e of r.events) {
    if (y > 278) { pdf.addPage(); y = 24; }
    const who = r.parties.find((p) => p.id === e.party)?.name || e.by || "";
    set(8, TEXT);
    pdf.text(fmtDateTime(e.at), M, y);
    set(8, INK); pdf.text(`${EVENT_LABEL[e.type]}${who ? ` · ${who}` : ""}${e.detail ? ` · ${e.detail}` : ""}`.slice(0, 95), M + 34, y);
    set(7, FAINT); if (e.ip) pdf.text(e.ip, W - M, y, { align: "right" });
    y += 5;
  }
  y += 4;
  set(7, MUTED);
  pdf.text(pdf.splitTextToSize("Firma electrónica simple (art. 3 del Reglamento eIDAS). La huella SHA-256 identifica el contenido exacto que se firmó; cualquier cambio en el documento la altera. Fechas en hora peninsular española.", W - 2 * M), M, Math.min(y, 285));
}

/** PDF completo: documento con las firmas + certificado. */
export async function buildSignedPdf(r: SignDoc, opts: { header?: string | null } = {}): Promise<jsPDF> {
  const v = signQuoteView(r);
  const pdf = v ? await buildDocPdf(v, opts) : await textDocPdf(r, opts.header);
  certificatePage(pdf, r);
  return pdf;
}

export const signedFileName = (r: Pick<SignRequest, "reference" | "title">) =>
  `${(r.reference || r.title || "documento").replace(/[^a-zA-Z0-9-]+/g, "_")}_firmado.pdf`;
