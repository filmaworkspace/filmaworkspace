// ─────────────────────────────────────────────────────────────────────────────
// Builder de PDFs con marca compartido — mismo diseño base para cualquier
// exportación de cualquier departamento (Accounting, Team, Config...), con
// el color de acento cambiando según el módulo, igual que ya hace la nav del
// Header (azul Accounting, verde Team). Piloto: exportación de una PO.
// ─────────────────────────────────────────────────────────────────────────────

import jsPDF from "jspdf";

export type PdfAccent = "accounting" | "team" | "config" | "budgeting" | "neutral";

type RGB = [number, number, number];

const ACCENTS: Record<PdfAccent, RGB> = {
  accounting: [47, 82, 224],   // #2F52E0
  team: [107, 163, 25],        // #6BA319
  config: [71, 85, 105],       // slate-600
  budgeting: [232, 111, 74],  // #E86F4A
  neutral: [15, 23, 42],       // slate-900
};

const SLATE = {
  900: [15, 23, 42] as RGB,
  700: [51, 65, 85] as RGB,
  500: [100, 116, 139] as RGB,
  400: [148, 163, 184] as RGB,
  200: [226, 232, 240] as RGB,
  50: [248, 250, 252] as RGB,
};

export interface PdfTableColumn {
  label: string;
  width: number; // mm
  align?: "left" | "right";
}

export interface PdfInfoCard {
  label: string;
  value: string;
  big?: boolean;
}

export interface PdfTotalRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface FilmaPdfOptions {
  accent?: PdfAccent;
  orientation?: "p" | "l";
  /** Texto corto que aparece en el pie de cada página, p. ej. "PO-014 · Proyecto X" */
  docRef?: string;
  /** Marca del pie de página; por defecto "Hecho con Filma Workspace". Cada módulo puede pasar la suya. */
  footerBrand?: string;
}

/**
 * Envoltorio fino sobre jsPDF con el diseño de marca de Filma Workspace:
 * cabecera de color + eyebrow del módulo, tarjetas de info, tabla con cebra,
 * bloque de totales, y pie de página con paginación en todas las páginas.
 * Uso típico:
 *   const doc = new FilmaPDF({ accent: "accounting", docRef: `PO-${po.number}` });
 *   doc.header({ eyebrow: "Accounting", title: "Orden de compra", docNumber: `PO-${po.number}` });
 *   doc.infoCards([...]);
 *   doc.sectionTitle("Items", po.items.length);
 *   doc.table(columns, rows);
 *   doc.totalsBlock([...]);
 *   doc.save("PO-014.pdf");
 */
export class FilmaPDF {
  pdf: jsPDF;
  y: number;
  margin: number;
  pageW: number;
  pageH: number;
  accentColor: RGB;
  private docRef?: string;
  private footerBrand: string;

  constructor(opts: FilmaPdfOptions = {}) {
    this.pdf = new jsPDF(opts.orientation || "p", "mm", "a4");
    this.margin = 18;
    this.pageW = this.pdf.internal.pageSize.getWidth();
    this.pageH = this.pdf.internal.pageSize.getHeight();
    this.accentColor = ACCENTS[opts.accent || "neutral"];
    this.docRef = opts.docRef;
    this.footerBrand = opts.footerBrand || "Hecho con Filma Workspace";
    this.y = this.margin;
  }

  private fill(c: RGB) { this.pdf.setFillColor(c[0], c[1], c[2]); }
  private text(c: RGB) { this.pdf.setTextColor(c[0], c[1], c[2]); }
  private draw(c: RGB) { this.pdf.setDrawColor(c[0], c[1], c[2]); }

  private checkPageBreak(need: number) {
    if (this.y + need > this.pageH - 22) {
      this.pdf.addPage();
      this.y = this.margin;
    }
  }

  /** Barra de color superior con el módulo (eyebrow), el wordmark y el título del documento. */
  header({ eyebrow, title, docNumber, meta }: { eyebrow: string; title: string; docNumber?: string; meta?: string }) {
    const h = 40;
    this.fill(this.accentColor);
    this.pdf.rect(0, 0, this.pageW, h, "F");

    this.text([255, 255, 255]);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(8);
    this.pdf.text(eyebrow.toUpperCase(), this.margin, 12);

    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(9);
    this.pdf.text("FILMA WORKSPACE", this.pageW - this.margin, 12, { align: "right" });

    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(20);
    this.pdf.text(title, this.margin, 27);

    this.pdf.setFontSize(11);
    this.pdf.setFont("helvetica", "normal");
    if (docNumber) this.pdf.text(docNumber, this.margin, 35);
    if (meta) this.pdf.text(meta, this.pageW - this.margin, 35, { align: "right" });

    this.y = h + 12;
  }

  /** Fila de tarjetas de información corta (proveedor, importe, fecha...). */
  infoCards(cards: PdfInfoCard[]) {
    const gap = 6;
    const w = (this.pageW - this.margin * 2 - gap * (cards.length - 1)) / cards.length;
    const hgt = 22;
    this.checkPageBreak(hgt + 10);
    cards.forEach((c, i) => {
      const x = this.margin + i * (w + gap);
      this.fill(SLATE[50]);
      this.pdf.roundedRect(x, this.y, w, hgt, 2, 2, "F");
      this.text(SLATE[500]);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(7);
      this.pdf.text(c.label.toUpperCase(), x + 4, this.y + 7);
      this.text(SLATE[900]);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(c.big ? 13 : 11);
      const line = this.pdf.splitTextToSize(c.value, w - 8)[0] || "";
      this.pdf.text(line, x + 4, this.y + 16.5);
    });
    this.y += hgt + 10;
  }

  sectionTitle(text: string, count?: number) {
    this.checkPageBreak(14);
    this.text(SLATE[900]);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(10);
    this.pdf.text(count !== undefined ? `${text.toUpperCase()} (${count})` : text.toUpperCase(), this.margin, this.y);
    this.y += 7;
  }

  /** Tabla con cabecera gris y filas con cebra; hace salto de página automático. */
  table(columns: PdfTableColumn[], rows: string[][]) {
    const tableW = columns.reduce((s, c) => s + c.width, 0);

    const drawHeaderRow = () => {
      this.fill(SLATE[50]);
      this.pdf.rect(this.margin, this.y, tableW, 8, "F");
      this.text(SLATE[500]);
      this.pdf.setFont("helvetica", "bold");
      this.pdf.setFontSize(7);
      let cx = this.margin;
      columns.forEach((col) => {
        const align = col.align === "right" ? "right" : "left";
        this.pdf.text(col.label.toUpperCase(), align === "right" ? cx + col.width - 3 : cx + 3, this.y + 5.5, { align });
        cx += col.width;
      });
      this.y += 8;
    };

    this.checkPageBreak(8 + 9);
    drawHeaderRow();

    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(9);
    rows.forEach((row, i) => {
      if (this.y + 9 > this.pageH - 22) {
        this.pdf.addPage();
        this.y = this.margin;
        drawHeaderRow();
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setFontSize(9);
      }
      if (i % 2 === 1) {
        this.fill(SLATE[50]);
        this.pdf.rect(this.margin, this.y, tableW, 9, "F");
      }
      this.text(SLATE[900]);
      let cx = this.margin;
      row.forEach((cell, ci) => {
        const col = columns[ci];
        if (!col) return;
        const align = col.align === "right" ? "right" : "left";
        const line = this.pdf.splitTextToSize(cell, col.width - 6)[0] || "";
        this.pdf.text(line, align === "right" ? cx + col.width - 3 : cx + 3, this.y + 6, { align });
        cx += col.width;
      });
      this.y += 9;
    });
    this.y += 6;
  }

  /** Bloque de totales alineado a la derecha (Base / IVA / Total...). */
  totalsBlock(rows: PdfTotalRow[]) {
    const w = 75;
    const x = this.pageW - this.margin - w;
    this.checkPageBreak(rows.length * 7 + 6);
    rows.forEach((r) => {
      this.text(r.emphasis ? SLATE[900] : SLATE[500]);
      this.pdf.setFont("helvetica", r.emphasis ? "bold" : "normal");
      this.pdf.setFontSize(r.emphasis ? 12 : 9);
      this.pdf.text(r.label, x, this.y);
      this.pdf.text(r.value, this.pageW - this.margin, this.y, { align: "right" });
      this.y += r.emphasis ? 8 : 6;
    });
    this.y += 4;
  }

  /** Párrafo libre (notas, condiciones...) con salto de línea automático. */
  paragraph(label: string, value: string) {
    this.checkPageBreak(20);
    this.text(SLATE[500]);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setFontSize(7);
    this.pdf.text(label.toUpperCase(), this.margin, this.y);
    this.y += 5;
    this.text(SLATE[700]);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.setFontSize(9);
    const lines: string[] = this.pdf.splitTextToSize(value, this.pageW - this.margin * 2);
    lines.forEach((line) => {
      this.checkPageBreak(6);
      this.pdf.text(line, this.margin, this.y);
      this.y += 5;
    });
    this.y += 4;
  }

  /** Pie de página en todas las páginas — se llama automáticamente desde save(). */
  private finish() {
    const pageCount = this.pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      this.pdf.setPage(i);
      this.draw(SLATE[200]);
      this.pdf.setLineWidth(0.2);
      this.pdf.line(this.margin, this.pageH - 16, this.pageW - this.margin, this.pageH - 16);
      this.text(SLATE[400]);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setFontSize(7.5);
      this.pdf.text(this.docRef ? `${this.footerBrand} · ${this.docRef}` : this.footerBrand, this.margin, this.pageH - 10);
      this.pdf.text(`Página ${i} de ${pageCount}`, this.pageW - this.margin, this.pageH - 10, { align: "right" });
    }
  }

  save(filename: string) {
    this.finish();
    this.pdf.save(filename);
  }

  /** Para generar el PDF sin disparar una descarga en el navegador — server-side, adjuntos de email, previews, etc. */
  toArrayBuffer(): ArrayBuffer {
    this.finish();
    return this.pdf.output("arraybuffer");
  }
}
