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
  Shield,
  ShieldAlert,
  Swords,
  Trash2,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
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
    dotColor: "bg-sky-500",
  },
  cast: {
    key: "cast",
    label: "Cast",
    icon: Clapperboard,
    bgColor: "bg-violet-50",
    textColor: "text-violet-700",
    borderColor: "border-violet-200",
    dotColor: "bg-violet-500",
  },
  specialists: {
    key: "specialists",
    label: "Especialistas",
    icon: Swords,
    bgColor: "bg-amber-50",
    textColor: "text-amber-700",
    borderColor: "border-amber-200",
    dotColor: "bg-amber-500",
  },
} as const;

type CrewSection = keyof typeof CREW_SECTIONS;

const STATUS_OPTIONS = [
  { value: "all",      label: "Todos los estados" },
  { value: "active",   label: "Activo"            },
  { value: "inactive", label: "Inactivo"          },
  { value: "pending",  label: "Pendiente"         },
];

const EMPTY_FORM: Omit<CrewMember, "id" | "createdAt" | "createdBy" | "createdByName"> = {
  section: "technical",
  name: "",
  role: "",
  department: "",
  phone: "",
  email: "",
  notes: "",
  status: "active",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  section: CrewSection;
  name: string;
  role: string;
  department: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: "active" | "inactive" | "pending";
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { user, isLoading: userLoading } = useUser();

  const [projectName, setProjectName] = useState("");
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
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const userId      = user?.uid || "";
  const userName    = user?.name || "Usuario";
  const canManage   = user?.role === "admin"; // ajustar según permisos reales

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (userId && id) loadData();
  }, [userId, id]);

  useEffect(() => {
    filterCrew();
  }, [searchTerm, statusFilter, sectionFilter, crew]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".menu-container")) {
        setOpenMenuId(null);
        setMenuPosition(null);
      }
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setShowStatusDropdown(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const projectDoc = await getDoc(doc(db, "projects", id));
      if (projectDoc.exists()) setProjectName(projectDoc.data().name || "Proyecto");

      const crewSnapshot = await getDocs(
        query(collection(db, `projects/${id}/crew`), orderBy("createdAt", "desc"))
      );
      const crewData: CrewMember[] = crewSnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id:            docSnap.id,
          section:       data.section      || "technical",
          name:          data.name         || "",
          role:          data.role         || "",
          department:    data.department   || "",
          phone:         data.phone        || "",
          email:         data.email        || "",
          notes:         data.notes        || "",
          status:        data.status       || "active",
          createdAt:     data.createdAt?.toDate() || new Date(),
          createdBy:     data.createdBy    || "",
          createdByName: data.createdByName || "",
        };
      });

      setCrew(crewData);
    } catch (error) {
      console.error("Error cargando crew:", error);
    } finally {
      setLoading(false);
    }
  };

  const filterCrew = () => {
    let filtered = [...crew];
    if (sectionFilter !== "all") filtered = filtered.filter((m) => m.section === sectionFilter);
    if (statusFilter !== "all")  filtered = filtered.filter((m) => m.status === statusFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(s)       ||
          m.role.toLowerCase().includes(s)       ||
          m.department.toLowerCase().includes(s) ||
          m.email?.toLowerCase().includes(s)
      );
    }
    setFilteredCrew(filtered);
  };

  const closeMenu = () => {
    setOpenMenuId(null);
    setMenuPosition(null);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingMember(null);
    setFormData({
      ...EMPTY_FORM,
      section: sectionFilter !== "all" ? sectionFilter : "technical",
    });
    setShowModal(true);
  };

  const openEdit = (member: CrewMember) => {
    setEditingMember(member);
    setFormData({
      section:    member.section,
      name:       member.name,
      role:       member.role,
      department: member.department,
      phone:      member.phone || "",
      email:      member.email || "",
      notes:      member.notes || "",
      status:     member.status,
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
    } catch (error) {
      console.error("Error guardando miembro:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (member: CrewMember) => {
    setConfirmDialog({
      title:         "Eliminar miembro",
      message:       `¿Eliminar a ${member.name} del crew? Esta acción no se puede deshacer.`,
      confirmLabel:  "Eliminar",
      danger:        true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await deleteDoc(doc(db, `projects/${id}/crew`, member.id));
          await loadData();
        } catch (error) {
          console.error("Error eliminando miembro:", error);
        }
        closeMenu();
      },
    });
    closeMenu();
  };

  const handleToggleStatus = async (member: CrewMember) => {
    const newStatus = member.status === "active" ? "inactive" : "active";
    try {
      await updateDoc(doc(db, `projects/${id}/crew`, member.id), {
        status:    newStatus,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      await loadData();
    } catch (error) {
      console.error("Error actualizando estado:", error);
    }
    closeMenu();
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const getStatusBadge = (status: CrewMember["status"]) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      active:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Activo"     },
      inactive: { bg: "bg-slate-100",  text: "text-slate-500",   label: "Inactivo"   },
      pending:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente"  },
    };
    const c = config[status] || config.active;
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    );
  };

  const getStatusLabel = () => STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label || "Todos los estados";

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
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(107, 163, 25, 0.1)" }}
              >
                <Users size={22} style={{ color: "#6BA319" }} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Crew</h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  {stats.active} miembro{stats.active !== 1 ? "s" : ""} activo{stats.active !== 1 ? "s" : ""} · {stats.total} en total
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                <UserPlus size={16} strokeWidth={2.5} />
                Añadir miembro
              </button>
            </div>
          </div>

          {/* Section stats */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            {(Object.values(CREW_SECTIONS)).map((section) => {
              const Icon  = section.icon;
              const count = section.key === "technical" ? stats.technical
                          : section.key === "cast"      ? stats.cast
                          : stats.specialists;
              const isActive = sectionFilter === section.key;
              return (
                <button
                  key={section.key}
                  onClick={() => setSectionFilter(isActive ? "all" : section.key)}
                  className={`p-3 rounded-xl border transition-all ${
                    isActive
                      ? `${section.borderColor} ${section.bgColor}`
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} className={isActive ? section.textColor : "text-slate-400"} />
                    <span className={`text-sm font-medium ${isActive ? section.textColor : "text-slate-700"}`}>
                      {section.label}
                    </span>
                    <span className={`ml-auto text-sm font-semibold ${isActive ? section.textColor : "text-slate-900"}`}>
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
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nombre, rol, departamento…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white text-sm"
            />
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {/* Status Dropdown */}
            <div className="relative" ref={statusDropdownRef}>
              <button
                onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                className="flex items-center gap-2 px-3 py-2.5 border border-slate-200 rounded-xl text-sm hover:border-slate-300 bg-white min-w-[180px]"
              >
                <Filter size={14} className="text-slate-400" />
                <span className="flex-1 text-left text-xs text-slate-700">{getStatusLabel()}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showStatusDropdown ? "rotate-180" : ""}`} />
              </button>
              {showStatusDropdown && (
                <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => { setStatusFilter(option.value); setShowStatusDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        statusFilter === option.value ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Table or empty state */}
        {filteredCrew.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users size={28} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all"
                ? "No se encontraron resultados"
                : "Sin miembros en el crew"}
            </h3>
            <p className="text-slate-500 text-sm mb-6">
              {searchTerm || statusFilter !== "all" || sectionFilter !== "all"
                ? "Prueba a ajustar los filtros de búsqueda"
                : "Añade el primer miembro del equipo"}
            </p>
            {!searchTerm && statusFilter === "all" && sectionFilter === "all" && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                <UserPlus size={16} />
                Añadir miembro
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl">
            <div className="overflow-x-auto rounded-2xl">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Miembro</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sección</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Rol / Depto.</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contacto</th>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCrew.map((member) => {
                    const sectionConfig = CREW_SECTIONS[member.section];
                    const SectionIcon   = sectionConfig.icon;
                    return (
                      <tr
                        key={member.id}
                        className={`transition-colors ${
                          member.status === "inactive" ? "opacity-60 hover:opacity-80" : "hover:bg-slate-50"
                        }`}
                      >
                        {/* Nombre */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-slate-600">
                              {member.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                              {member.notes && (
                                <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{member.notes}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Sección */}
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${sectionConfig.bgColor} ${sectionConfig.textColor}`}>
                            <SectionIcon size={11} />
                            {sectionConfig.label}
                          </span>
                        </td>

                        {/* Rol / Departamento */}
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
                                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MailPlus size={11} className="text-slate-400" />
                                {member.email}
                              </a>
                            )}
                            {member.phone && (
                              <a
                                href={`tel:${member.phone}`}
                                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Phone size={11} className="text-slate-400" />
                                {member.phone}
                              </a>
                            )}
                            {!member.email && !member.phone && (
                              <span className="text-xs text-slate-400">—</span>
                            )}
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
                                if (openMenuId === member.id) {
                                  setOpenMenuId(null);
                                  setMenuPosition(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setMenuPosition({ top: rect.bottom + 4, left: rect.right - 208 });
                                  setOpenMenuId(member.id);
                                }
                              }}
                              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                              <MoreHorizontal size={18} />
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
                    <Pencil size={15} className="text-slate-400" />
                    Editar
                  </button>
                  <button
                    onClick={() => handleToggleStatus(member)}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-3"
                  >
                    {member.status === "active"
                      ? <><UserMinus size={15} className="text-slate-400" />Marcar como inactivo</>
                      : <><UserCheck size={15} className="text-slate-400" />Marcar como activo</>
                    }
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={() => handleDelete(member)}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                  >
                    <Trash2 size={15} />
                    Eliminar
                  </button>
                </>
              );
            })()}
          </div>
        )}
      </main>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {editingMember ? "Editar miembro" : "Añadir miembro"}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-6 space-y-4">
              {/* Sección */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-2">Sección</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.values(CREW_SECTIONS)).map((section) => {
                    const Icon     = section.icon;
                    const isActive = formData.section === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setFormData({ ...formData, section: section.key })}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all ${
                          isActive
                            ? `${section.borderColor} ${section.bgColor} ${section.textColor}`
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <Icon size={16} />
                        {section.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Nombre + Rol */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">
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
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">
                    Rol / Cargo <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="p.ej. Director de fotografía"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              </div>

              {/* Departamento + Estado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Departamento</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    placeholder="p.ej. Cámara"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Estado</label>
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

              {/* Email + Teléfono */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Teléfono</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+34 600 000 000"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              </div>

              {/* Notas */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase mb-1.5">Notas</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Observaciones, disponibilidad, condiciones…"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3 rounded-b-2xl">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white font-medium text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formData.name.trim() || !formData.role.trim()}
                className="px-5 py-2.5 text-white rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                {saving ? "Guardando…" : editingMember ? "Guardar cambios" : "Añadir miembro"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ───────────────────────────────────────────────────── */}
      {confirmDialog && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmDialog(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
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
                className={`flex-1 px-4 py-2.5 rounded-xl font-medium text-sm text-white ${
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
