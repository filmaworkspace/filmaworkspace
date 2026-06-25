"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { getInvoiceDisplayState } from "@/lib/invoiceHelpers";
import { IBANField } from "@/components/IBANField";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  CreditCard,
  Download,
  Edit,
  ExternalLink,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Lock,
  Mail,
  MapPin,
  Package,
  Phone,
  Receipt,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Certificate {
  expiryDate?: Date;
  uploaded: boolean;
  fileName?: string;
  verified?: boolean;
  verifiedByName?: string;
  verifiedAt?: Date;
}

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName: string;
  country: string;
  taxId: string;
  address: { street: string; number: string; city: string; province: string; postalCode: string };
  contact: { name: string; email: string; phone: string };
  paymentMethod: string;
  bankAccount: string;
  bic?: string;
  certificates: { bankOwnership: Certificate; contractorsCertificate: Certificate };
  createdAt: Date;
}

interface Invoice {
  id: string;
  number: string;
  description: string;
  baseAmount: number;
  totalAmount: number;
  status: string;
  issueDate: Date;
  dueDate?: Date;
  paidAt?: Date;
  department?: string;
  createdBy: string;
}

interface PO {
  id: string;
  number: string;
  description: string;
  baseAmount: number;
  status: string;
  createdAt: Date;
  department?: string;
  createdBy: string;
}

interface ProjectConfig {
  fiscalName: string;
  taxId: string;
  address: string;
  city: string;
  postalCode: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COUNTRIES: Record<string, string> = { ES: "España", FR: "Francia", DE: "Alemania", IT: "Italia", PT: "Portugal", UK: "Reino Unido", US: "Estados Unidos" };
const PAYMENT_METHODS: Record<string, string> = { transferencia: "Transferencia", tb30: "Transf. 30 días", tb60: "Transf. 60 días", tarjeta: "Tarjeta", efectivo: "Efectivo" };

// ─────────────────────────────────────────────────────────────────────────────

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const supplierId = params?.supplierId as string;

  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null);
  const [producerNames, setProducerNames] = useState<string[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userDepartment, setUserDepartment] = useState("");
  const [userPosition, setUserPosition] = useState("");
  const [canVerify, setCanVerify] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const [editingFiscal, setEditingFiscal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    address: { street: "", number: "", city: "", province: "", postalCode: "" },
    paymentMethod: "transferencia",
    bankAccount: "",
    bic: "",
  });
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeProjectData, setCloseProjectData] = useState({
    notes: "",
    signedLetterFile: null as File | null,
    signedLetterName: "",
  });
  const [supplierClosure, setSupplierClosure] = useState<{
    closedAt: Date;
    closedBy: string;
    closedByName: string;
    notes: string;
    signedLetterUrl?: string;
    signedLetterName?: string;
  } | null>(null);
  const [allSuppliers, setAllSuppliers] = useState<{ id: string; fiscalName: string; taxId: string }[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showSupplierSearch, setShowSupplierSearch] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserId(user.uid);
        setUserName(user.displayName || user.email || "Usuario");
        try {
          const memberDoc = await getDoc(doc(db, `projects/${projectId}/members`, user.uid));
          if (memberDoc.exists()) {
            const memberData = memberDoc.data();
            setCanVerify(memberData.accountingAccessLevel === "accounting_extended");
            setUserRole(memberData.role || "");
            setUserDepartment(memberData.department || "");
            setUserPosition(memberData.position || "");
          }
        } catch (e) { console.error(e); }
      }
    });
    return () => unsubscribe();
  }, [projectId]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".custom-dropdown")) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Cargar proyecto
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (projectDoc.exists()) {
        const projectData = projectDoc.data();
        setProjectName(projectData.name || "Proyecto");
        
        // Cargar nombres de productoras
        if (projectData.producers && projectData.producers.length > 0) {
          const producerNamesArr: string[] = [];
          for (const producerId of projectData.producers) {
            const producerDoc = await getDoc(doc(db, "producers", producerId));
            if (producerDoc.exists()) producerNamesArr.push(producerDoc.data().name);
          }
          setProducerNames(producerNamesArr);
        }
      }

      // Cargar config del proyecto (datos fiscales)
      const configDoc = await getDoc(doc(db, `projects/${projectId}/config`, "company"));
      if (configDoc.exists()) {
        const configData = configDoc.data();
        setProjectConfig({
          fiscalName: configData.fiscalName || "",
          taxId: configData.taxId || "",
          address: configData.address || "",
          city: configData.city || "",
          postalCode: configData.postalCode || "",
        });
      }

      // Cargar proveedor
      const supplierDoc = await getDoc(doc(db, `projects/${projectId}/suppliers`, supplierId));
      if (!supplierDoc.exists()) { setLoading(false); return; }

      const data = supplierDoc.data();
      setSupplier({
        id: supplierDoc.id,
        fiscalName: data.fiscalName || "",
        commercialName: data.commercialName || "",
        country: data.country || "ES",
        taxId: data.taxId || "",
        address: data.address || {},
        contact: data.contact || {},
        paymentMethod: data.paymentMethod || "transferencia",
        bankAccount: data.bankAccount || "",
        bic: data.bic || "",
        certificates: {
          bankOwnership: { ...data.certificates?.bankOwnership, expiryDate: data.certificates?.bankOwnership?.expiryDate?.toDate(), verifiedAt: data.certificates?.bankOwnership?.verifiedAt?.toDate() },
          contractorsCertificate: { ...data.certificates?.contractorsCertificate, expiryDate: data.certificates?.contractorsCertificate?.expiryDate?.toDate(), verifiedAt: data.certificates?.contractorsCertificate?.verifiedAt?.toDate() },
        },
        createdAt: data.createdAt?.toDate() || new Date(),
      });

      // Determinar permisos de visibilidad
      const isProjectRole = ["admin", "PM", "EP", "LP", "Coordinator", "Accounting"].includes(userRole);
      const canViewAllPOs = isProjectRole;
      const canViewDepartmentPOs = !isProjectRole && (
        userPosition?.toLowerCase().includes("head") || 
        userPosition?.toLowerCase().includes("jefe") ||
        userRole === "HOD"
      );
      const canViewOwnPOs = !isProjectRole && !canViewDepartmentPOs;

      // Cargar facturas
      const invSnap = await getDocs(query(
        collection(db, `projects/${projectId}/invoices`), 
        where("supplierId", "==", supplierId),
        orderBy("createdAt", "desc")
      ));
      const allInvoices = invSnap.docs.map(d => {
        const invData = d.data();
        return {
          id: d.id,
          number: invData.number || "",
          description: invData.description || "",
          baseAmount: invData.baseAmount || 0,
          totalAmount: invData.totalAmount || invData.baseAmount || 0,
          status: invData.status || "pending",
          issueDate: invData.issueDate?.toDate() || invData.createdAt?.toDate() || new Date(),
          dueDate: invData.dueDate?.toDate(),
          paidAt: invData.paidAt?.toDate(),
          codedAt: invData.codedAt?.toDate(),
          approvedAt: invData.approvedAt?.toDate(),
          accountedAt: invData.accountedAt?.toDate(),
          department: invData.department || "",
          createdBy: invData.createdBy || "",
        };
      });
      
      // Filtrar facturas según permisos y ordenar por fecha desc, descripción asc
      const filteredInvoices = allInvoices
        .filter((inv) => {
          if (canViewAllPOs) return true;
          if (canViewDepartmentPOs && inv.department === userDepartment) return true;
          if (canViewOwnPOs && inv.createdBy === userId) return true;
          return false;
        })
        .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime() || (a.description || "").localeCompare(b.description || ""));
      setInvoices(filteredInvoices);

      // Cargar POs
      const posSnap = await getDocs(query(
        collection(db, `projects/${projectId}/pos`), 
        where("supplierId", "==", supplierId),
        orderBy("createdAt", "desc")
      ));
      const allPOs = posSnap.docs.map(d => {
        const poData = d.data();
        return {
          id: d.id,
          number: poData.number || "",
          description: poData.generalDescription || poData.description || "",
          baseAmount: poData.baseAmount || 0,
          status: poData.status || "draft",
          createdAt: poData.createdAt?.toDate() || new Date(),
          department: poData.department || "",
          createdBy: poData.createdBy || "",
        };
      });
      
      // Filtrar POs según permisos
      const filteredPOs = allPOs.filter((po) => {
        if (canViewAllPOs) return true;
        if (canViewDepartmentPOs && po.department === userDepartment) return true;
        if (canViewOwnPOs && po.createdBy === userId) return true;
        return false;
      });
      setPos(filteredPOs);

      // Inicializar form de edición
      setEditForm({
        address: data.address || { street: "", number: "", city: "", province: "", postalCode: "" },
        paymentMethod: data.paymentMethod || "transferencia",
        bankAccount: formatIBAN(data.bankAccount || ""),
        bic: data.bic || "",
      });

      // Cargar datos de cierre si existen
      if (data.closure) {
        setSupplierClosure({
          closedAt: data.closure.closedAt?.toDate() || new Date(),
          closedBy: data.closure.closedBy || "",
          closedByName: data.closure.closedByName || "",
          notes: data.closure.notes || "",
          signedLetterUrl: data.closure.signedLetterUrl,
          signedLetterName: data.closure.signedLetterName,
        });
      } else {
        setSupplierClosure(null);
      }

      // Cargar todos los proveedores para el buscador
      const allSuppliersSnap = await getDocs(query(
        collection(db, `projects/${projectId}/suppliers`),
        orderBy("fiscalName", "asc")
      ));
      setAllSuppliers(allSuppliersSnap.docs.map(d => ({
        id: d.id,
        fiscalName: d.data().fiscalName || "",
        taxId: d.data().taxId || "",
      })));

    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, [userId, projectId, supplierId, userRole, userDepartment, userPosition]);

  useEffect(() => { if (userId && projectId && supplierId && userRole !== undefined) loadData(); }, [userId, projectId, supplierId, userRole, userDepartment, userPosition, loadData]);

  const handleVerify = async (certType: "bankOwnership" | "contractorsCertificate", verified: boolean) => {
    if (!supplier || !canVerify) return;
    try {
      const updates: any = { [`certificates.${certType}.verified`]: verified };
      if (verified) {
        updates[`certificates.${certType}.verifiedBy`] = userId;
        updates[`certificates.${certType}.verifiedByName`] = userName;
        updates[`certificates.${certType}.verifiedAt`] = Timestamp.now();
      } else {
        updates[`certificates.${certType}.verifiedBy`] = null;
        updates[`certificates.${certType}.verifiedByName`] = null;
        updates[`certificates.${certType}.verifiedAt`] = null;
      }
      await updateDoc(doc(db, `projects/${projectId}/suppliers`, supplierId), updates);
      setSuccessMessage(verified ? "Certificado verificado" : "Verificación eliminada");
      setTimeout(() => setSuccessMessage(""), 3000);
      await loadData();
    } catch (e: any) { setErrorMessage(e.message); }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDelete = async () => {
    if (invoices.length > 0 || pos.length > 0) { setErrorMessage("No se puede eliminar: tiene documentos asociados"); return; }
    openConfirm(
      "Eliminar proveedor",
      `¿Estás seguro de que quieres eliminar a ${supplier?.fiscalName}? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${projectId}/suppliers`, supplierId));
          router.push(`/project/${projectId}/accounting/suppliers`);
        } catch (e: any) { setErrorMessage(e.message); }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const handleSaveFiscal = async () => {
    if (!supplier) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/suppliers`, supplierId), {
        address: editForm.address,
        paymentMethod: editForm.paymentMethod,
        bankAccount: editForm.bankAccount.replace(/\s/g, ""),
        bic: editForm.bic.trim().toUpperCase(),
      });
      setSuccessMessage("Datos actualizados");
      setTimeout(() => setSuccessMessage(""), 3000);
      setEditingFiscal(false);
      await loadData();
    } catch (e: any) { 
      setErrorMessage(e.message); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleCloseProject = async () => {
    if (!supplier || hasPendingInvoices) return;
    setSaving(true);
    try {
      // En producción aquí se subiría el archivo a Storage
      // Por ahora guardamos solo los metadatos
      const closureData: any = {
        closedAt: Timestamp.now(),
        closedBy: userId,
        closedByName: userName,
        notes: closeProjectData.notes.trim(),
      };

      if (closeProjectData.signedLetterFile) {
        // Simular URL del archivo subido
        closureData.signedLetterName = closeProjectData.signedLetterFile.name;
        closureData.signedLetterUrl = `uploads/${projectId}/suppliers/${supplierId}/closure/${closeProjectData.signedLetterFile.name}`;
      }

      await updateDoc(doc(db, `projects/${projectId}/suppliers`, supplierId), {
        closure: closureData,
        status: "closed",
      });

      setSuccessMessage("Relación con proveedor cerrada correctamente");
      setTimeout(() => setSuccessMessage(""), 3000);
      setShowCloseModal(false);
      setCloseProjectData({ notes: "", signedLetterFile: null, signedLetterName: "" });
      await loadData();
    } catch (e: any) {
      setErrorMessage(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReopenProject = async () => {
    if (!supplier || !supplierClosure) return;
    openConfirm(
      "Reabrir relación con proveedor",
      "¿Reabrir la relación con este proveedor? Se eliminará el registro de cierre.",
      async () => {
        setConfirmDialog(null);
        setSaving(true);
        try {
          await updateDoc(doc(db, `projects/${projectId}/suppliers`, supplierId), {
            closure: null,
            status: "active",
          });
          setSuccessMessage("Relación reabierta");
          setTimeout(() => setSuccessMessage(""), 3000);
          await loadData();
        } catch (e: any) {
          setErrorMessage(e.message);
        } finally {
          setSaving(false);
        }
      },
      { confirmLabel: "Reabrir" }
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setSuccessMessage(`${label} copiado`);
    setTimeout(() => setSuccessMessage(""), 2000);
  };

  const formatIBAN = (iban: string) => iban.replace(/\s/g, "").toUpperCase().match(/.{1,4}/g)?.join(" ") || iban;
  
  // Calcula los dígitos de control del IBAN español
  const calculateSpanishIBANCheckDigits = (accountNumber: string): string => {
    const clean = accountNumber.replace(/\s/g, "");
    if (clean.length !== 20 || !/^\d{20}$/.test(clean)) return "";
    const numericString = clean + "142800";
    let remainder = 0;
    for (let i = 0; i < numericString.length; i++) {
      remainder = (remainder * 10 + parseInt(numericString[i])) % 97;
    }
    const checkDigits = (98 - remainder).toString().padStart(2, "0");
    return "ES" + checkDigits + clean;
  };

  const handleBankAccountChange = (value: string) => {
    let clean = value.replace(/\s/g, "").toUpperCase();
    // Si tiene exactamente 20 dígitos numéricos, calcular IBAN completo
    const withoutPrefix = clean.replace(/^ES\d{0,2}/, "");
    if (/^\d{20}$/.test(withoutPrefix)) {
      const fullIban = calculateSpanishIBANCheckDigits(withoutPrefix);
      if (fullIban) {
        setEditForm({ ...editForm, bankAccount: formatIBAN(fullIban) });
        return;
      }
    }
    // Si empieza con números, añadir ES
    if (/^\d/.test(clean)) {
      clean = "ES" + clean;
    }
    if (clean.length > 24) clean = clean.slice(0, 24);
    setEditForm({ ...editForm, bankAccount: formatIBAN(clean) });
  };

  const formatDate = (date?: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";
  const formatCurrency = (amount: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(amount);

  const getCertStatus = (cert: Certificate) => {
    if (!cert.uploaded) return { label: "No subido", color: "text-red-600", bg: "bg-red-50" };
    if (cert.verified) return { label: "Verificado", color: "text-emerald-600", bg: "bg-emerald-50" };
    if (cert.expiryDate && cert.expiryDate < new Date()) return { label: "Caducado", color: "text-red-600", bg: "bg-red-50" };
    if (cert.expiryDate && cert.expiryDate < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) return { label: "Por caducar", color: "text-amber-600", bg: "bg-amber-50" };
    return { label: "Válido", color: "text-emerald-600", bg: "bg-emerald-50" };
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Borrador" },
      submitted: { bg: "bg-purple-50", text: "text-purple-700", label: "En sistema" },
      pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente" },
      pending_approval: { bg: "bg-purple-50", text: "text-purple-700", label: "Pend. aprob." },
      approved: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada" },
      coded: { bg: "bg-violet-50", text: "text-violet-700", label: "Codificada" },
      accounted: { bg: "bg-teal-50", text: "text-teal-700", label: "Contabilizada" },
      paid: { bg: "bg-blue-50", text: "text-blue-700", label: "Pagada" },
      rejected: { bg: "bg-red-50", text: "text-red-700", label: "Rechazada" },
      closed: { bg: "bg-blue-50", text: "text-blue-700", label: "Cerrada" },
      cancelled: { bg: "bg-red-100", text: "text-red-800", label: "Anulada" },
      void: { bg: "bg-red-100", text: "text-red-800", label: "Anulada" },
      overdue: { bg: "bg-red-50", text: "text-red-700", label: "Vencida" },
    };
    const c = config[status] || config.submitted;
    return (
      <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-medium ${c.bg} ${c.text} ${status === "cancelled" ? "line-through" : ""}`}>
        {status === "cancelled" && <span className="font-bold">✕</span>}
        {c.label}
      </span>
    );
  };

  // Generar PDF de listado de facturas
  const generateInvoiceListPdf = async () => {
    const activeInvoices = invoices.filter(inv => !["cancelled","void"].includes(inv.status));
    if (!supplier || activeInvoices.length === 0) return;
    setGeneratingPdf("invoices");

    try {
      const { jsPDF } = await import('jspdf');
      const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

      const paidInvoices = activeInvoices.filter(inv => (inv.paidAt || inv.status === "paid"));
      const pendingInvoices = activeInvoices.filter(inv => (!inv.paidAt && inv.status !== "paid"));
      const totalBase = activeInvoices.reduce((s, inv) => s + inv.baseAmount, 0);
      const totalAmount = activeInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
      const totalPaid = paidInvoices.reduce((s, inv) => s + inv.totalAmount, 0);

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const cw = pageWidth - margin * 2;
      let y = margin;

      // ── CABECERA ──────────────────────────────────────────────
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, pageWidth, 38, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Listado de Facturas', margin, 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(`${projectName}  ·  ${supplier.fiscalName}  ·  ${supplier.taxId}`, margin, 27);
      doc.setTextColor(148, 163, 184);
      doc.text(today, pageWidth - margin, 27, { align: 'right' });
      y = 50;

      // ── RESUMEN 3 CAJAS ───────────────────────────────────────
      const boxW = (cw - 8) / 3;
      const boxes = [
        { label: 'TOTAL FACTURAS', value: `${activeInvoices.length}`, sub: `${paidInvoices.length} pagadas · ${pendingInvoices.length} pendientes` },
        { label: 'IMPORTE TOTAL', value: `${formatCurrency(totalAmount)} €`, sub: `Base: ${formatCurrency(totalBase)} €` },
        { label: 'TOTAL PAGADO', value: `${formatCurrency(totalPaid)} €`, sub: `${paidInvoices.length} de ${activeInvoices.length} facturas` },
      ];
      boxes.forEach((b, i) => {
        const bx = margin + i * (boxW + 4);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(bx, y, boxW, 26, 2, 2, 'FD');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(b.label, bx + 6, y + 8);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(b.value, bx + 6, y + 17);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(b.sub, bx + 6, y + 23);
      });
      y += 36;

      // ── TABLA ─────────────────────────────────────────────────
      // Columnas: Nº(28) Fecha(22) Descripción(60) Base(28) Total(28) Estado(22)
      const cols = { num: margin, date: margin+28, desc: margin+50, base: margin+115, total: margin+138, status: margin+161 };

      // Cabecera tabla
      doc.setFillColor(30, 41, 59);
      doc.rect(margin, y, cw, 9, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('Nº FACTURA', cols.num + 2, y + 6);
      doc.text('FECHA', cols.date, y + 6);
      doc.text('DESCRIPCIÓN', cols.desc, y + 6);
      doc.text('BASE', cols.base, y + 6, { align: 'right' });
      doc.text('TOTAL', cols.total, y + 6, { align: 'right' });
      doc.text('ESTADO', cols.status, y + 6);
      y += 9;

      // Filas
      activeInvoices.forEach((inv, idx) => {
        if (y > pageHeight - 35) { doc.addPage(); y = margin; }

        doc.setFillColor(idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
        doc.rect(margin, y, cw, 8, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, y + 8, margin + cw, y + 8);

        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.setFont('helvetica', 'bold');
        doc.text(inv.number || '-', cols.num + 2, y + 5.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(formatDate(inv.issueDate), cols.date, y + 5.5);
        doc.text((inv.description || '-').substring(0, 26), cols.desc, y + 5.5);
        doc.setTextColor(15, 23, 42);
        doc.text(formatCurrency(inv.baseAmount), cols.base, y + 5.5, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.text(formatCurrency(inv.totalAmount), cols.total, y + 5.5, { align: 'right' });

        const isPaid = inv.status === 'paid';
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(isPaid ? 22 : 146, isPaid ? 101 : 64, isPaid ? 52 : 14);
        doc.text(isPaid ? 'Pagada' : 'Pendiente', cols.status, y + 5.5);
        doc.setTextColor(15, 23, 42);
        y += 8;
      });

      // ── TOTALES ────────────────────────────────────────────────
      y += 4;
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, y, cw, 18, 2, 2, 'F');
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Base imponible total', margin + 6, y + 7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(`${formatCurrency(totalBase)} €`, margin + 6, y + 14);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('TOTAL FACTURAS', margin + cw / 2, y + 7, { align: 'center' });
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(`${formatCurrency(totalAmount)} €`, margin + cw / 2, y + 14, { align: 'center' });
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Total pagado', margin + cw - 6, y + 7, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(134, 239, 172);
      doc.text(`${formatCurrency(totalPaid)} €`, margin + cw - 6, y + 14, { align: 'right' });

      // ── FOOTER ─────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generado el ${today} · Filma Workspace · Pág. ${i}/${pageCount}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      doc.save(`facturas_${supplier.fiscalName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
      setSuccessMessage("Listado de facturas generado");
    } catch (error) {
      console.error(error);
      setErrorMessage("Error generando el documento");
    } finally {
      setGeneratingPdf(null);
      setShowActionsMenu(false);
    }
  };

  // Generar Carta de Fin de Proyecto en PDF
  const generateEndOfProjectLetter = async () => {
    if (!supplier) return;
    setGeneratingPdf("letter");

    try {
      const { jsPDF } = await import('jspdf');

      const paidInvoices = invoices.filter(inv => (inv.paidAt || inv.status === "paid"))
        .sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());
      const totalPaid = paidInvoices.reduce((s, inv) => s + inv.totalAmount, 0);
      const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 25;
      const cw = pageWidth - margin * 2;
      let y = margin;

      // ── MEMBRETE ──────────────────────────────────────────────
      // Banda superior sutil
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, pageWidth, 42, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(0, 42, pageWidth, 42);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(15, 23, 42);
      doc.text(projectConfig?.fiscalName || projectName, margin, y + 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      const memberInfo = [
        projectConfig?.taxId ? `CIF: ${projectConfig.taxId}` : null,
        projectConfig?.address ? `${projectConfig.address}${projectConfig.city ? `, ${projectConfig.city}` : ''}` : null,
      ].filter(Boolean).join('  ·  ');
      if (memberInfo) doc.text(memberInfo, margin, y + 18);

      // Fecha a la derecha
      doc.setTextColor(100, 116, 139);
      doc.text(today, pageWidth - margin, y + 10, { align: 'right' });

      y = 56;

      // ── DESTINATARIO ──────────────────────────────────────────
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text(supplier.fiscalName, margin, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(71, 85, 105);
      doc.text(supplier.taxId, margin, y);
      y += 5;
      if (supplier.address?.street) {
        doc.text(`${supplier.address.street}${supplier.address.number ? ` ${supplier.address.number}` : ''}`, margin, y);
        y += 5;
      }
      if (supplier.address?.city) {
        doc.text(`${supplier.address.postalCode || ''} ${supplier.address.city}`.trim(), margin, y);
        y += 5;
      }
      y += 14;

      // ── ASUNTO ────────────────────────────────────────────────
      doc.setDrawColor(47, 82, 224);
      doc.setLineWidth(0.8);
      doc.line(margin, y, margin + 3, y);
      doc.setLineWidth(0.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      const asuntoText = `Asunto: Certificado de cierre de relación comercial — "${projectName}"`;
      doc.text(asuntoText, margin + 6, y + 0.5, { maxWidth: cw - 6 });
      y += doc.splitTextToSize(asuntoText, cw - 6).length * 5.5 + 10;

      // ── CUERPO ────────────────────────────────────────────────
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(30, 41, 59);
      const productorText = producerNames.length > 0 ? `, producido por ${producerNames.join(" y ")}` : "";
      const p1 = `Por medio de la presente, ${projectConfig?.fiscalName || "la productora"} certifica que, con fecha de hoy, no existen facturas pendientes de pago correspondientes a los servicios prestados por ${supplier.fiscalName} en el marco del proyecto audiovisual "${projectName}"${productorText}.`;
      const lines1 = doc.splitTextToSize(p1, cw);
      doc.text(lines1, margin, y);
      y += lines1.length * 5.5 + 12;

      // ── CAJA VERIFICACIÓN ─────────────────────────────────────
      doc.setFillColor(240, 253, 244);
      doc.setDrawColor(34, 197, 94);
      doc.setLineWidth(0.4);
      doc.roundedRect(margin, y, cw, 22, 3, 3, 'FD');
      doc.setLineWidth(0.2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(22, 101, 52);
      doc.text('✓  Todas las facturas han sido íntegramente abonadas', margin + 7, y + 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(21, 128, 61);
      doc.text(`La relación comercial con ${supplier.commercialName || supplier.fiscalName} queda debidamente liquidada.`, margin + 7, y + 16);
      y += 32;

      // ── TABLA DE FACTURAS PAGADAS ─────────────────────────────
      if (paidInvoices.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text('A continuación se detalla el histórico de facturas abonadas:', margin, y);
        y += 8;

        // Cabecera tabla
        doc.setFillColor(30, 41, 59);
        doc.rect(margin, y, cw, 8, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('Nº FACTURA', margin + 3, y + 5.5);
        doc.text('FECHA EMISIÓN', margin + 35, y + 5.5);
        doc.text('CONCEPTO', margin + 68, y + 5.5);
        doc.text('IMPORTE', margin + 128, y + 5.5, { align: 'right' });
        doc.text('FECHA PAGO', margin + cw - 3, y + 5.5, { align: 'right' });
        y += 8;

        doc.setFont('helvetica', 'normal');
        paidInvoices.forEach((inv, idx) => {
          if (y > pageHeight - 45) { doc.addPage(); y = margin; }

          doc.setFillColor(idx % 2 === 0 ? 255 : 249, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
          doc.rect(margin, y, cw, 8, 'F');
          doc.setDrawColor(226, 232, 240);
          doc.line(margin, y + 8, margin + cw, y + 8);

          doc.setFontSize(8);
          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold');
          doc.text(inv.number || '-', margin + 3, y + 5.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(71, 85, 105);
          doc.text(formatDate(inv.issueDate), margin + 35, y + 5.5);
          doc.text((inv.description || '-').substring(0, 28), margin + 68, y + 5.5);
          doc.setTextColor(15, 23, 42);
          doc.setFont('helvetica', 'bold');
          doc.text(`${formatCurrency(inv.totalAmount)} €`, margin + 128, y + 5.5, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(22, 101, 52);
          doc.text(inv.paidAt ? formatDate(inv.paidAt) : '-', margin + cw - 3, y + 5.5, { align: 'right' });
          y += 8;
        });

        // Total
        doc.setFillColor(15, 23, 42);
        doc.rect(margin, y, cw, 9, 'F');
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('TOTAL ABONADO', margin + 3, y + 6);
        doc.setTextColor(134, 239, 172);
        doc.text(`${formatCurrency(totalPaid)} €`, margin + 128, y + 6, { align: 'right' });
        y += 20;
      }

      // ── PÁRRAFO FINAL ─────────────────────────────────────────
      if (y > pageHeight - 55) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      const pFinal = 'Se expide el presente certificado a petición del interesado y para los efectos que estime oportunos.';
      doc.text(pFinal, margin, y, { maxWidth: cw });
      y += 18;

      // ── FIRMA ─────────────────────────────────────────────────
      doc.text('Atentamente,', margin, y);
      y += 28;
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + 65, y);
      doc.setLineWidth(0.2);
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(projectConfig?.fiscalName || projectName, margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text('Departamento de Producción', margin, y);

      // ── FOOTER ────────────────────────────────────────────────
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'normal');
        doc.text(`Documento generado automáticamente · Filma Workspace · ${today}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }

      doc.save(`carta_fin_proyecto_${supplier.fiscalName.replace(/\s+/g, '_')}_${projectName.replace(/\s+/g, '_')}.pdf`);
      setSuccessMessage("Carta de fin de proyecto generada");
    } catch (error) {
      console.error(error);
      setErrorMessage("Error generando el documento");
    } finally {
      setGeneratingPdf(null);
      setShowActionsMenu(false);
    }
  };

  // Exportar datos a CSV
  const exportToCSV = () => {
    if (invoices.length === 0) return;
    
    const headers = ["Número", "Fecha", "Descripción", "Base", "Total", "Estado", "Fecha Pago"];
    const rows = invoices.map(inv => [
      inv.number,
      formatDate(inv.issueDate),
      inv.description || "",
      inv.baseAmount.toString(),
      inv.totalAmount.toString(),
      inv.status,
      inv.paidAt ? formatDate(inv.paidAt) : ""
    ]);
    
    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `facturas_${supplier?.fiscalName.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setSuccessMessage("CSV exportado");
    setShowActionsMenu(false);
  };

  // Enviar email al contacto
  const sendEmail = () => {
    if (!supplier?.contact?.email) return;
    const subject = encodeURIComponent(`Proyecto ${projectName} - ${supplier.fiscalName}`);
    window.open(`mailto:${supplier.contact.email}?subject=${subject}`, '_blank');
    setShowActionsMenu(false);
  };

  if (loading) return <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" /></div>;

  if (!supplier) return (
    <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
      <div className="text-center">
        <p className="text-slate-500 mb-4">Proveedor no encontrado</p>
        <Link href={`/project/${projectId}/accounting/suppliers`} className="text-slate-900 hover:underline">Volver a proveedores</Link>
      </div>
    </div>
  );

  const pendingInvoices = invoices.filter(inv => (!inv.paidAt && inv.status !== "paid") && !["cancelled","void"].includes(inv.status));
  const paidInvoices = invoices.filter(inv => (inv.paidAt || inv.status === "paid"));
  const hasPendingInvoices = pendingInvoices.length > 0;

  // Determinar estado general del proveedor
  const getSupplierStatus = () => {
    const bankCert = supplier.certificates.bankOwnership;
    const contrCert = supplier.certificates.contractorsCertificate;
    
    if (!bankCert.uploaded || !contrCert.uploaded) return { label: "Documentación incompleta", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" };
    if (bankCert.verified && contrCert.verified) return { label: "Verificado", color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" };
    
    const now = new Date();
    if ((bankCert.expiryDate && bankCert.expiryDate < now) || (contrCert.expiryDate && contrCert.expiryDate < now)) {
      return { label: "Certificados caducados", color: "text-red-600", bg: "bg-red-50", border: "border-red-200" };
    }
    
    return { label: "Documentación completa", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200" };
  };

  const supplierStatus = getSupplierStatus();

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 py-6">
          {/* Breadcrumb y acciones */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Link 
                href={`/project/${projectId}/accounting/suppliers`} 
                className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft size={16} />
                Proveedores
              </Link>
              
              {/* Buscador rápido de proveedores */}
              <div className="relative">
                <button
                  onClick={() => setShowSupplierSearch(!showSupplierSearch)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <Search size={14} />
                  <span>Buscar proveedores</span>
                </button>
                
                {showSupplierSearch && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => { setShowSupplierSearch(false); setSupplierSearch(""); }} />
                    <div className="absolute left-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-xl z-20 overflow-hidden">
                      <div className="p-2 border-b border-slate-100">
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={supplierSearch}
                            onChange={(e) => setSupplierSearch(e.target.value)}
                            placeholder="Buscar proveedor"
                            autoFocus
                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {allSuppliers
                          .filter(s => 
                            s.id !== supplierId && 
                            (s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) ||
                             s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()))
                          )
                          .slice(0, 8)
                          .map(s => (
                            <Link
                              key={s.id}
                              href={`/project/${projectId}/accounting/suppliers/${s.id}`}
                              onClick={() => { setShowSupplierSearch(false); setSupplierSearch(""); }}
                              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-900 truncate">{s.fiscalName}</p>
                                <p className="text-xs text-slate-500 font-mono">{s.taxId}</p>
                              </div>
                              <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                            </Link>
                          ))
                        }
                        {allSuppliers.filter(s => 
                          s.id !== supplierId && 
                          (s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) ||
                           s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()))
                        ).length === 0 && (
                          <div className="px-4 py-6 text-center">
                            <p className="text-sm text-slate-400">No hay otros proveedores</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Dropdown de exportación */}
              <div className="relative">
                <button 
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <Download size={16} />
                  Exportar
                  <ChevronDown size={14} className={`transition-transform ${showActionsMenu ? 'rotate-180' : ''}`} />
                </button>
                
                {showActionsMenu && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowActionsMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-20">
                      <button
                        onClick={generateInvoiceListPdf}
                        disabled={invoices.length === 0 || generatingPdf === "invoices"}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileText size={16} className="text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900">Listado de facturas</p>
                          <p className="text-xs text-slate-500">PDF con todas las facturas</p>
                        </div>
                      </button>
                      
                      <button
                        onClick={generateEndOfProjectLetter}
                        disabled={hasPendingInvoices || generatingPdf === "letter"}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <FileSpreadsheet size={16} className="text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900">Carta fin de proyecto</p>
                          <p className="text-xs text-slate-500">
                            {hasPendingInvoices ? "Requiere facturas pagadas" : "Certificado de cierre"}
                          </p>
                        </div>
                      </button>
                      
                      <div className="border-t border-slate-100 my-1" />
                      
                      <button
                        onClick={exportToCSV}
                        disabled={invoices.length === 0}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-slate-50 flex items-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Download size={16} className="text-slate-400" />
                        <div>
                          <p className="font-medium text-slate-900">Exportar CSV</p>
                          <p className="text-xs text-slate-500">Para Excel o Sheets</p>
                        </div>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button 
                onClick={handleDelete} 
                disabled={invoices.length > 0 || pos.length > 0} 
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed" 
                title="Eliminar"
              >
                <Trash2 size={18} />
              </button>

              {!supplierClosure && !hasPendingInvoices && (
                <button
                  onClick={() => setShowCloseModal(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  <Lock size={16} />
                  Cerrar
                </button>
              )}
            </div>
          </div>

          {/* Info principal del proveedor */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{supplier.fiscalName}</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="font-mono text-sm text-slate-500">{supplier.taxId}</span>
                {supplier.commercialName && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">{supplier.commercialName}</span>
                  </>
                )}
              </div>
            </div>
            
            {/* Badge de estado */}
            <div className={`px-3 py-1.5 rounded-xl text-xs font-medium ${supplierStatus.bg} ${supplierStatus.color} border ${supplierStatus.border} flex items-center gap-1.5`}>
              {supplierStatus.label === "Verificado" && <ShieldCheck size={14} />}
              {supplierStatus.label}
            </div>
          </div>
        </div>
      </div>

      <main className="px-24 py-8">
        {/* Banner de proveedor cerrado */}
        {supplierClosure && (
          <div className="mb-6 bg-slate-900 rounded-2xl p-5 text-white">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <FileCheck size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg mb-1">Relación cerrada</h3>
                  <p className="text-white/70 text-sm">
                    Cerrado el {formatDate(supplierClosure.closedAt)} por {supplierClosure.closedByName}
                  </p>
                  {supplierClosure.notes && (
                    <p className="text-white/80 text-sm mt-2 bg-white/10 rounded-lg px-3 py-2">
                      &ldquo;{supplierClosure.notes}&rdquo;
                    </p>
                  )}
                  {supplierClosure.signedLetterName && (
                    <div className="flex items-center gap-2 mt-3">
                      <FileText size={14} className="text-white/60" />
                      <span className="text-sm text-white/80">{supplierClosure.signedLetterName}</span>
                      <button className="text-xs text-white/60 hover:text-white underline">
                        Descargar
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={handleReopenProject}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
              >
                <RotateCcw size={14} />
                Reabrir
              </button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-6">
          {/* Columna izquierda - Datos y documentos */}
          <div className="col-span-2 space-y-6">
            {/* Datos fiscales y dirección - editable inline */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Datos fiscales</h2>
                {!editingFiscal ? (
                  <button
                    onClick={() => setEditingFiscal(true)}
                    className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                  >
                    <Edit size={14} />
                    Editar
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setEditingFiscal(false); setEditForm({ ...editForm, address: supplier.address, paymentMethod: supplier.paymentMethod, bankAccount: supplier.bankAccount, bic: supplier.bic || "" }); }}
                      className="text-xs text-slate-500 hover:text-slate-900"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveFiscal}
                      disabled={saving}
                      className="text-xs text-white bg-slate-900 hover:bg-slate-800 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                    >
                      {saving ? "Guardando..." : "Guardar"}
                    </button>
                  </div>
                )}
              </div>
              
              <div className="p-5">
                {!editingFiscal ? (
                  <div className="grid grid-cols-2 gap-6">
                    {/* Dirección */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Dirección fiscal</p>
                      {supplier.address?.street ? (
                        <div className="text-sm text-slate-700">
                          <p>{supplier.address.street} {supplier.address.number}</p>
                          <p>{supplier.address.postalCode} {supplier.address.city}</p>
                          {supplier.address.province && <p className="text-slate-500">{supplier.address.province}</p>}
                          <p className="text-slate-500 mt-1">{COUNTRIES[supplier.country] || supplier.country}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Sin dirección</p>
                      )}
                    </div>
                    
                    {/* Datos bancarios */}
                    <div>
                      <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Datos bancarios</p>
                      {supplier.bankAccount ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-sm font-medium text-slate-900">{formatIBAN(supplier.bankAccount)}</p>
                            <button 
                              onClick={() => copyToClipboard(supplier.bankAccount, "IBAN")}
                              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                              title="Copiar"
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                          {supplier.bic && (
                            <p className="font-mono text-xs text-slate-500 mt-1">BIC: {supplier.bic}</p>
                          )}
                          <p className="text-sm text-slate-500 mt-1">{PAYMENT_METHODS[supplier.paymentMethod]}</p>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Sin cuenta bancaria</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Form de edición */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Dirección fiscal</p>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={editForm.address.street}
                            onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, street: e.target.value } })}
                            placeholder="Calle"
                            className="col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                          <input
                            type="text"
                            value={editForm.address.number}
                            onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, number: e.target.value } })}
                            placeholder="Nº"
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={editForm.address.postalCode}
                            onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, postalCode: e.target.value } })}
                            placeholder="CP"
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                          <input
                            type="text"
                            value={editForm.address.city}
                            onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, city: e.target.value } })}
                            placeholder="Ciudad"
                            className="col-span-2 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          />
                        </div>
                        <input
                          type="text"
                          value={editForm.address.province}
                          onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, province: e.target.value } })}
                          placeholder="Provincia"
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </div>
                      
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400 uppercase tracking-wide">Datos bancarios</p>
                        <IBANField
                          iban={editForm.bankAccount}
                          bic={editForm.bic}
                          onIBANChange={(v) => setEditForm({ ...editForm, bankAccount: v })}
                          onBICChange={(v) => setEditForm({ ...editForm, bic: v })}
                          ibanClassName="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          bicClassName="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                          ibanPlaceholder="Pega 20 dígitos o IBAN completo"
                          bicPlaceholder="BIC/SWIFT"
                        />
                        <div className="relative custom-dropdown">
                          <button
                            type="button"
                            onClick={() => setOpenDropdown(openDropdown === "editPaymentMethod" ? null : "editPaymentMethod")}
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-left flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors"
                          >
                            <span className="text-slate-900 truncate">{PAYMENT_METHODS[editForm.paymentMethod as keyof typeof PAYMENT_METHODS] || editForm.paymentMethod}</span>
                            <ChevronDown size={14} className={`text-slate-400 flex-shrink-0 transition-transform ${openDropdown === "editPaymentMethod" ? "rotate-180" : ""}`} />
                          </button>
                          {openDropdown === "editPaymentMethod" && (
                            <div className="absolute z-30 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                              {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => { setEditForm({ ...editForm, paymentMethod: value }); setOpenDropdown(null); }}
                                  className={`w-full px-4 py-2 text-left text-sm transition-colors ${editForm.paymentMethod === value ? "bg-slate-100 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                                >
                                  {label as string}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Facturas */}
            {(() => {
              const activeInvoices = invoices.filter(inv => !["cancelled","void"].includes(inv.status));
              const paidCount = activeInvoices.filter(inv => (inv.paidAt || inv.status === "paid")).length;
              const totalBase = activeInvoices.reduce((s, inv) => s + inv.baseAmount, 0);
              return (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h2 className="font-semibold text-slate-900">Facturas</h2>
                      <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{activeInvoices.length}</span>
                      {paidCount > 0 && (
                        <span className="text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">{paidCount} pagadas</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {activeInvoices.length > 0 && (
                        <span className="text-xs text-slate-500 font-mono">{formatCurrency(totalBase)} €</span>
                      )}
                      {invoices.length > 0 && (
                        <Link
                          href={`/project/${projectId}/accounting/invoices?supplier=${supplierId}`}
                          className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                        >
                          Ver todas <ExternalLink size={12} />
                        </Link>
                      )}
                    </div>
                  </div>

                  {activeInvoices.length === 0 ? (
                    <div className="p-8 text-center">
                      <Receipt size={24} className="text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">Sin facturas registradas</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {activeInvoices.slice(0, 5).map(inv => (
                        <Link
                          key={inv.id}
                          href={`/project/${projectId}/accounting/invoices/${inv.id}`}
                          className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors group"
                        >
                          <div className="flex-1 min-w-0 mr-3">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-sm font-semibold text-slate-900">{inv.number}</span>
                              <span className="text-xs text-slate-400">{formatDate(inv.issueDate)}</span>
                            </div>
                            {inv.description && <p className="text-xs text-slate-500 truncate">{inv.description}</p>}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="font-mono text-sm font-semibold text-slate-900">{formatCurrency(inv.totalAmount)} €</span>
                            {getStatusBadge(getInvoiceDisplayState(inv))}
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500" />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* POs */}
            {pos.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold text-slate-900">Órdenes de compra</h2>
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{pos.length}</span>
                  </div>
                  <Link 
                    href={`/project/${projectId}/accounting/pos?supplier=${supplierId}`}
                    className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                  >
                    Ver todas <ExternalLink size={12} />
                  </Link>
                </div>
                <div className="divide-y divide-slate-100">
                  {pos.slice(0, 5).map(po => {
                    const isCancelled = po.status === "cancelled";
                    return (
                      <Link
                        key={po.id}
                        href={`/project/${projectId}/accounting/pos/${po.id}`}
                        className={`flex items-center justify-between px-5 py-3.5 transition-colors group ${isCancelled ? "bg-red-50/40 opacity-60 hover:opacity-80" : "hover:bg-slate-50"}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`font-mono text-sm font-semibold ${isCancelled ? "line-through text-slate-400" : "text-slate-900"}`}>PO-{po.number}</span>
                          <span className="text-sm text-slate-500 truncate max-w-[200px]">{po.description || "-"}</span>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`font-mono text-sm font-semibold ${isCancelled ? "line-through text-slate-400" : "text-slate-900"}`}>{formatCurrency(po.baseAmount)}</span>
                          {getStatusBadge(po.status)}
                          <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-500" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Columna derecha - Contacto y certificados */}
          <div className="space-y-6">
            {/* Contacto */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Contacto</h2>
              </div>
              <div className="p-5">
                {supplier.contact?.name ? (
                  <div className="space-y-4">
                    <div>
                      <p className="font-medium text-slate-900">{supplier.contact.name}</p>
                      <p className="text-xs text-slate-500">Contacto principal</p>
                    </div>
                    
                    {supplier.contact.email && (
                      <a 
                        href={`mailto:${supplier.contact.email}`}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group"
                      >
                        <Mail size={16} className="text-slate-400 group-hover:text-slate-600" />
                        <span className="text-sm text-slate-700 truncate">{supplier.contact.email}</span>
                      </a>
                    )}
                    
                    {supplier.contact.phone && (
                      <a 
                        href={`tel:${supplier.contact.phone}`}
                        className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors group"
                      >
                        <Phone size={16} className="text-slate-400 group-hover:text-slate-600" />
                        <span className="text-sm text-slate-700">{supplier.contact.phone}</span>
                      </a>
                    )}

                    {supplier.contact.email && (
                      <button
                        onClick={sendEmail}
                        className="w-full flex items-center justify-center gap-2 p-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Send size={16} />
                        Enviar email
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <User size={24} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">Sin contacto</p>
                  </div>
                )}
              </div>
            </div>

            {/* Certificados */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Certificados</h2>
              </div>
              <div className="p-5 space-y-4">
                {/* Titularidad bancaria */}
                <div className={`p-4 rounded-xl border ${supplier.certificates.bankOwnership.verified ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className={supplier.certificates.bankOwnership.verified ? 'text-emerald-600' : 'text-slate-400'} />
                      <p className="text-sm font-medium text-slate-900">Titularidad bancaria</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getCertStatus(supplier.certificates.bankOwnership).bg} ${getCertStatus(supplier.certificates.bankOwnership).color}`}>
                      {getCertStatus(supplier.certificates.bankOwnership).label}
                    </span>
                  </div>
                  
                  {supplier.certificates.bankOwnership.expiryDate && (
                    <p className="text-xs text-slate-500 mb-2">
                      Caduca: {formatDate(supplier.certificates.bankOwnership.expiryDate)}
                    </p>
                  )}
                  
                  {supplier.certificates.bankOwnership.verified && supplier.certificates.bankOwnership.verifiedByName && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1">
                      <ShieldCheck size={12} />
                      Verificado por {supplier.certificates.bankOwnership.verifiedByName}
                    </p>
                  )}
                  
                  {canVerify && supplier.certificates.bankOwnership.uploaded && (
                    <button 
                      onClick={() => handleVerify("bankOwnership", !supplier.certificates.bankOwnership.verified)} 
                      className="mt-3 text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                    >
                      {supplier.certificates.bankOwnership.verified ? "Quitar verificación" : "Marcar verificado"}
                    </button>
                  )}
                </div>

                {/* Certificado contratistas */}
                <div className={`p-4 rounded-xl border ${supplier.certificates.contractorsCertificate.verified ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className={supplier.certificates.contractorsCertificate.verified ? 'text-emerald-600' : 'text-slate-400'} />
                      <p className="text-sm font-medium text-slate-900">Cert. contratistas</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getCertStatus(supplier.certificates.contractorsCertificate).bg} ${getCertStatus(supplier.certificates.contractorsCertificate).color}`}>
                      {getCertStatus(supplier.certificates.contractorsCertificate).label}
                    </span>
                  </div>
                  
                  {supplier.certificates.contractorsCertificate.expiryDate && (
                    <p className="text-xs text-slate-500 mb-2">
                      Caduca: {formatDate(supplier.certificates.contractorsCertificate.expiryDate)}
                    </p>
                  )}
                  
                  {supplier.certificates.contractorsCertificate.verified && supplier.certificates.contractorsCertificate.verifiedByName && (
                    <p className="text-xs text-emerald-600 flex items-center gap-1">
                      <ShieldCheck size={12} />
                      Verificado por {supplier.certificates.contractorsCertificate.verifiedByName}
                    </p>
                  )}
                  
                  {canVerify && supplier.certificates.contractorsCertificate.uploaded && (
                    <button 
                      onClick={() => handleVerify("contractorsCertificate", !supplier.certificates.contractorsCertificate.verified)} 
                      className="mt-3 text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                    >
                      {supplier.certificates.contractorsCertificate.verified ? "Quitar verificación" : "Marcar verificado"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Footer info */}
            <div className="text-center text-xs text-slate-400 py-2">
              <p>Añadido {formatDate(supplier.createdAt)}</p>
            </div>
          </div>
        </div>
      </main>

      {/* Modal de cierre de proyecto */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="font-semibold text-slate-900">Cerrar relación con proveedor</h3>
                <p className="text-sm text-slate-500 mt-0.5">{supplier.fiscalName}</p>
              </div>
              <button 
                onClick={() => setShowCloseModal(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Info */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-emerald-900">Todas las facturas están pagadas</p>
                    <p className="text-xs text-emerald-700 mt-1">
                      {invoices.length} factura{invoices.length !== 1 ? "s" : ""} · {formatCurrency(invoices.reduce((sum, inv) => sum + inv.totalAmount, 0))} total
                    </p>
                  </div>
                </div>
              </div>

              {/* Paso 1: Descargar carta */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <p className="text-sm font-medium text-slate-900">Descargar carta de fin de proyecto</p>
                </div>
                <button
                  onClick={() => { generateEndOfProjectLetter(); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Download size={16} />
                  Descargar carta para firmar
                </button>
              </div>

              {/* Paso 2: Notas */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <p className="text-sm font-medium text-slate-900">Añadir nota (opcional)</p>
                </div>
                <textarea
                  value={closeProjectData.notes}
                  onChange={(e) => setCloseProjectData({ ...closeProjectData, notes: e.target.value })}
                  placeholder="Valoración del proveedor"
                  rows={3}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              {/* Paso 3: Subir carta firmada */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">3</span>
                  <p className="text-sm font-medium text-slate-900">Subir carta firmada (opcional)</p>
                </div>
                
                {!closeProjectData.signedLetterFile ? (
                  <label className="w-full flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors">
                    <Upload size={24} className="text-slate-400" />
                    <span className="text-sm text-slate-500">Arrastra o haz clic para subir</span>
                    <span className="text-xs text-slate-400">PDF, JPG o PNG</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setCloseProjectData({ 
                            ...closeProjectData, 
                            signedLetterFile: file,
                            signedLetterName: file.name 
                          });
                        }
                      }}
                    />
                  </label>
                ) : (
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <FileText size={18} className="text-slate-400" />
                      <span className="text-sm text-slate-700">{closeProjectData.signedLetterFile.name}</span>
                    </div>
                    <button
                      onClick={() => setCloseProjectData({ ...closeProjectData, signedLetterFile: null, signedLetterName: "" })}
                      className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 bg-slate-50 flex-shrink-0">
              <button
                onClick={() => setShowCloseModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCloseProject}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Lock size={16} />
                )}
                Cerrar relación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white animate-in slide-in-from-bottom-2">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
