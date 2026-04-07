"use client";

// app/companydashboard/[producerId]/accounts/[projectId]/page.tsx

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import { collection, getDocs, getDoc, doc, updateDoc, query, orderBy } from "firebase/firestore";
import { handleInvoiceStatusChange } from "@/lib/budgetOperations";
import {
  Search, Filter, ChevronDown, ChevronLeft, ChevronRight,
  Eye, CheckCircle, Clock, AlertTriangle, Lock, Unlock,
  Euro, X, AlertCircle, RefreshCw, Calendar, CreditCard, ExternalLink,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

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

export default function CompanyAccountsPage() {
  const params     = useParams();
  const router     = useRouter();
  const producerId = params?.producerId as string;
  const projectId  = params?.projectId  as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [toast,    setToast]    = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [searchTerm,         setSearchTerm]         = useState("");
  const [statusFilter,       setStatusFilter]       = useState("pending_accounting");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showDocument,    setShowDocument]    = useState(false);
  const [accountingForm,  setAccountingForm]  = useState({ entryNumber: "" });

  const isAdmin       = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess     = isAdmin || isCompanyUser;

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

  const formatDate = (date: Date | undefined) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "-";

  const isInvoiceCoded = (invoice: Invoice) =>
    invoice.items?.length > 0 && invoice.items.every((item) => item.subAccountId);

  useEffect(() => {
    if (!userLoading && !hasAccess) router.push("/dashboard");
  }, [contextUser, userLoading, router, hasAccess]);

  useEffect(() => {
    if (producerId && projectId && hasAccess) loadData();
  }, [producerId, projectId, hasAccess]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilterDropdown(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const producerDoc = await getDoc(doc(db, "producers", producerId));
      if (!producerDoc.exists()) { router.push(isAdmin ? "/admindashboard" : "/"); return; }

      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) { router.push(`/companydashboard/${producerId}`); return; }

      const snap = await getDocs(
        query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))
      );
      setInvoices(snap.docs.map((d) => {
        const r = d.data();
        return {
          id: d.id, number: r.number, displayNumber: r.displayNumber || r.number,
          documentType: r.documentType || "invoice", supplier: r.supplier,
          supplierId: r.supplierId, description: r.description,
          baseAmount: r.baseAmount || 0, vatAmount: r.vatAmount || 0,
          irpfAmount: r.irpfAmount || 0, totalAmount: r.totalAmount || 0,
          status: r.status, dueDate: r.dueDate?.toDate?.() || new Date(),
          invoiceDate: r.invoiceDate?.toDate?.(), createdAt: r.createdAt?.toDate?.() || new Date(),
          items: r.items || [], attachmentUrl: r.attachmentUrl,
          accounted: r.accounted || false, accountedAt: r.accountedAt?.toDate?.(),
          accountedBy: r.accountedBy, accountedByName: r.accountedByName,
          accountingEntryNumber: r.accountingEntryNumber, accountingAccount: r.accountingAccount,
          paidAt: r.paidAt?.toDate?.(), paidAmount: r.paidAmount,
        };
      }));
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsAccounted = async () => {
    if (!selectedInvoice || !accountingForm.entryNumber.trim()) {
      showToast("error", "El número de asiento es obligatorio"); return;
    }
    setSaving(true);
    try {
      const oldStatus = selectedInvoice.status;
      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedInvoice.id), {
        accounted: true, accountedAt: new Date(), accountedBy: contextUser?.uid,
        accountedByName: contextUser?.name, accountingEntryNumber: accountingForm.entryNumber.trim(), status: "accounted",
      });
      const items = selectedInvoice.items.map((i: any) => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount || 0 }));
      await handleInvoiceStatusChange(projectId, oldStatus, "accounted", items);
      showToast("success", "Factura contabilizada");
      setAccountingForm({ entryNumber: "" });
      await loadData();
      goToNextInvoice();
    } catch (error) { console.error(error); showToast("error", "Error al contabilizar"); }
    finally { setSaving(false); }
  };

  const handleUnmarkAsAccounted = async () => {
    if (!selectedInvoice || !confirm("¿Desmarcar como contabilizada?")) return;
    setSaving(true);
    try {
      const oldStatus = selectedInvoice.status;
      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedInvoice.id), { accounted: false, status: "approved" });
      const items = selectedInvoice.items.map((i: any) => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount || 0 }));
      await handleInvoiceStatusChange(projectId, oldStatus, "approved", items);
      showToast("success", "Factura desbloqueada");
      await loadData();
    } catch (error) { console.error(error); showToast("error", "Error al desbloquear"); }
    finally { setSaving(false); }
  };

  const filteredInvoices = useMemo(() =>
    invoices.filter((inv) => {
      const matchesSearch =
        inv.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.accountingEntryNumber || "").toLowerCase().includes(searchTerm.toLowerCase());
      const isCoded = isInvoiceCoded(inv);
      let matchesStatus = true;
      if      (statusFilter === "pending_accounting") matchesStatus = isCoded && !inv.accounted && ["approved","pending","paid"].includes(inv.status);
      else if (statusFilter === "accounted")           matchesStatus = inv.accounted === true;
      else if (statusFilter === "not_coded")           matchesStatus = !isCoded;
      else if (statusFilter !== "all")                 matchesStatus = inv.status === statusFilter;
      return matchesSearch && matchesStatus;
    }),
  [invoices, searchTerm, statusFilter]);

  const codedInvoices     = invoices.filter((i) => isInvoiceCoded(i));
  const pendingAccounting = codedInvoices.filter((i) => !i.accounted && ["approved","pending","paid"].includes(i.status)).length;
  const accountedCount    = invoices.filter((i) => i.accounted).length;
  const notCodedCount     = invoices.filter((i) => !isInvoiceCoded(i)).length;
  const totalBaseAmount   = codedInvoices.reduce((acc, i) => acc + i.baseAmount, 0);

  const currentIndex = selectedInvoice ? filteredInvoices.findIndex((i) => i.id === selectedInvoice.id) : -1;

  const goToPrevInvoice = () => {
    if (currentIndex > 0) {
      const prev = filteredInvoices[currentIndex - 1];
      setSelectedInvoice(prev); setAccountingForm({ entryNumber: prev.accountingEntryNumber || "" });
    }
  };
  const goToNextInvoice = () => {
    if (currentIndex < filteredInvoices.length - 1) {
      const next = filteredInvoices[currentIndex + 1];
      setSelectedInvoice(next); setAccountingForm({ entryNumber: next.accountingEntryNumber || "" });
    } else setSelectedInvoice(null);
  };

  const openInvoicePanel = (invoice: Invoice) => {
    setSelectedInvoice(invoice); setShowDocument(false);
    setAccountingForm({ entryNumber: invoice.accountingEntryNumber || "" });
  };

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}>
            {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {toast.message}
          </div>
        </div>
      )}

      <div className="mt-16 flex">
        <div className={`flex-1 transition-all ${selectedInvoice ? "mr-[50%]" : ""}`}>

          {/* Stats bar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-6 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-slate-500">Pte. contab.:</span>
                <span className="font-semibold text-amber-600">{pendingAccounting}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-slate-500">Contabilizadas:</span>
                <span className="font-semibold text-emerald-600">{accountedCount}</span>
              </div>
              {notCodedCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="text-slate-500">Sin codificar:</span>
                  <span className="font-semibold text-slate-500">{notCodedCount}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 ml-auto">
                <Euro size={12} className="text-slate-400" />
                <span className="text-slate-500">Base total:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(totalBaseAmount)} €</span>
              </div>
              <button onClick={loadData} disabled={loading} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Toolbar */}
          <div className="bg-white border-b border-slate-200 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none" />
              </div>
              <div className="relative" ref={filterRef}>
                <button onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg ${statusFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <Filter size={14} />
                  {FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label || "Filtrar"}
                  <ChevronDown size={14} />
                </button>
                {showFilterDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[170px]">
                    {FILTER_OPTIONS.map((option) => (
                      <button key={option.value} onClick={() => { setStatusFilter(option.value); setShowFilterDropdown(false); }}
                        className={`w-full text-left px-3 py-1.5 text-sm ${statusFilter === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"}`}>
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="ml-auto text-xs text-slate-400">{filteredInvoices.length} resultado{filteredInvoices.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          {/* Table */}
          <div className="p-4">
            {filteredInvoices.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
                <p className="text-sm text-slate-500">No hay facturas para este filtro</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      <th className="px-3 py-2 w-8" /><th className="px-3 py-2">Nº Factura</th>
                      <th className="px-3 py-2">Proveedor</th><th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Cuenta</th><th className="px-3 py-2 text-right">Base</th>
                      <th className="px-3 py-2">Estado</th><th className="px-3 py-2">Nº Asiento</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((invoice) => {
                      const isCoded      = isInvoiceCoded(invoice);
                      const statusConf   = STATUS_CONFIG[invoice.status] || STATUS_CONFIG.pending;
                      const accountCodes = [...new Set(invoice.items.map((i: any) => i.subAccountCode).filter(Boolean))];
                      const isSelected   = selectedInvoice?.id === invoice.id;
                      return (
                        <tr key={invoice.id} onClick={() => openInvoicePanel(invoice)}
                          className={`hover:bg-slate-50 cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : ""}`}>
                          <td className="px-3 py-2">
                            {invoice.accounted
                              ? <div className="w-5 h-5 bg-emerald-100 rounded flex items-center justify-center"><Lock size={11} className="text-emerald-600" /></div>
                              : isCoded
                              ? <div className="w-5 h-5 bg-amber-50 rounded flex items-center justify-center"><Clock size={11} className="text-amber-500" /></div>
                              : <div className="w-5 h-5 bg-slate-100 rounded flex items-center justify-center"><AlertTriangle size={11} className="text-slate-400" /></div>}
                          </td>
                          <td className="px-3 py-2"><span className="font-mono text-xs font-medium text-slate-900">{invoice.displayNumber}</span></td>
                          <td className="px-3 py-2"><span className="text-slate-700 text-xs truncate max-w-[120px] block">{invoice.supplier}</span></td>
                          <td className="px-3 py-2 text-slate-500 text-xs">{formatDate(invoice.invoiceDate || invoice.createdAt)}</td>
                          <td className="px-3 py-2">
                            {accountCodes.length > 0
                              ? <span className="font-mono text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{accountCodes[0]}{accountCodes.length > 1 && ` +${accountCodes.length - 1}`}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs font-medium text-slate-900">{formatCurrency(invoice.baseAmount)}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${statusConf.bg} ${statusConf.text}`}>{statusConf.label}</span>
                          </td>
                          <td className="px-3 py-2">
                            {invoice.accountingEntryNumber
                              ? <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{invoice.accountingEntryNumber}</span>
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

        {/* Side panel */}
        {selectedInvoice && (
          <div className="fixed right-0 top-16 bottom-0 w-1/2 bg-white border-l border-slate-200 shadow-xl z-30 flex flex-col">
            <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button onClick={goToPrevInvoice} disabled={currentIndex <= 0} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="text-xs text-slate-500">{currentIndex + 1} / {filteredInvoices.length}</span>
                <button onClick={goToNextInvoice} disabled={currentIndex >= filteredInvoices.length - 1} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setShowDocument(false)} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!showDocument ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Datos</button>
                <button onClick={() => setShowDocument(true)} disabled={!selectedInvoice.attachmentUrl} className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${showDocument ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"} disabled:opacity-40 disabled:cursor-not-allowed`}>Documento</button>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>

            {showDocument && selectedInvoice.attachmentUrl ? (
              <div className="flex-1 bg-slate-100">
                <iframe src={selectedInvoice.attachmentUrl} className="w-full h-full" title="Documento" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-lg font-bold text-slate-900">{selectedInvoice.displayNumber}</span>
                      {selectedInvoice.accounted && (
                        <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full"><Lock size={10} />Contabilizada</span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600">{selectedInvoice.supplier}</p>
                  </div>
                  <Link href={`/project/${projectId}/invoices/${selectedInvoice.id}`} target="_blank" className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Abrir en nueva pestaña">
                    <ExternalLink size={16} />
                  </Link>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: <Calendar size={12} />, label: "Fecha factura", value: formatDate(selectedInvoice.invoiceDate || selectedInvoice.createdAt), color: "" },
                    { icon: <Clock size={12} />,    label: "Vencimiento",   value: formatDate(selectedInvoice.dueDate), color: "" },
                    { icon: <CreditCard size={12} />,label: "Pago",         value: selectedInvoice.status === "paid" ? "Pagada" : "Pendiente", color: selectedInvoice.status === "paid" ? "text-emerald-600" : "text-amber-600" },
                  ].map((f) => (
                    <div key={f.label} className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">{f.icon}{f.label}</div>
                      <p className={`text-sm font-medium ${f.color || "text-slate-900"}`}>{f.value}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Desglose</h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr className="text-left text-slate-500">
                          <th className="px-3 py-2 font-medium">Descripción</th>
                          <th className="px-3 py-2 font-medium">Cuenta</th>
                          <th className="px-3 py-2 text-right font-medium">Base</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedInvoice.items.map((item: any, idx: number) => (
                          <tr key={idx}>
                            <td className="px-3 py-2 text-slate-700">{item.description || "—"}</td>
                            <td className="px-3 py-2">
                              {item.subAccountCode
                                ? <span className="font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{item.subAccountCode}</span>
                                : <span className="text-red-500">Sin cuenta</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-900">{formatCurrency(item.baseAmount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 border-t border-slate-200">
                        <tr className="font-medium">
                          <td className="px-3 py-2 text-slate-700" colSpan={2}>Total base</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-900">{formatCurrency(selectedInvoice.baseAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 text-xs">
                  {[
                    { label: "Base imponible", value: selectedInvoice.baseAmount },
                    { label: "IVA",            value: selectedInvoice.vatAmount  },
                    { label: "IRPF",           value: selectedInvoice.irpfAmount },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between">
                      <span className="text-slate-500">{r.label}</span>
                      <span className={`font-mono font-medium ${r.value < 0 ? "text-red-600" : "text-slate-900"}`}>{formatCurrency(r.value)} €</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-200 pt-1.5 flex justify-between">
                    <span className="text-sm font-semibold text-slate-900">Total factura</span>
                    <span className="font-mono text-sm font-bold text-slate-900">{formatCurrency(selectedInvoice.totalAmount)} €</span>
                  </div>
                </div>

                {!isInvoiceCoded(selectedInvoice) && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-start gap-2">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>Esta factura no está codificada. Todos los ítems deben tener cuenta analítica asignada.</span>
                  </div>
                )}

                {isInvoiceCoded(selectedInvoice) && !selectedInvoice.accounted && ["approved","pending","paid"].includes(selectedInvoice.status) && (
                  <div className="border-t border-slate-200 pt-4 space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contabilizar</h4>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Nº Asiento <span className="text-red-500">*</span></label>
                      <input type="text" value={accountingForm.entryNumber} onChange={(e) => setAccountingForm({ ...accountingForm, entryNumber: e.target.value })}
                        placeholder="A-2024-001" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 outline-none font-mono" />
                    </div>
                    {accountingForm.entryNumber.trim() && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Preview asiento — {accountingForm.entryNumber}</p>
                        <table className="w-full text-xs">
                          <thead><tr className="text-slate-400 text-[10px]"><th className="text-left pb-1.5 font-medium">Cuenta</th><th className="text-right pb-1.5 font-medium">Debe</th><th className="text-right pb-1.5 font-medium">Haber</th></tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedInvoice.items.map((item: any, i: number) => (
                              <tr key={i}><td className="py-1 font-mono text-slate-600">{item.subAccountCode} – {item.description}</td><td className="py-1 text-right font-mono font-semibold text-slate-900">{formatCurrency(item.baseAmount)}</td><td /></tr>
                            ))}
                            {selectedInvoice.vatAmount > 0 && <tr><td className="py-1 font-mono text-slate-600">472 – H.P. IVA soportado</td><td className="py-1 text-right font-mono font-semibold text-slate-900">{formatCurrency(selectedInvoice.vatAmount)}</td><td /></tr>}
                            {selectedInvoice.irpfAmount < 0 && <tr><td className="py-1 font-mono text-slate-600">473 – H.P. retenciones practicadas</td><td /><td className="py-1 text-right font-mono font-semibold text-red-600">{formatCurrency(Math.abs(selectedInvoice.irpfAmount))}</td></tr>}
                            <tr><td className="py-1 font-mono text-slate-600">400 – Proveedores</td><td /><td className="py-1 text-right font-mono font-semibold text-red-600">{formatCurrency(selectedInvoice.totalAmount + (selectedInvoice.irpfAmount < 0 ? Math.abs(selectedInvoice.irpfAmount) : 0))}</td></tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    <button onClick={handleMarkAsAccounted} disabled={saving || !accountingForm.entryNumber.trim()}
                      className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
                      {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      Contabilizar y siguiente
                    </button>
                  </div>
                )}

                {selectedInvoice.accounted && (
                  <div className="border-t border-slate-200 pt-4 space-y-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-2"><CheckCircle size={16} />Factura contabilizada</div>
                      <div className="text-xs text-emerald-600 space-y-1">
                        <p>Nº Asiento: <span className="font-mono font-medium">{selectedInvoice.accountingEntryNumber}</span></p>
                        {selectedInvoice.accountedByName && <p>Por: {selectedInvoice.accountedByName}</p>}
                      </div>
                    </div>
                    <button onClick={handleUnmarkAsAccounted} disabled={saving}
                      className="w-full py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-2">
                      <Unlock size={14} />Desbloquear para edición
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
