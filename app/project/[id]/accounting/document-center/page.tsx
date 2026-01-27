"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import {
  FileText, Search, Download, ExternalLink, Filter, X, Calendar,
  Building2, Receipt, ChevronDown, File, FileImage, FileSpreadsheet,
  FileArchive, Cloud, CloudOff, Settings, Eye, Briefcase
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

interface Document {
  id: string;
  type: "po" | "invoice";
  documentId: string;
  documentNumber: string;
  fileName: string;
  fileUrl: string;
  supplier: string;
  supplierId: string;
  department: string;
  date: Date;
  amount: number;
}

interface CloudConfig {
  provider: "none" | "google_drive" | "dropbox" | "onedrive";
  connected: boolean;
  folderName?: string;
  lastSync?: Date;
}

const FILE_ICONS: Record<string, any> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  jpg: FileImage,
  jpeg: FileImage,
  png: FileImage,
  gif: FileImage,
  webp: FileImage,
  zip: FileArchive,
  rar: FileArchive,
  default: File,
};

const getFileIcon = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return FILE_ICONS[ext] || FILE_ICONS.default;
};

const getFileExtension = (fileName: string) => {
  return fileName.split(".").pop()?.toUpperCase() || "FILE";
};

export default function DocumentCenterPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "po" | "invoice">("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [departments, setDepartments] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>({ provider: "none", connected: false });
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  useEffect(() => {
    filterDocuments();
  }, [documents, searchTerm, typeFilter, departmentFilter, supplierFilter]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Cargar nombre del proyecto y departamentos
      const projectDoc = await getDocs(query(collection(db, "projects")));
      const project = projectDoc.docs.find(d => d.id === id);
      if (project) {
        setProjectName(project.data().name || "Proyecto");
        setDepartments(project.data().departments || []);
      }

      // Cargar configuración de nube
      try {
        const cloudDocs = await getDocs(collection(db, `projects/${id}/config`));
        const cloudDoc = cloudDocs.docs.find(d => d.id === "cloud");
        if (cloudDoc?.exists()) {
          setCloudConfig(cloudDoc.data() as CloudConfig);
        }
      } catch (e) {
        console.error("Error loading cloud config:", e);
      }

      const allDocuments: Document[] = [];
      const supplierSet = new Map<string, string>();

      // Cargar documentos de POs
      const posSnapshot = await getDocs(query(collection(db, `projects/${id}/pos`), orderBy("createdAt", "desc")));
      posSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.attachmentUrl && data.attachmentFileName) {
          allDocuments.push({
            id: `po-${doc.id}`,
            type: "po",
            documentId: doc.id,
            documentNumber: data.number || data.displayNumber || "PO",
            fileName: data.attachmentFileName,
            fileUrl: data.attachmentUrl,
            supplier: data.supplier || "",
            supplierId: data.supplierId || "",
            department: data.department || "",
            date: data.createdAt?.toDate() || new Date(),
            amount: data.totalAmount || 0,
          });
          if (data.supplierId && data.supplier) {
            supplierSet.set(data.supplierId, data.supplier);
          }
        }
      });

      // Cargar documentos de Facturas
      const invoicesSnapshot = await getDocs(query(collection(db, `projects/${id}/invoices`), orderBy("createdAt", "desc")));
      invoicesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.attachmentUrl && data.attachmentFileName) {
          allDocuments.push({
            id: `inv-${doc.id}`,
            type: "invoice",
            documentId: doc.id,
            documentNumber: data.number || data.displayNumber || "FAC",
            fileName: data.attachmentFileName,
            fileUrl: data.attachmentUrl,
            supplier: data.supplier || "",
            supplierId: data.supplierId || "",
            department: data.department || "",
            date: data.createdAt?.toDate() || new Date(),
            amount: data.totalAmount || 0,
          });
          if (data.supplierId && data.supplier) {
            supplierSet.set(data.supplierId, data.supplier);
          }
        }
      });

      setDocuments(allDocuments);
      setSuppliers(Array.from(supplierSet.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      console.error("Error loading documents:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterDocuments = () => {
    let filtered = [...documents];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(doc =>
        doc.fileName.toLowerCase().includes(term) ||
        doc.documentNumber.toLowerCase().includes(term) ||
        doc.supplier.toLowerCase().includes(term)
      );
    }

    if (typeFilter !== "all") {
      filtered = filtered.filter(doc => doc.type === typeFilter);
    }

    if (departmentFilter !== "all") {
      filtered = filtered.filter(doc => doc.department === departmentFilter);
    }

    if (supplierFilter !== "all") {
      filtered = filtered.filter(doc => doc.supplierId === supplierFilter);
    }

    setFilteredDocuments(filtered);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setTypeFilter("all");
    setDepartmentFilter("all");
    setSupplierFilter("all");
  };

  const hasActiveFilters = searchTerm || typeFilter !== "all" || departmentFilter !== "all" || supplierFilter !== "all";

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getDocumentLink = (doc: Document) => {
    if (doc.type === "po") {
      return `/project/${id}/accounting/pos/${doc.documentId}`;
    }
    return `/project/${id}/accounting/invoices/${doc.documentId}`;
  };

  const stats = {
    total: documents.length,
    pos: documents.filter(d => d.type === "po").length,
    invoices: documents.filter(d => d.type === "invoice").length,
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem] border-b border-slate-200">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                <FileText size={20} className="text-slate-600" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Document Center</h1>
                <p className="text-slate-500 text-sm">{stats.total} documentos · {stats.pos} POs · {stats.invoices} Facturas</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Estado de nube */}
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm ${
                cloudConfig.connected 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200" 
                  : "bg-slate-50 text-slate-500 border border-slate-200"
              }`}>
                {cloudConfig.connected ? (
                  <>
                    <Cloud size={16} />
                    <span className="font-medium capitalize">{cloudConfig.provider.replace("_", " ")}</span>
                  </>
                ) : (
                  <>
                    <CloudOff size={16} />
                    <span>Sin nube conectada</span>
                  </>
                )}
              </div>

              <Link
                href={`/project/${id}/accounting/config?section=cloud`}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Settings size={16} />
                Configurar
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-4 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, número o proveedor..."
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
            />
          </div>

          {/* Type filter pills */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTypeFilter("all")}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                typeFilter === "all" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setTypeFilter("po")}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                typeFilter === "po" ? "bg-blue-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <FileText size={14} />
              POs
            </button>
            <button
              onClick={() => setTypeFilter("invoice")}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                typeFilter === "invoice" ? "bg-violet-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Receipt size={14} />
              Facturas
            </button>
          </div>

          {/* More filters */}
          <div className="relative">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm font-medium transition-colors ${
                (departmentFilter !== "all" || supplierFilter !== "all")
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50 bg-white"
              }`}
            >
              <Filter size={14} />
              Filtros
              <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>

            {showFilters && (
              <div className="absolute top-full right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 p-4 min-w-[280px]">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Departamento</label>
                    <select
                      value={departmentFilter}
                      onChange={(e) => setDepartmentFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="all">Todos los departamentos</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Proveedor</label>
                    <select
                      value={supplierFilter}
                      onChange={(e) => setSupplierFilter(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    >
                      <option value="all">Todos los proveedores</option>
                      {suppliers.map(sup => (
                        <option key={sup.id} value={sup.id}>{sup.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-slate-600 hover:text-slate-900"
            >
              <X size={14} />
              Limpiar
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="mt-3 text-sm text-slate-500">
            {filteredDocuments.length} documento{filteredDocuments.length !== 1 ? "s" : ""} encontrado{filteredDocuments.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Content */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              {hasActiveFilters ? "No se encontraron documentos" : "Sin documentos"}
            </h3>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              {hasActiveFilters
                ? "Prueba con otros filtros o términos de búsqueda"
                : "Los documentos adjuntos a POs y Facturas aparecerán aquí"}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredDocuments.map((doc) => {
              const FileIcon = getFileIcon(doc.fileName);
              const extension = getFileExtension(doc.fileName);

              return (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors group"
                >
                  {/* File icon */}
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    doc.type === "po" ? "bg-blue-50" : "bg-violet-50"
                  }`}>
                    <FileIcon size={24} className={doc.type === "po" ? "text-blue-600" : "text-violet-600"} />
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900 truncate">{doc.fileName}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${
                        doc.type === "po" 
                          ? "bg-blue-100 text-blue-700" 
                          : "bg-violet-100 text-violet-700"
                      }`}>
                        {extension}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                      <span className={`flex items-center gap-1 ${
                        doc.type === "po" ? "text-blue-600" : "text-violet-600"
                      }`}>
                        {doc.type === "po" ? <FileText size={12} /> : <Receipt size={12} />}
                        {doc.documentNumber}
                      </span>
                      <span className="flex items-center gap-1">
                        <Building2 size={12} />
                        {doc.supplier}
                      </span>
                      {doc.department && (
                        <span className="flex items-center gap-1">
                          <Briefcase size={12} />
                          {doc.department}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDate(doc.date)}
                      </span>
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-slate-900">{formatCurrency(doc.amount)} €</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Ver archivo"
                    >
                      <Eye size={18} />
                    </a>
                    <a
                      href={doc.fileUrl}
                      download={doc.fileName}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Descargar"
                    >
                      <Download size={18} />
                    </a>
                    <Link
                      href={getDocumentLink(doc)}
                      className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      title={`Ver ${doc.type === "po" ? "PO" : "Factura"}`}
                    >
                      <ExternalLink size={18} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
