"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { IBANField } from "@/components/IBANField";

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
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  Edit,
  Eye,
  FileCheck,
  FileText,
  FileX,
  Filter,
  Globe,
  Hash,
  Lock,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────


// ─── Types ───────────────────────────────────────────────────────────────────

interface Address {
  street: string;
  number: string;
  city: string;
  province: string;
  postalCode: string;
}

interface Contact {
  name: string;
  email: string;
  phone: string;
}

interface Certificate {
  url?: string;
  expiryDate?: Date;
  uploaded: boolean;
  fileName?: string;
  verified?: boolean;
  verifiedBy?: string;
  verifiedByName?: string;
  verifiedAt?: Date;
}

interface Supplier {
  id: string;
  fiscalName: string;
  commercialName: string;
  country: string;
  taxId: string;
  address: Address;
  contact: Contact;
  paymentMethod: string;
  bankAccount: string;
  bic?: string;
  certificates: {
    bankOwnership: Certificate;
    contractorsCertificate: Certificate & { aeatVerified?: boolean };
  };
  createdAt: Date;
  createdBy: string;
  hasAssignedPOs: boolean;
  hasAssignedInvoices: boolean;
  closure?: {
    closedAt: Date;
    closedByName: string;
    notes?: string;
  };
}

type PaymentMethod = "transferencia" | "tb30" | "tb60" | "tarjeta" | "efectivo";

// ─── Constants ───────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "tb30", label: "Transferencia 30 días" },
  { value: "tb60", label: "Transferencia 60 días" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "efectivo", label: "Efectivo" },
];

const COUNTRIES = [
  { code: "ES", name: "España", ibanLength: 24, ibanPrefix: "ES" },
  { code: "FR", name: "Francia", ibanLength: 27, ibanPrefix: "FR" },
  { code: "DE", name: "Alemania", ibanLength: 22, ibanPrefix: "DE" },
  { code: "IT", name: "Italia", ibanLength: 27, ibanPrefix: "IT" },
  { code: "PT", name: "Portugal", ibanLength: 25, ibanPrefix: "PT" },
  { code: "UK", name: "Reino Unido", ibanLength: 22, ibanPrefix: "GB" },
  { code: "US", name: "Estados Unidos", ibanLength: 0, ibanPrefix: "" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "valid", label: "Certificados válidos" },
  { value: "expiring", label: "Próximos a caducar" },
  { value: "expired", label: "Acción requerida" },
  { value: "closed", label: "Cerrados" },
];

const capitalizeSupplierName = (name: string): string => {
  if (!name) return "";
  const lowercaseWords = ["de", "del", "la", "las", "el", "los", "y", "e", "en", "a", "con", "por", "para"];
  const societyForms: Record<string, string> = {
    "s.l.": "SL", "s. l.": "SL", "sl": "SL", "s.l": "SL",
    "s.a.": "SA", "s. a.": "SA", "sa": "SA", "s.a": "SA",
    "s.c.": "SC", "s. c.": "SC", "sc": "SC", "s.c": "SC",
    "s.l.u.": "SLU", "s. l. u.": "SLU", "slu": "SLU", "s.l.u": "SLU",
    "s.c.p.": "SCP", "s. c. p.": "SCP", "scp": "SCP", "s.c.p": "SCP",
    "s.a.u.": "SAU", "s. a. u.": "SAU", "sau": "SAU", "s.a.u": "SAU",
    "s.l.l.": "SLL", "s. l. l.": "SLL", "sll": "SLL",
    "coop.": "COOP", "coop": "COOP",
  };
  let normalized = name.toLowerCase();
  Object.entries(societyForms).forEach(([pattern, replacement]) => {
    const regex = new RegExp(`\\b${pattern.replace(/\./g, "\\.")}\\b`, "gi");
    normalized = normalized.replace(regex, replacement);
  });
  const words = normalized.split(/\s+/);
  const capitalized = words.map((word, index) => {
    if (["SL", "SA", "SC", "SLU", "SCP", "SAU", "SLL", "COOP"].includes(word.toUpperCase())) return word.toUpperCase();
    if (index > 0 && lowercaseWords.includes(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  return capitalized.join(" ");
};

const formatIBAN = (iban: string): string => {
  const clean = iban.replace(/\s/g, "").toUpperCase();
  return clean.match(/.{1,4}/g)?.join(" ") || clean;
};

// Calcula los dígitos de control del IBAN español
const calculateSpanishIBANCheckDigits = (accountNumber: string): string => {
  // accountNumber debe ser los 20 dígitos de la cuenta (entidad + oficina + DC + cuenta)
  const clean = accountNumber.replace(/\s/g, "");
  if (clean.length !== 20 || !/^\d{20}$/.test(clean)) return "";
  
  // Para calcular: cuenta + ES00 -> convertir letras a números (E=14, S=28) -> mod 97
  // IBAN = ES + (98 - (cuenta + 142800) mod 97)
  const numericString = clean + "142800"; // 14=E, 28=S, 00=dígitos placeholder
  
  // Calcular mod 97 para números grandes
  let remainder = 0;
  for (let i = 0; i < numericString.length; i++) {
    remainder = (remainder * 10 + parseInt(numericString[i])) % 97;
  }
  
  const checkDigits = (98 - remainder).toString().padStart(2, "0");
  return "ES" + checkDigits + clean;
};

const validateSpanishTaxId = (taxId: string): boolean => {
  const clean = taxId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 9) return false;
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  const firstChar = clean.charAt(0);
  if (/^[0-9XYZ]/.test(firstChar)) {
    let num = clean.slice(0, 8);
    if (firstChar === "X") num = "0" + num.slice(1);
    else if (firstChar === "Y") num = "1" + num.slice(1);
    else if (firstChar === "Z") num = "2" + num.slice(1);
    const expectedLetter = letters[parseInt(num) % 23];
    return clean.charAt(8) === expectedLetter;
  }
  return /^[ABCDEFGHJKLMNPQRSUVW][0-9]{7}[0-9A-J]$/.test(clean);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "valid" | "expiring" | "expired" | "closed">("all");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [userAccountingLevel, setUserAccountingLevel] = useState<string>("");
  const [taxIdError, setTaxIdError] = useState("");

  // Dropdowns personalizados
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [showPaymentMethodDropdown, setShowPaymentMethodDropdown] = useState(false);
  const paymentMethodDropdownRef = useRef<HTMLDivElement>(null);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [countrySearch, setCountrySearch] = useState("");

  const [formData, setFormData] = useState({
    fiscalName: "", commercialName: "", country: "ES", taxId: "",
    address: { street: "", number: "", city: "", province: "", postalCode: "" },
    contact: { name: "", email: "", phone: "" },
    paymentMethod: "transferencia" as PaymentMethod, bankAccount: "", bic: "",
  });

  const [certificates, setCertificates] = useState({
    bankOwnership: { file: null as File | null, expiryDate: "", verified: false },
    contractorsCertificate: { file: null as File | null, expiryDate: "", verified: false },
  });

  const canVerifyCertificates = userAccountingLevel === "accounting_extended";

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUserId(user.uid);
        setUserName(user.displayName || user.email || "Usuario");
        try {
          const memberDoc = await getDoc(doc(db, `projects/${id}/members`, user.uid));
          if (memberDoc.exists()) setUserAccountingLevel(memberDoc.data().accountingAccessLevel || "user");
        } catch (e) { console.error(e); }
      }
    });
    return () => unsubscribe();
  }, [id]);

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);
  useEffect(() => { filterSuppliers(); }, [searchTerm, filterStatus, suppliers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setShowStatusDropdown(false);
      }
      if (paymentMethodDropdownRef.current && !paymentMethodDropdownRef.current.contains(event.target as Node)) {
        setShowPaymentMethodDropdown(false);
      }
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false);
        setCountrySearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      const suppliersRef = collection(db, `projects/${id}/suppliers`);
      const suppliersQuery = query(suppliersRef, orderBy("createdAt", "desc"));
      const suppliersSnapshot = await getDocs(suppliersQuery);

      const suppliersData = suppliersSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id, fiscalName: data.fiscalName || "", commercialName: data.commercialName || "",
          country: data.country || "ES", taxId: data.taxId || "",
          address: data.address || { street: "", number: "", city: "", province: "", postalCode: "" },
          contact: data.contact || { name: "", email: "", phone: "" },
          paymentMethod: data.paymentMethod || "transferencia", bankAccount: data.bankAccount || "", bic: data.bic || "",
          certificates: {
            bankOwnership: { ...data.certificates?.bankOwnership, expiryDate: data.certificates?.bankOwnership?.expiryDate?.toDate(), uploaded: data.certificates?.bankOwnership?.uploaded || false, verified: data.certificates?.bankOwnership?.verified || false, verifiedAt: data.certificates?.bankOwnership?.verifiedAt?.toDate() },
            contractorsCertificate: { ...data.certificates?.contractorsCertificate, expiryDate: data.certificates?.contractorsCertificate?.expiryDate?.toDate(), uploaded: data.certificates?.contractorsCertificate?.uploaded || false, verified: data.certificates?.contractorsCertificate?.verified || false, verifiedAt: data.certificates?.contractorsCertificate?.verifiedAt?.toDate() },
          },
          createdAt: data.createdAt?.toDate() || new Date(), createdBy: data.createdBy || "",
          hasAssignedPOs: data.hasAssignedPOs || false, hasAssignedInvoices: data.hasAssignedInvoices || false,
          closure: data.closure ? { closedAt: data.closure.closedAt?.toDate(), closedByName: data.closure.closedByName || "", notes: data.closure.notes || "" } : undefined,
        };
      }) as Supplier[];
      setSuppliers(suppliersData);
    } catch (error: any) {
      setErrorMessage(`Error cargando datos: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filterSuppliers = () => {
    let filtered = [...suppliers];
    if (searchTerm) {
      filtered = filtered.filter((s) =>
        s.fiscalName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.commercialName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.taxId.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    if (filterStatus === "closed") {
      filtered = filtered.filter((s) => s.closure);
    } else if (filterStatus !== "all") {
      filtered = filtered.filter((s) => !s.closure && getCertificateStatus(s) === filterStatus);
    }
    // Ordenar: fecha desc (ya viene de Firestore), luego nombre asc como desempate
    filtered.sort((a, b) => {
      const dateDiff = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
      if (dateDiff !== 0) return dateDiff;
      return a.fiscalName.localeCompare(b.fiscalName);
    });
    setFilteredSuppliers(filtered);
  };

  const getCertificateStatus = (supplier: Supplier): "valid" | "expiring" | "expired" => {
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const bankCert = supplier.certificates.bankOwnership;
    const contractorCert = supplier.certificates.contractorsCertificate;
    if (!bankCert.uploaded || !contractorCert.uploaded) return "expired";
    if ((bankCert.expiryDate && bankCert.expiryDate < now) || (contractorCert.expiryDate && contractorCert.expiryDate < now)) return "expired";
    if ((bankCert.expiryDate && bankCert.expiryDate < thirtyDaysFromNow) || (contractorCert.expiryDate && contractorCert.expiryDate < thirtyDaysFromNow)) return "expiring";
    return "valid";
  };

  const getCountryInfo = (code: string) => COUNTRIES.find(c => c.code === code) || COUNTRIES[0];
  const getStatusLabel = () => STATUS_OPTIONS.find((o) => o.value === filterStatus)?.label || "Todos los estados";

  const handleCountryChange = (newCountry: string) => {
    const countryInfo = getCountryInfo(newCountry);
    let newBankAccount = formData.bankAccount;
    const currentPrefix = formData.bankAccount.replace(/\s/g, "").slice(0, 2);
    const oldCountry = COUNTRIES.find(c => c.ibanPrefix === currentPrefix);
    if (oldCountry || !formData.bankAccount) newBankAccount = countryInfo.ibanPrefix;
    setFormData({ ...formData, country: newCountry, bankAccount: newBankAccount });
  };

  const handleBankAccountChange = (value: string) => {
    const countryInfo = getCountryInfo(formData.country);
    let clean = value.replace(/\s/g, "").toUpperCase();
    
    // Si es España y el usuario introduce solo números (20 dígitos de cuenta)
    if (formData.country === "ES") {
      // Quitar prefijo ES si existe para analizar
      const withoutPrefix = clean.replace(/^ES\d{0,2}/, "");
      
      // Si tiene exactamente 20 dígitos numéricos, calcular IBAN completo
      if (/^\d{20}$/.test(withoutPrefix)) {
        const fullIban = calculateSpanishIBANCheckDigits(withoutPrefix);
        if (fullIban) {
          setFormData({ ...formData, bankAccount: formatIBAN(fullIban) });
          return;
        }
      }
      
      // Si el usuario está escribiendo y empieza con números, añadir ES
      if (/^\d/.test(clean)) {
        clean = "ES" + clean;
      }
    }
    
    if (countryInfo.ibanPrefix && !clean.startsWith(countryInfo.ibanPrefix)) {
      clean = countryInfo.ibanPrefix + clean.replace(/^[A-Z]{0,2}/, "");
    }
    if (countryInfo.ibanLength > 0) clean = clean.slice(0, countryInfo.ibanLength);
    setFormData({ ...formData, bankAccount: formatIBAN(clean) });
  };

  const handleTaxIdChange = (value: string) => {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setFormData({ ...formData, taxId: clean });
    if (formData.country === "ES" && clean.length === 9) {
      if (!validateSpanishTaxId(clean)) setTaxIdError("NIF/CIF no válido");
      else setTaxIdError("");
    } else setTaxIdError("");
  };

  const handleFiscalNameBlur = () => setFormData({ ...formData, fiscalName: capitalizeSupplierName(formData.fiscalName) });
  const handleCommercialNameBlur = () => setFormData({ ...formData, commercialName: capitalizeSupplierName(formData.commercialName) });

  const validateForm = () => {
    if (!formData.fiscalName.trim()) { setErrorMessage("El nombre fiscal es obligatorio"); return false; }
    if (!formData.taxId.trim()) { setErrorMessage("El NIF/CIF es obligatorio"); return false; }
    if (formData.country === "ES" && !validateSpanishTaxId(formData.taxId)) { setErrorMessage("El NIF/CIF no es válido"); return false; }
    return true;
  };

  const handleCreateSupplier = async () => {
    if (!validateForm()) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const newSupplier = {
        fiscalName: capitalizeSupplierName(formData.fiscalName.trim()),
        commercialName: capitalizeSupplierName(formData.commercialName.trim()),
        country: formData.country,
        taxId: formData.taxId.trim().toUpperCase(),
        address: {
          street: formData.address.street.trim(), number: formData.address.number.trim(),
          city: formData.address.city.trim(), province: formData.address.province.trim(),
          postalCode: formData.address.postalCode.trim(),
        },
        contact: {
          name: formData.contact.name.trim(), email: formData.contact.email.trim(),
          phone: formData.contact.phone.trim(),
        },
        paymentMethod: formData.paymentMethod,
        bankAccount: formData.bankAccount.replace(/\s/g, ""),
        bic: formData.bic.trim().toUpperCase(),
        certificates: {
          bankOwnership: { uploaded: !!certificates.bankOwnership.file, expiryDate: certificates.bankOwnership.expiryDate ? Timestamp.fromDate(new Date(certificates.bankOwnership.expiryDate)) : null, fileName: certificates.bankOwnership.file?.name || "", verified: false },
          contractorsCertificate: { uploaded: !!certificates.contractorsCertificate.file, expiryDate: certificates.contractorsCertificate.expiryDate ? Timestamp.fromDate(new Date(certificates.contractorsCertificate.expiryDate)) : null, fileName: certificates.contractorsCertificate.file?.name || "", verified: false, aeatVerified: false },
        },
        createdAt: Timestamp.now(), createdBy: userId || "",
        hasAssignedPOs: false, hasAssignedInvoices: false,
      };
      await addDoc(collection(db, `projects/${id}/suppliers`), newSupplier);
      setSuccessMessage("Proveedor creado correctamente");
      setTimeout(() => setSuccessMessage(""), 3000);
      resetForm();
      setShowModal(false);
      await loadData();
    } catch (error: any) {
      setErrorMessage(`Error creando proveedor: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSupplier = async () => {
    if (!selectedSupplier) return;
    if (!validateForm()) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const updatedData: any = {
        fiscalName: capitalizeSupplierName(formData.fiscalName.trim()),
        commercialName: capitalizeSupplierName(formData.commercialName.trim()),
        country: formData.country,
        taxId: formData.taxId.trim().toUpperCase(),
        address: {
          street: formData.address.street.trim(), number: formData.address.number.trim(),
          city: formData.address.city.trim(), province: formData.address.province.trim(),
          postalCode: formData.address.postalCode.trim(),
        },
        contact: {
          name: formData.contact.name.trim(), email: formData.contact.email.trim(),
          phone: formData.contact.phone.trim(),
        },
        paymentMethod: formData.paymentMethod,
        bankAccount: formData.bankAccount.replace(/\s/g, ""),
        bic: formData.bic.trim().toUpperCase(),
      };

      // Función para limpiar undefined de objetos
      const cleanUndefined = (obj: any) => {
        const cleaned: any = {};
        for (const key in obj) {
          if (obj[key] !== undefined) {
            cleaned[key] = obj[key];
          }
        }
        return cleaned;
      };

      const bankOwnershipUpdate: any = cleanUndefined({ ...selectedSupplier.certificates.bankOwnership });
      // Convertir Date a Timestamp si existe
      if (bankOwnershipUpdate.expiryDate instanceof Date) {
        bankOwnershipUpdate.expiryDate = Timestamp.fromDate(bankOwnershipUpdate.expiryDate);
      }
      if (certificates.bankOwnership.file) { bankOwnershipUpdate.uploaded = true; bankOwnershipUpdate.fileName = certificates.bankOwnership.file.name; }
      if (certificates.bankOwnership.expiryDate) bankOwnershipUpdate.expiryDate = Timestamp.fromDate(new Date(certificates.bankOwnership.expiryDate));
      else if (!bankOwnershipUpdate.expiryDate) bankOwnershipUpdate.expiryDate = null;
      if (canVerifyCertificates && certificates.bankOwnership.verified !== selectedSupplier.certificates.bankOwnership.verified) {
        bankOwnershipUpdate.verified = certificates.bankOwnership.verified;
        if (certificates.bankOwnership.verified) { bankOwnershipUpdate.verifiedBy = userId; bankOwnershipUpdate.verifiedByName = userName; bankOwnershipUpdate.verifiedAt = Timestamp.now(); }
        else { bankOwnershipUpdate.verifiedBy = null; bankOwnershipUpdate.verifiedByName = null; bankOwnershipUpdate.verifiedAt = null; }
      }

      const contractorsCertUpdate: any = cleanUndefined({ ...selectedSupplier.certificates.contractorsCertificate });
      // Convertir Date a Timestamp si existe
      if (contractorsCertUpdate.expiryDate instanceof Date) {
        contractorsCertUpdate.expiryDate = Timestamp.fromDate(contractorsCertUpdate.expiryDate);
      }
      if (certificates.contractorsCertificate.file) { contractorsCertUpdate.uploaded = true; contractorsCertUpdate.fileName = certificates.contractorsCertificate.file.name; }
      if (certificates.contractorsCertificate.expiryDate) contractorsCertUpdate.expiryDate = Timestamp.fromDate(new Date(certificates.contractorsCertificate.expiryDate));
      else if (!contractorsCertUpdate.expiryDate) contractorsCertUpdate.expiryDate = null;
      if (canVerifyCertificates && certificates.contractorsCertificate.verified !== selectedSupplier.certificates.contractorsCertificate.verified) {
        contractorsCertUpdate.verified = certificates.contractorsCertificate.verified;
        if (certificates.contractorsCertificate.verified) { contractorsCertUpdate.verifiedBy = userId; contractorsCertUpdate.verifiedByName = userName; contractorsCertUpdate.verifiedAt = Timestamp.now(); }
        else { contractorsCertUpdate.verifiedBy = null; contractorsCertUpdate.verifiedByName = null; contractorsCertUpdate.verifiedAt = null; }
      }

      updatedData.certificates = { bankOwnership: bankOwnershipUpdate, contractorsCertificate: contractorsCertUpdate };
      await updateDoc(doc(db, `projects/${id}/suppliers`, selectedSupplier.id), updatedData);
      setSuccessMessage("Proveedor actualizado correctamente");
      setTimeout(() => setSuccessMessage(""), 3000);
      resetForm();
      setShowModal(false);
      await loadData();
    } catch (error: any) {
      setErrorMessage(`Error actualizando proveedor: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const openConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: { confirmLabel?: string; danger?: boolean }
  ) => {
    setConfirmDialog({ title, message, onConfirm, ...options });
  };

  const handleDeleteSupplier = async (supplier: Supplier) => {
    if (supplier.hasAssignedPOs || supplier.hasAssignedInvoices) {
      setErrorMessage("No se puede eliminar un proveedor con POs o facturas asignadas");
      setTimeout(() => setErrorMessage(""), 5000);
      return;
    }
    openConfirm(
      "Eliminar proveedor",
      `¿Estás seguro de que quieres eliminar a ${supplier.fiscalName}? Esta acción no se puede deshacer.`,
      async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${id}/suppliers`, supplier.id));
          setSuccessMessage("Proveedor eliminado");
          setTimeout(() => setSuccessMessage(""), 3000);
          await loadData();
        } catch (error: any) {
          setErrorMessage(`Error eliminando proveedor: ${error.message}`);
        }
      },
      { danger: true, confirmLabel: "Eliminar" }
    );
  };

  const resetForm = () => {
    setFormData({
      fiscalName: "", commercialName: "", country: "ES", taxId: "",
      address: { street: "", number: "", city: "", province: "", postalCode: "" },
      contact: { name: "", email: "", phone: "" },
      paymentMethod: "transferencia", bankAccount: "ES", bic: "",
    });
    setCertificates({
      bankOwnership: { file: null, expiryDate: "", verified: false },
      contractorsCertificate: { file: null, expiryDate: "", verified: false },
    });
    setSelectedSupplier(null);
    setErrorMessage("");
    setTaxIdError("");
  };

  const openCreateModal = () => { resetForm(); setModalMode("create"); setShowModal(true); };

  const openEditModal = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setFormData({
      fiscalName: supplier.fiscalName, commercialName: supplier.commercialName,
      country: supplier.country, taxId: supplier.taxId, address: supplier.address,
      contact: supplier.contact || { name: "", email: "", phone: "" },
      paymentMethod: supplier.paymentMethod as PaymentMethod,
      bankAccount: formatIBAN(supplier.bankAccount),
      bic: supplier.bic || "",
    });
    setCertificates({
      bankOwnership: { file: null, expiryDate: supplier.certificates.bankOwnership.expiryDate ? new Date(supplier.certificates.bankOwnership.expiryDate).toISOString().split('T')[0] : "", verified: supplier.certificates.bankOwnership.verified || false },
      contractorsCertificate: { file: null, expiryDate: supplier.certificates.contractorsCertificate.expiryDate ? new Date(supplier.certificates.contractorsCertificate.expiryDate).toISOString().split('T')[0] : "", verified: supplier.certificates.contractorsCertificate.verified || false },
    });
    setModalMode("edit");
    setShowModal(true);
  };

  const getCertificateBadge = (cert: Certificate) => {
    if (!cert.uploaded) return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700"><FileX size={12} />No subido</span>);
    if (cert.verified) return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><ShieldCheck size={12} />Verificado</span>);
    if (!cert.expiryDate) return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700"><FileCheck size={12} />Subido</span>);
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (cert.expiryDate < now) return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700"><AlertCircle size={12} />Caducado</span>);
    if (cert.expiryDate < thirtyDaysFromNow) return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700"><Clock size={12} />Por caducar</span>);
    return (<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700"><CheckCircle size={12} />Válido</span>);
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      valid: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Válido" },
      expiring: { bg: "bg-amber-50", text: "text-amber-700", label: "Por caducar" },
      expired: { bg: "bg-red-50", text: "text-red-700", label: "Acción req." },
    };
    const c = config[status] || config.valid;
    return <span className={`px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const exportSuppliers = () => {
    const rows = [["NOMBRE FISCAL", "NOMBRE COMERCIAL", "PAÍS", "NIF/CIF", "CONTACTO", "EMAIL", "TELÉFONO", "MÉTODO PAGO", "IBAN", "BIC"]];
    suppliers.forEach((supplier) => {
      rows.push([supplier.fiscalName, supplier.commercialName, supplier.country, supplier.taxId, supplier.contact?.name || "", supplier.contact?.email || "", supplier.contact?.phone || "", supplier.paymentMethod, supplier.bankAccount, supplier.bic || ""]);
    });
    const csvContent = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `proveedores_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

  if (loading) {
    return (<div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}><div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" /></div>);
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-4">
              <Building2 size={24} style={{ color: '#2F52E0' }} />
              <h1 className="text-2xl font-semibold text-slate-900">Proveedores</h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openCreateModal} className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: '#2F52E0' }}>
                <Plus size={16} strokeWidth={2.5} />
                Añadir proveedor
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="px-24 py-8">
        {/* Filters */}
        <div className="flex flex-row gap-3 items-center mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="Buscar proveedores" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-sm" />
          </div>

          <div className="flex gap-2 flex-shrink-0">
            {/* Status Dropdown personalizado */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-sm transition-colors min-w-[180px] ${
                  filterStatus !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                }`}
              >
                <Filter size={14} className={filterStatus !== "all" ? "text-white" : "text-slate-400"} />
                <span className="flex-1 text-left text-xs">{getStatusLabel()}</span>
                <ChevronDown size={14} className={`transition-transform ${showStatusDropdown ? "rotate-180" : ""} ${filterStatus !== "all" ? "text-white" : "text-slate-400"}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setFilterStatus(option.value as any); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        filterStatus === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(searchTerm || filterStatus !== "all") && (
              <button onClick={() => { setSearchTerm(""); setFilterStatus("all"); }} className="px-3 py-2.5 border border-slate-200 rounded-xl text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 font-medium">
                <X size={14} />Limpiar
              </button>
            )}

            <button onClick={exportSuppliers} className="px-3 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5 text-xs font-medium">
              <Download size={14} />Exportar
            </button>
          </div>
        </div>

        {/* Content */}
        {filteredSuppliers.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Building2 size={28} className="text-slate-400" /></div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{searchTerm || filterStatus !== "all" ? "No se encontraron proveedores" : "No hay proveedores registrados"}</h3>
            <p className="text-slate-500 text-sm">{searchTerm || filterStatus !== "all" ? "Intenta ajustar los filtros" : "Añade tu primer proveedor al proyecto"}</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[200px]">Proveedor</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">NIF/CIF</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[180px]">Contacto</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[120px]">Titularidad</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[120px]">Contratistas</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider min-w-[100px]">Estado</th>
                  <th className="text-right px-4 py-2.5 min-w-[100px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.map((supplier) => {
                  const status = getCertificateStatus(supplier);
                  return (
                    <tr key={supplier.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-4 py-3">
                        <Link href={`/project/${id}/accounting/suppliers/${supplier.id}`} className="text-left hover:text-[#2F52E0] transition-colors block">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-900 group-hover:text-[#2F52E0] text-xs">{supplier.fiscalName}</p>
                            {supplier.closure && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-medium">
                                <Lock size={10} />
                                Cerrado
                              </span>
                            )}
                          </div>
                          {supplier.commercialName && <p className="text-[11px] text-slate-500">{supplier.commercialName}</p>}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-slate-700">{supplier.taxId}</span>
                      </td>
                      <td className="px-4 py-3">
                        {supplier.contact?.name ? (
                          <div>
                            <p className="text-xs text-slate-900">{supplier.contact.name}</p>
                            {supplier.contact.email && <p className="text-[11px] text-slate-500 truncate max-w-[180px]">{supplier.contact.email}</p>}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">{getCertificateBadge(supplier.certificates.bankOwnership)}</td>
                      <td className="px-3 py-3 text-center">{getCertificateBadge(supplier.certificates.contractorsCertificate)}</td>
                      <td className="px-3 py-3 text-center">
                        {supplier.closure ? (
                          <span className="px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap bg-slate-100 text-slate-600">Cerrado</span>
                        ) : (
                          getStatusBadge(status)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Link href={`/project/${id}/accounting/suppliers/${supplier.id}`} className="p-1.5 text-slate-400 hover:text-[#2F52E0] hover:bg-blue-50 rounded-lg" title="Ver"><Eye size={14} /></Link>
                          <button onClick={() => openEditModal(supplier)} className="p-1.5 text-slate-400 hover:text-[#2F52E0] hover:bg-blue-50 rounded-lg" title="Editar"><Edit size={14} /></button>
                          <button onClick={() => handleDeleteSupplier(supplier)} disabled={supplier.hasAssignedPOs || supplier.hasAssignedInvoices} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" title="Eliminar"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setShowModal(false); resetForm(); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{modalMode === "create" ? "Nuevo proveedor" : "Editar proveedor"}</h2>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
              <div className="space-y-6">
                {/* Información básica */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider flex items-center gap-2"><Building2 size={14} />Información básica</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Nombre fiscal *</label>
                      <input type="text" value={formData.fiscalName} onChange={(e) => setFormData({ ...formData, fiscalName: e.target.value })} onBlur={handleFiscalNameBlur} placeholder="Razón social" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      <p className="text-xs text-slate-500 mt-1">Se formateará automáticamente</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Nombre comercial</label>
                      <input type="text" value={formData.commercialName} onChange={(e) => setFormData({ ...formData, commercialName: e.target.value })} onBlur={handleCommercialNameBlur} placeholder="Nombre comercial" className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div ref={countryDropdownRef} className="relative">
                      <label className="block text-sm font-medium text-slate-700 mb-2">País</label>
                      <button
                        type="button"
                        onClick={() => { setShowCountryDropdown(!showCountryDropdown); setCountrySearch(""); }}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                      >
                        <span className="text-slate-900">{getCountryInfo(formData.country).name}</span>
                        <ChevronDown size={16} className={"text-slate-400 transition-transform " + (showCountryDropdown ? "rotate-180" : "")} />
                      </button>
                      {showCountryDropdown && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                          <div className="p-2 border-b border-slate-100">
                            <input
                              type="text"
                              value={countrySearch}
                              onChange={(e) => setCountrySearch(e.target.value)}
                              placeholder="Buscar país"
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                              autoFocus
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto py-1">
                            {COUNTRIES.filter(c => 
                              c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
                              c.code.toLowerCase().includes(countrySearch.toLowerCase())
                            ).map((country) => (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => { handleCountryChange(country.code); setShowCountryDropdown(false); setCountrySearch(""); }}
                                className={"w-full px-4 py-2 text-left text-sm hover:bg-slate-50 transition-colors flex items-center justify-between " + (formData.country === country.code ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600")}
                              >
                                <span>{country.name}</span>
                                <span className="text-slate-400">{country.code}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">NIF/CIF *</label>
                      <input type="text" value={formData.taxId} onChange={(e) => handleTaxIdChange(e.target.value)} placeholder={formData.country === "ES" ? "B12345678" : "ID fiscal"} className={`w-full px-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 font-mono uppercase ${taxIdError ? "border-red-300 bg-red-50" : "border-slate-200"}`} />
                      {taxIdError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} />{taxIdError}</p>}
                    </div>
                  </div>
                </div>

                {/* Persona de contacto */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider flex items-center gap-2"><User size={14} />Persona de contacto</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Nombre</label>
                      <div className="relative">
                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" value={formData.contact.name} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, name: e.target.value } })} placeholder="Nombre del contacto" className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
                      <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="email" value={formData.contact.email} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, email: e.target.value } })} placeholder="email@ejemplo.com" className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Teléfono</label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="tel" value={formData.contact.phone} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, phone: e.target.value } })} placeholder="+34 600 000 000" className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dirección */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider flex items-center gap-2"><MapPin size={14} />Dirección</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 mb-2">Calle</label>
                      <input type="text" value={formData.address.street} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Número</label>
                      <input type="text" value={formData.address.number} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, number: e.target.value } })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Población</label>
                      <input type="text" value={formData.address.city} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Provincia</label>
                      <input type="text" value={formData.address.province} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, province: e.target.value } })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Código postal</label>
                      <input type="text" value={formData.address.postalCode} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, postalCode: e.target.value } })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900" />
                    </div>
                  </div>
                </div>

                {/* Información de pago */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider flex items-center gap-2"><CreditCard size={14} />Información de pago</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div ref={paymentMethodDropdownRef} className="relative">
                      <label className="block text-sm font-medium text-slate-700 mb-2">Método de pago</label>
                      <button
                        type="button"
                        onClick={() => setShowPaymentMethodDropdown(!showPaymentMethodDropdown)}
                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-left flex items-center justify-between hover:border-slate-300 transition-colors"
                      >
                        <span className="text-slate-900">{PAYMENT_METHODS.find(m => m.value === formData.paymentMethod)?.label}</span>
                        <ChevronDown size={16} className={"text-slate-400 transition-transform " + (showPaymentMethodDropdown ? "rotate-180" : "")} />
                      </button>
                      {showPaymentMethodDropdown && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
                          {PAYMENT_METHODS.map((method) => (
                            <button
                              key={method.value}
                              type="button"
                              onClick={() => { setFormData({ ...formData, paymentMethod: method.value }); setShowPaymentMethodDropdown(false); }}
                              className={"w-full px-4 py-2 text-left text-sm hover:bg-slate-50 transition-colors " + (formData.paymentMethod === method.value ? "bg-slate-50 text-slate-900 font-medium" : "text-slate-600")}
                            >
                              {method.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Cuenta bancaria (IBAN) / BIC</label>
                      <IBANField
                        iban={formData.bankAccount}
                        bic={formData.bic}
                        onIBANChange={(v) => setFormData({ ...formData, bankAccount: v })}
                        onBICChange={(v) => setFormData({ ...formData, bic: v })}
                        ibanClassName="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                        bicClassName="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                        ibanPlaceholder="Pega 20 dígitos o IBAN completo"
                        bicPlaceholder="BIC/SWIFT (opcional)"
                      />
                    </div>
                  </div>
                </div>

                {/* Certificados */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider flex items-center gap-2"><FileText size={14} />Certificados</h3>
                  <div className="space-y-4">
                    {/* Bank Ownership Certificate */}
                    <div className="border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Certificado de titularidad bancaria</h4>
                        {canVerifyCertificates ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={certificates.bankOwnership.verified} onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, verified: e.target.checked } })} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                            <span className="text-sm text-slate-600 flex items-center gap-1"><ShieldCheck size={14} className="text-emerald-600" />Verificado</span>
                          </label>
                        ) : (
                          <span className="text-xs text-slate-400 flex items-center gap-1"><Lock size={12} />Solo contabilidad ampliada</span>
                        )}
                      </div>
                      {certificates.bankOwnership.verified && formData.bankAccount && (
                        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <p className="text-xs text-emerald-700 mb-1">IBAN verificado:</p>
                          <p className="font-mono text-sm font-bold text-emerald-900">{formatIBAN(formData.bankAccount)}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Archivo</label>
                          <input type="file" onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, file: e.target.files?.[0] || null } })} className="w-full text-sm" accept=".pdf,.jpg,.jpeg,.png" />
                          {modalMode === "edit" && selectedSupplier?.certificates.bankOwnership.fileName && (
                            <p className="text-xs text-slate-500 mt-1">Actual: {selectedSupplier.certificates.bankOwnership.fileName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Fecha caducidad</label>
                          <input type="date" value={certificates.bankOwnership.expiryDate} onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, expiryDate: e.target.value } })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>

                    {/* Contractors Certificate */}
                    <div className="border border-slate-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Certificado de contratistas</h4>
                        {canVerifyCertificates ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={certificates.contractorsCertificate.verified} onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, verified: e.target.checked } })} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                            <span className="text-sm text-slate-600 flex items-center gap-1"><ShieldCheck size={14} className="text-emerald-600" />Verificado</span>
                          </label>
                        ) : (
                          <span className="text-xs text-slate-400 flex items-center gap-1"><Lock size={12} />Solo contabilidad ampliada</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Archivo</label>
                          <input type="file" onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, file: e.target.files?.[0] || null } })} className="w-full text-sm" accept=".pdf,.jpg,.jpeg,.png" />
                          {modalMode === "edit" && selectedSupplier?.certificates.contractorsCertificate.fileName && (
                            <p className="text-xs text-slate-500 mt-1">Actual: {selectedSupplier.certificates.contractorsCertificate.fileName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Fecha caducidad</label>
                          <input type="date" value={certificates.contractorsCertificate.expiryDate} onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, expiryDate: e.target.value } })} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 bg-slate-50">
              <button onClick={() => { setShowModal(false); resetForm(); }} className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white font-medium transition-colors">Cancelar</button>
              <button onClick={modalMode === "create" ? handleCreateSupplier : handleUpdateSupplier} disabled={saving} className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center gap-2">
                {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {modalMode === "create" ? "Crear proveedor" : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white animate-in slide-in-from-bottom-2">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
              >
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
