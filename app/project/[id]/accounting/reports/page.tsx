"use client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, orderBy } from "firebase/firestore";
import { Download, FileText, Receipt, Building2, Wallet, Settings2, ChevronDown, Check, X, Save, Trash2, BookMarked, Layers, GripVertical, Plus, Minus, FileSpreadsheet, Film, ShieldAlert, ArrowLeft } from "lucide-react";
import { getCostSettings, shouldCommitPO, shouldRealizeInvoice, CostSettings } from "@/lib/budgetRules";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

type ReportType = "budget" | "pos_list" | "pos_items" | "invoices" | "suppliers";

interface ReportColumn {
  id: string;
  label: string;
  enabled: boolean;
  locked?: boolean;
  isBlank?: boolean;
}

interface SelectedColumn {
  id: string;
  originalId: string;
  label: string;
  isBlank?: boolean;
}

interface ReportPreset {
  id: string;
  name: string;
  reportType: ReportType;
  columns: { id: string; isBlank?: boolean }[];
  createdAt: string;
}

const REPORT_COLUMNS: Record<ReportType, ReportColumn[]> = {
  budget: [
    { id: "code", label: "Código", enabled: true, locked: true },
    { id: "description", label: "Descripción", enabled: true },
    { id: "type", label: "Tipo", enabled: true },
    { id: "budgeted", label: "Presupuestado", enabled: true },
    { id: "committed", label: "Comprometido", enabled: true },
    { id: "actual", label: "Realizado", enabled: true },
    { id: "available", label: "Disponible", enabled: true },
    { id: "percentUsed", label: "% Utilizado", enabled: false },
  ],
  pos_list: [
    { id: "number", label: "Nº PO", enabled: true, locked: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "description", label: "Descripción", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxAmount", label: "IVA", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "isOpen", label: "Abierta/Cerrada", enabled: true },
    { id: "createdAt", label: "Fecha creación", enabled: true },
    { id: "createdBy", label: "Creado por", enabled: false },
    { id: "approvedAt", label: "Fecha aprobación", enabled: false },
    { id: "approvedBy", label: "Aprobado por", enabled: false },
    { id: "itemCount", label: "Nº ítems", enabled: false },
  ],
  pos_items: [
    { id: "poNumber", label: "Nº PO", enabled: true, locked: true },
    { id: "poDescription", label: "Descripción PO", enabled: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "itemNumber", label: "Nº Ítem", enabled: true },
    { id: "itemDescription", label: "Descripción ítem", enabled: true },
    { id: "episode", label: "Capítulo", enabled: true },
    { id: "accountCode", label: "Código cuenta", enabled: true },
    { id: "accountDescription", label: "Cuenta", enabled: false },
    { id: "subaccountCode", label: "Código subcuenta", enabled: true },
    { id: "subaccountDescription", label: "Subcuenta", enabled: false },
    { id: "baseCommitted", label: "Base comprometido", enabled: true },
    { id: "totalCommitted", label: "Total comprometido", enabled: true },
    { id: "baseInvoiced", label: "Base facturado", enabled: true },
    { id: "baseAvailable", label: "Base disponible", enabled: true },
    { id: "totalAvailable", label: "Total disponible", enabled: true },
    { id: "poStatus", label: "Estado PO", enabled: true },
    { id: "isOpen", label: "Abierta/Cerrada", enabled: true },
    { id: "itemClosed", label: "Item cerrado", enabled: false },
    { id: "taxRate", label: "% IVA", enabled: false },
    { id: "irpfRate", label: "% IRPF", enabled: false },
  ],
  invoices: [
    { id: "number", label: "Nº Factura", enabled: true, locked: true },
    { id: "supplier", label: "Proveedor", enabled: true },
    { id: "supplierTaxId", label: "NIF Proveedor", enabled: false },
    { id: "description", label: "Descripción", enabled: true },
    { id: "poNumber", label: "Nº PO asociada", enabled: true },
    { id: "episode", label: "Capítulo", enabled: true },
    { id: "baseAmount", label: "Base imponible", enabled: true },
    { id: "taxAmount", label: "IVA", enabled: false },
    { id: "irpfAmount", label: "IRPF", enabled: false },
    { id: "totalAmount", label: "Total", enabled: true },
    { id: "status", label: "Estado", enabled: true },
    { id: "dueDate", label: "Vencimiento", enabled: true },
    { id: "createdAt", label: "Fecha registro", enabled: true },
    { id: "paidAt", label: "Fecha pago", enabled: false },
    { id: "accountCode", label: "Cuenta", enabled: false },
  ],
  suppliers: [
    { id: "fiscalName", label: "Nombre fiscal", enabled: true, locked: true },
    { id: "commercialName", label: "Nombre comercial", enabled: true },
    { id: "taxId", label: "NIF/CIF", enabled: true },
    { id: "contactName", label: "Contacto", enabled: true },
    { id: "contactEmail", label: "Email", enabled: true },
    { id: "contactPhone", label: "Teléfono", enabled: true },
    { id: "address", label: "Dirección", enabled: false },
    { id: "city", label: "Ciudad", enabled: false },
    { id: "postalCode", label: "CP", enabled: false },
    { id: "paymentMethod", label: "Método pago", enabled: true },
    { id: "iban", label: "IBAN", enabled: true },
    { id: "paymentTerms", label: "Plazo pago", enabled: false },
    { id: "totalPOs", label: "Total POs", enabled: false },
    { id: "totalInvoiced", label: "Total facturado", enabled: false },
  ],
};

const REPORT_INFO: Record<ReportType, { title: string; description: string; icon: any; color: string }> = {
  budget: { title: "Presupuesto", description: "Cuentas, subcuentas y ejecución presupuestaria", icon: Wallet, color: "bg-slate-100 text-slate-600" },
  pos_list: { title: "Listado de POs", description: "Órdenes de compra con totales", icon: FileText, color: "bg-slate-100 text-slate-600" },
  pos_items: { title: "POs por ítems", description: "Desglose detallado de cada ítem de PO", icon: Layers, color: "bg-slate-100 text-slate-600" },
  invoices: { title: "Facturas", description: "Listado de facturas recibidas", icon: Receipt, color: "bg-slate-100 text-slate-600" },
  suppliers: { title: "Proveedores", description: "Directorio completo de proveedores", icon: Building2, color: "bg-slate-100 text-slate-600" },
};

export default function ReportsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [counts, setCounts] = useState({ pos: 0, invoices: 0, suppliers: 0, accounts: 0 });
  const [userId, setUserId] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  
  const [showConfig, setShowConfig] = useState(false);
  const [configReportType, setConfigReportType] = useState<ReportType | null>(null);
  const [availableColumns, setAvailableColumns] = useState<ReportColumn[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([]);
  const [draggedItem, setDraggedItem] = useState<number | null>(null);
  const [dragOverItem, setDragOverItem] = useState<number | null>(null);
  
  const [presets, setPresets] = useState<ReportPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [expandedReport, setExpandedReport] = useState<ReportType | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");

  // Estados para episodios
  const [episodesEnabled, setEpisodesEnabled] = useState(false);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [splitByEpisode, setSplitByEpisode] = useState(false);

  // Configuración de coste
  const [costConfig, setCostConfig] = useState<CostSettings>({
    poCommitmentTrigger: "on_approve",
    invoiceActualTrigger: "on_paid",
  });

  useEffect(() => {
    const savedPresets = localStorage.getItem(`report_presets_${id}`);
    if (savedPresets) setPresets(JSON.parse(savedPresets));
    
    // Cargar formato de exportación guardado
    const savedFormat = localStorage.getItem(`report_export_format`) as "csv" | "xlsx" | null;
    if (savedFormat) setExportFormat(savedFormat);
  }, [id]);

  const toggleExportFormat = () => {
    const newFormat = exportFormat === "csv" ? "xlsx" : "csv";
    setExportFormat(newFormat);
    localStorage.setItem(`report_export_format`, newFormat);
  };

  const savePresetsToStorage = (newPresets: ReportPreset[]) => {
    localStorage.setItem(`report_presets_${id}`, JSON.stringify(newPresets));
    setPresets(newPresets);
  };

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (!user) router.push("/");
      else setUserId(user.uid);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Verificar acceso: accounting o accounting_extended, o EP/PM
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
      const hasReportsAccess = accountingLevel === "accounting_extended" || accountingLevel === "accounting";
      
      if (!hasAccountingAccess || (!isEPorPM && !hasReportsAccess)) {
        setAccessError("No tienes permisos para acceder a los informes");
        setLoading(false);
        return;
      }
      setHasAccess(true);
      
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");
      
      const [posSnap, invoicesSnap, suppliersSnap, accountsSnap] = await Promise.all([
        getDocs(collection(db, `projects/${id}/pos`)),
        getDocs(collection(db, `projects/${id}/invoices`)),
        getDocs(collection(db, `projects/${id}/suppliers`)),
        getDocs(collection(db, `projects/${id}/accounts`)),
      ]);
      setCounts({ pos: posSnap.size, invoices: invoicesSnap.size, suppliers: suppliersSnap.size, accounts: accountsSnap.size });

      // Cargar configuración de episodios
      try {
        const productionDoc = await getDoc(doc(db, `projects/${id}/config/production`));
        if (productionDoc.exists()) {
          const prodData = productionDoc.data();
          if (prodData.projectType === "serie") {
            setTotalEpisodes(prodData.episodes || 0);
            
            const projectConfigDoc = await getDoc(doc(db, `projects/${id}/config/project`));
            if (projectConfigDoc.exists()) {
              const configData = projectConfigDoc.data();
              setEpisodesEnabled(configData.enableEpisodes || false);
            }
          }
        }
      } catch (epErr) {
        console.error("Error loading episodes config:", epErr);
      }

      // Cargar configuración de costes usando budgetRules
      try {
        const loadedCostConfig = await getCostSettings(id);
        setCostConfig(loadedCostConfig);
      } catch (ctErr) {
        console.error("Error loading cost config:", ctErr);
      }
    } catch (error) { 
      console.error("Error cargando datos:", error); 
    } finally { 
      setLoading(false); 
    }
  };

  const openConfig = (reportType: ReportType) => {
    setConfigReportType(reportType);
    const cols = REPORT_COLUMNS[reportType];
    setAvailableColumns(cols.filter(c => !c.enabled));
    setSelectedColumns(
      cols.filter(c => c.enabled).map((c, i) => ({
        id: `${c.id}_${i}`,
        originalId: c.id,
        label: c.label,
      }))
    );
    setShowConfig(true);
  };

  const addColumn = (column: ReportColumn) => {
    const newCol: SelectedColumn = {
      id: `${column.id}_${Date.now()}`,
      originalId: column.id,
      label: column.label,
    };
    setSelectedColumns([...selectedColumns, newCol]);
    setAvailableColumns(availableColumns.filter(c => c.id !== column.id));
  };

  const removeColumn = (columnId: string, originalId: string) => {
    const colDef = REPORT_COLUMNS[configReportType!].find(c => c.id === originalId);
    if (colDef?.locked) return;
    
    setSelectedColumns(selectedColumns.filter(c => c.id !== columnId));
    if (!colDef?.isBlank) {
      const original = REPORT_COLUMNS[configReportType!].find(c => c.id === originalId);
      if (original && !availableColumns.find(c => c.id === originalId)) {
        setAvailableColumns([...availableColumns, original]);
      }
    }
  };

  const addBlankColumn = () => {
    const blankCol: SelectedColumn = {
      id: `blank_${Date.now()}`,
      originalId: "blank",
      label: "(Columna vacía)",
      isBlank: true,
    };
    setSelectedColumns([...selectedColumns, blankCol]);
  };

  const handleDragStart = (index: number) => {
    setDraggedItem(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverItem(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedItem === null) return;
    
    const newColumns = [...selectedColumns];
    const draggedColumn = newColumns[draggedItem];
    newColumns.splice(draggedItem, 1);
    newColumns.splice(dropIndex, 0, draggedColumn);
    
    setSelectedColumns(newColumns);
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  const getDefaultColumns = (reportType: ReportType): SelectedColumn[] => {
    return REPORT_COLUMNS[reportType]
      .filter(c => c.enabled)
      .map((c, i) => ({
        id: `${c.id}_${i}`,
        originalId: c.id,
        label: c.label,
      }));
  };

  const savePreset = () => {
    if (!newPresetName.trim() || !configReportType) return;
    const newPreset: ReportPreset = {
      id: `preset_${Date.now()}`,
      name: newPresetName.trim(),
      reportType: configReportType,
      columns: selectedColumns.map(c => ({ id: c.originalId, isBlank: c.isBlank })),
      createdAt: new Date().toISOString(),
    };
    savePresetsToStorage([...presets, newPreset]);
    setNewPresetName("");
    setShowSavePreset(false);
  };

  const deletePreset = (presetId: string) => {
    savePresetsToStorage(presets.filter(p => p.id !== presetId));
  };

  const loadPreset = (preset: ReportPreset) => {
    const cols = preset.columns.map((c, i) => {
      if (c.isBlank) {
        return { id: `blank_${i}`, originalId: "blank", label: "(Columna vacía)", isBlank: true };
      }
      const original = REPORT_COLUMNS[preset.reportType].find(col => col.id === c.id);
      return { id: `${c.id}_${i}`, originalId: c.id, label: original?.label || c.id };
    });
    setSelectedColumns(cols);
    
    const usedIds = cols.filter(c => !c.isBlank).map(c => c.originalId);
    setAvailableColumns(REPORT_COLUMNS[preset.reportType].filter(c => !usedIds.includes(c.id)));
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
  const formatDate = (date: any) => date?.toDate ? new Date(date.toDate()).toLocaleDateString("es-ES") : "";
  const getCurrentDate = () => new Date().toISOString().split("T")[0];

  const downloadFile = async (rows: string[][], filename: string) => {
    if (exportFormat === "xlsx") {
      await downloadXLSX(rows, filename.replace(".csv", ".xlsx"));
    } else {
      downloadCSV(rows, filename);
    }
  };

  const downloadCSV = (rows: string[][], filename: string) => {
    const csvContent = rows.map(row => row.map(cell => {
      const escaped = (cell || "").toString().replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(";")).join("\n");
    
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", filename.endsWith(".csv") ? filename : filename + ".csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadXLSX = async (rows: string[][], filename: string) => {
    try {
      // Importar SheetJS dinámicamente
      const XLSX = await import("xlsx");
      
      // Crear worksheet desde los datos
      const ws = XLSX.utils.aoa_to_sheet(rows);
      
      // Ajustar anchos de columna automáticamente
      const colWidths = rows[0].map((_, colIndex) => {
        const maxLen = Math.max(...rows.map(row => (row[colIndex] || "").toString().length));
        return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
      });
      ws["!cols"] = colWidths;
      
      // Crear workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Datos");
      
      // Generar archivo y descargar
      XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : filename + ".xlsx");
    } catch (error) {
      console.error("Error generando XLSX:", error);
      // Fallback a CSV si falla
      downloadCSV(rows, filename.replace(".xlsx", ".csv"));
    }
  };

  const generateBudgetReport = async (columns: SelectedColumn[]) => {
    setGenerating("budget");
    try {
      const accountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts`), orderBy("code", "asc")));
      const rows: string[][] = [columns.map(col => col.isBlank ? "" : col.label)];
      
      for (const accountDoc of accountsSnapshot.docs) {
        const accountData = accountDoc.data();
        const subAccountsSnapshot = await getDocs(query(collection(db, `projects/${id}/accounts/${accountDoc.id}/subaccounts`), orderBy("code", "asc")));
        
        let accountBudgeted = 0, accountCommitted = 0, accountActual = 0;
        const subRows: any[] = [];
        
        subAccountsSnapshot.docs.forEach((subDoc) => {
          const subData = subDoc.data();
          const budgeted = subData.budgeted || 0, committed = subData.committed || 0, actual = subData.actual || 0;
          accountBudgeted += budgeted; accountCommitted += committed; accountActual += actual;
          const available = budgeted - committed - actual;
          const percentUsed = budgeted > 0 ? ((committed + actual) / budgeted * 100).toFixed(1) : "0";
          
          subRows.push({
            code: subData.code, description: subData.description, type: "SUBCUENTA",
            budgeted, committed, actual, available, percentUsed: `${percentUsed}%`
          });
        });
        
        const accountAvailable = accountBudgeted - accountCommitted - accountActual;
        const accountPercentUsed = accountBudgeted > 0 ? ((accountCommitted + accountActual) / accountBudgeted * 100).toFixed(1) : "0";
        
        const accountRow: any = {
          code: accountData.code, description: accountData.description, type: "CUENTA",
          budgeted: accountBudgeted, committed: accountCommitted, actual: accountActual,
          available: accountAvailable, percentUsed: `${accountPercentUsed}%`
        };
        
        rows.push(columns.map(col => {
          if (col.isBlank) return "";
          const val = accountRow[col.originalId];
          return typeof val === "number" ? formatCurrency(val) : val;
        }));
        
        subRows.forEach(subRow => {
          rows.push(columns.map(col => {
            if (col.isBlank) return "";
            const val = subRow[col.originalId];
            return typeof val === "number" ? formatCurrency(val) : val;
          }));
        });
      }
      
      await downloadFile(rows, `Presupuesto_${projectName}_${getCurrentDate()}.csv`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePOsListReport = async (columns: SelectedColumn[]) => {
    setGenerating("pos_list");
    try {
      const posSnapshot = await getDocs(query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc")));
      const rows: string[][] = [columns.map(col => col.isBlank ? "" : col.label)];
      
      for (const docSnap of posSnapshot.docs) {
        const data = docSnap.data();
        const items = data.items || [];
        
        const rowData: any = {
          number: data.number || data.displayNumber || "",
          supplier: data.supplier || "",
          description: data.description || "",
          baseAmount: data.baseAmount || 0,
          taxAmount: data.taxAmount || 0,
          totalAmount: data.totalAmount || 0,
          status: data.status || "",
          isOpen: data.isOpen !== false ? "Abierta" : "Cerrada",
          createdAt: formatDate(data.createdAt),
          createdBy: data.createdByName || "",
          approvedAt: formatDate(data.approvedAt),
          approvedBy: data.approvedByName || "",
          itemCount: items.length,
        };
        
        rows.push(columns.map(col => {
          if (col.isBlank) return "";
          const val = rowData[col.originalId];
          return typeof val === "number" ? formatCurrency(val) : val?.toString() || "";
        }));
      }
      
      await downloadFile(rows, `POs_Listado_${projectName}_${getCurrentDate()}.csv`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generatePOsItemsReport = async (columns: SelectedColumn[]) => {
    setGenerating("pos_items");
    try {
      const posSnapshot = await getDocs(query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc")));
      const invoicesSnapshot = await getDocs(collection(db, `projects/${id}/invoices`));
      
      // Crear mapa de facturas por PO y calcular facturado por item (solo facturas con estado válido según config)
      const invoicedByPOItem: Record<string, Record<number, number>> = {};
      invoicesSnapshot.docs.forEach(invDoc => {
        const invData = invDoc.data();
        const invStatus = invData.status || "";
        // Usar shouldRealizeInvoice para determinar si la factura cuenta
        if (invData.poId && invStatus !== "cancelled" && invStatus !== "rejected" && shouldRealizeInvoice(invStatus, costConfig)) {
          if (!invoicedByPOItem[invData.poId]) invoicedByPOItem[invData.poId] = {};
          (invData.items || []).forEach((invItem: any) => {
            const itemIndex = invItem.poItemIndex ?? -1;
            if (itemIndex >= 0) {
              invoicedByPOItem[invData.poId][itemIndex] = (invoicedByPOItem[invData.poId][itemIndex] || 0) + (invItem.baseAmount || 0);
            }
          });
        }
      });

      const rows: string[][] = [columns.map(col => col.isBlank ? "" : col.label)];
      
      for (const docSnap of posSnapshot.docs) {
        const poData = docSnap.data();
        const poStatus = poData.status || "";
        
        // Usar shouldCommitPO para determinar si la PO cuenta
        if (!shouldCommitPO(poStatus, costConfig)) continue;
        
        const poId = docSnap.id;
        const items = poData.items || [];
        const poInvoiced = invoicedByPOItem[poId] || {};
        
        items.forEach((item: any, index: number) => {
          const itemIsClosed = item.isClosed || false;
          const rawBaseAmount = item.baseAmount || item.amount || 0;
          const baseInvoiced = poInvoiced[index] || 0;
          const taxRate = item.vatRate || item.taxRate || 21;
          const irpfRate = item.irpfRate || 0;
          
          // Comprometido = lo pendiente de facturar (baseAmount - invoicedAmount)
          // Si item cerrado: comprometido = 0 (se liberó el resto)
          const baseCommitted = itemIsClosed ? 0 : Math.max(0, rawBaseAmount - baseInvoiced);
          const taxAmount = baseCommitted * (taxRate / 100);
          const irpfAmount = baseCommitted * (irpfRate / 100);
          const totalCommitted = baseCommitted + taxAmount - irpfAmount;
          
          // Disponible = comprometido (ya que comprometido es lo pendiente)
          const baseAvailable = baseCommitted;
          const totalAvailable = totalCommitted;

          // Determinar capítulo(s)
          const episodeAssignment = item.episodeAssignment || "general";
          const episodes = item.episodes || [];

          // Si splitByEpisode está activo y hay episodios específicos, crear una fila por cada uno
          if (splitByEpisode && episodeAssignment === "specific" && episodes.length > 0) {
            episodes.forEach((ep: any) => {
              const rawEpBaseAmount = ep.amount || 0;
              const epPercentage = rawBaseAmount > 0 ? rawEpBaseAmount / rawBaseAmount : 0;
              const epBaseInvoiced = baseInvoiced * epPercentage;
              
              // Comprometido del episodio = pendiente de facturar
              const epBaseCommitted = itemIsClosed ? 0 : Math.max(0, rawEpBaseAmount - epBaseInvoiced);
              const epTaxAmount = epBaseCommitted * (taxRate / 100);
              const epIrpfAmount = epBaseCommitted * (irpfRate / 100);
              const epTotalCommitted = epBaseCommitted + epTaxAmount - epIrpfAmount;
              const epBaseAvailable = epBaseCommitted;
              const epTotalAvailable = epTotalCommitted;
              
              const rowData: any = {
                poNumber: poData.number || poData.displayNumber || "",
                poDescription: poData.generalDescription || poData.description || "",
                supplier: poData.supplier || "",
                itemNumber: index + 1,
                itemDescription: item.description || "",
                episode: ep.episode.toString(),
                accountCode: item.accountCode || item.subAccountCode?.split(".")[0] || "",
                accountDescription: item.accountDescription || "",
                subaccountCode: item.subAccountCode || item.subaccountCode || "",
                subaccountDescription: item.subAccountDescription || item.subaccountDescription || "",
                baseCommitted: epBaseCommitted,
                totalCommitted: epTotalCommitted,
                baseInvoiced: epBaseInvoiced,
                baseAvailable: epBaseAvailable,
                totalAvailable: epTotalAvailable,
                poStatus: poData.status || "",
                isOpen: poData.isOpen !== false ? "Abierta" : "Cerrada",
                itemClosed: itemIsClosed ? "Sí" : "No",
                taxRate: `${taxRate}%`,
                irpfRate: `${irpfRate}%`,
              };
              
              rows.push(columns.map(col => {
                if (col.isBlank) return "";
                const val = rowData[col.originalId];
                if (typeof val === "number") return formatCurrency(val);
                return val?.toString() || "";
              }));
            });
          } else {
            // Fila única (general o sin desglose)
            const episodeLabel = episodeAssignment === "general" ? "0" : 
              episodes.length === 1 ? episodes[0].episode.toString() :
              episodes.length > 1 ? episodes.map((e: any) => e.episode).join(", ") : "0";
            
            const rowData: any = {
              poNumber: poData.number || poData.displayNumber || "",
              poDescription: poData.generalDescription || poData.description || "",
              supplier: poData.supplier || "",
              itemNumber: index + 1,
              itemDescription: item.description || "",
              episode: episodeLabel,
              accountCode: item.accountCode || item.subAccountCode?.split(".")[0] || "",
              accountDescription: item.accountDescription || "",
              subaccountCode: item.subAccountCode || item.subaccountCode || "",
              subaccountDescription: item.subAccountDescription || item.subaccountDescription || "",
              baseCommitted: baseCommitted,
              totalCommitted: totalCommitted,
              baseInvoiced: baseInvoiced,
              baseAvailable: baseAvailable,
              totalAvailable: totalAvailable,
              poStatus: poData.status || "",
              isOpen: poData.isOpen !== false ? "Abierta" : "Cerrada",
              itemClosed: itemIsClosed ? "Sí" : "No",
              taxRate: `${taxRate}%`,
              irpfRate: `${irpfRate}%`,
            };
            
            rows.push(columns.map(col => {
              if (col.isBlank) return "";
              const val = rowData[col.originalId];
              if (typeof val === "number") return formatCurrency(val);
              return val?.toString() || "";
            }));
          }
        });
      }
      
      await downloadFile(rows, `POs_Items_${projectName}_${getCurrentDate()}.csv`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateInvoicesReport = async (columns: SelectedColumn[]) => {
    setGenerating("invoices");
    try {
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      const rows: string[][] = [columns.map(col => col.isBlank ? "" : col.label)];
      
      invoicesSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const items = data.items || [];

        // Determinar capítulos de los items
        let episodeLabel = "0";
        const allEpisodes: number[] = [];
        
        items.forEach((item: any) => {
          const assignment = item.episodeAssignment || "general";
          if (assignment === "specific" && item.episodes && item.episodes.length > 0) {
            item.episodes.forEach((ep: any) => {
              if (!allEpisodes.includes(ep.episode)) {
                allEpisodes.push(ep.episode);
              }
            });
          }
        });

        if (allEpisodes.length > 0) {
          allEpisodes.sort((a, b) => a - b);
          episodeLabel = allEpisodes.length === 1 ? allEpisodes[0].toString() : allEpisodes.join(", ");
        }

        // Si splitByEpisode, crear filas separadas por capítulo
        if (splitByEpisode && allEpisodes.length > 1) {
          // Calcular importe por capítulo
          const amountByEpisode: Record<number, number> = {};
          items.forEach((item: any) => {
            const assignment = item.episodeAssignment || "general";
            if (assignment === "specific" && item.episodes && item.episodes.length > 0) {
              item.episodes.forEach((ep: any) => {
                amountByEpisode[ep.episode] = (amountByEpisode[ep.episode] || 0) + (ep.amount || 0);
              });
            } else {
              // General: se distribuye entre todos (ponemos en 0)
              amountByEpisode[0] = (amountByEpisode[0] || 0) + (item.baseAmount || 0);
            }
          });

          Object.entries(amountByEpisode).forEach(([epNum, amount]) => {
            const rowData: any = {
              number: data.number || data.displayNumber || "",
              supplier: data.supplier || "",
              supplierTaxId: data.supplierTaxId || "",
              description: data.description || "",
              poNumber: data.poNumber || "",
              episode: epNum,
              baseAmount: amount,
              taxAmount: amount * 0.21, // Aproximación
              irpfAmount: 0,
              totalAmount: amount * 1.21,
              status: data.status || "",
              dueDate: formatDate(data.dueDate),
              createdAt: formatDate(data.createdAt),
              paidAt: formatDate(data.paidAt),
              accountCode: data.accountCode || "",
            };
            
            rows.push(columns.map(col => {
              if (col.isBlank) return "";
              const val = rowData[col.originalId];
              return typeof val === "number" ? formatCurrency(val) : val?.toString() || "";
            }));
          });
        } else {
          const rowData: any = {
            number: data.number || data.displayNumber || "",
            supplier: data.supplier || "",
            supplierTaxId: data.supplierTaxId || "",
            description: data.description || "",
            poNumber: data.poNumber || "",
            episode: episodeLabel,
            baseAmount: data.baseAmount || 0,
            taxAmount: data.vatAmount || data.taxAmount || 0,
            irpfAmount: data.irpfAmount || 0,
            totalAmount: data.totalAmount || 0,
            status: data.status || "",
            dueDate: formatDate(data.dueDate),
            createdAt: formatDate(data.createdAt),
            paidAt: formatDate(data.paidAt),
            accountCode: data.accountCode || "",
          };
          
          rows.push(columns.map(col => {
            if (col.isBlank) return "";
            const val = rowData[col.originalId];
            return typeof val === "number" ? formatCurrency(val) : val?.toString() || "";
          }));
        }
      });
      
      await downloadFile(rows, `Facturas_${projectName}_${getCurrentDate()}.csv`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateSuppliersReport = async (columns: SelectedColumn[]) => {
    setGenerating("suppliers");
    try {
      const suppliersSnapshot = await getDocs(query(collection(db, `projects/${id}/suppliers`), orderBy("fiscalName", "asc")));
      const rows: string[][] = [columns.map(col => col.isBlank ? "" : col.label)];
      
      suppliersSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        
        const rowData: any = {
          fiscalName: data.fiscalName || "",
          commercialName: data.commercialName || "",
          taxId: data.taxId || "",
          contactName: data.contact?.name || "",
          contactEmail: data.contact?.email || "",
          contactPhone: data.contact?.phone || "",
          address: data.address || "",
          city: data.city || "",
          postalCode: data.postalCode || "",
          paymentMethod: data.paymentMethod || "",
          iban: data.bankAccount || data.iban || "",
          paymentTerms: data.paymentTerms || "",
          totalPOs: data.totalPOs || 0,
          totalInvoiced: data.totalInvoiced || 0,
        };
        
        rows.push(columns.map(col => {
          if (col.isBlank) return "";
          const val = rowData[col.originalId];
          return typeof val === "number" ? formatCurrency(val) : val?.toString() || "";
        }));
      });
      
      await downloadFile(rows, `Proveedores_${projectName}_${getCurrentDate()}.csv`);
    } catch (error) { console.error("Error:", error); } finally { setGenerating(null); }
  };

  const generateReport = (reportType: ReportType, columns?: SelectedColumn[]) => {
    const cols = columns || getDefaultColumns(reportType);
    switch (reportType) {
      case "budget": return generateBudgetReport(cols);
      case "pos_list": return generatePOsListReport(cols);
      case "pos_items": return generatePOsItemsReport(cols);
      case "invoices": return generateInvoicesReport(cols);
      case "suppliers": return generateSuppliersReport(cols);
    }
  };

  const generateFromPreset = (preset: ReportPreset) => {
    const cols: SelectedColumn[] = preset.columns.map((c, i) => {
      if (c.isBlank) {
        return { id: `blank_${i}`, originalId: "blank", label: "", isBlank: true };
      }
      const original = REPORT_COLUMNS[preset.reportType].find(col => col.id === c.id);
      return { id: `${c.id}_${i}`, originalId: c.id, label: original?.label || c.id };
    });
    generateReport(preset.reportType, cols);
  };

  const getReportCount = (reportType: ReportType) => {
    switch (reportType) {
      case "budget": return counts.accounts;
      case "pos_list": 
      case "pos_items": return counts.pos;
      case "invoices": return counts.invoices;
      case "suppliers": return counts.suppliers;
    }
  };

  const reportTypes: ReportType[] = ["budget", "pos_list", "pos_items", "invoices", "suppliers"];

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
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
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <FileSpreadsheet size={24} style={{ color: '#2F52E0' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Informes</h1>
            </div>
            
            {/* Format Switch */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">Formato:</span>
              <button
                onClick={toggleExportFormat}
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  exportFormat === "csv" 
                    ? "bg-white text-slate-900 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}>
                  <FileText size={14} />
                  CSV
                </span>
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  exportFormat === "xlsx" 
                    ? "bg-white text-slate-900 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}>
                  <FileSpreadsheet size={14} />
                  Excel
                </span>
              </button>

              {/* Toggle desglosar por capítulos */}
              {episodesEnabled && totalEpisodes > 0 && (
                <>
                  <div className="w-px h-6 bg-slate-200" />
                  <button
                    onClick={() => setSplitByEpisode(!splitByEpisode)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      splitByEpisode 
                        ? "bg-violet-100 text-violet-700 border border-violet-200" 
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    <Film size={14} />
                    Desglosar por capítulo
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        <div className="space-y-4">
          {reportTypes.map((reportType) => {
            const info = REPORT_INFO[reportType];
            const Icon = info.icon;
            const isExpanded = expandedReport === reportType;
            const reportPresets = presets.filter(p => p.reportType === reportType);
            const count = getReportCount(reportType);
            
            return (
              <div key={reportType} className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-slate-300 transition-all">
                <div className="p-5">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${info.color}`}>
                      <Icon size={22} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900">{info.title}</h3>
                      <p className="text-sm text-slate-500">{info.description}</p>
                      <p className="text-xs text-slate-400 mt-1">{count} registros</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openConfig(reportType)}
                        className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                        title="Configurar columnas"
                      >
                        <Settings2 size={18} />
                      </button>
                      <button
                        onClick={() => generateReport(reportType)}
                        disabled={generating !== null}
                        className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                        style={{ backgroundColor: '#2F52E0' }}
                      >
                        {generating === reportType ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Generando
                          </>
                        ) : (
                          <>
                            <Download size={14} />
                            Exportar
                          </>
                        )}
                      </button>
                      {reportPresets.length > 0 && (
                        <button
                          onClick={() => setExpandedReport(isExpanded ? null : reportType)}
                          className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                        >
                          <ChevronDown size={18} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {isExpanded && reportPresets.length > 0 && (
                  <div className="px-5 pb-5 pt-0">
                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-xs font-medium text-slate-500 mb-3 flex items-center gap-1.5">
                        <BookMarked size={12} />
                        Plantillas guardadas
                      </p>
                      <div className="space-y-2">
                        {reportPresets.map((preset) => (
                          <div key={preset.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl group">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-slate-700">{preset.name}</p>
                              <p className="text-xs text-slate-400">{preset.columns.length} columnas</p>
                            </div>
                            <button
                              onClick={() => generateFromPreset(preset)}
                              disabled={generating !== null}
                              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                              <Download size={12} className="inline mr-1" />
                              Usar
                            </button>
                            <button
                              onClick={() => deletePreset(preset.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Modal de configuración */}
      {showConfig && configReportType && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfig(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Configurar columnas</h3>
                <p className="text-sm text-slate-500">{REPORT_INFO[configReportType].title}</p>
              </div>
              <button onClick={() => setShowConfig(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {/* Presets */}
              {presets.filter(p => p.reportType === configReportType).length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-medium text-slate-500 mb-2">Cargar plantilla</p>
                  <div className="flex flex-wrap gap-2">
                    {presets.filter(p => p.reportType === configReportType).map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => loadPreset(preset)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                {/* Columnas seleccionadas */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Columnas del informe</p>
                    <span className="text-xs text-slate-400">{selectedColumns.length}</span>
                  </div>
                  <div className="space-y-1 min-h-[200px] p-3 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                    {selectedColumns.map((column, index) => {
                      const isLocked = REPORT_COLUMNS[configReportType].find(c => c.id === column.originalId)?.locked;
                      return (
                        <div
                          key={column.id}
                          draggable={!isLocked}
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                            dragOverItem === index ? "bg-slate-200 border-slate-300" : "bg-white border-slate-200"
                          } border ${draggedItem === index ? "opacity-50" : ""} ${
                            column.isBlank ? "border-dashed" : ""
                          }`}
                        >
                          <div className={`cursor-grab ${isLocked ? "opacity-30" : ""}`}>
                            <GripVertical size={14} className="text-slate-400" />
                          </div>
                          <span className={`flex-1 text-sm ${column.isBlank ? "text-slate-400 italic" : "text-slate-700"}`}>
                            {column.label}
                          </span>
                          {isLocked ? (
                            <span className="text-[10px] text-slate-400">Req.</span>
                          ) : (
                            <button
                              onClick={() => removeColumn(column.id, column.originalId)}
                              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            >
                              <Minus size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    
                    {/* Botón añadir columna en blanco */}
                    <button
                      onClick={addBlankColumn}
                      className="w-full flex items-center justify-center gap-2 p-2 mt-2 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Plus size={14} />
                      <span className="text-xs font-medium">Columna vacía</span>
                    </button>
                  </div>
                </div>

                {/* Columnas disponibles */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Disponibles</p>
                    <span className="text-xs text-slate-400">{availableColumns.length}</span>
                  </div>
                  <div className="space-y-1 min-h-[200px] p-3 bg-slate-50 rounded-xl">
                    {availableColumns.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-8">Todas las columnas están en uso</p>
                    ) : (
                      availableColumns.map((column) => (
                        <button
                          key={column.id}
                          onClick={() => addColumn(column)}
                          className="w-full flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
                        >
                          <Plus size={14} className="text-slate-400" />
                          <span className="flex-1 text-sm text-slate-600">{column.label}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-400 mt-4 text-center">
                Arrastra las columnas para reordenarlas
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
              {!showSavePreset ? (
                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowConfig(false)}
                    className="px-4 py-2.5 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setShowSavePreset(true)}
                    className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors"
                  >
                    <Save size={14} />
                    Guardar plantilla
                  </button>
                  <button
                    onClick={() => {
                      generateReport(configReportType, selectedColumns);
                      setShowConfig(false);
                    }}
                    disabled={generating !== null}
                    className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#2F52E0' }}
                  >
                    <Download size={14} />
                    Exportar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="Nombre de la plantilla"
                    className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && savePreset()}
                  />
                  <button
                    onClick={() => { setShowSavePreset(false); setNewPresetName(""); }}
                    className="px-4 py-2.5 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={savePreset}
                    disabled={!newPresetName.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: '#2F52E0' }}
                  >
                    <Check size={14} />
                    Guardar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
