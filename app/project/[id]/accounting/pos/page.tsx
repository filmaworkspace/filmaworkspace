"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { Modal, AnchoredPanel, Checkbox, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Page, PageHeader, PageLoading, Segmented, Select, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { ActionModal } from "@/components/accounting/ActionModal";
import { getScopedDocs, scopeFromPermissions, sortByTime } from "@/lib/accountingScope";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowUpDown,
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Edit,
  ExternalLink,
  Eye,
  FileEdit,
  FileText,
  KeyRound,
  Lock,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  Unlock,
  X,
  XCircle,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import jsPDF from "jspdf";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

type POStatus = "draft" | "pending" | "approved" | "closed" | "cancelled";
type SortOrder = "desc" | "asc";

interface POItem {
  id?: string;
  description: string;
  subAccountId?: string;
  subAccountCode?: string;
  quantity: number;
  unitPrice: number;
  baseAmount?: number;
  totalAmount: number;
}

interface PO {
  id: string;
  number: string;
  version: number;
  supplier: string;
  supplierId: string;
  department?: string;
  generalDescription: string;
  description?: string;
  totalAmount: number;
  baseAmount?: number;
  vatAmount?: number;
  irpfAmount?: number;
  items: POItem[];
  status: POStatus;
  committedAmount: number;
  invoicedAmount: number;
  remainingAmount?: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  modificationHistory?: any[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: "desc", label: "Más recientes primero" },
  { value: "asc", label: "Más antiguas primero" },
];

const STATUS_CONFIG: Record<POStatus, { bg: string; text: string; label: string; icon: typeof Clock; gradient: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-700", label: "Borrador", icon: Edit, gradient: "from-slate-500 to-slate-600" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente", icon: Clock, gradient: "from-amber-500 to-orange-500" },
  approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada", icon: CheckCircle2, gradient: "from-emerald-500 to-teal-500" },
  closed: { bg: "bg-slate-100", text: "text-slate-600", label: "Cerrada", icon: Archive, gradient: "from-slate-500 to-slate-600" },
  cancelled: { bg: "bg-red-100", text: "text-red-800", label: "Anulada", icon: Ban, gradient: "from-red-600 to-rose-600" },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function POsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const searchParams = useSearchParams();
  const supplierParam = searchParams?.get("supplier") || "";
  const [poField, setPoField] = useState<"all" | "number" | "supplier" | "concept" | "account" | "amount">("all");
  const [poSort, setPoSort] = useState<"recent" | "old" | "amount">("recent");
  const [deptFilter, setDeptFilter] = useState("all");
  const [onlyMine, setOnlyMine] = useState(false);
  const [nearlyExhausted, setNearlyExhausted] = useState(false);

  const {
    loading: permissionsLoading,
    error: permissionsError,
    permissions,
    canViewPO,
    canEditPO,
    getPOPermissions: getFullPOPermissions,
  } = useAccountingPermissions(id);

  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [pos, setPos] = useState<PO[]>([]);
  const [filteredPOs, setFilteredPOs] = useState<PO[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | POStatus>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [stats, setStats] = useState({ total: 0, draft: 0, pending: 0, approved: 0, closed: 0, cancelled: 0, totalBase: 0, totalInvoiced: 0 });
  const [previewPO, setPreviewPO] = useState<PO | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(!!previewPO || showCloseModal || showReopenModal || showCancelModal || showModifyModal);
  const [cancellationReason, setCancellationReason] = useState("");
  const [modificationReason, setModificationReason] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; openUpward: boolean }>({ top: 0, left: 0, openUpward: false });
  const menuButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const menuRef = useRef<HTMLDivElement>(null);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) loadData();
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    filterAndSortPOs();
  }, [searchTerm, statusFilter, pos, sortOrder]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-container")) setOpenMenuId(null);
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(target)) setShowSortDropdown(false);
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (openMenuId) updateMenuPosition(openMenuId);
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [openMenuId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      // Solo lo que este usuario puede leer (ver lib/accountingScope)
      const posDocs = sortByTime(await getScopedDocs(collection(db, `projects/${id}/pos`), scopeFromPermissions(permissions)));
      const allPOs = posDocs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt?.toDate(),
        version: docSnap.data().version || 1,
        committedAmount: docSnap.data().committedAmount || 0,
        invoicedAmount: docSnap.data().invoicedAmount || 0,
        remainingAmount: docSnap.data().remainingAmount || 0,
        items: docSnap.data().items || [],
        modificationHistory: docSnap.data().modificationHistory || [],
      })) as PO[];

      const posData = allPOs.filter((po) =>
        canViewPO({
          id: po.id,
          department: po.department || "",
          createdBy: po.createdBy,
          status: po.status,
        })
      );
      setPos(posData);

      const newStats = posData.reduce(
        (acc, po) => {
          acc.total++;
          acc[po.status]++;
          if (po.status !== "cancelled") {
            acc.totalBase += po.baseAmount || po.totalAmount || 0;
            acc.totalInvoiced += po.invoicedAmount || 0;
          }
          return acc;
        },
        { total: 0, draft: 0, pending: 0, approved: 0, closed: 0, cancelled: 0, totalBase: 0, totalInvoiced: 0 }
      );
      setStats(newStats);
    } catch (error) {
      console.error("Error cargando POs:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortPOs = () => {
    let filtered = [...pos];
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (po) =>
          po.number.toLowerCase().includes(term) ||
          po.supplier.toLowerCase().includes(term) ||
          (po.generalDescription || po.description || "").toLowerCase().includes(term)
      );
    }
    if (statusFilter !== "all") filtered = filtered.filter((po) => po.status === statusFilter);
    filtered.sort((a, b) => {
      const dateA = a.createdAt?.getTime() || 0;
      const dateB = b.createdAt?.getTime() || 0;
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });
    setFilteredPOs(filtered);
  };

  const getSortLabel = () => SORT_OPTIONS.find(o => o.value === sortOrder)?.label || "Ordenar";

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
      if (error.code === "auth/wrong-password" || error.code === "auth/invalid-credential") {
        setPasswordError("Contraseña incorrecta");
      } else {
        setPasswordError("Error de autenticación");
      }
      return false;
    }
  };

  const resetModalState = () => {
    setPasswordInput("");
    setPasswordError("");
    setCancellationReason("");
    setModificationReason("");
    setSelectedPO(null);
  };

  const getPOPermissions = (po: PO) => {
    const perms = getFullPOPermissions(po);
    return {
      ...perms,
      isOwn: po.createdBy === permissions.userId,
    };
  };

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);

  const formatDate = (date: Date) =>
    date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

  const formatDateTime = (date: Date) =>
    date
      ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
      : "-";

  const formatDateRelative = (date: Date) => {
    if (!date) return "-";
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    if (diff < 7) return `Hace ${diff} días`;
    return formatDate(date);
  };

  const getStatusBadge = (status: POStatus, size: "sm" | "md" = "sm") => {
    const config = STATUS_CONFIG[status];
    const Icon = config.icon;
    const sizeClasses = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-lg font-medium ${config.bg} ${config.text} ${sizeClasses}`}>
        <Icon size={size === "sm" ? 12 : 14} />
        {config.label}
      </span>
    );
  };

  const updateMenuPosition = (poId: string) => {
    const button = menuButtonRefs.current.get(poId);
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: rect.right - 192,
      openUpward: false,
    });
  };

  const handleMenuToggle = (poId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (openMenuId === poId) {
      setOpenMenuId(null);
    } else {
      setOpenMenuId(poId);
      setTimeout(() => updateMenuPosition(poId), 0);
    }
  };

  const closeMenu = () => setOpenMenuId(null);

  const getRoleBadge = () => {
    if (permissions.isProjectRole) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
          <Eye size={12} />
          Todo el proyecto
        </span>
      );
    }
    if (permissions.canViewDepartmentPOs) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
          <Building2 size={12} />
          {permissions.department}
        </span>
      );
    }
    if (permissions.canViewOwnPOs) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
          <FileText size={12} />
          Mis POs
        </span>
      );
    }
    return null;
  };

  const handleEditDraft = (po: PO) => {
    const perms = getPOPermissions(po);
    if (!perms.canEdit) {
      alert("No tienes permisos para editar esta PO");
      return;
    }
    closeMenu();
    router.push(`/project/${id}/accounting/pos/${po.id}/edit`);
  };

  const handleCreateInvoice = (po: PO) => {
    const perms = getPOPermissions(po);
    if (!perms.canCreateInvoice) {
      alert("No tienes permisos para crear facturas en esta PO");
      return;
    }
    closeMenu();
    router.push(`/project/${id}/accounting/invoices/new?poId=${po.id}`);
  };

  const handleClosePO = (po: PO) => {
    if (po.status !== "approved") return;
    closeMenu();
    setSelectedPO(po);
    resetModalState();
    setShowCloseModal(true);
  };

  const releaseRemainingCommitted = async (po: PO) => {
    const baseAmount = po.baseAmount || po.totalAmount || 0;
    const invoicedAmount = po.invoicedAmount || 0;
    const remainingToRelease = baseAmount - invoicedAmount;

    if (remainingToRelease <= 0) return;

    const accountsSnapshot = await getDocs(collection(db, `projects/${id}/accounts`));

    for (const item of po.items) {
      if (item.subAccountId) {
        const itemBaseAmount = item.baseAmount || item.quantity * item.unitPrice || 0;
        const itemProportion = baseAmount > 0 ? itemBaseAmount / baseAmount : 0;
        const itemRemainingToRelease = remainingToRelease * itemProportion;

        if (itemRemainingToRelease > 0) {
          for (const accountDoc of accountsSnapshot.docs) {
            try {
              const subAccountRef = doc(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`, item.subAccountId);
              const subAccountSnap = await getDoc(subAccountRef);
              if (subAccountSnap.exists()) {
                const currentCommitted = subAccountSnap.data().committed || 0;
                await updateDoc(subAccountRef, {
                  committed: Math.max(0, currentCommitted - itemRemainingToRelease),
                });
                break;
              }
            } catch (e) {
              console.error(`Error releasing committed for subaccount ${item.subAccountId}:`, e);
            }
          }
        }
      }
    }
  };

  const confirmClosePO = async () => {
    if (!selectedPO) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      await releaseRemainingCommitted(selectedPO);

      await updateDoc(doc(db, `projects/${id}/pos`, selectedPO.id), {
        status: "closed",
        closedAt: Timestamp.now(),
        closedBy: permissions.userId,
        closedByName: permissions.userName,
        remainingAmount: 0,
      });
      setShowCloseModal(false);
      resetModalState();
      await loadData();
    } catch (error) {
      console.error("Error:", error);
      alert("Error al cerrar la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleReopenPO = (po: PO) => {
    if (po.status !== "closed") return;
    closeMenu();
    setSelectedPO(po);
    resetModalState();
    setShowReopenModal(true);
  };

  const restoreCommittedOnReopen = async (po: PO) => {
    const baseAmount = po.baseAmount || po.totalAmount || 0;
    const invoicedAmount = po.invoicedAmount || 0;
    const remainingToRestore = baseAmount - invoicedAmount;

    if (remainingToRestore <= 0) return;

    const accountsSnapshot = await getDocs(collection(db, `projects/${id}/accounts`));

    for (const item of po.items) {
      if (item.subAccountId) {
        const itemBaseAmount = item.baseAmount || item.quantity * item.unitPrice || 0;
        const itemProportion = baseAmount > 0 ? itemBaseAmount / baseAmount : 0;
        const itemRemainingToRestore = remainingToRestore * itemProportion;

        if (itemRemainingToRestore > 0) {
          for (const accountDoc of accountsSnapshot.docs) {
            try {
              const subAccountRef = doc(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`, item.subAccountId);
              const subAccountSnap = await getDoc(subAccountRef);
              if (subAccountSnap.exists()) {
                const currentCommitted = subAccountSnap.data().committed || 0;
                await updateDoc(subAccountRef, {
                  committed: currentCommitted + itemRemainingToRestore,
                });
                break;
              }
            } catch (e) {
              console.error(`Error restoring committed for subaccount ${item.subAccountId}:`, e);
            }
          }
        }
      }
    }
  };

  const confirmReopenPO = async () => {
    if (!selectedPO) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      await restoreCommittedOnReopen(selectedPO);

      const baseAmount = selectedPO.baseAmount || selectedPO.totalAmount || 0;
      const invoicedAmount = selectedPO.invoicedAmount || 0;

      await updateDoc(doc(db, `projects/${id}/pos`, selectedPO.id), {
        status: "approved",
        closedAt: null,
        closedBy: null,
        closedByName: null,
        remainingAmount: baseAmount - invoicedAmount,
      });
      setShowReopenModal(false);
      resetModalState();
      await loadData();
    } catch (error) {
      console.error("Error:", error);
      alert("Error al reabrir la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelPO = (po: PO) => {
    if (po.status !== "approved" && po.status !== "draft") return;
    if ((po.invoicedAmount || 0) > 0) return;
    closeMenu();
    setSelectedPO(po);
    resetModalState();
    setShowCancelModal(true);
  };

  const confirmCancelPO = async () => {
    if (!selectedPO || !cancellationReason.trim()) return;
    const verified = await verifyPassword();
    if (!verified) return;
    setProcessing(true);
    try {
      if (selectedPO.status === "approved") {
        for (const item of selectedPO.items) {
          if (item.subAccountId) {
            const itemBaseAmount = item.baseAmount || item.quantity * item.unitPrice || 0;
            const accountsSnap = await getDocs(collection(db, `projects/${id}/accounts`));
            for (const accountDoc of accountsSnap.docs) {
              try {
                const subAccountRef = doc(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`, item.subAccountId);
                const subAccountSnap = await getDoc(subAccountRef);
                if (subAccountSnap.exists()) {
                  await updateDoc(subAccountRef, { committed: Math.max(0, (subAccountSnap.data().committed || 0) - itemBaseAmount) });
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          }
        }
      }
      await updateDoc(doc(db, `projects/${id}/pos`, selectedPO.id), {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: permissions.userId,
        cancelledByName: permissions.userName,
        cancellationReason: cancellationReason.trim(),
        committedAmount: 0,
        remainingAmount: 0,
      });
      setShowCancelModal(false);
      resetModalState();
      await loadData();
    } catch (error) {
      console.error("Error:", error);
      alert("Error al anular la PO");
    } finally {
      setProcessing(false);
    }
  };

  const handleModifyPO = (po: PO) => {
    if (po.status !== "approved") return;
    closeMenu();
    setSelectedPO(po);
    resetModalState();
    setShowModifyModal(true);
  };

  const confirmModifyPO = async () => {
    if (!selectedPO || !modificationReason.trim()) return;
    setProcessing(true);
    try {
      const newVersion = (selectedPO.version || 1) + 1;
      await updateDoc(doc(db, `projects/${id}/pos`, selectedPO.id), {
        version: newVersion,
        status: "draft",
        modificationHistory: [
          ...(selectedPO.modificationHistory || []),
          {
            date: Timestamp.now(),
            userId: permissions.userId || "",
            userName: permissions.userName,
            reason: modificationReason.trim(),
            previousVersion: selectedPO.version || 1,
          },
        ],
        approvedAt: null,
        approvedBy: null,
        approvedByName: null,
        approvalSteps: null,
        approverIds: [],
        currentApprovalStep: null,
      });
      setShowModifyModal(false);
      router.push(`/project/${id}/accounting/pos/${selectedPO.id}/edit`);
    } catch (error) {
      console.error("Error:", error);
      alert("Error al modificar la PO");
    } finally {
      setProcessing(false);
    }
  };

  const generatePDF = (po: PO) => {
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;
    pdf.setFillColor(30, 41, 59);
    pdf.rect(0, 0, pageWidth, 45, "F");
    pdf.setTextColor(255, 255, 255);
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
    pdf.roundedRect(margin, y, pageWidth - margin * 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text("PROVEEDOR", margin + 5, y + 8);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(12);
    pdf.text(po.supplier || "Sin proveedor asignado", margin + 5, y + 18);
    y += 35;
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(margin, y, pageWidth - margin * 2, 25, 3, 3, "F");
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "bold");
    pdf.text("IMPORTE TOTAL", margin + 5, y + 8);
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(16);
    pdf.text(formatCurrency(po.totalAmount) + " €", margin + 5, y + 18);
    y += 35;
    pdf.setTextColor(30, 41, 59);
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "bold");
    pdf.text("ITEMS (" + po.items.length + ")", margin, y);
    y += 8;
    po.items.forEach((item, index) => {
      pdf.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
      pdf.roundedRect(margin, y, pageWidth - margin * 2, 12, 0, 0, "F");
      pdf.setTextColor(30, 41, 59);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      const desc = (item.description || "").substring(0, 50) + ((item.description || "").length > 50 ? "..." : "");
      pdf.text(desc, margin + 5, y + 8);
      pdf.setFont("helvetica", "bold");
      pdf.text(formatCurrency(item.totalAmount) + " €", pageWidth - margin - 25, y + 8);
      y += 12;
    });
    y += 10;
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.text("Generado el " + formatDateTime(new Date()), margin, y);
    pdf.save("PO-" + po.number + (po.version > 1 ? "-V" + String(po.version).padStart(2, "0") : "") + ".pdf");
    closeMenu();
  };

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="hidden">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos para acceder a órdenes de compra"}</p>
          <Link 
            href={`/project/${id}/accounting`} 
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium transition-opacity"
          >
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  // ── Búsqueda avanzada, vistas y filtros ───────────────────────────────────
  type POField = "all" | "number" | "supplier" | "concept" | "account" | "amount";
  const PO_FIELDS: SearchField<POField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Número, proveedor o concepto" },
    { value: "number", label: "Nº de PO", placeholder: "Ej. 0012", mono: true },
    { value: "supplier", label: "Proveedor", placeholder: "Ej. Rental Norte" },
    { value: "concept", label: "Concepto", placeholder: "Ej. alquiler" },
    { value: "account", label: "Cuenta", placeholder: "Ej. 03.01 o atrezzo", mono: true },
    { value: "amount", label: "Importe", placeholder: "1500 · >1000 · 500-2000", mono: true },
  ];
  const poMatches = (po: PO) => {
    const q = searchTerm.trim();
    if (!q) return true;
    const byNumber = matchCode(q, `PO-${po.number}`, po.number);
    const bySupplier = matchWords(q, po.supplier);
    const byConcept = matchWords(q, po.generalDescription, po.description, ...(po.items || []).map((i) => i.description));
    const byAccount = (po.items || []).some((i) => matchCode(q, i.subAccountCode) || matchWords(q, (i as any).subAccountDescription));
    const byAmount = matchAmount(q, po.baseAmount || po.totalAmount || 0, po.totalAmount || 0);
    if (poField === "number") return byNumber;
    if (poField === "supplier") return bySupplier;
    if (poField === "concept") return byConcept;
    if (poField === "account") return byAccount;
    if (poField === "amount") return byAmount === true;
    return byNumber || bySupplier || byConcept || byAccount || byAmount === true;
  };
  const departments = Array.from(new Set(pos.map((p) => p.department).filter(Boolean))) as string[];
  const rows = pos
    .filter((po) => statusFilter === "all" || po.status === statusFilter)
    .filter((po) => !supplierParam || po.supplierId === supplierParam)
    .filter((po) => deptFilter === "all" || po.department === deptFilter)
    .filter((po) => !onlyMine || po.createdBy === permissions.userId)
    .filter((po) => !nearlyExhausted || (po.status === "approved" && (po.baseAmount || po.totalAmount) > 0 && po.invoicedAmount / (po.baseAmount || po.totalAmount) >= 0.9))
    .filter(poMatches)
    .sort((a, b) => {
      if (poSort === "amount") return (b.baseAmount || b.totalAmount || 0) - (a.baseAmount || a.totalAmount || 0);
      const d = (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0);
      return poSort === "old" ? -d : d;
    });
  const statusCount = (s: "all" | POStatus) => (s === "all" ? pos.length : pos.filter((p) => p.status === s).length);
  const supplierName = supplierParam ? pos.find((p) => p.supplierId === supplierParam)?.supplier : null;
  const filtersActive = deptFilter !== "all" || onlyMine || nearlyExhausted || !!supplierParam;
  const live = rows.filter((p) => p.status !== "cancelled");
  const totals = {
    base: live.reduce((s, p) => s + (p.baseAmount || p.totalAmount || 0), 0),
    invoiced: live.reduce((s, p) => s + (p.invoicedAmount || 0), 0),
  };
  const PO_STATE: Record<POStatus, { label: string; dot: string; text: string }> = {
    draft: { label: "Borrador", dot: "bg-slate-300", text: "text-slate-600" },
    pending: { label: "Pend. aprobación", dot: "bg-amber-500", text: "text-amber-800" },
    approved: { label: "Aprobada", dot: "bg-emerald-500", text: "text-emerald-800" },
    closed: { label: "Cerrada", dot: "bg-slate-400", text: "text-slate-600" },
    cancelled: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500 line-through" },
  };

  return (
    <Page>
      <PageHeader
        title={
          <>
            Órdenes de compra <span className="text-[15px] font-normal text-slate-400">{pos.length}</span>
            {!permissions.canViewAllPOs && (
              <span className="text-xs font-normal text-slate-500">· {permissions.canViewDepartmentPOs ? permissions.department : "solo tus POs"}</span>
            )}
          </>
        }
        actions={
          permissions.canCreatePO ? (
            <Link href={`/project/${id}/accounting/pos/new`} className={buttonClass("primary")}><Plus size={14} /> Nueva PO</Link>
          ) : undefined
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex gap-0.5 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="tablist" aria-label="Estado">
          {(["all", "draft", "pending", "approved", "closed", "cancelled"] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${statusFilter === s ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
            >
              {s === "all" ? "Todas" : PO_STATE[s].label.replace("Pend. aprobación", "Pendientes")}
              <span className="tabular-nums text-slate-400">{statusCount(s)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={PO_FIELDS} field={poField} onField={setPoField} value={searchTerm} onChange={setSearchTerm} count={rows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
        {departments.length > 1 && (
          <div className="w-44">
            <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="all">Todos los dptos.</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
        )}
        <Segmented value={poSort} onChange={setPoSort} options={[{ value: "recent", label: "Recientes" }, { value: "old", label: "Antiguas" }, { value: "amount", label: "Importe" }]} />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-4">
        <Checkbox label="Solo mías" checked={onlyMine} onChange={setOnlyMine} />
        <Checkbox label="Casi agotadas (≥ 90 % facturado)" checked={nearlyExhausted} onChange={setNearlyExhausted} />
        {supplierName && (
          <button onClick={() => router.replace(`/project/${id}/accounting/pos`)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-xs text-slate-700 hover:border-slate-300">
            Proveedor: {supplierName} <X size={11} />
          </button>
        )}
        {filtersActive && (
          <button onClick={() => { setDeptFilter("all"); setOnlyMine(false); setNearlyExhausted(false); if (supplierParam) router.replace(`/project/${id}/accounting/pos`); }} className="text-xs text-slate-500 hover:text-slate-900">Quitar filtros</button>
        )}
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title={pos.length ? "Sin resultados" : "Sin órdenes de compra"}
            action={!pos.length && permissions.canCreatePO ? <Link href={`/project/${id}/accounting/pos/new`} className={buttonClass("primary", "sm")}>Nueva PO</Link> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[1000px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Nº</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Departamento</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Base</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Facturado</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Fecha</th>
                  <th scope="col" className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((po) => {
                  const base = po.baseAmount || po.totalAmount || 0;
                  const pct = base > 0 ? Math.round((po.invoicedAmount / base) * 100) : 0;
                  const st = PO_STATE[po.status] || PO_STATE.draft;
                  const href = `/project/${id}/accounting/pos/${po.id}`;
                  const poPerms = getPOPermissions(po);
                  const dead = po.status === "cancelled";
                  return (
                    <tr key={po.id} className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${dead ? "text-slate-400" : ""}`} onClick={() => router.push(href)}>
                      <td className="whitespace-nowrap px-4 py-1.5">
                        <span className="flex items-center gap-1.5">
                          <Link href={href} onClick={(e) => e.stopPropagation()} className={`font-mono text-xs font-medium hover:underline ${dead ? "line-through" : ""}`}>PO-{po.number}</Link>
                          {po.version > 1 && <span className="font-mono text-[10px] text-slate-500">v{po.version}</span>}
                        </span>
                      </td>
                      <td className="max-w-[320px] px-3 py-1.5">
                        <span className={`block truncate font-medium ${po.supplier ? "text-slate-900" : "italic text-slate-400"}`}>{po.supplier || "Sin proveedor"}</span>
                        {(po.generalDescription || po.description) && <span className="block truncate text-xs text-slate-500">{po.generalDescription || po.description}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{po.department || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs font-medium">{formatCurrency(base)}</td>
                      <td className="px-3 py-1.5">
                        {po.status === "approved" || po.status === "closed" ? (
                          <span className="flex items-center gap-2">
                            <span aria-hidden="true" className="flex h-[3px] w-16 overflow-hidden rounded-full bg-[#F1F1F3]">
                              <span className={pct >= 100 ? "bg-slate-500" : pct >= 90 ? "bg-amber-600" : "bg-[#2F52E0]"} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </span>
                            <span className={`w-9 text-right text-xs tabular-nums ${pct >= 90 && pct < 100 ? "text-amber-800" : "text-slate-600"}`}>{pct} %</span>
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className={`inline-flex items-center gap-1.5 text-xs ${st.text}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500" title={formatDateTime(po.createdAt)}>{formatDateRelative(po.createdAt)}</td>
                      <td className="py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Menu trigger={(toggle) => <IconButton label="Acciones" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); setPreviewPO(po); }}>Vista rápida</MenuItem>
                              <MenuItem onClick={() => { close(); router.push(href); }}>Abrir</MenuItem>
                              <MenuItem onClick={() => { close(); generatePDF(po); }}>Descargar PDF</MenuItem>
                              {po.status === "draft" && poPerms.canEdit && <MenuItem onClick={() => { close(); handleEditDraft(po); }}>Editar borrador</MenuItem>}
                              {po.status === "approved" && poPerms.canCreateInvoice && <MenuItem onClick={() => { close(); handleCreateInvoice(po); }}>Subir factura de esta PO</MenuItem>}
                              {po.status === "approved" && (permissions.isProjectRole || poPerms.canClose || poPerms.canCancel) && <MenuSeparator />}
                              {po.status === "approved" && permissions.isProjectRole && <MenuItem onClick={() => { close(); handleModifyPO(po); }}>Modificar</MenuItem>}
                              {po.status === "approved" && poPerms.canClose && <MenuItem onClick={() => { close(); handleClosePO(po); }}>Cerrar</MenuItem>}
                              {po.status === "approved" && poPerms.canCancel && (po.invoicedAmount || 0) === 0 && <MenuItem danger onClick={() => { close(); handleCancelPO(po); }}>Anular</MenuItem>}
                              {po.status === "closed" && poPerms.canReopen && <MenuItem onClick={() => { close(); handleReopenPO(po); }}>Reabrir</MenuItem>}
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                  <td className="px-4 py-2 font-semibold" colSpan={3}>Total {rows.length === pos.length ? "" : "filtrado "}sin anuladas</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(totals.base)}</td>
                  <td className="px-3 py-2 font-mono text-slate-600">{formatCurrency(totals.invoiced)} facturado</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Vista rápida */}
      <Modal
        open={!!previewPO}
        onClose={() => setPreviewPO(null)}
        title={previewPO ? `PO-${previewPO.number}${previewPO.version > 1 ? ` · V${String(previewPO.version).padStart(2, "0")}` : ""}` : ""}
        footer={previewPO ? (
          <Link href={`/project/${id}/accounting/pos/${previewPO.id}`} onClick={() => setPreviewPO(null)} className={buttonClass("primary")}>Abrir PO</Link>
        ) : undefined}
      >
        {previewPO && (() => {
          const base = previewPO.baseAmount || previewPO.totalAmount || 0;
          const pct = base ? Math.min(100, ((previewPO.invoicedAmount || 0) / base) * 100) : 0;
          return (
            <div className="flex flex-col gap-4 text-[13px]">
              <div>
                <p className="font-medium text-slate-900">{previewPO.supplier || "Sin proveedor"}</p>
                {(previewPO.generalDescription || previewPO.description) && <p className="mt-1 text-slate-600">{previewPO.generalDescription || previewPO.description}</p>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-slate-500">Base</dt><dd className="text-right font-mono">{formatCurrency(base)} €</dd>
                <dt className="text-slate-500">Total con IVA</dt><dd className="text-right font-mono">{formatCurrency(previewPO.totalAmount)} €</dd>
                {previewPO.status === "approved" && (<><dt className="text-slate-500">Facturado</dt><dd className="text-right font-mono">{formatCurrency(previewPO.invoicedAmount || 0)} € · {pct.toFixed(0)} %</dd></>)}
                <dt className="text-slate-500">Líneas</dt><dd className="text-right font-mono">{previewPO.items?.length || 0}</dd>
                <dt className="text-slate-500">Fecha</dt><dd className="text-right">{formatDate(previewPO.createdAt)}</dd>
                <dt className="text-slate-500">Creada por</dt><dd className="text-right">{previewPO.createdByName}</dd>
                {previewPO.department && (<><dt className="text-slate-500">Departamento</dt><dd className="text-right">{previewPO.department}</dd></>)}
              </dl>
              {previewPO.status === "approved" && (
                <div className="h-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#2F52E0]" style={{ width: `${pct}%` }} /></div>
              )}
            </div>
          );
        })()}
      </Modal>

      {selectedPO && (() => {
        const base = selectedPO.baseAmount || selectedPO.totalAmount || 0;
        const pending = base - (selectedPO.invoicedAmount || 0);
        const pwd = { value: passwordInput, onChange: (v: string) => { setPasswordInput(v); setPasswordError(""); }, error: passwordError, email: permissions.userEmail };
        return (
          <>
            <ActionModal
              open={showCloseModal}
              onClose={() => { setShowCloseModal(false); resetModalState(); }}
              title={`Cerrar PO-${selectedPO.number}`}
              notice={pending > 0 ? <>Queda <b>{formatCurrency(pending)} €</b> sin facturar. Al cerrar la PO se libera ese comprometido del presupuesto.</> : undefined}
              password={pwd}
              confirmLabel="Cerrar PO"
              processingLabel="Cerrando…"
              processing={processing}
              onConfirm={confirmClosePO}
            />
            <ActionModal
              open={showReopenModal}
              onClose={() => { setShowReopenModal(false); resetModalState(); }}
              title={`Reabrir PO-${selectedPO.number}`}
              subtitle="Vuelve a estar aprobada."
              notice={<>Se vuelven a comprometer <b>{formatCurrency(pending)} €</b> del presupuesto.</>}
              password={pwd}
              confirmLabel="Reabrir PO"
              processingLabel="Reabriendo…"
              processing={processing}
              onConfirm={confirmReopenPO}
            />
            <ActionModal
              open={showCancelModal}
              onClose={() => { setShowCancelModal(false); resetModalState(); }}
              title={`Anular PO-${selectedPO.number}`}
              subtitle="No se puede deshacer."
              notice={selectedPO.status === "approved" ? <>Se liberan <b>{formatCurrency(selectedPO.committedAmount || base)} €</b> comprometidos.</> : undefined}
              reason={{ label: "Motivo de la anulación", value: cancellationReason, onChange: setCancellationReason, placeholder: "Por qué se anula" }}
              password={pwd}
              confirmLabel="Anular PO"
              processingLabel="Anulando…"
              processing={processing}
              danger
              onConfirm={confirmCancelPO}
            />
            <ActionModal
              open={showModifyModal}
              onClose={() => { setShowModifyModal(false); resetModalState(); }}
              title={`Modificar PO-${selectedPO.number}`}
              notice={<>Pasa a la versión <b>V{String((selectedPO.version || 1) + 1).padStart(2, "0")}</b> en borrador. Tendrás que editarla y enviarla de nuevo a aprobación.</>}
              reason={{ label: "Motivo de la modificación", value: modificationReason, onChange: setModificationReason, placeholder: "Qué cambia y por qué", rows: 4 }}
              confirmLabel="Modificar"
              processingLabel="Modificando…"
              processing={processing}
              onConfirm={confirmModifyPO}
            />
          </>
        );
      })()}
    </Page>
  );
}
