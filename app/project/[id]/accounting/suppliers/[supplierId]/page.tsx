"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel, Button, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select, Textarea, buttonClass } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchCode, matchWords } from "@/lib/search";
import { getInvoiceDisplayState } from "@/lib/invoiceHelpers";
import { IBANField } from "@/components/IBANField";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { getScopedDocs, scopeFromMember, sortByTime } from "@/lib/accountingScope";
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
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit,
  ExternalLink,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Lock,
  Mail,
  Phone,
  Receipt,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  MoreHorizontal,
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
  const [docTab, setDocTab] = useState<"invoices" | "pos">("invoices");
  const [docSearch, setDocSearch] = useState("");
  const [docField, setDocField] = useState<"all" | "number" | "concept">("all");
  const [showSupplierSearch, setShowSupplierSearch] = useState(false);

  // Bloquea el scroll de la página de detrás mientras el modal de cierre o
  // el de confirmación están abiertos.
  useBodyScrollLock(showCloseModal || !!confirmDialog);

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

  useEffect(() => { if (userId && projectId && supplierId && userRole !== undefined) loadData(); }, [userId, projectId, supplierId, userRole, userDepartment, userPosition]);

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

  const loadData = async () => {
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
      // Misma lógica que las reglas de Firestore (lib/accountingScope)
      const meSnap = await getDoc(doc(db, `projects/${projectId}/members`, userId!));
      const scope = scopeFromMember(userId!, meSnap.exists() ? (meSnap.data() as any) : null);
      const canViewAllPOs = scope.all;
      const canViewDepartmentPOs = !scope.all && !!scope.department;
      const canViewOwnPOs = !scope.all;

      // Cargar facturas
      const invSnap = {
        docs: (await getScopedDocs(collection(db, `projects/${projectId}/invoices`), scope, [where("supplierId", "==", supplierId)]))
          .filter((d) => d.data().supplierId === supplierId),
      };
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
      const posSnap = {
        docs: sortByTime((await getScopedDocs(collection(db, `projects/${projectId}/pos`), scope, [where("supplierId", "==", supplierId)]))
          .filter((d) => d.data().supplierId === supplierId)),
      };
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
  };

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
  const formatCurrency = (amount: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as Intl.NumberFormatOptions).format(amount);

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

  if (loading) return <PageLoading />;

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

  // ── Documentos: búsqueda avanzada ─────────────────────────────────────────
  type DocField = "all" | "number" | "concept";
  const DOC_FIELDS: SearchField<DocField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Número o concepto" },
    { value: "number", label: "Número", placeholder: "Ej. FRA-0012 o 0003", mono: true },
    { value: "concept", label: "Concepto", placeholder: "Ej. alquiler cámara" },
  ];
  const docMatches = (number: string, concept: string) => {
    if (!docSearch.trim()) return true;
    if (docField === "number") return matchCode(docSearch, number);
    if (docField === "concept") return matchWords(docSearch, concept);
    return matchCode(docSearch, number) || matchWords(docSearch, concept);
  };
  const DOC_STATE: Record<string, { label: string; dot: string; text: string }> = {
    draft: { label: "Borrador", dot: "bg-slate-300", text: "text-slate-600" },
    pending: { label: "Pend. aprobación", dot: "bg-amber-500", text: "text-amber-800" },
    submitted: { label: "Pend. aprobación", dot: "bg-amber-500", text: "text-amber-800" },
    approved: { label: "Aprobada", dot: "bg-emerald-500", text: "text-emerald-800" },
    coded: { label: "Codificada", dot: "bg-violet-500", text: "text-violet-800" },
    accounted: { label: "Contabilizada", dot: "bg-teal-500", text: "text-teal-800" },
    paid: { label: "Pagada", dot: "bg-[#2F52E0]", text: "text-blue-800" },
    overdue: { label: "Vencida", dot: "bg-red-500", text: "text-red-700" },
    closed: { label: "Cerrada", dot: "bg-slate-400", text: "text-slate-600" },
    rejected: { label: "Rechazada", dot: "bg-red-500", text: "text-red-700" },
    cancelled: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500 line-through" },
    void: { label: "Anulada", dot: "bg-slate-300", text: "text-slate-500 line-through" },
    returned: { label: "Devuelta", dot: "bg-teal-500", text: "text-teal-800" },
    partial_return: { label: "Dev. parcial", dot: "bg-cyan-500", text: "text-cyan-800" },
  };
  const Dot = ({ state }: { state: string }) => {
    const s = DOC_STATE[state] || DOC_STATE.draft;
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${s.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
    );
  };
  const invoiceRows = invoices.filter((inv) => docMatches(inv.number, inv.description));
  const poRows = pos.filter((po) => docMatches(`PO-${po.number}`, po.description));
  const rowsBase = docTab === "invoices"
    ? invoiceRows.filter((i) => !["cancelled", "void"].includes(i.status)).reduce((s, i) => s + i.baseAmount, 0)
    : poRows.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.baseAmount, 0);

  const certRow = (key: "bankOwnership" | "contractorsCertificate", label: string) => {
    const cert = supplier.certificates[key];
    const st = getCertStatus(cert);
    const tone = !cert.uploaded || st.label.toLowerCase().includes("caduc") ? "text-red-700" : cert.verified ? "text-emerald-800" : "text-slate-600";
    return (
      <div className="flex flex-col gap-1 border-b border-slate-100 py-2.5 last:border-0">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate-900">{label}</span>
          <span className={`text-xs ${tone}`}>{st.label}</span>
        </div>
        {(cert.expiryDate || cert.verifiedByName || (canVerify && cert.uploaded)) && (
          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>
              {cert.expiryDate && <>Caduca {formatDate(cert.expiryDate)}</>}
              {cert.expiryDate && cert.verified && cert.verifiedByName && " · "}
              {cert.verified && cert.verifiedByName && <>Verificado por {cert.verifiedByName}</>}
            </span>
            {canVerify && cert.uploaded && (
              <button onClick={() => handleVerify(key, !cert.verified)} className="font-medium text-slate-900 hover:underline">
                {cert.verified ? "Quitar verificación" : "Verificar"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const otherSuppliers = allSuppliers.filter((s) => s.id !== supplierId && (matchWords(supplierSearch, s.fiscalName) || matchCode(supplierSearch, s.taxId)));
  const statusTone = supplierStatus.label === "Verificado" ? "bg-emerald-500" : supplierStatus.label.includes("caducados") ? "bg-red-500" : supplierStatus.label.includes("incompleta") ? "bg-amber-500" : "bg-slate-400";

  return (
    <Page>
      <div className="mb-3 flex items-center justify-between gap-3 text-[13px]">
        <Link href={`/project/${projectId}/accounting/suppliers`} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900">
          <ArrowLeft size={14} /> Proveedores
        </Link>
        <div className="relative">
          <button onClick={() => setShowSupplierSearch(!showSupplierSearch)} className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-900">
            <Search size={13} /> Ir a otro proveedor
          </button>
          {showSupplierSearch && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setShowSupplierSearch(false); setSupplierSearch(""); }} />
              <AnchoredPanel className="w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" align="right" gap={6}>
                <div className="border-b border-slate-100 p-2">
                  <Input value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)} placeholder="Nombre o NIF" autoFocus />
                </div>
                <div className="max-h-64 overflow-y-auto py-1">
                  {otherSuppliers.slice(0, 10).map((s) => (
                    <Link
                      key={s.id}
                      href={`/project/${projectId}/accounting/suppliers/${s.id}`}
                      onClick={() => { setShowSupplierSearch(false); setSupplierSearch(""); }}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-[#F4F4F5]"
                    >
                      <span className="truncate text-[13px]">{s.fiscalName}</span>
                      <span className="font-mono text-[11px] text-slate-500">{s.taxId}</span>
                    </Link>
                  ))}
                  {otherSuppliers.length === 0 && <p className="px-3 py-4 text-center text-xs text-slate-500">Sin resultados</p>}
                </div>
              </AnchoredPanel>
            </>
          )}
        </div>
      </div>

      <PageHeader
        title={
          <>
            <span className="truncate">{supplier.fiscalName}</span>
            {supplier.taxId && <span className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-600">{supplier.taxId}</span>}
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-slate-600">
              <span className={`h-1.5 w-1.5 rounded-full ${supplierClosure ? "bg-slate-300" : statusTone}`} />
              {supplierClosure ? "Relación cerrada" : supplierStatus.label}
            </span>
          </>
        }
        actions={
          <>
            <Menu trigger={(toggle) => <Button variant="secondary" onClick={toggle}><Download size={14} /> Exportar</Button>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); router.push(`/project/${projectId}/accounting/document-center?doc=sup-ext:${supplierId}`); }}>Extracto de facturas (documentación)</MenuItem>
                  <MenuItem onClick={() => { close(); if (!hasPendingInvoices) router.push(`/project/${projectId}/accounting/document-center?doc=sup-close:${supplierId}`); }}>
                    <span className={hasPendingInvoices ? "text-slate-400" : ""}>Certificado de cierre{hasPendingInvoices ? " · requiere todo pagado" : ""}</span>
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => { close(); exportToCSV(); }}>Facturas en CSV</MenuItem>
                </>
              )}
            </Menu>
            {!supplierClosure && !hasPendingInvoices && (
              <Button variant="secondary" onClick={() => setShowCloseModal(true)}><Lock size={14} /> Cerrar relación</Button>
            )}
            <Menu trigger={(toggle) => <IconButton label="Más acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); setEditingFiscal(true); }}>Editar datos fiscales</MenuItem>
                  {supplier.contact?.email && <MenuItem onClick={() => { close(); sendEmail(); }}>Enviar email</MenuItem>}
                  {invoices.length === 0 && pos.length === 0 && (
                    <>
                      <MenuSeparator />
                      <MenuItem danger onClick={() => { close(); handleDelete(); }}>Eliminar proveedor</MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
          </>
        }
      />

      {supplierClosure && (
        <div className="mt-6 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-[#FAFAFA] px-4 py-3 text-[13px]">
          <div className="flex flex-col gap-1">
            <span className="text-slate-900">Relación cerrada el {formatDate(supplierClosure.closedAt)} por {supplierClosure.closedByName}</span>
            {supplierClosure.notes && <span className="text-slate-600">“{supplierClosure.notes}”</span>}
            {supplierClosure.signedLetterName && <span className="text-xs text-slate-500">Carta firmada: {supplierClosure.signedLetterName}</span>}
          </div>
          <Button variant="ghost" size="sm" onClick={handleReopenProject} disabled={saving}><RotateCcw size={13} /> Reabrir</Button>
        </div>
      )}

      <div className="mt-6 grid items-start gap-8 text-[13px] xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Documentos ─────────────────────────────────────────────────── */}
        <section aria-label="Documentos" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SearchBar fields={DOC_FIELDS} field={docField} onField={setDocField} value={docSearch} onChange={setDocSearch} count={docTab === "invoices" ? invoiceRows.length : poRows.length} />
            <Segmented
              value={docTab}
              onChange={setDocTab}
              options={[
                { value: "invoices", label: `Facturas · ${invoices.length}` },
                { value: "pos", label: `POs · ${pos.length}` },
              ]}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            {(docTab === "invoices" ? invoiceRows : poRows).length === 0 ? (
              <p className="px-4 py-12 text-center text-slate-500">{docSearch ? "Sin resultados" : docTab === "invoices" ? "Sin facturas" : "Sin órdenes de compra"}</p>
            ) : (
              <table className="tbl w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                    <th scope="col" className="px-4 py-2 text-left font-medium">Nº</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Concepto</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Fecha</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{docTab === "invoices" ? "Total" : "Base"}</th>
                    <th scope="col" className="px-4 py-2 text-left font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {docTab === "invoices"
                    ? invoiceRows.map((inv) => (
                        <tr key={inv.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                          <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs font-medium">
                            <Link href={`/project/${projectId}/accounting/invoices/${inv.id}`} className="hover:underline">{inv.number}</Link>
                          </td>
                          <td className="max-w-[360px] truncate px-3 py-1.5 text-slate-700">{inv.description || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-500">{formatDate(inv.issueDate)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs">{formatCurrency(inv.totalAmount)}</td>
                          <td className="px-4 py-1.5"><Dot state={getInvoiceDisplayState(inv)} /></td>
                        </tr>
                      ))
                    : poRows.map((po) => (
                        <tr key={po.id} className="border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]">
                          <td className="whitespace-nowrap px-4 py-1.5 font-mono text-xs font-medium">
                            <Link href={`/project/${projectId}/accounting/pos/${po.id}`} className="hover:underline">PO-{po.number}</Link>
                          </td>
                          <td className="max-w-[360px] truncate px-3 py-1.5 text-slate-700">{po.description || "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-500">{formatDate(po.createdAt)}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs">{formatCurrency(po.baseAmount)}</td>
                          <td className="px-4 py-1.5"><Dot state={po.status} /></td>
                        </tr>
                      ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                    <td className="px-4 py-2 font-semibold" colSpan={3}>Total base</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatCurrency(rowsBase)}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/project/${projectId}/accounting/${docTab === "invoices" ? "invoices" : "pos"}?supplier=${supplierId}`} className="text-slate-600 hover:text-slate-900">Abrir en {docTab === "invoices" ? "Facturas" : "POs"} →</Link>
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </section>

        {/* ── Ficha ──────────────────────────────────────────────────────── */}
        <aside className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="fiscal-title" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 id="fiscal-title" className="text-xs font-medium text-slate-500">Datos fiscales</h2>
              <button onClick={() => setEditingFiscal(true)} className="text-xs font-medium text-slate-900 hover:underline">Editar</button>
            </div>
            <dl className="rounded-lg border border-slate-200 px-3.5">
              {[
                ["Nombre comercial", supplier.commercialName || "—"],
                ["País", COUNTRIES[supplier.country] || supplier.country || "—"],
                ["Dirección", supplier.address?.street ? [[supplier.address.street, supplier.address.number].filter(Boolean).join(" "), [supplier.address.postalCode, supplier.address.city].filter(Boolean).join(" "), supplier.address.province].filter(Boolean).join(", ") : "—"],
                ["Forma de pago", PAYMENT_METHODS[supplier.paymentMethod] || supplier.paymentMethod || "—"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-slate-900">{v}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-2">
                <dt className="text-slate-500">IBAN</dt>
                <dd className="flex items-center gap-1.5">
                  {supplier.bankAccount ? (
                    <>
                      <span className="font-mono text-xs">{formatIBAN(supplier.bankAccount)}</span>
                      <button onClick={() => copyToClipboard(supplier.bankAccount, "IBAN")} aria-label="Copiar IBAN" title="Copiar" className="text-slate-400 hover:text-slate-900"><Copy size={12} /></button>
                    </>
                  ) : "—"}
                </dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-2">
                <dt className="text-slate-500">BIC</dt>
                <dd className="font-mono text-xs">{supplier.bic || "—"}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="contact-title" className="flex flex-col gap-2">
            <h2 id="contact-title" className="text-xs font-medium text-slate-500">Contacto</h2>
            <dl className="rounded-lg border border-slate-200 px-3.5">
              <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-2">
                <dt className="text-slate-500">Nombre</dt>
                <dd>{supplier.contact?.name || "—"}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 border-b border-slate-100 py-2">
                <dt className="text-slate-500">Email</dt>
                <dd className="truncate">{supplier.contact?.email ? <a href={`mailto:${supplier.contact.email}`} className="hover:underline">{supplier.contact.email}</a> : "—"}</dd>
              </div>
              <div className="grid grid-cols-[110px_1fr] gap-3 py-2">
                <dt className="text-slate-500">Teléfono</dt>
                <dd>{supplier.contact?.phone ? <a href={`tel:${supplier.contact.phone}`} className="hover:underline">{supplier.contact.phone}</a> : "—"}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="certs-title" className="flex flex-col gap-2">
            <h2 id="certs-title" className="text-xs font-medium text-slate-500">Certificados</h2>
            <div className="rounded-lg border border-slate-200 px-3.5">
              {certRow("bankOwnership", "Titularidad bancaria")}
              {certRow("contractorsCertificate", "Contratistas (AEAT)")}
            </div>
          </section>

          <p className="text-xs text-slate-500">Alta {formatDate(supplier.createdAt)}</p>
        </aside>
      </div>

      {/* Edición de datos fiscales */}
      <Modal
        open={editingFiscal}
        onClose={() => { setEditingFiscal(false); setEditForm({ ...editForm, address: supplier.address, paymentMethod: supplier.paymentMethod, bankAccount: supplier.bankAccount, bic: supplier.bic || "" }); }}
        title="Datos fiscales"
        width="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEditingFiscal(false); setEditForm({ ...editForm, address: supplier.address, paymentMethod: supplier.paymentMethod, bankAccount: supplier.bankAccount, bic: supplier.bic || "" }); }}>Cancelar</Button>
            <Button variant="primary" onClick={handleSaveFiscal} disabled={saving}>Guardar</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <Field label="Calle"><Input value={editForm.address.street} onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, street: e.target.value } })} /></Field>
            <Field label="Número"><Input value={editForm.address.number} onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, number: e.target.value } })} /></Field>
          </div>
          <div className="grid grid-cols-[110px_1fr_1fr] gap-3">
            <Field label="CP"><Input value={editForm.address.postalCode} onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, postalCode: e.target.value } })} className="tabular-nums" /></Field>
            <Field label="Ciudad"><Input value={editForm.address.city} onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, city: e.target.value } })} /></Field>
            <Field label="Provincia"><Input value={editForm.address.province} onChange={(e) => setEditForm({ ...editForm, address: { ...editForm.address, province: e.target.value } })} /></Field>
          </div>
          <Field label="Forma de pago">
            <Select value={editForm.paymentMethod} onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}>
              {Object.entries(PAYMENT_METHODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600">IBAN y BIC</span>
            <IBANField
              iban={editForm.bankAccount}
              bic={editForm.bic}
              onIBANChange={(v) => setEditForm({ ...editForm, bankAccount: v })}
              onBICChange={(v) => setEditForm({ ...editForm, bic: v })}
              ibanClassName="h-8 w-full rounded-md border border-slate-200 px-2.5 tabular-nums text-[13px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
              bicClassName="h-8 w-full rounded-md border border-slate-200 px-2.5 font-mono text-[13px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10"
              ibanPlaceholder="20 dígitos o IBAN completo"
              bicPlaceholder="BIC/SWIFT"
            />
          </div>
        </div>
      </Modal>

      {/* Cerrar relación con el proveedor */}
      <Modal
        open={showCloseModal}
        onClose={() => setShowCloseModal(false)}
        title="Cerrar relación"
        width="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCloseModal(false)}>Cancelar</Button>
            <Button variant="primary" onClick={handleCloseProject} disabled={saving}><Lock size={14} /> Cerrar relación</Button>
          </>
        }
      >
        <ol className="flex flex-col gap-5 text-[13px]">
          <li className="text-slate-600">
            {invoices.length} {invoices.length === 1 ? "factura" : "facturas"} pagadas · <span className="tabular-nums text-slate-900">{formatCurrency(invoices.reduce((sum, inv) => sum + inv.totalAmount, 0))}</span>
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-500"><span className="tabular-nums">01</span> Carta de fin de proyecto</span>
            <Link href={`/project/${projectId}/accounting/document-center?doc=sup-close:${supplierId}`} target="_blank" className={buttonClass("secondary")}><FileText size={14} /> Abrir en documentación para firmar</Link>
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-500"><span className="tabular-nums">02</span> Nota (opcional)</span>
            <Textarea value={closeProjectData.notes} onChange={(e) => setCloseProjectData({ ...closeProjectData, notes: e.target.value })} rows={3} />
          </li>
          <li className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-500"><span className="tabular-nums">03</span> Carta firmada (opcional)</span>
            {!closeProjectData.signedLetterFile ? (
              <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-center hover:bg-[#FAFAFA]">
                <span className="text-[13px] text-slate-900">Elegir archivo</span>
                <span className="text-xs text-slate-500">PDF, JPG o PNG</span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setCloseProjectData({ ...closeProjectData, signedLetterFile: file, signedLetterName: file.name });
                  }}
                />
              </label>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                <span className="truncate">{closeProjectData.signedLetterFile.name}</span>
                <button onClick={() => setCloseProjectData({ ...closeProjectData, signedLetterFile: null, signedLetterName: "" })} aria-label="Quitar archivo" className="text-slate-400 hover:text-slate-900"><X size={14} /></button>
              </div>
            )}
          </li>
        </ol>
      </Modal>

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white animate-in slide-in-from-bottom-2">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>
    </Page>
  );
}
