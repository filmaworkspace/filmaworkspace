"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/page.tsx

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import {
  collection, getDocs, getDoc, doc, updateDoc, setDoc, query, orderBy,
} from "firebase/firestore";
import { handleInvoiceStatusChange } from "@/lib/budgetOperations";
import {
  Search, Filter, ChevronDown, ChevronLeft, ChevronRight, Eye,
  CheckCircle, Clock, AlertTriangle, Lock, Unlock, Euro, X,
  AlertCircle, RefreshCw, Calendar, CreditCard, ExternalLink,
  Plus, Trash2, Save, Info,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ── Types ─────────────────────────────────────────────────────────────────────

interface JournalLine {
  id: string;
  code: string;
  name: string;
  debe: number;
  haber: number;
}

interface Invoice {
  id: string;
  number: string;
  displayNumber: string;
  documentType: string;
  supplier: string;
  supplierId: string;
  description: string;
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  status: string;
  dueDate: Date;
  invoiceDate?: Date;
  createdAt: Date;
  items: any[];
  journalLines?: JournalLine[];
  attachmentUrl?: string;
  accounted?: boolean;
  accountedAt?: Date;
  accountedBy?: string;
  accountedByName?: string;
  accountingEntryNumber?: string;
  accountingAccount?: string;
  paidAt?: Date;
  paidAmount?: number;
}

interface ChartAccount { code: string; name: string; type: string; group: string; parent?: string | null; }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  draft:            { bg: "bg-slate-100",  text: "text-slate-600",  label: "Borrador"      },
  coding:           { bg: "bg-violet-50",  text: "text-violet-700", label: "Codificando"   },
  pending_approval: { bg: "bg-amber-50",   text: "text-amber-700",  label: "Pte. aprob."   },
  pending:          { bg: "bg-blue-50",    text: "text-blue-700",   label: "Pte. pago"     },
  approved:         { bg: "bg-emerald-50", text: "text-emerald-700",label: "Aprobada"      },
  accounted:        { bg: "bg-teal-50",    text: "text-teal-700",   label: "Contabilizada" },
  paid:             { bg: "bg-emerald-50", text: "text-emerald-700",label: "Pagada"        },
  rejected:         { bg: "bg-red-50",     text: "text-red-700",    label: "Rechazada"     },
  cancelled:        { bg: "bg-red-50",     text: "text-red-700",    label: "Anulada"       },
};

const FILTER_OPTIONS = [
  { value: "pending_accounting", label: "Pte. contabilizar" },
  { value: "accounted",          label: "Contabilizadas"    },
  { value: "not_coded",          label: "Sin codificar"     },
  { value: "all",                label: "Todas"             },
];

// Default plan loaded from Firestore; this is just the fallback
const FALLBACK_PLAN: ChartAccount[] = [
  { code: "203", name: "Propiedad intelectual (obra)",         type: "activo",  group: "2" },
  { code: "230", name: "Inmovilizado intangible en curso",     type: "activo",  group: "2" },
  { code: "400", name: "Proveedores",                          type: "pasivo",  group: "4" },
  { code: "430", name: "Clientes",                             type: "activo",  group: "4" },
  { code: "465", name: "Remuneraciones pendientes de pago",    type: "pasivo",  group: "4" },
  { code: "472", name: "H.P. IVA soportado",                   type: "activo",  group: "4" },
  { code: "473", name: "H.P. retenciones practicadas",         type: "pasivo",  group: "4" },
  { code: "475", name: "H.P. acreedora por IVA",               type: "pasivo",  group: "4" },
  { code: "476", name: "Organismos SS acreedores",             type: "pasivo",  group: "4" },
  { code: "477", name: "IVA repercutido",                      type: "pasivo",  group: "4" },
  { code: "480", name: "Gastos anticipados",                   type: "activo",  group: "4" },
  { code: "570", name: "Caja, euros",                          type: "activo",  group: "5" },
  { code: "572", name: "Bancos c/c",                           type: "activo",  group: "5" },
  { code: "572.1", name: "Banco principal",                    type: "activo",  group: "5", parent: "572" },
  { code: "572.2", name: "Pleo / tarjetas corporativas",       type: "activo",  group: "5", parent: "572" },
  { code: "602", name: "Compras otros aprovisionamientos",     type: "gasto",   group: "6" },
  { code: "621", name: "Arrendamientos y cánones",             type: "gasto",   group: "6" },
  { code: "621.01", name: "Alquiler equipo cámara",            type: "gasto",   group: "6", parent: "621" },
  { code: "621.02", name: "Alquiler sala grabación",           type: "gasto",   group: "6", parent: "621" },
  { code: "621.03", name: "Alquiler localizaciones",           type: "gasto",   group: "6", parent: "621" },
  { code: "623", name: "Servicios profesionales independientes",type: "gasto",  group: "6" },
  { code: "624", name: "Transportes",                          type: "gasto",   group: "6" },
  { code: "624.01", name: "Transporte equipo/material",        type: "gasto",   group: "6", parent: "624" },
  { code: "625", name: "Primas de seguros",                    type: "gasto",   group: "6" },
  { code: "625.01", name: "Seguro producción todo riesgo",     type: "gasto",   group: "6", parent: "625" },
  { code: "626", name: "Servicios bancarios y similares",      type: "gasto",   group: "6" },
  { code: "627", name: "Publicidad y propaganda",              type: "gasto",   group: "6" },
  { code: "628", name: "Suministros",                          type: "gasto",   group: "6" },
  { code: "629", name: "Otros servicios",                      type: "gasto",   group: "6" },
  { code: "629.01", name: "Catering",                          type: "gasto",   group: "6", parent: "629" },
  { code: "629.02", name: "Dietas y gastos menores",           type: "gasto",   group: "6", parent: "629" },
  { code: "631", name: "Trabajos por otras empresas",          type: "gasto",   group: "6" },
  { code: "631.01", name: "Jefe de cámara",                    type: "gasto",   group: "6", parent: "631" },
  { code: "631.02", name: "Operador steadicam",                type: "gasto",   group: "6", parent: "631" },
  { code: "631.03", name: "Técnico de sonido",                 type: "gasto",   group: "6", parent: "631" },
  { code: "631.04", name: "VFX supervisor",                    type: "gasto",   group: "6", parent: "631" },
  { code: "631.05", name: "Montaje y edición",                 type: "gasto",   group: "6", parent: "631" },
  { code: "640", name: "Sueldos y salarios",                   type: "gasto",   group: "6" },
  { code: "642", name: "SS a cargo de la empresa",             type: "gasto",   group: "6" },
  { code: "680", name: "Amortización inmov. intangible",       type: "gasto",   group: "6" },
  { code: "700", name: "Ventas de mercaderías",                type: "ingreso", group: "7" },
  { code: "705", name: "Prestaciones de servicios",            type: "ingreso", group: "7" },
  { code: "746", name: "Subvenciones transferidas al resultado",type: "ingreso",group: "7" },
  { code: "770", name: "Beneficios por enajenación inmov.",    type: "ingreso", group: "7" },
];

const fmt = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: Date | undefined) =>
  d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d) : "—";

// ── Smart invoice validation (based on manual rules) ──────────────────────────

interface ValidationWarning { level: "error" | "warn" | "info"; msg: string; }

function validateInvoice(inv: Invoice): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Fra. R- = rectificativa / abono
  if (inv.displayNumber?.startsWith("R-") || inv.displayNumber?.includes("/R-")) {
    warnings.push({ level: "info", msg: "Factura rectificativa (abono). Revisar si debe revertir asiento original." });
  }

  // IRPF: solo personas físicas (autónomos). Fra. A- = autónomo
  const isAutonomo = inv.displayNumber?.startsWith("A-") || inv.documentType === "autonomo";
  if (inv.irpfAmount < 0 && !isAutonomo) {
    warnings.push({ level: "warn", msg: "Se ha aplicado retención IRPF. Verifica que el emisor es autónomo (persona física). Las empresas (SL, SA, AIE) NO llevan retención." });
  }
  if (isAutonomo && inv.irpfAmount === 0) {
    warnings.push({ level: "warn", msg: "Factura de autónomo sin retención IRPF. ¿Primer/segundo año de actividad (7%)? Si no, aplica 15%." });
  }

  // IVA: detectar tipo
  if (inv.vatAmount > 0 && inv.baseAmount > 0) {
    const rate = Math.round((inv.vatAmount / inv.baseAmount) * 100);
    if (rate !== 21 && rate !== 10 && rate !== 4) {
      warnings.push({ level: "warn", msg: `Tipo de IVA inusual: ${rate}%. Tipos habituales: 21% (servicios), 10% (hostelería), 4% (libros).` });
    }
    if (rate === 10) {
      warnings.push({ level: "info", msg: "IVA 10% — hostelería/alojamiento. Confirmar que corresponde a hotel o restaurante de rodaje." });
    }
  }

  // Sin IVA: posible inversión del sujeto pasivo
  if (inv.vatAmount === 0 && inv.baseAmount > 0 && !isAutonomo) {
    warnings.push({ level: "info", msg: "Factura sin IVA. Si el proveedor es de la UE → inversión del sujeto pasivo (art. 69 LIVA, Mod. 349). Si es fuera de la UE → operación no sujeta." });
  }

  // Importes elevados
  if (inv.totalAmount >= 3005.06) {
    warnings.push({ level: "info", msg: "Importe ≥ 3.005,06 €. Debe incluirse en el Modelo 347 (operaciones con terceros) si el acumulado anual con este proveedor supera ese límite." });
  }

  return warnings;
}

// ── Build default journal lines from invoice ──────────────────────────────────

function buildDefaultLines(inv: Invoice, plan: ChartAccount[]): JournalLine[] {
  const lines: JournalLine[] = [];

  // Determine target account: 230 (en curso) or specific cost account
  inv.items.forEach((item: any, i: number) => {
    const code = item.subAccountCode || "230";
    const planItem = plan.find(p => p.code === code);
    lines.push({ id: `item-${i}`, code, name: item.description || planItem?.name || code, debe: item.baseAmount || 0, haber: 0 });
  });

  if (inv.vatAmount > 0)
    lines.push({ id: "iva", code: "472", name: "H.P. IVA soportado", debe: inv.vatAmount, haber: 0 });

  if (inv.irpfAmount < 0)
    lines.push({ id: "irpf", code: "473", name: "H.P. retenciones practicadas", debe: 0, haber: Math.abs(inv.irpfAmount) });

  // Proveedores net (what we actually owe)
  const net = inv.totalAmount + (inv.irpfAmount < 0 ? Math.abs(inv.irpfAmount) : 0);
  lines.push({ id: "prov", code: "400", name: `Proveedores — ${inv.supplier}`, debe: 0, haber: net });

  return lines;
}

// ── Suggest entry number (auto-increment) ────────────────────────────────────

function suggestNextEntry(invoices: Invoice[]): string {
  const nums = invoices
    .filter(i => i.accountingEntryNumber)
    .map(i => {
      const m = i.accountingEntryNumber!.match(/(\d+)$/);
      return m ? parseInt(m[1]) : 0;
    });
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  const year = new Date().getFullYear();
  return `A-${year}-${String(next).padStart(3, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CompanyAccountsPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [invoices,     setInvoices]     = useState<Invoice[]>([]);
  const [planCuentas,  setPlanCuentas]  = useState<ChartAccount[]>(FALLBACK_PLAN);
  const [toast,        setToast]        = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [searchTerm,   setSearchTerm]   = useState("");
  const [statusFilter, setStatusFilter] = useState("pending_accounting");
  const [showFilter,   setShowFilter]   = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showDocument,    setShowDocument]    = useState(false);
  const [entryNumber,     setEntryNumber]     = useState("");

  const [editingLines, setEditingLines] = useState(false);
  const [draftLines,   setDraftLines]   = useState<JournalLine[]>([]);
  const [showWarnings, setShowWarnings] = useState(true);

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 3500);
  };

  const isInvoiceCoded = (inv: Invoice) =>
    inv.items?.length > 0 && inv.items.every((i) => i.subAccountId);

  useEffect(() => { if (!userLoading && !hasAccess) router.push("/dashboard"); }, [contextUser, userLoading, router, hasAccess]);
  useEffect(() => { if (producerId && projectId && hasAccess) loadData(); }, [producerId, projectId, hasAccess]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadData = async () => {
    try {
      setLoading(true);
      const [pdoc, prjDoc] = await Promise.all([
        getDoc(doc(db, "producers", producerId)),
        getDoc(doc(db, "projects", projectId)),
      ]);
      if (!pdoc.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }
      if (!prjDoc.exists()) { router.push(`/companydashboard/${producerId}`); return; }

      const planDoc = await getDoc(doc(db, `projects/${projectId}/config/planCuentas`));
      if (planDoc.exists()) setPlanCuentas(planDoc.data().accounts || FALLBACK_PLAN);

      const snap = await getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc")));
      setInvoices(snap.docs.map(d => {
        const r = d.data();
        return {
          id: d.id, number: r.number, displayNumber: r.displayNumber || r.number,
          documentType: r.documentType || "invoice", supplier: r.supplier, supplierId: r.supplierId,
          description: r.description, baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0,
          irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0, status: r.status,
          dueDate: r.dueDate?.toDate?.() || new Date(), invoiceDate: r.invoiceDate?.toDate?.(),
          createdAt: r.createdAt?.toDate?.() || new Date(), items: r.items || [],
          journalLines: r.journalLines || null, attachmentUrl: r.attachmentUrl,
          accounted: r.accounted || false, accountedAt: r.accountedAt?.toDate?.(),
          accountedBy: r.accountedBy, accountedByName: r.accountedByName,
          accountingEntryNumber: r.accountingEntryNumber, accountingAccount: r.accountingAccount,
          paidAt: r.paidAt?.toDate?.(), paidAmount: r.paidAmount,
        };
      }));
    } catch (err) { console.error(err); showToast("error", "Error al cargar datos"); }
    finally { setLoading(false); }
  };

  // ── Journal editor ─────────────────────────────────────────────────────────
  const startEditLines = (inv: Invoice) => {
    const lines = inv.journalLines?.length ? inv.journalLines : buildDefaultLines(inv, planCuentas);
    setDraftLines(lines.map(l => ({ ...l, id: l.id || Math.random().toString(36).slice(2) })));
    setEditingLines(true);
  };

  const addDraftLine = () => setDraftLines(p => [...p, { id: Math.random().toString(36).slice(2), code: "400", name: "", debe: 0, haber: 0 }]);
  const removeDraftLine = (id: string) => setDraftLines(p => p.filter(l => l.id !== id));

  const updateDraftLine = (id: string, field: keyof JournalLine, value: string | number) => {
    setDraftLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      if (field === "code") { const acc = planCuentas.find(a => a.code === value); return { ...l, code: value as string, name: l.name || acc?.name || "" }; }
      return { ...l, [field]: value };
    }));
  };

  const saveDraftLines = async () => {
    if (!selectedInvoice) return;
    const td = draftLines.reduce((s, l) => s + (l.debe || 0), 0);
    const th = draftLines.reduce((s, l) => s + (l.haber || 0), 0);
    if (Math.abs(td - th) > 0.01) { showToast("error", `El asiento no cuadra — diferencia ${fmt(Math.abs(td - th))} €`); return; }
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedInvoice.id), { journalLines: draftLines });
      showToast("success", "Asiento guardado"); setEditingLines(false); await loadData();
    } catch (err) { console.error(err); showToast("error", "Error al guardar"); }
    finally { setSaving(false); }
  };

  // ── Accounting actions ─────────────────────────────────────────────────────
  const handleMarkAccounted = async () => {
    if (!selectedInvoice || !entryNumber.trim()) { showToast("error", "Nº de asiento obligatorio"); return; }
    if (!panelOk) { showToast("error", "El asiento no cuadra"); return; }
    setSaving(true);
    try {
      const oldStatus = selectedInvoice.status;
      const lines = selectedInvoice.journalLines?.length ? selectedInvoice.journalLines : buildDefaultLines(selectedInvoice, planCuentas);
      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedInvoice.id), {
        accounted: true, accountedAt: new Date(), accountedBy: contextUser?.uid,
        accountedByName: contextUser?.name, accountingEntryNumber: entryNumber.trim(),
        status: "accounted", journalLines: lines,
      });
      const items = selectedInvoice.items.map((i: any) => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount || 0 }));
      await handleInvoiceStatusChange(projectId, oldStatus, "accounted", items);
      showToast("success", `Contabilizada — ${entryNumber}`);
      setEntryNumber(""); setEditingLines(false);
      await loadData(); goToNext();
    } catch (err) { console.error(err); showToast("error", "Error al contabilizar"); }
    finally { setSaving(false); }
  };

  const handleUnmarkAccounted = async () => {
    if (!selectedInvoice || !confirm("¿Desmarcar como contabilizada?")) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedInvoice.id), { accounted: false, status: "approved" });
      const items = selectedInvoice.items.map((i: any) => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount || 0 }));
      await handleInvoiceStatusChange(projectId, selectedInvoice.status, "approved", items);
      showToast("success", "Factura desbloqueada"); setEditingLines(false); await loadData();
    } catch (err) { console.error(err); showToast("error", "Error"); }
    finally { setSaving(false); }
  };

  // ── Filtered + navigation ──────────────────────────────────────────────────
  const filtered = useMemo(() => invoices.filter(inv => {
    const term = searchTerm.toLowerCase();
    const match = !term || inv.number.toLowerCase().includes(term) || inv.supplier.toLowerCase().includes(term)
      || inv.description.toLowerCase().includes(term) || (inv.accountingEntryNumber || "").toLowerCase().includes(term);
    const coded = isInvoiceCoded(inv);
    let st = true;
    if      (statusFilter === "pending_accounting") st = coded && !inv.accounted && ["approved","pending","paid"].includes(inv.status);
    else if (statusFilter === "accounted")           st = inv.accounted === true;
    else if (statusFilter === "not_coded")           st = !coded;
    else if (statusFilter !== "all")                 st = inv.status === statusFilter;
    return match && st;
  }), [invoices, searchTerm, statusFilter]);

  const currentIdx = selectedInvoice ? filtered.findIndex(i => i.id === selectedInvoice.id) : -1;

  const goToPrev = () => { const p = filtered[currentIdx - 1]; if (p) { setSelectedInvoice(p); setEntryNumber(p.accountingEntryNumber || ""); setEditingLines(false); } };
  const goToNext = () => { const n = filtered[currentIdx + 1]; if (n) { setSelectedInvoice(n); setEntryNumber(n.accountingEntryNumber || ""); setEditingLines(false); } else setSelectedInvoice(null); };

  const openPanel = (inv: Invoice) => {
    setSelectedInvoice(inv); setShowDocument(false);
    setEntryNumber(inv.accountingEntryNumber || suggestNextEntry(invoices));
    setEditingLines(false); setShowWarnings(true);
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const coded        = invoices.filter(i => isInvoiceCoded(i));
  const pendingCount = coded.filter(i => !i.accounted && ["approved","pending","paid"].includes(i.status)).length;
  const accountedCnt = invoices.filter(i => i.accounted).length;
  const notCodedCnt  = invoices.filter(i => !isInvoiceCoded(i)).length;
  const totalBase    = coded.reduce((s, i) => s + i.baseAmount, 0);

  // ── Panel derived ──────────────────────────────────────────────────────────
  const panelLines: JournalLine[] = editingLines
    ? draftLines
    : selectedInvoice
      ? (selectedInvoice.journalLines?.length ? selectedInvoice.journalLines : buildDefaultLines(selectedInvoice, planCuentas))
      : [];

  const panelDebe  = panelLines.reduce((s, l) => s + (l.debe || 0), 0);
  const panelHaber = panelLines.reduce((s, l) => s + (l.haber || 0), 0);
  const panelOk    = Math.abs(panelDebe - panelHaber) < 0.01;

  const validationWarnings = selectedInvoice ? validateInvoice(selectedInvoice) : [];

  if (loading || userLoading) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}>
            {toast.type === "success" ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {toast.message}
          </div>
        </div>
      )}

      <div className="mt-[77px] flex">
        {/* TABLE SIDE */}
        <div className={`flex-1 transition-all ${selectedInvoice ? "mr-[52%]" : ""}`}>

          {/* Stats */}
          <div className="bg-white border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-slate-500">Pte. contab.:</span><span className="font-semibold text-amber-600">{pendingCount}</span></div>
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /><span className="text-slate-500">Contabilizadas:</span><span className="font-semibold text-emerald-600">{accountedCnt}</span></div>
              {notCodedCnt > 0 && <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /><span className="text-slate-500">Sin codificar:</span><span className="font-semibold text-slate-500">{notCodedCnt}</span></div>}
              <div className="flex items-center gap-1.5 ml-auto"><Euro size={12} className="text-slate-400" /><span className="text-slate-500">Base total:</span><span className="font-semibold text-slate-900">{fmt(totalBase)} €</span></div>
              <button onClick={loadData} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"><RefreshCw size={13} className={loading ? "animate-spin" : ""} /></button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" placeholder="Buscar..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 outline-none" />
            </div>
            <div className="relative" ref={filterRef}>
              <button onClick={() => setShowFilter(!showFilter)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg ${statusFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                <Filter size={13} />{FILTER_OPTIONS.find(o => o.value === statusFilter)?.label}<ChevronDown size={13} />
              </button>
              {showFilter && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[160px]">
                  {FILTER_OPTIONS.map(o => (
                    <button key={o.value} onClick={() => { setStatusFilter(o.value); setShowFilter(false); }}
                      className={`w-full text-left px-3 py-1.5 text-sm ${statusFilter === o.value ? "bg-slate-100 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>{o.label}</button>
                  ))}
                </div>
              )}
            </div>
            <span className="ml-auto text-xs text-slate-400">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
          </div>

          {/* Table */}
          <div className="p-4">
            {filtered.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                <p className="text-sm text-slate-500">Sin resultados para este filtro</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      <th className="px-3 py-2 w-8" /><th className="px-3 py-2">Nº Factura</th>
                      <th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Cuentas</th><th className="px-3 py-2 text-right">Base</th>
                      <th className="px-3 py-2">Estado</th><th className="px-3 py-2">Nº Asiento</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(inv => {
                      const isCoded = isInvoiceCoded(inv);
                      const st      = STATUS_CONFIG[inv.status] || STATUS_CONFIG.pending;
                      const warns   = validateInvoice(inv);
                      const hasErr  = warns.some(w => w.level === "error");
                      const hasWarn = warns.some(w => w.level === "warn");
                      const lines   = inv.journalLines?.length ? inv.journalLines : [];
                      const codes   = lines.length
                        ? [...new Set(lines.filter(l => l.debe > 0).map(l => l.code))]
                        : [...new Set(inv.items.map((i: any) => i.subAccountCode).filter(Boolean))];
                      const isSel   = selectedInvoice?.id === inv.id;
                      return (
                        <tr key={inv.id} onClick={() => openPanel(inv)}
                          className={`hover:bg-slate-50 cursor-pointer transition-colors ${isSel ? "bg-slate-50 ring-1 ring-inset ring-slate-300" : ""}`}>
                          <td className="px-3 py-2">
                            {inv.accounted
                              ? <div className="w-5 h-5 bg-emerald-100 rounded flex items-center justify-center"><Lock size={10} className="text-emerald-600" /></div>
                              : hasErr ? <div className="w-5 h-5 bg-red-100 rounded flex items-center justify-center"><AlertCircle size={10} className="text-red-600" /></div>
                              : hasWarn ? <div className="w-5 h-5 bg-amber-100 rounded flex items-center justify-center"><AlertTriangle size={10} className="text-amber-600" /></div>
                              : isCoded ? <div className="w-5 h-5 bg-amber-50 rounded flex items-center justify-center"><Clock size={10} className="text-amber-500" /></div>
                              : <div className="w-5 h-5 bg-slate-100 rounded flex items-center justify-center"><AlertTriangle size={10} className="text-slate-400" /></div>}
                          </td>
                          <td className="px-3 py-2"><span className="font-mono text-xs font-semibold">{inv.displayNumber}</span></td>
                          <td className="px-3 py-2 max-w-[130px]"><span className="text-xs text-slate-700 truncate block">{inv.supplier}</span></td>
                          <td className="px-3 py-2"><span className="font-mono text-xs text-slate-500">{fmtDate(inv.invoiceDate || inv.createdAt)}</span></td>
                          <td className="px-3 py-2">
                            {codes.slice(0, 2).map(c => <span key={c} className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded mr-1">{c}</span>)}
                            {codes.length > 2 && <span className="text-[10px] text-slate-400">+{codes.length - 2}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-semibold">{fmt(inv.baseAmount)}</td>
                          <td className="px-3 py-2"><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${st.bg} ${st.text}`}>{st.label}</span></td>
                          <td className="px-3 py-2">
                            {inv.accountingEntryNumber
                              ? <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{inv.accountingEntryNumber}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2"><Eye size={13} className="text-slate-400" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* SIDE PANEL */}
        {selectedInvoice && (
          <div className="fixed right-0 top-16 bottom-0 w-[52%] bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={goToPrev} disabled={currentIdx <= 0} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="font-mono text-xs text-slate-500">{currentIdx + 1} / {filtered.length}</span>
                <button onClick={goToNext} disabled={currentIdx >= filtered.length - 1} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                <button onClick={() => setShowDocument(false)} className={`px-3 py-1 text-xs font-medium rounded-md ${!showDocument ? "bg-slate-100 text-slate-900" : "text-slate-500"}`}>Datos</button>
                <button onClick={() => setShowDocument(true)} disabled={!selectedInvoice.attachmentUrl} className={`px-3 py-1 text-xs font-medium rounded-md ${showDocument ? "bg-slate-100 text-slate-900" : "text-slate-500"} disabled:opacity-40`}>Documento</button>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg"><X size={16} /></button>
            </div>

            {showDocument && selectedInvoice.attachmentUrl ? (
              <div className="flex-1"><iframe src={selectedInvoice.attachmentUrl} className="w-full h-full border-none" /></div>
            ) : (
              <div className="flex-1 overflow-y-auto">

                {/* Invoice header */}
                <div className="px-5 pt-4 pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-bold">{selectedInvoice.displayNumber}</span>
                        {selectedInvoice.accounted && <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><Lock size={9} />{selectedInvoice.accountingEntryNumber}</span>}
                        {/* Document type badge */}
                        {selectedInvoice.displayNumber?.startsWith("A-") && <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded font-mono">Fra. autónomo</span>}
                        {selectedInvoice.displayNumber?.includes("/R-") || selectedInvoice.displayNumber?.startsWith("R-") ? <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-mono">Rectificativa</span> : null}
                      </div>
                      <p className="text-sm text-slate-600 mt-0.5">{selectedInvoice.supplier}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{selectedInvoice.description}</p>
                    </div>
                    <Link href={`/project/${projectId}/invoices/${selectedInvoice.id}`} target="_blank" className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><ExternalLink size={14} /></Link>
                  </div>

                  {/* Key data grid */}
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {[
                      { l: "Fecha",       v: fmtDate(selectedInvoice.invoiceDate || selectedInvoice.createdAt) },
                      { l: "Vencimiento", v: fmtDate(selectedInvoice.dueDate) },
                      { l: "Base imp.",   v: fmt(selectedInvoice.baseAmount) + " €" },
                      { l: "Total",       v: fmt(selectedInvoice.totalAmount) + " €" },
                    ].map(f => (
                      <div key={f.l} className="bg-slate-50 rounded-md p-2">
                        <p className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-0.5">{f.l}</p>
                        <p className="font-mono text-xs font-semibold">{f.v}</p>
                      </div>
                    ))}
                  </div>

                  {/* IVA / IRPF summary */}
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    {selectedInvoice.vatAmount > 0 && (
                      <span className="font-mono text-slate-500">
                        IVA {Math.round((selectedInvoice.vatAmount / selectedInvoice.baseAmount) * 100)}% = {fmt(selectedInvoice.vatAmount)} €
                      </span>
                    )}
                    {selectedInvoice.vatAmount === 0 && <span className="font-mono text-amber-600 text-[10px] bg-amber-50 px-1.5 py-0.5 rounded">SIN IVA</span>}
                    {selectedInvoice.irpfAmount < 0 && (
                      <span className="font-mono text-blue-600 text-[10px] bg-blue-50 px-1.5 py-0.5 rounded">
                        IRPF {Math.round((Math.abs(selectedInvoice.irpfAmount) / selectedInvoice.baseAmount) * 100)}% retención
                      </span>
                    )}
                  </div>
                </div>

                {/* Validation warnings */}
                {validationWarnings.length > 0 && showWarnings && (
                  <div className="px-5 py-3 border-b border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">Alertas contables</span>
                      <button onClick={() => setShowWarnings(false)} className="text-[10px] text-slate-400 hover:text-slate-600">Ocultar</button>
                    </div>
                    <div className="space-y-1.5">
                      {validationWarnings.map((w, i) => (
                        <div key={i} className={`flex items-start gap-2 text-xs px-2.5 py-2 rounded-md border ${
                          w.level === "error" ? "bg-red-50 border-red-200 text-red-700" :
                          w.level === "warn"  ? "bg-amber-50 border-amber-200 text-amber-800" :
                                               "bg-blue-50 border-blue-200 text-blue-700"
                        }`}>
                          {w.level === "error" ? <AlertCircle size={12} className="flex-shrink-0 mt-0.5" /> :
                           w.level === "warn"  ? <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> :
                                                <Info size={12} className="flex-shrink-0 mt-0.5" />}
                          <span>{w.msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Journal editor */}
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Asiento contable (partida doble)</h4>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${panelOk ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                        {panelOk ? "Cuadrado" : `Dif. ${fmt(Math.abs(panelDebe - panelHaber))} €`}
                      </span>
                    </div>
                    {!selectedInvoice.accounted && (
                      <div className="flex items-center gap-1.5">
                        {editingLines ? (
                          <>
                            <button onClick={addDraftLine} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium border border-slate-200 rounded hover:bg-slate-50"><Plus size={10} />Línea</button>
                            <button onClick={saveDraftLines} disabled={saving || !panelOk}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-slate-900 text-white rounded disabled:opacity-40"><Save size={10} />Guardar</button>
                            <button onClick={() => setEditingLines(false)} className="px-2 py-1 text-[10px] font-medium border border-slate-200 rounded hover:bg-slate-50">Cancelar</button>
                          </>
                        ) : (
                          <button onClick={() => startEditLines(selectedInvoice)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium border border-slate-200 rounded hover:bg-slate-50">
                            Editar asiento
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Lines table */}
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 text-left text-[10px] font-mono text-slate-400 uppercase w-[100px]">Cuenta</th>
                          <th className="px-3 py-2 text-left text-[10px] font-mono text-slate-400 uppercase">Descripción</th>
                          <th className="px-3 py-2 text-right text-[10px] font-mono text-slate-400 uppercase w-[90px]">Debe</th>
                          <th className="px-3 py-2 text-right text-[10px] font-mono text-slate-400 uppercase w-[90px]">Haber</th>
                          {editingLines && <th className="w-8" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {panelLines.map((line, idx) => (
                          <tr key={line.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                            <td className="px-3 py-1.5">
                              {editingLines ? (
                                <select value={line.code} onChange={e => updateDraftLine(line.id, "code", e.target.value)}
                                  className="font-mono text-[10px] border border-slate-200 rounded px-1.5 py-0.5 w-full bg-white focus:border-slate-400 outline-none">
                                  {planCuentas.map(a => <option key={a.code} value={a.code}>{a.code}</option>)}
                                </select>
                              ) : <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{line.code}</span>}
                            </td>
                            <td className="px-3 py-1.5">
                              {editingLines ? (
                                <input value={line.name} onChange={e => updateDraftLine(line.id, "name", e.target.value)}
                                  className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full focus:border-slate-400 outline-none" />
                              ) : <span className="text-[11px] text-slate-600">{line.name}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editingLines ? (
                                <input type="number" value={line.debe || ""} min={0} step={0.01}
                                  onChange={e => updateDraftLine(line.id, "debe", parseFloat(e.target.value) || 0)}
                                  className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                              ) : <span className={`font-mono text-[11px] font-semibold ${line.debe > 0 ? "text-slate-900" : "text-slate-300"}`}>{line.debe > 0 ? fmt(line.debe) : "—"}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {editingLines ? (
                                <input type="number" value={line.haber || ""} min={0} step={0.01}
                                  onChange={e => updateDraftLine(line.id, "haber", parseFloat(e.target.value) || 0)}
                                  className="font-mono text-[11px] border border-slate-200 rounded px-1.5 py-0.5 w-full text-right focus:border-slate-400 outline-none" />
                              ) : <span className={`font-mono text-[11px] font-semibold ${line.haber > 0 ? "text-red-600" : "text-slate-300"}`}>{line.haber > 0 ? fmt(line.haber) : "—"}</span>}
                            </td>
                            {editingLines && <td className="px-2"><button onClick={() => removeDraftLine(line.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={12} /></button></td>}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                        <tr>
                          <td colSpan={2} className="px-3 py-2 font-mono text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total</td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-bold text-slate-900">{fmt(panelDebe)}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-bold text-red-600">{fmt(panelHaber)}</td>
                          {editingLines && <td />}
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Totals */}
                  <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                    {[
                      { l: "Base imponible", v: selectedInvoice.baseAmount   },
                      { l: "IVA",            v: selectedInvoice.vatAmount    },
                      { l: "IRPF retención", v: selectedInvoice.irpfAmount   },
                    ].map(r => (
                      <div key={r.l} className="flex justify-between">
                        <span className="text-slate-500">{r.l}</span>
                        <span className={`font-mono font-medium ${r.v < 0 ? "text-red-600" : "text-slate-900"}`}>{fmt(r.v)} €</span>
                      </div>
                    ))}
                    <div className="border-t border-slate-200 pt-1.5 flex justify-between">
                      <span className="font-semibold text-slate-900">Total factura</span>
                      <span className="font-mono font-bold text-slate-900">{fmt(selectedInvoice.totalAmount)} €</span>
                    </div>
                  </div>

                  {/* Accounting form */}
                  {!selectedInvoice.accounted && (
                    <div className="mt-4 border-t border-slate-200 pt-4 space-y-3">
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contabilizar</h4>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Nº Asiento <span className="text-red-500">*</span></label>
                        <input value={entryNumber} onChange={e => setEntryNumber(e.target.value)} placeholder="A-2024-001"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none font-mono" />
                        <p className="text-[10px] text-slate-400 mt-1 font-mono">Formato recomendado: A-YYYY-NNN</p>
                      </div>
                      <button onClick={handleMarkAccounted} disabled={saving || !entryNumber.trim() || !panelOk}
                        className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
                        {saving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                        Contabilizar y siguiente
                      </button>
                      {!panelOk && <p className="text-xs text-red-600 text-center">Edita las líneas del asiento para cuadrarlo primero</p>}
                    </div>
                  )}

                  {selectedInvoice.accounted && (
                    <div className="mt-4 border-t border-slate-200 pt-4 space-y-3">
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-1.5"><CheckCircle size={14} />Factura contabilizada</div>
                        <div className="text-xs text-emerald-600 space-y-0.5">
                          <p>Nº Asiento: <span className="font-mono font-semibold">{selectedInvoice.accountingEntryNumber}</span></p>
                          {selectedInvoice.accountedByName && <p>Por: {selectedInvoice.accountedByName}</p>}
                        </div>
                      </div>
                      <button onClick={handleUnmarkAccounted} disabled={saving}
                        className="w-full py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2">
                        <Unlock size={13} />Desbloquear para edición
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
