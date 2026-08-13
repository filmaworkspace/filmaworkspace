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
import { BudgetingCategoryDef, BudgetingExportConfig, BudgetingFringe, BudgetingProjectInfo, DEFAULT_EXPORT_CONFIG, PDF_FONT_SIZES, fmtCurrency } from "./budgeting";

interface ReportChapter { id: string; code: string; description: string; }
interface ReportSubchapter { id: string; code: string; description: string; receivedTotal?: number; }
interface ReportLine {
  code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number;
  notes?: string; tags?: string[]; fringeIds?: string[]; routedTo?: { subchapterCode: string } | null;
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
// sin cabeceras de color ni cebra, portada tipográfica con los datos de
// producción, y todo en tabla real (filas y columnas con línea, como una
// hoja de cálculo impresa), con tamaño de letra configurable. Las cargas
// sociales aparecen como sus propias filas en cada nivel donde computan,
// igual que en pantalla.

type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];       // slate-900
const MUTED: RGB = [100, 116, 139];  // slate-500
const RULE: RGB = [148, 163, 184];   // slate-400, borde de tabla
const RULE_LIGHT: RGB = [203, 213, 225]; // slate-300, borde de fila

interface GCol { label: string; x: number; width: number; align: "left" | "right"; }

/** Construye el PDF sin disparar la descarga (adjuntos, previews, tests...). `downloadBudgetPdf` es un envoltorio fino que llama a `.save()`. */
export function buildBudgetPdf(p: BudgetReportParams): FilmaPDF {
  const cfg = p.exportConfig || DEFAULT_EXPORT_CONFIG;
  const F = PDF_FONT_SIZES[cfg.pdfFontSize || "normal"];
  const fringes = p.fringes || [];
  const info = p.projectInfo || {};
  const doc = new FilmaPDF({ accent: "budgeting", docRef: p.draftName });
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
  const heading = (str: string) => {
    breakIfNeeded(F.heading + 12);
    text(str, left, { bold: true, size: F.heading });
    doc.y += 3;
    rule(INK, 0.5);
    doc.y += 8;
  };

  // ─── Fila de tabla: dibuja el texto de cada columna y sus bordes (línea
  // inferior + verticales en cada límite de columna), sin relleno de color.
  // El borde superior del bloque se pinta una sola vez, antes de la cabecera.
  // `size` es en puntos (tamaño de letra) pero las coordenadas del PDF están
  // en milímetros: hay que convertir, si no la fila sale altísima y vacía. ──
  const ptToMm = (pt: number) => pt * 0.3528;
  const rowHeight = (size: number) => ptToMm(size) + 3.6;
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
  const tableTop = () => {
    doc.pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.pdf.setLineWidth(0.3);
    doc.pdf.line(left, doc.y, right, doc.y);
  };
  const tableHeaderRow = (cols: GCol[]) => {
    tableTop();
    gridRow(cols, cols.map((c) => c.label), { bold: true, size: F.label, color: MUTED });
  };
  /** Fila de datos con salto de página automático, repitiendo la cabecera de la tabla si hace falta. */
  const dataRow = (cols: GCol[], values: string[], opts: { bold?: boolean; size: number; color?: RGB }) => {
    const rh = rowHeight(opts.size);
    if (doc.y + rh > doc.pageH - 22) {
      doc.pdf.addPage();
      doc.y = doc.margin;
      tableHeaderRow(cols);
    }
    gridRow(cols, values, opts);
  };

  // Misma fórmula de fringe que en pantalla (ver lib/budgeting.ts).
  const fringeAmount = (f: BudgetingFringe, line: { total: number; units: number }) =>
    f.type === "percent" ? (line.total || 0) * ((f.percent || 0) / 100) : Math.min(f.amount || 0, f.capAmount ?? Infinity) * (line.units || 0);
  const fringeBreakdownFor = (subIds: string[], scope: "subchapter" | "chapter" | "total") => {
    const sums = new Map<string, number>();
    for (const subId of subIds) {
      for (const l of p.linesBySubchapter[subId] || []) {
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

  const cats = p.categoriesEnabled ? p.categories : [{ id: "all", label: "Presupuesto" } as BudgetingCategoryDef];
  const allSubIds = Object.values(p.subchaptersByChapter).flat().map((s) => s.id);

  // ─── Portada: solo tipografía, sin bloque de color. Título grande y, si
  // hay datos de producción rellenados, un bloque de ficha a dos columnas. ──
  text(info.title || p.draftName, left, { bold: true, size: F.title });
  doc.y += F.title * 0.42;
  rule(INK, 0.6);
  doc.y += 8;

  const infoPairs: [string, string][] = [];
  if (info.productionCompany) infoPairs.push(["PRODUCTORA", info.productionCompany]);
  if (info.format) infoPairs.push(["FORMATO", info.format]);
  if (info.director) infoPairs.push(["DIRECCIÓN", info.director]);
  if (info.producer) infoPairs.push(["PRODUCCIÓN", info.producer]);
  infoPairs.push(["MONEDA", p.currency]);
  if (info.preparedBy) infoPairs.push(["PREPARADO POR", info.preparedBy]);
  infoPairs.push(["FECHA", info.dateLabel || new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())]);

  const infoColW = (right - left) / 2;
  for (let i = 0; i < infoPairs.length; i += 2) {
    breakIfNeeded(ptToMm(F.body) + 5);
    infoPairs.slice(i, i + 2).forEach(([label, value], colIdx) => {
      const x = left + colIdx * infoColW;
      text(`${label}:`, x, { size: F.label, color: MUTED, bold: true });
      text(value, x + 32, { size: F.body, color: INK });
    });
    doc.y += ptToMm(F.body) + 4;
  }
  doc.y += 6;

  // ─── Top Sheet (opcional: toggle "Portada con totales" de la configuración
  // de exportación) ─────────────────────────────────────────────────────────
  if (cfg.coverSheet) {
    heading("TOP SHEET");

    const topCols: GCol[] = (() => {
      const codeW = 24, amtW = 42;
      return [
        { label: "CÓD.", x: left, width: codeW, align: "left" },
        { label: "CAPÍTULO", x: left + codeW, width: (right - left) - codeW - amtW, align: "left" },
        { label: "IMPORTE", x: right - amtW, width: amtW, align: "right" },
      ];
    })();
    tableHeaderRow(topCols);

    cats.forEach((cat) => {
      const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
      if (chapters.length === 0) return;
      if (p.categoriesEnabled) dataRow(topCols, ["", cat.label.toUpperCase(), ""], { bold: true, size: F.body });
      let catSum = 0;
      chapters.forEach((chapter) => {
        const subs = p.subchaptersByChapter[chapter.id] || [];
        const chapterFringeSum = fringeBreakdownFor(subs.map((s) => s.id), "chapter").reduce((s, b) => s + b.amount, 0);
        const chapterSum = Math.round((subs.reduce((s, sub) => {
          const lines = p.linesBySubchapter[sub.id] || [];
          const subFringes = fringeBreakdownFor([sub.id], "subchapter").reduce((s2, b) => s2 + b.amount, 0);
          return s + subTotal(sub, lines, subFringes);
        }, 0) + chapterFringeSum) * 100) / 100;
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

    doc.pdf.addPage();
    doc.y = doc.margin;
  }

  // ─── Detalle por cuenta ──────────────────────────────────────────────────
  heading("DETALLE POR CUENTA");

  const detailCols: GCol[] = (() => {
    let x = left;
    const push = (label: string, width: number, align: "left" | "right" = "left"): GCol => {
      const c = { label, x, width, align };
      x += width;
      return c;
    };
    const list = [push("CÓD.", 20), push("DESCRIPCIÓN", cfg.fields.unit ? 62 : 78), push("CANT.", 16, "right")];
    if (cfg.fields.unit) list.push(push("UNIDAD", 16));
    list.push(push("X", 12, "right"), push("TARIFA", 24, "right"), push("TOTAL", 24, "right"));
    return list;
  })();
  const detailRowValues = (row: { code: string; desc: string; qty: string; unit: string; mult: string; rate: string; total: string }) => {
    const byLabel: Record<string, string> = { "CÓD.": row.code, "DESCRIPCIÓN": row.desc, "CANT.": row.qty, "UNIDAD": row.unit, "X": row.mult, "TARIFA": row.rate, "TOTAL": row.total };
    return detailCols.map((c) => byLabel[c.label] || "");
  };

  cats.forEach((cat, catIdx) => {
    const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
    if (chapters.length === 0) return;
    if (p.categoriesEnabled) {
      breakIfNeeded(10);
      text(cat.label.toUpperCase(), left, { bold: true, size: F.body, color: MUTED });
      doc.y += 7;
    }
    chapters.forEach((chapter, chapterIdx) => {
      if (cfg.pageBreakPerChapter && !(catIdx === 0 && chapterIdx === 0)) {
        doc.pdf.addPage();
        doc.y = doc.margin;
      }
      const subs = p.subchaptersByChapter[chapter.id] || [];
      if (subs.length === 0) return;
      breakIfNeeded(12);
      text(`${chapter.code}  ${chapter.description}`, left, { bold: true, size: F.heading * 0.8 });
      doc.y += 2.5;
      rule(RULE);
      doc.y += 7;

      let chapterSum = 0;
      subs.forEach((sub) => {
        const lines = p.linesBySubchapter[sub.id] || [];
        const subFringes = fringeBreakdownFor([sub.id], "subchapter");
        if (lines.length === 0 && subFringes.length === 0) return;

        // Deja sitio para el subtítulo + la cabecera de la tabla + al menos una
        // fila, así nunca queda una cabecera huérfana sola al final de página.
        breakIfNeeded(8 + rowHeight(F.label) + rowHeight(F.body) * 2);
        text(`${sub.code}  ${sub.description}`, left, { bold: true, size: F.body + 0.5 });
        doc.y += 6;
        tableHeaderRow(detailCols);

        lines.forEach((l) => {
          dataRow(detailCols, detailRowValues({
            code: l.code, desc: l.description, qty: String(l.units),
            unit: l.unit || "", mult: String(l.multiplier), rate: fmt(l.rate), total: fmt(l.total),
          }), { size: F.body, color: l.routedTo ? MUTED : INK });
        });
        subFringes.forEach(({ fringe, amount }) => {
          dataRow(detailCols, detailRowValues({ code: fringe.code, desc: fringe.label, qty: "", unit: "", mult: "", rate: "", total: fmt(amount) }), { size: F.body, color: MUTED });
        });

        const subFringeSum = subFringes.reduce((s, b) => s + b.amount, 0);
        const subSum = subTotal(sub, lines, subFringeSum);
        chapterSum += subSum;
        dataRow(detailCols, detailRowValues({ code: "", desc: `Total ${sub.code} ${sub.description}`, qty: "", unit: "", mult: "", rate: "", total: fmt(subSum) }), { bold: true, size: F.body });
        doc.y += 4;
      });

      const chapterFringes = fringeBreakdownFor(subs.map((s) => s.id), "chapter");
      if (chapterFringes.length > 0) {
        breakIfNeeded(rowHeight(F.body) * (chapterFringes.length + 1));
        tableHeaderRow(detailCols);
        chapterFringes.forEach(({ fringe, amount }) => {
          dataRow(detailCols, detailRowValues({ code: fringe.code, desc: fringe.label, qty: "", unit: "", mult: "", rate: "", total: fmt(amount) }), { size: F.body, color: MUTED });
        });
        chapterSum += chapterFringes.reduce((s, b) => s + b.amount, 0);
        doc.y += 4;
      }

      breakIfNeeded(F.heading * 0.8 + 8);
      rule(INK, 0.4);
      doc.y += (F.heading * 0.8) * 0.55 + 3;
      text(`Total ${chapter.code} ${chapter.description}`, left, { bold: true, size: F.heading * 0.75 });
      text(fmt(chapterSum), right, { bold: true, size: F.heading * 0.75, align: "right" });
      doc.y += 11;
    });
  });

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
