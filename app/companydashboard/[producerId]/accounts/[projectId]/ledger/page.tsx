"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/ledger/page.tsx

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, query, orderBy } from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import {
  Search, RefreshCw, CheckCircle, X, Filter,
  FileSpreadsheet, FileText, Download, TrendingUp, TrendingDown,
  ChevronDown, BarChart2,
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ── Types ─────────────────────────────────────────────────────────────────────
interface JLine { id: string; code: string; name: string; debe: number; haber: number; }
interface Invoice {
  id: string; displayNumber: string; supplier: string; description: string;
  baseAmount: number; vatAmount: number; irpfAmount: number; totalAmount: number;
  accounted: boolean; accountingEntryNumber?: string; invoiceDate: Date;
  items: any[]; journalLines?: JLine[];
}
interface ManualEntry { id: string; numero: string; date: string; concepto: string; lines: JLine[]; tipo?: string; }
interface Movement { fecha: string; concepto: string; entry: string; debe: number; haber: number; saldo: number; tipo: string; }
interface LedgerAccount {
  code: string; name: string; group: string;
  movimientos: Movement[];
  totalDebe: number; totalHaber: number; saldoFinal: number;
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: Date | undefined) => d ? new Intl.DateTimeFormat("es-ES").format(d) : "—";
const dateToISO = (s: string) => {
  if (!s) return "";
  if (s.includes("/")) { const [d, m, y] = s.split("/"); return `${y}-${m?.padStart(2,"0")}-${d?.padStart(2,"0")}`; }
  return s;
};
const isoToDisplay = (iso: string) => {
  if (!iso) return "—"; const [y,m,d] = iso.split("-"); return `${d}/${m}/${y}`;
};
const GROUP_LABELS: Record<string, string> = {
  "1": "Grupo 1 — Financiación", "2": "Grupo 2 — Activo no corriente",
  "4": "Grupo 4 — Acreedores/Deudores", "5": "Grupo 5 — Financiero",
  "6": "Grupo 6 — Gastos", "7": "Grupo 7 — Ingresos", "?": "Sin clasificar",
};

function codeToGroup(code: string): string {
  if (code.startsWith("1")) return "1";
  if (code.startsWith("2")) return "2";
  if (code.startsWith("4")) return "4";
  if (code.startsWith("5")) return "5";
  if (code.startsWith("6")) return "6";
  if (code.startsWith("7")) return "7";
  return "?";
}

function buildLines(inv: Invoice): JLine[] {
  if (inv.journalLines?.length) return inv.journalLines;
  const lines: JLine[] = [];
  inv.items.forEach((item: any, i: number) => {
    if (item.subAccountCode) lines.push({ id: `i${i}`, code: item.subAccountCode, name: item.description || item.subAccountCode, debe: item.baseAmount || 0, haber: 0 });
  });
  if (inv.vatAmount > 0)  lines.push({ id: "iva",  code: "472", name: "H.P. IVA soportado", debe: inv.vatAmount, haber: 0 });
  if (inv.irpfAmount < 0) lines.push({ id: "irpf", code: "473", name: "H.P. retenciones practicadas", debe: 0, haber: Math.abs(inv.irpfAmount) });
  const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
  lines.push({ id: "prov", code: "400", name: `Proveedores — ${inv.supplier}`, debe: 0, haber: net });
  return lines;
}

// ── Monthly chart (SVG) ───────────────────────────────────────────────────────
function MonthlyChart({ movimientos }: { movimientos: Movement[] }) {
  const months = useMemo(() => {
    const map: Record<string, { debe: number; haber: number }> = {};
    movimientos.forEach(m => {
      const iso = dateToISO(m.fecha);
      const key = iso.slice(0, 7); // yyyy-mm
      if (!map[key]) map[key] = { debe: 0, haber: 0 };
      map[key].debe  += m.debe;
      map[key].haber += m.haber;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-12);
  }, [movimientos]);

  if (months.length === 0) return null;

  const maxVal = Math.max(...months.flatMap(([, v]) => [v.debe, v.haber]), 1);
  const barH = 48;
  const w = 100 / months.length;

  return (
    <div className="px-5 py-4 border-b border-slate-100">
      <p className="text-[9px] font-mono font-semibold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><BarChart2 size={10} />Actividad mensual (últimos 12 meses)</p>
      <div className="flex items-end gap-0.5" style={{ height: barH + 20 }}>
        {months.map(([key, v]) => {
          const dh = (v.debe  / maxVal) * barH;
          const hh = (v.haber / maxVal) * barH;
          const [, m] = key.split("-");
          const mLabel = ["","E","F","M","A","M","J","J","A","S","O","N","D"][parseInt(m)] || m;
          return (
            <div key={key} className="flex-1 flex flex-col items-center gap-0.5">
              <div className="w-full flex items-end gap-px" style={{ height: barH }}>
                <div className="flex-1 bg-slate-800 rounded-t-sm opacity-80" style={{ height: dh }} title={`Debe: ${fmt(v.debe)} €`} />
                <div className="flex-1 bg-red-400 rounded-t-sm opacity-70" style={{ height: hh }} title={`Haber: ${fmt(v.haber)} €`} />
              </div>
              <span className="text-[8px] font-mono text-slate-400">{mLabel}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-slate-800 opacity-80" /><span className="text-[9px] text-slate-500">Debe</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-sm bg-red-400 opacity-70" /><span className="text-[9px] text-slate-500">Haber</span></div>
      </div>
    </div>
  );
}

// ── PDF export (jsPDF via CDN script injection) ────────────────────────────────
async function exportAccountPDF(account: LedgerAccount, projectName: string) {
  // Dynamically load jsPDF if not present
  if (!(window as any).jspdf) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  // Also load autotable
  if (!(window as any).jspdf?.jsPDF?.API?.autoTable) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js";
      s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const { jsPDF } = (window as any).jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const now = new Date().toLocaleDateString("es-ES");
  const W = doc.internal.pageSize.getWidth();

  // ── Header ──
  doc.setFillColor(26, 25, 22);
  doc.rect(0, 0, W, 22, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text("LIBRO MAYOR", 14, 10);
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.setTextColor(150, 150, 150);
  doc.text(projectName, 14, 16);
  doc.setTextColor(200, 200, 200);
  doc.text(`Generado: ${now}`, W - 14, 16, { align: "right" });

  // ── Account header ──
  doc.setFillColor(248, 248, 246);
  doc.rect(0, 24, W, 16, "F");
  doc.setTextColor(26, 25, 22);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(`${account.code}  ${account.name}`, 14, 33);

  // ── Summary boxes ──
  const boxes = [
    { label: "Suma Debe",  val: fmt(account.totalDebe) + " €",  x: W - 180 },
    { label: "Suma Haber", val: fmt(account.totalHaber) + " €", x: W - 120 },
    { label: "Saldo final",val: (account.saldoFinal >= 0 ? "D " : "A ") + fmt(Math.abs(account.saldoFinal)) + " €", x: W - 60 },
  ];
  boxes.forEach(b => {
    doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(120, 120, 120);
    doc.text(b.label, b.x, 27);
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.setTextColor(account.saldoFinal < 0 && b.label === "Saldo final" ? 153 : 26, account.saldoFinal < 0 && b.label === "Saldo final" ? 27 : 25, account.saldoFinal < 0 && b.label === "Saldo final" ? 27 : 22);
    doc.text(b.val, b.x, 34);
  });

  // ── Table ──
  (doc as any).autoTable({
    startY: 44,
    head: [["Fecha", "Nº Asiento", "Concepto", "Debe", "Haber", "Saldo progresivo"]],
    body: account.movimientos.map(m => [
      m.fecha,
      m.entry,
      m.concepto.length > 60 ? m.concepto.slice(0, 58) + "…" : m.concepto,
      m.debe  > 0 ? fmt(m.debe)  : "—",
      m.haber > 0 ? fmt(m.haber) : "—",
      (m.saldo >= 0 ? "D " : "A ") + fmt(Math.abs(m.saldo)),
    ]),
    foot: [[
      "", "", "TOTALES",
      fmt(account.totalDebe) + " €",
      fmt(account.totalHaber) + " €",
      (account.saldoFinal >= 0 ? "D " : "A ") + fmt(Math.abs(account.saldoFinal)) + " €",
    ]],
    headStyles: { fillColor: [26, 25, 22], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    footStyles: { fillColor: [245, 245, 243], textColor: [26, 25, 22], fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [50, 50, 50] },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 30 }, 2: { cellWidth: "auto" },
      3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 28, halign: "right" },
      5: { cellWidth: 35, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: [250, 250, 248] },
    didParseCell: (data: any) => {
      if (data.section === "body") {
        const m = account.movimientos[data.row.index];
        if (m && m.saldo < 0 && data.column.index === 5) data.cell.styles.textColor = [153, 27, 27];
      }
    },
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(180, 180, 180);
    doc.text(`Página ${i} de ${pages}`, W - 14, doc.internal.pageSize.getHeight() - 6, { align: "right" });
    doc.text("Libro Mayor · PGC 2007", 14, doc.internal.pageSize.getHeight() - 6);
  }

  doc.save(`mayor_${account.code}_${account.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`);
}

// ── Excel export (SheetJS) ────────────────────────────────────────────────────
async function exportAccountXLSX(account: LedgerAccount, projectName: string) {
  if (!(window as any).XLSX) {
    await new Promise<void>((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => res(); s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const XLSX = (window as any).XLSX;

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Movimientos ──
  const headers = ["Fecha", "Nº Asiento", "Concepto", "Tipo", "Debe", "Haber", "Saldo progresivo", "D/A"];
  const rows = account.movimientos.map(m => [
    m.fecha, m.entry, m.concepto, m.tipo || "—",
    m.debe  > 0 ? m.debe  : "",
    m.haber > 0 ? m.haber : "",
    Math.abs(m.saldo),
    m.saldo >= 0 ? "D" : "A",
  ]);
  const totals = ["", "", "TOTALES", "", account.totalDebe, account.totalHaber, Math.abs(account.saldoFinal), account.saldoFinal >= 0 ? "D" : "A"];

  const wsData = [
    [`Libro Mayor — Cuenta ${account.code} — ${account.name}`],
    [`Proyecto: ${projectName}   |   Generado: ${new Date().toLocaleDateString("es-ES")}`],
    [],
    headers,
    ...rows,
    [],
    totals,
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, { wch: 16 }, { wch: 55 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 5 },
  ];

  // Merge title row
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, `Mayor ${account.code}`);

  // ── Sheet 2: Resumen mensual ──
  const monthMap: Record<string, { debe: number; haber: number }> = {};
  account.movimientos.forEach(m => {
    const iso = dateToISO(m.fecha); const key = iso.slice(0, 7);
    if (!monthMap[key]) monthMap[key] = { debe: 0, haber: 0 };
    monthMap[key].debe  += m.debe;
    monthMap[key].haber += m.haber;
  });
  const monthRows = Object.entries(monthMap).sort().map(([k, v]) => [
    isoToDisplay(`${k}-01`).slice(3), // mm/yyyy
    v.debe, v.haber, v.debe - v.haber,
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([
    [`Resumen mensual — ${account.code} ${account.name}`],
    [],
    ["Período", "Movimiento Debe", "Movimiento Haber", "Saldo neto mes"],
    ...monthRows,
  ]);
  ws2["!cols"] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen mensual");

  XLSX.writeFile(wb, `mayor_${account.code}_${account.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LedgerPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,      setLoading]      = useState(true);
  const [invoices,     setInvoices]     = useState<Invoice[]>([]);
  const [manuals,      setManuals]      = useState<ManualEntry[]>([]);
  const [search,       setSearch]       = useState("");
  const [groupFilter,  setGroupFilter]  = useState("all");
  const [filterFrom,   setFilterFrom]   = useState("");
  const [filterTo,     setFilterTo]     = useState("");
  const [selected,     setSelected]     = useState<LedgerAccount | null>(null);
  const [toast,        setToast]        = useState("");
  const [exporting,    setExporting]    = useState<"pdf" | "xlsx" | null>(null);
  const [projectName,  setProjectName]  = useState("Proyecto");
  const [viewMode,     setViewMode]     = useState<"cards" | "table">("cards");
  const [showDateFilter, setShowDateFilter] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;
  const showToast     = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDateFilter(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pd, prj] = await Promise.all([
        getDoc(doc(db, "producers", producerId)),
        getDoc(doc(db, "projects", projectId)),
      ]);
      if (!pd.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!prj.exists()) { router.push(`/companydashboard/${producerId}`); return; }
      setProjectName(prj.data()?.name || "Proyecto");

      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
      ]);
      setInvoices(invSnap.docs.map(d => {
        const r = d.data();
        return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null };
      }));
      setManuals((manSnap as any).docs.map((d: any) => {
        const r = d.data();
        return { id: d.id, numero: r.numero, date: r.date, concepto: r.concepto, lines: r.lines || [], tipo: r.tipo };
      }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── Build ledger ──────────────────────────────────────────────────────────────
  const ledger = useMemo(() => {
    const map: Record<string, LedgerAccount> = {};
    const ensure = (code: string, name: string) => {
      if (!map[code]) map[code] = { code, name, group: codeToGroup(code), movimientos: [], totalDebe: 0, totalHaber: 0, saldoFinal: 0 };
      return map[code];
    };

    invoices.filter(i => i.accounted && i.accountingEntryNumber).forEach(inv => {
      const fecha = fmtDate(inv.invoiceDate);
      const concepto = inv.description + " — " + inv.displayNumber;
      buildLines(inv).forEach(l => {
        const acc = ensure(l.code, l.name);
        if (l.debe  > 0) { acc.movimientos.push({ fecha, concepto, entry: inv.accountingEntryNumber!, debe: l.debe, haber: 0, saldo: 0, tipo: "Gestión" }); acc.totalDebe  += l.debe; }
        if (l.haber > 0) { acc.movimientos.push({ fecha, concepto, entry: inv.accountingEntryNumber!, debe: 0, haber: l.haber, saldo: 0, tipo: "Gestión" }); acc.totalHaber += l.haber; }
      });
    });

    manuals.forEach(me => {
      me.lines.forEach(l => {
        const acc = ensure(l.code, l.name);
        if (l.debe  > 0) { acc.movimientos.push({ fecha: me.date, concepto: me.concepto, entry: me.numero, debe: l.debe, haber: 0, saldo: 0, tipo: me.tipo || "manual" }); acc.totalDebe  += l.debe; }
        if (l.haber > 0) { acc.movimientos.push({ fecha: me.date, concepto: me.concepto, entry: me.numero, debe: 0, haber: l.haber, saldo: 0, tipo: me.tipo || "manual" }); acc.totalHaber += l.haber; }
      });
    });

    return Object.values(map).map(acc => {
      // Sort by date then entry number
      acc.movimientos.sort((a, b) => {
        const da = dateToISO(a.fecha); const db_ = dateToISO(b.fecha);
        return da !== db_ ? da.localeCompare(db_) : a.entry.localeCompare(b.entry);
      });
      let s = 0;
      acc.movimientos = acc.movimientos.map(m => { s += m.debe - m.haber; return { ...m, saldo: s }; });
      acc.saldoFinal = acc.totalDebe - acc.totalHaber;
      return acc;
    }).sort((a, b) => a.code.localeCompare(b.code));
  }, [invoices, manuals]);

  // ── Filter ledger by date range ───────────────────────────────────────────────
  const ledgerFiltered = useMemo(() => {
    return ledger.map(acc => {
      if (!filterFrom && !filterTo) return acc;
      const movs = acc.movimientos.filter(m => {
        const iso = dateToISO(m.fecha);
        return (!filterFrom || iso >= filterFrom) && (!filterTo || iso <= filterTo);
      });
      if (movs.length === 0) return null;
      const totalDebe  = movs.reduce((s, m) => s + m.debe, 0);
      const totalHaber = movs.reduce((s, m) => s + m.haber, 0);
      // Recalculate progressive balance from scratch for date-filtered view
      let s = 0;
      const movsWithSaldo = movs.map(m => { s += m.debe - m.haber; return { ...m, saldo: s }; });
      return { ...acc, movimientos: movsWithSaldo, totalDebe, totalHaber, saldoFinal: totalDebe - totalHaber };
    }).filter(Boolean) as LedgerAccount[];
  }, [ledger, filterFrom, filterTo]);

  const filtered = useMemo(() => {
    return ledgerFiltered.filter(c => {
      const matchSearch = !search || c.code.includes(search) || c.name.toLowerCase().includes(search.toLowerCase());
      const matchGroup  = groupFilter === "all" || c.group === groupFilter;
      return matchSearch && matchGroup;
    });
  }, [ledgerFiltered, search, groupFilter]);

  // ── Export full mayor CSV ─────────────────────────────────────────────────────
  const exportFullCSV = () => {
    const rows: string[][] = [["Cuenta", "Nombre", "Fecha", "Nº Asiento", "Concepto", "Tipo", "Debe", "Haber", "Saldo", "D/A"]];
    filtered.forEach(c => c.movimientos.forEach(m => rows.push([
      c.code, c.name, m.fecha, m.entry, m.concepto, m.tipo,
      m.debe > 0 ? fmt(m.debe) : "", m.haber > 0 ? fmt(m.haber) : "",
      fmt(Math.abs(m.saldo)), m.saldo >= 0 ? "D" : "A",
    ])));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }));
    a.download = "libro_mayor_completo.csv"; a.click();
    showToast("Libro Mayor exportado");
  };

  const handleExportPDF = async (acc: LedgerAccount) => {
    setExporting("pdf");
    try { await exportAccountPDF(acc, projectName); showToast(`Mayor ${acc.code} exportado en PDF`); }
    catch (err) { console.error(err); showToast("Error al exportar PDF"); }
    finally { setExporting(null); }
  };

  const handleExportXLSX = async (acc: LedgerAccount) => {
    setExporting("xlsx");
    try { await exportAccountXLSX(acc, projectName); showToast(`Mayor ${acc.code} exportado en Excel`); }
    catch (err) { console.error(err); showToast("Error al exportar Excel"); }
    finally { setExporting(null); }
  };

  const currentYear = new Date().getFullYear();

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"><CheckCircle size={14} />{toast}</div>}
      {exporting && (
        <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl px-8 py-6 shadow-2xl flex items-center gap-4">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
            <div>
              <p className="font-semibold text-slate-900">Generando {exporting === "pdf" ? "PDF" : "Excel"}…</p>
              <p className="text-xs text-slate-500 mt-0.5">Cargando librerías y creando el archivo</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-[53px] flex h-[calc(100vh-53px)] overflow-hidden">
        {/* ── MAIN PANEL ── */}
        <div className={`flex flex-col flex-1 overflow-hidden transition-all ${selected ? "mr-[480px]" : ""}`}>

          {/* Toolbar */}
          <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-2 flex-wrap">
            <div>
              <h1 className="text-base font-bold text-slate-900">Libro Mayor</h1>
              <p className="font-mono text-[10px] text-slate-400">
                {filtered.length} cuentas · {filtered.reduce((s, c) => s + c.movimientos.length, 0)} movimientos
                {(filterFrom || filterTo) && <span className="text-amber-600"> · Fechas filtradas</span>}
              </p>
            </div>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg">
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>

              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input placeholder="Código o nombre..." value={search} onChange={e => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-52" />
              </div>

              {/* Group filter */}
              <div className="relative">
                <Filter size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
                  className={`pl-7 pr-6 py-1.5 text-sm border rounded-lg outline-none appearance-none cursor-pointer focus:ring-1 focus:ring-slate-400 ${groupFilter !== "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>
                  <option value="all">Todos los grupos</option>
                  {Object.entries(GROUP_LABELS).map(([g, l]) => <option key={g} value={g}>{l}</option>)}
                </select>
              </div>

              {/* Date range */}
              <div className="relative" ref={dateRef}>
                <button onClick={() => setShowDateFilter(o => !o)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${(filterFrom || filterTo) ? "bg-amber-600 text-white border-amber-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <Filter size={13} />
                  {filterFrom || filterTo ? "Fechas activas" : "Período"}
                  <ChevronDown size={11} />
                </button>
                {showDateFilter && (
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-4 z-50 w-72">
                    <p className="text-xs font-semibold text-slate-700 mb-3">Filtrar por período</p>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div><label className="block text-[10px] font-medium text-slate-500 mb-1">Desde</label><input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:border-slate-400 outline-none font-mono" /></div>
                      <div><label className="block text-[10px] font-medium text-slate-500 mb-1">Hasta</label><input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:border-slate-400 outline-none font-mono" /></div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {[{ l: "T1", f: `${currentYear}-01-01`, t: `${currentYear}-03-31` }, { l: "T2", f: `${currentYear}-04-01`, t: `${currentYear}-06-30` }, { l: "T3", f: `${currentYear}-07-01`, t: `${currentYear}-09-30` }, { l: "T4", f: `${currentYear}-10-01`, t: `${currentYear}-12-31` }, { l: `${currentYear}`, f: `${currentYear}-01-01`, t: `${currentYear}-12-31` }, { l: `${currentYear-1}`, f: `${currentYear-1}-01-01`, t: `${currentYear-1}-12-31` }].map(p => (
                        <button key={p.l} onClick={() => { setFilterFrom(p.f); setFilterTo(p.t); }}
                          className={`px-2 py-1 text-[10px] font-mono font-semibold border rounded ${filterFrom === p.f && filterTo === p.t ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{p.l}</button>
                      ))}
                    </div>
                    {(filterFrom || filterTo) && <button onClick={() => { setFilterFrom(""); setFilterTo(""); }} className="w-full text-xs text-red-600 hover:text-red-800 py-1">Limpiar período</button>}
                  </div>
                )}
              </div>

              {/* View toggle */}
              <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode("cards")} className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "cards" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Fichas</button>
                <button onClick={() => setViewMode("table")} className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "table" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Tabla</button>
              </div>

              <button onClick={exportFullCSV} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white text-xs font-medium rounded-lg hover:bg-slate-50">
                <Download size={13} />CSV completo
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {filtered.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-12 text-center"><p className="text-sm text-slate-500">Sin movimientos para los filtros aplicados.</p></div>
            ) : viewMode === "table" ? (
              /* ── TABLE VIEW ── */
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900 text-white sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider">Cuenta</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-mono uppercase tracking-wider">Nombre</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider">Σ Debe</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider">Σ Haber</th>
                      <th className="px-4 py-2.5 text-right text-[10px] font-mono uppercase tracking-wider">Saldo</th>
                      <th className="px-4 py-2.5 text-center text-[10px] font-mono uppercase tracking-wider w-8">Movs.</th>
                      <th className="px-4 py-2.5 w-20" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((c, i) => (
                      <tr key={c.code} onClick={() => setSelected(selected?.code === c.code ? null : c)}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${selected?.code === c.code ? "bg-slate-50 ring-1 ring-inset ring-slate-300" : i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}`}>
                        <td className="px-4 py-2.5"><span className="font-mono font-bold text-slate-900">{c.code}</span></td>
                        <td className="px-4 py-2.5 text-slate-700 max-w-[200px] truncate">{c.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">{fmt(c.totalDebe)}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-red-600">{fmt(c.totalHaber)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`font-mono font-bold text-sm ${c.saldoFinal >= 0 ? "text-slate-900" : "text-red-600"}`}>
                            {c.saldoFinal >= 0 ? "D " : "A "}{fmt(Math.abs(c.saldoFinal))}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center"><span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{c.movimientos.length}</span></td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <button onClick={() => handleExportXLSX(c)} title="Exportar Excel" className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded"><FileSpreadsheet size={13} /></button>
                            <button onClick={() => handleExportPDF(c)}  title="Exportar PDF"   className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><FileText size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ── CARDS VIEW ── */
              filtered.map(cuenta => {
                const isSel = selected?.code === cuenta.code;
                return (
                  <div key={cuenta.code}
                    className={`bg-white rounded-lg overflow-hidden mb-3 transition-all ${isSel ? "ring-2 ring-slate-900 shadow-lg" : "border border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}>

                    {/* Account header */}
                    <div
                      onClick={() => setSelected(isSel ? null : cuenta)}
                      className={`px-4 py-3 flex items-center gap-3 cursor-pointer ${isSel ? "bg-slate-900" : "bg-slate-50 border-b border-slate-200 hover:bg-slate-100"} transition-colors`}>
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className={`font-mono text-sm font-black min-w-[60px] ${isSel ? "text-white" : "text-slate-900"}`}>{cuenta.code}</span>
                        <span className={`text-sm font-medium truncate ${isSel ? "text-slate-300" : "text-slate-700"}`}>{cuenta.name}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${isSel ? "bg-white/10 text-white/60" : "bg-slate-200 text-slate-500"}`}>Gr.{cuenta.group}</span>
                      </div>
                      <div className="flex items-center gap-6 flex-shrink-0">
                        <div className="text-right">
                          <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Debe</p>
                          <p className={`font-mono text-xs font-semibold ${isSel ? "text-white" : "text-slate-700"}`}>{fmt(cuenta.totalDebe)}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Suma Haber</p>
                          <p className={`font-mono text-xs font-semibold ${isSel ? "text-red-400" : "text-red-600"}`}>{fmt(cuenta.totalHaber)}</p>
                        </div>
                        <div className="text-right min-w-[110px]">
                          <p className={`text-[9px] font-mono uppercase tracking-widest mb-0.5 ${isSel ? "text-slate-500" : "text-slate-400"}`}>Saldo</p>
                          <p className={`font-mono text-base font-black ${isSel ? "text-white" : cuenta.saldoFinal >= 0 ? "text-slate-900" : "text-red-600"}`}>
                            {cuenta.saldoFinal >= 0 ? <TrendingUp size={12} className="inline mr-0.5 mb-0.5" /> : <TrendingDown size={12} className="inline mr-0.5 mb-0.5" />}
                            {cuenta.saldoFinal >= 0 ? "D " : "A "}{fmt(Math.abs(cuenta.saldoFinal))}
                          </p>
                        </div>
                        {/* Export buttons — stop propagation */}
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleExportXLSX(cuenta)} title="Exportar Excel" className={`p-1.5 rounded-lg transition-colors ${isSel ? "text-white/50 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"}`}><FileSpreadsheet size={14} /></button>
                          <button onClick={() => handleExportPDF(cuenta)} title="Exportar PDF" className={`p-1.5 rounded-lg transition-colors ${isSel ? "text-white/50 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-red-600 hover:bg-red-50"}`}><FileText size={14} /></button>
                        </div>
                      </div>
                    </div>

                    {/* Progressive balance table (Sage-style) */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" style={{ minWidth: 640 }}>
                        <thead className="border-b border-slate-100">
                          <tr className="bg-slate-50">
                            <th className="px-4 py-2 text-left text-[10px] font-mono text-slate-400 uppercase w-24">Fecha</th>
                            <th className="px-4 py-2 text-left text-[10px] font-mono text-slate-400 uppercase w-28">Nº Asiento</th>
                            <th className="px-4 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Concepto</th>
                            <th className="px-4 py-2 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Debe</th>
                            <th className="px-4 py-2 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Haber</th>
                            <th className="px-4 py-2 text-right text-[10px] font-mono text-slate-400 uppercase w-32">Saldo progresivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {cuenta.movimientos.map((m, i) => (
                            <tr key={i} className={`${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"} hover:bg-blue-50/30 transition-colors`}>
                              <td className="px-4 py-1.5 font-mono text-[10px] text-slate-500 whitespace-nowrap">{m.fecha}</td>
                              <td className="px-4 py-1.5">
                                <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{m.entry}</span>
                              </td>
                              <td className="px-4 py-1.5 text-slate-600 max-w-[280px] truncate" title={m.concepto}>{m.concepto}</td>
                              <td className="px-4 py-1.5 text-right">
                                {m.debe > 0
                                  ? <span className="font-mono font-semibold text-slate-900">{fmt(m.debe)}</span>
                                  : <span className="text-slate-200 font-mono text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-1.5 text-right">
                                {m.haber > 0
                                  ? <span className="font-mono font-semibold text-red-600">{fmt(m.haber)}</span>
                                  : <span className="text-slate-200 font-mono text-[10px]">—</span>}
                              </td>
                              <td className="px-4 py-1.5 text-right">
                                <span className={`font-mono font-bold text-sm ${m.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>
                                  {m.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(m.saldo))}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-300">
                          <tr className="bg-slate-100">
                            <td colSpan={3} className="px-4 py-2 font-mono text-[10px] font-bold text-slate-600 uppercase tracking-wider">Totales {cuenta.code}</td>
                            <td className="px-4 py-2 text-right font-mono text-sm font-black text-slate-900">{fmt(cuenta.totalDebe)}</td>
                            <td className="px-4 py-2 text-right font-mono text-sm font-black text-red-600">{fmt(cuenta.totalHaber)}</td>
                            <td className="px-4 py-2 text-right font-mono text-sm font-black"><span className={cuenta.saldoFinal >= 0 ? "text-slate-900" : "text-red-600"}>{cuenta.saldoFinal >= 0 ? "D " : "A "}{fmt(Math.abs(cuenta.saldoFinal))}</span></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── DETAIL PANEL ── */}
        {selected && (
          <div className="fixed right-0 top-[53px] bottom-0 w-[480px] bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col">

            {/* Panel header */}
            <div className="bg-slate-900 px-5 py-4 flex-shrink-0">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xl font-black text-white">{selected.code}</span>
                    <span className="text-[10px] font-mono bg-white/10 text-white/60 px-1.5 py-0.5 rounded">Grupo {selected.group}</span>
                  </div>
                  <p className="text-slate-400 text-sm mt-0.5">{selected.name}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-slate-500 hover:text-white transition-colors mt-1"><X size={16} /></button>
              </div>
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { l: "Suma Debe",  v: selected.totalDebe,  c: "text-white",  p: "" },
                  { l: "Suma Haber", v: selected.totalHaber, c: "text-red-400", p: "" },
                  { l: "Saldo final", v: Math.abs(selected.saldoFinal), c: selected.saldoFinal >= 0 ? "text-white" : "text-red-400", p: selected.saldoFinal >= 0 ? "D " : "A " },
                ].map(s => (
                  <div key={s.l} className="bg-white/5 rounded-lg p-3">
                    <p className="text-[9px] font-mono text-slate-500 uppercase tracking-widest mb-1">{s.l}</p>
                    <p className={`font-mono text-sm font-bold ${s.c}`}>{s.p}{fmt(s.v)} €</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Export buttons */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
              <span className="text-xs text-slate-500 font-medium">Exportar cuenta {selected.code}:</span>
              <button onClick={() => handleExportXLSX(selected)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors">
                <FileSpreadsheet size={13} />Excel (.xlsx)
              </button>
              <button onClick={() => handleExportPDF(selected)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                <FileText size={13} />PDF
              </button>
            </div>

            {/* Monthly chart */}
            <MonthlyChart movimientos={selected.movimientos} />

            {/* Progressive balance detail */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-3 border-b border-slate-100">
                <p className="text-[9px] font-mono font-semibold text-slate-400 uppercase tracking-widest">Saldo progresivo — {selected.movimientos.length} movimientos</p>
              </div>
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-[10px] font-medium text-slate-500">Fecha · Asiento</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium text-slate-500">Debe</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium text-slate-500">Haber</th>
                    <th className="px-4 py-2 text-right text-[10px] font-medium text-slate-500">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.movimientos.map((m, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"} hover:bg-blue-50/20`}>
                      <td className="px-4 py-2">
                        <p className="font-mono text-[10px] font-semibold text-slate-700">{m.fecha}</p>
                        <p className="text-[9px] text-slate-400 font-mono">{m.entry}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{m.concepto.length > 35 ? m.concepto.slice(0, 33) + "…" : m.concepto}</p>
                      </td>
                      <td className="px-4 py-2 text-right align-top pt-2">
                        {m.debe > 0 ? <span className="font-mono font-semibold text-slate-900">{fmt(m.debe)}</span> : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right align-top pt-2">
                        {m.haber > 0 ? <span className="font-mono font-semibold text-red-600">{fmt(m.haber)}</span> : <span className="text-slate-200">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right align-top pt-2">
                        <span className={`font-mono font-black text-sm ${m.saldo >= 0 ? "text-slate-900" : "text-red-600"}`}>
                          {m.saldo >= 0 ? "D " : "A "}{fmt(Math.abs(m.saldo))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
