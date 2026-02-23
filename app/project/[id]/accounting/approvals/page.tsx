"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import {
  CheckCircle, XCircle, ChevronLeft, ChevronRight, FileText, Receipt, AlertCircle,
  Clock, User, Calendar, Building2, Eye, Check, X, AlertTriangle,
  MessageSquare, History, TrendingUp, DollarSign, Shield, FileCheck, Zap,
  ChevronDown, ChevronUp, ExternalLink, Send, Info, Flame, Award, Target,
  PieChart, HelpCircle, Link as LinkIcon, ClipboardCheck, Layers, CreditCard, Banknote, Package,
} from "lucide-react";
import Link from "next/link";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { handlePOStatusChange, handleInvoiceStatusChange, updatePOItemsInvoiced } from "@/lib/budgetOperations";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface ApprovalStepStatus { id: string; order: number; approverType: "fixed" | "role" | "hod" | "coordinator"; approvers: string[]; approverNames?: string[]; roles?: string[]; department?: string; approvedBy: string[]; rejectedBy: string[]; status: "pending" | "approved" | "rejected"; requireAll: boolean; hasAmountThreshold?: boolean; amountThreshold?: number; amountCondition?: string; }
interface TimelineEvent { id: string; type: "created" | "approved" | "rejected" | "comment" | "info_requested"; date: Date; userId: string; userName: string; stepOrder?: number; comment?: string; }
interface AutoCheck { id: string; label: string; status: "pass" | "warning" | "fail" | "info"; message: string; details?: string; }
interface POComparison { poNumber: string; poBaseAmount: number; invoicedBefore: number; thisInvoice: number; remaining: number; percentageUsed: number; itemDiscrepancies: { description: string; poAmount: number; invoiceAmount: number; difference: number; }[]; }
interface SupplierStats { totalPOs: number; totalInvoices: number; pendingAmount: number; avgApprovalTime: number; lastTransaction: Date | null; }
interface BoxExpensePreview { id: string; supplier: string; subAccountCode: string; baseAmount: number; vatAmount: number; totalAmount: number; date?: string; personName?: string; }
interface PendingApproval { id: string; type: "po" | "invoice" | "box"; documentId: string; documentNumber: string; displayNumber?: string; projectId: string; projectName: string; supplier: string; supplierId?: string; amount: number; baseAmount: number; description: string; createdAt: Date; createdBy: string; createdByName: string; currentApprovalStep: number; approvalSteps: ApprovalStepStatus[]; attachmentUrl?: string; attachmentFileName?: string; items?: any[]; department?: string; poType?: string; currency?: string; poId?: string; poNumber?: string; timeline: TimelineEvent[]; autoChecks: AutoCheck[]; poComparison?: POComparison; supplierStats?: SupplierStats; daysWaiting: number; isUrgent: boolean; budgetImpact?: { accountCode: string; accountName: string; budgeted: number; committed: number; actual: number; available: number; afterApproval: number; committedAfter?: number; actualAfter?: number; }[]; boxType?: "card" | "transfer"; boxExpenses?: BoxExpensePreview[]; expenseCount?: number; cardName?: string; paymentDate?: string; }
interface UserStats { approvedToday: number; approvedThisWeek: number; approvedThisMonth: number; avgResponseTime: number; pendingCount: number; }

export default function ApprovalsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
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

  useEffect(() => { const unsub = onAuthStateChanged(auth, (u) => { if (!u) router.push("/"); else { setUserId(u.uid); setUserName(u.displayName || u.email || "Usuario"); } }); return () => unsub(); }, [router]);
  useEffect(() => { if (userId && id) loadPendingApprovals(); }, [userId, id]);
  useEffect(() => { let filtered = [...pendingApprovals]; if (typeFilter !== "all") filtered = filtered.filter((a) => a.type === typeFilter); setFilteredApprovals(filtered); setCurrentIndex(0); }, [typeFilter, pendingApprovals]);

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
            budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, false),
            supplierStats: await loadSupplierStats(d.supplierId), daysWaiting, isUrgent: daysWaiting >= 3,
          });
        }
      }

      // Load Invoices
      try {
        const invoicesSnap = await getDocs(query(collection(db, `projects/${id}/invoices`), where("status", "==", "pending_approval")));
        for (const invDoc of invoicesSnap.docs) {
          const d = invDoc.data();
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            let poComparison: POComparison | undefined;
            if (d.poId) poComparison = await loadPOComparison(d.poId, d.items || [], d.baseAmount || 0, invDoc.id);
            approvals.push({
              id: invDoc.id, type: "invoice", documentId: invDoc.id, documentNumber: d.number,
              displayNumber: d.displayNumber || `FAC-${d.number}`, projectId: id, projectName: localProjectName,
              supplier: d.supplier, supplierId: d.supplierId, amount: d.totalAmount || 0, baseAmount: d.baseAmount || d.totalAmount || 0,
              description: d.description || "", createdAt, createdBy: d.createdBy,
              createdByName: d.createdByName || membersMap[d.createdBy] || "Usuario",
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: d.approvalSteps || [],
              attachmentUrl: d.attachmentUrl, attachmentFileName: d.attachmentFileName,
              items: d.items || [], poId: d.poId, poNumber: d.poNumber,
              timeline: buildTimeline(d, membersMap), autoChecks: buildAutoChecks(d, "invoice", subAccountsMap),
              budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, !!d.poId),
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

  const calculateBudgetImpact = (items: any[], subAccountsMap: Record<string, any>, hasPO: boolean): PendingApproval["budgetImpact"] => {
    const impact: PendingApproval["budgetImpact"] = [];
    const accountImpacts: Record<string, number> = {};
    for (const item of items) { if (item.subAccountId && subAccountsMap[item.subAccountId]) accountImpacts[item.subAccountId] = (accountImpacts[item.subAccountId] || 0) + (item.baseAmount || 0); }
    for (const [subAccountId, amount] of Object.entries(accountImpacts)) { 
      const sub = subAccountsMap[subAccountId]; 
      if (sub) {
        // Si tiene PO: el realizado aumenta y el comprometido disminuye (el available no cambia)
        // Si no tiene PO: el realizado aumenta y el available disminuye
        const newCommitted = hasPO ? Math.max(0, sub.committed - amount) : sub.committed;
        const newActual = sub.actual + amount;
        const newAvailable = hasPO ? sub.available : sub.available - amount;
        impact.push({ 
          accountCode: sub.code, 
          accountName: sub.description, 
          budgeted: sub.budgeted, 
          committed: sub.committed, 
          actual: sub.actual, 
          available: sub.available, 
          afterApproval: newAvailable,
          // Campos adicionales para mostrar el cambio
          committedAfter: newCommitted,
          actualAfter: newActual,
        }); 
      }
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
          
          // Verificar si hay items comprometidos anteriores (edición de PO aprobada)
          const previousCommittedItems = docData.previousCommittedItems || null;
          
          // Usar budgetOperations para manejar el comprometido
          await handlePOStatusChange(approval.projectId, oldStatus, "approved", budgetItems, previousCommittedItems);
          
          // Limpiar previousCommittedItems después de aprobar
          updates.previousCommittedItems = null;
          
        } else if (approval.type === "invoice") {
          // Factura
          updates.status = "pending"; // Pasa a "pendiente de pago" (aprobada)
          updates.approvalStatus = "approved";
          updates.approvedAt = Timestamp.now();
          updates.approvedBy = userId;
          updates.approvedByName = userName;
          
          // Preparar items para budgetOperations
          const budgetItems: Array<{ subAccountId: string; baseAmount: number; poItemIndex?: number }> = [];
          for (const item of (approval.items || [])) {
            const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
            if (item.subAccountId) {
              budgetItems.push({ 
                subAccountId: item.subAccountId, 
                baseAmount: itemBaseAmount,
                poItemIndex: item.poItemIndex 
              });
            }
          }
          
          // El estado real de la factura será "pending" (aprobada, pendiente de pago)
          // Usar budgetOperations para manejar el realizado (si corresponde según config)
          await handleInvoiceStatusChange(approval.projectId, oldStatus, "pending", budgetItems);
          
          // Si tiene PO vinculada, actualizar los invoicedAmount de cada item de la PO
          if (approval.poId) {
            await updatePOItemsInvoiced(approval.projectId, approval.poId, budgetItems, "add");
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
          // Verificar si hay items comprometidos anteriores (edición de PO aprobada)
          const previousCommittedItems = docData.previousCommittedItems;
          
          if (previousCommittedItems && previousCommittedItems.length > 0) {
            // Si había items anteriores comprometidos, descomprometer esos (no los nuevos)
            await handlePOStatusChange(selectedApproval.projectId, "approved", "rejected", previousCommittedItems);
          } else {
            // Preparar items actuales para budgetOperations
            const budgetItems: Array<{ subAccountId: string; baseAmount: number }> = [];
            for (const item of (selectedApproval.items || [])) {
              const itemBaseAmount = item.baseAmount || (item.quantity && item.unitPrice ? item.quantity * item.unitPrice : item.totalAmount ? item.totalAmount / 1.21 : 0);
              if (item.subAccountId) {
                budgetItems.push({ subAccountId: item.subAccountId, baseAmount: itemBaseAmount });
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
  const formatDate = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  const formatDateTime = (date: Date) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  const formatCurrency = (amount: number, currency: string = "EUR") => { const s: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" }; return `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0)} ${s[currency] || currency}`; };
  const getCheckIcon = (status: AutoCheck["status"]) => { switch (status) { case "pass": return <CheckCircle size={14} className="text-emerald-500" />; case "warning": return <AlertTriangle size={14} className="text-amber-500" />; case "fail": return <XCircle size={14} className="text-red-500" />; case "info": return <Info size={14} className="text-blue-500" />; } };
  const getCheckBg = (status: AutoCheck["status"]) => { switch (status) { case "pass": return "bg-emerald-50 border-emerald-200"; case "warning": return "bg-amber-50 border-amber-200"; case "fail": return "bg-red-50 border-red-200"; case "info": return "bg-blue-50 border-blue-200"; } };

  if (loading) return (<div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" /></div>);

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          {/* Page header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <ClipboardCheck size={24} className="text-slate-400" />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Aprobaciones</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  {userStats.pendingCount} pendiente{userStats.pendingCount !== 1 ? "s" : ""}
                  {userRole && <span className="text-slate-400"> · {userRole}</span>}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900">{userStats.approvedToday}</p>
                  <p className="text-xs text-slate-500">Hoy</p>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900">{userStats.approvedThisWeek}</p>
                  <p className="text-xs text-slate-500">Semana</p>
                </div>
              </div>
              {pendingApprovals.some(a => a.isUrgent) && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                  <Flame size={16} className="text-red-500" />
                  <span className="text-sm font-medium text-red-700">{pendingApprovals.filter(a => a.isUrgent).length} urgente{pendingApprovals.filter(a => a.isUrgent).length > 1 ? "s" : ""}</span>
                </div>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-4 pt-4">
            <div className="flex items-center gap-1 border border-slate-200 rounded-xl p-1">
              {(["all", "po", "invoice", "box"] as const).map((t) => (<button key={t} onClick={() => setTypeFilter(t)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${typeFilter === t ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>{t === "all" ? "Todos" : t === "po" ? "POs" : t === "invoice" ? "Facturas" : "BOX"}<span className="ml-1.5 text-xs opacity-70">({t === "all" ? pendingApprovals.length : pendingApprovals.filter(a => a.type === t).length})</span></button>))}
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        {successMessage && (<div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3"><CheckCircle size={18} className="text-emerald-600" /><span className="text-sm text-emerald-700 font-medium">{successMessage}</span></div>)}
        {errorMessage && (<div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3"><AlertCircle size={18} className="text-red-600" /><span className="text-sm text-red-700">{errorMessage}</span><button onClick={() => setErrorMessage("")} className="ml-auto text-red-400 hover:text-red-600"><X size={16} /></button></div>)}

        {filteredApprovals.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><CheckCircle size={28} className="text-emerald-600" /></div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No hay aprobaciones pendientes</h3>
            <p className="text-slate-500 text-sm">{typeFilter !== "all" ? "Prueba a ajustar los filtros" : "¡Estás al día con todas tus aprobaciones!"}</p>
            {userStats.approvedThisWeek > 0 && (<div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-xl"><Award size={16} className="text-emerald-600" /><span className="text-sm text-emerald-700">Has aprobado {userStats.approvedThisWeek} documentos esta semana</span></div>)}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-3 px-1 font-semibold">Documentos · {filteredApprovals.length}</p>
                <div className="space-y-2">
                  {filteredApprovals.map((approval, index) => (
                    <button key={approval.id} onClick={() => setCurrentIndex(index)} className={`w-full text-left p-3 rounded-xl border-2 transition-all ${index === currentIndex ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}>
                      <div className="flex items-start gap-2 mb-1">
                        {approval.type === "po" ? <FileText size={14} className="text-slate-500 mt-0.5" /> : <Receipt size={14} className="text-slate-500 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2"><p className="text-sm font-medium text-slate-900 truncate">{approval.displayNumber}</p>{approval.isUrgent && (<span className="flex items-center gap-0.5 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-lg"><Flame size={10} /></span>)}</div>
                          <p className="text-xs text-slate-500 truncate">{approval.supplier}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-sm font-semibold text-slate-900">{formatCurrency(approval.amount, approval.currency)}</p>
                        <div className="flex items-center gap-1">
                          {approval.autoChecks.some(c => c.status === "fail") && <XCircle size={12} className="text-red-500" />}
                          {approval.autoChecks.some(c => c.status === "warning") && !approval.autoChecks.some(c => c.status === "fail") && <AlertTriangle size={12} className="text-amber-500" />}
                          <div className="flex items-center gap-0.5 ml-1">{approval.approvalSteps.map((s, i) => (<div key={i} className={`w-1.5 h-1.5 rounded-full ${s.status === "approved" ? "bg-emerald-500" : i === approval.currentApprovalStep ? "bg-amber-500" : "bg-slate-200"}`} />))}</div>
                        </div>
                      </div>
                      {approval.daysWaiting > 0 && <p className="text-xs text-slate-400 mt-1">{approval.daysWaiting} día{approval.daysWaiting > 1 ? "s" : ""} esperando</p>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Main Card */}
            <div className="lg:col-span-2">
              {currentApproval && (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-6 py-5 border-b border-slate-200 bg-slate-50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {currentApproval.type === "po" ? <div className="w-12 h-12 bg-slate-200 rounded-xl flex items-center justify-center"><FileText size={20} className="text-slate-600" /></div> : currentApproval.type === "invoice" ? <div className="w-12 h-12 bg-slate-200 rounded-xl flex items-center justify-center"><Receipt size={20} className="text-slate-600" /></div> : <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center"><Package size={20} className="text-blue-600" /></div>}
                          <div>
                            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-slate-900">{currentApproval.displayNumber}</h2>{currentApproval.isUrgent && (<span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg font-medium"><Flame size={10} />Urgente</span>)}</div>
                            <p className="text-sm text-slate-500">{currentApproval.department && `${currentApproval.department} · `}{currentApproval.poType}{currentApproval.poNumber && currentApproval.type === "invoice" && (<span className="inline-flex items-center gap-1 ml-2 text-slate-600"><LinkIcon size={10} />PO-{currentApproval.poNumber}</span>)}</p>
                          </div>
                        </div>
                        <div className="text-right"><p className="text-xs text-slate-500">Coste</p><p className="text-xl font-bold text-slate-900">{formatCurrency(currentApproval.baseAmount, currentApproval.currency)}</p></div>
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
                        <button onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-30"><ChevronLeft size={16} />Anterior</button>
                        <span className="text-sm text-slate-500">{currentIndex + 1} de {filteredApprovals.length}</span>
                        <button onClick={() => setCurrentIndex(Math.min(filteredApprovals.length - 1, currentIndex + 1))} disabled={currentIndex === filteredApprovals.length - 1} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-30">Siguiente<ChevronRight size={16} /></button>
                      </div>
                    </div>

                    <div className="p-6">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div><p className="text-xs text-slate-500 mb-1">Proveedor</p><div className="flex items-center gap-2"><Building2 size={14} className="text-slate-400" /><p className="text-sm font-medium text-slate-900">{currentApproval.supplier}</p></div></div>
                        <div><p className="text-xs text-slate-500 mb-1">Fecha</p><div className="flex items-center gap-2"><Calendar size={14} className="text-slate-400" /><p className="text-sm text-slate-900">{formatDate(currentApproval.createdAt)}</p></div></div>
                        <div><p className="text-xs text-slate-500 mb-1">Creado por</p><div className="flex items-center gap-2"><User size={14} className="text-slate-400" /><p className="text-sm text-slate-900">{currentApproval.createdByName}</p></div></div>
                        <div><p className="text-xs text-slate-500 mb-1">Esperando</p><div className="flex items-center gap-2"><Clock size={14} className={currentApproval.isUrgent ? "text-red-500" : "text-slate-400"} /><p className={`text-sm ${currentApproval.isUrgent ? "text-red-600 font-medium" : "text-slate-900"}`}>{currentApproval.daysWaiting} día{currentApproval.daysWaiting !== 1 ? "s" : ""}</p></div></div>
                      </div>

                      <div className="mb-6"><p className="text-xs text-slate-500 mb-2">Descripción</p><p className="text-sm text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-100">{currentApproval.description || "Sin descripción"}</p></div>

                      {currentApproval.attachmentUrl && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-2"><p className="text-xs text-slate-500">Documento adjunto</p><button onClick={() => setShowPreview(!showPreview)} className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1">{showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{showPreview ? "Ocultar" : "Ver preview"}</button></div>
                          {showPreview ? (
                            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100">
                              {currentApproval.attachmentUrl.toLowerCase().includes(".pdf") ? <iframe src={currentApproval.attachmentUrl} className="w-full h-96" title="Document preview" /> : <img src={currentApproval.attachmentUrl} alt="Document preview" className="w-full max-h-96 object-contain" />}
                              <div className="px-4 py-2 bg-white border-t border-slate-200 flex items-center justify-between"><span className="text-xs text-slate-500">{currentApproval.attachmentFileName || "Documento"}</span><a href={currentApproval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"><ExternalLink size={12} />Abrir en nueva pestaña</a></div>
                            </div>
                          ) : (
                            <a href={currentApproval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"><div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center"><FileCheck size={18} className="text-slate-500" /></div><div className="flex-1"><p className="text-sm font-medium text-slate-900">{currentApproval.attachmentFileName || "Ver documento"}</p><p className="text-xs text-slate-500">Clic para abrir</p></div><Eye size={16} className="text-slate-400" /></a>
                          )}
                        </div>
                      )}

                      {currentApproval.items && currentApproval.items.length > 0 && (
                        <div className="mb-6">
                          <p className="text-xs text-slate-500 mb-2">Items ({currentApproval.items.length})</p>
                          <div className="bg-slate-50 rounded-xl border border-slate-100 p-4 max-h-48 overflow-y-auto space-y-2">
                            {currentApproval.items.map((item: any, index: number) => {
                              const episodeLabel = item.episodeAssignment === "specific" && item.episodes && item.episodes.length > 0
                                ? item.episodes.length === 1 
                                  ? item.episodes[0].episode.toString()
                                  : item.episodes.map((e: any) => e.episode).join(", ")
                                : null;
                              return (
                                <div key={index} className="flex items-start justify-between text-sm border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                                  <div className="flex-1">
                                    <p className="font-medium text-slate-900">{item.description}</p>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <p className="text-xs text-slate-500">{item.subAccountCode && `${item.subAccountCode} · `}{item.quantity || 0} × {formatCurrency(item.unitPrice || 0)}</p>
                                      {item.episodeAssignment && (
                                        <span className="flex items-center gap-1 text-xs text-violet-600">
                                          <Layers size={10} />
                                          {episodeLabel || "General"}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <p className="font-medium text-slate-900">{formatCurrency(item.totalAmount || 0)}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Vista previa de gastos BOX */}
                      {currentApproval.type === "box" && currentApproval.boxExpenses && currentApproval.boxExpenses.length > 0 && (
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs text-slate-500">Gastos del sobre ({currentApproval.expenseCount || currentApproval.boxExpenses.length})</p>
                            {currentApproval.boxType === "transfer" && currentApproval.paymentDate && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg">Pago: {currentApproval.paymentDate}</span>
                            )}
                          </div>
                          <div className="bg-blue-50 rounded-xl border border-blue-100 overflow-hidden">
                            <div className="max-h-56 overflow-y-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-blue-100/50 sticky top-0">
                                  <tr>
                                    {currentApproval.boxType === "transfer" && <th className="text-left px-3 py-2 text-xs font-medium text-blue-700">Persona</th>}
                                    <th className="text-left px-3 py-2 text-xs font-medium text-blue-700">Proveedor</th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-blue-700">Cuenta</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-blue-700">Base</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-blue-700">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-blue-100">
                                  {currentApproval.boxExpenses.map((exp, idx) => (
                                    <tr key={exp.id || idx} className="hover:bg-blue-100/30">
                                      {currentApproval.boxType === "transfer" && <td className="px-3 py-2 text-slate-900">{exp.personName || "-"}</td>}
                                      <td className="px-3 py-2 text-slate-900 truncate max-w-[150px]">{exp.supplier}</td>
                                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{exp.subAccountCode}</td>
                                      <td className="px-3 py-2 text-right font-mono text-slate-700">{formatCurrency(exp.baseAmount)}</td>
                                      <td className="px-3 py-2 text-right font-mono font-medium text-slate-900">{formatCurrency(exp.totalAmount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="px-3 py-2 bg-blue-100 flex justify-between items-center border-t border-blue-200">
                              <span className="text-xs text-blue-700 font-medium">{currentApproval.boxType === "card" ? `Tarjeta: ${currentApproval.cardName}` : "Sobre de transferencia"}</span>
                              <span className="text-sm font-bold text-blue-900">{formatCurrency(currentApproval.amount)}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mb-6">
                        <p className="text-xs text-slate-500 mb-3">Progreso de aprobación</p>
                        <div className="space-y-2">
                          {currentApproval.approvalSteps.map((step, index) => (
                            <div key={step.id || index} className={`flex items-center gap-3 p-3 rounded-xl border ${index === currentApproval.currentApprovalStep ? "border-amber-200 bg-amber-50" : step.status === "approved" ? "border-emerald-200 bg-emerald-50" : "border-slate-100 bg-slate-50"}`}>
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step.status === "approved" ? "bg-emerald-500 text-white" : index === currentApproval.currentApprovalStep ? "bg-amber-500 text-white" : "bg-slate-200 text-slate-600"}`}>
                                {step.status === "approved" ? <Check size={12} /> : step.order}
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-slate-900">
                                  Nivel {step.order}
                                  {step.approverType === "fixed" && (
                                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Usuario específico</span>
                                  )}
                                  {step.approverType === "role" && step.roles && (
                                    <span className="text-slate-500 font-normal"> ({step.roles.join(", ")})</span>
                                  )}
                                  {step.approverType === "hod" && (
                                    <span className="text-slate-500 font-normal"> (HOD{step.department ? ` ${step.department}` : ""})</span>
                                  )}
                                  {step.approverType === "coordinator" && (
                                    <span className="text-slate-500 font-normal"> (Coord.{step.department ? ` ${step.department}` : ""})</span>
                                  )}
                                  {step.hasAmountThreshold && step.amountThreshold && (
                                    <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">&gt;{step.amountThreshold.toLocaleString()}€</span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {step.approverNames?.length ? (
                                    step.approverNames.slice(0, 3).join(", ") + (step.approverNames.length > 3 ? ` +${step.approverNames.length - 3}` : "")
                                  ) : (
                                    `${(step.approvedBy || []).length} aprobación${(step.approvedBy || []).length !== 1 ? "es" : ""}`
                                  )}
                                  {step.requireAll && " (todos)"}
                                </p>
                              </div>
                              {step.status === "approved" && <CheckCircle size={16} className="text-emerald-500" />}
                              {index === currentApproval.currentApprovalStep && step.status === "pending" && <Clock size={16} className="text-amber-500" />}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-6 border-t border-slate-200">
                        {showCommentInput ? (
                          <div className="space-y-3"><textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Añade un comentario (opcional)..." rows={2} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none text-sm" /><div className="flex gap-3"><button onClick={() => { setShowCommentInput(false); setApprovalComment(""); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button><button onClick={() => handleApprove(currentApproval, true)} disabled={processing} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">{processing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={16} />}Aprobar con comentario</button></div></div>
                        ) : (
                          <div className="space-y-3"><div className="flex gap-3"><button onClick={() => { setSelectedApproval(currentApproval); setShowApprovalModal(true); }} disabled={processing} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">{processing ? (<><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Procesando...</>) : (<><CheckCircle size={18} />Aprobar</>)}</button><button onClick={() => { setSelectedApproval(currentApproval); setShowRejectionModal(true); }} disabled={processing} className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"><XCircle size={18} />Rechazar</button></div><div className="flex gap-3"><button onClick={() => setShowCommentInput(true)} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"><MessageSquare size={16} />Aprobar con comentario</button><button onClick={() => { setSelectedApproval(currentApproval); setShowInfoRequestModal(true); }} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"><HelpCircle size={16} />Solicitar información</button></div></div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Auto Checks */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <button onClick={() => toggleSection("checks")} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                      <div className="flex items-center gap-3"><Shield size={18} className="text-slate-500" /><span className="font-semibold text-slate-900">Verificaciones automáticas</span><div className="flex items-center gap-1.5">{currentApproval.autoChecks.filter(c => c.status === "pass").length > 0 && (<span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-lg"><CheckCircle size={10} />{currentApproval.autoChecks.filter(c => c.status === "pass").length}</span>)}{currentApproval.autoChecks.filter(c => c.status === "warning").length > 0 && (<span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg"><AlertTriangle size={10} />{currentApproval.autoChecks.filter(c => c.status === "warning").length}</span>)}{currentApproval.autoChecks.filter(c => c.status === "fail").length > 0 && (<span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg"><XCircle size={10} />{currentApproval.autoChecks.filter(c => c.status === "fail").length}</span>)}</div></div>
                      {expandedSections.has("checks") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                    </button>
                    {expandedSections.has("checks") && (<div className="px-6 pb-6 space-y-2">{currentApproval.autoChecks.map((check) => (<div key={check.id} className={`flex items-start gap-3 p-3 rounded-xl border ${getCheckBg(check.status)}`}>{getCheckIcon(check.status)}<div className="flex-1"><p className="text-sm font-medium text-slate-900">{check.label}</p><p className="text-xs text-slate-600">{check.message}</p>{check.details && <p className="text-xs text-slate-500 mt-1">{check.details}</p>}</div></div>))}</div>)}
                  </div>

                  {/* Budget Impact */}
                  {currentApproval.budgetImpact && currentApproval.budgetImpact.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                      <button onClick={() => toggleSection("budget")} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><PieChart size={18} className="text-slate-500" /><span className="font-semibold text-slate-900">Impacto en presupuesto</span></div>{expandedSections.has("budget") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                      {expandedSections.has("budget") && (<div className="px-6 pb-6 space-y-3">{currentApproval.budgetImpact.map((impact, idx) => { const isOverBudget = impact.afterApproval < 0; const isLow = impact.afterApproval < impact.budgeted * 0.1 && impact.afterApproval >= 0; return (<div key={idx} className={`p-4 rounded-xl border ${isOverBudget ? "border-red-200 bg-red-50" : isLow ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}><div className="flex items-center justify-between mb-2"><p className="text-sm font-medium text-slate-900">{impact.accountCode}</p>{isOverBudget && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg">Sin presupuesto</span>}{isLow && !isOverBudget && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-lg">Bajo</span>}</div><p className="text-xs text-slate-500 mb-3">{impact.accountName}</p><div className="grid grid-cols-4 gap-2 text-xs"><div><p className="text-slate-500">Presupuestado</p><p className="font-semibold text-slate-900">{formatCurrency(impact.budgeted)}</p></div><div><p className="text-slate-500">Disponible</p><p className="font-semibold text-slate-900">{formatCurrency(impact.available)}</p></div><div><p className="text-slate-500">Este doc.</p><p className="font-semibold text-amber-600">-{formatCurrency(impact.available - impact.afterApproval)}</p></div><div><p className="text-slate-500">Tras aprobar</p><p className={`font-semibold ${isOverBudget ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600"}`}>{formatCurrency(impact.afterApproval)}</p></div></div></div>); })}</div>)}
                    </div>
                  )}

                  {/* PO Comparison */}
                  {currentApproval.poComparison && (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                      <button onClick={() => toggleSection("po-comparison")} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><Target size={18} className="text-slate-500" /><span className="font-semibold text-slate-900">Comparativa con PO-{currentApproval.poComparison.poNumber}</span>{currentApproval.poComparison.percentageUsed > 100 && (<span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-lg">Excede PO</span>)}</div>{expandedSections.has("po-comparison") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                      {expandedSections.has("po-comparison") && (<div className="px-6 pb-6"><div className="grid grid-cols-4 gap-4 mb-4"><div className="text-center p-3 bg-slate-50 rounded-xl"><p className="text-xs text-slate-500">Base PO</p><p className="text-sm font-bold text-slate-900">{formatCurrency(currentApproval.poComparison.poBaseAmount)}</p></div><div className="text-center p-3 bg-emerald-50 rounded-xl"><p className="text-xs text-emerald-600">Facturado antes</p><p className="text-sm font-bold text-emerald-700">{formatCurrency(currentApproval.poComparison.invoicedBefore)}</p></div><div className="text-center p-3 bg-amber-50 rounded-xl"><p className="text-xs text-amber-600">Esta factura</p><p className="text-sm font-bold text-amber-700">{formatCurrency(currentApproval.poComparison.thisInvoice)}</p></div><div className={`text-center p-3 rounded-xl ${currentApproval.poComparison.remaining < 0 ? "bg-red-50" : "bg-slate-50"}`}><p className={`text-xs ${currentApproval.poComparison.remaining < 0 ? "text-red-600" : "text-slate-500"}`}>Restante</p><p className={`text-sm font-bold ${currentApproval.poComparison.remaining < 0 ? "text-red-700" : "text-slate-900"}`}>{formatCurrency(currentApproval.poComparison.remaining)}</p></div></div><div className="mb-4"><div className="flex items-center justify-between text-xs text-slate-500 mb-1"><span>Uso de la PO</span><span className={currentApproval.poComparison.percentageUsed > 100 ? "text-red-600 font-medium" : ""}>{currentApproval.poComparison.percentageUsed.toFixed(1)}%</span></div><div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div className={`h-full ${currentApproval.poComparison.percentageUsed > 100 ? "bg-red-500" : currentApproval.poComparison.percentageUsed > 90 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(currentApproval.poComparison.percentageUsed, 100)}%` }} /></div></div>{currentApproval.poComparison.itemDiscrepancies.length > 0 && (<div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl"><p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-2"><AlertTriangle size={12} />Discrepancias en items</p><div className="space-y-2">{currentApproval.poComparison.itemDiscrepancies.map((disc, idx) => (<div key={idx} className="flex items-center justify-between text-xs"><span className="text-slate-700">{disc.description}</span><div className="flex items-center gap-3"><span className="text-slate-500">PO: {formatCurrency(disc.poAmount)}</span><span className="text-slate-900">FAC: {formatCurrency(disc.invoiceAmount)}</span><span className={disc.difference > 0 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>{disc.difference > 0 ? "+" : ""}{formatCurrency(disc.difference)}</span></div></div>))}</div></div>)}</div>)}
                    </div>
                  )}

                  {/* Supplier Stats */}
                  {currentApproval.supplierStats && (
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                      <button onClick={() => toggleSection("supplier")} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><Building2 size={18} className="text-slate-500" /><span className="font-semibold text-slate-900">Historial del proveedor</span></div>{expandedSections.has("supplier") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                      {expandedSections.has("supplier") && (<div className="px-6 pb-6"><div className="grid grid-cols-3 gap-4"><div className="text-center p-4 bg-slate-50 rounded-xl"><p className="text-2xl font-bold text-slate-900">{currentApproval.supplierStats.totalPOs}</p><p className="text-xs text-slate-500">POs totales</p></div><div className="text-center p-4 bg-slate-50 rounded-xl"><p className="text-2xl font-bold text-slate-900">{currentApproval.supplierStats.totalInvoices}</p><p className="text-xs text-slate-500">Facturas totales</p></div><div className="text-center p-4 bg-amber-50 rounded-xl"><p className="text-2xl font-bold text-amber-700">{formatCurrency(currentApproval.supplierStats.pendingAmount)}</p><p className="text-xs text-amber-600">Pendiente</p></div></div>{currentApproval.supplierStats.lastTransaction && (<p className="text-xs text-slate-500 mt-3 text-center">Última transacción: {formatDate(currentApproval.supplierStats.lastTransaction)}</p>)}</div>)}
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <button onClick={() => toggleSection("timeline")} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"><div className="flex items-center gap-3"><History size={18} className="text-slate-500" /><span className="font-semibold text-slate-900">Historial de actividad</span><span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{currentApproval.timeline.length}</span></div>{expandedSections.has("timeline") ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}</button>
                    {expandedSections.has("timeline") && (<div className="px-6 pb-6"><div className="space-y-3">{currentApproval.timeline.map((event, idx) => (<div key={event.id} className="flex items-start gap-3"><div className="relative"><div className={`w-8 h-8 rounded-full flex items-center justify-center ${event.type === "created" ? "bg-blue-100" : event.type === "approved" ? "bg-emerald-100" : event.type === "rejected" ? "bg-red-100" : event.type === "comment" ? "bg-slate-100" : "bg-amber-100"}`}>{event.type === "created" && <FileText size={14} className="text-blue-600" />}{event.type === "approved" && <Check size={14} className="text-emerald-600" />}{event.type === "rejected" && <X size={14} className="text-red-600" />}{event.type === "comment" && <MessageSquare size={14} className="text-slate-600" />}{event.type === "info_requested" && <HelpCircle size={14} className="text-amber-600" />}</div>{idx < currentApproval.timeline.length - 1 && (<div className="absolute top-8 left-1/2 -translate-x-1/2 w-0.5 h-8 bg-slate-200" />)}</div><div className="flex-1 pt-1"><p className="text-sm text-slate-900"><span className="font-medium">{event.userName}</span>{event.type === "created" && " creó el documento"}{event.type === "approved" && ` aprobó (Nivel ${event.stepOrder})`}{event.type === "rejected" && " rechazó el documento"}{event.type === "comment" && " añadió un comentario"}{event.type === "info_requested" && " solicitó información"}</p>{event.comment && (<p className="text-sm text-slate-600 bg-slate-50 p-2 rounded-lg mt-1 italic">"{event.comment}"</p>)}<p className="text-xs text-slate-400 mt-0.5">{formatDateTime(event.date)}</p></div></div>))}</div></div>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Modal de confirmación de aprobación */}
      {showApprovalModal && selectedApproval && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Confirmar aprobación</h3>
              <p className="text-sm text-slate-500">{selectedApproval.displayNumber}</p>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 p-4 bg-emerald-50 rounded-xl mb-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <CheckCircle size={24} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">¿Aprobar este documento?</p>
                  <p className="text-sm text-slate-600">{selectedApproval.supplier} · {formatCurrency(selectedApproval.totalAmount)}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => { setShowApprovalModal(false); setSelectedApproval(null); }} 
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => handleApprove(selectedApproval)} 
                  disabled={processing} 
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                >
                  {processing ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Aprobando...</>
                  ) : (
                    <><CheckCircle size={16} />Confirmar aprobación</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRejectionModal && selectedApproval && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200"><h3 className="text-lg font-semibold text-slate-900">Rechazar documento</h3><p className="text-sm text-slate-500">{selectedApproval.displayNumber}</p></div>
            <div className="p-6"><label className="block text-sm font-medium text-slate-700 mb-2">Motivo del rechazo *</label><textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Explica el motivo del rechazo..." rows={4} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none text-sm" /><div className="flex gap-3 mt-6"><button onClick={() => { setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button><button onClick={handleReject} disabled={processing || !rejectionReason.trim()} className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">{processing ? "Rechazando..." : "Confirmar rechazo"}</button></div></div>
          </div>
        </div>
      )}

      {showInfoRequestModal && selectedApproval && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200"><h3 className="text-lg font-semibold text-slate-900">Solicitar información</h3><p className="text-sm text-slate-500">{selectedApproval.displayNumber}</p></div>
            <div className="p-6"><label className="block text-sm font-medium text-slate-700 mb-2">¿Qué información necesitas?</label><textarea value={infoRequestMessage} onChange={(e) => setInfoRequestMessage(e.target.value)} placeholder="Describe qué información adicional necesitas..." rows={4} className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none text-sm" /><div className="flex gap-3 mt-6"><button onClick={() => { setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null); }} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button><button onClick={handleRequestInfo} disabled={processing || !infoRequestMessage.trim()} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"><Send size={16} />{processing ? "Enviando..." : "Enviar solicitud"}</button></div></div>
          </div>
        </div>
      )}
    </div>
  );
}
