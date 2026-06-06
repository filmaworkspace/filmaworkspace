"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
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
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Camera,
  ChevronDown,
  Clapperboard,
  Filter,
  MailPlus,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Swords,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
  Check,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";

// ─── Constants ───────────────────────────────────────────────────────────────

const CREW_SECTIONS = {
  technical: {
    key: "technical",
    label: "Equipo Técnico",
    icon: Camera,
    bgColor: "bg-sky-50",
    textColor: "text-sky-700",
    borderColor: "border-sky-200",
  },
  cast: {
    key: "cast",
    label: "Cast",
    icon: Clapperboard,
    bgColor: "bg-violet-50",
    textColor: "text-violet-700",
    borderColor: "border-violet-200",
  },
  specialists: {
    key: "specialists",
    label: "Especialistas",
    icon: Swords,
    bgColor: "bg-amber-50",
    textColor: "text-amber-700",
    borderColor: "border-amber-200",
  },
} as const;

type CrewSection = keyof typeof CREW_SECTIONS;

const DEPARTMENTS_TECHNICAL = [
  "Producción Ejecutiva",
  "Legal",
  "Guion",
  "Dirección",
  "Producción",
  "Transportes",
  "Fotografía",
  "Arte",
  "Vestuario",
  "Maquillaje & Peluquería",
  "Sonido",
  "Eléctricos & Maquinistas",
  "Transportes Pesados",
  "VFX",
  "SFX",
  "Montaje",
  "Postproducción",
];

const DEPARTMENTS_SPECIALISTS = [
  "Especialistas de Acción",
  "Dobles",
  "Coordinación de Especialistas",
  "Pirotecnia",
  "Conducción Especializada",
];

const STATUS_OPTIONS = [
  { value: "all",      label: "Todos los estados" },
  { value: "active",   label: "Activo"            },
  { value: "inactive", label: "Inactivo"          },
  { value: "pending",  label: "Pendiente"         },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  section: CrewSection;
  // Datos básicos
  name: string;
  artisticName?: string;
  role: string;           // cargo
  department: string;
  company?: string;       // empresa
  status: "active" | "inactive" | "pending";
  // Contacto
  phone?: string;
  email?: string;
  // Cast-specific
  character?: string;     // personaje
  sessions?: number;      // nº sesiones
  salaryPerSession?: number;
  // Datos laborales (para ficha detalle más adelante)
  grossSalary?: number;
  irpfRate?: number;
  regime?: string;
  startDate?: string;
  endDateApprox?: string;
  contractReason?: string;
  // Misc
  notes?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

type FormData = Omit<CrewMember, "id" | "createdAt" | "createdBy" | "createdByName">;

const EMPTY_FORM: FormData = {
  section: "technical",
  name: "",
  artisticName: "",
  role: "",
  department: "",
  company: "",
  status: "active",
  phone: "",
  email: "",
  character: "",
  sessions: undefined,
  salaryPerSession: undefined,
  grossSalary: undefined,
  irpfRate: undefined,
  regime: "",
  startDate: "",
  endDateApprox: "",
  contractReason: "",
  notes: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponent: Custom Department Dropdown with autocomplete
// ─────────────────────────────────────────────────────────────────────────────

function DepartmentSelect({
  value,
  onChange,
  options,
  placeholder = "Seleccionar departamento",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Sync input when value changes externally (e.g. section switch)
  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        // if typed something that isn't in list, keep as custom value
        if (query && !options.includes(query)) onChange(query);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [query, options, onChange]);

  const select = (opt: string) => {
    onChange(opt);
    setQuery(opt);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] pr-8 bg-white"
      />
      <ChevronDown
        size={14}
        className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none transition-transform ${open ? "rotate-180" : ""}`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-[200] top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={() => select(opt)}
              className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors ${
                value === opt
                  ? "bg-[rgba(107,163,25,0.08)] text-[#6BA319] font-medium"
                  : "text-slate-700 hover:bg-slate-50"
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

// ─────────────────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [filteredCrew, setFilteredCrew] = useState<CrewMember[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState<CrewSection | "all">("all");
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<CrewMember | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const statusDropdownRef = useRef<HTMLDivElement>(null);

  const userId   = user?.uid   || "";
  const userName = user?.name  || "Usuario";

  // ── Data ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (userId && id) loadData();
  }, [userId, id]);

  useEffect(() => {
    filterCrew();
  }, [searchTerm, statusFilter, sectionFilter, crew]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".menu-container")) { setOpenMenuId(null); setMenuPosition(null); }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(t)) setShowStatusDropdown(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const crewSnapshot = await getDocs(
        query(collection(db, `projects/${id}/crew`), orderBy("createdAt", "desc"))
      );
      const crewData: CrewMember[] = crewSnapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          section:          data.section          || "technical",
          name:             data.name             || "",
          artisticName:     data.artisticName     || "",
          role:             data.role             || "",
          department:       data.department       || "",
          company:          data.company          || "",
          status:           data.status           || "active",
          phone:            data.phone            || "",
          email:            data.email            || "",
          character:        data.character        || "",
          sessions:         data.sessions,
          salaryPerSession: data.salaryPerSession,
          grossSalary:      data.grossSalary,
          irpfRate:         data.irpfRate,
          regime:           data.regime           || "",
          startDate:        data.startDate        || "",
          endDateApprox:    data.endDateApprox    || "",
          contractReason:   data.contractReason   || "",
          notes:            data.notes            || "",
          createdAt:        data.createdAt?.toDate() || new Date(),
          createdBy:        data.createdBy        || "",
          createdByName:    data.createdByName    || "",
        };
      });
      setCrew(crewData);
    } catch (err) {
      console.error("Error cargando crew:", err);
    } finally {
      setLoading(false);
    }
  };

  const filterCrew = () => {
    let f = [...crew];
    if (sectionFilter !== "all") f = f.filter((m) => m.section === sectionFilter);
    if (statusFilter  !== "all") f = f.filter((m) => m.status  === statusFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      f = f.filter((m) =>
        m.name.toLowerCase().includes(s)         ||
        m.role.toLowerCase().includes(s)         ||
        m.department.toLowerCase().includes(s)   ||
        m.email?.toLowerCase().includes(s)       ||
        m.character?.toLowerCase().includes(s)
      );
    }
    setFilteredCrew(f);
  };

  const closeMenu = () => { setOpenMenuId(null); setMenuPosition(null); };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const openCreate = (section?: CrewSection) => {
    setEditingMember(null);
    setFormData({
      ...EMPTY_FORM,
      section: section || (sectionFilter !== "all" ? sectionFilter : "technical"),
    });
    setShowModal(true);
  };

  const openEdit = (member: CrewMember) => {
    setEditingMember(member);
    setFormData({
      section:          member.section,
      name:             member.name,
      artisticName:     member.artisticName     || "",
      role:             member.role,
      department:       member.department,
      company:          member.company          || "",
      status:           member.status,
      phone:            member.phone            || "",
      email:            member.email            || "",
      character:        member.character        || "",
      sessions:         member.sessions,
      salaryPerSession: member.salaryPerSession,
      grossSalary:      member.grossSalary,
      irpfRate:         member.irpfRate,
      regime:           member.regime           || "",
      startDate:        member.startDate        || "",
      endDateApprox:    member.endDateApprox    || "",
      contractReason:   member.contractReason   || "",
      notes:            member.notes            || "",
    });
    setShowModal(true);
    closeMenu();
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.role.trim()) return;
    setSaving(true);
    try {
      if (editingMember) {
        await updateDoc(doc(db, `projects/${id}/crew`, editingMember.id), {
          ...formData,
          updatedAt: Timestamp.now(),
          updatedBy: userId,
        });
      } else {
        const newRef = doc(collection(db, `projects/${id}/crew`));
        await setDoc(newRef, {
          ...formData,
          createdAt:     Timestamp.now(),
          createdBy:     userId,
          createdByName: userName,
        });
      }
      await loadData();
      setShowModal(false);
    } catch (err) {
      console.error("Error guardando:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (member: CrewMember) => {
    setConfirmDialog({
      title:        "Eliminar miembro",
      message:      `¿Eliminar a ${member.name}? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger:       true,
      onConfirm: async () => {
        setConfirmDialog(null);
        await deleteDoc(doc(db, `projects/${id}/crew`, member.id));
        await loadData();
        closeMenu();
      },
    });
    closeMenu();
  };

  const handleToggleStatus = async (member: CrewMember) => {
    const next = member.status === "active" ? "inactive" : "active";
    await updateDoc(doc(db, `projects/${id}/crew`, member.id), {
      status: next, updatedAt: Timestamp.now(), updatedBy: userId,
    });
    await loadData();
    closeMenu();
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getStatusBadge = (status: CrewMember["status"]) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      active:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Activo"    },
      inactive: { bg: "bg-slate-100",  text: "text-slate-500",   label: "Inactivo"  },
      pending:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente" },
    };
    const c = map[status] || map.active;
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    );
  };

  const getStatusLabel = () => STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || "Todos los estados";

  const deptOptions = formData.section === "cast"
    ? []
    : formData.section === "specialists"
    ? DEPARTMENTS_SPECIALISTS
    : DEPARTMENTS_TECHNICAL;

  const stats = {
    total:       crew.length,
    technical:   crew.filter((m) => m.section === "technical").length,
    cast:        crew.filter((m) => m.section === "cast").length,
    specialists: crew.filter((m) => m.section === "specialists").length,
    active:      crew.filter((m) => m.status === "active").length,
  };

  // ── Guards ───────────────────────────────────────────────────────────────────
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

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">

            {/* Title */}
            <div className="flex items-center gap-4">
              <Users size={24} style={{ color: "#6BA319" }} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Crew</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {stats.active} activo{stats.active !== 1 ? "s" : ""} · {stats.total} en total
                </p>
              </div>
            </div>

            {/* Actions */}
            <button
              onClick={() => openCreate()}
              className="flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#6BA319" }}
            >
              <Plus size={15} />
              Añadir miembro
            </button>
          </div>

          {/* Section tabs */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            {(Object.values(CREW_SECTIONS)).map((section) => {
              const Icon  = section.icon;
              const count = stats[section.key as keyof typeof stats] as number;
              const active = sectionFilter === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setSectionFilter(active ? "all" : section.key)}
                  className={`p-3 rounded-xl border transition-all text-left ${
                    active
                      ? `${section.borderColor} ${section.bgColor}`
                      : "border-slate-200 hover:border-slate-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={15} className={active ? section.textColor : "text-slate-400"} />
                      <span className={`text-sm font-medium ${active ? section.textColor : "text-slate-700"}`}>
                        {section.label}
                      </span>
                    </div>
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
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, cargo, departamento…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white text-sm"
            />
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm hover:border-slate-300 bg-white min-w-[170px]"
              >
                <Filter size={13} className="text-slate-400" />
                <span className="flex-1 text-left text-xs text-slate-700">{getStatusLabel()}</span>
                <ChevronDown size={13} className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 min-w-full">
                  {STATUS_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => { setStatusFilter(o.value); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm whitespace-nowrap ${
                        statusFilter === o.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Table / Empty */}
        {filteredCrew.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all"
                ? "Sin resultados"
                : "Sin miembros aún"}
            </h3>
            <p className="text-slate-500 text-sm mb-6">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all"
                ? "Prueba a ajustar los filtros"
                : "Añade el primer miembro del equipo"}
            </p>
            {!searchTerm && statusFilter === "all" && sectionFilter === "all" && (
              <button
                onClick={() => openCreate()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90"
                style={{ backgroundColor: "#6BA319" }}
              >
                <Plus size={14} />
                Añadir miembro
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
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
                    const SI  = sc.icon;
                    const dim = member.status === "inactive";
                    return (
                      <tr
                        key={member.id}
                        onClick={() => router.push(`/project/${id}/team/crew/${member.id}`)}
                        className={`transition-colors cursor-pointer ${dim ? "opacity-50 hover:opacity-70" : "hover:bg-slate-50"}`}
                      >
                        {/* Nombre */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-600">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900 group-hover:text-[#6BA319]">
                                {member.name}
                              </p>
                              {member.artisticName && (
                                <p className="text-xs text-slate-400 mt-0.5 italic">"{member.artisticName}"</p>
                              )}
                              {member.section === "cast" && member.character && (
                                <p className="text-xs text-violet-500 mt-0.5">{member.character}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Sección */}
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sc.bgColor} ${sc.textColor}`}>
                            <SI size={11} />
                            {sc.label}
                          </span>
                        </td>

                        {/* Cargo · Depto */}
                        <td className="px-6 py-4">
                          <p className="text-sm text-slate-900 font-medium">{member.role}</p>
                          {member.department && (
                            <p className="text-xs text-slate-500 mt-0.5">{member.department}</p>
                          )}
                        </td>

                        {/* Contacto */}
                        <td className="px-6 py-4">
                          <div className="space-y-0.5">
                            {member.email && (
                              <a
                                href={`mailto:${member.email}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
                              >
                                <MailPlus size={11} className="text-slate-400" />
                                {member.email}
                              </a>
                            )}
                            {member.phone && (
                              <a
                                href={`tel:${member.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900"
                              >
                                <Phone size={11} className="text-slate-400" />
                                {member.phone}
                              </a>
                            )}
                            {!member.email && !member.phone && <span className="text-xs text-slate-400">—</span>}
                          </div>
                        </td>

                        {/* Estado */}
                        <td className="px-6 py-4">
                          {getStatusBadge(member.status)}
                        </td>

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
          <div
            className="fixed w-52 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] py-1"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            {(() => {
              const member = filteredCrew.find((m) => m.id === openMenuId);
              if (!member) return null;
              return (
                <>
                  <button
                    onClick={() => openEdit(member)}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                  >
                    <Pencil size={14} className="text-slate-400" />
                    Editar datos
                  </button>
                  <button
                    onClick={() => handleToggleStatus(member)}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                  >
                    {member.status === "active"
                      ? <><UserMinus size={14} className="text-slate-400" />Marcar inactivo</>
                      : <><UserCheck size={14} className="text-slate-400" />Marcar activo</>
                    }
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => handleDelete(member)}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                  >
                    <Trash2 size={14} />
                    Eliminar
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* ── Modal ────────────────────────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-900">
                {editingMember ? "Editar miembro" : "Nuevo miembro"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body — scrollable */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">

              {/* Sección */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sección</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(CREW_SECTIONS).map((s) => {
                    const Icon = s.icon;
                    const on   = formData.section === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setFormData({ ...formData, section: s.key, department: "" })}
                        className={`py-2.5 rounded-xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                          on
                            ? `${s.borderColor} ${s.bgColor} ${s.textColor}`
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <Icon size={13} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nombre + Nombre artístico */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Nombre <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Nombre completo"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Nombre artístico
                  </label>
                  <input
                    type="text"
                    value={formData.artisticName || ""}
                    onChange={(e) => setFormData({ ...formData, artisticName: e.target.value })}
                    placeholder="Alias o nombre de cartel"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              </div>

              {/* Cargo + Empresa */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Cargo <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="p.ej. Director de fotografía"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Empresa</label>
                  <input
                    type="text"
                    value={formData.company || ""}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Razón social"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              </div>

              {/* Departamento — solo para técnicos y especialistas */}
              {formData.section !== "cast" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Departamento</label>
                  <DepartmentSelect
                    value={formData.department}
                    onChange={(v) => setFormData({ ...formData, department: v })}
                    options={deptOptions}
                    placeholder="Selecciona o escribe un departamento"
                  />
                </div>
              )}

              {/* Cast-specific: personaje + sesiones */}
              {formData.section === "cast" && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Personaje</label>
                    <input
                      type="text"
                      value={formData.character || ""}
                      onChange={(e) => setFormData({ ...formData, character: e.target.value })}
                      placeholder="Nombre del personaje"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nº sesiones</label>
                      <input
                        type="number"
                        min={0}
                        value={formData.sessions ?? ""}
                        onChange={(e) => setFormData({ ...formData, sessions: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Salario / sesión (€)</label>
                      <input
                        type="number"
                        min={0}
                        value={formData.salaryPerSession ?? ""}
                        onChange={(e) => setFormData({ ...formData, salaryPerSession: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="0.00"
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* Email + Teléfono */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input
                    type="email"
                    value={formData.email || ""}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Teléfono</label>
                  <input
                    type="tel"
                    value={formData.phone || ""}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+34 600 000 000"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              </div>

              {/* Fechas + Estado */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Fecha alta</label>
                  <input
                    type="date"
                    value={formData.startDate || ""}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Baja aprox.</label>
                  <input
                    type="date"
                    value={formData.endDateApprox || ""}
                    onChange={(e) => setFormData({ ...formData, endDateApprox: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Estado</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as CrewMember["status"] })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                  >
                    <option value="active">Activo</option>
                    <option value="pending">Pendiente</option>
                    <option value="inactive">Inactivo</option>
                  </select>
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Notas</label>
                <textarea
                  value={formData.notes || ""}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Observaciones, disponibilidad, condiciones especiales…"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none"
                />
              </div>

              {/* Aviso ficha completa */}
              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2.5">
                Los datos fiscales y laborales completos (DNI, NSS, salario, IRPF…) se gestionan en la ficha individual de cada miembro.
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3 flex-shrink-0 rounded-b-2xl">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formData.name.trim() || !formData.role.trim()}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                {saving ? "Guardando…" : editingMember ? "Guardar cambios" : "Añadir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm ──────────────────────────────────────────────────────────── */}
      {confirmDialog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white ${
                  confirmDialog.danger ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"
                }`}
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
