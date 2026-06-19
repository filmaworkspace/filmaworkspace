"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Upload,
  User,
  X,
} from "lucide-react";
import Image from "next/image";

// ─── Brand ───────────────────────────────────────────────────────────────────

const D = "#342A21"; // dark
const L = "#C9B79C"; // light

function FormLogo() {
  return (
    <Image src="/logo-forms.svg" alt="Forms" width={88} height={28} priority />
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormDoc {
  type: "crew_onboarding";
  pin: string;
  status: "pending" | "submitted";
  projectId: string;
  projectName: string;
  crewMemberId?: string;
  createdByName: string;
  coordinatorMessage?: string;
  expiresAt?: Timestamp;
  prefilled: {
    firstName?: string;
    lastName1?: string;
    lastName2?: string;
    artisticName?: string;
    email?: string;
    phone?: string;
    role?: string;
    department?: string;
    section?: string;
  };
}

interface UploadedFile { name: string; url: string; size: number; }

interface FormResponse {
  firstName: string; lastName1: string; lastName2: string; artisticName: string;
  birthDate: string; birthPlace: string; nationality: string;
  docType: "dni" | "nie" | "passport"; docNumber: string; docExpiry: string;
  email: string; phone: string;
  address: string; postalCode: string; city: string; province: string; country: string;
  ssNumber: string; ssRegime: string; irpfRate: string; contractReason: string;
  iban: string; bankName: string; accountHolder: string;
  docs: Record<string, UploadedFile>;
  privacyAccepted: boolean;
}

const EMPTY: FormResponse = {
  firstName: "", lastName1: "", lastName2: "", artisticName: "",
  birthDate: "", birthPlace: "", nationality: "Española",
  docType: "dni", docNumber: "", docExpiry: "",
  email: "", phone: "",
  address: "", postalCode: "", city: "", province: "", country: "España",
  ssNumber: "", ssRegime: "", irpfRate: "", contractReason: "",
  iban: "", bankName: "", accountHolder: "",
  docs: {}, privacyAccepted: false,
};

const SS_REGIMES = [
  "Régimen General", "Régimen Especial Artistas",
  "Autónomo (RETA)", "Trabajador/a Extranjero/a",
];

const DOC_UPLOADS = [
  { key: "id_front",  label: "DNI / NIE — Anverso",              required: true  },
  { key: "id_back",   label: "DNI / NIE — Reverso",              required: true  },
  { key: "bank_cert", label: "Certificado de cuenta bancaria",    required: false },
  { key: "cv",        label: "Curriculum Vitae",                  required: false },
];

const STEPS = ["Datos personales", "Contacto", "Fiscal y bancario", "Documentos", "Revisión"];

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
    task.on(
      "state_changed",
      (snap) => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => { setError("Error al subir el archivo"); setProgress(null); },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        onUploaded(docKey, { name: file.name, url, size: file.size });
        setProgress(null);
      }
    );
  };

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {existing ? (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          <span className="text-sm text-emerald-800 flex-1 truncate">{existing.name}</span>
          <button type="button" onClick={() => onUploaded(docKey, null)} className="p-1 text-emerald-600 hover:text-red-500 transition-colors">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className="border-2 border-dashed border-stone-200 rounded-xl p-6 text-center cursor-pointer transition-all hover:border-stone-400 hover:bg-stone-50"
        >
          {progress !== null ? (
            <div className="space-y-2">
              <Loader2 size={20} className="animate-spin mx-auto" style={{ color: D }} />
              <div className="w-full bg-stone-100 rounded-full h-1.5 mx-auto max-w-[160px]">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: D }} />
              </div>
              <p className="text-xs text-stone-400">{progress}%</p>
            </div>
          ) : (
            <>
              <Upload size={20} className="text-stone-300 mx-auto mb-2" />
              <p className="text-sm text-stone-500">Arrastra o <span className="font-medium" style={{ color: D }}>selecciona</span></p>
              <p className="text-xs text-stone-400 mt-1">PDF, JPG, PNG · máx. 10 MB</p>
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function FormPage() {
  const params = useParams();
  const formId = params?.formId as string;

  const [loading,     setLoading]     = useState(true);
  const [formDoc,     setFormDoc]     = useState<FormDoc | null>(null);
  const [notFound,    setNotFound]    = useState(false);
  const [expired,     setExpired]     = useState(false);
  const [alreadySent, setAlreadySent] = useState(false);

  const [pinDigits, setPinDigits] = useState(["", "", "", ""]);
  const [pinError,  setPinError]  = useState("");
  const [pinOk,     setPinOk]     = useState(false);
  const [showPin,   setShowPin]   = useState(false);
  const pinRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  const [step,       setStep]       = useState(0);
  const [data,       setData]       = useState<FormResponse>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [errors,     setErrors]     = useState<Partial<Record<keyof FormResponse, string>>>({});

  // ── Load ────────────────────────────────────────────────────────────────────

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
        setData((prev) => ({
          ...prev,
          firstName:    d.prefilled.firstName    || "",
          lastName1:    d.prefilled.lastName1    || "",
          lastName2:    d.prefilled.lastName2    || "",
          artisticName: d.prefilled.artisticName || "",
          email:        d.prefilled.email        || "",
          phone:        d.prefilled.phone        || "",
        }));
      } catch (e) { console.error(e); setNotFound(true); }
      finally { setLoading(false); }
    })();
  }, [formId]);

  // ── PIN ─────────────────────────────────────────────────────────────────────

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

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateStep = useCallback((): boolean => {
    const e: typeof errors = {};
    if (step === 0) {
      if (!data.firstName.trim()) e.firstName = "Obligatorio";
      if (!data.lastName1.trim()) e.lastName1 = "Obligatorio";
      if (!data.birthDate)        e.birthDate = "Obligatorio";
      if (!data.docNumber.trim()) e.docNumber = "Obligatorio";
    } else if (step === 1) {
      if (!data.email.trim())      e.email      = "Obligatorio";
      if (!data.phone.trim())      e.phone      = "Obligatorio";
      if (!data.address.trim())    e.address    = "Obligatorio";
      if (!data.postalCode.trim()) e.postalCode = "Obligatorio";
      if (!data.city.trim())       e.city       = "Obligatorio";
    } else if (step === 2) {
      if (!data.ssNumber.trim()) e.ssNumber = "Obligatorio";
      if (!data.ssRegime)        e.ssRegime = "Obligatorio";
      if (!data.iban.trim())     e.iban     = "Obligatorio";
    } else if (step === 3) {
      const missing = DOC_UPLOADS.filter((d) => d.required && !data.docs[d.key]);
      if (missing.length > 0) e.docs = "Sube los documentos obligatorios (*)" as any;
    } else if (step === 4) {
      if (!data.privacyAccepted) e.privacyAccepted = "Debes aceptar la política de privacidad" as any;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [step, data]);

  const nextStep = () => { if (validateStep()) setStep((s) => s + 1); };
  const prevStep = () => { setErrors({}); setStep((s) => s - 1); };

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      await updateDoc(doc(db, "forms", formId), {
        status: "submitted",
        submittedAt: Timestamp.now(),
        responseData: {
          ...data,
          docs: Object.fromEntries(Object.entries(data.docs).map(([k, v]) => [k, v.url])),
        },
      });
      setSubmitted(true);
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  // ── Field helpers ────────────────────────────────────────────────────────────

  const field = (label: string, key: keyof FormResponse, opts?: {
    type?: string; placeholder?: string; required?: boolean; readonly?: boolean; half?: boolean;
  }) => {
    const { type = "text", placeholder = "", required = false, readonly = false } = opts || {};
    const err = errors[key];
    return (
      <div className={opts?.half ? "col-span-1" : "col-span-2"}>
        <label className="block text-sm font-medium text-stone-700 mb-1.5">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        <input
          type={type}
          value={data[key] as string}
          readOnly={readonly}
          placeholder={placeholder}
          onChange={(e) => { if (!readonly) { setData((d) => ({ ...d, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); } }}
          className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all ${
            readonly ? "bg-stone-50 text-stone-400 cursor-not-allowed border-stone-100" :
            err ? "border-red-300 focus:ring-red-200 bg-red-50" :
            "border-stone-200 bg-white text-stone-900"
          }`}
          style={!readonly && !err ? { outlineColor: D } : {}}
          onFocus={(e) => { if (!readonly && !err) e.target.style.borderColor = L; }}
          onBlur={(e)  => { if (!readonly && !err) e.target.style.borderColor = ""; }}
        />
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  const selectField = (label: string, key: keyof FormResponse, options: string[], required = false) => {
    const err = errors[key];
    return (
      <div className="col-span-2">
        <label className="block text-sm font-medium text-stone-700 mb-1.5">
          {label} {required && <span className="text-red-400">*</span>}
        </label>
        <select
          value={data[key] as string}
          onChange={(e) => { setData((d) => ({ ...d, [key]: e.target.value })); setErrors((er) => ({ ...er, [key]: undefined })); }}
          className={`w-full px-4 py-3 border rounded-xl text-sm focus:outline-none transition-all bg-white ${
            err ? "border-red-300" : "border-stone-200 text-stone-900"
          }`}
        >
          <option value="">Seleccionar…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // STATES
  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <Loader2 size={28} className="animate-spin" style={{ color: D }} />
    </div>
  );

  if (notFound)    return <InfoScreen icon="?" title="Formulario no encontrado" message="El enlace no es válido o ha sido eliminado." />;
  if (expired)     return <InfoScreen icon="⏱" title="Formulario caducado"     message="Este formulario ya no está disponible. Contacta con el equipo de coordinación." />;
  if (alreadySent) return <InfoScreen icon="✓" title="Ficha ya enviada"        message="Esta ficha ya fue completada. Gracias." success />;
  if (submitted)   return <SuccessScreen projectName={formDoc?.projectName || ""} role={formDoc?.prefilled.role || ""} />;

  // ── PIN ──────────────────────────────────────────────────────────────────────

  if (!pinOk) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#FAF8F5" }}>
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">

          {/* Logo */}
          <div className="mb-10 text-center space-y-2">
            <FormLogo />
            {formDoc?.projectName && (
              <p className="text-xs font-medium tracking-wide" style={{ color: L }}>{formDoc.projectName.toUpperCase()}</p>
            )}
          </div>

          {/* Card */}
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-stone-100 p-8">
            <div className="text-center mb-8">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: "rgba(52,42,33,0.07)" }}>
                <Lock size={18} style={{ color: D }} />
              </div>
              <h1 className="text-lg font-bold mb-1" style={{ color: D }}>Código de acceso</h1>
              <p className="text-sm text-stone-500">
                {formDoc?.createdByName
                  ? <>Introduce el código que te ha enviado <strong className="text-stone-700">{formDoc.createdByName}</strong></>
                  : "Introduce el código de 4 dígitos"}
              </p>
            </div>

            {/* PIN inputs */}
            <div className="flex gap-3 justify-center mb-5">
              {pinDigits.map((d, i) => (
                <input
                  key={i}
                  ref={pinRefs[i]}
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
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

            <button
              onClick={verifyPin}
              disabled={pinDigits.join("").length < 4}
              className="w-full py-3.5 rounded-xl text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: D }}
            >
              Acceder
            </button>
          </div>

          <p className="text-xs text-stone-400 mt-8 text-center max-w-xs">
            Este formulario es personal e intransferible. El código de acceso te lo ha proporcionado el equipo de coordinación.
          </p>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#FAF8F5" }}>

      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-100 shadow-sm">
        <div className="max-w-xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <FormLogo />
            <span className="text-xs font-medium" style={{ color: L }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-stone-100 rounded-full h-1">
            <div
              className="h-1 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(((step + 1) / STEPS.length) * 100, 100)}%`, backgroundColor: D }}
            />
          </div>

          {/* Step labels */}
          <div className="flex mt-2 overflow-x-auto">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-shrink-0 text-xs px-2 py-0.5 rounded transition-all"
                style={{ color: i === step ? D : i < step ? L : "#c4bdb8", fontWeight: i === step ? 600 : 400 }}>
                {i < step ? "✓ " : ""}{s}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-xl mx-auto px-4 py-8">

        {/* Welcome banner on step 0 */}
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
                  {formDoc?.prefilled.department || formDoc?.prefilled.section}
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

        {/* Step card */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-50">
            <h2 className="text-base font-bold" style={{ color: D }}>{STEPS[step]}</h2>
            <p className="text-xs text-stone-400 mt-0.5">
              {["Información básica de identificación", "Datos de contacto y domicilio",
                "Número de Seguridad Social, IRPF y cuenta bancaria",
                "Adjunta los documentos requeridos", "Revisa y confirma que todo es correcto"][step]}
            </p>
          </div>

          <div className="p-5">

            {/* STEP 0: Personales */}
            {step === 0 && (
              <div className="grid grid-cols-2 gap-4">
                {field("Nombre", "firstName", { required: true, placeholder: "Tu nombre" })}
                {field("Primer apellido", "lastName1", { required: true, half: true, placeholder: "Primer apellido" })}
                {field("Segundo apellido", "lastName2", { half: true, placeholder: "Segundo apellido" })}
                {field("Nombre artístico / en créditos", "artisticName", { placeholder: "Como aparecerás en los créditos" })}

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-stone-700 mb-1.5">
                    Tipo de documento <span className="text-red-400">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([["dni", "DNI"], ["nie", "NIE"], ["passport", "Pasaporte"]] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setData((d) => ({ ...d, docType: v }))}
                        className="py-2.5 rounded-xl border text-sm font-medium transition-all"
                        style={{
                          borderColor: data.docType === v ? D : "#e7e5e4",
                          backgroundColor: data.docType === v ? "rgba(52,42,33,0.05)" : "#fff",
                          color: data.docType === v ? D : "#57534e",
                        }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {field("Número de documento", "docNumber", { required: true, half: true, placeholder: "12345678A" })}
                {field("Caducidad", "docExpiry", { type: "date", half: true })}
                {field("Fecha de nacimiento", "birthDate", { type: "date", required: true, half: true })}
                {field("Lugar de nacimiento", "birthPlace", { half: true, placeholder: "Ciudad" })}
                {field("Nacionalidad", "nationality", { placeholder: "Española" })}
              </div>
            )}

            {/* STEP 1: Contacto */}
            {step === 1 && (
              <div className="grid grid-cols-2 gap-4">
                {field("Email", "email", { type: "email", required: true, readonly: !!formDoc?.prefilled.email, placeholder: "correo@ejemplo.com" })}
                {field("Teléfono", "phone", { type: "tel", required: true, placeholder: "+34 600 000 000" })}
                {field("Dirección (calle y número)", "address", { required: true, placeholder: "Calle Mayor, 10, 2º A" })}
                {field("Código postal", "postalCode", { required: true, half: true, placeholder: "28001" })}
                {field("Ciudad", "city", { required: true, half: true, placeholder: "Madrid" })}
                {field("Provincia", "province", { half: true, placeholder: "Madrid" })}
                {field("País", "country", { half: true, placeholder: "España" })}
              </div>
            )}

            {/* STEP 2: Fiscal y bancario */}
            {step === 2 && (
              <div className="grid grid-cols-2 gap-4">
                {field("Nº Seguridad Social", "ssNumber", { required: true, placeholder: "12/1234567/89" })}
                {selectField("Régimen de la SS", "ssRegime", SS_REGIMES, true)}
                {field("% IRPF aplicable", "irpfRate", { half: true, placeholder: "15" })}
                {field("Causa del contrato", "contractReason", { half: true, placeholder: "Obras y servicios" })}
                <div className="col-span-2 pt-3 border-t border-stone-100">
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: L }}>Datos bancarios</p>
                </div>
                {field("IBAN", "iban", { required: true, placeholder: "ES00 0000 0000 0000 0000 0000" })}
                {field("Nombre del banco", "bankName", { half: true, placeholder: "Banco Santander" })}
                {field("Titular de la cuenta", "accountHolder", { half: true, placeholder: "Nombre y apellidos" })}
              </div>
            )}

            {/* STEP 3: Documentos */}
            {step === 3 && (
              <div className="space-y-5">
                {DOC_UPLOADS.map((d) => (
                  <FileUploadField key={d.key} docKey={d.key} label={d.label} required={d.required}
                    formId={formId} existing={data.docs[d.key]}
                    onUploaded={(key, file) =>
                      setData((prev) => ({
                        ...prev,
                        docs: file
                          ? { ...prev.docs, [key]: file }
                          : Object.fromEntries(Object.entries(prev.docs).filter(([k]) => k !== key)),
                      }))
                    }
                  />
                ))}
                {errors.docs && (
                  <p className="text-sm text-red-500 flex items-center gap-1.5">
                    <AlertCircle size={13} /> {errors.docs as unknown as string}
                  </p>
                )}
              </div>
            )}

            {/* STEP 4: Revisión */}
            {step === 4 && (
              <div className="space-y-5">
                <ReviewSection title="Datos personales" items={[
                  ["Nombre completo", `${data.firstName} ${data.lastName1}${data.lastName2 ? " " + data.lastName2 : ""}`],
                  data.artisticName ? ["Nombre en créditos", data.artisticName] : null,
                  ["Documento", `${data.docType.toUpperCase()} ${data.docNumber}`],
                  ["Nacimiento", data.birthDate],
                  ["Nacionalidad", data.nationality],
                ]} />
                <ReviewSection title="Contacto" items={[
                  ["Email", data.email],
                  ["Teléfono", data.phone],
                  ["Dirección", `${data.address}, ${data.postalCode} ${data.city}`],
                ]} />
                <ReviewSection title="Fiscal y bancario" items={[
                  ["Nº SS", data.ssNumber],
                  ["Régimen", data.ssRegime],
                  data.irpfRate ? ["IRPF", `${data.irpfRate}%`] : null,
                  ["IBAN", data.iban],
                  data.bankName ? ["Banco", data.bankName] : null,
                ]} />
                <ReviewSection title="Documentos" items={
                  DOC_UPLOADS.map((d) => [d.label, data.docs[d.key] ? "✓ Adjuntado" : "No adjuntado"])
                } />

                {/* Privacy */}
                <div className={`p-4 rounded-xl border transition-all ${errors.privacyAccepted ? "border-red-200 bg-red-50" : "border-stone-200 bg-stone-50"}`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <div
                      onClick={() => { setData((d) => ({ ...d, privacyAccepted: !d.privacyAccepted })); setErrors((e) => ({ ...e, privacyAccepted: undefined })); }}
                      className="mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
                      style={{
                        borderColor: data.privacyAccepted ? D : "#d6d3d1",
                        backgroundColor: data.privacyAccepted ? D : "#fff",
                      }}
                    >
                      {data.privacyAccepted && <Check size={11} className="text-white" strokeWidth={3} />}
                    </div>
                    <span className="text-sm text-stone-600 leading-snug">
                      Confirmo que los datos proporcionados son correctos y consiento su tratamiento para los fines de la producción, conforme a la LOPD y el RGPD.
                    </span>
                  </label>
                  {errors.privacyAccepted && (
                    <p className="text-xs text-red-500 mt-2 ml-8">{errors.privacyAccepted as unknown as string}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-5">
          {step > 0 && (
            <button onClick={prevStep}
              className="flex items-center gap-2 px-5 py-3 border border-stone-200 text-stone-700 rounded-xl text-sm font-medium hover:bg-white transition-colors">
              <ArrowLeft size={15} /> Anterior
            </button>
          )}
          <div className="flex-1" />
          {step < STEPS.length - 1 ? (
            <button onClick={nextStep}
              className="flex items-center gap-2 px-6 py-3 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ backgroundColor: D }}>
              Siguiente <ArrowRight size={15} />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-6 py-3 text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: D }}>
              {submitting ? <><Loader2 size={15} className="animate-spin" /> Enviando…</> : <><Check size={15} /> Enviar ficha</>}
            </button>
          )}
        </div>

        <p className="text-center text-xs mt-6" style={{ color: L }}>
          Formulario seguro · FilmaWorkspace Forms
        </p>
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

function InfoScreen({ icon, title, message, success }: { icon: string; title: string; message: string; success?: boolean }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#FAF8F5" }}>
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 text-2xl"
          style={{ backgroundColor: success ? "rgba(52,42,33,0.07)" : "#f5f5f4" }}>
          {icon}
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: D }}>{title}</h1>
        <p className="text-sm text-stone-500">{message}</p>
        <div className="mt-10">
          <FormLogo />
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ projectName, role }: { projectName: string; role: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#FAF8F5" }}>
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{ backgroundColor: "rgba(52,42,33,0.07)" }}>
          <CheckCircle2 size={38} style={{ color: D }} />
        </div>
        <h1 className="text-2xl font-bold mb-3" style={{ color: D }}>¡Ficha enviada!</h1>
        <p className="text-stone-500 text-sm leading-relaxed">
          Tu ficha para <strong className="text-stone-700">{projectName || "la producción"}</strong>
          {role && <> como <strong className="text-stone-700">{role}</strong></>} ha sido recibida correctamente.
          El equipo de coordinación revisará tus datos en breve.
        </p>
        <div className="mt-6 p-4 bg-white rounded-xl border border-stone-100">
          <p className="text-xs text-stone-400">Puedes cerrar esta ventana con seguridad.</p>
        </div>
        <div className="mt-10">
          <FormLogo />
        </div>
      </div>
    </div>
  );
}
