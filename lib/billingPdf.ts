// ─── PDF de facturas y presupuestos de Filma ─────────────────────────────────
// A4 con la cabecera del degradado de Filma (la misma imagen de los emails),
// emisor y cliente, líneas, desglose de IVA, total destacado, forma de pago o
// condiciones. Factura y presupuesto se convierten primero a un DocView común
// que pintan igual el PDF y la vista previa en pantalla.

import jsPDF from "jspdf";
import {
  BillingInvoice, BillingLine, BillingParty, BillingQuote, BillingSettings, eur, fmtDay, invoiceMonths, invoiceTotals, lineTotal, monthName, monthsLabel,
  partyLines, phaseMonthlyBase, quoteGrandTotal,
} from "./billing";

type Issuer = BillingParty & { phone?: string; iban?: string; bank?: string; footer?: string };

export interface DocView {
  title: string;
  number: string | null;
  watermark: string;
  issuer: Issuer;
  client: BillingParty;
  meta: [string, string][];
  banner: string;
  lines: BillingLine[];
  totals: { baseAmount: number; vatAmount: number; totalAmount: number; vatBreakdown: { rate: number; base: number; vat: number }[] };
  totalLabel: string;
  extraTotals: [string, string][];
  payment: string[];
  notesTitle: string;
  notes: string;
  conditions: string;
  signature: boolean;
}

export function periodLabel(inv: Pick<BillingInvoice, "periodType" | "periodMonth" | "periodMonths" | "projectName">) {
  if (inv.periodType === "monthly" && invoiceMonths(inv).length) return `Mensual · ${monthsLabel(invoiceMonths(inv))}`;
  if (inv.periodType === "project") return "Proyecto";
  return "";
}

const iban = (s?: string) => (s || "").replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

export function invoiceView(inv: BillingInvoice, settings: BillingSettings): DocView {
  const issuer = (inv.issuer || settings) as Issuer;
  const totals = inv.status === "draft" ? invoiceTotals(inv.lines) : { baseAmount: inv.baseAmount, vatAmount: inv.vatAmount, totalAmount: inv.totalAmount, vatBreakdown: inv.vatBreakdown };
  const meta: [string, string][] = [["Fecha de emisión", fmtDay(inv.issueDate)]];
  if (inv.kind === "standard") meta.push(["Vencimiento", fmtDay(inv.dueDate)]);
  if (inv.projectName) meta.push([inv.subject === "budgeting" ? "Servicio" : inv.subject === "other" ? "Concepto" : "Proyecto", inv.projectName]);
  if (inv.periodType === "monthly" && invoiceMonths(inv).length) meta.push(["Periodo", monthsLabel(invoiceMonths(inv))]);
  if (inv.quoteNumber) meta.push(["Presupuesto", inv.quoteNumber]);
  return {
    title: inv.kind === "rectifying" ? "Factura rectificativa" : inv.status === "draft" ? "Borrador de factura" : "Factura",
    number: inv.number,
    watermark: inv.status === "draft" ? "BORRADOR" : inv.status === "voided" ? "ANULADA" : "",
    issuer, client: inv.client, meta,
    banner: inv.kind === "rectifying" && inv.rectifies
      ? `Rectifica la factura ${inv.rectifies.number} de ${fmtDay(inv.rectifies.issueDate)}${inv.reason ? `. Motivo: ${inv.reason}` : ""}. Anulación total (art. 15 del RD 1619/2012).`
      : "",
    lines: inv.lines, totals, totalLabel: "Total", extraTotals: [],
    payment: inv.kind === "standard" && issuer.iban
      ? [`Transferencia bancaria a ${iban(issuer.iban)}${issuer.bank ? ` (${issuer.bank})` : ""}.`, `Vencimiento: ${fmtDay(inv.dueDate)}. Indica el número de factura en el concepto.`]
      : [],
    notesTitle: "Notas", notes: inv.notes || "", conditions: "", signature: false,
  };
}

export function quoteView(q: BillingQuote, settings: BillingSettings): DocView {
  const issuer = (q.issuer || settings) as Issuer;
  const totals = q.status === "draft" ? invoiceTotals(q.lines) : { baseAmount: q.baseAmount, vatAmount: q.vatAmount, totalAmount: q.totalAmount, vatBreakdown: q.vatBreakdown };
  const monthly = q.billingMode === "monthly";
  const phased = q.billingMode === "phases";
  const grand = quoteGrandTotal({ ...q, ...totals });
  const meta: [string, string][] = [["Fecha", fmtDay(q.issueDate)], ["Válido hasta", fmtDay(q.validUntil)], [q.subject === "budgeting" ? "Servicio" : q.subject === "other" ? "Concepto" : "Proyecto", q.projectName || "—"]];
  if ((monthly || phased) && q.startMonth) meta.push(["Inicio", monthName(q.startMonth)]);
  const phaseText = (q.phases || []).map((p) => `${p.name}: ${p.months} ${p.months === 1 ? "mes" : "meses"} × ${eur(phaseMonthlyBase(p))}`).join(" · ");
  return {
    title: q.status === "draft" ? "Borrador de presupuesto" : "Presupuesto",
    number: q.number,
    watermark: q.status === "draft" ? "BORRADOR" : q.status === "rejected" ? "RECHAZADO" : "",
    issuer, client: q.client, meta,
    banner: q.title || "",
    lines: q.lines, totals,
    totalLabel: monthly ? "Total al mes" : "Total",
    extraTotals: monthly && q.months ? [[`Total ${q.months} ${q.months === 1 ? "mes" : "meses"} (IVA incl.)`, eur(grand.total)], [`Base ${q.months} ${q.months === 1 ? "mes" : "meses"}`, eur(grand.base)]] : [],
    payment: [phased
      ? `Facturación mensual por fases (+ IVA). ${phaseText}${q.startMonth ? `, desde ${monthName(q.startMonth)}` : ""}.`
      : monthly
      ? `Cuota mensual de ${eur(totals.baseAmount)} + IVA${q.months ? ` durante ${q.months} ${q.months === 1 ? "mes" : "meses"}` : ""}${q.startMonth ? ` desde ${monthName(q.startMonth)}` : ""}, facturada cada mes.`
      : `Pago único de ${eur(totals.baseAmount)} + IVA, facturable en uno o varios plazos.`],
    notesTitle: "Notas", notes: q.notes || "", conditions: q.conditions || "", signature: true,
  };
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const INK: RGB = [15, 23, 42];
const TEXT: RGB = [51, 65, 85];
const MUTED: RGB = [100, 116, 139];
const FAINT: RGB = [148, 163, 184];
const LINE: RGB = [226, 232, 240];
const ACCENT: RGB = [36, 64, 110]; // #24406E, el azul del degradado

let headerCache: string | null = null;
async function headerImage(): Promise<string | null> {
  if (headerCache) return headerCache;
  try {
    const blob = await (await fetch("/email/header.jpg")).blob();
    headerCache = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return headerCache;
  } catch { return null; }
}

export async function buildDocPdf(v: DocView): Promise<jsPDF> {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 18, BOTTOM = 272;
  const set = (size: number, color: RGB, style: "normal" | "bold" = "normal") => { pdf.setFont("helvetica", style); pdf.setFontSize(size); pdf.setTextColor(...color); };
  const ensure = (h: number) => { if (y + h > BOTTOM) { pdf.addPage(); y = 24; } };

  const img = await headerImage();
  if (img) pdf.addImage(img, "JPEG", 0, 0, W, 42);
  else { pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 42, "F"); }
  set(9, [255, 255, 255]);
  pdf.text(v.title.toUpperCase(), W - M, 17, { align: "right" });
  set(18, [255, 255, 255], "bold");
  pdf.text(v.number || "Sin número", W - M, 26, { align: "right" });

  if (v.watermark) {
    pdf.saveGraphicsState();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdf.setGState(new (pdf as any).GState({ opacity: 0.07 }));
    set(v.watermark.length > 8 ? 74 : 90, INK, "bold");
    pdf.text(v.watermark, W / 2, 175, { align: "center", angle: 30 });
    pdf.restoreGraphicsState();
  }

  let y = 56;
  const block = (x: number, label: string, title: string, lines: string[], w: number) => {
    set(7.5, FAINT, "bold"); pdf.text(label.toUpperCase(), x, y, { charSpace: 0.5 });
    set(10.5, INK, "bold"); const t = pdf.splitTextToSize(title || "—", w); pdf.text(t, x, y + 6);
    set(8.5, TEXT);
    let yy = y + 6 + t.length * 5;
    for (const l of lines) { const parts = pdf.splitTextToSize(l, w); pdf.text(parts, x, yy); yy += parts.length * 4.2; }
    return yy;
  };
  const partyText = (p: BillingParty) => [p.taxId ? `NIF ${p.taxId}` : "", ...partyLines(p), p.email || ""].filter(Boolean);
  const y1 = block(M, "Emisor", v.issuer.name, partyText(v.issuer), 56);
  const y2 = block(M + 62, "Cliente", v.client.name, partyText(v.client), 56);
  let ym = y;
  for (const [k, val] of v.meta) {
    set(7.5, FAINT, "bold"); pdf.text(k.toUpperCase(), W - M, ym, { align: "right" });
    set(9.5, INK); const t = pdf.splitTextToSize(val, 46); pdf.text(t, W - M, ym + 5, { align: "right" });
    ym += 7 + t.length * 4.6;
  }
  y = Math.max(y1, y2, ym) + 5;

  if (v.banner) {
    pdf.setFillColor(248, 250, 252); pdf.setDrawColor(...LINE);
    set(9, INK, "bold");
    const txt = pdf.splitTextToSize(v.banner, W - 2 * M - 8);
    const h = 6 + txt.length * 4.4;
    pdf.roundedRect(M, y, W - 2 * M, h, 1.5, 1.5, "FD");
    pdf.text(txt, M + 4, y + 5.6);
    y += h + 7;
  }

  const cols = [
    { label: "Concepto", x: M, w: 84, align: "left" as const },
    { label: "Cant.", x: M + 104, align: "right" as const },
    { label: "Precio", x: M + 128, align: "right" as const },
    { label: "IVA", x: M + 142, align: "right" as const },
    { label: "Importe", x: W - M, align: "right" as const },
  ];
  set(7.5, MUTED, "bold");
  cols.forEach((c) => pdf.text(c.label.toUpperCase(), c.x, y, c.align === "left" ? { charSpace: 0.4 } : { align: "right" }));
  y += 2.5; pdf.setDrawColor(...INK); pdf.setLineWidth(0.3); pdf.line(M, y, W - M, y); y += 6;
  const fmtQty = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);
  for (const l of v.lines) {
    set(9.5, INK);
    const desc = pdf.splitTextToSize(l.description || "—", cols[0].w!);
    ensure(desc.length * 4.4 + 6);
    set(9.5, INK); pdf.text(desc, M, y);
    set(9.5, TEXT);
    pdf.text(fmtQty(l.quantity), cols[1].x, y, { align: "right" });
    pdf.text(eur(l.unitPrice), cols[2].x, y, { align: "right" });
    pdf.text(`${l.vatRate} %`, cols[3].x, y, { align: "right" });
    set(9.5, INK); pdf.text(eur(lineTotal(l)), cols[4].x, y, { align: "right" });
    y += desc.length * 4.4 + 2.6;
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, y - 1.2, W - M, y - 1.2); y += 3.4;
  }

  ensure(36 + v.extraTotals.length * 6);
  y += 2;
  const tx = W - M - 72;
  const row = (k: string, val: string, muted = true) => { set(9.5, muted ? MUTED : INK); pdf.text(k, tx, y); set(9.5, INK); pdf.text(val, W - M, y, { align: "right" }); y += 6; };
  row("Base imponible", eur(v.totals.baseAmount));
  v.totals.vatBreakdown.forEach((b) => row(`IVA ${b.rate} %`, eur(b.vat)));
  y += 1;
  pdf.setFillColor(...ACCENT);
  pdf.roundedRect(tx - 4, y - 5, W - M - tx + 4, 12, 1.5, 1.5, "F");
  set(10, [255, 255, 255], "bold"); pdf.text(v.totalLabel, tx, y + 2.6);
  set(13, [255, 255, 255], "bold"); pdf.text(eur(v.totals.totalAmount), W - M - 3, y + 2.8, { align: "right" });
  y += 14;
  v.extraTotals.forEach(([k, val], i) => row(k, val, i !== 0));
  y += 6;

  const section = (title: string, body: string[], size = 9) => {
    if (!body.length || !body.some(Boolean)) return;
    const lines = body.flatMap((b) => pdf.splitTextToSize(b, W - 2 * M));
    ensure(8 + lines.length * 4.3);
    set(7.5, FAINT, "bold"); pdf.text(title.toUpperCase(), M, y, { charSpace: 0.5 });
    set(size, TEXT); pdf.text(lines, M, y + 5);
    y += 9 + lines.length * 4.3;
  };
  section(v.signature ? "Facturación" : "Forma de pago", v.payment);
  section("Condiciones", [v.conditions], 8.5);
  section(v.notesTitle, [v.notes]);

  if (v.signature) {
    ensure(34);
    y += 4;
    set(7.5, FAINT, "bold"); pdf.text("ACEPTADO POR EL CLIENTE", M, y, { charSpace: 0.5 });
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.3);
    pdf.line(M, y + 20, M + 75, y + 20); pdf.line(M + 90, y + 20, M + 135, y + 20);
    set(7.5, MUTED); pdf.text("Nombre, firma y sello", M, y + 24.5); pdf.text("Fecha", M + 90, y + 24.5);
    y += 30;
  }

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINE); pdf.setLineWidth(0.2); pdf.line(M, 280, W - M, 280);
    set(7.5, FAINT);
    const legal = [v.issuer.name, v.issuer.taxId && `NIF ${v.issuer.taxId}`, partyLines(v.issuer).join(", ")].filter(Boolean).join(" · ");
    pdf.text(pdf.splitTextToSize(v.issuer.footer || legal, 150), M, 285);
    pdf.text(`${v.number || "Borrador"} · ${i}/${pages}`, W - M, 285, { align: "right" });
  }
  return pdf;
}

export const docFileName = (v: DocView) =>
  `${v.number || "borrador"}_${(v.client.name || "cliente").replace(/[^a-zA-Z0-9]+/g, "_")}.pdf`;

export async function downloadDocPdf(v: DocView) {
  const pdf = await buildDocPdf(v);
  pdf.save(docFileName(v));
}

export async function docPdfBase64(v: DocView) {
  const pdf = await buildDocPdf(v);
  return pdf.output("datauristring").split(",")[1];
}
