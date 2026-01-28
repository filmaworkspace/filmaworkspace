"use client";
import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy, Timestamp } from "firebase/firestore";
import { Plus, ChevronDown, ChevronRight, Edit, Trash2, X, Search, Upload, AlertCircle, CheckCircle, FileSpreadsheet, Eye, EyeOff, Wallet } from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface SubAccount { id: string; code: string; description: string; budgeted: number; committed: number; actual: number; accountId: string; createdAt: Date; }
interface Account { id: string; code: string; description: string; subAccounts: SubAccount[]; createdAt: Date; }
interface BudgetSummary { totalBudgeted: number; totalCommitted: number; totalActual: number; totalAvailable: number; }
interface CostTrackingConfig {
  poCommitmentTrigger: "on_create" | "on_approve";
  invoiceActualTrigger: "on_approve" | "on_account" | "on_paid";
}

export default function BudgetPage() {
  const params = useParams();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [costConfig, setCostConfig] = useState<CostTrackingConfig>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_paid",
  });

  const [formData, setFormData] = useState({ code: "", description: "", budgeted: 0 });
  const [summary, setSummary] = useState<BudgetSummary>({ totalBudgeted: 0, totalCommitted: 0, totalActual: 0, totalAvailable: 0 });

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
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      // Cargar configuración de costTracking
      let commitTrigger: "on_create" | "on_approve" = "on_approve";
      let actualTrigger: "on_approve" | "on_account" | "on_paid" = "on_paid";
      try {
        const costConfigDoc = await getDoc(doc(db, `projects/${id}/config/costTracking`));
        if (costConfigDoc.exists()) {
          const configData = costConfigDoc.data();
          commitTrigger = configData.poCommitmentTrigger || "on_approve";
          actualTrigger = configData.invoiceActualTrigger || "on_paid";
        }
      } catch (e) {
        console.error("Error loading cost config:", e);
      }
      setCostConfig({ poCommitmentTrigger: commitTrigger, invoiceActualTrigger: actualTrigger });

      // Determinar estados válidos para comprometido
      const validPOStatuses: string[] = commitTrigger === "on_create" 
        ? ["pending", "approved"] 
        : ["approved"];

      // Determinar estados válidos para realizado
      const validInvoiceStatuses: string[] = 
        actualTrigger === "on_approve" ? ["approved", "accounted", "paid"] :
        actualTrigger === "on_account" ? ["accounted", "paid"] :
        ["paid"];

      // Cargar POs y calcular committed por subcuenta
      const committedBySubaccount: Record<string, number> = {};
      const posSnapshot = await getDocs(collection(db, `projects/${id}/pos`));
      posSnapshot.docs.forEach(poDoc => {
        const poData = poDoc.data();
        if (poData.status && validPOStatuses.includes(poData.status) && poData.items) {
          poData.items.forEach((item: any) => {
            if (item.subAccountCode) {
              const key = item.subAccountCode;
              committedBySubaccount[key] = (committedBySubaccount[key] || 0) + (item.baseAmount || 0);
            }
          });
        }
      });

      // Cargar Facturas y calcular actual por subcuenta
      const actualBySubaccount: Record<string, number> = {};
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
      invoicesSnapshot.docs.forEach(invDoc => {
        const invData = invDoc.data();
        if (invData.status && validInvoiceStatuses.includes(invData.status) && invData.items) {
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

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setSaving(true); setErrorMessage("");
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").slice(1);
      try {
        const accountsMap = new Map<string, string>();
        let accountsCreated = 0, subAccountsCreated = 0;
        for (const line of lines) {
          const [code, description, type, budgeted] = line.split(",").map((s) => s.trim());
          if (!code || !description || !type) continue;
          if (type.toUpperCase() === "CUENTA") {
            const accountRef = await addDoc(collection(db, `projects/${id}/accounts`), { code: code.trim(), description, createdAt: Timestamp.now(), createdBy: userId || "" });
            accountsMap.set(code, accountRef.id); accountsCreated++;
          } else if (type.toUpperCase() === "SUBCUENTA") {
            const accountCode = code.split(/[.\-]/)[0];
            let accountId = accountsMap.get(accountCode);
            if (!accountId) { const existingAccount = accounts.find(a => a.code === accountCode); if (existingAccount) accountId = existingAccount.id; }
            if (accountId) {
              await addDoc(collection(db, `projects/${id}/accounts/${accountId}/subaccounts`), { code: code.trim(), description, budgeted: parseFloat(budgeted) || 0, committed: 0, actual: 0, accountId, createdAt: Timestamp.now(), createdBy: userId || "" });
              subAccountsCreated++;
            }
          }
        }
        setSuccessMessage(`Importación completada: ${accountsCreated} cuentas y ${subAccountsCreated} subcuentas`);
        setTimeout(() => setSuccessMessage(""), 5000); setShowImportModal(false); await loadData();
      } catch (error: any) { setErrorMessage(`Error al importar: ${error.message}`); } finally { setSaving(false); }
    };
    reader.readAsText(file);
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

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowImportModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Importar presupuesto</h2>
              <button onClick={() => setShowImportModal(false)} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-medium text-slate-900 mb-2">1. Descarga la plantilla</h3>
                <p className="text-sm text-slate-500 mb-3">La plantilla incluye ejemplos de formato.</p>
                <button onClick={downloadTemplate} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
                  <Download size={16} />Descargar plantilla
                </button>
              </div>

              <div>
                <h3 className="font-medium text-slate-900 mb-2">2. Sube tu archivo</h3>
                <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
                  <FileSpreadsheet size={32} className="text-slate-400 mx-auto mb-2" />
                  <label className="cursor-pointer">
                    <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800">
                      <Upload size={16} />{saving ? "Importando..." : "Seleccionar archivo"}
                    </span>
                    <input type="file" accept=".csv" onChange={handleImportCSV} disabled={saving} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <p className="text-sm text-blue-800"><strong>Formato libre:</strong> Puedes usar códigos como 01, 01.01, A1, etc.</p>
              </div>
            </div>

            <div className="px-6 pb-6">
              <button onClick={() => setShowImportModal(false)} className="w-full px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
