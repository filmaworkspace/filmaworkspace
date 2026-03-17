"use client";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { doc, getDoc, collection, getDocs, updateDoc, query, orderBy, Timestamp, deleteField, arrayUnion } from "firebase/firestore";
import { Receipt, ArrowLeft, Building2, AlertCircle, Info, Upload, X, Plus, Trash2, Search, Calendar, Hash, FileText, CheckCircle, AlertTriangle, Send, Save, ShieldAlert, Lock, Percent, Euro, Layers, ChevronDown, Eye } from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";
import { getCostSettings, shouldRealizeInvoice } from "@/lib/budgetRules";
import { realizeInvoice, unrealizeInvoice, updatePOItemsInvoiced } from "@/lib/budgetOperations";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface EpisodeDistribution { episode: number; amount: number; percentage: number; }
interface InvoiceItem { id: string; description: string; poItemId?: string; poItemIndex?: number; isNewItem: boolean; subAccountId: string; subAccountCode: string; subAccountDescription: string; quantity: number; unitPrice: number; baseAmount: number; vatRate: number; vatAmount: number; irpfRate: number; irpfAmount: number; totalAmount: number; episodeAssignment?: "general" | "specific"; episodes?: EpisodeDistribution[]; }
interface SubAccount { id: string; code: string; description: string; budgeted: number; committed: number; actual: number; available: number; accountId: string; accountCode: string; accountDescription: string; }
interface Supplier { id: string; fiscalName: string; commercialName?: string; taxId: string; }
interface Member { userId: string; name?: string; email?: string; role?: string; department?: string; position?: string; }
interface ApprovalStep { id: string; order: number; approverType: "fixed" | "role" | "hod" | "coordinator"; approvers?: string[]; roles?: string[]; department?: string; requireAll: boolean; }
interface ApprovalStepStatus { id: string; order: number; approverType: "fixed" | "role" | "hod" | "coordinator"; approvers: string[]; approverNames: string[]; roles?: string[]; department?: string; approvedBy: string[]; rejectedBy: string[]; status: "pending" | "approved" | "rejected"; requireAll: boolean; }

const VAT_RATES = [0, 4, 10, 21];
const IRPF_RATES = [0, 1, 2, 7, 15, 19];

export default function EditInvoicePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const invoiceId = params?.invoiceId as string;
  const isAdminCorrection = searchParams.get("mode") === "correction";

  const { loading: permissionsLoading, permissions } = useAccountingPermissions(id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [originalInvoice, setOriginalInvoice] = useState<any>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDisplayNumber, setInvoiceDisplayNumber] = useState("");
  const [invoiceVersion, setInvoiceVersion] = useState(1);
  const [invoiceStatus, setInvoiceStatus] = useState("");

  const [formData, setFormData] = useState({ supplier: "", supplierName: "", department: "", description: "", dueDate: "", notes: "" });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [totals, setTotals] = useState({ baseAmount: 0, vatAmount: 0, irpfAmount: 0, totalAmount: 0 });
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [approvalConfig, setApprovalConfig] = useState<ApprovalStep[]>([]);
  const [projectEpisodes, setProjectEpisodes] = useState<number[]>([]);

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [existingFileUrl, setExistingFileUrl] = useState("");
  const [existingFileName, setExistingFileName] = useState("");

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [currentItemIndex, setCurrentItemIndex] = useState<number | null>(null);

  const [showEpisodeModal, setShowEpisodeModal] = useState(false);
  const [episodeItemIndex, setEpisodeItemIndex] = useState<number | null>(null);
  const [tempEpisodeDistribution, setTempEpisodeDistribution] = useState<EpisodeDistribution[]>([]);
  const [episodeDistributionMode, setEpisodeDistributionMode] = useState<"equal" | "amount">("equal");

  // Guardar items originales para calcular diferencias de presupuesto
  const [originalItems, setOriginalItems] = useState<InvoiceItem[]>([]);
  const [wasApproved, setWasApproved] = useState(false);

  useEffect(() => {
    if (id && invoiceId && !permissionsLoading) loadData();
  }, [id, invoiceId, permissionsLoading]);

  useEffect(() => { calculateTotals(); }, [items]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Cargar factura
      const invoiceDoc = await getDoc(doc(db, `projects/${id}/invoices`, invoiceId));
      if (!invoiceDoc.exists()) { router.push(`/project/${id}/accounting/invoices`); return; }
      
      const data = invoiceDoc.data();
      setOriginalInvoice(data);
      setInvoiceNumber(data.number || "");
      setInvoiceDisplayNumber(data.displayNumber || "");
      setInvoiceVersion(data.version || 1);
      setInvoiceStatus(data.status || "draft");
      setExistingFileUrl(data.attachmentUrl || "");
      setExistingFileName(data.attachmentFileName || "");
      
      // Verificar si estaba aprobada/realizada
      const wasRealizedBefore = ["pending", "approved", "paid"].includes(data.status);
      setWasApproved(wasRealizedBefore);

      setFormData({
        supplier: data.supplierId || "",
        supplierName: data.supplier || "",
        department: data.department || "",
        description: data.description || "",
        dueDate: data.dueDate?.toDate?.().toISOString().split("T")[0] || new Date().toISOString().split("T")[0],
        notes: data.notes || "",
      });

      const loadedItems = (data.items || []).map((item: any, idx: number) => ({
        id: item.id || String(idx + 1),
        description: item.description || "",
        poItemId: item.poItemId || undefined,
        poItemIndex: item.poItemIndex,
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
        episodeAssignment: item.episodeAssignment || "general",
        episodes: item.episodes || undefined,
      }));
      setItems(loadedItems);
      setOriginalItems(JSON.parse(JSON.stringify(loadedItems)));

      // Cargar proveedores
      const suppSnap = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName")));
      setSuppliers(suppSnap.docs.filter(d => !d.data().closure).map(d => ({ id: d.id, fiscalName: d.data().fiscalName || "", commercialName: d.data().commercialName, taxId: d.data().taxId || "" })));

      // Cargar subcuentas
      const accountsSnap = await getDocs(collection(db, `projects/${id}/accounts`));
      const allSubAccounts: SubAccount[] = [];
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subSnap = await getDocs(collection(db, `projects/${id}/accounts/${accDoc.id}/subaccounts`));
        subSnap.docs.forEach(subDoc => {
          const subData = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id, code: subData.code || "", description: subData.description || "",
            budgeted: subData.budgeted || 0, committed: subData.committed || 0, actual: subData.actual || 0,
            available: (subData.budgeted || 0) - (subData.actual || 0),
            accountId: accDoc.id, accountCode: accData.code || "", accountDescription: accData.description || "",
          });
        });
      }
      setSubAccounts(allSubAccounts.sort((a, b) => a.code.localeCompare(b.code)));

      // Cargar miembros
      const membersSnap = await getDocs(collection(db, `projects/${id}/members`));
      setMembers(membersSnap.docs.map(d => ({ userId: d.id, ...d.data() } as Member)));

      // Cargar configuración de aprobaciones
      const approvalDoc = await getDoc(doc(db, `projects/${id}/config`, "approvals"));
      if (approvalDoc.exists()) setApprovalConfig(approvalDoc.data().invoiceApprovals || []);

      // Cargar episodios
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) {
        const eps = projectDoc.data().episodes || 1;
        setProjectEpisodes(Array.from({ length: eps }, (_, i) => i + 1));
      }

    } catch (error) {
      console.error("Error loading invoice:", error);
    } finally {
      setLoading(false);
    }
  };

  const calculateItemTotal = (item: InvoiceItem) => {
    const base = item.quantity * item.unitPrice;
    const vat = base * (item.vatRate / 100);
    const irpf = base * (item.irpfRate / 100);
    return { baseAmount: base, vatAmount: vat, irpfAmount: irpf, totalAmount: base + vat - irpf };
  };

  const calculateTotals = () => {
    setTotals({
      baseAmount: items.reduce((s, i) => s + i.baseAmount, 0),
      vatAmount: items.reduce((s, i) => s + i.vatAmount, 0),
      irpfAmount: items.reduce((s, i) => s + i.irpfAmount, 0),
      totalAmount: items.reduce((s, i) => s + i.totalAmount, 0),
    });
  };

  const updateItem = (i: number, field: keyof InvoiceItem, value: any) => {
    const n = [...items];
    n[i] = { ...n[i], [field]: value, ...calculateItemTotal({ ...n[i], [field]: value }) };
    setItems(n);
    setTouched(p => ({ ...p, [`item_${i}_${field}`]: true }));
  };

  const addNewItem = () => {
    setItems([...items, {
      id: String(Date.now()), description: "", isNewItem: true, subAccountId: "", subAccountCode: "", subAccountDescription: "",
      quantity: 1, unitPrice: 0, baseAmount: 0, vatRate: 21, vatAmount: 0, irpfRate: 0, irpfAmount: 0, totalAmount: 0, episodeAssignment: "general",
    }]);
  };

  const removeItem = (i: number) => { if (items.length > 1) setItems(items.filter((_, idx) => idx !== i)); };

  const selectSupplier = (s: Supplier) => {
    setFormData({ ...formData, supplier: s.id, supplierName: s.fiscalName });
    setShowSupplierModal(false);
    setSupplierSearch("");
  };

  const selectAccount = (sub: SubAccount) => {
    if (currentItemIndex !== null) {
      const n = [...items];
      n[currentItemIndex] = { ...n[currentItemIndex], subAccountId: sub.id, subAccountCode: sub.code, subAccountDescription: sub.description };
      setItems(n);
    }
    setShowAccountModal(false);
    setAccountSearch("");
    setCurrentItemIndex(null);
  };

  // Episodios
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
      const newDist = [...tempEpisodeDistribution, { episode: episodeNum, amount: 0, percentage: 0 }].sort((a, b) => a.episode - b.episode);
      recalculateDistribution(newDist, item.baseAmount);
    }
  };

  const recalculateDistribution = (dist: EpisodeDistribution[], baseAmount: number) => {
    if (dist.length === 0) { setTempEpisodeDistribution([]); return; }
    if (episodeDistributionMode === "equal") {
      const pct = 100 / dist.length;
      const amt = baseAmount / dist.length;
      setTempEpisodeDistribution(dist.map(e => ({ ...e, percentage: pct, amount: amt })));
    } else {
      setTempEpisodeDistribution(dist);
    }
  };

  const updateEpisodeAmount = (episodeNum: number, amount: number) => {
    const item = episodeItemIndex !== null ? items[episodeItemIndex] : null;
    if (!item) return;
    const newDist = tempEpisodeDistribution.map(e => e.episode === episodeNum ? { ...e, amount, percentage: item.baseAmount > 0 ? (amount / item.baseAmount) * 100 : 0 } : e);
    setTempEpisodeDistribution(newDist);
  };

  const saveEpisodeDistribution = () => {
    if (episodeItemIndex === null) return;
    const n = [...items];
    if (tempEpisodeDistribution.length > 0) {
      n[episodeItemIndex] = { ...n[episodeItemIndex], episodeAssignment: "specific", episodes: tempEpisodeDistribution };
    } else {
      n[episodeItemIndex] = { ...n[episodeItemIndex], episodeAssignment: "general", episodes: undefined };
    }
    setItems(n);
    setShowEpisodeModal(false);
    setEpisodeItemIndex(null);
  };

  // Aprobaciones
  const resolveApprovers = (step: ApprovalStep, dept?: string): { ids: string[]; names: string[] } => {
    const ids: string[] = [];
    const names: string[] = [];
    if (step.approverType === "fixed" && step.approvers) {
      step.approvers.forEach(uid => {
        const m = members.find(mb => mb.userId === uid);
        if (m) { ids.push(uid); names.push(m.name || m.email || uid); }
      });
    } else if (step.approverType === "role" && step.roles) {
      members.filter(m => step.roles!.includes(m.role || "")).forEach(m => { ids.push(m.userId); names.push(m.name || m.email || m.userId); });
    } else if (step.approverType === "hod") {
      const targetDept = step.department || dept;
      members.filter(m => m.department === targetDept && (m.position?.toLowerCase().includes("head") || m.position?.toLowerCase().includes("jefe") || m.role === "HOD")).forEach(m => { ids.push(m.userId); names.push(m.name || m.email || m.userId); });
    }
    return { ids, names };
  };

  const generateApprovalSteps = (): ApprovalStepStatus[] => {
    if (approvalConfig.length === 0) return [];
    return approvalConfig.map(step => {
      const { ids, names } = resolveApprovers(step, formData.department);
      return { id: step.id || "", order: step.order || 0, approverType: step.approverType || "role", approvers: ids, approverNames: names, roles: step.roles || [], department: step.department || "", approvedBy: [], rejectedBy: [], status: "pending" as const, requireAll: step.requireAll ?? false };
    });
  };

  const shouldAutoApprove = (steps: ApprovalStepStatus[]) => steps.length === 0 || steps.every(s => s.approvers.length === 0);

  const validateForm = () => {
    if (!formData.supplier) { alert("Selecciona un proveedor"); return false; }
    if (!formData.description.trim()) { alert("Añade una descripción"); return false; }
    if (items.length === 0) { alert("Añade al menos un item"); return false; }
    for (let i = 0; i < items.length; i++) {
      if (!items[i].description.trim()) { alert(`Item ${i + 1}: falta descripción`); return false; }
      if (!items[i].subAccountId) { alert(`Item ${i + 1}: selecciona una cuenta`); return false; }
      if (items[i].baseAmount <= 0) { alert(`Item ${i + 1}: el importe debe ser mayor a 0`); return false; }
    }
    return true;
  };

  const handleSave = async (sendForApproval: boolean) => {
    if (sendForApproval && !validateForm()) return;

    setSaving(true);
    try {
      const costSettings = await getCostSettings(id);

      // Subir archivo si hay uno nuevo
      let fileUrl = existingFileUrl;
      let fileName = existingFileName;
      if (uploadedFile) {
        const fileRef = ref(storage, `projects/${id}/invoices/${invoiceDisplayNumber}/${uploadedFile.name}`);
        await uploadBytes(fileRef, uploadedFile);
        fileUrl = await getDownloadURL(fileRef);
        fileName = uploadedFile.name;
      }

      // Preparar items
      const itemsData = items.map(i => ({
        description: i.description?.trim() || "",
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
        ...(i.episodes && i.episodes.length > 0 ? { episodes: i.episodes } : {}),
      }));

      const updateData: Record<string, any> = {
        supplier: formData.supplierName || "",
        supplierId: formData.supplier || "",
        department: formData.department || "",
        description: formData.description?.trim() || "",
        notes: formData.notes?.trim() || "",
        items: itemsData,
        baseAmount: totals.baseAmount || 0,
        vatAmount: totals.vatAmount || 0,
        irpfAmount: totals.irpfAmount || 0,
        totalAmount: totals.totalAmount || 0,
        dueDate: Timestamp.fromDate(new Date(formData.dueDate || new Date())),
        updatedAt: Timestamp.now(),
        updatedBy: permissions.userId || "",
        updatedByName: permissions.userName || "",
      };

      // Solo añadir attachment si existe
      if (fileUrl) {
        updateData.attachmentUrl = fileUrl;
        updateData.attachmentFileName = fileName || "";
      }

      if (isAdminCorrection) {
        // Corrección administrativa: no crear nueva versión, solo auditar
        updateData.adminCorrectionHistory = arrayUnion({
          timestamp: Timestamp.now(),
          userId: permissions.userId || "",
          userName: permissions.userName || "",
          changes: "Corrección administrativa",
        });
      } else if (sendForApproval) {
        // Modificación normal: incrementar versión y reiniciar aprobaciones
        const newVersion = (invoiceVersion || 1) + 1;
        updateData.version = newVersion;

        // Guardar items anteriores si estaba realizada
        if (wasApproved && originalItems.length > 0) {
          updateData.previousRealizedItems = originalItems.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
        }

        const steps = generateApprovalSteps();
        if (shouldAutoApprove(steps)) {
          updateData.status = "pending";
          updateData.approvalStatus = "approved";
          updateData.autoApproved = true;
          updateData.approvedAt = Timestamp.now();
          updateData.approvedBy = permissions.userId || "";
          updateData.approvedByName = permissions.userName || "";
          // Limpiar campos anteriores
          updateData.approvalSteps = deleteField();
          updateData.currentApprovalStep = deleteField();
        } else {
          updateData.status = "pending_approval";
          updateData.approvalStatus = "pending";
          updateData.approvalSteps = steps;
          updateData.currentApprovalStep = 0;
          // Limpiar campos de aprobación anterior
          updateData.approvedAt = deleteField();
          updateData.approvedBy = deleteField();
          updateData.approvedByName = deleteField();
        }

        // Añadir al historial de modificaciones
        updateData.modificationHistory = arrayUnion({
          date: Timestamp.now(),
          userId: permissions.userId || "",
          userName: permissions.userName || "",
          previousVersion: invoiceVersion || 1,
        });
      } else {
        updateData.status = "draft";
      }

      await updateDoc(doc(db, `projects/${id}/invoices`, invoiceId), updateData);

      // Manejar presupuesto
      if (!isAdminCorrection && sendForApproval) {
        const finalStatus = updateData.status;
        
        // Si se auto-aprueba y había items anteriores, hacer diferencia
        if (finalStatus === "pending" && wasApproved && originalItems.length > 0) {
          // Desrealizar items anteriores
          const itemsToUnrealize = originalItems.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
          if (itemsToUnrealize.length > 0) {
            await unrealizeInvoice(id, itemsToUnrealize);
          }
          // Realizar nuevos items
          if (shouldRealizeInvoice(finalStatus, costSettings)) {
            const itemsToRealize = items.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
            if (itemsToRealize.length > 0) {
              await realizeInvoice(id, itemsToRealize);
            }
          }
        } else if (finalStatus === "pending" && !wasApproved) {
          // Nueva realización
          if (shouldRealizeInvoice(finalStatus, costSettings)) {
            const itemsToRealize = items.filter(i => i.subAccountId && i.baseAmount > 0).map(i => ({ subAccountId: i.subAccountId, baseAmount: i.baseAmount }));
            if (itemsToRealize.length > 0) {
              await realizeInvoice(id, itemsToRealize);
            }
          }
        }
      }

      setSuccessMessage(isAdminCorrection ? "Corrección guardada" : sendForApproval ? "Factura enviada para aprobación" : "Borrador guardado");
      setTimeout(() => router.push(`/project/${id}/accounting/invoices/${invoiceId}`), 1500);
    } catch (error: any) {
      console.error("Error saving invoice:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (a: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0);

  const filteredSuppliers = suppliers.filter(s => s.fiscalName.toLowerCase().includes(supplierSearch.toLowerCase()) || s.taxId.toLowerCase().includes(supplierSearch.toLowerCase()));
  const filteredSubAccounts = subAccounts.filter(s => s.code.toLowerCase().includes(accountSearch.toLowerCase()) || s.description.toLowerCase().includes(accountSearch.toLowerCase()));

  if (permissionsLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (permissions.accountingAccessLevel !== "accounting_extended") {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">Solo contabilidad ampliada puede editar facturas.</p>
          <Link href={`/project/${id}/accounting/invoices/${invoiceId}`} className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="px-6 md:px-8 lg:px-12 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href={`/project/${id}/accounting/invoices/${invoiceId}`} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                <ArrowLeft size={20} className="text-slate-600" />
              </Link>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  {isAdminCorrection ? "Corrección administrativa" : "Editar"} {invoiceDisplayNumber}
                </h1>
                <p className="text-sm text-slate-500">
                  {isAdminCorrection ? "Los cambios no generarán nueva versión" : `Versión actual: ${invoiceVersion}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!isAdminCorrection && (
                <button onClick={() => handleSave(false)} disabled={saving} className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  <Save size={16} className="inline mr-2" />
                  Guardar borrador
                </button>
              )}
              <button onClick={() => handleSave(true)} disabled={saving} className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Guardando..." : isAdminCorrection ? "Guardar corrección" : "Enviar para aprobación"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Success message */}
      {successMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-emerald-600 text-white rounded-xl shadow-lg flex items-center gap-2">
          <CheckCircle size={18} />
          {successMessage}
        </div>
      )}

      {/* Content */}
      <main className="px-6 md:px-8 lg:px-12 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Aviso de corrección administrativa */}
          {isAdminCorrection && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-amber-800">Modo corrección administrativa</h3>
                <p className="text-sm text-amber-700 mt-1">Los cambios se guardarán sin crear nueva versión ni reiniciar aprobaciones. Se auditará la corrección.</p>
              </div>
            </div>
          )}

          {/* Proveedor y descripción */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Información general</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Proveedor *</label>
                <button type="button" onClick={() => setShowSupplierModal(true)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between hover:border-slate-300">
                  <span className={formData.supplierName ? "text-slate-900" : "text-slate-400"}>{formData.supplierName || "Seleccionar proveedor"}</span>
                  <Building2 size={16} className="text-slate-400" />
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fecha vencimiento</label>
                <input type="date" value={formData.dueDate} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-2">Descripción *</label>
                <input type="text" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Descripción de la factura" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-2">Notas</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} placeholder="Notas adicionales (opcional)" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none" />
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Items</h2>
              <button onClick={addNewItem} className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                <Plus size={16} />
                Añadir item
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <input type="text" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} placeholder="Descripción del item" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <button type="button" onClick={() => { setCurrentItemIndex(idx); setShowAccountModal(true); }} className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-left hover:border-slate-300 truncate">
                          {item.subAccountCode ? `${item.subAccountCode} - ${item.subAccountDescription}` : "Seleccionar cuenta"}
                        </button>
                        
                        <div className="flex gap-2">
                          <input type="number" value={item.quantity} onChange={e => updateItem(idx, "quantity", parseFloat(e.target.value) || 0)} placeholder="Cant." className="w-20 px-2 py-2 border border-slate-200 rounded-lg text-sm text-center" />
                          <input type="number" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", parseFloat(e.target.value) || 0)} placeholder="Precio" className="flex-1 px-2 py-2 border border-slate-200 rounded-lg text-sm text-right" />
                        </div>

                        <select value={item.vatRate} onChange={e => updateItem(idx, "vatRate", parseInt(e.target.value))} className="px-2 py-2 border border-slate-200 rounded-lg text-sm">
                          {VAT_RATES.map(r => <option key={r} value={r}>IVA {r}%</option>)}
                        </select>

                        <select value={item.irpfRate} onChange={e => updateItem(idx, "irpfRate", parseInt(e.target.value))} className="px-2 py-2 border border-slate-200 rounded-lg text-sm">
                          {IRPF_RATES.map(r => <option key={r} value={r}>IRPF {r}%</option>)}
                        </select>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-4">
                          {projectEpisodes.length > 1 && (
                            <button onClick={() => openEpisodeModal(idx)} className="flex items-center gap-1 text-slate-500 hover:text-slate-700">
                              <Layers size={14} />
                              {item.episodeAssignment === "specific" && item.episodes ? `Eps: ${item.episodes.map(e => e.episode).join(", ")}` : "General"}
                            </button>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-slate-500">Base: {formatCurrency(item.baseAmount)}€</span>
                          <span className="ml-4 font-medium text-slate-900">Total: {formatCurrency(item.totalAmount)}€</span>
                        </div>
                      </div>
                    </div>

                    {items.length > 1 && (
                      <button onClick={() => removeItem(idx)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Totales */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
              <div className="flex justify-end">
                <div className="text-right space-y-1">
                  <div className="text-sm text-slate-500">Base: {formatCurrency(totals.baseAmount)}€</div>
                  <div className="text-sm text-slate-500">IVA: {formatCurrency(totals.vatAmount)}€</div>
                  {totals.irpfAmount > 0 && <div className="text-sm text-slate-500">IRPF: -{formatCurrency(totals.irpfAmount)}€</div>}
                  <div className="text-lg font-semibold text-slate-900">Total: {formatCurrency(totals.totalAmount)}€</div>
                </div>
              </div>
            </div>
          </div>

          {/* Documento adjunto */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h2 className="font-semibold text-slate-900 mb-4">Documento adjunto</h2>
            {existingFileUrl && !uploadedFile && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-4">
                <FileText size={20} className="text-slate-400" />
                <span className="text-sm text-slate-600 flex-1">{existingFileName}</span>
                <a href={existingFileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                  <Eye size={14} />
                  Ver
                </a>
              </div>
            )}
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={e => setUploadedFile(e.target.files?.[0] || null)} className="hidden" />
              {uploadedFile ? (
                <div className="text-center">
                  <CheckCircle size={24} className="text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">{uploadedFile.name}</p>
                  <p className="text-xs text-slate-400">Click para cambiar</p>
                </div>
              ) : (
                <div className="text-center">
                  <Upload size={24} className="text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600">{existingFileUrl ? "Subir nuevo documento" : "Subir documento"}</p>
                </div>
              )}
            </label>
          </div>
        </div>
      </main>

      {/* Modal proveedor */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSupplierModal(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Search size={20} className="text-slate-400" />
                <input type="text" value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} placeholder="Buscar proveedor..." autoFocus className="flex-1 outline-none text-sm" />
                <button onClick={() => setShowSupplierModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredSuppliers.map(s => (
                <button key={s.id} onClick={() => selectSupplier(s)} className="w-full px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <p className="font-medium text-slate-900">{s.fiscalName}</p>
                  <p className="text-xs text-slate-500">{s.taxId}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal cuenta */}
      {showAccountModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowAccountModal(false)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Search size={20} className="text-slate-400" />
                <input type="text" value={accountSearch} onChange={e => setAccountSearch(e.target.value)} placeholder="Buscar cuenta..." autoFocus className="flex-1 outline-none text-sm" />
                <button onClick={() => setShowAccountModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {filteredSubAccounts.map(s => (
                <button key={s.id} onClick={() => selectAccount(s)} className="w-full px-4 py-3 text-left hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{s.code}</p>
                      <p className="text-sm text-slate-500">{s.description}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="text-slate-500">Disp: {formatCurrency(s.available)}€</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal episodios */}
      {showEpisodeModal && episodeItemIndex !== null && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowEpisodeModal(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold">Asignar episodios</h3>
              <button onClick={() => setShowEpisodeModal(false)} className="p-1 hover:bg-slate-100 rounded"><X size={18} /></button>
            </div>
            <div className="p-4">
              <div className="flex gap-2 mb-4">
                <button onClick={() => { setEpisodeDistributionMode("equal"); recalculateDistribution(tempEpisodeDistribution, items[episodeItemIndex].baseAmount); }} className={`flex-1 py-2 rounded-lg text-sm font-medium ${episodeDistributionMode === "equal" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                  Partes iguales
                </button>
                <button onClick={() => setEpisodeDistributionMode("amount")} className={`flex-1 py-2 rounded-lg text-sm font-medium ${episodeDistributionMode === "amount" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
                  Por importe
                </button>
              </div>
              
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {projectEpisodes.map(ep => {
                  const selected = tempEpisodeDistribution.find(e => e.episode === ep);
                  return (
                    <div key={ep} className={`flex items-center gap-3 p-3 rounded-lg border ${selected ? "border-slate-300 bg-slate-50" : "border-slate-200"}`}>
                      <input type="checkbox" checked={!!selected} onChange={() => toggleEpisodeInDistribution(ep)} className="w-4 h-4" />
                      <span className="font-medium">Ep. {ep}</span>
                      {selected && episodeDistributionMode === "amount" && (
                        <input type="number" value={selected.amount || ""} onChange={e => updateEpisodeAmount(ep, parseFloat(e.target.value) || 0)} placeholder="0.00" className="ml-auto w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right" />
                      )}
                      {selected && episodeDistributionMode === "equal" && (
                        <span className="ml-auto text-sm text-slate-500">{selected.percentage.toFixed(1)}%</span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200 flex gap-3">
                <button onClick={() => { setTempEpisodeDistribution([]); }} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm">
                  General (sin episodios)
                </button>
                <button onClick={saveEpisodeDistribution} className="flex-1 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium">
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
