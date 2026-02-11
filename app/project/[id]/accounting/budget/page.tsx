"use client";
import React, { useState, useEffect, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, Timestamp } from "firebase/firestore";
import { Plus, ChevronDown, ChevronRight, Edit, Trash2, X, Search, Upload, AlertCircle, CheckCircle, FileSpreadsheet, Eye, EyeOff, Wallet, ShieldAlert, ArrowLeft, Download } from "lucide-react";
import { getCostSettings, shouldCommitPO, shouldRealizeInvoice, CostSettings } from "@/lib/budgetRules";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface SubAccount { id: string; code: string; description: string; budgeted: number; committed: number; actual: number; accountId: string; createdAt: Date; }
interface Account { id: string; code: string; description: string; subAccounts: SubAccount[]; createdAt: Date; }
interface BudgetSummary { totalBudgeted: number; totalCommitted: number; totalActual: number; totalAvailable: number; }

export default function BudgetPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"account" | "subaccount">("account");
  const [editMode, setEditMode] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedSubAccount, setSelectedSubAccount] = useState<SubAccount | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [costConfig, setCostConfig] = useState<CostSettings>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_paid",
  });

  const [formData, setFormData] = useState({ code: "", description: "", budgeted: 0 });
  const [summary, setSummary] = useState<BudgetSummary>({ totalBudgeted: 0, totalCommitted: 0, totalActual: 0, totalAvailable: 0 });

  // Estados para el importador mejorado
  const [importStep, setImportStep] = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [importData, setImportData] = useState<{ code: string; description: string; type: string; budgeted: number; valid: boolean; error?: string }[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ accounts: number; subaccounts: number; errors: number }>({ accounts: 0, subaccounts: 0, errors: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [importFileName, setImportFileName] = useState("");

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => { if (user) setUserId(user.uid); });
    return () => unsubscribe();
  }, []);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);
  useEffect(() => { calculateSummary(); }, [accounts]);

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMessage("");
      
      // Verificar acceso: solo accounting_extended o EP/PM
      const userProjectRef = doc(db, `userProjects/${userId}/projects/${id}`);
      const userProjectSnap = await getDoc(userProjectRef);
      if (!userProjectSnap.exists()) {
        setAccessError("No tienes acceso a este proyecto");
        setLoading(false);
        return;
      }
      
      const userProjectData = userProjectSnap.data();
      const hasAccountingAccess = userProjectData.permissions?.accounting || false;
      const accountingLevel = userProjectData.accountingAccessLevel;
      
      const memberRef = doc(db, `projects/${id}/members`, userId!);
      const memberSnap = await getDoc(memberRef);
      const memberData = memberSnap.exists() ? memberSnap.data() : null;
      const isEPorPM = memberData && ["EP", "PM"].includes(memberData.role);
      const hasExtendedAccess = accountingLevel === "accounting_extended";
      
      if (!hasAccountingAccess || (!isEPorPM && !hasExtendedAccess)) {
        setAccessError("No tienes permisos para acceder al presupuesto");
        setLoading(false);
        return;
      }
      setHasAccess(true);
      
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      // Cargar configuración de costes usando budgetRules
      const loadedCostConfig = await getCostSettings(id);
      setCostConfig(loadedCostConfig);

      // Cargar POs y calcular committed por subcuenta
      // Comprometido = baseAmount - invoicedAmount (lo pendiente de facturar)
      // Si item cerrado: committed = 0 (se liberó el resto)
      const committedBySubaccount: Record<string, number> = {};
      const posSnapshot = await getDocs(collection(db, `projects/${id}/pos`));
      posSnapshot.docs.forEach(poDoc => {
        const poData = poDoc.data();
        // Usar shouldCommitPO de budgetRules para determinar si cuenta
        if (poData.status && shouldCommitPO(poData.status, loadedCostConfig) && poData.items) {
          poData.items.forEach((item: any) => {
            if (item.subAccountCode) {
              const key = item.subAccountCode;
              // Si el item está cerrado, no hay comprometido pendiente
              // Si está abierto, el comprometido es lo que falta por facturar
              const itemInvoiced = item.invoicedAmount || 0;
              const itemBase = item.baseAmount || 0;
              const itemCommitted = item.isClosed 
                ? 0 
                : Math.max(0, itemBase - itemInvoiced);
              committedBySubaccount[key] = (committedBySubaccount[key] || 0) + itemCommitted;
            }
          });
        }
      });

      // Cargar Facturas y calcular actual por subcuenta
      const actualBySubaccount: Record<string, number> = {};
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
      invoicesSnapshot.docs.forEach(invDoc => {
        const invData = invDoc.data();
        // Usar shouldRealizeInvoice de budgetRules para determinar si cuenta
        if (invData.status && shouldRealizeInvoice(invData.status, loadedCostConfig) && invData.items) {
          invData.items.forEach((item: any) => {
            if (item.subAccountCode) {
              const key = item.subAccountCode;
              actualBySubaccount[key] = (actualBySubaccount[key] || 0) + (item.baseAmount || 0);
            }
          });
        }
      });

      // Cargar cuentas y subcuentas
      const accountsRef = collection(db, `projects/${id}/accounts`);
      const accountsQuery = query(accountsRef, orderBy("code", "asc"));
      const accountsSnapshot = await getDocs(accountsQuery);

      const accountsData = await Promise.all(
        accountsSnapshot.docs.map(async (accountDoc) => {
          const subAccountsRef = collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`);
          const subAccountsQuery = query(subAccountsRef, orderBy("code", "asc"));
          const subAccountsSnapshot = await getDocs(subAccountsQuery);
          const subAccounts = subAccountsSnapshot.docs.map((subDoc) => {
            const subData = subDoc.data();
            const subCode = subData.code || "";
            return {
              id: subDoc.id,
              code: subCode,
              description: subData.description || "",
              budgeted: subData.budgeted || 0,
              committed: committedBySubaccount[subCode] || 0,
              actual: actualBySubaccount[subCode] || 0,
              accountId: accountDoc.id,
              createdAt: subData.createdAt?.toDate() || new Date(),
            };
          }) as SubAccount[];
          return {
            id: accountDoc.id,
            code: accountDoc.data().code || "",
            description: accountDoc.data().description || "",
            subAccounts,
            createdAt: accountDoc.data().createdAt?.toDate() || new Date(),
          } as Account;
        })
      );
      setAccounts(accountsData);
      setExpandedAccounts(new Set(accountsData.map(a => a.id)));
    } catch (error: any) {
      setErrorMessage(`Error cargando datos: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const calculateSummary = () => {
    let totalBudgeted = 0, totalCommitted = 0, totalActual = 0;
    accounts.forEach((account) => {
      account.subAccounts.forEach((sub) => {
        totalBudgeted += sub.budgeted || 0;
        totalCommitted += sub.committed || 0;
        totalActual += sub.actual || 0;
      });
    });
    setSummary({ totalBudgeted, totalCommitted, totalActual, totalAvailable: totalBudgeted - totalCommitted - totalActual });
  };

  const getAccountTotals = (account: Account) => {
    const budgeted = account.subAccounts.reduce((sum, sub) => sum + (sub.budgeted || 0), 0);
    const committed = account.subAccounts.reduce((sum, sub) => sum + (sub.committed || 0), 0);
    const actual = account.subAccounts.reduce((sum, sub) => sum + (sub.actual || 0), 0);
    return { budgeted, committed, actual, available: budgeted - committed - actual, executed: committed + actual };
  };

  const toggleAccount = (accountId: string) => {
    const newExpanded = new Set(expandedAccounts);
    if (newExpanded.has(accountId)) newExpanded.delete(accountId);
    else newExpanded.add(accountId);
    setExpandedAccounts(newExpanded);
  };

  const handleCreateAccount = async () => {
    if (!formData.code.trim() || !formData.description.trim()) { setErrorMessage("El código y la descripción son obligatorios"); return; }
    setSaving(true); setErrorMessage("");
    try {
      await addDoc(collection(db, `projects/${id}/accounts`), { code: formData.code.trim(), description: formData.description.trim(), createdAt: Timestamp.now(), createdBy: userId || "" });
      setSuccessMessage("Cuenta creada correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(`Error creando cuenta: ${error.message}`); } finally { setSaving(false); }
  };

  const handleUpdateAccount = async () => {
    if (!selectedAccount) return;
    if (!formData.code.trim() || !formData.description.trim()) { setErrorMessage("El código y la descripción son obligatorios"); return; }
    setSaving(true); setErrorMessage("");
    try {
      await updateDoc(doc(db, `projects/${id}/accounts`, selectedAccount.id), { code: formData.code.trim(), description: formData.description.trim() });
      setSuccessMessage("Cuenta actualizada correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(`Error actualizando cuenta: ${error.message}`); } finally { setSaving(false); }
  };

  const handleCreateSubAccount = async () => {
    if (!selectedAccount) { setErrorMessage("Debes seleccionar una cuenta padre"); return; }
    if (!formData.code.trim() || !formData.description.trim()) { setErrorMessage("El código y la descripción son obligatorios"); return; }
    setSaving(true); setErrorMessage("");
    try {
      await addDoc(collection(db, `projects/${id}/accounts/${selectedAccount.id}/subaccounts`), {
        code: formData.code.trim(), description: formData.description.trim(), budgeted: formData.budgeted || 0,
        committed: 0, actual: 0, accountId: selectedAccount.id, createdAt: Timestamp.now(), createdBy: userId || "",
      });
      setSuccessMessage("Subcuenta creada correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(`Error creando subcuenta: ${error.message}`); } finally { setSaving(false); }
  };

  const handleUpdateSubAccount = async () => {
    if (!selectedAccount || !selectedSubAccount) { setErrorMessage("Error: No se encontró la subcuenta"); return; }
    setSaving(true); setErrorMessage("");
    try {
      await updateDoc(doc(db, `projects/${id}/accounts/${selectedAccount.id}/subaccounts`, selectedSubAccount.id), {
        code: formData.code.trim(), description: formData.description.trim(), budgeted: formData.budgeted || 0,
      });
      setSuccessMessage("Subcuenta actualizada correctamente"); setTimeout(() => setSuccessMessage(""), 3000);
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(`Error actualizando subcuenta: ${error.message}`); } finally { setSaving(false); }
  };

  const handleDeleteAccount = async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (account && account.subAccounts.length > 0) { setErrorMessage("No se puede eliminar una cuenta con subcuentas"); setTimeout(() => setErrorMessage(""), 5000); return; }
    if (!confirm("¿Eliminar esta cuenta?")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/accounts`, accountId));
      setSuccessMessage("Cuenta eliminada"); setTimeout(() => setSuccessMessage(""), 3000); await loadData();
    } catch (error: any) { setErrorMessage(`Error eliminando cuenta: ${error.message}`); }
  };

  const handleDeleteSubAccount = async (accountId: string, subAccountId: string) => {
    if (!confirm("¿Eliminar esta subcuenta?")) return;
    try {
      await deleteDoc(doc(db, `projects/${id}/accounts/${accountId}/subaccounts`, subAccountId));
      setSuccessMessage("Subcuenta eliminada"); setTimeout(() => setSuccessMessage(""), 3000); await loadData();
    } catch (error: any) { setErrorMessage(`Error eliminando subcuenta: ${error.message}`); }
  };

  const resetForm = () => { setFormData({ code: "", description: "", budgeted: 0 }); setSelectedAccount(null); setSelectedSubAccount(null); setEditMode(false); setErrorMessage(""); };

  const openCreateAccountModal = () => { resetForm(); setModalMode("account"); setEditMode(false); setShowModal(true); };
  const openEditAccountModal = (account: Account) => { setSelectedAccount(account); setFormData({ code: account.code, description: account.description, budgeted: 0 }); setModalMode("account"); setEditMode(true); setShowModal(true); };
  const openCreateSubAccountModal = (account: Account) => { resetForm(); setSelectedAccount(account); setFormData({ code: "", description: "", budgeted: 0 }); setModalMode("subaccount"); setEditMode(false); setShowModal(true); };
  const openEditSubAccountModal = (account: Account, subAccount: SubAccount) => { setSelectedAccount(account); setSelectedSubAccount(subAccount); setFormData({ code: subAccount.code, description: subAccount.description, budgeted: subAccount.budgeted }); setModalMode("subaccount"); setEditMode(true); setShowModal(true); };

  const downloadTemplate = () => {
    const template = [["CÓDIGO", "DESCRIPCIÓN", "TIPO", "PRESUPUESTADO"], ["01", "GUION Y MÚSICA", "CUENTA", ""], ["01.01", "Derechos de autor", "SUBCUENTA", "5000"], ["01.02", "Música original", "SUBCUENTA", "3000"], ["02", "PRODUCCIÓN", "CUENTA", ""], ["02.01", "Equipo técnico", "SUBCUENTA", "10000"]];
    const csvContent = template.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob)); link.setAttribute("download", "plantilla_presupuesto.csv"); link.click();
  };

  const parseImportFile = (text: string): { code: string; description: string; type: string; budgeted: number; valid: boolean; error?: string }[] => {
    const lines = text.split("\n").slice(1); // Skip header
    const data: { code: string; description: string; type: string; budgeted: number; valid: boolean; error?: string }[] = [];
    
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      const [code, description, type, budgeted] = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      
      let valid = true;
      let error = "";
      
      if (!code) { valid = false; error = "Código vacío"; }
      else if (!description) { valid = false; error = "Descripción vacía"; }
      else if (!type || !["CUENTA", "SUBCUENTA"].includes(type.toUpperCase())) { 
        valid = false; 
        error = "Tipo debe ser CUENTA o SUBCUENTA"; 
      }
      else if (type.toUpperCase() === "SUBCUENTA") {
        const accountCode = code.split(/[.\-]/)[0];
        const hasParentInData = data.some(d => d.code === accountCode && d.type.toUpperCase() === "CUENTA");
        const hasParentInExisting = accounts.some(a => a.code === accountCode);
        if (!hasParentInData && !hasParentInExisting) {
          valid = false;
          error = `Cuenta padre ${accountCode} no existe`;
        }
      }
      
      data.push({
        code: code || "",
        description: description || "",
        type: type?.toUpperCase() || "",
        budgeted: parseFloat(budgeted) || 0,
        valid,
        error,
      });
    });
    
    return data;
  };

  const handleFileSelect = (file: File) => {
    if (!file) return;
    setImportFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseImportFile(text);
      setImportData(parsed);
      setImportStep("preview");
    };
    reader.readAsText(file);
  };

  const handleImportCSV = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith(".csv")) {
      handleFileSelect(file);
    } else {
      setErrorMessage("Por favor, sube un archivo CSV");
    }
  };

  const executeImport = async () => {
    setImportStep("importing");
    setImportProgress(0);
    setSaving(true);
    
    const validItems = importData.filter(d => d.valid);
    const total = validItems.length;
    let processed = 0;
    let accountsCreated = 0;
    let subAccountsCreated = 0;
    let errors = 0;
    
    const accountsMap = new Map<string, string>();
    
    try {
      // First pass: Create accounts
      for (const item of validItems) {
        if (item.type === "CUENTA") {
          try {
            const accountRef = await addDoc(collection(db, `projects/${id}/accounts`), {
              code: item.code,
              description: item.description,
              createdAt: Timestamp.now(),
              createdBy: userId || "",
            });
            accountsMap.set(item.code, accountRef.id);
            accountsCreated++;
          } catch (err) {
            errors++;
          }
        }
        processed++;
        setImportProgress(Math.round((processed / total) * 100));
      }
      
      // Second pass: Create subaccounts
      for (const item of validItems) {
        if (item.type === "SUBCUENTA") {
          try {
            const accountCode = item.code.split(/[.\-]/)[0];
            let accountId = accountsMap.get(accountCode);
            if (!accountId) {
              const existingAccount = accounts.find(a => a.code === accountCode);
              if (existingAccount) accountId = existingAccount.id;
            }
            
            if (accountId) {
              await addDoc(collection(db, `projects/${id}/accounts/${accountId}/subaccounts`), {
                code: item.code,
                description: item.description,
                budgeted: item.budgeted,
                committed: 0,
                actual: 0,
                accountId,
                createdAt: Timestamp.now(),
                createdBy: userId || "",
              });
              subAccountsCreated++;
            } else {
              errors++;
            }
          } catch (err) {
            errors++;
          }
        }
        processed++;
        setImportProgress(Math.round((processed / total) * 100));
      }
      
      setImportResults({ accounts: accountsCreated, subaccounts: subAccountsCreated, errors });
      setImportStep("done");
      await loadData();
    } catch (error: any) {
      setErrorMessage(`Error al importar: ${error.message}`);
      setImportStep("preview");
    } finally {
      setSaving(false);
    }
  };

  const resetImport = () => {
    setImportStep("upload");
    setImportData([]);
    setImportProgress(0);
    setImportResults({ accounts: 0, subaccounts: 0, errors: 0 });
    setImportFileName("");
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    resetImport();
  };

  const filteredAccounts = accounts.filter((account) => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return account.code.toLowerCase().includes(searchLower) || account.description.toLowerCase().includes(searchLower) || account.subAccounts.some((sub) => sub.code.toLowerCase().includes(searchLower) || sub.description.toLowerCase().includes(searchLower));
  });

  const expandAll = () => setExpandedAccounts(new Set(accounts.map((a) => a.id)));
  const collapseAll = () => setExpandedAccounts(new Set());

  const formatCurrency = (amount: number): string => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

  const getExecutionPercent = (executed: number, budgeted: number): number => budgeted > 0 ? (executed / budgeted) * 100 : 0;

  const getStatusIndicator = (available: number, budgeted: number) => {
    if (budgeted === 0) return { color: "bg-slate-300", text: "text-slate-600" };
    const percent = (available / budgeted) * 100;
    if (available < 0) return { color: "bg-red-500", text: "text-red-700 font-bold" };
    if (percent < 10) return { color: "bg-red-400", text: "text-red-600 font-semibold" };
    if (percent < 25) return { color: "bg-amber-400", text: "text-amber-600 font-medium" };
    return { color: "bg-emerald-400", text: "text-emerald-600" };
  };

  const getProgressColor = (percent: number) => {
    if (percent > 100) return "bg-red-500";
    if (percent > 90) return "bg-red-400";
    if (percent > 75) return "bg-amber-400";
    return "bg-emerald-500";
  };

  const totalExecuted = summary.totalCommitted + summary.totalActual;
  const totalExecutionPercent = summary.totalBudgeted > 0 ? (totalExecuted / summary.totalBudgeted) * 100 : 0;

  if (loading) {
    return (<div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" /></div>);
  }

  if (accessError || !hasAccess) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert size={28} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Acceso denegado</h2>
          <p className="text-slate-500 mb-6">{accessError || "No tienes permisos para acceder a esta página"}</p>
          <Link
            href={`/project/${id}/accounting`}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
            style={{ backgroundColor: "#2F52E0" }}
          >
            <ArrowLeft size={16} />
            Volver al panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          {/* Page header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Wallet size={24} style={{ color: '#2F52E0' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Presupuesto</h1>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
                <Upload size={16} />Importar
              </button>
              <button onClick={openCreateAccountModal} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: '#2F52E0' }}>
                <Plus size={16} strokeWidth={2.5} />Nueva cuenta
              </button>
            </div>
          </div>

          {/* Summary Stats - Compacto */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Presupuestado</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">{formatCurrency(summary.totalBudgeted)} €</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Comprometido</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">{formatCurrency(summary.totalCommitted)} €</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Realizado</p>
              <p className="text-base font-bold text-slate-900 tabular-nums">{formatCurrency(summary.totalActual)} €</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Disponible</p>
              <p className={`text-base font-bold tabular-nums ${summary.totalAvailable < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(summary.totalAvailable)} €</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 col-span-2 md:col-span-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">% Ejecución</p>
              <div className="flex items-center gap-2">
                <p className={`text-base font-bold tabular-nums ${totalExecutionPercent > 100 ? 'text-red-600' : totalExecutionPercent > 90 ? 'text-amber-600' : 'text-slate-900'}`}>{totalExecutionPercent.toFixed(1)}%</p>
                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${getProgressColor(totalExecutionPercent)}`} style={{ width: `${Math.min(totalExecutionPercent, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {/* Messages */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 text-sm">
            <AlertCircle size={18} /><span className="flex-1">{errorMessage}</span>
            <button onClick={() => setErrorMessage("")}><X size={14} /></button>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-700 text-sm">
            <CheckCircle size={18} /><span>{successMessage}</span>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Buscar cuentas" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" />
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={expandAll} className="px-3 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-xs font-medium"><Eye size={14} />Expandir</button>
            <button onClick={collapseAll} className="px-3 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-xs font-medium"><EyeOff size={14} />Colapsar</button>
          </div>
        </div>

        {/* Budget Table */}
        {filteredAccounts.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <FileSpreadsheet size={32} className="text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900 mb-1">{searchTerm ? "No se encontraron cuentas" : "No hay cuentas presupuestarias"}</h3>
            <p className="text-slate-500 text-sm">{searchTerm ? "Intenta ajustar la búsqueda" : "Crea tu primera cuenta o importa un presupuesto"}</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left pl-4 pr-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider w-8"></th>
                  <th className="text-left px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[80px]">Código</th>
                  <th className="text-left px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[200px]">Descripción</th>
                  <th className="text-right px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Presupuesto</th>
                  <th className="text-right px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Comprometido</th>
                  <th className="text-right px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Realizado</th>
                  <th className="text-right px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Disponible</th>
                  <th className="text-center px-2 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[80px]">% Ejec.</th>
                  <th className="text-right px-4 py-2.5 min-w-[90px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAccounts.map((account) => {
                  const totals = getAccountTotals(account);
                  const isExpanded = expandedAccounts.has(account.id);
                  const execPercent = getExecutionPercent(totals.executed, totals.budgeted);
                  const status = getStatusIndicator(totals.available, totals.budgeted);

                  return (
                    <React.Fragment key={account.id}>
                      {/* Account Row */}
                      <tr className="bg-slate-50/80 hover:bg-slate-100/80 transition-colors">
                        <td className="pl-4 pr-2 py-2">
                          <button onClick={() => toggleAccount(account.id)} className="text-slate-500 hover:text-slate-900 p-0.5">
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-2 py-2 font-bold text-slate-900 text-xs">{account.code}</td>
                        <td className="px-2 py-2 font-semibold text-slate-900 text-xs">{account.description}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-900 tabular-nums text-xs">{formatCurrency(totals.budgeted)}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-700 tabular-nums text-xs">{formatCurrency(totals.committed)}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-700 tabular-nums text-xs">{formatCurrency(totals.actual)}</td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${status.color}`}></span>
                            <span className={`font-bold tabular-nums text-xs ${status.text}`}>{formatCurrency(totals.available)}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${getProgressColor(execPercent)}`} style={{ width: `${Math.min(execPercent, 100)}%` }} />
                            </div>
                            <span className={`text-[10px] font-bold tabular-nums w-8 text-right ${execPercent > 100 ? 'text-red-600' : 'text-slate-600'}`}>{execPercent.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => openCreateSubAccountModal(account)} className="p-1 text-slate-400 hover:text-[#2F52E0] hover:bg-blue-50 rounded" title="Añadir subcuenta"><Plus size={14} /></button>
                            <button onClick={() => openEditAccountModal(account)} className="p-1 text-slate-400 hover:text-[#2F52E0] hover:bg-blue-50 rounded" title="Editar"><Edit size={14} /></button>
                            <button onClick={() => handleDeleteAccount(account.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>

                      {/* SubAccount Rows */}
                      {isExpanded && account.subAccounts.map((subAccount, subIndex) => {
                        const available = subAccount.budgeted - subAccount.committed - subAccount.actual;
                        const executed = subAccount.committed + subAccount.actual;
                        const subExecPercent = getExecutionPercent(executed, subAccount.budgeted);
                        const subStatus = getStatusIndicator(available, subAccount.budgeted);
                        const isLast = subIndex === account.subAccounts.length - 1;

                        return (
                          <tr key={subAccount.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="pl-4 pr-2 py-1.5">
                              <div className="flex items-center h-full">
                                <div className={`w-4 border-l-2 border-b-2 border-slate-200 ${isLast ? 'h-3 rounded-bl' : 'h-full'}`}></div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-slate-500 text-xs font-medium">{subAccount.code}</td>
                            <td className="px-2 py-1.5 text-slate-700 text-xs">{subAccount.description}</td>
                            <td className="px-2 py-1.5 text-right text-slate-900 tabular-nums text-xs">{formatCurrency(subAccount.budgeted)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums text-xs">{formatCurrency(subAccount.committed)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums text-xs">{formatCurrency(subAccount.actual)}</td>
                            <td className="px-2 py-1.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${subStatus.color}`}></span>
                                <span className={`tabular-nums text-xs ${subStatus.text}`}>{formatCurrency(available)}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${getProgressColor(subExecPercent)}`} style={{ width: `${Math.min(subExecPercent, 100)}%` }} />
                                </div>
                                <span className={`text-[10px] tabular-nums w-8 text-right ${subExecPercent > 100 ? 'text-red-600' : 'text-slate-500'}`}>{subExecPercent.toFixed(0)}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-1.5">
                              <div className="flex items-center justify-end gap-0.5">
                                <button onClick={() => openEditSubAccountModal(account, subAccount)} className="p-1 text-slate-400 hover:text-[#2F52E0] hover:bg-blue-50 rounded" title="Editar"><Edit size={12} /></button>
                                <button onClick={() => handleDeleteSubAccount(account.id, subAccount.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar"><Trash2 size={12} /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}

                {/* Total Row */}
                <tr className="bg-slate-900 text-white">
                  <td className="pl-4 pr-2 py-3"></td>
                  <td className="px-2 py-3 font-bold text-xs" colSpan={2}>TOTAL PRESUPUESTO</td>
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-xs">{formatCurrency(summary.totalBudgeted)}</td>
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-xs">{formatCurrency(summary.totalCommitted)}</td>
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-xs">{formatCurrency(summary.totalActual)}</td>
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-xs">{formatCurrency(summary.totalAvailable)}</td>
                  <td className="px-2 py-3 text-center font-bold text-xs">{totalExecutionPercent.toFixed(1)}%</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {modalMode === "account" ? (editMode ? "Editar cuenta" : "Nueva cuenta") : (editMode ? "Editar subcuenta" : "Nueva subcuenta")}
              </h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>

            <div className="p-6">
              {errorMessage && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle size={16} />{errorMessage}
                </div>
              )}

              {modalMode === "subaccount" && selectedAccount && (
                <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-500">Cuenta padre</p>
                  <p className="text-sm font-medium text-slate-900">{selectedAccount.code} - {selectedAccount.description}</p>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Código</label>
                  <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder={modalMode === "account" ? "Ej: 01, 02, A1..." : "Ej: 01.01, 02-A, 1.1.1..."} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 " />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Descripción</label>
                  <input type="text" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Nombre de la cuenta o subcuenta" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                {modalMode === "subaccount" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Presupuesto (€)</label>
                    <input type="number" value={formData.budgeted} onChange={(e) => setFormData({ ...formData, budgeted: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 " min="0" step="0.01" />
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-6 border-t border-slate-200">
                <button onClick={() => { setShowModal(false); resetForm(); }} className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">Cancelar</button>
                <button onClick={modalMode === "account" ? (editMode ? handleUpdateAccount : handleCreateAccount) : (editMode ? handleUpdateSubAccount : handleCreateSubAccount)} disabled={saving} className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium disabled:opacity-50 flex items-center gap-2">
                  {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {editMode ? "Guardar cambios" : (modalMode === "account" ? "Crear cuenta" : "Crear subcuenta")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal - Super Guay */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeImportModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
                  <Upload size={20} className="text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Importar presupuesto</h2>
                  <p className="text-xs text-slate-500">
                    {importStep === "upload" && "Sube un archivo CSV con tu presupuesto"}
                    {importStep === "preview" && `${importData.length} filas encontradas`}
                    {importStep === "importing" && "Importando datos..."}
                    {importStep === "done" && "¡Importación completada!"}
                  </p>
                </div>
              </div>
              <button onClick={closeImportModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            {/* Progress Steps */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
              <div className="flex items-center justify-center gap-2">
                {[
                  { step: "upload", label: "Subir" },
                  { step: "preview", label: "Revisar" },
                  { step: "importing", label: "Importar" },
                  { step: "done", label: "Listo" },
                ].map((s, index) => (
                  <React.Fragment key={s.step}>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      importStep === s.step 
                        ? "bg-emerald-100 text-emerald-700" 
                        : ["preview", "importing", "done"].indexOf(importStep) >= ["preview", "importing", "done"].indexOf(s.step as any)
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-200 text-slate-500"
                    }`}>
                      {["preview", "importing", "done"].indexOf(importStep) > ["preview", "importing", "done"].indexOf(s.step as any) ? (
                        <CheckCircle size={14} />
                      ) : (
                        <span className="w-5 h-5 rounded-full bg-current/20 flex items-center justify-center text-xs">{index + 1}</span>
                      )}
                      {s.label}
                    </div>
                    {index < 3 && <ChevronRight size={16} className="text-slate-300" />}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto">
              {/* Step 1: Upload */}
              {importStep === "upload" && (
                <div className="p-6 space-y-6">
                  {/* Drag & Drop Zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all ${
                      isDragging 
                        ? "border-emerald-500 bg-emerald-50" 
                        : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-colors ${
                      isDragging ? "bg-emerald-100" : "bg-slate-100"
                    }`}>
                      <FileSpreadsheet size={32} className={isDragging ? "text-emerald-600" : "text-slate-400"} />
                    </div>
                    <p className="text-lg font-medium text-slate-900 mb-1">
                      {isDragging ? "¡Suelta el archivo aquí!" : "Arrastra tu archivo CSV aquí"}
                    </p>
                    <p className="text-sm text-slate-500 mb-4">o haz clic para seleccionar</p>
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
                        <Upload size={16} />
                        Seleccionar archivo
                      </span>
                      <input type="file" accept=".csv" onChange={handleImportCSV} className="hidden" />
                    </label>
                  </div>

                  {/* Template Download */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Download size={24} className="text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 mb-1">¿Primera vez importando?</h3>
                        <p className="text-sm text-slate-600 mb-3">
                          Descarga nuestra plantilla con el formato correcto y ejemplos incluidos.
                        </p>
                        <button 
                          onClick={downloadTemplate}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Download size={14} />
                          Descargar plantilla CSV
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Format Info */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="font-medium text-slate-900 mb-2 text-sm">Formato esperado:</h4>
                    <div className="font-mono text-xs bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto">
                      <div className="text-slate-500">Código, Descripción, Tipo, Presupuesto</div>
                      <div className="text-slate-700">01, Producción, CUENTA, 0</div>
                      <div className="text-slate-700">01.01, Equipo técnico, SUBCUENTA, 50000</div>
                      <div className="text-slate-700">01.02, Material, SUBCUENTA, 25000</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Preview */}
              {importStep === "preview" && (
                <div className="p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <FileSpreadsheet size={16} className="text-slate-600" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900 text-sm">{importFileName}</p>
                        <p className="text-xs text-slate-500">{importData.length} filas · {importData.filter(d => d.valid).length} válidas</p>
                      </div>
                    </div>
                    <button
                      onClick={resetImport}
                      className="text-sm text-slate-500 hover:text-slate-700"
                    >
                      Cambiar archivo
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-blue-700">{importData.filter(d => d.type === "CUENTA").length}</p>
                      <p className="text-xs text-blue-600">Cuentas</p>
                    </div>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-700">{importData.filter(d => d.type === "SUBCUENTA").length}</p>
                      <p className="text-xs text-emerald-600">Subcuentas</p>
                    </div>
                    <div className={`border rounded-xl p-3 text-center ${importData.filter(d => !d.valid).length > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                      <p className={`text-2xl font-bold ${importData.filter(d => !d.valid).length > 0 ? "text-red-700" : "text-slate-400"}`}>
                        {importData.filter(d => !d.valid).length}
                      </p>
                      <p className={`text-xs ${importData.filter(d => !d.valid).length > 0 ? "text-red-600" : "text-slate-500"}`}>Errores</p>
                    </div>
                  </div>

                  {/* Table Preview */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="max-h-64 overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Estado</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Código</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Descripción</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">Tipo</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-slate-500 uppercase">Presupuesto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {importData.map((row, index) => (
                            <tr key={index} className={row.valid ? "bg-white" : "bg-red-50"}>
                              <td className="px-3 py-2">
                                {row.valid ? (
                                  <CheckCircle size={16} className="text-emerald-500" />
                                ) : (
                                  <div className="group relative">
                                    <AlertCircle size={16} className="text-red-500" />
                                    <div className="absolute left-6 top-0 bg-red-600 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                                      {row.error}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-900">{row.code}</td>
                              <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]">{row.description}</td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  row.type === "CUENTA" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                                }`}>
                                  {row.type}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-slate-900">
                                {row.budgeted > 0 ? formatCurrency(row.budgeted) : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {importData.filter(d => !d.valid).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                      <AlertCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-amber-900 text-sm">Hay {importData.filter(d => !d.valid).length} filas con errores</p>
                        <p className="text-xs text-amber-700 mt-1">Las filas con errores serán ignoradas durante la importación.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Importing */}
              {importStep === "importing" && (
                <div className="p-12 text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6 relative">
                    <div className="absolute inset-0 rounded-full border-4 border-emerald-200">
                      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                        <circle
                          cx="50" cy="50" r="46"
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="8"
                          strokeDasharray={`${importProgress * 2.89} 289`}
                          className="transition-all duration-300"
                        />
                      </svg>
                    </div>
                    <span className="text-2xl font-bold text-emerald-700">{importProgress}%</span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">Importando datos...</h3>
                  <p className="text-sm text-slate-500">Por favor, no cierres esta ventana</p>
                </div>
              )}

              {/* Step 4: Done */}
              {importStep === "done" && (
                <div className="p-12 text-center">
                  <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
                    <CheckCircle size={40} className="text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">¡Importación completada!</h3>
                  <p className="text-slate-500 mb-6">Tu presupuesto ha sido importado correctamente</p>
                  
                  <div className="flex items-center justify-center gap-4">
                    <div className="text-center px-6 py-4 bg-blue-50 rounded-xl">
                      <p className="text-3xl font-bold text-blue-700">{importResults.accounts}</p>
                      <p className="text-sm text-blue-600">Cuentas creadas</p>
                    </div>
                    <div className="text-center px-6 py-4 bg-emerald-50 rounded-xl">
                      <p className="text-3xl font-bold text-emerald-700">{importResults.subaccounts}</p>
                      <p className="text-sm text-emerald-600">Subcuentas creadas</p>
                    </div>
                    {importResults.errors > 0 && (
                      <div className="text-center px-6 py-4 bg-red-50 rounded-xl">
                        <p className="text-3xl font-bold text-red-700">{importResults.errors}</p>
                        <p className="text-sm text-red-600">Errores</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between flex-shrink-0 bg-slate-50">
              {importStep === "upload" && (
                <button onClick={closeImportModal} className="px-4 py-2.5 text-slate-600 hover:text-slate-900 text-sm font-medium">
                  Cancelar
                </button>
              )}
              {importStep === "preview" && (
                <>
                  <button onClick={resetImport} className="px-4 py-2.5 text-slate-600 hover:text-slate-900 text-sm font-medium">
                    ← Volver
                  </button>
                  <button
                    onClick={executeImport}
                    disabled={importData.filter(d => d.valid).length === 0}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Upload size={16} />
                    Importar {importData.filter(d => d.valid).length} filas
                  </button>
                </>
              )}
              {importStep === "importing" && (
                <div className="w-full text-center text-sm text-slate-500">
                  Procesando...
                </div>
              )}
              {importStep === "done" && (
                <button
                  onClick={closeImportModal}
                  className="w-full px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
                >
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
