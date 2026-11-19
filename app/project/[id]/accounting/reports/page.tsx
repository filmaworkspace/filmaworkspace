"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { Button, Checkbox, EmptyState, Input, Modal, Page, PageHeader, PageLoading, Select, Spinner, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchWords } from "@/lib/search";
import { useCanSeeBudget } from "@/hooks/useCanSeeBudget";
import { Fragment, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel } from "@/components/ds";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { loadBudgetFigures } from "@/lib/budgetFigures";
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
import { CostSettings, getCostSettings } from "@/lib/budgetRules";
import { loadLedger } from "@/lib/ledgerClient";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

type ReportType = "budget" | "pos_list" | "pos_items" | "invoices" | "invoices_items" | "suppliers" | "payments" | "box_cards" | "box_transfers";

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
    { id: "baseCommitted", label: "Base PO", enabled: true },
    { id: "totalCommitted", label: "Total PO", enabled: true },
    { id: "baseInvoiced", label: "Base realizado", enabled: true },
    { id: "baseAvailable", label: "Base comprometido", enabled: true },
    { id: "totalAvailable", label: "Total comprometido", enabled: true },
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
  invoices_items: [
    { id: "number", label: "Nº Factura", enabled: true, locked: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: false },
    { id: "description", label: "Descripción factura", enabled: true },
    { id: "itemDescription", label: "Descripción ítem", enabled: true },
    { id: "itemNumber", label: "Nº Ítem", enabled: true },
    { id: "poNumber", label: "Nº PO asociada", enabled: true },
    { id: "episode", label: "Capítulo", enabled: true },
    { id: "accountCode", label: "Cuenta contable", enabled: true },
    { id: "subaccountCode", label: "Subcuenta", enabled: false },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxRate", label: "% IVA", enabled: false },
    { id: "taxAmount", label: "IVA", enabled: true },
    { id: "irpfRate", label: "% IRPF", enabled: false },
    { id: "irpfAmount", label: "IRPF", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "invoiceDate", label: "Fecha factura", enabled: true },
    { id: "dueDate", label: "Vencimiento", enabled: true },
    { id: "paidAt", label: "Fecha pago", enabled: false },
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
    { id: "invoiceNumber", label: "Nº Factura", enabled: true, locked: true },
    { id: "supplierNumber", label: "Nº Factura proveedor", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: false },
    { id: "supplierIban", label: "IBAN", enabled: true },
    { id: "description", label: "Concepto", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "totalAmount", label: "Total factura", enabled: true },
    { id: "paymentMethod", label: "Método pago", enabled: true },
    { id: "dueDate", label: "Fecha pago estimada", enabled: true },
    { id: "paidAt", label: "Fecha pago real", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "paidBy", label: "Pagado por", enabled: false },
    { id: "accountingEntryNumber", label: "Nº Asiento", enabled: false },
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
  pos_list: { title: "Listado de POs", icon: FileText, section: "pos" },
  pos_items: { title: "POs desglosado por ítems", icon: Layers, section: "pos" },
  invoices: { title: "Listado de facturas", icon: Receipt, section: "facturas" },
  invoices_items: { title: "Facturas desglosado por ítems", icon: Layers, section: "facturas" },
  payments: { title: "Informe de pagos", icon: Wallet, section: "facturas" },
  box_cards: { title: "Gastos de tarjeta", icon: CreditCard, section: "box" },
  box_transfers: { title: "Transferencias de caja", icon: Banknote, section: "box" },
  suppliers: { title: "Proveedores", icon: Building2, section: "otros" },
};

const REPORT_SECTIONS = [
  { id: "presupuesto", title: "Presupuesto", reports: ["budget"] as ReportType[] },
  { id: "pos", title: "Órdenes de compra", reports: ["pos_list", "pos_items"] as ReportType[] },
  { id: "facturas", title: "Facturas y pagos", reports: ["invoices", "invoices_items", "payments"] as ReportType[] },
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
  const blob = new Blob([xlsxBytes as BlobPart], {
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
  const canSeeBudgetFigures = useCanSeeBudget(id);
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
  const [reportSearch, setReportSearch] = useState("");
  const [reportField, setReportField] = useState<"all" | "name" | "preset">("all");
  const [sectionFilter, setSectionFilter] = useState("all");

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

  // Bloquea el scroll de la página de detrás mientras el modal de ajustes o
  // el del libro de facturas están abiertos.
  useBodyScrollLock(showConfig || showInvoiceBookModal);

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
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);
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
      const figures = await loadBudgetFigures(id as string);
      // Mismo libro que la página de Presupuesto (lib/budgetLedger): las cifras cuadran siempre.
      const ledger = await loadLedger(id as string);
      
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        
        let accountBudgeted = 0, accountCommitted = 0, accountActual = 0;
        const subRows: any[] = [];
        
        subAccountsSnapshot.docs.forEach(subDoc => {
          const subData = subDoc.data();
          const cell = ledger.bySub[subData.code || ""] || { committed: 0, actual: 0, box: 0 };
          // Realizado incluye caja (tarjetas, transferencias, efectivo), como en Presupuesto.
          const budgeted = figures[subDoc.id] ?? subData.budgeted ?? 0, committed = cell.committed, actual = cell.actual + cell.box;
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
      
      void invoicesSnapshot;
      const ledger = await loadLedger(id as string);
      const dataRows: (string | number)[][] = [];
      
      for (const docSnap of posSnapshot.docs) {
        const poData = docSnap.data();
        const poId = docSnap.id;
        const items = poData.items || [];
        const pl = ledger.pos[poId];
        if (!pl || (poData.status === "draft" || poData.status === "rejected")) continue;
        
        items.forEach((item: any, index: number) => {
          const itemIsClosed = item.isClosed || false;
          const rawBaseAmount = item.baseAmount || item.amount || 0;
          // Del libro único: realizado y comprometido de ESTE ítem (no se mezclan ítems).
          const baseInvoiced = pl.lines[index]?.realized || 0;
          const lineCommitted = pl.lines[index]?.committed || 0;
          const taxRate = item.vatRate || item.taxRate || 21;
          const irpfRate = item.irpfRate || 0;
          // Base PO = importe del ítem; realizado y comprometido salen del libro único.
          const baseCommitted = rawBaseAmount;
          const totalCommitted = baseCommitted + baseCommitted * (taxRate / 100) - baseCommitted * (irpfRate / 100);
          // Disponible = PO menos lo ya realizado, nunca negativo
          const baseAvailable = lineCommitted;
          const totalAvailable = baseAvailable + baseAvailable * (taxRate / 100) - baseAvailable * (irpfRate / 100);
          const episodes = item.episodes || [];
          const episodeAssignment = item.episodeAssignment || "general";

          if (splitByEpisode && episodeAssignment === "specific" && episodes.length > 0) {
            episodes.forEach((ep: any) => {
              const rawEpBaseAmount = ep.amount || 0;
              const epPercentage = rawBaseAmount > 0 ? rawEpBaseAmount / rawBaseAmount : 0;
              const epBaseInvoiced = baseInvoiced * epPercentage;
              const epBaseCommitted = rawEpBaseAmount;
              const epTotalCommitted = epBaseCommitted + epBaseCommitted * (taxRate / 100) - epBaseCommitted * (irpfRate / 100);
              const epBaseAvailable = lineCommitted * epPercentage;
              const epTotalAvailable = epBaseAvailable + epBaseAvailable * (taxRate / 100) - epBaseAvailable * (irpfRate / 100);
              dataRows.push(toXlsxRow(columns, {
                poNumber: poData.number || poData.displayNumber || "", poDescription: poData.generalDescription || poData.description || "",
                supplier: poData.supplier || "", itemNumber: index + 1, itemDescription: item.description || "",
                episode: ep.episode.toString(), accountCode: item.accountCode || item.subAccountCode?.split(".")[0] || "",
                accountDescription: item.accountDescription || "", subaccountCode: item.subAccountCode || item.subaccountCode || "",
                subaccountDescription: item.subAccountDescription || item.subaccountDescription || "",
                baseCommitted: epBaseCommitted, totalCommitted: epTotalCommitted, baseInvoiced: epBaseInvoiced,
                baseAvailable: epBaseAvailable, totalAvailable: epTotalAvailable,
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
              baseCommitted, totalCommitted, baseInvoiced, baseAvailable, totalAvailable,
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

  const generateInvoicesAccountingReport = async (columns: SelectedColumn[], filters: InvoiceBookFilters) => {
    setGenerating("invoices_accounting");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const dataRows: (string | number)[][] = [];

      invoicesSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();

        if (!filters.includeCancelled && data.status === "cancelled") return;
        if (filters.supplierId && data.supplierId !== filters.supplierId) return;
        if (filters.dateFrom || filters.dateTo) {
          const invoiceDate = data.invoiceDate?.toDate ? data.invoiceDate.toDate() : (data.invoiceDate ? new Date(data.invoiceDate) : null);
          const dateStr = invoiceDate ? invoiceDate.toISOString().slice(0, 10) : "";
          if (filters.dateFrom && dateStr < filters.dateFrom) return;
          if (filters.dateTo && dateStr > filters.dateTo) return;
        }
        if (filters.paymentStatus !== "all") {
          const isPaid = data.status === "paid" || !!data.paidAt;
          if (filters.paymentStatus === "paid" && !isPaid) return;
          if (filters.paymentStatus === "pending" && isPaid) return;
        }

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
      downloadXLSX(columns, dataRows, makeTitle("invoices"), `Libro_Facturas_${projectName}_${getCurrentDate()}`);
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

  const generateInvoicesItemsReport = async (columns: SelectedColumn[]) => {
    setGenerating("invoices_items");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const dataRows: (string | number)[][] = [];
      invoicesSnapshot.docs.forEach(docSnap => {
        const data = docSnap.data();
        const items = data.items || [];
        if (items.length === 0) {
          dataRows.push(toXlsxRow(columns, {
            number: data.number || data.displayNumber || "", supplier: data.supplier || "",
            supplierTaxId: data.supplierTaxId || "", description: data.description || "",
            itemDescription: "", itemNumber: "", poNumber: data.poNumber || "", episode: "",
            accountCode: "", subaccountCode: "",
            baseAmount: data.baseAmount || 0, taxRate: "", taxAmount: data.vatAmount || 0,
            irpfRate: "", irpfAmount: data.irpfAmount || 0, totalAmount: data.totalAmount || 0,
            status: data.status || "", invoiceDate: formatDate(data.invoiceDate),
            dueDate: formatDate(data.dueDate), paidAt: formatDate(data.paidAt),
          }));
        } else {
          items.forEach((item: any, idx: number) => {
            const episodes = item.episodes || [];
            const episodeLabel = item.episodeAssignment === "general" ? "0"
              : episodes.length === 1 ? episodes[0].episode.toString()
              : episodes.map((e: any) => e.episode).join(", ") || "0";
            const taxRate = item.vatRate || item.taxRate || 0;
            const irpfRate = item.irpfRate || 0;
            const base = item.baseAmount || 0;
            dataRows.push(toXlsxRow(columns, {
              number: data.number || data.displayNumber || "", supplier: data.supplier || "",
              supplierTaxId: data.supplierTaxId || "", description: data.description || "",
              itemDescription: item.description || "", itemNumber: idx + 1,
              poNumber: data.poNumber || "", episode: episodeLabel,
              accountCode: item.subAccountCode?.split(".")[0] || item.accountCode || "",
              subaccountCode: item.subAccountCode || item.subaccountCode || "",
              baseAmount: base, taxRate: taxRate ? `${taxRate}%` : "",
              taxAmount: base * (taxRate / 100),
              irpfRate: irpfRate ? `${irpfRate}%` : "",
              irpfAmount: base * (irpfRate / 100),
              totalAmount: base + base * (taxRate / 100) - base * (irpfRate / 100),
              status: data.status || "", invoiceDate: formatDate(data.invoiceDate),
              dueDate: formatDate(data.dueDate), paidAt: formatDate(data.paidAt),
            }));
          });
        }
      });
      downloadXLSX(columns, dataRows, makeTitle("invoices_items"), `Facturas_Items_${projectName}_${getCurrentDate()}`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePaymentsReport = async (columns: SelectedColumn[]) => {
    setGenerating("payments");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("dueDate", "asc")));
      const dataRows: (string | number)[][] = [];
      invoicesSnapshot.docs
        .filter(doc => !["cancelled", "void", "rejected"].includes(doc.data().status))
        .forEach(docSnap => {
          const data = docSnap.data();
          dataRows.push(toXlsxRow(columns, {
            invoiceNumber: data.number || data.displayNumber || "",
            supplierNumber: data.supplierNumber || "",
            supplier: data.supplier || "", supplierTaxId: data.supplierTaxId || "",
            supplierIban: data.supplierIban || "", description: data.description || "",
            baseAmount: data.baseAmount || 0, totalAmount: data.totalAmount || 0,
            paymentMethod: data.paymentMethod || "",
            dueDate: formatDate(data.dueDate),
            paidAt: formatDate(data.paidAt),
            status: (data.paidAt || data.status === "paid") ? "Pagada" : "Pendiente",
            paidBy: data.paidByName || "", accountingEntryNumber: data.accountingEntryNumber || "",
          }));
        });
      downloadXLSX(columns, dataRows, makeTitle("payments"), `Informe_Pagos_${projectName}_${getCurrentDate()}`);
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
      case "budget":         return generateBudgetReport(cols);
      case "pos_list":       return generatePOsListReport(cols);
      case "pos_items":      return generatePOsItemsReport(cols);
      case "invoices":       return generateInvoicesReport(cols);
      case "invoices_items": return generateInvoicesItemsReport(cols);
      case "suppliers":      return generateSuppliersReport(cols);
      case "payments":       return generatePaymentsReport(cols);
      case "box_cards":      return generateBoxCardsReport(cols);
      case "box_transfers":  return generateBoxTransfersReport(cols);
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
      case "budget": return counts.accounts;
      case "pos_list": case "pos_items": return counts.pos;
      case "invoices": case "invoices_items": case "payments": return counts.invoices;
      case "suppliers": return counts.suppliers;
      case "box_cards": return counts.cardExpenses || 0;
      case "box_transfers": return counts.transferExpenses || 0;
      default: return 0;
    }
  };

  if (loading) return <PageLoading />;

  if (accessError || !hasAccess) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white px-6 ${inter.className}`}>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-slate-900">Sin acceso</p>
          <p className="mt-1 text-[13px] text-slate-500">{accessError || "No tienes permiso para ver los informes."}</p>
          <Link href={`/project/${id}/accounting`} className={`${buttonClass("primary")} mt-5`}>Volver al panel</Link>
        </div>
      </div>
    );
  }

  // ── Catálogo con búsqueda avanzada ─────────────────────────────────────────
  type ReportField = "all" | "name" | "preset";
  const REPORT_FIELDS: SearchField<ReportField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Informe, sección o plantilla" },
    { value: "name", label: "Informe", placeholder: "Ej. facturas" },
    { value: "preset", label: "Plantilla", placeholder: "Nombre de la plantilla" },
  ];
  const sections = REPORT_SECTIONS.filter((s) => s.id !== "presupuesto" || canSeeBudgetFigures);
  const catalog = sections.flatMap((section) =>
    section.reports.map((type) => ({ type, section, info: REPORT_INFO[type], presets: presets.filter((p) => p.reportType === type) })),
  );
  const reportRows = catalog.filter((r) => {
    if (sectionFilter !== "all" && r.section.id !== sectionFilter) return false;
    if (!reportSearch.trim()) return true;
    const byName = matchWords(reportSearch, r.info.title);
    const byPreset = r.presets.some((p) => matchWords(reportSearch, p.name));
    if (reportField === "name") return byName;
    if (reportField === "preset") return byPreset;
    return byName || byPreset || matchWords(reportSearch, r.section.title);
  });

  return (
    <Page>
      <PageHeader title="Informes" />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={REPORT_FIELDS} field={reportField} onField={setReportField} value={reportSearch} onChange={setReportSearch} count={reportRows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="w-48">
          <Select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
            <option value="all">Todas las secciones</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </Select>
        </div>
        {episodesEnabled && totalEpisodes > 0 && (
          <Checkbox label="Desglosar por capítulo" checked={splitByEpisode} onChange={setSplitByEpisode} />
        )}
        </div>
      </div>

      <div className="mt-4">
        {reportRows.length === 0 ? (
          <EmptyState title="Sin resultados" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Informe</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Sección</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Registros</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Plantillas</th>
                  <th scope="col" className="w-60 py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {reportRows.map(({ type, section, info, presets: rp }) => {
                  const open = expandedReport === type;
                  return (
                    <Fragment key={type}>
                      <tr className="border-b border-slate-100 hover:bg-[#FAFAFA]">
                        <td className="px-4 py-1.5 font-medium text-slate-900">{info.title}</td>
                        <td className="px-3 py-1.5 text-slate-600">{section.title}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-xs">{getReportCount(type)}</td>
                        <td className="px-3 py-1.5">
                          {rp.length > 0 ? (
                            <button onClick={() => setExpandedReport(open ? null : type)} className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900" aria-expanded={open}>
                              {rp.length} {rp.length === 1 ? "plantilla" : "plantillas"}
                              <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
                            </button>
                          ) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-1.5 pr-4">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openConfig(type)}>Columnas…</Button>
                            <Button variant="secondary" size="sm" onClick={() => generateReport(type)} disabled={generating !== null}>
                              {generating === type ? <Spinner className="h-3.5 w-3.5" /> : <Download size={13} />} Excel
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {open && rp.map((preset) => (
                        <tr key={preset.id} className="border-b border-slate-100 bg-[#FCFCFC]">
                          <td className="py-1.5 pl-8 pr-4 text-slate-700" colSpan={3}>{preset.name}</td>
                          <td className="px-3 py-1.5 text-xs text-slate-500">{preset.columns?.length ?? 0} columnas</td>
                          <td className="py-1.5 pr-4">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="ghost" size="sm" onClick={() => deletePreset(preset.id)}>Eliminar</Button>
                              <Button variant="secondary" size="sm" onClick={() => generateFromPreset(preset)} disabled={generating !== null}><Download size={13} /> Excel</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Columnas del informe */}
      <Modal
        open={showConfig && !!configReportType}
        onClose={() => { setShowConfig(false); setShowSavePreset(false); setNewPresetName(""); }}
        title={configReportType ? `Columnas · ${REPORT_INFO[configReportType].title}` : "Columnas"}
        width="max-w-2xl"
        footer={
          !showSavePreset ? (
            <>
              <Button variant="secondary" onClick={() => setShowSavePreset(true)}><Save size={14} /> Guardar como plantilla</Button>
              <Button variant="primary" onClick={() => { if (configReportType) generateReport(configReportType, selectedColumns); setShowConfig(false); }} disabled={generating !== null}><Download size={14} /> Exportar</Button>
            </>
          ) : (
            <div className="flex w-full items-center gap-2">
              <Input value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="Nombre de la plantilla" autoFocus onKeyDown={(e) => e.key === "Enter" && savePreset()} />
              <Button variant="secondary" onClick={() => { setShowSavePreset(false); setNewPresetName(""); }}>Cancelar</Button>
              <Button variant="primary" onClick={savePreset} disabled={!newPresetName.trim()}>Guardar</Button>
            </div>
          )
        }
      >
        {configReportType && (
          <div className="flex flex-col gap-4">
            {presets.filter((p) => p.reportType === configReportType).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Cargar plantilla</span>
                {presets.filter((p) => p.reportType === configReportType).map((preset) => (
                  <Button key={preset.id} variant="secondary" size="sm" onClick={() => loadPreset(preset)}>{preset.name}</Button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-slate-500">En el informe · {selectedColumns.length}</span>
                <div className="flex min-h-[240px] flex-col overflow-hidden rounded-md border border-slate-200">
                  {selectedColumns.map((column, index) => {
                    const isLocked = REPORT_COLUMNS[configReportType].find((c) => c.id === column.originalId)?.locked;
                    return (
                      <div
                        key={column.id}
                        draggable={!isLocked}
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 ${dragOverItem === index ? "bg-[#F4F4F5]" : "bg-white"} ${draggedItem === index ? "opacity-50" : ""}`}
                      >
                        <GripVertical size={13} className={`text-slate-400 ${isLocked ? "opacity-30" : "cursor-grab"}`} />
                        <span className={`flex-1 text-[13px] ${column.isBlank ? "italic text-slate-400" : "text-slate-800"}`}>{column.label}</span>
                        <span className="font-mono text-[10px] text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                        {isLocked ? (
                          <span className="text-[10px] text-slate-400">fija</span>
                        ) : (
                          <button onClick={() => removeColumn(column.id, column.originalId)} aria-label={`Quitar ${column.label}`} className="text-slate-400 hover:text-slate-900"><Minus size={12} /></button>
                        )}
                      </div>
                    );
                  })}
                  <button onClick={addBlankColumn} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-[#FAFAFA] hover:text-slate-900">
                    <Plus size={12} /> Columna vacía
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-slate-500">Disponibles · {availableColumns.length}</span>
                <div className="flex min-h-[240px] flex-col overflow-hidden rounded-md border border-slate-200">
                  {availableColumns.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">Todas en uso</p>
                  ) : (
                    availableColumns.map((column) => (
                      <button key={column.id} onClick={() => addColumn(column)} className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-[#FAFAFA]">
                        <Plus size={12} className="text-slate-400" /> {column.label}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500">Arrastra para cambiar el orden.</p>
          </div>
        )}
      </Modal>
    </Page>
  );
}
