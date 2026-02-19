"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import {
  doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, Timestamp, writeBatch, setDoc
} from "firebase/firestore";
import {
  Package, Plus, Search, ChevronDown, ChevronRight, X, Check, AlertCircle, CheckCircle,
  Trash2, Edit, Upload, FileText, Receipt, Eye, Calendar, ArrowLeft, Layers,
  ShieldAlert, FileSpreadsheet, ExternalLink, Lock, FileUp, Send, Banknote,
  ClipboardList, UserCircle, CreditCard, Hash, CheckSquare, AlertTriangle
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// ─── Interfaces ────────────────────────────────────────────────────────────────

interface Box {
  id: string;
  name: string;
  code: string;
  department?: string;
  nextInvoiceNumber: number;
  nextTicketNumber: number;
  nextEnvelopeNumber: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

interface Envelope {
  id: string;
  boxId: string;
  boxCode: string;
  number: number;
  displayNumber: string;
  status: "open" | "reviewing" | "closed";
  totalBase: number;
  totalVat: number;
  totalAmount: number;
  expenseCount: number;
  reviewedCount: number;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  closedAt?: Date;
  closedBy?: string;
  closedByName?: string;
}

interface ExpenseItem {
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
}

interface BoxExpense {
  id: string;
  envelopeId: string;
  boxId: string;
  boxCode: string;
  number: number;
  displayNumber: string;
  type: "invoice" | "ticket";
  pleoReceiptId: string;
  pleoUrl?: string;
  documentUrl?: string;
  supplier: string;
  supplierTaxId: string;
  supplierNumber: string;
  subAccountCode: string;
  subAccountDescription: string;
  description: string;
  date: Date;
  items: ExpenseItem[];
  baseAmount: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  status: "pending" | "reviewed" | "accounted";
  reviewedAt?: Date;
  reviewedBy?: string;
  reviewedByName?: string;
}

interface BoxSupplier {
  taxId: string;
  name: string;
  originalName: string;
  updatedAt?: Date;
}

// ─── Transfer interfaces ───────────────────────────────────────────────────────

type TransferStatus = "draft" | "pending" | "transferred";

interface TransferExpense {
  id: string;
  type: "invoice" | "ticket";
  supplier: string;
  supplierTaxId: string;
  supplierNumber: string;
  subAccountCode: string;
  subAccountDescription: string;
  description: string;
  date: string;
  baseAmount: number;
  vatRate: number;
  vatAmount: number;
  irpfRate: number;
  irpfAmount: number;
  totalAmount: number;
  documentUrl?: string;
}

interface BoxTransfer {
  id: string;
  boxId: string;
  boxCode: string;
  displayNumber: string;
  number: number;
  requesterName: string;
  requesterIban: string;
  requesterDepartment: string;
  requesterEmail: string;
  expenses: TransferExpense[];
  totalBase: number;
  totalVat: number;
  totalAmount: number;
  notes: string;
  status: TransferStatus;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
  transferredAt?: Date;
  transferredBy?: string;
  transferredByName?: string;
  transferReference?: string;
  transferDate?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const capitalizeSupplierName = (name: string): string => {
  if (!name) return "";
  const lw = ["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "con", "por", "para"];
  return name.toLowerCase().split(" ").map((w, i) =>
    i > 0 && lw.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
};

const generateCode = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const STATUS_CONFIG = {
  open: { bg: "bg-blue-50", text: "text-blue-700", label: "Abierto" },
  reviewing: { bg: "bg-amber-50", text: "text-amber-700", label: "En revisión" },
  closed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Cerrado" },
};

const EXPENSE_STATUS_CONFIG = {
  pending: { bg: "bg-slate-100", text: "text-slate-600", label: "Pendiente" },
  reviewed: { bg: "bg-blue-50", text: "text-blue-700", label: "Revisado" },
  accounted: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Contabilizado" },
};

const TRANSFER_STATUS_CONFIG: Record<TransferStatus, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-slate-100", text: "text-slate-600", label: "Borrador" },
  pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Pendiente transferencia" },
  transferred: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Transferida" },
};

const EMPTY_TRANSFER_EXPENSE = (): TransferExpense => ({
  id: crypto.randomUUID(),
  type: "invoice",
  supplier: "",
  supplierTaxId: "",
  supplierNumber: "",
  subAccountCode: "",
  subAccountDescription: "",
  description: "",
  date: new Date().toLocaleDateString("es-ES"),
  baseAmount: 0,
  vatRate: 21,
  vatAmount: 0,
  irpfRate: 0,
  irpfAmount: 0,
  totalAmount: 0,
  documentUrl: "",
});

type BoxView = "pleo" | "transfers";

// ═══════════════════════════════════════════════════════════════════════════════
export default function BoxesPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const { loading: permissionsLoading } = useAccountingPermissions(projectId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [expenses, setExpenses] = useState<BoxExpense[]>([]);
  const [transfers, setTransfers] = useState<BoxTransfer[]>([]);
  const [boxSuppliers, setBoxSuppliers] = useState<BoxSupplier[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [boxView, setBoxView] = useState<BoxView>("pleo");
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<BoxTransfer | null>(null);

  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [showEditBoxModal, setShowEditBoxModal] = useState(false);
  const [showDeleteBoxModal, setShowDeleteBoxModal] = useState(false);
  const [showCreateEnvelopeModal, setShowCreateEnvelopeModal] = useState(false);
  const [showDeleteEnvelopeModal, setShowDeleteEnvelopeModal] = useState<Envelope | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCreateTransferModal, setShowCreateTransferModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);

  const [boxForm, setBoxForm] = useState({ name: "", code: "", department: "" });
  const [editBoxForm, setEditBoxForm] = useState({ name: "", code: "" });

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [transferForm, setTransferForm] = useState({ requesterName: "", requesterIban: "", requesterDepartment: "", requesterEmail: "", notes: "" });
  const [transferExpenses, setTransferExpenses] = useState<TransferExpense[]>([EMPTY_TRANSFER_EXPENSE()]);
  const [transferRef, setTransferRef] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toLocaleDateString("es-ES"));

  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);
  const departmentDropdownRef = useRef<HTMLDivElement>(null);

  // ─── Utils ────────────────────────────────────────────────────────────────────

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };
  const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  const fmtDate = (date: Date | any) => {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  };

  // ─── Auth / init ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (!user) router.push("/");
      else { setUserId(user.uid); setUserName(user.displayName || user.email || "Usuario"); }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(e.target as Node))
        setShowDepartmentDropdown(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  useEffect(() => {
    if (userId && projectId && !permissionsLoading) loadData();
  }, [userId, projectId, permissionsLoading]);

  // ─── Load ─────────────────────────────────────────────────────────────────────

  const loadData = async () => {
    try {
      setLoading(true);
      const ups = await getDoc(doc(db, `userProjects/${userId}/projects/${projectId}`));
      if (!ups.exists()) { setAccessError("No tienes acceso a este proyecto"); setLoading(false); return; }
      if (!ups.data().permissions?.accounting) { setAccessError("No tienes permisos de contabilidad"); setLoading(false); return; }
      setHasAccess(true);

      const deptSnap = await getDocs(collection(db, `projects/${projectId}/departments`));
      setDepartments(deptSnap.docs.map(d => d.data().name || d.id));

      const boxesSnap = await getDocs(query(collection(db, `projects/${projectId}/boxes`), orderBy("name")));
      setBoxes(boxesSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date() })) as Box[]);

      const envSnap = await getDocs(query(collection(db, `projects/${projectId}/boxEnvelopes`), orderBy("createdAt", "desc")));
      setEnvelopes(envSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date(), closedAt: d.data().closedAt?.toDate() })) as Envelope[]);

      const expSnap = await getDocs(query(collection(db, `projects/${projectId}/boxExpenses`), orderBy("date", "desc")));
      setExpenses(expSnap.docs.map(d => ({ id: d.id, ...d.data(), date: d.data().date?.toDate() || new Date(), reviewedAt: d.data().reviewedAt?.toDate() })) as BoxExpense[]);

      const trfSnap = await getDocs(query(collection(db, `projects/${projectId}/boxTransfers`), orderBy("createdAt", "desc")));
      setTransfers(trfSnap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() || new Date(), transferredAt: d.data().transferredAt?.toDate() })) as BoxTransfer[]);

      const supSnap = await getDocs(collection(db, `projects/${projectId}/boxSuppliers`));
      setBoxSuppliers(supSnap.docs.map(d => ({ taxId: d.id, ...d.data() })) as BoxSupplier[]);
    } catch (e) { console.error(e); showToast("error", "Error al cargar datos"); }
    finally { setLoading(false); }
  };

  // ─── Box CRUD ─────────────────────────────────────────────────────────────────

  const handleCreateBox = async () => {
    if (!boxForm.name.trim() || !boxForm.code.trim()) return showToast("error", "Nombre y código obligatorios");
    if (boxes.some(b => b.code.toUpperCase() === boxForm.code.toUpperCase())) return showToast("error", "Código ya en uso");
    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/boxes`), {
        name: boxForm.name.trim(), code: boxForm.code.toUpperCase().trim(), department: boxForm.department || "",
        nextInvoiceNumber: 1, nextTicketNumber: 1, nextEnvelopeNumber: 1,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      showToast("success", "Caja creada");
      setShowCreateBoxModal(false);
      setBoxForm({ name: "", code: "", department: "" });
      loadData();
    } catch { showToast("error", "Error al crear caja"); } finally { setSaving(false); }
  };

  const handleEditBox = async () => {
    if (!selectedBox || !editBoxForm.name.trim() || !editBoxForm.code.trim()) return;
    if (boxes.some(b => b.id !== selectedBox.id && b.code.toUpperCase() === editBoxForm.code.toUpperCase()))
      return showToast("error", "Código ya en uso");
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/boxes`, selectedBox.id), {
        name: editBoxForm.name.trim(), code: editBoxForm.code.toUpperCase().trim(),
      });
      const updated = { ...selectedBox, name: editBoxForm.name.trim(), code: editBoxForm.code.toUpperCase().trim() };
      setSelectedBox(updated);
      setBoxes(prev => prev.map(b => b.id === selectedBox.id ? updated : b));
      showToast("success", "Caja actualizada");
      setShowEditBoxModal(false);
    } catch { showToast("error", "Error al actualizar"); } finally { setSaving(false); }
  };

  const canDeleteBox = (box: Box) => {
    const hasApproved = expenses.filter(e => e.boxId === box.id).some(e => e.status === "reviewed" || e.status === "accounted");
    const hasTransferred = transfers.filter(t => t.boxId === box.id).some(t => t.status === "transferred");
    return !hasApproved && !hasTransferred;
  };

  const handleDeleteBox = async () => {
    if (!selectedBox) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      expenses.filter(e => e.boxId === selectedBox.id).forEach(e => batch.delete(doc(db, `projects/${projectId}/boxExpenses`, e.id)));
      envelopes.filter(e => e.boxId === selectedBox.id).forEach(e => batch.delete(doc(db, `projects/${projectId}/boxEnvelopes`, e.id)));
      transfers.filter(t => t.boxId === selectedBox.id).forEach(t => batch.delete(doc(db, `projects/${projectId}/boxTransfers`, t.id)));
      batch.delete(doc(db, `projects/${projectId}/boxes`, selectedBox.id));
      await batch.commit();
      showToast("success", "Caja eliminada");
      setShowDeleteBoxModal(false);
      setSelectedBox(null);
      loadData();
    } catch { showToast("error", "Error al eliminar caja"); } finally { setSaving(false); }
  };

  // ─── Envelope CRUD ────────────────────────────────────────────────────────────

  const handleCreateEnvelope = async () => {
    if (!selectedBox) return;
    setSaving(true);
    try {
      const num = selectedBox.nextEnvelopeNumber || 1;
      const displayNumber = `ENV-${selectedBox.code}-${String(num).padStart(3, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/boxEnvelopes`), {
        boxId: selectedBox.id, boxCode: selectedBox.code, number: num, displayNumber,
        status: "open", totalBase: 0, totalVat: 0, totalAmount: 0, expenseCount: 0, reviewedCount: 0,
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      const newNext = num + 1;
      await updateDoc(doc(db, `projects/${projectId}/boxes`, selectedBox.id), { nextEnvelopeNumber: newNext });
      const updated = { ...selectedBox, nextEnvelopeNumber: newNext };
      setSelectedBox(updated);
      setBoxes(prev => prev.map(b => b.id === selectedBox.id ? updated : b));
      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateEnvelopeModal(false);
      loadData();
    } catch { showToast("error", "Error al crear sobre"); } finally { setSaving(false); }
  };

  const canDeleteEnvelope = (envelope: Envelope) =>
    !expenses.filter(e => e.envelopeId === envelope.id).some(e => e.status === "reviewed" || e.status === "accounted");

  const handleDeleteEnvelope = async (envelope: Envelope) => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      expenses.filter(e => e.envelopeId === envelope.id).forEach(e => batch.delete(doc(db, `projects/${projectId}/boxExpenses`, e.id)));
      batch.delete(doc(db, `projects/${projectId}/boxEnvelopes`, envelope.id));
      await batch.commit();
      showToast("success", "Sobre eliminado");
      setShowDeleteEnvelopeModal(null);
      if (selectedEnvelope?.id === envelope.id) setSelectedEnvelope(null);
      loadData();
    } catch { showToast("error", "Error al eliminar sobre"); } finally { setSaving(false); }
  };

  // ─── Pleo import ──────────────────────────────────────────────────────────────

  const parsePleoExcel = async (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(data);
          const sharedStrings: string[] = [];
          const ssFile = zip.file("xl/sharedStrings.xml");
          if (ssFile) {
            const ssDoc = new DOMParser().parseFromString(await ssFile.async("text"), "text/xml");
            ssDoc.querySelectorAll("t").forEach(t => sharedStrings.push(t.textContent || ""));
          }
          const sheetFile = zip.file("xl/worksheets/sheet1.xml");
          if (!sheetFile) throw new Error("No se encontró la hoja");
          const sheetDoc = new DOMParser().parseFromString(await sheetFile.async("text"), "text/xml");
          const rows: string[][] = [];
          sheetDoc.querySelectorAll("row").forEach(row => {
            const rd: string[] = [];
            row.querySelectorAll("c").forEach(cell => {
              const type = cell.getAttribute("t"), vElem = cell.querySelector("v");
              let value = vElem?.textContent || "";
              if (type === "s" && value) value = sharedStrings[parseInt(value)] || "";
              rd.push(value);
            });
            rows.push(rd);
          });
          if (rows.length < 2) { reject(new Error("Sin datos")); return; }
          const headers = rows[0];
          const grouped: Record<string, any[]> = {};
          for (let i = 1; i < rows.length; i++) {
            const record: any = {};
            headers.forEach((h, j) => { record[h] = rows[i][j] || ""; });
            const id = record["RECIBO PLEO"]; if (!id) continue;
            if (!grouped[id]) grouped[id] = [];
            grouped[id].push(record);
          }
          const result: any[] = [];
          for (const [receiptId, records] of Object.entries(grouped)) {
            const first = records[0];
            const items = records.map(r => ({
              baseAmount: parseFloat(r["ANTES DE IMPUESTOS"]?.replace(",", ".") || "0"),
              vatRate: parseFloat(r["PORCENTAJE IMPUESTO"]?.replace(",", ".") || "0"),
              vatAmount: parseFloat(r["TOTAL IMPUESTO"]?.replace(",", ".") || "0"),
            }));
            const totalBase = items.reduce((s, i) => s + i.baseAmount, 0);
            const totalVat = items.reduce((s, i) => s + i.vatAmount, 0);
            const irpfRate = parseFloat(first["IRPF %"]?.replace(",", ".") || "0");
            const irpfAmount = parseFloat(first["IRPF TOTAL"]?.replace(",", ".") || "0");
            result.push({
              pleoReceiptId: receiptId,
              type: first["TIPO DE DOCUMENTO"]?.toLowerCase() === "ticket" ? "ticket" : "invoice",
              supplier: first["PROVEEDOR"] || "", supplierTaxId: first["CIF"] || "",
              supplierNumber: first["Número de Factura"] || "",
              subAccountCode: first["CODIGO PRESUPUESTO"] || "",
              subAccountDescription: first["DESCRIPCIÓN NUMERO CUENTA"] || "",
              description: first["DESCRIPCION"] || first["NOTAS"] || "",
              date: first["FECHA FACTURA/TICKET"] || "", pleoUrl: first["URL"] || "",
              items, baseAmount: totalBase, vatAmount: totalVat, irpfRate, irpfAmount,
              totalAmount: totalBase + totalVat - irpfAmount,
            });
          }
          resolve(result);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error("Error leyendo archivo"));
      reader.readAsArrayBuffer(file);
    });
  };

  const handleFileSelect = async (file: File) => {
    setImportFile(file);
    try { setImportPreview(await parsePleoExcel(file)); }
    catch { showToast("error", "Error al leer el archivo"); setImportFile(null); setImportPreview([]); }
  };

  const handleImportExpenses = async () => {
    if (!selectedEnvelope || !selectedBox || importPreview.length === 0) return;
    setImporting(true);
    try {
      const batch = writeBatch(db);
      let invoiceNum = selectedBox.nextInvoiceNumber, ticketNum = selectedBox.nextTicketNumber;
      let totalBase = selectedEnvelope.totalBase, totalVat = selectedEnvelope.totalVat;
      let totalAmount = selectedEnvelope.totalAmount, expenseCount = selectedEnvelope.expenseCount;
      const existingIds = new Set(expenses.filter(e => e.envelopeId === selectedEnvelope.id).map(e => e.pleoReceiptId));
      const localSuppliers = [...boxSuppliers];
      for (const exp of importPreview) {
        if (existingIds.has(exp.pleoReceiptId)) continue;
        let supplierName = exp.supplier;
        const found = localSuppliers.find(s => s.taxId === exp.supplierTaxId);
        if (found) { supplierName = found.name; }
        else if (exp.supplierTaxId) {
          const normalized = capitalizeSupplierName(exp.supplier);
          await setDoc(doc(db, `projects/${projectId}/boxSuppliers`, exp.supplierTaxId),
            { taxId: exp.supplierTaxId, name: normalized, originalName: exp.supplier, updatedAt: Timestamp.now() }, { merge: true });
          supplierName = normalized;
          localSuppliers.push({ taxId: exp.supplierTaxId, name: normalized, originalName: exp.supplier });
        }
        const isTicket = exp.type === "ticket";
        const num = isTicket ? ticketNum++ : invoiceNum++;
        const displayNumber = `BOX-${selectedBox.code}-${isTicket ? "T" : "F"}-${String(num).padStart(4, "0")}`;
        let expenseDate = new Date();
        if (exp.date) { const p = exp.date.split("/"); if (p.length === 3) expenseDate = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])); }
        const ref = doc(collection(db, `projects/${projectId}/boxExpenses`));
        batch.set(ref, {
          envelopeId: selectedEnvelope.id, boxId: selectedBox.id, boxCode: selectedBox.code,
          number: num, displayNumber, type: exp.type, pleoReceiptId: exp.pleoReceiptId,
          pleoUrl: exp.pleoUrl || "", documentUrl: "", supplier: supplierName,
          supplierTaxId: exp.supplierTaxId || "", supplierNumber: exp.supplierNumber || "",
          subAccountCode: exp.subAccountCode || "", subAccountDescription: exp.subAccountDescription || "",
          description: exp.description || "", date: Timestamp.fromDate(expenseDate),
          items: exp.items || [], baseAmount: exp.baseAmount || 0, vatAmount: exp.vatAmount || 0,
          irpfRate: exp.irpfRate || 0, irpfAmount: exp.irpfAmount || 0, totalAmount: exp.totalAmount || 0,
          status: "pending", createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
        totalBase += exp.baseAmount || 0; totalVat += exp.vatAmount || 0;
        totalAmount += exp.totalAmount || 0; expenseCount++;
      }
      batch.update(doc(db, `projects/${projectId}/boxEnvelopes`, selectedEnvelope.id), { totalBase, totalVat, totalAmount, expenseCount });
      batch.update(doc(db, `projects/${projectId}/boxes`, selectedBox.id), { nextInvoiceNumber: invoiceNum, nextTicketNumber: ticketNum });
      await batch.commit();
      const updated = { ...selectedBox, nextInvoiceNumber: invoiceNum, nextTicketNumber: ticketNum };
      setSelectedBox(updated); setBoxes(prev => prev.map(b => b.id === selectedBox.id ? updated : b));
      showToast("success", `${importPreview.length} gastos importados`);
      setShowImportModal(false); setImportFile(null); setImportPreview([]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "Error al importar"); } finally { setImporting(false); }
  };

  const handleReviewExpense = async (expense: BoxExpense) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/boxExpenses`, expense.id), {
        status: "reviewed", reviewedAt: Timestamp.now(), reviewedBy: userId, reviewedByName: userName,
      });
      const envelope = envelopes.find(e => e.id === expense.envelopeId);
      if (envelope) await updateDoc(doc(db, `projects/${projectId}/boxEnvelopes`, envelope.id), { reviewedCount: (envelope.reviewedCount || 0) + 1 });
      showToast("success", "Gasto revisado"); loadData();
    } catch { showToast("error", "Error al revisar"); }
  };

  const handleCloseEnvelope = async (envelope: Envelope) => {
    const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
    const pending = envExpenses.filter(e => e.status === "pending").length;
    if (pending > 0) return showToast("error", `${pending} gastos sin revisar`);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, `projects/${projectId}/boxEnvelopes`, envelope.id), { status: "closed", closedAt: Timestamp.now(), closedBy: userId, closedByName: userName });
      envExpenses.forEach(e => batch.update(doc(db, `projects/${projectId}/boxExpenses`, e.id), { status: "accounted", accountedAt: Timestamp.now() }));
      await batch.commit(); showToast("success", "Sobre cerrado"); loadData();
    } catch { showToast("error", "Error al cerrar sobre"); }
  };

  // ─── Transfer CRUD ────────────────────────────────────────────────────────────

  const computeTE = (exp: TransferExpense): TransferExpense => {
    const vatAmount = Math.round(exp.baseAmount * exp.vatRate / 100 * 100) / 100;
    const irpfAmount = Math.round(exp.baseAmount * exp.irpfRate / 100 * 100) / 100;
    return { ...exp, vatAmount, irpfAmount, totalAmount: exp.baseAmount + vatAmount - irpfAmount };
  };

  const updateTE = (id: string, changes: Partial<TransferExpense>) =>
    setTransferExpenses(prev => prev.map(e => e.id !== id ? e : computeTE({ ...e, ...changes })));

  const trfTotals = {
    base: transferExpenses.reduce((s, e) => s + (e.baseAmount || 0), 0),
    vat: transferExpenses.reduce((s, e) => s + (e.vatAmount || 0), 0),
    total: transferExpenses.reduce((s, e) => s + (e.totalAmount || 0), 0),
  };

  const handleCreateTransfer = async (asDraft: boolean) => {
    if (!selectedBox) return;
    if (!transferForm.requesterName.trim()) return showToast("error", "Nombre del solicitante obligatorio");
    if (transferExpenses.every(e => e.baseAmount === 0)) return showToast("error", "Añade al menos un gasto con importe");
    setSaving(true);
    try {
      const num = transfers.filter(t => t.boxId === selectedBox.id).length + 1;
      const displayNumber = `TRF-${selectedBox.code}-${String(num).padStart(4, "0")}`;
      await addDoc(collection(db, `projects/${projectId}/boxTransfers`), {
        boxId: selectedBox.id, boxCode: selectedBox.code, displayNumber, number: num,
        requesterName: transferForm.requesterName.trim(), requesterIban: transferForm.requesterIban.trim(),
        requesterDepartment: transferForm.requesterDepartment, requesterEmail: transferForm.requesterEmail.trim(),
        expenses: transferExpenses, totalBase: trfTotals.base, totalVat: trfTotals.vat, totalAmount: trfTotals.total,
        notes: transferForm.notes.trim(), status: asDraft ? "draft" : "pending",
        createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
      });
      showToast("success", asDraft ? "Borrador guardado" : `Solicitud ${displayNumber} enviada`);
      setShowCreateTransferModal(false);
      setTransferForm({ requesterName: "", requesterIban: "", requesterDepartment: "", requesterEmail: "", notes: "" });
      setTransferExpenses([EMPTY_TRANSFER_EXPENSE()]);
      loadData();
    } catch (e) { console.error(e); showToast("error", "Error al crear solicitud"); } finally { setSaving(false); }
  };

  const handleMarkTransferred = async () => {
    if (!selectedTransfer || !transferRef.trim()) return showToast("error", "Introduce la referencia");
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/boxTransfers`, selectedTransfer.id), {
        status: "transferred", transferredAt: Timestamp.now(), transferredBy: userId, transferredByName: userName,
        transferReference: transferRef.trim(), transferDate: transferDate,
      });
      showToast("success", "Transferencia registrada");
      setShowTransferModal(false); setSelectedTransfer(null); loadData();
    } catch { showToast("error", "Error al registrar"); } finally { setSaving(false); }
  };

  const handleDeleteTransfer = async (trf: BoxTransfer) => {
    if (trf.status === "transferred") return showToast("error", "No se puede eliminar una transferencia ejecutada");
    try {
      await deleteDoc(doc(db, `projects/${projectId}/boxTransfers`, trf.id));
      showToast("success", "Solicitud eliminada");
      if (selectedTransfer?.id === trf.id) setSelectedTransfer(null);
      loadData();
    } catch { showToast("error", "Error al eliminar"); }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const filteredBoxes = boxes.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) || b.code.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const boxEnvelopes = selectedBox ? envelopes.filter(e => e.boxId === selectedBox.id) : [];
  const envelopeExpenses = selectedEnvelope ? expenses.filter(e => e.envelopeId === selectedEnvelope.id) : [];
  const boxTransfers = selectedBox ? transfers.filter(t => t.boxId === selectedBox.id) : [];
  const openEnvelopes = envelopes.filter(e => e.status === "open").length;
  const totalAmt = expenses.reduce((s, e) => s + e.totalAmount, 0);

  // ─── Loading / Access ─────────────────────────────────────────────────────────

  if (loading || permissionsLoading) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
    </div>
  );

  if (!hasAccess || accessError) return (
    <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4"><ShieldAlert size={28} className="text-red-500" /></div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
        <p className="text-slate-500 mb-6">{accessError}</p>
        <Link href={`/project/${projectId}/accounting`} className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium" style={{ backgroundColor: "#2F52E0" }}>
          <ArrowLeft size={16} /> Volver
        </Link>
      </div>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400 font-medium">Filma Accounting</span>
              <ChevronRight size={14} className="text-slate-300" />
              <span className="text-2xl font-bold bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">BOX</span>
            </div>
            <div className="flex items-center gap-4">
              {boxes.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-slate-500 mr-2">
                  <span><strong className="text-slate-900">{boxes.length}</strong> cajas</span>
                  <span><strong className="text-amber-600">{openEnvelopes}</strong> sobres abiertos</span>
                  <span><strong className="text-slate-900">{fmt(totalAmt)} €</strong></span>
                </div>
              )}
              <button onClick={() => { setBoxForm({ name: "", code: "", department: "" }); setShowCreateBoxModal(true); }}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90 shadow-lg shadow-orange-500/20"
                style={{ background: "linear-gradient(135deg, #f59e0b, #f97316)" }}>
                <Plus size={16} /> Nueva caja
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-8">
        <div className="flex gap-6">
          {/* Left panel */}
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-24">
              <div className="mb-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="text" placeholder="Buscar caja" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
              </div>
              <div className="space-y-1">
                {filteredBoxes.map(box => {
                  const openCount = envelopes.filter(e => e.boxId === box.id && e.status === "open").length;
                  const pendingTrf = transfers.filter(t => t.boxId === box.id && t.status === "pending").length;
                  const isSelected = selectedBox?.id === box.id;
                  return (
                    <button key={box.id}
                      onClick={() => { setSelectedBox(box); setSelectedEnvelope(null); setSelectedTransfer(null); setBoxView("pleo"); }}
                      className={`w-full text-left p-3 rounded-xl transition-all ${isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${isSelected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{box.code}</div>
                          <div>
                            <p className={`text-sm font-medium ${isSelected ? "text-white" : "text-slate-900"}`}>{box.name}</p>
                            {box.department && <p className={`text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>{box.department}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {openCount > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"}`}>{openCount}</span>}
                          {pendingTrf > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700"}`}>{pendingTrf}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredBoxes.length === 0 && <p className="text-center py-8 text-slate-400 text-sm">{searchTerm ? "Sin resultados" : "No hay cajas"}</p>}
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 min-w-0">
            {!selectedBox ? (
              <div className="flex items-center justify-center h-96">
                <p className="text-sm text-slate-400">{boxes.length === 0 ? "No hay cajas creadas" : "Selecciona una caja"}</p>
              </div>

            ) : !selectedEnvelope && !selectedTransfer ? (
              /* ── Box detail ── */
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">{selectedBox.name}</h2>
                    <p className="text-sm text-slate-500">Código: {selectedBox.code}{selectedBox.department ? ` · ${selectedBox.department}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setEditBoxForm({ name: selectedBox.name, code: selectedBox.code }); setShowEditBoxModal(true); }}
                      className="flex items-center gap-2 px-3 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">
                      <Edit size={14} /> Editar
                    </button>
                    {canDeleteBox(selectedBox) && (
                      <button onClick={() => setShowDeleteBoxModal(true)}
                        className="flex items-center gap-2 px-3 py-2 border border-red-100 text-red-500 rounded-xl text-sm font-medium hover:bg-red-50">
                        <Trash2 size={14} /> Eliminar
                      </button>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit mb-6">
                  <button onClick={() => setBoxView("pleo")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${boxView === "pleo" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                    <FileSpreadsheet size={15} /> Pleo
                  </button>
                  <button onClick={() => setBoxView("transfers")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${boxView === "transfers" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                    <Banknote size={15} /> Transferencias
                    {boxTransfers.filter(t => t.status === "pending").length > 0 && (
                      <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                        {boxTransfers.filter(t => t.status === "pending").length}
                      </span>
                    )}
                  </button>
                </div>

                {/* ─ PLEO TAB ─ */}
                {boxView === "pleo" && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-slate-500">{boxEnvelopes.length} sobres</p>
                      <button onClick={() => setShowCreateEnvelopeModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
                        <Plus size={16} /> Nuevo sobre
                      </button>
                    </div>
                    {boxEnvelopes.length === 0 ? (
                      <p className="text-center py-16 text-sm text-slate-400">No hay sobres en esta caja</p>
                    ) : (
                      <div className="space-y-2">
                        {boxEnvelopes.map(envelope => {
                          const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
                          const pendingCount = envExpenses.filter(e => e.status === "pending").length;
                          const sc = STATUS_CONFIG[envelope.status];
                          return (
                            <div key={envelope.id} className="p-4 border border-slate-200 rounded-xl hover:border-slate-300 transition-all">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setSelectedEnvelope(envelope)}>
                                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                    <Layers size={18} className="text-slate-500" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-slate-900">{envelope.displayNumber}</span>
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">
                                      {envelope.expenseCount} gastos · {fmt(envelope.totalAmount)} €
                                      {pendingCount > 0 && <span className="text-amber-600 ml-2">· {pendingCount} pendientes</span>}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-400">{fmtDate(envelope.createdAt)}</span>
                                  {canDeleteEnvelope(envelope) && envelope.status !== "closed" && (
                                    <button onClick={e => { e.stopPropagation(); setShowDeleteEnvelopeModal(envelope); }}
                                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                  <ChevronRight size={16} className="text-slate-400 cursor-pointer" onClick={() => setSelectedEnvelope(envelope)} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ─ TRANSFERS TAB ─ */}
                {boxView === "transfers" && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-slate-500">{boxTransfers.length} solicitudes</p>
                      <button onClick={() => { setTransferForm({ requesterName: "", requesterIban: "", requesterDepartment: "", requesterEmail: "", notes: "" }); setTransferExpenses([EMPTY_TRANSFER_EXPENSE()]); setShowCreateTransferModal(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
                        <Plus size={16} /> Nueva solicitud
                      </button>
                    </div>
                    {boxTransfers.length === 0 ? (
                      <p className="text-center py-16 text-sm text-slate-400">No hay solicitudes de transferencia</p>
                    ) : (
                      <div className="space-y-2">
                        {boxTransfers.map(trf => {
                          const sc = TRANSFER_STATUS_CONFIG[trf.status];
                          return (
                            <div key={trf.id} className="p-4 border border-slate-200 rounded-xl hover:border-slate-300 transition-all">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setSelectedTransfer(trf)}>
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${trf.status === "transferred" ? "bg-emerald-50" : trf.status === "pending" ? "bg-amber-50" : "bg-slate-100"}`}>
                                    <Banknote size={18} className={trf.status === "transferred" ? "text-emerald-500" : trf.status === "pending" ? "text-amber-500" : "text-slate-400"} />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-slate-900">{trf.displayNumber}</span>
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                    </div>
                                    <p className="text-xs text-slate-500">{trf.requesterName} · {trf.expenses.length} gastos · {fmt(trf.totalAmount)} €</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {trf.status === "pending" && (
                                    <button onClick={e => { e.stopPropagation(); setSelectedTransfer(trf); setTransferRef(""); setTransferDate(new Date().toLocaleDateString("es-ES")); setShowTransferModal(true); }}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700">
                                      <Send size={12} /> Marcar transferida
                                    </button>
                                  )}
                                  {trf.status !== "transferred" && (
                                    <button onClick={e => { e.stopPropagation(); handleDeleteTransfer(trf); }}
                                      className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                  <ChevronRight size={16} className="text-slate-400 cursor-pointer" onClick={() => setSelectedTransfer(trf)} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

            ) : selectedEnvelope ? (
              /* ── Envelope detail ── */
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => setSelectedEnvelope(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><ArrowLeft size={18} /></button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{selectedEnvelope.displayNumber}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[selectedEnvelope.status].bg} ${STATUS_CONFIG[selectedEnvelope.status].text}`}>
                        {STATUS_CONFIG[selectedEnvelope.status].label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{selectedEnvelope.expenseCount} gastos · Base: {fmt(selectedEnvelope.totalBase)} € · Total: {fmt(selectedEnvelope.totalAmount)} €</p>
                  </div>
                  {selectedEnvelope.status === "open" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowImportModal(true)}
                        className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                        <Upload size={16} /> Importar Pleo
                      </button>
                      <button onClick={() => handleCloseEnvelope(selectedEnvelope)} disabled={envelopeExpenses.some(e => e.status === "pending")}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                        <Lock size={16} /> Cerrar sobre
                      </button>
                    </div>
                  )}
                </div>
                {envelopeExpenses.length === 0 ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="text-center">
                      <p className="text-sm text-slate-400 mb-4">No hay gastos en este sobre</p>
                      {selectedEnvelope.status === "open" && (
                        <button onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium" style={{ backgroundColor: "#2F52E0" }}>
                          <Upload size={16} /> Importar desde Pleo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-slate-600">Número</th>
                          <th className="text-left px-4 py-3 font-medium text-slate-600">Proveedor</th>
                          <th className="text-left px-4 py-3 font-medium text-slate-600">Cuenta</th>
                          <th className="text-right px-4 py-3 font-medium text-slate-600">Base</th>
                          <th className="text-right px-4 py-3 font-medium text-slate-600">IVA</th>
                          <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                          <th className="text-center px-4 py-3 font-medium text-slate-600">Estado</th>
                          <th className="text-center px-4 py-3 font-medium text-slate-600">Acc.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {envelopeExpenses.map(expense => {
                          const sc = EXPENSE_STATUS_CONFIG[expense.status];
                          return (
                            <tr key={expense.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {expense.type === "ticket" ? <Receipt size={14} className="text-amber-500" /> : <FileText size={14} className="text-blue-500" />}
                                  <span className="font-mono text-xs">{expense.displayNumber}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium text-slate-900 truncate max-w-[180px]">{expense.supplier}</p>
                                <p className="text-xs text-slate-500">{expense.supplierTaxId}</p>
                              </td>
                              <td className="px-4 py-3"><span className="font-mono text-xs text-slate-600">{expense.subAccountCode}</span></td>
                              <td className="px-4 py-3 text-right font-mono">{fmt(expense.baseAmount)}</td>
                              <td className="px-4 py-3 text-right font-mono text-emerald-600">+{fmt(expense.vatAmount)}</td>
                              <td className="px-4 py-3 text-right font-mono font-medium">{fmt(expense.totalAmount)}</td>
                              <td className="px-4 py-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span></td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  {expense.pleoUrl && (
                                    <a href={expense.pleoUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"><ExternalLink size={14} /></a>
                                  )}
                                  {expense.status === "pending" && selectedEnvelope.status === "open" && (
                                    <button onClick={() => handleReviewExpense(expense)} className="p-1.5 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 rounded"><Check size={14} /></button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            ) : selectedTransfer ? (
              /* ── Transfer detail ── */
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <button onClick={() => setSelectedTransfer(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"><ArrowLeft size={18} /></button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{selectedTransfer.displayNumber}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${TRANSFER_STATUS_CONFIG[selectedTransfer.status].bg} ${TRANSFER_STATUS_CONFIG[selectedTransfer.status].text}`}>
                        {TRANSFER_STATUS_CONFIG[selectedTransfer.status].label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">{selectedTransfer.expenses.length} gastos · Total: {fmt(selectedTransfer.totalAmount)} €</p>
                  </div>
                  {selectedTransfer.status === "pending" && (
                    <button onClick={() => { setTransferRef(""); setTransferDate(new Date().toLocaleDateString("es-ES")); setShowTransferModal(true); }}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700">
                      <Send size={16} /> Registrar transferencia
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Solicitante</p>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2"><UserCircle size={14} className="text-slate-400" /><span className="text-sm font-medium text-slate-900">{selectedTransfer.requesterName}</span></div>
                      {selectedTransfer.requesterDepartment && <div className="flex items-center gap-2"><ClipboardList size={14} className="text-slate-400" /><span className="text-sm text-slate-600">{selectedTransfer.requesterDepartment}</span></div>}
                      {selectedTransfer.requesterEmail && <div className="flex items-center gap-2"><Hash size={14} className="text-slate-400" /><span className="text-sm text-slate-600">{selectedTransfer.requesterEmail}</span></div>}
                      {selectedTransfer.requesterIban && <div className="flex items-center gap-2"><CreditCard size={14} className="text-slate-400" /><span className="text-sm font-mono text-slate-600">{selectedTransfer.requesterIban}</span></div>}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl">
                    <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Importes</p>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm"><span className="text-slate-500">Base</span><span className="font-mono">{fmt(selectedTransfer.totalBase)} €</span></div>
                      <div className="flex justify-between text-sm"><span className="text-slate-500">IVA</span><span className="font-mono text-emerald-600">+{fmt(selectedTransfer.totalVat)} €</span></div>
                      <div className="flex justify-between text-sm font-semibold border-t border-slate-200 pt-1 mt-1"><span>Total a transferir</span><span className="font-mono">{fmt(selectedTransfer.totalAmount)} €</span></div>
                    </div>
                  </div>
                </div>

                {selectedTransfer.status === "transferred" && (
                  <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
                    <CheckSquare size={18} className="text-emerald-600 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-emerald-800">Transferencia ejecutada el {selectedTransfer.transferDate}</p>
                      <p className="text-xs text-emerald-600">Ref: {selectedTransfer.transferReference} · Por {selectedTransfer.transferredByName}</p>
                    </div>
                  </div>
                )}

                {selectedTransfer.notes && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                    <p className="text-xs text-amber-700"><strong>Notas:</strong> {selectedTransfer.notes}</p>
                  </div>
                )}

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Tipo</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Proveedor</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Cuenta</th>
                        <th className="text-left px-4 py-3 font-medium text-slate-600">Descripción</th>
                        <th className="text-right px-4 py-3 font-medium text-slate-600">Base</th>
                        <th className="text-right px-4 py-3 font-medium text-slate-600">IVA</th>
                        <th className="text-right px-4 py-3 font-medium text-slate-600">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedTransfer.expenses.map(exp => (
                        <tr key={exp.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${exp.type === "ticket" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                              {exp.type === "ticket" ? "Ticket" : "Factura"}
                            </span>
                          </td>
                          <td className="px-4 py-3"><p className="font-medium text-slate-900 truncate max-w-[150px]">{exp.supplier}</p><p className="text-xs text-slate-500">{exp.date}</p></td>
                          <td className="px-4 py-3"><span className="font-mono text-xs text-slate-600">{exp.subAccountCode}</span></td>
                          <td className="px-4 py-3"><p className="text-xs text-slate-500 truncate max-w-[150px]">{exp.description}</p></td>
                          <td className="px-4 py-3 text-right font-mono">{fmt(exp.baseAmount)}</td>
                          <td className="px-4 py-3 text-right font-mono text-emerald-600">+{fmt(exp.vatAmount)}</td>
                          <td className="px-4 py-3 text-right font-mono font-medium">{fmt(exp.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200">
                      <tr>
                        <td colSpan={4} />
                        <td className="px-4 py-3 text-right font-mono font-medium">{fmt(selectedTransfer.totalBase)}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-emerald-600">+{fmt(selectedTransfer.totalVat)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">{fmt(selectedTransfer.totalAmount)} €</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ═══════════ MODALS ═══════════ */}

      {/* Create box */}
      {showCreateBoxModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva caja</h3>
              <button onClick={() => setShowCreateBoxModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del responsable *</label>
                <input type="text" value={boxForm.name}
                  onChange={e => { const name = e.target.value; setBoxForm({ ...boxForm, name, code: boxForm.code || generateCode(name) }); }}
                  placeholder="Ej: Lucía García"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Código *</label>
                <input type="text" value={boxForm.code} onChange={e => setBoxForm({ ...boxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                  placeholder="Ej: LG" maxLength={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase" />
              </div>
              <div ref={departmentDropdownRef} className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-2">Departamento (opcional)</label>
                <button type="button" onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between">
                  <span className={boxForm.department ? "text-slate-900" : "text-slate-400"}>{boxForm.department || "Seleccionar"}</span>
                  <ChevronDown size={16} className="text-slate-400" />
                </button>
                {showDepartmentDropdown && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                    <button type="button" onClick={() => { setBoxForm({ ...boxForm, department: "" }); setShowDepartmentDropdown(false); }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-400 hover:bg-slate-50">Sin departamento</button>
                    {departments.map(d => (
                      <button key={d} type="button" onClick={() => { setBoxForm({ ...boxForm, department: d }); setShowDepartmentDropdown(false); }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50">{d}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateBoxModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleCreateBox} disabled={saving || !boxForm.name.trim() || !boxForm.code.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Creando..." : "Crear caja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit box */}
      {showEditBoxModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEditBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Editar caja</h3>
              <button onClick={() => setShowEditBoxModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del responsable *</label>
                <input type="text" value={editBoxForm.name} onChange={e => setEditBoxForm({ ...editBoxForm, name: e.target.value })}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Código *</label>
                <input type="text" value={editBoxForm.code} onChange={e => setEditBoxForm({ ...editBoxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                  maxLength={3} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase" />
                <p className="text-xs text-slate-500 mt-1">Cambiar el código no afecta a gastos ya creados</p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowEditBoxModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleEditBox} disabled={saving || !editBoxForm.name.trim() || !editBoxForm.code.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete box confirm */}
      {showDeleteBoxModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-4"><AlertTriangle size={22} className="text-red-500" /></div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Eliminar caja</h3>
              <p className="text-sm text-slate-500 mb-6">Se eliminará <strong>{selectedBox.name}</strong> y todos sus sobres y gastos pendientes. Esta acción no se puede deshacer.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteBoxModal(false)} className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={handleDeleteBox} disabled={saving} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete envelope confirm */}
      {showDeleteEnvelopeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteEnvelopeModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mb-4"><AlertTriangle size={22} className="text-red-500" /></div>
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Eliminar sobre</h3>
              <p className="text-sm text-slate-500 mb-6">Se eliminará <strong>{showDeleteEnvelopeModal.displayNumber}</strong> y todos sus gastos pendientes.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteEnvelopeModal(null)} className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">Cancelar</button>
                <button onClick={() => handleDeleteEnvelope(showDeleteEnvelopeModal)} disabled={saving} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 disabled:opacity-50">
                  {saving ? "Eliminando..." : "Eliminar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create envelope */}
      {showCreateEnvelopeModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateEnvelopeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo sobre</h3>
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 text-center py-8">
              <p className="text-slate-900 font-medium mb-1">ENV-{selectedBox.code}-{String(selectedBox.nextEnvelopeNumber || 1).padStart(3, "0")}</p>
              <p className="text-sm text-slate-500">Se creará un nuevo sobre para {selectedBox.name}</p>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleCreateEnvelope} disabled={saving} className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                {saving ? "Creando..." : "Crear sobre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Pleo */}
      {showImportModal && selectedEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Importar desde Pleo</h3>
                <p className="text-sm text-slate-500">Sube el Excel exportado de Pleo</p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto">
              {!importFile ? (
                <div onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f?.name.endsWith(".xlsx")) handleFileSelect(f); }}
                  className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${isDragging ? "border-blue-400 bg-blue-50" : "border-slate-200"}`}>
                  <Upload size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 mb-2">Arrastra el archivo Excel aquí</p>
                  <p className="text-sm text-slate-400 mb-4">o</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium cursor-pointer">
                    <FileSpreadsheet size={16} /> Seleccionar archivo
                    <input type="file" accept=".xlsx" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} className="hidden" />
                  </label>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl mb-4">
                    <FileSpreadsheet size={20} className="text-emerald-500" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-900">{importFile.name}</p>
                      <p className="text-xs text-slate-500">{importPreview.length} gastos detectados</p>
                    </div>
                    <button onClick={() => { setImportFile(null); setImportPreview([]); }} className="p-1.5 text-slate-400 hover:bg-slate-200 rounded"><X size={16} /></button>
                  </div>
                  {importPreview.length > 0 && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Tipo</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Proveedor</th>
                            <th className="text-left px-3 py-2 font-medium text-slate-600">Cuenta</th>
                            <th className="text-right px-3 py-2 font-medium text-slate-600">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importPreview.slice(0, 10).map((exp, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${exp.type === "ticket" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{exp.type === "ticket" ? "Ticket" : "Factura"}</span></td>
                              <td className="px-3 py-2"><p className="font-medium text-slate-900 truncate max-w-[200px]">{capitalizeSupplierName(exp.supplier)}</p><p className="text-xs text-slate-500">{exp.supplierTaxId}</p></td>
                              <td className="px-3 py-2 font-mono text-xs">{exp.subAccountCode}</td>
                              <td className="px-3 py-2 text-right font-mono font-medium">{fmt(exp.totalAmount)} €</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importPreview.length > 10 && <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500 text-center">+{importPreview.length - 10} más</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
              <span className="text-sm text-slate-500">{importPreview.length > 0 && <>Total: <strong className="text-slate-900">{fmt(importPreview.reduce((s, e) => s + e.totalAmount, 0))} €</strong></>}</span>
              <div className="flex gap-3">
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={handleImportExpenses} disabled={importing || importPreview.length === 0}
                  className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                  {importing ? "Importando..." : `Importar ${importPreview.length} gastos`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Create Transfer Modal ─── */}
      {showCreateTransferModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateTransferModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Nueva solicitud de transferencia</h3>
                <p className="text-sm text-slate-500">Caja {selectedBox.name} ({selectedBox.code})</p>
              </div>
              <button onClick={() => setShowCreateTransferModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Requester */}
              <div className="px-6 pt-5 pb-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Datos del solicitante</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo *</label>
                    <input type="text" value={transferForm.requesterName} onChange={e => setTransferForm({ ...transferForm, requesterName: e.target.value })}
                      placeholder="Ej: Lucía García"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">IBAN</label>
                    <input type="text" value={transferForm.requesterIban} onChange={e => setTransferForm({ ...transferForm, requesterIban: e.target.value })}
                      placeholder="ES00 0000 0000 0000 0000 0000"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Departamento</label>
                    <select value={transferForm.requesterDepartment} onChange={e => setTransferForm({ ...transferForm, requesterDepartment: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
                      <option value="">Sin departamento</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input type="email" value={transferForm.requesterEmail} onChange={e => setTransferForm({ ...transferForm, requesterEmail: e.target.value })}
                      placeholder="lucia@empresa.com"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
                  </div>
                </div>
              </div>

              {/* Expenses */}
              <div className="px-6 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Gastos a reembolsar</p>
                  <button onClick={() => setTransferExpenses(prev => [...prev, EMPTY_TRANSFER_EXPENSE()])}
                    className="flex items-center gap-1.5 text-xs text-slate-600 font-medium hover:text-slate-900 px-2 py-1 rounded-lg hover:bg-slate-100">
                    <Plus size={13} /> Añadir gasto
                  </button>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="grid grid-cols-[110px_1fr_80px_70px_70px_70px_70px_30px] gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                    <span>Tipo</span><span>Proveedor / Descripción</span><span>Cuenta</span>
                    <span className="text-right">Base</span><span className="text-right">IVA%</span><span className="text-right">IRPF%</span><span className="text-right">Total</span><span />
                  </div>
                  {transferExpenses.map((exp, idx) => (
                    <div key={exp.id} className={`grid grid-cols-[110px_1fr_80px_70px_70px_70px_70px_30px] gap-2 px-3 py-2 items-center ${idx > 0 ? "border-t border-slate-100" : ""}`}>
                      <select value={exp.type} onChange={e => updateTE(exp.id, { type: e.target.value as "invoice" | "ticket" })}
                        className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none">
                        <option value="invoice">Factura</option>
                        <option value="ticket">Ticket</option>
                      </select>
                      <div className="space-y-1">
                        <input type="text" value={exp.supplier} onChange={e => updateTE(exp.id, { supplier: e.target.value })}
                          placeholder="Proveedor"
                          className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-slate-900" />
                        <input type="text" value={exp.description} onChange={e => updateTE(exp.id, { description: e.target.value })}
                          placeholder="Descripción (opcional)"
                          className="w-full px-2 py-1 border border-slate-100 rounded-lg text-xs text-slate-500 focus:outline-none bg-slate-50" />
                      </div>
                      <input type="text" value={exp.subAccountCode} onChange={e => updateTE(exp.id, { subAccountCode: e.target.value })}
                        placeholder="000000"
                        className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                      <input type="number" value={exp.baseAmount || ""} onChange={e => updateTE(exp.id, { baseAmount: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00" step="0.01"
                        className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                      <div className="relative">
                        <input type="number" value={exp.vatRate} onChange={e => updateTE(exp.id, { vatRate: parseFloat(e.target.value) || 0 })}
                          step="1" className="w-full px-2 py-1.5 pr-5 border border-slate-200 rounded-lg text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">%</span>
                      </div>
                      <div className="relative">
                        <input type="number" value={exp.irpfRate} onChange={e => updateTE(exp.id, { irpfRate: parseFloat(e.target.value) || 0 })}
                          step="1" className="w-full px-2 py-1.5 pr-5 border border-slate-200 rounded-lg text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-slate-900" />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">%</span>
                      </div>
                      <span className="text-xs font-mono font-medium text-right pr-1">{fmt(exp.totalAmount)}</span>
                      <button onClick={() => setTransferExpenses(prev => prev.filter(e => e.id !== exp.id))}
                        disabled={transferExpenses.length === 1} className="p-1 text-slate-300 hover:text-red-400 disabled:opacity-0 rounded">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <div className="grid grid-cols-[110px_1fr_80px_70px_70px_70px_70px_30px] gap-2 px-3 py-2 bg-slate-50 border-t border-slate-200">
                    <span className="text-xs font-semibold text-slate-500 col-span-3">Totales</span>
                    <span className="text-xs font-mono font-semibold text-right">{fmt(trfTotals.base)}</span>
                    <span /><span />
                    <span className="text-xs font-mono font-bold text-right">{fmt(trfTotals.total)}</span>
                    <span />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="px-6 pb-5">
                <label className="block text-sm font-medium text-slate-700 mb-2">Notas (opcional)</label>
                <textarea value={transferForm.notes} onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })}
                  rows={2} placeholder="Observaciones adicionales..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none" />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
              <span className="text-sm text-slate-500">Total: <strong className="text-slate-900 font-mono">{fmt(trfTotals.total)} €</strong></span>
              <div className="flex gap-3">
                <button onClick={() => setShowCreateTransferModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
                <button onClick={() => handleCreateTransfer(true)} disabled={saving}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                  {saving ? "..." : "Guardar borrador"}
                </button>
                <button onClick={() => handleCreateTransfer(false)} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50" style={{ backgroundColor: "#2F52E0" }}>
                  <Send size={14} /> {saving ? "Enviando..." : "Enviar solicitud"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark transferred */}
      {showTransferModal && selectedTransfer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowTransferModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Registrar transferencia</h3>
              <button onClick={() => setShowTransferModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-xs text-slate-500 mb-1">Solicitud</p>
                <p className="text-sm font-medium text-slate-900">{selectedTransfer.displayNumber} · {selectedTransfer.requesterName}</p>
                <p className="text-sm font-mono text-slate-700">{fmt(selectedTransfer.totalAmount)} € → {selectedTransfer.requesterIban || "IBAN no especificado"}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Referencia de la transferencia *</label>
                <input type="text" value={transferRef} onChange={e => setTransferRef(e.target.value)}
                  placeholder="Ej: 2024-TRF-001"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Fecha de la transferencia</label>
                <input type="text" value={transferDate} onChange={e => setTransferDate(e.target.value)}
                  placeholder="DD/MM/YYYY"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">Cancelar</button>
              <button onClick={handleMarkTransferred} disabled={saving || !transferRef.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                <Check size={14} /> {saving ? "Guardando..." : "Confirmar transferencia"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
