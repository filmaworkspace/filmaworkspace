// ─────────────────────────────────────────────────────────────────────────────
// Exportación de un borrador de Budgeting a Excel y PDF (además del .fwb de
// budgetingExport.ts). El PDF reutiliza el builder de marca compartido
// (lib/pdfBuilder.ts) con el acento de Budgeting — minimalista, sin adornos.
// El Excel usa el mismo método de escritura XML+zip ya probado en el
// importador de Accounting > Budget (fflate, sin librerías nuevas).
// ─────────────────────────────────────────────────────────────────────────────

import { strToU8, zipSync } from "fflate";
import { FilmaPDF } from "./pdfBuilder";
import { BudgetingCategoryDef, fmtCurrency } from "./budgeting";

interface ReportChapter { id: string; code: string; description: string; }
interface ReportSubchapter { id: string; code: string; description: string; }
interface ReportLine { code: string; description: string; units: number; unit: string; multiplier: number; rate: number; total: number; }

export interface BudgetReportParams {
  draftName: string;
  currency: string;
  categoriesEnabled: boolean;
  categories: BudgetingCategoryDef[];
  chaptersByCategory: (categoryId: string | null) => ReportChapter[];
  subchaptersByChapter: Record<string, ReportSubchapter[]>;
  linesBySubchapter: Record<string, ReportLine[]>;
  grandTotal: number;
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
  const rows: (string | number)[][] = [["Categoría", "Capítulo", "Subcapítulo", "Código", "Descripción", "Cantidad", "Unidad", "X", "Tarifa", "Total"]];
  const cats = p.categoriesEnabled ? p.categories : [{ id: "all", label: "" } as BudgetingCategoryDef];
  cats.forEach((cat) => {
    p.chaptersByCategory(p.categoriesEnabled ? cat.id : null).forEach((chapter) => {
      (p.subchaptersByChapter[chapter.id] || []).forEach((sub) => {
        (p.linesBySubchapter[sub.id] || []).forEach((line) => {
          rows.push([
            cat.label, `${chapter.code} ${chapter.description}`, `${sub.code} ${sub.description}`,
            line.code, line.description, line.units, line.unit, line.multiplier, line.rate, line.total,
          ]);
        });
      });
    });
  });
  rows.push(["", "", "", "", "", "", "", "", "Total", p.grandTotal]);
  const bytes = buildXlsx("Presupuesto", rows);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${p.draftName.replace(/[^\w\-]+/g, "_")}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

export function downloadBudgetPdf(p: BudgetReportParams) {
  const doc = new FilmaPDF({ accent: "budgeting", docRef: p.draftName });
  doc.header({ eyebrow: "Budgeting", title: p.draftName, meta: p.currency });

  const cats = p.categoriesEnabled ? p.categories : [{ id: "all", label: "Presupuesto" } as BudgetingCategoryDef];
  cats.forEach((cat) => {
    const chapters = p.chaptersByCategory(p.categoriesEnabled ? cat.id : null);
    if (chapters.length === 0) return;
    if (p.categoriesEnabled) doc.sectionTitle(cat.label);
    chapters.forEach((chapter) => {
      (p.subchaptersByChapter[chapter.id] || []).forEach((sub) => {
        const lines = p.linesBySubchapter[sub.id] || [];
        if (lines.length === 0) return;
        doc.sectionTitle(`${chapter.code} ${chapter.description} · ${sub.code} ${sub.description}`);
        doc.table(
          [
            { label: "Código", width: 28 },
            { label: "Descripción", width: 68 },
            { label: "Cant.", width: 16, align: "right" },
            { label: "Unidad", width: 20 },
            { label: "Tarifa", width: 21, align: "right" },
            { label: "Total", width: 21, align: "right" },
          ],
          lines.map((l) => [
            l.code, l.description, String(l.units), l.unit || "",
            fmtCurrency(l.rate, p.currency), fmtCurrency(l.total, p.currency),
          ])
        );
      });
    });
  });

  doc.totalsBlock([{ label: "Total", value: fmtCurrency(p.grandTotal, p.currency), emphasis: true }]);
  doc.save(`${p.draftName.replace(/[^\w\-]+/g, "_")}.pdf`);
}
