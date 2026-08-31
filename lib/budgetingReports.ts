// ─────────────────────────────────────────────────────────────────────────────
// Exportación de un borrador de Budgeting a Excel y PDF (además del .fwb de
// budgetingExport.ts). El PDF reutiliza el builder de marca compartido
// (lib/pdfBuilder.ts) con el acento de Budgeting: minimalista, sin adornos.
// El Excel usa el mismo método de escritura XML+zip ya probado en el
// importador de Accounting > Budget (fflate, sin librerías nuevas).
//
// `exportConfig` (portada, salto de página por capítulo, campos visibles)
// es opcional: si no se pasa, se exporta con el comportamiento de siempre.
// ─────────────────────────────────────────────────────────────────────────────

import { strToU8, zipSync } from "fflate";
import { FilmaPDF } from "./pdfBuilder";
import { BudgetingCategoryDef, BudgetingExportConfig, BudgetingFolder, BudgetingFringe, BudgetingProjectInfo, BudgetingUnit, DEFAULT_EXPORT_CONFIG, DEFAULT_TEXT_LINE_COLOR, PDF_FONT_SIZES, PdfLanguage, fmtCurrency, groupFringeSumsByFolder, pluralizeUnit } from "./budgeting";

// Las líneas de texto/subtotal (isTextLine/isSubtotal) son opcionales en las
// tres interfaces: el Excel/.fwb las sigue excluyendo (reportParams las
// filtra antes de llegar aquí), pero el PDF las incluye y las pinta con su
// negrita/color, igual que en pantalla.
interface ReportChapter { id: string; code: string; description: string; isTextLine?: boolean; isSubtotal?: boolean; textBold?: boolean; textColor?: string | null; }
interface ReportSubchapter {
  id: string; code: string; description: string; receivedTotal?: number; receivedCode?: string; receivedLabel?: string;
  isTextLine?: boolean; isSubtotal?: boolean; textBold?: boolean; textColor?: string | null;
}
interface ReportLine {
  id: string; code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number;
  notes?: string; tags?: string[]; fringeIds?: string[]; routedTo?: { subchapterCode: string } | null;
  isTextLine?: boolean; isSubtotal?: boolean; textBold?: boolean; textColor?: string | null;
}

export interface BudgetReportParams {
  draftName: string;
  currency: string;
  categoriesEnabled: boolean;
  categories: BudgetingCategoryDef[];
  chaptersByCategory: (categoryId: string | null) => ReportChapter[];
  subchaptersByChapter: Record<string, ReportSubchapter[]>;
  linesBySubchapter: Record<string, ReportLine[]>;
  /** Para desglosar las cargas sociales en el PDF, igual que en pantalla. */
  fringes?: BudgetingFringe[];
  /** Carpetas de cargas sociales: las que comparten carpeta se funden en una sola línea, igual que en pantalla. */
  fringeFolders?: BudgetingFolder[];
  /** Unidades del borrador (singular/plural): la columna Unidad se pluraliza según la Cantidad de cada línea, igual que en pantalla. */
  units?: BudgetingUnit[];
  /** Datos de producción para la cabecera del PDF (portada estilo Top Sheet). */
  projectInfo?: BudgetingProjectInfo;
  grandTotal: number;
  exportConfig?: BudgetingExportConfig;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Excel ───────────────────────────────────────────────────────────────────

function buildXlsx(sheetName: string, rows: (string | number)[][]): Uint8Array {
  const cellXml = (col: number, row: number, val: string | number, sIdx = 0): string => {
    const colLetter = String.fromCharCode(65 + col);
    const addr = `${colLetter}${row}`;
    const s = sIdx > 0 ? ` s="${sIdx}"` : "";
    if (typeof val === "number") return `<c r="${addr}"${s}><v>${val}</v></c>`;
    if (val === "") return `<c r="${addr}"${s}/>`;
    return `<c r="${addr}" t="inlineStr"${s}><is><t>${esc(String(val))}</t></is></c>`;
  };
  let sheetRows = "";
  rows.forEach((row, ri) => {
    const r = ri + 1;
    sheetRows += `<row r="${r}">${row.map((v, c) => cellXml(c, r, v, ri === 0 ? 1 : 0)).join("")}</row>`;
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(wbXml),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/styles.xml": strToU8(stylesXml),
  });
}

export function downloadBudgetExcel(p: BudgetReportParams) {
  const cfg = p.exportConfig || DEFAULT_EXPORT_CONFIG;
  const header = ["Categoría", "Capítulo", "Subcapítulo", "Código", "Descripción", "Cantidad"];
  if (cfg.fields.unit) header.push("Unidad");
  header.push("X", "Tarifa", "Total");
  if (cfg.fields.notes) header.push("Comentario");
  if (cfg.fields.tags) header.push("Etiquetas");

  const rows: (string | number)[][] = [header];
  const cats = p.categoriesEnabled ? p.categories : [{ id: "all", label: "" } as BudgetingCategoryDef];
  cats.forEach((cat) => {
    p.chaptersByCategory(p.categoriesEnabled ? cat.id : null).forEach((chapter) => {
      (p.subchaptersByChapter[chapter.id] || []).forEach((sub) => {
        (p.linesBySubchapter[sub.id] || []).forEach((line) => {
          const row: (string | number)[] = [
            cat.label, `${chapter.code} ${chapter.description}`, `${sub.code} ${sub.description}`,
            line.code, line.description, line.units,
          ];
          if (cfg.fields.unit) row.push(pluralizeUnit(line.unit, line.units, p.units || []));
          row.push(line.multiplier, line.rate, line.total);
          if (cfg.fields.notes) row.push(line.notes || "");
          if (cfg.fields.tags) row.push((line.tags || []).join(", "));
          rows.push(row);
        });
      });
    });
  });
  const tail = new Array(header.length - 2).fill("");
  rows.push([...tail, "Total", p.grandTotal]);
  const bytes = buildXlsx("Presupuesto", rows);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.draftName.replace(/[^\w\-]+/g, "_")}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
// Formato "top sheet" de presupuesto de producción (Movie Magic Budgeting):
// portada solo con los datos de producción (nunca totales, siempre en su
// propia página), y Top Sheet + Detalle como una única tabla continua por
// sección, tal cual se ve en pantalla: filas finas, con línea, sin cabeceras
// de columna ni títulos tipográficos intercalados. Las líneas de texto y los
// subtotales del presupuesto se pintan igual, con su negrita/color, en vez de
// quedar fuera del PDF. Las cargas sociales aparecen como sus propias filas
// en cada nivel donde computan, igual que en pantalla.

type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];       // slate-900
const MUTED: RGB = [100, 116, 139];  // slate-500
const RULE: RGB = [148, 163, 184];   // slate-400, borde de tabla
const RULE_LIGHT: RGB = [203, 213, 225]; // slate-300, borde de fila
const ACCENT: RGB = [232, 111, 74];   // #E86F4A, acento de Budgeting
const HEADER_BG: RGB = [241, 245, 249];  // slate-100: cabecera de columna clara, no negra
const CATEGORY_BG: RGB = [229, 231, 235]; // gris neutro (no el acento), para las filas de categoría (ATL/BTL)
const TOTAL_BG: RGB = [226, 232, 240];   // slate-200: filas de total (Top Sheet y Detalle), un poco más marcado

// ─── Idioma del PDF: solo traduce los textos fijos (etiquetas, encabezados
// de columna, "Total"...). Todo lo escrito en el presupuesto (nombres,
// descripciones, notas, códigos...) sale siempre tal cual, sin tocar. ──────
interface PdfI18n {
  format: string; episodesUnit: string; perEpisode: string;
  version: string; budgetDate: string; currency: string;
  director: string; producer: string; preparedBy: string; notes: string;
  scriptDate: string; startDate: string; endDate: string; post: string; productionCompany: string;
  issuedOn: (date: string, time: string) => string;
  dateLocale: string;
  total: string; grandTotal: string; subtotalFallback: string;
  totalChapter: (code: string) => string;
  detailHeaders: { code: string; desc: string; qty: string; unit: string; mult: string; rate: string; subtotal: string; total: string };
  receivedDefaultLabel: string;
}
const PDF_I18N: Record<PdfLanguage, PdfI18n> = {
  es: {
    format: "Formato", episodesUnit: "capítulos", perEpisode: "por capítulo",
    version: "Versión #", budgetDate: "Fecha presupuesto", currency: "Moneda",
    director: "Dirección", producer: "Producción", preparedBy: "Preparado por", notes: "Notas",
    scriptDate: "Guion fechado", startDate: "Inicio rodaje", endDate: "Fin rodaje", post: "Postproducción", productionCompany: "Productora",
    issuedOn: (date, time) => `Emitido el ${date} a las ${time}`,
    dateLocale: "es-ES",
    total: "Total", grandTotal: "TOTAL PRESUPUESTO", subtotalFallback: "Subtotal",
    totalChapter: (code) => `Total capítulo ${code}`,
    detailHeaders: { code: "ACCT #", desc: "DESCRIPCIÓN", qty: "CANT.", unit: "UNIDAD", mult: "X", rate: "TARIFA", subtotal: "SUBTOTAL", total: "TOTAL" },
    receivedDefaultLabel: "Redirigido desde otras cuentas",
  },
  en: {
    format: "Format", episodesUnit: "episodes", perEpisode: "per episode",
    version: "Version #", budgetDate: "Budget date", currency: "Currency",
    director: "Director", producer: "Producer", preparedBy: "Prepared by", notes: "Notes",
    scriptDate: "Script dated", startDate: "Start date", endDate: "End date", post: "Post", productionCompany: "Production Company",
    issuedOn: (date, time) => `Issued on ${date} at ${time}`,
    dateLocale: "en-US",
    total: "Total", grandTotal: "TOTAL BUDGET", subtotalFallback: "Subtotal",
    totalChapter: (code) => `Chapter ${code} total`,
    detailHeaders: { code: "ACCT #", desc: "DESCRIPTION", qty: "QTY.", unit: "UNIT", mult: "X", rate: "RATE", subtotal: "SUBTOTAL", total: "TOTAL" },
    receivedDefaultLabel: "Redirected from other accounts",
  },
};
/** "Película"/"Serie" son valores de una lista fija (no texto libre), así que también se traducen; cualquier otro valor (datos antiguos) se deja tal cual. */
const FORMAT_VALUE_I18N: Record<PdfLanguage, Record<string, string>> = {
  es: { Película: "Película", Serie: "Serie" },
  en: { Película: "Movie", Serie: "Series" },
};

interface GCol { x: number; width: number; align: "left" | "right"; }

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Construye el PDF sin disparar la descarga (adjuntos, previews, tests...). `downloadBudgetPdf` es un envoltorio fino que llama a `.save()`. */
export function buildBudgetPdf(p: BudgetReportParams): FilmaPDF {
  const cfg = p.exportConfig || DEFAULT_EXPORT_CONFIG;
  const F = PDF_FONT_SIZES[cfg.pdfFontSize || "normal"];
  const t = PDF_I18N[cfg.pdfLanguage || "es"];
  const fringes = p.fringes || [];
  const fringeFolders = p.fringeFolders || [];
  const info = p.projectInfo || {};
  const doc = new FilmaPDF({ accent: "budgeting", docRef: info.title || p.draftName, footerBrand: "FW Budgeting" });
  doc.y = doc.margin;

  const left = doc.margin;
  const right = doc.pageW - doc.margin;
  const fmt = (n: number) => fmtCurrency(n, p.currency);

  const breakIfNeeded = (need: number) => {
    if (doc.y + need > doc.pageH - 22) { doc.pdf.addPage(); doc.y = doc.margin; }
  };
  const rule = (color: RGB = RULE_LIGHT, w = 0.2) => {
    doc.pdf.setDrawColor(color[0], color[1], color[2]);
    doc.pdf.setLineWidth(w);
    doc.pdf.line(left, doc.y, right, doc.y);
  };
  const text = (str: string, x: number, opts: { align?: "left" | "right"; bold?: boolean; size?: number; color?: RGB } = {}) => {
    doc.pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.pdf.setFontSize(opts.size ?? F.body);
    const c = opts.color ?? INK;
    doc.pdf.setTextColor(c[0], c[1], c[2]);
    doc.pdf.text(str, x, doc.y, { align: opts.align || "left" });
  };
  const startPage = () => { doc.pdf.addPage(); doc.y = doc.margin; };

  // ─── Fila de tabla: dibuja el texto de cada columna y sus bordes (línea
  // inferior + verticales en cada límite de columna), sin relleno de color ni
  // cabecera de columna: la tabla es continua, con un único borde superior al
  // empezar la sección (y al reabrirse tras un salto de página).
  // `size` es en puntos (tamaño de letra) pero las coordenadas del PDF están
  // en milímetros: hay que convertir, si no la fila sale altísima y vacía. ──
  const ptToMm = (pt: number) => pt * 0.3528;
  const rowHeight = (size: number) => ptToMm(size) + 2.8;
  type RowOpts = { bold?: boolean; size: number; color?: RGB; fill?: RGB };
  const gridRow = (cols: GCol[], values: string[], opts: RowOpts) => {
    const rh = rowHeight(opts.size);
    const y0 = doc.y;
    const y1 = y0 + rh;
    if (opts.fill) {
      doc.pdf.setFillColor(opts.fill[0], opts.fill[1], opts.fill[2]);
      doc.pdf.rect(left, y0, right - left, rh, "F");
    }
    doc.pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.pdf.setFontSize(opts.size);
    const c = opts.color ?? INK;
    doc.pdf.setTextColor(c[0], c[1], c[2]);
    cols.forEach((col, i) => {
      const v = values[i];
      if (!v) return;
      const tx = col.align === "right" ? col.x + col.width - 2 : col.x + 2;
      doc.pdf.text(v, tx, y1 - 1.8, { align: col.align });
    });
    doc.pdf.setDrawColor(RULE_LIGHT[0], RULE_LIGHT[1], RULE_LIGHT[2]);
    doc.pdf.setLineWidth(0.15);
    doc.pdf.line(left, y1, right, y1);
    const xs = [left, ...cols.slice(1).map((c2) => c2.x), right];
    xs.forEach((x) => doc.pdf.line(x, y0, x, y1));
    doc.y = y1;
  };
  /** Fila de texto/subtotal: la descripción ocupa toda la fila (sin divisiones internas), con su propio color/negrita; el importe (si lo hay, en un subtotal) va en la última columna. */
  const textRow = (cols: GCol[], description: string, amountText: string | undefined, opts: { bold: boolean; size: number; color: RGB }) => {
    const rh = rowHeight(opts.size);
    const y0 = doc.y;
    const y1 = y0 + rh;
    doc.pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.pdf.setFontSize(opts.size);
    doc.pdf.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    doc.pdf.text(description || "", left + 2, y1 - 1.8);
    if (amountText) {
      const amtCol = cols[cols.length - 1];
      doc.pdf.text(amountText, amtCol.x + amtCol.width - 2, y1 - 1.8, { align: "right" });
    }
    doc.pdf.setDrawColor(RULE_LIGHT[0], RULE_LIGHT[1], RULE_LIGHT[2]);
    doc.pdf.setLineWidth(0.15);
    doc.pdf.line(left, y1, right, y1);
    doc.pdf.line(left, y0, left, y1);
    doc.pdf.line(right, y0, right, y1);
    doc.y = y1;
  };
  const tableTop = () => {
    doc.pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.pdf.setLineWidth(0.3);
    doc.pdf.line(left, doc.y, right, doc.y);
  };
  /** Nueva página que continúa la misma tabla: repone el borde superior, sin repetir ninguna cabecera. */
  const continueTable = () => { startPage(); pageTitle(); tableTop(); };
  /** Fila de datos con salto de página automático. */
  const dataRow = (cols: GCol[], values: string[], opts: RowOpts) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) continueTable();
    gridRow(cols, values, opts);
  };
  const dataTextRow = (cols: GCol[], description: string, amountText: string | undefined, opts: { bold: boolean; size: number; color: RGB }) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) continueTable();
    textRow(cols, description, amountText, opts);
  };

  // Misma fórmula de fringe que en pantalla (ver lib/budgeting.ts).
  const fringeAmount = (f: BudgetingFringe, line: { total: number; units: number }) =>
    f.type === "percent" ? (line.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (line.units || 0);
  const fringeBreakdownFor = (subIds: string[], scope: "subchapter" | "chapter" | "total") => {
    const sums = new Map<string, number>();
    for (const subId of subIds) {
      for (const l of p.linesBySubchapter[subId] || []) {
        if (l.isTextLine || l.isSubtotal) continue;
        for (const id of l.fringeIds || []) {
          const f = fringes.find((fr) => fr.id === id);
          if (!f || f.scope !== scope) continue;
          sums.set(f.id, (sums.get(f.id) || 0) + fringeAmount(f, l));
        }
      }
    }
    return groupFringeSumsByFolder(sums, fringes, fringeFolders);
  };
  // Una línea redirigida ("excl.") no cuenta en su subcapítulo físico, cuenta
  // en el destino (denormalizado en receivedTotal), igual que en pantalla.
  const ownLinesTotal = (lines: ReportLine[]) =>
    Math.round(lines.filter((l) => !l.routedTo).reduce((s, l) => s + (l.total || 0), 0) * 100) / 100;
  const subTotal = (sub: ReportSubchapter, lines: ReportLine[], subFringes: number) =>
    Math.round((ownLinesTotal(lines) + (sub.receivedTotal || 0) + subFringes) * 100) / 100;
  /** Suma hacia atrás desde una fila de subtotal hasta el subtotal anterior (o el principio), igual que en pantalla. */
  const subtotalSince = <T extends { id: string; isTextLine?: boolean; isSubtotal?: boolean }>(
    items: T[], subtotalId: string, amounts: Map<string, number>,
  ): number => {
    const idx = items.findIndex((i) => i.id === subtotalId);
    if (idx < 0) return 0;
    let sum = 0;
    for (let i = idx - 1; i >= 0; i--) {
      const it = items[i];
      if (it.isSubtotal) break;
      if (!it.isTextLine) sum += amounts.get(it.id) || 0;
    }
    return Math.round(sum * 100) / 100;
  };

  const cats = p.categoriesEnabled ? p.categories : [{ id: "all", label: "Presupuesto" } as BudgetingCategoryDef];
  const allSubIds = Object.values(p.subchaptersByChapter).flat().filter((s) => !s.isTextLine && !s.isSubtotal).map((s) => s.id);

  // Total de cada capítulo real, precalculado una vez y compartido por el Top
  // Sheet y el Detalle, para que un subtotal de capítulo sume lo mismo en
  // ambas secciones.
  const chapterTotalMap = new Map<string, number>();
  cats.forEach((cat) => {
    p.chaptersByCategory(p.categoriesEnabled ? cat.id : null).forEach((chapter) => {
      if (chapter.isTextLine || chapter.isSubtotal) return;
      const subs = (p.subchaptersByChapter[chapter.id] || []).filter((s) => !s.isTextLine && !s.isSubtotal);
      const chapterFringeSum = fringeBreakdownFor(subs.map((s) => s.id), "chapter").reduce((s, b) => s + b.amount, 0);
      const chapterSum = Math.round((subs.reduce((s, sub) => {
        const lines = (p.linesBySubchapter[sub.id] || []).filter((l) => !l.isTextLine && !l.isSubtotal);
        const subFringes = fringeBreakdownFor([sub.id], "subchapter").reduce((s2, b) => s2 + b.amount, 0);
        return s + subTotal(sub, lines, subFringes);
      }, 0) + chapterFringeSum) * 100) / 100;
      chapterTotalMap.set(chapter.id, chapterSum);
    });
  });

  // ─── Portada: título como "pastilla" de acento y datos de producción en
  // dos columnas —Producción/Dirección/Guion fechado/Fecha presupuesto a la
  // izquierda, Inicio/Fin de rodaje/Postproducción a la derecha, con la
  // fecha de presupuesto resaltada como otra pastilla— inspirado en el
  // mockup de referencia (etiquetas en mayúscula, fecha destacada), con el
  // acento propio de Budgeting en vez de azul. El resto —formato/duración,
  // versión, moneda, preparado por, notas— va debajo, en bloques de
  // siempre. El resto del documento siempre arranca en una página nueva. ──
  const writeLine = (str: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? F.body;
    breakIfNeeded(ptToMm(size) + 6);
    text(str, left, { size, bold: !!opts.bold });
    doc.y += ptToMm(size) + 4;
  };
  const blockGap = () => { doc.y += ptToMm(F.body) * 1.6; };

  // Tinte muy claro del acento para el fondo de las pastillas, calculado
  // aquí en RGB (mismo criterio que BUDGETING_TINT en pantalla, que es CSS).
  const accent = doc.accentColor;
  const accentTint: RGB = [
    Math.round(accent[0] * 0.14 + 255 * 0.86),
    Math.round(accent[1] * 0.14 + 255 * 0.86),
    Math.round(accent[2] * 0.14 + 255 * 0.86),
  ];
  /** "Pastilla" de acento con texto (título, o un valor destacado como la fecha de presupuesto). `y` es la línea base del texto, igual que `text()`. Devuelve su ancho. */
  const pill = (str: string, x: number, y: number, size: number): number => {
    doc.pdf.setFont("helvetica", "bold");
    doc.pdf.setFontSize(size);
    const padX = 2.6, padY = 1.4;
    const w = doc.pdf.getTextWidth(str) + padX * 2;
    const h = ptToMm(size) + padY * 2;
    doc.pdf.setFillColor(accentTint[0], accentTint[1], accentTint[2]);
    doc.pdf.roundedRect(x, y - ptToMm(size) - padY + 0.3, w, h, h / 2, h / 2, "F");
    doc.pdf.setTextColor(INK[0], INK[1], INK[2]);
    doc.pdf.text(str, x + padX, y);
    return w;
  };

  /** Misma pastilla del título, en miniatura, repetida al principio de cada página que no es la portada (Top Sheet, Detalle, y cada salto de página dentro de ambos). */
  const pageTitle = () => {
    doc.y = doc.margin + ptToMm(F.label);
    pill(info.title || p.draftName, left, doc.y, F.label);
    doc.y += ptToMm(F.label) + 4.5;
  };

  // Portada, Top Sheet y Detalle son tres "reportes" independientes (ver
  // BudgetingReportsModal): cada uno se incluye o no en el PDF por
  // separado. `openSection` decide si la página 1 (que jsPDF ya crea sola)
  // vale para el primer reporte que toque, o si hace falta saltar de
  // página — y si a ese reporte le toca el título grande de portada (solo
  // el primero, y solo si es la propia Portada) o la pastilla en miniatura
  // repetida (Top Sheet/Detalle, y cualquiera que no sea el primero).
  let started = false;
  const openSection = (needsMiniTitle: boolean) => {
    if (started) { startPage(); if (needsMiniTitle) pageTitle(); }
    else { started = true; if (needsMiniTitle) pageTitle(); }
  };

  if (cfg.includeCoverSheet) {
    openSection(false);
    const titleSize = F.title * 0.55;
    breakIfNeeded(ptToMm(titleSize) + 10);
    doc.y += ptToMm(titleSize);
    pill(info.title || p.draftName, left, doc.y, titleSize);
    doc.y += ptToMm(F.label) * 4.2;

    // Dos columnas: cada fila es "Etiqueta: valor" (sin mayúsculas forzadas,
  // tal cual vienen los textos del idioma elegido); los campos sin rellenar
  // no salen (ni la etiqueta), para no dejar huecos vacíos en la portada.
  const budgetDateValue = info.dateLabel || new Intl.DateTimeFormat(t.dateLocale, { day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const leftFieldRows: { label: string; value: string }[] = [
    { label: t.productionCompany, value: info.productionCompany || "" },
    { label: t.director, value: info.director || "" },
    { label: t.scriptDate, value: info.scriptDate || "" },
    { label: t.budgetDate, value: budgetDateValue },
  ];
  const rightFieldRows: { label: string; value: string }[] = [
    { label: t.startDate, value: info.startDate || "" },
    { label: t.endDate, value: info.endDate || "" },
    { label: t.post, value: info.post || "" },
  ];
  const fieldColumn = (x: number, rows: { label: string; value: string }[]) => {
    const rh = ptToMm(F.label) + 4.4;
    let y = doc.y;
    rows.filter((row) => row.value).forEach((row) => {
      doc.y = y;
      text(`${row.label}:`, x, { bold: true, size: F.label });
      doc.pdf.setFont("helvetica", "bold");
      doc.pdf.setFontSize(F.label);
      const labelW = doc.pdf.getTextWidth(`${row.label}: `);
      text(row.value, x + labelW, { size: F.label });
      y += rh;
    });
    return y;
  };
  const colGap = 10;
  const colWidth = (right - left - colGap) / 2;
  const yAfterLeft = fieldColumn(left, leftFieldRows);
  const yAfterRight = fieldColumn(left + colWidth + colGap, rightFieldRows);
  doc.y = Math.max(yAfterLeft, yAfterRight);
  blockGap();

  if (info.format) {
    const formatValue = FORMAT_VALUE_I18N[cfg.pdfLanguage || "es"][info.format] ?? info.format;
    writeLine(`${t.format}: ${formatValue}`);
    if (info.format === "Serie") {
      const bits: string[] = [];
      if (info.episodeCount) bits.push(`${info.episodeCount} ${t.episodesUnit}`);
      if (info.episodeDuration) bits.push(`${info.episodeDuration} ${t.perEpisode}`);
      if (bits.length > 0) writeLine(bits.join(" · "));
    } else if (info.format === "Película" && info.filmDuration) {
      writeLine(info.filmDuration);
    }
    blockGap();
  }

  if (info.version) writeLine(`${t.version}: ${info.version}`);
  writeLine(`${t.currency}: ${p.currency}`);
  blockGap();

  if (info.preparedBy) {
    writeLine(`${t.preparedBy}: ${info.preparedBy}`);
    blockGap();
  }

  if (info.notes) {
    info.notes.split("\n").forEach((line) => writeLine(line || " "));
    blockGap();
  }

  // Sello de emisión, anclado al fondo de la última página de la portada
  // (si el contenido de arriba ya llega tan abajo, sigue justo debajo en
  // vez de superponerse). pageH-16 es justo la línea del pie de página
  // compartido (ver FilmaPDF.finish()): hay que quedarse claramente por
  // encima, no pegado a ella.
  const now = new Date();
  const issuedDate = new Intl.DateTimeFormat(t.dateLocale, { day: "2-digit", month: "long", year: "numeric" }).format(now);
  const issuedTime = new Intl.DateTimeFormat(t.dateLocale, { hour: "2-digit", minute: "2-digit" }).format(now);
  const issuedY = doc.pageH - 22;
  doc.y = doc.y < issuedY ? issuedY : doc.y + 4;
  text(t.issuedOn(issuedDate, issuedTime), left, { size: Math.max(6, F.body - 1), color: MUTED });
  }

  // ─── Top Sheet: tabla única (capítulos por categoría), sin cabecera de
  // columna. Reporte independiente de la Portada (ver BudgetingReportsModal). ──
  if (cfg.includeTopSheet) {
    openSection(true);
    const topCols: GCol[] = (() => {
      const codeW = 24, amtW = 42;
      return [
        { x: left, width: codeW, align: "left" },
        { x: left + codeW, width: (right - left) - codeW - amtW, align: "left" },
        { x: right - amtW, width: amtW, align: "right" },
      ];
    })();
    tableTop();

    cats.forEach((cat) => {
      const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
      if (chapters.length === 0) return;
      if (p.categoriesEnabled) dataRow(topCols, ["", cat.label.toUpperCase(), ""], { bold: true, size: F.body, color: MUTED, fill: CATEGORY_BG });
      let catSum = 0;
      chapters.forEach((chapter) => {
        if (chapter.isTextLine) {
          dataTextRow(topCols, chapter.description, undefined, { bold: !!chapter.textBold, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        if (chapter.isSubtotal) {
          const amt = subtotalSince(chapters, chapter.id, chapterTotalMap);
          dataTextRow(topCols, chapter.description || t.subtotalFallback, fmt(amt), { bold: true, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        const chapterSum = chapterTotalMap.get(chapter.id) || 0;
        catSum += chapterSum;
        dataRow(topCols, [chapter.code, chapter.description, fmt(chapterSum)], { size: F.body });
      });
      if (p.categoriesEnabled) {
        dataRow(topCols, ["", `${t.total} ${cat.label}`, fmt(catSum)], { bold: true, size: F.body });
      }
    });

    const totalFringes = fringeBreakdownFor(allSubIds, "total");
    totalFringes.forEach(({ code, label, amount }) => {
      dataRow(topCols, [code, label, fmt(amount)], { size: F.body, color: MUTED });
    });

    doc.y += 1;
    breakIfNeeded(rowHeight(F.total) + 4);
    rule(INK, 0.5);
    dataRow(topCols, ["", t.grandTotal, fmt(p.grandTotal)], { bold: true, size: F.total, fill: TOTAL_BG });
    doc.y += 4;
  }

  // ─── Detalle: al estilo Movie Magic Budgeting (ver mockup del usuario) —
  // Acct#/Descripción/Cant./Unidad/X/Tarifa/Subtotal/Total, con una cabecera
  // de columna oscura que se repite delante de cada capítulo (no una sola
  // vez para toda la tabla). El valor de cada línea va en "Subtotal"; la
  // columna "Total" solo se rellena en las filas de cierre (TOTAL de la
  // Cuenta, Total del capítulo). Capítulos y Cuentas son filas en negrita
  // dentro de la propia tabla, no títulos aparte. Reporte independiente de
  // la Portada y el Top Sheet (ver BudgetingReportsModal). ──────────────────
  if (cfg.includeDetail) {
  openSection(true);
  type DetailKey = "code" | "desc" | "qty" | "unit" | "mult" | "rate" | "subtotal" | "total";
  const detailKeys: DetailKey[] = (() => {
    const list: DetailKey[] = ["code", "desc", "qty"];
    if (cfg.fields.unit) list.push("unit");
    list.push("mult", "rate", "subtotal", "total");
    return list;
  })();
  const detailWidths: Record<DetailKey, number> = { code: 16, desc: 0, qty: 13, unit: 14, mult: 8, rate: 20, subtotal: 22, total: 22 };
  const detailAligns: Record<DetailKey, "left" | "right"> = { code: "left", desc: "left", qty: "right", unit: "left", mult: "right", rate: "right", subtotal: "right", total: "right" };
  const detailLabels: Record<DetailKey, string> = t.detailHeaders;
  const detailFixedWidth = detailKeys.filter((k) => k !== "desc").reduce((s, k) => s + detailWidths[k], 0);
  detailWidths.desc = (right - left) - detailFixedWidth;
  const detailCols: GCol[] = (() => {
    let x = left;
    return detailKeys.map((k) => {
      const c: GCol = { x, width: detailWidths[k], align: detailAligns[k] };
      x += detailWidths[k];
      return c;
    });
  })();
  const detailRowValues = (row: Partial<Record<DetailKey, string>>) => detailKeys.map((k) => row[k] || "");

  // Cabecera de columna clara (ACCT#/DESCRIPCIÓN/.../TOTAL), no sombreada en
  // negro: aparece una sola vez por página (al empezar el Detalle, o al
  // reabrirse la tabla tras un salto de página), no delante de cada
  // capítulo — entre capítulos de una misma página va un separador fino
  // (ver chapterSeparator), no la cabecera entera. Texto algo más pequeño
  // que el resto de la tabla, para que pese menos visualmente.
  const headerFontSize = Math.max(6, F.label - 1);
  const detailHeaderRow = () => {
    const rh = rowHeight(headerFontSize);
    breakIfNeeded(rh + rowHeight(F.body));
    const y0 = doc.y;
    const y1 = y0 + rh;
    doc.pdf.setFillColor(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2]);
    doc.pdf.rect(left, y0, right - left, rh, "F");
    doc.pdf.setFont("helvetica", "bold");
    doc.pdf.setFontSize(headerFontSize);
    doc.pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    detailCols.forEach((col, i) => {
      const tx = col.align === "right" ? col.x + col.width - 2 : col.x + 2;
      doc.pdf.text(detailLabels[detailKeys[i]], tx, y1 - 1.8, { align: col.align });
    });
    doc.y = y1;
  };
  /** Nueva página que continúa el Detalle: repone la cabecera de columna, no solo el borde. */
  const detailContinueTable = () => { startPage(); pageTitle(); detailHeaderRow(); };
  /** Separador fino entre capítulos de una misma página, en vez de repetir la cabecera de columna entera. */
  const chapterSeparator = () => {
    breakIfNeeded(rowHeight(F.body) * 2);
    doc.y += 2;
    doc.pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.pdf.setLineWidth(0.5);
    doc.pdf.line(left, doc.y, right, doc.y);
    doc.y += 2;
  };
  const detailDataRow = (values: string[], opts: RowOpts) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) detailContinueTable();
    gridRow(detailCols, values, opts);
  };
  const detailDataTextRow = (description: string, amountText: string | undefined, opts: { bold: boolean; size: number; color: RGB }) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) detailContinueTable();
    textRow(detailCols, description, amountText, opts);
  };

  // La cabecera de columna aparece una sola vez por página, no delante de
  // cada capítulo: se dibuja al abrir la tabla (con la primera fila real,
  // sea de categoría o de capítulo) y de nuevo solo cuando toca página
  // nueva (salto automático por desbordar, o forzado por
  // `pageBreakPerChapter`). Entre capítulos de una misma página va un
  // separador fino (chapterSeparator), no la cabecera entera repetida.
  let tableOpened = false;
  let firstRealChapter = true;
  cats.forEach((cat) => {
    const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
    if (chapters.length === 0) return;
    if (p.categoriesEnabled) {
      if (!tableOpened) { detailHeaderRow(); tableOpened = true; }
      else chapterSeparator();
      detailDataRow(detailRowValues({ desc: cat.label.toUpperCase() }), { bold: true, size: F.body, color: MUTED, fill: CATEGORY_BG });
    }
    chapters.forEach((chapter) => {
      if (chapter.isTextLine) {
        detailDataTextRow(chapter.description, undefined, { bold: !!chapter.textBold, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
        return;
      }
      if (chapter.isSubtotal) {
        const amt = subtotalSince(chapters, chapter.id, chapterTotalMap);
        detailDataTextRow(chapter.description || t.subtotalFallback, fmt(amt), { bold: true, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
        return;
      }
      const subs = p.subchaptersByChapter[chapter.id] || [];
      if (subs.length === 0) return;

      if (!tableOpened) {
        detailHeaderRow();
        tableOpened = true;
      } else if (firstRealChapter) {
        // La tabla ya está abierta (p.ej. por la fila de categoría), pero
        // este es el primer capítulo real: ni separador ni salto forzado.
      } else if (cfg.pageBreakPerChapter) {
        startPage();
        pageTitle();
        detailHeaderRow();
      } else {
        chapterSeparator();
      }
      firstRealChapter = false;

      detailDataRow(detailRowValues({ code: chapter.code, desc: chapter.description }), { bold: true, size: F.body });

      let chapterSum = 0;
      const subTotals = new Map<string, number>();
      subs.forEach((sub) => {
        if (sub.isTextLine) {
          detailDataTextRow(sub.description, undefined, { bold: !!sub.textBold, size: F.body, color: hexToRgb(sub.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        if (sub.isSubtotal) {
          const amt = subtotalSince(subs, sub.id, subTotals);
          detailDataTextRow(sub.description || t.subtotalFallback, fmt(amt), { bold: true, size: F.body, color: hexToRgb(sub.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        const allLines = p.linesBySubchapter[sub.id] || [];
        const subFringes = fringeBreakdownFor([sub.id], "subchapter");
        if (allLines.length === 0 && subFringes.length === 0 && !(sub.receivedTotal || 0)) return;

        // El total se calcula siempre (para que el subtotal del capítulo
        // cuadre), pero solo se dibujan las filas de esta Cuenta si no está
        // oculta por `hideZeroTotalSubchapters` (config de exportación).
        const realLines = allLines.filter((l) => !l.isTextLine && !l.isSubtotal);
        const subFringeSum = subFringes.reduce((s, b) => s + b.amount, 0);
        const subSum = subTotal(sub, realLines, subFringeSum);
        subTotals.set(sub.id, subSum);
        chapterSum += subSum;
        if (cfg.hideZeroTotalSubchapters && subSum === 0) return;

        detailDataRow(detailRowValues({ code: sub.code, desc: sub.description }), { bold: true, size: F.body });

        const lineTotals = new Map<string, number>();
        allLines.forEach((l) => {
          if (l.isTextLine) {
            detailDataTextRow(l.description, undefined, { bold: !!l.textBold, size: F.body, color: hexToRgb(l.textColor || DEFAULT_TEXT_LINE_COLOR) });
            return;
          }
          if (l.isSubtotal) {
            const amt = subtotalSince(allLines, l.id, lineTotals);
            detailDataTextRow(l.description || t.subtotalFallback, fmt(amt), { bold: true, size: F.body, color: hexToRgb(l.textColor || DEFAULT_TEXT_LINE_COLOR) });
            return;
          }
          lineTotals.set(l.id, l.total || 0);
          detailDataRow(detailRowValues({
            desc: l.description, qty: String(l.units),
            unit: pluralizeUnit(l.unit, l.units, p.units || []), mult: String(l.multiplier), rate: fmt(l.rate), subtotal: fmt(l.total),
          }), { size: F.body, color: l.routedTo ? MUTED : INK });
        });
        subFringes.forEach(({ code, label, amount }) => {
          detailDataRow(detailRowValues({ desc: `${code} ${label}`, subtotal: fmt(amount) }), { size: F.body, color: MUTED });
        });
        if ((sub.receivedTotal || 0) > 0) {
          const code = sub.receivedCode || "";
          const label = sub.receivedLabel || t.receivedDefaultLabel;
          detailDataRow(detailRowValues({ desc: code ? `${code} ${label}` : label, subtotal: fmt(sub.receivedTotal || 0) }), { size: F.body, color: MUTED });
        }

        detailDataRow(detailRowValues({ desc: t.total.toUpperCase(), total: fmt(subSum) }), { bold: true, size: F.body });
      });

      const realSubs = subs.filter((s) => !s.isTextLine && !s.isSubtotal);
      const chapterFringes = fringeBreakdownFor(realSubs.map((s) => s.id), "chapter");
      chapterFringes.forEach(({ code, label, amount }) => {
        detailDataRow(detailRowValues({ desc: `${code} ${label}`, subtotal: fmt(amount) }), { size: F.body, color: MUTED });
      });
      chapterSum += chapterFringes.reduce((s, b) => s + b.amount, 0);

      detailDataRow(detailRowValues({ desc: t.totalChapter(chapter.code), total: fmt(chapterSum) }), { bold: true, size: F.body });
    });
  });

  doc.y += 1;
  breakIfNeeded(rowHeight(F.total) + 4);
  rule(INK, 0.5);
  detailDataRow(detailRowValues({ desc: t.grandTotal, total: fmt(p.grandTotal) }), { bold: true, size: F.total, fill: TOTAL_BG });
  }

  return doc;
}

export function downloadBudgetPdf(p: BudgetReportParams) {
  const doc = buildBudgetPdf(p);
  doc.save(`${p.draftName.replace(/[^\w\-]+/g, "_")}.pdf`);
}
