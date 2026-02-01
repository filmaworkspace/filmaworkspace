"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ArrowLeft,
  FileText,
  Receipt,
  FileCheck,
  Search,
  Building2,
  Calendar,
  Hash,
  CheckCircle,
  Clock,
  Wallet,
  BookCheck,
  AlertCircle,
  Upload,
  X,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAccountingPermissions } from "@/hooks/useAccountingPermissions";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

const DOCUMENT_TYPES = {
  proforma: {
    code: "PRF",
    label: "Proforma",
    icon: FileText,
    bgColor: "bg-violet-50",
    textColor: "text-violet-700",
    borderColor: "border-violet-200",
  },
  budget: {
    code: "PRS",
    label: "Presupuesto",
    icon: FileCheck,
    bgColor: "bg-amber-50",
    textColor: "text-amber-700",
    borderColor: "border-amber-200",
  },
};

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "pending", label: "Pendiente" },
  { value: "approved", label: "Aprobada" },
  { value: "accounted", label: "Codificada" },
  { value: "paid", label: "Pagada" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "Todos los tipos" },
  { value: "proforma", label: "Proformas" },
  { value: "budget", label: "Presupuestos" },
];

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; icon: typeof Clock }> = {
  pending: { label: "Pendiente", bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  approved: { label: "Aprobada", bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle },
  accounted: { label: "Codificada", bg: "bg-violet-50", text: "text-violet-700", icon: BookCheck },
  paid: { label: "Pagada", bg: "bg-blue-50", text: "text-blue-700", icon: Wallet },
};

type DocumentType = keyof typeof DOCUMENT_TYPES;

interface PendingDocument {
  id: string;
  documentType: DocumentType;
  number: string;
  displayNumber: string;
  supplier: string;
  supplierName: string;
  supplierId: string;
  department?: string;
  totalAmount: number;
  baseAmount: number;
  status: string;
  description: string;
  createdAt: Date;
  poId?: string;
  poNumber?: string;
  currency: string;
  attachmentUrl?: string;
  attachmentFileName?: string;
}

export default function ReplaceDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params?.id as string;
  const preselectedDocId = searchParams.get("docId");

  const { loading: permissionsLoading, permissions } = useAccountingPermissions(projectId);

  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  // Dropdowns
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Modal de sustitución
  const [selectedDoc, setSelectedDoc] = useState<PendingDocument | null>(null);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) router.push("/");
      else setUserId(user.uid);
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (userId && projectId && !permissionsLoading) loadData();
  }, [userId, projectId, permissionsLoading]);

  // Abrir modal automáticamente si viene con docId preseleccionado
  useEffect(() => {
    if (preselectedDocId && documents.length > 0 && !showReplaceModal) {
      const docToReplace = documents.find(d => d.id === preselectedDocId);
      if (docToReplace) {
        openReplaceModal(docToReplace);
      }
    }
  }, [preselectedDocId, documents]);

  // Cerrar dropdowns al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setShowStatusDropdown(false);
      }
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target as Node)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      const invoicesSnapshot = await getDocs(
        query(collection(db, `projects/${projectId}/invoices`), orderBy("createdAt", "desc"))
      );

      const docsData: PendingDocument[] = [];

      invoicesSnapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const docType = data.documentType as DocumentType;

        // Solo proformas y presupuestos que NO han sido reemplazados
        if ((docType === "proforma" || docType === "budget") && !data.replacedBy) {
          docsData.push({
            id: docSnap.id,
            documentType: docType,
            number: data.number || "",
            displayNumber: data.displayNumber || `${DOCUMENT_TYPES[docType]?.code || "DOC"}-${data.number}`,
            supplier: data.supplier || "",
            supplierName: data.supplierName || data.supplier || "",
            supplierId: data.supplierId || "",
            department: data.department,
            totalAmount: data.totalAmount || 0,
            baseAmount: data.baseAmount || 0,
            status: data.status || "pending",
            description: data.description || "",
            createdAt: data.createdAt?.toDate() || new Date(),
            poId: data.poId,
            poNumber: data.poNumber,
            currency: data.currency || "EUR",
            attachmentUrl: data.attachmentUrl,
            attachmentFileName: data.attachmentFileName,
          });
        }
      });

      setDocuments(docsData);
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);

  const formatDate = (date: Date | undefined) => {
    if (!date) return "-";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };

  const getCurrencySymbol = (currency: string) => {
    const symbols: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
    return symbols[currency] || "€";
  };

  const openReplaceModal = (docItem: PendingDocument) => {
    setSelectedDoc(docItem);
    setUploadedFile(null);
    setError("");
    setShowReplaceModal(true);
  };

  const closeReplaceModal = () => {
    setShowReplaceModal(false);
    setSelectedDoc(null);
    setUploadedFile(null);
    setError("");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError("El archivo no puede superar 10MB");
        return;
      }
      setUploadedFile(file);
      setError("");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError("El archivo no puede superar 10MB");
        return;
      }
      setUploadedFile(file);
      setError("");
    }
  };

  const handleReplace = async () => {
    if (!selectedDoc || !uploadedFile) {
      setError("Debes adjuntar la factura definitiva");
      return;
    }

    setProcessing(true);
    setError("");

    try {
      // Subir archivo
      const fileRef = ref(storage, `projects/${projectId}/invoices/${selectedDoc.id}_replaced_${uploadedFile.name}`);
      await uploadBytes(fileRef, uploadedFile);
      const attachmentUrl = await getDownloadURL(fileRef);

      // Actualizar el documento: cambiar tipo a factura, descodificar, mantener número correlativo
      const newDisplayNumber = `FAC-${selectedDoc.number}`;

      await updateDoc(doc(db, `projects/${projectId}/invoices`, selectedDoc.id), {
        documentType: "invoice",
        displayNumber: newDisplayNumber,
        replacedFromType: selectedDoc.documentType,
        replacedAt: Timestamp.now(),
        replacedBy: userId,
        attachmentUrl,
        attachmentFileName: uploadedFile.name,
        // Descodificar para que se vuelva a codificar
        status: "approved",
        codedAt: null,
        codedBy: null,
        codedByName: null,
        accountingEntry: null,
      });

      closeReplaceModal();
      router.push(`/project/${projectId}/accounting/invoices/${selectedDoc.id}`);
    } catch (error) {
      console.error("Error replacing document:", error);
      setError("Error al sustituir el documento");
    } finally {
      setProcessing(false);
    }
  };

  // Filtrar documentos
  const filteredDocs = documents.filter((docItem) => {
    const matchesSearch =
      docItem.displayNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      docItem.supplierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      docItem.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === "all" || docItem.status === filterStatus;
    const matchesType = filterType === "all" || docItem.documentType === filterType;

    return matchesSearch && matchesStatus && matchesType;
  });

  if (loading || permissionsLoading) {
    return (
      <div className={`${inter.className} min-h-screen bg-white flex items-center justify-center`}>
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`${inter.className} min-h-screen bg-white`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Link
                href={`/project/${projectId}/accounting/invoices`}
                className="w-10 h-10 rounded-xl flex items-center justify-center border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <ArrowLeft size={18} className="text-slate-600" />
              </Link>
              <RefreshCw size={24} style={{ color: "#2F52E0" }} />
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">Sustituir documento</h1>
                <span className="px-2.5 py-1 bg-violet-100 text-violet-700 rounded-lg text-xs font-medium">
                  Proformas y presupuestos
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        {/* Filtros */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Buscador */}
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por número, proveedor o descripción"
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm bg-white"
              />
            </div>

            {/* Dropdown Tipo */}
            <div className="relative" ref={typeDropdownRef}>
              <button
                onClick={() => { setShowTypeDropdown(!showTypeDropdown); setShowStatusDropdown(false); }}
                className="w-full sm:w-44 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white flex items-center justify-between hover:border-slate-300 transition-colors"
              >
                <span className={filterType === "all" ? "text-slate-500" : "text-slate-900"}>
                  {TYPE_OPTIONS.find(o => o.value === filterType)?.label}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showTypeDropdown ? "rotate-180" : ""}`} />
              </button>
              {showTypeDropdown && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
                  {TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setFilterType(option.value); setShowTypeDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${filterType === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dropdown Estado */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => { setShowStatusDropdown(!showStatusDropdown); setShowTypeDropdown(false); }}
                className="w-full sm:w-44 px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white flex items-center justify-between hover:border-slate-300 transition-colors"
              >
                <span className={filterStatus === "all" ? "text-slate-500" : "text-slate-900"}>
                  {STATUS_OPTIONS.find(o => o.value === filterStatus)?.label}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setFilterStatus(option.value); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${filterStatus === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Lista de documentos */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
            <h2 className="font-semibold text-slate-900">Documentos pendientes de sustitución</h2>
            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium">
              {filteredDocs.length}
            </span>
          </div>

          {filteredDocs.length === 0 ? (
            <div className="text-center py-16 bg-white">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <FileText size={28} className="text-slate-400" />
              </div>
              <p className="text-slate-500 mb-2">No hay documentos pendientes</p>
              <p className="text-sm text-slate-400">
                Las proformas y presupuestos aparecerán aquí para ser sustituidos
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredDocs.map((docItem) => {
                const docType = DOCUMENT_TYPES[docItem.documentType];
                const DocIcon = docType.icon;
                const statusConfig = STATUS_CONFIG[docItem.status] || STATUS_CONFIG.pending;
                const StatusIcon = statusConfig.icon;

                return (
                  <div
                    key={docItem.id}
                    className="p-6 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        <div className={`w-12 h-12 ${docType.bgColor} rounded-xl flex items-center justify-center flex-shrink-0`}>
                          <DocIcon size={20} className={docType.textColor} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold text-slate-900">{docItem.displayNumber}</p>
                            <span className={`px-2 py-0.5 ${docType.bgColor} ${docType.textColor} rounded text-xs font-medium`}>
                              {docType.label}
                            </span>
                            <span className={`px-2 py-0.5 ${statusConfig.bg} ${statusConfig.text} rounded text-xs font-medium flex items-center gap-1`}>
                              <StatusIcon size={10} />
                              {statusConfig.label}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 mb-2">{docItem.description}</p>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                              <Building2 size={12} />
                              {docItem.supplierName}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar size={12} />
                              {formatDate(docItem.createdAt)}
                            </span>
                            {docItem.poNumber && (
                              <span className="flex items-center gap-1">
                                <Hash size={12} />
                                PO-{docItem.poNumber}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-bold text-slate-900">
                            {formatCurrency(docItem.totalAmount)} {getCurrencySymbol(docItem.currency)}
                          </p>
                          <p className="text-xs text-slate-500">
                            Base: {formatCurrency(docItem.baseAmount)} {getCurrencySymbol(docItem.currency)}
                          </p>
                        </div>
                        <button
                          onClick={() => openReplaceModal(docItem)}
                          className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                          style={{ backgroundColor: "#2F52E0" }}
                        >
                          <RefreshCw size={14} />
                          Sustituir
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modal de sustitución */}
      {showReplaceModal && selectedDoc && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={closeReplaceModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                  <Receipt size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Sustituir por factura</h2>
                  <p className="text-xs text-slate-500">{selectedDoc.displayNumber} → FAC-{selectedDoc.number}</p>
                </div>
              </div>
              <button onClick={closeReplaceModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Resumen del documento original */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-2">Documento original</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{selectedDoc.supplierName}</p>
                    <p className="text-sm text-slate-500">{selectedDoc.description}</p>
                  </div>
                  <p className="font-bold text-slate-900">
                    {formatCurrency(selectedDoc.totalAmount)} {getCurrencySymbol(selectedDoc.currency)}
                  </p>
                </div>
              </div>

              {/* Subir archivo */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Adjuntar factura definitiva *
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                    isDragging ? "border-slate-400 bg-slate-50" : uploadedFile ? "border-emerald-300 bg-emerald-50" : "border-slate-200"
                  }`}
                >
                  {uploadedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <CheckCircle size={20} className="text-emerald-600" />
                      <span className="text-sm text-slate-700">{uploadedFile.name}</span>
                      <button
                        onClick={() => setUploadedFile(null)}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload size={24} className="text-slate-400 mx-auto mb-2" />
                      <p className="text-sm text-slate-500 mb-1">Arrastra el archivo o</p>
                      <label className="text-sm text-slate-900 font-medium cursor-pointer hover:underline">
                        selecciona desde tu equipo
                        <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
                      </label>
                      <p className="text-xs text-slate-400 mt-2">PDF, JPG o PNG (máx. 10MB)</p>
                    </>
                  )}
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              {/* Aviso */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-600 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    Al sustituir, el documento pasará a estado "Aprobado" y deberá ser codificado de nuevo.
                  </p>
                </div>
              </div>

              {/* Botones */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeReplaceModal}
                  className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReplace}
                  disabled={processing || !uploadedFile}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {processing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <CheckCircle size={16} />
                      Sustituir documento
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
