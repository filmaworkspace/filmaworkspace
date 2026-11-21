"use client";
import { errorText } from "@/lib/toast";
import { toast as appToast } from "@/lib/toast";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { Fragment, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Edit,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  MoreHorizontal,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import { strToU8, unzipSync, zipSync } from "fflate";

import { loadLedger } from "@/lib/ledgerClient";
import SearchBar from "@/components/SearchBar";
import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select, Spinner, buttonClass } from "@/components/ds";
// ─── Internal ────────────────────────────────────────────────────────────────
import { CostSettings, getCostSettings } from "@/lib/budgetRules";
import { deleteBudgetFigure, loadBudgetFigures, migrateBudgetFigures, setBudgetFigure } from "@/lib/budgetFigures";
import { parseFwbText, flattenFwbToAccountRows, FwbSubaccountLevel } from "@/lib/budgetingExport";
import BudgetLevelMappingChoice from "@/components/BudgetLevelMappingChoice";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface SubAccount {
  id: string;
  code: string;
  description: string;
  budgeted: number;
  committed: number;
  actual: number;
  box: number;
  accountId: string;
  createdAt: Date;
}

interface Account {
  id: string;
  code: string;
  description: string;
  subAccounts: SubAccount[];
  /** Departamentos (HOD/coordinación) que pueden seguir comprometido y realizado de esta cuenta. */
  trackingDepartments: string[];
  createdAt: Date;
}

interface BudgetSummary {
  totalBudgeted: number;
  totalCommitted: number;
  totalActual: number;
  totalBox: number;
  totalAvailable: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);
  const [projectDepartments, setProjectDepartments] = useState<string[]>([]);
  const [trackingAccount, setTrackingAccount] = useState<Account | null>(null);
  const [trackingSel, setTrackingSel] = useState<string[]>([]);
  const [accessError, setAccessError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"account" | "subaccount">("account");
  const [editMode, setEditMode] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedSubAccount, setSelectedSubAccount] = useState<SubAccount | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [view, setView] = useState<"all" | "risk">("all");
  const [searchField, setSearchField] = useState<"all" | "code" | "description">("all");
  const [showImportModal, setShowImportModal] = useState(false);
  const setErrorMessage = (m: string) => { if (m) appToast.error(m); };
  // Los avisos van por lib/toast.
  const setSuccessMessage = (m: string) => { if (m) appToast.success(m); };
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [costConfig, setCostConfig] = useState<CostSettings>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_paid",
  });

  const [formData, setFormData] = useState({ code: "", description: "", budgeted: 0 });
  const [summary, setSummary] = useState<BudgetSummary>({ totalBudgeted: 0, totalCommitted: 0, totalActual: 0, totalBox: 0, totalAvailable: 0 });

  // Estados para el importador
  const [importStep, setImportStep] = useState<"upload" | "preview" | "importing" | "done">("upload");
  // parentCode = código de la cuenta padre (null = sin asignar)
  const [importData, setImportData] = useState<{ code: string; description: string; type: string; budgeted: number; parentCode: string | null }[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{ accounts: number; subaccounts: number; errors: number }>({ accounts: 0, subaccounts: 0, errors: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [expandedImportAccounts, setExpandedImportAccounts] = useState<Set<string>>(new Set());
  // Fase dentro del paso preview: "select" = elegir cuentas, "organize" = ver distribución
  const [importPhase, setImportPhase] = useState<"select" | "organize">("select");
  // Al elegir un .fwb (Budgeting tiene 3 niveles, Accounting solo 2), primero
  // se pregunta qué nivel se queda como código operativo antes de parsear.
  const [pendingFwbBytes, setPendingFwbBytes] = useState<Uint8Array | null>(null);
  const [showFwbMappingModal, setShowFwbMappingModal] = useState(false);
  const [fwbSubaccountLevel, setFwbSubaccountLevel] = useState<FwbSubaccountLevel>("subchapter");

  // Bloquea el scroll de la página de detrás mientras cualquiera de los
  // modales a pantalla completa de esta página está abierto.
  useBodyScrollLock(showModal || showImportModal || !!confirmDialog || showFwbMappingModal);

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
      if (projectDoc.exists()) {
        setProjectName(projectDoc.data().name || "Proyecto");
        setProjectDepartments(projectDoc.data().departments || []);
      }

      // Cargar configuración de costes usando budgetRules
      const loadedCostConfig = await getCostSettings(id);
      setCostConfig(loadedCostConfig);

      // Comprometido, realizado y caja: libro único calculado desde los documentos (lib/budgetLedger).
      const ledger = await loadLedger(id);
      const cell = (code: string) => ledger.bySub[code] || { committed: 0, actual: 0, box: 0 };

      // Cifras de presupuesto: colección protegida (lib/budgetFigures). Antes se
      // trasladan las que aún queden en subcuentas antiguas.
      await migrateBudgetFigures(id);
      const figures = await loadBudgetFigures(id);

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
              budgeted: figures[subDoc.id] ?? subData.budgeted ?? 0,
              committed: cell(subCode).committed,
              actual: cell(subCode).actual,
              box: cell(subCode).box,
              accountId: accountDoc.id,
              createdAt: subData.createdAt?.toDate() || new Date(),
            };
          }) as SubAccount[];
          return {
            id: accountDoc.id,
            code: accountDoc.data().code || "",
            description: accountDoc.data().description || "",
            subAccounts,
            trackingDepartments: accountDoc.data().trackingDepartments || [],
            createdAt: accountDoc.data().createdAt?.toDate() || new Date(),
          } as Account;
        })
      );
      setAccounts(accountsData);
      setExpandedAccounts(new Set(accountsData.map(a => a.id)));
    } catch (error: any) {
      setErrorMessage(errorText(error, "No se ha podido cargar datos"));
    } finally {
      setLoading(false);
    }
  };

  const calculateSummary = () => {
    let totalBudgeted = 0, totalCommitted = 0, totalActual = 0, totalBox = 0;
    accounts.forEach((account) => {
      account.subAccounts.forEach((sub) => {
        totalBudgeted += sub.budgeted || 0;
        totalCommitted += sub.committed || 0;
        totalActual += sub.actual || 0;
        totalBox += sub.box || 0;
      });
    });
    setSummary({ totalBudgeted, totalCommitted, totalActual, totalBox, totalAvailable: totalBudgeted - totalCommitted - totalActual - totalBox });
  };

  const getAccountTotals = (account: Account) => {
    const budgeted = account.subAccounts.reduce((sum, sub) => sum + (sub.budgeted || 0), 0);
    const committed = account.subAccounts.reduce((sum, sub) => sum + (sub.committed || 0), 0);
    const actual = account.subAccounts.reduce((sum, sub) => sum + (sub.actual || 0), 0);
    const box = account.subAccounts.reduce((sum, sub) => sum + (sub.box || 0), 0);
    return { budgeted, committed, actual, box, available: budgeted - committed - actual - box, executed: committed + actual + box };
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
      setSuccessMessage("Cuenta creada correctamente");
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido crear cuenta")); } finally { setSaving(false); }
  };

  const handleUpdateAccount = async () => {
    if (!selectedAccount) return;
    if (!formData.code.trim() || !formData.description.trim()) { setErrorMessage("El código y la descripción son obligatorios"); return; }
    setSaving(true); setErrorMessage("");
    try {
      await updateDoc(doc(db, `projects/${id}/accounts`, selectedAccount.id), { code: formData.code.trim(), description: formData.description.trim() });
      setSuccessMessage("Cuenta actualizada correctamente");
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido actualizar cuenta")); } finally { setSaving(false); }
  };

  const handleCreateSubAccount = async () => {
    if (!selectedAccount) { setErrorMessage("Debes seleccionar una cuenta padre"); return; }
    if (!formData.code.trim() || !formData.description.trim()) { setErrorMessage("El código y la descripción son obligatorios"); return; }
    setSaving(true); setErrorMessage("");
    try {
      const subRef = doc(collection(db, `projects/${id}/accounts/${selectedAccount.id}/subaccounts`));
      const batch = writeBatch(db);
      batch.set(subRef, {
        code: formData.code.trim(), description: formData.description.trim(),
        committed: 0, actual: 0, accountId: selectedAccount.id, createdAt: Timestamp.now(), createdBy: userId || "",
      });
      setBudgetFigure(batch, id, subRef.id, { budgeted: formData.budgeted || 0, accountId: selectedAccount.id, code: formData.code.trim() });
      await batch.commit();
      setSuccessMessage("Subcuenta creada correctamente");
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido crear subcuenta")); } finally { setSaving(false); }
  };

  const handleUpdateSubAccount = async () => {
    if (!selectedAccount || !selectedSubAccount) { setErrorMessage("No se encontró la subcuenta"); return; }
    setSaving(true); setErrorMessage("");
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, `projects/${id}/accounts/${selectedAccount.id}/subaccounts`, selectedSubAccount.id), {
        code: formData.code.trim(), description: formData.description.trim(),
      });
      setBudgetFigure(batch, id, selectedSubAccount.id, { budgeted: formData.budgeted || 0, accountId: selectedAccount.id, code: formData.code.trim() });
      await batch.commit();
      setSuccessMessage("Subcuenta actualizada correctamente");
      resetForm(); setShowModal(false); await loadData();
    } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido actualizar subcuenta")); } finally { setSaving(false); }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDeleteAccount = async (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    if (account.subAccounts.length > 0) {
      setErrorMessage("No se puede eliminar una cuenta que tiene subcuentas");
      return;
    }
    openConfirm(
      "Eliminar cuenta",
      "¿Estás seguro de que quieres eliminar esta cuenta? Esta acción no se puede deshacer.",
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${id}/accounts`, accountId));
          setSuccessMessage("Cuenta eliminada"); await loadData();
        } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido eliminar cuenta")); }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const handleDeleteSubAccount = async (accountId: string, subAccountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    const sub = account?.subAccounts.find((s) => s.id === subAccountId);
    if (sub) {
      const hasActivity = (sub.committed || 0) > 0 || (sub.actual || 0) > 0 || (sub.box || 0) > 0;
      if (hasActivity) {
        setErrorMessage(
          `No se puede eliminar "${sub.description}": tiene importes comprometidos (${sub.committed > 0 ? formatCurrency(sub.committed) + " €" : "—"}), realizados (${sub.actual > 0 ? formatCurrency(sub.actual) + " €" : "—"}) o de caja (${sub.box > 0 ? formatCurrency(sub.box) + " €" : "—"}) asociados a POs o facturas.`
        );
        return;
      }
    }
    openConfirm(
      "Eliminar subcuenta",
      "¿Estás seguro de que quieres eliminar esta subcuenta? Esta acción no se puede deshacer.",
      async () => {
        setConfirmDialog(null);
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, `projects/${id}/accounts/${accountId}/subaccounts`, subAccountId));
          deleteBudgetFigure(batch, id, subAccountId);
          await batch.commit();
          setSuccessMessage("Subcuenta eliminada"); await loadData();
        } catch (error: any) { setErrorMessage(errorText(error, "No se ha podido eliminar subcuenta")); }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const resetForm = () => { setFormData({ code: "", description: "", budgeted: 0 }); setSelectedAccount(null); setSelectedSubAccount(null); setEditMode(false); setErrorMessage(""); };

  const openCreateAccountModal = () => { resetForm(); setModalMode("account"); setEditMode(false); setShowModal(true); };
  // ── Seguimiento de cuenta ──────────────────────────────────────────────────
  // Da a HOD y coordinación de los departamentos elegidos acceso al comprometido
  // y realizado de esta cuenta (nunca al presupuestado ni al disponible).
  const openTracking = (account: Account) => { setTrackingAccount(account); setTrackingSel(account.trackingDepartments); };
  const saveTracking = async () => {
    if (!trackingAccount) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `projects/${id}/accounts`, trackingAccount.id), { trackingDepartments: trackingSel });
      setAccounts((prev) => prev.map((a) => (a.id === trackingAccount.id ? { ...a, trackingDepartments: trackingSel } : a)));
      setTrackingAccount(null);
      setSuccessMessage("Seguimiento actualizado");
    } catch (error: any) {
      setErrorMessage(errorText(error, "No se ha podido guardar el seguimiento"));
    } finally {
      setSaving(false);
    }
  };

  const openEditAccountModal = (account: Account) => { setSelectedAccount(account); setFormData({ code: account.code, description: account.description, budgeted: 0 }); setModalMode("account"); setEditMode(true); setShowModal(true); };
  const openCreateSubAccountModal = (account: Account) => { resetForm(); setSelectedAccount(account); setFormData({ code: "", description: "", budgeted: 0 }); setModalMode("subaccount"); setEditMode(false); setShowModal(true); };
  const openEditSubAccountModal = (account: Account, subAccount: SubAccount) => { setSelectedAccount(account); setSelectedSubAccount(subAccount); setFormData({ code: subAccount.code, description: subAccount.description, budgeted: subAccount.budgeted }); setModalMode("subaccount"); setEditMode(true); setShowModal(true); };

  // ── XLSX import/export (usando fflate, igual que reports) ─────────────────

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const buildTemplateXlsx = (): Uint8Array => {
    // Nueva plantilla: 4 columnas  CUENTA | SUBCUENTA | DESCRIPCIÓN | PRESUPUESTO
    // Si SUBCUENTA está vacía → fila de cuenta padre.
    // Si SUBCUENTA tiene valor → fila de subcuenta hija de la cuenta indicada en CUENTA.
    const templateRows: [string, string, string, string | number][] = [
      ["CUENTA", "SUBCUENTA", "DESCRIPCIÓN", "PRESUPUESTO"],
      ["01", "", "GUION Y MÚSICA", ""],
      ["01", "01-01-0100", "Derechos de autor", 10000],
      ["01", "01-01-0200", "Argumento original", 5000],
      ["01", "01-01-0300", "Música original", 3000],
      ["02", "", "PRODUCCIÓN", ""],
      ["02", "02-01-0100", "Equipo técnico", 50000],
      ["02", "02-01-0200", "Material y consumibles", 10000],
      ["03", "", "POSTPRODUCCIÓN", ""],
      ["03", "03-01-0100", "Montaje", 20000],
      ["03", "03-01-0200", "Sonido", 8000],
    ];

    const cellXml = (col: number, row: number, val: string | number, sIdx = 0): string => {
      const colLetter = String.fromCharCode(65 + col);
      const addr = `${colLetter}${row}`;
      const s = sIdx > 0 ? ` s="${sIdx}"` : "";
      if (typeof val === "number") return `<c r="${addr}"${s}><v>${val}</v></c>`;
      if (val === "") return `<c r="${addr}"${s}/>`;
      return `<c r="${addr}" t="inlineStr"${s}><is><t>${esc(String(val))}</t></is></c>`;
    };

    let sheetRows = "";
    templateRows.forEach((row, ri) => {
      const r = ri + 1;
      const isHeader = ri === 0;
      sheetRows += `<row r="${r}">${row.map((v, c) => cellXml(c, r, v, isHeader ? 2 : 0)).join("")}</row>`;
    });

    // Hoja instrucciones
    const instrLines = [
      "INSTRUCCIONES DE IMPORTACIÓN",
      "",
      "La plantilla tiene 4 columnas: CUENTA · SUBCUENTA · DESCRIPCIÓN · PRESUPUESTO",
      "",
      "Columna A — CUENTA",
      "  · Código de la cuenta padre a la que pertenece la fila (ej: 01, 02, 03).",
      "  · Se rellena en todas las filas, tanto cuentas como subcuentas.",
      "",
      "Columna B — SUBCUENTA",
      "  · VACÍA → la fila es una cuenta principal (carpeta).",
      "  · Con valor → la fila es una subcuenta hija de la cuenta indicada en A.",
      "  · Puedes usar el formato que prefieras: 01-01-0100, 01.01, 0100, etc.",
      "",
      "Columna C — DESCRIPCIÓN",
      "  · Nombre de la cuenta o subcuenta. Texto libre.",
      "",
      "Columna D — PRESUPUESTO",
      "  · Solo para subcuentas. Deja en blanco la celda de la cuenta principal.",
      "  · Número sin símbolo de moneda ni puntos de millar (ej: 50000).",
      "",
      "EJEMPLO:",
      "  CUENTA | SUBCUENTA   | DESCRIPCIÓN         | PRESUPUESTO",
      "  01     |             | GUION Y MÚSICA      |",
      "  01     | 01-01-0100  | Derechos de autor   | 10000",
      "  01     | 01-01-0200  | Argumento original  | 5000",
      "",
      "IMPORTANTE: No modifiques la fila de cabecera (fila 1).",
    ];
    const instrRows = instrLines
      .map((t, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${esc(t)}</t></is></c></row>`)
      .join("");

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2F52E0"/></patternFill></fill>
  </fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

    const makeSheet = (rows: string, cols: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;

    const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
  <sheet name="Presupuesto" sheetId="1" r:id="rId1"/>
  <sheet name="Instrucciones" sheetId="2" r:id="rId2"/>
</sheets></workbook>`;

    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const mainColsXml = `<col min="1" max="1" width="12" customWidth="1"/>
<col min="2" max="2" width="18" customWidth="1"/>
<col min="3" max="3" width="38" customWidth="1"/>
<col min="4" max="4" width="16" customWidth="1"/>`;

    return zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "xl/workbook.xml": strToU8(wbXml),
      "xl/_rels/workbook.xml.rels": strToU8(wbRels),
      "xl/worksheets/sheet1.xml": strToU8(makeSheet(sheetRows, mainColsXml)),
      "xl/worksheets/sheet2.xml": strToU8(makeSheet(instrRows, `<col min="1" max="1" width="70" customWidth="1"/>`)),
      "xl/styles.xml": strToU8(stylesXml),
      "xl/sharedStrings.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"/>`),
    });
  };

  const downloadTemplate = () => {
    const bytes = buildTemplateXlsx();
    const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plantilla_presupuesto.xlsx";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const isSubAccountCode = (code: string) => /[.\-\/]/.test(code.trim());

  // Convierte referencia de columna Excel (A, B, AA…) a índice 0-based
  const colRefToIndex = (ref: string): number => {
    let n = 0;
    for (let i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
    return n - 1;
  };

  // Extrae la tabla de cadenas compartidas de sharedStrings.xml
  const parseSharedStrings = (xml: string): string[] => {
    const strings: string[] = [];
    const siMatches = xml.matchAll(/<si>([\s\S]*?)<\/si>/g);
    for (const m of siMatches) {
      // Concatena todos los <t> dentro del <si> (puede haber varios en rich-text)
      const texts = [...m[1].matchAll(/<t(?:[^>]*)?>([^<]*)<\/t>/g)].map(t =>
        t[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      );
      strings.push(texts.join(""));
    }
    return strings;
  };

  // Lee el XML de la hoja y devuelve filas como arrays de strings,
  // resolviendo shared strings (t="s") y valores inline / numéricos.
  const parseSheetXml = (xml: string, sharedStrings: string[]): string[][] => {
    const rows: string[][] = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const col = colRefToIndex(c[1]);
        const attrs = c[2];
        const inner = c[3];
        let val = "";

        if (attrs.includes('t="s"')) {
          // Shared string: <v> contiene el índice
          const vm = inner.match(/<v>(\d+)<\/v>/);
          if (vm) val = sharedStrings[parseInt(vm[1])] ?? "";
        } else if (attrs.includes('t="inlineStr"')) {
          const tm = inner.match(/<t(?:[^>]*)?>([^<]*)<\/t>/);
          if (tm) val = tm[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
        } else if (attrs.includes('t="str"')) {
          // Fórmula con resultado string
          const vm = inner.match(/<v>([^<]*)<\/v>/);
          if (vm) val = vm[1];
        } else {
          // Numérico o fecha — devolver como string
          const vm = inner.match(/<v>([^<]*)<\/v>/);
          if (vm) val = vm[1];
        }

        while (cells.length < col) cells.push("");
        cells[col] = val;
      }
      if (cells.length > 0) rows.push(cells);
    }
    return rows;
  };

  const parseImportFile = (fileBytes: Uint8Array): { code: string; description: string; type: string; budgeted: number; parentCode: string | null }[] => {
    try {
      const files = unzipSync(fileBytes);
      const ssEntry = files["xl/sharedStrings.xml"];
      const sharedStrings = ssEntry ? parseSharedStrings(new TextDecoder().decode(ssEntry)) : [];
      const sheetEntry = files["xl/worksheets/sheet1.xml"];
      if (!sheetEntry) throw new Error("sheet1.xml no encontrado");
      const sheetXml = new TextDecoder().decode(sheetEntry);
      const allRows = parseSheetXml(sheetXml, sharedStrings);

      // Localizar fila de cabecera buscando "CUENTA" en cualquier celda
      const normalize = (s: string) =>
        s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const headerIdx = allRows.findIndex(r => r.some(c => normalize(c) === "CUENTA"));
      const dataRows = allRows.slice(headerIdx >= 0 ? headerIdx + 1 : 1);

      const data: { code: string; description: string; type: string; budgeted: number; parentCode: string | null }[] = [];

      // Nueva lógica: 4 columnas — CUENTA | SUBCUENTA | DESCRIPCIÓN | PRESUPUESTO
      // · Si SUBCUENTA (col B) está vacía → es cuenta padre (CUENTA)
      // · Si SUBCUENTA tiene valor → es subcuenta; el padre es el código de CUENTA (col A)
      dataRows.forEach((row) => {
        const accountCode   = (row[0] ?? "").trim();   // A: código de cuenta
        const subAccountCode = (row[1] ?? "").trim();  // B: código de subcuenta (vacío = cuenta)
        const description   = (row[2] ?? "").trim();   // C: descripción
        const budgetedRaw   = (row[3] ?? "").trim();   // D: presupuesto

        if (!accountCode && !description) return; // Fila vacía → ignorar

        const isSubAccount = subAccountCode !== "";
        const type = isSubAccount ? "SUBCUENTA" : "CUENTA";
        const code = isSubAccount ? subAccountCode : accountCode;
        const parentCode = isSubAccount ? accountCode : null;

        // Parsear presupuesto: admite 10.000,50 (ES) o 10000.50 (EN)
        const normalizedBudget = budgetedRaw
          .replace(/[€$\s]/g, "")                  // quitar símbolo de moneda y espacios
          .replace(/\.(?=\d{3}([.,]|$))/g, "")     // eliminar puntos de millar
          .replace(",", ".");                        // coma decimal → punto
        const budgeted = isSubAccount && normalizedBudget !== ""
          ? parseFloat(normalizedBudget) || 0
          : 0;

        data.push({ code, description, type, budgeted, parentCode });
      });

      return data;
    } catch {
      setErrorMessage("No se pudo leer el archivo. Asegúrate de que es un .xlsx válido.");
      return [];
    }
  };

  // Toggle cuenta ↔ subcuenta; las subcuentas recalculan su auto-parent
  const toggleRowType = (index: number) => {
    setImportData(prev => {
      return prev.map((row, i) => {
        if (i !== index) return row;
        const newType = row.type === "CUENTA" ? "SUBCUENTA" : "CUENTA";
        let parentCode: string | null = null;
        if (newType === "SUBCUENTA") {
          const prefix = row.code.split(/[.\-\/]/)[0];
          const existsInImport = prev.some((d, di) => di !== i && d.type === "CUENTA" && d.code === prefix);
          const existsInDB = accounts.some(a => a.code === prefix);
          if (existsInImport || existsInDB) parentCode = prefix;
        }
        return { ...row, type: newType, parentCode };
      });
    });
  };

  // Reasignar una subcuenta a otra cuenta padre
  const reassignParent = (index: number, newParentCode: string | null) => {
    setImportData(prev => prev.map((row, i) =>
      i === index ? { ...row, parentCode: newParentCode } : row
    ));
  };

  // Dado el conjunto de cuentas conocidas, asigna cada subcuenta
  // a la cuenta cuyo código sea el prefijo más largo del código de la subcuenta.
  // Si hay empate o ninguna coincide → parentCode = null (excepción manual)
  const autoDistribute = (data: typeof importData): typeof importData => {
    const accountCodes = [
      ...data.filter(d => d.type === "CUENTA").map(d => d.code),
      ...accounts.map(a => a.code),
    ];
    return data.map(row => {
      if (row.type !== "SUBCUENTA") return row;
      // Buscar la cuenta cuyo código sea prefijo del código de la subcuenta (más largo primero)
      const matches = accountCodes
        .filter(ac => row.code.startsWith(ac) && row.code !== ac)
        .sort((a, b) => b.length - a.length); // más específico primero
      return { ...row, parentCode: matches.length === 1 ? matches[0] : (matches.length > 1 ? matches[0] : null) };
    });
  };

  // Confirmar qué filas son cuentas y lanzar distribución automática
  const confirmAccountsAndDistribute = () => {
    const distributed = autoDistribute(importData);
    setImportData(distributed);
    setExpandedImportAccounts(new Set(distributed.filter(d => d.type === "CUENTA").map(d => d.code)));
    setImportPhase("organize");
  };

  // Asignar todas las excepciones sin padre a una cuenta de golpe
  const assignAllUnassigned = (parentCode: string) => {
    setImportData(prev => prev.map(row =>
      row.type === "SUBCUENTA" && !row.parentCode ? { ...row, parentCode } : row
    ));
  };

  // Mover una subcuenta arriba o abajo dentro de su cuenta (reordenar)
  const moveSubAccount = (index: number, direction: "up" | "down") => {
    setImportData(prev => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      // Solo intercambiar si el vecino es del mismo padre o también es subcuenta
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // Cuentas disponibles para asignar como padre (importadas + existentes en BD)
  const availableParentAccounts = [
    ...importData.filter(d => d.type === "CUENTA").map(d => ({ code: d.code, description: d.description, source: "import" as const })),
    ...accounts.filter(a => !importData.some(d => d.type === "CUENTA" && d.code === a.code))
              .map(a => ({ code: a.code, description: a.description, source: "db" as const })),
  ];

  const unassignedSubAccounts = importData.filter(d => d.type === "SUBCUENTA" && !d.parentCode);

  // Importa un .fwb (exportado desde Budgeting) — mismo shape de salida que
  // parseImportFile, para reutilizar tal cual el resto del flujo de
  // importación (preview/organize/execute). Las categorías del .fwb
  // (Above/Below the line) no se preservan: solo Cuentas y Detail Lines.
  // Budgeting tiene 3 niveles y Accounting solo 2, así que `subaccountLevel`
  // (elegido en el modal antes de llegar aquí) decide cuál se queda como
  // código operativo — ver flattenFwbToAccountRows.
  const parseFwbBudgetFile = (fileBytes: Uint8Array, subaccountLevel: FwbSubaccountLevel): { code: string; description: string; type: string; budgeted: number; parentCode: string | null }[] => {
    try {
      const text = new TextDecoder().decode(fileBytes);
      const fwb = parseFwbText(text);
      return flattenFwbToAccountRows(fwb, subaccountLevel);
    } catch (error: any) {
      setErrorMessage(errorText(error, "No se pudo leer el archivo .fwb"));
      return [];
    }
  };

  const applyImportData = (parsed: { code: string; description: string; type: string; budgeted: number; parentCode: string | null }[]) => {
    if (parsed.length > 0) {
      setImportData(parsed);
      // Expandir todas las cuentas por defecto en la vista previa
      const accountCodes = new Set(parsed.filter(d => d.type === "CUENTA").map(d => d.code));
      setExpandedImportAccounts(accountCodes);
      setImportStep("preview");
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file) return;
    setImportFileName(file.name);
    const isFwb = file.name.toLowerCase().endsWith(".fwb");
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
      if (isFwb) {
        // El .fwb tiene 3 niveles: hay que preguntar antes de aplanarlo a
        // Cuenta/Subcuenta, no se puede decidir el importData todavía.
        setFwbSubaccountLevel("subchapter");
        setPendingFwbBytes(bytes);
        setShowFwbMappingModal(true);
        return;
      }
      applyImportData(parseImportFile(bytes));
    };
    reader.readAsArrayBuffer(file);
  };

  const confirmFwbMapping = () => {
    if (!pendingFwbBytes) return;
    applyImportData(parseFwbBudgetFile(pendingFwbBytes, fwbSubaccountLevel));
    setShowFwbMappingModal(false);
    setPendingFwbBytes(null);
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls") || file.name.endsWith(".fwb"))) {
      handleFileSelect(file);
    } else {
      setErrorMessage("Por favor, sube un archivo .xlsx o .fwb");
    }
  };

  const executeImport = async () => {
    setImportStep("importing");
    setImportProgress(0);
    setSaving(true);

    // Solo importar cuentas y subcuentas con padre asignado
    const accountItems = importData.filter(d => d.type === "CUENTA");
    const subItems = importData.filter(d => d.type === "SUBCUENTA" && d.parentCode);
    const total = accountItems.length + subItems.length;
    let processed = 0;
    let accountsCreated = 0;
    let subAccountsCreated = 0;
    let errors = 0;

    const accountsMap = new Map<string, string>(); // code → firestoreId

    try {
      // 1ª pasada: crear cuentas
      for (const item of accountItems) {
        try {
          const accountRef = await addDoc(collection(db, `projects/${id}/accounts`), {
            code: item.code,
            description: item.description,
            createdAt: Timestamp.now(),
            createdBy: userId || "",
          });
          accountsMap.set(item.code, accountRef.id);
          accountsCreated++;
        } catch { errors++; }
        processed++;
        setImportProgress(Math.round((processed / total) * 100));
      }

      // 2ª pasada: crear subcuentas usando parentCode
      for (const item of subItems) {
        try {
          let accountId = accountsMap.get(item.parentCode!);
          if (!accountId) {
            const existingAccount = accounts.find(a => a.code === item.parentCode);
            if (existingAccount) accountId = existingAccount.id;
          }
          if (accountId) {
            const subRef = doc(collection(db, `projects/${id}/accounts/${accountId}/subaccounts`));
            const batch = writeBatch(db);
            batch.set(subRef, {
              code: item.code,
              description: item.description,
              committed: 0,
              actual: 0,
              accountId,
              createdAt: Timestamp.now(),
              createdBy: userId || "",
            });
            setBudgetFigure(batch, id, subRef.id, { budgeted: item.budgeted, accountId, code: item.code });
            await batch.commit();
            subAccountsCreated++;
          } else { errors++; }
        } catch { errors++; }
        processed++;
        setImportProgress(Math.round((processed / total) * 100));
      }

      // Subcuentas sin asignar → omitidas, no error
      const skipped = importData.filter(d => d.type === "SUBCUENTA" && !d.parentCode).length;
      if (skipped > 0) console.info(`${skipped} subcuentas sin asignar omitidas`);

      setImportResults({ accounts: accountsCreated, subaccounts: subAccountsCreated, errors });
      setImportStep("done");
      await loadData();
    } catch (error: any) {
      setErrorMessage(errorText(error, "No se ha podido importar"));
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
    setExpandedImportAccounts(new Set());
    setImportPhase("select");
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    resetImport();
  };

  // ── Búsqueda avanzada ─────────────────────────────────────────────────────
  // Campo: todo, código de cuenta o descripción. Sin distinguir mayúsculas ni
  // acentos; en códigos se ignoran separadores ("0101" encuentra "01-01").
  // Varias palabras en la descripción deben aparecer todas.
  const norm = (v: string) => (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const bare = (v: string) => norm(v).replace(/[\s.\-\/_]/g, "");
  const searchQuery = norm(searchTerm);
  const matchCode = (code: string) => !!searchQuery && (norm(code).includes(searchQuery) || (!!bare(searchQuery) && bare(code).startsWith(bare(searchQuery))));
  const matchDesc = (desc: string) => !!searchQuery && searchQuery.split(/\s+/).every((w) => norm(desc).includes(w));
  const matches = (code: string, desc: string) =>
    searchField === "code" ? matchCode(code) : searchField === "description" ? matchDesc(desc) : matchCode(code) || matchDesc(desc);

  /** Subcuentas a mostrar de una cuenta: todas si la cuenta coincide, si no solo las que coinciden. */
  const visibleSubs = (account: Account) => {
    if (!searchQuery || matches(account.code, account.description)) return account.subAccounts;
    return account.subAccounts.filter((sub) => matches(sub.code, sub.description));
  };
  const filteredAccounts = accounts.filter((account) => !searchQuery || matches(account.code, account.description) || visibleSubs(account).length > 0);
  const matchCount = searchQuery
    ? filteredAccounts.reduce((n, a) => n + (matches(a.code, a.description) ? 1 : 0) + a.subAccounts.filter((sub) => matches(sub.code, sub.description)).length, 0)
    : 0;

  /** Resalta en el texto la parte buscada (solo coincidencias literales). */
  const Hl = ({ text, field }: { text: string; field: "code" | "description" }) => {
    if (!searchQuery || (searchField !== "all" && searchField !== field)) return <>{text}</>;
    const words = field === "code" ? [searchQuery] : searchQuery.split(/\s+/).filter(Boolean);
    const plain = norm(text);
    const marks: [number, number][] = [];
    words.forEach((w) => { const i = plain.indexOf(w); if (i >= 0) marks.push([i, i + w.length]); });
    if (!marks.length) return <>{text}</>;
    marks.sort((a, b) => a[0] - b[0]);
    const out: React.ReactNode[] = [];
    let pos = 0;
    marks.forEach(([a, b], k) => {
      if (a < pos) return;
      out.push(text.slice(pos, a));
      out.push(<mark key={k} className="rounded-sm bg-amber-100 px-px text-inherit">{text.slice(a, b)}</mark>);
      pos = b;
    });
    out.push(text.slice(pos));
    return <>{out}</>;
  };

  const expandAll = () => setExpandedAccounts(new Set(accounts.map((a) => a.id)));
  const collapseAll = () => setExpandedAccounts(new Set());

  const formatCurrency = (amount: number): string => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(amount || 0);

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

  // ── Vista ──────────────────────────────────────────────────────────────────
  const execTone = (pct: number) => (pct > 100 ? "over" : pct >= 90 ? "warn" : "ok");
  const isAtRisk = (budgeted: number, executed: number) => budgeted > 0 ? executed / budgeted >= 0.9 : executed > 0;
  const visibleAccounts = filteredAccounts.filter((a) => {
    if (view !== "risk") return true;
    const t = getAccountTotals(a);
    return isAtRisk(t.budgeted, t.executed);
  });
  const riskCount = accounts.filter((a) => { const t = getAccountTotals(a); return isAtRisk(t.budgeted, t.executed); }).length;
  const allExpanded = accounts.length > 0 && expandedAccounts.size === accounts.length;
  const totalExecuted = summary.totalCommitted + summary.totalActual + summary.totalBox;
  const totalExecutionPercent = summary.totalBudgeted > 0 ? (totalExecuted / summary.totalBudgeted) * 100 : 0;

  // Exporta la tabla tal y como está (cuentas y subcuentas) a CSV para Excel.
  const exportCsv = () => {
    const n = (v: number) => (v || 0).toFixed(2).replace(".", ",");
    const q = (s: string) => `"${(s || "").replace(/"/g, '""')}"`;
    const lines = [["Código", "Descripción", "Presupuesto", "Comprometido", "Realizado", "Caja", "Disponible", "% Ejecución"].join(";")];
    accounts.forEach((a) => {
      const t = getAccountTotals(a);
      lines.push([q(a.code), q(a.description), n(t.budgeted), n(t.committed), n(t.actual), n(t.box), n(t.available), n(getExecutionPercent(t.executed, t.budgeted))].join(";"));
      a.subAccounts.forEach((s) => {
        const ex = s.committed + s.actual + s.box;
        lines.push([q(s.code), q(s.description), n(s.budgeted), n(s.committed), n(s.actual), n(s.box), n(s.budgeted - ex), n(getExecutionPercent(ex, s.budgeted))].join(";"));
      });
    });
    lines.push([q("TOTAL"), q(""), n(summary.totalBudgeted), n(summary.totalCommitted), n(summary.totalActual), n(summary.totalBox), n(summary.totalAvailable), n(totalExecutionPercent)].join(";"));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Presupuesto_${projectName || "proyecto"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <PageLoading />;

  if (accessError || !hasAccess) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-white px-6 ${inter.className}`}>
        <div className="text-center">
          <p className="text-[15px] font-semibold text-slate-900">Sin acceso</p>
          <p className="mt-1 text-[13px] text-slate-500">{accessError || "No tienes permiso para ver el presupuesto."}</p>
          <Link href={`/project/${id}/accounting`} className={`${buttonClass("primary")} mt-5`}>Volver al panel</Link>
        </div>
      </div>
    );
  }

  const num = (v: number) => formatCurrency(v);
  const availableClass = (available: number, budgeted: number) =>
    available < 0 ? "text-red-700" : budgeted > 0 && available / budgeted < 0.1 ? "text-amber-800" : "text-slate-900";
  const ExecCell = ({ executed, budgeted, strong }: { executed: number; budgeted: number; strong?: boolean }) => {
    const pct = getExecutionPercent(executed, budgeted);
    const tone = execTone(pct);
    return (
      <div className="flex items-center justify-end gap-2">
        <span aria-hidden="true" className="flex h-[3px] w-14 overflow-hidden rounded-full bg-[#F1F1F3]">
          <span className={tone === "over" ? "bg-red-600" : tone === "warn" ? "bg-amber-600" : "bg-[#2F52E0]"} style={{ width: `${Math.min(pct, 100)}%` }} />
        </span>
        <span className={`w-10 text-right tabular-nums ${strong ? "font-medium" : ""} ${tone === "over" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "text-slate-600"}`}>
          {pct.toFixed(0)} %
        </span>
      </div>
    );
  };

  const formTitle = modalMode === "account" ? (editMode ? "Editar cuenta" : "Nueva cuenta") : (editMode ? "Editar subcuenta" : "Nueva subcuenta");
  const closeForm = () => { setShowModal(false); resetForm(); };
  const submitForm = modalMode === "account" ? (editMode ? handleUpdateAccount : handleCreateAccount) : (editMode ? handleUpdateSubAccount : handleCreateSubAccount);
  const importAccounts = importData.filter((d) => d.type === "CUENTA").length;
  const importSubs = importData.filter((d) => d.type === "SUBCUENTA").length;
  const IMPORT_STEPS = [["upload", "Archivo"], ["preview", "Revisión"], ["importing", "Importación"], ["done", "Listo"]] as const;
  const stepIndex = IMPORT_STEPS.findIndex(([s]) => s === importStep);

  return (
    <Page>
      <PageHeader
        title="Presupuesto"
        actions={
          <>
            <Menu trigger={(toggle) => <IconButton label="Más acciones" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
              {(close) => (
                <>
                  <MenuItem onClick={() => { close(); exportCsv(); }}>Exportar a Excel (CSV)</MenuItem>
                  <MenuItem onClick={() => { close(); downloadTemplate(); }}>Descargar plantilla de importación</MenuItem>
                </>
              )}
            </Menu>
            <Button variant="secondary" onClick={() => setShowImportModal(true)}><Upload size={14} /> Importar</Button>
            <Button variant="primary" onClick={openCreateAccountModal}><Plus size={14} /> Nueva cuenta</Button>
          </>
        }
      />

      {/* Barra de herramientas */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar
          fields={[
            { value: "all", label: "Buscar en todo", placeholder: "Código o descripción" },
            { value: "code", label: "Código de cuenta", placeholder: "Ej. 03 o 03.01", mono: true },
            { value: "description", label: "Descripción", placeholder: "Ej. atrezzo" },
          ]}
          field={searchField}
          onField={setSearchField}
          value={searchTerm}
          onChange={setSearchTerm}
          count={matchCount}
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: "Todas" },
            { value: "risk", label: riskCount ? `En riesgo · ${riskCount}` : "En riesgo" },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={allExpanded ? collapseAll : expandAll}>
          {allExpanded ? "Contraer todo" : "Desplegar todo"}
        </Button>
        </div>
      </div>

      {/* Tabla */}
      <div className="mt-4">
        {visibleAccounts.length === 0 ? (
          <EmptyState
            title={searchTerm ? "Sin resultados" : view === "risk" ? "Ninguna cuenta por encima del 90 %" : "Sin cuentas"}
            action={!searchTerm && view === "all" ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>Importar</Button>
                <Button variant="primary" size="sm" onClick={openCreateAccountModal}>Nueva cuenta</Button>
              </div>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[1080px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-8 py-2 pl-3" />
                  <th scope="col" className="w-28 px-2 py-2 text-left font-medium">Código</th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Descripción</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Presupuesto</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Comprometido</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Realizado</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Caja</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Disponible</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Ejecución</th>
                  <th scope="col" className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map((account) => {
                  const t = getAccountTotals(account);
                  const subs = visibleSubs(account);
                  const open = expandedAccounts.has(account.id) || (!!searchQuery && subs.length > 0 && !matches(account.code, account.description));
                  const tracking = account.trackingDepartments;
                  return (
                    <Fragment key={account.id}>
                      <tr className="border-b border-slate-100 bg-[#FAFAFA]/60 hover:bg-[#F4F4F5]">
                        <td className="py-1 pl-3">
                          <button
                            onClick={() => toggleAccount(account.id)}
                            aria-label={open ? "Contraer cuenta" : "Desplegar cuenta"}
                            aria-expanded={open}
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-white hover:text-slate-900"
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-2 py-1 font-mono text-xs font-semibold"><Hl text={account.code} field="code" /></td>
                        <td className="px-2 py-1">
                          <span className="flex items-center gap-2">
                            <span className="font-medium"><Hl text={account.description} field="description" /></span>
                            <span className="text-[11px] text-slate-500">{account.subAccounts.length}</span>
                            {tracking.length > 0 && (
                              <button onClick={() => openTracking(account)} title={`Seguimiento: ${tracking.join(", ")}`}>
                                <Badge><Eye size={11} /> {tracking.length === 1 ? tracking[0] : `${tracking.length} dptos.`}</Badge>
                              </button>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs font-semibold">{num(t.budgeted)}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs">{num(t.committed)}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs">{num(t.actual)}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-xs">{num(t.box)}</td>
                        <td className={`px-3 py-1 text-right tabular-nums text-xs font-semibold ${availableClass(t.available, t.budgeted)}`}>{num(t.available)}</td>
                        <td className="px-3 py-1 text-xs"><ExecCell executed={t.executed} budgeted={t.budgeted} strong /></td>
                        <td className="py-1 pr-3 text-right">
                          <Menu trigger={(toggle) => <IconButton label="Acciones de la cuenta" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                            {(close) => (
                              <>
                                <MenuItem onClick={() => { close(); openCreateSubAccountModal(account); }}>Añadir subcuenta</MenuItem>
                                <MenuItem onClick={() => { close(); openEditAccountModal(account); }}>Editar cuenta</MenuItem>
                                <MenuItem onClick={() => { close(); openTracking(account); }}>Seguimiento de cuenta…</MenuItem>
                                <MenuSeparator />
                                <MenuItem danger onClick={() => { close(); handleDeleteAccount(account.id); }}>Eliminar</MenuItem>
                              </>
                            )}
                          </Menu>
                        </td>
                      </tr>

                      {open && subs.map((sub) => {
                        const executed = sub.committed + sub.actual + sub.box;
                        const available = sub.budgeted - executed;
                        return (
                          <tr key={sub.id} className="group border-b border-slate-100 hover:bg-[#FAFAFA]">
                            <td className="py-1 pl-3" />
                            <td className="py-1 pl-5 pr-2 font-mono text-xs text-slate-500"><Hl text={sub.code} field="code" /></td>
                            <td className="px-2 py-1 text-slate-700"><Hl text={sub.description} field="description" /></td>
                            <td className="px-3 py-1 text-right tabular-nums text-xs">{num(sub.budgeted)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-600">{num(sub.committed)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-600">{num(sub.actual)}</td>
                            <td className="px-3 py-1 text-right tabular-nums text-xs text-slate-600">{num(sub.box)}</td>
                            <td className={`px-3 py-1 text-right tabular-nums text-xs ${availableClass(available, sub.budgeted)}`}>{num(available)}</td>
                            <td className="px-3 py-1 text-xs"><ExecCell executed={executed} budgeted={sub.budgeted} /></td>
                            <td className="py-1 pr-3 text-right">
                              <Menu trigger={(toggle) => <IconButton label="Acciones de la subcuenta" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                                {(close) => (
                                  <>
                                    <MenuItem onClick={() => { close(); openEditSubAccountModal(account, sub); }}>Editar subcuenta</MenuItem>
                                    <MenuSeparator />
                                    <MenuItem danger onClick={() => { close(); handleDeleteSubAccount(account.id, sub.id); }}>Eliminar</MenuItem>
                                  </>
                                )}
                              </Menu>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })}
              </tbody>
              {view === "all" && !searchTerm && (
                <tfoot>
                  <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
                    <td className="py-2.5 pl-3" />
                    <td className="px-2 py-2.5 font-semibold" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{num(summary.totalBudgeted)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{num(summary.totalCommitted)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{num(summary.totalActual)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{num(summary.totalBox)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${availableClass(summary.totalAvailable, summary.totalBudgeted)}`}>{num(summary.totalAvailable)}</td>
                    <td className="px-3 py-2.5"><ExecCell executed={totalExecuted} budgeted={summary.totalBudgeted} strong /></td>
                    <td className="py-2.5 pr-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Cuenta / subcuenta */}
      <Modal
        open={showModal}
        onClose={closeForm}
        title={formTitle}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm}>Cancelar</Button>
            <Button variant="primary" onClick={submitForm} disabled={saving}>{editMode ? "Guardar" : "Crear"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {modalMode === "subaccount" && selectedAccount && (
            <p className="text-[13px] text-slate-600">
              <span className="font-mono text-slate-500">{selectedAccount.code}</span> {selectedAccount.description}
            </p>
          )}
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Código">
              <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} className="tabular-nums" autoFocus />
            </Field>
            <Field label="Descripción">
              <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </Field>
          </div>
          {modalMode === "subaccount" && (
            <Field label="Presupuesto (€)">
              <Input type="number" min="0" step="0.01" value={formData.budgeted} onChange={(e) => setFormData({ ...formData, budgeted: parseFloat(e.target.value) || 0 })} className="text-right tabular-nums" />
            </Field>
          )}
        </div>
      </Modal>

      {/* Importar */}
      <Modal
        open={showImportModal}
        onClose={closeImportModal}
        title="Importar presupuesto"
        width="max-w-3xl"
        footer={
          importStep === "upload" ? (
            <Button variant="secondary" onClick={closeImportModal}>Cancelar</Button>
          ) : importStep === "preview" ? (
            <>
              <Button variant="ghost" onClick={resetImport}>Cambiar archivo</Button>
              <Button variant="primary" onClick={executeImport} disabled={importAccounts + importSubs === 0}>
                Importar {importAccounts} cuentas y {importSubs} subcuentas
              </Button>
            </>
          ) : importStep === "done" ? (
            <Button variant="primary" onClick={closeImportModal}>Cerrar</Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          <ol className="flex items-center gap-2 text-xs">
            {IMPORT_STEPS.map(([key, label], i) => (
              <li key={key} className="flex items-center gap-2">
                <span className={i === stepIndex ? "font-semibold text-slate-900" : i < stepIndex ? "text-slate-600" : "text-slate-400"}>
                  <span className="font-mono">{String(i + 1).padStart(2, "0")}</span> {label}
                </span>
                {i < IMPORT_STEPS.length - 1 && <span className="text-slate-300">/</span>}
              </li>
            ))}
          </ol>

          {importStep === "upload" && (
            <>
              <label
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${
                  isDragging ? "border-slate-900 bg-[#F4F4F5]" : "border-slate-300 hover:bg-[#FAFAFA]"
                }`}
              >
                <FileSpreadsheet size={22} className="text-slate-400" />
                <span className="text-[13px] font-medium text-slate-900">{isDragging ? "Suelta el archivo" : "Arrastra el archivo o haz clic para elegirlo"}</span>
                <span className="text-xs text-slate-500">.xlsx o .fwb (Budgeting)</span>
                <input type="file" accept=".xlsx,.xls,.fwb" onChange={handleImportFile} className="hidden" />
              </label>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Formato</span>
                  <button onClick={downloadTemplate} className="text-xs font-medium text-slate-900 hover:underline">Descargar plantilla</button>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 tabular-nums text-xs">
                  <div className="grid min-w-[480px] grid-cols-[80px_120px_1fr_100px] gap-2 border-b border-slate-200 bg-[#FAFAFA] px-3 py-1.5 text-[11px] text-slate-500">
                    <span>CUENTA</span><span>SUBCUENTA</span><span>DESCRIPCIÓN</span><span className="text-right">PRESUPUESTO</span>
                  </div>
                  <div className="grid min-w-[480px] grid-cols-[80px_120px_1fr_100px] gap-2 px-3 py-1 font-semibold">
                    <span>01</span><span className="text-slate-300">—</span><span>GUION Y MÚSICA</span><span className="text-right text-slate-300">—</span>
                  </div>
                  <div className="grid min-w-[480px] grid-cols-[80px_120px_1fr_100px] gap-2 px-3 py-1 text-slate-600">
                    <span>01</span><span>01-01-0100</span><span>Derechos de autor</span><span className="text-right">10000</span>
                  </div>
                  <div className="grid min-w-[480px] grid-cols-[80px_120px_1fr_100px] gap-2 px-3 py-1 text-slate-600">
                    <span>01</span><span>01-01-0200</span><span>Argumento original</span><span className="text-right">5000</span>
                  </div>
                </div>
                <p className="text-xs text-slate-500">Subcuenta vacía: fila de cuenta. Con valor: subcuenta de la cuenta indicada. También acepta el .fwb descargado de Budgeting.</p>
              </div>
            </>
          )}

          {importStep === "preview" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-medium text-slate-900">{importFileName}</span>
                <button
                  onClick={() => {
                    const all = importData.filter((d) => d.type === "CUENTA").map((d) => d.code);
                    setExpandedImportAccounts(expandedImportAccounts.size > 0 ? new Set() : new Set(all));
                  }}
                  className="text-slate-600 hover:text-slate-900"
                >
                  {expandedImportAccounts.size > 0 ? "Contraer todo" : "Desplegar todo"}
                </button>
              </div>
              <div className="max-h-[380px] overflow-y-auto rounded-md border border-slate-200">
                {importData.filter((d) => d.type === "CUENTA").map((acc) => {
                  const subs = importData.filter((d) => d.type === "SUBCUENTA" && d.parentCode === acc.code);
                  const open = expandedImportAccounts.has(acc.code);
                  const total = subs.reduce((s, x) => s + x.budgeted, 0);
                  return (
                    <div key={acc.code} className="border-b border-slate-100 last:border-0">
                      <button
                        onClick={() => setExpandedImportAccounts((prev) => { const n = new Set(prev); n.has(acc.code) ? n.delete(acc.code) : n.add(acc.code); return n; })}
                        className="flex w-full items-center gap-2 bg-[#FAFAFA] px-3 py-1.5 text-left hover:bg-[#F4F4F5]"
                      >
                        <ChevronRight size={13} className={`flex-shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                        <span className="w-12 flex-shrink-0 font-mono text-xs font-semibold">{acc.code}</span>
                        <span className="flex-1 truncate text-[13px] font-medium">{acc.description}</span>
                        <span className="text-[11px] text-slate-500">{subs.length}</span>
                        <span className="w-28 text-right tabular-nums text-xs">{total > 0 ? num(total) : ""}</span>
                      </button>
                      {open && subs.map((s) => (
                        <div key={s.code} className="flex items-center gap-2 py-1.5 pl-9 pr-3">
                          <span className="w-28 flex-shrink-0 font-mono text-xs text-slate-500">{s.code}</span>
                          <span className="flex-1 truncate text-xs text-slate-700">{s.description}</span>
                          <span className="w-28 text-right tabular-nums text-xs text-slate-600">{s.budgeted > 0 ? num(s.budgeted) : ""}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {importStep === "importing" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Spinner className="h-6 w-6" />
              <span className="tabular-nums text-xs text-slate-600">{importProgress} %</span>
            </div>
          )}

          {importStep === "done" && (
            <p className="py-6 text-center text-[13px] text-slate-900">
              {importResults.accounts} cuentas y {importResults.subaccounts} subcuentas importadas
              {importResults.errors > 0 && <span className="text-red-700"> · {importResults.errors} errores</span>}
            </p>
          )}
        </div>
      </Modal>

      {/* Confirmación */}
      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>
              {confirmDialog?.confirmLabel || "Confirmar"}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>

      {/* .fwb: qué nivel de Budgeting pasa a ser la subcuenta */}
      <Modal
        open={showFwbMappingModal}
        onClose={() => { setShowFwbMappingModal(false); setPendingFwbBytes(null); }}
        title="Cuentas y subcuentas"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowFwbMappingModal(false); setPendingFwbBytes(null); }}>Cancelar</Button>
            <Button variant="primary" onClick={confirmFwbMapping}>Continuar</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-slate-600">Contabilidad usa dos niveles y Budgeting tres. Elige qué código se asignará en POs, facturas y cajas.</p>
          <BudgetLevelMappingChoice value={fwbSubaccountLevel} onChange={setFwbSubaccountLevel} />
        </div>
      </Modal>

      {/* Seguimiento de cuenta */}
      <Modal
        open={!!trackingAccount}
        onClose={() => setTrackingAccount(null)}
        title="Seguimiento de cuenta"
        footer={
          <>
            <Button variant="secondary" onClick={() => setTrackingAccount(null)}>Cancelar</Button>
            <Button variant="primary" onClick={saveTracking} disabled={saving}>Guardar</Button>
          </>
        }
      >
        {trackingAccount && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-slate-900">
              <span className="font-mono text-slate-500">{trackingAccount.code}</span> {trackingAccount.description}
            </p>
            <p className="text-xs text-slate-500">HOD y coordinación de estos departamentos verán el comprometido y el realizado de la cuenta en su panel. Nunca el presupuesto.</p>
            {projectDepartments.length === 0 ? (
              <p className="text-[13px] text-slate-500">El proyecto no tiene departamentos.</p>
            ) : (
              <div className="flex max-h-72 flex-col overflow-y-auto border-t border-slate-100 pt-2">
                {projectDepartments.map((d) => (
                  <Checkbox
                    key={d}
                    label={d}
                    checked={trackingSel.includes(d)}
                    onChange={(v) => setTrackingSel((prev) => (v ? [...prev, d] : prev.filter((x) => x !== d)))}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Avisos */}
    </Page>
  );
}
