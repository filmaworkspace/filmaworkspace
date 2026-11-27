// ─── Acreditación del crew con QR ────────────────────────────────────────────
// Cada persona tiene una acreditación con un QR. El QR abre /acreditacion/…,
// que comprueba en el momento si sigue siendo válida (de alta, dentro de sus
// fechas y no revocada) y enseña su foto, nombre y puesto. La tarjeta se
// imprime en PDF (tamaño tarjeta, 10 por hoja A4 con marcas de corte).

import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { db } from "@/lib/firebase";
import { renderProjectBand } from "@/lib/docs/projectPdf";

export interface AccreditationPerson {
  id: string;
  name: string;            // nombre en créditos o completo
  role: string;
  department: string;
  crewNumber?: string;
  startDate?: string;
  endDate?: string;
  photoUrl?: string;
  accreditation?: { token: string; issuedAt?: unknown } | null;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const accreditationUrl = (token: string) => `${window.location.origin}/acreditacion/${token}`;

/** Devuelve el token de la persona, creándolo si no tiene. */
export async function ensureAccreditation(projectId: string, p: AccreditationPerson, by: string): Promise<string> {
  if (p.accreditation?.token) return p.accreditation.token;
  const token = newToken();
  const id = await sha(token);
  const b = writeBatch(db);
  b.set(doc(db, "accreditations", id), { projectId, crewId: p.id, revoked: false, issuedAt: serverTimestamp(), issuedByName: by });
  b.update(doc(db, `projects/${projectId}/crew`, p.id), { accreditation: { token, id, issuedAt: serverTimestamp(), issuedByName: by } });
  await b.commit();
  p.accreditation = { token };
  return token;
}

/** Reemite: el QR anterior deja de valer (p. ej. tarjeta perdida). */
export async function reissueAccreditation(projectId: string, p: AccreditationPerson, by: string): Promise<string> {
  if (p.accreditation?.token) {
    await updateDoc(doc(db, "accreditations", await sha(p.accreditation.token)), { revoked: true, revokedAt: serverTimestamp(), revokedByName: by }).catch(() => {});
  }
  p.accreditation = null;
  return ensureAccreditation(projectId, p, by);
}

export async function revokeAccreditation(projectId: string, p: AccreditationPerson, by: string) {
  if (!p.accreditation?.token) return;
  await setDoc(doc(db, "accreditations", await sha(p.accreditation.token)), { revoked: true, revokedAt: serverTimestamp(), revokedByName: by }, { merge: true });
}

async function imageData(url: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const blob = await r.blob();
    // Recorte cuadrado centrado, en JPEG, para que pese poco
    const bmp = await createImageBitmap(blob);
    const side = Math.min(bmp.width, bmp.height);
    const c = document.createElement("canvas"); c.width = 360; c.height = 360;
    c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 360, 360);
    return c.toDataURL("image/jpeg", 0.85);
  } catch { return null; }
}

const dmy = (s?: string) => (s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");

/** PDF con las acreditaciones: 10 por hoja A4 (85,6 × 54 mm) y marcas de corte. */
export async function accreditationsPdf(opts: {
  projectId: string; projectName: string; producer?: string; coverUrl?: string | null;
  people: AccreditationPerson[]; user: string; onProgress?: (done: number, total: number) => void;
}): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const CW = 85.6, CH = 54, GX = 8, GY = 4;
  const left = (210 - (2 * CW + GX)) / 2, top = (297 - (5 * CH + 4 * GY)) / 2;
  const band = await renderProjectBand(opts.projectId, opts.coverUrl, 1712, 260);
  for (let i = 0; i < opts.people.length; i++) {
    const p = opts.people[i];
    if (i && i % 10 === 0) pdf.addPage();
    const k = i % 10, x = left + (k % 2) * (CW + GX), y = top + Math.floor(k / 2) * (CH + GY);
    const token = await ensureAccreditation(opts.projectId, p, opts.user);
    const qr = await QRCode.toDataURL(accreditationUrl(token), { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#0F172A", light: "#FFFFFF" } });
    const photo = p.photoUrl ? await imageData(p.photoUrl) : null;

    // Tarjeta
    pdf.addImage(band, "JPEG", x, y, CW, 13);
    pdf.setFillColor(15, 23, 42); pdf.rect(x, y + 13, CW, 0.6, "F");
    pdf.setTextColor(255, 255, 255); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.text(pdf.splitTextToSize(opts.projectName, CW - 30)[0], x + 4, y + 6.4);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(5.6);
    if (opts.producer) pdf.text(opts.producer.toUpperCase(), x + 4, y + 10.2, { charSpace: 0.4 });
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(6); pdf.text("CREW", x + CW - 4, y + 6.4, { align: "right", charSpace: 0.8 });

    // Foto
    const ph = 31, px = x + 4, py = y + 17.5;
    if (photo) pdf.addImage(photo, "JPEG", px, py, ph * 0.8, ph);
    else { pdf.setFillColor(241, 245, 249); pdf.rect(px, py, ph * 0.8, ph, "F"); pdf.setTextColor(148, 163, 184); pdf.setFontSize(5.5); pdf.text("SIN FOTO", px + ph * 0.4, py + ph / 2, { align: "center" }); }

    // Datos
    const tx = px + ph * 0.8 + 3.5, tw = CW - (tx - x) - 27;
    pdf.setTextColor(15, 23, 42); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9.5);
    const nameLines = pdf.splitTextToSize(p.name, tw).slice(0, 2);
    pdf.text(nameLines, tx, py + 4);
    let ty = py + 4 + nameLines.length * 4;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7); pdf.setTextColor(51, 65, 85);
    pdf.text(pdf.splitTextToSize(p.role || "—", tw).slice(0, 2), tx, ty); ty += 3.4 * Math.min(2, pdf.splitTextToSize(p.role || "—", tw).length);
    pdf.setTextColor(100, 116, 139); pdf.text(pdf.splitTextToSize(p.department || "", tw)[0] || "", tx, ty + 0.6);
    pdf.setFontSize(6.2); pdf.setTextColor(100, 116, 139);
    const dates = p.startDate && p.endDate ? `Válida ${dmy(p.startDate)} – ${dmy(p.endDate)}` : p.startDate ? `Desde ${dmy(p.startDate)}` : p.endDate ? `Hasta ${dmy(p.endDate)}` : "";
    if (dates) pdf.text(dates, tx, py + ph - 1);
    if (p.crewNumber) { pdf.setFont("courier", "normal"); pdf.text(`CRW-${String(p.crewNumber).padStart(4, "0")}`, tx, py + ph - 4.2); }

    // QR
    pdf.addImage(qr, "PNG", x + CW - 25, py, 21, 21);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(4.6); pdf.setTextColor(148, 163, 184);
    pdf.text("Escanea para verificar", x + CW - 14.5, py + 24, { align: "center" });
    // Borde de la tarjeta, por encima de la cabecera
    pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.25); pdf.roundedRect(x, y, CW, CH, 2.5, 2.5, "S");

    // Marcas de corte
    pdf.setDrawColor(203, 213, 225); pdf.setLineWidth(0.1);
    for (const [cx, cy] of [[x, y], [x + CW, y], [x, y + CH], [x + CW, y + CH]]) {
      pdf.line(cx - 2.5, cy, cx - 1, cy); pdf.line(cx + 1, cy, cx + 2.5, cy);
      pdf.line(cx, cy - 2.5, cx, cy - 1); pdf.line(cx, cy + 1, cx, cy + 2.5);
    }
    opts.onProgress?.(i + 1, opts.people.length);
  }
  // Pie de cada hoja
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(148, 163, 184);
    pdf.text(`${opts.projectName} · Acreditaciones · ${new Date().toLocaleDateString("es-ES")} · ${opts.user}`, 105, 292, { align: "center" });
  }
  return pdf;
}

export function savePdf(pdf: jsPDF, name: string) {
  const url = URL.createObjectURL(pdf.output("blob"));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
