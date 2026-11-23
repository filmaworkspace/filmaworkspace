"use client";
import { errorText } from "@/lib/toast";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import { Button, EmptyState, Field, IconButton, Modal, Page, PageHeader, PageLoading, Textarea } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchAmount, matchCode, matchWords } from "@/lib/search";
import { useCanSeeBudget } from "@/hooks/useCanSeeBudget";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { getScopedDocs, scopeFromMember, type DocScope } from "@/lib/accountingScope";
import { loadBudgetFigures } from "@/lib/budgetFigures";
import { ApprovalSteps } from "@/components/accounting/ApprovalFlow";
import { approveDoc, rejectDoc, requestInfo } from "@/lib/approvalOps";
import type { PendingKind } from "@/lib/myPending";
import { syncBudget } from "@/lib/ledgerClient";
import { applyApproval, applyRejection, canApprove, stripUndefined, withNames } from "@/lib/approvalFlow";
import {
  onAuthStateChanged,
} from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  runTransaction,
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
  openPOs: number;
  totalInvoices: number;
  invoicedBase: number;
  pendingAmount: number;
  lastTransaction: Date | null;
  taxId?: string;
  iban?: string;
  certState: "verified" | "unverified" | "expired" | "none" | "noiban";
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
  supplierNumber?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  vatAmount?: number;
  irpfAmount?: number;
  documentType?: string;
}

interface UserStats {
  approvedToday: number;
  approvedThisWeek: number;
  approvedThisMonth: number;
  avgResponseTime: number;
  pendingCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────

/** Bloque de información del documento (mismo estilo en toda la página). */
function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-slate-900">{title}</h3>
        {aside && <span className="text-xs text-slate-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** Barra fina con tramos (realizado, comprometido, este documento). */
function Bar({ parts, total }: { parts: { value: number; cls: string }[]; total: number }) {
  return (
    <span aria-hidden="true" className="flex h-[4px] w-full overflow-hidden rounded-full bg-[#F1F1F3]">
      {parts.map((p, k) => <span key={k} className={p.cls} style={{ width: `${total > 0 ? Math.max(0, Math.min(100, (p.value / total) * 100)) : 0}%` }} />)}
    </span>
  );
}

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
  // Los avisos van por lib/toast.
  const setSuccessMessage = (m: string) => { if (m) appToast.success(m); };
  const setErrorMessage = (m: string) => { if (m) appToast.error(m); };
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
      const memberList = Object.entries(membersMap).map(([userId, name]) => ({ userId, name }));

      let localUserRole = "", localUserDepartment = "", localUserPosition = "";
      const memberDoc = await getDoc(doc(db, `projects/${id}/members`, userId!));
      scopeRef.current = scopeFromMember(userId!, memberDoc.exists() ? (memberDoc.data() as any) : null);
      if (memberDoc.exists()) { const d = memberDoc.data(); localUserRole = d.role || ""; localUserDepartment = d.department || ""; localUserPosition = d.position || ""; setUserRole(localUserRole); setUserDepartment(localUserDepartment); setUserPosition(localUserPosition); }

      const subAccountsMap: Record<string, any> = {};
      const accountsSnap = await getDocs(collection(db, `projects/${id}/accounts`));
      const figures = await loadBudgetFigures(id as string);
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subsSnap = await getDocs(collection(db, `projects/${id}/accounts/${accDoc.id}/subaccounts`));
        for (const subDoc of subsSnap.docs) { const subData = subDoc.data(); subAccountsMap[subDoc.id] = { hasFigure: subDoc.id in figures || subData.budgeted !== undefined, id: subDoc.id, code: subData.code, description: subData.description, budgeted: figures[subDoc.id] ?? subData.budgeted ?? 0, committed: subData.committed || 0, actual: subData.actual || 0, available: (figures[subDoc.id] ?? subData.budgeted ?? 0) - (subData.committed || 0) - (subData.actual || 0), accountCode: accData.code, accountDescription: accData.description }; }
      }

      await loadUserStats(localUserRole, localUserDepartment, localUserPosition);

      // Load POs
      const posSnap = await scopedDocs("pos", "status", "==", "pending");
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
            currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: (withNames(d as any, memberList).approvalSteps || []) as any,
            attachmentUrl: d.attachmentUrl, attachmentFileName: d.attachmentFileName,
            items: d.items || [], department: d.department, poType: d.poType, currency: d.currency || "EUR",
            vatAmount: d.vatAmount || 0, irpfAmount: d.irpfAmount || 0,
            timeline: buildTimeline(d, membersMap), autoChecks: buildAutoChecks(d, "po", subAccountsMap),
            budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, "po", false),
            supplierStats: await loadSupplierStats(d.supplierId), daysWaiting, isUrgent: daysWaiting >= 3,
          });
        }
      }

      // Load Invoices
      try {
        const invoicesSnap = await scopedDocs("invoices", "status", "in", ["submitted", "pending_approval"]);
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
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: (withNames(d as any, memberList).approvalSteps || []) as any,
              attachmentUrl: d.attachmentUrl, attachmentFileName: d.attachmentFileName,
              items: d.items || [], poId: d.poId, poNumber: d.poNumber, department: d.department,
              supplierNumber: d.supplierNumber || "", invoiceDate: d.invoiceDate?.toDate?.(), dueDate: d.dueDate?.toDate?.(),
              vatAmount: d.vatAmount || 0, irpfAmount: d.irpfAmount || 0, documentType: d.documentType || "invoice",
              timeline: buildTimeline(d, membersMap), autoChecks: buildAutoChecks(d, "invoice", subAccountsMap),
              budgetImpact: calculateBudgetImpact(d.items || [], subAccountsMap, "invoice", !!d.poId),
              supplierStats: await loadSupplierStats(d.supplierId), poComparison, daysWaiting, isUrgent: daysWaiting >= 3,
            });
          }
        }
      } catch (e) {}

      // Load Card Envelopes (sobres de tarjeta pendientes de aprobación)
      try {
        const cardEnvSnap = { docs: (await getDocs(query(collection(db, `projects/${id}/cardEnvelopes`), where("approverIds", "array-contains", userId)))).docs.filter((d) => d.data().status === "pending_approval") };
        for (const envDoc of cardEnvSnap.docs) {
          const d = envDoc.data();
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            
            // Cargar gastos del sobre
            const expensesSnap = await getDocs(query(collection(db, `projects/${id}/cardExpenses`), where("envelopeId", "==", envDoc.id))).catch(() => ({ docs: [] as any[] }));
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
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: (withNames(d as any, memberList).approvalSteps || []) as any,
              timeline: buildTimeline(d, membersMap), autoChecks: [],
              daysWaiting, isUrgent: daysWaiting >= 3,
              boxType: "card", boxExpenses, expenseCount: d.expenseCount || 0, cardName,
            });
          }
        }
      } catch (e) {}

      // Load Transfer Envelopes (sobres de transferencia pendientes de aprobación)
      try {
        const transferEnvSnap = { docs: (await getDocs(query(collection(db, `projects/${id}/transferEnvelopes`), where("approverIds", "array-contains", userId)))).docs.filter((d) => d.data().status === "pending_approval") };
        for (const envDoc of transferEnvSnap.docs) {
          const d = envDoc.data();
          if (canUserApprove(d, userId!, localUserRole, localUserDepartment, localUserPosition)) {
            const createdAt = d.createdAt?.toDate() || new Date();
            const daysWaiting = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
            
            // Cargar gastos del sobre
            const expensesSnap = await getDocs(query(collection(db, `projects/${id}/transferExpenses`), where("envelopeId", "==", envDoc.id))).catch(() => ({ docs: [] as any[] }));
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
              currentApprovalStep: d.currentApprovalStep || 0, approvalSteps: (withNames(d as any, memberList).approvalSteps || []) as any,
              timeline: buildTimeline(d, membersMap), autoChecks: [],
              daysWaiting, isUrgent: daysWaiting >= 3,
              boxType: "transfer", boxExpenses, expenseCount: d.expenseCount || 0, paymentDate: d.paymentDate,
            });
          }
        }
      } catch (e) {}

      // Comprobaciones con datos de otros documentos y del proveedor.
      for (const a of approvals) {
        if (a.type === "box") continue;
        const st = a.supplierStats;
        if (st) {
          a.autoChecks.push(
            st.certState === "verified" ? { id: "iban", label: "Cuenta bancaria", status: "pass", message: "Certificado de titularidad verificado" }
            : st.certState === "noiban" ? { id: "iban", label: "Cuenta bancaria", status: "warning", message: "El proveedor no tiene IBAN" }
            : { id: "iban", label: "Cuenta bancaria", status: "warning", message: st.certState === "unverified" ? "Certificado sin verificar" : st.certState === "expired" ? "Certificado caducado" : "Sin certificado de titularidad" },
          );
        }
        if (a.poComparison && a.poComparison.remaining < -0.005) {
          a.autoChecks.push({ id: "po-over", label: `PO-${a.poComparison.poNumber}`, status: "fail", message: `La supera en ${formatCurrency(-a.poComparison.remaining)}` });
        }
        if (a.type === "invoice" && a.supplierNumber && a.supplierId) {
          const dup = (await scopedDocs("invoices", "supplierId", "==", a.supplierId)).docs.find((x) => x.id !== a.documentId && (x.data().supplierNumber || "").trim().toUpperCase() === a.supplierNumber!.trim().toUpperCase() && !["cancelled", "void"].includes(x.data().status));
          if (dup) a.autoChecks.push({ id: "dup", label: "Posible duplicado", status: "fail", message: `${dup.data().displayNumber} tiene el mismo número de proveedor` });
        }
        if (a.type === "invoice" && a.dueDate) {
          const days = Math.round((a.dueDate.getTime() - Date.now()) / 86400000);
          if (days < 0) a.autoChecks.push({ id: "due", label: "Vencimiento", status: "warning", message: `Vencida hace ${-days} ${-days === 1 ? "día" : "días"}` });
          else if (days <= 7) a.autoChecks.push({ id: "due", label: "Vencimiento", status: "info", message: days === 0 ? "Vence hoy" : `Vence en ${days} ${days === 1 ? "día" : "días"}` });
        }
      }

      approvals.sort((a, b) => { if (a.isUrgent && !b.isUrgent) return -1; if (!a.isUrgent && b.isUrgent) return 1; return b.createdAt.getTime() - a.createdAt.getTime(); });
      setPendingApprovals(approvals);
      setFilteredApprovals(approvals);
      setUserStats(prev => ({ ...prev, pendingCount: approvals.length }));
      setLoading(false);
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido completar")); setLoading(false); }
  };

  // POs/facturas que este usuario puede leer (lib/accountingScope). Con alcance
  // limitado la condición se aplica en el cliente.
  const scopeRef = useRef<DocScope>({ all: true });
  const scopedDocs = async (col: "pos" | "invoices", field: string, op: "==" | "in", value: any) => {
    const docs = (await getScopedDocs(collection(db, `projects/${id}/${col}`), scopeRef.current, [where(field, op, value)]))
      .filter((d) => (op === "in" ? (value as any[]).includes(d.data()[field]) : d.data()[field] === value));
    return { docs, size: docs.length, empty: docs.length === 0 };
  };

  const loadUserStats = async (role: string, dept: string, pos: string) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      let approvedToday = 0, approvedThisWeek = 0, approvedThisMonth = 0;

      const posSnap = await scopedDocs("pos", "status", "==", "approved");
      for (const poDoc of posSnap.docs) {
        const d = poDoc.data();
        if (d.approvedBy === userId || d.approvalSteps?.some((s: any) => s.approvedBy?.includes(userId))) {
          const approvedAt = d.approvedAt?.toDate();
          if (approvedAt) { if (approvedAt >= todayStart) approvedToday++; if (approvedAt >= weekStart) approvedThisWeek++; if (approvedAt >= monthStart) approvedThisMonth++; }
        }
      }
      try {
        const invSnap = await scopedDocs("invoices", "approvalStatus", "==", "approved");
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
      const [posSnap, invSnap, supSnap] = await Promise.all([
        scopedDocs("pos", "supplierId", "==", supplierId),
        scopedDocs("invoices", "supplierId", "==", supplierId).catch(() => ({ docs: [] as any[], size: 0, empty: true })),
        getDoc(doc(db, `projects/${id}/suppliers`, supplierId)).catch(() => null),
      ]);
      let openPOs = 0, invoicedBase = 0, pendingAmount = 0;
      let lastTransaction: Date | null = null;
      const seen = (dt?: Date) => { if (dt && (!lastTransaction || dt > lastTransaction)) lastTransaction = dt; };
      for (const d of posSnap.docs.map((x) => x.data())) { if (d.status === "approved") openPOs++; seen(d.createdAt?.toDate()); }
      for (const d of invSnap.docs.map((x: any) => x.data())) {
        if (["cancelled", "void", "rejected"].includes(d.status)) continue;
        invoicedBase += d.baseAmount || 0;
        if (!d.paidAt && d.status !== "paid") pendingAmount += d.totalAmount || 0;
        seen(d.invoiceDate?.toDate?.() || d.createdAt?.toDate?.());
      }
      const sup = supSnap?.data();
      const iban = (sup?.bankAccount || sup?.iban || "").replace(/\s+/g, "");
      const cert = sup?.certificates?.bankOwnership;
      const exp = cert?.expiryDate?.toDate?.();
      const certState: SupplierStats["certState"] = !iban ? "noiban" : cert?.verified ? (exp && exp < new Date() ? "expired" : "verified") : cert?.uploaded ? "unverified" : "none";
      return { totalPOs: posSnap.size, openPOs, totalInvoices: invSnap.size, invoicedBase, pendingAmount, lastTransaction, taxId: sup?.taxId, iban, certState };
    } catch (e) { return undefined; }
  };

  const loadPOComparison = async (poId: string, invoiceItems: any[], invoiceBaseAmount: number, currentInvoiceId: string): Promise<POComparison | undefined> => {
    try {
      const poDoc = await getDoc(doc(db, `projects/${id}/pos`, poId));
      if (!poDoc.exists()) return undefined;
      const poData = poDoc.data();
      const poBaseAmount = poData.baseAmount || 0;
      let invoicedBefore = 0;
      try { const invSnap = await scopedDocs("invoices", "poId", "==", poId); for (const invDoc of invSnap.docs) { if (invDoc.id !== currentInvoiceId) { const d = invDoc.data(); if (["pending", "pending_approval", "approved", "paid"].includes(d.status)) invoicedBefore += d.baseAmount || 0; } } } catch (e) {}
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
            if (diff > 0.01) itemDiscrepancies.push({ description: invItem.description || poItem.description, poAmount: poItem.baseAmount || 0, invoiceAmount: invItem.baseAmount || 0, difference: diff });
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
          for (const approverId of step.approvedBy) events.push({ id: `approved-${step.order}-${approverId}`, type: "approved", date: (step.approvals || []).find((x: any) => x.uid === approverId)?.at?.toDate?.() || step.approvedAt?.toDate?.() || docData.createdAt?.toDate?.() || new Date(), userId: approverId, userName: membersMap[approverId] || approverId, stepOrder: step.order });
        }
      }
    }
    if (docData.comments) { for (const comment of docData.comments) events.push({ id: `comment-${comment.id}`, type: comment.type === "info_request" ? "info_requested" : "comment", date: comment.createdAt?.toDate() || new Date(), userId: comment.userId, userName: membersMap[comment.userId] || comment.userName || "Usuario", comment: comment.text }); }
    return events.sort((a, b) => a.date.getTime() - b.date.getTime());
  };

  const buildAutoChecks = (docData: any, type: "po" | "invoice", subAccountsMap: Record<string, any>): AutoCheck[] => {
    const checks: AutoCheck[] = [];
    const items = docData.items || [];
    // La factura tiene que traer su documento; en una PO es opcional.
    if (type === "invoice") checks.push({ id: "attachment", label: "Documento", status: docData.attachmentUrl ? "pass" : "warning", message: docData.attachmentUrl ? "Adjunto" : "Sin documento adjunto" });
    else if (docData.attachmentUrl) checks.push({ id: "attachment", label: "Documento", status: "pass", message: "Presupuesto del proveedor adjunto" });
    const noAccount = items.filter((it: any) => !it.subAccountId).length;
    if (noAccount) checks.push({ id: "accounts", label: "Cuentas", status: "fail", message: `${noAccount} ${noAccount === 1 ? "línea sin cuenta" : "líneas sin cuenta"}` });
    // Presupuesto por subcuenta (solo con acceso a las cifras).
    const bySub: Record<string, number> = {};
    for (const it of items) if (it.subAccountId) bySub[it.subAccountId] = (bySub[it.subAccountId] || 0) + (it.baseAmount || 0);
    const over = Object.entries(bySub).filter(([sid, amt]) => subAccountsMap[sid]?.hasFigure && subAccountsMap[sid].available < amt - 0.005 && !(type === "invoice" && docData.poId));
    if (Object.keys(bySub).some((sid) => subAccountsMap[sid]?.hasFigure)) {
      checks.push(over.length
        ? { id: "budget", label: "Presupuesto", status: "fail", message: `${over.map(([sid]) => subAccountsMap[sid].code).join(", ")} sin disponible suficiente` }
        : { id: "budget", label: "Presupuesto", status: "pass", message: "Hay disponible en todas las cuentas" });
    }
    if (!docData.supplierId) checks.push({ id: "supplier", label: "Proveedor", status: "warning", message: "No está dado de alta" });
    if (type === "invoice") checks.push(docData.poId
      ? { id: "po-link", label: "PO", status: "pass", message: `Vinculada a PO-${docData.poNumber}` }
      : { id: "po-link", label: "PO", status: "info", message: "Sin PO: el gasto se realiza directamente" });
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

  // Quién puede aprobar sale de la lista fijada en el flujo del documento (la
  // misma que usan las reglas), no del rol/puesto actual de la persona.
  const canUserApprove = (docData: any, uId: string, _r?: string, _d?: string, _p?: string): boolean => canApprove(docData, uId);


  // Operaciones comunes con el móvil (lib/approvalOps): transacción y presupuesto.
  const kindOf = (a: PendingApproval): PendingKind => (a.type === "box" ? (a.boxType === "card" ? "card" : "transfer") : a.type);
  const actor = () => ({ uid: userId || "", name: userName });
  const dropFromQueue = (a: PendingApproval) => {
    setPendingApprovals(pendingApprovals.filter((x) => x.id !== a.id));
    if (currentIndex >= filteredApprovals.length - 1) setCurrentIndex(Math.max(0, currentIndex - 1));
  };

  const handleApprove = async (approval: PendingApproval, withComment: boolean = false) => {
    if (withComment && !approvalComment.trim()) { setErrorMessage("Escribe un comentario"); return; }
    setShowApprovalModal(false);
    setProcessing(true);
    try {
      const { complete } = await approveDoc(approval.projectId, kindOf(approval), approval.documentId, actor(), approvalComment);
      dropFromQueue(approval);
      setSuccessMessage(complete ? `${approval.displayNumber} aprobado` : "Aprobación registrada");
      setApprovalComment(""); setShowCommentInput(false);
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido aprobar")); } finally { setProcessing(false); }
  };

  const handleReject = async () => {
    if (!selectedApproval || !rejectionReason.trim()) { setErrorMessage("Escribe el motivo del rechazo"); return; }
    setProcessing(true);
    try {
      await rejectDoc(selectedApproval.projectId, kindOf(selectedApproval), selectedApproval.documentId, actor(), rejectionReason);
      dropFromQueue(selectedApproval);
      setSuccessMessage(`${selectedApproval.displayNumber} rechazado`);
      setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null);
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido rechazar")); } finally { setProcessing(false); }
  };

  const handleRequestInfo = async () => {
    if (!selectedApproval || !infoRequestMessage.trim()) { setErrorMessage("Escribe qué información necesitas"); return; }
    setProcessing(true);
    try {
      await requestInfo(selectedApproval.projectId, kindOf(selectedApproval), selectedApproval.documentId, actor(), infoRequestMessage);
      setSuccessMessage("Solicitud de información enviada");
      setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null);
      loadPendingApprovals();
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido enviar")); } finally { setProcessing(false); }
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
  if (loading) return <PageLoading />;

  const urgentCount = pendingApprovals.filter((a) => a.isUrgent).length;
  const typeLabel = (t: "all" | "po" | "invoice" | "box") => (t === "all" ? "Todos" : t === "po" ? "POs" : t === "invoice" ? "Facturas" : "Cajas");
  const typeCode = (a: PendingApproval) => (a.type === "po" ? "PO" : a.type === "box" ? (a.boxType === "card" ? "TAR" : "TRF") : a.documentType === "proforma" ? "PRF" : a.documentType === "guarantee" ? "FNZ" : "FRA");
  const typeName = (a: PendingApproval) => (a.type === "po" ? "Orden de compra" : a.type === "box" ? (a.boxType === "card" ? "Sobre de tarjeta" : "Sobre de transferencias") : a.documentType === "proforma" ? "Proforma" : a.documentType === "guarantee" ? "Fianza" : "Factura");
  const DOT: Record<AutoCheck["status"], string> = { pass: "bg-emerald-500", warning: "bg-amber-500", fail: "bg-red-500", info: "bg-slate-400" };
  const worstOf = (a: PendingApproval) => (a.autoChecks.some((c) => c.status === "fail") ? "fail" : a.autoChecks.some((c) => c.status === "warning") ? "warning" : null);
  const days = (n: number) => (n === 0 ? "hoy" : `${n} ${n === 1 ? "día" : "días"}`);
  const levelOf = (a: PendingApproval) => {
    const steps = (a.approvalSteps || []).filter((x) => (x as any).status !== "skipped");
    const i = Math.max(0, steps.findIndex((x) => x === a.approvalSteps[a.currentApprovalStep]));
    return steps.length ? `Nivel ${i + 1} de ${steps.length}` : "";
  };
  const a = currentApproval;

  return (
    <Page>
      <PageHeader
        title={
          <>
            Aprobaciones <span className="text-[15px] font-normal text-slate-400">{pendingApprovals.length}</span>
            {urgentCount > 0 && <span className="inline-flex items-center gap-1.5 text-xs font-normal text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />{urgentCount} {urgentCount === 1 ? "esperando más de 3 días" : "esperan más de 3 días"}</span>}
          </>
        }
        actions={
          <span className="hidden items-center gap-4 text-xs text-slate-500 md:flex">
            <span><span className="tabular-nums text-slate-900">{userStats.approvedToday}</span> hoy</span>
            <span><span className="tabular-nums text-slate-900">{userStats.approvedThisWeek}</span> esta semana</span>
            <span><span className="tabular-nums text-slate-900">{userStats.approvedThisMonth}</span> este mes</span>
          </span>
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={APPROVAL_FIELDS} field={apprField} onField={setApprField} value={apprSearch} onChange={setApprSearch} count={filteredApprovals.length} />
        <div className="flex gap-0.5 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="tablist" aria-label="Tipo">
          {(["all", "po", "invoice", "box"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={typeFilter === t} onClick={() => setTypeFilter(t)}
              className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${typeFilter === t ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}>
              {typeLabel(t)}
              <span className="tabular-nums text-slate-400">{t === "all" ? pendingApprovals.length : pendingApprovals.filter((x) => x.type === t).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {filteredApprovals.length === 0 ? (
          <EmptyState title={apprSearch || typeFilter !== "all" ? "Sin resultados" : userStats.approvedThisWeek > 0 ? `Todo al día · ${userStats.approvedThisWeek} aprobados esta semana` : "Todo al día"} />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* Cola */}
            <div className="lg:sticky lg:top-[85px]">
              <div className="overflow-hidden rounded-lg border border-slate-200 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto">
                {filteredApprovals.map((x, index) => {
                  const worst = worstOf(x);
                  const on = index === currentIndex;
                  return (
                    <button key={x.id} onClick={() => setCurrentIndex(index)} aria-current={on}
                      className={`relative flex w-full flex-col gap-1 border-b border-slate-100 px-3.5 py-2.5 text-left last:border-0 ${on ? "bg-[#F4F4F5]" : "hover:bg-[#FAFAFA]"}`}>
                      {on && <span className="absolute inset-y-0 left-0 w-[2px] bg-slate-900" />}
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-7 font-mono text-[10px] text-slate-500">{typeCode(x)}</span>
                          <span className="font-mono text-xs font-medium text-slate-900">{x.displayNumber}</span>
                        </span>
                        <span className="text-[13px] font-medium tabular-nums text-slate-900">{formatCurrency(x.baseAmount, x.currency)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2 pl-9 text-xs text-slate-500">
                        <span className="truncate">{x.supplier || "Sin proveedor"}</span>
                        <span className="flex flex-shrink-0 items-center gap-1.5">
                          {worst && <span className={`h-1.5 w-1.5 rounded-full ${DOT[worst]}`} title={worst === "fail" ? "Hay comprobaciones que fallan" : "Hay avisos"} />}
                          <span className={x.isUrgent ? "text-red-700" : ""}>{x.daysWaiting > 0 ? `${x.daysWaiting} d` : "hoy"}</span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 hidden items-center gap-3 text-[11px] text-slate-500 lg:flex">
                {[["J", "siguiente"], ["K", "anterior"], ["A", "aprobar"], ["R", "rechazar"]].map(([k, l]) => (
                  <span key={k} className="inline-flex items-center gap-1"><kbd className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 text-[10px] text-slate-600">{k}</kbd>{l}</span>
                ))}
              </p>
            </div>

            {/* Documento */}
            {a && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  {/* Cabecera */}
                  <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-4 pt-5">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{typeName(a)}</span>
                        {levelOf(a) && <><span aria-hidden="true">·</span><span>{levelOf(a)}</span></>}
                        <span aria-hidden="true">·</span>
                        <span className={a.isUrgent ? "text-red-700" : ""}>esperando {days(a.daysWaiting)}</span>
                      </p>
                      <h2 className="mt-1 flex items-center gap-3">
                        <span className="font-mono text-[15px] font-semibold text-slate-900">{a.displayNumber}</span>
                        <span className="truncate text-[17px] font-semibold text-slate-900">{a.supplier || "Sin proveedor"}</span>
                      </h2>
                      {a.description && <p className="mt-1 text-[13px] text-slate-600">{a.description}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Base imponible</p>
                      <p className="text-[22px] font-semibold tabular-nums tracking-tight text-slate-900">{formatCurrency(a.baseAmount, a.currency)}</p>
                      {a.amount !== a.baseAmount && <p className="text-xs tabular-nums text-slate-500">{formatCurrency(a.amount, a.currency)} con impuestos</p>}
                    </div>
                  </div>

                  {/* Datos */}
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-slate-100 px-5 py-4 text-[13px] md:grid-cols-4">
                    {([
                      a.type === "invoice" ? ["Nº proveedor", a.supplierNumber ? <span className="font-mono text-xs">{a.supplierNumber}</span> : null] : ["Departamento", a.department],
                      a.type === "invoice" ? ["Fecha factura", a.invoiceDate ? formatDate(a.invoiceDate) : null] : ["Fecha", formatDate(a.createdAt)],
                      a.type === "invoice" ? ["Vencimiento", a.dueDate ? formatDate(a.dueDate) : null] : a.type === "box" ? ["Gastos", String(a.expenseCount || a.boxExpenses?.length || 0)] : ["Líneas", String(a.items?.length || 0)],
                      ["Solicita", a.createdByName],
                      ...(a.type === "invoice" ? [["Departamento", a.department], ["PO", a.poNumber ? <span className="font-mono text-xs">PO-{a.poNumber}</span> : "Sin PO"]] : []),
                    ] as [string, React.ReactNode][]).map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-xs text-slate-500">{k}</dt>
                        <dd className="mt-0.5 truncate text-slate-900">{v || <span className="text-slate-400">—</span>}</dd>
                      </div>
                    ))}
                  </dl>

                  {/* Líneas */}
                  {a.items && a.items.length > 0 && (
                    <div className="border-t border-slate-100">
                      <table className="w-full border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                            <th scope="col" className="px-5 py-2 text-left font-medium">Concepto</th>
                            <th scope="col" className="w-40 px-3 py-2 text-left font-medium">Cuenta</th>
                            <th scope="col" className="w-36 px-3 py-2 text-right font-medium">Cant. × precio</th>
                            <th scope="col" className="w-32 px-5 py-2 text-right font-medium">Base</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.items.map((item: any, k: number) => (
                            <tr key={k} className="border-b border-slate-100 last:border-0">
                              <td className="px-5 py-2 text-slate-900">
                                {item.description || <span className="text-slate-400">Sin concepto</span>}
                                {item.episodeAssignment === "specific" && item.episodes?.length ? <span className="ml-1.5 text-xs text-slate-500">cap. {item.episodes.map((e: any) => e.episode).join(", ")}</span> : null}
                              </td>
                              <td className="px-3 py-2">
                                {item.subAccountCode ? <><span className="font-mono text-xs text-slate-700">{item.subAccountCode}</span> <span className="text-xs text-slate-500">{item.subAccountDescription || ""}</span></> : <span className="text-xs text-red-700">Sin cuenta</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{item.quantity || 0} × {formatCurrency(item.unitPrice || 0)}</td>
                              <td className="px-5 py-2 text-right tabular-nums text-slate-900">{formatCurrency(item.baseAmount ?? ((item.quantity || 0) * (item.unitPrice || 0)))}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="text-xs text-slate-600">
                          {!!a.vatAmount && <tr><td colSpan={3} className="px-5 pt-2 text-right">IVA</td><td className="px-5 pt-2 text-right tabular-nums">{formatCurrency(a.vatAmount)}</td></tr>}
                          {!!a.irpfAmount && <tr><td colSpan={3} className="px-5 pt-1 text-right">IRPF</td><td className="px-5 pt-1 text-right tabular-nums">−{formatCurrency(a.irpfAmount)}</td></tr>}
                          <tr><td colSpan={3} className="px-5 pb-2.5 pt-1 text-right font-medium text-slate-900">Total</td><td className="px-5 pb-2.5 pt-1 text-right font-medium tabular-nums text-slate-900">{formatCurrency(a.amount, a.currency)}</td></tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* Gastos del sobre */}
                  {a.type === "box" && a.boxExpenses && a.boxExpenses.length > 0 && (
                    <div className="max-h-72 overflow-y-auto border-t border-slate-100">
                      <table className="w-full border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                            {a.boxType === "transfer" && <th scope="col" className="px-5 py-2 text-left font-medium">Persona</th>}
                            <th scope="col" className={`${a.boxType === "transfer" ? "px-3" : "px-5"} py-2 text-left font-medium`}>Proveedor</th>
                            <th scope="col" className="px-3 py-2 text-left font-medium">Cuenta</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Base</th>
                            <th scope="col" className="px-5 py-2 text-right font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.boxExpenses.map((e, k) => (
                            <tr key={e.id || k} className="border-b border-slate-100 last:border-0">
                              {a.boxType === "transfer" && <td className="px-5 py-1.5">{e.personName || "—"}</td>}
                              <td className={`${a.boxType === "transfer" ? "px-3" : "px-5"} max-w-[220px] truncate py-1.5`}>{e.supplier}</td>
                              <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{e.subAccountCode}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatCurrency(e.baseAmount)}</td>
                              <td className="px-5 py-1.5 text-right tabular-nums">{formatCurrency(e.totalAmount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Documento adjunto */}
                  {a.attachmentUrl && (
                    <div className="border-t border-slate-100 px-5 py-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-slate-600"><FileText size={14} className="text-slate-400" />{a.attachmentFileName || "Documento"}</span>
                        <span className="flex gap-3">
                          <button onClick={() => setShowPreview(!showPreview)} className="font-medium text-slate-900 hover:underline">{showPreview ? "Ocultar" : "Ver aquí"}</button>
                          <a href={a.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">Abrir <ExternalLink size={11} /></a>
                        </span>
                      </div>
                      {showPreview && (
                        <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-[#F7F7F8]">
                          {a.attachmentUrl.toLowerCase().includes(".pdf")
                            ? <iframe src={a.attachmentUrl} className="h-[520px] w-full" title="Documento" />
                            // eslint-disable-next-line @next/next/no-img-element
                            : <img src={a.attachmentUrl} alt={`Documento de ${a.displayNumber}`} className="max-h-[520px] w-full object-contain" />}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Circuito */}
                  <div className="border-t border-slate-100 px-5 py-4">
                    <p className="mb-2 text-xs text-slate-500">Circuito de aprobación</p>
                    <ApprovalSteps steps={a.approvalSteps as any} current={a.currentApprovalStep} department={a.department} />
                  </div>

                  {/* Acciones */}
                  <div className="border-t border-slate-200 bg-[#FAFAFA] px-5 py-3">
                    {showCommentInput ? (
                      <div className="flex flex-col gap-2">
                        <Textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Comentario para el circuito" rows={2} autoFocus />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => { setShowCommentInput(false); setApprovalComment(""); }}>Cancelar</Button>
                          <Button variant="primary" onClick={() => handleApprove(a, true)} disabled={processing || !approvalComment.trim()}><Check size={14} /> Aprobar con comentario</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-xs text-slate-500">
                          <IconButton label="Anterior (K)" onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0}><ChevronLeft size={15} /></IconButton>
                          <span className="tabular-nums">{currentIndex + 1} de {filteredApprovals.length}</span>
                          <IconButton label="Siguiente (J)" onClick={() => setCurrentIndex(Math.min(filteredApprovals.length - 1, currentIndex + 1))} disabled={currentIndex === filteredApprovals.length - 1}><ChevronRight size={15} /></IconButton>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="ghost" onClick={() => { setSelectedApproval(a); setShowInfoRequestModal(true); }}><HelpCircle size={14} /> Pedir información</Button>
                          <Button variant="ghost" onClick={() => setShowCommentInput(true)}><MessageSquare size={14} /> Con comentario</Button>
                          <Button variant="danger" onClick={() => { setSelectedApproval(a); setShowRejectionModal(true); }} disabled={processing}><X size={14} /> Rechazar</Button>
                          <Button variant="primary" onClick={() => { setSelectedApproval(a); setShowApprovalModal(true); }} disabled={processing}><Check size={14} /> Aprobar</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  {/* Comprobaciones */}
                  {a.autoChecks.length > 0 && (
                    <Section title="Comprobaciones" aside={(() => { const n = a.autoChecks.filter((c) => c.status === "fail" || c.status === "warning").length; return n ? `${n} ${n === 1 ? "aviso" : "avisos"}` : "Todo correcto"; })()}>
                      {[...a.autoChecks].sort((x, y) => ["fail", "warning", "info", "pass"].indexOf(x.status) - ["fail", "warning", "info", "pass"].indexOf(y.status)).map((c) => (
                        <div key={c.id} className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-2 text-[13px] last:border-0">
                          <span className={`mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[c.status]}`} />
                          <span className="min-w-0 flex-1">
                            <span className="text-slate-900">{c.label}</span>
                            <span className="text-slate-500"> · {c.message}</span>
                            {c.details && <span className="block text-xs text-slate-500">{c.details}</span>}
                          </span>
                        </div>
                      ))}
                    </Section>
                  )}

                  {/* Presupuesto */}
                  {canSeeBudgetFigures && a.budgetImpact && a.budgetImpact.length > 0 && (
                    <Section title="Presupuesto" aside={a.type === "po" ? "Al aprobar se compromete" : a.poNumber ? "Pasa de comprometido a realizado" : "Al aprobar se realiza"}>
                      {a.budgetImpact.map((im) => {
                        const over = im.afterApproval < 0;
                        const used = (im.committedAfter ?? im.committed) + (im.actualAfter ?? im.actual);
                        const thisDoc = Math.max(0, used - im.committed - im.actual);
                        return (
                          <div key={im.accountCode} className="border-b border-slate-100 px-4 py-3 last:border-0">
                            <div className="flex items-baseline justify-between gap-3 text-[13px]">
                              <span className="min-w-0 truncate"><span className="font-mono text-xs text-slate-700">{im.accountCode}</span> <span className="text-slate-900">{im.accountName}</span></span>
                              <span className={`flex-shrink-0 tabular-nums ${over ? "font-medium text-red-700" : "text-slate-900"}`}>{formatCurrency(im.afterApproval)} <span className="text-xs font-normal text-slate-500">disponible</span></span>
                            </div>
                            <div className="mt-2">
                              <Bar total={im.budgeted} parts={[
                                { value: im.actual, cls: "bg-slate-700" },
                                { value: im.committed, cls: "bg-slate-400" },
                                { value: thisDoc, cls: over ? "bg-red-500" : "bg-[#2F52E0]" },
                              ]} />
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-x-4 text-[11.5px] tabular-nums text-slate-500">
                              <span>Presupuesto {formatCurrency(im.budgeted)}</span>
                              <span>Realizado {formatCurrency(im.actualAfter ?? im.actual)}</span>
                              <span>Comprometido {formatCurrency(im.committedAfter ?? im.committed)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </Section>
                  )}

                  {/* PO */}
                  {a.poComparison && (
                    <Section title={`PO-${a.poComparison.poNumber}`} aside={`${a.poComparison.percentageUsed.toFixed(0)} % con esta factura`}>
                      <div className="px-4 py-3">
                        <Bar total={Math.max(a.poComparison.poBaseAmount, a.poComparison.invoicedBefore + a.poComparison.thisInvoice)} parts={[
                          { value: a.poComparison.invoicedBefore, cls: "bg-slate-700" },
                          { value: a.poComparison.thisInvoice, cls: a.poComparison.remaining < 0 ? "bg-red-500" : "bg-[#2F52E0]" },
                        ]} />
                        <dl className="mt-3 grid grid-cols-4 gap-3 text-[13px]">
                          {[["Base PO", a.poComparison.poBaseAmount], ["Ya facturado", a.poComparison.invoicedBefore], ["Esta factura", a.poComparison.thisInvoice], ["Queda", a.poComparison.remaining]].map(([k, v]) => (
                            <div key={k as string}>
                              <dt className="text-xs text-slate-500">{k}</dt>
                              <dd className={`mt-0.5 tabular-nums ${k === "Queda" && (v as number) < 0 ? "font-medium text-red-700" : "text-slate-900"}`}>{formatCurrency(v as number)}</dd>
                            </div>
                          ))}
                        </dl>
                        {a.poComparison.itemDiscrepancies.length > 0 && (
                          <div className="mt-3 border-t border-slate-100 pt-2.5">
                            <p className="text-xs text-slate-500">Líneas que superan su línea de la PO</p>
                            {a.poComparison.itemDiscrepancies.map((d, k) => (
                              <div key={k} className="mt-1 flex items-center justify-between gap-3 text-xs">
                                <span className="truncate text-slate-700">{d.description}</span>
                                <span className="flex-shrink-0 tabular-nums text-slate-500">{formatCurrency(d.poAmount)} en PO · <span className={d.difference > 0 ? "text-red-700" : "text-slate-900"}>{d.difference > 0 ? "+" : ""}{formatCurrency(d.difference)}</span></span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Section>
                  )}

                  {/* Proveedor */}
                  {a.supplierStats && (
                    <Section title={a.supplier} aside={a.supplierId ? <Link href={`/project/${id}/accounting/suppliers/${a.supplierId}`} className="inline-flex items-center gap-1 hover:text-slate-900">Ficha <ExternalLink size={11} /></Link> : undefined}>
                      <dl className="grid grid-cols-3 gap-3 px-4 py-3 text-[13px]">
                        <div><dt className="text-xs text-slate-500">Facturado</dt><dd className="mt-0.5 tabular-nums text-slate-900">{formatCurrency(a.supplierStats.invoicedBase)}</dd></div>
                        <div><dt className="text-xs text-slate-500">Pendiente de pago</dt><dd className="mt-0.5 tabular-nums text-slate-900">{formatCurrency(a.supplierStats.pendingAmount)}</dd></div>
                        <div><dt className="text-xs text-slate-500">POs abiertas</dt><dd className="mt-0.5 tabular-nums text-slate-900">{a.supplierStats.openPOs} <span className="text-xs text-slate-500">de {a.supplierStats.totalPOs}</span></dd></div>
                      </dl>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                        {a.supplierStats.taxId && <span>NIF <span className="font-mono text-slate-700">{a.supplierStats.taxId}</span></span>}
                        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${a.supplierStats.certState === "verified" ? "bg-emerald-500" : "bg-amber-500"}`} />{a.supplierStats.certState === "verified" ? "IBAN verificado" : a.supplierStats.certState === "noiban" ? "Sin IBAN" : "IBAN sin certificado verificado"}</span>
                        {a.supplierStats.lastTransaction && <span>Último movimiento {formatDate(a.supplierStats.lastTransaction)}</span>}
                      </div>
                    </Section>
                  )}
                </div>

                {/* Actividad */}
                <Section title="Actividad" aside={`${a.timeline.length}`}>
                  <ol className="px-4 py-3">
                    {a.timeline.map((ev, k) => (
                      <li key={ev.id} className="relative flex gap-3 pb-3 last:pb-0">
                        {k < a.timeline.length - 1 && <span aria-hidden="true" className="absolute left-[3px] top-3 h-full w-px bg-slate-200" />}
                        <span className={`relative mt-[6px] h-[7px] w-[7px] flex-shrink-0 rounded-full ${ev.type === "approved" ? "bg-emerald-500" : ev.type === "rejected" ? "bg-red-500" : ev.type === "info_requested" ? "bg-amber-500" : "bg-slate-400"}`} />
                        <div className="min-w-0 flex-1 text-[13px]">
                          <p className="text-slate-900">
                            <span className="font-medium">{ev.userName}</span>
                            <span className="text-slate-600">{ev.type === "created" ? " lo envió" : ev.type === "approved" ? ` aprobó${ev.stepOrder ? ` el nivel ${ev.stepOrder}` : ""}` : ev.type === "rejected" ? " lo rechazó" : ev.type === "info_requested" ? " pidió información" : " comentó"}</span>
                            <span className="ml-2 text-xs text-slate-500">{formatDateTime(ev.date)}</span>
                          </p>
                          {ev.comment && <p className="mt-1 rounded-md bg-[#F7F7F8] px-2.5 py-1.5 text-slate-700">{ev.comment}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </Section>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={showApprovalModal && !!selectedApproval}
        onClose={() => { setShowApprovalModal(false); setSelectedApproval(null); }}
        title={`Aprobar ${selectedApproval?.displayNumber || ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowApprovalModal(false); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="primary" onClick={() => selectedApproval && handleApprove(selectedApproval)} disabled={processing} autoFocus><Check size={14} /> Aprobar</Button>
          </>
        }
      >
        {selectedApproval && (
          <div className="text-[13px]">
            <p className="text-slate-900">{selectedApproval.supplier} · <span className="tabular-nums">{formatCurrency(selectedApproval.baseAmount, selectedApproval.currency)}</span> <span className="text-slate-500">base</span></p>
            <p className="mt-1 text-slate-500">{(() => {
              const steps = selectedApproval.approvalSteps.filter((x) => (x as any).status !== "skipped");
              const last = steps.length && selectedApproval.approvalSteps[selectedApproval.currentApprovalStep] === steps[steps.length - 1];
              return last ? (selectedApproval.type === "po" ? "Es el último nivel: la PO queda aprobada y compromete presupuesto." : "Es el último nivel: queda aprobado.") : "Pasa al siguiente nivel del circuito.";
            })()}</p>
            {worstOf(selectedApproval) && <p className="mt-2 text-amber-800">Hay {worstOf(selectedApproval) === "fail" ? "comprobaciones que fallan" : "avisos"}: revísalos antes de aprobar.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={showRejectionModal && !!selectedApproval}
        onClose={() => { setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null); }}
        title={`Rechazar ${selectedApproval?.displayNumber || ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowRejectionModal(false); setRejectionReason(""); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="danger" onClick={handleReject} disabled={processing || !rejectionReason.trim()}>Rechazar</Button>
          </>
        }
      >
        <Field label="Motivo"><Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={4} autoFocus placeholder="Lo verá quien lo envió" /></Field>
      </Modal>

      <Modal
        open={showInfoRequestModal && !!selectedApproval}
        onClose={() => { setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null); }}
        title={`Pedir información · ${selectedApproval?.displayNumber || ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowInfoRequestModal(false); setInfoRequestMessage(""); setSelectedApproval(null); }}>Cancelar</Button>
            <Button variant="primary" onClick={handleRequestInfo} disabled={processing || !infoRequestMessage.trim()}><Send size={14} /> Enviar</Button>
          </>
        }
      >
        <Field label="¿Qué necesitas saber?"><Textarea value={infoRequestMessage} onChange={(e) => setInfoRequestMessage(e.target.value)} rows={4} autoFocus /></Field>
      </Modal>
    </Page>
  );
}
