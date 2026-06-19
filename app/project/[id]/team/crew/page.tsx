"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
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
  setDoc,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ExternalLink,
  FileDown,
  Filter,
  Link2,
  MailPlus,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const CREW_SECTIONS = {
  technical:   { key: "technical",   label: "Equipo técnico", bgColor: "bg-sky-50",    textColor: "text-sky-700",    borderColor: "border-sky-200"    },
  cast:        { key: "cast",        label: "Cast",           bgColor: "bg-violet-50", textColor: "text-violet-700", borderColor: "border-violet-200" },
  specialists: { key: "specialists", label: "Especialistas",  bgColor: "bg-amber-50",  textColor: "text-amber-700",  borderColor: "border-amber-200"  },
} as const;

type CrewSection = keyof typeof CREW_SECTIONS;

const DEPARTMENTS_TECHNICAL = [
  "Producción Ejecutiva", "Legal", "Guion", "Dirección", "Producción",
  "Transportes", "Fotografía", "Arte", "Vestuario", "Maquillaje & Peluquería",
  "Sonido", "Eléctricos & Maquinistas", "Transportes Pesados",
  "VFX", "SFX", "Montaje", "Postproducción",
];

const DEPARTMENTS_SPECIALISTS = [
  "Especialistas de Acción", "Dobles", "Coordinación de Especialistas",
  "Pirotecnia", "Conducción Especializada",
];

const STATUS_OPTIONS = [
  { value: "all",      label: "Todos los estados" },
  { value: "active",   label: "Activo"            },
  { value: "inactive", label: "Inactivo"          },
  { value: "pending",  label: "Pendiente"         },
];

const STATUS_MEMBER_OPTIONS = [
  { value: "active",   label: "Activo"    },
  { value: "pending",  label: "Pendiente" },
  { value: "inactive", label: "Inactivo"  },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  crewNumber: string;       // e.g. "0001"
  section: CrewSection;
  firstName: string;
  lastName1: string;
  lastName2?: string;
  artisticName?: string;
  role: string;
  department: string;
  company?: string;
  status: "active" | "inactive" | "pending";
  phone?: string;
  email?: string;
  // Cast & Especialistas
  character?: string;
  sessions?: number;
  salaryPerSession?: number;
  // Técnicos
  salaryType?: "weekly" | "monthly"; // semanal o mensual
  salaryAmount?: number;             // importe bruto
  // Común (ficha detalle)
  grossSalary?: number;
  irpfRate?: number;
  regime?: string;
  startDate?: string;
  endDateApprox?: string;
  contractReason?: string;
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

type FormData = Omit<CrewMember, "id" | "crewNumber" | "createdAt" | "createdBy" | "createdByName">;

const EMPTY_FORM: FormData = {
  section: "technical", firstName: "", lastName1: "", lastName2: "",
  artisticName: "", role: "", department: "", company: "", status: "active",
  phone: "", email: "", character: "",
  salaryType: "monthly", regime: "",
  startDate: "", endDateApprox: "", contractReason: "", notes: "",
};

// ─── CustomSelect ─────────────────────────────────────────────────────────────

function CustomSelect({
  value, onChange, options, placeholder = "Seleccionar",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#6BA319] hover:border-slate-300 transition-colors"
      >
        <span className={selected ? "text-slate-900" : "text-slate-400"}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.value} type="button"
              onMouseDown={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${
                value === o.value ? "bg-[rgba(107,163,25,0.08)] text-[#6BA319] font-medium" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {o.label}
              {value === o.value && <Check size={13} className="text-[#6BA319]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DepartmentSelect (autocomplete) ─────────────────────────────────────────

function DepartmentSelect({
  value, onChange, options, placeholder = "Seleccionar departamento",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;

  useEffect(() => { setQ(value); }, [value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        if (q && !options.includes(q)) onChange(q);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [q, options, onChange]);

  return (
    <div className="relative" ref={ref}>
      <input
        type="text" value={q} placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] pr-8 bg-white"
      />
      <ChevronDown size={14} className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none transition-transform ${open ? "rotate-180" : ""}`} />
      {open && filtered.length > 0 && (
        <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt} type="button"
              onMouseDown={() => { onChange(opt); setQ(opt); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${
                value === opt ? "bg-[rgba(107,163,25,0.08)] text-[#6BA319] font-medium" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {opt}
              {value === opt && <Check size={13} className="text-[#6BA319]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SalarySection (colapsable, solo técnicos) ───────────────────────────────

function SalarySection({
  formData,
  setFormData,
}: {
  formData: FormData;
  setFormData: (d: FormData) => void;
}) {
  const [open, setOpen] = useState(!!(formData.salaryAmount));

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Remuneración</span>
          {formData.salaryAmount && (
            <span className="text-xs font-medium text-[#6BA319] bg-[rgba(107,163,25,0.1)] px-2 py-0.5 rounded-md">
              {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(formData.salaryAmount)} € /
              {formData.salaryType === "weekly" ? " sem." : " mes"}
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {/* Tipo: semanal / mensual */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Periodicidad</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "weekly",  label: "Semanal" },
                { value: "monthly", label: "Mensual" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, salaryType: opt.value })}
                  className={`py-2.5 rounded-xl border text-xs font-medium transition-all ${
                    formData.salaryType === opt.value
                      ? "border-[#6BA319] bg-[rgba(107,163,25,0.08)] text-[#6BA319]"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Importe */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Salario bruto {formData.salaryType === "weekly" ? "semanal" : "mensual"} (€)
            </label>
            <input
              type="number" min={0}
              value={formData.salaryAmount ?? ""}
              onChange={(e) => setFormData({ ...formData, salaryAmount: e.target.value ? Number(e.target.value) : null })}
              placeholder="0.00"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading]             = useState(true);
  const [crew, setCrew]                   = useState<CrewMember[]>([]);
  const [filteredCrew, setFilteredCrew]   = useState<CrewMember[]>([]);
  const [searchTerm, setSearchTerm]       = useState("");
  const [statusFilter, setStatusFilter]   = useState("all");
  const [sectionFilter, setSectionFilter] = useState<CrewSection | "all">("all");
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [openMenuId, setOpenMenuId]       = useState<string | null>(null);
  const [menuPosition, setMenuPosition]   = useState<{ top: number; left: number } | null>(null);
  const [showModal, setShowModal]         = useState(false);
  const [editingMember, setEditingMember] = useState<CrewMember | null>(null);
  const [formData, setFormData]           = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving]               = useState(false);
  const [sendingForm, setSendingForm]     = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void;
  } | null>(null);
  const [projectName, setProjectName]       = useState("");
  const [showCrewListModal, setShowCrewListModal] = useState(false);
  const [deptOrder, setDeptOrder]           = useState<string[]>([]);
  const [exportingPdf, setExportingPdf]     = useState(false);

  // Send form modal
  const [formTarget, setFormTarget]         = useState<CrewMember | null>(null);
  const [formMessage, setFormMessage]       = useState("");
  const [generatingForm, setGeneratingForm] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{ url: string; pin: string } | null>(null);
  const [copiedUrl, setCopiedUrl]           = useState(false);
  const [copiedPin, setCopiedPin]           = useState(false);

  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const userId   = user?.uid  || "";
  const userName = user?.name || "Usuario";

  useEffect(() => { if (userId && id) loadData(); }, [userId, id]);
  useEffect(() => { filterCrew(); }, [searchTerm, statusFilter, sectionFilter, crew]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".menu-container")) { setOpenMenuId(null); setMenuPosition(null); }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(t)) setShowStatusDropdown(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const fullName = (m: CrewMember) =>
    [m.firstName, m.lastName1, m.lastName2].filter(Boolean).join(" ");

  // Genera el siguiente número correlativo 0001, 0002…
  const getNextCrewNumber = async (): Promise<string> => {
    const snap = await getDocs(collection(db, `projects/${id}/crew`));
    const numbers = snap.docs
      .map((d) => parseInt(d.data().crewNumber || "0", 10))
      .filter((n) => !isNaN(n));
    const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    return String(next).padStart(4, "0");
  };

  // ── Data ─────────────────────────────────────────────────────────────────────

  const loadData = async () => {
    try {
      setLoading(true);
      const [projectSnap, snap] = await Promise.all([
        getDoc(doc(db, `projects/${id}`)),
        getDocs(query(collection(db, `projects/${id}/crew`), orderBy("createdAt", "desc"))),
      ]);
      if (projectSnap.exists()) setProjectName(projectSnap.data().name || "");
      const data: CrewMember[] = snap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          crewNumber:       v.crewNumber       || "0000",
          section:          v.section          || "technical",
          firstName:        v.firstName        || v.name || "",
          lastName1:        v.lastName1        || "",
          lastName2:        v.lastName2        || "",
          artisticName:     v.artisticName     || "",
          role:             v.role             || "",
          department:       v.department       || "",
          company:          v.company          || "",
          status:           v.status           || "active",
          phone:            v.phone            || "",
          email:            v.email            || "",
          character:        v.character        || "",
          sessions:         v.sessions,
          salaryPerSession: v.salaryPerSession,
          salaryType:       v.salaryType       || "monthly",
          salaryAmount:     v.salaryAmount,
          grossSalary:      v.grossSalary,
          irpfRate:         v.irpfRate,
          regime:           v.regime           || "",
          startDate:        v.startDate        || "",
          endDateApprox:    v.endDateApprox    || "",
          contractReason:   v.contractReason   || "",
          notes:            v.notes            || "",
          createdAt:        v.createdAt?.toDate() || new Date(),
          createdBy:        v.createdBy        || "",
          createdByName:    v.createdByName    || "",
        };
      });
      setCrew(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const filterCrew = () => {
    let f = [...crew];
    if (sectionFilter !== "all") f = f.filter((m) => m.section === sectionFilter);
    if (statusFilter  !== "all") f = f.filter((m) => m.status  === statusFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      f = f.filter((m) =>
        fullName(m).toLowerCase().includes(s) ||
        m.role.toLowerCase().includes(s) ||
        m.department.toLowerCase().includes(s) ||
        m.email?.toLowerCase().includes(s) ||
        m.character?.toLowerCase().includes(s)
      );
    }
    setFilteredCrew(f);
  };

  const closeMenu = () => { setOpenMenuId(null); setMenuPosition(null); };

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingMember(null);
    setFormData({ ...EMPTY_FORM, section: sectionFilter !== "all" ? sectionFilter : "technical" });
    setShowModal(true);
  };

  const openEdit = (member: CrewMember) => {
    setEditingMember(member);
    setFormData({
      section: member.section, firstName: member.firstName, lastName1: member.lastName1,
      lastName2: member.lastName2 || "", artisticName: member.artisticName || "",
      role: member.role, department: member.department, company: member.company || "",
      status: member.status, phone: member.phone || "", email: member.email || "",
      character: member.character || "", sessions: member.sessions,
      salaryPerSession: member.salaryPerSession,
      salaryType: member.salaryType || "monthly",
      salaryAmount: member.salaryAmount,
      grossSalary: member.grossSalary,
      irpfRate: member.irpfRate, regime: member.regime || "", startDate: member.startDate || "",
      endDateApprox: member.endDateApprox || "", contractReason: member.contractReason || "",
      notes: member.notes || "",
    });
    setShowModal(true);
    closeMenu();
  };

  // Guarda sin enviar formulario
  // Firestore no acepta undefined ni null en campos numéricos — los elimina
  const sanitize = (obj: Record<string, any>): Record<string, any> =>
    Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, v !== null && typeof v === "object" && !Array.isArray(v) && !(v?.toMillis) ? sanitize(v) : v])
    );

  const handleSave = async () => {
    if (!formData.firstName.trim() || !formData.lastName1.trim() || !formData.role.trim()) return;
    setSaving(true);
    try {
      if (editingMember) {
        await updateDoc(doc(db, `projects/${id}/crew`, editingMember.id),
          sanitize({ ...formData, updatedAt: Timestamp.now(), updatedBy: userId })
        );
      } else {
        const crewNumber = await getNextCrewNumber();
        await setDoc(doc(collection(db, `projects/${id}/crew`)),
          sanitize({ ...formData, crewNumber, createdAt: Timestamp.now(), createdBy: userId, createdByName: userName })
        );
      }
      await loadData();
      setShowModal(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  // Guarda Y envía el formulario de alta al miembro
  const handleSaveAndSend = async () => {
    if (!formData.firstName.trim() || !formData.lastName1.trim() || !formData.role.trim()) return;
    if (!formData.email?.trim()) return;
    setSendingForm(true);
    try {
      const crewNumber = editingMember ? editingMember.crewNumber : await getNextCrewNumber();
      const ref = editingMember
        ? doc(db, `projects/${id}/crew`, editingMember.id)
        : doc(collection(db, `projects/${id}/crew`));
      await setDoc(ref, sanitize({
        ...formData, crewNumber,
        ...(editingMember ? {} : { createdAt: Timestamp.now(), createdBy: userId, createdByName: userName }),
        updatedAt: Timestamp.now(), updatedBy: userId,
        formSentAt: Timestamp.now(), formSentBy: userId, formSentByName: userName,
      }), { merge: true });
      // → aquí irá la llamada a Cloud Function / API de email
      await loadData();
      setShowModal(false);
    } catch (e) { console.error(e); }
    finally { setSendingForm(false); }
  };

  const handleDelete = (member: CrewMember) => {
    setConfirmDialog({
      title: "Eliminar miembro",
      message: `¿Eliminar a ${fullName(member)}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar", danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        await deleteDoc(doc(db, `projects/${id}/crew`, member.id));
        await loadData(); closeMenu();
      },
    });
    closeMenu();
  };

  const handleToggleStatus = async (member: CrewMember) => {
    const next = member.status === "active" ? "inactive" : "active";
    await updateDoc(doc(db, `projects/${id}/crew`, member.id), {
      status: next, updatedAt: Timestamp.now(), updatedBy: userId,
    });
    await loadData(); closeMenu();
  };

  // ── Crew List PDF ─────────────────────────────────────────────────────────────

  const creditName = (m: CrewMember) => m.artisticName?.trim() || fullName(m);

  const openSendForm = (member: CrewMember) => {
    setFormTarget(member);
    setFormMessage("");
    setGeneratedResult(null);
    closeMenu();
  };

  const closeSendForm = () => {
    setFormTarget(null);
    setGeneratedResult(null);
    setFormMessage("");
  };

  const handleGenerateForm = async () => {
    if (!formTarget) return;
    setGeneratingForm(true);
    try {
      const pin = String(Math.floor(1000 + Math.random() * 9000));
      const expires = new Date();
      expires.setDate(expires.getDate() + 14);
      const docRef = await addDoc(collection(db, "forms"), {
        type: "crew_onboarding",
        pin,
        status: "pending",
        projectId: id,
        projectName,
        crewMemberId: formTarget.id,
        createdBy: userId,
        createdByName: userName,
        coordinatorMessage: formMessage.trim() || null,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromDate(expires),
        prefilled: {
          firstName:    formTarget.firstName,
          lastName1:    formTarget.lastName1,
          lastName2:    formTarget.lastName2    || "",
          artisticName: formTarget.artisticName || "",
          email:        formTarget.email        || "",
          phone:        formTarget.phone        || "",
          role:         formTarget.role,
          department:   formTarget.department,
          section:      formTarget.section,
        },
      });
      const url = `${window.location.origin}/form/${docRef.id}`;
      setGeneratedResult({ url, pin });
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingForm(false);
    }
  };

  const copyToClipboard = async (text: string, type: "url" | "pin") => {
    await navigator.clipboard.writeText(text);
    if (type === "url") { setCopiedUrl(true); setTimeout(() => setCopiedUrl(false), 2000); }
    else                { setCopiedPin(true); setTimeout(() => setCopiedPin(false), 2000); }
  };

  const openCrewListModal = () => {
    const depts = Array.from(
      new Set(
        crew
          .filter((m) => m.status !== "inactive")
          .map((m) => m.department?.trim() || CREW_SECTIONS[m.section].label)
      )
    );
    setDeptOrder(depts);
    setShowCrewListModal(true);
  };

  const moveDept = (idx: number, dir: -1 | 1) => {
    const next = [...deptOrder];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setDeptOrder(next);
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const pageW = 210;
      const pageH = 297;
      const mL = 18;
      const mR = 18;
      const cW = pageW - mL - mR;
      const green: [number, number, number] = [107, 163, 25];
      const dark: [number, number, number]  = [22, 22, 22];
      const mid: [number, number, number]   = [110, 110, 110];
      const light: [number, number, number] = [245, 245, 245];

      const colW = [52, 55, 36, 31] as const; // PUESTO | NOMBRE | TELÉFONO | EMAIL
      const col = [mL, mL + colW[0], mL + colW[0] + colW[1], mL + colW[0] + colW[1] + colW[2]];

      const now = new Date();
      const dateStr = now.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });

      let y = 22;

      // ── Header ─────────────────────────────────────────────────────────────
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...mid);
      doc.text((projectName || "Proyecto").toUpperCase(), mL, y);
      doc.text(dateStr, pageW - mR, y, { align: "right" });

      y += 9;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(26);
      doc.setTextColor(...dark);
      doc.text("CREW LIST", pageW / 2, y, { align: "center" });

      y += 5;
      doc.setDrawColor(...green);
      doc.setLineWidth(0.6);
      doc.line(mL, y, pageW - mR, y);
      y += 11;

      // ── Per department ─────────────────────────────────────────────────────
      for (const dept of deptOrder) {
        const members = crew.filter(
          (m) =>
            m.status !== "inactive" &&
            (m.department?.trim() || CREW_SECTIONS[m.section].label) === dept
        );
        if (members.length === 0) continue;

        const blockHeight = 10 + members.length * 7 + 8;
        if (y + blockHeight > pageH - 14) {
          doc.addPage();
          y = 22;
          // mini-header on continuation pages
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(...mid);
          doc.text((projectName || "Proyecto").toUpperCase(), mL, 14);
          doc.text("CREW LIST", pageW / 2, 14, { align: "center" });
          doc.text(dateStr, pageW - mR, 14, { align: "right" });
          doc.setDrawColor(...light);
          doc.setLineWidth(0.3);
          doc.line(mL, 17, pageW - mR, 17);
        }

        // Department header bar
        doc.setFillColor(...light);
        doc.roundedRect(mL, y - 4.5, cW, 9, 1.2, 1.2, "F");
        doc.setFillColor(...green);
        doc.roundedRect(mL, y - 4.5, 2.5, 9, 0.5, 0.5, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(...dark);
        doc.text(dept.toUpperCase(), mL + 6, y + 0.5);

        // member count badge
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...mid);
        doc.text(`${members.length} miembro${members.length !== 1 ? "s" : ""}`, pageW - mR, y + 0.5, { align: "right" });

        y += 8;

        // Column headers
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(...mid);
        doc.text("PUESTO",             col[0], y);
        doc.text("NOMBRE EN CRÉDITOS", col[1], y);
        doc.text("TELÉFONO",           col[2], y);
        doc.text("EMAIL",              col[3], y);

        y += 2;
        doc.setDrawColor(220, 220, 220);
        doc.setLineWidth(0.25);
        doc.line(mL, y, pageW - mR, y);
        y += 4.5;

        // Rows
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        members.forEach((m, i) => {
          if (i % 2 === 0) {
            doc.setFillColor(251, 252, 250);
            doc.rect(mL, y - 3.5, cW, 7, "F");
          }
          doc.setTextColor(...dark);
          doc.text(doc.splitTextToSize(m.role || "—", colW[0] - 3)[0], col[0], y);
          doc.text(doc.splitTextToSize(creditName(m), colW[1] - 3)[0], col[1], y);
          doc.setTextColor(...mid);
          doc.text(m.phone || "—", col[2], y);
          doc.text(doc.splitTextToSize(m.email || "—", colW[3] - 1)[0], col[3], y);
          y += 7;
        });

        y += 7;
      }

      // ── Footer ─────────────────────────────────────────────────────────────
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...mid);
        doc.text(`${p} / ${totalPages}`, pageW / 2, pageH - 8, { align: "center" });
        doc.setDrawColor(...light);
        doc.setLineWidth(0.3);
        doc.line(mL, pageH - 11, pageW - mR, pageH - 11);
      }

      doc.save(`crew-list_${(projectName || "proyecto").replace(/\s+/g, "-").toLowerCase()}_${now.toISOString().slice(0, 10)}.pdf`);
      setShowCrewListModal(false);
    } catch (e) {
      console.error(e);
    } finally {
      setExportingPdf(false);
    }
  };

  // ── UI helpers ────────────────────────────────────────────────────────────────

  const getStatusBadge = (status: CrewMember["status"]) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Activo"    },
      inactive: { bg: "bg-slate-100",  text: "text-slate-500",   label: "Inactivo"  },
      pending:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente" },
    };
    const c = map[status] || map.active;
    return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
  };

  const getStatusLabel = () => STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || "Todos los estados";

  const deptOptions = formData.section === "cast" ? [] : formData.section === "specialists" ? DEPARTMENTS_SPECIALISTS : DEPARTMENTS_TECHNICAL;

  const stats = {
    technical:   crew.filter((m) => m.section === "technical").length,
    cast:        crew.filter((m) => m.section === "cast").length,
    specialists: crew.filter((m) => m.section === "specialists").length,
    active:      crew.filter((m) => m.status === "active").length,
    total:       crew.length,
  };

  const canSend = formData.firstName.trim() && formData.lastName1.trim() && formData.role.trim() && formData.email?.trim();
  const canSave = formData.firstName.trim() && formData.lastName1.trim() && formData.role.trim();

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-center justify-between border-b border-slate-200 pb-6">

            {/* Left: título solo */}
            <div className="flex items-center gap-3">
              <Users size={24} style={{ color: "#6BA319" }} />
              <h1 className="text-2xl font-semibold text-slate-900">Crew</h1>
            </div>

            {/* Right: stats + botón */}
            <div className="flex items-center gap-4">
              {/* Stats pill */}
              <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-center">
                  <p className="text-xs text-slate-400 leading-none mb-0.5">Activos</p>
                  <p className="text-base font-bold text-slate-900 leading-none">{stats.active}</p>
                </div>
                <div className="w-px h-6 bg-slate-200" />
                <div className="text-center">
                  <p className="text-xs text-slate-400 leading-none mb-0.5">Total</p>
                  <p className="text-base font-bold text-slate-900 leading-none">{stats.total}</p>
                </div>
              </div>

              <button
                onClick={openCrewListModal}
                disabled={crew.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-40 transition-colors"
              >
                <FileDown size={15} className="text-slate-500" />
                Crew List
              </button>

              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                <Plus size={15} />
                Añadir miembro
              </button>
            </div>
          </div>

          {/* Section tabs */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            {Object.values(CREW_SECTIONS).map((section) => {
              const count  = stats[section.key as keyof typeof stats] as number;
              const active = sectionFilter === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setSectionFilter(active ? "all" : section.key)}
                  className={`px-4 py-3 rounded-xl border transition-all text-left ${
                    active ? `${section.borderColor} ${section.bgColor}` : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${active ? section.textColor : "text-slate-700"}`}>
                      {section.label}
                    </span>
                    <span className={`text-sm font-semibold ${active ? section.textColor : "text-slate-900"}`}>
                      {count}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">

        {/* Filters */}
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center mb-6">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, cargo, departamento"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white text-sm"
            />
          </div>
          <div className="relative flex-shrink-0" ref={statusDropdownRef}>
            <button
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
              className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm hover:border-slate-300 bg-white min-w-[170px]"
            >
              <Filter size={13} className="text-slate-400" />
              <span className="flex-1 text-left text-xs text-slate-700">{getStatusLabel()}</span>
              <ChevronDown size={13} className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
            </button>
            {showStatusDropdown && (
              <div className="absolute top-full right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-full">
                {STATUS_OPTIONS.map((o) => (
                  <button key={o.value} onClick={() => { setStatusFilter(o.value); setShowStatusDropdown(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm whitespace-nowrap ${statusFilter === o.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"}`}
                  >{o.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Empty */}
        {filteredCrew.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all" ? "Sin resultados" : "Sin miembros aún"}
            </h3>
            <p className="text-slate-500 text-sm">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all"
                ? "Prueba a ajustar los filtros"
                : "Usa el botón «Añadir miembro» para empezar"}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider w-12">#</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Miembro</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sección</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cargo · Depto.</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contacto</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                    <th className="w-14" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCrew.map((member) => {
                    const sc  = CREW_SECTIONS[member.section];
                    const dim = member.status === "inactive";
                    return (
                      <tr
                        key={member.id}
                        onClick={() => router.push(`/project/${id}/team/crew/${member.id}`)}
                        className={`transition-colors cursor-pointer ${dim ? "opacity-50 hover:opacity-70" : "hover:bg-slate-50"}`}
                      >
                        {/* Número */}
                        <td className="px-6 py-4">
                          <span className="text-xs font-mono text-slate-400">{member.crewNumber}</span>
                        </td>
                        {/* Miembro */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-600">
                              {member.firstName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{fullName(member)}</p>
                              {member.artisticName && <p className="text-xs text-slate-400 italic mt-0.5">"{member.artisticName}"</p>}
                              {member.section === "cast" && member.character && <p className="text-xs text-violet-500 mt-0.5">{member.character}</p>}
                            </div>
                          </div>
                        </td>
                        {/* Sección */}
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bgColor} ${sc.textColor}`}>
                            {sc.label}
                          </span>
                        </td>
                        {/* Cargo */}
                        <td className="px-6 py-4">
                          <p className="text-sm text-slate-900 font-medium">{member.role}</p>
                          {member.department && <p className="text-xs text-slate-500 mt-0.5">{member.department}</p>}
                          {/* Salario resumido */}
                          {member.section === "technical" && member.salaryAmount && (
                            <p className="text-xs text-[#6BA319] mt-0.5 font-medium">
                              {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(member.salaryAmount)} €
                              <span className="text-slate-400 font-normal"> / {member.salaryType === "weekly" ? "sem." : "mes"}</span>
                            </p>
                          )}
                          {(member.section === "cast" || member.section === "specialists") && member.salaryPerSession && (
                            <p className="text-xs text-[#6BA319] mt-0.5 font-medium">
                              {new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(member.salaryPerSession)} €
                              <span className="text-slate-400 font-normal"> / sesión{member.sessions ? ` · ${member.sessions} ses.` : ""}</span>
                            </p>
                          )}
                        </td>
                        {/* Contacto */}
                        <td className="px-6 py-4">
                          <div className="space-y-0.5">
                            {member.email && (
                              <a href={`mailto:${member.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
                                <MailPlus size={11} className="text-slate-400" />{member.email}
                              </a>
                            )}
                            {member.phone && (
                              <a href={`tel:${member.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
                                <Phone size={11} className="text-slate-400" />{member.phone}
                              </a>
                            )}
                            {!member.email && !member.phone && <span className="text-xs text-slate-400">—</span>}
                          </div>
                        </td>
                        {/* Estado */}
                        <td className="px-6 py-4">{getStatusBadge(member.status)}</td>
                        {/* Menú */}
                        <td className="px-6 py-4">
                          <div className="relative menu-container">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (openMenuId === member.id) { closeMenu(); return; }
                                const rect = e.currentTarget.getBoundingClientRect();
                                setMenuPosition({ top: rect.bottom + 4, left: rect.right - 208 });
                                setOpenMenuId(member.id);
                              }}
                              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Floating context menu */}
        {openMenuId && menuPosition && (
          <div className="fixed w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] py-1" style={{ top: menuPosition.top, left: menuPosition.left }}>
            {(() => {
              const member = filteredCrew.find((m) => m.id === openMenuId);
              if (!member) return null;
              return (
                <>
                  <button onClick={() => openEdit(member)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3">
                    <Pencil size={14} className="text-slate-400" />Editar datos
                  </button>
                  <button onClick={() => openSendForm(member)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3">
                    <Link2 size={14} className="text-slate-400" />Enviar ficha
                  </button>
                  <button onClick={() => handleToggleStatus(member)} className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3">
                    {member.status === "active"
                      ? <><UserMinus size={14} className="text-slate-400" />Marcar inactivo</>
                      : <><UserCheck size={14} className="text-slate-400" />Marcar activo</>}
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button onClick={() => handleDelete(member)} className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3">
                    <Trash2 size={14} />Eliminar
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* ── Modal ────────────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {editingMember ? `Editar · ${editingMember.crewNumber}` : "Nuevo miembro"}
                </h2>
                {!editingMember && (
                  <p className="text-xs text-slate-400 mt-0.5">Se asignará número automáticamente</p>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">

              {/* Sección */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sección</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(CREW_SECTIONS).map((s) => {
                    const on = formData.section === s.key;
                    return (
                      <button key={s.key} type="button"
                        onClick={() => setFormData({ ...formData, section: s.key, department: "" })}
                        className={`py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          on ? `${s.borderColor} ${s.bgColor} ${s.textColor}` : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nombre + Apellido 1 + Apellido 2 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Nombre <span className="text-red-400">*</span>
                  </label>
                  <input type="text" value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="Nombre"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Apellido 1 <span className="text-red-400">*</span>
                  </label>
                  <input type="text" value={formData.lastName1}
                    onChange={(e) => setFormData({ ...formData, lastName1: e.target.value })}
                    placeholder="Primer apellido"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Apellido 2</label>
                  <input type="text" value={formData.lastName2 || ""}
                    onChange={(e) => setFormData({ ...formData, lastName2: e.target.value })}
                    placeholder="Segundo apellido"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
              </div>

              {/* Nombre artístico */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nombre artístico</label>
                <input type="text" value={formData.artisticName || ""}
                  onChange={(e) => setFormData({ ...formData, artisticName: e.target.value })}
                  placeholder="Alias o nombre de cartel"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
              </div>

              {/* Cargo + Empresa */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Cargo <span className="text-red-400">*</span>
                  </label>
                  <input type="text" value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="p.ej. Director de fotografía"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Empresa</label>
                  <input type="text" value={formData.company || ""}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Razón social"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
              </div>

              {/* Departamento */}
              {formData.section !== "cast" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Departamento</label>
                  <DepartmentSelect value={formData.department}
                    onChange={(v) => setFormData({ ...formData, department: v })}
                    options={deptOptions} placeholder="Selecciona o escribe un departamento" />
                </div>
              )}

              {/* Cast: personaje + sesiones + salario */}
              {formData.section === "cast" && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Personaje</label>
                    <input type="text" value={formData.character || ""}
                      onChange={(e) => setFormData({ ...formData, character: e.target.value })}
                      placeholder="Nombre del personaje"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nº sesiones</label>
                      <input type="number" min={0} value={formData.sessions ?? ""}
                        onChange={(e) => setFormData({ ...formData, sessions: e.target.value ? Number(e.target.value) : null })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Salario / sesión (€)</label>
                      <input type="number" min={0} value={formData.salaryPerSession ?? ""}
                        onChange={(e) => setFormData({ ...formData, salaryPerSession: e.target.value ? Number(e.target.value) : null })}
                        placeholder="0.00"
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                    </div>
                  </div>
                </>
              )}

              {/* Especialistas: igual que cast, por sesión */}
              {formData.section === "specialists" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nº sesiones</label>
                    <input type="number" min={0} value={formData.sessions ?? ""}
                      onChange={(e) => setFormData({ ...formData, sessions: e.target.value ? Number(e.target.value) : null })}
                      placeholder="0"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Salario / sesión (€)</label>
                    <input type="number" min={0} value={formData.salaryPerSession ?? ""}
                      onChange={(e) => setFormData({ ...formData, salaryPerSession: e.target.value ? Number(e.target.value) : null })}
                      placeholder="0.00"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                  </div>
                </div>
              )}

              {/* Técnicos: remuneración colapsable */}
              {formData.section === "technical" && (
                <SalarySection formData={formData} setFormData={setFormData} />
              )}

              {/* Email + Teléfono */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input type="email" value={formData.email || ""}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Teléfono</label>
                  <input type="tel" value={formData.phone || ""}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+34 600 000 000"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]" />
                </div>
              </div>

              {/* Fechas + Estado */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Fecha alta</label>
                  <input type="date" value={formData.startDate || ""}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Baja aprox.</label>
                  <input type="date" value={formData.endDateApprox || ""}
                    onChange={(e) => setFormData({ ...formData, endDateApprox: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Estado</label>
                  <CustomSelect value={formData.status}
                    onChange={(v) => setFormData({ ...formData, status: v as CrewMember["status"] })}
                    options={STATUS_MEMBER_OPTIONS} />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notas</label>
                <textarea value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Observaciones, disponibilidad, condiciones especiales"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none" />
              </div>

              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2.5">
                Los datos fiscales completos (DNI, NSS, IRPF, cuenta bancaria) se gestionan en la ficha individual de cada miembro.
              </p>
            </div>

            {/* Footer — dos acciones */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors">
                  Cancelar
                </button>
                <div className="flex-1" />
                {/* Guardar sin enviar */}
                <button onClick={handleSave} disabled={saving || !canSave}
                  className="px-4 py-2.5 border border-slate-300 text-slate-700 bg-white rounded-xl text-sm font-medium hover:bg-slate-50 disabled:opacity-40 transition-colors">
                  {saving ? "Guardando…" : editingMember ? "Guardar cambios" : "Guardar"}
                </button>
                {/* Guardar + enviar ficha */}
                <button onClick={handleSaveAndSend} disabled={sendingForm || !canSend}
                  className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: "#6BA319" }}
                  title={!formData.email?.trim() ? "Añade un email para enviar la ficha" : "Guarda y envía la ficha al miembro"}
                >
                  <Send size={14} />
                  {sendingForm ? "Enviando…" : "Guardar y enviar ficha"}
                </button>
              </div>
              {!formData.email?.trim() && canSave && (
                <p className="text-xs text-slate-400 mt-2 text-right">
                  Añade un email para poder enviar la ficha
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Send Form Modal ──────────────────────────────────────────────────── */}
      {formTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={closeSendForm}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(107,163,25,0.1)" }}>
                  <Link2 size={16} style={{ color: "#6BA319" }} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Enviar ficha de alta</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formTarget.firstName} {formTarget.lastName1} · {formTarget.role}
                  </p>
                </div>
              </div>
              <button onClick={closeSendForm} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {!generatedResult ? (
                <>
                  {/* Pre-filled preview */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl divide-y divide-slate-100 text-sm">
                    {[
                      ["Nombre", `${formTarget.firstName} ${formTarget.lastName1}${formTarget.lastName2 ? " " + formTarget.lastName2 : ""}`],
                      formTarget.email ? ["Email", formTarget.email] : null,
                      formTarget.phone ? ["Teléfono", formTarget.phone] : null,
                      ["Cargo", formTarget.role],
                      formTarget.department ? ["Departamento", formTarget.department] : null,
                    ].filter(Boolean).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between px-4 py-2.5 gap-3">
                        <span className="text-xs text-slate-400 flex-shrink-0">{label}</span>
                        <span className="text-sm text-slate-700 text-right truncate">{value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Optional message */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Mensaje para {formTarget.firstName} <span className="font-normal text-slate-400">(opcional)</span>
                    </label>
                    <textarea
                      value={formMessage}
                      onChange={(e) => setFormMessage(e.target.value)}
                      placeholder={`Hola ${formTarget.firstName}, adjunto la ficha de alta para ${projectName || "la producción"}. Rellena todos los campos y adjunta los documentos indicados. ¡Gracias!`}
                      rows={3}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none"
                    />
                  </div>

                  <p className="text-xs text-slate-400 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                    Se generará un enlace único y un código de 4 dígitos válido durante 14 días.
                  </p>
                </>
              ) : (
                /* Result */
                <div className="space-y-4">
                  <div className="text-center py-2">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: "rgba(107,163,25,0.1)" }}>
                      <Check size={22} style={{ color: "#6BA319" }} />
                    </div>
                    <h3 className="text-base font-semibold text-slate-900">¡Ficha generada!</h3>
                    <p className="text-xs text-slate-500 mt-1">Comparte el enlace y el código con {formTarget.firstName}</p>
                  </div>

                  {/* PIN */}
                  <div className="bg-slate-900 rounded-2xl p-5 text-center">
                    <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-medium">Código de acceso</p>
                    <div className="flex items-center justify-center gap-2 mb-3">
                      {generatedResult.pin.split("").map((d, i) => (
                        <div key={i} className="w-12 h-14 bg-white/10 rounded-xl flex items-center justify-center">
                          <span className="text-2xl font-bold text-white">{d}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => copyToClipboard(generatedResult.pin, "pin")}
                      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors mx-auto"
                    >
                      {copiedPin ? <Check size={11} className="text-emerald-400" /> : <ClipboardCopy size={11} />}
                      {copiedPin ? "Copiado" : "Copiar código"}
                    </button>
                  </div>

                  {/* URL */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Enlace del formulario</p>
                    <p className="text-xs text-slate-600 break-all font-mono bg-slate-50 rounded-lg px-2 py-1.5">{generatedResult.url}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(generatedResult.url, "url")}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                      >
                        {copiedUrl ? <Check size={12} className="text-emerald-500" /> : <ClipboardCopy size={12} />}
                        {copiedUrl ? "Copiado" : "Copiar enlace"}
                      </button>
                      <a
                        href={generatedResult.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
                      >
                        <ExternalLink size={12} /> Abrir
                      </a>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 text-center">
                    Válido durante 14 días · El código solo sirve para este formulario
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            {!generatedResult && (
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex gap-3">
                <button onClick={closeSendForm} className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleGenerateForm}
                  disabled={generatingForm}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: "#6BA319" }}
                >
                  {generatingForm
                    ? <><Send size={14} className="animate-pulse" /> Generando…</>
                    : <><Link2 size={14} /> Generar enlace y código</>}
                </button>
              </div>
            )}
            {generatedResult && (
              <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                <button onClick={closeSendForm} className="w-full py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors">
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Crew List Modal ──────────────────────────────────────────────────── */}
      {showCrewListModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCrewListModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col"
            style={{ maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(107,163,25,0.1)" }}>
                  <FileDown size={16} style={{ color: "#6BA319" }} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Exportar Crew List</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Ordena los departamentos antes de exportar</p>
                </div>
              </div>
              <button onClick={() => setShowCrewListModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Department list */}
            <div className="p-4 overflow-y-auto flex-1 space-y-1.5">
              {deptOrder.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">No hay miembros activos</p>
              ) : (
                deptOrder.map((dept, idx) => {
                  const count = crew.filter(
                    (m) =>
                      m.status !== "inactive" &&
                      (m.department?.trim() || CREW_SECTIONS[m.section].label) === dept
                  ).length;
                  return (
                    <div
                      key={dept}
                      className="flex items-center gap-3 px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl group"
                    >
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => moveDept(idx, -1)}
                          disabled={idx === 0}
                          className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors rounded"
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          onClick={() => moveDept(idx, 1)}
                          disabled={idx === deptOrder.length - 1}
                          className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-20 transition-colors rounded"
                        >
                          <ChevronDown size={13} />
                        </button>
                      </div>

                      <div
                        className="w-0.5 h-8 rounded-full flex-shrink-0"
                        style={{ backgroundColor: "#6BA319" }}
                      />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{dept}</p>
                        <p className="text-xs text-slate-400">{count} miembro{count !== 1 ? "s" : ""}</p>
                      </div>

                      <span className="text-xs font-mono text-slate-300 w-5 text-right">{idx + 1}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0">
              {/* PDF preview info */}
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                <div className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono truncate text-slate-500">
                  {projectName || "Proyecto"} · CREW LIST · {new Date().toLocaleDateString("es-ES")}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCrewListModal(false)}
                  className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExportPdf}
                  disabled={exportingPdf || deptOrder.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                  style={{ backgroundColor: "#6BA319" }}
                >
                  <FileDown size={15} />
                  {exportingPdf ? "Generando PDF…" : "Exportar PDF"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm ──────────────────────────────────────────────────────────── */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium">Cancelar</button>
              <button onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white ${confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}>
                {confirmDialog.confirmLabel || "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
