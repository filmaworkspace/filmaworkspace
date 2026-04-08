"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/journal/page.tsx

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, getDoc, doc, setDoc, deleteDoc, query, orderBy,
} from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import {
  Search, Download, CheckCircle, RefreshCw, Plus, Trash2, X,
  ChevronDown, Copy, Repeat, Users, FileText, Filter,
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
interface ManualEntry {
  id: string; numero: string; date: string; concepto: string;
  lines: JLine[]; tipo: string; createdAt: Date;
  recurrente?: boolean; frecuencia?: string;
}
interface ChartAccount { code: string; name: string; }

// ── Nómina worker type ────────────────────────────────────────────────────────
interface NominaWorker {
  id: string;
  nombre: string;
  categoria: string;
  bruto: number;
  irpf: number;      // importe €
  ssObrera: number;  // importe €
  ssPatronal: number; // importe €
}

// ── Utils ─────────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: Date | undefined) => d ? new Intl.DateTimeFormat("es-ES").format(d) : "—";
const uid = () => Math.random().toString(36).slice(2, 9);

const DEFAULT_PLAN: ChartAccount[] = [
  { code: "203", name: "Propiedad intelectual (obra)" },
  { code: "230", name: "Inmovilizado intangible en curso" },
  { code: "2803", name: "Amort. acum. propiedad intelectual" },
  { code: "400", name: "Proveedores" }, { code: "410", name: "Acreedores" },
  { code: "430", name: "Clientes" },
  { code: "460", name: "Anticipos de remuneraciones" },
  { code: "465", name: "Remuneraciones pendientes de pago" },
  { code: "470", name: "H.P. deudora por IVA" },
  { code: "472", name: "H.P. IVA soportado" },
  { code: "473", name: "H.P. retenciones practicadas" },
  { code: "475", name: "H.P. acreedora por IVA" },
  { code: "476", name: "Organismos SS acreedores" },
  { code: "477", name: "IVA repercutido" },
  { code: "480", name: "Gastos anticipados" },
  { code: "481", name: "Ingresos anticipados" },
  { code: "4708", name: "H.P. deudora por subvenciones" },
  { code: "4750", name: "H.P. acreedora por IS" },
  { code: "4751", name: "H.P. acreedora retenciones" },
  { code: "570", name: "Caja" },
  { code: "572", name: "Bancos c/c" },
  { code: "572.1", name: "Banco principal" },
  { code: "572.2", name: "Pleo / tarjetas corp." },
  { code: "602", name: "Compras otros aprovisionamientos" },
  { code: "621", name: "Arrendamientos y cánones" },
  { code: "621.01", name: "Alquiler equipo" },
  { code: "621.02", name: "Alquiler sala" },
  { code: "621.03", name: "Localizaciones" },
  { code: "623", name: "Servicios profesionales" },
  { code: "624", name: "Transportes" },
  { code: "625", name: "Primas de seguros" },
  { code: "626", name: "Servicios bancarios" },
  { code: "627", name: "Publicidad y propaganda" },
  { code: "628", name: "Suministros" },
  { code: "629", name: "Otros servicios" },
  { code: "629.01", name: "Catering" },
  { code: "629.02", name: "Dietas y gastos menores" },
  { code: "631", name: "Trabajos por otras empresas" },
  { code: "640", name: "Sueldos y salarios" },
  { code: "642", name: "SS a cargo empresa" },
  { code: "680", name: "Amortización inmov. intangible" },
  { code: "700", name: "Ventas" },
  { code: "705", name: "Prestaciones de servicios" },
  { code: "746", name: "Subvenciones transferidas al resultado" },
  { code: "770", name: "Beneficios enajenación inmov." },
  { code: "840", name: "Transferencia subvenciones de capital" },
  { code: "940", name: "Ingresos subvenciones de capital (PN)" },
];

// ── Entry templates ───────────────────────────────────────────────────────────
interface EntryTemplate {
  id: string; label: string; description: string; tipo: string;
  params: { key: string; label: string; type: "number" | "text"; placeholder?: string }[];
  buildLines: (p: Record<string, number | string>) => JLine[];
  suggestConcepto: (p: Record<string, number | string>) => string;
}

const TEMPLATES: EntryTemplate[] = [
  {
    id: "pago_proveedor", label: "Pago a proveedor", description: "Salda la deuda con proveedor (400) contra bancos (572).", tipo: "Gestión",
    params: [{ key: "importe", label: "Importe (€)", type: "number" }, { key: "proveedor", label: "Proveedor", type: "text" }, { key: "factura", label: "Nº factura", type: "text", placeholder: "2025/001" }],
    buildLines: (p) => [{ id: uid(), code: "400", name: `Proveedores — ${p.proveedor}`, debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Fra. ${p.factura} — ${p.proveedor}.`,
  },
  {
    id: "cobro_cliente", label: "Cobro de cliente", description: "Ingreso en bancos (572), salda crédito cliente (430).", tipo: "Gestión",
    params: [{ key: "importe", label: "Importe (€)", type: "number" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "572", name: "Bancos c/c", debe: +p.importe, haber: 0 }, { id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Cobro Fra. ${p.factura} — ${p.cliente}.`,
  },
  {
    id: "activacion_obra", label: "Activación obra audiovisual", description: "Traslada costes de 230 (en curso) a 203 (propiedad intelectual).", tipo: "Activación",
    params: [{ key: "importe", label: "Coste total (€)", type: "number", placeholder: "150000" }, { key: "titulo", label: "Título obra", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "203", name: `Propiedad intelectual — ${p.titulo}`, debe: +p.importe, haber: 0 }, { id: uid(), code: "230", name: "Inmov. intangible en curso", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Activación obra '${p.titulo}' — producción finalizada.`,
  },
  {
    id: "amortizacion_obra", label: "Amortización anual obra", description: "Gasto de amortización (680) contra amortización acumulada (2803).", tipo: "Amortización",
    params: [{ key: "cuota", label: "Cuota anual (€)", type: "number", placeholder: "30000" }, { key: "titulo", label: "Título obra", type: "text" }, { key: "ano", label: "Año (ej: 1 de 5)", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "680", name: "Amortización inmov. intangible", debe: +p.cuota, haber: 0 }, { id: uid(), code: "2803", name: `Amort. acum. — ${p.titulo}`, debe: 0, haber: +p.cuota }],
    suggestConcepto: (p) => `Amort. obra '${p.titulo}' — año ${p.ano}. Lineal.`,
  },
  {
    id: "liquidacion_iva", label: "Liquidación IVA (Mod. 303)", description: "Compensa IVA repercutido (477) con soportado (472). Saldo → 4750 o 470.", tipo: "Fiscal",
    params: [{ key: "repercutido", label: "IVA repercutido 477 (€)", type: "number" }, { key: "soportado", label: "IVA soportado 472 (€)", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => {
      const rep = +p.repercutido; const sop = +p.soportado; const r = rep - sop;
      const lines: JLine[] = [{ id: uid(), code: "477", name: "IVA repercutido", debe: rep, haber: 0 }];
      if (sop > 0) lines.push({ id: uid(), code: "472", name: "H.P. IVA soportado", debe: 0, haber: sop });
      if (r > 0) lines.push({ id: uid(), code: "4750", name: "H.P. acreedora por IVA", debe: 0, haber: r });
      else if (r < 0) lines.push({ id: uid(), code: "470", name: "H.P. deudora por IVA (a compensar)", debe: Math.abs(r), haber: 0 });
      return lines;
    },
    suggestConcepto: (p) => { const r = +p.repercutido - +p.soportado; return `Liquidación IVA ${p.trimestre} — Mod. 303. ${r >= 0 ? "A pagar " + fmt(r) + " €" : "A compensar " + fmt(Math.abs(r)) + " €"}.`; },
  },
  {
    id: "pago_303", label: "Pago Mod. 303 a Hacienda", description: "Salda H.P. acreedora IVA (4750) contra bancos.", tipo: "Fiscal",
    params: [{ key: "importe", label: "Importe (€)", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => [{ id: uid(), code: "4750", name: "H.P. acreedora por IVA", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Mod. 303 ${p.trimestre} a Hacienda.`,
  },
  {
    id: "pago_111", label: "Pago Mod. 111 (retenciones IRPF)", description: "Ingresa a Hacienda las retenciones practicadas (4751) contra bancos.", tipo: "Fiscal",
    params: [{ key: "importe", label: "Importe retenciones (€)", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => [{ id: uid(), code: "4751", name: "H.P. acreedora retenciones", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Mod. 111 ${p.trimestre} — retenciones IRPF a Hacienda.`,
  },
  {
    id: "pago_ss", label: "Pago cuotas SS a la Seguridad Social", description: "Salda SS acreedores (476) contra bancos.", tipo: "Nómina",
    params: [{ key: "importe", label: "Total cuotas SS (€)", type: "number" }, { key: "periodo", label: "Período", type: "text", placeholder: "enero 2025" }],
    buildLines: (p) => [{ id: uid(), code: "476", name: "Organismos SS acreedores", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago SS ${p.periodo} — transferencia Seguridad Social.`,
  },
  {
    id: "periodificacion", label: "Periodificación de gasto", description: "Difiere gasto al ejercicio que corresponde (480 ← cuenta gasto).", tipo: "Periodificación",
    params: [{ key: "importe", label: "Importe (€)", type: "number" }, { key: "cuenta", label: "Cuenta gasto (ej: 625)", type: "text" }, { key: "concepto", label: "Descripción", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "480", name: "Gastos anticipados", debe: +p.importe, haber: 0 }, { id: uid(), code: String(p.cuenta), name: String(p.concepto), debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Periodificación — ${p.concepto}.`,
  },
  {
    id: "pleo_carga", label: "Carga Pleo", description: "Traspaso de banco principal (572.1) a Pleo (572.2).", tipo: "Tesorería",
    params: [{ key: "importe", label: "Importe (€)", type: "number" }, { key: "descripcion", label: "Concepto", type: "text", placeholder: "Provisión rodaje sem. 1" }],
    buildLines: (p) => [{ id: uid(), code: "572.2", name: "Pleo / tarjetas corporativas", debe: +p.importe, haber: 0 }, { id: uid(), code: "572.1", name: "Banco principal", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Traspaso banco → Pleo. ${p.descripcion}.`,
  },
  {
    id: "pleo_devolucion", label: "Devolución saldo Pleo", description: "Devuelve saldo de Pleo (572.2) al banco principal (572.1).", tipo: "Tesorería",
    params: [{ key: "importe", label: "Saldo devuelto (€)", type: "number" }],
    buildLines: (p) => [{ id: uid(), code: "572.1", name: "Banco principal", debe: +p.importe, haber: 0 }, { id: uid(), code: "572.2", name: "Pleo / tarjetas corporativas", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Devolución saldo Pleo ${fmt(+p.importe)} € al finalizar rodaje.`,
  },
  {
    id: "subvencion_concesion", label: "Reconocimiento subvención ICAA", description: "H.P. deudora (4708) contra PN (940). Al publicarse resolución BOE.", tipo: "Subvención",
    params: [{ key: "importe", label: "Importe subvención (€)", type: "number" }, { key: "expediente", label: "Nº expediente / BOE", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "4708", name: "H.P. deudora por subvenciones", debe: +p.importe, haber: 0 }, { id: uid(), code: "940", name: "Ingresos subvenciones de capital (PN)", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Reconocimiento subv. ICAA ${fmt(+p.importe)} €. Exp. ${p.expediente}.`,
  },
  {
    id: "subvencion_cobro", label: "Cobro subvención ICAA", description: "Bancos (572) contra H.P. deudora (4708).", tipo: "Subvención",
    params: [{ key: "importe", label: "Importe cobrado (€)", type: "number" }],
    buildLines: (p) => [{ id: uid(), code: "572", name: "Bancos c/c", debe: +p.importe, haber: 0 }, { id: uid(), code: "4708", name: "H.P. deudora por subvenciones", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Cobro subv. ICAA ${fmt(+p.importe)} €.`,
  },
  {
    id: "subvencion_imputacion", label: "Imputación anual subvención a resultados", description: "Transferencia (840) → ingreso (746). En paralelo a la amortización.", tipo: "Subvención",
    params: [{ key: "importe", label: "Importe a imputar (€)", type: "number" }, { key: "ano", label: "Año (ej: 1 de 5)", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "840", name: "Transferencia subvenciones de capital", debe: +p.importe, haber: 0 }, { id: uid(), code: "746", name: "Subvenciones transferidas al resultado", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Imputación subv. ICAA — año ${p.ano}.`,
  },
  {
    id: "factura_emitida_esp", label: "Factura emitida (cliente español)", description: "Clientes (430) contra 705 + IVA repercutido (477) al 21%.", tipo: "Ingresos",
    params: [{ key: "base", label: "Base imponible (€)", type: "number" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => { const b = +p.base; const iva = b * 0.21; return [{ id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: b + iva, haber: 0 }, { id: uid(), code: "705", name: "Prestación de servicios", debe: 0, haber: b }, { id: uid(), code: "477", name: "IVA repercutido (21%)", debe: 0, haber: iva }]; },
    suggestConcepto: (p) => `Fra. ${p.factura} — ${p.cliente}.`,
  },
  {
    id: "factura_emitida_ue", label: "Factura emitida (plataforma UE — inv. SP)", description: "Sin IVA. Inversión sujeto pasivo art. 69 LIVA. Presentar Mod. 349.", tipo: "Ingresos",
    params: [{ key: "base", label: "Importe (€)", type: "number" }, { key: "cliente", label: "Plataforma / cliente", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: +p.base, haber: 0 }, { id: uid(), code: "705", name: "Prestación de servicios — Inv. SP", debe: 0, haber: +p.base }],
    suggestConcepto: (p) => `Fra. ${p.factura} — ${p.cliente}. SIN IVA — Inv. SP art. 69 LIVA. Mod. 349.`,
  },
];

const TIPO_COLORS: Record<string, string> = {
  "Gestión":        "bg-slate-100 text-slate-700 border-slate-200",
  "Activación":     "bg-purple-50 text-purple-700 border-purple-200",
  "Amortización":   "bg-slate-100 text-slate-600 border-slate-200",
  "Fiscal":         "bg-red-50 text-red-700 border-red-200",
  "Nómina":         "bg-blue-50 text-blue-700 border-blue-200",
  "Subvención":     "bg-green-50 text-green-700 border-green-200",
  "Tesorería":      "bg-amber-50 text-amber-700 border-amber-200",
  "Periodificación":"bg-indigo-50 text-indigo-700 border-indigo-200",
  "Ingresos":       "bg-emerald-50 text-emerald-700 border-emerald-200",
  "manual":         "bg-slate-100 text-slate-500 border-slate-200",
};

function buildLines(inv: Invoice): JLine[] {
  if (inv.journalLines?.length) return inv.journalLines;
  const lines: JLine[] = [];
  inv.items.forEach((item: any, i: number) => { if (item.subAccountCode) lines.push({ id: `i${i}`, code: item.subAccountCode, name: item.description || item.subAccountCode, debe: item.baseAmount || 0, haber: 0 }); });
  if (inv.vatAmount > 0)  lines.push({ id: uid(), code: "472", name: "H.P. IVA soportado", debe: inv.vatAmount, haber: 0 });
  if (inv.irpfAmount < 0) lines.push({ id: uid(), code: "473", name: "H.P. retenciones practicadas", debe: 0, haber: Math.abs(inv.irpfAmount) });
  const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
  lines.push({ id: uid(), code: "400", name: `Proveedores — ${inv.supplier}`, debe: 0, haber: net });
  return lines;
}

const exportCSV = (rows: string[][], filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }));
  a.download = filename; a.click();
};

// ── Account search combobox ───────────────────────────────────────────────────
function AccountSelect({ value, plan, onChange }: { value: string; plan: ChartAccount[]; onChange: (code: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (!q) return plan.slice(0, 12);
    const lo = q.toLowerCase();
    return plan.filter(a => a.code.includes(lo) || a.name.toLowerCase().includes(lo)).slice(0, 12);
  }, [q, plan]);

  const current = plan.find(a => a.code === value);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen(!open); setQ(""); }}
        className="font-mono text-[10px] border border-slate-200 rounded px-1.5 py-0.5 w-full bg-white text-left flex items-center justify-between gap-1 hover:border-slate-400 transition-colors">
        <span className="font-semibold">{value}</span>
        <ChevronDown size={9} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 z-50 bg-white border border-slate-200 rounded-lg shadow-xl w-72">
          <div className="p-1.5 border-b border-slate-100">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cuenta..."
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:border-slate-400 outline-none font-mono" />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {matches.map(a => (
              <button key={a.code} type="button"
                onClick={() => { onChange(a.code); setOpen(false); setQ(""); }}
                className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2 ${a.code === value ? "bg-slate-50" : ""}`}>
                <span className="font-mono font-semibold text-slate-900 min-w-[48px]">{a.code}</span>
                <span className="text-slate-500 truncate">{a.name}</span>
              </button>
            ))}
            {matches.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Sin resultados</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function JournalPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,       setLoading]       = useState(true);
  const [invoices,      setInvoices]      = useState<Invoice[]>([]);
  const [manuals,       setManuals]       = useState<ManualEntry[]>([]);
  const [planCuentas,   setPlan]          = useState<ChartAccount[]>(DEFAULT_PLAN);
  const [search,        setSearch]        = useState("");
  const [tipoFilter,    setTipoFilter]    = useState("all");
  const [toast,         setToast]         = useState("");
  const [activeModal,   setActiveModal]   = useState<"entry" | "nomina" | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTpl,   setSelectedTpl]  = useState<EntryTemplate | null>(null);
  const [tplParams,     setTplParams]    = useState<Record<string, string | number>>({});

  // Manual entry form
  const [mNum,       setMNum]       = useState("");
  const [mDate,      setMDate]      = useState(new Date().toLocaleDateString("es-ES"));
  const [mConcept,   setMConcept]   = useState("");
  const [mTipo,      setMTipo]      = useState("manual");
  const [mRecurr,    setMRecurr]    = useState(false);
  const [mFreq,      setMFreq]      = useState("mensual");
  const [mLines,     setMLines]     = useState<JLine[]>([
    { id: uid(), code: "400", name: "", debe: 0, haber: 0 },
    { id: uid(), code: "572", name: "", debe: 0, haber: 0 },
  ]);

  // Nómina module
  const [nPeriodo,   setNPeriodo]   = useState(new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
  const [nWorkers,   setNWorkers]   = useState<NominaWorker[]>([
    { id: uid(), nombre: "", categoria: "", bruto: 0, irpf: 0, ssObrera: 0, ssPatronal: 0 },
  ]);
  const [nEntryNum,  setNEntryNum]  = useState("");
  const [nSsEntry,   setNSsEntry]   = useState("");

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;
  const showToast     = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pd, prj] = await Promise.all([getDoc(doc(db, "producers", producerId)), getDoc(doc(db, "projects", projectId))]);
      if (!pd.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!prj.exists()) { router.push(`/companydashboard/${producerId}`); return; }
      const planDoc = await getDoc(doc(db, `projects/${projectId}/config/planCuentas`));
      if (planDoc.exists()) setPlan(planDoc.data().accounts?.map((a: any) => ({ code: a.code, name: a.name })) || DEFAULT_PLAN);
      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
      ]);
      setInvoices(invSnap.docs.map(d => { const r = d.data(); return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null }; }));
      setManuals((manSnap as any).docs.map((d: any) => { const r = d.data(); return { id: d.id, numero: r.numero, date: r.date, concepto: r.concepto, lines: r.lines || [], tipo: r.tipo || "manual", recurrente: r.recurrente || false, frecuencia: r.frecuencia, createdAt: r.createdAt?.toDate?.() || new Date() }; }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── All entries ──────────────────────────────────────────────────────────────
  const allEntries = useMemo(() => {
    type E = { id: string; numero: string; fecha: string; concepto: string; lines: JLine[]; isManual: boolean; tipo: string; recurrente?: boolean; frecuencia?: string };
    const inv: E[] = invoices.filter(i => i.accounted && i.accountingEntryNumber).map(i => ({
      id: i.id, numero: i.accountingEntryNumber!, fecha: fmtDate(i.invoiceDate),
      concepto: i.description + " — " + i.displayNumber, lines: buildLines(i), isManual: false, tipo: "Gestión",
    }));
    const man: E[] = manuals.map(m => ({ id: m.id, numero: m.numero, fecha: m.date, concepto: m.concepto, lines: m.lines, isManual: true, tipo: m.tipo, recurrente: m.recurrente, frecuencia: m.frecuencia }));
    return [...inv, ...man].sort((a, b) => a.numero.localeCompare(b.numero));
  }, [invoices, manuals]);

  const tipoOptions = useMemo(() => ["all", ...Array.from(new Set(allEntries.map(e => e.tipo)))], [allEntries]);

  const filtered = useMemo(() => allEntries.filter(e => {
    const matchSearch = !search || e.numero.toLowerCase().includes(search.toLowerCase()) || e.concepto.toLowerCase().includes(search.toLowerCase());
    const matchTipo   = tipoFilter === "all" || e.tipo === tipoFilter;
    return matchSearch && matchTipo;
  }), [allEntries, search, tipoFilter]);

  // ── Apply template ────────────────────────────────────────────────────────────
  const applyTemplate = (tpl: EntryTemplate) => {
    setSelectedTpl(tpl); setTplParams({}); setMTipo(tpl.tipo); setShowTemplates(false);
  };
  const buildFromTemplate = () => {
    if (!selectedTpl) return;
    setMLines(selectedTpl.buildLines(tplParams));
    if (selectedTpl.suggestConcepto) setMConcept(selectedTpl.suggestConcepto(tplParams));
    setSelectedTpl(null); setTplParams({});
  };

  // ── Lines helpers ─────────────────────────────────────────────────────────────
  const updateMLine = (id: string, field: keyof JLine, val: string | number) => {
    setMLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === "code") { const acc = planCuentas.find(a => a.code === val); return { ...l, code: val as string, name: l.name || acc?.name || "" }; }
      return { ...l, [field]: val };
    }));
  };

  const mDebe  = mLines.reduce((s, l) => s + (l.debe || 0), 0);
  const mHaber = mLines.reduce((s, l) => s + (l.haber || 0), 0);
  const mDiff  = Math.abs(mDebe - mHaber);
  const mOk    = mDiff < 0.01 && mDebe > 0;

  // ── Save manual entry ─────────────────────────────────────────────────────────
  const saveManual = async () => {
    if (!mNum.trim() || !mConcept.trim()) { showToast("Número y concepto son obligatorios"); return; }
    const validLines = mLines.filter(l => l.code && (l.debe > 0 || l.haber > 0));
    const td = validLines.reduce((s, l) => s + (l.debe || 0), 0);
    const th = validLines.reduce((s, l) => s + (l.haber || 0), 0);
    if (Math.abs(td - th) > 0.01) { showToast(`El asiento no cuadra — dif. ${fmt(Math.abs(td - th))} €`); return; }
    try {
      await setDoc(doc(db, `projects/${projectId}/manualEntries`, `M-${Date.now()}`), {
        numero: mNum.trim(), date: mDate, concepto: mConcept.trim(), lines: validLines,
        tipo: mTipo, recurrente: mRecurr, frecuencia: mRecurr ? mFreq : null, createdAt: new Date(),
      });
      showToast("Asiento guardado"); setActiveModal(null); resetManualForm(); await loadData();
    } catch (err) { console.error(err); showToast("Error al guardar"); }
  };

  const resetManualForm = () => {
    setMNum(""); setMConcept(""); setMTipo("manual"); setMRecurr(false); setSelectedTpl(null);
    setMLines([{ id: uid(), code: "400", name: "", debe: 0, haber: 0 }, { id: uid(), code: "572", name: "", debe: 0, haber: 0 }]);
  };

  // ── Duplicate entry ───────────────────────────────────────────────────────────
  const duplicateEntry = (entry: { numero: string; concepto: string; lines: JLine[]; tipo: string }) => {
    setMNum(entry.numero + "-copia");
    setMConcept(entry.concepto);
    setMTipo(entry.tipo);
    setMLines(entry.lines.map(l => ({ ...l, id: uid() })));
    setActiveModal("entry");
  };

  // ── Delete manual ─────────────────────────────────────────────────────────────
  const deleteManual = async (id: string) => {
    if (!confirm("¿Eliminar este asiento?")) return;
    await deleteDoc(doc(db, `projects/${projectId}/manualEntries`, id));
    showToast("Asiento eliminado"); await loadData();
  };

  // ── Save nómina (creates two entries: nómina + SS patronal) ──────────────────
  const saveNomina = async () => {
    if (!nEntryNum.trim() || !nSsEntry.trim()) { showToast("Rellena los números de asiento"); return; }
    const validWorkers = nWorkers.filter(w => w.nombre && w.bruto > 0);
    if (validWorkers.length === 0) { showToast("Añade al menos un trabajador con datos"); return; }

    const totalBruto    = validWorkers.reduce((s, w) => s + w.bruto, 0);
    const totalIrpf     = validWorkers.reduce((s, w) => s + w.irpf, 0);
    const totalSsObrera = validWorkers.reduce((s, w) => s + w.ssObrera, 0);
    const totalNeto     = totalBruto - totalIrpf - totalSsObrera;
    const totalPatronal = validWorkers.reduce((s, w) => s + w.ssPatronal, 0);

    // Asiento nómina
    const nominaLines: JLine[] = [
      { id: uid(), code: "640", name: "Sueldos y salarios", debe: totalBruto, haber: 0 },
      { id: uid(), code: "4751", name: "H.P. acreedora retenciones (IRPF)", debe: 0, haber: totalIrpf },
      { id: uid(), code: "476", name: "Organismos SS acreedores (obrera)", debe: 0, haber: totalSsObrera },
      { id: uid(), code: "465", name: "Remuneraciones pendientes de pago", debe: 0, haber: totalNeto },
    ];
    // Asiento SS patronal
    const ssLines: JLine[] = [
      { id: uid(), code: "642", name: "SS a cargo de la empresa", debe: totalPatronal, haber: 0 },
      { id: uid(), code: "476", name: "Organismos SS acreedores (patronal)", debe: 0, haber: totalPatronal },
    ];

    // Descripción trabajadores
    const workersDesc = validWorkers.map(w => w.nombre + (w.categoria ? ` (${w.categoria})` : "")).join(", ");

    try {
      await Promise.all([
        setDoc(doc(db, `projects/${projectId}/manualEntries`, `M-${Date.now()}-N`), {
          numero: nEntryNum.trim(), date: mDate, concepto: `Nmna. ${nPeriodo} — ${workersDesc}`,
          lines: nominaLines, tipo: "Nómina", createdAt: new Date(),
        }),
        setDoc(doc(db, `projects/${projectId}/manualEntries`, `M-${Date.now()}-SS`), {
          numero: nSsEntry.trim(), date: mDate, concepto: `SS patronal ${nPeriodo} — cuota empresa`,
          lines: ssLines, tipo: "Nómina", createdAt: new Date() + 1,
        }),
      ]);
      showToast(`Nómina contabilizada — ${validWorkers.length} trabajador${validWorkers.length > 1 ? "es" : ""}`);
      setActiveModal(null);
      setNWorkers([{ id: uid(), nombre: "", categoria: "", bruto: 0, irpf: 0, ssObrera: 0, ssPatronal: 0 }]);
      setNEntryNum(""); setNSsEntry("");
      await loadData();
    } catch (err) { console.error(err); showToast("Error al guardar"); }
  };

  const addWorker = () => setNWorkers(p => [...p, { id: uid(), nombre: "", categoria: "", bruto: 0, irpf: 0, ssObrera: 0, ssPatronal: 0 }]);
  const updateWorker = (id: string, field: keyof NominaWorker, val: string | number) => setNWorkers(p => p.map(w => w.id === id ? { ...w, [field]: val } : w));
  const removeWorker = (id: string) => setNWorkers(p => p.filter(w => w.id !== id));

  const nTotals = {
    bruto:      nWorkers.reduce((s, w) => s + (w.bruto || 0), 0),
    irpf:       nWorkers.reduce((s, w) => s + (w.irpf || 0), 0),
    ssObrera:   nWorkers.reduce((s, w) => s + (w.ssObrera || 0), 0),
    ssPatronal: nWorkers.reduce((s, w) => s + (w.ssPatronal || 0), 0),
    get neto() { return this.bruto - this.irpf - this.ssObrera; },
    get costeTotalEmpresa() { return this.bruto + this.ssPatronal; },
  };

  const handleExport = () => {
    const rows: string[][] = [["Asiento", "Fecha", "Concepto", "Tipo", "Cuenta", "Nombre", "Debe", "Haber"]];
    filtered.forEach(e => e.lines.forEach(l => rows.push([e.numero, e.fecha, e.concepto, e.tipo, l.code, l.name, fmt(l.debe), fmt(l.haber)])));
    exportCSV(rows, "libro_diario.csv"); showToast("Libro Diario exportado");
  };

  const totalDebe  = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.debe, 0), 0);
  const totalHaber = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.haber, 0), 0);

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"><CheckCircle size={14} />{toast}</div>}

      {/* ── MODAL: Asiento manual ── */}
      {activeModal === "entry" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-slate-900 text-sm">Nuevo asiento manual</h3>
              <button onClick={() => { setActiveModal(null); resetManualForm(); }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-4">

              {/* Template picker */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Plantilla</span>
                  <button onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-1 hover:bg-slate-50">
                    Seleccionar plantilla <ChevronDown size={11} />
                  </button>
                </div>
                {showTemplates && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden mb-3 max-h-56 overflow-y-auto">
                    {["Gestión","Activación","Amortización","Fiscal","Nómina","Subvención","Tesorería","Periodificación","Ingresos"].map(tipo => {
                      const tpls = TEMPLATES.filter(t => t.tipo === tipo);
                      if (!tpls.length) return null;
                      return (
                        <div key={tipo}>
                          <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${TIPO_COLORS[tipo] || ""}`}>{tipo}</span>
                          </div>
                          {tpls.map(tpl => (
                            <button key={tpl.id} onClick={() => applyTemplate(tpl)} className="w-full text-left px-3 py-2 border-b border-slate-50 hover:bg-slate-50">
                              <p className="text-xs font-medium text-slate-900">{tpl.label}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">{tpl.description}</p>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                {selectedTpl && (
                  <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-3">
                    <p className="text-xs font-semibold text-blue-800 mb-3">{selectedTpl.label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedTpl.params.map(p => (
                        <div key={p.key}>
                          <label className="block text-[10px] font-medium text-blue-700 mb-1">{p.label}</label>
                          <input type={p.type} placeholder={p.placeholder} value={tplParams[p.key] || ""}
                            onChange={e => setTplParams(prev => ({ ...prev, [p.key]: p.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))}
                            className="w-full px-2 py-1 border border-blue-200 rounded text-xs focus:ring-1 focus:ring-blue-300 outline-none bg-white font-mono" />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button onClick={buildFromTemplate} className="px-3 py-1.5 bg-blue-700 text-white text-xs rounded hover:bg-blue-800">Aplicar plantilla</button>
                      <button onClick={() => { setSelectedTpl(null); setTplParams({}); }} className="px-3 py-1.5 border border-blue-200 text-blue-700 text-xs rounded">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Base fields */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nº Asiento *</label>
                  <input value={mNum} onChange={e => setMNum(e.target.value)} placeholder="M-2024-001"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                  <input value={mDate} onChange={e => setMDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                  <select value={mTipo} onChange={e => setMTipo(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">
                    {["manual","Gestión","Activación","Amortización","Fiscal","Nómina","Subvención","Tesorería","Periodificación","Ingresos","Cierre"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Concepto * <span className="text-slate-400 font-normal">— estructura: TIPO · REF · DESCRIPCIÓN · PERÍODO</span></label>
                  <input value={mConcept} onChange={e => setMConcept(e.target.value)} placeholder="Fra. 2025/001 — Alquiler cámara. Cine Tech SL"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
              </div>

              {/* Recurrente */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={mRecurr} onChange={e => setMRecurr(e.target.checked)} className="rounded" />
                  <Repeat size={12} className="text-slate-400" />
                  <span className="text-slate-600">Asiento recurrente</span>
                </label>
                {mRecurr && (
                  <select value={mFreq} onChange={e => setMFreq(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-slate-400 outline-none">
                    <option value="mensual">Mensual</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="anual">Anual</option>
                  </select>
                )}
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Líneas</label>
                    {/* Live balance indicator */}
                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${mOk ? "bg-emerald-50 text-emerald-700 border-emerald-200" : mDebe === 0 ? "bg-slate-50 text-slate-400 border-slate-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                      {mOk ? `✓ Cuadrado ${fmt(mDebe)} €` : mDebe === 0 ? "Introduce importes" : `D ${fmt(mDebe)} H ${fmt(mHaber)} Δ ${fmt(mDiff)}`}
                    </span>
                  </div>
                  <button onClick={() => setMLines(p => [...p, { id: uid(), code: "400", name: "", debe: 0, haber: 0 }])} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50">
                    <Plus size={10} />Línea
                  </button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase w-28">Cuenta</th>
                        <th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase">Descripción</th>
                        <th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Debe</th>
                        <th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Haber</th>
                        <th className="w-7" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mLines.map(line => (
                        <tr key={line.id}>
                          <td className="px-2 py-1">
                            <AccountSelect value={line.code} plan={planCuentas} onChange={code => updateMLine(line.id, "code", code)} />
                          </td>
                          <td className="px-2 py-1">
                            <input value={line.name} onChange={e => updateMLine(line.id, "name", e.target.value)}
                              placeholder={planCuentas.find(a => a.code === line.code)?.name || ""}
                              className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" value={line.debe || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "debe", parseFloat(e.target.value) || 0)}
                              className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-2 py-1">
                            <input type="number" value={line.haber || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "haber", parseFloat(e.target.value) || 0)}
                              className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-1">
                            <button onClick={() => setMLines(p => p.filter(l => l.id !== line.id))} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                      <tr>
                        <td colSpan={2} className={`px-2 py-1.5 font-mono text-[10px] font-bold ${mOk ? "text-emerald-600" : "text-red-600"}`}>
                          {mOk ? "✓ Cuadrado" : mDebe === 0 ? "—" : `✗ Dif. ${fmt(mDiff)} €`}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-slate-900">{fmt(mDebe)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-red-600">{fmt(mHaber)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={() => { setActiveModal(null); resetManualForm(); }} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={saveManual} disabled={!mOk || !mNum || !mConcept}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40">Guardar asiento</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Nóminas ── */}
      {activeModal === "nomina" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <Users size={15} className="text-blue-600" />
                <h3 className="font-semibold text-slate-900 text-sm">Contabilizar nóminas</h3>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-5">
              {/* Período + números asiento */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Período</label>
                  <input value={nPeriodo} onChange={e => setNPeriodo(e.target.value)} placeholder="enero 2025"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nº Asiento nómina *</label>
                  <input value={nEntryNum} onChange={e => setNEntryNum(e.target.value)} placeholder="M-2025-010"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nº Asiento SS patronal *</label>
                  <input value={nSsEntry} onChange={e => setNSsEntry(e.target.value)} placeholder="M-2025-011"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
              </div>

              {/* Fecha */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha del asiento</label>
                <input value={mDate} onChange={e => setMDate(e.target.value)}
                  className="w-44 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
              </div>

              {/* Workers table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Trabajadores</label>
                  <button onClick={addWorker} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50"><Plus size={10} />Añadir</button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Nombre</th>
                        <th className="px-2 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Categoría</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">Bruto €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">IRPF €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">SS obrera €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">SS patronal €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">Neto €</th>
                        <th className="w-7" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {nWorkers.map(w => (
                        <tr key={w.id}>
                          <td className="px-2 py-1.5"><input value={w.nombre} onChange={e => updateWorker(w.id, "nombre", e.target.value)} placeholder="Nombre" className="w-full text-xs border border-slate-200 rounded px-1.5 py-0.5 focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input value={w.categoria} onChange={e => updateWorker(w.id, "categoria", e.target.value)} placeholder="ej: Productor" className="w-full text-xs border border-slate-200 rounded px-1.5 py-0.5 focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.bruto || ""} onChange={e => updateWorker(w.id, "bruto", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.irpf || ""} onChange={e => updateWorker(w.id, "irpf", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.ssObrera || ""} onChange={e => updateWorker(w.id, "ssObrera", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.ssPatronal || ""} onChange={e => updateWorker(w.id, "ssPatronal", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5 text-right">
                            <span className={`font-mono text-xs font-semibold ${w.bruto - w.irpf - w.ssObrera > 0 ? "text-emerald-700" : "text-red-600"}`}>
                              {w.bruto > 0 ? fmt(w.bruto - w.irpf - w.ssObrera) : "—"}
                            </span>
                          </td>
                          <td className="px-1"><button onClick={() => removeWorker(w.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    {nWorkers.length > 1 && (
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                        <tr>
                          <td colSpan={2} className="px-2 py-2 font-mono text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Totales ({nWorkers.filter(w => w.nombre).length} trabajadores)</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-slate-900">{fmt(nTotals.bruto)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-red-600">{fmt(nTotals.irpf)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-red-600">{fmt(nTotals.ssObrera)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-amber-700">{fmt(nTotals.ssPatronal)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-emerald-700">{fmt(nTotals.neto)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* Preview de asientos */}
              {nTotals.bruto > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-[10px] font-mono font-semibold text-blue-700 uppercase tracking-wider mb-2">Asiento nómina — {nEntryNum || "M-???-N"}</p>
                    {[
                      { code: "640",  name: "Sueldos y salarios",              debe: nTotals.bruto,    haber: 0                },
                      { code: "4751", name: "H.P. acreedora retenciones",      debe: 0,                haber: nTotals.irpf     },
                      { code: "476",  name: "SS acreedores (obrera)",           debe: 0,                haber: nTotals.ssObrera },
                      { code: "465",  name: "Remuneraciones pendientes",        debe: 0,                haber: nTotals.neto     },
                    ].map((l, i) => (
                      <div key={i} className="flex justify-between text-xs py-0.5">
                        <span className="font-mono text-[9px] bg-blue-100 text-blue-800 px-1 rounded mr-1.5">{l.code}</span>
                        <span className="flex-1 text-blue-800">{l.name}</span>
                        {l.debe > 0 && <span className="font-mono font-semibold text-blue-900">{fmt(l.debe)}</span>}
                        {l.haber > 0 && <span className="font-mono font-semibold text-blue-700">{fmt(l.haber)}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-[10px] font-mono font-semibold text-amber-700 uppercase tracking-wider mb-2">Asiento SS patronal — {nSsEntry || "M-???-SS"}</p>
                    {[
                      { code: "642", name: "SS a cargo empresa",              debe: nTotals.ssPatronal, haber: 0                    },
                      { code: "476", name: "SS acreedores (patronal)",         debe: 0,                  haber: nTotals.ssPatronal   },
                    ].map((l, i) => (
                      <div key={i} className="flex justify-between text-xs py-0.5">
                        <span className="font-mono text-[9px] bg-amber-100 text-amber-800 px-1 rounded mr-1.5">{l.code}</span>
                        <span className="flex-1 text-amber-800">{l.name}</span>
                        {l.debe > 0 && <span className="font-mono font-semibold text-amber-900">{fmt(l.debe)}</span>}
                        {l.haber > 0 && <span className="font-mono font-semibold text-amber-700">{fmt(l.haber)}</span>}
                      </div>
                    ))}
                    <div className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-700">
                      <span className="font-semibold">Coste total empresa: {fmt(nTotals.costeTotalEmpresa)} €</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={saveNomina} disabled={!nEntryNum || !nSsEntry || nTotals.bruto === 0}
                className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-40 flex items-center gap-2">
                <Users size={13} />Contabilizar nóminas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN ── */}
      <div className="mt-[53px] p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Libro Diario</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">
              {filtered.length} asientos · {manuals.length} manuales · {manuals.filter(m => m.recurrente).length} recurrentes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input placeholder="Buscar asiento..." value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-52" />
            </div>
            {/* Tipo filter */}
            <div className="relative">
              <Filter size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none appearance-none">
                {tipoOptions.map(t => <option key={t} value={t}>{t === "all" ? "Todos los tipos" : t}</option>)}
              </select>
            </div>
            {/* Actions */}
            <button onClick={() => setActiveModal("nomina")} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-lg hover:bg-blue-800">
              <Users size={13} />Nóminas
            </button>
            <button onClick={() => { resetManualForm(); setActiveModal("entry"); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-700">
              <Plus size={13} />Asiento manual
            </button>
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 bg-white text-xs font-medium rounded-lg hover:bg-slate-50">
              <Download size={13} />Exportar
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center">
            <p className="text-sm text-slate-500">No hay asientos. Contabiliza facturas o crea asientos manuales.</p>
          </div>
        ) : (
          <>
            {filtered.map(entry => {
              const td = entry.lines.reduce((s, l) => s + l.debe, 0);
              const th = entry.lines.reduce((s, l) => s + l.haber, 0);
              const ok = Math.abs(td - th) < 0.01;
              const tipoStyle = TIPO_COLORS[entry.tipo] || TIPO_COLORS.manual;
              return (
                <div key={entry.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-3">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2.5">
                    <span className="font-mono text-xs font-bold bg-slate-900 text-white px-2.5 py-1 rounded">{entry.numero}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.fecha}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${tipoStyle}`}>{entry.tipo}</span>
                    {entry.recurrente && (
                      <span className="flex items-center gap-1 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                        <Repeat size={9} />{entry.frecuencia}
                      </span>
                    )}
                    <span className="text-sm text-slate-700 flex-1 truncate">{entry.concepto}</span>
                    <span className="font-mono text-xs text-slate-400">Σ {fmt(td)} €</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{ok ? "Cuadrado" : "Descuadrado"}</span>
                    {entry.isManual && (
                      <>
                        <button onClick={() => duplicateEntry(entry)} title="Duplicar asiento" className="text-slate-400 hover:text-slate-700 p-0.5"><Copy size={12} /></button>
                        <button onClick={() => deleteManual(entry.id)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
                      </>
                    )}
                    {!entry.isManual && (
                      <button onClick={() => duplicateEntry(entry)} title="Copiar como manual" className="text-slate-300 hover:text-slate-600 p-0.5"><Copy size={12} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-100">
                    <div className="p-4">
                      <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-3">Debe</p>
                      <div className="space-y-2">
                        {entry.lines.filter(l => l.debe > 0).map(l => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">{l.code}</span>
                              <span className="text-xs text-slate-600 truncate">{l.name}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">{fmt(l.debe)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Total Debe</span>
                        <span className="font-mono text-sm font-bold text-slate-900">{fmt(td)} €</span>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-3">Haber</p>
                      <div className="space-y-2">
                        {entry.lines.filter(l => l.haber > 0).map(l => (
                          <div key={l.id} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">{l.code}</span>
                              <span className="text-xs text-slate-600 truncate">{l.name}</span>
                            </div>
                            <span className="font-mono text-xs font-semibold text-red-600 whitespace-nowrap">{fmt(l.haber)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Total Haber</span>
                        <span className="font-mono text-sm font-bold text-red-600">{fmt(th)} €</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="bg-slate-900 text-white rounded-lg px-6 py-4 flex items-center justify-between mt-4">
              <span className="font-mono text-xs tracking-widest uppercase text-slate-400">Totales — {filtered.length} asientos</span>
              <div className="flex gap-12">
                <div className="text-right"><p className="text-[9px] text-slate-500 uppercase font-mono mb-1">Total Debe</p><p className="font-mono text-base font-bold">{fmt(totalDebe)} €</p></div>
                <div className="text-right"><p className="text-[9px] text-slate-500 uppercase font-mono mb-1">Total Haber</p><p className="font-mono text-base font-bold text-red-400">{fmt(totalHaber)} €</p></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
