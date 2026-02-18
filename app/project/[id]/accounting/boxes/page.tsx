"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, where, Timestamp, writeBatch } from "firebase/firestore";
import {
  Package, Plus, Search, ChevronDown, ChevronRight, X, Check, AlertCircle, CheckCircle,
  User, Mail, Hash, Trash2, Edit, Upload, FileText, Receipt, Eye, Calendar, Building2,
  Euro, Clock, Lock, FileUp, ExternalLink, Save, RefreshCw, Filter, ArrowLeft, Layers,
  ShieldAlert, CreditCard, FileSpreadsheet, MoreHorizontal, Download
} from "lucide-react";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

// Interfaces
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

interface SubAccount {
  id: string;
  code: string;
  description: string;
  accountId: string;
  accountCode: string;
}

// Helper para capitalizar nombres de proveedores
const capitalizeSupplierName = (name: string): string => {
  if (!name) return "";
  const lowercaseWords = ["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "con", "por", "para"];
  return name.toLowerCase().split(" ").map((word, index) => {
    if (index > 0 && lowercaseWords.includes(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
};

// Helper para generar código de iniciales
const generateCode = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }
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

export default function BoxesPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const { loading: permissionsLoading, permissions } = useAccountingPermissions(projectId);

  // Estados principales
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");

  // Datos
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [expenses, setExpenses] = useState<BoxExpense[]>([]);
  const [boxSuppliers, setBoxSuppliers] = useState<BoxSupplier[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  // Navegación
  const [selectedBox, setSelectedBox] = useState<Box | null>(null);
  const [selectedEnvelope, setSelectedEnvelope] = useState<Envelope | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<BoxExpense | null>(null);

  // Modales
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [showCreateEnvelopeModal, setShowCreateEnvelopeModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showEditExpenseModal, setShowEditExpenseModal] = useState(false);

  // Formularios
  const [boxForm, setBoxForm] = useState({ name: "", code: "", department: "" });
  const [editingExpense, setEditingExpense] = useState<BoxExpense | null>(null);

  // Import
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // UI
  const [searchTerm, setSearchTerm] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Refs para dropdowns
  const departmentDropdownRef = useRef<HTMLDivElement>(null);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

  const formatDate = (date: Date | any) => {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  };

  // Auth
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) router.push("/");
      else {
        setUserId(user.uid);
        setUserName(user.displayName || user.email || "Usuario");
      }
    });
    return () => unsubscribe();
  }, [router]);

  // Click outside para dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (departmentDropdownRef.current && !departmentDropdownRef.current.contains(event.target as Node)) {
        setShowDepartmentDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Cargar datos
  useEffect(() => {
    if (userId && projectId && !permissionsLoading) loadData();
  }, [userId, projectId, permissionsLoading]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Verificar acceso
      const userProjectRef = doc(db, `userProjects/${userId}/projects/${projectId}`);
      const userProjectSnap = await getDoc(userProjectRef);
      if (!userProjectSnap.exists()) {
        setAccessError("No tienes acceso a este proyecto");
        setLoading(false);
        return;
      }

      const userProjectData = userProjectSnap.data();
      const hasAccountingAccess = userProjectData.permissions?.accounting || false;
      const accountingLevel = userProjectData.accountingAccessLevel;

      if (!hasAccountingAccess) {
        setAccessError("No tienes permisos de contabilidad");
        setLoading(false);
        return;
      }
      setHasAccess(true);

      // Cargar proyecto
      const projectDoc = await getDoc(doc(db, "projects", projectId));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      // Cargar departamentos
      const deptSnap = await getDocs(collection(db, `projects/${projectId}/departments`));
      setDepartments(deptSnap.docs.map(d => d.data().name || d.id));

      // Cargar subcuentas
      const accountsSnap = await getDocs(collection(db, `projects/${projectId}/accounts`));
      const allSubAccounts: SubAccount[] = [];
      for (const accDoc of accountsSnap.docs) {
        const accData = accDoc.data();
        const subSnap = await getDocs(collection(db, `projects/${projectId}/accounts/${accDoc.id}/subaccounts`));
        subSnap.docs.forEach(subDoc => {
          const subData = subDoc.data();
          allSubAccounts.push({
            id: subDoc.id,
            code: subData.code,
            description: subData.description,
            accountId: accDoc.id,
            accountCode: accData.code,
          });
        });
      }
      setSubAccounts(allSubAccounts);

      // Cargar cajas
      const boxesSnap = await getDocs(query(collection(db, `projects/${projectId}/boxes`), orderBy("name")));
      const boxesData = boxesSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate() || new Date(),
      })) as Box[];
      setBoxes(boxesData);

      // Cargar sobres
      const envelopesSnap = await getDocs(query(collection(db, `projects/${projectId}/boxEnvelopes`), orderBy("createdAt", "desc")));
      const envelopesData = envelopesSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate() || new Date(),
        closedAt: d.data().closedAt?.toDate(),
      })) as Envelope[];
      setEnvelopes(envelopesData);

      // Cargar gastos
      const expensesSnap = await getDocs(query(collection(db, `projects/${projectId}/boxExpenses`), orderBy("date", "desc")));
      const expensesData = expensesSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        date: d.data().date?.toDate() || new Date(),
        reviewedAt: d.data().reviewedAt?.toDate(),
      })) as BoxExpense[];
      setExpenses(expensesData);

      // Cargar proveedores de caja
      const suppliersSnap = await getDocs(collection(db, `projects/${projectId}/boxSuppliers`));
      const suppliersData = suppliersSnap.docs.map(d => ({
        taxId: d.id,
        ...d.data(),
      })) as BoxSupplier[];
      setBoxSuppliers(suppliersData);

    } catch (error) {
      console.error("Error cargando datos:", error);
      showToast("error", "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  // Crear caja
  const handleCreateBox = async () => {
    if (!boxForm.name.trim() || !boxForm.code.trim()) {
      showToast("error", "Nombre y código son obligatorios");
      return;
    }

    // Verificar código único
    if (boxes.some(b => b.code.toUpperCase() === boxForm.code.toUpperCase())) {
      showToast("error", "Ya existe una caja con ese código");
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, `projects/${projectId}/boxes`), {
        name: boxForm.name.trim(),
        code: boxForm.code.toUpperCase().trim(),
        department: boxForm.department || "",
        nextInvoiceNumber: 1,
        nextTicketNumber: 1,
        nextEnvelopeNumber: 1,
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByName: userName,
      });

      showToast("success", "Caja creada");
      setShowCreateBoxModal(false);
      setBoxForm({ name: "", code: "", department: "" });
      loadData();
    } catch (error) {
      console.error("Error:", error);
      showToast("error", "Error al crear caja");
    } finally {
      setSaving(false);
    }
  };

  // Crear sobre
  const handleCreateEnvelope = async () => {
    if (!selectedBox) return;

    setSaving(true);
    try {
      const envelopeNumber = selectedBox.nextEnvelopeNumber || 1;
      const displayNumber = `ENV-${selectedBox.code}-${String(envelopeNumber).padStart(3, "0")}`;

      await addDoc(collection(db, `projects/${projectId}/boxEnvelopes`), {
        boxId: selectedBox.id,
        boxCode: selectedBox.code,
        number: envelopeNumber,
        displayNumber,
        status: "open",
        totalBase: 0,
        totalVat: 0,
        totalAmount: 0,
        expenseCount: 0,
        reviewedCount: 0,
        createdAt: Timestamp.now(),
        createdBy: userId,
        createdByName: userName,
      });

      // Incrementar contador
      await updateDoc(doc(db, `projects/${projectId}/boxes`, selectedBox.id), {
        nextEnvelopeNumber: envelopeNumber + 1,
      });

      showToast("success", `Sobre ${displayNumber} creado`);
      setShowCreateEnvelopeModal(false);
      loadData();
    } catch (error) {
      console.error("Error:", error);
      showToast("error", "Error al crear sobre");
    } finally {
      setSaving(false);
    }
  };

  // Parsear Excel de Pleo
  const parsePleoExcel = async (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          // Importar JSZip dinámicamente
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(data);
          
          // Leer shared strings
          const sharedStrings: string[] = [];
          const ssFile = zip.file("xl/sharedStrings.xml");
          if (ssFile) {
            const ssContent = await ssFile.async("text");
            const parser = new DOMParser();
            const ssDoc = parser.parseFromString(ssContent, "text/xml");
            ssDoc.querySelectorAll("t").forEach(t => sharedStrings.push(t.textContent || ""));
          }

          // Leer hoja
          const sheetFile = zip.file("xl/worksheets/sheet1.xml");
          if (!sheetFile) throw new Error("No se encontró la hoja");
          
          const sheetContent = await sheetFile.async("text");
          const parser = new DOMParser();
          const sheetDoc = parser.parseFromString(sheetContent, "text/xml");
          
          const rows: string[][] = [];
          sheetDoc.querySelectorAll("row").forEach(row => {
            const rowData: string[] = [];
            row.querySelectorAll("c").forEach(cell => {
              const type = cell.getAttribute("t");
              const vElem = cell.querySelector("v");
              let value = vElem?.textContent || "";
              if (type === "s" && value) {
                const idx = parseInt(value);
                value = sharedStrings[idx] || "";
              }
              rowData.push(value);
            });
            rows.push(rowData);
          });

          if (rows.length < 2) {
            reject(new Error("El archivo no contiene datos"));
            return;
          }

          const headers = rows[0];
          const expenses: any[] = [];
          
          // Agrupar por RECIBO PLEO
          const groupedByReceipt: Record<string, any[]> = {};
          
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const record: any = {};
            headers.forEach((h, j) => {
              record[h] = row[j] || "";
            });
            
            const receiptId = record["RECIBO PLEO"];
            if (!receiptId) continue;
            
            if (!groupedByReceipt[receiptId]) {
              groupedByReceipt[receiptId] = [];
            }
            groupedByReceipt[receiptId].push(record);
          }

          // Procesar cada grupo
          for (const [receiptId, records] of Object.entries(groupedByReceipt)) {
            const first = records[0];
            const items: ExpenseItem[] = records.map(r => ({
              baseAmount: parseFloat(r["ANTES DE IMPUESTOS"]?.replace(",", ".") || "0"),
              vatRate: parseFloat(r["PORCENTAJE IMPUESTO"]?.replace(",", ".") || "0"),
              vatAmount: parseFloat(r["TOTAL IMPUESTO"]?.replace(",", ".") || "0"),
            }));

            const totalBase = items.reduce((sum, item) => sum + item.baseAmount, 0);
            const totalVat = items.reduce((sum, item) => sum + item.vatAmount, 0);
            const irpfRate = parseFloat(first["IRPF %"]?.replace(",", ".") || "0");
            const irpfAmount = parseFloat(first["IRPF TOTAL"]?.replace(",", ".") || "0");

            expenses.push({
              pleoReceiptId: receiptId,
              employee: first["EMPLEADO"] || "",
              type: first["TIPO DE DOCUMENTO"]?.toLowerCase() === "ticket" ? "ticket" : "invoice",
              supplier: first["PROVEEDOR"] || "",
              supplierTaxId: first["CIF"] || "",
              supplierNumber: first["Número de Factura"] || "",
              subAccountCode: first["CODIGO PRESUPUESTO"] || "",
              subAccountDescription: first["DESCRIPCIÓN NUMERO CUENTA"] || "",
              description: first["DESCRIPCION"] || first["NOTAS"] || "",
              date: first["FECHA FACTURA/TICKET"] || "",
              pleoUrl: first["URL"] || "",
              items,
              baseAmount: totalBase,
              vatAmount: totalVat,
              irpfRate,
              irpfAmount,
              totalAmount: totalBase + totalVat - irpfAmount,
            });
          }

          resolve(expenses);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Error leyendo archivo"));
      reader.readAsArrayBuffer(file);
    });
  };

  // Manejar archivo de importación
  const handleFileSelect = async (file: File) => {
    setImportFile(file);
    try {
      const parsed = await parsePleoExcel(file);
      setImportPreview(parsed);
    } catch (error) {
      console.error("Error parseando:", error);
      showToast("error", "Error al leer el archivo");
      setImportFile(null);
      setImportPreview([]);
    }
  };

  // Importar gastos
  const handleImportExpenses = async () => {
    if (!selectedEnvelope || !selectedBox || importPreview.length === 0) return;

    setImporting(true);
    try {
      const batch = writeBatch(db);
      let invoiceNum = selectedBox.nextInvoiceNumber;
      let ticketNum = selectedBox.nextTicketNumber;
      let totalBase = selectedEnvelope.totalBase;
      let totalVat = selectedEnvelope.totalVat;
      let totalAmount = selectedEnvelope.totalAmount;
      let expenseCount = selectedEnvelope.expenseCount;

      // Verificar duplicados
      const existingReceiptIds = new Set(
        expenses.filter(e => e.envelopeId === selectedEnvelope.id).map(e => e.pleoReceiptId)
      );

      for (const exp of importPreview) {
        // Saltar duplicados
        if (existingReceiptIds.has(exp.pleoReceiptId)) continue;

        // Buscar o crear proveedor
        let supplierName = exp.supplier;
        const existingSupplier = boxSuppliers.find(s => s.taxId === exp.supplierTaxId);
        if (existingSupplier) {
          supplierName = existingSupplier.name;
        } else if (exp.supplierTaxId) {
          // Crear nuevo proveedor
          const normalizedName = capitalizeSupplierName(exp.supplier);
          await updateDoc(doc(db, `projects/${projectId}/boxSuppliers`, exp.supplierTaxId), {
            taxId: exp.supplierTaxId,
            name: normalizedName,
            originalName: exp.supplier,
            updatedAt: Timestamp.now(),
          }).catch(() => {
            // Si no existe, crear
            return addDoc(collection(db, `projects/${projectId}/boxSuppliers`), {
              taxId: exp.supplierTaxId,
              name: normalizedName,
              originalName: exp.supplier,
              updatedAt: Timestamp.now(),
            });
          });
          supplierName = normalizedName;
        }

        // Determinar número
        const isTicket = exp.type === "ticket";
        const num = isTicket ? ticketNum++ : invoiceNum++;
        const typeCode = isTicket ? "T" : "F";
        const displayNumber = `BOX-${selectedBox.code}-${typeCode}-${String(num).padStart(4, "0")}`;

        // Parsear fecha
        let expenseDate = new Date();
        if (exp.date) {
          const parts = exp.date.split("/");
          if (parts.length === 3) {
            expenseDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
          }
        }

        const expenseRef = doc(collection(db, `projects/${projectId}/boxExpenses`));
        batch.set(expenseRef, {
          envelopeId: selectedEnvelope.id,
          boxId: selectedBox.id,
          boxCode: selectedBox.code,
          number: num,
          displayNumber,
          type: exp.type,
          pleoReceiptId: exp.pleoReceiptId,
          pleoUrl: exp.pleoUrl || "",
          documentUrl: "",
          supplier: supplierName,
          supplierTaxId: exp.supplierTaxId || "",
          supplierNumber: exp.supplierNumber || "",
          subAccountCode: exp.subAccountCode || "",
          subAccountDescription: exp.subAccountDescription || "",
          description: exp.description || "",
          date: Timestamp.fromDate(expenseDate),
          items: exp.items || [],
          baseAmount: exp.baseAmount || 0,
          vatAmount: exp.vatAmount || 0,
          irpfRate: exp.irpfRate || 0,
          irpfAmount: exp.irpfAmount || 0,
          totalAmount: exp.totalAmount || 0,
          status: "pending",
          createdAt: Timestamp.now(),
          createdBy: userId,
          createdByName: userName,
        });

        totalBase += exp.baseAmount || 0;
        totalVat += exp.vatAmount || 0;
        totalAmount += exp.totalAmount || 0;
        expenseCount++;
      }

      // Actualizar sobre
      batch.update(doc(db, `projects/${projectId}/boxEnvelopes`, selectedEnvelope.id), {
        totalBase,
        totalVat,
        totalAmount,
        expenseCount,
      });

      // Actualizar contadores de caja
      batch.update(doc(db, `projects/${projectId}/boxes`, selectedBox.id), {
        nextInvoiceNumber: invoiceNum,
        nextTicketNumber: ticketNum,
      });

      await batch.commit();

      showToast("success", `${importPreview.length} gastos importados`);
      setShowImportModal(false);
      setImportFile(null);
      setImportPreview([]);
      loadData();
    } catch (error) {
      console.error("Error importando:", error);
      showToast("error", "Error al importar gastos");
    } finally {
      setImporting(false);
    }
  };

  // Marcar gasto como revisado
  const handleReviewExpense = async (expense: BoxExpense) => {
    try {
      await updateDoc(doc(db, `projects/${projectId}/boxExpenses`, expense.id), {
        status: "reviewed",
        reviewedAt: Timestamp.now(),
        reviewedBy: userId,
        reviewedByName: userName,
      });

      // Actualizar contador del sobre
      const envelope = envelopes.find(e => e.id === expense.envelopeId);
      if (envelope) {
        await updateDoc(doc(db, `projects/${projectId}/boxEnvelopes`, envelope.id), {
          reviewedCount: (envelope.reviewedCount || 0) + 1,
        });
      }

      showToast("success", "Gasto marcado como revisado");
      loadData();
    } catch (error) {
      console.error("Error:", error);
      showToast("error", "Error al actualizar gasto");
    }
  };

  // Cerrar sobre
  const handleCloseEnvelope = async (envelope: Envelope) => {
    const envelopeExpenses = expenses.filter(e => e.envelopeId === envelope.id);
    const pendingCount = envelopeExpenses.filter(e => e.status === "pending").length;

    if (pendingCount > 0) {
      showToast("error", `Hay ${pendingCount} gastos sin revisar`);
      return;
    }

    try {
      const batch = writeBatch(db);

      // Actualizar sobre
      batch.update(doc(db, `projects/${projectId}/boxEnvelopes`, envelope.id), {
        status: "closed",
        closedAt: Timestamp.now(),
        closedBy: userId,
        closedByName: userName,
      });

      // Marcar todos los gastos como contabilizados
      for (const expense of envelopeExpenses) {
        batch.update(doc(db, `projects/${projectId}/boxExpenses`, expense.id), {
          status: "accounted",
          accountedAt: Timestamp.now(),
        });

        // TODO: Actualizar realizado en presupuesto
      }

      await batch.commit();
      showToast("success", "Sobre cerrado y contabilizado");
      loadData();
    } catch (error) {
      console.error("Error:", error);
      showToast("error", "Error al cerrar sobre");
    }
  };

  // Datos filtrados
  const filteredBoxes = boxes.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const boxEnvelopes = selectedBox ? envelopes.filter(e => e.boxId === selectedBox.id) : [];
  const envelopeExpenses = selectedEnvelope ? expenses.filter(e => e.envelopeId === selectedEnvelope.id) : [];

  // Stats
  const totalBoxes = boxes.length;
  const openEnvelopes = envelopes.filter(e => e.status === "open").length;
  const pendingExpenses = expenses.filter(e => e.status === "pending").length;
  const totalExpensesAmount = expenses.reduce((sum, e) => sum + e.totalAmount, 0);

  // Loading
  if (loading || permissionsLoading) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // Sin acceso
  if (!hasAccess || accessError) {
    return (
      <div className={"min-h-screen bg-white flex items-center justify-center " + inter.className}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{accessError || "No tienes permisos"}</p>
          <Link href={`/project/${projectId}/accounting`} className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90" style={{ backgroundColor: "#2F52E0" }}>
            <ArrowLeft size={16} />
            Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={"min-h-screen bg-white " + inter.className}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          {toast.type === "success" ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Package size={24} style={{ color: "#2F52E0" }} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Cajas</h1>
                <p className="text-sm text-slate-500">Gestión de gastos Pleo</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span><strong className="text-slate-900">{totalBoxes}</strong> cajas</span>
                <span><strong className="text-amber-600">{openEnvelopes}</strong> sobres abiertos</span>
                <span><strong className="text-slate-900">{formatCurrency(totalExpensesAmount)} €</strong> total</span>
              </div>
              <button
                onClick={() => {
                  setBoxForm({ name: "", code: "", department: "" });
                  setShowCreateBoxModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90"
                style={{ backgroundColor: "#2F52E0" }}
              >
                <Plus size={16} />
                Nueva caja
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-8">
        <div className="flex gap-6">
          {/* Panel izquierdo - Lista de cajas */}
          <div className="w-72 flex-shrink-0">
            <div className="sticky top-24">
              <div className="mb-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Buscar caja"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                {filteredBoxes.map((box) => {
                  const boxEnvs = envelopes.filter(e => e.boxId === box.id);
                  const openCount = boxEnvs.filter(e => e.status === "open").length;
                  const isSelected = selectedBox?.id === box.id;

                  return (
                    <button
                      key={box.id}
                      onClick={() => {
                        setSelectedBox(box);
                        setSelectedEnvelope(null);
                        setSelectedExpense(null);
                      }}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        isSelected
                          ? "bg-slate-900 text-white"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                            isSelected ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                          }`}>
                            {box.code}
                          </div>
                          <div>
                            <p className={`text-sm font-medium ${isSelected ? "text-white" : "text-slate-900"}`}>
                              {box.name}
                            </p>
                            {box.department && (
                              <p className={`text-xs ${isSelected ? "text-white/70" : "text-slate-500"}`}>
                                {box.department}
                              </p>
                            )}
                          </div>
                        </div>
                        {openCount > 0 && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isSelected ? "bg-white/20 text-white" : "bg-amber-100 text-amber-700"
                          }`}>
                            {openCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}

                {filteredBoxes.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    {searchTerm ? "Sin resultados" : "No hay cajas"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Panel derecho - Contenido */}
          <div className="flex-1 min-w-0">
            {!selectedBox ? (
              /* Vista inicial sin caja seleccionada */
              <div className="flex items-center justify-center h-96">
                <div className="text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Package size={28} className="text-slate-400" />
                  </div>
                  <h3 className="text-lg font-medium text-slate-900 mb-2">Selecciona una caja</h3>
                  <p className="text-sm text-slate-500 mb-6">o crea una nueva para empezar</p>
                  <button
                    onClick={() => {
                      setBoxForm({ name: "", code: "", department: "" });
                      setShowCreateBoxModal(true);
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90"
                    style={{ backgroundColor: "#2F52E0" }}
                  >
                    <Plus size={16} />
                    Nueva caja
                  </button>
                </div>
              </div>
            ) : !selectedEnvelope ? (
              /* Vista de sobres de la caja */
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">{selectedBox.name}</h2>
                    <p className="text-sm text-slate-500">Código: {selectedBox.code} · {boxEnvelopes.length} sobres</p>
                  </div>
                  <button
                    onClick={() => setShowCreateEnvelopeModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                  >
                    <Plus size={16} />
                    Nuevo sobre
                  </button>
                </div>

                {boxEnvelopes.length === 0 ? (
                  <div className="flex items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-2xl">
                    <div className="text-center">
                      <Layers size={32} className="text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 mb-4">No hay sobres en esta caja</p>
                      <button
                        onClick={() => setShowCreateEnvelopeModal(true)}
                        className="text-sm text-slate-600 hover:text-slate-900 font-medium"
                      >
                        Crear primer sobre
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {boxEnvelopes.map((envelope) => {
                      const envExpenses = expenses.filter(e => e.envelopeId === envelope.id);
                      const pendingCount = envExpenses.filter(e => e.status === "pending").length;
                      const statusConfig = STATUS_CONFIG[envelope.status];

                      return (
                        <div
                          key={envelope.id}
                          onClick={() => setSelectedEnvelope(envelope)}
                          className="p-4 border border-slate-200 rounded-xl hover:border-slate-300 cursor-pointer transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                <Layers size={18} className="text-slate-500" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-slate-900">{envelope.displayNumber}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
                                    {statusConfig.label}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500">
                                  {envelope.expenseCount} gastos · {formatCurrency(envelope.totalAmount)} €
                                  {pendingCount > 0 && (
                                    <span className="text-amber-600 ml-2">· {pendingCount} pendientes</span>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-400">{formatDate(envelope.createdAt)}</span>
                              <ChevronRight size={16} className="text-slate-400" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Vista de gastos del sobre */
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => setSelectedEnvelope(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{selectedEnvelope.displayNumber}</h2>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CONFIG[selectedEnvelope.status].bg} ${STATUS_CONFIG[selectedEnvelope.status].text}`}>
                        {STATUS_CONFIG[selectedEnvelope.status].label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500">
                      {selectedEnvelope.expenseCount} gastos · Base: {formatCurrency(selectedEnvelope.totalBase)} € · Total: {formatCurrency(selectedEnvelope.totalAmount)} €
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedEnvelope.status === "open" && (
                      <>
                        <button
                          onClick={() => setShowImportModal(true)}
                          className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                        >
                          <Upload size={16} />
                          Importar Pleo
                        </button>
                        <button
                          onClick={() => handleCloseEnvelope(selectedEnvelope)}
                          disabled={envelopeExpenses.some(e => e.status === "pending")}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Lock size={16} />
                          Cerrar sobre
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {envelopeExpenses.length === 0 ? (
                  <div className="flex items-center justify-center h-64 border-2 border-dashed border-slate-200 rounded-2xl">
                    <div className="text-center">
                      <FileUp size={32} className="text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-500 mb-4">No hay gastos en este sobre</p>
                      <button
                        onClick={() => setShowImportModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90"
                        style={{ backgroundColor: "#2F52E0" }}
                      >
                        <Upload size={16} />
                        Importar desde Pleo
                      </button>
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
                          <th className="text-center px-4 py-3 font-medium text-slate-600">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {envelopeExpenses.map((expense) => {
                          const statusConfig = EXPENSE_STATUS_CONFIG[expense.status];
                          return (
                            <tr key={expense.id} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  {expense.type === "ticket" ? (
                                    <Receipt size={14} className="text-amber-500" />
                                  ) : (
                                    <FileText size={14} className="text-blue-500" />
                                  )}
                                  <span className="font-mono text-xs">{expense.displayNumber}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div>
                                  <p className="font-medium text-slate-900 truncate max-w-[200px]">{expense.supplier}</p>
                                  <p className="text-xs text-slate-500">{expense.supplierTaxId}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-mono text-xs text-slate-600">{expense.subAccountCode}</span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono">{formatCurrency(expense.baseAmount)}</td>
                              <td className="px-4 py-3 text-right font-mono text-emerald-600">+{formatCurrency(expense.vatAmount)}</td>
                              <td className="px-4 py-3 text-right font-mono font-medium">{formatCurrency(expense.totalAmount)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${statusConfig.bg} ${statusConfig.text}`}>
                                  {statusConfig.label}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  {expense.pleoUrl && (
                                    <a
                                      href={expense.pleoUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                                      title="Ver en Pleo"
                                    >
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                  {expense.status === "pending" && selectedEnvelope.status === "open" && (
                                    <button
                                      onClick={() => handleReviewExpense(expense)}
                                      className="p-1.5 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                                      title="Marcar revisado"
                                    >
                                      <Check size={14} />
                                    </button>
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
            )}
          </div>
        </div>
      </div>

      {/* Modal crear caja */}
      {showCreateBoxModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateBoxModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nueva caja</h3>
              <button onClick={() => setShowCreateBoxModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Nombre del responsable *</label>
                <input
                  type="text"
                  value={boxForm.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setBoxForm({ ...boxForm, name, code: boxForm.code || generateCode(name) });
                  }}
                  placeholder="Ej: Lucía García"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Código (iniciales) *</label>
                <input
                  type="text"
                  value={boxForm.code}
                  onChange={(e) => setBoxForm({ ...boxForm, code: e.target.value.toUpperCase().slice(0, 3) })}
                  placeholder="Ej: LG"
                  maxLength={3}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase"
                />
                <p className="text-xs text-slate-500 mt-1">2-3 caracteres para identificar los gastos</p>
              </div>
              <div ref={departmentDropdownRef} className="relative">
                <label className="block text-sm font-medium text-slate-700 mb-2">Departamento (opcional)</label>
                <button
                  type="button"
                  onClick={() => setShowDepartmentDropdown(!showDepartmentDropdown)}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between hover:border-slate-300"
                >
                  <span className={boxForm.department ? "text-slate-900" : "text-slate-400"}>
                    {boxForm.department || "Seleccionar"}
                  </span>
                  <ChevronDown size={16} className={"text-slate-400 transition-transform " + (showDepartmentDropdown ? "rotate-180" : "")} />
                </button>
                {showDepartmentDropdown && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => { setBoxForm({ ...boxForm, department: "" }); setShowDepartmentDropdown(false); }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-400 hover:bg-slate-50"
                    >
                      Sin departamento
                    </button>
                    {departments.map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => { setBoxForm({ ...boxForm, department: dept }); setShowDepartmentDropdown(false); }}
                        className={"w-full px-4 py-2 text-left text-sm hover:bg-slate-50 " + (boxForm.department === dept ? "bg-slate-50 font-medium" : "")}
                      >
                        {dept}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateBoxModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={handleCreateBox}
                disabled={saving || !boxForm.name.trim() || !boxForm.code.trim()}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}
              >
                {saving ? "Creando..." : "Crear caja"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal crear sobre */}
      {showCreateEnvelopeModal && selectedBox && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateEnvelopeModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Nuevo sobre</h3>
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Layers size={28} className="text-slate-500" />
                </div>
                <p className="text-slate-900 font-medium mb-1">
                  ENV-{selectedBox.code}-{String(selectedBox.nextEnvelopeNumber || 1).padStart(3, "0")}
                </p>
                <p className="text-sm text-slate-500">
                  Se creará un nuevo sobre para {selectedBox.name}
                </p>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setShowCreateEnvelopeModal(false)} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={handleCreateEnvelope}
                disabled={saving}
                className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ backgroundColor: "#2F52E0" }}
              >
                {saving ? "Creando..." : "Crear sobre"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal importar Pleo */}
      {showImportModal && selectedEnvelope && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Importar desde Pleo</h3>
                <p className="text-sm text-slate-500">Sube el archivo Excel exportado de Pleo</p>
              </div>
              <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto">
              {!importFile ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file && file.name.endsWith(".xlsx")) handleFileSelect(file);
                  }}
                  className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
                    isDragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <Upload size={40} className="text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-600 mb-2">Arrastra el archivo Excel aquí</p>
                  <p className="text-sm text-slate-400 mb-4">o</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 cursor-pointer">
                    <FileSpreadsheet size={16} />
                    Seleccionar archivo
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                      className="hidden"
                    />
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
                    <button
                      onClick={() => { setImportFile(null); setImportPreview([]); }}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded"
                    >
                      <X size={16} />
                    </button>
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
                          {importPreview.slice(0, 10).map((exp, idx) => (
                            <tr key={idx}>
                              <td className="px-3 py-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${exp.type === "ticket" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                                  {exp.type === "ticket" ? "Ticket" : "Factura"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <p className="font-medium text-slate-900 truncate max-w-[200px]">{capitalizeSupplierName(exp.supplier)}</p>
                                <p className="text-xs text-slate-500">{exp.supplierTaxId}</p>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{exp.subAccountCode}</td>
                              <td className="px-3 py-2 text-right font-mono font-medium">{formatCurrency(exp.totalAmount)} €</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importPreview.length > 10 && (
                        <div className="px-3 py-2 bg-slate-50 text-xs text-slate-500 text-center">
                          +{importPreview.length - 10} gastos más
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center flex-shrink-0">
              <div className="text-sm text-slate-500">
                {importPreview.length > 0 && (
                  <span>Total: <strong className="text-slate-900">{formatCurrency(importPreview.reduce((sum, e) => sum + e.totalAmount, 0))} €</strong></span>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview([]); }} className="px-4 py-2 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100">
                  Cancelar
                </button>
                <button
                  onClick={handleImportExpenses}
                  disabled={importing || importPreview.length === 0}
                  className="px-4 py-2 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  {importing ? "Importando..." : `Importar ${importPreview.length} gastos`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
