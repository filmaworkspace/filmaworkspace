// app/api/invoice-banner/route.ts
// Genera el banner PDF para expedientes de proveedores (transferencias)

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface InvoiceItem {
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  subAccountCode?: string;
  subAccountDescription?: string;
}

interface InvoiceData {
  displayNumber: string;
  supplier: string;
  supplierNumber: string;
  date: string;
  type: string;
  items: InvoiceItem[];
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  status: string;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
}

const PAYMENT_METHODS: Record<string, string> = {
  transfer:     "Transferencia bancaria",
  card:         "Tarjeta",
  cash:         "Efectivo",
  check:        "Cheque",
  direct_debit: "Domiciliación",
};

const fmt = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const fmtNum = (n: number) =>
  n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch { return iso; }
};

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice:   "Factura",
  proforma:  "Proforma",
  budget:    "Presupuesto",
  guarantee: "Fianza",
};

export async function POST(request: NextRequest) {
  try {
    const invoice: InvoiceData = await request.json();

    const pageWidth = 595;
    const padding   = 20;
    const headerH   = 32;
    const subH      = 24;
    const lineH     = 15;
    const itemsH    = Math.max(1, invoice.items.length) * lineH + 8;
    const paymentH  = invoice.status === "paid" ? 22 : 0;
    const footerH   = 26;
    const pageHeight = headerH + subH + itemsH + paymentH + footerH + padding + 8;

    const pdfDoc = await PDFDocument.create();
    const page   = pdfDoc.addPage([pageWidth, pageHeight]);
    const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const dark   = rgb(0.12, 0.16, 0.23);
    const orange = rgb(0.976, 0.451, 0.086);
    const mid    = rgb(0.44, 0.50, 0.56);
    const white  = rgb(1, 1, 1);
    const light  = rgb(0.95, 0.96, 0.97);
    const green  = rgb(0.13, 0.77, 0.37);
    const border = rgb(0.85, 0.87, 0.89);

    // White background
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: white });

    // ── Dark header bar ──────────────────────────────────────────────
    const hY = pageHeight - headerH;
    page.drawRectangle({ x: 0, y: hY, width: pageWidth, height: headerH, color: dark });
    page.drawRectangle({ x: 0, y: hY, width: 4, height: headerH, color: orange });

    page.drawText(invoice.displayNumber, {
      x: padding, y: hY + (headerH - 13) / 2,
      size: 13, font: fontB, color: white,
    });

    const typeLabel = DOC_TYPE_LABELS[invoice.type] || invoice.type;
    const dateStr = `${fmtDate(invoice.date)}  ·  ${typeLabel}`;
    const dateW = fontR.widthOfTextAtSize(dateStr, 9);
    page.drawText(dateStr, {
      x: pageWidth - padding - dateW, y: hY + (headerH - 9) / 2,
      size: 9, font: fontR, color: rgb(0.7, 0.75, 0.8),
    });

    // ── Supplier sub-row ─────────────────────────────────────────────
    const subY = hY - subH;
    page.drawLine({ start: { x: 0, y: subY }, end: { x: pageWidth, y: subY }, thickness: 0.5, color: border });

    const supplierParts = [invoice.supplier, invoice.supplierNumber].filter(Boolean).join("  ·  ");
    page.drawText(supplierParts, {
      x: padding, y: subY + (subH - 10) / 2,
      size: 10, font: fontB, color: dark,
    });

    // ── Items ─────────────────────────────────────────────────────────
    const itemsTop = subY - 8;
    invoice.items.forEach((item, i) => {
      const y = itemsTop - i * lineH;
      if (i % 2 === 0) {
        page.drawRectangle({ x: 0, y: y - 3, width: pageWidth, height: lineH, color: light });
      }
      const account = [item.subAccountCode, item.subAccountDescription].filter(Boolean).join(" · ") || "—";
      page.drawText(account, { x: padding, y: y + 2, size: 8, font: fontR, color: dark });

      const baseStr = `Base: ${fmtNum(item.baseAmount)}`;
      page.drawText(baseStr, { x: 300, y: y + 2, size: 8, font: fontR, color: mid });

      const vatStr = `IVA ${item.vatRate}%: ${fmtNum(item.vatAmount)}`;
      const vatW = fontR.widthOfTextAtSize(vatStr, 8);
      page.drawText(vatStr, { x: pageWidth - padding - vatW, y: y + 2, size: 8, font: fontR, color: mid });
    });

    // ── Payment status row (only if paid) ────────────────────────────
    const afterItemsY = itemsTop - invoice.items.length * lineH - 4;
    if (invoice.status === "paid" && invoice.paidAt) {
      const payY = afterItemsY - 4;
      page.drawRectangle({ x: 0, y: payY - 3, width: pageWidth, height: paymentH, color: rgb(0.93, 0.99, 0.95) });

      const payMethod = PAYMENT_METHODS[invoice.paymentMethod || ""] || invoice.paymentMethod || "";
      const payParts = ["✓ Pagada el " + fmtDate(invoice.paidAt), payMethod, invoice.paymentReference ? "Ref: " + invoice.paymentReference : ""].filter(Boolean).join("  ·  ");
      page.drawText(payParts, { x: padding, y: payY + 4, size: 8, font: fontB, color: green });
    }

    // ── Divider ───────────────────────────────────────────────────────
    const divBase = invoice.status === "paid" && invoice.paidAt
      ? afterItemsY - paymentH - 8
      : afterItemsY - 4;
    page.drawLine({ start: { x: padding, y: divBase }, end: { x: pageWidth - padding, y: divBase }, thickness: 0.5, color: border });

    // ── Footer totals ─────────────────────────────────────────────────
    const footerY = divBase - 16;
    page.drawText("Base imponible:", { x: padding, y: footerY, size: 8, font: fontR, color: mid });
    page.drawText(fmt(invoice.baseAmount), { x: padding + 75, y: footerY, size: 8, font: fontB, color: dark });

    if (invoice.irpfRate > 0) {
      const irpfStr = `IRPF ${invoice.irpfRate}%: ${fmt(invoice.irpfAmount)}`;
      page.drawText(irpfStr, { x: 260, y: footerY, size: 8, font: fontR, color: mid });
    }

    const totalValStr = fmt(invoice.totalAmount);
    const totalLabelStr = "Total:";
    const totalValW = fontB.widthOfTextAtSize(totalValStr, 9);
    const totalLabelW = fontR.widthOfTextAtSize(totalLabelStr, 8);
    page.drawText(totalLabelStr, { x: pageWidth - padding - totalValW - totalLabelW - 6, y: footerY, size: 8, font: fontR, color: mid });
    page.drawText(totalValStr, { x: pageWidth - padding - totalValW, y: footerY, size: 9, font: fontB, color: dark });

    // ── Watermark ─────────────────────────────────────────────────────
    const watermark = "Generado por Filma Workspace · filmaworkspace.com";
    const wmW = fontR.widthOfTextAtSize(watermark, 6);
    page.drawText(watermark, {
      x: pageWidth - padding - wmW, y: 5,
      size: 6, font: fontR, color: rgb(0.75, 0.78, 0.82),
    });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(pdfBytes, {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (error) {
    console.error("Invoice banner error:", error);
    return NextResponse.json({ error: "Banner generation failed" }, { status: 500 });
  }
}
