"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ChevronRight,
  Clapperboard,
  ClipboardCheck,
  MailPlus,
  Plus,
  Settings,
  Shield,
  Users,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

type CrewSection = "technical" | "cast" | "specialists";

interface CrewMember {
  id: string;
  crewNumber: string;
  section: CrewSection;
  firstName: string;
  lastName1: string;
  lastName2?: string;
  artisticName?: string;
  role: string;
  department?: string;
  status: "active" | "inactive" | "pending";
  email?: string;
  character?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SECTION_CONFIG: Record<CrewSection, { label: string; bg: string; text: string; icon: typeof Users }> = {
  technical:   { label: "Equipo técnico", bg: "bg-sky-50",    text: "text-sky-700",    icon: Users      },
  cast:        { label: "Cast",           bg: "bg-violet-50", text: "text-violet-700", icon: Clapperboard },
  specialists: { label: "Especialistas",  bg: "bg-amber-50",  text: "text-amber-700",  icon: Shield     },
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  active:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Activo"    },
  inactive: { bg: "bg-slate-100",  text: "text-slate-500",   label: "Inactivo"  },
  pending:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente" },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { id } = useParams();
  const router = useRouter();

  const [loading, setLoading]           = useState(true);
  const [recentCrew, setRecentCrew]     = useState<CrewMember[]>([]);
  const [stats, setStats]               = useState({ total: 0, active: 0, technical: 0, cast: 0, specialists: 0 });
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/"); return; }
      await loadCrewData();
      setLoading(false);
    });
    return () => unsub();
  }, [id, router]);

  const loadCrewData = async () => {
    try {
      // Full list for stats
      const allSnap = await getDocs(collection(db, `projects/${id}/crew`));
      const allCrew = allSnap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          crewNumber:   v.crewNumber   || "0000",
          section:      (v.section     || "technical") as CrewSection,
          firstName:    v.firstName    || v.name || "",
          lastName1:    v.lastName1    || "",
          lastName2:    v.lastName2    || "",
          artisticName: v.artisticName || "",
          role:         v.role         || "",
          department:   v.department   || "",
          status:       v.status       || "active",
          email:        v.email        || "",
          character:    v.character    || "",
        } as CrewMember;
      });

      setStats({
        total:       allCrew.length,
        active:      allCrew.filter((m) => m.status === "active").length,
        technical:   allCrew.filter((m) => m.section === "technical").length,
        cast:        allCrew.filter((m) => m.section === "cast").length,
        specialists: allCrew.filter((m) => m.section === "specialists").length,
      });
      setPendingApprovals(allCrew.filter((m) => (m as any).approvalStatus === "pending_approval").length);

      // Recent 5 for the summary list
      const recentSnap = await getDocs(
        query(collection(db, `projects/${id}/crew`), orderBy("createdAt", "desc"), limit(5))
      );
      const recent: CrewMember[] = recentSnap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          crewNumber:   v.crewNumber   || "0000",
          section:      (v.section     || "technical") as CrewSection,
          firstName:    v.firstName    || v.name || "",
          lastName1:    v.lastName1    || "",
          lastName2:    v.lastName2    || "",
          artisticName: v.artisticName || "",
          role:         v.role         || "",
          department:   v.department   || "",
          status:       v.status       || "active",
          email:        v.email        || "",
          character:    v.character    || "",
        };
      });
      setRecentCrew(recent);
    } catch (e) {
      console.error("Error cargando crew:", e);
    }
  };

  const fullName = (m: CrewMember) =>
    [m.firstName, m.lastName1, m.lastName2].filter(Boolean).join(" ");

  const getStatusBadge = (status: string) => {
    const c = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 pt-10 pb-6">
          <div className="relative flex items-center justify-center">
            <h1 className="text-3xl font-bold text-slate-900 text-center">Panel de coordinación</h1>
          </div>
        </div>
      </div>

      <main className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">

        {/* Crew summary card — mirrors the POs/Invoices cards in AccountingPage */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex-1 lg:max-w-[50%]">

            {/* Card header */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Users size={18} style={{ color: "#6BA319" }} />
                <h3 className="font-semibold text-slate-900">Crew</h3>
                <span className="text-xs text-slate-400">reciente</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/project/${id}/team/crew/new`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                  title="Añadir miembro"
                >
                  <Plus size={16} />
                </Link>
                <Link
                  href={`/project/${id}/team/crew`}
                  className="text-xs font-medium flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  Ver todos <ChevronRight size={12} />
                </Link>
              </div>
            </div>

            {/* Section stats strip */}
            <div className="px-5 pt-4 pb-2 grid grid-cols-3 gap-3">
              {(["technical", "cast", "specialists"] as CrewSection[]).map((section) => {
                const cfg   = SECTION_CONFIG[section];
                const Icon  = cfg.icon;
                const count = stats[section];
                return (
                  <Link
                    key={section}
                    href={`/project/${id}/team/crew`}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-transparent hover:border-slate-200 transition-all ${cfg.bg}`}
                  >
                    <Icon size={14} className={cfg.text} />
                    <div>
                      <p className={`text-sm font-bold leading-none ${cfg.text}`}>{count}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-none">{cfg.label}</p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Recent members list */}
            <div className="p-5">
              {recentCrew.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Users size={24} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">Sin miembros de crew</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {recentCrew.map((member) => {
                    const sectionCfg = SECTION_CONFIG[member.section];
                    const dim        = member.status === "inactive";
                    return (
                      <Link
                        key={member.id}
                        href={`/project/${id}/team/crew/${member.id}`}
                        className="block"
                      >
                        <div
                          className={`flex items-center justify-between px-3 py-3 rounded-xl transition-colors cursor-pointer group border ${
                            dim
                              ? "bg-slate-50/60 border-slate-100 opacity-60 hover:opacity-80"
                              : "bg-slate-50 hover:bg-slate-100 border-transparent hover:border-slate-200"
                          }`}
                        >
                          {/* Avatar + name */}
                          <div className="flex items-center gap-3 flex-1 min-w-0 mr-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-600">
                              {member.firstName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-semibold text-slate-900 truncate">
                                  {fullName(member)}
                                </span>
                                {member.artisticName && (
                                  <span className="text-xs text-slate-400 italic truncate hidden sm:inline">
                                    "{member.artisticName}"
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs text-slate-500 truncate">{member.role}</p>
                                {member.section === "cast" && member.character && (
                                  <>
                                    <span className="text-slate-300">·</span>
                                    <p className="text-xs text-violet-500 truncate">{member.character}</p>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right: section badge + status + arrow */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right hidden sm:block">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${sectionCfg.bg} ${sectionCfg.text} mb-1`}
                              >
                                {sectionCfg.label}
                              </span>
                              <div>{getStatusBadge(member.status)}</div>
                            </div>
                            {member.email && (
                              <a
                                href={`mailto:${member.email}`}
                                onClick={(e) => e.preventDefault()}
                                className="p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-200 transition-colors"
                                title={member.email}
                              >
                                <MailPlus size={13} />
                              </a>
                            )}
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-[#6BA319] transition-colors" />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer summary */}
            {stats.total > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{stats.active}</span> activos
                  {" "}de{" "}
                  <span className="font-semibold text-slate-900">{stats.total}</span> miembros totales
                </span>
                <Link
                  href={`/project/${id}/team/crew`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-0.5"
                >
                  Ver crew completo <ChevronRight size={11} />
                </Link>
              </div>
            )}
          </div>

          {/* Quick links column */}
          <div className="flex flex-col gap-4 w-full lg:w-64 flex-shrink-0">

            {/* Approvals card */}
            <Link href={`/project/${id}/team/approvals`}
              className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 hover:shadow-sm transition-all group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50">
                  <ClipboardCheck size={18} className="text-amber-600" />
                </div>
                {pendingApprovals > 0 && (
                  <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-full">{pendingApprovals}</span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-[#6BA319] transition-colors">Aprobaciones</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {pendingApprovals > 0 ? `${pendingApprovals} alta${pendingApprovals > 1 ? "s" : ""} pendiente${pendingApprovals > 1 ? "s" : ""}` : "Sin altas pendientes"}
              </p>
              <div className="flex items-center gap-1 mt-3 text-xs text-slate-400 group-hover:text-[#6BA319] transition-colors">
                Ver aprobaciones <ChevronRight size={12} />
              </div>
            </Link>

            {/* Config card */}
            <Link href={`/project/${id}/team/config`}
              className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-slate-300 hover:shadow-sm transition-all group">
              <div className="flex items-center justify-between mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100">
                  <Settings size={18} className="text-slate-500" />
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-900 group-hover:text-[#6BA319] transition-colors">Configuración</p>
              <p className="text-xs text-slate-400 mt-0.5">Flujo de aprobación y permisos</p>
              <div className="flex items-center gap-1 mt-3 text-xs text-slate-400 group-hover:text-[#6BA319] transition-colors">
                Configurar <ChevronRight size={12} />
              </div>
            </Link>
          </div>
        </div>

      </main>
    </div>
  );
}
