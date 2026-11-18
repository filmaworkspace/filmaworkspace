"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { AnchoredPanel, Button, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, Modal, Page, PageHeader, PageLoading, Segmented, Select } from "@/components/ds";
import SearchBar, { type SearchField } from "@/components/SearchBar";
import { matchCode, matchWords } from "@/lib/search";
import { IBANField } from "@/components/IBANField";
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
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  MoreHorizontal,
  Edit,
  Eye,
  FileCheck,
  FileText,
  FileX,
  Filter,
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
  const [searchField, setSearchField] = useState<"all" | "name" | "taxId" | "contact" | "iban">("all");
  const [filterPayment, setFilterPayment] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "name">("recent");
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

  // Bloquea el scroll de la página de detrás mientras el modal de nuevo
  // proveedor o el de confirmación están abiertos.
  useBodyScrollLock(showModal || !!confirmDialog);

  // Dropdowns personalizados
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const [showPaymentMethodDropdown, setShowPaymentMethodDropdown] = useState(false);
  const paymentMethodDropdownRef = useRef<HTMLDivElement>(null);
  const [paymentMethodDropdownPos, setPaymentMethodDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [countryDropdownPos, setCountryDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
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
    const csvContent = rows.map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `proveedores_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatDate = (date: Date) => date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "-";

  if (loading) return <PageLoading />;

  // ── Búsqueda avanzada y filtros ───────────────────────────────────────────
  type SupplierField = "all" | "name" | "taxId" | "contact" | "iban";
  const SEARCH_FIELDS: SearchField<SupplierField>[] = [
    { value: "all", label: "Buscar en todo", placeholder: "Nombre, NIF, contacto o IBAN" },
    { value: "name", label: "Nombre", placeholder: "Nombre fiscal o comercial" },
    { value: "taxId", label: "NIF/CIF", placeholder: "Ej. B12345678", mono: true },
    { value: "contact", label: "Contacto", placeholder: "Nombre, email o teléfono" },
    { value: "iban", label: "IBAN", placeholder: "Ej. ES91 2100", mono: true },
  ];
  const supplierMatches = (s: Supplier) => {
    if (!searchTerm.trim()) return true;
    const byName = matchWords(searchTerm, s.fiscalName, s.commercialName);
    const byTax = matchCode(searchTerm, s.taxId);
    const byContact = matchWords(searchTerm, s.contact?.name, s.contact?.email, s.contact?.phone);
    const byIban = matchCode(searchTerm, s.bankAccount);
    if (searchField === "name") return byName;
    if (searchField === "taxId") return byTax;
    if (searchField === "contact") return byContact;
    if (searchField === "iban") return byIban;
    return byName || byTax || byContact || byIban || matchWords(searchTerm, s.address?.city, s.address?.province);
  };
  const rows = suppliers
    .filter(supplierMatches)
    .filter((s) => filterStatus === "all" ? true : filterStatus === "closed" ? !!s.closure : !s.closure && getCertificateStatus(s) === filterStatus)
    .filter((s) => filterPayment === "all" || s.paymentMethod === filterPayment)
    .sort((a, b) => sortBy === "name"
      ? a.fiscalName.localeCompare(b.fiscalName)
      : (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  const filtersActive = filterStatus !== "all" || filterPayment !== "all";

  const certState = (cert: Certificate): { label: string; dot: string; text: string } => {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (!cert.uploaded) return { label: "No subido", dot: "bg-red-500", text: "text-red-700" };
    if (cert.expiryDate && cert.expiryDate < now) return { label: "Caducado", dot: "bg-red-500", text: "text-red-700" };
    if (cert.expiryDate && cert.expiryDate < soon) return { label: "Por caducar", dot: "bg-amber-500", text: "text-amber-800" };
    if (cert.verified) return { label: "Verificado", dot: "bg-emerald-500", text: "text-emerald-800" };
    return { label: "Subido", dot: "bg-slate-400", text: "text-slate-600" };
  };
  const STATE_LABEL: Record<string, { label: string; dot: string; text: string }> = {
    valid: { label: "Al día", dot: "bg-emerald-500", text: "text-emerald-800" },
    expiring: { label: "Por caducar", dot: "bg-amber-500", text: "text-amber-800" },
    expired: { label: "Acción requerida", dot: "bg-red-500", text: "text-red-700" },
    closed: { label: "Cerrado", dot: "bg-slate-300", text: "text-slate-500" },
  };
  const Dot = ({ s }: { s: { label: string; dot: string; text: string } }) => (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
  const paymentLabel = (m: string) => PAYMENT_METHODS.find((p) => p.value === m)?.label || m || "—";

  return (
    <Page>
      <PageHeader
        title={<>Proveedores <span className="text-[15px] font-normal text-slate-400">{suppliers.length}</span></>}
        actions={
          <>
            <Button variant="secondary" onClick={exportSuppliers}><Download size={14} /> Exportar</Button>
            <Button variant="primary" onClick={openCreateModal}><Plus size={14} /> Añadir proveedor</Button>
          </>
        }
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <SearchBar fields={SEARCH_FIELDS} field={searchField} onField={setSearchField} value={searchTerm} onChange={setSearchTerm} count={rows.length} />
        <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="w-44">
          <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterPayment} onChange={(e) => setFilterPayment(e.target.value)}>
            <option value="all">Cualquier forma de pago</option>
            {PAYMENT_METHODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </div>
        <Segmented value={sortBy} onChange={setSortBy} options={[{ value: "recent", label: "Recientes" }, { value: "name", label: "A–Z" }]} />
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterStatus("all"); setFilterPayment("all"); }}>Quitar filtros</Button>
        )}
        </div>
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title={searchTerm || filtersActive ? "Sin resultados" : "Sin proveedores"}
            action={!searchTerm && !filtersActive ? <Button variant="primary" size="sm" onClick={openCreateModal}>Añadir proveedor</Button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="tbl w-full min-w-[1000px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="px-4 py-2 text-left font-medium">Proveedor</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">NIF/CIF</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Contacto</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Forma de pago</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Titularidad</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Contratistas</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Estado</th>
                  <th scope="col" className="w-12 py-2 pr-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const href = `/project/${id}/accounting/suppliers/${s.id}`;
                  const state = STATE_LABEL[s.closure ? "closed" : getCertificateStatus(s)];
                  return (
                    <tr key={s.id} className={`border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${s.closure ? "text-slate-500" : ""}`}>
                      <td className="max-w-[320px] px-4 py-1.5">
                        <Link href={href} className="block">
                          <span className="block truncate font-medium text-slate-900 hover:underline">{s.fiscalName}</span>
                          {s.commercialName && s.commercialName !== s.fiscalName && <span className="block truncate text-xs text-slate-500">{s.commercialName}</span>}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{s.taxId || "—"}</td>
                      <td className="max-w-[240px] px-3 py-1.5">
                        {s.contact?.name || s.contact?.email ? (
                          <>
                            <span className="block truncate">{s.contact?.name || "—"}</span>
                            {s.contact?.email && <span className="block truncate text-xs text-slate-500">{s.contact.email}</span>}
                          </>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{paymentLabel(s.paymentMethod)}</td>
                      <td className="px-3 py-1.5"><Dot s={certState(s.certificates.bankOwnership)} /></td>
                      <td className="px-3 py-1.5"><Dot s={certState(s.certificates.contractorsCertificate)} /></td>
                      <td className="px-3 py-1.5"><Dot s={state} /></td>
                      <td className="py-1.5 pr-3 text-right">
                        <Menu trigger={(toggle) => <IconButton label="Acciones del proveedor" onClick={toggle} className="-my-1"><MoreHorizontal size={15} /></IconButton>}>
                          {(close) => (
                            <>
                              <MenuItem onClick={() => { close(); router.push(href); }}>Abrir ficha</MenuItem>
                              <MenuItem onClick={() => { close(); openEditModal(s); }}>Editar</MenuItem>
                              {!(s.hasAssignedPOs || s.hasAssignedInvoices) && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem danger onClick={() => { close(); handleDeleteSupplier(s); }}>Eliminar</MenuItem>
                                </>
                              )}
                            </>
                          )}
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alta / edición de proveedor */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); resetForm(); }}
        title={modalMode === "create" ? "Nuevo proveedor" : "Editar proveedor"}
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setShowModal(false); resetForm(); }}>Cancelar</Button>
            <Button variant="primary" onClick={modalMode === "create" ? handleCreateSupplier : handleUpdateSupplier} disabled={saving}>
              {saving ? "Guardando…" : modalMode === "create" ? "Crear proveedor" : "Guardar cambios"}
            </Button>
          </>
        }
      >
              <div className="space-y-6">
                {/* Información básica */}
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Información básica</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre fiscal *</label>
                      <input type="text" value={formData.fiscalName} onChange={(e) => setFormData({ ...formData, fiscalName: e.target.value })} onBlur={handleFiscalNameBlur} placeholder="Razón social" className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                      <p className="text-xs text-slate-500 mt-1">Se formateará automáticamente</p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre comercial</label>
                      <input type="text" value={formData.commercialName} onChange={(e) => setFormData({ ...formData, commercialName: e.target.value })} onBlur={handleCommercialNameBlur} placeholder="Nombre comercial" className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">País</label>
                      <Select value={formData.country} onChange={(e) => handleCountryChange(e.target.value)}>
                        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">NIF/CIF *</label>
                      <input type="text" value={formData.taxId} onChange={(e) => handleTaxIdChange(e.target.value)} placeholder={formData.country === "ES" ? "B12345678" : "ID fiscal"} className={`w-full px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 font-mono uppercase ${taxIdError ? "border-red-300 bg-red-50" : "border-slate-200"} text-[13px]`} />
                      {taxIdError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertCircle size={12} />{taxIdError}</p>}
                    </div>
                  </div>
                </div>

                {/* Persona de contacto */}
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Persona de contacto</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Nombre</label>
                      <div className="relative">
                        <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" value={formData.contact.name} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, name: e.target.value } })} placeholder="Nombre del contacto" className="w-full pl-10 pr-4 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Email</label>
                      <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="email" value={formData.contact.email} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, email: e.target.value } })} placeholder="email@ejemplo.com" className="w-full pl-10 pr-4 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Teléfono</label>
                      <div className="relative">
                        <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="tel" value={formData.contact.phone} onChange={(e) => setFormData({ ...formData, contact: { ...formData.contact, phone: e.target.value } })} placeholder="+34 600 000 000" className="w-full pl-10 pr-4 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dirección */}
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Dirección</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Calle</label>
                      <input type="text" value={formData.address.street} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Número</label>
                      <input type="text" value={formData.address.number} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, number: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Población</label>
                      <input type="text" value={formData.address.city} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Provincia</label>
                      <input type="text" value={formData.address.province} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, province: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Código postal</label>
                      <input type="text" value={formData.address.postalCode} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, postalCode: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900 text-[13px]" />
                    </div>
                  </div>
                </div>

                {/* Información de pago */}
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Información de pago</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Método de pago</label>
                      <Select value={formData.paymentMethod} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as PaymentMethod })}>
                        {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-600">Cuenta bancaria (IBAN) / BIC</label>
                      <IBANField
                        iban={formData.bankAccount}
                        bic={formData.bic}
                        onIBANChange={(v) => setFormData({ ...formData, bankAccount: v })}
                        onBICChange={(v) => setFormData({ ...formData, bic: v })}
                        ibanClassName="w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900"
                        bicClassName="w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-md focus:outline-none focus:ring-4 focus:ring-slate-900/10 focus:border-slate-900"
                        ibanPlaceholder="Pega 20 dígitos o IBAN completo"
                        bicPlaceholder="BIC/SWIFT (opcional)"
                      />
                    </div>
                  </div>
                </div>

                {/* Certificados */}
                <div>
                  <h3 className="mb-3 text-[13px] font-semibold text-slate-900">Certificados</h3>
                  <div className="space-y-4">
                    {/* Bank Ownership Certificate */}
                    <div className="border border-slate-200 rounded-md p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Certificado de titularidad bancaria</h4>
                        {canVerifyCertificates ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={certificates.bankOwnership.verified} onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, verified: e.target.checked } })} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 text-[13px]" />
                            <span className="text-[13px] text-slate-600 flex items-center gap-1"><ShieldCheck size={14} className="text-emerald-600" />Verificado</span>
                          </label>
                        ) : (
                          <span className="text-xs text-slate-400 flex items-center gap-1"><Lock size={12} />Solo contabilidad ampliada</span>
                        )}
                      </div>
                      {certificates.bankOwnership.verified && formData.bankAccount && (
                        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <p className="text-xs text-emerald-700 mb-1">IBAN verificado:</p>
                          <p className="font-mono text-[13px] font-bold text-emerald-900">{formatIBAN(formData.bankAccount)}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Archivo</label>
                          <input type="file" onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, file: e.target.files?.[0] || null } })} className="w-full text-[13px]" accept=".pdf,.jpg,.jpeg,.png" />
                          {modalMode === "edit" && selectedSupplier?.certificates.bankOwnership.fileName && (
                            <p className="text-xs text-slate-500 mt-1">Actual: {selectedSupplier.certificates.bankOwnership.fileName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Fecha caducidad</label>
                          <input type="date" value={certificates.bankOwnership.expiryDate} onChange={(e) => setCertificates({ ...certificates, bankOwnership: { ...certificates.bankOwnership, expiryDate: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px]" />
                        </div>
                      </div>
                    </div>

                    {/* Contractors Certificate */}
                    <div className="border border-slate-200 rounded-md p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Certificado de contratistas</h4>
                        {canVerifyCertificates ? (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={certificates.contractorsCertificate.verified} onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, verified: e.target.checked } })} className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 text-[13px]" />
                            <span className="text-[13px] text-slate-600 flex items-center gap-1"><ShieldCheck size={14} className="text-emerald-600" />Verificado</span>
                          </label>
                        ) : (
                          <span className="text-xs text-slate-400 flex items-center gap-1"><Lock size={12} />Solo contabilidad ampliada</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Archivo</label>
                          <input type="file" onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, file: e.target.files?.[0] || null } })} className="w-full text-[13px]" accept=".pdf,.jpg,.jpeg,.png" />
                          {modalMode === "edit" && selectedSupplier?.certificates.contractorsCertificate.fileName && (
                            <p className="text-xs text-slate-500 mt-1">Actual: {selectedSupplier.certificates.contractorsCertificate.fileName}</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">Fecha caducidad</label>
                          <input type="date" value={certificates.contractorsCertificate.expiryDate} onChange={(e) => setCertificates({ ...certificates, contractorsCertificate: { ...certificates.contractorsCertificate, expiryDate: e.target.value } })} className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-[13px]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
      </Modal>

      {/* Toast notifications */}
      {successMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-slate-900 text-white animate-in slide-in-from-bottom-2">
          <CheckCircle size={16} />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="fixed bottom-4 left-4 z-50 px-4 py-3 rounded-md text-[13px] font-medium shadow-lg flex items-center gap-2 bg-red-600 text-white animate-in slide-in-from-bottom-2">
          <AlertCircle size={16} />
          {errorMessage}
          <button onClick={() => setErrorMessage("")} className="ml-2 hover:bg-white/20 rounded p-0.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Confirmación */}
      <Modal
        open={!!confirmDialog}
        onClose={() => setConfirmDialog(null)}
        title={confirmDialog?.title || ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDialog(null)}>Cancelar</Button>
            <Button variant={confirmDialog?.danger ? "danger" : "primary"} onClick={() => confirmDialog?.onConfirm()}>{confirmDialog?.confirmLabel || "Confirmar"}</Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">{confirmDialog?.message}</p>
      </Modal>
    </Page>
  );
}
