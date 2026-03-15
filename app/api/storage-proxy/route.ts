// app/api/storage-proxy/route.ts
// Proxy para descargar archivos de Firebase Storage + añade banner PDF con datos del gasto

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface ExpenseItem {
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  subAccountCode?: string;
  subAccountDescription?: string;
}

interface ExpenseData {
  displayNumber: string;
  supplier: string;
  date: string;
  type: "invoice" | "ticket";
  items: ExpenseItem[];
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
}

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

async function generateBannerPdf(expense: ExpenseData): Promise<Uint8Array> {
  const pageWidth = 595;
  const lineH = 14;
  const padding = 20;
  const headerH = 36;
  const itemsH = Math.max(1, expense.items.length) * lineH;
  const footerH = 28;
  const pageHeight = headerH + itemsH + footerH + padding * 2 + 16;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const dark   = rgb(0.12, 0.16, 0.23);
  const orange = rgb(0.976, 0.451, 0.086);
  const mid    = rgb(0.44, 0.50, 0.56);
  const white  = rgb(1, 1, 1);
  const light  = rgb(0.95, 0.96, 0.97);

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: white });
  page.drawRectangle({ x: 0, y: pageHeight - headerH, width: pageWidth, height: headerH, color: dark });
  page.drawRectangle({ x: 0, y: pageHeight - headerH, width: 4, height: headerH, color: orange });

  page.drawText(expense.displayNumber, { x: padding, y: pageHeight - headerH + 14, size: 13, font: fontB, color: white });
  page.drawText(expense.supplier, { x: padding, y: pageHeight - headerH + 2, size: 9, font: fontR, color: rgb(0.7, 0.75, 0.8) });

  const typeLabel = expense.type === "invoice" ? "Factura" : "Ticket";
  const dateStr = `${fmtDate(expense.date)}  ·  ${typeLabel}`;
  const dateW = fontR.widthOfTextAtSize(dateStr, 9);
  page.drawText(dateStr, { x: pageWidth - padding - dateW, y: pageHeight - headerH + 14, size: 9, font: fontR, color: rgb(0.7, 0.75, 0.8) });

  const totalStr = fmt(expense.totalAmount);
  const totalW = fontB.widthOfTextAtSize(totalStr, 11);
  page.drawText(totalStr, { x: pageWidth - padding - totalW, y: pageHeight - headerH + 2, size: 11, font: fontB, color: orange });

  const itemsY = pageHeight - headerH - padding;
  expense.items.forEach((item, i) => {
    const y = itemsY - i * lineH;
    if (i % 2 === 0) {
      page.drawRectangle({ x: padding - 4, y: y - 3, width: pageWidth - padding * 2 + 8, height: lineH, color: light });
    }
    const account = [item.subAccountCode, item.subAccountDescription].filter(Boolean).join(" · ") || "—";
    page.drawText(account, { x: padding, y: y + 1, size: 8, font: fontR, color: dark });
    const baseStr = `Base: ${fmtNum(item.baseAmount)}`;
    page.drawText(baseStr, { x: 280, y: y + 1, size: 8, font: fontR, color: mid });
    const vatStr = `IVA ${item.vatRate}%: ${fmtNum(item.vatAmount)}`;
    const vatW = fontR.widthOfTextAtSize(vatStr, 8);
    page.drawText(vatStr, { x: pageWidth - padding - vatW, y: y + 1, size: 8, font: fontR, color: mid });
  });

  const divY = pageHeight - headerH - padding - itemsH - 6;
  page.drawLine({ start: { x: padding, y: divY }, end: { x: pageWidth - padding, y: divY }, thickness: 0.5, color: rgb(0.85, 0.87, 0.89) });

  const footerY = divY - 16;
  page.drawText("Base imponible:", { x: padding, y: footerY, size: 8, font: fontR, color: mid });
  page.drawText(fmt(expense.baseAmount), { x: padding + 72, y: footerY, size: 8, font: fontB, color: dark });

  if (expense.irpfRate > 0) {
    const irpfStr = `IRPF ${expense.irpfRate}%: ${fmt(expense.irpfAmount)}`;
    page.drawText(irpfStr, { x: 240, y: footerY, size: 8, font: fontR, color: mid });
  }

  const totalLabelStr = "Total:";
  const totalValStr = fmt(expense.totalAmount);
  const totalValW = fontB.widthOfTextAtSize(totalValStr, 9);
  const totalLabelW = fontR.widthOfTextAtSize(totalLabelStr, 8);
  page.drawText(totalLabelStr, { x: pageWidth - padding - totalValW - totalLabelW - 6, y: footerY, size: 8, font: fontR, color: mid });
  page.drawText(totalValStr, { x: pageWidth - padding - totalValW, y: footerY, size: 9, font: fontB, color: dark });

  return pdfDoc.save();
}

async function convertImageToPdf(imageBytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  let image;
  if (contentType.includes("png")) {
    image = await pdfDoc.embedPng(imageBytes);
  } else {
    image = await pdfDoc.embedJpg(imageBytes);
  }
  const { width, height } = image.scale(1);
  const maxW = 595, maxH = 842;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const page = pdfDoc.addPage([maxW, maxH]);
  page.drawImage(image, {
    x: (maxW - width * scale) / 2,
    y: (maxH - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  });
  return pdfDoc.save();
}

async function prependBannerToPdf(bannerBytes: Uint8Array, docBytes: Uint8Array): Promise<Uint8Array> {
  try {
    const bannerDoc = await PDFDocument.load(bannerBytes);
    const docPdf    = await PDFDocument.load(docBytes);
    const merged    = await PDFDocument.create();
    const [bannerPage] = await merged.copyPages(bannerDoc, [0]);
    merged.addPage(bannerPage);
    const docPages = await merged.copyPages(docPdf, docPdf.getPageIndices());
    docPages.forEach(p => merged.addPage(p));
    return merged.save();
  } catch {
    return bannerBytes;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const expenseRaw = searchParams.get("expense");

  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  if (!url.includes("firebasestorage.googleapis.com") && !url.includes("firebasestorage.app")) {
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 403 });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return NextResponse.json({ error: `Storage fetch failed: ${response.status}` }, { status: response.status });
    }

    const fileBytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    if (!expenseRaw) {
      return new NextResponse(fileBytes, {
        status: 200,
        headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
      });
    }

    const expense: ExpenseData = JSON.parse(expenseRaw);
    const bannerBytes = await generateBannerPdf(expense);

    let docPdfBytes: Uint8Array;
    if (contentType.includes("pdf")) {
      docPdfBytes = fileBytes;
    } else {
      docPdfBytes = await convertImageToPdf(fileBytes, contentType);
    }

    const merged = await prependBannerToPdf(bannerBytes, docPdfBytes);

    return new NextResponse(merged, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("Storage proxy error:", error);
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 500 });
  }
}
