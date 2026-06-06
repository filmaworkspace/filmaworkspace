"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db, storage } from "@/lib/firebase";
import { doc, getDoc, updateDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ClipboardCopy,
  FileText,
  Link as LinkIcon,
  Mail,
  MailCheck,
  Pencil,
  Phone,
  RefreshCw,
  Save,
  Send,
  Upload,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const CREW_SECTIONS = {
  technical:   { label: "Equipo técnico", textColor: "text-sky-700",    bgColor: "bg-sky-50",    borderColor: "border-sky-200"    },
  cast:        { label: "Cast",           textColor: "text-violet-700", bgColor: "bg-violet-50", borderColor: "border-violet-200" },
  specialists: { label: "Especialistas",  textColor: "text-amber-700",  bgColor: "bg-amber-50",  borderColor: "border-amber-200"  },
} as const;

type CrewSection = keyof typeof CREW_SECTIONS;

const STATUS_MAP = {
  active:   { label: "Activo",    bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  inactive: { label: "Inactivo",  bg: "bg-slate-100",  text: "text-slate-500",  dot: "bg-slate-400"   },
  pending:  { label: "Pendiente", bg: "bg-amber-50",   text: "text-amber-700",  dot: "bg-amber-500"   },
};

// Documentos requeridos — en orden de aparición
const REQUIRED_DOCS = [
  { key: "photoAccreditation", label: "Foto acreditación",              accept: "image/*" },
  { key: "dniFront",           label: "DNI anverso",                    accept: "image/*,application/pdf" },
  { key: "dniBack",            label: "DNI reverso",                    accept: "image/*,application/pdf" },
  { key: "drivingFront",       label: "Carné de conducir anverso",      accept: "image/*,application/pdf" },
  { key: "drivingBack",        label: "Carné de conducir reverso",      accept: "image/*,application/pdf" },
  { key: "bankCertificate",    label: "Certificado titularidad bancaria", accept: "image/*,application/pdf" },
] as const;

type DocKey = typeof REQUIRED_DOCS[number]["key"];

// ─── Types ───────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  crewNumber?: string;
  section: CrewSection;
  firstName?: string;
  lastName1?: string;
  lastName2?: string;
  name: string;           // legacy / display
  artisticName?: string;
  role: string;
  department: string;
  company?: string;
  status: "active" | "inactive" | "pending";
  photoUrl?: string;
  // Contacto
  phone?: string;
  email?: string;
  address?: string;
  municipality?: string;
  postalCode?: string;
  // Personales
  dni?: string;
  socialSecurityNumber?: string;
  birthDate?: string;
  birthPlace?: string;
  nationality?: string;
  // Contrato
  contractReason?: string;
  startDate?: string;
  endDateApprox?: string;
  // Remuneración — técnicos
  salaryType?: "weekly" | "monthly";
  salaryAmount?: number;
  // Remuneración — cast & especialistas
  character?: string;
  sessions?: number;
  salaryPerSession?: number;
  // Datos fiscales (ficha)
  grossSalary?: number;
  irpfRate?: number;
  regime?: string;
  bankAccount?: string;
  // Documentos
  documents?: Partial<Record<DocKey, string>>; // URLs
  // Misc
  notes?: string;
  formSentAt?: Date;
  formSentBy?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtCurrency = (n?: number) =>
  n !== undefined ? new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(n) + " €" : "—";

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({
  label, value, editing, type = "text", placeholder, onChange, span = 1, sensitive = false,
}: {
  label: string; value?: string | number; editing: boolean; type?: string;
  placeholder?: string; onChange?: (v: string) => void; span?: number; sensitive?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const display = value !== undefined && value !== "" && value !== null;
  const masked = sensitive && !revealed && display
    ? "•".repeat(Math.min(String(value).length, 16)) : undefined;

  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      {editing ? (
        <input type={type} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white" />
      ) : (
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium ${display ? "text-slate-900" : "text-slate-300"}`}>
            {display ? (sensitive && !revealed ? masked : String(value)) : "—"}
          </p>
          {sensitive && display && (
            <button onClick={() => setRevealed(!revealed)} className="text-[10px] text-slate-400 hover:text-slate-600 underline">
              {revealed ? "ocultar" : "ver"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

function SectionCard({
  title, editing, onEdit, children, action,
}: {
  title: string; editing: boolean; onEdit?: () => void; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{title}</p>
        <div className="flex items-center gap-2">
          {action}
          {onEdit && !editing && (
            <button onClick={onEdit} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors">
              <Pencil size={11} />Editar
            </button>
          )}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── EditActions ─────────────────────────────────────────────────────────────

function EditActions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={onCancel} className="px-3 py-2 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-white transition-colors">
        Cancelar
      </button>
      <button onClick={onSave} disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: "#6BA319" }}>
        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CrewMemberPage() {
  const params    = useParams();
  const router    = useRouter();
  const projectId = params?.id as string;
  const memberId  = params?.memberId as string;

  const { user, isLoading: userLoading } = useUser();

  const [member, setMember]               = useState<CrewMember | null>(null);
  const [loading, setLoading]             = useState(true);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draft, setDraft]                 = useState<Partial<CrewMember>>({});
  const [saving, setSaving]               = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDoc, setUploadingDoc]   = useState<DocKey | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [sendingForm, setSendingForm]     = useState(false);
  const [formSent, setFormSent]           = useState(false);
  const [linkCopied, setLinkCopied]       = useState(false);
  const [statusOpen, setStatusOpen]       = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef   = useRef<HTMLInputElement>(null);
  const pendingDocKey = useRef<DocKey | null>(null);
  const statusRef     = useRef<HTMLDivElement>(null);

  const userId   = user?.uid  || "";
  const userName = user?.name || "Usuario";

  // Form URL — enlace que se envía al miembro para que rellene su ficha
  const formUrl = typeof window !== "undefined"
    ? `${window.location.origin}/form/crew/${projectId}/${memberId}`
    : "";

  useEffect(() => { if (userId && projectId && memberId) loadMember(); }, [userId, projectId, memberId]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const loadMember = async () => {
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, `projects/${projectId}/crew`, memberId));
      if (!snap.exists()) { router.push(`/project/${projectId}/team/crew`); return; }
      const d = snap.data();
      const firstName = d.firstName || "";
      const lastName1 = d.lastName1 || "";
      const lastName2 = d.lastName2 || "";
      const displayName = [firstName, lastName1, lastName2].filter(Boolean).join(" ") || d.name || "";
      setMember({
        id: snap.id,
        crewNumber:           d.crewNumber           || "",
        section:              d.section              || "technical",
        firstName,
        lastName1,
        lastName2,
        name:                 displayName,
        artisticName:         d.artisticName         || "",
        role:                 d.role                 || "",
        department:           d.department           || "",
        company:              d.company              || "",
        status:               d.status               || "active",
        photoUrl:             d.photoUrl             || "",
        phone:                d.phone                || "",
        email:                d.email                || "",
        address:              d.address              || "",
        municipality:         d.municipality         || "",
        postalCode:           d.postalCode           || "",
        dni:                  d.dni                  || "",
        socialSecurityNumber: d.socialSecurityNumber || "",
        birthDate:            d.birthDate            || "",
        birthPlace:           d.birthPlace           || "",
        nationality:          d.nationality          || "",
        contractReason:       d.contractReason       || "",
        startDate:            d.startDate            || "",
        endDateApprox:        d.endDateApprox        || "",
        salaryType:           d.salaryType           || "monthly",
        salaryAmount:         d.salaryAmount,
        character:            d.character            || "",
        sessions:             d.sessions,
        salaryPerSession:     d.salaryPerSession,
        grossSalary:          d.grossSalary,
        irpfRate:             d.irpfRate,
        regime:               d.regime               || "",
        bankAccount:          d.bankAccount          || "",
        documents:            d.documents            || {},
        notes:                d.notes                || "",
        formSentAt:           d.formSentAt?.toDate(),
        formSentBy:           d.formSentBy           || "",
        createdAt:            d.createdAt?.toDate()  || new Date(),
        createdBy:            d.createdBy            || "",
        createdByName:        d.createdByName        || "",
      });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────────
  const startEdit = (section: string) => { if (!member) return; setDraft({ ...member }); setEditingSection(section); };
  const cancelEdit = () => { setEditingSection(null); setDraft({}); };

  const saveEdit = async () => {
    if (!member) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries({ ...member, ...draft }).filter(([, v]) => v !== undefined && v !== null));
      await updateDoc(doc(db, `projects/${projectId}/crew`, memberId), { ...payload, updatedAt: Timestamp.now(), updatedBy: userId });
      setMember({ ...member, ...draft } as CrewMember);
      setEditingSection(null); setDraft({});
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const setField = (key: keyof CrewMember, value: any) => setDraft((d) => ({ ...d, [key]: value }));
  const get = (key: keyof CrewMember): any => editingSection ? (draft[key] ?? member?.[key]) : member?.[key];

  // ── Photo ─────────────────────────────────────────────────────────────────────
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !member) return;
    setUploadingPhoto(true);
    try {
      const storageRef = ref(storage, `projects/${projectId}/crew/${memberId}/photo`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, `projects/${projectId}/crew`, memberId), { photoUrl: url });
      setMember({ ...member, photoUrl: url });
    } catch (e) { console.error(e); }
    finally { setUploadingPhoto(false); }
  };

  // ── Documents ─────────────────────────────────────────────────────────────────
  const triggerDocUpload = (key: DocKey) => {
    pendingDocKey.current = key;
    docInputRef.current?.click();
  };

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const key  = pendingDocKey.current;
    if (!file || !key || !member) return;
    setUploadingDoc(key);
    try {
      const storageRef = ref(storage, `projects/${projectId}/crew/${memberId}/docs/${key}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const newDocs = { ...(member.documents || {}), [key]: url };
      await updateDoc(doc(db, `projects/${projectId}/crew`, memberId), { documents: newDocs });
      setMember({ ...member, documents: newDocs });
    } catch (e) { console.error(e); }
    finally { setUploadingDoc(null); e.target.value = ""; }
  };

  // ── Status ────────────────────────────────────────────────────────────────────
  const handleStatusChange = async (status: CrewMember["status"]) => {
    if (!member) return;
    await updateDoc(doc(db, `projects/${projectId}/crew`, memberId), { status, updatedAt: Timestamp.now(), updatedBy: userId });
    setMember({ ...member, status });
    setStatusOpen(false);
  };

  // ── Send form ─────────────────────────────────────────────────────────────────
  const handleSendForm = async () => {
    if (!member?.email) return;
    setSendingForm(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/crew`, memberId), {
        formSentAt: Timestamp.now(), formSentBy: userId, formSentByName: userName,
      });
      setMember({ ...member, formSentAt: new Date(), formSentBy: userId });
      setFormSent(true);
      setTimeout(() => setFormSent(false), 3000);
      setShowFormModal(false);
    } catch (e) { console.error(e); }
    finally { setSendingForm(false); }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(formUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    } catch { /* fallback silencioso */ }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const fmt = (d?: string) => {
    if (!d) return "—";
    try { return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d)); }
    catch { return d; }
  };

  const fmtTs = (d?: Date) => {
    if (!d) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  };

  const completeness = (() => {
    if (!member) return 0;
    const fields = [member.phone, member.email, member.address, member.dni,
      member.socialSecurityNumber, member.birthDate, member.nationality, member.bankAccount];
    const filled = fields.filter((f) => f !== undefined && f !== "" && f !== null).length;
    return Math.round((filled / fields.length) * 100);
  })();

  const docsUploaded = member ? Object.values(member.documents || {}).filter(Boolean).length : 0;

  // ─────────────────────────────────────────────────────────────────────────────
  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }
  if (!member) return null;

  const sc     = CREW_SECTIONS[member.section];
  const stConf = STATUS_MAP[member.status] || STATUS_MAP.active;
  const isEdit = (s: string) => editingSection === s;

  const isTechnical   = member.section === "technical";
  const isCastOrSpec  = member.section === "cast" || member.section === "specialists";

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="mt-[4rem]">
        <div className="bg-white border-b border-slate-200 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-4">
          <div className="flex items-center justify-between">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
              <Link href={`/project/${projectId}/team/crew`}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors">
                <ArrowLeft size={14} />Crew
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-slate-900 font-medium">{member.name}</span>
              {member.crewNumber && (
                <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                  #{member.crewNumber}
                </span>
              )}
            </div>

            {/* Right */}
            <div className="flex items-center gap-2">
              {/* Completeness */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
                <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${completeness}%`, backgroundColor: completeness >= 80 ? "#6BA319" : completeness >= 50 ? "#F59E0B" : "#EF4444" }} />
                </div>
                <span className="text-xs text-slate-500 font-medium">{completeness}% completado</span>
              </div>

              {/* Send form */}
              <button onClick={() => setShowFormModal(true)} disabled={!member.email}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={!member.email ? "Añade un email para enviar el formulario" : "Enviar formulario de alta"}>
                {formSent ? <MailCheck size={14} className="text-[#6BA319]" /> : <Send size={14} />}
                {formSent ? "Enviado" : "Enviar formulario"}
              </button>

              {/* Status dropdown */}
              <div className="relative" ref={statusRef}>
                <button onClick={() => setStatusOpen(!statusOpen)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${stConf.bg} ${stConf.text} ${sc.borderColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${stConf.dot}`} />
                  {stConf.label}
                  <ChevronDown size={12} className={`transition-transform ${statusOpen ? "rotate-180" : ""}`} />
                </button>
                {statusOpen && (
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 w-36 overflow-hidden">
                    {(Object.entries(STATUS_MAP) as [CrewMember["status"], typeof STATUS_MAP.active][]).map(([key, conf]) => (
                      <button key={key} onClick={() => handleStatusChange(key)}
                        className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${member.status === key ? "bg-slate-50 font-semibold" : "text-slate-700 hover:bg-slate-50"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
                        {conf.label}
                        {member.status === key && <Check size={11} className="ml-auto text-[#6BA319]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── LEFT ────────────────────────────────────────────────────────── */}
          <div className="lg:col-span-1 flex flex-col gap-6">

            {/* Identity card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center">
              {/* Photo */}
              <div className="relative mb-4">
                <div className="w-24 h-24 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center">
                  {member.photoUrl
                    ? <img src={member.photoUrl} alt={member.name} className="w-full h-full object-cover" />
                    : <span className="text-3xl font-bold text-slate-400">{member.name.charAt(0).toUpperCase()}</span>
                  }
                </div>
                <button onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-white border border-slate-200 rounded-lg shadow-sm flex items-center justify-center hover:bg-slate-50 transition-colors disabled:opacity-50"
                  title="Cambiar foto">
                  {uploadingPhoto ? <RefreshCw size={12} className="text-slate-500 animate-spin" /> : <Camera size={12} className="text-slate-500" />}
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              </div>

              <h1 className="text-lg font-bold text-slate-900 leading-tight">{member.name}</h1>
              {member.artisticName && <p className="text-sm text-slate-400 italic mt-0.5">"{member.artisticName}"</p>}
              <div className="mt-2">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bgColor} ${sc.textColor}`}>
                  {sc.label}
                </span>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 w-full space-y-1 text-center">
                <p className="text-sm font-semibold text-slate-900">{member.role}</p>
                {member.department && <p className="text-xs text-slate-500">{member.department}</p>}
                {member.company    && <p className="text-xs text-slate-400">{member.company}</p>}
              </div>

              {/* Remuneración resumida */}
              {isTechnical && member.salaryAmount && (
                <div className="mt-3 pt-3 border-t border-slate-100 w-full">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Salario {member.salaryType === "weekly" ? "semanal" : "mensual"}</span>
                    <span className="font-semibold text-[#6BA319]">{fmtCurrency(member.salaryAmount)}</span>
                  </div>
                </div>
              )}
              {isCastOrSpec && (member.sessions || member.salaryPerSession) && (
                <div className="mt-3 pt-3 border-t border-slate-100 w-full space-y-1.5">
                  {member.section === "cast" && member.character && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Personaje</span>
                      <span className="font-medium text-violet-700">{member.character}</span>
                    </div>
                  )}
                  {member.sessions !== undefined && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Sesiones</span>
                      <span className="font-medium text-slate-700">{member.sessions}</span>
                    </div>
                  )}
                  {member.salaryPerSession !== undefined && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Salario / sesión</span>
                      <span className="font-semibold text-[#6BA319]">{fmtCurrency(member.salaryPerSession)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Contacto rápido */}
              <div className="mt-4 pt-4 border-t border-slate-100 w-full flex flex-col gap-2">
                {member.email && (
                  <a href={`mailto:${member.email}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 justify-center">
                    <Mail size={13} className="text-slate-400" />{member.email}
                  </a>
                )}
                {member.phone && (
                  <a href={`tel:${member.phone}`} className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 justify-center">
                    <Phone size={13} className="text-slate-400" />{member.phone}
                  </a>
                )}
              </div>
            </div>

            {/* Form status card */}
            <div className={`border rounded-2xl p-4 ${member.formSentAt ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${member.formSentAt ? "bg-emerald-100" : "bg-slate-100"}`}>
                  {member.formSentAt ? <MailCheck size={16} className="text-emerald-600" /> : <Mail size={16} className="text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${member.formSentAt ? "text-emerald-800" : "text-slate-700"}`}>
                    {member.formSentAt ? "Formulario enviado" : "Formulario pendiente"}
                  </p>
                  <p className={`text-xs mt-0.5 ${member.formSentAt ? "text-emerald-600" : "text-slate-400"}`}>
                    {member.formSentAt ? fmtTs(member.formSentAt) : "No se ha enviado aún"}
                  </p>
                </div>
                {member.formSentAt && (
                  <button onClick={() => setShowFormModal(true)} className="text-xs text-emerald-600 hover:text-emerald-800 flex-shrink-0" title="Reenviar">
                    <RefreshCw size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Notes */}
            {(member.notes || isEdit("notes")) && (
              <SectionCard title="Notas" editing={isEdit("notes")} onEdit={() => startEdit("notes")}>
                {isEdit("notes") ? (
                  <div className="space-y-3">
                    <textarea value={get("notes") || ""} onChange={(e) => setField("notes", e.target.value)}
                      rows={4} placeholder="Observaciones…"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none" />
                    <EditActions saving={saving} onSave={saveEdit} onCancel={cancelEdit} />
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{member.notes}</p>
                )}
              </SectionCard>
            )}
          </div>

          {/* ── RIGHT ───────────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-6">

            {/* Contacto */}
            <SectionCard title="Contacto" editing={isEdit("contact")} onEdit={() => startEdit("contact")}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Email"    value={get("email")}   editing={isEdit("contact")} onChange={(v) => setField("email", v)}   placeholder="correo@ejemplo.com" />
                <Field label="Teléfono" value={get("phone")}   editing={isEdit("contact")} onChange={(v) => setField("phone", v)}   placeholder="+34 600 000 000" />
                <Field label="Domicilio" value={get("address")} editing={isEdit("contact")} onChange={(v) => setField("address", v)} placeholder="Calle, número, piso" span={2} />
                <Field label="Municipio"     value={get("municipality")} editing={isEdit("contact")} onChange={(v) => setField("municipality", v)} placeholder="Ciudad" />
                <Field label="Código postal" value={get("postalCode")}   editing={isEdit("contact")} onChange={(v) => setField("postalCode", v)}   placeholder="28001" />
              </div>
              {isEdit("contact") && <div className="mt-4 pt-4 border-t border-slate-100"><EditActions saving={saving} onSave={saveEdit} onCancel={cancelEdit} /></div>}
            </SectionCard>

            {/* Datos personales */}
            <SectionCard title="Datos personales" editing={isEdit("personal")} onEdit={() => startEdit("personal")}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="DNI / NIE"           value={get("dni")}                  editing={isEdit("personal")} onChange={(v) => setField("dni", v)}                  placeholder="00000000X"            sensitive />
                <Field label="Nº Seguridad Social"  value={get("socialSecurityNumber")} editing={isEdit("personal")} onChange={(v) => setField("socialSecurityNumber", v)} placeholder="00 000000000 00"      sensitive />
                <Field label="Fecha de nacimiento"  value={get("birthDate")}            editing={isEdit("personal")} type="date" onChange={(v) => setField("birthDate", v)} />
                <Field label="Lugar de nacimiento"  value={get("birthPlace")}           editing={isEdit("personal")} onChange={(v) => setField("birthPlace", v)}           placeholder="Ciudad, país" />
                <Field label="Nacionalidad"         value={get("nationality")}          editing={isEdit("personal")} onChange={(v) => setField("nationality", v)}           placeholder="Española" />
              </div>
              {isEdit("personal") && <div className="mt-4 pt-4 border-t border-slate-100"><EditActions saving={saving} onSave={saveEdit} onCancel={cancelEdit} /></div>}
            </SectionCard>

            {/* Contrato & Remuneración */}
            <SectionCard title="Contrato & Remuneración" editing={isEdit("contract")} onEdit={() => startEdit("contract")}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <Field label="Motivo contratación" value={get("contractReason")} editing={isEdit("contract")} onChange={(v) => setField("contractReason", v)} placeholder="Largometraje, serie…" span={2} />
                <Field label="Fecha alta"      value={fmt(get("startDate"))}    editing={isEdit("contract")} type="date" onChange={(v) => setField("startDate", v)} />
                <Field label="Baja aproximada" value={fmt(get("endDateApprox"))} editing={isEdit("contract")} type="date" onChange={(v) => setField("endDateApprox", v)} />

                {/* Salario — técnicos */}
                {isTechnical && !isEdit("contract") && (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Periodicidad</p>
                      <p className="text-sm font-medium text-slate-900">
                        {member.salaryType === "weekly" ? "Semanal" : "Mensual"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Salario bruto {member.salaryType === "weekly" ? "semanal" : "mensual"}
                      </p>
                      <p className="text-sm font-medium text-slate-900">{fmtCurrency(member.salaryAmount)}</p>
                    </div>
                  </>
                )}
                {isTechnical && isEdit("contract") && (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Periodicidad</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(["weekly", "monthly"] as const).map((t) => (
                          <button key={t} type="button"
                            onClick={() => setField("salaryType", t)}
                            className={`py-2 rounded-xl border text-xs font-medium transition-all ${
                              get("salaryType") === t
                                ? "border-[#6BA319] bg-[rgba(107,163,25,0.08)] text-[#6BA319]"
                                : "border-slate-200 text-slate-600 hover:border-slate-300"
                            }`}>
                            {t === "weekly" ? "Semanal" : "Mensual"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                        Salario bruto {get("salaryType") === "weekly" ? "semanal" : "mensual"} (€)
                      </p>
                      <input type="number" min={0} value={get("salaryAmount") ?? ""}
                        onChange={(e) => setField("salaryAmount", e.target.value ? Number(e.target.value) : undefined)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                    </div>
                  </>
                )}

                {/* Salario — cast & especialistas */}
                {isCastOrSpec && (
                  <>
                    <Field label="Nº sesiones"     value={get("sessions")}         editing={isEdit("contract")} type="number" onChange={(v) => setField("sessions", Number(v))}         placeholder="0" />
                    <Field label="Salario / sesión (€)" value={get("salaryPerSession")} editing={isEdit("contract")} type="number" onChange={(v) => setField("salaryPerSession", Number(v))} placeholder="0.00" />
                  </>
                )}

                <Field label="Retención IRPF (%)"   value={get("irpfRate")}    editing={isEdit("contract")} type="number" onChange={(v) => setField("irpfRate", Number(v))}   placeholder="15" />
                <Field label="Régimen"               value={get("regime")}      editing={isEdit("contract")} onChange={(v) => setField("regime", v)}       placeholder="General, autónomo…" />
                <Field label="Nº cuenta corriente"   value={get("bankAccount")} editing={isEdit("contract")} onChange={(v) => setField("bankAccount", v)}  placeholder="ES00 0000 0000 0000 0000 0000" sensitive span={2} />
              </div>
              {isEdit("contract") && <div className="mt-4 pt-4 border-t border-slate-100"><EditActions saving={saving} onSave={saveEdit} onCancel={cancelEdit} /></div>}
            </SectionCard>

            {/* Documentos */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Documentos</p>
                <span className="text-xs text-slate-400">{docsUploaded} / {REQUIRED_DOCS.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {REQUIRED_DOCS.map((docDef) => {
                  const url      = member.documents?.[docDef.key];
                  const uploading = uploadingDoc === docDef.key;
                  return (
                    <div key={docDef.key} className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${url ? "bg-emerald-50" : "bg-slate-100"}`}>
                          <FileText size={13} className={url ? "text-emerald-600" : "text-slate-400"} />
                        </div>
                        <span className={`text-sm ${url ? "text-slate-900" : "text-slate-500"}`}>{docDef.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-2">
                            Ver
                          </a>
                        )}
                        <button
                          onClick={() => triggerDocUpload(docDef.key)}
                          disabled={uploading}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                            url
                              ? "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
                              : "border-[#6BA319] text-[#6BA319] hover:bg-[rgba(107,163,25,0.05)]"
                          } disabled:opacity-50`}
                        >
                          {uploading
                            ? <><RefreshCw size={11} className="animate-spin" />Subiendo</>
                            : <><Upload size={11} />{url ? "Cambiar" : "Subir"}</>
                          }
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Input de documentos — oculto */}
            <input ref={docInputRef} type="file" className="hidden" onChange={handleDocUpload} />

            {/* Notas (si no están en sidebar) */}
            {!member.notes && !isEdit("notes") && (
              <button onClick={() => startEdit("notes")}
                className="w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-sm text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors">
                + Añadir notas
              </button>
            )}

            {/* Meta */}
            <div className="text-xs text-slate-400 text-right space-y-0.5">
              <p>Alta creada por <span className="font-medium">{member.createdByName}</span></p>
              <p>{fmtTs(member.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Send form modal ─────────────────────────────────────────────────── */}
      {showFormModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowFormModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {member.formSentAt ? "Reenviar formulario" : "Enviar formulario de alta"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Formulario para que el miembro complete sus datos</p>
              </div>
              <button onClick={() => setShowFormModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg">
                <X size={16} />
              </button>
            </div>

            {/* Resumen */}
            <div className="px-6 pt-5 pb-4 space-y-4">
              <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Destinatario</span>
                  <span className="font-medium text-slate-900">{member.name}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Email</span>
                  <span className="font-mono text-slate-700 text-xs">{member.email}</span>
                </div>
                {member.formSentAt && (
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-200">
                    <span className="text-slate-500">Último envío</span>
                    <span className="text-xs text-slate-500">{fmtTs(member.formSentAt)}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500">
                Se enviará un enlace a <span className="font-semibold text-slate-700">{member.email}</span> para que el miembro complete su ficha: datos personales, DNI, cuenta bancaria y demás información de alta.
              </p>

              {/* Enlace copiable */}
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Enlace del formulario</p>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                  <LinkIcon size={13} className="text-slate-400 flex-shrink-0" />
                  <span className="text-xs text-slate-600 font-mono flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {formUrl}
                  </span>
                  <button onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 border"
                    style={linkCopied
                      ? { backgroundColor: "rgba(107,163,25,0.08)", borderColor: "rgba(107,163,25,0.3)", color: "#6BA319" }
                      : { borderColor: "#e2e8f0", color: "#64748b" }}>
                    {linkCopied ? <><Check size={11} />Copiado</> : <><ClipboardCopy size={11} />Copiar</>}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex gap-3 rounded-b-2xl">
              <button onClick={() => setShowFormModal(false)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium">
                Cancelar
              </button>
              <button onClick={handleSendForm} disabled={sendingForm || !member.email}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}>
                {sendingForm
                  ? <><RefreshCw size={14} className="animate-spin" />Enviando…</>
                  : <><Send size={14} />{member.formSentAt ? "Reenviar" : "Enviar"}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
