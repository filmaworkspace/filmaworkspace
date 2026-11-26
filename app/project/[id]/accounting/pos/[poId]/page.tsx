"use client";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel, Button, Modal } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import { ActionModal } from "@/components/accounting/ActionModal";
import { getScopedDocs, scopeFromPermissions, sortByTime } from "@/lib/accountingScope";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  FileText,
  Ban,
  BookCheck,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit,
  ExternalLink,
  FileEdit,
  FileUp,
  Glasses,
  Hash,
  Info,
  KeyRound,
  Layers,
  Lock,
  MoreHorizontal,
  ShieldAlert,
  Trash2,
  Unlock,
  Upload,
  User,
  Wallet,
  X,
  XCircle,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { PendingApprovalNotice } from "@/components/accounting/ApprovalFlow";
import { stepLabel } from "@/lib/approvalFlow";
import { repairDoc } from "@/lib/approvalActions";

const toDateAny = (v: any): Date => (v?.toDate ? v.toDate() : new Date(v));
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { syncBudget } from "@/lib/ledgerClient";
import { AmountSummary } from "@/components/accounting/AmountSummary";
import { SupplierHeader } from "@/components/accounting/SupplierPreview";
import { needsNewVersion, revisePO } from "@/lib/poRevision";
import { ReassignModal } from "@/components/accounting/ReassignModal";
import { UserCog } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

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
  status: "pending" | "approved" | "rejected" | "skipped";
  skipReason?: string | null;
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
  isOpen?: boolean;
  attachmentUrl?: string;
  attachmentFileName?: string;
  originalAttachmentUrl?: string;
  originalAttachmentFileName?: string;
  createdAt: Date;
  createdBy: string;
  reassignments?: any[];
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

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<POStatus, { bg: string; text: string; label: string; icon: typeof Clock; gradient: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit, gradient: "from-slate-500 to-slate-600" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente", icon: Clock, gradient: "from-amber-500 to-orange-500" },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada", icon: CheckCircle, gradient: "from-emerald-500 to-teal-500" },
  rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada", icon: XCircle, gradient: "from-red-500 to-rose-500" },
  closed: { bg: "bg-[#F7F7F8]", text: "text-slate-900", label: "Cerrada", icon: Archive, gradient: "" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", label: "Anulada", icon: Ban, gradient: "from-red-500 to-rose-500" },
};

// ─────────────────────────────────────────────────────────────────────────────

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
  const [showReassign, setShowReassign] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showApprovalNoteModal, setShowApprovalNoteModal] = useState<ApprovalComment | null>(null);
  const [replacingDocument, setReplacingDocument] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(
    showCloseModal || showReopenModal || showCancelModal || showModifyModal ||
    showCloseItemModal !== null || showReopenItemModal !== null || showDeleteModal || !!showApprovalNoteModal
  );

  useEffect(() => {
    if (projectId && poId && !permissionsLoading) loadData();
  }, [projectId, poId, permissionsLoading]);

  // Reparar un flujo atascado (pasos sin aprobador o fuera de umbral → omitidos).
  const canRepairFlow = permissions.isProjectRole || ["accounting", "accounting_extended"].includes(String(permissions.accountingAccessLevel));
  const handleRepairFlow = async () => {
    try {
      const r = await repairDoc(projectId, "po", poId, { uid: permissions.userId || "", name: permissions.userName || "" });
      if (r.changed) appToast.success("Flujo reparado"); else appToast.info("No había nada que reparar");
      await loadData();
    } catch (e: any) { appToast.error(e, { fallback: "No se ha podido reparar el flujo" }); }
  };

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
        reassignments: poDoc.data().reassignments || [],
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

      const scope = scopeFromPermissions(permissions);
      const poInvoices = (await getScopedDocs(collection(db, `projects/${projectId}/invoices`), scope, [where("poId", "==", poId)]))
        .filter((d) => d.data().poId === poId);
      setInvoices(poInvoices.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() } as Invoice)));

      // Cargar solo las POs que el usuario puede ver para navegación
      const navPOs = sortByTime(await getScopedDocs(collection(db, `projects/${projectId}/pos`), scope), "createdAt", "asc");
      const accessiblePOs = navPOs.filter((d) => {
        const data = d.data();
        return canViewPO({
          id: d.id,
          department: data.department || "",
          createdBy: data.createdBy || "",
          status: data.status || "draft",
        });
      });
      const ids = accessiblePOs.map((d) => d.id);
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
  // Modificar (revisar) una PO: quien la puede editar, roles de proyecto y contabilidad.
  const isExtended = permissions.accountingAccessLevel === "accounting_extended";
  const canModify = !!po && (getPOPermissions(po).canEdit || permissions.isProjectRole || ["accounting", "accounting_extended"].includes(String(permissions.accountingAccessLevel)));
  const canDeleteDraft = po?.status === "draft" && (!po.version || po.version === 1) && getPOPermissions(po).canEdit;
  
  // Verificar si se puede reemplazar el documento
  const canReplaceDocument = () => {
    if (!po) return false;
    if (po.status === "cancelled") return false;
    // Cualquier usuario con acceso puede reemplazar, o contabilidad ampliada
    return poPerms.canEdit || permissions.accountingAccessLevel === "accounting_extended";
  };
  
  // Función para reemplazar documento
  const handleReplaceDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !po) return;
    
    setReplacingDocument(true);
    try {
      // Subir nuevo archivo
      const timestamp = Date.now();
      const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const storageRef = ref(storage, `projects/${projectId}/pos/${poId}/${timestamp}_${safeFileName}`);
      await uploadBytes(storageRef, file);
      const newUrl = await getDownloadURL(storageRef);
      
      // Preparar datos de auditoría
      const auditEntry = {
        action: "document_replaced",
        userId: permissions.userId || "",
        userName: permissions.userName || "",
        timestamp: Timestamp.now(),
        previousFileName: po.attachmentFileName || "",
        newFileName: file.name,
      };
      
      // Actualizar documento
      const updateData: Record<string, any> = {
        attachmentUrl: newUrl,
        attachmentFileName: file.name,
        documentHistory: arrayUnion(auditEntry),
        updatedAt: Timestamp.now(),
        updatedBy: permissions.userId || "",
        updatedByName: permissions.userName || "",
      };
      
      // Guardar documento anterior si no había original y existe uno actual
      if (!po.originalAttachmentUrl && po.attachmentUrl) {
        updateData.originalAttachmentUrl = po.attachmentUrl;
        updateData.originalAttachmentFileName = po.attachmentFileName || "";
      }
      
      await updateDoc(doc(db, `projects/${projectId}/pos`, poId), updateData);
      
      // Actualizar estado local
      setPO({
        ...po,
        attachmentUrl: newUrl,
        attachmentFileName: file.name,
      });
      
      setShowActionsMenu(false);
      appToast.success("Documento reemplazado");
    } catch (error) {
      console.error("Error replacing document:", error);
      appToast.error("No se ha podido reemplazar el documento");
    } finally {
      setReplacingDocument(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);
  const formatDate = (date: Date) => (date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "long", year: "numeric" }).format(date) : "-");
  const formatDateTime = (date: Date) => (date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "-");
  const getCurrencySymbol = () => ({ EUR: "€", USD: "$", GBP: "£" }[po?.currency || "EUR"] || "€");

  const navigatePO = (direction: "prev" | "next") => {
    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < allPOIds.length) {
      router.push(`/project/${projectId}/accounting/pos/${allPOIds[newIndex]}`);
    }
  };





  const handleClosePO = async () => {
    if (!po) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "closed",
        closedAt: Timestamp.now(),
        closedBy: permissions.userId,
        closedByName: permissions.userName,
        remainingAmount: 0,
      });
      await syncBudget(projectId);
      setShowCloseModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      appToast.error("No se ha podido cerrar la PO");
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
      const baseAmount = po.baseAmount || 0;
      const invoicedAmount = po.invoicedAmount || 0;

      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "approved",
        closedAt: null,
        closedBy: null,
        closedByName: null,
        remainingAmount: baseAmount - invoicedAmount,
      });
      await syncBudget(projectId);
      setShowReopenModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      appToast.error("No se ha podido reabrir la PO");
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
      await updateDoc(doc(db, `projects/${projectId}/pos`, po.id), {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: permissions.userId,
        cancelledByName: permissions.userName,
        cancellationReason: cancellationReason.trim(),
        committedAmount: 0,
        remainingAmount: 0,
      });
      await syncBudget(projectId);
      setShowCancelModal(false);
      resetModals();
      await loadData();
    } catch (error) {
      appToast.error("No se ha podido anular la PO");
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
      await syncBudget(projectId);

      setShowCloseItemModal(null);
      resetModals();
      await loadData();
    } catch (error) {
      console.error("Error closing item:", error);
      appToast.error("No se ha podido cerrar el item");
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
      await syncBudget(projectId);

      setShowReopenItemModal(null);
      resetModals();
      await loadData();
    } catch (error) {
      console.error("Error reopening item:", error);
      appToast.error("No se ha podido reabrir el item");
    } finally {
      setProcessing(false);
    }
  };

  const handleModifyPO = async () => {
    if (!po || !modificationReason.trim()) return;
    setProcessing(true);
    try {
      await revisePO(projectId, po as any, { uid: permissions.userId || "", name: permissions.userName || "" }, modificationReason.trim());
      setShowModifyModal(false);
      router.push(`/project/${projectId}/accounting/pos/${po.id}/edit`);
    } catch (error) {
      appToast.error("No se ha podido modificar la PO");
    } finally {
      setProcessing(false);
    }
  };


  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess || accessDenied) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="hidden">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para ver esta orden de compra"}</p>
          <Link href={`/project/${projectId}/accounting/pos`} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
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
      <div className="mt-[53px]">
        <div className="px-6 pt-8 sm:px-10">
          <div className="relative flex min-h-[44px] items-center justify-start border-b border-slate-200 pb-4">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-3">
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900">Orden de compra</h1>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-lg text-[13px] font-mono font-medium">
                    PO-{po.number}
                  </span>
                  {po.version > 1 && (
                    <span className="px-2 py-1 bg-[#F7F7F8] text-slate-900 rounded-lg text-xs font-medium">
                      V{String(po.version).padStart(2, "0")}
                    </span>
                  )}
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium text-[13px] ${config.bg} ${config.text}`}>
                    <Icon size={14} />
                    {config.label}
                  </span>
                </div>
              </div>
            </div>

            <div className="absolute right-0 flex items-center gap-2">
              {/* Navegación entre POs */}
              <div className="flex items-center gap-1 mr-2">
                <button aria-label="Anterior" onClick={() => navigatePO("prev")} disabled={currentIndex <= 0} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30">
                  <ChevronLeft size={18} />
                </button>
                <span className="text-xs text-slate-500 px-2">{currentIndex + 1} / {allPOIds.length}</span>
                <button aria-label="Siguiente" onClick={() => navigatePO("next")} disabled={currentIndex >= allPOIds.length - 1} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30">
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Botón principal según estado */}
              {po.status === "draft" && poPerms.canEdit && (
                <Link href={`/project/${projectId}/accounting/pos/${po.id}/edit`} className="flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                  <Edit size={16} />
                  Editar
                </Link>
              )}
              {po.status === "approved" && (
                <Link href={`/project/${projectId}/accounting/invoices/new?poId=${po.id}`} className="flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                  <Upload size={16} />
                  Subir factura
                </Link>
              )}
              {po.status === "closed" && poPerms.canReopen && (
                <button onClick={() => { resetModals(); setShowReopenModal(true); }} className="flex items-center gap-2 px-4 py-1.5 rounded-md text-[13px] font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]">
                  <Unlock size={16} />
                  Reabrir
                </button>
              )}

              {/* Menú de acciones */}
              <div className="relative">
                <button aria-label="Más acciones" 
                  onClick={() => setShowActionsMenu(!showActionsMenu)} 
                  className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-slate-700 rounded-md hover:bg-slate-50 text-[13px] font-medium"
                >
                  <MoreHorizontal size={18} />
                </button>
                
                {showActionsMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowActionsMenu(false)} />
                    <AnchoredPanel className="w-56 bg-white border border-slate-200 rounded-md shadow-xl py-1 animate-fadeIn" align="right" gap={8}>
                      {/* Los documentos se descargan siempre desde el hub de documentación */}
                      <Link
                        href={`/project/${projectId}/accounting/document-center?doc=po:${poId}`}
                        onClick={() => setShowActionsMenu(false)}
                        className="w-full px-4 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                      >
                        <FileText size={16} className="text-slate-400" />
                        Ver en documentación
                      </Link>
                      
                      {/* Reemplazar documento */}
                      {canReplaceDocument() && (
                        <button 
                          onClick={() => { fileInputRef.current?.click(); setShowActionsMenu(false); }} 
                          disabled={replacingDocument}
                          className="w-full px-4 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-3 disabled:opacity-50"
                        >
                          <Upload size={16} className="text-slate-400" />
                          {replacingDocument ? "Subiendo..." : "Reemplazar documento"}
                        </button>
                      )}

                      {/* Modificar: siempre, sea cual sea el estado */}
                      {canModify && (
                        <>
                          <div className="border-t border-slate-100 my-1" />
                          <button
                            onClick={() => {
                              setShowActionsMenu(false);
                              if (needsNewVersion(po as any)) { resetModals(); setShowModifyModal(true); }
                              else router.push(`/project/${projectId}/accounting/pos/${po.id}/edit`);
                            }}
                            className="w-full px-4 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                          >
                            <FileEdit size={16} className="text-slate-400" />
                            Modificar PO
                          </button>
                        </>
                      )}

                      {isExtended && (
                        <button onClick={() => { setShowActionsMenu(false); setShowReassign(true); }} className="w-full px-4 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-3">
                          <UserCog size={16} className="text-slate-400" />
                          Reasignar responsable
                        </button>
                      )}

                      {/* Acciones para estado Aprobada */}
                      {po.status === "approved" && (
                        <>
                          {poPerms.canClose && (
                            <button 
                              onClick={() => { resetModals(); setShowCloseModal(true); setShowActionsMenu(false); }} 
                              className="w-full px-4 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50 flex items-center gap-3"
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
                                className="w-full px-4 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-3"
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
                            className="w-full px-4 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-3"
                          >
                            <Trash2 size={16} className="text-red-400" />
                            Eliminar borrador
                          </button>
                        </>
                      )}
                    </AnchoredPanel>
                  </>
                )}
              </div>
              

              <ReassignModal open={showReassign} onClose={() => setShowReassign(false)} projectId={projectId} kind="po"
                target={{ id: po.id, label: `PO-${po.number}`, createdBy: po.createdBy, createdByName: (po as any).createdByName, department: po.department }}
                actor={{ uid: permissions.userId || "", name: permissions.userName || "" }}
                onDone={() => loadData()} />
              {/* Input oculto para reemplazar documento */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleReplaceDocument} 
                accept=".pdf,.jpg,.jpeg,.png,.webp" 
                className="hidden" 
              />
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 sm:px-10 py-8">
        <SupplierHeader projectId={projectId} supplierId={po.supplierId} name={po.supplier}
          meta={po.department || undefined} />
        {po.status === "pending" && (
          <div className="mb-6"><PendingApprovalNotice doc={po as any} onlyMine approve={permissions.userId ? { projectId, kind: "po", docId: poId, user: { uid: permissions.userId, name: permissions.userName || "" }, onDone: () => loadData() } : undefined} /></div>
        )}
        <div className="grid grid-cols-3 gap-8">
          <div className="col-span-2 space-y-6">
            {po.generalDescription && (
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <h3 className="text-[13px] font-semibold text-slate-900 mb-3">Descripción</h3>
                <p className="text-slate-600">{po.generalDescription}</p>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-slate-900">Items</h3>
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
                              <span className="px-2 py-0.5 bg-[#F1F1F3] text-slate-900 rounded-lg text-xs font-medium flex items-center gap-1">
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
                                      ? "text-slate-500 hover:bg-[#F4F4F5]" 
                                      : itemRemaining > 0 
                                        ? "text-amber-500 hover:bg-amber-100" 
                                        : "text-emerald-500 hover:bg-emerald-100"
                                  }`}
                                  title="Ver estado del item"
                                >
                                  <Info size={16} />
                                </button>
                                
                                <Modal
                                  open={showItemInfoPopover === index}
                                  onClose={() => setShowItemInfoPopover(null)}
                                  title={item.isClosed ? "Línea cerrada" : itemRemaining > 0 ? "Pendiente de facturar" : "Facturada por completo"}
                                  width="max-w-sm"
                                  footer={po.status === "approved" && po.isOpen !== false && (permissions.role === "EP" || permissions.role === "PM" || permissions.role === "Controller" || permissions.accountingAccessLevel === "accounting_extended") ? (
                                    item.isClosed ? (
                                      <Button variant="secondary" onClick={() => { setShowItemInfoPopover(null); setShowReopenItemModal(index); setPasswordInput(""); setPasswordError(""); }}>Reabrir línea</Button>
                                    ) : (
                                      <Button variant="secondary" onClick={() => { setShowItemInfoPopover(null); setShowCloseItemModal(index); setPasswordInput(""); setPasswordError(""); }}>
                                        Cerrar línea{itemRemaining > 0 ? ` y liberar ${formatCurrency(itemRemaining)} ${getCurrencySymbol()}` : ""}
                                      </Button>
                                    )
                                  ) : undefined}
                                >
                                  <div className="flex flex-col gap-3 text-[13px]">
                                    <p className="text-slate-600">{item.description}</p>
                                    <dl className="grid grid-cols-2 gap-y-1.5">
                                      <dt className="text-slate-500">Comprometido</dt><dd className="text-right tabular-nums">{formatCurrency(itemCommitted)} {getCurrencySymbol()}</dd>
                                      <dt className="text-slate-500">Facturado</dt><dd className={`text-right tabular-nums ${isOverInvoiced ? "text-amber-800" : ""}`}>{formatCurrency(itemInvoiced)} {getCurrencySymbol()}</dd>
                                      <dt className="font-medium text-slate-900">Pendiente</dt><dd className="text-right tabular-nums font-semibold">{item.isClosed ? "0,00" : formatCurrency(itemRemaining)} {getCurrencySymbol()}</dd>
                                    </dl>
                                    <div>
                                      <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Facturado</span><span>{Math.round(itemProgress)} %</span></div>
                                      <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                                        <div className={`h-full ${isOverInvoiced ? "bg-amber-500" : "bg-[#2F52E0]"}`} style={{ width: `${Math.min(100, itemProgress)}%` }} />
                                      </div>
                                    </div>
                                  </div>
                                </Modal>
                              </>
                            )}
                          </div>
                          <p className="text-[13px] text-slate-500 mt-0.5">{item.subAccountCode} · {item.subAccountDescription}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums text-slate-900">{formatCurrency(item.baseAmount)} {getCurrencySymbol()}</p>
                          <p className="text-xs tabular-nums text-slate-400">Total {formatCurrency(item.totalAmount)} {getCurrencySymbol()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-[13px] text-slate-500">
                        <span>{item.quantity} × {formatCurrency(item.unitPrice)} {getCurrencySymbol()}</span>
                        {item.vatRate > 0 && <span>IVA {item.vatRate}%</span>}
                        {item.irpfRate > 0 && <span className="text-red-500">IRPF {item.irpfRate}%</span>}
                        {item.episodeAssignment && (
                          <span className="flex items-center gap-1 text-slate-700">
                            <Layers size={12} />
                            {episodeLabel}
                          </span>
                        )}
                      </div>
                      {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.episodes.map((ep) => (
                            <span key={ep.episode} className="text-xs bg-[#F1F1F3] text-slate-900 px-2 py-0.5 rounded-lg">
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
                              <div className={`rounded-lg px-3 py-2 ${item.isClosed ? "bg-[#F7F7F8]" : itemRemaining > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
                                <p className={`mb-0.5 ${item.isClosed ? "text-slate-700" : itemRemaining > 0 ? "text-amber-600" : "text-slate-500"}`}>Pendiente</p>
                                <p className={`font-semibold ${item.isClosed ? "text-slate-900" : itemRemaining > 0 ? "text-amber-700" : "text-slate-600"}`}>
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
                            {po.status === "approved" && po.isOpen !== false && (permissions.role === "EP" || permissions.role === "PM" || permissions.role === "Controller" || permissions.accountingAccessLevel === "accounting_extended") && (
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
                                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-[#F4F4F5] rounded-lg transition-colors"
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
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-slate-900">Facturas vinculadas</h3>
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium">{invoices.length}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {invoices.map((invoice) => {
                    const isCancelled = invoice.status === "cancelled";
                    return (
                      <Link
                        key={invoice.id}
                        href={`/project/${projectId}/accounting/invoices/${invoice.id}`}
                        className={`flex items-center justify-between p-4 transition-colors ${isCancelled ? "bg-red-50/40 opacity-60 hover:opacity-80" : "hover:bg-slate-50"}`}
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <p className={`font-medium ${isCancelled ? "line-through text-slate-400" : "text-slate-900"}`}>FRA-{invoice.number}</p>
                            <p className="text-xs text-slate-500">{formatDate(invoice.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isCancelled && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium line-through">✕ Anulada</span>
                            )}
                            {!isCancelled && (invoice.status === "accounted" || invoice.status === "paid") && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-[#F1F1F3] text-slate-900 rounded text-xs" title="Codificada">
                                <BookCheck size={12} />
                              </span>
                            )}
                            {!isCancelled && invoice.status === "paid" && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs" title="Pagada">
                                <Wallet size={12} />
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className={`font-semibold ${isCancelled ? "line-through text-slate-400" : "text-slate-900"}`}>{formatCurrency(invoice.totalAmount)} {getCurrencySymbol()}</p>
                          <ExternalLink size={14} className="text-slate-400" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {po.modificationHistory && po.modificationHistory.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h3 className="text-[13px] font-semibold text-slate-900">Historial de modificaciones</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {po.modificationHistory.map((entry, index) => (
                    <div key={index} className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[13px] font-medium text-slate-900">V{String(entry.previousVersion).padStart(2, "0")} → V{String(entry.previousVersion + 1).padStart(2, "0")}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(entry.date?.toDate?.() || entry.date)}</span>
                      </div>
                      <p className="text-[13px] text-slate-600">{entry.reason}</p>
                      <p className="text-xs text-slate-400 mt-1">Por {entry.userName}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <AmountSummary base={po.baseAmount || 0} vat={po.vatAmount || 0} irpf={po.irpfAmount || 0} total={po.totalAmount || 0} symbol={getCurrencySymbol()} />

            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <h3 className="text-[13px] font-semibold text-slate-900 mb-4">Detalles</h3>
              <div className="space-y-4 text-[13px]">
                <div className="flex items-center gap-3">
                  <Building2 size={16} className="text-slate-400" />
                  <div>
                    <p className="text-slate-500">Proveedor</p>
                    <p className={po.supplier ? "font-medium text-slate-900" : "font-medium italic text-slate-400"}>
                      {po.supplier || "Sin proveedor asignado"}
                    </p>
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
                    <p className="text-slate-500">Responsable</p>
                    <p className="font-medium text-slate-900">{po.createdByName}</p>
                    {(po as any).reassignments?.length > 0 && (() => { const r = (po as any).reassignments[(po as any).reassignments.length - 1]; return <p className="text-xs text-slate-500 mt-0.5">Reasignada por {r.byName}{r.at?.toDate ? ` el ${r.at.toDate().toLocaleDateString("es-ES")}` : ""}{r.reason ? ` · ${r.reason}` : ""}</p>; })()}
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
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <h3 className="text-[13px] font-semibold text-slate-900 mb-4">Adjunto</h3>
                <a href={po.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors">
                  <div className="w-10 h-10 bg-[#F1F1F3] rounded-lg flex items-center justify-center">
                    <FileUp size={18} className="text-slate-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-900 truncate">{po.attachmentFileName}</p>
                    <p className="text-xs text-slate-500">Ver archivo</p>
                  </div>
                  <ExternalLink size={14} className="text-slate-400" />
                </a>
              </div>
            )}

            {po.notes && (
              <div className="bg-white border border-slate-200 rounded-lg p-6">
                <h3 className="text-[13px] font-semibold text-slate-900 mb-3">Notas</h3>
                <p className="text-[13px] text-slate-600">{po.notes}</p>
              </div>
            )}

            {po.status === "cancelled" && po.cancellationReason && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                <h3 className="font-semibold text-red-900 mb-3">Motivo de anulación</h3>
                <p className="text-[13px] text-red-700">{po.cancellationReason}</p>
                <p className="text-xs text-red-500 mt-2">Por {po.cancelledByName} · {formatDateTime(po.cancelledAt!)}</p>
              </div>
            )}
          </div>
        </div>

        {/* Firmas */}
        {po.approvalSteps && po.approvalSteps.length > 0 && (
          <div className="mt-8 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-slate-900">Firmas</h3>
              {po.status === "approved" && (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle size={12} />
                  Completado
                </span>
              )}
              {po.status === "pending" && (
                <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <Clock size={12} />
                  {po.approvalSteps.filter(s => s.status === "approved").length}/{po.approvalSteps.filter(s => s.status !== "skipped").length}
                </span>
              )}
              {po.status === "rejected" && (
                <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                  <XCircle size={12} />
                  Rechazado
                </span>
              )}
            </div>

            {po.status === "pending" && (
              <div className="px-4 pt-4">
                <PendingApprovalNotice doc={po as any} onRepair={canRepairFlow ? handleRepairFlow : undefined} />
              </div>
            )}
            <div className="p-4">
              <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${po.approvalSteps.length}, minmax(0, 1fr))` }}>
                {po.approvalSteps.map((step, index) => {
                  const isApproved = step.status === "approved";
                  const isRejected = step.status === "rejected";
                  const isPending = step.status === "pending";
                  const isSkipped = step.status === "skipped";
                  const isCurrent = po.currentApprovalStep === index && isPending;
                  
                  // Obtener nombre del firmante
                  const signerName = isSkipped
                    ? stepLabel(step as any, po.department)
                    : isApproved && step.approvedByNames?.length
                    ? step.approvedByNames.join(", ")
                    : step.approverNames?.join(", ") || "—";
                  
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
                      className={`p-3 rounded-md border text-center ${
                        isApproved ? "bg-emerald-50 border-emerald-200" : 
                        isRejected ? "bg-red-50 border-red-200" : 
                        isSkipped ? "bg-white border-dashed border-slate-200" :
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
                         isSkipped ? "—" :
                         signerName.charAt(0).toUpperCase()}
                      </div>
                      
                      <p title={signerName} className={`text-[13px] font-medium truncate ${isSkipped ? "text-slate-400 " : ""}${
                        isApproved ? "text-emerald-800" : 
                        isRejected ? "text-red-800" : 
                        "text-slate-700"
                      }`}>
                        {signerName}
                      </p>
                      
                      {isApproved ? (
                        <p className="text-[10px] text-emerald-600 mt-0.5">
                          {step.approvedAt 
                            ? `${toDateAny(step.approvedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} · ${toDateAny(step.approvedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
                            : "Firmado"
                          }
                        </p>
                      ) : isRejected ? (
                        <p className="text-[10px] text-red-600 mt-0.5">Rechazado</p>
                      ) : isSkipped ? (
                        <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2" title={step.skipReason || ""}>Omitido · {step.skipReason || "sin aprobador"}</p>
                      ) : isCurrent ? (
                        <p className="text-[10px] text-amber-600 mt-0.5">{step.requireAll ? `Pendiente · ${(step.approvedBy || []).length}/${(step.approvers || []).length}` : "Pendiente"}</p>
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

      {po && (() => {
        const cur = getCurrencySymbol();
        const pwd = { value: passwordInput, onChange: (v: string) => { setPasswordInput(v); setPasswordError(""); }, error: passwordError, email: permissions.userEmail };
        const closeItem = showCloseItemModal !== null ? po.items[showCloseItemModal] : null;
        const reopenItem = showReopenItemModal !== null ? po.items[showReopenItemModal] : null;
        const left = (it: any) => Math.max(0, (it?.baseAmount || 0) - (it?.invoicedAmount || 0));
        const note = showApprovalNoteModal;
        const NOTE_LABEL: Record<string, string> = { approval: "Aprobación", rejection: "Rechazo", info_request: "Solicitud de información", comment: "Comentario" };
        return (
          <>
            <ActionModal
              open={showCloseModal}
              onClose={() => { setShowCloseModal(false); resetModals(); }}
              title={`Cerrar PO-${po.number}`}
              notice={remainingAmount > 0 ? <>Queda <b>{formatCurrency(remainingAmount)} {cur}</b> sin facturar. Al cerrar la PO se libera ese comprometido del presupuesto.</> : undefined}
              password={pwd}
              confirmLabel="Cerrar PO"
              processingLabel="Cerrando…"
              processing={processing}
              onConfirm={handleClosePO}
            />
            <ActionModal
              open={!!closeItem}
              onClose={() => { setShowCloseItemModal(null); resetModals(); }}
              title="Cerrar línea"
              subtitle={closeItem?.description}
              notice={closeItem && left(closeItem) > 0 ? <>Comprometido {formatCurrency(closeItem.baseAmount)} {cur} · facturado {formatCurrency(closeItem.invoicedAmount || 0)} {cur}. Se liberan <b>{formatCurrency(left(closeItem))} {cur}</b>.</> : undefined}
              password={pwd}
              confirmLabel="Cerrar línea"
              processingLabel="Cerrando…"
              processing={processing}
              onConfirm={() => showCloseItemModal !== null && handleCloseItem(showCloseItemModal)}
            />
            <ActionModal
              open={!!reopenItem}
              onClose={() => { setShowReopenItemModal(null); resetModals(); }}
              title="Reabrir línea"
              subtitle={reopenItem?.description}
              notice={reopenItem ? <>Comprometido original {formatCurrency(reopenItem.baseAmount)} {cur} · facturado {formatCurrency(reopenItem.invoicedAmount || 0)} {cur}. Se vuelven a comprometer <b>{formatCurrency(left(reopenItem))} {cur}</b>.</> : undefined}
              password={pwd}
              confirmLabel="Reabrir línea"
              processingLabel="Reabriendo…"
              processing={processing}
              onConfirm={() => showReopenItemModal !== null && handleReopenItem(showReopenItemModal)}
            />
            <ActionModal
              open={showReopenModal}
              onClose={() => { setShowReopenModal(false); resetModals(); }}
              title={`Reabrir PO-${po.number}`}
              subtitle="Vuelve a estar aprobada."
              notice={<>Se vuelven a comprometer <b>{formatCurrency(Math.max(0, po.baseAmount - po.invoicedAmount))} {cur}</b> del presupuesto.</>}
              password={pwd}
              confirmLabel="Reabrir PO"
              processingLabel="Reabriendo…"
              processing={processing}
              onConfirm={handleReopenPO}
            />
            <ActionModal
              open={showCancelModal}
              onClose={() => { setShowCancelModal(false); resetModals(); }}
              title={`Anular PO-${po.number}`}
              subtitle="No se puede deshacer."
              notice={po.status === "approved" ? <>Se liberan <b>{formatCurrency(po.committedAmount || po.baseAmount)} {cur}</b> comprometidos.</> : undefined}
              reason={{ label: "Motivo de la anulación", value: cancellationReason, onChange: setCancellationReason, placeholder: "Por qué se anula" }}
              password={pwd}
              confirmLabel="Anular PO"
              processingLabel="Anulando…"
              processing={processing}
              danger
              onConfirm={handleCancelPO}
            />
            <ActionModal
              open={showModifyModal}
              onClose={() => { setShowModifyModal(false); resetModals(); }}
              title={`Modificar PO-${po.number}`}
              notice={<>Pasa a la versión <b>V{String((po.version || 1) + 1).padStart(2, "0")}</b> en borrador. Mientras la editas y se aprueba, la versión actual sigue contando en el presupuesto.</>}
              reason={{ label: "Motivo de la modificación", value: modificationReason, onChange: setModificationReason, placeholder: "Qué cambia y por qué", rows: 4 }}
              confirmLabel="Modificar"
              processingLabel="Modificando…"
              processing={processing}
              onConfirm={handleModifyPO}
            />
            <ActionModal
              open={showDeleteModal}
              onClose={() => setShowDeleteModal(false)}
              title="Eliminar borrador"
              subtitle={`Se elimina el borrador PO-${po.number}. No se puede deshacer.`}
              confirmLabel="Eliminar"
              processingLabel="Eliminando…"
              processing={processing}
              danger
              onConfirm={handleDeleteDraft}
            />
            <Modal
              open={!!note}
              onClose={() => setShowApprovalNoteModal(null)}
              title={note ? `${NOTE_LABEL[note.type] || "Nota"} · ${note.userName}` : ""}
              footer={<Button variant="secondary" onClick={() => setShowApprovalNoteModal(null)}>Cerrar</Button>}
            >
              {note && (
                <div className="flex flex-col gap-3">
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{note.text}</p>
                  <p className="text-xs text-slate-400">{formatDateTime(note.createdAt)}</p>
                </div>
              )}
            </Modal>
          </>
        );
      })()}
    </div>
  );
}
