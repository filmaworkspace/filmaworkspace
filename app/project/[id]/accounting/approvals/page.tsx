"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { Button, EmptyState, Field, IconButton, Modal, Page, PageHeader, PageLoading, Textarea } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import { useCanSeeBudget } from "@/hooks/useCanSeeBudget";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Building2,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  Flame,
  HelpCircle,
  History,
  Info,
  Layers,
  Link as LinkIcon,
  MessageSquare,
  Package,
  PieChart,
  Receipt,
  Send,
  Shield,
  Target,
  User,
  X,
  XCircle,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { handlePOStatusChange, handleInvoiceStatusChange, updatePOItemsInvoiced, realizeInvoice } from "@/lib/budgetOperations";
import { getCostSettings, shouldRealizeInvoice } from "@/lib/budgetRules";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface ApprovalStepStatus {
  id: string;
  order: number;
  approverType: "fixed" | "role" | "hod" | "coordinator";
  approvers: string[];
  approverNames?: string[];
  roles?: string[];
  department?: string;
  approvedBy: string[];
  rejectedBy: string[];
  status: "pending" | "approved" | "rejected";
  requireAll: boolean;
  hasAmountThreshold?: boolean;
  amountThreshold?: number;
  amountCondition?: string;
}

interface TimelineEvent {
  id: string;
  type: "created" | "approved" | "rejected" | "comment" | "info_requested";
  date: Date;
  userId: string;
  userName: string;
  stepOrder?: number;
  comment?: string;
}

interface AutoCheck {
  id: string;
  label: string;
  status: "pass" | "warning" | "fail" | "info";
  message: string;
  details?: string;
}

interface POComparison {
  poNumber: string;
  poBaseAmount: number;
  invoicedBefore: number;
  thisInvoice: number;
  remaining: number;
  percentageUsed: number;
  itemDiscrepancies: {
    description: string;
    poAmount: number;
    invoiceAmount: number;
    difference: number;
  }[];
}

interface SupplierStats {
  totalPOs: number;
  totalInvoices: number;
  pendingAmount: number;
  avgApprovalTime: number;
  lastTransaction: Date | null;
}

interface BoxExpensePreview {
  id: string;
  supplier: string;
  subAccountCode: string;
  baseAmount: number;
  vatAmount: number;
  totalAmount: number;
  date?: string;
  personName?: string;
}

interface PendingApproval {
  id: string;
  type: "po" | "invoice" | "box";
  documentId: string;
  documentNumber: string;
  displayNumber?: string;
  projectId: string;
  projectName: string;
  supplier: string;
  supplierId?: string;
  amount: number;
  baseAmount: number;
  description: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  currentApprovalStep: number;
  approvalSteps: ApprovalStepStatus[];
  attachmentUrl?: string;
  attachmentFileName?: string;
  items?: any[];
  department?: string;
  poType?: string;
  currency?: string;
  poId?: string;
  poNumber?: string;
  timeline: TimelineEvent[];
  autoChecks: AutoCheck[];
  poComparison?: POComparison;
  supplierStats?: SupplierStats;
  daysWaiting: number;
  isUrgent: boolean;
  budgetImpact?: {
    accountCode: string;
    accountName: string;
    budgeted: number;
    committed: number;
    actual: number;
    available: number;
    afterApproval: number;
    committedAfter?: number;
    actualAfter?: number;
  }[];
  boxType?: "card" | "transfer";
  boxExpenses?: BoxExpensePreview[];
  expenseCount?: number;
  cardName?: string;
  paymentDate?: string;
}

interface UserStats {
  approvedToday: number;
  approvedThisWeek: number;
  approvedThisMonth: number;
  avgResponseTime: number;
  pendingCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const canSeeBudgetFigures = useCanSeeBudget(id);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userDepartment, setUserDepartment] = useState("");
  const [userPosition, setUserPosition] = useState("");
  const [projectName, setProjectName] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [filteredApprovals, setFilteredApprovals] = useState<PendingApproval[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState<"all" | "po" | "invoice" | "box">("all");
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [approvalComment, setApprovalComment] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["checks", "timeline"]));
  const [userStats, setUserStats] = useState<UserStats>({ approvedToday: 0, approvedThisWeek: 0, approvedThisMonth: 0, avgResponseTime: 0, pendingCount: 0 });
  const [showInfoRequestModal, setShowInfoRequestModal] = useState(false);
  const [infoRequestMessage, setInfoRequestMessage] = useState("");
  const [members, setMembers] = useState<Record<string, string>>({});

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales de aprobación/rechazo/solicitud de información está abierto.
  useBodyScrollLock(showApprovalModal || showRejectionModal || showInfoRequestModal);

  useEffect(() => { const unsub = onAuthStateChanged(auth, (u) => { if (!u) router.push("/"); else { setUserId(u.uid); setUserName(u.displayName || u.email || "Usuario"); } }); return () => unsub(); }, [router]);
  useEffect(() => { if (userId && id) loadPendingApprovals(); }, [userId, id]);
  const [apprSearch, setApprSearch] = useState("");
  const [apprField, setApprField] = useState<"all" | "number" | "supplier" | "amount">("all");
  useEffect(() => {
    let filtered = [...pendingApprovals];
    if (typeFilter !== "all") filtered = filtered.filter((a) => a.type === typeFilter);
    const q = apprSearch.trim();
    if (q) {
      filtered = filtered.filter((a) => {
        const byNumber = matchCode(q, a.displayNumber, a.poNumber ? `PO-${a.poNumber}` : "");
        const bySupplier = matchWords(q, a.supplier, a.description, a.createdByName);
        const byAmount = matchAmount(q, a.amount, a.baseAmount) === true;
        return apprField === "number" ? byNumber : apprField === "supplier" ? bySupplier : apprField === "amount" ? byAmount : byNumber || bySupplier || byAmount;
      });
    }
    setFilteredApprovals(filtered);
    setCurrentIndex(0);
  }, [typeFilter, pendingApprovals, apprSearch, apprField]);

  const toggleSection = (section: string) => { const n = new Set(expandedSections); if (n.has(section)) n.delete(section); else n.add(section); setExpandedSections(n); };

  const loadPendingApprovals = async () => {
    try {
      setLoading(true);
      const approvals: PendingApproval[] = [];
      let localProjectName = "Proyecto";
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) { localProjectName = projectDoc.data().name || "Proyecto"; setProjectName(localProjectName); }

      const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
      const membersMap: Record<string, string> = {};
      for (const mDoc of membersSnap.docs) { const mData = mDoc.data(); membersMap[mDoc.id] = mData.name || mData.email || mDoc.id; }
      setMembers(membersMap);

      let localUserRole = "", localUserDepartment = "", localUserPosition = "";
      const memberDoc = await getDoc(doc(db, `projects/${id}/members`, userId!));
      if (memberDoc.exists()) { const d = memberDoc.data(); localUserRole = d.role || ""; localUserDepartment = d.department || ""; localUserPosition = d.position || ""; setUserRole(localUserRole); setUserDepartment(localUserDepartment); setUserPosition(localUserPosition); }

      const subAccountsMap: Record<string, any> = {};
      const accountsSnap = await getDocs(collection(db, `projects/${id}/accounts`));
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subsSnap = await getDocs(collection(db, `projects/${id}/accounts/${accDoc.id}/subaccounts`));
        for (const subDoc of subsSnap.docs) { const subData = subDoc.data(); subAccountsMap[subDoc.id] = { id: subDoc.id, code: subData.code, description: subData.description, budgeted: subData.budgeted || 0, committed: subData.committed || 0, actual: subData.actual || 0, available: (subData.budgeted || 0) - (subData.committed || 0) - (subData.actual || 0), accountCode: accData.code, accountDescription: accData.description }; }
      }

      await loadUserStats(localUserRole, localUserDepartment, localUserPosition);

      // Load POs
      const posSnap = await getDocs(query(collection(db, `projects/${id}/pos`), where("status", "==", "pending")));
      for (const poDoc of posSnap.docs) {
        const d = poDoc.data();
        if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
          const createdAt = d.createdAt?.toDate() || new Date();
          const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
          approvals.push({
            id: poDoc.id, type: "po", documentId: poDoc.id, documentNumber: d.number, displayNumber: `PO-${d.number}`,
            projectId: id, projectName: localProjectName, supplier: d.supplier, supplierId: d.supplierId,
            amount: d.totalAmount || 0, baseAmount: d.baseAmount || d.totalAmount || 0, description: d.generalDescription || d.description || "",
            createdAt, createdBy: d.createdBy, createdByName: d.createdByName || membersMap[d.createdBy] || "Usuario",
            currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: d.approvalSteps || [],
            attachmentUrl: d.attachmentUrl, attachmentFileName: d.attachmentFileName,
            items: d.items || [], department: d.department, poType: d.poType, currency: d.currency || "EUR",
            timeline: buildTimeline(d, membersMap), autoChecks: buildAutoChecks(d, "po", subAccountsMap),
            budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, "po", false),
            supplierStats: await loadSupplierStats(d.supplierId), daysWaiting, isUrgent: daysWaiting >= 3,
          });
        }
      }

      // Load Invoices
      try {
        const invoicesSnap = await getDocs(query(collection(db, `projects/${id}/invoices`), where("status", "in", ["submitted", "pending_approval"])));
        for (const invDoc of invoicesSnap.docs) {
          const d = invDoc.data();
          // Solo facturas pendientes de aprobar (sin track de aprobación completado)
          if (d.approvedAt) continue;
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            let poComparison: POComparison | undefined;
            if (d.poId) poComparison = await loadPOComparison(d.poId, d.items || [], d.baseAmount || 0, invDoc.id);
            approvals.push({
              id: invDoc.id, type: "invoice", documentId: invDoc.id, documentNumber: d.number,
              displayNumber: d.displayNumber || `FRA-${d.number}`, projectId: id, projectName: localProjectName,
              supplier: d.supplier, supplierId: d.supplierId, amount: d.totalAmount || 0, baseAmount: d.baseAmount || d.totalAmount || 0,
              description: d.description || "", createdAt, createdBy: d.createdBy,
              createdByName: d.createdByName || membersMap[d.createdBy] || "Usuario",
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: d.approvalSteps || [],
              attachmentUrl: d.attachmentUrl, attachmentFileName: d.attachmentFileName,
              items: d.items || [], poId: d.poId, poNumber: d.poNumber,
              timeline: buildTimeline(d, membersMap), autoChecks: buildAutoChecks(d, "invoice", subAccountsMap),
              budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, "invoice", !!d.poId),
              supplierStats: await loadSupplierStats(d.supplierId), poComparison, daysWaiting, isUrgent: daysWaiting >= 3,
            });
          }
        }
      } catch (e) {}

      // Load Card Envelopes (sobres de tarjeta pendientes de aprobación)
      try {
        const cardEnvSnap = await getDocs(query(collection(db, `projects/${id}/cardEnvelopes`), where("status", "==", "pending_approval")));
        for (const envDoc of cardEnvSnap.docs) {
          const d = envDoc.data();
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            
            // Cargar gastos del sobre
            const expensesSnap = await getDocs(query(collection(db, `projects/${id}/cardExpenses`), where("envelopeId", "==", envDoc.id)));
            const boxExpenses: BoxExpensePreview[] = expensesSnap.docs.map(expDoc => {
              const expData = expDoc.data();
              return {
                id: expDoc.id,
                supplier: expData.supplier || "",
                subAccountCode: expData.subAccountCode || "",
                baseAmount: expData.baseAmount || 0,
                vatAmount: expData.vatAmount || 0,
                totalAmount: expData.totalAmount || 0,
                date: expData.date?.toDate ? new Intl.DateTimeFormat("es-ES").format(expData.date.toDate()) : "",
              };
            });
            
            // Obtener nombre de la tarjeta
            let cardName = d.boxCode || "";
            try {
              const cardDoc = await getDoc(doc(db, `projects/${id}/cards`, d.boxId));
              if (cardDoc.exists()) cardName = cardDoc.data().name || d.boxCode;
            } catch (e) {}
            
            approvals.push({
              id: envDoc.id, type: "box", documentId: envDoc.id, documentNumber: d.displayNumber || `ENV-${d.number}`,
              displayNumber: d.displayNumber || `ENV-${d.number}`, projectId: id, projectName: localProjectName,
              supplier: cardName, amount: d.totalAmount || 0, baseAmount: d.totalBase || 0,
              description: `Sobre de tarjeta · ${d.expenseCount || 0} gastos`,
              createdAt, createdBy: d.createdBy, createdByName: d.createdByName || membersMap[d.createdBy] || "Usuario",
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: d.approvalSteps || [],
              timeline: buildTimeline(d, membersMap), autoChecks: [],
              daysWaiting, isUrgent: daysWaiting >= 3,
              boxType: "card", boxExpenses, expenseCount: d.expenseCount || 0, cardName,
            });
          }
        }
      } catch (e) {}

      // Load Transfer Envelopes (sobres de transferencia pendientes de aprobación)
      try {
        const transferEnvSnap = await getDocs(query(collection(db, `projects/${id}/transferEnvelopes`), where("status", "==", "pending_approval")));
        for (const envDoc of transferEnvSnap.docs) {
          const d = envDoc.data();
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            
            // Cargar gastos del sobre
            const expensesSnap = await getDocs(query(collection(db, `projects/${id}/transferExpenses`), where("envelopeId", "==", envDoc.id)));
            const boxExpenses: BoxExpensePreview[] = expensesSnap.docs.map(expDoc => {
              const expData = expDoc.data();
              return {
                id: expDoc.id,
                supplier: expData.supplier || "",
                subAccountCode: expData.subAccountCode || "",
                baseAmount: expData.baseAmount || 0,
                vatAmount: expData.vatAmount || 0,
                totalAmount: expData.totalAmount || 0,
                date: expData.date || "",
                personName: expData.personName || "",
              };
            });
            
            approvals.push({
              id: envDoc.id, type: "box", documentId: envDoc.id, documentNumber: d.displayNumber || `TRF-${d.number}`,
              displayNumber: d.displayNumber || `TRF-${d.number}`, projectId: id, projectName: localProjectName,
              supplier: `Transferencia`, amount: d.totalAmount || 0, baseAmount: d.totalBase || 0,
              description: `Sobre de transferencia · ${d.expenseCount || 0} gastos`,
              createdAt, createdBy: d.createdBy, createdByName: d.createdByName || membersMap[d.createdBy] || "Usuario",
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: d.approvalSteps || [],
              timeline: buildTimeline(d, membersMap), autoChecks: [],
              daysWaiting, isUrgent: daysWaiting >= 3,
              boxType: "transfer", boxExpenses, expenseCount: d.expenseCount || 0, paymentDate: d.paymentDate,
            });
          }
        }
      } catch (e) {}

      approvals.sort((a, b) => { if (a.isUrgent && !b.isUrgent) return -1; if (!a.isUrgent && b.isUrgent) return 1; return b.createdAt.getTime() - a.createdAt.getTime(); });
      setPendingApprovals(approvals);
      setFilteredApprovals(approvals);
      setUserStats(prev => ({ ...prev, pendingCount: approvals.length }));
      setLoading(false);
    } catch (error: any) { setErrorMessage(`Error: ${error.message}`); setLoading(false); }
  };

  const loadUserStats = async (role: string, dept: string, pos: string) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      let approvedToday = 0, approvedThisWeek = 0, approvedThisMonth = 0;

      const posSnap = await getDocs(query(collection(db, `projects/${id}/pos`), where("status", "==", "approved")));
      for (const poDoc of posSnap.docs) {
        const d = poDoc.data();
        if (d.approvedBy === userId || d.approvalSteps?.some((s: any) => s.approvedBy?.includes(userId))) {
          const approvedAt = d.approvedAt?.toDate();
          if (approvedAt) { if (approvedAt >= todayStart) approvedToday++; if (approvedAt >= weekStart) approvedThisWeek++; if (approvedAt >= monthStart) approvedThisMonth++; }
        }
      }
      try {
        const invSnap = await getDocs(query(collection(db, `projects/${id}/invoices`), where("approvalStatus", "==", "approved")));
        for (const invDoc of invSnap.docs) {
          const d = invDoc.data();
          if (d.approvedBy === userId || d.approvalSteps?.some((s: any) => s.approvedBy?.includes(userId))) {
            const approvedAt = d.approvedAt?.toDate();
            if (approvedAt) { if (approvedAt >= todayStart) approvedToday++; if (approvedAt >= weekStart) approvedThisWeek++; if (approvedAt >= monthStart) approvedThisMonth++; }
          }
        }
      } catch (e) {}
      setUserStats(prev => ({ ...prev, approvedToday, approvedThisWeek, approvedThisMonth }));
    } catch (e) {}
  };

  const loadSupplierStats = async (supplierId?: string): Promise<SupplierStats | undefined> => {
    if (!supplierId) return undefined;
    try {
      let totalPOs = 0, totalInvoices = 0, pendingAmount = 0;
      let lastTransaction: Date | null = null;
      const posSnap = await getDocs(query(collection(db, `projects/${id}/pos`), where("supplierId", "==", supplierId)));
      totalPOs = posSnap.size;
      for (const poDoc of posSnap.docs) { const d = poDoc.data(); if (d.status === "pending") pendingAmount += d.totalAmount || 0; const created = d.createdAt?.toDate(); if (created && (!lastTransaction || created > lastTransaction)) lastTransaction = created; }
      try { const invSnap = await getDocs(query(collection(db, `projects/${id}/invoices`), where("supplierId", "==", supplierId))); totalInvoices = invSnap.size; for (const invDoc of invSnap.docs) { const d = invDoc.data(); if (d.status === "pending" || d.status === "pending_approval") pendingAmount += d.totalAmount || 0; } } catch (e) {}
      return { totalPOs, totalInvoices, pendingAmount, avgApprovalTime: 0, lastTransaction };
    } catch (e) { return undefined; }
  };

  const loadPOComparison = async (poId: string, invoiceItems: any[], invoiceBaseAmount: number, currentInvoiceId: string): Promise<POComparison | undefined> => {
    try {
      const poDoc = await getDoc(doc(db, `projects/${id}/pos`, poId));
      if (!poDoc.exists()) return undefined;
      const poData = poDoc.data();
      const poBaseAmount = poData.baseAmount || 0;
      let invoicedBefore = 0;
      try { const invSnap = await getDocs(query(collection(db, `projects/${id}/invoices`), where("poId", "==", poId))); for (const invDoc of invSnap.docs) { if (invDoc.id !== currentInvoiceId) { const d = invDoc.data(); if (["pending", "pending_approval", "approved", "paid"].includes(d.status)) invoicedBefore += d.baseAmount || 0; } } } catch (e) {}
      const remaining = poBaseAmount - invoicedBefore - invoiceBaseAmount;
      const percentageUsed = poBaseAmount > 0 ? ((invoicedBefore + invoiceBaseAmount) / poBaseAmount) * 100 : 0;
      const itemDiscrepancies: POComparison["itemDiscrepancies"] = [];
      const poItems = poData.items || [];
      for (const invItem of invoiceItems) {
        if (invItem.poItemId || invItem.poItemIndex !== undefined) {
          const poItemIndex = invItem.poItemIndex ?? poItems.findIndex((p: any) => p.id === invItem.poItemId);
          if (poItemIndex >= 0 && poItemIndex < poItems.length) {
            const poItem = poItems[poItemIndex];
            const diff = (invItem.baseAmount || 0) - (poItem.baseAmount || 0);
            if (Math.abs(diff) > 0.01) itemDiscrepancies.push({ description: invItem.description || poItem.description, poAmount: poItem.baseAmount || 0, invoiceAmount: invItem.baseAmount || 0, difference: diff });
          }
        }
      }
      return { poNumber: poData.number, poBaseAmount, invoicedBefore, thisInvoice: invoiceBaseAmount, remaining, percentageUsed, itemDiscrepancies };
    } catch (e) { return undefined; }
  };

  const buildTimeline = (docData: any, membersMap: Record<string, string>): TimelineEvent[] => {
    const events: TimelineEvent[] = [];
    events.push({ id: "created", type: "created", date: docData.createdAt?.toDate() || new Date(), userId: docData.createdBy, userName: docData.createdByName || membersMap[docData.createdBy] || "Usuario" });
    if (docData.approvalSteps) {
      for (const step of docData.approvalSteps) {
        if (step.approvedBy?.length > 0) {
          for (const approverId of step.approvedBy) events.push({ id: `approved-${step.order}-${approverId}`, type: "approved", date: new Date(), userId: approverId, userName: membersMap[approverId] || approverId, stepOrder: step.order });
        }
      }
    }
    if (docData.comments) { for (const comment of docData.comments) events.push({ id: `comment-${comment.id}`, type: comment.type === "info_request" ? "info_requested" : "comment", date: comment.createdAt?.toDate() || new Date(), userId: comment.userId, userName: membersMap[comment.userId] || comment.userName || "Usuario", comment: comment.text }); }
    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  };

  const buildAutoChecks = (docData: any, type: "po" | "invoice", subAccountsMap: Record<string, any>): AutoCheck[] => {
    const checks: AutoCheck[] = [];
    const items = docData.items || [];
    const totalAmount = docData.totalAmount || 0;
    checks.push({ id: "attachment", label: "Documento adjunto", status: docData.attachmentUrl ? "pass" : "warning", message: docData.attachmentUrl ? "Archivo adjunto disponible" : "Sin documento adjunto" });
    let hasBudgetIssue = false, budgetMessage = "Todas las cuentas tienen presupuesto";
    for (const item of items) { if (item.subAccountId && subAccountsMap[item.subAccountId]) { const sub = subAccountsMap[item.subAccountId]; if (sub.available < (item.baseAmount || item.totalAmount || 0)) { hasBudgetIssue = true; budgetMessage = `${sub.code} supera el presupuesto`; break; } } }
    checks.push({ id: "budget", label: "Presupuesto disponible", status: hasBudgetIssue ? "fail" : "pass", message: budgetMessage });
    checks.push({ id: "supplier", label: "Proveedor", status: docData.supplierId ? "pass" : "info", message: docData.supplierId ? "Proveedor registrado" : "Proveedor no vinculado" });
    if (totalAmount > 25000) checks.push({ id: "amount-high", label: "Importe elevado", status: "warning", message: `Superior a 25.000 €`, details: "Puede requerir aprobaciones adicionales" });
    if (type === "invoice") { if (docData.poId) checks.push({ id: "po-link", label: "Vinculación a PO", status: "pass", message: `Vinculada a PO-${docData.poNumber}` }); else checks.push({ id: "po-link", label: "Vinculación a PO", status: "info", message: "Sin PO asociada" }); }
    return checks;
  };

  // docType: "po" = la aprobación compromete presupuesto; "invoice" = puede realizar según config
  const calculateBudgetImpact = (items: any[], subAccountsMap: Record<string, any>, docType: "po" | "invoice", hasPO: boolean): PendingApproval["budgetImpact"] => {
    const impact: PendingApproval["budgetImpact"] = [];
    const accountImpacts: Record<string, number> = {};
    for (const item of items) { if (item.subAccountId && subAccountsMap[item.subAccountId]) accountImpacts[item.subAccountId] = (accountImpacts[item.subAccountId] || 0) + (item.baseAmount || 0); }
    for (const [subAccountId, amount] of Object.entries(accountImpacts)) {
      const sub = subAccountsMap[subAccountId];
      if (!sub) continue;
      let newCommitted = sub.committed;
      let newActual = sub.actual;
      if (docType === "po") {
        // Aprobar una PO compromete presupuesto
        newCommitted = sub.committed + amount;
      } else if (docType === "invoice" && hasPO) {
        // Factura con PO: comprometido baja, realizado sube (neto = 0 en disponible)
        newCommitted = Math.max(0, sub.committed - amount);
        newActual = sub.actual + amount;
      } else {
        // Factura sin PO: realizado sube, disponible baja
        newActual = sub.actual + amount;
      }
      const newAvailable = sub.budgeted - newCommitted - newActual;
      impact.push({
        accountCode: sub.code,
        accountName: sub.description,
        budgeted: sub.budgeted,
        committed: sub.committed,
        actual: sub.actual,
        available: sub.available,
        afterApproval: newAvailable,
        committedAfter: newCommitted,
        actualAfter: newActual,
      });
    }
    return impact;
  };

  const canUserApprove = (docData: any, uId: string, uRole: string, uDept: string, uPos: string): boolean => {
    if (!docData.approvalSteps || docData.currentApprovalStep === undefined) return false;
    const step = docData.approvalSteps[docData.currentApprovalStep];
    if (!step || step.status !== "pending") return false;
    if (step.approvedBy?.includes(uId) || step.rejectedBy?.includes(uId)) return false;
    if (step.hasAmountThreshold && step.amountThreshold) {
      const amount = docData.totalAmount || 0;
      if (step.amountCondition === "above" && amount <= step.amountThreshold) return false;
      if (step.amountCondition === "below" && amount >= step.amountThreshold) return false;
      if (step.amountCondition === "between" && (amount < step.amountThreshold || amount > (step.amountThresholdMax || Infinity))) return false;
    }
    switch (step.approverType) {
      case "fixed": return step.approvers?.includes(uId) || false;
      case "role": return step.roles?.includes(uRole) || false;
      case "hod": return uPos === "HOD" && uDept === (step.department || docData.department);
      case "coordinator": return uPos === "Coordinator" && uDept === (step.department || docData.department);
      default: return false;
    }
  };

  const handleApprove = async (approval: PendingApproval, withComment: boolean = false) => {
    if (withComment && !approvalComment.trim()) { setErrorMessage("Escribe un comentario"); return; }
    setShowApprovalModal(false);
    setProcessing(true);
    try {
      let collectionName = approval.type === "po" ? "pos" : approval.type === "invoice" ? "invoices" : "";
      
      // Para sobres BOX, determinar la colección según boxType
      if (approval.type === "box") {
        collectionName = approval.boxType === "card" ? "cardEnvelopes" : "transferEnvelopes";
      }
      
      const docRef = doc(db, `projects/${approval.projectId}/${collectionName}`, approval.documentId);
      const docSnap = await getDoc(docRef);
      if (!docSnap.exists()) { setErrorMessage("El documento ya no existe"); setProcessing(false); return; }
      const docData = docSnap.data();
      const currentStepIndex = docData.currentApprovalStep || 0;
      const currentStep = docData.approvalSteps[currentStepIndex];
      const newApprovedBy = [...(currentStep.approvedBy || []), userId];
      let isStepComplete = currentStep.requireAll ? newApprovedBy.length >= (currentStep.approverType === "fixed" ? currentStep.approvers.length : currentStep.roles?.length || 1) : true;
      const updatedSteps = [...docData.approvalSteps];
      updatedSteps[currentStepIndex] = { ...currentStep, approvedBy: newApprovedBy, status: isStepComplete ? "approved" : "pending" };
      const isLastStep = currentStepIndex === docData.approvalSteps.length - 1;
      const allStepsComplete = isStepComplete && isLastStep;
      const updates: any = { approvalSteps: updatedSteps };
      if (approvalComment.trim()) { const comments = docData.comments || []; comments.push({ id: `comment-${Date.now()}`, userId, userName, text: approvalComment.trim(), createdAt: Timestamp.now(), type: "approval" }); updates.comments = comments; }
      if (isStepComplete && !isLastStep) updates.currentApprovalStep = currentStepIndex + 1;
      else if (allStepsComplete) {
        const oldStatus = docData.status || "pending";
        
        if (approval.type === "po") {
          updates.status = "approved";
          updates.approvedAt = Timestamp.now();
          updates.approvedBy = userId;
          updates.approvedByName = userName;
          
          // Calcular totales para la PO
          let totalBaseAmount = 0;
          const budgetItems: Array<{ subAccountId: string; baseAmount: number }> = [];
          
          for (const item of (approval.items || [])) {
            const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
            totalBaseAmount += itemBaseAmount;
            if (item.subAccountId) {
              budgetItems.push({ subAccountId: item.subAccountId, baseAmount: itemBaseAmount });
            }
          }
          
          updates.committedAmount = totalBaseAmount;
          updates.remainingAmount = totalBaseAmount;
          
          // Verificar si hay items comprometidos anteriores (edición de PO aprobada).
          // Los enriquecemos con invoicedAmount para que uncommitPO no reste
          // lo que ya pasó a actual vía facturas realizadas.
          let previousCommittedItems = docData.previousCommittedItems || null;
          if (previousCommittedItems && previousCommittedItems.length > 0) {
            const invoicedBySubAccount: Record<string, number> = {};
            for (const item of (docData.items || [])) {
              if (item.subAccountId) {
                invoicedBySubAccount[item.subAccountId] =
                  (invoicedBySubAccount[item.subAccountId] || 0) + (item.invoicedAmount || 0);
              }
            }
            previousCommittedItems = previousCommittedItems.map((item: any) => ({
              ...item,
              invoicedAmount: invoicedBySubAccount[item.subAccountId] || 0,
            }));
          }

          await handlePOStatusChange(approval.projectId, oldStatus, "approved", budgetItems, previousCommittedItems);
          
          // Limpiar previousCommittedItems después de aprobar
          updates.previousCommittedItems = null;
          
        } else if (approval.type === "invoice") {
          // Factura: la aprobación completa el track de aprobación. El lifecycle
          // pasa a "submitted" (estado activo). La realización del presupuesto solo
          // ocurre aquí si el trigger es on_approve; para on_code/on_account ocurre
          // al codificar/contabilizar.
          const approvedAt = Timestamp.now();
          updates.status = "submitted";
          updates.approvalStatus = "approved";
          updates.approvedAt = approvedAt;
          updates.approvedBy = userId;
          updates.approvedByName = userName;

          const budgetItems: Array<{ subAccountId: string; baseAmount: number; poItemIndex?: number }> = [];
          for (const item of (approval.items || [])) {
            const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
            if (item.subAccountId) {
              budgetItems.push({ subAccountId: item.subAccountId, baseAmount: itemBaseAmount, poItemIndex: item.poItemIndex });
            }
          }

          const costSettings = await getCostSettings(approval.projectId);
          // Realizar solo si el trigger es on_approve. shouldRealizeInvoice con el
          // track approvedAt devuelve true para on_approve y false para on_code/on_account.
          const realizeNow = shouldRealizeInvoice("submitted", costSettings, { approvedAt });
          if (realizeNow) {
            const wasRealized = shouldRealizeInvoice(oldStatus, costSettings);
            if (!wasRealized && budgetItems.length > 0) {
              await realizeInvoice(approval.projectId, budgetItems.map(b => ({ subAccountId: b.subAccountId, baseAmount: b.baseAmount })));
              if (approval.poId) await updatePOItemsInvoiced(approval.projectId, approval.poId, budgetItems, "add");
            }
          }
        } else if (approval.type === "box") {
          // Sobre BOX (tarjeta o transferencia)
          updates.approvedAt = Timestamp.now();
          updates.approvedBy = userId;
          updates.approvedByName = userName;
          
          if (approval.boxType === "card") {
            // Sobre de tarjeta: pasa a "reviewing" (revisado y aprobado, pendiente de cerrar)
            updates.status = "reviewing";
          } else {
            // Sobre de transferencia: pasa directamente a "pending" (aprobado, pendiente de transferir)
            updates.status = "pending";
          }
        }
      }
      await updateDoc(docRef, updates);
      setPendingApprovals(pendingApprovals.filter((a) => a.id !== approval.id));
      setSuccessMessage(allStepsComplete ? `${approval.displayNumber} aprobado` : "Aprobación registrada");
      setTimeout(() => setSuccessMessage(""), 3000);
      setApprovalComment(""); setShowCommentInput(false);
      if (currentIndex >= filteredApprovals.length - 1) setCurrentIndex(Math.max(0, currentIndex - 1));
    } catch (error: any) { setErrorMessage(`Error: ${error.message}`); setTimeout(() => setErrorMessage(""), 5000); } finally { setProcessing(false); }
  };

  const handleReject = async () => {
    if (!selectedApproval || !rejectionReason.trim()) { setErrorMessage("Debes proporcionar un motivo"); return; }
    setProcessing(true);
    try {
      let collectionName = selectedApproval.type === "po" ? "pos" : selectedApproval.type === "invoice" ? "invoices" : "";
      
      // Para sobres BOX, determinar la colección según boxType
      if (selectedApproval.type === "box") {
        collectionName = selectedApproval.boxType === "card" ? "cardEnvelopes" : "transferEnvelopes";
      }
      
      const docRef = doc(db, `projects/${selectedApproval.projectId}/${collectionName}`, selectedApproval.documentId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const docData = docSnap.data();
        const oldStatus = docData.status || "pending";
        
        // Manejar el presupuesto según tipo de documento
        if (selectedApproval.type === "po") {
          // Agrupar invoicedAmount actual por subAccountId para no restar de committed
          // lo que ya pasó a actual mediante facturas realizadas.
          const invoicedBySubAccount: Record<string, number> = {};
          for (const item of (docData.items || [])) {
            if (item.subAccountId) {
              invoicedBySubAccount[item.subAccountId] =
                (invoicedBySubAccount[item.subAccountId] || 0) + (item.invoicedAmount || 0);
            }
          }

          const previousCommittedItems = docData.previousCommittedItems;

          if (previousCommittedItems && previousCommittedItems.length > 0) {
            // Enriquecer los items históricos con el invoicedAmount actual antes de descomprometer
            const enrichedPrevious = previousCommittedItems.map((item: any) => ({
              ...item,
              invoicedAmount: invoicedBySubAccount[item.subAccountId] || 0,
            }));
            await handlePOStatusChange(selectedApproval.projectId, "approved", "rejected", enrichedPrevious);
          } else {
            const budgetItems: Array<{ subAccountId: string; baseAmount: number; invoicedAmount: number }> = [];
            for (const item of (selectedApproval.items || [])) {
              const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
              if (item.subAccountId) {
                budgetItems.push({
                  subAccountId: item.subAccountId,
                  baseAmount: itemBaseAmount,
                  // Incluir lo ya realizado para que uncommitPO solo reste el saldo pendiente
                  invoicedAmount: invoicedBySubAccount[item.subAccountId] || 0,
                });
              }
            }
            await handlePOStatusChange(selectedApproval.projectId, oldStatus, "rejected", budgetItems);
          }
        } else if (selectedApproval.type === "invoice") {
          // Factura
          const budgetItems: Array<{ subAccountId: string; baseAmount: number }> = [];
          for (const item of (selectedApproval.items || [])) {
            const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
            if (item.subAccountId) {
              budgetItems.push({ subAccountId: item.subAccountId, baseAmount: itemBaseAmount });
            }
          }
          await handleInvoiceStatusChange(selectedApproval.projectId, oldStatus, "rejected", budgetItems);
        }
        // Para sobres BOX no hay operación de presupuesto al rechazar (aún no se ha cerrado)
      }
      
      // Determinar el nuevo status según el tipo
      let newStatus = "rejected";
      if (selectedApproval.type === "box") {
        // Los sobres BOX vuelven a estado anterior (open para tarjetas, draft para transferencias)
        newStatus = selectedApproval.boxType === "card" ? "open" : "draft";
      }
      
      await updateDoc(docRef, { 
        status: newStatus, 
        rejectedAt: Timestamp.now(), 
        rejectedBy: userId, 
        rejectedByName: userName, 
        rejectionReason: rejectionReason.trim(),
        previousCommittedItems: null // Limpiar al rechazar
      });
      
      setPendingApprovals(pendingApprovals.filter((a) => a.id !== selectedApproval.id));
      setSuccessMessage(`${selectedApproval.displayNumber} rechazado`);
      setTimeout(() => setSuccessMessage(""), 3000);
      setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null);
      if (currentIndex >= filteredApprovals.length - 1) setCurrentIndex(Math.max(0, currentIndex - 1));
    } catch (error: any) { setErrorMessage(`Error: ${error.message}`); } finally { setProcessing(false); }
  };

  const handleRequestInfo = async () => {
    if (!selectedApproval || !infoRequestMessage.trim()) { setErrorMessage("Escribe qué información necesitas"); return; }
    setProcessing(true);
    try {
      let collectionName = selectedApproval.type === "po" ? "pos" : selectedApproval.type === "invoice" ? "invoices" : "";
      if (selectedApproval.type === "box") {
        collectionName = selectedApproval.boxType === "card" ? "cardEnvelopes" : "transferEnvelopes";
      }
      const docRef = doc(db, `projects/${selectedApproval.projectId}/${collectionName}`, selectedApproval.documentId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) { const comments = docSnap.data().comments || []; comments.push({ id: `info-request-${Date.now()}`, userId, userName, text: infoRequestMessage.trim(), createdAt: Timestamp.now(), type: "info_request" }); await updateDoc(docRef, { comments, infoRequested: true, infoRequestedBy: userId, infoRequestedAt: Timestamp.now() }); }
      setSuccessMessage("Solicitud de información enviada");
      setTimeout(() => setSuccessMessage(""), 3000);
      setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null);
      loadPendingApprovals();
    } catch (error: any) { setErrorMessage(`Error: ${error.message}`); } finally { setProcessing(false); }
  };

  const currentApproval = filteredApprovals[currentIndex];
  const APPROVAL_FIELDS: SearchField<"all" | "number" | "supplier" | "amount">[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Número, proveedor o importe" },
    { value: "number", label: "Número", placeholder: "Ej. PO-0012", mono: true },
    { value: "supplier", label: "Proveedor", placeholder: "Proveedor, concepto o solicitante" },
    { value: "amount", label: "Importe", placeholder: "1500 · >1000 · 500-2000", mono: true },
  ];

  // Atajos: J/K para moverse por la cola, A para aprobar, R para rechazar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (showApprovalModal || showRejectionModal || showInfoRequestModal || !filteredApprovals.length) return;
      const k = e.key.toLowerCase();
      if (k === "j") setCurrentIndex((i) => Math.min(filteredApprovals.length - 1, i + 1));
      else if (k === "k") setCurrentIndex((i) => Math.max(0, i - 1));
      else if (k === "a" && currentApproval) { setSelectedApproval(currentApproval); setShowApprovalModal(true); }
      else if (k === "r" && currentApproval) { setSelectedApproval(currentApproval); setShowRejectionModal(true); }
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filteredApprovals, currentApproval, showApprovalModal, showRejectionModal, showInfoRequestModal]);
  const formatDate = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  const formatDateTime = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  const formatCurrency = (amount: number, currency: string = "EUR") => { const s: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" }; return `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0)} ${s[currency] || currency}`; };
  const getCheckIcon = (status: AutoCheck["status"]) => { switch (status) { case "pass": return <CheckCircle size={14} className="text-emerald-500" />; case "warning": return <AlertTriangle size={14} className="text-amber-500" />; case "fail": return <XCircle size={14} className="text-red-500" />; case "info": return <Info size={14} className="text-blue-500" />; } };
  const getCheckBg = (status: AutoCheck["status"]) => { switch (status) { case "pass": return "bg-emerald-50 border-emerald-200"; case "warning": return "bg-amber-50 border-amber-200"; case "fail": return "bg-red-50 border-red-200"; case "info": return "bg-blue-50 border-blue-200"; } };

  if (loading) return <PageLoading />;

  const urgentCount = pendingApprovals.filter((a) => a.isUrgent).length;
  const typeLabel = (t: "all" | "po" | "invoice" | "box") => (t === "all" ? "Todos" : t === "po" ? "POs" : t === "invoice" ? "Facturas" : "Cajas");
  const checkTone = (s: AutoCheck["status"]) => (s === "pass" ? "bg-emerald-500" : s === "warning" ? "bg-amber-500" : s === "fail" ? "bg-red-500" : "bg-slate-400");

  return (
    <Page>
      <PageHeader
        title={
          <>
            Aprobaciones <span className="text-[15px] font-normal text-slate-400">{pendingApprovals.length}</span>
            {urgentCount > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-normal text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{urgentCount} {urgentCount === 1 ? "urgente" : "urgentes"}</span>}
          </>
        }
        actions={
          filteredApprovals.length > 0 ? (
            <span className="hidden items-center gap-3 text-[11px] text-slate-500 lg:flex">
              {[["J", "siguiente"], ["K", "anterior"], ["A", "aprobar"], ["R", "rechazar"]].map(([k, l]) => (
                <span key={k} className="inline-flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 font-mono text-[10px] text-slate-600">{k}</kbd>{l}</span>
              ))}
            </span>
          ) : undefined
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={APPROVAL_FIELDS} field={apprField} onField={setApprField} value={apprSearch} onChange={setApprSearch} count={filteredApprovals.length} />
        <div className="flex gap-0.5 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="tablist" aria-label="Tipo">
          {(["all", "po", "invoice", "box"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${typeFilter === t ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
            >
              {typeLabel(t)}
              <span className="tabular-nums text-slate-400">{t === "all" ? pendingApprovals.length : pendingApprovals.filter((a) => a.type === t).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {filteredApprovals.length === 0 ? (
          <EmptyState title={apprSearch || typeFilter !== "all" ? "Sin resultados" : userStats.approvedThisWeek > 0 ? `Todo al día · ${userStats.approvedThisWeek} aprobados esta semana` : "Todo al día"} />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            {/* Cola */}
            <div className="overflow-hidden rounded-lg border border-slate-200 lg:sticky lg:top-[85px] lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto">
              {filteredApprovals.map((approval, index) => {
                const worst = approval.autoChecks.some((c) => c.status === "fail") ? "fail" : approval.autoChecks.some((c) => c.status === "warning") ? "warning" : null;
                const on = index === currentIndex;
                return (
                  <button
                    key={approval.id}
                    onClick={() => setCurrentIndex(index)}
                    className={`relative flex w-full flex-col gap-0.5 border-b border-slate-100 px-3.5 py-2.5 text-left last:border-0 ${on ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}
                  >
                    {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-slate-900" />}
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-mono text-xs font-medium">
                        {approval.displayNumber}
                        {approval.isUrgent && <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Urgente" />}
                      </span>
                      <span className="font-mono text-xs">{formatCurrency(approval.amount, approval.currency)}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">{approval.supplier}</span>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        {worst && <span className={`h-1.5 w-1.5 rounded-full ${worst === "fail" ? "bg-red-500" : "bg-amber-500"}`} title={worst === "fail" ? "Hay comprobaciones fallidas" : "Hay avisos"} />}
                        {approval.daysWaiting > 0 ? `${approval.daysWaiting} d` : "hoy"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Documento */}
            <div className="flex min-w-0 flex-col gap-4">
              {currentApproval && (
                <>
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold">{currentApproval.displayNumber}</span>
                          <span className="text-xs text-slate-500">{currentApproval.type === "po" ? "Orden de compra" : currentApproval.type === "invoice" ? "Factura" : "Caja"}</span>
                          {currentApproval.isUrgent && <span className="text-xs text-red-700">· urgente</span>}
                        </span>
                        <span className="text-xs text-slate-500">
                          {[currentApproval.department, currentApproval.poType].filter(Boolean).join(" · ")}
                          {currentApproval.poNumber && currentApproval.type === "invoice" && <> · PO-{currentApproval.poNumber}</>}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="block text-xl font-semibold tabular-nums tracking-tight">{formatCurrency(currentApproval.baseAmount, currentApproval.currency)}</span>
                        <span className="text-xs text-slate-500">base</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-5 px-5 py-4 text-[13px]">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
                        {[
                          ["Proveedor", currentApproval.supplier],
                          ["Fecha", formatDate(currentApproval.createdAt)],
                          ["Creado por", currentApproval.createdByName],
                          ["Esperando", `${currentApproval.daysWaiting} ${currentApproval.daysWaiting === 1 ? "día" : "días"}`],
                        ].map(([k, v]) => (
                          <div key={k} className="flex flex-col">
                            <dt className="text-xs text-slate-500">{k}</dt>
                            <dd className={k === "Esperando" && currentApproval.isUrgent ? "text-red-700" : ""}>{v || "—"}</dd>
                          </div>
                        ))}
                      </dl>

                      {currentApproval.description && <p className="text-slate-700">{currentApproval.description}</p>}

                      {currentApproval.attachmentUrl && (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">Documento adjunto</span>
                            <span className="flex gap-3 text-xs">
                              <button onClick={() => setShowPreview(!showPreview)} className="font-medium text-slate-900 hover:underline">{showPreview ? "Ocultar" : "Vista previa"}</button>
                              <a href={currentApproval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-slate-900">Abrir ↗</a>
                            </span>
                          </div>
                          {showPreview && (
                            <div className="overflow-hidden rounded-md border border-slate-200 bg-[#F7F7F8]">
                              {currentApproval.attachmentUrl.toLowerCase().includes(".pdf")
                                ? <iframe src={currentApproval.attachmentUrl} className="h-[480px] w-full" title="Vista previa del documento" />
                                // eslint-disable-next-line @next/next/no-img-element
                                : <img src={currentApproval.attachmentUrl} alt="Vista previa del documento" className="max-h-[480px] w-full object-contain" />}
                            </div>
                          )}
                        </div>
                      )}

                      {currentApproval.items && currentApproval.items.length > 0 && (
                        <div className="overflow-hidden rounded-md border border-slate-200">
                          <table className="tbl w-full border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                                <th scope="col" className="px-3 py-1.5 text-left font-medium">Concepto</th>
                                <th scope="col" className="px-3 py-1.5 text-left font-medium">Cuenta</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Cant. × precio</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Base</th>
                              </tr>
                            </thead>
                            <tbody>
                              {currentApproval.items.map((item: any, index: number) => (
                                <tr key={index} className="border-b border-slate-100 last:border-0">
                                  <td className="px-3 py-1.5">{item.description}{item.episodeAssignment === "specific" && item.episodes?.length ? <span className="ml-1.5 text-xs text-slate-500">cap. {item.episodes.map((e: any) => e.episode).join(", ")}</span> : null}</td>
                                  <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{item.subAccountCode || "—"}</td>
                                  <td className="px-3 py-1.5 text-right font-mono text-xs text-slate-600">{item.quantity || 0} × {formatCurrency(item.unitPrice || 0)}</td>
                                  <td className="px-3 py-1.5 text-right font-mono text-xs">{formatCurrency(item.baseAmount ?? ((item.quantity || 0) * (item.unitPrice || 0)))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {currentApproval.type === "box" && currentApproval.boxExpenses && currentApproval.boxExpenses.length > 0 && (
                        <div className="overflow-hidden rounded-md border border-slate-200">
                          <div className="flex items-center justify-between border-b border-slate-200 bg-[#FAFAFA] px-3 py-1.5 text-xs text-slate-600">
                            <span>{currentApproval.boxType === "card" ? `Tarjeta ${currentApproval.cardName}` : "Sobre de transferencias"} · {currentApproval.expenseCount || currentApproval.boxExpenses.length} gastos</span>
                            {currentApproval.boxType === "transfer" && currentApproval.paymentDate && <span>Pago {currentApproval.paymentDate}</span>}
                          </div>
                          <div className="max-h-56 overflow-y-auto">
                            <table className="tbl w-full border-collapse">
                              <tbody>
                                {currentApproval.boxExpenses.map((exp, idx) => (
                                  <tr key={exp.id || idx} className="border-b border-slate-100 last:border-0">
                                    {currentApproval.boxType === "transfer" && <td className="px-3 py-1.5">{exp.personName || "—"}</td>}
                                    <td className="max-w-[180px] truncate px-3 py-1.5">{exp.supplier}</td>
                                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{exp.subAccountCode}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs text-slate-600">{formatCurrency(exp.baseAmount)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-xs">{formatCurrency(exp.totalAmount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs text-slate-500">Circuito de aprobación</span>
                        <ol className="flex flex-wrap items-center gap-2">
                          {currentApproval.approvalSteps.map((step, index) => {
                            const current = index === currentApproval.currentApprovalStep && step.status === "pending";
                            const who = step.approverType === "role" && step.roles ? step.roles.join(", ")
                              : step.approverType === "hod" ? `HOD${step.department ? ` ${step.department}` : ""}`
                              : step.approverType === "coordinator" ? `Coord.${step.department ? ` ${step.department}` : ""}`
                              : step.approverNames?.length ? step.approverNames.slice(0, 2).join(", ") + (step.approverNames.length > 2 ? ` +${step.approverNames.length - 2}` : "")
                              : "Usuario";
                            return (
                              <li key={step.id || index} className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${current ? "border-slate-900 text-slate-900" : step.status === "approved" ? "border-slate-200 text-slate-500" : "border-slate-200 text-slate-400"}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${step.status === "approved" ? "bg-emerald-500" : current ? "bg-amber-500" : "bg-slate-300"}`} />
                                  <span className="font-mono">{step.order}</span> {who}{step.requireAll ? " (todos)" : ""}
                                  {step.hasAmountThreshold && step.amountThreshold ? <span className="text-slate-400">&gt;{step.amountThreshold.toLocaleString("es-ES")} €</span> : null}
                                </span>
                                {index < currentApproval.approvalSteps.length - 1 && <span className="text-slate-300">→</span>}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-[#FAFAFA] px-5 py-3">
                      {showCommentInput ? (
                        <div className="flex flex-col gap-2">
                          <Textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Comentario" rows={2} autoFocus />
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => { setShowCommentInput(false); setApprovalComment(""); }}>Cancelar</Button>
                            <Button variant="primary" onClick={() => handleApprove(currentApproval, true)} disabled={processing}><Check size={14} /> Aprobar con comentario</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1 text-xs text-slate-500">
                            <IconButton label="Anterior (K)" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}><ChevronLeft size={15} /></IconButton>
                            <span className="tabular-nums">{currentIndex + 1} / {filteredApprovals.length}</span>
                            <IconButton label="Siguiente (J)" onClick={() => setCurrentIndex(Math.min(filteredApprovals.length - 1, currentIndex + 1))} disabled={currentIndex === filteredApprovals.length - 1}><ChevronRight size={15} /></IconButton>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" onClick={() => { setSelectedApproval(currentApproval); setShowInfoRequestModal(true); }}>Pedir información</Button>
                            <Button variant="ghost" onClick={() => setShowCommentInput(true)}>Aprobar con comentario</Button>
                            <Button variant="secondary" onClick={() => { setSelectedApproval(currentApproval); setShowRejectionModal(true); }} disabled={processing}><span className="text-red-700">Rechazar</span></Button>
                            <Button variant="primary" onClick={() => { setSelectedApproval(currentApproval); setShowApprovalModal(true); }} disabled={processing}><Check size={14} /> Aprobar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Comprobaciones */}
                  <section className="overflow-hidden rounded-lg border border-slate-200">
                    <h3 className="border-b border-slate-200 bg-[#FAFAFA] px-4 py-2 text-xs font-medium text-slate-500">Comprobaciones automáticas</h3>
                    {currentApproval.autoChecks.map((check) => (
                      <div key={check.id} className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-2 text-[13px] last:border-0">
                        <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${checkTone(check.status)}`} />
                        <span className="flex-1">
                          <span className="text-slate-900">{check.label}</span>
                          <span className="text-slate-500"> · {check.message}</span>
                          {check.details && <span className="block text-xs text-slate-500">{check.details}</span>}
                        </span>
                      </div>
                    ))}
                  </section>

                  {/* Budget Impact */}
                  {canSeeBudgetFigures && currentApproval.budgetImpact && currentApproval.budgetImpact.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleSection("budget")} className="w-full px-3.5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3">
                          <PieChart size={18} className="text-slate-500" />
                          <span className="text-[13px] font-medium text-slate-900">Impacto en presupuesto</span>
                          {currentApproval.budgetImpact.some(i => i.afterApproval < 0) && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg">Sin presupuesto</span>
                          )}
                        </div>
                        {expandedSections.has("budget") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                      </button>
                      {expandedSections.has("budget") && (
                        <div className="px-6 pb-6 space-y-4">
                          {currentApproval.budgetImpact.map((impact, idx) => {
                            const isOverBudget = impact.afterApproval < 0;
                            const isLow = impact.afterApproval >= 0 && impact.afterApproval < impact.budgeted * 0.1;
                            const execBefore = impact.budgeted > 0 ? ((impact.committed + impact.actual) / impact.budgeted) * 100 : 0;
                            const execAfter = impact.budgeted > 0 ? (((impact.committedAfter ?? impact.committed) + (impact.actualAfter ?? impact.actual)) / impact.budgeted) * 100 : 0;
                            const thisDoc = impact.available - impact.afterApproval;
                            return (
                              <div key={idx} className={`rounded-md border ${isOverBudget ? "border-red-200 bg-red-50/40" : isLow ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-slate-50/60"}`}>
                                {/* Header subcuenta */}
                                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-200/60">
                                  <div>
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{impact.accountCode}</span>
                                    <p className="text-[13px] font-semibold text-slate-900 mt-0.5">{impact.accountName}</p>
                                  </div>
                                  {isOverBudget && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-lg font-medium">Sin presupuesto</span>}
                                  {isLow && !isOverBudget && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-medium">Presupuesto bajo</span>}
                                </div>
                                {/* Stats */}
                                <div className="grid grid-cols-4 gap-0 px-4 py-4">
                                  <div className="pr-4 border-r border-slate-200">
                                    <p className="text-xs text-slate-500 mb-1">Presupuestado</p>
                                    <p className="text-[13px] font-bold text-slate-900 tabular-nums">{formatCurrency(impact.budgeted)}</p>
                                  </div>
                                  <div className="px-4 border-r border-slate-200">
                                    <p className="text-xs text-slate-500 mb-1">Comprometido</p>
                                    <p className="text-[13px] font-semibold text-slate-700 tabular-nums">{formatCurrency(impact.committed)}</p>
                                    {impact.committedAfter !== undefined && impact.committedAfter !== impact.committed && (
                                      <p className={`text-xs font-semibold tabular-nums mt-0.5 ${impact.committedAfter > impact.committed ? "text-amber-600" : "text-emerald-600"}`}>
                                        → {formatCurrency(impact.committedAfter)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="px-4 border-r border-slate-200">
                                    <p className="text-xs text-slate-500 mb-1">Realizado</p>
                                    <p className="text-[13px] font-semibold text-slate-700 tabular-nums">{formatCurrency(impact.actual)}</p>
                                    {impact.actualAfter !== undefined && impact.actualAfter !== impact.actual && (
                                      <p className="text-xs font-semibold text-amber-600 tabular-nums mt-0.5">
                                        → {formatCurrency(impact.actualAfter)}
                                      </p>
                                    )}
                                  </div>
                                  <div className="pl-4">
                                    <p className="text-xs text-slate-500 mb-1">Disponible</p>
                                    <p className="text-[13px] font-semibold text-slate-700 tabular-nums">{formatCurrency(impact.available)}</p>
                                    <p className={`text-xs font-bold tabular-nums mt-0.5 ${isOverBudget ? "text-red-600" : thisDoc === 0 ? "text-slate-500" : "text-amber-600"}`}>
                                      → {formatCurrency(impact.afterApproval)}
                                    </p>
                                  </div>
                                </div>
                                {/* Barra de ejecución */}
                                {impact.budgeted > 0 && (
                                  <div className="px-4 pb-4">
                                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                                      <span>Ejecución tras aprobar</span>
                                      <span className={`font-semibold ${execAfter > 100 ? "text-red-600" : execAfter > 90 ? "text-amber-600" : "text-slate-700"}`}>{execAfter.toFixed(1)}%</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden relative">
                                      <div className="h-full bg-slate-300 rounded-full" style={{ width: `${Math.min(execBefore, 100)}%` }} />
                                      <div className={`absolute top-0 left-0 h-full rounded-full opacity-70 ${isOverBudget ? "bg-red-500" : execAfter > 90 ? "bg-amber-500" : "bg-[#2F52E0]"}`} style={{ width: `${Math.min(execAfter, 100)}%` }} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* PO Comparison */}
                  {currentApproval.poComparison && (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleSection("po-comparison")} className="w-full px-3.5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><Target size={18} className="text-slate-500" /><span className="text-[13px] font-medium text-slate-900">Comparativa con PO-{currentApproval.poComparison.poNumber}</span>{currentApproval.poComparison.percentageUsed > 100 && (<span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg">Excede PO</span>)}</div>{expandedSections.has("po-comparison") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                      {expandedSections.has("po-comparison") && (<div className="px-6 pb-6"><div className="grid grid-cols-4 gap-4 mb-4"><div className="text-center p-3 bg-slate-50 rounded-md"><p className="text-xs text-slate-500">Base PO</p><p className="text-[13px] font-bold text-slate-900">{formatCurrency(currentApproval.poComparison.poBaseAmount)}</p></div><div className="text-center p-3 bg-emerald-50 rounded-md"><p className="text-xs text-emerald-600">Facturado antes</p><p className="text-[13px] font-bold text-emerald-700">{formatCurrency(currentApproval.poComparison.invoicedBefore)}</p></div><div className="text-center p-3 bg-amber-50 rounded-md"><p className="text-xs text-amber-600">Esta factura</p><p className="text-[13px] font-bold text-amber-700">{formatCurrency(currentApproval.poComparison.thisInvoice)}</p></div><div className={`text-center p-3 rounded-md ${currentApproval.poComparison.remaining < 0 ? "bg-red-50" : "bg-slate-50"}`}><p className={`text-xs ${currentApproval.poComparison.remaining < 0 ? "text-red-600" : "text-slate-500"}`}>Restante</p><p className={`text-[13px] font-bold ${currentApproval.poComparison.remaining < 0 ? "text-red-700" : "text-slate-900"}`}>{formatCurrency(currentApproval.poComparison.remaining)}</p></div></div><div className="mb-4"><div className="flex items-center justify-between text-xs text-slate-500 mb-1"><span>Uso de la PO</span><span className={currentApproval.poComparison.percentageUsed > 100 ? "text-red-600 font-medium" : ""}>{currentApproval.poComparison.percentageUsed.toFixed(1)}%</span></div><div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full ${currentApproval.poComparison.percentageUsed > 100 ? "bg-red-500" : currentApproval.poComparison.percentageUsed > 90 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(currentApproval.poComparison.percentageUsed, 100)}%` }} /></div></div>{currentApproval.poComparison.itemDiscrepancies.length > 0 && (<div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-md"><p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-2"><AlertTriangle size={12} />Discrepancias en items</p><div className="space-y-2">{currentApproval.poComparison.itemDiscrepancies.map((disc, idx) => (<div key={idx} className="flex items-center justify-between text-xs"><span className="text-slate-700">{disc.description}</span><div className="flex items-center gap-3"><span className="text-slate-500">PO: {formatCurrency(disc.poAmount)}</span><span className="text-slate-900">FRA: {formatCurrency(disc.invoiceAmount)}</span><span className={disc.difference > 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{disc.difference > 0 ? "+" : ""}{formatCurrency(disc.difference)}</span></div></div>))}</div></div>)}</div>)}
                    </div>
                  )}

                  {/* Supplier Stats */}
                  {currentApproval.supplierStats && (
                    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                      <button onClick={() => toggleSection("supplier")} className="w-full px-3.5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><Building2 size={18} className="text-slate-500" /><span className="text-[13px] font-medium text-slate-900">Historial del proveedor</span></div>{expandedSections.has("supplier") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                      {expandedSections.has("supplier") && (<div className="px-6 pb-6"><div className="grid grid-cols-3 gap-4"><div className="text-center p-4 bg-slate-50 rounded-md"><p className="text-2xl font-bold text-slate-900">{currentApproval.supplierStats.totalPOs}</p><p className="text-xs text-slate-500">POs totales</p></div><div className="text-center p-4 bg-slate-50 rounded-md"><p className="text-2xl font-bold text-slate-900">{currentApproval.supplierStats.totalInvoices}</p><p className="text-xs text-slate-500">Facturas totales</p></div><div className="text-center p-4 bg-amber-50 rounded-md"><p className="text-2xl font-bold text-amber-700">{formatCurrency(currentApproval.supplierStats.pendingAmount)}</p><p className="text-xs text-amber-600">Pendiente</p></div></div>{currentApproval.supplierStats.lastTransaction && (<p className="text-xs text-slate-500 mt-3 text-center">Última transacción: {formatDate(currentApproval.supplierStats.lastTransaction)}</p>)}</div>)}
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection("timeline")} className="w-full px-3.5 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><History size={18} className="text-slate-500" /><span className="text-[13px] font-medium text-slate-900">Historial de actividad</span><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{currentApproval.timeline.length}</span></div>{expandedSections.has("timeline") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                    {expandedSections.has("timeline") && (<div className="px-6 pb-6"><div className="space-y-3">{currentApproval.timeline.map((event, idx) => (<div key={event.id} className="flex items-start gap-3"><div className="relative"><div className={`w-8 h-8 rounded-full flex items-center justify-center ${event.type === "created" ? "bg-blue-100" : event.type === "approved" ? "bg-emerald-100" : event.type === "rejected" ? "bg-red-100" : event.type === "comment" ? "bg-slate-100" : "bg-amber-100"}`}>{event.type === "created" && <FileText size={14} className="text-blue-600" />}{event.type === "approved" && <Check size={14} className="text-emerald-600" />}{event.type === "rejected" && <X size={14} className="text-red-600" />}{event.type === "comment" && <MessageSquare size={14} className="text-slate-600" />}{event.type === "info_requested" && <HelpCircle size={14} className="text-amber-600" />}</div>{idx < currentApproval.timeline.length - 1 && (<div className="absolute top-8 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-slate-200" />)}</div><div className="flex-1 pt-1"><p className="text-[13px] text-slate-900"><span className="font-medium">{event.userName}</span>{event.type === "created" && " creó el documento"}{event.type === "approved" && ` aprobó (Nivel ${event.stepOrder})`}{event.type === "rejected" && " rechazó el documento"}{event.type === "comment" && " añadió un comentario"}{event.type === "info_requested" && " solicitó información"}</p>{event.comment && (<p className="text-[13px] text-slate-600 bg-slate-50 p-2 rounded-lg mt-1 italic">&quot;{event.comment}&quot;</p>)}<p className="text-xs text-slate-400 mt-0.5">{formatDateTime(event.date)}</p></div></div>))}</div></div>)}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        open={showApprovalModal && !!selectedApproval}
        onClose={() => { setShowApprovalModal(false); setSelectedApproval(null); }}
        title="Aprobar"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowApprovalModal(false); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="primary" onClick={() => selectedApproval && handleApprove(selectedApproval)} disabled={processing} autoFocus><Check size={14} /> Aprobar</Button>
          </>
        }
      >
        {selectedApproval && (
          <p className="text-[13px] text-slate-700">
            <span className="font-mono">{selectedApproval.displayNumber}</span> · {selectedApproval.supplier} · <span className="font-mono">{formatCurrency(selectedApproval.amount, selectedApproval.currency)}</span>
          </p>
        )}
      </Modal>

      <Modal
        open={showRejectionModal && !!selectedApproval}
        onClose={() => { setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null); }}
        title={`Rechazar ${selectedApproval?.displayNumber || ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="danger" onClick={handleReject} disabled={processing || !rejectionReason.trim()}>Rechazar</Button>
          </>
        }
      >
        <Field label="Motivo">
          <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={4} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={showInfoRequestModal && !!selectedApproval}
        onClose={() => { setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null); }}
        title={`Pedir información · ${selectedApproval?.displayNumber || ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="primary" onClick={handleRequestInfo} disabled={processing || !infoRequestMessage.trim()}><Send size={14} /> Enviar</Button>
          </>
        }
      >
        <Field label="¿Qué necesitas saber?">
          <Textarea value={infoRequestMessage} onChange={(e) => setInfoRequestMessage(e.target.value)} rows={4} autoFocus />
        </Field>
      </Modal>

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
    </Page>
  );
}
