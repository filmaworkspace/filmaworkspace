"use client";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useCallback } from "react";
import { syncBudget } from "@/lib/ledgerClient";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { Button, Field, Input, Modal } from "@/components/ds";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock,
  Download,
  Euro,
  ExternalLink,
  FileCheck,
  FileText,
  FileUp,
  Info,
  Landmark,
  PiggyBank,
  Receipt,
  Shield,
  ShieldAlert,
  Trash2,
  Undo2,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { getCostSettings, shouldRealizeInvoice, shouldRealizeOnStatusChange } from "@/lib/budgetRules";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Constants ───────────────────────────────────────────────────────────────

const PAYMENT_TYPES = {
  invoice: { label: "Factura", icon: Receipt, bgColor: "bg-emerald-50", textColor: "text-emerald-600" },
  partial: { label: "Pago parcial", icon: CircleDollarSign, bgColor: "bg-[#F7F7F8]", textColor: "text-slate-700" },
  proforma: { label: "Proforma", icon: FileText, bgColor: "bg-[#F7F7F8]", textColor: "text-slate-700" },
  budget: { label: "Presupuesto", icon: Wallet, bgColor: "bg-amber-50", textColor: "text-amber-600" },
  deposit: { label: "Depósito", icon: PiggyBank, bgColor: "bg-[#F7F7F8]", textColor: "text-slate-700" },
  guarantee: { label: "Fianza", icon: Shield, bgColor: "bg-slate-100", textColor: "text-slate-600" },
  cash_funding: { label: "Reposición de caja", icon: Wallet, bgColor: "bg-[#F7F7F8]", textColor: "text-slate-700" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

type PaymentType = keyof typeof PAYMENT_TYPES;

interface PaymentItem {
  id: string;
  type: PaymentType;
  invoiceId?: string;
  invoiceNumber?: string;
  supplier: string;
  supplierId?: string;
  description: string;
  amount: number;
  partialAmount?: number;
  addedAt: Date;
  status: "pending" | "completed";
  receiptUrl?: string;
  receiptName?: string;
  completedAt?: Date;
  completedBy?: string;
  completedByName?: string;
  iban?: string;
  bic?: string;
  attachmentUrl?: string;
}

interface PaymentForecast {
  id: string;
  name: string;
  paymentDate: Date;
  type: "remesa" | "fuera_remesa";
  status: "draft" | "pending" | "completed";
  items: PaymentItem[];
  totalAmount: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

interface BankAccount {
  id: string;
  alias: string;
  fiscalName: string;
  taxId: string;
  iban: string;
  bic?: string;
  isDefault?: boolean;
}

interface SupplierData {
  id: string;
  name: string;
  iban?: string;
  bic?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function PaymentPayPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const forecastId = params?.forecastId as string;

  const {
    loading: permissionsLoading,
    error: permissionsError,
    permissions,
  } = useAccountingPermissions(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forecast, setForecast] = useState<PaymentForecast | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankAccount, setSelectedBankAccount] = useState<BankAccount | null>(null);
  const [suppliers, setSuppliers] = useState<Record<string, SupplierData>>({});
  const [dragOver, setDragOver] = useState(false);
  const [showSepaModal, setShowSepaModal] = useState(false);
  const [sepaDate, setSepaDate] = useState(new Date().toISOString().split("T")[0]);

  // Bloquea el scroll de la página de detrás mientras el modal SEPA está abierto.
  useBodyScrollLock(showSepaModal);
  const [tempAmounts, setTempAmounts] = useState<Record<string, number>>({});
  const [itemReceipts, setItemReceipts] = useState<Record<string, { file: File; url: string }>>({});
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const bulkFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: "success" | "error" | "warning" | "info", message: string) => { if (type === "error") appToast.error(message); else appToast[type](message); };
  const formatCurrency = (a: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(a || 0);
  const formatDate = (d: Date) => d ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(d) : "-";

  useEffect(() => {
    if (!permissions.userId || !id || !forecastId || permissionsLoading) return;
    const loadData = async () => {
      try {
        const forecastSnap = await getDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId));
        if (!forecastSnap.exists()) { showToast("error", "Previsión no encontrada"); router.push(`/project/${id}/accounting/payments`); return; }
        const data = forecastSnap.data();
        const forecastData: PaymentForecast = { id: forecastSnap.id, name: data.name, paymentDate: data.paymentDate?.toDate() || new Date(), type: data.type || "remesa", status: data.status, totalAmount: data.totalAmount || 0, createdAt: data.createdAt?.toDate() || new Date(), createdBy: data.createdBy, createdByName: data.createdByName, items: (data.items || []).map((item: any) => ({ ...item, addedAt: item.addedAt?.toDate ? item.addedAt.toDate() : new Date(item.addedAt), completedAt: item.completedAt?.toDate ? item.completedAt.toDate() : undefined })) };
        setForecast(forecastData);
        const amounts: Record<string, number> = {};
        forecastData.items.forEach((item) => { amounts[item.id] = item.partialAmount || item.amount; });
        setTempAmounts(amounts);
        const firstPending = forecastData.items.find((i) => i.status === "pending");
        if (firstPending) setSelectedPaymentId(firstPending.id);
        
        const bankAccountsSnap = await getDocs(collection(db, `projects/${id}/config/company/bankAccounts`));
        const accounts = bankAccountsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as BankAccount[];
        const sortedAccounts = accounts.sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
        setBankAccounts(sortedAccounts);
        if (sortedAccounts[0]) setSelectedBankAccount(sortedAccounts.find((a) => a.isDefault) || sortedAccounts[0]);
        
        const suppliersMap: Record<string, SupplierData> = {};
        const uniqueSupplierIds = [...new Set(
          forecastData.items.filter(i => i.supplierId).map(i => i.supplierId!)
        )];
        const supplierSnaps = await Promise.all(
          uniqueSupplierIds.map(sid => getDoc(doc(db, `projects/${id}/suppliers`, sid)))
        );
        supplierSnaps.forEach((snap, idx) => {
          if (snap.exists()) {
            const sData = snap.data();
            suppliersMap[uniqueSupplierIds[idx]] = { id: snap.id, name: sData.fiscalName || sData.commercialName || sData.name, iban: (sData.bankAccount || sData.iban || "").replace(/\s+/g, ""), bic: sData.bic };
          }
        });
        setSuppliers(suppliersMap);
        setLoading(false);
      } catch (error) { console.error("Error:", error); showToast("error", "No se ha podido cargar datos"); setLoading(false); }
    };
    loadData();
  }, [permissions.userId, id, forecastId, router, permissionsLoading]);

  const pendingItems = forecast?.items.filter((i) => i.status === "pending") || [];
  const completedItems = forecast?.items.filter((i) => i.status === "completed") || [];
  const totalPending = pendingItems.reduce((sum, i) => sum + (tempAmounts[i.id] || i.partialAmount || i.amount), 0);
  const totalCompleted = completedItems.reduce((sum, i) => sum + (i.partialAmount || i.amount), 0);
  const selectedPayment = forecast?.items.find((i) => i.id === selectedPaymentId);

  const handleUploadReceipt = (itemId: string, file: File) => { const url = URL.createObjectURL(file); setItemReceipts((prev) => ({ ...prev, [itemId]: { file, url } })); showToast("success", "Justificante añadido"); };
  const handleRemoveReceipt = (itemId: string) => { setItemReceipts((prev) => { const n = { ...prev }; if (n[itemId]?.url) URL.revokeObjectURL(n[itemId].url); delete n[itemId]; return n; }); };

  const handleMarkAsPaid = async (itemIds: string[]) => {
    if (!forecast || itemIds.length === 0) return;
    const withoutReceipt = itemIds.filter((i) => !itemReceipts[i]);
    if (withoutReceipt.length > 0) { showToast("warning", `${withoutReceipt.length} pago(s) sin justificante`); return; }
    setSaving(true);
    try {
      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      
      const updatedItems = [...forecast.items];
      const newPendingItems: PaymentItem[] = [];
      
      for (const itemId of itemIds) {
        const idx = updatedItems.findIndex((i) => i.id === itemId);
        if (idx === -1) continue;
        const item = updatedItems[idx];
        const receipt = itemReceipts[itemId];
        const payingAmount = tempAmounts[itemId] || item.partialAmount || item.amount;
        const isPartialPayment = payingAmount < item.amount * 0.99;
        
        let receiptUrl = "", receiptName = "";
        if (receipt) { 
          const storageRef = ref(storage, `projects/${id}/receipts/${forecastId}/${itemId}_${receipt.file.name}`); 
          await uploadBytes(storageRef, receipt.file); 
          receiptUrl = await getDownloadURL(storageRef); 
          receiptName = receipt.file.name; 
        }
        
        // Mark current item as completed with the paid amount
        updatedItems[idx] = { 
          ...item, 
          status: "completed" as const, 
          partialAmount: payingAmount, 
          receiptUrl, 
          receiptName, 
          completedAt: new Date(), 
          completedBy: permissions.userId || "", 
          completedByName: permissions.userName 
        };
        
        // If partial payment, create a new pending item for the remaining amount
        if (isPartialPayment) {
          const remainingAmount = item.amount - payingAmount;
          const newItem: PaymentItem = {
            id: `${item.id}_remaining_${Date.now()}`,
            type: item.type,
            invoiceId: item.invoiceId,
            invoiceNumber: item.invoiceNumber,
            supplier: item.supplier,
            supplierId: item.supplierId,
            description: `${item.description} (restante)`,
            amount: remainingAmount,
            addedAt: new Date(),
            status: "pending",
            iban: item.iban,
            bic: item.bic,
            attachmentUrl: item.attachmentUrl,
          } as PaymentItem;
          newPendingItems.push(newItem);
        }
        
        // Reposición de caja de efectivo: tesorería ya ha pagado; el cajero
        // confirmará la recepción desde Cajas › Efectivo.
        if ((item as any).cashMovementId && !isPartialPayment) {
          await updateDoc(doc(db, `projects/${id}/cashMovements`, (item as any).cashMovementId), {
            treasuryPaidAt: Timestamp.now(),
            treasuryPaidByName: permissions.userName,
          });
        }

        // Update invoice status and handle budget realization
        if (item.invoiceId) {
          const newStatus = isPartialPayment ? "partial_paid" : "paid";
          
          // Obtener estado anterior de la factura
          const invoiceRef = doc(db, `projects/${id}/invoices`, item.invoiceId);
          const invoiceSnap = await getDoc(invoiceRef);
          const oldStatus = invoiceSnap.exists() ? invoiceSnap.data().status : "pending";
          
          // Actualizar estado de la factura
          await updateDoc(invoiceRef, { 
            status: newStatus, 
            paidAmount: payingAmount, 
            paidAt: Timestamp.now(), 
            paymentForecastId: forecastId 
          });
          
          // Presupuesto: se recalcula desde los documentos (lib/budgetLedger).
          await syncBudget(id);
        }
      }
      
      // Add new pending items for partial payments
      const allItems = [...updatedItems, ...newPendingItems];
      
      const allCompleted = allItems.every((item) => item.status === "completed");
      const newTotalAmount = allItems.reduce((sum, item) => sum + (item.partialAmount || item.amount), 0);
      
      await updateDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId), { 
        items: allItems.map((item) => ({ 
          ...item, 
          addedAt: item.addedAt instanceof Date ? Timestamp.fromDate(item.addedAt) : item.addedAt, 
          completedAt: item.completedAt instanceof Date ? Timestamp.fromDate(item.completedAt) : item.completedAt 
        })), 
        status: allCompleted ? "completed" : forecast.status,
        totalAmount: newTotalAmount
      });
      
      itemIds.forEach((itemId) => { if (itemReceipts[itemId]?.url) URL.revokeObjectURL(itemReceipts[itemId].url); });
      setForecast({ ...forecast, items: allItems, status: allCompleted ? "completed" : forecast.status, totalAmount: newTotalAmount });
      setItemReceipts((prev) => { const n = { ...prev }; itemIds.forEach((i) => delete n[i]); return n; });
      setTempAmounts((prev) => { const n = { ...prev }; newPendingItems.forEach((item) => { n[item.id] = item.amount; }); return n; });
      
      const nextPending = allItems.find((i) => i.status === "pending");
      setSelectedPaymentId(nextPending?.id || null);
      
      if (newPendingItems.length > 0) {
        showToast("success", `Pago parcial completado. Creado item pendiente por ${formatCurrency(newPendingItems.reduce((sum, i) => sum + i.amount, 0))} €`);
      } else {
        showToast("success", `${itemIds.length} pago(s) completado(s)`);
      }
    } catch (error) { console.error("Error:", error); showToast("error", "No se ha podido procesar pagos"); } finally { setSaving(false); }
  };

  const handleUndoPayment = async (itemId: string) => {
    if (!forecast) return;
    setSaving(true);
    try {
      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      
      let updatedItems = [...forecast.items];
      const idx = updatedItems.findIndex((i) => i.id === itemId);
      if (idx === -1) { setSaving(false); return; }
      
      const item = updatedItems[idx];
      const originalAmount = item.amount;
      
      // Check if this item has a "remaining" counterpart (was a partial payment)
      // The remaining item would have an ID like "{itemId}_remaining_*"
      const baseItemId = itemId.replace(/_remaining_\d+$/, "");
      const remainingItemIdx = updatedItems.findIndex((i) => i.id.startsWith(`${itemId}_remaining_`));
      
      // If there's a remaining item, we need to consolidate back
      if (remainingItemIdx !== -1) {
        const remainingItem = updatedItems[remainingItemIdx];
        // Restore full amount to original item
        updatedItems[idx] = { 
          ...item, 
          status: "pending" as const, 
          amount: item.amount + remainingItem.amount, // Combine amounts
          partialAmount: undefined,
          receiptUrl: undefined, 
          receiptName: undefined, 
          completedAt: undefined, 
          completedBy: undefined, 
          completedByName: undefined 
        };
        // Remove the remaining item
        updatedItems = updatedItems.filter((_, i) => i !== remainingItemIdx);
      } else {
        // Simple undo - just reset to pending
        updatedItems[idx] = { 
          ...item, 
          status: "pending" as const, 
          partialAmount: undefined,
          receiptUrl: undefined, 
          receiptName: undefined, 
          completedAt: undefined, 
          completedBy: undefined, 
          completedByName: undefined 
        };
      }
      
      // Update invoice status back to pending if it was paid
      if (item.invoiceId) {
        try {
          // Check if invoice exists first
          const invoiceRef = doc(db, `projects/${id}/invoices`, item.invoiceId);
          const invoiceSnap = await getDoc(invoiceRef);
          
          if (invoiceSnap.exists()) {
            const invoiceData = invoiceSnap.data();
            const oldStatus = invoiceData.status;
            
            // Check if there are other completed payments for this invoice
            const otherPaymentsForInvoice = updatedItems.filter(
              (i) => i.invoiceId === item.invoiceId && i.status === "completed" && i.id !== itemId
            );
            
            let newStatus: string;
            if (otherPaymentsForInvoice.length > 0) {
              // There are still other payments, calculate total paid
              const totalPaid = otherPaymentsForInvoice.reduce((sum, i) => sum + (i.partialAmount || i.amount), 0);
              newStatus = "partial_paid";
              await updateDoc(invoiceRef, { 
                status: newStatus, 
                paidAmount: totalPaid
              });
            } else {
              // No other payments, reset to pending
              newStatus = "pending";
              await updateDoc(invoiceRef, { 
                status: newStatus, 
                paidAmount: 0, 
                paidAt: null, 
                paymentForecastId: null 
              });
            }
            
            await syncBudget(id);
          }
        } catch (invoiceError) {
          console.warn("Could not update invoice:", invoiceError);
          // Continue with forecast update even if invoice update fails
        }
      }
      
      const newTotalAmount = updatedItems.reduce((sum, it) => sum + (it.status === "pending" ? it.amount : (it.partialAmount || it.amount)), 0);
      
      // Update forecast
      await updateDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId), { 
        items: updatedItems.map((it) => ({ 
          ...it, 
          addedAt: it.addedAt instanceof Date ? Timestamp.fromDate(it.addedAt) : it.addedAt, 
          completedAt: it.completedAt instanceof Date ? Timestamp.fromDate(it.completedAt) : it.completedAt 
        })), 
        status: "pending",
        totalAmount: newTotalAmount
      });
      
      setForecast({ ...forecast, items: updatedItems, status: "pending", totalAmount: newTotalAmount });
      setSelectedPaymentId(itemId);
      setTempAmounts((prev) => ({ ...prev, [itemId]: updatedItems[idx].amount }));
      showToast("success", "Pago deshecho correctamente");
    } catch (error) { 
      console.error("Error:", error); 
      showToast("error", "No se ha podido deshacer pago"); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleUpdateReceipt = async (itemId: string, file: File) => {
    if (!forecast) return;
    setSaving(true);
    try {
      const storageRef = ref(storage, `projects/${id}/receipts/${forecastId}/${itemId}_${file.name}`);
      await uploadBytes(storageRef, file);
      const receiptUrl = await getDownloadURL(storageRef);
      
      const updatedItems = forecast.items.map((item) => 
        item.id === itemId ? { ...item, receiptUrl, receiptName: file.name } : item
      );
      
      await updateDoc(doc(db, `projects/${id}/paymentForecasts`, forecastId), { 
        items: updatedItems.map((it) => ({ 
          ...it, 
          addedAt: it.addedAt instanceof Date ? Timestamp.fromDate(it.addedAt) : it.addedAt, 
          completedAt: it.completedAt instanceof Date ? Timestamp.fromDate(it.completedAt) : it.completedAt 
        }))
      });
      
      setForecast({ ...forecast, items: updatedItems });
      showToast("success", "Justificante actualizado");
    } catch (error) { 
      console.error("Error:", error); 
      showToast("error", "No se ha podido actualizar justificante"); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleBulkUpload = (files: FileList) => {
    if (!forecast || files.length === 0) return;
    let matched = 0;
    for (const file of Array.from(files)) { const fn = file.name.toLowerCase(); for (const item of pendingItems) { const num = item.invoiceNumber?.toLowerCase(); if (num && (fn.includes(num) || fn.includes(`fac-${num}`) || fn.includes(`fac${num}`))) { handleUploadReceipt(item.id, file); matched++; break; } } }
    if (matched === 0) showToast("warning", "Sin coincidencias"); else showToast("success", `${matched} justificante(s) añadido(s)`);
  };

  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length > 0) handleBulkUpload(e.dataTransfer.files); }, [forecast, pendingItems]);

  const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

  const generateSepaXml = () => {
    if (!forecast || !selectedBankAccount) { showToast("error", "Selecciona cuenta bancaria"); return; }
    const items = pendingItems;
    if (items.length === 0) { showToast("error", "No hay pagos"); return; }
    const noIban = items.filter((item) => { const s = item.supplierId ? suppliers[item.supplierId] : null; return !s?.iban && !item.iban; });
    if (noIban.length > 0) { showToast("error", `${noIban.length} sin IBAN`); return; }
    const total = items.reduce((sum, i) => sum + (tempAmounts[i.id] || i.partialAmount || i.amount), 0);
    const msgId = `REMESA-${forecast.id.substring(0, 8)}-${Date.now()}`;
    let txs = "";
    items.forEach((item, idx) => { const s = item.supplierId ? suppliers[item.supplierId] : null; const iban = s?.iban || item.iban || ""; const bic = s?.bic || item.bic || ""; const amt = (tempAmounts[item.id] || item.partialAmount || item.amount).toFixed(2); const r = item.invoiceNumber ? `FRA-${item.invoiceNumber}` : item.description.substring(0, 35); txs += `<CdtTrfTxInf><PmtId><EndToEndId>${msgId}-${idx + 1}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${amt}</InstdAmt></Amt>${bic ? `<CdtrAgt><FinInstnId><BIC>${bic}</BIC></FinInstnId></CdtrAgt>` : ""}<Cdtr><Nm>${escapeXml(item.supplier.substring(0, 70))}</Nm></Cdtr><CdtrAcct><Id><IBAN>${iban.replace(/\s/g, "")}</IBAN></Id></CdtrAcct><RmtInf><Ustrd>${escapeXml(r)}</Ustrd></RmtInf></CdtTrfTxInf>`; });
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn><GrpHdr><MsgId>${msgId}</MsgId><CreDtTm>${new Date().toISOString()}</CreDtTm><NbOfTxs>${items.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><InitgPty><Nm>${escapeXml(selectedBankAccount.fiscalName)}</Nm><Id><OrgId><Othr><Id>${selectedBankAccount.taxId}</Id></Othr></OrgId></Id></InitgPty></GrpHdr><PmtInf><PmtInfId>${msgId}-INFO</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${items.length}</NbOfTxs><CtrlSum>${total.toFixed(2)}</CtrlSum><PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf><ReqdExctnDt>${sepaDate}</ReqdExctnDt><Dbtr><Nm>${escapeXml(selectedBankAccount.fiscalName)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${selectedBankAccount.iban.replace(/\s/g, "")}</IBAN></Id></DbtrAcct>${selectedBankAccount.bic ? `<DbtrAgt><FinInstnId><BIC>${selectedBankAccount.bic}</BIC></FinInstnId></DbtrAgt>` : ""}<ChrgBr>SLEV</ChrgBr>${txs}</PmtInf></CstmrCdtTrfInitn></Document>`;
    const blob = new Blob([xml], { type: "application/xml" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `SEPA_${forecast.name.replace(/\s/g, "_")}_${sepaDate}.xml`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    setShowSepaModal(false); showToast("success", "SEPA generado");
  };

  const isPDF = (url?: string) => url?.toLowerCase().includes(".pdf") || url?.toLowerCase().includes("application/pdf");

  // Verificar permisos - solo accounting_extended puede acceder
  const canAccessPayments = permissions.accountingAccessLevel === "accounting_extended";

  // Loading
  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  // Acceso denegado
  if (permissionsError || !canAccessPayments) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md px-6">
          <div className="hidden">
            <ShieldAlert size={32} className="text-red-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 mb-2">Acceso restringido</h1>
          <p className="text-slate-500 mb-6">
            No tienes permisos para acceder a la gestión de pagos. Esta sección está disponible únicamente para usuarios con nivel de acceso &quot;Contabilidad ampliada&quot;.
          </p>
          <Link 
            href={`/project/${id}/accounting`} 
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
          >
            <ArrowLeft size={16} />
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  // Previsión no encontrada
  if (!forecast) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center">
          <AlertCircle size={48} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">Previsión no encontrada</p>
          <Link href={`/project/${id}/accounting/payments`} className="text-[13px] text-emerald-600 hover:underline mt-2 inline-block">Volver</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-100 ${inter.className}`}>

      {/* Header */}
      <div className="bg-white border-b border-slate-200 text-slate-900 px-5 h-[53px] flex items-center justify-between fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push(`/project/${id}/accounting/payments`)} className="p-1.5 text-slate-400 hover:bg-[#F4F4F5] hover:text-slate-900 rounded-md" title="Salir"><X size={18} /></button>
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold tracking-tight">Pagar remesa</span>
            <span className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{forecast.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-5 text-slate-500 text-[13px]">
            <span>Pendiente: <span className="font-medium text-slate-900 tabular-nums">{formatCurrency(totalPending)} €</span></span>
            <span>Completado: <span className="font-medium text-slate-900 tabular-nums">{formatCurrency(totalCompleted)} €</span></span>
          </div>
          <button onClick={() => setShowSepaModal(true)} className="flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium">
            <Download size={16} />SEPA XML
          </button>
        </div>
      </div>

      <div className="flex pt-[52px]" style={{ height: "100vh" }}>
        {/* Left: Document Preview */}
        <div className="w-1/2 bg-slate-800 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-[13px]">
              {selectedPayment
                ? `Documento: ${(selectedPayment.supplierId ? suppliers[selectedPayment.supplierId]?.name : null) || selectedPayment.supplier || "—"}`
                : "Selecciona un pago"}
            </span>
            <div className="flex items-center gap-2">
              {selectedPayment && (itemReceipts[selectedPayment.id]?.url || selectedPayment.receiptUrl) && (
                <span className="text-xs text-emerald-400 flex items-center gap-1"><FileCheck size={12} />Justificante</span>
              )}
              {(selectedPayment?.attachmentUrl || selectedPayment?.receiptUrl || (selectedPayment && itemReceipts[selectedPayment.id]?.url)) && (
                <a href={selectedPayment?.receiptUrl || itemReceipts[selectedPayment?.id || ""]?.url || selectedPayment?.attachmentUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600">
                  <ExternalLink size={16} />
                </a>
              )}
            </div>
          </div>
          <div className="flex-1 bg-slate-900 rounded-md overflow-auto flex items-center justify-center">
            {(() => {
              const previewUrl = selectedPayment && (itemReceipts[selectedPayment.id]?.url || selectedPayment.receiptUrl || selectedPayment.attachmentUrl);
              if (previewUrl) {
                return isPDF(previewUrl) ? (
                  <iframe src={`${previewUrl}#toolbar=0`} className="w-full h-full" />
                ) : (
                  <img src={previewUrl} alt="Documento" className="max-w-full max-h-full object-contain" />
                );
              } else if (selectedPayment) {
                return (
                  <div className="text-center text-slate-500">
                    <FileText size={48} className="mx-auto mb-3 opacity-50" />
                    <p>Sin documento adjunto</p>
                    <p className="text-xs mt-1">Sube el justificante a la derecha</p>
                  </div>
                );
              } else {
                return (
                  <div className="text-center text-slate-500">
                    <Banknote size={48} className="mx-auto mb-3 opacity-50" />
                    <p>Selecciona un pago de la lista</p>
                  </div>
                );
              }
            })()}
          </div>
        </div>

        {/* Right: Payment List & Form */}
        <div className="w-1/2 overflow-y-auto p-6">
          {/* Progreso de la remesa */}
          <div className="mb-5 flex items-center gap-3 text-xs text-slate-600">
            <span aria-hidden="true" className="flex h-[3px] flex-1 overflow-hidden rounded-full bg-[#F1F1F3]">
              <span className="bg-emerald-500" style={{ width: `${((totalCompleted / (totalPending + totalCompleted)) * 100) || 0}%` }} />
            </span>
            <span className="tabular-nums">{completedItems.length} de {pendingItems.length + completedItems.length} pagados</span>
          </div>

          {/* Bulk Upload */}
          {pendingItems.length > 0 && (
            <div 
              className={`mb-4 border-2 border-dashed rounded-md p-4 transition-colors ${dragOver ? "border-emerald-400 bg-emerald-50" : "border-slate-300 bg-white hover:border-slate-400"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="flex items-center justify-center gap-4 text-center">
                <FileUp size={20} className={dragOver ? "text-emerald-500" : "text-slate-400"} />
                <div>
                  <p className="text-[13px] font-medium text-slate-700">Arrastra justificantes aquí</p>
                  <p className="text-xs text-slate-500">Nombra con nº factura (FRA-001.pdf)</p>
                </div>
                <button onClick={() => bulkFileInputRef.current?.click()} className="px-3 py-1.5 text-[13px] text-emerald-600 hover:bg-emerald-50 rounded-lg font-medium">Seleccionar</button>
              </div>
              <input ref={bulkFileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files && handleBulkUpload(e.target.files)} />
            </div>
          )}

          {/* Pending Items */}
          {pendingItems.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 mb-4">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <Clock size={16} className="text-amber-500" />
                <span className="font-semibold text-slate-900 text-[13px]">Pagos pendientes</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg">{pendingItems.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {pendingItems.map((item) => {
                  const typeInfo = PAYMENT_TYPES[item.type];
                  const TypeIcon = typeInfo.icon;
                  const isSelected = selectedPaymentId === item.id;
                  const hasReceipt = !!itemReceipts[item.id];
                  const payingAmount = tempAmounts[item.id] || item.partialAmount || item.amount;
                  const enrichedSupplier = item.supplierId ? suppliers[item.supplierId] : null;
                  const supplierName = enrichedSupplier?.name || item.supplier || "—";
                  const hasIban = !!(enrichedSupplier?.iban || item.iban);

                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => setSelectedPaymentId(item.id)}
                        className={`w-full px-4 py-2 flex items-center gap-3 text-left transition-colors ${isSelected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isSelected ? "bg-emerald-100" : typeInfo.bgColor}`}>
                          <TypeIcon size={14} className={isSelected ? "text-emerald-600" : typeInfo.textColor} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900 text-[13px]">{supplierName}</span>
                            {item.invoiceNumber && <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">FRA-{item.invoiceNumber}</span>}
                            {!hasIban && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Sin IBAN</span>}
                          </div>
                          <p className="text-xs text-slate-500 truncate">{item.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-slate-900 text-[13px]">{formatCurrency(payingAmount)} €</p>
                          {payingAmount < item.amount && <p className="text-[10px] text-amber-600">Parcial</p>}
                        </div>
                        {hasReceipt ? <CheckCircle size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-slate-300" />}
                      </button>

                      {isSelected && (
                        <div className="px-4 pb-4 bg-emerald-50 border-t border-emerald-100">
                          <div className="bg-white rounded-md p-4 mt-3 space-y-4">
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-2">Importe a pagar</label>
                              <div className="flex items-center gap-3">
                                <div className="relative flex-1 max-w-[180px]">
                                  <input type="number" step="0.01" min="0.01" max={item.amount} value={tempAmounts[item.id] || item.amount} onChange={(e) => setTempAmounts((prev) => ({ ...prev, [item.id]: Math.min(parseFloat(e.target.value) || 0, item.amount) }))} className="w-full px-2.5 py-1.5 pr-8 border border-slate-200 rounded-lg text-[13px] focus:ring-4 focus:ring-emerald-500 focus:outline-none" />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]">€</span>
                                </div>
                                <span className="text-xs text-slate-500">de {formatCurrency(item.amount)} €</span>
                                {payingAmount < item.amount && <button onClick={() => setTempAmounts((prev) => ({ ...prev, [item.id]: item.amount }))} className="text-xs text-emerald-600 hover:underline">Pagar todo</button>}
                              </div>
                              {payingAmount < item.amount && <p className="text-xs text-amber-600 mt-2 flex items-center gap-1"><Info size={12} />Pago parcial: quedarán {formatCurrency(item.amount - payingAmount)} € pendientes</p>}
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-2">Justificante <span className="text-red-500">*</span></label>
                              {hasReceipt ? (
                                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                                  <FileCheck size={18} className="text-emerald-600" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-slate-900 truncate">{itemReceipts[item.id].file.name}</p>
                                    <p className="text-xs text-slate-500">{(itemReceipts[item.id].file.size / 1024).toFixed(1)} KB</p>
                                  </div>
                                  <a href={itemReceipts[item.id].url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-emerald-100 rounded-lg"><ExternalLink size={14} className="text-emerald-600" /></a>
                                  <button aria-label="Eliminar" onClick={() => handleRemoveReceipt(item.id)} className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={14} /></button>
                                </div>
                              ) : (
                                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 rounded-md cursor-pointer hover:border-emerald-300 hover:bg-emerald-50">
                                  <Upload size={18} className="text-slate-400" />
                                  <span className="text-[13px] text-slate-600">Subir justificante</span>
                                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadReceipt(item.id, f); }} />
                                </label>
                              )}
                            </div>

                            <button onClick={() => handleMarkAsPaid([item.id])} disabled={!hasReceipt || saving} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle size={16} />}
                              Marcar como pagado
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Items */}
          {completedItems.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="font-semibold text-slate-900 text-[13px]">Completados</span>
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg">{completedItems.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {completedItems.map((item) => {
                  const isSelected = selectedPaymentId === item.id;
                  const isPartialPayment = item.partialAmount && item.partialAmount < item.amount;
                  const enrichedSupplierC = item.supplierId ? suppliers[item.supplierId] : null;
                  const supplierNameC = enrichedSupplierC?.name || item.supplier || "—";

                  return (
                    <div key={item.id}>
                      <button
                        onClick={() => setSelectedPaymentId(isSelected ? null : item.id)}
                        className={`w-full px-4 py-2 flex items-center gap-3 text-left transition-colors ${isSelected ? "bg-slate-50" : "hover:bg-slate-50"}`}
                      >
                        <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <CheckCircle2 size={14} className="text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900 text-[13px]">{supplierNameC}</span>
                            {item.invoiceNumber && <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">FRA-{item.invoiceNumber}</span>}
                            {isPartialPayment && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Parcial</span>}
                          </div>
                          <p className="text-xs text-slate-500">{item.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-emerald-600 text-[13px]">{formatCurrency(item.partialAmount || item.amount)} €</p>
                          {isPartialPayment && <p className="text-[10px] text-amber-600">de {formatCurrency(item.amount)} €</p>}
                          {item.completedAt && !isPartialPayment && <p className="text-[10px] text-slate-400">{formatDate(item.completedAt)}</p>}
                        </div>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform ${isSelected ? "rotate-180" : ""}`} />
                      </button>

                      {isSelected && (
                        <div className="px-4 pb-4 bg-slate-50 border-t border-slate-100">
                          <div className="bg-white rounded-md p-4 mt-3 space-y-4">
                            {/* Info */}
                            <div className="grid grid-cols-2 gap-4 text-[13px]">
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Pagado el</p>
                                <p className="font-medium">{item.completedAt ? formatDate(item.completedAt) : "-"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Por</p>
                                <p className="font-medium">{item.completedByName || "-"}</p>
                              </div>
                              {isPartialPayment && (
                                <>
                                  <div>
                                    <p className="text-xs text-slate-500 mb-1">Importe pagado</p>
                                    <p className="font-medium text-emerald-600">{formatCurrency(item.partialAmount!)} €</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-slate-500 mb-1">Pendiente restante</p>
                                    <p className="font-medium text-amber-600">{formatCurrency(item.amount - item.partialAmount!)} €</p>
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Receipt */}
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-2">Justificante</label>
                              {item.receiptUrl ? (
                                <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                                  <FileCheck size={18} className="text-emerald-600" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-medium text-slate-900 truncate">{item.receiptName || "Justificante"}</p>
                                  </div>
                                  <a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:bg-emerald-100 rounded-lg">
                                    <ExternalLink size={14} className="text-emerald-600" />
                                  </a>
                                  <label className="p-1.5 hover:bg-emerald-100 rounded-lg cursor-pointer" title="Cambiar justificante">
                                    <Upload size={14} className="text-emerald-600" />
                                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpdateReceipt(item.id, f); }} />
                                  </label>
                                </div>
                              ) : (
                                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 rounded-md cursor-pointer hover:border-emerald-300 hover:bg-emerald-50">
                                  <Upload size={18} className="text-slate-400" />
                                  <span className="text-[13px] text-slate-600">Añadir justificante</span>
                                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpdateReceipt(item.id, f); }} />
                                </label>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2 border-t border-slate-100">
                              <button
                                onClick={() => handleUndoPayment(item.id)}
                                disabled={saving}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-1.5 border border-red-200 text-red-600 rounded-md text-[13px] font-medium hover:bg-red-50 disabled:opacity-50"
                              >
                                <Undo2 size={14} />
                                Deshacer pago
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pendingItems.length === 0 && completedItems.length > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-6 text-center mt-4">
              <CheckCircle2 size={32} className="text-emerald-600 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-emerald-900">¡Todos los pagos completados!</h3>
              <p className="text-emerald-700 text-[13px] mt-1">Remesa procesada correctamente</p>
            </div>
          )}

          {forecast.items.length === 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
              <Banknote size={32} className="text-slate-300 mx-auto mb-3" />
              <h3 className="text-[14px] font-semibold text-slate-900 mb-2">Sin pagos</h3>
              <p className="text-slate-500 text-[13px]">Esta previsión no tiene pagos</p>
            </div>
          )}
        </div>
      </div>

      {/* Fichero SEPA (pain.001.001.03) */}
      <Modal
        open={showSepaModal}
        onClose={() => setShowSepaModal(false)}
        title="Generar fichero SEPA"
        width="max-w-lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSepaModal(false)}>Cancelar</Button>
            <Button variant="primary" onClick={generateSepaXml} disabled={!selectedBankAccount}><Download size={13} /> Descargar XML</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-[13px]">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Cuenta ordenante</p>
            {bankAccounts.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                {bankAccounts.map((acc) => (
                  <label key={acc.id} className={`flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-0 ${selectedBankAccount?.id === acc.id ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                    <input type="radio" name="bankAccount" checked={selectedBankAccount?.id === acc.id} onChange={() => setSelectedBankAccount(acc)} className="h-3.5 w-3.5 accent-slate-900" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-slate-900">{acc.alias}</span>
                      {acc.isDefault && <span className="ml-2 text-xs text-slate-400">principal</span>}
                      <span className="block font-mono text-xs text-slate-500">{acc.iban.replace(/(.{4})/g, "$1 ").trim()}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2.5 text-xs text-amber-900">No hay cuentas bancarias. Añádelas en Configuración de contabilidad.</p>
            )}
          </div>
          <Field label="Fecha de ejecución"><Input type="date" value={sepaDate} onChange={(e) => setSepaDate(e.target.value)} /></Field>
          <div className="flex items-baseline justify-between rounded-md border border-slate-200 px-3 py-2.5">
            <span className="text-slate-600">{pendingItems.length} {pendingItems.length === 1 ? "pago" : "pagos"}</span>
            <span className="tabular-nums font-semibold">{formatCurrency(totalPending)} €</span>
          </div>
          {(() => {
            const missing = pendingItems.filter((item) => {
              const sup = item.supplierId ? suppliers[item.supplierId] : null;
              return !sup?.iban && !item.iban;
            });
            if (missing.length === 0) return null;
            return (
              <div className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2.5 text-xs text-amber-900">
                <p className="font-medium">{missing.length} {missing.length === 1 ? "pago sin IBAN" : "pagos sin IBAN"}: no entrarán en el fichero.</p>
                <p className="mt-1">{missing.map((item) => (item.supplierId ? suppliers[item.supplierId]?.name : null) || item.supplier || "—").join(" · ")}</p>
                <p className="mt-1 text-amber-800">Añade el IBAN en la ficha del proveedor.</p>
              </div>
            );
          })()}
        </div>
      </Modal>
    </div>
  );
}
