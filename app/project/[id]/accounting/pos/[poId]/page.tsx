"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc, getDoc, collection, getDocs, updateDoc, deleteDoc, query, where, orderBy, Timestamp } from "firebase/firestore";
import { FileText, ArrowLeft, Edit, Download, Receipt, Lock, Unlock, XCircle, CheckCircle, Clock, Ban, Archive, Building2, Calendar, User, Hash, FileUp, ChevronLeft, ChevronRight, AlertTriangle, KeyRound, AlertCircle, ShieldAlert, FileEdit, ExternalLink, MoreHorizontal, Layers, BookCheck, Wallet, Info, Trash2, Upload, Glasses, Check, X, MessageSquare, PenLine } from "lucide-react";
import jsPDF from "jspdf";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { getCostSettings, shouldCommitPO } from "@/lib/budgetRules";
import { uncommitPO, closePoItem, reopenPoItem } from "@/lib/budgetOperations";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
type POStatus = "draft" | "pending" | "approved" | "rejected" | "closed" | "cancelled";

interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

interface POItem {
  description: string;
  subAccountId: string;
  subAccountCode: string;
  subAccountDescription: string;
  quantity: number;
  unitPrice: number;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  invoicedAmount?: number;
  isClosed?: boolean;
  closedAt?: Date;
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface Invoice {
  id: string;
  number: string;
  supplier: string;
  totalAmount: number;
  status: string;
  createdAt: Date;
}

interface ApprovalStepStatus {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers: string[];
  approverNames?: string[];
  roles?: string[];
  department?: string;
  approvedBy: string[];
  approvedByNames?: string[];
  rejectedBy: string[];
  status: "pending" | "approved" | "rejected";
  requireAll: boolean;
  approvedAt?: Date;
}

interface ApprovalComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: Date;
  type: "approval" | "rejection" | "info_request" | "comment";
  stepOrder?: number;
}

interface ModificationEntry {
  date: any;
  userId: string;
  userName: string;
  reason: string;
  previousVersion: number;
}

interface PO {
  id: string;
  number: string;
  version: number;
  supplier: string;
  supplierId: string;
  department?: string;
  poType: string;
  currency: string;
  generalDescription: string;
  paymentTerms?: string;
  notes?: string;
  items: POItem[];
  baseAmount: number;
  vatAmount: number;
  irpfAmount: number;
  totalAmount: number;
  committedAmount: number;
  invoicedAmount: number;
  remainingAmount?: number;
  status: POStatus;
  attachmentUrl?: string;
  attachmentFileName?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  approvedAt?: Date;
  approvedBy?: string;
  approvedByName?: string;
  closedAt?: Date;
  cancelledAt?: Date;
  cancelledByName?: string;
  cancellationReason?: string;
  modificationHistory?: ModificationEntry[];
  approvalSteps?: ApprovalStepStatus[];
  currentApprovalStep?: number;
  comments?: ApprovalComment[];
}

const STATUS_CONFIG: Record<POStatus, { bg: string; text: string; label: string; icon: typeof Clock; gradient: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit, gradient: "from-slate-500 to-slate-600" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente", icon: Clock, gradient: "from-amber-500 to-orange-500" },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada", icon: CheckCircle, gradient: "from-emerald-500 to-teal-500" },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada", icon: XCircle, gradient: "from-red-500 to-rose-500" },
  closed: { bg: "bg-blue-50", text: "text-blue-700", label: "Cerrada", icon: Archive, gradient: "from-blue-500 to-indigo-500" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", label: "Anulada", icon: Ban, gradient: "from-red-500 to-rose-500" },
};

export default function PODetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const poId = params?.poId as string;

  const { loading: permissionsLoading, error: permissionsError, permissions, canViewPO, canEditPO, getPOPermissions } = useAccountingPermissions(projectId);

  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [po, setPO] = useState<PO | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allPOIds, setAllPOIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [showCloseItemModal, setShowCloseItemModal] = useState<number | null>(null);
  const [showReopenItemModal, setShowReopenItemModal] = useState<number | null>(null);
  const [showItemInfoPopover, setShowItemInfoPopover] = useState<number | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [cancellationReason, setCancellationReason] = useState("");
  const [modificationReason, setModificationReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showApprovalNoteModal, setShowApprovalNoteModal] = useState<ApprovalComment | null>(null);

  useEffect(() => {
    if (projectId && poId && !permissionsLoading) loadData();
  }, [projectId, poId, permissionsLoading]);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      const poDoc = await getDoc(doc(db, `projects/${projectId}/pos`, poId));
      if (!poDoc.exists()) {
        router.push(`/project/${projectId}/accounting/pos`);
        return;
      }

      const poData = {
        id: poDoc.id,
        ...poDoc.data(),
        createdAt: poDoc.data().createdAt?.toDate(),
        approvedAt: poDoc.data().approvedAt?.toDate(),
        closedAt: poDoc.data().closedAt?.toDate(),
        cancelledAt: poDoc.data().cancelledAt?.toDate(),
        version: poDoc.data().version || 1,
        committedAmount: poDoc.data().committedAmount || 0,
        invoicedAmount: poDoc.data().invoicedAmount || 0,
        remainingAmount: poDoc.data().remainingAmount || 0,
        items: poDoc.data().items || [],
        modificationHistory: poDoc.data().modificationHistory || [],
        approvalSteps: (poDoc.data().approvalSteps || []).map((step: any) => ({
          ...step,
          approvedAt: step.approvedAt?.toDate?.() || null,
          approvedByNames: step.approvedByNames || [],
        })),
        currentApprovalStep: poDoc.data().currentApprovalStep ?? null,
        comments: (poDoc.data().comments || []).map((c: any) => ({
          ...c,
          createdAt: c.createdAt?.toDate?.() || new Date(),
        })),
      } as PO;

      if (!canViewPO(poData)) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }
      setPO(poData);

      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${projectId}/invoices`), where("poId", "==", poId)));
      setInvoices(invoicesSnapshot.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() } as Invoice)));

      const posSnapshot = await getDocs(query(collection(db, `projects/${projectId}/pos`), orderBy("createdAt", "asc")));
      const ids = posSnapshot.docs.map((d) => d.id);
      setAllPOIds(ids);
      setCurrentIndex(ids.indexOf(poId));
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  };

  const verifyPassword = async (): Promise<boolean> => {
    if (!passwordInput.trim()) {
      setPasswordError("Introduce tu contraseña");
      return false;
    }
    const user = auth.currentUser;
    if (!user || !user.email) {
      setPasswordError("No hay usuario autenticado");
      return false;
    }
    try {
      const credential = EmailAuthProvider.credential(user.email, passwordInput);
      await reauthenticateWithCredential(user, credential);
      setPasswordError("");
      return true;
    } catch (error: any) {
      setPasswordError(error.code === "auth/wrong-password" || error.code === "auth/invalid-credential" ? "Contraseña incorrecta" : "Error de autenticación");
      return false;
    }
  };

  const resetModals = () => {
    setPasswordInput("");
    setPasswordError("");
    setCancellationReason("");
    setModificationReason("");
  };

  // Función para eliminar borrador (solo si es versión 1 y status draft)
  const handleDeleteDraft = async () => {
    if (!po || po.status !== "draft" || (po.version && po.version > 1)) return;
    
    setProcessing(true);
    try {
      await deleteDoc(doc(db, `projects/${projectId}/pos`, poId));
      router.push(`/project/${projectId}/accounting/pos`);
    } catch (error) {
      console.error("Error eliminando borrador:", error);
      setPasswordError("Error al eliminar el borrador");
    } finally {
      setProcessing(false);
    }
  };

  // Verificar si se puede eliminar (borrador sin versión anterior)
  const canDeleteDraft = po?.status === "draft" && (!po.version || po.version === 1) && poPerms.canEdit;

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  const formatDate = (date: Date) => (date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(date) : "-");
  const formatDateTime = (date: Date) => (date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-");
  const getCurrencySymbol = () => ({ EUR: "€", USD: "$", GBP: "£" }[po?.currency || "EUR"] || "€");

  const navigatePO = (direction: "prev" | "next") => {
    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < allPOIds.length) {
      router.push(`/project/${projectId}/accounting/pos/${allPOIds[newIndex]}`);
    }
  };

  const releaseRemainingCommitted = async (poToClose: PO) => {
    // Preparar items con el importe restante a liberar por cada uno
    const itemsToRelease: Array<{ subAccountId: string; baseAmount: number }> = [];
    
    for (const item of poToClose.items) {
      if (item.subAccountId && !item.isClosed) {
        const itemInvoiced = item.invoicedAmount || 0;
        const itemCommitted = item.baseAmount || 0;
        const remainingToRelease = itemCommitted - itemInvoiced;
        
        if (remainingToRelease > 0) {
          itemsToRelease.push({
            subAccountId: item.subAccountId,
            baseAmount: remainingToRelease,
          });
        }
      }
    }
    
    // Usar uncommitPO para liberar todo de una vez
    if (itemsToRelease.length > 0) {
      await uncommitPO(projectId, itemsToRelease);
    }
  };

  const restoreCommittedOnReopen = async (poToReopen: PO) => {
    // Verificar configuración - solo restaurar si la PO debería estar comprometida
    const costSettings = await getCostSettings(projectId);
    if (!shouldCommitPO("approved", costSettings)) return;
    
    // Preparar items con el importe restante a restaurar por cada uno
    const itemsToRestore: Array<{ subAccountId: string; baseAmount: number }> = [];
    
    for (const item of poToReopen.items) {
      if (item.subAccountId && !item.isClosed) {
        const itemInvoiced = item.invoicedAmount || 0;
        const itemCommitted = item.baseAmount || 0;
        const remainingToRestore = itemCommitted - itemInvoiced;
        
        if (remainingToRestore > 0) {
          itemsToRestore.push({
            subAccountId: item.subAccountId,
            baseAmount: remainingToRestore,
          });
        }
      }
    }
    
    // Usar commitPO para restaurar (importamos uncommitPO pero usamos la lógica inversa)
    if (itemsToRestore.length > 0) {
      // Restaurar = sumar a committed, así que usamos la función de budgetOperations
      const { commitPO } = await import("@/lib/budgetOperations");
      await commitPO(projectId, itemsToRestore);
    }
  };

  const handleClosePO = async () => {
    if (!po) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      await releaseRemainingCommitted(po);

      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "closed",
        closedAt: Timestamp.now(),
        closedBy: permissions.userId,
        closedByName: permissions.userName,
        remainingAmount: 0,
      });
      setShowCloseModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      alert("Error al cerrar la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleReopenPO = async () => {
    if (!po) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      await restoreCommittedOnReopen(po);

      const baseAmount = po.baseAmount || 0;
      const invoicedAmount = po.invoicedAmount || 0;

      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "approved",
        closedAt: null,
        closedBy: null,
        closedByName: null,
        remainingAmount: baseAmount - invoicedAmount,
      });
      setShowReopenModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      alert("Error al reabrir la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPO = async () => {
    if (!po || !cancellationReason.trim()) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      // Verificar si la PO estaba comprometida según la configuración
      const costSettings = await getCostSettings(projectId);
      const wasCommitted = shouldCommitPO(po.status, costSettings);
      
      // Si estaba comprometida, liberar el presupuesto
      if (wasCommitted) {
        const itemsToUncommit = po.items
          .filter(item => item.subAccountId && !item.isClosed)
          .map(item => ({
            subAccountId: item.subAccountId,
            baseAmount: (item.baseAmount || 0) - (item.invoicedAmount || 0),
          }))
          .filter(item => item.baseAmount > 0);
        
        if (itemsToUncommit.length > 0) {
          await uncommitPO(projectId, itemsToUncommit);
        }
      }
      
      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: permissions.userId,
        cancelledByName: permissions.userName,
        cancellationReason: cancellationReason.trim(),
        committedAmount: 0,
        remainingAmount: 0,
      });
      setShowCancelModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      alert("Error al anular la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseItem = async (itemIndex: number) => {
    if (!po || itemIndex < 0 || itemIndex >= po.items.length) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      const item = po.items[itemIndex];
      const itemInvoiced = item.invoicedAmount || 0;
      const itemCommitted = item.baseAmount || 0;
      const remainingToRelease = itemCommitted - itemInvoiced;

      // Liberar comprometido pendiente usando budgetOperations
      if (remainingToRelease > 0 && item.subAccountId) {
        await closePoItem(projectId, item.subAccountId, remainingToRelease);
      }

      // Actualizar el item como cerrado
      const updatedItems = [...po.items];
      updatedItems[itemIndex] = {
        ...updatedItems[itemIndex],
        isClosed: true,
        closedAt: new Date(),
      };

      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        items: updatedItems,
      });

      setShowCloseItemModal(null);
      resetModals();
      await loadData();
    } catch (error) {
      console.error("Error closing item:", error);
      alert("Error al cerrar el item");
    } finally {
      setProcessing(false);
    }
  };

  const handleReopenItem = async (itemIndex: number) => {
    if (!po || itemIndex < 0 || itemIndex >= po.items.length) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      const item = po.items[itemIndex];
      const itemInvoiced = item.invoicedAmount || 0;
      const itemCommitted = item.baseAmount || 0;
      const remainingToRestore = itemCommitted - itemInvoiced;

      // Restaurar comprometido usando budgetOperations
      if (remainingToRestore > 0 && item.subAccountId) {
        await reopenPoItem(projectId, item.subAccountId, remainingToRestore);
      }

      // Actualizar el item como abierto
      const updatedItems = [...po.items];
      updatedItems[itemIndex] = {
        ...updatedItems[itemIndex],
        isClosed: false,
        closedAt: undefined,
      };

      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        items: updatedItems,
      });

      setShowReopenItemModal(null);
      resetModals();
      await loadData();
    } catch (error) {
      console.error("Error reopening item:", error);
      alert("Error al reabrir el item");
    } finally {
      setProcessing(false);
    }
  };

  const handleModifyPO = async () => {
    if (!po || !modificationReason.trim()) return;
    setProcessing(true);
    try {
      const newVersion = (po.version || 1) + 1;
      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        version: newVersion,
        status: "draft",
        modificationHistory: [
          ...(po.modificationHistory || []),
          {
            date: Timestamp.now(),
            userId: permissions.userId || "",
            userName: permissions.userName,
            reason: modificationReason.trim(),
            previousVersion: po.version || 1,
          },
        ],
        approvedAt: null,
        approvedBy: null,
        approvedByName: null,
        approvalSteps: null,
        currentApprovalStep: null,
      });
      setShowModifyModal(false);
      router.push(`/project/${projectId}/accounting/pos/${po.id}/edit`);
    } catch (error) {
      alert("Error al modificar la PO");
    } finally {
      setProcessing(false);
    }
  };

  const generatePDF = () => {
    if (!po) return;
    const pdf = new jsPDF("p", "mm", "a4");
    const margin = 20;
    let y = margin;
    pdf.setFillColor(30, 41, 59);
    pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), 45, "F");
    pdf.setTextColor(255);
    pdf.setFontSize(24);
    pdf.setFont("helvetica", "bold");
    pdf.text("ORDEN DE COMPRA", margin, 20);
    pdf.setFontSize(32);
    pdf.text("PO-" + po.number, margin, 35);
    if (po.version > 1) {
      pdf.setFontSize(12);
      pdf.text("V" + String(po.version).padStart(2, "0"), margin + pdf.getTextWidth("PO-" + po.number) + 5, 35);
    }
    y = 55;
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin, y, pdf.internal.pageSize.getWidth() - margin * 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.text("PROVEEDOR", margin + 5, y + 8);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(12);
    pdf.text(po.supplier, margin + 5, y + 18);
    y += 35;
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin, y, pdf.internal.pageSize.getWidth() - margin * 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.text("IMPORTE TOTAL", margin + 5, y + 8);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(16);
    pdf.text(formatCurrency(po.totalAmount) + " " + getCurrencySymbol(), margin + 5, y + 18);
    y += 35;
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    pdf.text("ITEMS (" + po.items.length + ")", margin, y);
    y += 8;
    po.items.forEach((item, index) => {
      pdf.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
      pdf.roundedRect(margin, y, pdf.internal.pageSize.getWidth() - margin * 2, 12, 0, 0, "F");
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text((item.description || "").substring(0, 50), margin + 5, y + 8);
      pdf.setFont("helvetica", "bold");
      pdf.text(formatCurrency(item.totalAmount) + " " + getCurrencySymbol(), pdf.internal.pageSize.getWidth() - margin - 25, y + 8);
      y += 12;
    });
    y += 10;
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.text("Generado el " + formatDateTime(new Date()), margin, y);
    pdf.save("PO-" + po.number + (po.version > 1 ? "-V" + String(po.version).padStart(2, "0") : "") + ".pdf");
  };

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || accessDenied) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para ver esta orden de compra"}</p>
          <Link href={`/project/${projectId}/accounting/pos`} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
            <ArrowLeft size={16} />
            Volver a POs
          </Link>
        </div>
      </div>
    );
  }

  if (!po) return null;

  const poPerms = getPOPermissions(po);
  const config = STATUS_CONFIG[po.status];
  const Icon = config.icon;
  const remainingAmount = po.baseAmount - po.invoicedAmount;
  const invoiceProgress = po.baseAmount > 0 ? Math.min(100, (po.invoicedAmount / po.baseAmount) * 100) : 0;

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-slate-400" />
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold text-slate-900">Orden de compra</h1>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-sm font-mono font-medium">
                    PO-{po.number}
                  </span>
                  {po.version > 1 && (
                    <span className="px-2 py-1 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium">
                      V{String(po.version).padStart(2, "0")}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium text-sm ${config.bg} ${config.text}`}>
                    <Icon size={14} />
                    {config.label}
                  </span>
                </div>
                <p className="text-slate-500 text-sm mt-1">
                  {po.supplier}
                  {po.department && <span className="ml-2 text-slate-400">· {po.department}</span>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Navegación entre POs */}
              <div className="flex items-center gap-1 mr-2">
                <button onClick={() => navigatePO("prev")} disabled={currentIndex <= 0} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs text-slate-500 px-2">{currentIndex + 1} / {allPOIds.length}</span>
                <button onClick={() => navigatePO("next")} disabled={currentIndex >= allPOIds.length - 1} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30">
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Botón principal según estado */}
              {po.status === "draft" && poPerms.canEdit && (
                <Link href={`/project/${projectId}/accounting/pos/${po.id}/edit`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium">
                  <Edit size={16} />
                  Editar
                </Link>
              )}
              {po.status === "approved" && (
                <Link href={`/project/${projectId}/accounting/invoices/new?poId=${po.id}`} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium">
                  <Upload size={16} />
                  Subir factura
                </Link>
              )}
              {po.status === "closed" && poPerms.canReopen && (
                <button onClick={() => { resetModals(); setShowReopenModal(true); }} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 text-sm font-medium">
                  <Unlock size={16} />
                  Reabrir
                </button>
              )}

              {/* Menú de acciones */}
              <div className="relative">
                <button 
                  onClick={() => setShowActionsMenu(!showActionsMenu)} 
                  className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
                >
                  <MoreHorizontal size={18} />
                </button>
                
                {showActionsMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 animate-fadeIn">
                      {/* Descargar PDF - Siempre visible */}
                      <button 
                        onClick={() => { generatePDF(); setShowActionsMenu(false); }} 
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                      >
                        <Download size={16} className="text-slate-400" />
                        Descargar PDF
                      </button>

                      {/* Acciones para estado Aprobada */}
                      {po.status === "approved" && (
                        <>
                          <div className="border-t border-slate-100 my-1" />
                          {permissions.isProjectRole && (
                            <button 
                              onClick={() => { resetModals(); setShowModifyModal(true); setShowActionsMenu(false); }} 
                              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                            >
                              <FileEdit size={16} className="text-slate-400" />
                              Modificar PO
                            </button>
                          )}
                          {poPerms.canClose && (
                            <button 
                              onClick={() => { resetModals(); setShowCloseModal(true); setShowActionsMenu(false); }} 
                              className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                            >
                              <Lock size={16} className="text-slate-400" />
                              Cerrar PO
                            </button>
                          )}
                          {poPerms.canCancel && (
                            <>
                              <div className="border-t border-slate-100 my-1" />
                              <button 
                                onClick={() => { resetModals(); setShowCancelModal(true); setShowActionsMenu(false); }} 
                                className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                              >
                                <XCircle size={16} className="text-red-400" />
                                Anular PO
                              </button>
                            </>
                          )}
                        </>
                      )}

                      {/* Opción de eliminar para borradores sin versión anterior */}
                      {canDeleteDraft && (
                        <>
                          <div className="border-t border-slate-100 my-1" />
                          <button 
                            onClick={() => { setShowDeleteModal(true); setShowActionsMenu(false); }} 
                            className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                          >
                            <Trash2 size={16} className="text-red-400" />
                            Eliminar borrador
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {po.generalDescription && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-semibold text-slate-900 mb-3">Descripción</h3>
                <p className="text-slate-600">{po.generalDescription}</p>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Items</h3>
                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">{po.items.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {po.items.map((item, index) => {
                  const itemInvoiced = item.invoicedAmount || 0;
                  const itemCommitted = item.baseAmount || 0;
                  const itemRemaining = item.isClosed ? 0 : Math.max(0, itemCommitted - itemInvoiced);
                  const itemProgress = itemCommitted > 0 ? Math.min(100, (itemInvoiced / itemCommitted) * 100) : 0;
                  const isOverInvoiced = itemInvoiced > itemCommitted;
                  const episodeLabel = item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0
                    ? item.episodes.length === 1 
                      ? item.episodes[0].episode.toString()
                      : item.episodes.map(e => e.episode).join(", ")
                    : "General";
                  return (
                    <div key={index} className={`p-6 ${item.isClosed ? "bg-slate-50" : ""}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{item.description}</p>
                            {item.isClosed && (
                              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium flex items-center gap-1">
                                <Lock size={10} />
                                Cerrado
                              </span>
                            )}
                            {/* Icono de info con popover */}
                            {po.status === "approved" && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowItemInfoPopover(showItemInfoPopover === index ? null : index);
                                  }}
                                  className={`p-1 rounded-full transition-colors ${
                                    item.isClosed 
                                      ? "text-blue-500 hover:bg-blue-100" 
                                      : itemRemaining > 0 
                                        ? "text-amber-500 hover:bg-amber-100" 
                                        : "text-emerald-500 hover:bg-emerald-100"
                                  }`}
                                  title="Ver estado del item"
                                >
                                  <Info size={16} />
                                </button>
                                
                                {/* Popover como modal centrado */}
                                {showItemInfoPopover === index && (
                                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowItemInfoPopover(null)}>
                                    <div className="absolute inset-0 bg-black/20" />
                                    <div className="relative w-80 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                                      <div className={`px-4 py-3 ${item.isClosed ? "bg-blue-50" : itemRemaining > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
                                        <p className={`font-semibold text-sm ${item.isClosed ? "text-blue-800" : itemRemaining > 0 ? "text-amber-800" : "text-emerald-800"}`}>
                                          {item.isClosed ? "Item cerrado" : itemRemaining > 0 ? "Pendiente de facturar" : "Completamente facturado"}
                                        </p>
                                        <p className="text-xs text-slate-600 mt-0.5">{item.description}</p>
                                      </div>
                                      <div className="p-4 space-y-3">
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                          <div>
                                            <p className="text-slate-500 text-xs">Comprometido</p>
                                            <p className="font-semibold text-slate-900">{formatCurrency(itemCommitted)} {getCurrencySymbol()}</p>
                                          </div>
                                          <div>
                                            <p className="text-slate-500 text-xs">Facturado</p>
                                            <p className={`font-semibold ${isOverInvoiced ? "text-amber-600" : "text-emerald-600"}`}>{formatCurrency(itemInvoiced)} {getCurrencySymbol()}</p>
                                          </div>
                                        </div>
                                        <div className={`p-3 rounded-lg ${item.isClosed ? "bg-blue-50" : itemRemaining > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
                                          <p className="text-xs text-slate-500 mb-1">Pendiente</p>
                                          <p className={`font-bold text-lg ${item.isClosed ? "text-blue-700" : itemRemaining > 0 ? "text-amber-700" : "text-slate-600"}`}>
                                            {item.isClosed ? "0,00" : formatCurrency(itemRemaining)} {getCurrencySymbol()}
                                          </p>
                                          {!item.isClosed && itemRemaining > 0 && (
                                            <p className="text-xs text-amber-600 mt-1">Este importe se liberará al cerrar</p>
                                          )}
                                        </div>
                                        {/* Barra de progreso */}
                                        <div>
                                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                                            <span>Progreso</span>
                                            <span>{Math.round(itemProgress)}%</span>
                                          </div>
                                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div 
                                              className={`h-full rounded-full ${isOverInvoiced ? "bg-amber-500" : "bg-emerald-500"}`} 
                                              style={{ width: `${Math.min(100, itemProgress)}%` }} 
                                            />
                                          </div>
                                        </div>
                                        {/* Botón de acción - disponible para POs aprobadas y abiertas */}
                                        {po.status === "approved" && po.isOpen !== false && (permissions.role === "EP" || permissions.role === "PM" || permissions.role === "Controller" || permissions.accessLevel === "manager" || permissions.accessLevel === "admin") && (
                                          <div className="pt-2 border-t border-slate-100">
                                            {item.isClosed ? (
                                              <button
                                                onClick={() => {
                                                  setShowItemInfoPopover(null);
                                                  setShowReopenItemModal(index);
                                                  setPasswordInput("");
                                                  setPasswordError("");
                                                }}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors"
                                              >
                                                <Unlock size={14} />
                                                Reabrir item
                                              </button>
                                            ) : (
                                              <button
                                                onClick={() => {
                                                  setShowItemInfoPopover(null);
                                                  setShowCloseItemModal(index);
                                                  setPasswordInput("");
                                                  setPasswordError("");
                                                }}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
                                              >
                                                <Lock size={14} />
                                                Cerrar item {itemRemaining > 0 && `(liberar ${formatCurrency(itemRemaining)} ${getCurrencySymbol()})`}
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          <p className="text-sm text-slate-500 mt-0.5">{item.subAccountCode} · {item.subAccountDescription}</p>
                        </div>
                        <p className="font-bold text-slate-900">{formatCurrency(item.totalAmount)} {getCurrencySymbol()}</p>
                      </div>
                      <div className="flex items-center gap-6 text-sm text-slate-500">
                        <span>{item.quantity} × {formatCurrency(item.unitPrice)} {getCurrencySymbol()}</span>
                        {item.vatRate > 0 && <span>IVA {item.vatRate}%</span>}
                        {item.irpfRate > 0 && <span className="text-red-500">IRPF {item.irpfRate}%</span>}
                        {item.episodeAssignment && (
                          <span className="flex items-center gap-1 text-violet-600">
                            <Layers size={12} />
                            {episodeLabel}
                          </span>
                        )}
                      </div>
                      {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.episodes.map((ep) => (
                            <span key={ep.episode} className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-lg">
                              {ep.episode}: {formatCurrency(ep.amount)} {getCurrencySymbol()}
                            </span>
                          ))}
                        </div>
                      )}
                      
                      {/* Control presupuestario por item - solo si PO aprobada */}
                      {po.status === "approved" && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="flex-1 grid grid-cols-3 gap-2 text-xs">
                              <div className="bg-slate-100 rounded-lg px-3 py-2">
                                <p className="text-slate-500 mb-0.5">Comprometido</p>
                                <p className="font-semibold text-slate-900">{formatCurrency(itemCommitted)} {getCurrencySymbol()}</p>
                              </div>
                              <div className={`rounded-lg px-3 py-2 ${isOverInvoiced ? "bg-amber-100" : "bg-emerald-50"}`}>
                                <p className={`mb-0.5 ${isOverInvoiced ? "text-amber-600" : "text-emerald-600"}`}>Realizado</p>
                                <p className={`font-semibold ${isOverInvoiced ? "text-amber-700" : "text-emerald-700"}`}>{formatCurrency(itemInvoiced)} {getCurrencySymbol()}</p>
                              </div>
                              <div className={`rounded-lg px-3 py-2 ${item.isClosed ? "bg-blue-50" : itemRemaining > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
                                <p className={`mb-0.5 ${item.isClosed ? "text-blue-600" : itemRemaining > 0 ? "text-amber-600" : "text-slate-500"}`}>Pendiente</p>
                                <p className={`font-semibold ${item.isClosed ? "text-blue-700" : itemRemaining > 0 ? "text-amber-700" : "text-slate-600"}`}>
                                  {item.isClosed ? "0,00" : formatCurrency(itemRemaining)} {getCurrencySymbol()}
                                </p>
                              </div>
                            </div>
                          </div>
                          
                          {/* Barra de progreso */}
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                            <div 
                              className={`h-full rounded-full transition-all ${isOverInvoiced ? "bg-amber-500" : "bg-emerald-500"}`} 
                              style={{ width: `${Math.min(100, itemProgress)}%` }} 
                            />
                          </div>
                          
                          {/* Info y botón cerrar/reabrir */}
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-slate-500">
                              {Math.round(itemProgress)}% realizado
                              {isOverInvoiced && <span className="text-amber-600 ml-2">· Excedido en {formatCurrency(itemInvoiced - itemCommitted)} {getCurrencySymbol()}</span>}
                            </p>
                            {po.status === "approved" && po.isOpen !== false && (permissions.role === "EP" || permissions.role === "PM" || permissions.role === "Controller" || permissions.accessLevel === "manager" || permissions.accessLevel === "admin") && (
                              item.isClosed ? (
                                <button
                                  onClick={() => { setShowReopenItemModal(index); setPasswordInput(""); setPasswordError(""); }}
                                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                >
                                  <Unlock size={12} />
                                  Reabrir item
                                </button>
                              ) : (
                                <button
                                  onClick={() => { setShowCloseItemModal(index); setPasswordInput(""); setPasswordError(""); }}
                                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                  <Lock size={12} />
                                  Cerrar item
                                </button>
                              )
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {invoices.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">Facturas vinculadas</h3>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium">{invoices.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {invoices.map((invoice) => (
                    <Link key={invoice.id} href={`/project/${projectId}/accounting/invoices/${invoice.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="font-medium text-slate-900">FAC-{invoice.number}</p>
                          <p className="text-xs text-slate-500">{formatDate(invoice.createdAt)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {(invoice.status === "accounted" || invoice.status === "paid") && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-xs" title="Codificada">
                              <BookCheck size={12} />
                            </span>
                          )}
                          {invoice.status === "paid" && (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs" title="Pagada">
                              <Wallet size={12} />
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold text-slate-900">{formatCurrency(invoice.totalAmount)} {getCurrencySymbol()}</p>
                        <ExternalLink size={14} className="text-slate-400" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {po.modificationHistory && po.modificationHistory.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="font-semibold text-slate-900">Historial de modificaciones</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {po.modificationHistory.map((entry, index) => (
                    <div key={index} className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-slate-900">V{String(entry.previousVersion).padStart(2, "0")} → V{String(entry.previousVersion + 1).padStart(2, "0")}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(entry.date?.toDate?.() || entry.date)}</span>
                      </div>
                      <p className="text-sm text-slate-600">{entry.reason}</p>
                      <p className="text-xs text-slate-400 mt-1">Por {entry.userName}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Resumen</h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Base imponible</span>
                  <span className="font-medium text-slate-900">{formatCurrency(po.baseAmount)} {getCurrencySymbol()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">IVA</span>
                  <span className="font-medium text-slate-700">+{formatCurrency(po.vatAmount)} {getCurrencySymbol()}</span>
                </div>
                {po.irpfAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">IRPF</span>
                    <span className="font-medium text-red-600">-{formatCurrency(po.irpfAmount)} {getCurrencySymbol()}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-slate-200 flex justify-between">
                  <span className="font-medium text-slate-700">Total</span>
                  <span className="text-xl font-bold text-slate-900">{formatCurrency(po.totalAmount)} {getCurrencySymbol()}</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Detalles</h3>
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  <Building2 size={16} className="text-slate-400" />
                  <div>
                    <p className="text-slate-500">Proveedor</p>
                    <p className="font-medium text-slate-900">{po.supplier}</p>
                  </div>
                </div>
                {po.department && (
                  <div className="flex items-center gap-3">
                    <Hash size={16} className="text-slate-400" />
                    <div>
                      <p className="text-slate-500">Departamento</p>
                      <p className="font-medium text-slate-900">{po.department}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Calendar size={16} className="text-slate-400" />
                  <div>
                    <p className="text-slate-500">Fecha de creación</p>
                    <p className="font-medium text-slate-900">{formatDate(po.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <User size={16} className="text-slate-400" />
                  <div>
                    <p className="text-slate-500">Creado por</p>
                    <p className="font-medium text-slate-900">{po.createdByName}</p>
                  </div>
                </div>
                {po.approvedAt && (
                  <div className="flex items-center gap-3">
                    <CheckCircle size={16} className="text-emerald-500" />
                    <div>
                      <p className="text-slate-500">Aprobada</p>
                      <p className="font-medium text-slate-900">{formatDate(po.approvedAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {po.attachmentUrl && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-semibold text-slate-900 mb-4">Adjunto</h3>
                <a href={po.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                    <FileUp size={18} className="text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{po.attachmentFileName}</p>
                    <p className="text-xs text-slate-500">Ver archivo</p>
                  </div>
                  <ExternalLink size={14} className="text-slate-400" />
                </a>
              </div>
            )}

            {po.notes && (
              <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <h3 className="font-semibold text-slate-900 mb-3">Notas</h3>
                <p className="text-sm text-slate-600">{po.notes}</p>
              </div>
            )}

            {po.status === "cancelled" && po.cancellationReason && (
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
                <h3 className="font-semibold text-red-900 mb-3">Motivo de anulación</h3>
                <p className="text-sm text-red-700">{po.cancellationReason}</p>
                <p className="text-xs text-red-500 mt-2">Por {po.cancelledByName} · {formatDateTime(po.cancelledAt!)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Firmas */}
        {po.approvalSteps && po.approvalSteps.length > 0 && (
          <div className="mt-8 bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Firmas</h3>
              {po.status === "approved" && (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle size={12} />
                  Completado
                </span>
              )}
              {po.status === "pending" && (
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <Clock size={12} />
                  {po.approvalSteps.filter(s => s.status === "approved").length}/{po.approvalSteps.length}
                </span>
              )}
              {po.status === "rejected" && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <XCircle size={12} />
                  Rechazado
                </span>
              )}
            </div>

            <div className="p-4">
              <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${po.approvalSteps.length}, minmax(0, 1fr))` }}>
                {po.approvalSteps.map((step, index) => {
                  const isApproved = step.status === "approved";
                  const isRejected = step.status === "rejected";
                  const isPending = step.status === "pending";
                  const isCurrent = po.currentApprovalStep === index;
                  
                  // Obtener nombre del firmante
                  const signerName = isApproved && step.approvedByNames?.[0] 
                    ? step.approvedByNames[0] 
                    : step.approverNames?.[0] || "—";
                  
                  const signerId = isApproved && step.approvedBy?.[0] 
                    ? step.approvedBy[0] 
                    : step.approvers?.[0];
                  
                  // Buscar comentario
                  const userComment = signerId ? (po.comments || []).find(c => 
                    c.userId === signerId && 
                    (c.type === "approval" || c.type === "rejection" || c.type === "comment")
                  ) : null;

                  return (
                    <div 
                      key={step.id} 
                      className={`p-3 rounded-xl border text-center ${
                        isApproved ? "bg-emerald-50 border-emerald-200" : 
                        isRejected ? "bg-red-50 border-red-200" : 
                        isCurrent ? "bg-amber-50 border-amber-200" : 
                        "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1 mb-2">
                        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Nivel {step.order}</span>
                        {userComment && (
                          <button
                            onClick={() => setShowApprovalNoteModal(userComment)}
                            className="p-0.5 hover:bg-white/50 rounded transition-colors"
                            title="Ver nota"
                          >
                            <Glasses size={12} className={
                              isApproved ? "text-emerald-600" : 
                              isRejected ? "text-red-600" : 
                              "text-slate-400"
                            } />
                          </button>
                        )}
                      </div>
                      
                      <div className={`w-8 h-8 rounded-full mx-auto mb-2 flex items-center justify-center text-xs font-semibold ${
                        isApproved ? "bg-emerald-200 text-emerald-700" : 
                        isRejected ? "bg-red-200 text-red-700" : 
                        isCurrent ? "bg-amber-200 text-amber-700" :
                        "bg-slate-200 text-slate-500"
                      }`}>
                        {isApproved ? <Check size={14} /> : 
                         isRejected ? <X size={14} /> : 
                         signerName.charAt(0).toUpperCase()}
                      </div>
                      
                      <p className={`text-sm font-medium truncate ${
                        isApproved ? "text-emerald-800" : 
                        isRejected ? "text-red-800" : 
                        "text-slate-700"
                      }`}>
                        {signerName}
                      </p>
                      
                      {isApproved ? (
                        <p className="text-[10px] text-emerald-600 mt-0.5">
                          {step.approvedAt 
                            ? `${new Date(step.approvedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · ${new Date(step.approvedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
                            : "Firmado"
                          }
                        </p>
                      ) : isRejected ? (
                        <p className="text-[10px] text-red-600 mt-0.5">Rechazado</p>
                      ) : isCurrent ? (
                        <p className="text-[10px] text-amber-600 mt-0.5">Pendiente</p>
                      ) : (
                        <p className="text-[10px] text-slate-400 mt-0.5">En espera</p>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {/* Creador */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Creado por <span className="font-medium text-slate-700">{po.createdByName}</span></span>
                <span>{formatDate(po.createdAt)}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Close Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowCloseModal(false); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <Lock size={20} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Cerrar PO-{po.number}</h3>
                <p className="text-xs text-slate-500">Esta acción requiere confirmación</p>
              </div>
            </div>
            <div className="p-6">
              {remainingAmount > 0 && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Esta PO tiene importe sin facturar</p>
                      <p className="text-xs mt-1">Pendiente: {formatCurrency(remainingAmount)} {getCurrencySymbol()}</p>
                      <p className="text-xs mt-1 text-amber-700">Se liberará el presupuesto comprometido restante.</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  placeholder="Tu contraseña"
                  className={`w-full px-4 py-3 border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm`}
                  autoFocus
                />
                {passwordError && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowCloseModal(false); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleClosePO} disabled={processing || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Cerrando..." : "Cerrar PO"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Close Item Modal */}
      {showCloseItemModal !== null && po && po.items[showCloseItemModal] && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowCloseItemModal(null); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <Lock size={20} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Cerrar item</h3>
                <p className="text-xs text-slate-500">{po.items[showCloseItemModal].description}</p>
              </div>
            </div>
            <div className="p-6">
              {(() => {
                const item = po.items[showCloseItemModal];
                const itemRemaining = Math.max(0, (item.baseAmount || 0) - (item.invoicedAmount || 0));
                return itemRemaining > 0 ? (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <p className="font-medium">Este item tiene importe sin facturar</p>
                        <p className="text-xs mt-1">Comprometido: {formatCurrency(item.baseAmount)} {getCurrencySymbol()}</p>
                        <p className="text-xs">Realizado: {formatCurrency(item.invoicedAmount || 0)} {getCurrencySymbol()}</p>
                        <p className="text-xs font-medium mt-1">Se liberarán: {formatCurrency(itemRemaining)} {getCurrencySymbol()}</p>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  placeholder="Tu contraseña"
                  className={`w-full px-4 py-3 border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm`}
                  autoFocus
                />
                {passwordError && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowCloseItemModal(null); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={() => handleCloseItem(showCloseItemModal)} disabled={processing || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Cerrando..." : "Cerrar item"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Item Modal */}
      {showReopenItemModal !== null && po && po.items[showReopenItemModal] && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowReopenItemModal(null); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Unlock size={20} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Reabrir item</h3>
                <p className="text-xs text-slate-500">{po.items[showReopenItemModal].description}</p>
              </div>
            </div>
            <div className="p-6">
              {(() => {
                const item = po.items[showReopenItemModal];
                const itemRemaining = Math.max(0, (item.baseAmount || 0) - (item.invoicedAmount || 0));
                return itemRemaining > 0 ? (
                  <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <p className="font-medium">Se restaurará el comprometido</p>
                        <p className="text-xs mt-1">Comprometido original: {formatCurrency(item.baseAmount)} {getCurrencySymbol()}</p>
                        <p className="text-xs">Facturado: {formatCurrency(item.invoicedAmount || 0)} {getCurrencySymbol()}</p>
                        <p className="text-xs font-medium mt-1">Se volverán a comprometer: {formatCurrency(itemRemaining)} {getCurrencySymbol()}</p>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  placeholder="Tu contraseña"
                  className={`w-full px-4 py-3 border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm`}
                  autoFocus
                />
                {passwordError && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowReopenItemModal(null); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={() => handleReopenItem(showReopenItemModal)} disabled={processing || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Reabriendo..." : "Reabrir item"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reopen Modal */}
      {showReopenModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowReopenModal(false); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <Unlock size={20} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Reabrir PO-{po.number}</h3>
                <p className="text-xs text-slate-500">Volverá al estado "Aprobada"</p>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">Se restaurará el presupuesto comprometido</p>
                    <p className="text-xs mt-1">Se volverá a comprometer: {formatCurrency(po.baseAmount - po.invoicedAmount)} {getCurrencySymbol()}</p>
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  placeholder="Tu contraseña"
                  className={`w-full px-4 py-3 border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm`}
                  autoFocus
                />
                {passwordError && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowReopenModal(false); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleReopenPO} disabled={processing || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Reabriendo..." : "Reabrir PO"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowCancelModal(false); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
                <XCircle size={20} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Anular PO-{po.number}</h3>
                <p className="text-xs text-slate-500">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <div className="p-6">
              {po.status === "approved" && (
                <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Se liberará el presupuesto comprometido</p>
                      <p className="text-xs mt-1">{formatCurrency(po.committedAmount || po.baseAmount)} {getCurrencySymbol()} volverán a estar disponibles</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Motivo de anulación *</label>
                <textarea
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="Explica por qué se anula esta PO..."
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none text-sm"
                />
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
                  <KeyRound size={14} />
                  Confirma tu contraseña
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(""); }}
                  placeholder="Tu contraseña"
                  className={`w-full px-4 py-3 border ${passwordError ? "border-red-300 bg-red-50" : "border-slate-200"} rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm`}
                />
                {passwordError && <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12} />{passwordError}</p>}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowCancelModal(false); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleCancelPO} disabled={processing || !cancellationReason.trim() || !passwordInput.trim()} className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Anulando..." : "Anular PO"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modify Modal */}
      {showModifyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowModifyModal(false); resetModals(); }}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <FileEdit size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Modificar PO-{po.number}</h3>
                <p className="text-xs text-slate-500">Crear nueva versión para editar</p>
              </div>
            </div>
            <div className="p-6">
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">Pasará a V{String((po.version || 1) + 1).padStart(2, "0")} en borrador</p>
                    <p className="text-xs mt-1">Deberás editarla y enviarla nuevamente.</p>
                  </div>
                </div>
              </div>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Motivo de la modificación *</label>
                <textarea
                  value={modificationReason}
                  onChange={(e) => setModificationReason(e.target.value)}
                  placeholder="Explica por qué se modifica..."
                  rows={4}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowModifyModal(false); resetModals(); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">
                  Cancelar
                </button>
                <button onClick={handleModifyPO} disabled={processing || !modificationReason.trim()} className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                  {processing ? "Modificando..." : "Modificar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Eliminar Borrador */}
      {showDeleteModal && po && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Trash2 size={28} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 text-center mb-2">Eliminar borrador</h3>
              <p className="text-slate-500 text-center mb-6">
                ¿Estás seguro de que quieres eliminar el borrador <strong>PO-{po.number}</strong>? Esta acción no se puede deshacer.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteModal(false)} 
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleDeleteDraft} 
                  disabled={processing} 
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Eliminando...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Eliminar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nota del Aprobador */}
      {showApprovalNoteModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowApprovalNoteModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  showApprovalNoteModal.type === "approval" ? "bg-emerald-100" :
                  showApprovalNoteModal.type === "rejection" ? "bg-red-100" :
                  "bg-slate-100"
                }`}>
                  <Glasses size={24} className={
                    showApprovalNoteModal.type === "approval" ? "text-emerald-600" :
                    showApprovalNoteModal.type === "rejection" ? "text-red-600" :
                    "text-slate-600"
                  } />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Nota del aprobador</h3>
                  <p className="text-sm text-slate-500">{showApprovalNoteModal.userName}</p>
                </div>
              </div>
              
              <div className={`p-4 rounded-xl border ${
                showApprovalNoteModal.type === "approval" ? "bg-emerald-50 border-emerald-200" :
                showApprovalNoteModal.type === "rejection" ? "bg-red-50 border-red-200" :
                "bg-slate-50 border-slate-200"
              }`}>
                <p className="text-sm text-slate-700 italic">"{showApprovalNoteModal.text}"</p>
              </div>
              
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Calendar size={12} />
                  {formatDateTime(showApprovalNoteModal.createdAt)}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  showApprovalNoteModal.type === "approval" ? "bg-emerald-100 text-emerald-700" :
                  showApprovalNoteModal.type === "rejection" ? "bg-red-100 text-red-700" :
                  showApprovalNoteModal.type === "info_request" ? "bg-amber-100 text-amber-700" :
                  "bg-slate-100 text-slate-700"
                }`}>
                  {showApprovalNoteModal.type === "approval" && "Aprobación"}
                  {showApprovalNoteModal.type === "rejection" && "Rechazo"}
                  {showApprovalNoteModal.type === "info_request" && "Solicitud de info"}
                  {showApprovalNoteModal.type === "comment" && "Comentario"}
                </span>
              </div>
              
              <button 
                onClick={() => setShowApprovalNoteModal(null)}
                className="w-full mt-4 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
