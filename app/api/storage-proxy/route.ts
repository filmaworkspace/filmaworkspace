// ─── Framework ────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";

// ─── Libraries ───────────────────────────────────────────────────────────────
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { verifyRequestAuth } from "@/lib/serverAuth";

// ─── Types ───────────────────────────────────────────────────────────────────

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
  supplierNumber: string;
  date: string;
  type: string;
  items: ExpenseItem[];
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  status?: string;
  paidAt?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  invoice: "Factura",
  ticket: "Ticket",
  proforma: "Proforma",
  budget: "Presupuesto",
  guarantee: "Fianza",
};

const PAYMENT_METHODS: Record<string, string> = {
  transfer: "Transferencia bancaria",
  card: "Tarjeta",
  cash: "Efectivo",
  check: "Cheque",
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
  } catch {
    return iso;
  }
};

async function generateBannerPdf(expense: ExpenseData): Promise<Uint8Array> {
  const pageWidth = 595;
  const padding = 20;
  const headerH = 32;
  const subH = 24;
  const lineH = 15;
  const itemsH = Math.max(1, expense.items.length) * lineH + 8;
  const paymentH = expense.status === "paid" && expense.paidAt ? 20 : 0;
  const footerH = 26;
  const pageHeight = headerH + subH + itemsH + paymentH + footerH + padding + 8;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const dark = rgb(0.12, 0.16, 0.23);
  const orange = rgb(0.976, 0.451, 0.086);
  const mid = rgb(0.44, 0.5, 0.56);
  const white = rgb(1, 1, 1);
  const light = rgb(0.95, 0.96, 0.97);
  const green = rgb(0.13, 0.77, 0.37);
  const border = rgb(0.85, 0.87, 0.89);

  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: white });

  const hY = pageHeight - headerH;
  page.drawRectangle({ x: 0, y: hY, width: pageWidth, height: headerH, color: dark });
  page.drawRectangle({ x: 0, y: hY, width: 4, height: headerH, color: orange });

  page.drawText(expense.displayNumber, {
    x: padding,
    y: hY + (headerH - 13) / 2,
    size: 13,
    font: fontB,
    color: white,
  });

  const typeLabel = DOC_TYPE_LABELS[expense.type] || expense.type;
  const dateStr = `${fmtDate(expense.date)}  ·  ${typeLabel}`;
  const dateW = fontR.widthOfTextAtSize(dateStr, 9);
  page.drawText(dateStr, {
    x: pageWidth - padding - dateW,
    y: hY + (headerH - 9) / 2,
    size: 9,
    font: fontR,
    color: rgb(0.7, 0.75, 0.8),
  });

  const subY = hY - subH;
  page.drawLine({ start: { x: 0, y: subY }, end: { x: pageWidth, y: subY }, thickness: 0.5, color: border });
  const supplierParts = [expense.supplier, expense.supplierNumber].filter(Boolean).join("  ·  ");
  page.drawText(supplierParts, {
    x: padding,
    y: subY + (subH - 10) / 2,
    size: 10,
    font: fontB,
    color: dark,
  });

  const itemsTop = subY - 8;
  expense.items.forEach((item, i) => {
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

  const afterItemsY = itemsTop - expense.items.length * lineH - 4;
  if (expense.status === "paid" && expense.paidAt) {
    const payY = afterItemsY - 2;
    page.drawRectangle({ x: 0, y: payY - 3, width: pageWidth, height: paymentH, color: rgb(0.93, 0.99, 0.95) });
    const payMethod = expense.paymentMethod ? PAYMENT_METHODS[expense.paymentMethod] || expense.paymentMethod : "";
    const parts = [
      "✓ Pagada el " + fmtDate(expense.paidAt),
      payMethod,
      expense.paymentReference ? "Ref: " + expense.paymentReference : "",
    ]
      .filter(Boolean)
      .join("  ·  ");
    page.drawText(parts, { x: padding, y: payY + 4, size: 8, font: fontB, color: green });
  }

  const divBase = expense.status === "paid" && expense.paidAt ? afterItemsY - paymentH - 6 : afterItemsY - 4;
  page.drawLine({
    start: { x: padding, y: divBase },
    end: { x: pageWidth - padding, y: divBase },
    thickness: 0.5,
    color: border,
  });

  const footerY = divBase - 16;
  page.drawText("Base imponible:", { x: padding, y: footerY, size: 8, font: fontR, color: mid });
  page.drawText(fmt(expense.baseAmount), { x: padding + 75, y: footerY, size: 8, font: fontB, color: dark });

  if (expense.irpfRate > 0) {
    const irpfStr = `IRPF ${expense.irpfRate}%: ${fmt(expense.irpfAmount)}`;
    page.drawText(irpfStr, { x: 260, y: footerY, size: 8, font: fontR, color: mid });
  }

  const totalValStr = fmt(expense.totalAmount);
  const totalLabelStr = "Total:";
  const totalValW = fontB.widthOfTextAtSize(totalValStr, 9);
  const totalLabelW = fontR.widthOfTextAtSize(totalLabelStr, 8);
  page.drawText(totalLabelStr, {
    x: pageWidth - padding - totalValW - totalLabelW - 6,
    y: footerY,
    size: 8,
    font: fontR,
    color: mid,
  });
  page.drawText(totalValStr, {
    x: pageWidth - padding - totalValW,
    y: footerY,
    size: 9,
    font: fontB,
    color: dark,
  });

  const watermark = "Generado por Filma Workspace · filmaworkspace.com";
  const wmW = fontR.widthOfTextAtSize(watermark, 6);
  page.drawText(watermark, {
    x: pageWidth - padding - wmW,
    y: 5,
    size: 6,
    font: fontR,
    color: rgb(0.75, 0.78, 0.82),
  });

  return pdfDoc.save();
}

async function convertImageToPdf(imageBytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const image = contentType.includes("png")
    ? await pdfDoc.embedPng(imageBytes)
    : await pdfDoc.embedJpg(imageBytes);
  const { width, height } = image.scale(1);
  const maxW = 595,
    maxH = 842;
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

async function mergePdfs(bannerBytes: Uint8Array, docBytes: Uint8Array): Promise<Uint8Array> {
  const srcRaw = await PDFDocument.load(docBytes, { ignoreEncryption: true });
  const normalized = await srcRaw.save({ useObjectStreams: false });
  const srcDoc = await PDFDocument.load(normalized, { ignoreEncryption: true });

  const bannerDoc = await PDFDocument.load(bannerBytes, { ignoreEncryption: true });

  const mergedDoc = await PDFDocument.create();

  const bannerPages = await mergedDoc.copyPages(bannerDoc, bannerDoc.getPageIndices());
  bannerPages.forEach((p) => mergedDoc.addPage(p));

  const invoicePages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
  invoicePages.forEach((p) => mergedDoc.addPage(p));

  return mergedDoc.save();
}

export async function GET(request: NextRequest) {
  const authResult = await verifyRequestAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const expenseRaw = searchParams.get("expense");

  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 403 });
  }
  const allowedHosts = ["firebasestorage.googleapis.com", "storage.googleapis.com"];
  const hostAllowed = allowedHosts.some(
    (h) => parsedUrl.hostname === h || parsedUrl.hostname.endsWith(`.${h}`)
  );
  if (!hostAllowed || (parsedUrl.protocol !== "https:"))
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 403 });

  try {
    // Firebase Storage rechaza requests con cabeceras condicionales (If-None-Match,
    // If-Modified-Since) con un 412. Next.js las inyecta automáticamente cuando
    // usa su fetch cache. Pasamos un Request explícito sin ninguna cabecera extra
    // y con cache: "no-store" para evitar que Next.js añada precondiciones.
    const storageRequest = new Request(url, {
      method: "GET",
      headers: { "Accept": "*/*" },
      cache: "no-store",
    });
    const response = await fetch(storageRequest, { cache: "no-store" });

    if (!response.ok)
      return NextResponse.json({ error: `Storage fetch failed: ${response.status}` }, { status: response.status });

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

    const docPdfBytes = contentType.includes("pdf")
      ? fileBytes
      : await convertImageToPdf(fileBytes, contentType);

    const merged = await mergePdfs(bannerBytes, docPdfBytes);

    return new NextResponse(merged, {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("[Proxy] top-level error:", error);
    return NextResponse.json({ error: "Proxy fetch failed" }, { status: 500 });
  }
}
