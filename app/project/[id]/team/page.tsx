"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import {
  collection, doc, getDocs, getDoc, limit, orderBy, query,
} from "firebase/firestore";
import {
  ArrowRight, ChevronRight, Clapperboard,
  ClipboardCheck, Clock, MailPlus, Plus, Settings, Shield, Users,
} from "lucide-react";

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
  approvalStatus?: string;
  email?: string;
  character?: string;
  photoUrl?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const SECTION_CONFIG: Record<CrewSection, { label: string; bg: string; text: string; icon: typeof Users }> = {
  technical:   { label: "Técnico",       bg: "bg-sky-50",    text: "text-sky-700",    icon: Users       },
  cast:        { label: "Cast",           bg: "bg-violet-50", text: "text-violet-700", icon: Clapperboard },
  specialists: { label: "Especialistas",  bg: "bg-amber-50",  text: "text-amber-700",  icon: Shield      },
};

const STATUS_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  active:   { bg: "bg-emerald-50", text: "text-emerald-700", label: "Activo"    },
  inactive: { bg: "bg-slate-100",  text: "text-slate-500",   label: "Inactivo"  },
  pending:  { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pendiente" },
};

const APPROVAL_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  draft:            { bg: "bg-slate-100",  text: "text-slate-500",   label: "Borrador"   },
  pending_approval: { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pend. aprob." },
  approved:         { bg: "bg-emerald-50", text: "text-emerald-700", label: "Aprobada"   },
  rejected:         { bg: "bg-red-50",     text: "text-red-700",     label: "Rechazada"  },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const { id } = useParams();

  const [loading, setLoading]                   = useState(true);
  const [recentCrew, setRecentCrew]             = useState<CrewMember[]>([]);
  const [stats, setStats]                       = useState({ total: 0, active: 0, technical: 0, cast: 0, specialists: 0 });
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) return;
      await loadData();
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  const loadData = async () => {
    try {
      const allSnap = await getDocs(collection(db, `projects/${id}/crew`));
      const all: CrewMember[] = allSnap.docs.map((d) => {
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
          approvalStatus: v.approvalStatus || undefined,
          email:        v.email        || "",
          character:    v.character    || "",
          photoUrl:     v.photoUrl     || "",
        };
      });

      setStats({
        total:       all.length,
        active:      all.filter((m) => m.status === "active").length,
        technical:   all.filter((m) => m.section === "technical").length,
        cast:        all.filter((m) => m.section === "cast").length,
        specialists: all.filter((m) => m.section === "specialists").length,
      });
      setPendingApprovals(all.filter((m) => m.approvalStatus === "pending_approval").length);

      const recentSnap = await getDocs(
        query(collection(db, `projects/${id}/crew`), orderBy("createdAt", "desc"), limit(6))
      );
      setRecentCrew(recentSnap.docs.map((d) => {
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
          approvalStatus: v.approvalStatus || undefined,
          email:        v.email        || "",
          character:    v.character    || "",
          photoUrl:     v.photoUrl     || "",
        };
      }));
    } catch (e) { console.error(e); }
  };

  const fullName = (m: CrewMember) =>
    [m.firstName, m.lastName1, m.lastName2].filter(Boolean).join(" ");

  const getStatusBadge = (m: CrewMember) => {
    if (m.approvalStatus && m.approvalStatus !== "approved") {
      const c = APPROVAL_CONFIG[m.approvalStatus] || APPROVAL_CONFIG.draft;
      return <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
    }
    const c = STATUS_CONFIG[m.status] || STATUS_CONFIG.active;
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>;
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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-6">
          <div className="relative flex items-center justify-center">
            <h1 className="text-3xl font-bold text-slate-900 text-center">Panel de coordinación</h1>

            {/* Icons top-right */}
            <div className="absolute right-0 flex items-center gap-1">
              <Link href={`/project/${id}/team/approvals`}
                className="relative p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                title="Aprobaciones">
                <ClipboardCheck size={18} />
                {pendingApprovals > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: TEAM_COLOR }} />
                )}
              </Link>
              <Link href={`/project/${id}/team/config`}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                title="Configuración">
                <Settings size={18} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <main className="px-24 py-8">

        {/* ── Pending approvals banner ──────────────────────────────────────── */}
        {pendingApprovals > 0 && (
          <Link href={`/project/${id}/team/approvals`}>
            <div className="mb-8 rounded-2xl p-5 cursor-pointer hover:shadow-lg transition-shadow"
              style={{ background: `linear-gradient(to right, ${TEAM_COLOR}, #4a7a10)` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                    <Clock size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {pendingApprovals} alta{pendingApprovals !== 1 ? "s" : ""} pendiente{pendingApprovals !== 1 ? "s" : ""} de aprobación
                    </h3>
                    <p className="text-white/80 text-sm">Revisa y aprueba para activar los miembros</p>
                  </div>
                </div>
                <ArrowRight size={24} className="text-white/80" />
              </div>
            </div>
          </Link>
        )}

        {/* ── Cards ────────────────────────────────────────────────────────── */}
        <div className="flex flex-row gap-6 items-start">

          {/* Crew reciente */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex-1">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Users size={18} style={{ color: TEAM_COLOR }} />
                <h3 className="font-semibold text-slate-900">Crew</h3>
                <span className="text-xs text-slate-400">reciente</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Link href={`/project/${id}/team/crew/new`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Añadir miembro">
                  <Plus size={16} />
                </Link>
                <Link href={`/project/${id}/team/crew`}
                  className="text-xs font-medium flex items-center gap-0.5 px-2 py-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                  Ver todos <ChevronRight size={12} />
                </Link>
              </div>
            </div>


            {/* List */}
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
                    const sc  = SECTION_CONFIG[member.section];
                    const dim = member.status === "inactive";
                    return (
                      <Link key={member.id} href={`/project/${id}/team/crew/${member.id}`} className="block">
                        <div className={`flex items-center justify-between px-3 py-3 rounded-xl transition-colors cursor-pointer group border ${
                          dim ? "bg-slate-50/60 border-slate-100 opacity-60 hover:opacity-80"
                              : "bg-slate-50 hover:bg-slate-100 border-transparent hover:border-slate-200"}`}>
                          {/* Avatar + name */}
                          <div className="flex items-center gap-3 flex-1 min-w-0 mr-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden text-xs font-semibold text-slate-600">
                              {member.photoUrl
                                ? <img src={member.photoUrl} alt={fullName(member)} className="w-full h-full object-cover" />
                                : member.firstName.charAt(0).toUpperCase()
                              }
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-semibold text-slate-900 truncate">{fullName(member)}</span>
                                {member.artisticName && (
                                  <span className="text-xs text-slate-400 italic truncate inline">&quot;{member.artisticName}&quot;</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs text-slate-500 truncate">{member.role}</p>
                                {member.section === "cast" && member.character && (
                                  <><span className="text-slate-300">·</span><p className="text-xs text-violet-500 truncate">{member.character}</p></>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Right */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right block space-y-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium ${sc.bg} ${sc.text}`}>
                                {sc.label}
                              </span>
                              <div>{getStatusBadge(member)}</div>
                            </div>
                            {member.email && (
                              <a href={`mailto:${member.email}`} onClick={(e) => e.preventDefault()}
                                className="p-1.5 rounded-lg text-slate-300 hover:text-slate-500 hover:bg-slate-200 transition-colors" title={member.email}>
                                <MailPlus size={13} />
                              </a>
                            )}
                            <ChevronRight size={16} className="text-slate-300 transition-colors" style={{ color: undefined }}
                              // eslint-disable-next-line react/no-unknown-property
                            />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {stats.total > 0 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{stats.active}</span> activos de <span className="font-semibold text-slate-900">{stats.total}</span> totales
                </span>
                <Link href={`/project/${id}/team/crew`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors flex items-center gap-0.5">
                  Ver crew completo <ChevronRight size={11} />
                </Link>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
