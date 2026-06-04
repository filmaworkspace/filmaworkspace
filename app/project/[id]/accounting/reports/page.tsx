"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeft,
  Banknote,
  BookMarked,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  FileSpreadsheet,
  FileText,
  Film,
  GripVertical,
  Layers,
  Minus,
  Plus,
  Receipt,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import { strToU8, zipSync } from "fflate";

// ─── Internal ────────────────────────────────────────────────────────────────
import { CostSettings, getCostSettings, shouldCommitPO, shouldRealizeInvoice } from "@/lib/budgetRules";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

type ReportType = "budget" | "pos_list" | "pos_items" | "invoices" | "invoices_accounting" | "suppliers" | "payments" | "cost_report" | "box_cards" | "box_transfers";

interface ReportColumn {
  id: string;
  label: string;
  enabled: boolean;
  locked?: boolean;
  isBlank?: boolean;
}

interface SelectedColumn {
  id: string;
  originalId: string;
  label: string;
  isBlank?: boolean;
}

interface ReportPreset {
  id: string;
  name: string;
  reportType: ReportType;
  columns: { id: string; isBlank?: boolean }[];
  createdAt: string;
}

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName?: string;
  taxId?: string;
}

interface InvoiceBookFilters {
  supplierId: string;
  supplierName: string;
  dateFrom: string;
  dateTo: string;
  paymentStatus: "all" | "paid" | "pending";
  includeCancelled: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const REPORT_COLUMNS: Record<ReportType, ReportColumn[]> = {
  budget: [
    { id: "code", label: "Código", enabled: true, locked: true },
    { id: "description", label: "Descripción", enabled: true },
    { id: "type", label: "Tipo", enabled: true },
    { id: "budgeted", label: "Presupuestado", enabled: true },
    { id: "committed", label: "Comprometido", enabled: true },
    { id: "actual", label: "Realizado", enabled: true },
    { id: "available", label: "Disponible", enabled: true },
    { id: "percentUsed", label: "% Utilizado", enabled: false },
  ],
  pos_list: [
    { id: "number", label: "Nº PO", enabled: true, locked: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "description", label: "Descripción", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxAmount", label: "IVA", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "isOpen", label: "Abierta/Cerrada", enabled: true },
    { id: "createdAt", label: "Fecha creación", enabled: true },
    { id: "createdBy", label: "Creado por", enabled: false },
    { id: "approvedAt", label: "Fecha aprobación", enabled: false },
    { id: "approvedBy", label: "Aprobado por", enabled: false },
    { id: "itemCount", label: "Nº ítems", enabled: false },
  ],
  pos_items: [
    { id: "poNumber", label: "Nº PO", enabled: true, locked: true },
    { id: "poDescription", label: "Descripción PO", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "itemNumber", label: "Nº Ítem", enabled: true },
    { id: "itemDescription", label: "Descripción ítem", enabled: true },
    { id: "episode", label: "Capítulo", enabled: true },
    { id: "accountCode", label: "Código cuenta", enabled: true },
    { id: "accountDescription", label: "Cuenta", enabled: false },
    { id: "subaccountCode", label: "Código subcuenta", enabled: true },
    { id: "subaccountDescription", label: "Subcuenta", enabled: false },
    { id: "baseCommitted", label: "Base comprometido", enabled: true },
    { id: "totalCommitted", label: "Total comprometido", enabled: true },
    { id: "baseInvoiced", label: "Base facturado", enabled: true },
    { id: "baseAvailable", label: "Base disponible", enabled: true },
    { id: "totalAvailable", label: "Total disponible", enabled: true },
    { id: "poStatus", label: "Estado PO", enabled: true },
    { id: "isOpen", label: "Abierta/Cerrada", enabled: true },
    { id: "itemClosed", label: "Item cerrado", enabled: false },
    { id: "taxRate", label: "% IVA", enabled: false },
    { id: "irpfRate", label: "% IRPF", enabled: false },
  ],
  invoices: [
    { id: "number", label: "Nº Factura", enabled: true, locked: true },
    { id: "supplierNumber", label: "Nº Factura proveedor", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: false },
    { id: "description", label: "Descripción", enabled: true },
    { id: "poNumber", label: "Nº PO asociada", enabled: true },
    { id: "episode", label: "Capítulo", enabled: true },
    { id: "accountCode", label: "Cuenta contable", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxAmount", label: "IVA", enabled: true },
    { id: "irpfAmount", label: "IRPF", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "coded", label: "Codificada", enabled: true },
    { id: "accounted", label: "Contabilizada", enabled: true },
    { id: "invoiceDate", label: "Fecha factura", enabled: true },
    { id: "dueDate", label: "Vencimiento", enabled: true },
    { id: "createdAt", label: "Fecha registro", enabled: false },
    { id: "paidAt", label: "Fecha pago", enabled: false },
  ],
  invoices_accounting: [
    { id: "accountingEntryNumber", label: "Nº Asiento", enabled: true, locked: true },
    { id: "number", label: "Nº Factura", enabled: true },
    { id: "supplierNumber", label: "Nº Factura proveedor", enabled: true },
    { id: "invoiceDate", label: "Fecha factura", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: true },
    { id: "supplierIban", label: "IBAN", enabled: false },
    { id: "description", label: "Concepto", enabled: true },
    { id: "accountCode", label: "Cuenta contable", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxRate", label: "% IVA", enabled: true },
    { id: "taxAmount", label: "Cuota IVA", enabled: true },
    { id: "irpfRate", label: "% IRPF", enabled: false },
    { id: "irpfAmount", label: "Retención IRPF", enabled: false },
    { id: "totalAmount", label: "Total factura", enabled: true },
    { id: "dueDate", label: "Vencimiento", enabled: true },
    { id: "status", label: "Estado pago", enabled: true },
    { id: "paidAt", label: "Fecha pago", enabled: false },
    { id: "accountedAt", label: "Fecha contabilización", enabled: true },
    { id: "accountedBy", label: "Contabilizado por", enabled: false },
  ],
  suppliers: [
    { id: "fiscalName", label: "Nombre fiscal", enabled: true, locked: true },
    { id: "commercialName", label: "Nombre comercial", enabled: true },
    { id: "taxId", label: "NIF/CIF", enabled: true },
    { id: "contactName", label: "Contacto", enabled: true },
    { id: "contactEmail", label: "Email", enabled: true },
    { id: "contactPhone", label: "Teléfono", enabled: true },
    { id: "address", label: "Dirección", enabled: false },
    { id: "city", label: "Ciudad", enabled: false },
    { id: "postalCode", label: "CP", enabled: false },
    { id: "paymentMethod", label: "Método pago", enabled: true },
    { id: "iban", label: "IBAN", enabled: true },
    { id: "paymentTerms", label: "Plazo pago", enabled: false },
    { id: "totalPOs", label: "Total POs", enabled: false },
    { id: "totalInvoiced", label: "Total facturado", enabled: false },
  ],
  payments: [
    { id: "paymentNumber", label: "Nº Pago", enabled: true, locked: true },
    { id: "invoiceNumber", label: "Nº Factura", enabled: true },
    { id: "supplierNumber", label: "Nº Factura proveedor", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: true },
    { id: "supplierIban", label: "IBAN", enabled: true },
    { id: "description", label: "Concepto", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "totalAmount", label: "Total pagado", enabled: true },
    { id: "paymentMethod", label: "Método pago", enabled: true },
    { id: "paidAt", label: "Fecha pago", enabled: true },
    { id: "paidBy", label: "Pagado por", enabled: false },
    { id: "accountingEntryNumber", label: "Nº Asiento", enabled: true },
  ],
  cost_report: [
    { id: "accountCode", label: "Cuenta", enabled: true, locked: true },
    { id: "accountDescription", label: "Descripción cuenta", enabled: true },
    { id: "budgeted", label: "Presupuestado", enabled: true },
    { id: "committed", label: "Comprometido", enabled: true },
    { id: "invoiced", label: "Facturado", enabled: true },
    { id: "paid", label: "Pagado", enabled: true },
    { id: "pendingPayment", label: "Pendiente pago", enabled: true },
    { id: "available", label: "Disponible", enabled: true },
    { id: "percentExecuted", label: "% Ejecutado", enabled: true },
    { id: "deviation", label: "Desviación", enabled: false },
  ],
  box_cards: [
    { id: "envelopeNumber", label: "Nº Sobre", enabled: true, locked: true },
    { id: "cardName", label: "Tarjeta", enabled: true },
    { id: "expenseNumber", label: "Nº Gasto", enabled: true },
    { id: "type", label: "Tipo", enabled: true },
    { id: "date", label: "Fecha", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "description", label: "Descripción", enabled: true },
    { id: "accountCode", label: "Cuenta", enabled: true },
    { id: "baseAmount", label: "Base", enabled: true },
    { id: "vatRate", label: "% IVA", enabled: false },
    { id: "vatAmount", label: "IVA", enabled: true },
    { id: "irpfRate", label: "% IRPF", enabled: false },
    { id: "irpfAmount", label: "IRPF", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado sobre", enabled: true },
    { id: "createdAt", label: "Fecha registro", enabled: false },
    { id: "createdBy", label: "Registrado por", enabled: false },
  ],
  box_transfers: [
    { id: "envelopeNumber", label: "Nº Sobre", enabled: true, locked: true },
    { id: "paymentDate", label: "Fecha pago", enabled: true },
    { id: "personName", label: "Persona", enabled: true },
    { id: "personDepartment", label: "Departamento", enabled: true },
    { id: "personIban", label: "IBAN", enabled: false },
    { id: "type", label: "Tipo", enabled: true },
    { id: "date", label: "Fecha gasto", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "description", label: "Descripción", enabled: false },
    { id: "accountCode", label: "Cuenta", enabled: true },
    { id: "baseAmount", label: "Base", enabled: true },
    { id: "vatRate", label: "% IVA", enabled: false },
    { id: "vatAmount", label: "IVA", enabled: true },
    { id: "irpfRate", label: "% IRPF", enabled: false },
    { id: "irpfAmount", label: "IRPF", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado sobre", enabled: true },
    { id: "transferReference", label: "Ref. transferencia", enabled: true },
    { id: "transferredAt", label: "Fecha transferencia", enabled: false },
  ],
};

const REPORT_INFO: Record<ReportType, { title: string; icon: any; section: string }> = {
  budget: { title: "Presupuesto", icon: Wallet, section: "presupuesto" },
  cost_report: { title: "Informe de costes", icon: FileSpreadsheet, section: "presupuesto" },
  pos_list: { title: "Listado de POs", icon: FileText, section: "pos" },
  pos_items: { title: "POs desglosado por ítems", icon: Layers, section: "pos" },
  invoices: { title: "Listado de facturas", icon: Receipt, section: "facturas" },
  invoices_accounting: { title: "Libro de facturas", icon: BookMarked, section: "facturas" },
  payments: { title: "Registro de pagos", icon: Wallet, section: "facturas" },
  box_cards: { title: "Gastos de tarjeta", icon: CreditCard, section: "box" },
  box_transfers: { title: "Transferencias de caja", icon: Banknote, section: "box" },
  suppliers: { title: "Proveedores", icon: Building2, section: "otros" },
};

const REPORT_SECTIONS = [
  { id: "presupuesto", title: "Presupuesto", reports: ["budget", "cost_report"] as ReportType[] },
  { id: "pos", title: "Órdenes de compra", reports: ["pos_list", "pos_items"] as ReportType[] },
  { id: "facturas", title: "Facturas y pagos", reports: ["invoices", "invoices_accounting", "payments"] as ReportType[] },
  { id: "box", title: "BOX", reports: ["box_cards", "box_transfers"] as ReportType[] },
  { id: "otros", title: "Otros", reports: ["suppliers"] as ReportType[] },
];

// ─── XLSX builder (same style as handleExportEnvelope in boxes/page.tsx) ──────
//
// Style indices:
//   0 = default
//   1 = title row  (white bold 13pt on dark #1E293B, vertically centered)
//   2 = header row (white bold 11pt on orange #F97316, horizontally+vertically centered)
//   3 = totals row (bold 11pt, no fill)

function buildXlsx(
  headers: string[],
  dataRows: (string | number)[][],
  titleText: string,
  // indices of columns that are numeric and should get SUM totals
  numericColIndices: number[],
): Uint8Array {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const colLetter = (n: number): string => {
    let s = "";
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };

  const numCols = headers.length;
  const dataStart = 3; // row 1 = title, row 2 = headers, row 3.. = data
  const dataEnd = dataStart + dataRows.length - 1;
  const totalRowNum = dataEnd + 1;

  const cellXml = (col: number, row: number, val: string | number, styleIdx = 0): string => {
    const addr = colLetter(col) + row;
    const s = styleIdx > 0 ? ` s="${styleIdx}"` : "";
    if (typeof val === "number") return `<c r="${addr}"${s}><v>${val}</v></c>`;
    if (typeof val === "string" && val.startsWith("="))
      return `<c r="${addr}" t="str"${s}><f>${esc(val.slice(1))}</f></c>`;
    return `<c r="${addr}" t="inlineStr"${s}><is><t>${esc(String(val))}</t></is></c>`;
  };

  // Row 1: title
  let sheetRows = `<row r="1" ht="22" customHeight="1">${
    cellXml(0, 1, titleText, 1)
  }${Array.from({ length: numCols - 1 }, (_, i) =>
    `<c r="${colLetter(i + 1)}1" s="1"/>`
  ).join("")}</row>`;

  // Row 2: column headers (orange)
  sheetRows += `<row r="2" ht="18" customHeight="1">${
    headers.map((h, c) => cellXml(c, 2, h, 2)).join("")
  }</row>`;

  // Data rows
  dataRows.forEach((row, ri) => {
    const r = ri + dataStart;
    sheetRows += `<row r="${r}">${row.map((v, c) => cellXml(c, r, v)).join("")}</row>`;
  });

  // Totals row: SUM formulas for numeric columns, bold style for all
  if (dataRows.length > 0) {
    const totalRow: (string | number)[] = new Array(numCols).fill("");
    totalRow[0] = "TOTAL";
    numericColIndices.forEach(ci => {
      totalRow[ci] = `=SUM(${colLetter(ci)}${dataStart}:${colLetter(ci)}${dataEnd})`;
    });
    sheetRows += `<row r="${totalRowNum}">${
      totalRow.map((v, c) => v !== "" ? cellXml(c, totalRowNum, v, 3) : "").join("")
    }</row>`;
  }

  // Auto column widths: try to fit header text, cap at 30
  const colWidths = headers.map(h => Math.min(Math.max(h.length + 4, 10), 30));

  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join("");

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF97316"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${colsXml}</cols>
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Informe" sheetId="1" r:id="rId1"/></sheets></workbook>`;

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

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(wbRels),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/styles.xml": strToU8(stylesXml),
    "xl/sharedStrings.xml": strToU8(sharedStringsXml),
  };

  return zipSync(files);
}

// Detect which column indices in a data row contain numbers
function detectNumericCols(dataRows: (string | number)[][]): number[] {
  if (dataRows.length === 0) return [];
  const first = dataRows[0];
  return first
    .map((v, i) => (typeof v === "number" ? i : -1))
    .filter(i => i >= 0);
}

// Trigger browser download of an xlsx Uint8Array
function downloadXLSX(
  columns: SelectedColumn[],
  dataRows: (string | number)[][],
  titleText: string,
  filename: string,
) {
  const headers = columns.map(c => (c.isBlank ? "" : c.label));
  const numericCols = detectNumericCols(dataRows);
  const xlsxBytes = buildXlsx(headers, dataRows, titleText, numericCols);
  const blob = new Blob([xlsxBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : filename + ".xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
// ─────────────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [counts, setCounts] = useState({ pos: 0, invoices: 0, suppliers: 0, accounts: 0, cardExpenses: 0, transferExpenses: 0 });
  const [userId, setUserId] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  
  const [showConfig, setShowConfig] = useState(false);
  const [configReportType, setConfigReportType] = useState<ReportType | null>(null);
  const [availableColumns, setAvailableColumns] = useState<ReportColumn[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([]);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [expandedReport, setExpandedReport] = useState<ReportType | null>(null);

  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [splitByEpisode, setSplitByEpisode] = useState(false);

  const [costConfig, setCostConfig] = useState<CostSettings>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_paid",
  });

  // Invoice Book Modal states
  const [showInvoiceBookModal, setShowInvoiceBookModal] = useState(false);
  const [invoiceBookFilters, setInvoiceBookFilters] = useState<InvoiceBookFilters>({
    supplierId: "",
    supplierName: "",
    dateFrom: "",
    dateTo: "",
    paymentStatus: "all",
    includeCancelled: false,
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  useEffect(() => {
    const savedPresets = localStorage.getItem(`report_presets_${id}`);
    if (savedPresets) setPresets(JSON.parse(savedPresets));
  }, [id]);

  const savePresetsToStorage = (newPresets: ReportPreset[]) => {
    localStorage.setItem(`report_presets_${id}`, JSON.stringify(newPresets));
    setPresets(newPresets);
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) router.push("/");
      else setUserId(user.uid);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
      const userProjectSnap = await getDoc(userProjectRef);
      if (!userProjectSnap.exists()) {
        setAccessError("No tienes acceso a este proyecto");
        setLoading(false);
        return;
      }
      
      const userProjectData = userProjectSnap.data();
      const hasAccountingAccess = userProjectData.permissions?.accounting || false;
      const accountingLevel = userProjectData.accountingAccessLevel;
      
      const memberRef = doc(db, `projects/${id}/members`, userId!);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role);
      const hasReportsAccess = accountingLevel === "accounting_extended" || accountingLevel === "accounting";
      
      if (!hasAccountingAccess || (!isEPorPM && !hasReportsAccess)) {
        setAccessError("No tienes permisos para acceder a los informes");
        setLoading(false);
        return;
      }
      setHasAccess(true);
      
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");
      
      const [posSnap, invoicesSnap, suppliersSnap, accountsSnap, cardExpensesSnap, transferExpensesSnap] = await Promise.all([
        getDocs(collection(db, `projects/${id}/pos`)),
        getDocs(collection(db, `projects/${id}/invoices`)),
        getDocs(collection(db, `projects/${id}/suppliers`)),
        getDocs(collection(db, `projects/${id}/accounts`)),
        getDocs(collection(db, `projects/${id}/cardExpenses`)),
        getDocs(collection(db, `projects/${id}/transferExpenses`)),
      ]);
      setCounts({ 
        pos: posSnap.size, 
        invoices: invoicesSnap.size, 
        suppliers: suppliersSnap.size, 
        accounts: accountsSnap.size,
        cardExpenses: cardExpensesSnap.size,
        transferExpenses: transferExpensesSnap.size,
      });

      try {
        const productionDoc = await getDoc(doc(db, `projects/${id}/config/production`));
        if (productionDoc.exists()) {
          const prodData = productionDoc.data();
          if (prodData.projectType === "serie") {
            setTotalEpisodes(prodData.episodes || 0);
            const projectConfigDoc = await getDoc(doc(db, `projects/${id}/config/project`));
            if (projectConfigDoc.exists()) {
              const configData = projectConfigDoc.data();
              setEpisodesEnabled(configData.enableEpisodes || false);
            }
          }
        }
      } catch (epErr) {
        console.error("Error loading episodes config:", epErr);
      }

      try {
        const loadedCostConfig = await getCostSettings(id);
        setCostConfig(loadedCostConfig);
      } catch (ctErr) {
        console.error("Error loading cost config:", ctErr);
      }
    } catch (error) { 
      console.error("Error cargando datos:", error); 
    } finally { 
      setLoading(false); 
    }
  };

  // Load suppliers for typeahead
  const loadSuppliers = async () => {
    if (suppliers.length > 0) return;
    setLoadingSuppliers(true);
    try {
      const suppliersSnap = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName", "asc")));
      const loadedSuppliers: Supplier[] = suppliersSnap.docs.map(doc => ({
        id: doc.id,
        fiscalName: doc.data().fiscalName || "",
        commercialName: doc.data().commercialName || "",
        taxId: doc.data().taxId || "",
      }));
      setSuppliers(loadedSuppliers);
    } catch (error) {
      console.error("Error loading suppliers:", error);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const openInvoiceBookModal = () => {
    loadSuppliers();
    setInvoiceBookFilters({ supplierId: "", supplierName: "", dateFrom: "", dateTo: "", paymentStatus: "all", includeCancelled: false });
    setSupplierSearch("");
    setShowSupplierDropdown(false);
    setShowInvoiceBookModal(true);
  };

  const selectSupplier = (supplier: Supplier) => {
    setInvoiceBookFilters({ ...invoiceBookFilters, supplierId: supplier.id, supplierName: supplier.fiscalName });
    setSupplierSearch(supplier.fiscalName);
    setShowSupplierDropdown(false);
  };

  const clearSupplier = () => {
    setInvoiceBookFilters({ ...invoiceBookFilters, supplierId: "", supplierName: "" });
    setSupplierSearch("");
  };

  const filteredSuppliers = supplierSearch.length >= 2
    ? suppliers.filter(s => 
        s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) ||
        (s.commercialName && s.commercialName.toLowerCase().includes(supplierSearch.toLowerCase())) ||
        (s.taxId && s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()))
      ).slice(0, 10)
    : [];

  const openConfig = (reportType: ReportType) => {
    setConfigReportType(reportType);
    const cols = REPORT_COLUMNS[reportType];
    setAvailableColumns(cols.filter(c => !c.enabled));
    setSelectedColumns(
      cols.filter(c => c.enabled).map((c, i) => ({ id: `${c.id}_${i}`, originalId: c.id, label: c.label }))
    );
    setShowConfig(true);
  };

  const addColumn = (column: ReportColumn) => {
    setSelectedColumns([...selectedColumns, { id: `${column.id}_${Date.now()}`, originalId: column.id, label: column.label }]);
    setAvailableColumns(availableColumns.filter(c => c.id !== column.id));
  };

  const removeColumn = (columnId: string, originalId: string) => {
    const colDef = REPORT_COLUMNS[configReportType!].find(c => c.id === originalId);
    if (colDef?.locked) return;
    setSelectedColumns(selectedColumns.filter(c => c.id !== columnId));
    if (!colDef?.isBlank) {
      const original = REPORT_COLUMNS[configReportType!].find(c => c.id === originalId);
      if (original && !availableColumns.find(c => c.id === originalId))
        setAvailableColumns([...availableColumns, original]);
    }
  };

  const addBlankColumn = () => {
    setSelectedColumns([...selectedColumns, { id: `blank_${Date.now()}`, originalId: "blank", label: "(Columna vacía)", isBlank: true }]);
  };

  const handleDragStart = (index: number) => setDraggedItem(index);
  const handleDragOver = (e: React.DragEvent, index: number) => { e.preventDefault(); setDragOverItem(index); };
  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedItem === null) return;
    const newColumns = [...selectedColumns];
    const draggedColumn = newColumns[draggedItem];
    newColumns.splice(draggedItem, 1);
    newColumns.splice(dropIndex, 0, draggedColumn);
    setSelectedColumns(newColumns);
    setDraggedItem(null);
    setDragOverItem(null);
  };
  const handleDragEnd = () => { setDraggedItem(null); setDragOverItem(null); };

  const getDefaultColumns = (reportType: ReportType): SelectedColumn[] =>
    REPORT_COLUMNS[reportType].filter(c => c.enabled).map((c, i) => ({ id: `${c.id}_${i}`, originalId: c.id, label: c.label }));

  const savePreset = () => {
    if (!newPresetName.trim() || !configReportType) return;
    const newPreset: ReportPreset = {
      id: `preset_${Date.now()}`,
      name: newPresetName.trim(),
      reportType: configReportType,
      columns: selectedColumns.map(c => ({ id: c.originalId, isBlank: c.isBlank })),
      createdAt: new Date().toISOString(),
    };
    savePresetsToStorage([...presets, newPreset]);
    setNewPresetName("");
    setShowSavePreset(false);
  };

  const deletePreset = (presetId: string) => savePresetsToStorage(presets.filter(p => p.id !== presetId));

  const loadPreset = (preset: ReportPreset) => {
    const cols = preset.columns.map((c, i) => {
      if (c.isBlank) return { id: `blank_${i}`, originalId: "blank", label: "(Columna vacía)", isBlank: true };
      const original = REPORT_COLUMNS[preset.reportType].find(col => col.id === c.id);
      return { id: `${c.id}_${i}`, originalId: c.id, label: original?.label || c.id };
    });
    setSelectedColumns(cols);
    const usedIds = cols.filter(c => !c.isBlank).map(c => c.originalId);
    setAvailableColumns(REPORT_COLUMNS[preset.reportType].filter(c => !usedIds.includes(c.id)));
  };

  // ── helpers ────────────────────────────────────────────────────────────────
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  const formatDate = (date: any) => date?.toDate ? new Date(date.toDate()).toLocaleDateString("es-ES") : "";
  const getCurrentDate = () => new Date().toISOString().split("T")[0];

  // Build a title string "PROJECT · Report name"
  const makeTitle = (reportType: ReportType) =>
    `${projectName ? projectName.toUpperCase() + " · " : ""}${REPORT_INFO[reportType].title.toUpperCase()}`;

  // Convert a row of mixed values:
  //   - numbers stay as numbers (so XLSX can SUM them)
  //   - everything else becomes a string
  const toXlsxRow = (
    columns: SelectedColumn[],
    rowData: Record<string, any>,
  ): (string | number)[] =>
    columns.map(col => {
      if (col.isBlank) return "";
      const val = rowData[col.originalId];
      if (typeof val === "number") return val;
      return val?.toString() || "";
    });

  // ── report generators ──────────────────────────────────────────────────────

  const generateBudgetReport = async (columns: SelectedColumn[]) => {
    setGenerating("budget");
    try {
      const accountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const dataRows: (string | number)[][] = [];
      
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        
        let accountBudgeted = 0, accountCommitted = 0, accountActual = 0;
        const subRows: any[] = [];
        
        subAccountsSnapshot.docs.forEach(subDoc => {
          const subData = subDoc.data();
          const budgeted = subData.budgeted || 0, committed = subData.committed || 0, actual = subData.actual || 0;
          accountBudgeted += budgeted; accountCommitted += committed; accountActual += actual;
          subRows.push({
            code: subData.code, description: subData.description, type: "SUBCUENTA",
            budgeted, committed, actual,
            available: budgeted - committed - actual,
            percentUsed: `${budgeted > 0 ? ((committed + actual) / budgeted * 100).toFixed(1) : "0"}%`,
          });
        });

        const accountRow: any = {
          code: accountData.code, description: accountData.description, type: "CUENTA",
          budgeted: accountBudgeted, committed: accountCommitted, actual: accountActual,
          available: accountBudgeted - accountCommitted - accountActual,
          percentUsed: `${accountBudgeted > 0 ? ((accountCommitted + accountActual) / accountBudgeted * 100).toFixed(1) : "0"}%`,
        };
        dataRows.push(toXlsxRow(columns, accountRow));
        subRows.forEach(r => dataRows.push(toXlsxRow(columns, r)));
      }

      downloadXLSX(columns, dataRows, makeTitle("budget"), `Presupuesto_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePOsListReport = async (columns: SelectedColumn[]) => {
    setGenerating("pos_list");
    try {
      const posSnapshot = await getDocs(query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc")));
      const dataRows: (string | number)[][] = [];
      
      for (const docSnap of posSnapshot.docs) {
        const data = docSnap.data();
        dataRows.push(toXlsxRow(columns, {
          number: data.number || data.displayNumber || "", supplier: data.supplier || "",
          description: data.description || "", baseAmount: data.baseAmount || 0,
          taxAmount: data.taxAmount || 0, totalAmount: data.totalAmount || 0,
          status: data.status || "", isOpen: data.isOpen !== false ? "Abierta" : "Cerrada",
          createdAt: formatDate(data.createdAt), createdBy: data.createdByName || "",
          approvedAt: formatDate(data.approvedAt), approvedBy: data.approvedByName || "",
          itemCount: (data.items || []).length,
        }));
      }
      downloadXLSX(columns, dataRows, makeTitle("pos_list"), `POs_Listado_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePOsItemsReport = async (columns: SelectedColumn[]) => {
    setGenerating("pos_items");
    try {
      const posSnapshot = await getDocs(query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc")));
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
      
      const invoicedByPOItem: Record<string, Record<number, number>> = {};
      invoicesSnapshot.docs.forEach(invDoc => {
        const invData = invDoc.data();
        if (invData.poId && shouldRealizeInvoice(invData.status || "", costConfig)) {
          if (!invoicedByPOItem[invData.poId]) invoicedByPOItem[invData.poId] = {};
          (invData.items || []).forEach((invItem: any) => {
            const itemIndex = invItem.poItemIndex ?? -1;
            if (itemIndex >= 0)
              invoicedByPOItem[invData.poId][itemIndex] = (invoicedByPOItem[invData.poId][itemIndex] || 0) + (invItem.baseAmount || 0);
          });
        }
      });

      const dataRows: (string | number)[][] = [];
      
      for (const docSnap of posSnapshot.docs) {
        const poData = docSnap.data();
        if (!shouldCommitPO(poData.status || "", costConfig)) continue;
        const poId = docSnap.id;
        const items = poData.items || [];
        const poInvoiced = invoicedByPOItem[poId] || {};
        
        items.forEach((item: any, index: number) => {
          const itemIsClosed = item.isClosed || false;
          const rawBaseAmount = item.baseAmount || item.amount || 0;
          const baseInvoiced = poInvoiced[index] || 0;
          const taxRate = item.vatRate || item.taxRate || 21;
          const irpfRate = item.irpfRate || 0;
          const baseCommitted = itemIsClosed ? 0 : Math.max(0, rawBaseAmount - baseInvoiced);
          const taxAmount = baseCommitted * (taxRate / 100);
          const irpfAmount = baseCommitted * (irpfRate / 100);
          const totalCommitted = baseCommitted + taxAmount - irpfAmount;
          const episodes = item.episodes || [];
          const episodeAssignment = item.episodeAssignment || "general";

          if (splitByEpisode && episodeAssignment === "specific" && episodes.length > 0) {
            episodes.forEach((ep: any) => {
              const rawEpBaseAmount = ep.amount || 0;
              const epPercentage = rawBaseAmount > 0 ? rawEpBaseAmount / rawBaseAmount : 0;
              const epBaseInvoiced = baseInvoiced * epPercentage;
              const epBaseCommitted = itemIsClosed ? 0 : Math.max(0, rawEpBaseAmount - epBaseInvoiced);
              const epTaxAmount = epBaseCommitted * (taxRate / 100);
              const epTotalCommitted = epBaseCommitted + epTaxAmount - epBaseCommitted * (irpfRate / 100);
              dataRows.push(toXlsxRow(columns, {
                poNumber: poData.number || poData.displayNumber || "", poDescription: poData.generalDescription || poData.description || "",
                supplier: poData.supplier || "", itemNumber: index + 1, itemDescription: item.description || "",
                episode: ep.episode.toString(), accountCode: item.accountCode || item.subAccountCode?.split(".")[0] || "",
                accountDescription: item.accountDescription || "", subaccountCode: item.subAccountCode || item.subaccountCode || "",
                subaccountDescription: item.subAccountDescription || item.subaccountDescription || "",
                baseCommitted: epBaseCommitted, totalCommitted: epTotalCommitted, baseInvoiced: epBaseInvoiced,
                baseAvailable: epBaseCommitted, totalAvailable: epTotalCommitted,
                poStatus: poData.status || "", isOpen: poData.isOpen !== false ? "Abierta" : "Cerrada",
                itemClosed: itemIsClosed ? "Sí" : "No", taxRate: `${taxRate}%`, irpfRate: `${irpfRate}%`,
              }));
            });
          } else {
            const episodeLabel = episodeAssignment === "general" ? "0"
              : episodes.length === 1 ? episodes[0].episode.toString()
              : episodes.length > 1 ? episodes.map((e: any) => e.episode).join(", ")
              : "0";
            dataRows.push(toXlsxRow(columns, {
              poNumber: poData.number || poData.displayNumber || "", poDescription: poData.generalDescription || poData.description || "",
              supplier: poData.supplier || "", itemNumber: index + 1, itemDescription: item.description || "",
              episode: episodeLabel, accountCode: item.accountCode || item.subAccountCode?.split(".")[0] || "",
              accountDescription: item.accountDescription || "", subaccountCode: item.subAccountCode || item.subaccountCode || "",
              subaccountDescription: item.subAccountDescription || item.subaccountDescription || "",
              baseCommitted, totalCommitted, baseInvoiced, baseAvailable: baseCommitted, totalAvailable: totalCommitted,
              poStatus: poData.status || "", isOpen: poData.isOpen !== false ? "Abierta" : "Cerrada",
              itemClosed: itemIsClosed ? "Sí" : "No", taxRate: `${taxRate}%`, irpfRate: `${irpfRate}%`,
            }));
          }
        });
      }
      downloadXLSX(columns, dataRows, makeTitle("pos_items"), `POs_Items_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateInvoicesReport = async (columns: SelectedColumn[]) => {
    setGenerating("invoices");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const dataRows: (string | number)[][] = [];
      
      invoicesSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const items = data.items || [];
        const allEpisodes: number[] = [];
        items.forEach((item: any) => {
          if (item.episodeAssignment === "specific" && item.episodes)
            item.episodes.forEach((ep: any) => { if (!allEpisodes.includes(ep.episode)) allEpisodes.push(ep.episode); });
        });
        allEpisodes.sort((a, b) => a - b);
        dataRows.push(toXlsxRow(columns, {
          number: data.number || data.displayNumber || "", supplierNumber: data.supplierNumber || "",
          supplier: data.supplier || "", supplierTaxId: data.supplierTaxId || "", description: data.description || "",
          poNumber: data.poNumber || "",
          episode: allEpisodes.length > 0 ? (allEpisodes.length === 1 ? allEpisodes[0].toString() : allEpisodes.join(", ")) : "0",
          accountCode: items.length > 0 ? (items[0].subAccountCode || "") : "",
          baseAmount: data.baseAmount || 0, taxAmount: data.vatAmount || data.taxAmount || 0,
          irpfAmount: data.irpfAmount || 0, totalAmount: data.totalAmount || 0,
          status: data.status || "", coded: data.codedAt ? "Sí" : "No", accounted: data.accounted ? "Sí" : "No",
          invoiceDate: formatDate(data.invoiceDate), dueDate: formatDate(data.dueDate),
          createdAt: formatDate(data.createdAt), paidAt: formatDate(data.paidAt),
        }));
      });
      downloadXLSX(columns, dataRows, makeTitle("invoices"), `Facturas_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateSuppliersReport = async (columns: SelectedColumn[]) => {
    setGenerating("suppliers");
    try {
      const suppliersSnapshot = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName", "asc")));
      const dataRows: (string | number)[][] = [];
      suppliersSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        dataRows.push(toXlsxRow(columns, {
          fiscalName: data.fiscalName || "", commercialName: data.commercialName || "", taxId: data.taxId || "",
          contactName: data.contact?.name || "", contactEmail: data.contact?.email || "", contactPhone: data.contact?.phone || "",
          address: data.address || "", city: data.city || "", postalCode: data.postalCode || "",
          paymentMethod: data.paymentMethod || "", iban: data.bankAccount || data.iban || "",
          paymentTerms: data.paymentTerms || "", totalPOs: data.totalPOs || 0, totalInvoiced: data.totalInvoiced || 0,
        }));
      });
      downloadXLSX(columns, dataRows, makeTitle("suppliers"), `Proveedores_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateInvoicesAccountingReport = async (columns: SelectedColumn[], filters?: InvoiceBookFilters) => {
    setGenerating("invoices_accounting");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("invoiceDate", "desc")));
      let filteredInvoices = invoicesSnapshot.docs;
      
      if (filters) {
        filteredInvoices = filteredInvoices.filter(docSnap => {
          const data = docSnap.data();
          // Excluir anuladas salvo que se soliciten explícitamente
          if (!filters.includeCancelled && data.status === "cancelled") return false;
          if (filters.supplierId && data.supplierId !== filters.supplierId) return false;
          if (filters.dateFrom || filters.dateTo) {
            const invoiceDate = data.invoiceDate?.toDate ? data.invoiceDate.toDate() : null;
            if (!invoiceDate) return false;
            if (filters.dateFrom) {
              const fromDate = new Date(filters.dateFrom); fromDate.setHours(0, 0, 0, 0);
              if (invoiceDate < fromDate) return false;
            }
            if (filters.dateTo) {
              const toDate = new Date(filters.dateTo); toDate.setHours(23, 59, 59, 999);
              if (invoiceDate > toDate) return false;
            }
          }
          if (filters.paymentStatus === "paid" && data.status !== "paid") return false;
          if (filters.paymentStatus === "pending" && data.status === "paid") return false;
          return true;
        });
      } else {
        // Sin filtros explícitos: excluir anuladas por defecto
        filteredInvoices = filteredInvoices.filter(d => d.data().status !== "cancelled");
        filteredInvoices = filteredInvoices.filter(doc => doc.data().accounted === true);
      }
      
      const dataRows: (string | number)[][] = [];
      filteredInvoices.forEach(docSnap => {
        const data = docSnap.data();
        const items = data.items || [];
        const accountCode = items.length > 0 ? (items[0].subAccountCode || "") : "";
        const taxRate = data.baseAmount > 0 ? Math.round((data.vatAmount / data.baseAmount) * 100) : 21;
        const irpfRate = data.baseAmount > 0 ? Math.round((data.irpfAmount / data.baseAmount) * 100) : 0;
        dataRows.push(toXlsxRow(columns, {
          accountingEntryNumber: data.accountingEntryNumber || "", number: data.number || data.displayNumber || "",
          supplierNumber: data.supplierNumber || "", invoiceDate: formatDate(data.invoiceDate),
          supplier: data.supplier || "", supplierTaxId: data.supplierTaxId || "", supplierIban: data.supplierIban || "",
          description: data.description || "", accountCode,
          baseAmount: data.baseAmount || 0, taxRate: `${taxRate}%`, taxAmount: data.vatAmount || 0,
          irpfRate: `${irpfRate}%`, irpfAmount: data.irpfAmount || 0, totalAmount: data.totalAmount || 0,
          dueDate: formatDate(data.dueDate),
          status: data.status === "paid" ? "Pagada" : "Pendiente",
          paidAt: formatDate(data.paidAt), accountedAt: formatDate(data.accountedAt),
          accountedBy: data.accountedByName || "",
        }));
      });

      let filename = "Libro_Facturas";
      if (filters?.supplierName) filename += `_${filters.supplierName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (filters?.dateFrom) filename += `_desde_${filters.dateFrom}`;
      if (filters?.dateTo) filename += `_hasta_${filters.dateTo}`;
      filename += `_${getCurrentDate()}`;

      downloadXLSX(columns, dataRows, makeTitle("invoices_accounting"), filename);
      setShowInvoiceBookModal(false);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePaymentsReport = async (columns: SelectedColumn[]) => {
    setGenerating("payments");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("paidAt", "desc")));
      const dataRows: (string | number)[][] = [];
      const paidInvoices = invoicesSnapshot.docs.filter(doc => doc.data().status === "paid" && doc.data().paidAt);
      paidInvoices.forEach((docSnap, idx) => {
        const data = docSnap.data();
        dataRows.push(toXlsxRow(columns, {
          paymentNumber: `PAG-${String(idx + 1).padStart(4, "0")}`,
          invoiceNumber: data.number || data.displayNumber || "", supplierNumber: data.supplierNumber || "",
          supplier: data.supplier || "", supplierTaxId: data.supplierTaxId || "", supplierIban: data.supplierIban || "",
          description: data.description || "", baseAmount: data.baseAmount || 0, totalAmount: data.totalAmount || 0,
          paymentMethod: data.paymentMethod || "Transferencia", paidAt: formatDate(data.paidAt),
          paidBy: data.paidByName || "", accountingEntryNumber: data.accountingEntryNumber || "",
        }));
      });
      downloadXLSX(columns, dataRows, makeTitle("payments"), `Pagos_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateCostReport = async (columns: SelectedColumn[]) => {
    setGenerating("cost_report");
    try {
      const accountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
      const dataRows: (string | number)[][] = [];

      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        let totalBudgeted = 0, totalCommitted = 0, totalActual = 0;
        subAccountsSnapshot.docs.forEach(subDoc => {
          const subData = subDoc.data();
          totalBudgeted += subData.budgeted || 0;
          totalCommitted += subData.committed || 0;
          totalActual += subData.actual || 0;
        });
        let totalPaid = 0, totalPending = 0;
        invoicesSnapshot.docs.forEach(invDoc => {
          const invData = invDoc.data();
          (invData.items || []).forEach((item: any) => {
            if (item.subAccountCode?.startsWith(accountData.code)) {
              if (invData.status === "paid") totalPaid += item.baseAmount || 0;
              else if (["approved", "pending", "accounted"].includes(invData.status)) totalPending += item.baseAmount || 0;
            }
          });
        });
        const available = totalBudgeted - totalCommitted;
        const percentExecuted = totalBudgeted > 0 ? Math.round((totalActual / totalBudgeted) * 100) : 0;
        dataRows.push(toXlsxRow(columns, {
          accountCode: accountData.code || "", accountDescription: accountData.description || "",
          budgeted: totalBudgeted, committed: totalCommitted, invoiced: totalActual,
          paid: totalPaid, pendingPayment: totalPending, available,
          percentExecuted: `${percentExecuted}%`, deviation: totalActual - totalBudgeted,
        }));
      }
      downloadXLSX(columns, dataRows, makeTitle("cost_report"), `Informe_Costes_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateBoxCardsReport = async (columns: SelectedColumn[]) => {
    setGenerating("box_cards");
    try {
      const [envelopesSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, `projects/${id}/cardEnvelopes`)),
        getDocs(query(collection(db, `projects/${id}/cardExpenses`), orderBy("createdAt", "desc"))),
      ]);
      const envelopesMap = new Map(envelopesSnap.docs.map(d => [d.id, d.data()]));
      const dataRows: (string | number)[][] = [];
      for (const expDoc of expensesSnap.docs) {
        const exp = expDoc.data();
        const envelope = envelopesMap.get(exp.envelopeId);
        dataRows.push(toXlsxRow(columns, {
          envelopeNumber: envelope?.displayNumber || "",
          cardName: exp.boxCode || "",
          expenseNumber: exp.displayNumber || "",
          type: exp.type === "ticket" ? "Ticket" : "Factura",
          date: exp.date ? (exp.date.toDate ? exp.date.toDate().toLocaleDateString("es-ES") : exp.date) : "",
          supplier: exp.supplier || "",
          description: exp.description || "",
          accountCode: exp.subAccountCode || "",
          baseAmount: exp.baseAmount || 0,
          vatRate: 0,
          vatAmount: exp.vatAmount || 0,
          irpfRate: 0,
          irpfAmount: exp.irpfAmount || 0,
          totalAmount: exp.totalAmount || 0,
          status: exp.status === "reviewed" ? "Revisado" : exp.status === "accounted" ? "Contabilizado" : "Pendiente",
          envelopeStatus: envelope?.status === "closed" ? "Cerrado" : envelope?.status === "reviewing" ? "En revisión" : "Abierto",
          createdAt: formatDate(exp.createdAt),
          createdBy: exp.createdByName || "",
        }));
      }
      downloadXLSX(columns, dataRows, makeTitle("box_cards"), `BOX_Tarjetas_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateBoxTransfersReport = async (columns: SelectedColumn[]) => {
    setGenerating("box_transfers");
    try {
      const [envelopesSnap, expensesSnap] = await Promise.all([
        getDocs(collection(db, `projects/${id}/transferEnvelopes`)),
        getDocs(query(collection(db, `projects/${id}/transferExpenses`), orderBy("createdAt", "desc"))),
      ]);
      const envelopesMap = new Map(envelopesSnap.docs.map(d => [d.id, d.data()]));
      const dataRows: (string | number)[][] = [];
      for (const expDoc of expensesSnap.docs) {
        const exp = expDoc.data();
        const envelope = envelopesMap.get(exp.envelopeId);
        const items = exp.items && exp.items.length > 0 ? exp.items : [{ subAccountCode: exp.subAccountCode, subAccountDescription: exp.subAccountDescription, description: exp.description, baseAmount: exp.baseAmount }];
        for (const item of items) {
          dataRows.push(toXlsxRow(columns, {
            envelopeNumber: envelope?.displayNumber || "",
            paymentDate: envelope?.paymentDate || "",
            personName: exp.personName || "",
            personDepartment: exp.personDepartment || "",
            personIban: exp.personIban || "",
            type: exp.type === "ticket" ? "Ticket" : "Factura",
            date: exp.date || "",
            supplier: exp.supplier || "",
            description: item.description || exp.description || "",
            accountCode: item.subAccountCode || "",
            baseAmount: item.baseAmount || 0,
            vatRate: item.vatRate || 0,
            vatAmount: item.vatAmount || exp.vatAmount || 0,
            irpfRate: exp.irpfRate || 0,
            irpfAmount: exp.irpfAmount || 0,
            totalAmount: exp.totalAmount || 0,
            status: envelope?.status === "transferred" ? "Transferido" : envelope?.status === "pending" ? "Pendiente" : "Borrador",
            transferReference: envelope?.transferReference || "",
            transferredAt: envelope?.transferredAt ? (envelope.transferredAt.toDate ? envelope.transferredAt.toDate().toLocaleDateString("es-ES") : envelope.transferredAt) : "",
          }));
        }
      }
      downloadXLSX(columns, dataRows, makeTitle("box_transfers"), `BOX_Transferencias_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateReport = (reportType: ReportType, columns?: SelectedColumn[]) => {
    const cols = columns || getDefaultColumns(reportType);
    switch (reportType) {
      case "budget":               return generateBudgetReport(cols);
      case "pos_list":             return generatePOsListReport(cols);
      case "pos_items":            return generatePOsItemsReport(cols);
      case "invoices":             return generateInvoicesReport(cols);
      case "invoices_accounting":  return generateInvoicesAccountingReport(cols);
      case "suppliers":            return generateSuppliersReport(cols);
      case "payments":             return generatePaymentsReport(cols);
      case "cost_report":          return generateCostReport(cols);
      case "box_cards":            return generateBoxCardsReport(cols);
      case "box_transfers":        return generateBoxTransfersReport(cols);
    }
  };

  const generateFromPreset = (preset: ReportPreset) => {
    const cols: SelectedColumn[] = preset.columns.map((c, i) => {
      if (c.isBlank) return { id: `blank_${i}`, originalId: "blank", label: "", isBlank: true };
      const original = REPORT_COLUMNS[preset.reportType].find(col => col.id === c.id);
      return { id: `${c.id}_${i}`, originalId: c.id, label: original?.label || c.id };
    });
    generateReport(preset.reportType, cols);
  };

  const getReportCount = (reportType: ReportType) => {
    switch (reportType) {
      case "budget": case "cost_report": return counts.accounts;
      case "pos_list": case "pos_items": return counts.pos;
      case "invoices": case "invoices_accounting": case "payments": return counts.invoices;
      case "suppliers": return counts.suppliers;
      case "box_cards": return counts.cardExpenses || 0;
      case "box_transfers": return counts.transferExpenses || 0;
      default: return 0;
    }
  };

  if (loading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (accessError || !hasAccess) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{accessError || "No tienes permisos para acceder a esta página"}</p>
          <Link href={"/project/" + id + "/accounting"} className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "#2F52E0" }}>
            <ArrowLeft size={16} />
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <FileSpreadsheet size={24} style={{ color: "#2F52E0" }} />
              <h1 className="text-2xl font-semibold text-slate-900">Informes</h1>
            </div>
            {episodesEnabled && totalEpisodes > 0 && (
              <button onClick={() => setSplitByEpisode(!splitByEpisode)} className={"flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all " + (splitByEpisode ? "bg-violet-100 text-violet-700 border border-violet-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                <Film size={14} />
                Desglosar por capítulo
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        <div className="space-y-8">
          {REPORT_SECTIONS.map((section) => (
            <div key={section.id}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{section.title}</h2>
              <div className="space-y-2">
                {section.reports.map((reportType) => {
                  const info = REPORT_INFO[reportType];
                  const Icon = info.icon;
                  const isExpanded = expandedReport === reportType;
                  const reportPresets = presets.filter(p => p.reportType === reportType);
                  const count = getReportCount(reportType);
                  
                  return (
                    <div key={reportType} className="bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-all">
                      <div className="px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Icon size={18} className="text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-slate-900 text-sm">{info.title}</h3>
                            <span className="text-xs text-slate-400">{count}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openConfig(reportType)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title="Configurar columnas">
                            <Settings2 size={16} />
                          </button>
                          <button 
                            onClick={() => reportType === "invoices_accounting" ? openInvoiceBookModal() : generateReport(reportType)} 
                            disabled={generating !== null} 
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors disabled:opacity-50"
                          >
                            {generating === reportType
                              ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /><span>...</span></>
                              : <><Download size={12} />Excel</>}
                          </button>
                          {reportPresets.length > 0 && (
                            <button onClick={() => setExpandedReport(isExpanded ? null : reportType)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                              <ChevronDown size={18} className={"transition-transform " + (isExpanded ? "rotate-180" : "")} />
                            </button>
                          )}
                        </div>
                      </div>
                      {isExpanded && reportPresets.length > 0 && (
                        <div className="px-4 pb-3 pt-0">
                          <div className="border-t border-slate-100 pt-3">
                            <p className="text-xs text-slate-400 mb-2">Plantillas guardadas</p>
                            <div className="space-y-1">
                              {reportPresets.map((preset) => (
                                <div key={preset.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg group">
                                  <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-700 truncate">{preset.name}</p></div>
                                  <button onClick={() => generateFromPreset(preset)} disabled={generating !== null} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded text-xs hover:bg-slate-50 transition-colors disabled:opacity-50">Usar</button>
                                  <button onClick={() => deletePreset(preset.id)} className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={12} /></button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Column config modal — unchanged */}
      {showConfig && configReportType && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfig(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Configurar columnas</h3>
                <p className="text-sm text-slate-500">{REPORT_INFO[configReportType].title}</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {presets.filter(p => p.reportType === configReportType).length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-medium text-slate-500 mb-2">Cargar plantilla</p>
                  <div className="flex flex-wrap gap-2">
                    {presets.filter(p => p.reportType === configReportType).map((preset) => (
                      <button key={preset.id} onClick={() => loadPreset(preset)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors">{preset.name}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Columnas del informe</p>
                    <span className="text-xs text-slate-400">{selectedColumns.length}</span>
                  </div>
                  <div className="space-y-1 min-h-[200px] p-3 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                    {selectedColumns.map((column, index) => {
                      const isLocked = REPORT_COLUMNS[configReportType].find(c => c.id === column.originalId)?.locked;
                      return (
                        <div key={column.id} draggable={!isLocked} onDragStart={() => handleDragStart(index)} onDragOver={(e) => handleDragOver(e, index)} onDrop={(e) => handleDrop(e, index)} onDragEnd={handleDragEnd} className={"flex items-center gap-2 p-2 rounded-lg transition-all border " + (dragOverItem === index ? "bg-slate-200 border-slate-300" : "bg-white border-slate-200") + (draggedItem === index ? " opacity-50" : "") + (column.isBlank ? " border-dashed" : "")}>
                          <div className={"cursor-grab " + (isLocked ? "opacity-30" : "")}><GripVertical size={14} className="text-slate-400" /></div>
                          <span className={"flex-1 text-sm " + (column.isBlank ? "text-slate-400 italic" : "text-slate-700")}>{column.label}</span>
                          {isLocked ? (<span className="text-[10px] text-slate-400">Req.</span>) : (<button onClick={() => removeColumn(column.id, column.originalId)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"><Minus size={12} /></button>)}
                        </div>
                      );
                    })}
                    <button onClick={addBlankColumn} className="w-full flex items-center justify-center gap-2 p-2 mt-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-slate-400 hover:text-slate-600 transition-colors">
                      <Plus size={14} /><span className="text-xs font-medium">Columna vacía</span>
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Disponibles</p>
                    <span className="text-xs text-slate-400">{availableColumns.length}</span>
                  </div>
                  <div className="space-y-1 min-h-[200px] p-3 bg-slate-50 rounded-xl">
                    {availableColumns.length === 0 ? (<p className="text-xs text-slate-400 text-center py-8">Todas las columnas están en uso</p>) : (
                      availableColumns.map((column) => (
                        <button key={column.id} onClick={() => addColumn(column)} className="w-full flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:bg-slate-50 transition-colors text-left">
                          <Plus size={14} className="text-slate-400" /><span className="flex-1 text-sm text-slate-600">{column.label}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-4 text-center">Arrastra las columnas para reordenarlas</p>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
              {!showSavePreset ? (
                <div className="flex items-center justify-end gap-3">
                  <button onClick={() => setShowConfig(false)} className="px-4 py-2.5 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors">Cancelar</button>
                  <button onClick={() => setShowSavePreset(true)} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"><Save size={14} />Guardar plantilla</button>
                  <button onClick={() => { generateReport(configReportType, selectedColumns); setShowConfig(false); }} disabled={generating !== null} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}><Download size={14} />Exportar</button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input type="text" value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="Nombre de la plantilla" className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" autoFocus onKeyDown={(e) => e.key === "Enter" && savePreset()} />
                  <button onClick={() => { setShowSavePreset(false); setNewPresetName(""); }} className="px-4 py-2.5 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors">Cancelar</button>
                  <button onClick={savePreset} disabled={!newPresetName.trim()} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}><Check size={14} />Guardar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Book Modal — unchanged */}
      {showInvoiceBookModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowInvoiceBookModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                  <BookMarked size={20} className="text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Libro de facturas</h3>
                  <p className="text-xs text-slate-500">Selecciona los filtros para el informe</p>
                </div>
              </div>
              <button onClick={() => setShowInvoiceBookModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor</label>
                <div className="relative">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => {
                        setSupplierSearch(e.target.value);
                        setShowSupplierDropdown(true);
                        if (e.target.value !== invoiceBookFilters.supplierName)
                          setInvoiceBookFilters({ ...invoiceBookFilters, supplierId: "", supplierName: "" });
                      }}
                      onFocus={() => setShowSupplierDropdown(true)}
                      placeholder="Buscar proveedor (mín. 2 caracteres)..."
                      className="w-full pl-10 pr-10 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                    {invoiceBookFilters.supplierId && (
                      <button onClick={clearSupplier} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    )}
                  </div>
                  {showSupplierDropdown && supplierSearch.length >= 2 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {loadingSuppliers ? (
                        <div className="px-4 py-3 text-sm text-slate-500 text-center">Cargando...</div>
                      ) : filteredSuppliers.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500 text-center">No se encontraron proveedores</div>
                      ) : (
                        filteredSuppliers.map(supplier => (
                          <button key={supplier.id} onClick={() => selectSupplier(supplier)} className="w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                            <p className="text-sm font-medium text-slate-900">{supplier.fiscalName}</p>
                            {(supplier.commercialName || supplier.taxId) && (
                              <p className="text-xs text-slate-500">{[supplier.commercialName, supplier.taxId].filter(Boolean).join(" · ")}</p>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {invoiceBookFilters.supplierId && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check size={12} />Proveedor seleccionado</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Desde</label>
                  <div className="relative">
                    <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="date" value={invoiceBookFilters.dateFrom} onChange={(e) => setInvoiceBookFilters({ ...invoiceBookFilters, dateFrom: e.target.value })} className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Hasta</label>
                  <div className="relative">
                    <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="date" value={invoiceBookFilters.dateTo} onChange={(e) => setInvoiceBookFilters({ ...invoiceBookFilters, dateTo: e.target.value })} className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Estado de pago</label>
                <div className="flex gap-2">
                  {[{ value: "all", label: "Todas" }, { value: "paid", label: "Pagadas" }, { value: "pending", label: "Pendientes" }].map(option => (
                    <button key={option.value} onClick={() => setInvoiceBookFilters({ ...invoiceBookFilters, paymentStatus: option.value as "all" | "paid" | "pending" })} className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${invoiceBookFilters.paymentStatus === option.value ? "bg-indigo-100 text-indigo-700 border-2 border-indigo-200" : "bg-slate-100 text-slate-600 border-2 border-transparent hover:bg-slate-200"}`}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Incluir anuladas</p>
                    <p className="text-xs text-slate-500">Por defecto las facturas anuladas no aparecen en el informe</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInvoiceBookFilters({ ...invoiceBookFilters, includeCancelled: !invoiceBookFilters.includeCancelled })}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ml-4 ${invoiceBookFilters.includeCancelled ? "bg-indigo-600" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${invoiceBookFilters.includeCancelled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
                  </button>
                </label>
              </div>

              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500">
                  {!invoiceBookFilters.supplierId && !invoiceBookFilters.dateFrom && !invoiceBookFilters.dateTo ? (
                    "Sin filtros seleccionados. Se exportarán todas las facturas."
                  ) : (
                    <>Se exportarán las facturas
                      {invoiceBookFilters.supplierName && <span className="font-medium text-slate-700"> de {invoiceBookFilters.supplierName}</span>}
                      {invoiceBookFilters.dateFrom && <span className="font-medium text-slate-700"> desde {invoiceBookFilters.dateFrom}</span>}
                      {invoiceBookFilters.dateTo && <span className="font-medium text-slate-700"> hasta {invoiceBookFilters.dateTo}</span>}
                      {invoiceBookFilters.paymentStatus !== "all" && <span className="font-medium text-slate-700">{invoiceBookFilters.paymentStatus === "paid" ? " (solo pagadas)" : " (solo pendientes)"}</span>}.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex gap-3">
              <button onClick={() => setShowInvoiceBookModal(false)} className="flex-1 px-4 py-2.5 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors">Cancelar</button>
              <button
                onClick={() => generateInvoicesAccountingReport(getDefaultColumns("invoices_accounting"), invoiceBookFilters)}
                disabled={generating !== null}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}
              >
                {generating === "invoices_accounting"
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Generando...</>
                  : <><Download size={16} />Exportar Excel</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
