"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import React, { Fragment, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";

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
  Wallet,
  X,
} from "lucide-react";

// ─── Libraries ───────────────────────────────────────────────────────────────
import { strToU8, unzipSync, zipSync } from "fflate";

// ─── Internal ────────────────────────────────────────────────────────────────
import { CostSettings, getCostSettings, shouldCommitPO, shouldRealizeInvoice } from "@/lib/budgetRules";

// ─────────────────────────────────────────────────────────────────────────────

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

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

      // Cargar gastos de caja (BOX) y calcular por subcuenta
      // Solo cuentan los gastos Pleo con status "accounted" (sobre cerrado)
      const boxBySubaccount: Record<string, number> = {};
      const boxExpensesSnapshot = await getDocs(collection(db, `projects/${id}/cardExpenses`));
      boxExpensesSnapshot.docs.forEach(expDoc => {
        const expData = expDoc.data();
        if (expData.status === "accounted" && expData.subAccountCode) {
          const key = expData.subAccountCode;
          boxBySubaccount[key] = (boxBySubaccount[key] || 0) + (expData.baseAmount || 0);
        }
      });

      // Cargar gastos de transferencias (todos cuentan, se suman al crear)
      const transferExpensesSnapshot = await getDocs(collection(db, `projects/${id}/transferExpenses`));
      transferExpensesSnapshot.docs.forEach(expDoc => {
        const expData = expDoc.data();
        if (expData.subAccountCode) {
          const key = expData.subAccountCode;
          boxBySubaccount[key] = (boxBySubaccount[key] || 0) + (expData.baseAmount || 0);
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
              box: boxBySubaccount[subCode] || 0,
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

  // ── XLSX import/export (usando fflate, igual que reports) ─────────────────

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const buildTemplateXlsx = (): Uint8Array => {
    // Filas de la hoja principal
    const templateRows: [string, string, string | number][] = [
      ["CÓDIGO", "DESCRIPCIÓN", "PRESUPUESTADO"],
      ["01", "GUION Y MÚSICA", ""],
      ["01.01", "Derechos de autor", 5000],
      ["01.02", "Música original", 3000],
      ["02", "PRODUCCIÓN", ""],
      ["02.01", "Equipo técnico", 50000],
      ["02.02", "Material y consumibles", 10000],
      ["03", "POSTPRODUCCIÓN", ""],
      ["03.01", "Montaje", 20000],
      ["03.02", "Sonido", 8000],
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

    // Hoja instrucciones (texto plano)
    const instrLines = [
      "INSTRUCCIONES DE IMPORTACIÓN",
      "",
      "Columna A — CÓDIGO",
      "  · Cuentas principales: número entero  (01, 02, 03…)",
      "  · Subcuentas: código con punto        (01.01, 01.02…)",
      "  · El tipo se detecta automáticamente: no hace falta columna TIPO.",
      "",
      "Columna B — DESCRIPCIÓN",
      "  · Texto libre. Puedes usar comas, tildes y cualquier carácter.",
      "",
      "Columna C — PRESUPUESTADO",
      "  · Solo para subcuentas. Deja en blanco las filas de cuenta principal.",
      "  · Número sin símbolo de moneda ni puntos de millar (ej: 50000).",
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

    const mainColsXml = `<col min="1" max="1" width="14" customWidth="1"/>
<col min="2" max="2" width="42" customWidth="1"/>
<col min="3" max="3" width="18" customWidth="1"/>`;

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
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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

      const normalize = (s: string) =>
        s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      const headerIdx = allRows.findIndex(r => r.some(c => normalize(c).startsWith("CODIGO")));
      const dataRows = allRows.slice(headerIdx >= 0 ? headerIdx + 1 : 1);

      const data: { code: string; description: string; type: string; budgeted: number; parentCode: string | null }[] = [];

      dataRows.forEach((row) => {
        const code = (row[0] ?? "").trim();
        const description = (row[1] ?? "").trim();
        const budgetedRaw = (row[2] ?? "").trim();
        if (!code && !description) return;

        const type = isSubAccountCode(code) ? "SUBCUENTA" : "CUENTA";
        const budgeted = budgetedRaw !== "" ? parseFloat(budgetedRaw.replace(",", ".")) || 0 : 0;

        // Intentar auto-asignar cuenta padre por prefijo del código
        let parentCode: string | null = null;
        if (type === "SUBCUENTA") {
          const prefix = code.split(/[.\-\/]/)[0];
          const existsInImport = data.some(d => d.type === "CUENTA" && d.code === prefix);
          const existsInDB = accounts.some(a => a.code === prefix);
          if (existsInImport || existsInDB) parentCode = prefix;
          // Si no se encuentra → parentCode queda null (sin asignar, usuario la colocará)
        }

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

  const handleFileSelect = (file: File) => {
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
      const parsed = parseImportFile(bytes);
      if (parsed.length > 0) {
        setImportData(parsed);
        setImportPhase("select");
        setImportStep("preview");
      }
    };
    reader.readAsArrayBuffer(file);
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
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
      handleFileSelect(file);
    } else {
      setErrorMessage("Por favor, sube un archivo .xlsx");
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
    setExpandedImportAccounts(new Set());
    setImportPhase("select");
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

  const totalExecuted = summary.totalCommitted + summary.totalActual + summary.totalBox;
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
                  <th className="text-right px-2 py-2.5 text-[10px] font-semibold text-amber-600 uppercase tracking-wider min-w-[80px]">Box</th>
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
                        <td className="px-2 py-2 text-right font-bold text-amber-600 tabular-nums text-xs">{formatCurrency(totals.box)}</td>
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
                        const available = subAccount.budgeted - subAccount.committed - subAccount.actual - subAccount.box;
                        const executed = subAccount.committed + subAccount.actual + subAccount.box;
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
                            <td className="px-2 py-1.5 text-right text-amber-600 tabular-nums text-xs">{formatCurrency(subAccount.box)}</td>
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
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-xs text-amber-400">{formatCurrency(summary.totalBox)}</td>
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
                    {importStep === "upload" && "Sube un archivo Excel (.xlsx) con tu presupuesto"}
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
                      {isDragging ? "¡Suelta el archivo aquí!" : "Arrastra tu archivo Excel aquí"}
                    </p>
                    <p className="text-sm text-slate-500 mb-4">o haz clic para seleccionar · .xlsx</p>
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
                        <Upload size={16} />
                        Seleccionar archivo
                      </span>
                      <input type="file" accept=".xlsx,.xls" onChange={handleImportFile} className="hidden" />
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
                          Descargar plantilla Excel
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Format Info */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <h4 className="font-medium text-slate-900 mb-2 text-sm">Formato de la plantilla:</h4>
                    <div className="font-mono text-xs bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto">
                      <div className="text-slate-400 mb-1">CÓDIGO · DESCRIPCIÓN · PRESUPUESTADO</div>
                      <div className="text-slate-700">01 · Producción ·</div>
                      <div className="text-slate-700 pl-4">01.01 · Equipo técnico · 50000</div>
                      <div className="text-slate-700 pl-4">01.02 · Material · 25000</div>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">El tipo (cuenta / subcuenta) se detecta automáticamente según el formato del código. No hace falta columna TIPO.</p>
                  </div>
                </div>
              )}

              {/* Step 2: Revisar */}
              {importStep === "preview" && (
                <div className="p-5 space-y-4">

                  {/* Cabecera */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={15} className="text-slate-400" />
                      <span className="font-medium text-slate-900 text-sm">{importFileName}</span>
                      <span className="text-xs text-slate-400">· {importData.length} filas</span>
                    </div>
                    <button onClick={resetImport} className="text-xs text-slate-400 hover:text-slate-600">Cambiar archivo</button>
                  </div>

                  {/* ── FASE 1: el usuario marca cuáles son cuentas ── */}
                  {importPhase === "select" && (
                    <>
                      <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-white">Paso 1 — Marca las cuentas principales</p>
                          <p className="text-xs text-slate-400 mt-0.5">Las marcadas como cuenta serán las carpetas. El resto son subcuentas.</p>
                        </div>
                        <div className="text-right flex-shrink-0 ml-4">
                          <p className="text-lg font-bold text-blue-400">{importData.filter(d => d.type === "CUENTA").length}</p>
                          <p className="text-[10px] text-slate-500">cuentas</p>
                        </div>
                      </div>

                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-100">
                          {importData.map((row, index) => (
                            <div
                              key={index}
                              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                                row.type === "CUENTA" ? "bg-blue-50 hover:bg-blue-100" : "bg-white hover:bg-slate-50"
                              }`}
                              onClick={() => toggleRowType(index)}
                            >
                              {/* Icono tipo */}
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                row.type === "CUENTA" ? "bg-blue-500" : "bg-slate-100"
                              }`}>
                                {row.type === "CUENTA"
                                  ? <FileSpreadsheet size={13} className="text-white" />
                                  : <ChevronRight size={13} className="text-slate-400" />
                                }
                              </div>

                              <span className="font-mono text-xs text-slate-500 w-20 flex-shrink-0">{row.code}</span>
                              <span className={`text-sm flex-1 truncate ${row.type === "CUENTA" ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                                {row.description}
                              </span>
                              {row.budgeted > 0 && (
                                <span className="text-xs text-slate-500 tabular-nums flex-shrink-0">{formatCurrency(row.budgeted)} €</span>
                              )}
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                                row.type === "CUENTA" ? "bg-blue-200 text-blue-800" : "bg-slate-100 text-slate-500"
                              }`}>
                                {row.type === "CUENTA" ? "Cuenta" : "Subcuenta"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 text-center">Clic en cualquier fila para cambiar su tipo</p>
                    </>
                  )}

                  {/* ── FASE 2: resultado de distribución automática ── */}
                  {importPhase === "organize" && (
                    <>
                      {/* Estadísticas */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                          <p className="text-xl font-bold text-blue-700">{importData.filter(d => d.type === "CUENTA").length}</p>
                          <p className="text-[10px] text-blue-600">Cuentas</p>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                          <p className="text-xl font-bold text-emerald-700">{importData.filter(d => d.type === "SUBCUENTA" && d.parentCode).length}</p>
                          <p className="text-[10px] text-emerald-600">Asignadas auto</p>
                        </div>
                        <div className={`border rounded-xl p-3 text-center ${unassignedSubAccounts.length > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
                          <p className={`text-xl font-bold ${unassignedSubAccounts.length > 0 ? "text-amber-700" : "text-slate-400"}`}>
                            {unassignedSubAccounts.length}
                          </p>
                          <p className={`text-[10px] ${unassignedSubAccounts.length > 0 ? "text-amber-600" : "text-slate-500"}`}>Sin asignar</p>
                        </div>
                      </div>

                      {/* Excepciones: subcuentas sin asignar */}
                      {unassignedSubAccounts.length > 0 && (
                        <div className="border border-amber-200 rounded-xl overflow-hidden">
                          <div className="bg-amber-50 px-4 py-2.5 border-b border-amber-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <AlertCircle size={14} className="text-amber-600" />
                              <span className="text-xs font-semibold text-amber-800">
                                {unassignedSubAccounts.length} excepción{unassignedSubAccounts.length > 1 ? "es" : ""} — asignar manualmente
                              </span>
                            </div>
                            {/* Asignar todas de golpe */}
                            <select
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) assignAllUnassigned(e.target.value); e.target.value = ""; }}
                              className="text-xs border border-amber-300 rounded-lg px-2 py-1 bg-white text-slate-700"
                            >
                              <option value="">Todas a… ▾</option>
                              {availableParentAccounts.map(a => (
                                <option key={a.code} value={a.code}>{a.code} — {a.description}</option>
                              ))}
                            </select>
                          </div>
                          <div className="divide-y divide-amber-100 max-h-48 overflow-y-auto">
                            {unassignedSubAccounts.map((sub) => {
                              const subIdx = importData.indexOf(sub);
                              return (
                                <div key={sub.code} className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-amber-50">
                                  <span className="font-mono text-xs text-amber-600 w-20 flex-shrink-0">{sub.code}</span>
                                  <span className="text-xs text-slate-700 flex-1 truncate">{sub.description}</span>
                                  {sub.budgeted > 0 && <span className="text-xs text-slate-500 tabular-nums flex-shrink-0">{formatCurrency(sub.budgeted)} €</span>}
                                  <select
                                    value=""
                                    onChange={(e) => reassignParent(subIdx, e.target.value || null)}
                                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 max-w-[170px] flex-shrink-0"
                                  >
                                    <option value="">Asignar a…</option>
                                    {availableParentAccounts.map(a => (
                                      <option key={a.code} value={a.code}>{a.code} — {a.description}</option>
                                    ))}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Vista de carpetas (colapsada por defecto, expandible) */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Vista previa del presupuesto</span>
                          <div className="flex items-center gap-3">
                            <button onClick={() => setImportPhase("select")} className="text-xs text-slate-400 hover:text-slate-600">← Cambiar cuentas</button>
                            <button
                              onClick={() => {
                                const allCodes = importData.filter(d => d.type === "CUENTA").map(d => d.code);
                                setExpandedImportAccounts(expandedImportAccounts.size > 0 ? new Set() : new Set(allCodes));
                              }}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              {expandedImportAccounts.size > 0 ? "Colapsar" : "Expandir todo"}
                            </button>
                          </div>
                        </div>
                        <div className="max-h-[260px] overflow-y-auto divide-y divide-slate-100">
                          {importData.filter(d => d.type === "CUENTA").map((account) => {
                            const subs = importData.filter(d => d.type === "SUBCUENTA" && d.parentCode === account.code);
                            const isExpanded = expandedImportAccounts.has(account.code);
                            return (
                              <div key={account.code}>
                                <button
                                  onClick={() => setExpandedImportAccounts(prev => {
                                    const n = new Set(prev);
                                    n.has(account.code) ? n.delete(account.code) : n.add(account.code);
                                    return n;
                                  })}
                                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-left"
                                >
                                  <ChevronRight size={13} className={`text-slate-400 transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                                  <span className="font-mono text-xs font-bold text-slate-500 w-16 flex-shrink-0">{account.code}</span>
                                  <span className="text-sm font-semibold text-slate-800 flex-1 truncate">{account.description}</span>
                                  <span className="text-[10px] text-slate-400">{subs.length} subcuentas</span>
                                </button>
                                {isExpanded && subs.map(sub => {
                                  const subIdx = importData.indexOf(sub);
                                  return (
                                    <div key={sub.code} className="flex items-center gap-2 pl-12 pr-4 py-2 bg-white hover:bg-slate-50 group/s">
                                      <span className="font-mono text-xs text-slate-400 w-16 flex-shrink-0">{sub.code}</span>
                                      <span className="text-xs text-slate-600 flex-1 truncate">{sub.description}</span>
                                      {sub.budgeted > 0 && <span className="text-xs text-slate-500 tabular-nums">{formatCurrency(sub.budgeted)} €</span>}
                                      <select
                                        value={sub.parentCode ?? ""}
                                        onChange={(e) => reassignParent(subIdx, e.target.value || null)}
                                        className="opacity-0 group-hover/s:opacity-100 transition-opacity text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 max-w-[120px] flex-shrink-0"
                                      >
                                        {availableParentAccounts.map(a => (
                                          <option key={a.code} value={a.code}>{a.code} — {a.description}</option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
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

                  {importPhase === "select" && (
                    <button
                      onClick={confirmAccountsAndDistribute}
                      disabled={importData.filter(d => d.type === "CUENTA").length === 0}
                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Distribuir automáticamente →
                    </button>
                  )}

                  {importPhase === "organize" && (() => {
                    const readyCount = importData.filter(d => d.type === "CUENTA").length
                      + importData.filter(d => d.type === "SUBCUENTA" && d.parentCode).length;
                    return (
                      <>
                        {unassignedSubAccounts.length > 0 && (
                          <span className="text-xs text-amber-600 self-center">
                            {unassignedSubAccounts.length} sin asignar se omitirán
                          </span>
                        )}
                        <button
                          onClick={executeImport}
                          disabled={readyCount === 0}
                          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Upload size={16} />
                          Importar {readyCount} elementos
                        </button>
                      </>
                    );
                  })()}
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

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
