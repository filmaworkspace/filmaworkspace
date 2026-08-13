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
import { BUDGETING_TEXT, BudgetingCategoryDef, BudgetingExportConfig, BudgetingFringe, BudgetingProjectInfo, DEFAULT_EXPORT_CONFIG, DEFAULT_TEXT_LINE_COLOR, PDF_FONT_SIZES, fmtCurrency } from "./budgeting";

// Las líneas de texto/subtotal (isTextLine/isSubtotal) son opcionales en las
// tres interfaces: el Excel/.fwb las sigue excluyendo (reportParams las
// filtra antes de llegar aquí), pero el PDF las incluye y las pinta con su
// negrita/color, igual que en pantalla.
interface ReportChapter { id: string; code: string; description: string; isTextLine?: boolean; isSubtotal?: boolean; textBold?: boolean; textColor?: string | null; }
interface ReportSubchapter { id: string; code: string; description: string; receivedTotal?: number; isTextLine?: boolean; isSubtotal?: boolean; textBold?: boolean; textColor?: string | null; }
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
          if (cfg.fields.unit) row.push(line.unit);
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
  const fringes = p.fringes || [];
  const info = p.projectInfo || {};
  const doc = new FilmaPDF({ accent: "budgeting", docRef: p.draftName, footerBrand: "Filma Workspace Budgeting · filmaworkspace.com" });
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
  const gridRow = (cols: GCol[], values: string[], opts: { bold?: boolean; size: number; color?: RGB }) => {
    const rh = rowHeight(opts.size);
    const y0 = doc.y;
    const y1 = y0 + rh;
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
  const continueTable = () => { startPage(); tableTop(); };
  /** Fila de datos con salto de página automático. */
  const dataRow = (cols: GCol[], values: string[], opts: { bold?: boolean; size: number; color?: RGB }) => {
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
    return fringes.filter((f) => sums.has(f.id)).map((f) => ({ fringe: f, amount: Math.round((sums.get(f.id) || 0) * 100) / 100 }));
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

  // ─── Portada: solo los datos de producción, sin ninguna tabla ni total.
  // Diseño calcado del mockup del usuario: una sola columna, título y
  // formato sueltos (sin etiqueta), luego créditos, "Datos del
  // presupuesto" y fecha/moneda/preparado por como bloques con su propio
  // hueco, cada línea de un bloque pegada a la siguiente. El resto del
  // documento siempre arranca en una página nueva. ──────────────────────────
  const writeLine = (str: string, opts: { bold?: boolean; size?: number } = {}) => {
    const size = opts.size ?? F.body;
    breakIfNeeded(ptToMm(size) + 6);
    text(str, left, { size, bold: !!opts.bold });
    doc.y += ptToMm(size) + 4;
  };
  const blockGap = () => { doc.y += ptToMm(F.body) * 1.6; };

  writeLine(info.title || p.draftName, { bold: true, size: F.title });
  blockGap();

  if (info.format) {
    writeLine(info.format);
    blockGap();
  }

  const credits: [string, string][] = [];
  if (info.productionCompany) credits.push(["Productora", info.productionCompany]);
  if (info.director) credits.push(["Dirección", info.director]);
  if (info.producer) credits.push(["Producción", info.producer]);
  if (credits.length > 0) {
    credits.forEach(([label, value]) => writeLine(`${label}: ${value}`));
    blockGap();
  }

  writeLine("Datos del presupuesto", { bold: true });
  doc.y += ptToMm(F.body) * 0.5;
  writeLine(`Fecha: ${info.dateLabel || new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}`);
  writeLine(`Moneda: ${p.currency}`);

  if (info.preparedBy) {
    blockGap();
    writeLine(`Preparado por: ${info.preparedBy}`);
  }

  startPage();

  // ─── Top Sheet: tabla única (capítulos por categoría), sin cabecera de
  // columna. Opcional: toggle "Top Sheet (portada)" de la configuración de
  // exportación. ─────────────────────────────────────────────────────────────
  if (cfg.coverSheet) {
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
      if (p.categoriesEnabled) dataRow(topCols, ["", cat.label.toUpperCase(), ""], { bold: true, size: F.body, color: MUTED });
      let catSum = 0;
      chapters.forEach((chapter) => {
        if (chapter.isTextLine) {
          dataTextRow(topCols, chapter.description, undefined, { bold: !!chapter.textBold, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        if (chapter.isSubtotal) {
          const amt = subtotalSince(chapters, chapter.id, chapterTotalMap);
          dataTextRow(topCols, chapter.description || "Subtotal", fmt(amt), { bold: true, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        const chapterSum = chapterTotalMap.get(chapter.id) || 0;
        catSum += chapterSum;
        dataRow(topCols, [chapter.code, chapter.description, fmt(chapterSum)], { size: F.body });
      });
      if (p.categoriesEnabled) {
        dataRow(topCols, ["", `Total ${cat.label}`, fmt(catSum)], { bold: true, size: F.body });
      }
    });

    const totalFringes = fringeBreakdownFor(allSubIds, "total");
    totalFringes.forEach(({ fringe, amount }) => {
      dataRow(topCols, [fringe.code, fringe.label, fmt(amount)], { size: F.body, color: MUTED });
    });

    doc.y += 2;
    breakIfNeeded(F.total + 8);
    rule(INK, 0.5);
    doc.y += F.total * 0.55 + 3;
    text("TOTAL PRESUPUESTO", left, { bold: true, size: F.total });
    text(fmt(p.grandTotal), right, { bold: true, size: F.total, align: "right" });
    doc.y += 6;

    startPage();
  }

  // ─── Detalle: al estilo Movie Magic Budgeting (ver mockup del usuario) —
  // Acct#/Descripción/Cant./Unidad/X/Tarifa/Subtotal/Total, con una cabecera
  // de columna oscura que se repite delante de cada capítulo (no una sola
  // vez para toda la tabla). El valor de cada línea va en "Subtotal"; la
  // columna "Total" solo se rellena en las filas de cierre (TOTAL de la
  // Cuenta, Total del capítulo). Capítulos y Cuentas son filas en negrita
  // dentro de la propia tabla, no títulos aparte. ───────────────────────────
  type DetailKey = "code" | "desc" | "qty" | "unit" | "mult" | "rate" | "subtotal" | "total";
  const detailKeys: DetailKey[] = (() => {
    const list: DetailKey[] = ["code", "desc", "qty"];
    if (cfg.fields.unit) list.push("unit");
    list.push("mult", "rate", "subtotal", "total");
    return list;
  })();
  const detailWidths: Record<DetailKey, number> = { code: 16, desc: 0, qty: 13, unit: 14, mult: 8, rate: 20, subtotal: 22, total: 22 };
  const detailAligns: Record<DetailKey, "left" | "right"> = { code: "left", desc: "left", qty: "right", unit: "left", mult: "right", rate: "right", subtotal: "right", total: "right" };
  const detailLabels: Record<DetailKey, string> = { code: "ACCT #", desc: "DESCRIPCIÓN", qty: "CANT.", unit: "UNIDAD", mult: "X", rate: "TARIFA", subtotal: "SUBTOTAL", total: "TOTAL" };
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

  const HEADER_BG = hexToRgb(BUDGETING_TEXT);
  /** Cabecera de columna con fondo oscuro (ACCT#/DESCRIPCIÓN/.../TOTAL), tal cual el mockup: se repite delante de cada capítulo. */
  const detailHeaderRow = () => {
    const rh = rowHeight(F.label);
    breakIfNeeded(rh + rowHeight(F.body));
    const y0 = doc.y;
    const y1 = y0 + rh;
    doc.pdf.setFillColor(HEADER_BG[0], HEADER_BG[1], HEADER_BG[2]);
    doc.pdf.rect(left, y0, right - left, rh, "F");
    doc.pdf.setFont("helvetica", "bold");
    doc.pdf.setFontSize(F.label);
    doc.pdf.setTextColor(255, 255, 255);
    detailCols.forEach((col, i) => {
      const tx = col.align === "right" ? col.x + col.width - 2 : col.x + 2;
      doc.pdf.text(detailLabels[detailKeys[i]], tx, y1 - 1.8, { align: col.align });
    });
    doc.y = y1;
  };
  /** Nueva página que continúa el Detalle: repone la cabecera de columna oscura, no solo el borde. */
  const detailContinueTable = () => { startPage(); detailHeaderRow(); };
  const detailDataRow = (values: string[], opts: { bold?: boolean; size: number; color?: RGB }) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) detailContinueTable();
    gridRow(detailCols, values, opts);
  };
  const detailDataTextRow = (description: string, amountText: string | undefined, opts: { bold: boolean; size: number; color: RGB }) => {
    if (doc.y + rowHeight(opts.size) > doc.pageH - 22) detailContinueTable();
    textRow(detailCols, description, amountText, opts);
  };

  let firstRealChapter = true;
  cats.forEach((cat) => {
    const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
    if (chapters.length === 0) return;
    if (p.categoriesEnabled) {
      breakIfNeeded(rowHeight(F.body) + 6);
      text(cat.label.toUpperCase(), left, { bold: true, size: F.body, color: MUTED });
      doc.y += ptToMm(F.body) + 5;
    }
    chapters.forEach((chapter) => {
      if (chapter.isTextLine) {
        detailDataTextRow(chapter.description, undefined, { bold: !!chapter.textBold, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
        return;
      }
      if (chapter.isSubtotal) {
        const amt = subtotalSince(chapters, chapter.id, chapterTotalMap);
        detailDataTextRow(chapter.description || "Subtotal", fmt(amt), { bold: true, size: F.body, color: hexToRgb(chapter.textColor || DEFAULT_TEXT_LINE_COLOR) });
        return;
      }
      const subs = p.subchaptersByChapter[chapter.id] || [];
      if (subs.length === 0) return;

      // La cabecera de columna se repite delante de cada capítulo (igual que
      // el mockup), con salto de página forzado si está activado, o si no,
      // simplemente un hueco antes del siguiente bloque en la misma página.
      if (!firstRealChapter) {
        if (cfg.pageBreakPerChapter) startPage();
        else { doc.y += 5; breakIfNeeded(rowHeight(F.label) + rowHeight(F.body) * 2); }
      }
      firstRealChapter = false;
      detailHeaderRow();

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
          detailDataTextRow(sub.description || "Subtotal", fmt(amt), { bold: true, size: F.body, color: hexToRgb(sub.textColor || DEFAULT_TEXT_LINE_COLOR) });
          return;
        }
        const allLines = p.linesBySubchapter[sub.id] || [];
        const subFringes = fringeBreakdownFor([sub.id], "subchapter");
        if (allLines.length === 0 && subFringes.length === 0) return;

        detailDataRow(detailRowValues({ code: sub.code, desc: sub.description }), { bold: true, size: F.body });

        const lineTotals = new Map<string, number>();
        allLines.forEach((l) => {
          if (l.isTextLine) {
            detailDataTextRow(l.description, undefined, { bold: !!l.textBold, size: F.body, color: hexToRgb(l.textColor || DEFAULT_TEXT_LINE_COLOR) });
            return;
          }
          if (l.isSubtotal) {
            const amt = subtotalSince(allLines, l.id, lineTotals);
            detailDataTextRow(l.description || "Subtotal", fmt(amt), { bold: true, size: F.body, color: hexToRgb(l.textColor || DEFAULT_TEXT_LINE_COLOR) });
            return;
          }
          lineTotals.set(l.id, l.total || 0);
          detailDataRow(detailRowValues({
            desc: l.description, qty: String(l.units),
            unit: l.unit || "", mult: String(l.multiplier), rate: fmt(l.rate), subtotal: fmt(l.total),
          }), { size: F.body, color: l.routedTo ? MUTED : INK });
        });
        subFringes.forEach(({ fringe, amount }) => {
          detailDataRow(detailRowValues({ desc: `${fringe.code} ${fringe.label}`, subtotal: fmt(amount) }), { size: F.body, color: MUTED });
        });

        const realLines = allLines.filter((l) => !l.isTextLine && !l.isSubtotal);
        const subFringeSum = subFringes.reduce((s, b) => s + b.amount, 0);
        const subSum = subTotal(sub, realLines, subFringeSum);
        subTotals.set(sub.id, subSum);
        chapterSum += subSum;
        detailDataRow(detailRowValues({ desc: "TOTAL", total: fmt(subSum) }), { bold: true, size: F.body });
      });

      const realSubs = subs.filter((s) => !s.isTextLine && !s.isSubtotal);
      const chapterFringes = fringeBreakdownFor(realSubs.map((s) => s.id), "chapter");
      chapterFringes.forEach(({ fringe, amount }) => {
        detailDataRow(detailRowValues({ desc: `${fringe.code} ${fringe.label}`, subtotal: fmt(amount) }), { size: F.body, color: MUTED });
      });
      chapterSum += chapterFringes.reduce((s, b) => s + b.amount, 0);

      detailDataRow(detailRowValues({ desc: `Total capítulo ${chapter.code}`, total: fmt(chapterSum) }), { bold: true, size: F.body });
    });
  });

  doc.y += 2;
  breakIfNeeded(F.total + 8);
  rule(INK, 0.5);
  doc.y += F.total * 0.55 + 3;
  text("TOTAL PRESUPUESTO", left, { bold: true, size: F.total });
  text(fmt(p.grandTotal), right, { bold: true, size: F.total, align: "right" });

  return doc;
}

export function downloadBudgetPdf(p: BudgetReportParams) {
  const doc = buildBudgetPdf(p);
  doc.save(`${p.draftName.replace(/[^\w\-]+/g, "_")}.pdf`);
}
