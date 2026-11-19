"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useCanSeeBudget } from "@/hooks/useCanSeeBudget";
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel, Input, Modal } from "@/components/ds";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db, storage } from "@/lib/firebase";
import { AccountPickerModal, EpisodeModal, POItemsModal, SupplierPickerModal } from "@/components/accounting/Pickers";
import { documentTotals, lineAmounts } from "@/lib/amounts";
import { getScopedDocs, scopeFromPermissions } from "@/lib/accountingScope";
import { nextDocNumber } from "@/lib/docCounter";
import { approverIdsOf } from "@/lib/approvers";
import { ApprovalSteps } from "@/components/accounting/ApprovalFlow";
import { buildFlow, type ApprovalStepConfig, type FlowMember } from "@/lib/approvalFlow";
import { loadBudgetFigures } from "@/lib/budgetFigures";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
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
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Euro,
  FileBox,
  FileCheck,
  FileText,
  Hash,
  Info,
  Layers,
  Lock,
  Percent,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShoppingCart,
  Split,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { getCostSettings, shouldRealizeInvoice } from "@/lib/budgetRules";
import { realizeInvoice, updatePOItemsInvoiced } from "@/lib/budgetOperations";


// ─── Types ───────────────────────────────────────────────────────────────────

interface DueDateEntry {
  id: string;
  date: string;
  type: "percentage" | "amount";
  percentage: number;
  amount: number;
}

// Helper para clases condicionales
function cx(...args: (string | boolean | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_TYPES = {
  invoice: {
    code: "FRA",
    label: "Factura",
    article: "de la",
    icon: Receipt,
    bgColor: "bg-emerald-50",
    textColor: "text-emerald-700",
    borderColor: "border-emerald-200",
    requiresReplacement: false,
  },
  proforma: {
    code: "PRF",
    label: "Proforma",
    article: "de la",
    icon: FileText,
    bgColor: "bg-[#F7F7F8]",
    textColor: "text-slate-900",
    borderColor: "border-slate-200",
    requiresReplacement: true,
  },
  budget: {
    code: "PRS",
    label: "Presupuesto",
    article: "del",
    icon: FileCheck,
    bgColor: "bg-amber-50",
    textColor: "text-amber-700",
    borderColor: "border-amber-200",
    requiresReplacement: true,
  },
  guarantee: {
    code: "FNZ",
    label: "Fianza",
    article: "de la",
    icon: Shield,
    bgColor: "bg-slate-100",
    textColor: "text-slate-700",
    borderColor: "border-slate-300",
    requiresReplacement: false,
  },
};

type DocumentType = keyof typeof DOCUMENT_TYPES;

// Interfaces
interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

interface PO {
  id: string;
  createdBy?: string;
  number: string;
  supplier: string;
  supplierId: string;
  department?: string;
  totalAmount: number;
  baseAmount?: number;
  items: POItem[];
}

interface POItem {
  id?: string;
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
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface POItemWithInvoiced extends POItem {
  invoicedAmount: number;
  availableAmount: number;
}

interface InvoiceItem {
  id: string;
  description: string;
  poItemId?: string;
  poItemIndex?: number;
  isNewItem: boolean;
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
  episodeAssignment?: "general" | "specific";
  episodes?: EpisodeDistribution[];
}

interface SubAccount {
  id: string;
  code: string;
  description: string;
  budgeted: number;
  committed: number;
  actual: number;
  available: number;
  accountId: string;
  accountCode: string;
  accountDescription: string;
}

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName?: string;
  taxId: string;
}

interface Member {
  userId: string;
  permissions?: { accounting?: boolean } | null;
  accountingAccessLevel?: string | null;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
  position?: string;
}

interface ApprovalStep {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers?: string[];
  roles?: string[];
  department?: string;
  requireAll: boolean;
}

interface ApprovalStepStatus {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers: string[];
  approverNames: string[];
  roles?: string[];
  department?: string;
  approvedBy: string[];
  rejectedBy: string[];
  status: "pending" | "approved" | "rejected" | "skipped";
  skipReason?: string | null;
  requireAll: boolean;
}

interface PendingDocument {
  id: string;
  documentType: DocumentType;
  number: string;
  displayNumber: string;
  supplier: string;
  supplierId: string;
  department?: string;
  totalAmount: number;
  baseAmount: number;
  paidAt: Date;
  poId?: string;
  poNumber?: string;
  items: any[];
  description: string;
}

// Constantes
const VAT_RATES = [
  { value: 0, label: "0%" },
  { value: 4, label: "4%" },
  { value: 10, label: "10%" },
  { value: 21, label: "21%" },
];

const IRPF_RATES = [
  { value: 0, label: "0%" },
  { value: 7, label: "7%" },
  { value: 15, label: "15%" },
  { value: 19, label: "19%" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function NewInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const canSeeBudgetFigures = useCanSeeBudget(id);
  const linkToId = searchParams.get("linkTo");
  const preselectedPoId = searchParams.get("poId");
  const { loading: permissionsLoading, error: permissionsError, permissions } = useAccountingPermissions(id);

  // Estados básicos
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nextNumber, setNextNumber] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Sistema de borradores (localStorage)
  interface Draft {
    id: string;
    name: string;
    savedAt: string;
    formData: any;
    items: InvoiceItem[];
  }
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);

  // Estados de datos
  const [members, setMembers] = useState<Member[]>([]);
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);
  const [linkedDocumentId, setLinkedDocumentId] = useState<string>("");

  // Estados de modales
  const [showPOModal, setShowPOModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showCreateSupplierModal, setShowCreateSupplierModal] = useState(false);
  const [showPOItemsModal, setShowPOItemsModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);

  // Estados de búsqueda
  const [poSearch, setPOSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");

  // Estados de datos de formulario
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [newSupplierData, setNewSupplierData] = useState({ fiscalName: "", taxId: "" });
  const [pos, setPOs] = useState<PO[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedPO, setSelectedPO] = useState<PO | null>(null);
  const [poItemsWithInvoiced, setPOItemsWithInvoiced] = useState<POItemWithInvoiced[]>([]);

  const [formData, setFormData] = useState({
    invoiceType: "with-po" as "with-po" | "without-po",
    supplier: "",
    supplierName: "",
    department: "",
    description: "",
    dueDate: "",
    notes: "",
  });

  // Estado para vencimientos múltiples
  const [multipleDueDates, setMultipleDueDates] = useState(false);
  const [dueDates, setDueDates] = useState<DueDateEntry[]>([]);

  const [items, setItems] = useState<InvoiceItem[]>([]);
  
  // Estado para delegar codificación a contabilidad
  const [delegateToAccounting, setDelegateToAccounting] = useState(false);

  const [totals, setTotals] = useState({
    baseAmount: 0,
    vatAmount: 0,
    irpfAmount: 0,
    totalAmount: 0,
  });

  const [poStats, setPOStats] = useState({
    totalAmount: 0,
    invoicedAmount: 0,
    percentageInvoiced: 0,
    isOverInvoiced: false,
  });

  // Estados de episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount" | "percentage">("equal");
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(
    showPOModal || showAccountModal || showSupplierModal || showCreateSupplierModal ||
    showPOItemsModal || showReplaceModal || showEpisodeModal
  );

  // Estados de reemplazo
  const [selectedPendingDoc, setSelectedPendingDoc] = useState<PendingDocument | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [sameAmount, setSameAmount] = useState(true);
  const [amountDifference, setAmountDifference] = useState(0);
  const [differenceReason, setDifferenceReason] = useState("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Computados
  const currentDocType = DOCUMENT_TYPES[documentType];
  const DocIcon = currentDocType.icon;

  const getDocumentNumber = () => {
    if (nextNumber === "NUEVO") return currentDocType.code + "-NUEVO";
    return currentDocType.code + "-" + nextNumber;
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".custom-dropdown")) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Effects
  useEffect(() => {
    if (!permissionsLoading && permissions.userId && id) {
      loadData();
    }
  }, [permissionsLoading, permissions.userId, id]);

  useEffect(() => {
    calculateTotals();
  }, [items]);

  useEffect(() => {
    if (selectedPO) {
      calculatePOStats();
      loadPOItemsInvoiced();
    }
  }, [selectedPO]);

  useEffect(() => {
    if (selectedPO && poItemsWithInvoiced.length > 0) {
      updateAvailableWithCurrentItems();
    }
  }, [items, poItemsWithInvoiced.length]);

  useEffect(() => {
    if (id) {
      setNextNumber("NUEVO");
    }
  }, [id]);

  useEffect(() => {
    if (Object.keys(touched).length > 0) {
      validateForm();
    }
  }, [formData, items, uploadedFile, selectedPO]);

  useEffect(() => {
    if (replaceMode && selectedPendingDoc) {
      const diff = totals.totalAmount - selectedPendingDoc.totalAmount;
      setAmountDifference(diff);
      setSameAmount(Math.abs(diff) < 0.01);
    }
  }, [totals.totalAmount, selectedPendingDoc, replaceMode]);

  // Actualizar importes de vencimientos cuando cambia el total
  useEffect(() => {
    if (multipleDueDates && dueDates.length > 0 && totals.totalAmount > 0) {
      setDueDates(dueDates.map(d => ({
        ...d,
        amount: totals.totalAmount * (d.percentage / 100)
      })));
    }
  }, [totals.totalAmount]);

  // Cargar borradores desde localStorage
  useEffect(() => {
    if (id) {
      const savedDrafts = localStorage.getItem(`invoice_drafts_${id}`);
      if (savedDrafts) {
        try {
          setDrafts(JSON.parse(savedDrafts));
        } catch (e) {}
      }
    }
  }, [id]);

  // Funciones de borradores
  const saveDraft = () => {
    const hasContent = formData.supplier || formData.description || 
                       items.some(item => item.description || item.unitPrice > 0);
    if (!hasContent) {
      setErrorMessage("No hay contenido para guardar");
      setTimeout(() => setErrorMessage(""), 2000);
      return;
    }

    const newDraft: Draft = {
      id: `draft_${Date.now()}`,
      name: formData.supplierName || formData.description || `Borrador ${drafts.length + 1}`,
      savedAt: new Date().toISOString(),
      formData,
      items,
    };
    
    const updatedDrafts = [...drafts, newDraft];
    setDrafts(updatedDrafts);
    localStorage.setItem(`invoice_drafts_${id}`, JSON.stringify(updatedDrafts));
    setSuccessMessage("Borrador guardado");
    setTimeout(() => setSuccessMessage(""), 2000);
    setShowDraftsPanel(false);
  };

  const loadDraft = (draft: Draft) => {
    setFormData(draft.formData);
    setItems(draft.items);
    setShowDraftsPanel(false);
    setSuccessMessage("Borrador cargado");
    setTimeout(() => setSuccessMessage(""), 2000);
  };

  const deleteDraft = (draftId: string) => {
    const updatedDrafts = drafts.filter(d => d.id !== draftId);
    setDrafts(updatedDrafts);
    localStorage.setItem(`invoice_drafts_${id}`, JSON.stringify(updatedDrafts));
  };

  // Estado para trackear si ya se procesó el linkTo
  const [linkToProcessed, setLinkToProcessed] = useState(false);

  // Funciones de carga de datos
  const loadData = async () => {
    try {
      setLoading(true);

      // Cargar proyecto
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
      }

      // Cargar miembros
      const membersSnap = await getDocs(collection(db, "projects/" + id + "/members"));
      const membersData: Member[] = [];
      for (const mDoc of membersSnap.docs) {
        const mData = mDoc.data();
        let name = mData.name || mData.email || mDoc.id;
        try {
          const uDoc = await getDoc(doc(db, "users", mDoc.id));
          if (uDoc.exists()) {
            name = uDoc.data().displayName || uDoc.data().email || name;
          }
        } catch (e) {}
        membersData.push({
          userId: mDoc.id,
          name: name,
          email: mData.email,
          role: mData.role,
          department: mData.department,
          position: mData.position,
          permissions: mData.permissions || null,
          accountingAccessLevel: mData.accountingAccessLevel || null,
        });
      }
      setMembers(membersData);

      // Cargar configuración de aprobaciones
      const approvalDoc = await getDoc(doc(db, "projects/" + id + "/config/approvals"));
      if (approvalDoc.exists()) {
        setApprovalConfig(approvalDoc.data().invoiceApprovals || []);
      } else {
        setApprovalConfig([
          { id: "default-1", order: 1, approverType: "role", roles: ["Controller", "PM", "EP"], requireAll: false },
        ]);
      }

      // Cargar POs aprobadas
      try {
        const posSnap = {
          docs: (await getScopedDocs(collection(db, "projects/" + id + "/pos"), scopeFromPermissions(permissions), [where("status", "==", "approved")]))
            .filter((d) => d.data().status === "approved"),
        };
        const allPOs = posSnap.docs.map((d) => ({
          id: d.id,
          createdBy: d.data().createdBy || "",
          number: d.data().number,
          supplier: d.data().supplier,
          supplierId: d.data().supplierId,
          department: d.data().department || "",
          totalAmount: d.data().totalAmount || 0,
          baseAmount: d.data().baseAmount || d.data().totalAmount || 0,
          items: (d.data().items || []).map((item: any, idx: number) => ({
            ...item,
            id: item.id || "item-" + idx,
          })),
        }));
        allPOs.sort((a, b) => b.number.localeCompare(a.number));

        const filteredPOs = allPOs.filter((po) => {
          if (permissions.canViewAllPOs) return true;
          if (permissions.canViewDepartmentPOs && po.department === permissions.department) return true;
          return false;
        });
        setPOs(filteredPOs);

        // Preseleccionar PO si viene de po-detail
        if (preselectedPoId) {
          const preselectedPO = filteredPOs.find(po => po.id === preselectedPoId);
          if (preselectedPO) {
            setSelectedPO(preselectedPO);
            setFormData(prev => ({
              ...prev,
              invoiceType: "with-po",
              supplier: preselectedPO.supplierId,
              supplierName: preselectedPO.supplier,
              department: preselectedPO.department || "",
            }));
          }
        }
      } catch (posErr) {
        console.error("Error loading POs:", posErr);
      }

      // Cargar proveedores
      try {
        const suppSnap = await getDocs(collection(db, "projects/" + id + "/suppliers"));
        const suppList = suppSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Supplier));
        suppList.sort((a, b) => (a.fiscalName || "").localeCompare(b.fiscalName || ""));
        setSuppliers(suppList);
      } catch (suppErr) {
        console.error("Error loading suppliers:", suppErr);
      }

      // Cargar cuentas
      try {
        const accsSnap = await getDocs(collection(db, "projects/" + id + "/accounts"));
        const figures = await loadBudgetFigures(id as string);
        const accsList = accsSnap.docs.slice().sort((a, b) => (a.data().code || "").localeCompare(b.data().code || ""));
        const allSubs: SubAccount[] = [];

        for (const accDoc of accsList) {
          const accData = accDoc.data();
          const subsSnap = await getDocs(collection(db, "projects/" + id + "/accounts/" + accDoc.id + "/subaccounts"));
          const subsList = subsSnap.docs.slice().sort((a, b) => (a.data().code || "").localeCompare(b.data().code || ""));

          subsList.forEach((s) => {
            const d = s.data();
            allSubs.push({
              id: s.id,
              code: d.code,
              description: d.description,
              budgeted: figures[s.id] ?? d.budgeted ?? 0,
              committed: d.committed || 0,
              actual: d.actual || 0,
              available: (figures[s.id] ?? d.budgeted ?? 0) - (d.committed || 0) - (d.actual || 0),
              accountId: accDoc.id,
              accountCode: accData.code,
              accountDescription: accData.description,
            });
          });
        }
        setSubAccounts(allSubs);
      } catch (accsErr) {
        console.error("Error loading accounts:", accsErr);
      }

      // Cargar documentos pendientes de sustitución
      try {
        const pendingSnap = {
          docs: (await getScopedDocs(collection(db, "projects/" + id + "/invoices"), scopeFromPermissions(permissions), [where("requiresReplacement", "==", true)]))
            .filter((d) => d.data().requiresReplacement === true),
        };

        const pendingDocs = pendingSnap.docs
          // Pagados: nuevo modelo usa paidAt; compat con status "paid".
          .filter((d) => (d.data().paidAt || d.data().status === "paid") && !d.data().replacedByInvoiceId)
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              documentType: data.documentType || "proforma",
              number: data.number,
              displayNumber: data.displayNumber || (DOCUMENT_TYPES[data.documentType as DocumentType]?.code || "PRF") + "-" + data.number,
              supplier: data.supplier,
              supplierId: data.supplierId,
              department: data.department || "",
              totalAmount: data.totalAmount,
              baseAmount: data.baseAmount || data.totalAmount,
              paidAt: data.paidAt?.toDate() || new Date(),
              poId: data.poId || null,
              poNumber: data.poNumber || null,
              items: data.items || [],
              description: data.description || "",
            };
          })
          .filter((pd) => {
            if (permissions.canViewAllPOs) return true;
            if (permissions.canViewDepartmentPOs && pd.department === permissions.department) return true;
            return false;
          });

        setPendingDocuments(pendingDocs);
      } catch (pendingErr) {
        console.error("Error loading pending docs:", pendingErr);
      }

      // Cargar configuración de episodios
      try {
        const productionDoc = await getDoc(doc(db, "projects/" + id + "/config/production"));
        if (productionDoc.exists()) {
          const prodData = productionDoc.data();
          if (prodData.projectType === "serie") {
            setTotalEpisodes(prodData.episodes || 0);
            
            const projectConfigDoc = await getDoc(doc(db, "projects/" + id + "/config/project"));
            if (projectConfigDoc.exists()) {
              const configData = projectConfigDoc.data();
              setEpisodesEnabled(configData.enableEpisodes || false);
            }
          }
        }
      } catch (epErr) {
        console.error("Error loading episodes config:", epErr);
      }

      // Establecer fecha de vencimiento por defecto (30 días)
      const dd = new Date();
      dd.setDate(dd.getDate() + 30);
      setFormData((p) => ({
        ...p,
        dueDate: dd.toISOString().split("T")[0],
        department: permissions.fixedDepartment || "",
      }));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Facturas vigentes de una PO que este usuario puede leer (lib/accountingScope).
  const invoicesOfPO = async (poId: string) =>
    (await getScopedDocs(collection(db, "projects/" + id + "/invoices"), scopeFromPermissions(permissions), [
      where("poId", "==", poId),
      where("status", "in", ["pending", "pending_approval", "approved", "paid", "overdue"]),
    ])).filter((d) => d.data().poId === poId && ["pending", "pending_approval", "approved", "paid", "overdue"].includes(d.data().status));

  const loadPOItemsInvoiced = async () => {
    if (!selectedPO) return;

    try {
      const invSnap = { docs: await invoicesOfPO(selectedPO.id) };

      const invoicedByItem: Record<string, number> = {};
      invSnap.docs.forEach((invDoc) => {
        (invDoc.data().items || []).forEach((invItem: any) => {
          if (invItem.poItemId || invItem.poItemIndex !== undefined) {
            const key = invItem.poItemId || "index-" + invItem.poItemIndex;
            invoicedByItem[key] = (invoicedByItem[key] || 0) + (invItem.totalAmount || 0);
          }
        });
      });

      setPOItemsWithInvoiced(
        selectedPO.items.map((item, idx) => {
          const key = item.id || "index-" + idx;
          const invoicedAmount = invoicedByItem[key] || 0;
          return {
            ...item,
            id: item.id || "item-" + idx,
            invoicedAmount: invoicedAmount,
            availableAmount: item.totalAmount - invoicedAmount,
          };
        })
      );
    } catch (e) {
      console.error(e);
    }
  };

  const updateAvailableWithCurrentItems = () => {
    const currentByItem: Record<string, number> = {};
    items.forEach((item) => {
      if (item.poItemId) {
        currentByItem[item.poItemId] = (currentByItem[item.poItemId] || 0) + item.totalAmount;
      }
    });

    setPOItemsWithInvoiced((prev) =>
      prev.map((poItem) => ({
        ...poItem,
        availableAmount: poItem.totalAmount - poItem.invoicedAmount - (currentByItem[poItem.id!] || 0),
      }))
    );
  };

  // Funciones de aprobación
  // Flujo de aprobación: lógica única en lib/approvalFlow (pasos sin aprobador
  // o fuera de umbral se omiten con su motivo; nunca se bloquea).
  const generateApprovalSteps = (): ApprovalStepStatus[] =>
    buildFlow(approvalConfig as ApprovalStepConfig[], members as FlowMember[], { department: formData.department || selectedPO?.department || permissions.fixedDepartment || "", baseAmount: totals.baseAmount }).steps as unknown as ApprovalStepStatus[];

  const shouldAutoApprove = (steps: ApprovalStepStatus[]): boolean => !steps.some((s) => s.status === "pending");

  const getApprovalPreview = () => {
    const steps = generateApprovalSteps();
    const pending = steps.filter((s) => s.status === "pending").length;
    if (!pending) return { autoApprove: true, message: "Se aprobará automáticamente", steps };
    return { autoApprove: false, message: pending + " nivel" + (pending > 1 ? "es" : "") + " de aprobación", steps };
  };


  // Funciones de cálculo
  // Importes redondeados a céntimos (lib/amounts)
  const calculateItemTotal = (item: InvoiceItem) => lineAmounts(item);

  const calculateTotals = () => {
    setTotals(documentTotals(items));
  };

  const calculatePOStats = async () => {
    if (!selectedPO) return;

    try {
      const invSnap = { docs: await invoicesOfPO(selectedPO.id) };

      const invoiced = invSnap.docs.reduce((s, d) => s + (d.data().totalAmount || 0), 0) + totals.totalAmount;

      setPOStats({
        totalAmount: selectedPO.totalAmount,
        invoicedAmount: invoiced,
        percentageInvoiced: selectedPO.totalAmount > 0 ? (invoiced / selectedPO.totalAmount) * 100 : 0,
        isOverInvoiced: invoiced > selectedPO.totalAmount,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // Funciones de items
  const updateItem = (i: number, field: keyof InvoiceItem, value: any) => {
    const n = [...items];
    n[i] = { ...n[i], [field]: value, ...calculateItemTotal({ ...n[i], [field]: value }) };
    setItems(n);
    setTouched((p) => ({ ...p, ["item_" + i + "_" + field]: true }));
  };

  const addNewItem = () => {
    setItems([
      ...items,
      {
        id: String(Date.now()),
        description: "",
        isNewItem: true,
        subAccountId: "",
        subAccountCode: "",
        subAccountDescription: "",
        quantity: 1,
        unitPrice: 0,
        baseAmount: 0,
        vatRate: 21,
        vatAmount: 0,
        irpfRate: 0,
        irpfAmount: 0,
        totalAmount: 0,
        episodeAssignment: "general",
      },
    ]);
  };

  const addPOItemToInvoice = (poItem: POItemWithInvoiced, idx: number) => {
    setItems([
      ...items,
      {
        id: String(Date.now()),
        description: poItem.description,
        poItemId: poItem.id,
        poItemIndex: idx,
        isNewItem: false,
        subAccountId: poItem.subAccountId,
        subAccountCode: poItem.subAccountCode,
        subAccountDescription: poItem.subAccountDescription,
        quantity: poItem.quantity,
        unitPrice: poItem.unitPrice,
        baseAmount: poItem.baseAmount,
        vatRate: poItem.vatRate,
        vatAmount: poItem.vatAmount,
        irpfRate: poItem.irpfRate,
        irpfAmount: poItem.irpfAmount,
        totalAmount: poItem.totalAmount,
        episodeAssignment: poItem.episodeAssignment || "general",
        episodes: poItem.episodes ? [...poItem.episodes] : undefined,
      },
    ]);
    setShowPOItemsModal(false);
  };

  const removeItem = (i: number) => {
    setItems(items.filter((_, idx) => idx !== i));
  };

  // Funciones para manejo de episodios
  const openEpisodeModal = (index: number) => {
    setEpisodeItemIndex(index);
    const item = items[index];
    if (item.episodes && item.episodes.length > 0) {
      setTempEpisodeDistribution([...item.episodes]);
      const allEqual = item.episodes.every(e => Math.abs(e.percentage - item.episodes![0].percentage) < 0.01);
      setEpisodeDistributionMode(allEqual ? "equal" : "amount");
    } else {
      setTempEpisodeDistribution([]);
    }
    setShowEpisodeModal(true);
  };

  const toggleEpisodeInDistribution = (episodeNum: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const existing = tempEpisodeDistribution.find(e => e.episode === episodeNum);
    if (existing) {
      setTempEpisodeDistribution(tempEpisodeDistribution.filter(e => e.episode !== episodeNum));
    } else {
      const newEp: EpisodeDistribution = { episode: episodeNum, amount: 0, percentage: 0 };
      const newDist = [...tempEpisodeDistribution, newEp].sort((a, b) => a.episode - b.episode);
      recalculateDistribution(newDist, item.baseAmount);
    }
  };

  const recalculateDistribution = (dist: EpisodeDistribution[], totalAmount: number) => {
    if (dist.length === 0) {
      setTempEpisodeDistribution([]);
      return;
    }
    
    if (episodeDistributionMode === "equal") {
      const equalPercentage = 100 / dist.length;
      const equalAmount = totalAmount / dist.length;
      setTempEpisodeDistribution(dist.map(e => ({
        ...e,
        percentage: equalPercentage,
        amount: equalAmount,
      })));
    } else {
      setTempEpisodeDistribution(dist);
    }
  };

  const updateEpisodeAmount = (episodeNum: number, amount: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const newDist = tempEpisodeDistribution.map(e => {
      if (e.episode === episodeNum) {
        return { ...e, amount, percentage: (amount / item.baseAmount) * 100 };
      }
      return e;
    });
    setTempEpisodeDistribution(newDist);
  };

  const updateEpisodePercentage = (episodeNum: number, percentage: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    
    const newDist = tempEpisodeDistribution.map(e => {
      if (e.episode === episodeNum) {
        return { ...e, percentage, amount: (percentage / 100) * item.baseAmount };
      }
      return e;
    });
    setTempEpisodeDistribution(newDist);
  };

  const applyEqualDistribution = () => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item || tempEpisodeDistribution.length === 0) return;
    
    const equalPercentage = 100 / tempEpisodeDistribution.length;
    const equalAmount = item.baseAmount / tempEpisodeDistribution.length;
    setTempEpisodeDistribution(tempEpisodeDistribution.map(e => ({
      ...e,
      percentage: equalPercentage,
      amount: equalAmount,
    })));
  };

  const saveEpisodeDistribution = (dist: EpisodeDistribution[] = tempEpisodeDistribution) => {
    if (episodeItemIndex === null) return;
    
    const newItems = [...items];
    const isGeneral = dist.length === 0 || dist.length === totalEpisodes;
    
    newItems[episodeItemIndex] = {
      ...newItems[episodeItemIndex],
      episodeAssignment: isGeneral ? "general" : "specific",
      episodes: dist.length > 0 && dist.length < totalEpisodes 
        ? dist 
        : undefined,
    };
    setItems(newItems);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
    setTempEpisodeDistribution([]);
  };

  const getTotalDistributedPercentage = () => {
    return tempEpisodeDistribution.reduce((sum, e) => sum + e.percentage, 0);
  };

  const getTotalDistributedAmount = () => {
    return tempEpisodeDistribution.reduce((sum, e) => sum + e.amount, 0);
  };

  // Funciones de vencimientos múltiples
  const initDueDates = () => {
    const defaultDate = formData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    setDueDates([
      { id: "1", date: defaultDate, type: "percentage", percentage: 50, amount: totals.totalAmount * 0.5 },
      { id: "2", date: defaultDate, type: "percentage", percentage: 50, amount: totals.totalAmount * 0.5 },
    ]);
  };

  const addDueDate = () => {
    const remaining = 100 - dueDates.reduce((sum, d) => sum + d.percentage, 0);
    const defaultDate = dueDates.length > 0 ? dueDates[dueDates.length - 1].date : formData.dueDate;
    setDueDates([
      ...dueDates,
      { id: String(Date.now()), date: defaultDate, type: "percentage", percentage: Math.max(0, remaining), amount: totals.totalAmount * (Math.max(0, remaining) / 100) },
    ]);
  };

  const removeDueDate = (i: number) => {
    if (dueDates.length <= 2) return;
    setDueDates(dueDates.filter((_, idx) => idx !== i));
  };

  const updateDueDate = (i: number, field: keyof DueDateEntry, value: any) => {
    const newDueDates = [...dueDates];
    newDueDates[i] = { ...newDueDates[i], [field]: value };
    
    // Si cambia el tipo, recalcular
    if (field === "type") {
      if (value === "percentage") {
        newDueDates[i].amount = totals.totalAmount * (newDueDates[i].percentage / 100);
      } else {
        newDueDates[i].percentage = totals.totalAmount > 0 ? (newDueDates[i].amount / totals.totalAmount) * 100 : 0;
      }
    }
    
    // Si cambia el porcentaje, recalcular importe
    if (field === "percentage") {
      newDueDates[i].amount = totals.totalAmount * (value / 100);
    }
    
    // Si cambia el importe, recalcular porcentaje
    if (field === "amount") {
      newDueDates[i].percentage = totals.totalAmount > 0 ? (value / totals.totalAmount) * 100 : 0;
    }
    
    setDueDates(newDueDates);
  };

  const getDueDatesTotal = () => dueDates.reduce((sum, d) => sum + d.amount, 0);
  const getDueDatesPercentage = () => dueDates.reduce((sum, d) => sum + d.percentage, 0);
  const isDueDatesValid = () => Math.abs(getDueDatesPercentage() - 100) < 0.1;

  // Funciones de selección
  const selectPO = (po: PO) => {
    setSelectedPO(po);
    setFormData({
      ...formData,
      supplier: po.supplierId,
      supplierName: po.supplier,
      department: po.department || formData.department,
      description: (currentDocType.label + " PARA PO-" + po.number).toUpperCase(),
    });
    setItems([]);
    setShowPOModal(false);
    setPOSearch("");
    setTouched((p) => ({ ...p, po: true }));
  };

  const selectSupplier = (s: Supplier) => {
    setFormData({ ...formData, supplier: s.id, supplierName: s.fiscalName });
    setShowSupplierModal(false);
    setSupplierSearch("");
    setTouched((p) => ({ ...p, supplier: true }));
  };

  const createQuickSupplier = async (data: { fiscalName: string; taxId: string } = newSupplierData) => {
    if (!data.fiscalName.trim() || !data.taxId.trim()) return;
    setCreatingSupplier(true);
    try {
      const newSupplier = {
        fiscalName: data.fiscalName.trim(),
        commercialName: "",
        country: "ES",
        taxId: data.taxId.trim().toUpperCase(),
        address: { street: "", number: "", city: "", province: "", postalCode: "" },
        contact: { name: "", email: "", phone: "" },
        paymentMethod: "transferencia",
        bankAccount: "",
        bic: "",
        certificates: {
          bankOwnership: { uploaded: false, expiryDate: null, fileName: "", verified: false },
          contractorsCertificate: { uploaded: false, expiryDate: null, fileName: "", verified: false, aeatVerified: false },
        },
        createdAt: Timestamp.now(),
        createdBy: permissions.userId || "",
        hasAssignedPOs: false,
        hasAssignedInvoices: false,
      };
      const docRef = await addDoc(collection(db, `projects/${id}/suppliers`), newSupplier);

      // Seleccionar el nuevo proveedor
      setFormData((prev) => ({ ...prev, supplier: docRef.id, supplierName: data.fiscalName.trim() }));
      setTouched((p) => ({ ...p, supplier: true }));

      // Añadir a la lista local
      setSuppliers((prev) => [...prev, { id: docRef.id, ...newSupplier } as Supplier]);

      // Cerrar modales
      setShowCreateSupplierModal(false);
      setShowSupplierModal(false);
      setNewSupplierData({ fiscalName: "", taxId: "" });
      setSupplierSearch("");
    } catch (error) {
      console.error("Error creating supplier:", error);
    } finally {
      setCreatingSupplier(false);
    }
  };

  const selectAccount = (sub: SubAccount) => {
    if (currentItemIndex !== null) {
      const n = [...items];
      n[currentItemIndex] = {
        ...n[currentItemIndex],
        subAccountId: sub.id,
        subAccountCode: sub.code,
        subAccountDescription: sub.description,
      };
      setItems(n);
    }
    setShowAccountModal(false);
    setAccountSearch("");
    setCurrentItemIndex(null);
  };

  // Funciones de reemplazo
  const startReplacement = (pd: PendingDocument) => {
    setSelectedPendingDoc(pd);
    setReplaceMode(true);
    setDocumentType("invoice");
    setLinkedDocumentId(pd.id);

    setFormData({
      ...formData,
      invoiceType: pd.poId ? "with-po" : "without-po",
      supplier: pd.supplierId,
      supplierName: pd.supplier,
      department: pd.department || formData.department,
      description: ("FACTURA DEFINITIVA PARA " + pd.displayNumber).toUpperCase(),
    });

    if (pd.poId) {
      const po = pos.find((p) => p.id === pd.poId);
      if (po) setSelectedPO(po);
    }

    if (pd.items && pd.items.length > 0) {
      setItems(
        pd.items.map((item: any, idx: number) => ({
          id: String(Date.now() + idx),
          description: item.description || "",
          poItemId: item.poItemId || null,
          poItemIndex: item.poItemIndex ?? null,
          isNewItem: item.isNewItem ?? true,
          subAccountId: item.subAccountId || "",
          subAccountCode: item.subAccountCode || "",
          subAccountDescription: item.subAccountDescription || "",
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          baseAmount: item.baseAmount || 0,
          vatRate: item.vatRate ?? 21,
          vatAmount: item.vatAmount || 0,
          irpfRate: item.irpfRate || 0,
          irpfAmount: item.irpfAmount || 0,
          totalAmount: item.totalAmount || 0,
        }))
      );
    }

    setSameAmount(true);
    setAmountDifference(0);
    setDifferenceReason("");
    setShowReplaceModal(false);
  };

  const cancelReplacement = () => {
    setReplaceMode(false);
    setSelectedPendingDoc(null);
    setLinkedDocumentId("");
    setFormData({
      invoiceType: "with-po",
      supplier: "",
      supplierName: "",
      department: permissions.fixedDepartment || "",
      description: "",
      dueDate: formData.dueDate,
      notes: "",
    });
    setItems([]);
    setSelectedPO(null);
    setSameAmount(true);
    setAmountDifference(0);
    setDifferenceReason("");
  };

  // Effect para procesar linkTo desde URL
  useEffect(() => {
    if (linkToId && pendingDocuments.length > 0 && !linkToProcessed && !replaceMode) {
      const docToReplace = pendingDocuments.find((pd) => pd.id === linkToId);
      if (docToReplace) {
        startReplacement(docToReplace);
        setLinkToProcessed(true);
      }
    }
  }, [linkToId, pendingDocuments, linkToProcessed, replaceMode]);

  // Funciones de archivo
  const handleFileUpload = (file: File) => {
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      alert("Solo PDF o imágenes hasta 10MB");
      return;
    }
    setUploadedFile(file);
    setTouched((p) => ({ ...p, file: true }));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileUpload(f);
  }, []);

  const handleBlur = (field: string) => {
    setTouched((p) => ({ ...p, [field]: true }));
  };

  // Validación
  const validateForm = () => {
    const e: Record<string, string> = {};

    if (!uploadedFile) e.file = "Adjunta el archivo";
    if (formData.invoiceType === "with-po" && !selectedPO && !replaceMode) e.po = "Selecciona una PO";
    if (formData.invoiceType === "without-po" && !formData.supplier && !linkedDocumentId) e.supplier = "Selecciona proveedor";
    if (!formData.description.trim()) e.description = "Obligatorio";
    
    // Validación de vencimientos
    if (multipleDueDates) {
      if (dueDates.length < 2) e.dueDates = "Mínimo 2 vencimientos";
      if (!isDueDatesValid()) e.dueDates = "Los porcentajes deben sumar 100%";
      dueDates.forEach((d, i) => {
        if (!d.date) e["dueDate_" + i] = "Fecha obligatoria";
        if (d.percentage <= 0) e["dueDate_" + i + "_percentage"] = "> 0";
      });
    } else {
      if (!formData.dueDate) e.dueDate = "Obligatorio";
    }
    
    if (items.length === 0) e.items = "Añade al menos un ítem";

    items.forEach((it, i) => {
      if (!it.description.trim()) e["item_" + i + "_description"] = "Obligatorio";
      if (!it.subAccountId) e["item_" + i + "_account"] = "Obligatorio";
      if (it.quantity <= 0) e["item_" + i + "_quantity"] = "> 0";
      if (it.unitPrice <= 0) e["item_" + i + "_unitPrice"] = "> 0";
    });

    if (replaceMode && !sameAmount && !differenceReason.trim()) {
      e.differenceReason = "Explica la diferencia";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Funciones de actualización de presupuesto
  const updateSubAccountsBudget = async (invoiceItems: InvoiceItem[], hasPO: boolean) => {
    // Preparar items para realizeInvoice
    const budgetItems = invoiceItems
      .filter(item => item.subAccountId && item.baseAmount > 0)
      .map(item => ({
        subAccountId: item.subAccountId,
        baseAmount: item.baseAmount,
      }));
    
    if (budgetItems.length > 0) {
      // realizeInvoice mueve de committed -> actual si hay PO
      // o simplemente suma a actual si no hay PO
      await realizeInvoice(id, budgetItems);
    }
  };

  const updatePOInvoicedAmount = async (poId: string, invoiceItems: typeof items) => {
    try {
      // Usar la función centralizada que actualiza items individuales
      await updatePOItemsInvoiced(id, poId, invoiceItems, "add");
    } catch (err) {
      console.error("Error updating PO:", err);
    }
  };

  // Submit
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      // Obtener siguiente número correlativo global (para todos los tipos de documento)
      const finalNumber = await nextDocNumber(id as string, "invoices");
      const finalDisplayNumber = currentDocType.code + "-" + finalNumber;

      // Subir archivo
      let fileUrl = "";
      if (uploadedFile) {
        const fileRef = ref(storage, "projects/" + id + "/invoices/" + finalDisplayNumber + "/" + uploadedFile.name);
        await uploadBytes(fileRef, uploadedFile);
        fileUrl = await getDownloadURL(fileRef);
      }

      // Preparar items
      const itemsData = items.map((i) => ({
        description: i.description.trim(),
        poItemId: i.poItemId || null,
        poItemIndex: i.poItemIndex !== undefined ? i.poItemIndex : null,
        isNewItem: i.isNewItem || false,
        subAccountId: i.subAccountId || "",
        subAccountCode: i.subAccountCode || "",
        subAccountDescription: i.subAccountDescription || "",
        quantity: i.quantity || 0,
        unitPrice: i.unitPrice || 0,
        baseAmount: i.baseAmount || 0,
        vatRate: i.vatRate || 0,
        vatAmount: i.vatAmount || 0,
        irpfRate: i.irpfRate || 0,
        irpfAmount: i.irpfAmount || 0,
        totalAmount: i.totalAmount || 0,
        episodeAssignment: i.episodeAssignment || "general",
        ...(i.episodes && i.episodes.length > 0 && { episodes: i.episodes }),
      }));

      // Preparar datos de factura
      const invoiceData: any = {
        documentType: documentType || "invoice",
        number: finalNumber,
        displayNumber: finalDisplayNumber,
        supplier: formData.supplierName || "",
        supplierId: formData.supplier || "",
        department: formData.department || selectedPO?.department || permissions.fixedDepartment || "",
        poId: selectedPO?.id || null,
        poNumber: selectedPO?.number || null,
        // Quien creó la PO puede ver todas sus facturas (reglas de Firestore)
        poCreatedBy: selectedPO?.createdBy || null,
        description: (formData.description || "").trim(),
        notes: (formData.notes || "").trim(),
        items: itemsData,
        baseAmount: totals.baseAmount || 0,
        vatAmount: totals.vatAmount || 0,
        irpfAmount: totals.irpfAmount || 0,
        totalAmount: totals.totalAmount || 0,
        attachmentUrl: fileUrl || "",
        attachmentFileName: uploadedFile?.name || "",
        createdAt: Timestamp.now(),
        createdBy: permissions.userId || "",
        createdByName: permissions.userName || "",
        requiresReplacement: currentDocType?.requiresReplacement || false,
        replacedByInvoiceId: null,
        linkedDocumentId: linkedDocumentId || null,
      };

      // Datos de vencimientos
      if (multipleDueDates && dueDates.length > 0) {
        invoiceData.hasMultipleDueDates = true;
        invoiceData.dueDates = dueDates.map((d) => ({
          date: Timestamp.fromDate(new Date(d.date)),
          percentage: d.percentage,
          amount: d.amount,
        }));
        invoiceData.dueDate = Timestamp.fromDate(new Date(dueDates[0].date));
      } else {
        invoiceData.hasMultipleDueDates = false;
        invoiceData.dueDate = Timestamp.fromDate(new Date(formData.dueDate || new Date()));
      }

      // Datos de reemplazo
      if (replaceMode && selectedPendingDoc) {
        invoiceData.isReplacement = true;
        invoiceData.replacesDocumentId = selectedPendingDoc.id;
        invoiceData.replacesDocumentNumber = selectedPendingDoc.displayNumber;
        invoiceData.originalAmount = selectedPendingDoc.totalAmount;
        invoiceData.amountDifference = amountDifference;
        invoiceData.hasDifference = !sameAmount;
        if (!sameAmount) {
          invoiceData.differenceReason = differenceReason.trim();
          invoiceData.pendingAmount = amountDifference;
        }
      }

      // Estado de aprobación
      const steps = generateApprovalSteps();
      
      // Lifecycle nuevo: "submitted" para todo lo que entra al sistema. Los detalles
      // (delegada/aprobada/pendiente) se reflejan en flags y tracks.
      if (delegateToAccounting) {
        // Delegada a contabilidad: en el sistema, pendiente de codificar.
        invoiceData.status = "submitted";
        invoiceData.approvalStatus = "pending";
        invoiceData.delegatedToAccounting = true;
        invoiceData.delegatedAt = Timestamp.now();
        invoiceData.delegatedBy = permissions.userId || "";
        invoiceData.delegatedByName = permissions.userName || "";
      } else if (shouldAutoApprove(steps)) {
        // Auto-aprobada: track de aprobación completado.
        invoiceData.status = "submitted";
        invoiceData.approvalStatus = "approved";
        invoiceData.autoApproved = true;
        if (steps.length) { invoiceData.approvalSteps = steps; invoiceData.approverIds = []; invoiceData.currentApprovalStep = -1; }
        invoiceData.approvedAt = Timestamp.now();
        invoiceData.approvedBy = permissions.userId || "";
        invoiceData.approvedByName = permissions.userName || "";
      } else {
        // Pendiente de aprobación.
        invoiceData.status = "submitted";
        invoiceData.approvalStatus = "pending";
        invoiceData.approvalSteps = steps;
        invoiceData.approverIds = approverIdsOf(steps);
        invoiceData.currentApprovalStep = steps.findIndex((x) => x.status === "pending");
      }

      // Guardar factura
      const docRef = await addDoc(collection(db, "projects/" + id + "/invoices"), invoiceData);

      // Obtener configuración de costes
      const costSettings = await getCostSettings(id);
      const finalStatus = invoiceData.status;
      
      // Actualizar presupuesto y tracking de PO solo si la factura ya debe realizarse
      // según la configuración (on_create). Si es on_approve/on_account/on_paid,
      // estas actualizaciones ocurren en el momento de aprobación/contabilización/pago.
      if (shouldRealizeInvoice(finalStatus, costSettings, { approvedAt: invoiceData.approvedAt })) {
        await updateSubAccountsBudget(items, !!selectedPO);
        if (selectedPO) {
          await updatePOInvoicedAmount(selectedPO.id, items);
        }
      }

      // Actualizar documento reemplazado
      if (linkedDocumentId || (replaceMode && selectedPendingDoc)) {
        const docToUpdate = linkedDocumentId || selectedPendingDoc?.id;
        if (docToUpdate) {
          await updateDoc(doc(db, "projects/" + id + "/invoices", docToUpdate), {
            replacedByInvoiceId: docRef.id,
            replacedAt: Timestamp.now(),
          });
        }
      }

      setSuccessMessage(invoiceData.autoApproved ? currentDocType.label + " creada" : currentDocType.label + " enviada para aprobación");

      setTimeout(() => {
        router.push("/project/" + id + "/accounting/invoices");
      }, 1500);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Funciones de formateo
  const formatCurrency = (a: number) => {
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: "always",
    } as Intl.NumberFormatOptions).format(a);
  };

  const formatDate = (d: Date) => {
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  };

  const getCompletionPercentage = () => {
    let c = 0;
    if (uploadedFile) c++;
    if (formData.invoiceType === "with-po" ? selectedPO : formData.supplier || linkedDocumentId) c++;
    if (formData.description.trim()) c++;
    if (multipleDueDates ? (isDueDatesValid() && dueDates.every(d => d.date)) : formData.dueDate) c++;
    if (items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0)) c++;
    return Math.round((c / 5) * 100);
  };

  // Filtros
  const filteredPOs = pos.filter(
    (p) => p.number.toLowerCase().includes(poSearch.toLowerCase()) || p.supplier.toLowerCase().includes(poSearch.toLowerCase())
  );

  const filteredSubAccounts = subAccounts.filter(
    (s) => s.code.toLowerCase().includes(accountSearch.toLowerCase()) || s.description.toLowerCase().includes(accountSearch.toLowerCase())
  );

  const filteredSuppliers = suppliers.filter(
    (s) =>
      (s.fiscalName || "").toLowerCase().includes(supplierSearch.toLowerCase()) ||
      (s.commercialName || "").toLowerCase().includes(supplierSearch.toLowerCase()) ||
      (s.taxId || "").toLowerCase().includes(supplierSearch.toLowerCase())
  );

  // Computados finales
  const approvalPreview = getApprovalPreview();
  const completionPercentage = getCompletionPercentage();
  const hasError = (f: string) => touched[f] && errors[f];

  // Loading state
  if (permissionsLoading || loading) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      </div>
    );
  }

  // Access denied
  if (permissionsError || !permissions.hasAccountingAccess) {
    return (
      <div className={cx("min-h-screen bg-white flex items-center justify-center", inter.className)}>
        <div className="text-center max-w-md">
          <div className="hidden">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-[14px] font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{permissionsError || "No tienes permisos"}</p>
          <Link
            href={"/project/" + id + "/accounting/invoices"}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium"
          >
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      {/* Header */}
      <div className="mt-[53px]">
        <div className="px-6 pt-8 sm:px-10">
          <div className="relative flex min-h-[44px] items-center justify-start border-b border-slate-200 pb-4">
            <Link
              href={"/project/" + id + "/accounting/invoices"}
              className="mr-3 w-8 h-8 rounded-md flex items-center justify-center text-slate-500 hover:bg-[#F4F4F5] hover:text-slate-900 transition-colors"
            >
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                  {replaceMode ? "Factura definitiva" : "Subir " + currentDocType.label.toLowerCase()}
                </h1>
                {replaceMode && (
                  <span className="px-2.5 py-1 bg-[#F1F1F3] text-slate-900 rounded-lg text-xs font-medium flex items-center gap-1.5">
                    <RefreshCw size={12} />
                    Sustitución
                  </span>
                )}
                {permissions.fixedDepartment && (
                  <span
                    className="px-2 py-1 rounded-lg text-xs font-medium"
                    style={{ backgroundColor: "rgba(47, 82, 224, 0.1)", color: "#2F52E0" }}
                  >
                    {permissions.fixedDepartment}
                  </span>
                )}
              </div>
            </div>
            <div className="absolute right-0 flex items-center gap-2">
              {/* Botón de borradores */}
              <div className="relative">
                <button
                  onClick={() => setShowDraftsPanel(!showDraftsPanel)}
                  className={cx(
                    "flex items-center gap-2 px-3 py-1.5 border rounded-md text-[13px] font-medium transition-colors",
                    drafts.length > 0
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <FileBox size={16} />
                  {drafts.length > 0 && (
                    <span className="w-5 h-5 bg-amber-500 text-white text-xs rounded-full flex items-center justify-center">
                      {drafts.length}
                    </span>
                  )}
                </button>

                {/* Panel de borradores */}
                {showDraftsPanel && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDraftsPanel(false)} />
                    <AnchoredPanel className="w-72 bg-white border border-slate-200 rounded-md shadow-xl overflow-hidden" align="right" offsetTop={48}>
                      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900 text-[13px]">Borradores</h3>
                        <button onClick={() => setShowDraftsPanel(false)} className="text-slate-400 hover:text-slate-600">
                          <X size={16} />
                        </button>
                      </div>
                      
                      <div className="max-h-64 overflow-y-auto">
                        {drafts.length > 0 ? (
                          drafts.map((draft) => (
                            <div key={draft.id} className="p-3 border-b border-slate-100 hover:bg-slate-50 group">
                              <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => loadDraft(draft)}>
                                  <p className="text-[13px] font-medium text-slate-900 truncate">{draft.name}</p>
                                  <p className="text-xs text-slate-400">
                                    {new Date(draft.savedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                                  </p>
                                </div>
                                <button
                                  onClick={() => deleteDraft(draft.id)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-6 text-center">
                            <FileBox size={24} className="text-slate-300 mx-auto mb-2" />
                            <p className="text-[13px] text-slate-500">No hay borradores</p>
                          </div>
                        )}
                      </div>

                      <div className="px-3 py-2 border-t border-slate-100 bg-slate-50">
                        <button
                          onClick={saveDraft}
                          className="w-full px-3 py-2 rounded-lg text-xs font-medium border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]"
                        >
                          Guardar como borrador
                        </button>
                      </div>
                    </AnchoredPanel>
                  </>
                )}
              </div>

              {replaceMode && (
                <button
                  onClick={cancelReplacement}
                  className="flex items-center gap-2 px-4 py-1.5 border border-slate-200 text-slate-700 rounded-md text-[13px] font-medium hover:bg-slate-50"
                >
                  <X size={16} />
                  Cancelar
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium transition-opacity disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    {approvalPreview.autoApprove ? <CheckCircle size={16} /> : <Send size={16} />}
                    {approvalPreview.autoApprove ? "Crear " + currentDocType.label.toLowerCase() : "Enviar"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="px-6 sm:px-10 py-8">

        {/* Replace Mode Banner */}
        {replaceMode && selectedPendingDoc && (
          <div className="mb-6 p-4 bg-[#F7F7F8] border border-slate-200 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-[#F1F1F3] rounded-md flex items-center justify-center flex-shrink-0">
                <RefreshCw size={18} className="text-slate-700" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">Sustituyendo {selectedPendingDoc.displayNumber}</p>
                <p className="text-[13px] text-slate-900 mt-0.5">
                  Esta factura definitiva reemplazará al documento original de {formatCurrency(selectedPendingDoc.totalAmount)} €
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="col-span-2 space-y-6">
            {/* Document Type Section */}
            {!replaceMode && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Tipo de documento</h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-4 gap-3">
                    {(Object.entries(DOCUMENT_TYPES) as [DocumentType, typeof DOCUMENT_TYPES.invoice][]).map(([key, config]) => {
                      const Icon = config.icon;
                      const isSelected = documentType === key;
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setDocumentType(key);
                            setLinkedDocumentId("");
                          }}
                          className={cx(
                            "p-4 rounded-md border-2 transition-all text-left",
                            isSelected ? config.borderColor + " " + config.bgColor : "border-slate-200 hover:border-slate-300"
                          )}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <Icon size={20} className={isSelected ? config.textColor : "text-slate-400"} />
                            {isSelected && <CheckCircle2 size={16} className={config.textColor} />}
                          </div>
                          <p className="font-semibold text-slate-900 text-[13px]">{config.label}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{config.code}</p>
                        </button>
                      );
                    })}
                  </div>
                  {currentDocType.requiresReplacement && (
                    <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-md">
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
                        <div>
                          <p className="text-[13px] font-semibold text-amber-800">Requiere factura definitiva</p>
                          <p className="text-[13px] text-amber-700 mt-1">Una vez pagado, deberás subir la factura definitiva.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pending Documents Button */}
            {!replaceMode && pendingDocuments.length > 0 && documentType === "invoice" && (
              <button
                onClick={() => setShowReplaceModal(true)}
                className="w-full p-4 border border-dashed border-slate-200 rounded-lg bg-[#F7F7F8] hover:bg-[#F4F4F5] hover:border-slate-400 transition-all text-left group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#F1F1F3] rounded-md flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                      <RefreshCw size={18} className="text-slate-700" />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-slate-900">¿Tienes la factura definitiva?</p>
                      <p className="text-xs text-slate-700">
                        {pendingDocuments.length} documento{pendingDocuments.length !== 1 ? "s" : ""} pendiente{pendingDocuments.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <ArrowRight size={18} className="text-slate-400 group-hover:text-slate-700" />
                </div>
              </button>
            )}

            {/* PO Association Section */}
            {!replaceMode && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Asociación a PO</h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => {
                        setFormData({ ...formData, invoiceType: "with-po", supplier: "", supplierName: "" });
                        setItems([]);
                        setSelectedPO(null);
                      }}
                      className={cx(
                        "p-5 rounded-md border-2 transition-all text-left",
                        formData.invoiceType === "with-po" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(47, 82, 224, 0.1)" }}>
                          <FileText size={20} style={{ color: formData.invoiceType === "with-po" ? "#2F52E0" : "#94a3b8" }} />
                        </div>
                        {formData.invoiceType === "with-po" && <CheckCircle2 size={20} className="text-slate-900" />}
                      </div>
                      <h3 className="font-semibold text-slate-900 mb-1">Con PO asociada</h3>
                      <p className="text-[13px] text-slate-500">Vinculada a una orden de compra</p>
                    </button>
                    <button
                      onClick={() => {
                        setFormData({ ...formData, invoiceType: "without-po", supplier: "", supplierName: "" });
                        setItems([]);
                        setSelectedPO(null);
                      }}
                      className={cx(
                        "p-5 rounded-md border-2 transition-all text-left",
                        formData.invoiceType === "without-po" ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <Receipt size={20} className={formData.invoiceType === "without-po" ? "text-emerald-600" : "text-emerald-400"} />
                        </div>
                        {formData.invoiceType === "without-po" && <CheckCircle2 size={20} className="text-slate-900" />}
                      </div>
                      <h3 className="font-semibold text-slate-900 mb-1">Sin PO</h3>
                      <p className="text-[13px] text-slate-500">Documento independiente</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* PO Selection Section */}
            {formData.invoiceType === "with-po" && !replaceMode && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Orden de compra *</h2>
                </div>
                <div className="p-6">
                  <button
                    onClick={() => setShowPOModal(true)}
                    onBlur={() => handleBlur("po")}
                    className={cx(
                      "w-full px-4 py-1.5 border rounded-md hover:border-slate-300 transition-colors text-left flex items-center justify-between",
                      hasError("po") ? "border-red-300 bg-red-50" : selectedPO ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                    )}
                  >
                    {selectedPO ? (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <CheckCircle2 size={18} className="text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">PO-{selectedPO.number}</p>
                          <p className="text-[13px] text-slate-500">{selectedPO.supplier}</p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">Seleccionar PO</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("po") && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.po}
                    </p>
                  )}
                  {selectedPO && (
                    <div className={cx("mt-4 p-4 rounded-md border", poStats.isOverInvoiced ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200")}>
                      <div className="flex items-start gap-3">
                        <div className={cx("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", poStats.isOverInvoiced ? "bg-red-100" : "bg-slate-200")}>
                          {poStats.isOverInvoiced ? <AlertTriangle size={16} className="text-red-600" /> : <Info size={16} className="text-slate-500" />}
                        </div>
                        <div className="flex-1">
                          <p className={cx("text-[13px] font-semibold mb-2", poStats.isOverInvoiced ? "text-red-800" : "text-slate-700")}>
                            {poStats.isOverInvoiced ? "Excede el total de la PO" : "Estado de facturación"}
                          </p>
                          <div className="grid grid-cols-2 gap-4 text-[13px]">
                            <div>
                              <p className="text-slate-500">Total PO</p>
                              <p className="font-semibold text-slate-900">{formatCurrency(poStats.totalAmount)} €</p>
                            </div>
                            <div>
                              <p className="text-slate-500">Facturado</p>
                              <p className={cx("font-semibold", poStats.isOverInvoiced ? "text-red-600" : "text-emerald-600")}>
                                {formatCurrency(poStats.invoicedAmount)} €
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div
                              className={cx("h-full", poStats.percentageInvoiced > 100 ? "bg-red-500" : poStats.percentageInvoiced > 90 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: Math.min(poStats.percentageInvoiced, 100) + "%" }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Replace Mode PO (locked) */}
            {replaceMode && selectedPO && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                  <Lock size={14} className="text-slate-400" />
                  <h2 className="font-semibold text-slate-900">Orden de compra vinculada</h2>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(47, 82, 224, 0.1)" }}>
                      <FileText size={18} style={{ color: "#2F52E0" }} />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">PO-{selectedPO.number}</p>
                      <p className="text-[13px] text-slate-500">{selectedPO.supplier}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Supplier Selection (without PO) */}
            {formData.invoiceType === "without-po" && !linkedDocumentId && !replaceMode && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Proveedor *</h2>
                </div>
                <div className="p-6">
                  <button
                    onClick={() => setShowSupplierModal(true)}
                    onBlur={() => handleBlur("supplier")}
                    className={cx(
                      "w-full px-4 py-1.5 border rounded-md hover:border-slate-300 transition-colors text-left flex items-center justify-between",
                      hasError("supplier") ? "border-red-300 bg-red-50" : formData.supplier ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                    )}
                  >
                    {formData.supplierName ? (
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <CheckCircle2 size={18} className="text-emerald-600" />
                        </div>
                        <span className="font-medium text-slate-900">{formData.supplierName}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400">Seleccionar proveedor</span>
                    )}
                    <Search size={16} className="text-slate-400" />
                  </button>
                  {hasError("supplier") && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.supplier}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Replace Mode Supplier (locked) */}
            {replaceMode && formData.supplierName && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
                  <Lock size={14} className="text-slate-400" />
                  <h2 className="font-semibold text-slate-900">Proveedor</h2>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md">
                    <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center">
                      <Building2 size={18} className="text-slate-600" />
                    </div>
                    <span className="font-medium text-slate-900">{formData.supplierName}</span>
                  </div>
                </div>
              </div>
            )}

            {/* File Upload Section */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Archivo del documento *</h2>
                <p className="text-xs text-slate-500 mt-0.5">PDF, JPG o PNG hasta 10MB</p>
              </div>
              <div className="p-6">
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                  }}
                  className={cx(
                    "border-2 border-dashed rounded-md p-8 text-center transition-all",
                    isDragging
                      ? "border-slate-400 bg-[#F7F7F8]"
                      : uploadedFile
                      ? "border-emerald-300 bg-emerald-50"
                      : hasError("file")
                      ? "border-red-300 bg-red-50"
                      : "border-slate-200 hover:border-slate-300"
                  )}
                  style={isDragging ? { borderColor: "#2F52E0", backgroundColor: "rgba(47, 82, 224, 0.05)" } : {}}
                >
                  {uploadedFile ? (
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-md p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                          <CheckCircle2 size={18} className="text-emerald-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-[13px] font-medium text-slate-900">{uploadedFile.name}</p>
                          <p className="text-xs text-slate-500">{(uploadedFile.size / 1024).toFixed(0)} KB</p>
                        </div>
                      </div>
                      <button onClick={() => setUploadedFile(null)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <label className="cursor-pointer block">
                      <div className={cx("w-12 h-12 rounded-md flex items-center justify-center mx-auto mb-3", hasError("file") ? "bg-red-100" : "bg-slate-100")}>
                        <Upload size={20} className={hasError("file") ? "text-red-400" : "text-slate-400"} />
                      </div>
                      <p className={cx("text-[13px] font-medium mb-1", hasError("file") ? "text-red-700" : "text-slate-700")}>
                        Arrastra o haz clic para subir
                      </p>
                      <p className="text-xs text-slate-500">PDF, JPG, PNG (máx. 10MB)</p>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileUpload(f);
                        }}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>
                {hasError("file") && (
                  <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {errors.file}
                  </p>
                )}
              </div>
            </div>

            {/* Basic Info Section */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Información básica</h2>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Descripción *</label>
                  <div className="relative">
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value.toUpperCase() })}
                      onBlur={() => handleBlur("description")}
                      placeholder={"Concepto " + currentDocType.article + " " + currentDocType.label.charAt(0).toLowerCase() + currentDocType.label.slice(1).toLowerCase()}
                      rows={2}
                      className={cx(
                        "w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 resize-none text-[13px] pr-10 uppercase",
                        hasError("description")
                          ? "border-red-300 bg-red-50"
                          : formData.description.trim()
                          ? "border-emerald-300 bg-emerald-50"
                          : "border-slate-200"
                      )}
                    />
                    {formData.description.trim() && <CheckCircle2 size={16} className="absolute right-4 top-4 text-emerald-600" />}
                  </div>
                  {hasError("description") && (
                    <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                      <AlertCircle size={12} />
                      {errors.description}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[13px] font-medium text-slate-700 flex items-center gap-2">
                        <Calendar size={14} />
                        Vencimiento *
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          if (!multipleDueDates) {
                            initDueDates();
                          }
                          setMultipleDueDates(!multipleDueDates);
                        }}
                        className={cx(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                          multipleDueDates
                            ? "bg-[#F1F1F3] text-slate-900 border border-slate-200"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <Split size={12} />
                        {multipleDueDates ? "Vencimiento único" : "Dividir vencimiento"}
                      </button>
                    </div>

                    {!multipleDueDates ? (
                      <div className="relative">
                        <input
                          type="date"
                          value={formData.dueDate}
                          onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                          onBlur={() => handleBlur("dueDate")}
                          className={cx(
                            "w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]",
                            hasError("dueDate") ? "border-red-300 bg-red-50" : formData.dueDate ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                          )}
                        />
                        {formData.dueDate && <CheckCircle2 size={16} className="absolute right-10 top-1/2 -translate-y-1/2 text-emerald-600" />}
                        {hasError("dueDate") && (
                          <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                            <AlertCircle size={12} />
                            {errors.dueDate}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {dueDates.map((dueDate, idx) => (
                          <div
                            key={dueDate.id}
                            className={cx(
                              "p-4 border rounded-md",
                              isDueDatesValid() && dueDate.date ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50"
                            )}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-medium text-slate-500">Vencimiento {idx + 1}</span>
                              {dueDates.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => removeDueDate(idx)}
                                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs text-slate-500 mb-1 block">Fecha</label>
                                <input
                                  type="date"
                                  value={dueDate.date}
                                  onChange={(e) => updateDueDate(idx, "date", e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-500 mb-1 block">Porcentaje</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    value={dueDate.percentage}
                                    onChange={(e) => updateDueDate(idx, "percentage", parseFloat(e.target.value) || 0)}
                                    className="w-full pl-3 pr-8 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none"
                                  />
                                  <Percent size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-slate-500 mb-1 block">Importe</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={Math.round(dueDate.amount * 100) / 100}
                                    onChange={(e) => updateDueDate(idx, "amount", parseFloat(e.target.value) || 0)}
                                    className="w-full pl-3 pr-8 py-1.5 border border-slate-200 rounded-lg text-[13px] focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 focus:outline-none"
                                  />
                                  <Euro size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={addDueDate}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-700 hover:bg-[#F4F4F5] rounded-lg text-xs font-medium transition-colors"
                          >
                            <Plus size={14} />
                            Añadir vencimiento
                          </button>
                          <div className={cx(
                            "text-xs font-medium px-3 py-1.5 rounded-lg",
                            isDueDatesValid() ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                          )}>
                            Total: {Math.round(getDueDatesPercentage() * 100) / 100}% = {formatCurrency(getDueDatesTotal())} €
                          </div>
                        </div>
                        {errors.dueDates && (
                          <p className="text-xs text-red-600 flex items-center gap-1">
                            <AlertCircle size={12} />
                            {errors.dueDates}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600">Notas</label>
                  <input
                    type="text"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Notas opcionales"
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]"
                  />
                </div>
              </div>
            </div>

            {/* Amount Verification (Replace Mode) */}
            {replaceMode && selectedPendingDoc && (
              <div className={cx("bg-white border rounded-lg overflow-hidden", !sameAmount ? "border-amber-300" : "border-slate-200")}>
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Verificación de importe</h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="p-4 bg-slate-50 rounded-md">
                      <p className="text-xs text-slate-500 mb-1">Importe original</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(selectedPendingDoc.totalAmount)} €</p>
                      <p className="text-xs text-slate-400 mt-1">{selectedPendingDoc.displayNumber}</p>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-md">
                      <p className="text-xs text-emerald-600 mb-1">Importe factura</p>
                      <p className="text-lg font-bold text-emerald-700">{formatCurrency(totals.totalAmount)} €</p>
                      <p className="text-xs text-emerald-500 mt-1">Este documento</p>
                    </div>
                    <div className={cx("p-4 rounded-md", Math.abs(amountDifference) < 0.01 ? "bg-slate-50" : amountDifference > 0 ? "bg-amber-50" : "bg-[#F7F7F8]")}>
                      <p className={cx("text-xs mb-1", Math.abs(amountDifference) < 0.01 ? "text-slate-500" : amountDifference > 0 ? "text-amber-600" : "text-slate-700")}>
                        Diferencia
                      </p>
                      <p className={cx("text-lg font-bold", Math.abs(amountDifference) < 0.01 ? "text-slate-400" : amountDifference > 0 ? "text-amber-700" : "text-slate-900")}>
                        {amountDifference > 0 ? "+" : ""}
                        {formatCurrency(amountDifference)} €
                      </p>
                      <p className={cx("text-xs mt-1", Math.abs(amountDifference) < 0.01 ? "text-slate-400" : amountDifference > 0 ? "text-amber-500" : "text-slate-500")}>
                        {Math.abs(amountDifference) < 0.01 ? "Sin diferencia" : amountDifference > 0 ? "Pendiente cobro" : "Pendiente devolución"}
                      </p>
                    </div>
                  </div>
                  {!sameAmount && (
                    <div className="mt-4">
                      <div className="p-4 bg-amber-50 border border-amber-200 rounded-md mb-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <p className="text-[13px] font-medium text-amber-800">
                            {amountDifference > 0
                              ? "La factura es " + formatCurrency(amountDifference) + " € mayor"
                              : "La factura es " + formatCurrency(Math.abs(amountDifference)) + " € menor"}
                          </p>
                        </div>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-slate-600">Motivo de la diferencia *</label>
                        <textarea
                          value={differenceReason}
                          onChange={(e) => setDifferenceReason(e.target.value)}
                          onBlur={() => handleBlur("differenceReason")}
                          placeholder="Explica por qué hay diferencia"
                          rows={2}
                          className={cx(
                            "w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 resize-none text-[13px]",
                            hasError("differenceReason")
                              ? "border-red-300 bg-red-50"
                              : differenceReason.trim()
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-slate-200"
                          )}
                        />
                        {hasError("differenceReason") && (
                          <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
                            <AlertCircle size={12} />
                            {errors.differenceReason}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Items Section */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-visible">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-900">Items</h2>
                  <span className={cx("px-2.5 py-1 rounded-lg text-xs font-medium", items.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                    {items.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {formData.invoiceType === "with-po" && selectedPO && (
                    <button
                      onClick={() => setShowPOItemsModal(true)}
                      className="flex items-center gap-1.5 px-4 py-2 border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB] rounded-md text-[13px] font-medium"
                    >
                      <Plus size={14} />
                      De PO
                    </button>
                  )}
                  <button
                    onClick={addNewItem}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-md text-[13px] font-medium"
                  >
                    <Plus size={14} />
                    Nuevo
                  </button>
                </div>
              </div>
              
              {/* Toggle delegar a contabilidad */}
              {formData.invoiceType === "without-po" && (
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <button
                      type="button"
                      onClick={() => setDelegateToAccounting(!delegateToAccounting)}
                      className={cx(
                        "relative w-10 h-5 rounded-full transition-colors",
                        delegateToAccounting ? "bg-amber-500" : "bg-slate-300"
                      )}
                    >
                      <span
                        className={cx(
                          "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform",
                          delegateToAccounting ? "left-5" : "left-0.5"
                        )}
                      />
                    </button>
                    <div>
                      <span className="text-[13px] font-medium text-slate-700 group-hover:text-slate-900">
                        Delegar codificación a contabilidad
                      </span>
                      <p className="text-xs text-slate-500">
                        No asignaré cuentas, lo hará el departamento de contabilidad
                      </p>
                    </div>
                  </label>
                </div>
              )}
              
              <div className="p-6">
                {items.length === 0 ? (
                  <div className={cx("text-center py-12 border-2 border-dashed rounded-md", hasError("items") ? "border-red-300 bg-red-50" : "border-slate-200")}>
                    <div className={cx("w-12 h-12 rounded-md flex items-center justify-center mx-auto mb-3", hasError("items") ? "bg-red-100" : "bg-slate-100")}>
                      <ShoppingCart size={20} className={hasError("items") ? "text-red-400" : "text-slate-400"} />
                    </div>
                    <p className={cx("text-[13px] font-medium", hasError("items") ? "text-red-700" : "text-slate-700")}>No hay ítems</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {formData.invoiceType === "with-po" && selectedPO ? "Añade items de la PO o crea uno nuevo" : "Añade items"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item, index) => {
                      const itemComplete = delegateToAccounting 
                        ? item.description.trim() && item.quantity > 0 && item.unitPrice > 0
                        : item.description.trim() && item.subAccountId && item.quantity > 0 && item.unitPrice > 0;
                      return (
                        <div key={item.id} className={cx("border rounded-md p-5", itemComplete ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 bg-slate-50/50")}>
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                {itemComplete ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Hash size={12} />}
                                Item {index + 1}
                              </span>
                              {item.isNewItem ? (
                                <span className="text-xs bg-[#F1F1F3] text-slate-900 px-2 py-0.5 rounded-lg font-medium">Nuevo</span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ backgroundColor: "rgba(47, 82, 224, 0.1)", color: "#2F52E0" }}>
                                  De PO
                                </span>
                              )}
                              {itemComplete && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg font-medium">Completo</span>}
                            </div>
                            <button onClick={() => removeItem(index)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="space-y-4">
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => updateItem(index, "description", e.target.value)}
                              onBlur={() => handleBlur("item_" + index + "_description")}
                              placeholder="Descripción"
                              className={cx(
                                "w-full px-2.5 py-1.5 border rounded-md text-[13px] focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 bg-white",
                                hasError("item_" + index + "_description") ? "border-red-300 bg-red-50" : item.description.trim() ? "border-emerald-200" : "border-slate-200"
                              )}
                            />
                            {/* Selector de cuenta - se oculta si se delega a contabilidad */}
                            {!delegateToAccounting && (
                              item.isNewItem ? (
                                <button
                                  onClick={() => {
                                    setCurrentItemIndex(index);
                                    setShowAccountModal(true);
                                  }}
                                  className={cx(
                                    "w-full px-4 py-1.5 border rounded-md text-[13px] text-left flex items-center justify-between hover:border-slate-300 bg-white",
                                    hasError("item_" + index + "_account")
                                      ? "border-red-300 bg-red-50"
                                      : item.subAccountCode
                                      ? "border-emerald-200 bg-emerald-50"
                                      : "border-slate-200"
                                  )}
                                >
                                  {item.subAccountCode ? (
                                    <div className="flex items-center gap-2">
                                      <CheckCircle2 size={14} className="text-emerald-600" />
                                      <span className="font-mono text-slate-900">
                                        {item.subAccountCode} - {item.subAccountDescription}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400">Seleccionar cuenta</span>
                                  )}
                                  <Search size={14} className="text-slate-400" />
                                </button>
                              ) : (
                                <div className="px-4 py-2.5 bg-slate-100 rounded-md text-[13px] flex items-center gap-2">
                                  <CheckCircle2 size={14} className="text-emerald-600" />
                                  <span className="font-mono text-slate-700">
                                    {item.subAccountCode} - {item.subAccountDescription}
                                  </span>
                                </div>
                              )
                            )}
                            
                            {/* Aviso de delegación a contabilidad */}
                            {delegateToAccounting && item.isNewItem && (
                              <div className="px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-md text-[13px] flex items-center gap-2">
                                <Clock size={14} className="text-amber-600" />
                                <span className="text-amber-700">Pendiente de codificación por contabilidad</span>
                              </div>
                            )}

                            {/* Asignación de capítulos */}
                            {episodesEnabled && totalEpisodes > 0 && (
                              <div>
                                <button
                                  onClick={() => openEpisodeModal(index)}
                                  className={cx(
                                    "w-full px-4 py-1.5 border rounded-md text-[13px] text-left flex items-center justify-between hover:border-slate-300 transition-colors bg-white",
                                    item.episodeAssignment === "general" ? "border-slate-200" : "border-slate-200 bg-[#F7F7F8]"
                                  )}
                                >
                                  {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0 ? (
                                    <div className="flex items-center gap-2">
                                      <Layers size={14} className="text-slate-700" />
                                      <span className="text-slate-900">
                                        {item.episodes.length === 1 
                                          ? `${item.episodes[0].episode}`
                                          : `${item.episodes.length} capítulos`
                                        }
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <Layers size={14} className="text-slate-400" />
                                      <span className="text-slate-600">General (todos los capítulos)</span>
                                    </div>
                                  )}
                                  <ChevronDown size={14} className="text-slate-400" />
                                </button>
                                {item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 1 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {item.episodes.map((ep) => (
                                      <span key={ep.episode} className="text-xs bg-[#F1F1F3] text-slate-900 px-2 py-0.5 rounded-lg">
                                        {ep.episode}: {formatCurrency(ep.amount)} €
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="grid grid-cols-4 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Cantidad</label>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={item.quantity}
                                  onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                                  className={cx("w-full px-2.5 py-1.5 border rounded-md text-[13px] bg-white", item.quantity > 0 ? "border-emerald-200" : "border-slate-200")}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Precio</label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                                  className={cx("w-full px-2.5 py-1.5 border rounded-md text-[13px] bg-white", item.unitPrice > 0 ? "border-emerald-200" : "border-slate-200")}
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">IVA</label>
                                <div className="relative custom-dropdown">
                                  <button
                                    type="button"
                                    onClick={() => setOpenDropdown(openDropdown === `vat-${index}` ? null : `vat-${index}`)}
                                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                                  >
                                    <span className="text-slate-900 truncate">{VAT_RATES.find(r => r.value === item.vatRate)?.label ?? `${item.vatRate}%`}</span>
                                    <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `vat-${index}` ? "rotate-180" : ""}`} />
                                  </button>
                                  {openDropdown === `vat-${index}` && (
                                    <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                      {VAT_RATES.map(opt => (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          onClick={() => { updateItem(index, "vatRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                          className={`w-full px-4 py-2 text-left text-[13px] transition-colors ${item.vatRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </AnchoredPanel>
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">IRPF</label>
                                <div className="relative custom-dropdown">
                                  <button
                                    type="button"
                                    onClick={() => setOpenDropdown(openDropdown === `irpf-${index}` ? null : `irpf-${index}`)}
                                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-[13px] bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                                  >
                                    <span className="text-slate-900 truncate">{IRPF_RATES.find(r => r.value === item.irpfRate)?.label ?? `${item.irpfRate}%`}</span>
                                    <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === `irpf-${index}` ? "rotate-180" : ""}`} />
                                  </button>
                                  {openDropdown === `irpf-${index}` && (
                                    <AnchoredPanel className="bg-white border border-slate-200 rounded-md shadow-lg py-1 max-h-48 overflow-y-auto" match="width">
                                      {IRPF_RATES.map(opt => (
                                        <button
                                          key={opt.value}
                                          type="button"
                                          onClick={() => { updateItem(index, "irpfRate", parseFloat(String(opt.value))); setOpenDropdown(null); }}
                                          className={`w-full px-4 py-2 text-left text-[13px] transition-colors ${item.irpfRate === opt.value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </AnchoredPanel>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex justify-end">
                              <div className="bg-slate-900 text-white px-4 py-2 rounded-md text-[13px]">
                                <span className="text-slate-400">Total:</span>
                                <span className="ml-2 font-semibold">{formatCurrency(item.totalAmount)} €</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Sidebar */}
          <div className="col-span-1">
            <div className="space-y-4">
              {/* Progress Card */}
              <div className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[13px] font-medium text-slate-700">Progreso</span>
                  <span className={cx("text-[13px] font-bold", completionPercentage === 100 ? "text-emerald-600" : "text-slate-900")}>{completionPercentage}%</span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={cx("h-full transition-all duration-300", completionPercentage === 100 ? "bg-emerald-500" : "")}
                    style={{ width: completionPercentage + "%", backgroundColor: completionPercentage < 100 ? "#2F52E0" : undefined }}
                  />
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {uploadedFile ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={uploadedFile ? "text-slate-700" : "text-slate-400"}>Archivo</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {(formData.invoiceType === "with-po" ? selectedPO : formData.supplier || linkedDocumentId) ? (
                      <CheckCircle2 size={12} className="text-emerald-600" />
                    ) : (
                      <Circle size={12} className="text-slate-300" />
                    )}
                    <span className={(formData.invoiceType === "with-po" ? selectedPO : formData.supplier || linkedDocumentId) ? "text-slate-700" : "text-slate-400"}>
                      {formData.invoiceType === "with-po" ? "PO" : "Proveedor"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {formData.description.trim() ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Circle size={12} className="text-slate-300" />}
                    <span className={formData.description.trim() ? "text-slate-700" : "text-slate-400"}>Descripción</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {(multipleDueDates ? isDueDatesValid() && dueDates.every(d => d.date) : formData.dueDate) ? (
                      <CheckCircle2 size={12} className="text-emerald-600" />
                    ) : (
                      <Circle size={12} className="text-slate-300" />
                    )}
                    <span className={(multipleDueDates ? isDueDatesValid() && dueDates.every(d => d.date) : formData.dueDate) ? "text-slate-700" : "text-slate-400"}>
                      Vencimiento{multipleDueDates ? ` (${dueDates.length})` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0) ? (
                      <CheckCircle2 size={12} className="text-emerald-600" />
                    ) : (
                      <Circle size={12} className="text-slate-300" />
                    )}
                    <span className={items.some((i) => i.description.trim() && i.subAccountId && i.quantity > 0 && i.unitPrice > 0) ? "text-slate-700" : "text-slate-400"}>
                      Items válidos
                    </span>
                  </div>
                </div>
              </div>

              {/* Document Type Card */}
              <div className={cx(currentDocType.bgColor, "border", currentDocType.borderColor, "rounded-lg p-5")}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-md flex items-center justify-center">
                    <DocIcon size={20} className={currentDocType.textColor} />
                  </div>
                  <div>
                    <p className={cx("font-semibold", currentDocType.textColor)}>{currentDocType.label}</p>
                    <p className="text-[13px] text-slate-600">{getDocumentNumber()}</p>
                  </div>
                </div>
              </div>

              {/* Totals Card */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-900">Total</h2>
                </div>
                <div className="p-6">
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-500">Base</span>
                      <span className="font-medium text-slate-900">{formatCurrency(totals.baseAmount)} €</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-500">IVA</span>
                      <span className="font-medium text-emerald-600">+{formatCurrency(totals.vatAmount)} €</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[13px] text-slate-500">IRPF</span>
                      <span className="font-medium text-red-600">-{formatCurrency(totals.irpfAmount)} €</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-base font-semibold text-slate-900">Total</span>
                      <span className="text-xl font-bold text-slate-900">{formatCurrency(totals.totalAmount)} €</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Approval Preview Card */}
              <div className={cx("border rounded-lg overflow-hidden", approvalPreview.autoApprove ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200")}>
                <div className="px-5 py-4 border-b" style={{ borderColor: approvalPreview.autoApprove ? "#a7f3d0" : "#fcd34d" }}>
                  <div className="flex items-center gap-3">
                    {approvalPreview.autoApprove ? (
                      <div className="w-10 h-10 bg-emerald-100 rounded-md flex items-center justify-center">
                        <CheckCircle size={20} className="text-emerald-600" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 bg-amber-100 rounded-md flex items-center justify-center">
                        <Clock size={20} className="text-amber-600" />
                      </div>
                    )}
                    <div>
                      <p className={cx("font-semibold", approvalPreview.autoApprove ? "text-emerald-800" : "text-amber-800")}>
                        {approvalPreview.autoApprove ? "Aprobación automática" : "Requiere aprobación"}
                      </p>
                      <p className={cx("text-[13px]", approvalPreview.autoApprove ? "text-emerald-700" : "text-amber-700")}>{approvalPreview.message}</p>
                    </div>
                  </div>
                </div>
                {approvalPreview.steps.length > 0 && (
                  <div className="bg-white/60 px-5 py-4">
                    <ApprovalSteps steps={approvalPreview.steps} department={formData.department || selectedPO?.department || permissions.fixedDepartment} preview />
                  </div>
                )}
              </div>

              {/* Info Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                <div className="flex gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Info size={14} className="text-slate-500" />
                  </div>
                  <div className="text-[13px] text-slate-600">
                    <p className="font-medium text-slate-700 mb-2">Importante</p>
                    <ul className="space-y-1.5 text-slate-500">
                      <li className="flex items-start gap-2">
                        <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Archivo obligatorio</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                        <span>Fecha vencimiento obligatoria</span>
                      </li>
                      {currentDocType.requiresReplacement && (
                        <li className="flex items-start gap-2 text-amber-600">
                          <ChevronRight size={12} className="mt-0.5 flex-shrink-0" />
                          <span>Requiere factura definitiva tras pago</span>
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Sustituir proforma/presupuesto pagado por la factura definitiva */}
      <Modal open={showReplaceModal} onClose={() => setShowReplaceModal(false)} title="Sustituir por factura definitiva" width="max-w-2xl">
        {pendingDocuments.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-500">No hay documentos pagados pendientes de factura definitiva</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="tbl w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-32 px-3 py-2 text-left font-medium">Documento</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                  <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Pagado</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {pendingDocuments.map((pd) => (
                  <tr key={pd.id} onClick={() => startReplacement(pd)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F4F4F5]">
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs font-medium">{pd.displayNumber}</span>
                      <span className="ml-2 text-xs text-slate-400">{DOCUMENT_TYPES[pd.documentType]?.label}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      {pd.supplier}
                      {pd.poNumber && <span className="ml-2 font-mono text-[11px] text-slate-400">PO-{pd.poNumber}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">{formatDate(pd.paidAt)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{formatCurrency(pd.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Elegir PO */}
      <Modal open={showPOModal} onClose={() => { setShowPOModal(false); setPOSearch(""); }} title="Seleccionar PO" width="max-w-2xl">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={poSearch} onChange={(e) => setPOSearch(e.target.value)} placeholder="Número, proveedor o concepto" className="pl-8" autoFocus />
          </div>
          {filteredPOs.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-slate-500">{poSearch ? "Sin resultados" : "No hay POs aprobadas"}</p>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
              <table className="tbl w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                    <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Nº</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                    <th scope="col" className="w-20 px-3 py-2 text-right font-medium">Líneas</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPOs.map((po) => (
                    <tr key={po.id} onClick={() => selectPO(po)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F4F4F5]">
                      <td className="px-3 py-1.5 font-mono text-xs font-medium">PO-{po.number}</td>
                      <td className="px-3 py-1.5">{po.supplier}{po.department && <span className="ml-2 text-xs text-slate-400">{po.department}</span>}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{po.items.length}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{formatCurrency(po.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <POItemsModal
        open={showPOItemsModal && !!selectedPO}
        onClose={() => setShowPOItemsModal(false)}
        poNumber={selectedPO?.number}
        items={poItemsWithInvoiced}
        onPick={addPOItemToInvoice}
      />

      <SupplierPickerModal
        open={showSupplierModal}
        onClose={() => { setShowSupplierModal(false); setSupplierSearch(""); }}
        suppliers={suppliers}
        onSelect={selectSupplier}
        onCreate={(data) => createQuickSupplier(data)}
      />
      <AccountPickerModal
        open={showAccountModal}
        onClose={() => { setShowAccountModal(false); setAccountSearch(""); setCurrentItemIndex(null); }}
        subAccounts={subAccounts}
        showFigures={canSeeBudgetFigures}
        selectedId={currentItemIndex !== null ? items[currentItemIndex]?.subAccountId : undefined}
        onSelect={selectAccount}
      />
      <EpisodeModal
        open={showEpisodeModal && episodeItemIndex !== null}
        onClose={() => { setShowEpisodeModal(false); setEpisodeItemIndex(null); }}
        baseAmount={episodeItemIndex !== null ? items[episodeItemIndex]?.baseAmount || 0 : 0}
        totalEpisodes={totalEpisodes}
        initial={episodeItemIndex !== null ? items[episodeItemIndex]?.episodes : undefined}
        label={episodeItemIndex !== null ? `Línea ${episodeItemIndex + 1}` : undefined}
        onSave={(dist) => saveEpisodeDistribution(dist)}
      />

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
