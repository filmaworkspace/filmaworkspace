"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, setDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2,
  Eye, EyeOff, Loader2, Lock, Plus, Trash2, Upload, User, X,
} from "lucide-react";
import Image from "next/image";

// ─── Brand ───────────────────────────────────────────────────────────────────

const D = "#342A21";
const L = "#C9B79C";

function FormLogo() {
  return <Image src="/logo-forms.svg" alt="Forms" width={110} height={36} priority />;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormDoc {
  type: "crew_onboarding" | "box_request" | "dietas_request";
  pin: string;
  status: "pending" | "submitted";
  projectId: string;
  projectName: string;
  crewMemberId?: string;
  createdByName: string;
  coordinatorMessage?: string;
  expiresAt?: Timestamp;
  importedToEnvelopeId?: string | null;
  prefilled: {
    firstName?: string; lastName1?: string; lastName2?: string; artisticName?: string;
    email?: string; phone?: string; role?: string; department?: string; section?: string;
    requesterName?: string;
  };
  // dietas_request extras
  dateFrom?: string;
  dateTo?: string;
  people?: Array<{ memberId: string; firstName: string; lastName1: string; department: string; section: string }>;
  allowanceTypes?: string[];
}

interface UploadedFile { name: string; url: string; size: number; }

// ─── crew_onboarding types ────────────────────────────────────────────────────

interface CrewFormResponse {
  firstName: string; lastName1: string; lastName2: string; artisticName: string;
  birthDate: string; birthPlace: string; nationality: string;
  docType: "dni" | "nie" | "passport"; docNumber: string; docExpiry: string;
  email: string; phone: string;
  address: string; postalCode: string; city: string; province: string; country: string;
  ssNumber: string; ssRegime: string; irpfRate: string; contractReason: string;
  iban: string; bankName: string; accountHolder: string;
  docs: Record<string, UploadedFile>;
  photoUrl?: string;
  privacyAccepted: boolean;
}

const CREW_EMPTY: CrewFormResponse = {
  firstName: "", lastName1: "", lastName2: "", artisticName: "",
  birthDate: "", birthPlace: "", nationality: "Española",
  docType: "dni", docNumber: "", docExpiry: "",
  email: "", phone: "",
  address: "", postalCode: "", city: "", province: "", country: "España",
  ssNumber: "", ssRegime: "", irpfRate: "", contractReason: "",
  iban: "", bankName: "", accountHolder: "",
  docs: {}, photoUrl: "", privacyAccepted: false,
};

interface FormBuilderConfig {
  showPhoto: boolean;
  showLastName2: boolean;
  showArtisticName: boolean;
  showDocExpiry: boolean;
  showBirthPlace: boolean;
  showNationality: boolean;
  showProvince: boolean;
  showCountry: boolean;
  showIrpfRate: boolean;
  showContractReason: boolean;
  showBankName: boolean;
  showAccountHolder: boolean;
  showBankCert: boolean;
  showCv: boolean;
}

const FORM_BUILDER_DEFAULTS: FormBuilderConfig = {
  showPhoto: true, showLastName2: true, showArtisticName: false,
  showDocExpiry: true, showBirthPlace: false, showNationality: true,
  showProvince: true, showCountry: true,
  showIrpfRate: true, showContractReason: false, showBankName: false, showAccountHolder: false,
  showBankCert: false, showCv: false,
};

const SS_REGIMES = ["Régimen General", "Régimen Especial Artistas", "Autónomo (RETA)", "Trabajador/a Extranjero/a"];
const DOC_UPLOADS_BASE = [
  { key: "id_front",  label: "DNI / NIE — Anverso",           required: true,  configKey: null          },
  { key: "id_back",   label: "DNI / NIE — Reverso",           required: true,  configKey: null          },
  { key: "bank_cert", label: "Certificado de cuenta bancaria", required: false, configKey: "showBankCert" as const },
  { key: "cv",        label: "Curriculum Vitae",               required: false, configKey: "showCv" as const      },
];
const CREW_STEPS = ["Datos personales", "Contacto", "Fiscal y bancario", "Documentos", "Revisión"];

// ─── box_request types ────────────────────────────────────────────────────────

interface ExpenseItem {
  localId: string;
  description: string;
  amount: string;
  fileUrl?: string;
  fileName?: string;
  uploading?: boolean;
  uploadProgress?: number;
}

// ─── Resguardo PDF ────────────────────────────────────────────────────────────

async function downloadResguardo(formDoc: FormDoc, responseData: any, formId: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210, mL = 20, mR = 20, cW = W - mL - mR;
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  let y = 22;

  // Header bar
  pdf.setFillColor(52, 42, 33);
  pdf.rect(0, 0, W, 18, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(201, 183, 156);
  pdf.text("FILMA WORKSPACE FORMS", mL, 11);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(201, 183, 156);
  pdf.text(dateStr + " · " + timeStr, W - mR, 11, { align: "right" });

  y = 32;

  // Title
  const title = formDoc.type === "crew_onboarding"
    ? "RESGUARDO DE FICHA DE ALTA"
    : formDoc.type === "dietas_request"
    ? "RESGUARDO DE INFORME DE DIETAS"
    : "RESGUARDO DE SOLICITUD DE CAJA";
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(52, 42, 33);
  pdf.text(title, mL, y);

  y += 6;
  pdf.setDrawColor(201, 183, 156);
  pdf.setLineWidth(0.5);
  pdf.line(mL, y, W - mR, y);
  y += 8;

  // Project + ref
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(110, 110, 110);
  pdf.text(`Proyecto: ${formDoc.projectName || "—"}`, mL, y);
  pdf.text(`Ref: ${formId.slice(0, 8).toUpperCase()}`, W - mR, y, { align: "right" });
  y += 12;

  if (formDoc.type === "crew_onboarding") {
    // ── Crew sections
    const sections: [string, [string, string][]][] = [
      ["Datos personales", [
        ["Nombre completo", `${responseData.firstName} ${responseData.lastName1}${responseData.lastName2 ? " " + responseData.lastName2 : ""}`],
        ["Nombre en créditos", responseData.artisticName || "—"],
        ["Documento", `${(responseData.docType || "").toUpperCase()} ${responseData.docNumber}`],
        ["Fecha nacimiento", responseData.birthDate || "—"],
        ["Nacionalidad", responseData.nationality || "—"],
      ]],
      ["Contacto", [
        ["Email", responseData.email || "—"],
        ["Teléfono", responseData.phone || "—"],
        ["Dirección", `${responseData.address || ""}, ${responseData.postalCode || ""} ${responseData.city || ""}`],
      ]],
      ["Fiscal y bancario", [
        ["Nº SS", responseData.ssNumber || "—"],
        ["Régimen", responseData.ssRegime || "—"],
        ["IRPF", responseData.irpfRate ? `${responseData.irpfRate}%` : "—"],
        ["IBAN", responseData.iban || "—"],
        ["Banco", responseData.bankName || "—"],
        ["Titular", responseData.accountHolder || "—"],
      ]],
      ["Documentos adjuntos", DOC_UPLOADS_BASE.filter(d => responseData.docs?.[d.key]).map(d => [d.label, "✓ Adjuntado"] as [string, string])],
    ];

    for (const [sectionTitle, rows] of sections) {
      if (y + rows.length * 7 + 14 > 280) { pdf.addPage(); y = 20; }
      pdf.setFillColor(245, 243, 240);
      pdf.rect(mL, y - 4, cW, 9, "F");
      pdf.setFillColor(52, 42, 33);
      pdf.rect(mL, y - 4, 2.5, 9, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.setTextColor(52, 42, 33);
      pdf.text(sectionTitle.toUpperCase(), mL + 5, y + 1.5);
      y += 10;
      for (const [label, value] of rows) {
        if (y > 280) { pdf.addPage(); y = 20; }
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(130, 120, 110);
        pdf.text(label, mL + 3, y);
        pdf.setTextColor(30, 30, 30);
        const isOk = String(value).startsWith("✓");
        if (isOk) pdf.setTextColor(22, 163, 74);
        else if (value === "No adjuntado") pdf.setTextColor(200, 190, 180);
        pdf.text(pdf.splitTextToSize(String(value), 90)[0], W - mR, y, { align: "right" });
        pdf.setTextColor(220, 215, 210);
        pdf.setLineWidth(0.2);
        pdf.line(mL, y + 2, W - mR, y + 2);
        y += 7;
      }
      y += 5;
    }
  } else {
    // ── Box request
    const expenses: any[] = responseData.expenses || [];
    const total = expenses.reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0);

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(52, 42, 33);
    pdf.text("SOLICITANTE", mL, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(30, 30, 30);
    pdf.text(responseData.requesterName || "—", mL, y);
    y += 3;
    pdf.setFontSize(8);
    pdf.setTextColor(110, 110, 110);
    pdf.text(`Solicitud gestionada por: ${formDoc.createdByName}`, mL, y + 5);
    if (responseData.notes?.trim()) {
      y += 10;
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 90, 80);
      pdf.text(`"${responseData.notes}"`, mL, y);
    }
    y += 14;

    // Expenses table
    pdf.setFillColor(245, 243, 240);
    pdf.rect(mL, y - 4, cW, 9, "F");
    pdf.setFillColor(52, 42, 33);
    pdf.rect(mL, y - 4, 2.5, 9, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(52, 42, 33);
    pdf.text("GASTOS SOLICITADOS", mL + 5, y + 1.5);
    y += 10;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(110, 110, 110);
    pdf.text("#", mL, y);
    pdf.text("DESCRIPCIÓN", mL + 10, y);
    pdf.text("IMPORTE", W - mR, y, { align: "right" });
    y += 3;
    pdf.setDrawColor(210, 200, 190);
    pdf.setLineWidth(0.3);
    pdf.line(mL, y, W - mR, y);
    y += 5;

    for (let i = 0; i < expenses.length; i++) {
      const e = expenses[i];
      if (y > 275) { pdf.addPage(); y = 20; }
      if (i % 2 === 0) { pdf.setFillColor(252, 251, 249); pdf.rect(mL, y - 3.5, cW, 7, "F"); }
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 90, 80);
      pdf.text(String(i + 1), mL + 1, y);
      pdf.setTextColor(30, 30, 30);
      pdf.text(pdf.splitTextToSize(e.description || "—", 130)[0], mL + 10, y);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${Number(e.amount || 0).toFixed(2)} €`, W - mR, y, { align: "right" });
      y += 7;
    }

    y += 3;
    pdf.setDrawColor(52, 42, 33);
    pdf.setLineWidth(0.5);
    pdf.line(mL + 100, y, W - mR, y);
    y += 6;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(52, 42, 33);
    pdf.text("TOTAL", mL + 100, y);
    pdf.text(`${total.toFixed(2)} €`, W - mR, y, { align: "right" });
  }

  // Footer
  const pages = (pdf as any).internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(180, 170, 160);
    pdf.line(mL, 287, W - mR, 287);
    pdf.text("Generado con Filma Workspace Forms · Este documento es un resguardo del envío y no tiene validez contractual.", mL, 292);
    pdf.text(`${p} / ${pages}`, W - mR, 292, { align: "right" });
  }

  const slug = formDoc.type === "box_request" ? "solicitud-caja" : "ficha-alta";
  pdf.save(`${slug}_${formId.slice(0, 8)}_${now.toISOString().slice(0, 10)}.pdf`);
}

// ─── FileUploadField ──────────────────────────────────────────────────────────

function FileUploadField({ docKey, label, required, formId, existing, onUploaded }: {
  docKey: string; label: string; required: boolean; formId: string;
  existing?: UploadedFile; onUploaded: (key: string, file: UploadedFile | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError]       = useState("");
  const inputRef                = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setError("Máximo 10 MB"); return; }
    setError(""); setProgress(0);
    const storageRef = ref(storage, `forms/${formId}/docs/${docKey}_${Date.now()}_${file.name}`);
    const task = uploadBytesResumable(storageRef, file);
    task.on("state_changed",
      (s) => setProgress(Math.round((s.bytesTransferred / s.totalBytes) * 100)),
      () => { setError("Error al subir"); setProgress(null); },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        onUploaded(docKey, { name: file.name, url, size: file.size });
        setProgress(null);
      }
    );
  };

  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {existing ? (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0" />
          <span className="text-sm text-emerald-800 flex-1 truncate">{existing.name}</span>
          <button type="button" onClick={() => onUploaded(docKey, null)} className="p-1 text-emerald-600 hover:text-red-500 transition-colors"><X size={13} /></button>
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className="border-2 border-dashed border-stone-200 rounded-xl p-5 text-center cursor-pointer hover:border-stone-400 hover:bg-stone-50 transition-all">
          {progress !== null ? (
            <div className="space-y-2">
              <Loader2 size={18} className="animate-spin mx-auto" style={{ color: D }} />
              <div className="w-full bg-stone-100 rounded-full h-1 mx-auto max-w-[140px]">
                <div className="h-1 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: D }} />
              </div>
              <p className="text-xs text-stone-400">{progress}%</p>
            </div>
          ) : (
            <>
              <Upload size={18} className="text-stone-300 mx-auto mb-1.5" />
              <p className="text-sm text-stone-500">Arrastra o <span className="font-medium" style={{ color: D }}>selecciona</span></p>
              <p className="text-xs text-stone-400 mt-0.5">PDF, JPG, PNG · máx. 10 MB</p>
            </>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}

// ─── ExpenseUploadRow ─────────────────────────────────────────────────────────

function ExpenseUploadRow({ expense, formId, onChange, onRemove }: {
  expense: ExpenseItem; formId: string;
  onChange: (id: string, patch: Partial<ExpenseItem>) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (file.size > 10 * 1024 * 1024) return;
    onChange(expense.localId, { uploading: true, uploadProgress: 0 });
    const storageRef = ref(storage, `forms/${formId}/expenses/${expense.localId}_${Date.now()}_${file.name}`);
    const task = uploadBytesResumable(storageRef, file);
    task.on("state_changed",
      (s) => onChange(expense.localId, { uploadProgress: Math.round((s.bytesTransferred / s.totalBytes) * 100) }),
      () => onChange(expense.localId, { uploading: false }),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        onChange(expense.localId, { fileUrl: url, fileName: file.name, uploading: false, uploadProgress: undefined });
      }
    );
  };

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <textarea
          value={expense.description}
          onChange={(e) => onChange(expense.localId, { description: e.target.value })}
          placeholder="Descripción del gasto (proveedor, concepto…)"
          rows={2}
          className="flex-1 px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none resize-none bg-white"
          style={{ borderColor: expense.description ? "#d1c7bc" : "" }}
        />
        <button type="button" onClick={() => onRemove(expense.localId)}
          className="mt-0.5 p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-[140px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">€</span>
          <input type="number" min="0" step="0.01"
            value={expense.amount}
            onChange={(e) => onChange(expense.localId, { amount: e.target.value })}
            placeholder="0,00"
            className="w-full pl-7 pr-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none bg-white font-medium"
            style={{ color: D }}
          />
        </div>

        {expense.fileUrl ? (
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
            <span className="text-xs text-emerald-700 truncate flex-1">{expense.fileName}</span>
            <button type="button" onClick={() => onChange(expense.localId, { fileUrl: undefined, fileName: undefined })}
              className="text-emerald-500 hover:text-red-500 transition-colors"><X size={12} /></button>
          </div>
        ) : expense.uploading ? (
          <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-stone-100 border border-stone-200 rounded-lg">
            <Loader2 size={13} className="animate-spin" style={{ color: D }} />
            <div className="flex-1 bg-stone-200 rounded-full h-1">
              <div className="h-1 rounded-full" style={{ width: `${expense.uploadProgress}%`, backgroundColor: D }} />
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()}
            className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-400 hover:border-stone-500 hover:text-stone-600 transition-all">
            <Upload size={13} />
            <span className="text-xs">Adjuntar justificante</span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FormPage() {
  const params = useParams();
  const formId = params?.formId as string;

  const [loading,     setLoading]     = useState(true);
  const [formDoc,     setFormDoc]     = useState<FormDoc | null>(null);
  const [notFound,    setNotFound]    = useState(false);
  const [expired,     setExpired]     = useState(false);
  const [alreadySent, setAlreadySent] = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [submittedData, setSubmittedData] = useState<any>(null);

  // PIN
  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [pinError,  setPinError]  = useState("");
  const [pinOk,     setPinOk]     = useState(false);
  const [showPin,   setShowPin]   = useState(false);
  const pinRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  // crew_onboarding
  const [step,       setStep]       = useState(0);
  const [crewData,   setCrewData]   = useState<CrewFormResponse>(CREW_EMPTY);
  const [crewErrors, setCrewErrors] = useState<Partial<Record<keyof CrewFormResponse, string>>>({});
  const [fc,         setFc]         = useState<FormBuilderConfig>(FORM_BUILDER_DEFAULTS);

  const DOC_UPLOADS = DOC_UPLOADS_BASE.filter((d) => !d.configKey || fc[d.configKey]);

  // box_request
  const [expenses,     setExpenses]     = useState<ExpenseItem[]>([]);
  const [boxNotes,     setBoxNotes]     = useState("");
  const [boxSubmitting,setBoxSubmitting]= useState(false);

  // dietas_request state
  // { memberId: { "2025-07-06": { meals: true, ... } } }
  const [dietasData,   setDietasData]   = useState<Record<string, Record<string, Record<string,boolean>>>>({});
  const [qfPerson,     setQfPerson]     = useState<string|null>(null);
  const [qfFrom,       setQfFrom]       = useState("");
  const [qfTo,         setQfTo]         = useState("");
  const [qfTypes,      setQfTypes]      = useState<Record<string,boolean>>({});
  const [dietasSubmitting, setDietasSubmitting] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [openSelectKey, setOpenSelectKey] = useState<string | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!formId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "forms", formId));
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        const d = snap.data() as FormDoc;
        if (d.status === "submitted") { setAlreadySent(true); setLoading(false); return; }
        if (d.expiresAt && d.expiresAt.toDate() < new Date()) { setExpired(true); setLoading(false); return; }
        setFormDoc(d);
        if (d.type === "crew_onboarding") {
          setCrewData((prev) => ({
            ...prev,
            firstName: d.prefilled.firstName || "", lastName1: d.prefilled.lastName1 || "",
            lastName2: d.prefilled.lastName2 || "", artisticName: d.prefilled.artisticName || "",
            email: d.prefilled.email || "", phone: d.prefilled.phone || "",
          }));
          // Load form builder config for this project
          try {
            const fcSnap = await getDoc(doc(db, `projects/${d.projectId}/teamConfig`, "formConfig"));
            if (fcSnap.exists()) setFc({ ...FORM_BUILDER_DEFAULTS, ...fcSnap.data() });
          } catch { /* use defaults */ }
        }
      } catch (e) { console.error(e); setNotFound(true); }
      finally { setLoading(false); }
    })();
  }, [formId]);

  // ── PIN ───────────────────────────────────────────────────────────────────

  const handlePinChange = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...pinDigits]; next[i] = v; setPinDigits(next); setPinError("");
    if (v && i < 3) pinRefs[i + 1].current?.focus();
  };
  const handlePinKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !pinDigits[i] && i > 0) pinRefs[i - 1].current?.focus();
  };
  const handlePinPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (text.length === 4) { setPinDigits(text.split("")); pinRefs[3].current?.focus(); }
  };
  const verifyPin = () => {
    const entered = pinDigits.join("");
    if (entered.length < 4) { setPinError("Introduce los 4 dígitos"); return; }
    if (entered !== formDoc?.pin) { setPinError("Código incorrecto"); setPinDigits(["", "", "", ""]); pinRefs[0].current?.focus(); return; }
    setPinOk(true);
  };

  // ── crew_onboarding validation ────────────────────────────────────────────

  const validateCrewStep = useCallback((): boolean => {
    const e: typeof crewErrors = {};
    if (step === 0) {
      if (!crewData.firstName.trim()) e.firstName = "Obligatorio";
      if (!crewData.lastName1.trim()) e.lastName1 = "Obligatorio";
      if (!crewData.birthDate)        e.birthDate = "Obligatorio";
      if (!crewData.docNumber.trim()) e.docNumber = "Obligatorio";
    } else if (step === 1) {
      if (!crewData.email.trim())      e.email      = "Obligatorio";
      if (!crewData.phone.trim())      e.phone      = "Obligatorio";
      if (!crewData.address.trim())    e.address    = "Obligatorio";
      if (!crewData.postalCode.trim()) e.postalCode = "Obligatorio";
      if (!crewData.city.trim())       e.city       = "Obligatorio";
    } else if (step === 2) {
      if (!crewData.ssNumber.trim()) e.ssNumber = "Obligatorio";
      if (!crewData.ssRegime)        e.ssRegime = "Obligatorio";
      if (!crewData.iban.trim())     e.iban     = "Obligatorio";
    } else if (step === 3) {
      const missing = DOC_UPLOADS.filter((d) => d.required && !crewData.docs[d.key]);
      if (missing.length > 0) e.docs = "Sube los documentos obligatorios (*)" as any;
    } else if (step === 4) {
      if (!crewData.privacyAccepted) e.privacyAccepted = "Debes aceptar la política de privacidad" as any;
    }
    setCrewErrors(e);
    return Object.keys(e).length === 0;
  }, [step, crewData]);

  const nextStep = () => { if (validateCrewStep()) setStep((s) => s + 1); };
  const prevStep = () => { setCrewErrors({}); setStep((s) => s - 1); };

  // ── crew submit ───────────────────────────────────────────────────────────

  const handleCrewSubmit = async () => {
    if (!validateCrewStep()) return;
    setSubmitting(true);
    try {
      const payload = {
        ...crewData,
        docs: Object.fromEntries(Object.entries(crewData.docs).map(([k, v]) => [k, v.url])),
      };
      await updateDoc(doc(db, "forms", formId), {
        status: "submitted", submittedAt: Timestamp.now(), responseData: payload,
      });
      // Sync photo and key data back to the crew member profile
      if (formDoc?.crewMemberId && formDoc?.projectId) {
        const patch: Record<string, unknown> = {
          phone: crewData.phone, email: crewData.email,
          address: crewData.address, postalCode: crewData.postalCode,
          municipality: crewData.city,
          birthDate: crewData.birthDate, birthPlace: crewData.birthPlace,
          nationality: crewData.nationality,
          dni: crewData.docNumber,
          socialSecurityNumber: crewData.ssNumber,
          iban: crewData.iban, bankAccount: crewData.iban,
        };
        if (crewData.photoUrl) patch.photoUrl = crewData.photoUrl;
        await updateDoc(doc(db, `projects/${formDoc.projectId}/crew`, formDoc.crewMemberId), patch);
      }
      setSubmittedData(payload);
      setSubmitted(true);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  // ── box submit ────────────────────────────────────────────────────────────

  const addExpense = () => {
    setExpenses((prev) => [...prev, { localId: crypto.randomUUID(), description: "", amount: "", fileUrl: undefined, fileName: undefined }]);
  };

  const updateExpense = (id: string, patch: Partial<ExpenseItem>) => {
    setExpenses((prev) => prev.map((e) => e.localId === id ? { ...e, ...patch } : e));
  };

  const removeExpense = (id: string) => setExpenses((prev) => prev.filter((e) => e.localId !== id));

  const handleBoxSubmit = async () => {
    if (expenses.length === 0) return;
    const invalid = expenses.some((e) => !e.description.trim() || !e.amount);
    if (invalid) return;
    setBoxSubmitting(true);
    try {
      const requesterName = formDoc?.prefilled.requesterName || "";
      const payload = {
        requesterName,
        notes: boxNotes.trim(),
        expenses: expenses.map((e) => ({
          description: e.description,
          amount: parseFloat(e.amount) || 0,
          fileUrl: e.fileUrl || null,
          fileName: e.fileName || null,
        })),
        totalAmount: expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0),
      };
      await updateDoc(doc(db, "forms", formId), {
        status: "submitted", submittedAt: Timestamp.now(), responseData: payload,
      });
      setSubmittedData(payload);
      setSubmitted(true);
    } catch (e) { console.error(e); }
    finally { setBoxSubmitting(false); }
  };

  // ── Field helpers ─────────────────────────────────────────────────────────

  const crewField = (label: string, key: keyof CrewFormResponse, opts?: {
    type?: string; placeholder?: string; required?: boolean; readonly?: boolean; half?: boolean;
  }) => {
    const { type = "text", placeholder = "", required = false, readonly = false } = opts || {};
    const err = crewErrors[key];
    return (
      <div className={`min-w-0 ${opts?.half ? "col-span-2 sm:col-span-1" : "col-span-2"}`}>
        <label className="block text-sm font-medium text-stone-700 mb-1.5">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        <input type={type} value={crewData[key] as string} readOnly={readonly} placeholder={placeholder}
          onChange={(e) => { if (!readonly) { setCrewData((d) => ({ ...d, [key]: e.target.value })); setCrewErrors((er) => ({ ...er, [key]: undefined })); } }}
          className={`w-full min-w-0 px-4 py-3 border rounded-xl text-sm focus:outline-none transition-all ${
            readonly ? "bg-stone-50 text-stone-400 cursor-not-allowed border-stone-100" :
            err ? "border-red-300 bg-red-50" : "border-stone-200 bg-white text-stone-900"
          }`}
        />
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  const crewSelect = (label: string, key: keyof CrewFormResponse, options: string[], required = false) => {
    const err = crewErrors[key];
    const current = crewData[key] as string;
    const isOpen = openSelectKey === key;
    return (
      <div className="col-span-2">
        <label className="block text-sm font-medium text-stone-700 mb-1.5">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        <div className="relative">
          <button type="button"
            onClick={() => setOpenSelectKey(isOpen ? null : key as string)}
            className={`w-full px-4 py-3 border rounded-xl text-sm text-left flex items-center justify-between bg-white transition-all ${err ? "border-red-300" : isOpen ? "border-stone-400" : "border-stone-200 hover:border-stone-300"}`}>
            <span className={current ? "text-stone-900" : "text-stone-400"}>{current || "Seleccionar"}</span>
            <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-stone-400 transition-transform ${isOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {isOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg py-1 max-h-52 overflow-y-auto">
              {options.map((o) => (
                <button key={o} type="button"
                  onClick={() => { setCrewData((d) => ({ ...d, [key]: o })); setCrewErrors((er) => ({ ...er, [key]: undefined })); setOpenSelectKey(null); }}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between transition-colors hover:bg-stone-50 ${current === o ? "font-medium text-stone-900" : "text-stone-700"}`}>
                  {o}
                  {current === o && <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>}
                </button>
              ))}
            </div>
          )}
        </div>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER STATES
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#FAF8F5" }}>
      <Loader2 size={28} className="animate-spin" style={{ color: D }} />
    </div>
  );

  if (notFound)    return <InfoScreen icon="?" title="Formulario no encontrado"  message="El enlace no es válido o ha sido eliminado." />;
  if (expired)     return <InfoScreen icon="⏱" title="Formulario caducado"      message="Este formulario ya no está disponible. Contacta con el equipo de contabilidad o coordinación." />;
  if (alreadySent) return <InfoScreen icon="✓" title="Formulario ya enviado"    message="Este formulario ya fue completado. Gracias." />;

  if (submitted && formDoc) return (
    <SuccessScreen
      formDoc={formDoc}
      responseData={submittedData}
      formId={formId}
    />
  );

  // ── PIN ───────────────────────────────────────────────────────────────────

  if (!pinOk) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#FAF8F5" }}>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="mb-10 text-center">
            <FormLogo />
          </div>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
            <div className="text-center mb-8">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "rgba(52,42,33,0.07)" }}>
                <Lock size={18} style={{ color: D }} />
              </div>
              <h1 className="text-lg font-bold mb-1" style={{ color: D }}>Código de acceso</h1>
              <p className="text-sm text-stone-500">
                {formDoc?.createdByName
                  ? <>Introduce el código enviado por <strong className="text-stone-700">{formDoc.createdByName}</strong></>
                  : "Introduce el código de 4 dígitos"}
              </p>
            </div>
            <div className="flex gap-3 justify-center mb-5">
              {pinDigits.map((d, i) => (
                <input key={i} ref={pinRefs[i]} type={showPin ? "text" : "password"}
                  inputMode="numeric" maxLength={1} value={d}
                  onChange={(e) => handlePinChange(i, e.target.value)}
                  onKeyDown={(e) => handlePinKeyDown(i, e)}
                  onPaste={i === 0 ? handlePinPaste : undefined}
                  className="w-14 h-16 text-center text-2xl font-bold border-2 rounded-xl focus:outline-none transition-all"
                  style={{
                    borderColor: pinError ? "#fca5a5" : d ? D : "#e7e5e4",
                    backgroundColor: pinError ? "#fff1f2" : d ? "rgba(52,42,33,0.04)" : "#fff",
                    color: pinError ? "#dc2626" : D,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-center mb-4">
              <button type="button" onClick={() => setShowPin(!showPin)}
                className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors">
                {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
                {showPin ? "Ocultar" : "Mostrar"} código
              </button>
            </div>
            {pinError && (
              <p className="text-sm text-red-500 text-center mb-4 flex items-center justify-center gap-1.5">
                <AlertCircle size={13} /> {pinError}
              </p>
            )}
            <button onClick={verifyPin} disabled={pinDigits.join("").length < 4}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: D }}>
              Acceder
            </button>
          </div>
          <p className="text-xs text-stone-400 mt-8 text-center max-w-xs">
            Este formulario es personal e intransferible.
          </p>
        </div>
      </div>
    );
  }

  // ── DIETAS REQUEST form ───────────────────────────────────────────────────

  if (formDoc?.type === "dietas_request") {
    const people = formDoc.people || [];
    const allowTypes = formDoc.allowanceTypes || [];

    const getDatesInRange = (from: string, to: string): string[] => {
      const dates: string[] = [];
      const start = new Date(from + "T00:00:00");
      const end   = new Date(to   + "T00:00:00");
      const cur   = new Date(start);
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 1);
      }
      return dates;
    };

    const allDates = formDoc.dateFrom && formDoc.dateTo ? getDatesInRange(formDoc.dateFrom, formDoc.dateTo) : [];
    const DAY_SH = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    const fmtDate = (d: string) => {
      const dt = new Date(d + "T00:00:00");
      return `${DAY_SH[dt.getDay()]} ${dt.getDate()}`;
    };
    const isWeekend = (d: string) => { const wd = new Date(d+"T00:00:00").getDay(); return wd===0||wd===6; };

    const DIETA_LABELS: Record<string,string> = {
      meals:"Comidas", halfPerDiem:"½ dieta nac.", perDiem:"Dieta nac.",
      halfIntlPerDiem:"½ dieta int.", intlPerDiem:"Dieta int.",
      accommodation:"Alojamiento", car:"Vehículo",
    };
    const DIETA_COLORS: Record<string,string> = {
      meals:"#f97316", halfPerDiem:"#7dd3fc", perDiem:"#0ea5e9",
      halfIntlPerDiem:"#a5b4fc", intlPerDiem:"#6366f1",
      accommodation:"#a855f7", car:"#10b981",
    };

    const toggleType = (mId: string, date: string, t: string) => {
      setDietasData(prev => {
        const pM = prev[mId] || {};
        const pD = pM[date] || {};
        return { ...prev, [mId]: { ...pM, [date]: { ...pD, [t]: !pD[t] } } };
      });
    };

    const applyQuickFill = (mId: string) => {
      if (!qfFrom || !qfTo) return;
      const rangeDates = getDatesInRange(
        qfFrom < formDoc.dateFrom! ? formDoc.dateFrom! : qfFrom,
        qfTo   > formDoc.dateTo!   ? formDoc.dateTo!   : qfTo,
      );
      setDietasData(prev => {
        const pM = { ...(prev[mId] || {}) };
        for (const d of rangeDates) {
          pM[d] = { ...(pM[d] || {}), ...Object.fromEntries(allowTypes.map(t => [t, !!qfTypes[t]])) };
        }
        return { ...prev, [mId]: pM };
      });
      setQfPerson(null);
    };

    const totalFilledDays = people.reduce((sum, p) => {
      return sum + allDates.filter(d => Object.values(dietasData[p.memberId]?.[d] || {}).some(Boolean)).length;
    }, 0);

    const handleDietasSubmit = async () => {
      setDietasSubmitting(true);
      try {
        await updateDoc(doc(db, "forms", formId), {
          status: "submitted",
          submittedAt: Timestamp.now(),
          response: { entries: dietasData },
        });
        // Update dietasForms status so payroll page can detect it
        try {
          await setDoc(doc(db, `projects/${formDoc.projectId}/dietasForms`, formId), {
            status: "submitted", submittedAt: Timestamp.now(),
          }, { merge: true });
        } catch { /* ignore */ }
        setSubmittedData({ entries: dietasData });
        setSubmitted(true);
      } catch (e) { console.error(e); }
      finally { setDietasSubmitting(false); }
    };

    return (
      <div className="min-h-screen" style={{ backgroundColor: "#FAF8F5" }}>
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-100 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
            <FormLogo />
            {formDoc.projectName && (
              <span className="text-xs font-medium" style={{ color: L }}>{formDoc.projectName}</span>
            )}
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
          {/* Header card */}
          <div className="bg-white border border-stone-100 rounded-2xl p-5 shadow-sm">
            <p className="text-base font-bold" style={{ color: D }}>Informe de complementos</p>
            <p className="text-xs text-stone-500 mt-1">
              {formDoc.dateFrom} → {formDoc.dateTo} · enviado por <strong className="text-stone-700">{formDoc.createdByName}</strong>
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {allowTypes.map(t => (
                <span key={t} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: DIETA_COLORS[t] || "#94a3b8" }}>
                  {DIETA_LABELS[t] || t}
                </span>
              ))}
            </div>
          </div>

          {/* Per-person sections */}
          {people.map(person => {
            const mId = person.memberId;
            const personEntries = dietasData[mId] || {};
            const filledCount = allDates.filter(d => Object.values(personEntries[d]||{}).some(Boolean)).length;

            return (
              <div key={mId} className="bg-white border border-stone-100 rounded-2xl overflow-hidden shadow-sm">
                {/* Person header */}
                <div className="px-5 py-4 border-b border-stone-50 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold" style={{ color: D }}>{person.firstName} {person.lastName1}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{person.department}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-400">{filledCount}/{allDates.length} días</span>
                    <button
                      onClick={() => {
                        if (qfPerson === mId) { setQfPerson(null); return; }
                        setQfPerson(mId);
                        setQfFrom(formDoc.dateFrom || "");
                        setQfTo(formDoc.dateTo || "");
                        setQfTypes(Object.fromEntries(allowTypes.map(t => [t, false])));
                      }}
                      className="text-xs px-2.5 py-1 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
                      style={{ color: D }}>
                      {qfPerson === mId ? "Cerrar" : "Relleno rápido"}
                    </button>
                  </div>
                </div>

                {/* Quick fill widget */}
                {qfPerson === mId && (
                  <div className="px-5 py-4 bg-stone-50 border-b border-stone-100 space-y-3">
                    <p className="text-xs font-semibold text-stone-700">Aplicar patrón a un rango de fechas</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="date" value={qfFrom} min={formDoc.dateFrom} max={formDoc.dateTo}
                        onChange={e => setQfFrom(e.target.value)}
                        className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                      <span className="text-xs text-stone-400">→</span>
                      <input type="date" value={qfTo} min={qfFrom || formDoc.dateFrom} max={formDoc.dateTo}
                        onChange={e => setQfTo(e.target.value)}
                        className="border border-stone-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allowTypes.map(t => (
                        <label key={t} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border cursor-pointer text-xs transition-all ${qfTypes[t] ? "text-white border-transparent" : "border-stone-200 text-stone-600"}`}
                          style={qfTypes[t] ? { backgroundColor: DIETA_COLORS[t] || "#6366f1" } : {}}>
                          <input type="checkbox" checked={!!qfTypes[t]} onChange={() => setQfTypes(q => ({ ...q, [t]: !q[t] }))} className="sr-only" />
                          {DIETA_LABELS[t] || t}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => applyQuickFill(mId)}
                        className="flex-1 py-2 text-white text-xs font-semibold rounded-lg transition-opacity hover:opacity-90"
                        style={{ backgroundColor: D }}>
                        Aplicar
                      </button>
                      <button
                        onClick={() => {
                          setDietasData(prev => {
                            const pM = { ...(prev[mId] || {}) };
                            for (const d of allDates) pM[d] = {};
                            return { ...prev, [mId]: pM };
                          });
                        }}
                        className="px-4 py-2 text-stone-500 text-xs rounded-lg border border-stone-200 hover:bg-stone-50 transition-colors">
                        Limpiar todo
                      </button>
                    </div>
                  </div>
                )}

                {/* Day-by-day grid */}
                <div className="divide-y divide-stone-50">
                  {allDates.map(date => {
                    const entry = personEntries[date] || {};
                    const hasAny = Object.values(entry).some(Boolean);
                    return (
                      <div key={date} className={`flex items-center gap-3 px-5 py-2.5 ${isWeekend(date) ? "bg-stone-50" : ""}`}>
                        <div className={`w-16 flex-shrink-0 text-xs font-medium ${isWeekend(date) ? "text-stone-400" : "text-stone-700"}`}>
                          {fmtDate(date)}
                        </div>
                        <div className="flex flex-wrap gap-1.5 flex-1">
                          {allowTypes.map(t => (
                            <button key={t} onClick={() => toggleType(mId, date, t)}
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-all ${entry[t] ? "text-white border-transparent" : "border-stone-200 text-stone-400"}`}
                              style={entry[t] ? { backgroundColor: DIETA_COLORS[t] || "#6366f1" } : {}}>
                              {DIETA_LABELS[t] || t}
                            </button>
                          ))}
                        </div>
                        {hasAny && <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Submit */}
          <div className="bg-white border border-stone-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-stone-500">
                {totalFilledDays} día{totalFilledDays!==1?"s":""} con dietas marcadas sobre {people.length * allDates.length} posibles
              </p>
            </div>
            <button onClick={handleDietasSubmit} disabled={dietasSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: D }}>
              {dietasSubmitting
                ? <><Loader2 size={15} className="animate-spin" /> Enviando…</>
                : "Enviar informe de dietas"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── BOX REQUEST form ──────────────────────────────────────────────────────

  if (formDoc?.type === "box_request") {
    const total = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const canSubmit = expenses.length > 0 && expenses.every((e) => e.description.trim() && e.amount);

    return (
      <div className="min-h-screen" style={{ backgroundColor: "#FAF8F5" }}>
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-100 shadow-sm">
          <div className="max-w-xl mx-auto px-4 py-3 flex items-center justify-between">
            <FormLogo />
            {formDoc.projectName && (
              <span className="text-xs font-medium" style={{ color: L }}>{formDoc.projectName}</span>
            )}
          </div>
        </div>

        <div className="max-w-xl mx-auto px-4 py-8 space-y-5">
          {/* Welcome */}
          <div className="bg-white border border-stone-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(201,183,156,0.2)" }}>
                <User size={18} style={{ color: D }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: D }}>
                  Hola, {formDoc.prefilled.requesterName || ""}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">Solicitud de gastos de caja · {formDoc.projectName}</p>
                <p className="text-xs text-stone-400 mt-2 leading-relaxed">
                  <strong className="text-stone-600">{formDoc.createdByName}</strong> recibirá esta solicitud y te notificará la aprobación y la fecha de pago.
                </p>
                {formDoc.coordinatorMessage && (
                  <p className="text-sm text-stone-600 mt-2 italic border-l-2 pl-2" style={{ borderColor: L }}>
                    "{formDoc.coordinatorMessage}"
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Expenses */}
          <div className="bg-white border border-stone-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-stone-50 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold" style={{ color: D }}>Gastos</h2>
                <p className="text-xs text-stone-400 mt-0.5">Añade cada gasto con su justificante</p>
              </div>
              {expenses.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-stone-400">Total</p>
                  <p className="text-base font-bold" style={{ color: D }}>{total.toFixed(2)} €</p>
                </div>
              )}
            </div>

            <div className="p-5 space-y-3">
              {expenses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-stone-400">Aún no has añadido ningún gasto</p>
                </div>
              ) : (
                expenses.map((exp) => (
                  <ExpenseUploadRow
                    key={exp.localId}
                    expense={exp}
                    formId={formId}
                    onChange={updateExpense}
                    onRemove={removeExpense}
                  />
                ))
              )}
              <button type="button" onClick={addExpense}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm font-medium text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-all">
                <Plus size={15} /> Añadir gasto
              </button>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white border border-stone-100 rounded-2xl p-5 shadow-sm">
            <label className="block text-sm font-medium text-stone-700 mb-2">
              Notas adicionales <span className="text-stone-400 font-normal">(opcional)</span>
            </label>
            <textarea value={boxNotes} onChange={(e) => setBoxNotes(e.target.value)}
              placeholder="Cualquier detalle adicional sobre esta solicitud…"
              rows={2}
              className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none resize-none bg-white"
            />
          </div>

          {/* Submit */}
          <button onClick={handleBoxSubmit} disabled={!canSubmit || boxSubmitting}
            className="w-full py-4 rounded-2xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity shadow-sm"
            style={{ backgroundColor: D }}>
            {boxSubmitting
              ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Enviando…</span>
              : `Enviar solicitud · ${total.toFixed(2)} €`}
          </button>

          <p className="text-center text-xs" style={{ color: L }}>
            Formulario seguro · Filma Workspace Forms
          </p>
        </div>
      </div>
    );
  }

  // ── CREW ONBOARDING form ──────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FAF8F5" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-100 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <FormLogo />
            <span className="text-xs font-medium" style={{ color: L }}>{step + 1} / {CREW_STEPS.length}</span>
          </div>
          <div className="w-full bg-stone-100 rounded-full h-1">
            <div className="h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(((step + 1) / CREW_STEPS.length) * 100, 100)}%`, backgroundColor: D }} />
          </div>
          <div className="flex mt-2 overflow-x-auto">
            {CREW_STEPS.map((s, i) => (
              <div key={s} className="flex-shrink-0 text-xs px-2 py-0.5 rounded transition-all"
                style={{ color: i === step ? D : i < step ? L : "#c4bdb8", fontWeight: i === step ? 600 : 400 }}>
                {i < step ? "✓ " : ""}{s}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-8">
        {step === 0 && (
          <div className="bg-white border border-stone-100 rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(201,183,156,0.2)" }}>
                <User size={18} style={{ color: D }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: D }}>
                  Hola{formDoc?.prefilled.firstName ? `, ${formDoc.prefilled.firstName}` : ""}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  {formDoc?.prefilled.role && <><strong>{formDoc.prefilled.role}</strong> · </>}
                  {formDoc?.prefilled.department}
                </p>
                {formDoc?.coordinatorMessage && (
                  <p className="text-sm text-stone-600 mt-2 italic border-l-2 pl-2" style={{ borderColor: L }}>
                    "{formDoc.coordinatorMessage}"
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-50">
            <h2 className="text-base font-bold" style={{ color: D }}>{CREW_STEPS[step]}</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {["Información básica de identificación", "Datos de contacto y domicilio",
                "Número de Seguridad Social, IRPF y cuenta bancaria",
                "Adjunta los documentos requeridos", "Revisa y confirma que todo es correcto"][step]}
            </p>
          </div>

          <div className="p-5">
            {step === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Photo upload */}
                {fc.showPhoto && (<div className="col-span-2">
                  <label className="block text-sm font-medium text-stone-700 mb-2">Foto de perfil <span className="text-xs text-stone-400">(aparecerá en tu ficha)</span></label>
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-2xl overflow-hidden flex-shrink-0 border border-stone-200 bg-stone-50 flex items-center justify-center">
                      {crewData.photoUrl
                        ? <img src={crewData.photoUrl} alt="Foto" className="w-full h-full object-cover" />
                        : <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      }
                    </div>
                    <div className="flex-1">
                      <label className="cursor-pointer">
                        <input type="file" accept="image/*" className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const { ref: sRef, uploadBytesResumable, getDownloadURL } = await import("firebase/storage");
                            const { storage } = await import("@/lib/firebase");
                            const storageRef = sRef(storage, `forms/${formId}/photo/${file.name}`);
                            const task = uploadBytesResumable(storageRef, file);
                            task.on("state_changed", () => {}, console.error, async () => {
                              const url = await getDownloadURL(storageRef);
                              setCrewData((d) => ({ ...d, photoUrl: url }));
                            });
                          }}
                        />
                        <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors cursor-pointer"
                          style={{ borderColor: L, color: D, backgroundColor: "rgba(201,183,156,0.1)" }}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          {crewData.photoUrl ? "Cambiar foto" : "Subir foto"}
                        </span>
                      </label>
                      <p className="text-xs text-stone-400 mt-1.5">JPG, PNG o WEBP. Recomendado: fondo neutro.</p>
                    </div>
                  </div>
                </div>)}
                {crewField("Nombre", "firstName", { required: true, placeholder: "Tu nombre" })}
                {crewField("Primer apellido", "lastName1", { required: true, half: fc.showLastName2 })}
                {fc.showLastName2 && crewField("Segundo apellido", "lastName2", { half: true })}
                {fc.showArtisticName && crewField("Nombre artístico / en créditos", "artisticName", { placeholder: "Como aparecerás en los créditos" })}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-stone-700 mb-1.5">Tipo de documento <span className="text-red-400">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    {([["dni","DNI"],["nie","NIE"],["passport","Pasaporte"]] as const).map(([v,l]) => (
                      <button key={v} type="button" onClick={() => setCrewData((d) => ({ ...d, docType: v }))}
                        className="py-2.5 rounded-xl border text-sm font-medium transition-all"
                        style={{ borderColor: crewData.docType === v ? D : "#e7e5e4", backgroundColor: crewData.docType === v ? "rgba(52,42,33,0.05)" : "#fff", color: crewData.docType === v ? D : "#57534e" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {crewField("Número de documento", "docNumber", { required: true, half: fc.showDocExpiry, placeholder: "12345678A" })}
                {fc.showDocExpiry && crewField("Caducidad", "docExpiry", { type: "date", half: true })}
                {crewField("Fecha de nacimiento", "birthDate", { type: "date", required: true, half: fc.showBirthPlace })}
                {fc.showBirthPlace && crewField("Lugar de nacimiento", "birthPlace", { half: true, placeholder: "Ciudad" })}
                {fc.showNationality && crewField("Nacionalidad", "nationality", { placeholder: "Española" })}
              </div>
            )}
            {step === 1 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {crewField("Email", "email", { type: "email", required: true, readonly: !!formDoc?.prefilled.email, placeholder: "correo@ejemplo.com" })}
                {crewField("Teléfono", "phone", { type: "tel", required: true, placeholder: "+34 600 000 000" })}
                {crewField("Dirección", "address", { required: true, placeholder: "Calle Mayor, 10, 2º A" })}
                {crewField("Código postal", "postalCode", { required: true, half: true, placeholder: "28001" })}
                {crewField("Ciudad", "city", { required: true, half: true, placeholder: "Madrid" })}
                {fc.showProvince && crewField("Provincia", "province", { half: fc.showCountry, placeholder: "Madrid" })}
                {fc.showCountry && crewField("País", "country", { half: fc.showProvince, placeholder: "España" })}
              </div>
            )}
            {step === 2 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {crewField("Nº Seguridad Social", "ssNumber", { required: true, placeholder: "12/1234567/89" })}
                {crewSelect("Régimen de la SS", "ssRegime", SS_REGIMES, true)}
                {fc.showIrpfRate && crewField("% IRPF aplicable", "irpfRate", { half: fc.showContractReason, placeholder: "15" })}
                {fc.showContractReason && crewField("Causa del contrato", "contractReason", { half: fc.showIrpfRate, placeholder: "Obras y servicios" })}
                <div className="col-span-2 pt-3 border-t border-stone-100">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: L }}>Datos bancarios</p>
                </div>
                {crewField("IBAN", "iban", { required: true, placeholder: "ES00 0000 0000 0000 0000 0000" })}
                {fc.showBankName && crewField("Nombre del banco", "bankName", { half: fc.showAccountHolder, placeholder: "Banco Santander" })}
                {fc.showAccountHolder && crewField("Titular de la cuenta", "accountHolder", { half: fc.showBankName })}
              </div>
            )}
            {step === 3 && (
              <div className="space-y-5">
                {DOC_UPLOADS.map((d) => (
                  <FileUploadField key={d.key} docKey={d.key} label={d.label} required={d.required}
                    formId={formId} existing={crewData.docs[d.key]}
                    onUploaded={(key, file) =>
                      setCrewData((prev) => ({
                        ...prev,
                        docs: file
                          ? { ...prev.docs, [key]: file }
                          : Object.fromEntries(Object.entries(prev.docs).filter(([k]) => k !== key)),
                      }))
                    }
                  />
                ))}
                {crewErrors.docs && <p className="text-sm text-red-500 flex items-center gap-1.5"><AlertCircle size={13} /> {crewErrors.docs as unknown as string}</p>}
              </div>
            )}
            {step === 4 && (
              <div className="space-y-5">
                <ReviewSection title="Datos personales" items={[
                  ["Nombre completo", `${crewData.firstName} ${crewData.lastName1}${crewData.lastName2 ? " " + crewData.lastName2 : ""}`],
                  crewData.artisticName ? ["Nombre en créditos", crewData.artisticName] : null,
                  ["Documento", `${crewData.docType.toUpperCase()} ${crewData.docNumber}`],
                  ["Nacimiento", crewData.birthDate], ["Nacionalidad", crewData.nationality],
                ]} />
                <ReviewSection title="Contacto" items={[
                  ["Email", crewData.email], ["Teléfono", crewData.phone],
                  ["Dirección", `${crewData.address}, ${crewData.postalCode} ${crewData.city}`],
                ]} />
                <ReviewSection title="Fiscal y bancario" items={[
                  ["Nº SS", crewData.ssNumber], ["Régimen", crewData.ssRegime],
                  crewData.irpfRate ? ["IRPF", `${crewData.irpfRate}%`] : null,
                  ["IBAN", crewData.iban], crewData.bankName ? ["Banco", crewData.bankName] : null,
                ]} />
                <ReviewSection title="Documentos" items={DOC_UPLOADS.map((d) => [d.label, crewData.docs[d.key] ? "✓ Adjuntado" : "No adjuntado"])} />
                <div className={`p-4 rounded-xl border ${crewErrors.privacyAccepted ? "border-red-200 bg-red-50" : "border-stone-200 bg-stone-50"}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <div onClick={() => { setCrewData((d) => ({ ...d, privacyAccepted: !d.privacyAccepted })); setCrewErrors((e) => ({ ...e, privacyAccepted: undefined })); }}
                      className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 cursor-pointer"
                      style={{ borderColor: crewData.privacyAccepted ? D : "#d6d3d1", backgroundColor: crewData.privacyAccepted ? D : "#fff" }}>
                      {crewData.privacyAccepted && <Check size={11} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-sm text-stone-600 leading-snug">
                      Confirmo que los datos proporcionados son correctos y consiento su tratamiento conforme a la LOPD y el RGPD.
                    </span>
                  </label>
                  {crewErrors.privacyAccepted && <p className="text-xs text-red-500 mt-2 ml-8">{crewErrors.privacyAccepted as unknown as string}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          {step > 0 && (
            <button onClick={prevStep}
              className="flex items-center gap-2 px-5 py-3 border border-stone-200 text-stone-700 rounded-xl text-sm font-medium hover:bg-white transition-colors">
              <ArrowLeft size={15} /> Anterior
            </button>
          )}
          <div className="flex-1" />
          {step < CREW_STEPS.length - 1 ? (
            <button onClick={nextStep}
              className="flex items-center gap-2 px-6 py-3 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: D }}>
              Siguiente <ArrowRight size={15} />
            </button>
          ) : (
            <button onClick={handleCrewSubmit} disabled={submitting}
              className="flex items-center gap-2 px-6 py-3 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: D }}>
              {submitting ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <><Check size={15} /> Enviar ficha</>}
            </button>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: L }}>Formulario seguro · Filma Workspace Forms</p>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReviewSection({ title, items }: { title: string; items: (string[] | null)[] }) {
  const filtered = items.filter(Boolean) as string[][];
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: L }}>{title}</p>
      <div className="bg-stone-50 rounded-xl border border-stone-100 divide-y divide-stone-100">
        {filtered.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between px-4 py-3 gap-3">
            <span className="text-xs text-stone-400 flex-shrink-0">{label}</span>
            <span className={`text-sm font-medium text-right ${value?.startsWith("✓") ? "text-emerald-600" : value === "No adjuntado" ? "text-stone-300" : "text-stone-800"}`}>
              {value || "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoScreen({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#FAF8F5" }}>
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl" style={{ backgroundColor: "rgba(52,42,33,0.07)" }}>{icon}</div>
        <h1 className="text-xl font-bold mb-2" style={{ color: D }}>{title}</h1>
        <p className="text-sm text-stone-500">{message}</p>
        <div className="mt-10"><FormLogo /></div>
      </div>
    </div>
  );
}

function SuccessScreen({ formDoc, responseData, formId }: { formDoc: FormDoc; responseData: any; formId: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadResguardo(formDoc, responseData, formId); }
    finally { setDownloading(false); }
  };

  const isBox = formDoc.type === "box_request";
  const isDietas = formDoc.type === "dietas_request";
  const total = isBox ? (responseData?.expenses || []).reduce((s: number, e: any) => s + (Number(e.amount) || 0), 0) : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#FAF8F5" }}>
      <div className="text-center max-w-sm w-full">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6" style={{ backgroundColor: "rgba(52,42,33,0.07)" }}>
          <CheckCircle2 size={38} style={{ color: D }} />
        </div>
        <h1 className="text-2xl font-bold mb-3" style={{ color: D }}>
          {isBox ? "¡Solicitud enviada!" : isDietas ? "¡Informe enviado!" : "¡Ficha enviada!"}
        </h1>
        <p className="text-stone-500 text-sm leading-relaxed">
          {isBox
            ? <><strong className="text-stone-700">{formDoc.createdByName}</strong> recibirá tu solicitud de <strong className="text-stone-700">{total?.toFixed(2)} €</strong> y te notificará la aprobación y la fecha de pago.</>
            : isDietas
            ? <><strong className="text-stone-700">{formDoc.createdByName}</strong> recibirá el informe de dietas y lo importará en el sistema de nóminas.</>
            : <>Tu ficha para <strong className="text-stone-700">{formDoc.projectName}</strong>{formDoc.prefilled.role && <> como <strong className="text-stone-700">{formDoc.prefilled.role}</strong></>} ha sido recibida correctamente.</>
          }
        </p>

        {/* Download resguardo (not for dietas) */}
        {!isDietas && (
          <div className="mt-6 bg-white border border-stone-200 rounded-2xl p-5">
            <p className="text-sm font-semibold mb-1" style={{ color: D }}>Descarga tu resguardo</p>
            <p className="text-xs text-stone-400 mb-4">Guarda este documento como confirmación del envío</p>
            <button onClick={handleDownload} disabled={downloading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: D }}>
              {downloading
                ? <><Loader2 size={15} className="animate-spin" /> Generando PDF…</>
                : <>⬇ Descargar resguardo PDF</>}
            </button>
          </div>
        )}

        <div className="mt-6 p-3 bg-white rounded-xl border border-stone-100">
          <p className="text-xs text-stone-400">Puedes cerrar esta ventana con seguridad.</p>
        </div>
        <div className="mt-8"><FormLogo /></div>
      </div>
    </div>
  );
}
