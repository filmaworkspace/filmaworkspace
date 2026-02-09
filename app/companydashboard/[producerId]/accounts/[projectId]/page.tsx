"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  query,
  orderBy,
} from "firebase/firestore";
import { handleInvoiceStatusChange } from "@/lib/budgetOperations";
import {
  ArrowLeft,
  Building2,
  Search,
  Filter,
  ChevronDown,
  Eye,
  CheckCircle,
  Clock,
  AlertTriangle,
  Receipt,
  Lock,
  Unlock,
  Euro,
  X,
  CheckSquare,
  AlertCircle,
  RefreshCw,
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
}

interface Project {
  id: string;
  name: string;
}

interface Producer {
  id: string;
  name: string;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Borrador" },
  coding: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificando" },
  pending_approval: { bg: "bg-amber-50", text: "text-amber-700", label: "Pte. aprob." },
  pending: { bg: "bg-blue-50", text: "text-blue-700", label: "Pte. pago" },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada" },
  accounted: { bg: "bg-teal-50", text: "text-teal-700", label: "Contabilizada" },
  paid: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Pagada" },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", label: "Anulada" },
};

const FILTER_OPTIONS = [
  { value: "all", label: "Todas" },
  { value: "pending_accounting", label: "Pte. contabilizar" },
  { value: "accounted", label: "Contabilizadas" },
  { value: "approved", label: "Aprobadas" },
  { value: "pending", label: "Pte. pago" },
  { value: "paid", label: "Pagadas" },
];

export default function CompanyAccountsPage() {
  const params = useParams();
  const router = useRouter();
  const producerId = params?.producerId as string;
  const projectId = params?.projectId as string;
  const { user: contextUser, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [producer, setProducer] = useState<Producer | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  const [showAccountingModal, setShowAccountingModal] = useState<Invoice | null>(null);
  const [accountingForm, setAccountingForm] = useState({
    entryNumber: "",
    accountingAccount: "",
  });

  const isAdmin = contextUser?.role === "admin";
  const isCompanyUser = contextUser?.companyId === producerId;
  const hasAccess = isAdmin || isCompanyUser;

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

  const formatDate = (date: Date) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date) : "-";

  useEffect(() => {
    if (!userLoading && !hasAccess) {
      router.push("/dashboard");
    }
  }, [contextUser, userLoading, router, hasAccess]);

  useEffect(() => {
    if (producerId && projectId && hasAccess) {
      loadData();
    }
  }, [producerId, projectId, hasAccess]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const producerDoc = await getDoc(doc(db, "producers", producerId));
      if (!producerDoc.exists()) {
        router.push(isAdmin ? "/admindashboard" : "/");
        return;
      }
      setProducer({ id: producerDoc.id, name: producerDoc.data().name });

      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (!projectDoc.exists()) {
        router.push(`/companydashboard/${producerId}`);
        return;
      }
      setProject({ id: projectDoc.id, name: projectDoc.data().name });

      const invoicesSnap = await getDocs(
        query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))
      );
      const invoicesData: Invoice[] = invoicesSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          number: data.number,
          displayNumber: data.displayNumber || data.number,
          documentType: data.documentType || "invoice",
          supplier: data.supplier,
          supplierId: data.supplierId,
          description: data.description,
          baseAmount: data.baseAmount || 0,
          vatAmount: data.vatAmount || 0,
          irpfAmount: data.irpfAmount || 0,
          totalAmount: data.totalAmount || 0,
          status: data.status,
          dueDate: data.dueDate?.toDate?.() || new Date(),
          invoiceDate: data.invoiceDate?.toDate?.(),
          createdAt: data.createdAt?.toDate?.() || new Date(),
          items: data.items || [],
          attachmentUrl: data.attachmentUrl,
          accounted: data.accounted || false,
          accountedAt: data.accountedAt?.toDate?.(),
          accountedBy: data.accountedBy,
          accountedByName: data.accountedByName,
          accountingEntryNumber: data.accountingEntryNumber,
          accountingAccount: data.accountingAccount,
        };
      });

      setInvoices(invoicesData);
    } catch (error) {
      console.error("Error loading data:", error);
      showToast("error", "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAsAccounted = async () => {
    if (!showAccountingModal || !accountingForm.entryNumber.trim()) {
      showToast("error", "El número de asiento es obligatorio");
      return;
    }

    setSaving(true);
    try {
      const oldStatus = showAccountingModal.status;
      const newStatus = "accounted";

      await updateDoc(doc(db, `projects/${projectId}/invoices`, showAccountingModal.id), {
        accounted: true,
        accountedAt: new Date(),
        accountedBy: contextUser?.uid,
        accountedByName: contextUser?.name,
        accountingEntryNumber: accountingForm.entryNumber.trim(),
        accountingAccount: accountingForm.accountingAccount.trim() || null,
        status: newStatus,
      });

      const invoiceItems = showAccountingModal.items.map((item: any) => ({
        subAccountId: item.subAccountId,
        baseAmount: item.baseAmount || 0,
      }));
      await handleInvoiceStatusChange(projectId, oldStatus, newStatus, invoiceItems);

      setShowAccountingModal(null);
      setAccountingForm({ entryNumber: "", accountingAccount: "" });
      showToast("success", "Factura contabilizada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al contabilizar");
    } finally {
      setSaving(false);
    }
  };

  const handleUnmarkAsAccounted = async (invoice: Invoice) => {
    if (!confirm("¿Desmarcar como contabilizada? Los usuarios podrán volver a editar la factura.")) return;

    setSaving(true);
    try {
      const oldStatus = invoice.status;
      const newStatus = "approved";

      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoice.id), {
        accounted: false,
        status: newStatus,
      });

      const invoiceItems = invoice.items.map((item: any) => ({
        subAccountId: item.subAccountId,
        baseAmount: item.baseAmount || 0,
      }));
      await handleInvoiceStatusChange(projectId, oldStatus, newStatus, invoiceItems);

      showToast("success", "Factura desbloqueada");
      await loadData();
    } catch (error) {
      console.error(error);
      showToast("error", "Error al desbloquear");
    } finally {
      setSaving(false);
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.supplier.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.accountingEntryNumber || "").toLowerCase().includes(searchTerm.toLowerCase());

    let matchesStatus = true;
    if (statusFilter === "pending_accounting") {
      matchesStatus = !inv.accounted && ["approved", "pending", "paid"].includes(inv.status);
    } else if (statusFilter === "accounted") {
      matchesStatus = inv.accounted === true;
    } else if (statusFilter !== "all") {
      matchesStatus = inv.status === statusFilter;
    }

    return matchesSearch && matchesStatus;
  });

  const totalInvoices = invoices.length;
  const pendingAccounting = invoices.filter((i) => !i.accounted && ["approved", "pending", "paid"].includes(i.status)).length;
  const accountedCount = invoices.filter((i) => i.accounted).length;
  const totalAmount = invoices.reduce((acc, i) => acc + i.totalAmount, 0);

  const isInvoiceCoded = (invoice: Invoice) => {
    return invoice.items && invoice.items.length > 0 && invoice.items.every((item) => item.subAccountId);
  };

  if (loading || userLoading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!producer || !project) return null;

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
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

      <div className="mt-16">
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href={`/companydashboard/${producerId}`}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <ArrowLeft size={18} />
              </Link>
              <div className="flex items-center gap-2 text-sm">
                <Building2 size={16} className="text-slate-400" />
                <span className="font-medium text-slate-600">{producer.name}</span>
                <span className="text-slate-300">/</span>
                <span className="font-semibold text-slate-900">{project.name}</span>
                <span className="text-slate-300">·</span>
                <span className="text-xs text-slate-500">Contabilidad</span>
              </div>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        <div className="bg-white border-b border-slate-200 px-4 py-2">
          <div className="flex items-center gap-6 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Total:</span>
              <span className="font-semibold text-slate-900">{totalInvoices}</span>
            </div>
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
            <div className="flex items-center gap-1.5 ml-auto">
              <Euro size={12} className="text-slate-400" />
              <span className="text-slate-500">Importe total:</span>
              <span className="font-semibold text-slate-900">{formatCurrency(totalAmount)} €</span>
            </div>
          </div>
        </div>

        <div className="bg-white border-b border-slate-200 px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar factura, proveedor, asiento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none"
              />
            </div>

            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg ${
                  statusFilter !== "all"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Filter size={14} />
                {FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label || "Filtrar"}
                <ChevronDown size={14} />
              </button>
              {showFilterDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 min-w-[160px]">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setStatusFilter(option.value);
                        setShowFilterDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 text-sm ${
                        statusFilter === option.value
                          ? "bg-slate-100 text-slate-900 font-medium"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-4">
          {filteredInvoices.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
              <Receipt size={24} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No hay facturas</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2">Nº Factura</th>
                    <th className="px-3 py-2">Proveedor</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Cuenta</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">IVA</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">Nº Asiento</th>
                    <th className="px-3 py-2 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((invoice) => {
                    const isCoded = isInvoiceCoded(invoice);
                    const canBeAccounted = isCoded && ["approved", "pending", "paid"].includes(invoice.status);
                    const statusConf = STATUS_CONFIG[invoice.status] || STATUS_CONFIG.pending;
                    // Obtener cuentas únicas de los items
                    const accountCodes = [...new Set(invoice.items.map((item: any) => item.subAccountCode).filter(Boolean))];

                    return (
                      <tr key={invoice.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          {invoice.accounted ? (
                            <div className="w-5 h-5 bg-emerald-100 rounded flex items-center justify-center" title="Contabilizada">
                              <Lock size={12} className="text-emerald-600" />
                            </div>
                          ) : canBeAccounted ? (
                            <div className="w-5 h-5 bg-amber-50 rounded flex items-center justify-center" title="Pendiente contabilizar">
                              <Clock size={12} className="text-amber-500" />
                            </div>
                          ) : (
                            <div className="w-5 h-5 bg-slate-100 rounded flex items-center justify-center" title={!isCoded ? "Sin codificar" : "No apta"}>
                              <AlertTriangle size={12} className="text-slate-400" />
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-2">
                          <span className="font-mono text-xs font-medium text-slate-900">{invoice.displayNumber}</span>
                        </td>

                        <td className="px-3 py-2">
                          <span className="text-slate-700 truncate max-w-[150px] block">{invoice.supplier}</span>
                        </td>

                        <td className="px-3 py-2 text-slate-500 text-xs">
                          {formatDate(invoice.invoiceDate || invoice.createdAt)}
                        </td>

                        <td className="px-3 py-2">
                          {accountCodes.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {accountCodes.slice(0, 2).map((code, idx) => (
                                <span key={idx} className="font-mono text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {code}
                                </span>
                              ))}
                              {accountCodes.length > 2 && (
                                <span className="text-[10px] text-slate-400">+{accountCodes.length - 2}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-700">
                          {formatCurrency(invoice.baseAmount)}
                        </td>

                        <td className="px-3 py-2 text-right font-mono text-xs text-slate-500">
                          {formatCurrency(invoice.vatAmount)}
                        </td>

                        <td className="px-3 py-2 text-right font-mono text-xs font-medium text-slate-900">
                          {formatCurrency(invoice.totalAmount)}
                        </td>

                        <td className="px-3 py-2">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${statusConf.bg} ${statusConf.text}`}>
                            {statusConf.label}
                          </span>
                        </td>

                        <td className="px-3 py-2">
                          {invoice.accountingEntryNumber ? (
                            <span className="font-mono text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                              {invoice.accountingEntryNumber}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              href={`/project/${projectId}/invoices/${invoice.id}`}
                              className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                              title="Ver factura"
                            >
                              <Eye size={14} />
                            </Link>

                            {invoice.accounted ? (
                              <button
                                onClick={() => handleUnmarkAsAccounted(invoice)}
                                disabled={saving}
                                className="p-1 text-emerald-500 hover:text-amber-600 hover:bg-amber-50 rounded disabled:opacity-50"
                                title="Desbloquear factura"
                              >
                                <Unlock size={14} />
                              </button>
                            ) : canBeAccounted ? (
                              <button
                                onClick={() => {
                                  setShowAccountingModal(invoice);
                                  setAccountingForm({
                                    entryNumber: "",
                                    accountingAccount: invoice.accountingAccount || "",
                                  });
                                }}
                                disabled={saving}
                                className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded disabled:opacity-50"
                                title="Contabilizar"
                              >
                                <CheckSquare size={14} />
                              </button>
                            ) : !isCoded ? (
                              <span className="p-1 text-slate-300" title="Factura sin codificar">
                                <AlertTriangle size={14} />
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showAccountingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Contabilizar factura</h3>
                <p className="text-xs text-slate-500">{showAccountingModal.displayNumber} · {showAccountingModal.supplier}</p>
              </div>
              <button
                onClick={() => setShowAccountingModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500">Base imponible</span>
                  <span className="font-mono">{formatCurrency(showAccountingModal.baseAmount)} €</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-500">IVA</span>
                  <span className="font-mono">{formatCurrency(showAccountingModal.vatAmount)} €</span>
                </div>
                {showAccountingModal.irpfAmount > 0 && (
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-500">IRPF</span>
                    <span className="font-mono text-red-600">-{formatCurrency(showAccountingModal.irpfAmount)} €</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 font-medium">
                  <span>Total</span>
                  <span className="font-mono">{formatCurrency(showAccountingModal.totalAmount)} €</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Número de asiento <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={accountingForm.entryNumber}
                  onChange={(e) => setAccountingForm({ ...accountingForm, entryNumber: e.target.value })}
                  placeholder="Ej: A-2024-00123"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Cuenta contable <span className="text-slate-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={accountingForm.accountingAccount}
                  onChange={(e) => setAccountingForm({ ...accountingForm, accountingAccount: e.target.value })}
                  placeholder="Ej: 6230001"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-slate-400 focus:border-slate-400 outline-none font-mono"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>Una vez contabilizada, la factura quedará bloqueada y los usuarios no podrán editarla ni anularla.</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex gap-3">
              <button
                onClick={() => setShowAccountingModal(null)}
                className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleMarkAsAccounted}
                disabled={saving || !accountingForm.entryNumber.trim()}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <CheckCircle size={14} />
                )}
                Contabilizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
