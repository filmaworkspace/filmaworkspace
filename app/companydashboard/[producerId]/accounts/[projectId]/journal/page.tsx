"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  Copy,
  Download,
  Filter,
  Info,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────
interface JLine {
  id: string;
  code: string;
  name: string;
  debe: number;
  haber: number;
}
interface Invoice {
  id: string;
  displayNumber: string;
  supplier: string;
  description: string;
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  accounted: boolean;
  accountingEntryNumber?: string;
  invoiceDate: Date;
  items: any[];
  journalLines?: JLine[];
}
interface ManualEntry {
  id: string;
  numero: string;
  date: string;
  concepto: string;
  lines: JLine[];
  tipo: string;
  createdAt: Date;
  recurrente?: boolean;
  frecuencia?: string;
}
interface ChartAccount {
  code: string;
  name: string;
}

// ── Nómina worker — expanded ──────────────────────────────────────────────────
interface NominaWorker {
  id: string;
  nombre: string;
  nif: string;
  categoria: string;           // puesto / función
  tipoContrato: string;        // indefinido, temporal, obra, prácticas, becario
  cuentaAnalitica: string;     // 640.XX → imputa el gasto a una subcuenta analítica
  bruto: number;               // salario base + complementos
  complementos: number;        // horas extras, pluses, dietas en nómina
  irpfPct: number;             // % retención IRPF (se calcula el €)
  ssObreraEur: number;         // € cuota obrera SS (calculada o manual)
  ssPatronalEur: number;       // € cuota patronal SS (calculada o manual)
  cuentaBancaria: string;      // IBAN para el pago del neto
  // derived
  get baseRetenci(): number;   // bruto + complementos
  get irpfEur(): number;
  get netoAPagar(): number;
  get costeTotalEmpresa(): number;
}

// ── Utils ─────────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtPct = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 9);

// Parse dd/mm/yyyy or yyyy-mm-dd → Date
const parseDate = (s: string): Date | null => {
  if (!s) return null;
  const parts = s.includes("/") ? s.split("/").reverse() : s.split("-");
  const d = new Date(`${parts[0]}-${parts[1]?.padStart(2,"0")}-${parts[2]?.padStart(2,"0")}`);
  return isNaN(d.getTime()) ? null : d;
};
const isoToDisplay = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};
const displayToIso = (s: string) => {
  const d = parseDate(s); return d ? d.toISOString().split("T")[0] : s;
};

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
  { code: "570", name: "Caja" }, { code: "572", name: "Bancos c/c" },
  { code: "572.1", name: "Banco principal" }, { code: "572.2", name: "Pleo / tarjetas corp." },
  { code: "602", name: "Compras otros aprovisionamientos" },
  { code: "621", name: "Arrendamientos y cánones" }, { code: "621.01", name: "Alquiler equipo" },
  { code: "621.02", name: "Alquiler sala" }, { code: "621.03", name: "Localizaciones" },
  { code: "623", name: "Servicios profesionales" }, { code: "624", name: "Transportes" },
  { code: "625", name: "Primas de seguros" }, { code: "626", name: "Servicios bancarios" },
  { code: "627", name: "Publicidad y propaganda" }, { code: "628", name: "Suministros" },
  { code: "629", name: "Otros servicios" }, { code: "629.01", name: "Catering" },
  { code: "629.02", name: "Dietas y gastos menores" },
  { code: "631", name: "Trabajos por otras empresas" },
  { code: "640", name: "Sueldos y salarios" },
  { code: "640.01", name: "Sueldos — producción" },
  { code: "640.02", name: "Sueldos — dirección" },
  { code: "640.03", name: "Sueldos — técnico" },
  { code: "640.04", name: "Sueldos — administración" },
  { code: "641", name: "Indemnizaciones" },
  { code: "642", name: "SS a cargo de la empresa" },
  { code: "649", name: "Otros gastos sociales" },
  { code: "680", name: "Amortización inmov. intangible" },
  { code: "700", name: "Ventas" }, { code: "705", name: "Prestaciones de servicios" },
  { code: "746", name: "Subvenciones transferidas al resultado" },
  { code: "770", name: "Beneficios enajenación inmov." },
  { code: "840", name: "Transferencia subvenciones de capital" },
  { code: "940", name: "Ingresos subvenciones de capital (PN)" },
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

const TIPOS_CONTRATO = ["Indefinido", "Temporal", "Obra y servicio", "Prácticas", "Becario", "Autónomo colaborador"];

// ── Entry templates ───────────────────────────────────────────────────────────
interface EntryTemplate {
  id: string; label: string; description: string; tipo: string;
  params: { key: string; label: string; type: "number" | "text"; placeholder?: string }[];
  buildLines: (p: Record<string, number | string>) => JLine[];
  suggestConcepto: (p: Record<string, number | string>) => string;
}

const TEMPLATES: EntryTemplate[] = [
  { id: "pago_proveedor", label: "Pago a proveedor", description: "Salda proveedor (400) contra bancos (572).", tipo: "Gestión",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "proveedor", label: "Proveedor", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "400", name: `Proveedores — ${p.proveedor}`, debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Fra. ${p.factura} — ${p.proveedor}.` },
  { id: "cobro_cliente", label: "Cobro de cliente", description: "Bancos (572), salda cliente (430).", tipo: "Gestión",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "572", name: "Bancos c/c", debe: +p.importe, haber: 0 }, { id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Cobro Fra. ${p.factura} — ${p.cliente}.` },
  { id: "activacion_obra", label: "Activación obra audiovisual", description: "Traslada 230 en curso → 203 propiedad intelectual.", tipo: "Activación",
    params: [{ key: "importe", label: "Coste total €", type: "number" }, { key: "titulo", label: "Título obra", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "203", name: `Propiedad intelectual — ${p.titulo}`, debe: +p.importe, haber: 0 }, { id: uid(), code: "230", name: "Inmov. en curso", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Activación obra '${p.titulo}' — producción finalizada.` },
  { id: "amortizacion_obra", label: "Amortización anual obra", description: "Gasto amortización (680) contra amortización acumulada (2803).", tipo: "Amortización",
    params: [{ key: "cuota", label: "Cuota anual €", type: "number" }, { key: "titulo", label: "Título obra", type: "text" }, { key: "ano", label: "Año (ej: 1 de 5)", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "680", name: "Amortización inmov. intangible", debe: +p.cuota, haber: 0 }, { id: uid(), code: "2803", name: `Amort. acum. — ${p.titulo}`, debe: 0, haber: +p.cuota }],
    suggestConcepto: (p) => `Amort. obra '${p.titulo}' — año ${p.ano}. Lineal.` },
  { id: "liquidacion_iva", label: "Liquidación IVA (Mod. 303)", description: "IVA repercutido (477) vs soportado (472) → resultado 4750 o 470.", tipo: "Fiscal",
    params: [{ key: "repercutido", label: "IVA repercutido 477 €", type: "number" }, { key: "soportado", label: "IVA soportado 472 €", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => { const rep = +p.repercutido; const sop = +p.soportado; const r = rep - sop; const lines: JLine[] = [{ id: uid(), code: "477", name: "IVA repercutido", debe: rep, haber: 0 }]; if (sop > 0) lines.push({ id: uid(), code: "472", name: "H.P. IVA soportado", debe: 0, haber: sop }); if (r > 0) lines.push({ id: uid(), code: "4750", name: "H.P. acreedora por IVA", debe: 0, haber: r }); else if (r < 0) lines.push({ id: uid(), code: "470", name: "H.P. deudora por IVA (a compensar)", debe: Math.abs(r), haber: 0 }); return lines; },
    suggestConcepto: (p) => { const r = +p.repercutido - +p.soportado; return `Liquidación IVA ${p.trimestre} — Mod. 303. ${r >= 0 ? "A pagar " + fmt(r) + " €" : "A compensar " + fmt(Math.abs(r)) + " €"}.`; } },
  { id: "pago_303", label: "Pago Mod. 303 a Hacienda", description: "H.P. acreedora IVA (4750) → bancos.", tipo: "Fiscal",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => [{ id: uid(), code: "4750", name: "H.P. acreedora por IVA", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Mod. 303 ${p.trimestre} a Hacienda.` },
  { id: "pago_111", label: "Pago Mod. 111 (retenciones IRPF)", description: "Retenciones (4751) → bancos.", tipo: "Fiscal",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "trimestre", label: "Trimestre", type: "text", placeholder: "T1 2025" }],
    buildLines: (p) => [{ id: uid(), code: "4751", name: "H.P. acreedora retenciones", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago Mod. 111 ${p.trimestre} — retenciones IRPF.` },
  { id: "pago_ss", label: "Pago cuotas SS", description: "SS acreedores (476) → bancos.", tipo: "Nómina",
    params: [{ key: "importe", label: "Total cuotas SS €", type: "number" }, { key: "periodo", label: "Período", type: "text", placeholder: "enero 2025" }],
    buildLines: (p) => [{ id: uid(), code: "476", name: "Organismos SS acreedores", debe: +p.importe, haber: 0 }, { id: uid(), code: "572", name: "Bancos c/c", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Pago SS ${p.periodo} — Tesorería SS.` },
  { id: "periodificacion", label: "Periodificación de gasto", description: "Difiere gasto al ejercicio correcto (480 ← cuenta gasto). Principio devengo.", tipo: "Periodificación",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "cuenta", label: "Cuenta gasto (ej: 625)", type: "text" }, { key: "concepto", label: "Descripción", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "480", name: "Gastos anticipados", debe: +p.importe, haber: 0 }, { id: uid(), code: String(p.cuenta), name: String(p.concepto), debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Periodificación — ${p.concepto}.` },
  { id: "pleo_carga", label: "Carga Pleo", description: "Banco (572.1) → Pleo (572.2).", tipo: "Tesorería",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "descripcion", label: "Concepto", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "572.2", name: "Pleo / tarjetas corp.", debe: +p.importe, haber: 0 }, { id: uid(), code: "572.1", name: "Banco principal", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Traspaso banco → Pleo. ${p.descripcion}.` },
  { id: "pleo_devolucion", label: "Devolución saldo Pleo", description: "Pleo (572.2) → banco (572.1).", tipo: "Tesorería",
    params: [{ key: "importe", label: "Saldo devuelto €", type: "number" }],
    buildLines: (p) => [{ id: uid(), code: "572.1", name: "Banco principal", debe: +p.importe, haber: 0 }, { id: uid(), code: "572.2", name: "Pleo / tarjetas corp.", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Devolución saldo Pleo ${fmt(+p.importe)} €.` },
  { id: "subvencion_concesion", label: "Reconocimiento subvención ICAA", description: "H.P. deudora (4708) → PN (940). Al publicarse BOE.", tipo: "Subvención",
    params: [{ key: "importe", label: "Importe €", type: "number" }, { key: "expediente", label: "Nº expediente", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "4708", name: "H.P. deudora subvenciones", debe: +p.importe, haber: 0 }, { id: uid(), code: "940", name: "Ingresos subvenciones capital (PN)", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Reconocimiento subv. ICAA ${fmt(+p.importe)} €. Exp. ${p.expediente}.` },
  { id: "subvencion_cobro", label: "Cobro subvención ICAA", description: "Bancos (572) → H.P. deudora (4708).", tipo: "Subvención",
    params: [{ key: "importe", label: "Importe cobrado €", type: "number" }],
    buildLines: (p) => [{ id: uid(), code: "572", name: "Bancos c/c", debe: +p.importe, haber: 0 }, { id: uid(), code: "4708", name: "H.P. deudora subvenciones", debe: 0, haber: +p.importe }],
    suggestConcepto: (p) => `Cobro subv. ICAA ${fmt(+p.importe)} €.` },
  { id: "factura_emitida_esp", label: "Factura emitida (cliente español)", description: "Clientes (430) + IVA repercutido (477) 21% → 705.", tipo: "Ingresos",
    params: [{ key: "base", label: "Base imponible €", type: "number" }, { key: "cliente", label: "Cliente", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => { const b = +p.base; const iva = b * 0.21; return [{ id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: b + iva, haber: 0 }, { id: uid(), code: "705", name: "Prestación de servicios", debe: 0, haber: b }, { id: uid(), code: "477", name: "IVA repercutido (21%)", debe: 0, haber: iva }]; },
    suggestConcepto: (p) => `Fra. ${p.factura} — ${p.cliente}.` },
  { id: "factura_emitida_ue", label: "Factura emitida (plataforma UE — inv. SP)", description: "Sin IVA. Art. 69 LIVA. Presentar Mod. 349.", tipo: "Ingresos",
    params: [{ key: "base", label: "Importe €", type: "number" }, { key: "cliente", label: "Plataforma", type: "text" }, { key: "factura", label: "Nº factura", type: "text" }],
    buildLines: (p) => [{ id: uid(), code: "430", name: `Clientes — ${p.cliente}`, debe: +p.base, haber: 0 }, { id: uid(), code: "705", name: "Prestación de servicios — Inv. SP", debe: 0, haber: +p.base }],
    suggestConcepto: (p) => `Fra. ${p.factura} — ${p.cliente}. SIN IVA — Inv. SP art. 69 LIVA. Mod. 349.` },
];

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

// ── Account Select (combobox) ─────────────────────────────────────────────────
function AccountSelect({ value, plan, onChange }: { value: string; plan: ChartAccount[]; onChange: (c: string) => void }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => { const lo = q.toLowerCase(); return (q ? plan.filter(a => a.code.includes(lo) || a.name.toLowerCase().includes(lo)) : plan).slice(0, 12); }, [q, plan]);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const current = plan.find(a => a.code === value);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen(o => !o); setQ(""); }}
        className="w-full flex items-center justify-between gap-1 border border-slate-200 rounded px-2 py-0.5 bg-white hover:border-slate-400 text-left">
        <span className="font-mono text-[10px] font-bold">{value}</span>
        {current && <span className="text-[9px] text-slate-400 truncate ml-1">{current.name}</span>}
        <ChevronDown size={9} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-0.5 z-[60] bg-white border border-slate-200 rounded-lg shadow-xl w-64">
          <div className="p-1.5 border-b border-slate-100">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Código o nombre"
              className="w-full text-xs px-2 py-1 border border-slate-200 rounded outline-none font-mono" />
          </div>
          <div className="max-h-48 overflow-y-auto py-0.5">
            {matches.map(a => (
              <button key={a.code} type="button" onClick={() => { onChange(a.code); setOpen(false); setQ(""); }}
                className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 hover:bg-slate-50 ${a.code === value ? "bg-slate-50" : ""}`}>
                <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded min-w-[42px] text-center ${a.code === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>{a.code}</span>
                <span className="text-[10px] text-slate-600 truncate">{a.name}</span>
              </button>
            ))}
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

  // ── Date / period filters ────────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const [filterYear,    setFilterYear]    = useState<number | "all">(currentYear);
  const [filterFrom,    setFilterFrom]    = useState("");  // ISO yyyy-mm-dd
  const [filterTo,      setFilterTo]      = useState("");
  const [showDatePanel, setShowDatePanel] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (dateRef.current && !dateRef.current.contains(e.target as Node)) setShowDatePanel(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

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

  // ── Nómina state — expanded ──────────────────────────────────────────────────
  const [nPeriodo,      setNPeriodo]      = useState(() => new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
  const [nFecha,        setNFecha]        = useState(new Date().toLocaleDateString("es-ES"));
  const [nEntryNomina,  setNEntryNomina]  = useState("");  // asiento 1: nómina
  const [nEntrySS,      setNEntrySS]      = useState("");  // asiento 2: SS patronal
  const [nEntryPago,    setNEntryPago]    = useState("");  // asiento 3: pago neto
  const [nCtaBancaria,  setNCtaBancaria]  = useState("572.1");  // cuenta pago por defecto
  const [nDesglose,     setNDesglose]     = useState<"agregado" | "trabajador">("trabajador"); // nivel de desglose
  const [nWorkers,      setNWorkers]      = useState<NominaWorker[]>([
    { id: uid(), nombre: "", nif: "", categoria: "", tipoContrato: "Indefinido", cuentaAnalitica: "640", bruto: 0, complementos: 0, irpfPct: 15, ssObreraEur: 0, ssPatronalEur: 0, cuentaBancaria: "",
      get baseRetenci() { return this.bruto + this.complementos; },
      get irpfEur() { return Math.round(this.baseRetenci * this.irpfPct) / 100; },
      get netoAPagar() { return this.baseRetenci - this.irpfEur - this.ssObreraEur; },
      get costeTotalEmpresa() { return this.baseRetenci + this.ssPatronalEur; },
    },
  ]);

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
      if (planDoc.exists()) {
        const stored = planDoc.data().accounts?.map((a: any) => ({ code: a.code, name: a.name })) || [];
        // merge: stored takes priority, append defaults not in stored
        const codes = new Set(stored.map((a: any) => a.code));
        setPlan([...stored, ...DEFAULT_PLAN.filter(a => !codes.has(a.code))]);
      }
      const [invSnap, manSnap] = await Promise.all([
        getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))),
        getDocs(query(collection(db, `projects/${projectId}/manualEntries`), orderBy("createdAt", "asc"))).catch(() => ({ docs: [] })),
      ]);
      setInvoices(invSnap.docs.map(d => { const r = d.data(); return { id: d.id, displayNumber: r.displayNumber || r.number, supplier: r.supplier, description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0, irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, accounted: r.accounted || false, accountingEntryNumber: r.accountingEntryNumber, invoiceDate: r.invoiceDate?.toDate?.() || r.createdAt?.toDate?.() || new Date(), items: r.items || [], journalLines: r.journalLines || null }; }));
      setManuals((manSnap as any).docs.map((d: any) => { const r = d.data(); return { id: d.id, numero: r.numero, date: r.date, concepto: r.concepto, lines: r.lines || [], tipo: r.tipo || "manual", recurrente: r.recurrente || false, frecuencia: r.frecuencia, createdAt: r.createdAt?.toDate?.() || new Date() }; }));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  // ── All entries ───────────────────────────────────────────────────────────────
  const allEntries = useMemo(() => {
    type E = { id: string; numero: string; fecha: string; fechaISO: string; concepto: string; lines: JLine[]; isManual: boolean; tipo: string; recurrente?: boolean; frecuencia?: string };
    const toISO = (s: string) => { const d = parseDate(s); return d ? d.toISOString().split("T")[0] : ""; };
    const inv: E[] = invoices.filter(i => i.accounted && i.accountingEntryNumber).map(i => {
      const f = i.invoiceDate instanceof Date ? i.invoiceDate.toLocaleDateString("es-ES") : "";
      return { id: i.id, numero: i.accountingEntryNumber!, fecha: f, fechaISO: toISO(f), concepto: i.description + " — " + i.displayNumber, lines: buildLines(i), isManual: false, tipo: "Gestión" };
    });
    const man: E[] = manuals.map(m => ({ id: m.id, numero: m.numero, fecha: m.date, fechaISO: toISO(m.date), concepto: m.concepto, lines: m.lines, isManual: true, tipo: m.tipo, recurrente: m.recurrente, frecuencia: m.frecuencia }));
    return [...inv, ...man].sort((a, b) => a.numero.localeCompare(b.numero));
  }, [invoices, manuals]);

  const tipoOptions = useMemo(() => ["all", ...Array.from(new Set(allEntries.map(e => e.tipo)))], [allEntries]);
  const yearOptions = useMemo(() => {
    const years = new Set(allEntries.map(e => e.fechaISO.slice(0, 4)).filter(Boolean));
    return Array.from(years).sort().reverse();
  }, [allEntries]);

  const filtered = useMemo(() => allEntries.filter(e => {
    const matchSearch = !search || e.numero.toLowerCase().includes(search.toLowerCase()) || e.concepto.toLowerCase().includes(search.toLowerCase());
    const matchTipo   = tipoFilter === "all" || e.tipo === tipoFilter;
    const matchYear   = filterYear === "all" || e.fechaISO.startsWith(String(filterYear));
    const matchFrom   = !filterFrom || e.fechaISO >= filterFrom;
    const matchTo     = !filterTo   || e.fechaISO <= filterTo;
    return matchSearch && matchTipo && matchYear && matchFrom && matchTo;
  }), [allEntries, search, tipoFilter, filterYear, filterFrom, filterTo]);

  const hasDateFilter = filterFrom || filterTo || filterYear !== currentYear;

  // ── Template helpers ──────────────────────────────────────────────────────────
  const applyTemplate = (tpl: EntryTemplate) => { setSelectedTpl(tpl); setTplParams({}); setMTipo(tpl.tipo); setShowTemplates(false); };
  const buildFromTemplate = () => {
    if (!selectedTpl) return;
    setMLines(selectedTpl.buildLines(tplParams));
    if (selectedTpl.suggestConcepto) setMConcept(selectedTpl.suggestConcepto(tplParams));
    setSelectedTpl(null); setTplParams({});
  };

  // ── Line helpers ──────────────────────────────────────────────────────────────
  const updateMLine = (id: string, field: keyof JLine, val: string | number) => {
    setMLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === "code") { const acc = planCuentas.find(a => a.code === val); return { ...l, code: val as string, name: l.name || acc?.name || "" }; }
      return { ...l, [field]: val };
    }));
  };
  const mDebe = mLines.reduce((s, l) => s + (l.debe || 0), 0);
  const mHaber = mLines.reduce((s, l) => s + (l.haber || 0), 0);
  const mDiff  = Math.abs(mDebe - mHaber);
  const mOk    = mDiff < 0.01 && mDebe > 0;

  // ── Save manual ───────────────────────────────────────────────────────────────
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

  const duplicateEntry = (entry: { numero: string; concepto: string; lines: JLine[]; tipo: string }) => {
    setMNum(entry.numero + "-copia"); setMConcept(entry.concepto); setMTipo(entry.tipo);
    setMLines(entry.lines.map(l => ({ ...l, id: uid() }))); setActiveModal("entry");
  };

  const deleteManual = async (id: string) => {
    if (!confirm("¿Eliminar este asiento?")) return;
    await deleteDoc(doc(db, `projects/${projectId}/manualEntries`, id));
    showToast("Asiento eliminado"); await loadData();
  };

  // ── Nómina helpers ────────────────────────────────────────────────────────────
  const makeWorker = (): NominaWorker => ({
    id: uid(), nombre: "", nif: "", categoria: "", tipoContrato: "Indefinido",
    cuentaAnalitica: "640", bruto: 0, complementos: 0, irpfPct: 15,
    ssObreraEur: 0, ssPatronalEur: 0, cuentaBancaria: "",
    get baseRetenci() { return this.bruto + this.complementos; },
    get irpfEur()     { return Math.round(this.baseRetenci * this.irpfPct) / 100; },
    get netoAPagar()  { return this.baseRetenci - this.irpfEur - this.ssObreraEur; },
    get costeTotalEmpresa() { return this.baseRetenci + this.ssPatronalEur; },
  });

  const addWorker    = () => setNWorkers(p => [...p, makeWorker()]);
  const removeWorker = (id: string) => setNWorkers(p => p.filter(w => w.id !== id));
  const updateWorker = (id: string, field: string, val: string | number) =>
    setNWorkers(p => p.map(w => w.id !== id ? w : Object.assign(Object.create(Object.getPrototypeOf(w)), w, { [field]: val })));

  // Derived nómina totals
  const nTot = useMemo(() => {
    const valid = nWorkers.filter(w => w.nombre && w.bruto > 0);
    const bruto      = valid.reduce((s, w) => s + w.bruto + w.complementos, 0);
    const irpf       = valid.reduce((s, w) => s + w.irpfEur, 0);
    const ssObrera   = valid.reduce((s, w) => s + w.ssObreraEur, 0);
    const ssPatronal = valid.reduce((s, w) => s + w.ssPatronalEur, 0);
    const neto       = bruto - irpf - ssObrera;
    return { valid, bruto, irpf, ssObrera, ssPatronal, neto, costeEmpresa: bruto + ssPatronal };
  }, [nWorkers]);

  // Build the three payroll journal entries
  const buildNominaEntries = () => {
    const { valid } = nTot;
    // ── Asiento 1: Nómina (devengo) ──
    // Si desglose por trabajador: una línea 640.xx por persona + una 465 global
    // Si agregado: una sola línea 640
    let nominaLines: JLine[] = [];
    if (nDesglose === "trabajador") {
      valid.forEach(w => {
        nominaLines.push({ id: uid(), code: w.cuentaAnalitica || "640", name: `Sueldos — ${w.nombre}${w.categoria ? ` (${w.categoria})` : ""}`, debe: w.bruto + w.complementos, haber: 0 });
      });
    } else {
      nominaLines.push({ id: uid(), code: "640", name: "Sueldos y salarios", debe: nTot.bruto, haber: 0 });
    }
    if (nTot.irpf > 0)     nominaLines.push({ id: uid(), code: "4751", name: "H.P. acreedora retenciones IRPF", debe: 0, haber: nTot.irpf });
    if (nTot.ssObrera > 0) nominaLines.push({ id: uid(), code: "476",  name: "SS acreedores — cuota obrera", debe: 0, haber: nTot.ssObrera });
    nominaLines.push({ id: uid(), code: "465", name: `Remuneraciones pendientes — ${nPeriodo}`, debe: 0, haber: nTot.neto });

    // ── Asiento 2: SS patronal ──
    const ssLines: JLine[] = [];
    if (nDesglose === "trabajador") {
      valid.forEach(w => {
        if (w.ssPatronalEur > 0) ssLines.push({ id: uid(), code: w.cuentaAnalitica?.replace("640", "642") || "642", name: `SS empresa — ${w.nombre}`, debe: w.ssPatronalEur, haber: 0 });
      });
    } else {
      ssLines.push({ id: uid(), code: "642", name: "SS a cargo de la empresa", debe: nTot.ssPatronal, haber: 0 });
    }
    ssLines.push({ id: uid(), code: "476", name: "SS acreedores — cuota patronal", debe: 0, haber: nTot.ssPatronal });

    // ── Asiento 3: Pago neto al trabajador ──
    const pagoLines: JLine[] = [];
    if (nDesglose === "trabajador") {
      valid.forEach(w => {
        const neto = w.netoAPagar;
        if (neto > 0) pagoLines.push({ id: uid(), code: "465", name: `Remuneraciones pendientes — ${w.nombre}`, debe: neto, haber: 0 });
      });
    } else {
      pagoLines.push({ id: uid(), code: "465", name: `Remuneraciones pendientes — ${nPeriodo}`, debe: nTot.neto, haber: 0 });
    }
    pagoLines.push({ id: uid(), code: nCtaBancaria, name: "Bancos c/c — pago neto trabajadores", debe: 0, haber: nTot.neto });

    return { nominaLines, ssLines, pagoLines };
  };

  const saveNomina = async () => {
    if (!nEntryNomina.trim() || !nEntrySS.trim() || !nEntryPago.trim()) { showToast("Rellena los tres números de asiento"); return; }
    if (nTot.valid.length === 0) { showToast("Añade al menos un trabajador con datos"); return; }
    const { nominaLines, ssLines, pagoLines } = buildNominaEntries();
    const workersDesc = nTot.valid.map(w => `${w.nombre}${w.categoria ? ` (${w.categoria})` : ""}`).join(", ");
    try {
      const t = Date.now();
      await Promise.all([
        setDoc(doc(db, `projects/${projectId}/manualEntries`, `NOM-${t}-1`), {
          numero: nEntryNomina.trim(), date: nFecha, tipo: "Nómina",
          concepto: `Nmna. ${nPeriodo} — ${workersDesc}`,
          lines: nominaLines, createdAt: new Date(t),
        }),
        setDoc(doc(db, `projects/${projectId}/manualEntries`, `NOM-${t}-2`), {
          numero: nEntrySS.trim(), date: nFecha, tipo: "Nómina",
          concepto: `SS patronal ${nPeriodo} — cuota empresa`,
          lines: ssLines, createdAt: new Date(t + 1),
        }),
        setDoc(doc(db, `projects/${projectId}/manualEntries`, `NOM-${t}-3`), {
          numero: nEntryPago.trim(), date: nFecha, tipo: "Nómina",
          concepto: `Pago neto nmna. ${nPeriodo} — ${nTot.valid.length} trabajador${nTot.valid.length > 1 ? "es" : ""}`,
          lines: pagoLines, createdAt: new Date(t + 2),
        }),
      ]);
      showToast(`Nómina contabilizada — 3 asientos (${nTot.valid.length} trabajadores)`);
      setActiveModal(null);
      setNWorkers([makeWorker()]); setNEntryNomina(""); setNEntrySS(""); setNEntryPago("");
      await loadData();
    } catch (err) { console.error(err); showToast("Error al guardar"); }
  };

  const handleExport = () => {
    const rows: string[][] = [["Asiento", "Fecha", "Concepto", "Tipo", "Cuenta", "Nombre", "Debe", "Haber"]];
    filtered.forEach(e => e.lines.forEach(l => rows.push([e.numero, e.fecha, e.concepto, e.tipo, l.code, l.name, fmt(l.debe), fmt(l.haber)])));
    exportCSV(rows, `libro_diario_${filterYear === "all" ? "completo" : filterYear}.csv`);
    showToast("Libro Diario exportado");
  };

  const totalDebe  = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.debe, 0), 0);
  const totalHaber = filtered.reduce((s, e) => s + e.lines.reduce((ss, l) => ss + l.haber, 0), 0);

  // Preview: cuadre de los tres asientos
  const { nominaLines, ssLines, pagoLines } = useMemo(() => nTot.valid.length > 0 ? buildNominaEntries() : { nominaLines: [], ssLines: [], pagoLines: [] }, [nWorkers, nCtaBancaria, nDesglose, nPeriodo]);

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {toast && <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2"><CheckCircle size={14} />{toast}</div>}

      {/* ══ MODAL: Asiento manual ══════════════════════════════════════════════════ */}
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
                  <button onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-1 hover:bg-slate-50">Seleccionar plantilla <ChevronDown size={11} /></button>
                </div>
                {showTemplates && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden mb-3 max-h-56 overflow-y-auto">
                    {["Gestión","Activación","Amortización","Fiscal","Nómina","Subvención","Tesorería","Periodificación","Ingresos"].map(tipo => {
                      const tpls = TEMPLATES.filter(t => t.tipo === tipo); if (!tpls.length) return null;
                      return (<div key={tipo}><div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${TIPO_COLORS[tipo] || ""}`}>{tipo}</span></div>{tpls.map(tpl => (<button key={tpl.id} onClick={() => applyTemplate(tpl)} className="w-full text-left px-3 py-2 border-b border-slate-50 hover:bg-slate-50"><p className="text-xs font-medium text-slate-900">{tpl.label}</p><p className="text-[10px] text-slate-400 mt-0.5">{tpl.description}</p></button>))}</div>);
                    })}
                  </div>
                )}
                {selectedTpl && (
                  <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mb-3">
                    <p className="text-xs font-semibold text-blue-800 mb-3">{selectedTpl.label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedTpl.params.map(p => (<div key={p.key}><label className="block text-[10px] font-medium text-blue-700 mb-1">{p.label}</label><input type={p.type} placeholder={p.placeholder} value={tplParams[p.key] || ""} onChange={e => setTplParams(prev => ({ ...prev, [p.key]: p.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value }))} className="w-full px-2 py-1 border border-blue-200 rounded text-xs focus:ring-1 focus:ring-blue-300 outline-none bg-white font-mono" /></div>))}
                    </div>
                    <div className="flex gap-2 mt-3"><button onClick={buildFromTemplate} className="px-3 py-1.5 bg-blue-700 text-white text-xs rounded hover:bg-blue-800">Aplicar plantilla</button><button onClick={() => { setSelectedTpl(null); setTplParams({}); }} className="px-3 py-1.5 border border-blue-200 text-blue-700 text-xs rounded">Cancelar</button></div>
                  </div>
                )}
              </div>
              {/* Base fields */}
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Nº Asiento *</label><input value={mNum} onChange={e => setMNum(e.target.value)} placeholder="M-2024-001" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" /></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label><input value={mDate} onChange={e => setMDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" /></div>
                <div><label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label><select value={mTipo} onChange={e => setMTipo(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">{["manual","Gestión","Activación","Amortización","Fiscal","Nómina","Subvención","Tesorería","Periodificación","Ingresos","Cierre"].map(t => <option key={t}>{t}</option>)}</select></div>
                <div className="col-span-3"><label className="block text-xs font-medium text-slate-600 mb-1">Concepto *</label><input value={mConcept} onChange={e => setMConcept(e.target.value)} placeholder="Fra. 2025/001 — Descripción. Proveedor SL" className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" /></div>
              </div>
              {/* Recurrente */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={mRecurr} onChange={e => setMRecurr(e.target.checked)} className="rounded" /><Repeat size={12} className="text-slate-400" /><span className="text-slate-600">Asiento recurrente</span></label>
                {mRecurr && <select value={mFreq} onChange={e => setMFreq(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-slate-400 outline-none"><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option></select>}
              </div>
              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Líneas</label>
                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border ${mOk ? "bg-emerald-50 text-emerald-700 border-emerald-200" : mDebe === 0 ? "bg-slate-50 text-slate-400 border-slate-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                      {mOk ? `✓ ${fmt(mDebe)} €` : mDebe === 0 ? "Introduce importes" : `D ${fmt(mDebe)} H ${fmt(mHaber)} Δ ${fmt(mDiff)}`}
                    </span>
                  </div>
                  <button onClick={() => setMLines(p => [...p, { id: uid(), code: "400", name: "", debe: 0, haber: 0 }])} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50"><Plus size={10} />Línea</button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200"><tr><th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase w-32">Cuenta</th><th className="px-2 py-1.5 text-left text-[10px] font-mono text-slate-400 uppercase">Descripción</th><th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Debe</th><th className="px-2 py-1.5 text-right text-[10px] font-mono text-slate-400 uppercase w-24">Haber</th><th className="w-7" /></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {mLines.map(line => (
                        <tr key={line.id}>
                          <td className="px-2 py-1"><AccountSelect value={line.code} plan={planCuentas} onChange={code => updateMLine(line.id, "code", code)} /></td>
                          <td className="px-2 py-1"><input value={line.name} onChange={e => updateMLine(line.id, "name", e.target.value)} placeholder={planCuentas.find(a => a.code === line.code)?.name || ""} className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1"><input type="number" value={line.debe || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "debe", parseFloat(e.target.value) || 0)} className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1"><input type="number" value={line.haber || ""} min={0} step={0.01} onChange={e => updateMLine(line.id, "haber", parseFloat(e.target.value) || 0)} className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-1"><button onClick={() => setMLines(p => p.filter(l => l.id !== line.id))} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50"><tr><td colSpan={2} className={`px-2 py-1.5 font-mono text-[10px] font-bold ${mOk ? "text-emerald-600" : "text-red-600"}`}>{mOk ? "✓ Cuadrado" : mDebe === 0 ? "—" : `✗ Dif. ${fmt(mDiff)} €`}</td><td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-slate-900">{fmt(mDebe)}</td><td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-red-600">{fmt(mHaber)}</td><td /></tr></tfoot>
                  </table>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={() => { setActiveModal(null); resetManualForm(); }} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={saveManual} disabled={!mOk || !mNum || !mConcept} className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40">Guardar asiento</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: Nóminas ══════════════════════════════════════════════════════════ */}
      {activeModal === "nomina" && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-5xl max-h-[94vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <Users size={15} className="text-blue-600" />
                <h3 className="font-semibold text-slate-900 text-sm">Contabilizar nóminas</h3>
                <span className="text-[10px] font-mono text-slate-400">— genera 3 asientos: devengo · SS patronal · pago neto</span>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Cabecera nómina */}
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2 col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Período *</label>
                  <input value={nPeriodo} onChange={e => setNPeriodo(e.target.value)} placeholder="enero 2025"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Fecha asiento</label>
                  <input value={nFecha} onChange={e => setNFecha(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cuenta pago neto</label>
                  <AccountSelect value={nCtaBancaria} plan={planCuentas.filter(a => a.code.startsWith("57"))} onChange={setNCtaBancaria} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Desglose</label>
                  <select value={nDesglose} onChange={e => setNDesglose(e.target.value as any)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none bg-white">
                    <option value="trabajador">Por trabajador (cuenta analítica)</option>
                    <option value="agregado">Agregado (una línea global)</option>
                  </select>
                </div>
              </div>

              {/* Números de asiento */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Nº Asiento 1 — Nómina (devengo)", val: nEntryNomina, set: setNEntryNomina, ph: "NOM-2025-001", color: "border-blue-200 bg-blue-50" },
                  { label: "Nº Asiento 2 — SS patronal",       val: nEntrySS,      set: setNEntrySS,      ph: "NOM-2025-002", color: "border-amber-200 bg-amber-50" },
                  { label: "Nº Asiento 3 — Pago neto",         val: nEntryPago,    set: setNEntryPago,    ph: "NOM-2025-003", color: "border-emerald-200 bg-emerald-50" },
                ].map(f => (
                  <div key={f.ph} className={`border rounded-lg px-3 py-2.5 ${f.color}`}>
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1 uppercase tracking-wider">{f.label}</label>
                    <input value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.ph}
                      className="w-full px-2 py-1 border border-slate-200 rounded text-sm font-mono focus:ring-1 focus:ring-slate-400 outline-none bg-white" />
                  </div>
                ))}
              </div>

              {/* Tabla de trabajadores */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Trabajadores</label>
                    <span className="text-[10px] text-slate-400">IRPF % → calcula € automáticamente</span>
                  </div>
                  <button onClick={addWorker} className="flex items-center gap-1 text-xs border border-slate-200 rounded px-2 py-0.5 hover:bg-slate-50"><Plus size={10} />Añadir trabajador</button>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: 900 }}>
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-2 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Nombre / NIF</th>
                        <th className="px-2 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Categoría / Contrato</th>
                        <th className="px-2 py-2 text-left text-[10px] font-mono text-slate-400 uppercase w-28">Cta. analítica</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">Salario base €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">Complement. €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">IRPF %</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">SS obrera €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase">SS patronal €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase bg-blue-50">IRPF €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase bg-emerald-50">Neto €</th>
                        <th className="px-2 py-2 text-right text-[10px] font-mono text-slate-400 uppercase bg-amber-50">Coste emp. €</th>
                        <th className="w-7" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {nWorkers.map(w => (
                        <tr key={w.id} className="hover:bg-slate-50">
                          <td className="px-2 py-1.5">
                            <input value={w.nombre} onChange={e => updateWorker(w.id, "nombre", e.target.value)} placeholder="Nombre completo"
                              className="w-full text-xs border border-slate-200 rounded px-1.5 py-0.5 focus:border-slate-400 outline-none mb-0.5" />
                            <input value={w.nif} onChange={e => updateWorker(w.id, "nif", e.target.value)} placeholder="NIF / NIE"
                              className="w-full text-[10px] font-mono border border-slate-100 rounded px-1.5 py-0.5 focus:border-slate-400 outline-none text-slate-500" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={w.categoria} onChange={e => updateWorker(w.id, "categoria", e.target.value)} placeholder="Categoría"
                              className="w-full text-xs border border-slate-200 rounded px-1.5 py-0.5 focus:border-slate-400 outline-none mb-0.5" />
                            <select value={w.tipoContrato} onChange={e => updateWorker(w.id, "tipoContrato", e.target.value)}
                              className="w-full text-[10px] border border-slate-100 rounded px-1.5 py-0.5 bg-white focus:border-slate-400 outline-none text-slate-500">
                              {TIPOS_CONTRATO.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <AccountSelect value={w.cuentaAnalitica || "640"} plan={planCuentas.filter(a => a.code.startsWith("64"))} onChange={code => updateWorker(w.id, "cuentaAnalitica", code)} />
                            <p className="text-[9px] text-slate-400 mt-0.5 font-mono px-0.5">Cuenta 640.xx</p>
                          </td>
                          <td className="px-2 py-1.5"><input type="number" value={w.bruto || ""} min={0} step={0.01} onChange={e => updateWorker(w.id, "bruto", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.complementos || ""} min={0} step={0.01} onChange={e => updateWorker(w.id, "complementos", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" placeholder="0.00" /></td>
                          <td className="px-2 py-1.5">
                            <input type="number" value={w.irpfPct || ""} min={0} max={50} step={0.1} onChange={e => updateWorker(w.id, "irpfPct", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                          </td>
                          <td className="px-2 py-1.5"><input type="number" value={w.ssObreraEur || ""} min={0} step={0.01} onChange={e => updateWorker(w.id, "ssObreraEur", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          <td className="px-2 py-1.5"><input type="number" value={w.ssPatronalEur || ""} min={0} step={0.01} onChange={e => updateWorker(w.id, "ssPatronalEur", parseFloat(e.target.value) || 0)} className="font-mono text-xs border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" /></td>
                          {/* Calculated */}
                          <td className="px-2 py-1.5 text-right bg-blue-50"><span className="font-mono text-xs font-semibold text-blue-800">{fmt(w.irpfEur)}</span></td>
                          <td className="px-2 py-1.5 text-right bg-emerald-50"><span className={`font-mono text-xs font-bold ${w.netoAPagar >= 0 ? "text-emerald-700" : "text-red-600"}`}>{fmt(w.netoAPagar)}</span></td>
                          <td className="px-2 py-1.5 text-right bg-amber-50"><span className="font-mono text-xs font-semibold text-amber-800">{fmt(w.costeTotalEmpresa)}</span></td>
                          <td className="px-1"><button onClick={() => removeWorker(w.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={10} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                    {nWorkers.length > 0 && (
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                        <tr>
                          <td colSpan={3} className="px-2 py-2 font-mono text-[10px] font-semibold text-slate-500 uppercase">{nTot.valid.length} trabajadores con datos</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-slate-900">{fmt(nTot.valid.reduce((s,w)=>s+w.bruto,0))}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-slate-900">{fmt(nTot.valid.reduce((s,w)=>s+w.complementos,0))}</td>
                          <td />
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-red-600">{fmt(nTot.ssObrera)}</td>
                          <td className="px-2 py-2 text-right font-mono text-xs font-bold text-amber-700">{fmt(nTot.ssPatronal)}</td>
                          <td className="px-2 py-2 text-right bg-blue-50 font-mono text-xs font-bold text-blue-800">{fmt(nTot.irpf)}</td>
                          <td className="px-2 py-2 text-right bg-emerald-50 font-mono text-sm font-bold text-emerald-700">{fmt(nTot.neto)}</td>
                          <td className="px-2 py-2 text-right bg-amber-50 font-mono text-sm font-bold text-amber-800">{fmt(nTot.costeEmpresa)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {/* Nota sobre IRPF */}
                <div className="mt-2 flex items-start gap-2 text-[10px] text-slate-500">
                  <Info size={11} className="flex-shrink-0 mt-0.5" />
                  <span>IRPF %: 15% autónomos (régimen general), 7% primer/segundo año, variable en nóminas según tramos IRPF del trabajador. Las cuotas SS son aproximadas — introduce los importes exactos del recibo de liquidación de cotizaciones (RLC).</span>
                </div>
              </div>

              {/* Preview de los 3 asientos */}
              {nTot.valid.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Vista previa — 3 asientos que se crearán</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { titulo: "Asiento 1 — Nómina (devengo)", lines: nominaLines, color: "blue", num: nEntryNomina || "NOM-?-001" },
                      { titulo: "Asiento 2 — SS patronal",       lines: ssLines,    color: "amber", num: nEntrySS || "NOM-?-002" },
                      { titulo: "Asiento 3 — Pago neto",         lines: pagoLines,  color: "emerald", num: nEntryPago || "NOM-?-003" },
                    ].map(({ titulo, lines, color, num }) => {
                      const td = lines.reduce((s, l) => s + l.debe, 0);
                      const th = lines.reduce((s, l) => s + l.haber, 0);
                      const ok = Math.abs(td - th) < 0.01;
                      const bg = color === "blue" ? "bg-blue-50 border-blue-200" : color === "amber" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200";
                      const tc = color === "blue" ? "text-blue-700" : color === "amber" ? "text-amber-700" : "text-emerald-700";
                      return (
                        <div key={titulo} className={`border rounded-lg overflow-hidden ${bg}`}>
                          <div className={`px-3 py-2 flex items-center justify-between border-b ${color === "blue" ? "border-blue-200" : color === "amber" ? "border-amber-200" : "border-emerald-200"}`}>
                            <div>
                              <p className={`text-[10px] font-semibold uppercase tracking-wider ${tc}`}>{titulo}</p>
                              <p className="font-mono text-xs font-bold text-slate-900 mt-0.5">{num}</p>
                            </div>
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{ok ? "✓" : "✗"} {fmt(td)} €</span>
                          </div>
                          <div className="px-3 py-2 space-y-1">
                            {lines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between gap-1 text-[10px]">
                                <span className={`font-mono font-bold px-1 py-0.5 rounded text-[9px] bg-white border ${color === "blue" ? "border-blue-200 text-blue-800" : color === "amber" ? "border-amber-200 text-amber-800" : "border-emerald-200 text-emerald-800"}`}>{l.code}</span>
                                <span className="flex-1 text-slate-600 truncate mx-1">{l.name}</span>
                                {l.debe  > 0 && <span className="font-mono font-semibold text-slate-900 whitespace-nowrap">{fmt(l.debe)} D</span>}
                                {l.haber > 0 && <span className="font-mono font-semibold text-red-600 whitespace-nowrap">{fmt(l.haber)} H</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={() => setActiveModal(null)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancelar</button>
              <button onClick={saveNomina} disabled={!nEntryNomina || !nEntrySS || !nEntryPago || nTot.valid.length === 0}
                className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-40 flex items-center gap-2">
                <Users size={13} />Contabilizar {nTot.valid.length > 0 ? `${nTot.valid.length} trabajador${nTot.valid.length > 1 ? "es" : ""}` : "nóminas"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MAIN ══════════════════════════════════════════════════════════════════ */}
      <div className="mt-[53px] p-6">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Libro Diario</h1>
            <p className="font-mono text-xs text-slate-500 mt-0.5">
              {filtered.length} asientos · {manuals.length} manuales
              {filterYear !== "all" && <span> · Ejercicio {filterYear}</span>}
              {(filterFrom || filterTo) && <span className="text-amber-600"> · Fechas filtradas</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={loadData} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input placeholder="Buscar asiento" value={search} onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none w-48" />
            </div>

            {/* Tipo filter */}
            <div className="relative">
              <Filter size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select value={tipoFilter} onChange={e => setTipoFilter(e.target.value)}
                className="pl-7 pr-6 py-1.5 text-sm border border-slate-200 bg-white rounded-lg focus:ring-1 focus:ring-slate-400 outline-none appearance-none cursor-pointer">
                {tipoOptions.map(t => <option key={t} value={t}>{t === "all" ? "Todos los tipos" : t}</option>)}
              </select>
            </div>

            {/* Year selector */}
            <div className="relative">
              <Calendar size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select value={filterYear} onChange={e => { setFilterYear(e.target.value === "all" ? "all" : +e.target.value); setFilterFrom(""); setFilterTo(""); }}
                className={`pl-7 pr-6 py-1.5 text-sm border rounded-lg focus:ring-1 focus:ring-slate-400 outline-none appearance-none cursor-pointer ${filterYear !== "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`}>
                <option value="all">Todos los años</option>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                {!yearOptions.includes(String(currentYear)) && <option value={currentYear}>{currentYear}</option>}
              </select>
            </div>

            {/* Date range panel */}
            <div className="relative" ref={dateRef}>
              <button onClick={() => setShowDatePanel(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${(filterFrom || filterTo) ? "bg-amber-600 text-white border-amber-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <Calendar size={13} />
                {filterFrom || filterTo ? "Filtro activo" : "Rango fecha"}
              </button>
              {showDatePanel && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl p-4 z-50 w-72">
                  <p className="text-xs font-semibold text-slate-700 mb-3">Filtrar por rango de fechas</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">Desde</label>
                      <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setFilterYear("all"); }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:border-slate-400 outline-none font-mono" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">Hasta</label>
                      <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setFilterYear("all"); }}
                        className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:border-slate-400 outline-none font-mono" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {/* Quick presets */}
                    {[
                      { label: "T1", from: `${currentYear}-01-01`, to: `${currentYear}-03-31` },
                      { label: "T2", from: `${currentYear}-04-01`, to: `${currentYear}-06-30` },
                      { label: "T3", from: `${currentYear}-07-01`, to: `${currentYear}-09-30` },
                      { label: "T4", from: `${currentYear}-10-01`, to: `${currentYear}-12-31` },
                    ].map(p => (
                      <button key={p.label} onClick={() => { setFilterFrom(p.from); setFilterTo(p.to); setFilterYear("all"); }}
                        className={`flex-1 py-1 text-[10px] font-mono font-semibold border rounded transition-colors ${filterFrom === p.from && filterTo === p.to ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {(filterFrom || filterTo) && (
                    <button onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterYear(currentYear); }} className="w-full mt-2 py-1 text-xs text-red-600 hover:text-red-800">Limpiar filtro de fechas</button>
                  )}
                </div>
              )}
            </div>

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
            <p className="text-sm text-slate-500">
              {allEntries.length === 0 ? "No hay asientos. Contabiliza facturas o crea asientos manuales." : "Sin resultados para los filtros aplicados."}
            </p>
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
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2.5 flex-wrap">
                    <span className="font-mono text-xs font-bold bg-slate-900 text-white px-2.5 py-1 rounded">{entry.numero}</span>
                    <span className="font-mono text-xs text-slate-500">{entry.fecha}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${tipoStyle}`}>{entry.tipo}</span>
                    {entry.recurrente && (
                      <span className="flex items-center gap-1 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                        <Repeat size={9} />{entry.frecuencia}
                      </span>
                    )}
                    <span className="text-sm text-slate-700 flex-1 truncate min-w-0">{entry.concepto}</span>
                    <span className="font-mono text-xs text-slate-400">Σ {fmt(td)} €</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>{ok ? "Cuadrado" : "Descuadrado"}</span>
                    {entry.isManual && (
                      <>
                        <button onClick={() => duplicateEntry(entry)} title="Duplicar" className="text-slate-400 hover:text-slate-700 p-0.5"><Copy size={12} /></button>
                        <button onClick={() => deleteManual(entry.id)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
                      </>
                    )}
                    {!entry.isManual && (
                      <button onClick={() => duplicateEntry(entry)} title="Copiar como manual" className="text-slate-300 hover:text-slate-600 p-0.5"><Copy size={12} /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-slate-100">
                    {[{ label: "Debe", lines: entry.lines.filter(l => l.debe > 0), total: td, tc: "text-slate-900" },
                      { label: "Haber", lines: entry.lines.filter(l => l.haber > 0), total: th, tc: "text-red-600" }].map(side => (
                      <div key={side.label} className="p-4">
                        <p className="text-[9px] font-semibold font-mono text-slate-400 uppercase tracking-widest mb-3">{side.label}</p>
                        <div className="space-y-1.5">
                          {side.lines.map(l => (
                            <div key={l.id} className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded flex-shrink-0">{l.code}</span>
                                <span className="text-xs text-slate-600 truncate">{l.name}</span>
                              </div>
                              <span className={`font-mono text-xs font-semibold whitespace-nowrap ${side.tc}`}>{fmt(side.label === "Debe" ? l.debe : l.haber)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
                          <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">Total {side.label}</span>
                          <span className={`font-mono text-sm font-bold ${side.tc}`}>{fmt(side.total)} €</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="bg-slate-900 text-white rounded-lg px-6 py-4 flex items-center justify-between mt-4">
              <span className="font-mono text-xs tracking-widest uppercase text-slate-400">
                Totales — {filtered.length} asientos{filterYear !== "all" ? ` · Ejercicio ${filterYear}` : ""}
              </span>
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
