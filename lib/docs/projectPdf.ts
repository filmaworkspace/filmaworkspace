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

// ─── Código de color por tipo de documento ───────────────────────────────────
// La proforma va en rojo: no vale como justificante y, cuando llega la factura
// definitiva, se sustituye (el mismo documento pasa a ser factura).
export type DocTypeKey = "po" | "invoice" | "proforma" | "budget" | "guarantee" | "box" | "supplier" | "crew" | "sign" | "crewList" | "calendar" | "ledger" | "form";
export const DOC_TYPES: Record<DocTypeKey, { label: string; rgb: RGB; hex: string }> = {
  po:        { label: "Orden de compra",  rgb: [47, 82, 224],  hex: "#2F52E0" },
  invoice:   { label: "Factura",          rgb: [5, 150, 105],  hex: "#059669" },
  proforma:  { label: "Proforma",         rgb: [220, 38, 38],  hex: "#DC2626" },
  budget:    { label: "Presupuesto",      rgb: [217, 119, 6],  hex: "#D97706" },
  guarantee: { label: "Fianza",           rgb: [100, 116, 139], hex: "#64748B" },
  box:       { label: "Box",              rgb: [124, 58, 237], hex: "#7C3AED" },
  supplier:  { label: "Proveedor",        rgb: [15, 23, 42],   hex: "#0F172A" },
  // Equipo
  crew:      { label: "Documentación de crew", rgb: [107, 163, 25], hex: "#6BA319" },
  sign:      { label: "Filma Sign",       rgb: [36, 64, 110],  hex: "#24406E" },
  crewList:  { label: "Crew list",        rgb: [107, 163, 25], hex: "#6BA319" },
  calendar:  { label: "Calendario",       rgb: [107, 163, 25], hex: "#6BA319" },
  form:      { label: "Resguardo",        rgb: [107, 163, 25], hex: "#6BA319" },
  // Contabilidad (otros)
  ledger:    { label: "Libro mayor",      rgb: [47, 82, 224],  hex: "#2F52E0" },
};
/** Tipos de cada centro de documentación. */
export const ACCOUNTING_DOC_TYPES: DocTypeKey[] = ["po", "invoice", "proforma", "budget", "guarantee", "box", "supplier"];
export const TEAM_DOC_TYPES: DocTypeKey[] = ["crew", "sign"];

// ─── Especificación de un documento ──────────────────────────────────────────
export interface DocProject {
  name: string; code: string; producer?: string; phase?: string; seed: string; band: string;
  /** Datos fiscales de la productora (razón social · NIF · dirección), en pequeño al pie. */
  legal?: string;
}
export interface DocApproval {
  level: number;
  role: string;
  status: "approved" | "pending" | "rejected";
  by?: string;
  at?: Date | null;
  auditId?: string;
}
export interface DocColumn { label: string; width: number; align?: "left" | "right"; mono?: boolean }
export interface DocTableGroup { title: string; note?: string; rows: string[][]; subRows?: (string | null)[] }
export interface ProjectDocSpec {
  project: DocProject;
  /** Vertical (por defecto) u horizontal para tablas anchas. */
  orientation?: "p" | "l";
  docLabel: string;        // "Orden de compra"
  docType: DocTypeKey;
  number: string;          // "LUZ-PO-0013"
  version?: string;        // "V01"
  status?: { label: string; tone: "ok" | "warn" | "bad" | "none" };
  meta: [string, string][];
  party?: { title: string; name: string; lines: string[] };
  summary?: { title: string; text: string };
  /** Texto corrido (cartas, certificados). */
  body?: string[];
  /** Caja destacada (p. ej. "Todas las facturas abonadas"). */
  highlight?: { title: string; text: string };
  /** Firma al final (cartas, vales). */
  signature?: { label: string; name: string; role?: string }[];
  /** Tabla: filas sueltas o agrupadas (departamentos, cuentas…), con fila de totales opcional. */
  table?: { columns: DocColumn[]; rows?: string[][]; subRows?: (string | null)[]; groups?: DocTableGroup[]; foot?: string[] };
  /** La base imponible es la cifra protagonista; IVA, IRPF y total van debajo en pequeño. */
  totals?: { base: string; rows: [string, string][]; label?: string };
  /** Historial de versiones (al pie del documento). Los listados no lo llevan. */
  versions?: { version: string; at: Date; by: string; change: string }[];
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
  const land = spec.orientation === "l";
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: land ? "landscape" : "portrait" });
  const W = land ? 297 : 210, H = land ? 210 : 297, M = 16, BOTTOM = H - 31;
  const pal = projectPalette(spec.project.seed);
  const ACC: RGB = pal.base[1];
  const set = (size: number, color: RGB, style: "normal" | "bold" = "normal") => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  let y = 0;
  const ensure = (h: number) => { if (y + h > BOTTOM) { pdf.addPage(); y = 22; } };

  // ── Cabecera del proyecto (baja: 34 mm) + franja del tipo de documento ──
  const HB = 34;
  const TYPE = DOC_TYPES[spec.docType];
  pdf.addImage(spec.project.band, "JPEG", 0, 0, W, HB);
  pdf.setFillColor(...TYPE.rgb); pdf.rect(0, HB, W, 1.6, "F");
  const white: RGB = [255, 255, 255];
  if (spec.project.producer) { set(6.5, white); pdf.text(spec.project.producer.toUpperCase(), M, 11, { charSpace: 0.8 }); }
  set(17, white, "bold"); pdf.text(pdf.splitTextToSize(spec.project.name, W - 100)[0], M, 20.5);
  set(7.5, white); pdf.text([spec.project.code, spec.project.phase].filter(Boolean).join("   ·   "), M, 26.5);
  // Tipo: pastilla de su color
  set(6.8, white, "bold");
  const tl = spec.docLabel.toUpperCase();
  const tlw = pdf.getTextWidth(tl) + 5;
  pdf.setFillColor(...TYPE.rgb); pdf.roundedRect(W - M - tlw, 7.4, tlw, 5, 2.5, 2.5, "F");
  pdf.text(tl, W - M - 2.5, 10.9, { align: "right" });
  set(14, white, "bold"); pdf.text(spec.number, W - M, 20.5, { align: "right" });
  if (spec.version || spec.status) {
    set(7, white); pdf.text([spec.version, spec.status?.label].filter(Boolean).join("  ·  "), W - M, 26.5, { align: "right" });
  }

  // ── Datos clave ────────────────────────────────────────────────────────────
  y = HB + 10;
  const cells = spec.meta.slice(0, land ? 6 : 4);
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
    y = party(spec.party, M, land ? 180 : 120) + 3;
  }
  if (spec.summary) {
    set(6.5, FAINT, "bold"); pdf.text(spec.summary.title.toUpperCase(), M, y, { charSpace: 0.4 });
    set(10, INK); const t = pdf.splitTextToSize(spec.summary.text, W - 2 * M); pdf.text(t, M, y + 5.5);
    y += 4 + t.length * 4.8 + 3;
  }

  for (const para of spec.body || []) {
    set(10, TEXT); const t = pdf.splitTextToSize(para, W - 2 * M);
    ensure(t.length * 5 + 4); pdf.text(t, M, y); y += t.length * 5 + 4;
  }
  if (spec.highlight) {
    set(9.5, INK, "bold"); const t = pdf.splitTextToSize(spec.highlight.text, W - 2 * M - 14);
    const h = 9 + t.length * 4.4;
    ensure(h + 6);
    pdf.setFillColor(...SOFT); pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.roundedRect(M, y, W - 2 * M, h, 1.6, 1.6, "FD");
    pdf.setFillColor(...ACC); pdf.circle(M + 6, y + 5.6, 2.4, "F");
    pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.5); pdf.line(M + 5, y + 5.7, M + 5.8, y + 6.5); pdf.line(M + 5.8, y + 6.5, M + 7.2, y + 4.8);
    set(9.5, INK, "bold"); pdf.text(spec.highlight.title, M + 11, y + 6.6);
    set(8.5, TEXT); pdf.text(pdf.splitTextToSize(spec.highlight.text, W - 2 * M - 14), M + 11, y + 11.2);
    y += h + 7;
  }

  // ── Tabla ──────────────────────────────────────────────────────────────────
  if (spec.table) {
    const cols = spec.table.columns;
    const xs: number[] = []; let acc = M;
    cols.forEach((c) => { xs.push(c.align === "right" ? acc + c.width : acc); acc += c.width; });
    const head = () => {
      set(6.5, MUTED, "bold");
      cols.forEach((c, i) => pdf.text(c.label.toUpperCase(), xs[i], y, c.align === "right" ? { align: "right" } : { charSpace: 0.3 }));
      y += 2.4; pdf.setDrawColor(...INK); pdf.setLineWidth(0.35); pdf.line(M, y, W - M, y); y += 5.4;
    };
    // Salto de página con la cabecera de la tabla repetida
    const brk = (h: number) => { if (y + h > BOTTOM) { pdf.addPage(); y = 22; head(); } };
    const cell = (c: DocColumn, v: string, x: number, emph: boolean) => {
      if (c.mono) pdf.setFont("courier", "normal"); else pdf.setFont("helvetica", "normal");
      pdf.setFontSize(c.mono ? 8.5 : 9); pdf.setTextColor(...(emph ? INK : TEXT));
      pdf.text(pdf.splitTextToSize(v || "", c.width - 3)[0] || "", x, y, c.align === "right" ? { align: "right" } : {});
    };
    const row = (r: string[], sub: string | null | undefined) => {
      set(9, INK);
      const first = pdf.splitTextToSize(r[0] || "—", cols[0].width - 4);
      const h = first.length * 4.3 + (sub ? 3.6 : 0) + 2;
      brk(h + 2);
      pdf.text(first, xs[0], y);
      if (sub) { set(7.5, MUTED); pdf.text(sub, xs[0], y + first.length * 4.3); }
      cols.slice(1).forEach((c, i) => cell(c, r[i + 1], xs[i + 1], i === cols.length - 2));
      y += h - 1.6;
      pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y, W - M, y); y += 4.4;
    };
    ensure(20);
    head();
    if (spec.table.groups) {
      spec.table.groups.forEach((g, gi) => {
        brk(16);
        if (gi) y += 2;
        pdf.setFillColor(...SOFT); pdf.rect(M, y - 4.2, W - 2 * M, 6.6, "F");
        pdf.setFillColor(...TYPE.rgb); pdf.rect(M, y - 4.2, 1.2, 6.6, "F");
        set(7.5, INK, "bold"); pdf.text(g.title.toUpperCase(), M + 4, y, { charSpace: 0.4 });
        if (g.note) { set(7.5, MUTED); pdf.text(g.note, W - M - 2, y, { align: "right" }); }
        y += 7;
        g.rows.forEach((r, ri) => row(r, g.subRows?.[ri]));
      });
    } else {
      (spec.table.rows || []).forEach((r, ri) => row(r, spec.table!.subRows?.[ri]));
    }
    if (spec.table.foot) {
      brk(9);
      y -= 2.2; pdf.setDrawColor(...INK); pdf.setLineWidth(0.35); pdf.line(M, y, W - M, y); y += 5;
      cols.forEach((c, i) => {
        set(9, INK, "bold");
        pdf.text(pdf.splitTextToSize(spec.table!.foot![i] || "", c.width - 3)[0] || "", xs[i], y, c.align === "right" ? { align: "right" } : {});
      });
      y += 8;
    }
  }

  // ── Importes: base imponible protagonista ─────────────────────────────────
  if (spec.totals) {
    ensure(26 + spec.totals.rows.length * 5);
    const bx = W - M - 72, bw = 72;
    pdf.setFillColor(...ACC); pdf.roundedRect(bx, y, bw, 17, 1.6, 1.6, "F");
    set(6.5, white, "bold"); pdf.text((spec.totals.label || "Base imponible").toUpperCase(), bx + 5, y + 5.6, { charSpace: 0.5 });
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

  if (spec.signature?.length) {
    ensure(34);
    y += 4;
    const sw = (W - 2 * M - 10 * (spec.signature.length - 1)) / spec.signature.length;
    spec.signature.forEach((sg, i) => {
      const x = M + i * (sw + 10);
      set(6.5, FAINT, "bold"); pdf.text(sg.label.toUpperCase(), x, y, { charSpace: 0.4 });
      pdf.setDrawColor(...MUTED); pdf.setLineWidth(0.3); pdf.line(x, y + 18, x + sw, y + 18);
      set(8.5, INK, "bold"); pdf.text(sg.name || " ", x, y + 23);
      if (sg.role) { set(7.5, MUTED); pdf.text(sg.role, x, y + 27); }
    });
    y += 34;
  }

  // ── Historial de versiones ────────────────────────────────────────────────
  if (spec.versions?.length) {
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
  }

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
      pdf.setFillColor(...TYPE.rgb); pdf.rect(0, 0, W, 2.2, "F");
      set(7, MUTED); pdf.text(`${spec.project.name}  ·  ${spec.number}`, M, 10);
    }
    if (spec.project.legal) { set(6.3, FAINT); pdf.text(pdf.splitTextToSize(spec.project.legal, W - 2 * M)[0], M, H - 21); }
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, H - 18, W - M, H - 18);
    set(6.8, MUTED);
    pdf.text(`${spec.number}${spec.version ? ` · ${spec.version}` : ""}  ·  Generado el ${fmtStamp(spec.generatedAt)} por ${spec.generatedBy}`, M, H - 13.5);
    pdf.setFont("courier", "normal"); pdf.setFontSize(6.3); pdf.setTextColor(...FAINT);
    pdf.text(`SHA-256 ${spec.fingerprint.slice(0, 32)}…`, M, H - 9.5);
    set(6.8, MUTED); pdf.text(`${i} / ${pages}`, W - M, H - 13.5, { align: "right" });
    set(6.3, FAINT); pdf.text("Filma Workspace", W - M, H - 9.5, { align: "right" });
  }
  return pdf;
}

// ─── Nomenclatura del hub ────────────────────────────────────────────────────
// Número del documento sin el código del proyecto (el proyecto ya va en la
// cabecera): PO-0001, FRA-0001, PRF-0002, FNZ-0003… (la numeración de
// facturas, proformas y fianzas es una sola). El archivo añade el proveedor.
export type HubDocKind = "PO" | "INV" | "FRA" | "PRF" | "FNZ" | "PRS" | "BOX" | "SUP" | "PAY";
/** Código del número según el tipo de documento de la factura. */
export const INVOICE_CODE: Record<string, HubDocKind> = { invoice: "FRA", proforma: "PRF", guarantee: "FNZ", budget: "PRS" };
export const hubNumber = (kind: HubDocKind | string, n: number | string) =>
  `${kind}-${String(n).replace(/^\D+-?/, "").padStart(4, "0")}`;
export const hubFileName = (number: string, supplier?: string, version?: string) =>
  `${number}${version && version !== "V01" ? `-${version}` : ""}${supplier ? ` · ${supplier.replace(/[\\/:*?"<>|]+/g, " ").trim()}` : ""}.pdf`;
