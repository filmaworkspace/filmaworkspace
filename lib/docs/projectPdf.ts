// ─── Documentos del proyecto (hub de documentación) ──────────────────────────
// Diseño común de todos los PDF que salen del hub: la cabecera es la del
// proyecto (su degradado o su foto de portada, su nombre, su código y la
// productora); Filma solo firma discretamente al pie. Incluye el bloque de
// aprobaciones con quién aprobó, con qué rol y cuándo, y una huella del
// contenido para verificar que el documento no se ha alterado.

import jsPDF from "jspdf";

type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];
const TEXT: RGB = [51, 65, 85];
const MUTED: RGB = [100, 116, 139];
const FAINT: RGB = [148, 163, 184];
const LINE: RGB = [226, 232, 240];
const SOFT: RGB = [248, 250, 252];

// Mismas paletas que las portadas de proyecto (lib/projectCover.ts)
const PALETTES: { top: RGB; bottom: RGB; mid: RGB; base: [RGB, RGB, RGB] }[] = [
  { top: [148, 190, 214], bottom: [120, 150, 210], mid: [47, 82, 224], base: [[59, 90, 134], [36, 64, 110], [26, 46, 82]] },
  { top: [150, 205, 220], bottom: [96, 140, 200], mid: [36, 99, 200], base: [[47, 95, 134], [31, 68, 102], [19, 45, 74]] },
  { top: [170, 180, 235], bottom: [130, 120, 210], mid: [79, 70, 229], base: [[63, 74, 143], [42, 47, 110], [27, 29, 79]] },
  { top: [185, 200, 220], bottom: [130, 150, 180], mid: [71, 105, 160], base: [[74, 92, 120], [51, 68, 94], [34, 47, 68]] },
  { top: [150, 215, 205], bottom: [100, 165, 185], mid: [20, 130, 150], base: [[46, 106, 114], [31, 78, 90], [20, 54, 66]] },
  { top: [205, 180, 225], bottom: [140, 150, 215], mid: [88, 80, 200], base: [[77, 74, 134], [51, 54, 107], [32, 38, 80]] },
];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
export const projectPalette = (seed: string) => PALETTES[hash(seed) % PALETTES.length];

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Pinta la banda de cabecera del proyecto en un canvas (el mismo degradado de
 * luz que su portada) y, si tiene foto, la foto con un velo oscuro. Devuelve
 * un JPEG en data URL.
 */
export async function renderProjectBand(seed: string, coverUrl?: string | null, w = 2480, h = 520): Promise<string> {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const p = projectPalette(seed);
  const drawGradient = () => {
    const ang = (160 * Math.PI) / 180;
    const dx = Math.sin(ang) * w, dy = -Math.cos(ang) * h;
    const lin = ctx.createLinearGradient(w / 2 - dx / 2, h / 2 - dy / 2, w / 2 + dx / 2, h / 2 + dy / 2);
    lin.addColorStop(0, rgba(p.base[0], 1)); lin.addColorStop(0.45, rgba(p.base[1], 1)); lin.addColorStop(1, rgba(p.base[2], 1));
    ctx.fillStyle = lin; ctx.fillRect(0, 0, w, h);
    const blob = (cx: number, cy: number, rx: number, ry: number, col: RGB, a: number) => {
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(col, a)); g.addColorStop(0.7, rgba(col, 0)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(-rx, -rx, rx * 2, rx * 2); ctx.restore();
    };
    blob(w * 0.85, h * 0.15, w * 0.6, h * 0.7 * 2.2, p.top, 0.85);
    blob(w * 0.1, h * 0.95, w * 0.55, h * 0.6 * 2.2, p.bottom, 0.7);
    blob(w * 0.3, h * 0.3, w * 0.7, h * 0.8 * 2.2, p.mid, 0.55);
  };
  if (coverUrl) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = coverUrl; });
      const s = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      const veil = ctx.createLinearGradient(0, 0, w, 0);
      veil.addColorStop(0, "rgba(10,16,30,0.78)"); veil.addColorStop(1, "rgba(10,16,30,0.45)");
      ctx.fillStyle = veil; ctx.fillRect(0, 0, w, h);
    } catch { drawGradient(); }
  } else drawGradient();
  return c.toDataURL("image/jpeg", 0.9);
}

/** Huella SHA-256 (hex) del contenido del documento, para verificar que no se ha alterado. */
export async function contentFingerprint(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// ─── Especificación de un documento ──────────────────────────────────────────
export interface DocProject { name: string; code: string; producer?: string; phase?: string; seed: string; band: string }
export interface DocApproval {
  level: number;
  role: string;
  status: "approved" | "pending" | "rejected";
  by?: string;
  at?: Date | null;
  auditId?: string;
}
export interface DocColumn { label: string; width: number; align?: "left" | "right"; mono?: boolean }
export interface ProjectDocSpec {
  project: DocProject;
  docLabel: string;        // "Orden de compra"
  number: string;          // "LUZ-PO-0013"
  version?: string;        // "V01"
  status?: { label: string; tone: "ok" | "warn" | "bad" | "none" };
  meta: [string, string][];
  party?: { title: string; name: string; lines: string[] };
  secondParty?: { title: string; name: string; lines: string[] };
  summary?: { title: string; text: string };
  table?: { columns: DocColumn[]; rows: string[][]; subRows?: (string | null)[] };
  /** La base imponible es la cifra protagonista; IVA, IRPF y total van debajo en pequeño. */
  totals?: { base: string; rows: [string, string][] };
  /** Historial de versiones (siempre al pie del documento). */
  versions: { version: string; at: Date; by: string; change: string }[];
  approvals?: DocApproval[];
  extraSections?: { title: string; rows: [string, string][] }[];
  notes?: string;
  generatedAt: Date;
  generatedBy: string;
  fingerprint: string;
}

const fmtStamp = (d: Date) =>
  `${d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;

export function buildProjectDoc(spec: ProjectDocSpec): jsPDF {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16, BOTTOM = 270;
  const pal = projectPalette(spec.project.seed);
  const ACC: RGB = pal.base[1];
  const set = (size: number, color: RGB, style: "normal" | "bold" = "normal") => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  let y = 0;
  const ensure = (h: number) => { if (y + h > BOTTOM) { pdf.addPage(); y = 22; } };

  // ── Cabecera del proyecto ──────────────────────────────────────────────────
  pdf.addImage(spec.project.band, "JPEG", 0, 0, W, 46);
  const white: RGB = [255, 255, 255];
  if (spec.project.producer) { set(7, white); pdf.text(spec.project.producer.toUpperCase(), M, 13, { charSpace: 0.8 }); }
  set(19, white, "bold"); pdf.text(pdf.splitTextToSize(spec.project.name, 110)[0], M, 24);
  set(8, white); pdf.text([spec.project.code, spec.project.phase].filter(Boolean).join("   ·   "), M, 31);
  set(7, white); pdf.text(spec.docLabel.toUpperCase(), W - M, 13, { align: "right" });
  set(15, white, "bold"); pdf.text(spec.number, W - M, 23, { align: "right" });
  if (spec.version || spec.status) {
    const label = [spec.version, spec.status?.label].filter(Boolean).join("  ·  ");
    set(7.5, white, "bold");
    const tw = pdf.getTextWidth(label) + 6;
    pdf.setFillColor(255, 255, 255);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf.saveGraphicsState(); pdf.setGState(new (pdf as any).GState({ opacity: 0.16 }));
    pdf.roundedRect(W - M - tw, 27.2, tw, 5.6, 2.8, 2.8, "F"); pdf.restoreGraphicsState();
    set(7.5, white, "bold"); pdf.text(label, W - M - 3, 31, { align: "right" });
  }

  // ── Datos clave ────────────────────────────────────────────────────────────
  y = 56;
  const cells = spec.meta.slice(0, 4);
  const cw = (W - 2 * M) / Math.max(1, cells.length);
  cells.forEach(([k, v], i) => {
    const x = M + i * cw;
    if (i) { pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(x - 3, y - 3, x - 3, y + 8); }
    set(6.5, FAINT, "bold"); pdf.text(k.toUpperCase(), x, y, { charSpace: 0.4 });
    set(9.5, INK); pdf.text(pdf.splitTextToSize(v || "—", cw - 6)[0], x, y + 5.5);
  });
  y += 14;
  pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, W - M, y);
  y += 7;

  // ── Partes ─────────────────────────────────────────────────────────────────
  const party = (pt: NonNullable<ProjectDocSpec["party"]>, x: number, w: number) => {
    set(6.5, FAINT, "bold"); pdf.text(pt.title.toUpperCase(), x, y, { charSpace: 0.4 });
    set(10, INK, "bold"); const n = pdf.splitTextToSize(pt.name || "—", w); pdf.text(n, x, y + 5.5);
    set(8.5, TEXT); let yy = y + 5.5 + n.length * 4.6;
    for (const l of pt.lines) { pdf.text(pdf.splitTextToSize(l, w), x, yy); yy += 4.2; }
    return yy;
  };
  if (spec.party) {
    const y1 = party(spec.party, M, 84);
    const y2 = spec.secondParty ? party(spec.secondParty, M + 92, 84) : y1;
    y = Math.max(y1, y2) + 3;
  }
  if (spec.summary) {
    set(6.5, FAINT, "bold"); pdf.text(spec.summary.title.toUpperCase(), M, y, { charSpace: 0.4 });
    set(10, INK); const t = pdf.splitTextToSize(spec.summary.text, W - 2 * M); pdf.text(t, M, y + 5.5);
    y += 4 + t.length * 4.8 + 3;
  }

  // ── Tabla ──────────────────────────────────────────────────────────────────
  if (spec.table) {
    const cols = spec.table.columns;
    const xs: number[] = []; let acc = M;
    cols.forEach((c) => { xs.push(c.align === "right" ? acc + c.width : acc); acc += c.width; });
    ensure(20);
    set(6.5, MUTED, "bold");
    cols.forEach((c, i) => pdf.text(c.label.toUpperCase(), xs[i], y, c.align === "right" ? { align: "right" } : { charSpace: 0.3 }));
    y += 2.4; pdf.setDrawColor(...INK); pdf.setLineWidth(0.35); pdf.line(M, y, W - M, y); y += 5.4;
    spec.table.rows.forEach((r, ri) => {
      set(9, INK);
      const first = pdf.splitTextToSize(r[0] || "—", cols[0].width - 4);
      const sub = spec.table!.subRows?.[ri];
      const h = first.length * 4.3 + (sub ? 3.6 : 0) + 2;
      ensure(h + 2);
      pdf.text(first, xs[0], y);
      if (sub) { set(7.5, MUTED); pdf.text(sub, xs[0], y + first.length * 4.3); }
      cols.slice(1).forEach((c, i) => {
        if (c.mono) pdf.setFont("courier", "normal"); else pdf.setFont("helvetica", "normal");
        pdf.setFontSize(c.mono ? 8.5 : 9); pdf.setTextColor(...(i === cols.length - 2 ? INK : TEXT));
        pdf.text(r[i + 1] || "", xs[i + 1], y, c.align === "right" ? { align: "right" } : {});
      });
      y += h - 1.6;
      pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, W - M, y); y += 4.4;
    });
  }

  // ── Importes: base imponible protagonista ─────────────────────────────────
  if (spec.totals) {
    ensure(26 + spec.totals.rows.length * 5);
    const bx = W - M - 72, bw = 72;
    pdf.setFillColor(...ACC); pdf.roundedRect(bx, y, bw, 17, 1.6, 1.6, "F");
    set(6.5, white, "bold"); pdf.text("BASE IMPONIBLE", bx + 5, y + 5.6, { charSpace: 0.5 });
    set(17, white, "bold"); pdf.text(spec.totals.base, bx + bw - 5, y + 13, { align: "right" });
    y += 22.5;
    for (const [k, v] of spec.totals.rows) {
      set(8, MUTED); pdf.text(k, bx + 5, y);
      set(8, TEXT); pdf.text(v, bx + bw - 5, y, { align: "right" });
      y += 4.6;
    }
    y += 3;
  }

  // ── Secciones de datos (pago, codificación…) ───────────────────────────────
  for (const sec of spec.extraSections || []) {
    ensure(10 + sec.rows.length * 5);
    set(6.5, FAINT, "bold"); pdf.text(sec.title.toUpperCase(), M, y, { charSpace: 0.4 }); y += 5;
    for (const [k, v] of sec.rows) {
      set(8.5, MUTED); pdf.text(k, M, y);
      set(8.5, INK); pdf.text(pdf.splitTextToSize(v, W - 2 * M - 46), M + 46, y);
      y += 4.8;
    }
    y += 4;
  }

  // ── Aprobaciones ───────────────────────────────────────────────────────────
  if (spec.approvals?.length) {
    ensure(12 + spec.approvals.length * 10.5);
    set(6.5, FAINT, "bold"); pdf.text("APROBACIONES", M, y, { charSpace: 0.4 });
    const done = spec.approvals.filter((a) => a.status === "approved").length;
    set(7.5, MUTED); pdf.text(`${done} de ${spec.approvals.length}`, W - M, y, { align: "right" });
    y += 4;
    pdf.setFillColor(...SOFT); pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2);
    const boxH = spec.approvals.length * 10.5 + 1.5;
    pdf.roundedRect(M, y, W - 2 * M, boxH, 1.6, 1.6, "FD");
    spec.approvals.forEach((a, i) => {
      const cy = y + 6 + i * 10.5;
      if (i) { pdf.setDrawColor(...LINE); pdf.line(M + 15, cy - 5.2, W - M - 4, cy - 5.2); }
      // sello
      if (a.status === "approved") {
        pdf.setFillColor(...ACC); pdf.circle(M + 8, cy, 3.2, "F");
        pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);
        pdf.line(M + 6.6, cy + 0.1, M + 7.7, cy + 1.2); pdf.line(M + 7.7, cy + 1.2, M + 9.6, cy - 1.1);
      } else if (a.status === "rejected") {
        pdf.setFillColor(220, 38, 38); pdf.circle(M + 8, cy, 3.2, "F");
        pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6);
        pdf.line(M + 6.8, cy - 1.2, M + 9.2, cy + 1.2); pdf.line(M + 9.2, cy - 1.2, M + 6.8, cy + 1.2);
      } else {
        pdf.setDrawColor(...FAINT); pdf.setLineWidth(0.4); pdf.circle(M + 8, cy, 3.2, "S");
      }
      set(9, a.status === "pending" ? MUTED : INK, "bold");
      pdf.text(a.status === "pending" ? "Pendiente de aprobación" : `${a.status === "rejected" ? "Rechazada" : "Aprobada"} por ${a.by || "—"}`, M + 15, cy - 0.6);
      set(7.5, MUTED);
      pdf.text(`Nivel ${a.level} · ${a.role}${a.at ? ` · ${fmtStamp(a.at)}` : ""}`, M + 15, cy + 3.6);
      if (a.auditId) { pdf.setFont("courier", "normal"); pdf.setFontSize(7); pdf.setTextColor(...FAINT); pdf.text(a.auditId, W - M - 4, cy + 1.2, { align: "right" }); }
    });
    y += boxH + 7;
  }

  // ── Historial de versiones (siempre) ──────────────────────────────────────
  ensure(12 + spec.versions.length * 5.2);
  set(6.5, FAINT, "bold"); pdf.text("HISTORIAL DE VERSIONES", M, y, { charSpace: 0.4 }); y += 2.6;
  pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, W - M, y); y += 4.4;
  for (const v of spec.versions) {
    pdf.setFont("courier", "bold"); pdf.setFontSize(8); pdf.setTextColor(...INK); pdf.text(v.version, M, y);
    set(8, TEXT); pdf.text(fmtStamp(v.at), M + 14, y);
    set(8, MUTED); pdf.text(v.by, M + 50, y);
    set(8, TEXT); pdf.text(pdf.splitTextToSize(v.change, W - 2 * M - 96)[0] || "", M + 96, y);
    y += 5.2;
  }
  y += 4;

  if (spec.notes) {
    ensure(14);
    set(6.5, FAINT, "bold"); pdf.text("NOTAS", M, y, { charSpace: 0.4 });
    set(8.5, TEXT); const n = pdf.splitTextToSize(spec.notes, W - 2 * M); pdf.text(n, M, y + 5); y += 6 + n.length * 4.2;
  }

  // ── Pie: trazabilidad ──────────────────────────────────────────────────────
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    if (i > 1) {
      // cabecera mínima en las páginas siguientes
      pdf.setFillColor(...ACC); pdf.rect(0, 0, W, 2.2, "F");
      set(7, MUTED); pdf.text(`${spec.project.name}  ·  ${spec.number}`, M, 10);
    }
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, 279, W - M, 279);
    set(6.8, MUTED);
    pdf.text(`${spec.number}${spec.version ? ` · ${spec.version}` : ""}  ·  Generado el ${fmtStamp(spec.generatedAt)} por ${spec.generatedBy}`, M, 283.5);
    pdf.setFont("courier", "normal"); pdf.setFontSize(6.3); pdf.setTextColor(...FAINT);
    pdf.text(`SHA-256 ${spec.fingerprint.slice(0, 32)}…`, M, 287.5);
    set(6.8, MUTED); pdf.text(`${i} / ${pages}`, W - M, 283.5, { align: "right" });
    set(6.3, FAINT); pdf.text("Filma Workspace", W - M, 287.5, { align: "right" });
  }
  return pdf;
}
