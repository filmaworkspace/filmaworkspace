"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc, getDoc, collection, getDocs, updateDoc, query, where, orderBy, Timestamp } from "firebase/firestore";
import { Receipt, Edit, Download, XCircle, CheckCircle, Clock, Ban, Building2, Calendar, User, Hash, FileUp, ChevronLeft, ChevronRight, AlertTriangle, KeyRound, AlertCircle, ShieldAlert, ExternalLink, MoreHorizontal, CreditCard, FileText, Link as LinkIcon, Eye, EyeOff, Code, Save, X, Plus, Trash2, Search, RefreshCw, Percent, Euro, FileCheck, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type InvoiceStatus = "draft" | "pending" | "pending_approval" | "approved" | "rejected" | "paid" | "cancelled" | "coding";
type DocumentType = "invoice" | "proforma" | "autonomo" | "ticket";

interface InvoiceItem { description: string; subAccountId: string; subAccountCode: string; subAccountDescription: string; quantity: number; unitPrice: number; baseAmount: number; vatRate: number; vatAmount: number; irpfRate: number; irpfAmount: number; totalAmount: number; poItemId?: string; poItemIndex?: number; isNewItem?: boolean; }
interface Invoice { id: string; documentType: DocumentType; number: string; displayNumber: string; supplierNumber?: string; supplier: string; supplierId: string; supplierTaxId?: string; supplierIban?: string; supplierBic?: string; department?: string; description: string; notes?: string; items: InvoiceItem[]; baseAmount: number; vatAmount: number; irpfAmount: number; totalAmount: number; invoiceDate?: Date; dueDate: Date; status: InvoiceStatus; approvalStatus?: string; attachmentUrl?: string; attachmentFileName?: string; createdAt: Date; createdBy: string; createdByName: string; codedAt?: Date; codedBy?: string; codedByName?: string; approvedAt?: Date; approvedBy?: string; approvedByName?: string; paidAt?: Date; paidAmount?: number; paymentMethod?: string; paymentReference?: string; cancelledAt?: Date; cancelledByName?: string; cancellationReason?: string; poId?: string; poNumber?: string; requiresReplacement?: boolean; replacedByInvoiceId?: string; isReplacement?: boolean; replacesDocumentId?: string; replacesDocumentNumber?: string; currency?: string; accountingEntry?: string; isAsset?: boolean; assetCategory?: string; }
interface LinkedPO { id: string; number: string; supplier: string; baseAmount: number; invoicedAmount: number; status: string; items?: any[]; }
interface Supplier { id: string; name: string; taxId?: string; iban?: string; bic?: string; }
interface SubAccount { id: string; code: string; description: string; accountId: string; committed: number; actual: number; budgeted: number; }
interface PaymentRecord { id: string; forecastId: string; forecastName: string; amount: number; paidAt: Date; paidByName: string; receiptUrl?: string; receiptName?: string; }

const STATUS_CONFIG: Record<InvoiceStatus, { bg: string; text: string; label: string; icon: typeof Clock }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit },
  coding: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificando", icon: Code },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente pago", icon: Clock },
  pending_approval: { bg: "bg-amber-50", text: "text-amber-700", label: "Pend. aprobación", icon: Clock },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada", icon: CheckCircle },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada", icon: XCircle },
  paid: { bg: "bg-blue-50", text: "text-blue-700", label: "Pagada", icon: CreditCard },
  cancelled: { bg: "bg-red-50", text: "text-red-700", label: "Anulada", icon: Ban },
};

const DOC_TYPE_CONFIG: Record<DocumentType, { label: string; code: string; color: string }> = {
  invoice: { label: "Factura", code: "FAC", color: "text-indigo-600" },
  proforma: { label: "Proforma", code: "PRF", color: "text-violet-600" },
  autonomo: { label: "Autónomo", code: "AUT", color: "text-amber-600" },
  ticket: { label: "Ticket", code: "TKT", color: "text-emerald-600" },
};

const VAT_RATES = [0, 4, 10, 21];
const IRPF_RATES = [0, 7, 15, 19];
const PAYMENT_METHODS = [
  { value: "transfer", label: "Transferencia bancaria" },
  { value: "card", label: "Tarjeta" },
  { value: "cash", label: "Efectivo" },
  { value: "check", label: "Cheque" },
  { value: "direct_debit", label: "Domiciliación" },
];

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const invoiceId = params?.invoiceId as string;
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(projectId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [linkedPO, setLinkedPO] = useState<LinkedPO | null>(null);
  const [allInvoiceIds, setAllInvoiceIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  
  // Coding mode states
  const [codingMode, setCodingMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [codingForm, setCodingForm] = useState({
    supplierNumber: "", invoiceDate: "", dueDate: "", description: "", supplierTaxId: "", supplierIban: "", supplierBic: "",
    paymentMethod: "transfer", currency: "EUR", accountingEntry: "", isAsset: false, assetCategory: "", notes: "",
  });
  const [codingItems, setCodingItems] = useState<Array<{ description: string; subAccountId: string; subAccountCode: string; subAccountDescription: string; quantity: number; unitPrice: number; vatRate: number; irpfRate: number; poItemIndex?: number; isNewItem: boolean; }>>([]);
  const [searchSubAccount, setSearchSubAccount] = useState("");

  const showToast = (type: "success" | "error", message: string) => { setToast({ type, message }); setTimeout(() => setToast(null), 3000); };
  const formatCurrency = (a: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0);
  const formatDate = (d: Date) => d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(d) : "-";
  const formatDateTime = (d: Date) => d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d) : "-";
  const formatDateInput = (d: Date) => d ? d.toISOString().split("T")[0] : "";

  useEffect(() => { if (projectId && invoiceId && !permissionsLoading) loadData(); }, [projectId, invoiceId, permissionsLoading]);

  const loadData = async () => {
    try {
      setLoading(true);
      const invoiceDoc = await getDoc(doc(db, `projects/${projectId}/invoices`, invoiceId));
      if (!invoiceDoc.exists()) { router.push(`/project/${projectId}/accounting/invoices`); return; }
      const data = invoiceDoc.data();
      const invoiceData: Invoice = {
        id: invoiceDoc.id, documentType: data.documentType || "invoice", number: data.number || "", displayNumber: data.displayNumber || `FAC-${data.number}`,
        supplierNumber: data.supplierNumber, supplier: data.supplier || "", supplierId: data.supplierId || "", supplierTaxId: data.supplierTaxId, supplierIban: data.supplierIban, supplierBic: data.supplierBic,
        department: data.department, description: data.description || "", notes: data.notes, items: data.items || [],
        baseAmount: data.baseAmount || 0, vatAmount: data.vatAmount || 0, irpfAmount: data.irpfAmount || 0, totalAmount: data.totalAmount || 0,
        invoiceDate: data.invoiceDate?.toDate(), dueDate: data.dueDate?.toDate() || new Date(), status: data.status || "pending",
        approvalStatus: data.approvalStatus, attachmentUrl: data.attachmentUrl, attachmentFileName: data.attachmentFileName,
        createdAt: data.createdAt?.toDate() || new Date(), createdBy: data.createdBy || "", createdByName: data.createdByName || "",
        codedAt: data.codedAt?.toDate(), codedBy: data.codedBy, codedByName: data.codedByName,
        approvedAt: data.approvedAt?.toDate(), approvedBy: data.approvedBy, approvedByName: data.approvedByName,
        paidAt: data.paidAt?.toDate(), paidAmount: data.paidAmount, paymentMethod: data.paymentMethod, paymentReference: data.paymentReference,
        cancelledAt: data.cancelledAt?.toDate(), cancelledByName: data.cancelledByName, cancellationReason: data.cancellationReason,
        poId: data.poId, poNumber: data.poNumber, requiresReplacement: data.requiresReplacement,
        replacedByInvoiceId: data.replacedByInvoiceId, isReplacement: data.isReplacement,
        replacesDocumentId: data.replacesDocumentId, replacesDocumentNumber: data.replacesDocumentNumber,
        currency: data.currency || "EUR", accountingEntry: data.accountingEntry, isAsset: data.isAsset, assetCategory: data.assetCategory,
      };
      setInvoice(invoiceData);

      // Init coding form
      setCodingForm({
        supplierNumber: data.supplierNumber || "", invoiceDate: formatDateInput(data.invoiceDate?.toDate() || new Date()),
        dueDate: formatDateInput(data.dueDate?.toDate() || new Date()), description: data.description || "",
        supplierTaxId: data.supplierTaxId || "", supplierIban: data.supplierIban || "", supplierBic: data.supplierBic || "",
        paymentMethod: data.paymentMethod || "transfer", currency: data.currency || "EUR",
        accountingEntry: data.accountingEntry || "", isAsset: data.isAsset || false, assetCategory: data.assetCategory || "", notes: data.notes || "",
      });
      setCodingItems((data.items || []).map((i: any) => ({
        description: i.description || "", subAccountId: i.subAccountId || "", subAccountCode: i.subAccountCode || "",
        subAccountDescription: i.subAccountDescription || "", quantity: i.quantity || 1, unitPrice: i.unitPrice || 0,
        vatRate: i.vatRate ?? 21, irpfRate: i.irpfRate ?? 0, poItemIndex: i.poItemIndex, isNewItem: i.isNewItem ?? (i.poItemIndex === undefined || i.poItemIndex === null),
      })));

      // Load PO
      if (data.poId) {
        const poDoc = await getDoc(doc(db, `projects/${projectId}/pos`, data.poId));
        if (poDoc.exists()) {
          const poData = poDoc.data();
          setLinkedPO({ id: poDoc.id, number: poData.number, supplier: poData.supplier, baseAmount: poData.baseAmount || 0, invoicedAmount: poData.invoicedAmount || 0, status: poData.status, items: poData.items });
        }
      }

      // Load invoice IDs for nav
      const invoicesSnap = await getDocs(query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "asc")));
      setAllInvoiceIds(invoicesSnap.docs.map((d) => d.id));
      setCurrentIndex(invoicesSnap.docs.findIndex((d) => d.id === invoiceId));

      // Load suppliers
      const suppliersSnap = await getDocs(collection(db, `projects/${projectId}/suppliers`));
      setSuppliers(suppliersSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Supplier[]);

      // Load subaccounts
      const accountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
      const subs: SubAccount[] = [];
      for (const acc of accountsSnap.docs) {
        const subSnap = await getDocs(collection(db, `projects/${projectId}/accounts/${acc.id}/subaccounts`));
        subSnap.docs.forEach((s) => {
          const sd = s.data();
          subs.push({ id: s.id, code: sd.code, description: sd.description, accountId: acc.id, committed: sd.committed || 0, actual: sd.actual || 0, budgeted: sd.budgeted || 0 });
        });
      }
      setSubAccounts(subs.sort((a, b) => a.code.localeCompare(b.code)));

      // Load payments for this invoice
      const forecastsSnap = await getDocs(collection(db, `projects/${projectId}/paymentForecasts`));
      const invoicePayments: PaymentRecord[] = [];
      for (const forecastDoc of forecastsSnap.docs) {
        const fData = forecastDoc.data();
        const items = fData.items || [];
        for (const item of items) {
          if (item.invoiceId === invoiceId && item.status === "completed") {
            invoicePayments.push({
              id: item.id,
              forecastId: forecastDoc.id,
              forecastName: fData.name || "Remesa",
              amount: item.partialAmount || item.amount,
              paidAt: item.completedAt?.toDate ? item.completedAt.toDate() : new Date(item.completedAt),
              paidByName: item.completedByName || "Usuario",
              receiptUrl: item.receiptUrl,
              receiptName: item.receiptName,
            });
          }
        }
      }
      setPayments(invoicePayments.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime()));

      setLoading(false);
    } catch (error) { console.error("Error:", error); setLoading(false); }
  };

  const loadSupplierData = async () => {
    if (!invoice?.supplierId) return;
    const sup = suppliers.find((s) => s.id === invoice.supplierId);
    if (sup) {
      setCodingForm((prev) => ({ ...prev, supplierTaxId: sup.taxId || prev.supplierTaxId, supplierIban: sup.iban || prev.supplierIban, supplierBic: sup.bic || prev.supplierBic }));
    }
  };

  const calculateItemTotals = (item: typeof codingItems[0]) => {
    const base = item.quantity * item.unitPrice;
    const vat = base * (item.vatRate / 100);
    const irpf = base * (item.irpfRate / 100);
    return { base, vat, irpf, total: base + vat - irpf };
  };

  const calculateTotals = () => {
    let base = 0, vat = 0, irpf = 0;
    codingItems.forEach((item) => { const t = calculateItemTotals(item); base += t.base; vat += t.vat; irpf += t.irpf; });
    return { base, vat, irpf, total: base + vat - irpf };
  };

  const addCodingItem = () => {
    setCodingItems([...codingItems, { description: "", subAccountId: "", subAccountCode: "", subAccountDescription: "", quantity: 1, unitPrice: 0, vatRate: 21, irpfRate: 0, isNewItem: true }]);
  };

  const removeCodingItem = (index: number) => {
    if (codingItems.length <= 1) return;
    setCodingItems(codingItems.filter((_, i) => i !== index));
  };

  const updateCodingItem = (index: number, field: string, value: any) => {
    const updated = [...codingItems];
    updated[index] = { ...updated[index], [field]: value };
    setCodingItems(updated);
  };

  const selectSubAccount = (index: number, sub: SubAccount) => {
    updateCodingItem(index, "subAccountId", sub.id);
    updateCodingItem(index, "subAccountCode", sub.code);
    updateCodingItem(index, "subAccountDescription", sub.description);
    setSearchSubAccount("");
  };

  const handleSaveCoding = async () => {
    if (!invoice) return;
    // Validate
    if (!codingForm.invoiceDate) { showToast("error", "Fecha de factura requerida"); return; }
    if (codingItems.some((i) => !i.subAccountId)) { showToast("error", "Todas las partidas deben tener cuenta asignada"); return; }
    if (codingItems.some((i) => i.unitPrice <= 0)) { showToast("error", "Los importes deben ser mayores a 0"); return; }

    setSaving(true);
    try {
      const totals = calculateTotals();
      const items = codingItems.map((item) => {
        const t = calculateItemTotals(item);
        return { ...item, baseAmount: t.base, vatAmount: t.vat, irpfAmount: t.irpf, totalAmount: t.total };
      });

      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoice.id), {
        supplierNumber: codingForm.supplierNumber, invoiceDate: codingForm.invoiceDate ? Timestamp.fromDate(new Date(codingForm.invoiceDate)) : null,
        dueDate: Timestamp.fromDate(new Date(codingForm.dueDate)), description: codingForm.description,
        supplierTaxId: codingForm.supplierTaxId, supplierIban: codingForm.supplierIban, supplierBic: codingForm.supplierBic,
        paymentMethod: codingForm.paymentMethod, currency: codingForm.currency, accountingEntry: codingForm.accountingEntry,
        isAsset: codingForm.isAsset, assetCategory: codingForm.assetCategory, notes: codingForm.notes,
        items, baseAmount: totals.base, vatAmount: totals.vat, irpfAmount: totals.irpf, totalAmount: totals.total,
        status: invoice.status === "draft" ? "pending_approval" : invoice.status,
        codedAt: Timestamp.now(), codedBy: permissions.userId, codedByName: permissions.userName,
      });

      showToast("success", "Factura codificada correctamente");
      setCodingMode(false);
      await loadData();
    } catch (error) { console.error("Error:", error); showToast("error", "Error al guardar"); } finally { setSaving(false); }
  };

  const verifyPassword = async (): Promise<boolean> => {
    if (!passwordInput.trim()) { setPasswordError("Introduce tu contraseña"); return false; }
    const user = auth.currentUser;
    if (!user?.email) { setPasswordError("No hay usuario autenticado"); return false; }
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, passwordInput));
      setPasswordError(""); return true;
    } catch (e: any) { setPasswordError(e.code?.includes("password") || e.code?.includes("credential") ? "Contraseña incorrecta" : "Error"); return false; }
  };

  const handleCancelInvoice = async () => {
    if (!invoice || !cancellationReason.trim()) return;
    if (!(await verifyPassword())) return;
    setProcessing(true);
    try {
      if (["approved", "paid", "pending"].includes(invoice.status)) {
        const accountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
        for (const item of invoice.items) {
          if (item.subAccountId) {
            for (const acc of accountsSnap.docs) {
              const subRef = doc(db, `projects/${projectId}/accounts/${acc.id}/subaccounts`, item.subAccountId);
              const subSnap = await getDoc(subRef);
              if (subSnap.exists()) {
                const updates: any = { actual: Math.max(0, (subSnap.data().actual || 0) - (item.baseAmount || 0)) };
                if (invoice.poId) updates.committed = (subSnap.data().committed || 0) + (item.baseAmount || 0);
                await updateDoc(subRef, updates);
                break;
              }
            }
          }
        }
        if (invoice.poId) {
          const poRef = doc(db, `projects/${projectId}/pos`, invoice.poId);
          const poSnap = await getDoc(poRef);
          if (poSnap.exists()) await updateDoc(poRef, { invoicedAmount: Math.max(0, (poSnap.data().invoicedAmount || 0) - invoice.baseAmount) });
        }
      }
      await updateDoc(doc(db, `projects/${projectId}/invoices`, invoice.id), {
        status: "cancelled", cancelledAt: Timestamp.now(), cancelledBy: permissions.userId, cancelledByName: permissions.userName, cancellationReason: cancellationReason.trim(),
      });
      setShowCancelModal(false); setPasswordInput(""); setCancellationReason("");
      await loadData();
    } catch (e) { showToast("error", "Error al anular"); } finally { setProcessing(false); }
  };

  const navigateInvoice = (dir: "prev" | "next") => {
    const idx = dir === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (idx >= 0 && idx < allInvoiceIds.length) router.push(`/project/${projectId}/accounting/invoices/${allInvoiceIds[idx]}`);
  };

  const canCode = () => permissions.accountingAccessLevel === "accounting" || permissions.accountingAccessLevel === "accounting_extended";
  const canCancel = () => invoice && !["cancelled", "paid"].includes(invoice.status) && permissions.isProjectRole;
  const canEdit = () => invoice && ["draft", "rejected"].includes(invoice.status);
  const isPDF = (url?: string) => url?.toLowerCase().includes(".pdf") || url?.toLowerCase().includes("application/pdf");

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">No tienes permisos para ver este documento.</p>
          <Link
            href={`/project/${projectId}/accounting/invoices`}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            style={{ backgroundColor: "#2F52E0" }}
          >
            Volver a facturas
          </Link>
        </div>
      </div>
    );
  }

  if (!invoice) return null;

  const config = STATUS_CONFIG[invoice.status];
  const docConfig = DOC_TYPE_CONFIG[invoice.documentType];
  const StatusIcon = config.icon;
  const totals = calculateTotals();

  // Coding Mode UI
  if (codingMode) {
    return (
      <div className={`min-h-screen bg-slate-100 ${inter.className}`}>
        {toast && <div className="fixed top-4 right-4 z-50"><div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white text-sm font-medium`}>{toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{toast.message}</div></div>}
        
        {/* Coding Header */}
        <div className="bg-violet-600 text-white px-6 py-3 flex items-center justify-between fixed top-0 left-0 right-0 z-50">
          <div className="flex items-center gap-4">
            <button onClick={() => setCodingMode(false)} className="p-2 hover:bg-violet-700 rounded-lg"><X size={20} /></button>
            <div className="flex items-center gap-3">
              <Code size={20} />
              <span className="font-semibold">CODIFICAR</span>
              <span className="bg-violet-500 px-2 py-0.5 rounded text-sm">{invoice.displayNumber}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-violet-200 text-sm">Total: <span className="font-bold text-white">{formatCurrency(totals.total)} €</span></span>
            <button onClick={handleSaveCoding} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-white text-violet-700 rounded-xl text-sm font-semibold hover:bg-violet-50 disabled:opacity-50 shadow-lg">
              {saving ? <RefreshCw size={16} className="animate-spin" /> : <FileCheck size={16} />}
              {saving ? "Guardando..." : "Completar codificación"}
            </button>
          </div>
        </div>

        <div className="flex pt-[52px]" style={{ height: "100vh" }}>
          {/* Left: Document Preview */}
          <div className="w-1/2 bg-slate-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-slate-400 text-sm">Vista previa del documento</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setZoomLevel(Math.max(50, zoomLevel - 25))} className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ZoomOut size={16} /></button>
                <span className="text-slate-400 text-xs w-12 text-center">{zoomLevel}%</span>
                <button onClick={() => setZoomLevel(Math.min(200, zoomLevel + 25))} className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ZoomIn size={16} /></button>
                {invoice.attachmentUrl && <a href={invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600"><ExternalLink size={16} /></a>}
              </div>
            </div>
            <div className="flex-1 bg-slate-900 rounded-xl overflow-auto">
              {invoice.attachmentUrl ? (
                isPDF(invoice.attachmentUrl) ? (
                  <iframe src={`${invoice.attachmentUrl}#toolbar=0`} className="w-full h-full" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left", width: `${100 / (zoomLevel / 100)}%`, height: `${100 / (zoomLevel / 100)}%` }} />
                ) : (
                  <img src={invoice.attachmentUrl} alt="Documento" className="max-w-full" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left" }} />
                )
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500"><FileUp size={48} className="mb-2" /><p>Sin documento</p></div>
              )}
            </div>
          </div>

          {/* Right: Coding Form */}
          <div className="w-1/2 overflow-y-auto p-6">
            {/* Header Info */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Nº Factura proveedor</label>
                  <input value={codingForm.supplierNumber} onChange={(e) => setCodingForm({ ...codingForm, supplierNumber: e.target.value })} placeholder="Ej: G 07668" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fecha factura</label>
                  <input type="date" value={codingForm.invoiceDate} onChange={(e) => setCodingForm({ ...codingForm, invoiceDate: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Fecha vencimiento</label>
                  <input type="date" value={codingForm.dueDate} onChange={(e) => setCodingForm({ ...codingForm, dueDate: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
                </div>
              </div>
              <div className="mt-4">
                <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                <input value={codingForm.description} onChange={(e) => setCodingForm({ ...codingForm, description: e.target.value })} placeholder="Descripción de la factura" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none" />
              </div>
            </div>

            {/* Supplier Info */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Building2 size={16} className="text-slate-400" />Proveedor: {invoice.supplier}</h3>
                <button onClick={loadSupplierData} className="text-xs text-violet-600 hover:underline flex items-center gap-1"><RefreshCw size={12} />Cargar datos</button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">CIF/NIF</label>
                  <input value={codingForm.supplierTaxId} onChange={(e) => setCodingForm({ ...codingForm, supplierTaxId: e.target.value })} placeholder="B12345678" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">IBAN</label>
                  <input value={codingForm.supplierIban} onChange={(e) => setCodingForm({ ...codingForm, supplierIban: e.target.value })} placeholder="ES12 3456 7890 1234 5678 90" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">BIC</label>
                  <input value={codingForm.supplierBic} onChange={(e) => setCodingForm({ ...codingForm, supplierBic: e.target.value })} placeholder="BBVAESMMXXX" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Líneas de codificación</h3>
                <div className="flex items-center gap-2">
                  {linkedPO && linkedPO.items && linkedPO.items.length > 0 && (
                    <button 
                      onClick={() => {
                        const poItems = linkedPO.items!.map((poItem: any, idx: number) => ({
                          description: poItem.description || "",
                          subAccountId: poItem.subAccountId || "",
                          subAccountCode: poItem.subAccountCode || "",
                          subAccountDescription: poItem.subAccountDescription || "",
                          quantity: poItem.quantity || 1,
                          unitPrice: poItem.unitPrice || 0,
                          vatRate: poItem.vatRate ?? 21,
                          irpfRate: poItem.irpfRate ?? 0,
                          poItemIndex: idx,
                          isNewItem: false,
                        }));
                        setCodingItems(poItems);
                      }} 
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-200"
                    >
                      <LinkIcon size={14} />Importar de PO
                    </button>
                  )}
                  <button onClick={addCodingItem} className="flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-medium hover:bg-violet-200"><Plus size={14} />Añadir línea</button>
                </div>
              </div>

              {/* PO Items selector */}
              {linkedPO && linkedPO.items && linkedPO.items.length > 0 && (
                <div className="mb-4 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <p className="text-xs font-medium text-indigo-800 mb-2">Añadir línea desde PO-{linkedPO.number}:</p>
                  <div className="flex flex-wrap gap-2">
                    {linkedPO.items.map((poItem: any, idx: number) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setCodingItems([...codingItems, {
                            description: poItem.description || "",
                            subAccountId: poItem.subAccountId || "",
                            subAccountCode: poItem.subAccountCode || "",
                            subAccountDescription: poItem.subAccountDescription || "",
                            quantity: poItem.quantity || 1,
                            unitPrice: poItem.unitPrice || 0,
                            vatRate: poItem.vatRate ?? 21,
                            irpfRate: poItem.irpfRate ?? 0,
                            poItemIndex: idx,
                            isNewItem: false,
                          }]);
                        }}
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-200 rounded-lg text-xs hover:bg-indigo-100 transition-colors"
                      >
                        <span className="font-medium text-indigo-700">#{idx + 1}</span>
                        <span className="text-slate-600 truncate max-w-[150px]">{poItem.description || "Sin descripción"}</span>
                        <span className="font-mono text-slate-500">{formatCurrency(poItem.unitPrice || 0)}€</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {codingItems.map((item, idx) => (
                  <div key={idx} className={`border rounded-xl p-4 relative ${item.isNewItem ? "border-amber-200 bg-amber-50/30" : "border-indigo-200 bg-indigo-50/30"}`}>
                    <div className="absolute -top-2 left-3 flex items-center gap-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs text-slate-500 font-medium">Línea {idx + 1}</span>
                      {item.isNewItem ? (
                        <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                          <Plus size={10} />Nuevo
                        </span>
                      ) : (
                        <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1">
                          <LinkIcon size={10} />De PO
                        </span>
                      )}
                    </div>
                    {codingItems.length > 1 && <button onClick={() => removeCodingItem(idx)} className="absolute top-2 right-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={14} /></button>}
                    
                    <div className="grid grid-cols-12 gap-3 mt-2">
                      <div className="col-span-12">
                        <label className="text-xs text-slate-500 block mb-1">Descripción</label>
                        <input value={item.description} onChange={(e) => updateCodingItem(idx, "description", e.target.value)} placeholder="Descripción del concepto" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                      </div>
                      
                      <div className="col-span-6">
                        <label className="text-xs text-slate-500 block mb-1">Cuenta / Partida</label>
                        <div className="relative">
                          {item.subAccountId ? (
                            <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg">
                              <span className="font-mono text-sm text-violet-700">{item.subAccountCode}</span>
                              <span className="text-xs text-slate-600 truncate flex-1">{item.subAccountDescription}</span>
                              <button onClick={() => { updateCodingItem(idx, "subAccountId", ""); updateCodingItem(idx, "subAccountCode", ""); updateCodingItem(idx, "subAccountDescription", ""); }} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                            </div>
                          ) : (
                            <div className="relative">
                              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              <input placeholder="Buscar cuenta..." value={searchSubAccount} onChange={(e) => setSearchSubAccount(e.target.value)} onFocus={() => setSearchSubAccount("")} className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                              {searchSubAccount && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-10 max-h-48 overflow-y-auto">
                                  {subAccounts.filter((s) => s.code.toLowerCase().includes(searchSubAccount.toLowerCase()) || s.description.toLowerCase().includes(searchSubAccount.toLowerCase())).slice(0, 10).map((s) => (
                                    <button key={s.id} onClick={() => selectSubAccount(idx, s)} className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-sm">
                                      <span className="font-mono text-violet-600">{s.code}</span>
                                      <span className="text-slate-600 truncate">{s.description}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {linkedPO && linkedPO.items && (
                        <div className="col-span-3">
                          <label className="text-xs text-slate-500 block mb-1">Origen</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                updateCodingItem(idx, "isNewItem", !item.isNewItem);
                                if (!item.isNewItem) updateCodingItem(idx, "poItemIndex", undefined);
                              }}
                              className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${item.isNewItem ? "bg-amber-100 text-amber-700 border border-amber-200" : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"}`}
                            >
                              Nuevo
                            </button>
                            <button
                              type="button"
                              onClick={() => updateCodingItem(idx, "isNewItem", false)}
                              className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${!item.isNewItem ? "bg-indigo-100 text-indigo-700 border border-indigo-200" : "bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200"}`}
                            >
                              De PO
                            </button>
                          </div>
                        </div>
                      )}

                      {linkedPO && linkedPO.items && !item.isNewItem && (
                        <div className="col-span-3">
                          <label className="text-xs text-slate-500 block mb-1">Línea de PO</label>
                          <select value={item.poItemIndex ?? ""} onChange={(e) => updateCodingItem(idx, "poItemIndex", e.target.value ? Number(e.target.value) : undefined)} className="w-full px-2 py-2 border border-indigo-200 bg-indigo-50 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none">
                            <option value="">Seleccionar...</option>
                            {linkedPO.items.map((poItem: any, i: number) => <option key={i} value={i}>#{i + 1} - {poItem.description?.substring(0, 30) || `Línea ${i + 1}`}</option>)}
                          </select>
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">IVA %</label>
                        <select value={item.vatRate} onChange={(e) => updateCodingItem(idx, "vatRate", Number(e.target.value))} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none">
                          {VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </div>

                      <div className="col-span-2">
                        <label className="text-xs text-slate-500 block mb-1">IRPF %</label>
                        <select value={item.irpfRate} onChange={(e) => updateCodingItem(idx, "irpfRate", Number(e.target.value))} className="w-full px-2 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none">
                          {IRPF_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </div>

                      <div className="col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">Base imponible</label>
                        <div className="relative">
                          <input type="number" step="0.01" value={item.unitPrice || ""} onChange={(e) => updateCodingItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} placeholder="0.00" className="w-full px-3 py-2 pr-8 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none text-right font-mono" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">€</span>
                        </div>
                      </div>

                      <div className="col-span-3">
                        <label className="text-xs text-slate-500 block mb-1">Total línea</label>
                        <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-right font-mono font-semibold text-slate-900">
                          {formatCurrency(calculateItemTotals(item).total)} €
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 mb-4">
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">Base imponible</p><p className="font-bold text-slate-900">{formatCurrency(totals.base)} €</p></div>
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">IVA</p><p className="font-bold text-emerald-600">+{formatCurrency(totals.vat)} €</p></div>
                <div className="text-center"><p className="text-violet-600 text-xs mb-1">IRPF</p><p className="font-bold text-red-600">-{formatCurrency(totals.irpf)} €</p></div>
                <div className="text-center bg-white rounded-xl p-3"><p className="text-violet-600 text-xs mb-1">TOTAL</p><p className="font-bold text-xl text-violet-700">{formatCurrency(totals.total)} €</p></div>
              </div>
            </div>

            {/* Extra Info */}
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold text-slate-900 mb-4">Información adicional</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 block mb-1">Método de pago</label>
                  <select value={codingForm.paymentMethod} onChange={(e) => setCodingForm({ ...codingForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none">
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={codingForm.isAsset} onChange={(e) => setCodingForm({ ...codingForm, isAsset: e.target.checked })} className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
                    <span className="text-sm text-slate-700">Es un activo / inventario</span>
                  </label>
                </div>
                {codingForm.isAsset && (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 block mb-1">Categoría de activo</label>
                    <input value={codingForm.assetCategory} onChange={(e) => setCodingForm({ ...codingForm, assetCategory: e.target.value })} placeholder="Ej: Equipo de cámara" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none" />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 block mb-1">Notas internas</label>
                  <textarea value={codingForm.notes} onChange={(e) => setCodingForm({ ...codingForm, notes: e.target.value })} rows={2} placeholder="Notas para el equipo de contabilidad..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none resize-none" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Normal Detail View
  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {toast && <div className="fixed top-4 right-4 z-50"><div className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white text-sm font-medium`}>{toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}{toast.message}</div></div>}
      
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <Receipt size={24} className="text-slate-400" />
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-semibold text-slate-900">{docConfig.label}</h1>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-sm font-mono">{invoice.displayNumber}</span>
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium text-sm ${config.bg} ${config.text}`}><StatusIcon size={14} />{config.label}</span>
                  {invoice.codedAt && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-100 text-violet-700 rounded-lg font-medium text-sm">
                      <FileCheck size={14} />Codificada
                    </span>
                  )}
                  {invoice.poNumber && <Link href={`/project/${projectId}/accounting/pos/${invoice.poId}`} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100"><LinkIcon size={12} />PO-{invoice.poNumber}</Link>}
                </div>
                <p className="text-slate-500 text-sm mt-1">{invoice.supplier}{invoice.department && <span className="ml-2 text-slate-400">· {invoice.department}</span>}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 mr-2">
                <button onClick={() => navigateInvoice("prev")} disabled={currentIndex <= 0} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="text-xs text-slate-500 px-2">{currentIndex + 1} / {allInvoiceIds.length}</span>
                <button onClick={() => navigateInvoice("next")} disabled={currentIndex >= allInvoiceIds.length - 1} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>

              {canCode() && invoice.status !== "cancelled" && (
                <button onClick={() => setCodingMode(true)} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${invoice.codedAt ? "bg-violet-100 text-violet-700 hover:bg-violet-200" : "bg-violet-600 text-white hover:bg-violet-700"}`}>
                  <Code size={16} />
                  {invoice.codedAt ? "Editar codificación" : "Codificar"}
                </button>
              )}

              {canEdit() && <Link href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium"><Edit size={16} />Editar</Link>}
              {invoice.status === "pending" && <Link href={`/project/${projectId}/accounting/payments?invoice=${invoice.id}`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium"><CreditCard size={16} />Ir a pagar</Link>}

              <div className="relative">
                <button onClick={() => setShowActionsMenu(!showActionsMenu)} className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50"><MoreHorizontal size={18} /></button>
                {showActionsMenu && (<><div className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} /><div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1">
                  {invoice.attachmentUrl && <a href={invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" onClick={() => setShowActionsMenu(false)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"><Download size={16} className="text-slate-400" />Descargar</a>}
                  {canCancel() && <><div className="border-t border-slate-100 my-1" /><button onClick={() => { setShowCancelModal(true); setShowActionsMenu(false); }} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"><XCircle size={16} />Anular</button></>}
                </div></>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {/* Datos fiscales - Mostrar prominentemente cuando está codificada */}
        {invoice.codedAt && (
          <div className="mb-8 bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileCheck size={18} className="text-violet-600" />
                <h3 className="font-semibold text-slate-900">Datos fiscales</h3>
              </div>
              {canCode() && (
                <button onClick={() => setCodingMode(true)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                  Editar
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Nº Factura proveedor</p>
                <p className="font-mono font-semibold text-slate-900">{invoice.supplierNumber || "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Fecha factura</p>
                <p className="font-medium text-slate-900">{invoice.invoiceDate ? formatDate(invoice.invoiceDate) : "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Fecha vencimiento</p>
                <p className="font-medium text-slate-900">{invoice.dueDate ? formatDate(invoice.dueDate) : "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">CIF/NIF proveedor</p>
                <p className="font-mono font-medium text-slate-900">{invoice.supplierTaxId || "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">IBAN</p>
                <p className="font-mono text-sm text-slate-900">{invoice.supplierIban || "-"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Codificada por</p>
                <p className="text-sm text-slate-700">{invoice.codedByName} · {formatDateTime(invoice.codedAt)}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* Left: Document Preview */}
          <div className="space-y-6">
            {invoice.description && <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6"><h3 className="font-semibold text-slate-900 mb-2">Descripción</h3><p className="text-slate-700">{invoice.description}</p></div>}
            
            {/* Document Preview with actions */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Documento</h3>
                <div className="flex items-center gap-2">
                  {canEdit() && (
                    <Link 
                      href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit?replaceDoc=true`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg font-medium"
                    >
                      <RefreshCw size={12} />
                      Sustituir
                    </Link>
                  )}
                  {invoice.attachmentUrl && (
                    <a href={invoice.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">
                      <ExternalLink size={12} />
                      Abrir
                    </a>
                  )}
                </div>
              </div>
              <div className="p-4">
                {invoice.attachmentUrl ? (
                  isPDF(invoice.attachmentUrl) ? (
                    <iframe src={`${invoice.attachmentUrl}#toolbar=0`} className="w-full h-[600px] rounded-xl border border-slate-200" />
                  ) : (
                    <img src={invoice.attachmentUrl} alt="Doc" className="w-full rounded-xl border border-slate-200" />
                  )
                ) : (
                  <div className="h-[300px] bg-slate-50 rounded-xl flex flex-col items-center justify-center gap-3">
                    <FileUp size={32} className="text-slate-300" />
                    <p className="text-sm text-slate-400">Sin documento adjunto</p>
                    {canEdit() && (
                      <Link 
                        href={`/project/${projectId}/accounting/invoices/${invoice.id}/edit?addDoc=true`}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                      >
                        <FileUp size={14} />
                        Añadir documento
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>

            {invoice.notes && <div className="bg-white border border-slate-200 rounded-2xl p-6"><h3 className="font-semibold text-slate-900 mb-3">Notas</h3><p className="text-sm text-slate-600">{invoice.notes}</p></div>}
          </div>

          {/* Right: Info */}
          <div className="space-y-6">
            {/* Items FIRST */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Líneas de factura</h3>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{invoice.items.length} {invoice.items.length === 1 ? 'línea' : 'líneas'}</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
                {invoice.items.map((item, i) => (
                  <div key={i} className={`p-4 ${item.isNewItem ? "bg-amber-50/50" : ""}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-slate-900">{item.description || "Sin descripción"}</p>
                          {item.isNewItem ? (
                            <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5"><Plus size={8} />Nuevo</span>
                          ) : item.poItemIndex !== undefined && item.poItemIndex !== null ? (
                            <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-0.5"><LinkIcon size={8} />PO #{item.poItemIndex + 1}</span>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-500">{item.subAccountCode} · {item.subAccountDescription}</p>
                      </div>
                      <p className="font-bold text-slate-900">{formatCurrency(item.baseAmount)} €</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      {item.vatRate > 0 && <span>IVA {item.vatRate}%</span>}
                      {item.irpfRate > 0 && <span className="text-red-500">IRPF {item.irpfRate}%</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Summary AFTER items */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Resumen</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><span className="text-slate-500">Base imponible</span><span className="font-medium">{formatCurrency(invoice.baseAmount)} €</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">IVA</span><span className="font-medium text-emerald-600">+{formatCurrency(invoice.vatAmount)} €</span></div>
                {invoice.irpfAmount > 0 && <div className="flex justify-between text-sm"><span className="text-slate-500">IRPF</span><span className="font-medium text-red-600">-{formatCurrency(invoice.irpfAmount)} €</span></div>}
                <div className="pt-3 border-t border-slate-200 flex justify-between"><span className="font-medium">Total</span><span className="text-xl font-bold">{formatCurrency(invoice.totalAmount)} €</span></div>
              </div>
            </div>

            {/* Coding Status - Only show if NOT coded yet */}
            {!invoice.codedAt && canCode() && invoice.status !== "cancelled" ? (
              <button 
                onClick={() => setCodingMode(true)} 
                className="w-full bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-violet-100 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                  <Code size={20} className="text-violet-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-violet-900">Codificar factura</p>
                  <p className="text-xs text-violet-700">Añadir datos fiscales y contables</p>
                </div>
                <ChevronRight size={20} className="text-violet-400" />
              </button>
            ) : !invoice.codedAt && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                  <Clock size={16} className="text-slate-400" />
                </div>
                <div>
                  <p className="font-medium text-slate-700">Pendiente de codificación</p>
                  <p className="text-xs text-slate-500">Por asignar a contabilidad</p>
                </div>
              </div>
            )}

            {/* Payments Section */}
            {(invoice.status === "paid" || payments.length > 0) && (
              <div className={`border rounded-2xl p-5 ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <CreditCard size={18} className={payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-600" : "text-amber-600"} />
                    <span className={`font-semibold ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-900" : "text-amber-900"}`}>
                      {payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "Pagada completamente" : "Pago parcial"}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-bold ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-700" : "text-amber-700"}`}>
                      {formatCurrency(payments.reduce((sum, p) => sum + p.amount, 0))} €
                    </p>
                    {payments.reduce((sum, p) => sum + p.amount, 0) < invoice.totalAmount * 0.99 && (
                      <p className="text-xs text-amber-600">de {formatCurrency(invoice.totalAmount)} € ({Math.round((payments.reduce((sum, p) => sum + p.amount, 0) / invoice.totalAmount) * 100)}%)</p>
                    )}
                  </div>
                </div>

                {/* Progress bar for partial payments */}
                {payments.reduce((sum, p) => sum + p.amount, 0) < invoice.totalAmount * 0.99 && (
                  <div className="w-full h-2 bg-amber-100 rounded-full overflow-hidden mb-4">
                    <div className="h-full bg-amber-500 rounded-full transition-all" style={{ width: `${Math.min(100, (payments.reduce((sum, p) => sum + p.amount, 0) / invoice.totalAmount) * 100)}%` }} />
                  </div>
                )}

                {/* Individual payments */}
                {payments.length > 0 && (
                  <div className="space-y-2">
                    <p className={`text-xs font-medium mb-2 ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-700" : "text-amber-700"}`}>
                      Pagos realizados ({payments.length})
                    </p>
                    {payments.map((payment) => (
                      <div key={payment.id} className="bg-white rounded-xl p-3 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "bg-emerald-100" : "bg-amber-100"}`}>
                          <CheckCircle size={14} className={payments.reduce((sum, p) => sum + p.amount, 0) >= invoice.totalAmount * 0.99 ? "text-emerald-600" : "text-amber-600"} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{payment.forecastName}</p>
                          <p className="text-xs text-slate-500">{formatDate(payment.paidAt)} · {payment.paidByName}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900">{formatCurrency(payment.amount)} €</p>
                          {payment.receiptUrl && (
                            <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center justify-end gap-1">
                              <FileText size={10} />Justificante
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {payments.length === 0 && invoice.paidAt && (
                  <div className="bg-white rounded-xl p-3 flex items-center gap-3">
                    <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                      <CheckCircle size={14} className="text-emerald-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{formatCurrency(invoice.paidAmount || invoice.totalAmount)} €</p>
                      <p className="text-xs text-slate-500">Pagado el {formatDate(invoice.paidAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Pending Replacement Alert */}
            {invoice.requiresReplacement && invoice.status === "paid" && !invoice.replacedByInvoiceId && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <AlertTriangle size={20} className="text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900">Pendiente de factura definitiva</p>
                    <p className="text-sm text-amber-700 mt-1">Este documento ha sido pagado. Recuerda subir la factura definitiva del proveedor.</p>
                    <Link
                      href={`/project/${projectId}/accounting/invoices/new?linkTo=${invoice.id}`}
                      className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 transition-colors"
                    >
                      <FileUp size={16} />
                      Subir factura definitiva
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Linked PO */}
            {linkedPO && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <LinkIcon size={16} className="text-indigo-600" />
                    <span className="font-semibold text-indigo-900">PO-{linkedPO.number}</span>
                  </div>
                  <Link href={`/project/${projectId}/accounting/pos/${linkedPO.id}`} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1">Ver PO <ExternalLink size={10} /></Link>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="text-indigo-600 text-xs">Base</p>
                    <p className="font-medium text-slate-900">{formatCurrency(linkedPO.baseAmount)} €</p>
                  </div>
                  <div>
                    <p className="text-indigo-600 text-xs">Facturado</p>
                    <p className="font-medium text-slate-900">{formatCurrency(linkedPO.invoicedAmount)} €</p>
                  </div>
                  <div className="flex-1">
                    <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, (linkedPO.invoicedAmount / linkedPO.baseAmount) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs text-indigo-600 font-medium">{Math.round((linkedPO.invoicedAmount / linkedPO.baseAmount) * 100)}%</span>
                </div>
              </div>
            )}

            {/* Details - More compact */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Detalles</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Proveedor</p>
                    <p className="font-medium">{invoice.supplier}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-amber-500" />
                  <div>
                    <p className="text-xs text-slate-500">Vencimiento</p>
                    <p className="font-medium">{formatDate(invoice.dueDate)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Creado por</p>
                    <p className="font-medium">{invoice.createdByName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  <div>
                    <p className="text-xs text-slate-500">Fecha creación</p>
                    <p className="font-medium">{formatDate(invoice.createdAt)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Cancellation Info */}
            {invoice.status === "cancelled" && invoice.cancellationReason && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Ban size={16} className="text-red-600" />
                  <span className="font-semibold text-red-900">Anulada</span>
                </div>
                <p className="text-sm text-red-700">{invoice.cancellationReason}</p>
                <p className="text-xs text-red-500 mt-2">{invoice.cancelledByName} · {formatDateTime(invoice.cancelledAt!)}</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCancelModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><XCircle size={20} className="text-red-600" /></div>
              <div><h3 className="text-lg font-semibold">Anular {invoice.displayNumber}</h3><p className="text-xs text-slate-500">Esta acción no se puede deshacer</p></div>
            </div>
            <div className="p-6">
              <div className="mb-4"><label className="block text-sm font-medium text-slate-700 mb-2">Motivo *</label><textarea value={cancellationReason} onChange={(e) => setCancellationReason(e.target.value)} rows={3} className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-slate-900 outline-none" /></div>
              <div className="mb-6"><label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2"><KeyRound size={14} />Contraseña</label><input type="password" value={passwordInput} onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }} className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 focus:ring-slate-900 outline-none ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"}`} />{passwordError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}</div>
              <div className="flex gap-3"><button onClick={() => { setShowCancelModal(false); setPasswordInput(""); setCancellationReason(""); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button><button onClick={handleCancelInvoice} disabled={processing || !cancellationReason.trim() || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium disabled:opacity-50">{processing ? "Anulando..." : "Anular"}</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
