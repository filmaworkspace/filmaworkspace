"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  Edit2,
  Flag,
  Info,
  Layers,
  LogIn,
  LogOut,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  StickyNote,
  Trash2,
  Users,
  X,
  Calendar,
  Filter,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

type EventCategory = "crew_join" | "crew_leave" | "scene" | "location" | "note" | "milestone";
type CrewSection   = "technical" | "cast" | "specialists";

interface CalendarEvent {
  id: string;
  date: string;          // "YYYY-MM-DD"
  endDate?: string;      // for multi-day events
  category: EventCategory;
  title: string;
  description?: string;
  crewMemberId?: string;
  crewMemberName?: string;
  crewSection?: CrewSection;
  location?: string;
  sceneNumber?: string;
  color?: string;
  allDay?: boolean;
  startTime?: string;    // "HH:mm"
  endTime?: string;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

interface CrewMember {
  id: string;
  crewNumber: string;
  section: CrewSection;
  firstName: string;
  lastName1: string;
  role: string;
  startDate?: string;
  endDateApprox?: string;
  status: string;
}

type ViewMode = "month" | "week";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<EventCategory, {
  label: string; color: string; bg: string; text: string;
  border: string; icon: typeof Clock; dotColor: string;
}> = {
  crew_join:  { label: "Alta crew",     color: "#22c55e", bg: "bg-emerald-50",  text: "text-emerald-700", border: "border-emerald-200", icon: LogIn,      dotColor: "bg-emerald-500" },
  crew_leave: { label: "Baja crew",     color: "#ef4444", bg: "bg-red-50",      text: "text-red-700",     border: "border-red-200",     icon: LogOut,     dotColor: "bg-red-500"     },
  scene:      { label: "Escena",        color: "#8b5cf6", bg: "bg-violet-50",   text: "text-violet-700",  border: "border-violet-200",  icon: Clapperboard, dotColor: "bg-violet-500" },
  location:   { label: "Localización",  color: "#f59e0b", bg: "bg-amber-50",    text: "text-amber-700",   border: "border-amber-200",   icon: MapPin,     dotColor: "bg-amber-500"   },
  note:       { label: "Nota",          color: "#6BA319", bg: "bg-lime-50",     text: "text-lime-700",    border: "border-lime-200",    icon: StickyNote, dotColor: "bg-lime-500"    },
  milestone:  { label: "Hito",          color: "#0ea5e9", bg: "bg-sky-50",      text: "text-sky-700",     border: "border-sky-200",     icon: Flag,       dotColor: "bg-sky-500"     },
};

const DAYS_ES   = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const EMPTY_FORM = {
  category:      "note" as EventCategory,
  title:         "",
  description:   "",
  date:          "",
  endDate:       "",
  allDay:        true,
  startTime:     "09:00",
  endTime:       "18:00",
  location:      "",
  sceneNumber:   "",
  crewMemberId:  "",
  crewMemberName:"",
  crewSection:   "" as CrewSection | "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toYMD = (d: Date) => d.toISOString().slice(0, 10);

const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return toYMD(d);
};

const isoWeekStart = (ymd: string) => {
  const d = new Date(ymd + "T12:00:00");
  const day = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - day);
  return toYMD(d);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { id } = useParams();
  const router  = useRouter();

  const [loading, setLoading]           = useState(true);
  const [userId, setUserId]             = useState("");
  const [userName, setUserName]         = useState("Usuario");
  const [events, setEvents]             = useState<CalendarEvent[]>([]);
  const [crew, setCrew]                 = useState<CrewMember[]>([]);
  const [viewMode, setViewMode]         = useState<ViewMode>("month");

  // navigation
  const [currentYear,  setCurrentYear]  = useState(() => new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth()); // 0-based
  const [weekStart,    setWeekStart]    = useState(() => isoWeekStart(toYMD(new Date())));

  // selection & modals
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent,  setEditingEvent]    = useState<CalendarEvent | null>(null);
  const [formData,      setFormData]        = useState({ ...EMPTY_FORM });
  const [saving,        setSaving]          = useState(false);
  const [openMenuId,    setOpenMenuId]      = useState<string | null>(null);
  const [menuPos,       setMenuPos]         = useState<{ top: number; left: number } | null>(null);
  const [crewSearch,    setCrewSearch]      = useState("");
  const [filterCategory, setFilterCategory] = useState<EventCategory | "all">("all");
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [sidebarEvent,  setSidebarEvent]    = useState<CalendarEvent | null>(null);

  const filterRef = useRef<HTMLDivElement>(null);

  // ── Auth + load ───────────────────────────────────────────────────────────

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/"); return; }
      setUserId(user.uid);
      setUserName(user.displayName || user.email?.split("@")[0] || "Usuario");
      await Promise.all([loadEvents(), loadCrew()]);
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".menu-container")) { setOpenMenuId(null); setMenuPos(null); }
      if (filterRef.current && !filterRef.current.contains(t)) setShowFilterMenu(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, []);

  // ── Data ─────────────────────────────────────────────────────────────────

  const loadEvents = async () => {
    try {
      const snap = await getDocs(
        query(collection(db, `projects/${id}/calendarEvents`), orderBy("date", "asc"))
      );
      const data: CalendarEvent[] = snap.docs.map((d) => {
        const v = d.data();
        return {
          id:             d.id,
          date:           v.date || "",
          endDate:        v.endDate || undefined,
          category:       v.category || "note",
          title:          v.title || "",
          description:    v.description || "",
          crewMemberId:   v.crewMemberId || "",
          crewMemberName: v.crewMemberName || "",
          crewSection:    v.crewSection || undefined,
          location:       v.location || "",
          sceneNumber:    v.sceneNumber || "",
          allDay:         v.allDay !== false,
          startTime:      v.startTime || "",
          endTime:        v.endTime || "",
          createdAt:      v.createdAt?.toDate() || new Date(),
          createdBy:      v.createdBy || "",
          createdByName:  v.createdByName || "",
        };
      });
      setEvents(data);
    } catch (e) { console.error(e); }
  };

  const loadCrew = async () => {
    try {
      const snap = await getDocs(collection(db, `projects/${id}/crew`));
      const data: CrewMember[] = snap.docs.map((d) => {
        const v = d.data();
        return {
          id:           d.id,
          crewNumber:   v.crewNumber || "0000",
          section:      v.section || "technical",
          firstName:    v.firstName || v.name || "",
          lastName1:    v.lastName1 || "",
          role:         v.role || "",
          startDate:    v.startDate || "",
          endDateApprox:v.endDateApprox || "",
          status:       v.status || "active",
        };
      });
      setCrew(data);
    } catch (e) { console.error(e); }
  };

  // Synthesise crew join/leave events from crew startDate/endDate
  const crewAutoEvents = useCallback((): CalendarEvent[] => {
    const out: CalendarEvent[] = [];
    crew.forEach((m) => {
      const name = [m.firstName, m.lastName1].filter(Boolean).join(" ");
      if (m.startDate) {
        out.push({
          id: `auto-join-${m.id}`,
          date: m.startDate,
          category: "crew_join",
          title: `Alta: ${name}`,
          description: m.role,
          crewMemberId: m.id,
          crewMemberName: name,
          crewSection: m.section,
          allDay: true,
          createdAt: new Date(),
          createdBy: "",
          createdByName: "Sistema",
        });
      }
      if (m.endDateApprox) {
        out.push({
          id: `auto-leave-${m.id}`,
          date: m.endDateApprox,
          category: "crew_leave",
          title: `Baja: ${name}`,
          description: m.role,
          crewMemberId: m.id,
          crewMemberName: name,
          crewSection: m.section,
          allDay: true,
          createdAt: new Date(),
          createdBy: "",
          createdByName: "Sistema",
        });
      }
    });
    return out;
  }, [crew]);

  const allEvents = useCallback((): CalendarEvent[] => {
    const manual = events.filter(
      (e) => filterCategory === "all" || e.category === filterCategory
    );
    const auto = (filterCategory === "all" || filterCategory === "crew_join" || filterCategory === "crew_leave")
      ? crewAutoEvents().filter((e) => filterCategory === "all" || e.category === filterCategory)
      : [];
    // deduplicate: manual events override auto for same crew+date
    const manualKeys = new Set(manual.map((e) => `${e.crewMemberId}-${e.date}-${e.category}`));
    const filteredAuto = auto.filter(
      (e) => !manualKeys.has(`${e.crewMemberId}-${e.date}-${e.category}`)
    );
    return [...manual, ...filteredAuto].sort((a, b) => a.date.localeCompare(b.date));
  }, [events, crewAutoEvents, filterCategory]);

  const eventsForDate = (ymd: string) =>
    allEvents().filter((e) => {
      if (e.endDate && e.endDate > e.date) {
        return ymd >= e.date && ymd <= e.endDate;
      }
      return e.date === ymd;
    });

  // ── CRUD ─────────────────────────────────────────────────────────────────

  const openCreate = (date?: string) => {
    setEditingEvent(null);
    setFormData({ ...EMPTY_FORM, date: date || toYMD(new Date()) });
    setCrewSearch("");
    setShowEventModal(true);
    setSidebarEvent(null);
  };

  const openEdit = (ev: CalendarEvent) => {
    if (ev.id.startsWith("auto-")) return; // can't edit auto events
    setEditingEvent(ev);
    setFormData({
      category:      ev.category,
      title:         ev.title,
      description:   ev.description || "",
      date:          ev.date,
      endDate:       ev.endDate || "",
      allDay:        ev.allDay !== false,
      startTime:     ev.startTime || "09:00",
      endTime:       ev.endTime || "18:00",
      location:      ev.location || "",
      sceneNumber:   ev.sceneNumber || "",
      crewMemberId:  ev.crewMemberId || "",
      crewMemberName:ev.crewMemberName || "",
      crewSection:   (ev.crewSection || "") as CrewSection | "",
    });
    setCrewSearch(ev.crewMemberName || "");
    setShowEventModal(true);
    setOpenMenuId(null);
    setSidebarEvent(null);
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.date) return;
    setSaving(true);
    try {
      const payload = {
        category:      formData.category,
        title:         formData.title.trim(),
        description:   formData.description.trim(),
        date:          formData.date,
        endDate:       formData.endDate || null,
        allDay:        formData.allDay,
        startTime:     formData.allDay ? null : formData.startTime,
        endTime:       formData.allDay ? null : formData.endTime,
        location:      formData.location.trim(),
        sceneNumber:   formData.sceneNumber.trim(),
        crewMemberId:  formData.crewMemberId || null,
        crewMemberName:formData.crewMemberName || null,
        crewSection:   formData.crewSection || null,
      };
      if (editingEvent) {
        await updateDoc(doc(db, `projects/${id}/calendarEvents`, editingEvent.id), {
          ...payload, updatedAt: Timestamp.now(), updatedBy: userId,
        });
      } else {
        await addDoc(collection(db, `projects/${id}/calendarEvents`), {
          ...payload, createdAt: Timestamp.now(), createdBy: userId, createdByName: userName,
        });
      }
      await loadEvents();
      setShowEventModal(false);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const handleDelete = async (ev: CalendarEvent) => {
    if (ev.id.startsWith("auto-")) return;
    if (!confirm(`¿Eliminar "${ev.title}"?`)) return;
    await deleteDoc(doc(db, `projects/${id}/calendarEvents`, ev.id));
    await loadEvents();
    setOpenMenuId(null);
    setSidebarEvent(null);
  };

  // ── Calendar grid helpers ─────────────────────────────────────────────────

  const getDaysInMonth = (year: number, month: number) => {
    const firstDay = new Date(year, month, 1, 12);
    const lastDay  = new Date(year, month + 1, 0, 12);
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0
    const days: (string | null)[] = Array(startDow).fill(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push(toYMD(new Date(year, month, d, 12)));
    }
    while (days.length % 7 !== 0) days.push(null);
    return days;
  };

  const getWeekDays = () => {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
    return days;
  };

  const navMonth = (dir: 1 | -1) => {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCurrentMonth(m);
    setCurrentYear(y);
  };

  const navWeek = (dir: 1 | -1) => {
    setWeekStart(addDays(weekStart, dir * 7));
  };

  const goToday = () => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setWeekStart(isoWeekStart(toYMD(now)));
  };

  const todayYMD = toYMD(new Date());

  // ── Crew select helpers ───────────────────────────────────────────────────

  const filteredCrew = crew.filter((m) => {
    if (!crewSearch) return true;
    const name = [m.firstName, m.lastName1].join(" ").toLowerCase();
    return name.includes(crewSearch.toLowerCase()) || m.role.toLowerCase().includes(crewSearch.toLowerCase());
  });

  const selectCrewMember = (m: CrewMember) => {
    const name = [m.firstName, m.lastName1].join(" ");
    setFormData((f) => ({
      ...f,
      crewMemberId:   m.id,
      crewMemberName: name,
      crewSection:    m.section,
      title: (f.category === "crew_join" || f.category === "crew_leave")
        ? (f.category === "crew_join" ? `Alta: ${name}` : `Baja: ${name}`)
        : f.title,
    }));
    setCrewSearch(name);
  };

  // ── Category icon ─────────────────────────────────────────────────────────

  const CategoryIcon = ({ cat, size = 12 }: { cat: EventCategory; size?: number }) => {
    const Icon = CATEGORY_CONFIG[cat].icon;
    return <Icon size={size} />;
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-[#6BA319] rounded-full animate-spin" />
      </div>
    );
  }

  const monthDays  = getDaysInMonth(currentYear, currentMonth);
  const weekDays   = getWeekDays();
  const crewEvents = crewAutoEvents();

  // Active category filter label
  const filterLabel = filterCategory === "all"
    ? "Todos"
    : CATEGORY_CONFIG[filterCategory].label;

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">

            <div className="flex items-center gap-3">
              <Calendar size={24} style={{ color: "#6BA319" }} />
              <h1 className="text-2xl font-semibold text-slate-900">Calendario de producción</h1>
            </div>

            <div className="flex items-center gap-2">
              {/* Filter */}
              <div className="relative" ref={filterRef}>
                <button
                  onClick={() => setShowFilterMenu(!showFilterMenu)}
                  className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-sm transition-colors ${
                    filterCategory !== "all"
                      ? "border-[#6BA319] bg-[rgba(107,163,25,0.06)] text-[#6BA319]"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <Filter size={13} />
                  <span className="text-xs font-medium">{filterLabel}</span>
                  <ChevronRight size={12} className={`transition-transform ${showFilterMenu ? "rotate-90" : ""}`} />
                </button>
                {showFilterMenu && (
                  <div className="absolute right-0 top-full mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-1 min-w-[170px]">
                    <button
                      onClick={() => { setFilterCategory("all"); setShowFilterMenu(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 ${filterCategory === "all" ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
                    >
                      <Layers size={13} className="text-slate-400" /> Todos
                    </button>
                    <div className="border-t border-slate-100 my-1" />
                    {(Object.entries(CATEGORY_CONFIG) as [EventCategory, typeof CATEGORY_CONFIG[EventCategory]][]).map(([key, cfg]) => {
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={key}
                          onClick={() => { setFilterCategory(key); setShowFilterMenu(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 ${filterCategory === key ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
                        >
                          <Icon size={13} className={cfg.text} />
                          <span className={filterCategory === key ? cfg.text : "text-slate-700"}>{cfg.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* View toggle */}
              <div className="flex border border-slate-200 rounded-xl overflow-hidden">
                {(["month", "week"] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-3 py-2 text-xs font-medium transition-colors capitalize ${
                      viewMode === v
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {v === "month" ? "Mes" : "Semana"}
                  </button>
                ))}
              </div>

              <button
                onClick={goToday}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Hoy
              </button>

              <button
                onClick={() => openCreate()}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                <Plus size={15} />
                Nuevo evento
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pb-16">

        {/* ─ Nav row ─ */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => viewMode === "month" ? navMonth(-1) : navWeek(-1)}
              className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-xl font-bold text-slate-900 min-w-[220px] text-center">
              {viewMode === "month"
                ? `${MONTHS_ES[currentMonth]} ${currentYear}`
                : (() => {
                    const wd = getWeekDays();
                    const s  = new Date(wd[0] + "T12:00:00");
                    const e  = new Date(wd[6] + "T12:00:00");
                    return `${s.getDate()} ${MONTHS_ES[s.getMonth()].slice(0,3)} – ${e.getDate()} ${MONTHS_ES[e.getMonth()].slice(0,3)} ${e.getFullYear()}`;
                  })()
              }
            </h2>
            <button
              onClick={() => viewMode === "month" ? navMonth(1) : navWeek(1)}
              className="p-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Crew stats strip */}
          <div className="hidden lg:flex items-center gap-3">
            {(["technical","cast","specialists"] as CrewSection[]).map((sec) => {
              const count = crew.filter((m) => m.section === sec && m.status === "active").length;
              const colors: Record<CrewSection,string> = { technical: "text-sky-600 bg-sky-50", cast: "text-violet-600 bg-violet-50", specialists: "text-amber-600 bg-amber-50" };
              const labels: Record<CrewSection,string> = { technical: "Técnico", cast: "Cast", specialists: "Especialistas" };
              return (
                <Link
                  key={sec}
                  href={`/project/${id}/team/crew`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${colors[sec]} transition-opacity hover:opacity-80`}
                >
                  <Users size={11} />
                  {count} {labels[sec]}
                </Link>
              );
            })}
          </div>
        </div>

        {/* ─── MONTH VIEW ─────────────────────────────────────────────────── */}
        {viewMode === "month" && (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {DAYS_ES.map((d) => (
                <div key={d} className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {monthDays.map((ymd, idx) => {
                const dayEvents = ymd ? eventsForDate(ymd) : [];
                const isToday   = ymd === todayYMD;
                const isSelected = ymd === selectedDate;
                const isWeekend = idx % 7 >= 5;

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (!ymd) return;
                      setSelectedDate(isSelected ? null : ymd);
                      setSidebarEvent(null);
                    }}
                    className={`min-h-[110px] border-r border-b border-slate-100 p-2 cursor-pointer transition-colors group
                      ${!ymd ? "bg-slate-50/60" : ""}
                      ${isWeekend && ymd ? "bg-slate-50/40" : ""}
                      ${isSelected ? "bg-[rgba(107,163,25,0.05)] ring-1 ring-inset ring-[#6BA319]/30" : "hover:bg-slate-50/70"}
                    `}
                  >
                    {ymd && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                            isToday
                              ? "bg-[#6BA319] text-white"
                              : "text-slate-700 group-hover:bg-slate-100"
                          }`}>
                            {new Date(ymd + "T12:00:00").getDate()}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); openCreate(ymd); }}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-slate-600 rounded transition-all"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <div className="space-y-0.5">
                          {dayEvents.slice(0, 3).map((ev) => {
                            const cfg = CATEGORY_CONFIG[ev.category];
                            return (
                              <button
                                key={ev.id}
                                onClick={(e) => { e.stopPropagation(); setSidebarEvent(ev); setSelectedDate(ymd); }}
                                className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 truncate ${cfg.bg} ${cfg.text} hover:opacity-80 transition-opacity`}
                              >
                                <CategoryIcon cat={ev.category} size={9} />
                                <span className="truncate">{ev.title}</span>
                              </button>
                            );
                          })}
                          {dayEvents.length > 3 && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setSelectedDate(ymd); setSidebarEvent(null); }}
                              className="w-full text-left px-1.5 py-0.5 text-[10px] text-slate-500 font-medium hover:text-slate-700"
                            >
                              +{dayEvents.length - 3} más
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── WEEK VIEW ──────────────────────────────────────────────────── */}
        {viewMode === "week" && (
          <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {weekDays.map((ymd) => {
                const d       = new Date(ymd + "T12:00:00");
                const isToday = ymd === todayYMD;
                return (
                  <div key={ymd} className="px-3 py-3 text-center border-r border-slate-100 last:border-r-0">
                    <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                      {DAYS_ES[(d.getDay() + 6) % 7]}
                    </p>
                    <span className={`text-sm font-bold w-8 h-8 mx-auto flex items-center justify-center rounded-full ${
                      isToday ? "bg-[#6BA319] text-white" : "text-slate-800"
                    }`}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-7">
              {weekDays.map((ymd, idx) => {
                const dayEvents  = eventsForDate(ymd);
                const isToday    = ymd === todayYMD;
                const isSelected = ymd === selectedDate;
                const isWeekend  = idx >= 5;

                return (
                  <div
                    key={ymd}
                    onClick={() => { setSelectedDate(isSelected ? null : ymd); setSidebarEvent(null); }}
                    className={`min-h-[300px] border-r border-slate-100 last:border-r-0 p-3 cursor-pointer transition-colors group
                      ${isWeekend ? "bg-slate-50/40" : ""}
                      ${isSelected ? "bg-[rgba(107,163,25,0.05)] ring-1 ring-inset ring-[#6BA319]/30" : "hover:bg-slate-50/60"}
                    `}
                  >
                    <div className="flex justify-end mb-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); openCreate(ymd); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-all"
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <div className="space-y-1">
                      {dayEvents.map((ev) => {
                        const cfg = CATEGORY_CONFIG[ev.category];
                        const Icon = cfg.icon;
                        return (
                          <button
                            key={ev.id}
                            onClick={(e) => { e.stopPropagation(); setSidebarEvent(ev); setSelectedDate(ymd); }}
                            className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium border ${cfg.bg} ${cfg.text} ${cfg.border} hover:opacity-80 transition-opacity`}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Icon size={11} />
                              <span className="truncate">{ev.title}</span>
                            </div>
                            {!ev.allDay && ev.startTime && (
                              <p className="text-[10px] opacity-70 flex items-center gap-1">
                                <Clock size={9} /> {ev.startTime}{ev.endTime ? `–${ev.endTime}` : ""}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── Day detail panel (shown when date is selected) ─────────────── */}
        {selectedDate && !sidebarEvent && (
          <div className="mt-6 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-sm">
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </h3>
                <span className="text-xs text-slate-400">
                  {eventsForDate(selectedDate).length} evento{eventsForDate(selectedDate).length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openCreate(selectedDate)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "#6BA319" }}
                >
                  <Plus size={12} /> Añadir
                </button>
                <button onClick={() => setSelectedDate(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors">
                  <X size={14} />
                </button>
              </div>
            </div>

            {eventsForDate(selectedDate).length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-slate-400">Sin eventos este día</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {eventsForDate(selectedDate).map((ev) => {
                  const cfg  = CATEGORY_CONFIG[ev.category];
                  const Icon = cfg.icon;
                  const isAuto = ev.id.startsWith("auto-");
                  return (
                    <div key={ev.id} className="px-5 py-3.5 flex items-center gap-4 group hover:bg-slate-50 transition-colors">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                        <Icon size={15} className={cfg.text} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">{ev.title}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>
                            {cfg.label}
                          </span>
                          {isAuto && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-500">
                              Auto
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {ev.description && <p className="text-xs text-slate-500 truncate">{ev.description}</p>}
                          {ev.location && (
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <MapPin size={10} /> {ev.location}
                            </span>
                          )}
                          {ev.sceneNumber && (
                            <span className="flex items-center gap-1 text-xs text-violet-600">
                              <Clapperboard size={10} /> Esc. {ev.sceneNumber}
                            </span>
                          )}
                          {!ev.allDay && ev.startTime && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Clock size={10} /> {ev.startTime}{ev.endTime ? `–${ev.endTime}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      {!isAuto && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(ev)}
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(ev)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                      {isAuto && ev.crewMemberId && (
                        <Link
                          href={`/project/${id}/team/crew/${ev.crewMemberId}`}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <ChevronRight size={14} />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Event sidebar detail ─────────────────────────────────────────── */}
        {sidebarEvent && (
          <div className="mt-6">
            {(() => {
              const ev   = sidebarEvent;
              const cfg  = CATEGORY_CONFIG[ev.category];
              const Icon = cfg.icon;
              const isAuto = ev.id.startsWith("auto-");
              return (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm max-w-lg">
                  <div className={`px-5 py-4 ${cfg.bg} border-b ${cfg.border} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-white/60 backdrop-blur`}>
                        <Icon size={18} className={cfg.text} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{ev.title}</p>
                        <p className={`text-xs ${cfg.text} font-medium`}>{cfg.label}{isAuto ? " · Auto" : ""}</p>
                      </div>
                    </div>
                    <button onClick={() => setSidebarEvent(null)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-white/50 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Calendar size={13} className="text-slate-400" />
                      {new Date(ev.date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
                      {ev.endDate && ev.endDate !== ev.date && (
                        <> → {new Date(ev.endDate + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" })}</>
                      )}
                    </div>
                    {!ev.allDay && ev.startTime && (
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <Clock size={13} className="text-slate-400" />
                        {ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ""}
                      </div>
                    )}
                    {ev.description && (
                      <p className="text-sm text-slate-600 leading-relaxed">{ev.description}</p>
                    )}
                    {ev.location && (
                      <div className="flex items-center gap-2 text-sm text-amber-700">
                        <MapPin size={13} className="text-amber-500" />
                        {ev.location}
                      </div>
                    )}
                    {ev.sceneNumber && (
                      <div className="flex items-center gap-2 text-sm text-violet-700">
                        <Clapperboard size={13} className="text-violet-500" />
                        Escena {ev.sceneNumber}
                      </div>
                    )}
                    {ev.crewMemberName && (
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <Users size={13} className="text-slate-400" />
                        {ev.crewMemberName}
                        {ev.crewSection && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${
                            ev.crewSection === "technical" ? "bg-sky-50 text-sky-600"
                            : ev.crewSection === "cast" ? "bg-violet-50 text-violet-600"
                            : "bg-amber-50 text-amber-600"
                          }`}>
                            {ev.crewSection === "technical" ? "Técnico" : ev.crewSection === "cast" ? "Cast" : "Especialista"}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <p className="text-xs text-slate-400">{ev.createdByName}</p>
                      {!isAuto && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(ev)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                            <Edit2 size={11} /> Editar
                          </button>
                          <button onClick={() => handleDelete(ev)} className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={11} /> Eliminar
                          </button>
                        </div>
                      )}
                      {isAuto && ev.crewMemberId && (
                        <Link href={`/project/${id}/team/crew/${ev.crewMemberId}`} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                          Ver ficha <ChevronRight size={11} />
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

      </main>

      {/* ── Event Modal ──────────────────────────────────────────────────── */}
      {showEventModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowEventModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-900">
                {editingEvent ? "Editar evento" : "Nuevo evento"}
              </h2>
              <button
                onClick={() => setShowEventModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">

              {/* Category picker */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Tipo de evento
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(CATEGORY_CONFIG) as [EventCategory, typeof CATEGORY_CONFIG[EventCategory]][]).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const on   = formData.category === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setFormData((f) => ({ ...f, category: key }))}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          on
                            ? `${cfg.border} ${cfg.bg} ${cfg.text}`
                            : "border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <Icon size={13} />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Título <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Descripción breve del evento"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  autoFocus
                />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Fecha <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData((f) => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Fecha fin <span className="text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData((f) => ({ ...f, endDate: e.target.value }))}
                    min={formData.date}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                  />
                </div>
              </div>

              {/* All day + time */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={formData.allDay}
                    onChange={(e) => setFormData((f) => ({ ...f, allDay: e.target.checked }))}
                    className="w-4 h-4 accent-[#6BA319] rounded"
                  />
                  <span className="text-sm font-medium text-slate-700">Todo el día</span>
                </label>
                {!formData.allDay && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Hora inicio</label>
                      <input type="time" value={formData.startTime}
                        onChange={(e) => setFormData((f) => ({ ...f, startTime: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Hora fin</label>
                      <input type="time" value={formData.endTime}
                        onChange={(e) => setFormData((f) => ({ ...f, endTime: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Scene + Location */}
              {(formData.category === "scene" || formData.category === "location") && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <Clapperboard size={11} className="inline mr-1" />Nº escena
                    </label>
                    <input
                      type="text"
                      value={formData.sceneNumber}
                      onChange={(e) => setFormData((f) => ({ ...f, sceneNumber: e.target.value }))}
                      placeholder="p.ej. 12A"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <MapPin size={11} className="inline mr-1" />Localización
                    </label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData((f) => ({ ...f, location: e.target.value }))}
                      placeholder="Nombre o dirección"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                    />
                  </div>
                </div>
              )}

              {/* Location only field */}
              {formData.category === "note" || formData.category === "milestone" ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    <MapPin size={11} className="inline mr-1" />Localización <span className="text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Lugar del evento"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                  />
                </div>
              ) : null}

              {/* Crew member picker */}
              {(formData.category === "crew_join" || formData.category === "crew_leave" || formData.category === "scene") && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    <Users size={11} className="inline mr-1" />
                    {formData.category === "scene" ? "Miembro crew (opcional)" : "Miembro crew"}
                  </label>
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={crewSearch}
                      onChange={(e) => { setCrewSearch(e.target.value); setFormData((f) => ({ ...f, crewMemberId: "", crewMemberName: "", crewSection: "" })); }}
                      placeholder="Buscar por nombre o cargo"
                      className="w-full pl-8 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319]"
                    />
                  </div>
                  {crewSearch && !formData.crewMemberId && filteredCrew.length > 0 && (
                    <div className="mt-1 border border-slate-200 rounded-xl overflow-hidden shadow-sm max-h-36 overflow-y-auto">
                      {filteredCrew.slice(0, 8).map((m) => {
                        const name = [m.firstName, m.lastName1].join(" ");
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectCrewMember(m)}
                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2.5 border-b border-slate-100 last:border-b-0"
                          >
                            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                              {m.firstName.charAt(0)}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900 text-xs">{name}</p>
                              <p className="text-[10px] text-slate-500">{m.role}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {formData.crewMemberId && (
                    <p className="mt-1 text-xs text-[#6BA319] flex items-center gap-1">
                      <Users size={10} /> Seleccionado: {formData.crewMemberName}
                    </p>
                  )}
                </div>
              )}

              {/* Description / Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Notas / Descripción
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Detalles adicionales, instrucciones, observaciones"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6BA319] resize-none"
                />
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex-shrink-0 flex items-center gap-3">
              <button
                onClick={() => setShowEventModal(false)}
                className="px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-white text-sm font-medium transition-colors"
              >
                Cancelar
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSave}
                disabled={saving || !formData.title.trim() || !formData.date}
                className="px-5 py-2.5 text-white rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: "#6BA319" }}
              >
                {saving ? "Guardando…" : editingEvent ? "Guardar cambios" : "Crear evento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
