"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Banknote,
  FileText,
  FolderDown,
  Plus,
  Receipt,
  Settings,
  Upload,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { PROJECT_ROLES } from "@/hooks/useAccountingPermissions";
import { getInvoiceDisplayState } from "@/lib/invoiceHelpers";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface PO {
  id: string;
  number: string;
  supplier: string;
  description: string;
  baseAmount: number;
  status: "draft" | "pending" | "approved" | "rejected" | "closed" | "cancelled";
  createdAt: Date | null;
  department?: string;
  createdBy: string;
}

interface Invoice {
  id: string;
  number: string;
  displayNumber: string;
  documentType: string;
  supplier: string;
  description: string;
  baseAmount: number;
  status: string;
  dueDate: Date | null;
  createdAt: Date | null;
  department?: string;
  createdBy: string;
  codedAt?: Date | null;
  approvedAt?: Date | null;
  accountedAt?: Date | null;
  paidAt?: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AccountingPage() {
  const params = useParams();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [recentPOs, setRecentPOs] = useState<PO[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState("");
  const [userDepartment, setUserDepartment] = useState("");
  const [userPosition, setUserPosition] = useState("");
  const [accountingAccessLevel, setAccountingAccessLevel] = useState<string>("");
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [isApprover, setIsApprover] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => { if (user) setUserId(user.uid); });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadProjectData = async () => {
      if (!userId || !id) return;
      try {
        const projectDoc = await getDoc(doc(db, "projects", id));
        if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

        const memberDoc = await getDoc(doc(db, `projects/${id}/members`, userId));
        let currentUserRole = "";
        let currentUserDepartment = "";
        let currentUserPosition = "";
        if (memberDoc.exists()) {
          const memberData = memberDoc.data();
          currentUserRole = memberData.role || "";
          currentUserDepartment = memberData.department || "";
          currentUserPosition = memberData.position || "";
          setUserRole(currentUserRole);
          setUserDepartment(currentUserDepartment);
          setUserPosition(currentUserPosition);
          setAccountingAccessLevel(memberData.accountingAccessLevel || "user");
        }
        
        const isProjectRole = PROJECT_ROLES.includes(currentUserRole);
        const canViewAllPOs = isProjectRole;
        const canViewDepartmentPOs = !isProjectRole && (
          currentUserPosition === "HOD" ||
          currentUserPosition === "Coordinator"
        );
        const canViewOwnPOs = !isProjectRole && !canViewDepartmentPOs;

        let userIsApprover = false;
        
        const approvalConfigDoc = await getDoc(doc(db, `projects/${id}/config`, "approvals"));
        if (approvalConfigDoc.exists()) {
          const config = approvalConfigDoc.data();
          
          const checkStepForUser = (step: any): boolean => {
            if (!step) return false;
            if (step.approverType === "fixed" && step.approvers?.includes(userId)) return true;
            if (step.approverType === "role" && step.roles?.includes(currentUserRole)) return true;
            if (step.approverType === "hod") {
              const isHOD = currentUserPosition?.toLowerCase().includes("head") || 
                           currentUserPosition?.toLowerCase().includes("jefe") ||
                           currentUserRole === "HOD";
              if (isHOD && (!step.department || step.department === currentUserDepartment)) return true;
            }
            if (step.approverType === "coordinator") {
              const isCoordinator = currentUserPosition?.toLowerCase().includes("coordinator") || 
                                   currentUserPosition?.toLowerCase().includes("coordinador") ||
                                   currentUserRole === "Coordinator";
              if (isCoordinator && (!step.department || step.department === currentUserDepartment)) return true;
            }
            return false;
          };
          
          if (config.poApprovals) {
            for (const step of config.poApprovals) {
              if (checkStepForUser(step)) { userIsApprover = true; break; }
            }
          }
          if (!userIsApprover && config.invoiceApprovals) {
            for (const step of config.invoiceApprovals) {
              if (checkStepForUser(step)) { userIsApprover = true; break; }
            }
          }
        }
        
        setIsApprover(userIsApprover);

        const posRecentQuery = query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc"), limit(20));
        const posRecentSnapshot = await getDocs(posRecentQuery);
        const allPOs = posRecentSnapshot.docs.map(doc => {
          const data = doc.data();
          return { 
            id: doc.id, 
            number: data.number || "", 
            supplier: data.supplier || "", 
            description: data.generalDescription || data.description || "", 
            baseAmount: data.baseAmount || 0, 
            status: data.status || "draft", 
            createdAt: data.createdAt?.toDate() || null,
            department: data.department || "",
            createdBy: data.createdBy || "",
          };
        });
        
        const filteredPOs = allPOs.filter((po) => {
          if (canViewAllPOs) return true;
          if (canViewDepartmentPOs && po.department === currentUserDepartment) return true;
          if (canViewOwnPOs && po.createdBy === userId) return true;
          return false;
        }).slice(0, 5);
        setRecentPOs(filteredPOs);

        const invoicesRecentQuery = query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc"), limit(20));
        const invoicesRecentSnapshot = await getDocs(invoicesRecentQuery);
        const allInvoices = invoicesRecentSnapshot.docs.map(doc => {
          const data = doc.data();
          const docType = data.documentType || "invoice";
          const typePrefix = docType === "proforma" ? "PRF" : docType === "budget" ? "PRS" : docType === "guarantee" ? "FNZ" : "FRA";
          return { 
            id: doc.id, 
            number: data.number || "", 
            displayNumber: data.displayNumber || `${typePrefix}-${data.number}`,
            documentType: docType,
            supplier: data.supplier || "", 
            description: data.description || "", 
            baseAmount: data.baseAmount || 0, 
            status: data.status || "pending", 
            createdAt: data.createdAt?.toDate() || null,
            dueDate: data.dueDate?.toDate() || null,
            department: data.department || "",
            createdBy: data.createdBy || "",
            codedAt: data.codedAt?.toDate() || null,
            approvedAt: data.approvedAt?.toDate() || null,
            accountedAt: data.accountedAt?.toDate() || null,
            paidAt: data.paidAt?.toDate() || null,
          };
        });
        
        const filteredInvoices = allInvoices.filter((inv) => {
          if (canViewAllPOs) return true;
          if (canViewDepartmentPOs && inv.department === currentUserDepartment) return true;
          if (canViewOwnPOs && inv.createdBy === userId) return true;
          return false;
        }).slice(0, 5);
        setRecentInvoices(filteredInvoices);
      } catch (error) {
        console.error("Error cargando datos:", error);
      } finally {
        setLoading(false);
      }
    };
    loadProjectData();
  }, [id, userId]);

  useEffect(() => {
    if (!id || !userId) return;

    let poCount = 0;
    let invCount = 0;
    const updateTotal = () => setPendingApprovalsCount(poCount + invCount);

    const poUnsub = onSnapshot(
      query(collection(db, `projects/${id}/pos`), where("status", "==", "pending")),
      (snap) => {
        poCount = 0;
        snap.forEach((d) => {
          const data = d.data();
          if (data.approvalSteps && data.currentApprovalStep !== undefined) {
            const step = data.approvalSteps[data.currentApprovalStep];
            if (step?.approvers?.includes(userId)) poCount++;
          }
        });
        updateTotal();
      }
    );

    const invUnsub = onSnapshot(
      query(collection(db, `projects/${id}/invoices`), where("status", "in", ["submitted", "pending_approval"])),
      (snap) => {
        invCount = 0;
        snap.forEach((d) => {
          const data = d.data();
          // Solo pendientes de aprobar (sin track de aprobación).
          if (data.approvedAt) return;
          if (data.approvalSteps && data.currentApprovalStep !== undefined) {
            const step = data.approvalSteps[data.currentApprovalStep];
            if (step?.approvers?.includes(userId)) invCount++;
          }
        });
        updateTotal();
      }
    );

    return () => {
      poUnsub();
      invUnsub();
    };
  }, [id, userId]);

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Borrador" },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente" },
      approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada" },
      rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
      closed: { bg: "bg-blue-50", text: "text-blue-700", label: "Cerrada" },
      cancelled: { bg: "bg-red-100", text: "text-red-800", label: "Anulada" },
      pending_approval: { bg: "bg-purple-50", text: "text-purple-700", label: "Pend. aprob." },
    };
    const c = config[status] || config.pending;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text} ${status === "cancelled" ? "line-through" : ""}`}>
        {status === "cancelled" && <span className="font-bold not-italic">✕</span>}
        {c.label}
      </span>
    );
  };

  const getInvoiceBadge = (invoice: any) => {
    const state = getInvoiceDisplayState(invoice);
    const config: Record<string, { bg: string; text: string; label: string; icon?: string }> = {
      draft:           { bg: "bg-slate-100",   text: "text-slate-600",  label: "Borrador" },
      submitted:       { bg: "bg-purple-50",   text: "text-purple-700", label: "En sistema" },
      approved:        { bg: "bg-emerald-50",  text: "text-emerald-700",label: "Aprobada" },
      coded:           { bg: "bg-violet-50",   text: "text-violet-700", label: "Codificada" },
      accounted:       { bg: "bg-teal-50",     text: "text-teal-700",   label: "Contabilizada" },
      paid:            { bg: "bg-blue-50",     text: "text-blue-700",   label: "Pagada", icon: "💲" },
      overdue:         { bg: "bg-red-50",      text: "text-red-700",    label: "Vencida" },
      cancelled:       { bg: "bg-red-100",     text: "text-red-800",    label: "Anulada" },
      void:            { bg: "bg-red-100",     text: "text-red-800",    label: "Anulada" },
      rejected:        { bg: "bg-red-50",      text: "text-red-700",    label: "Rechazada" },
      returned:        { bg: "bg-teal-50",     text: "text-teal-700",   label: "Devuelta" },
      partial_return:  { bg: "bg-cyan-50",     text: "text-cyan-700",   label: "Dev. parcial" },
    };
    const c = config[state] || config.submitted;
    const struck = state === "cancelled" || state === "void";
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text} ${struck ? "line-through" : ""}`}>
        {c.icon && <span className="text-[10px]">{c.icon}</span>}
        {struck && <span className="font-bold not-italic">✕</span>}
        {c.label}
      </span>
    );
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  const hasExtendedAccess = accountingAccessLevel === "accounting_extended";

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-6">
          <div className="relative flex items-center justify-center">
            <h1 className="text-3xl font-bold text-slate-900 text-center">Panel de contabilidad</h1>

            {/* Iconos top-right */}
            <div className="absolute right-0 flex items-center gap-1">
              {isApprover && (
                <Link
                  href={`/project/${id}/accounting/approvals`}
                  className="relative p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                  title="Aprobaciones"
                >
                  <ClipboardCheck size={18} />
                  {pendingApprovalsCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full" />
                  )}
                </Link>
              )}
              {(userRole === "EP" || userRole === "PM" || userRole === "Controller") && (
                <>
                  <Link
                    href={`/project/${id}/accounting/document-center`}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                    title="Documentos"
                  >
                    <FolderDown size={18} />
                  </Link>
                  <Link
                    href={`/project/${id}/accounting/config`}
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                    title="Configuración"
                  >
                    <Settings size={18} />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="px-24 py-8">
        {/* Pending Approvals Alert */}
        {pendingApprovalsCount > 0 && (
          <Link href={`/project/${id}/accounting/approvals`}>
            <div className="mb-8 bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-5 cursor-pointer hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                    <Clock size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">{pendingApprovalsCount} {pendingApprovalsCount === 1 ? "documento pendiente" : "documentos pendientes"} de tu aprobación</h3>
                    <p className="text-white/80 text-sm">Revisa y aprueba para continuar el flujo</p>
                  </div>
                </div>
                <ArrowRight size={24} className="text-white/80" />
              </div>
            </div>
          </Link>
        )}

        {/* Recent Activity */}
        <div className="flex flex-row gap-6 items-start">
          {/* Recent POs */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex-1 max-w-[50%]">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileText size={18} style={{ color: '#2F52E0' }} />
                <h3 className="font-semibold text-slate-900">POs</h3>
                <span className="text-xs text-slate-400">recientes</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Link 
                  href={`/project/${id}/accounting/pos/new`} 
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <Plus size={16} />
                </Link>
                <Link 
                  href={`/project/${id}/accounting/pos`} 
                  className="text-xs font-medium flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  Ver todas <ChevronRight size={12} />
                </Link>
              </div>
            </div>

            <div className="p-5">
              {recentPOs.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <FileText size={24} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">Sin órdenes de compra</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentPOs.map((po) => (
                    <Link key={po.id} href={`/project/${id}/accounting/pos/${po.id}`} className="block">
                      <div className={`flex items-center justify-between px-3 py-3 rounded-xl transition-colors cursor-pointer group border ${po.status === "cancelled" ? "bg-red-50/40 border-red-100 opacity-60 hover:opacity-80" : "bg-slate-50 hover:bg-slate-100 border-transparent hover:border-slate-200"}`}>
                        <div className="flex-1 min-w-0 mr-3">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-sm font-semibold font-mono ${po.status === "cancelled" ? "line-through text-slate-400" : "text-slate-900"}`}>PO-{po.number}</span>
                            <span className="text-slate-300">/</span>
                            <span className="text-sm font-medium text-slate-700 truncate">{po.supplier || "Sin proveedor"}</span>
                          </div>
                          {po.description && (
                            <p className="text-xs text-slate-500 truncate">{po.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-semibold text-slate-900">{formatCurrency(po.baseAmount)} €</p>
                            {getStatusBadge(po.status)}
                          </div>
                          <ChevronRight size={16} className="text-slate-300 group-hover:text-[#2F52E0] transition-colors" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Invoices */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex-1 max-w-[50%]">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Receipt size={18} style={{ color: '#2F52E0' }} />
                <h3 className="font-semibold text-slate-900">Facturas</h3>
                <span className="text-xs text-slate-400">recientes</span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasExtendedAccess && (
                  <Link 
                    href={`/project/${id}/accounting/payments`} 
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" 
                    title="Pagos"
                  >
                    <Banknote size={16} />
                  </Link>
                )}
                <Link 
                  href={`/project/${id}/accounting/invoices/new`} 
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  <Upload size={16} />
                </Link>
                <Link 
                  href={`/project/${id}/accounting/invoices`} 
                  className="text-xs font-medium flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  Ver todas <ChevronRight size={12} />
                </Link>
              </div>
            </div>

            <div className="p-5">
              {recentInvoices.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Receipt size={24} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">Sin facturas</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentInvoices.map((invoice) => {
                    const isOverdue = getInvoiceDisplayState(invoice) === "overdue";
                    return (
                      <Link key={invoice.id} href={`/project/${id}/accounting/invoices/${invoice.id}`} className="block">
                        <div className={`flex items-center justify-between px-3 py-3 rounded-xl transition-colors cursor-pointer group border ${["cancelled","void","rejected"].includes(invoice.status) ? "bg-red-50/40 border-red-100 opacity-60 hover:opacity-80" : "bg-slate-50 hover:bg-slate-100 border-transparent hover:border-slate-200"}`}>
                          <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-sm font-semibold font-mono ${["cancelled","void"].includes(invoice.status) ? "line-through text-slate-400" : "text-slate-900"}`}>{invoice.displayNumber}</span>
                              {isOverdue && <AlertCircle size={12} className="text-red-500" />}
                              <span className="text-slate-300">/</span>
                              <span className="text-sm font-medium text-slate-700 truncate">{invoice.supplier || "Sin proveedor"}</span>
                            </div>
                            {invoice.description && (
                              <p className="text-xs text-slate-500 truncate">{invoice.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-900">{formatCurrency(invoice.baseAmount)} €</p>
                              {getInvoiceBadge(invoice)}
                            </div>
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-[#2F52E0] transition-colors" />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
