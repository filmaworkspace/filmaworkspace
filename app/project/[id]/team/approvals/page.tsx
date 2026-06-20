"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, Timestamp, updateDoc,
} from "firebase/firestore";
import {
  Check, CheckCircle, ChevronRight, Clock,
  ClipboardCheck, FileText, Users, X, XCircle,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

// ─── Types ───────────────────────────────────────────────────────────────────

type ApprovalTab = "pending_approval" | "approved" | "rejected";

interface PendingMember {
  id: string;
  crewNumber?: string;
  section: "technical" | "cast" | "specialists";
  firstName?: string;
  lastName1?: string;
  lastName2?: string;
  name: string;
  artisticName?: string;
  role: string;
  department: string;
  status: string;
  approvalStatus: ApprovalTab;
  email?: string;
  phone?: string;
  photoUrl?: string;
  startDate?: string;
  salaryAmount?: number;
  salaryType?: string;
  sessions?: number;
  salaryPerSession?: number;
  notes?: string;
  submittedForApprovalAt?: Date;
  submittedForApprovalBy?: string;
  submittedForApprovalByName?: string;
  approvedAt?: Date;
  approvedBy?: string;
  approvedByName?: string;
  rejectedAt?: Date;
  rejectedBy?: string;
  rejectedReason?: string;
  createdAt: Date;
  createdByName: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TEAM_COLOR = "#6BA319";

const SECTION_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  technical:   { label: "Técnico",      bg: "bg-sky-50",    text: "text-sky-700"    },
  cast:        { label: "Cast",          bg: "bg-violet-50", text: "text-violet-700" },
  specialists: { label: "Especialistas", bg: "bg-amber-50",  text: "bg-amber-700"    },
};

const fmtDate = (d?: Date) => {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(d);
};

const isToday = (d?: Date) => {
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

const isThisWeek = (d?: Date) => {
  if (!d) return false;
  const now = new Date();
  const week = new Date(now);
  week.setDate(now.getDate() - 7);
  return d >= week;
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamApprovalsPage() {
  const { id } = useParams();
  const router = useRouter();
  const projectId = id as string;
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading]               = useState(true);
  const [members, setMembers]               = useState<PendingMember[]>([]);
  const [selected, setSelected]             = useState<PendingMember | null>(null);
  const [tab, setTab]                       = useState<ApprovalTab>("pending_approval");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason]     = useState("");
  const [processing, setProcessing]         = useState(false);

  const userId   = user?.uid  || "";
  const userName = user?.name || "Usuario";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { router.push("/"); return; }
      await loadData();
      setLoading(false);
    });
    return () => unsub();
  }, [projectId]);

  const loadData = async () => {
    try {
      const snap = await getDocs(collection(db, `projects/${projectId}/crew`));
      const all: PendingMember[] = snap.docs
        .filter((d) => d.data().approvalStatus)
        .map((d) => {
          const v = d.data();
          const firstName = v.firstName || "";
          const lastName1 = v.lastName1 || "";
          const lastName2 = v.lastName2 || "";
          return {
            id: d.id,
            crewNumber: v.crewNumber || "",
            section: v.section || "technical",
            firstName, lastName1, lastName2,
            name: [firstName, lastName1, lastName2].filter(Boolean).join(" ") || v.name || "",
            artisticName: v.artisticName || "",
            role: v.role || "",
            department: v.department || "",
            status: v.status || "pending",
            approvalStatus: v.approvalStatus,
            email: v.email || "",
            phone: v.phone || "",
            photoUrl: v.photoUrl || "",
            startDate: v.startDate || "",
            salaryAmount: v.salaryAmount,
            salaryType: v.salaryType || "monthly",
            sessions: v.sessions,
            salaryPerSession: v.salaryPerSession,
            notes: v.notes || "",
            submittedForApprovalAt: v.submittedForApprovalAt?.toDate(),
            submittedForApprovalBy: v.submittedForApprovalBy || "",
            submittedForApprovalByName: v.submittedForApprovalByName || "",
            approvedAt: v.approvedAt?.toDate(),
            approvedBy: v.approvedBy || "",
            approvedByName: v.approvedByName || "",
            rejectedAt: v.rejectedAt?.toDate(),
            rejectedBy: v.rejectedBy || "",
            rejectedReason: v.rejectedReason || "",
            createdAt: v.createdAt?.toDate() || new Date(),
            createdByName: v.createdByName || "",
          };
        });
      setMembers(all);
      if (selected) {
        const updated = all.find((m) => m.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch (e) { console.error(e); }
  };

  const handleApprove = async (member: PendingMember) => {
    setProcessing(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/crew`, member.id), {
        approvalStatus: "approved",
        status: "active",
        approvedAt: Timestamp.now(),
        approvedBy: userId,
        approvedByName: userName,
        rejectedReason: null,
      });
      await loadData();
      setTab("approved");
      setSelected(null);
    } catch (e) { console.error(e); }
    finally { setProcessing(false); }
  };

  const handleReject = async () => {
    if (!selected) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, `projects/${projectId}/crew`, selected.id), {
        approvalStatus: "rejected",
        status: "pending",
        rejectedAt: Timestamp.now(),
        rejectedBy: userId,
        rejectedByName: userName,
        rejectedReason: rejectReason.trim() || "Sin motivo especificado",
      });
      await loadData();
      setShowRejectModal(false);
      setRejectReason("");
      setSelected(null);
      setTab("rejected");
    } catch (e) { console.error(e); }
    finally { setProcessing(false); }
  };

  // Stats
  const pendingCount    = members.filter((m) => m.approvalStatus === "pending_approval").length;
  const approvedToday   = members.filter((m) => m.approvalStatus === "approved" && isToday(m.approvedAt)).length;
  const approvedThisWeek = members.filter((m) => m.approvalStatus === "approved" && isThisWeek(m.approvedAt)).length;

  const filtered = members.filter((m) => m.approvalStatus === tab);

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Header (mismo patrón que accounting/approvals) ─────────────────── */}
      <div className="mt-[4.5rem]">
        <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
          <div className="flex items-start justify-between border-b border-slate-200 pb-6">
            <div className="flex items-center gap-3">
              <ClipboardCheck size={24} style={{ color: TEAM_COLOR }} />
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">Aprobaciones</h1>
                <p className="text-slate-500 text-sm mt-0.5">
                  {pendingCount} pendiente{pendingCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden md:flex items-center gap-4">
              <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900">{approvedToday}</p>
                  <p className="text-xs text-slate-500">Hoy</p>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-center">
                  <p className="text-lg font-bold text-slate-900">{approvedThisWeek}</p>
                  <p className="text-xs text-slate-500">Semana</p>
                </div>
              </div>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-4 pt-4">
            <div className="flex items-center gap-1 border border-slate-200 rounded-xl p-1">
              {([
                { key: "pending_approval", label: "Pendientes", count: pendingCount },
                { key: "approved",         label: "Aprobadas",  count: members.filter((m) => m.approvalStatus === "approved").length },
                { key: "rejected",         label: "Rechazadas", count: members.filter((m) => m.approvalStatus === "rejected").length },
              ] as const).map((t) => (
                <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>
                  {t.label}
                  <span className="ml-1.5 text-xs opacity-70">({t.count})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        <div className="grid grid-cols-3 gap-6 min-h-[calc(100vh-320px)]">

          {/* ── Sidebar ───────────────────────────────────────────────────── */}
          <div className="col-span-1 space-y-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-white rounded-2xl border border-slate-200">
                <Users size={28} className="mb-2 opacity-30" />
                <p className="text-sm">
                  {tab === "pending_approval" ? "Sin altas pendientes" :
                   tab === "approved" ? "Sin altas aprobadas" : "Sin altas rechazadas"}
                </p>
              </div>
            ) : filtered.map((m) => {
              const isActive = selected?.id === m.id;
              const sc = SECTION_CONFIG[m.section] || SECTION_CONFIG.technical;
              return (
                <button key={m.id} onClick={() => setSelected(m)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${isActive
                    ? "shadow-lg scale-[1.01]"
                    : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm"}`}
                  style={isActive ? { borderColor: TEAM_COLOR, backgroundColor: "rgba(107,163,25,0.04)" } : {}}>

                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden bg-slate-100">
                      {m.photoUrl
                        ? <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                        : <span className="w-full h-full flex items-center justify-center text-sm font-bold text-slate-500">{m.name.charAt(0)}</span>
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-semibold text-slate-900 truncate">{m.name}</p>
                        <ChevronRight size={14} className="text-slate-300 flex-shrink-0 mt-0.5" />
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{m.role}{m.department ? ` · ${m.department}` : ""}</p>
                      <span className={`inline-flex items-center mt-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </div>
                  </div>

                  {/* Approval step dots */}
                  <div className="mt-3 flex items-center gap-1.5">
                    {/* dot: submitted */}
                    <div className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${m.submittedForApprovalAt ? "bg-emerald-500" : "bg-slate-200"}`} />
                      <span className="text-[9px] text-slate-400">Enviada</span>
                    </div>
                    <div className="flex-1 h-px bg-slate-100" />
                    <div className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${
                        m.approvalStatus === "approved" ? "bg-emerald-500" :
                        m.approvalStatus === "rejected" ? "bg-red-500" :
                        "bg-slate-200"}`} />
                      <span className="text-[9px] text-slate-400">Revisada</span>
                    </div>
                    <div className="flex-1 h-px bg-slate-100" />
                    <div className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${m.approvalStatus === "approved" ? "bg-emerald-500" : "bg-slate-200"}`} />
                      <span className="text-[9px] text-slate-400">Activa</span>
                    </div>
                  </div>

                  {m.submittedForApprovalAt && (
                    <p className="text-[10px] text-slate-400 mt-2">
                      <Clock size={9} className="inline mr-1" />{fmtDate(m.submittedForApprovalAt)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Main detail (col-span-2) ─────────────────────────────────── */}
          <div className="col-span-2">
            {!selected ? (
              <div className="h-full flex items-center justify-center bg-white rounded-2xl border border-slate-200">
                <div className="text-center text-slate-400">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-slate-50">
                    <FileText size={28} className="opacity-30" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">Selecciona un alta para revisarla</p>
                  <p className="text-xs text-slate-400 mt-1">Verás los detalles y podrás aprobar o rechazar</p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 340px)" }}>

                {/* Card header */}
                <div className="px-6 py-5 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-4">
                    {/* Member info */}
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl overflow-hidden bg-slate-100 flex-shrink-0">
                        {selected.photoUrl
                          ? <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />
                          : <span className="w-full h-full flex items-center justify-center text-2xl font-bold text-slate-400">{selected.name.charAt(0)}</span>
                        }
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                        {selected.artisticName && <p className="text-sm text-slate-400 italic mt-0.5">&quot;{selected.artisticName}&quot;</p>}
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          {(() => {
                            const sc = SECTION_CONFIG[selected.section] || SECTION_CONFIG.technical;
                            return <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${sc.bg} ${sc.text}`}>{sc.label}</span>;
                          })()}
                          {selected.crewNumber && (
                            <span className="text-xs text-slate-400 font-mono">#{selected.crewNumber}</span>
                          )}
                          <span className="text-xs text-slate-600 font-medium">{selected.role}</span>
                          {selected.department && <span className="text-xs text-slate-400">{selected.department}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Action area */}
                    <div className="flex-shrink-0">
                      {selected.approvalStatus === "pending_approval" && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setShowRejectModal(true)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                            <X size={14} /> Rechazar
                          </button>
                          <button onClick={() => handleApprove(selected)} disabled={processing}
                            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors shadow-sm"
                            style={{ backgroundColor: TEAM_COLOR }}>
                            {processing
                              ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              : <Check size={14} />}
                            Aprobar alta
                          </button>
                        </div>
                      )}

                      {selected.approvalStatus === "approved" && (
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl">
                          <CheckCircle size={14} /> Aprobada {fmtDate(selected.approvedAt)}
                        </span>
                      )}

                      {selected.approvalStatus === "rejected" && (
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-red-700 bg-red-50 border border-red-100 px-3 py-1.5 rounded-xl">
                          <XCircle size={14} /> Rechazada
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                  {/* Rejection reason */}
                  {selected.approvalStatus === "rejected" && selected.rejectedReason && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-1.5">Motivo del rechazo</p>
                      <p className="text-sm text-red-600">{selected.rejectedReason}</p>
                    </div>
                  )}

                  {/* Two-column info grid */}
                  <div className="grid grid-cols-2 gap-6">
                    {/* Contacto */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contacto</p>
                      <div className="space-y-2">
                        <div className="bg-slate-50 rounded-xl px-4 py-3">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Email</p>
                          <p className="text-sm font-medium text-slate-900">{selected.email || "—"}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl px-4 py-3">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Teléfono</p>
                          <p className="text-sm font-medium text-slate-900">{selected.phone || "—"}</p>
                        </div>
                      </div>
                    </div>

                    {/* Contrato */}
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contrato</p>
                      <div className="space-y-2">
                        <div className="bg-slate-50 rounded-xl px-4 py-3">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Fecha de alta</p>
                          <p className="text-sm font-medium text-slate-900">{selected.startDate || "—"}</p>
                        </div>
                        <div className="bg-slate-50 rounded-xl px-4 py-3">
                          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Remuneración</p>
                          <p className="text-sm font-medium text-slate-900">
                            {selected.salaryAmount
                              ? `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(selected.salaryAmount)} € / ${selected.salaryType === "weekly" ? "sem." : "mes"}`
                              : selected.salaryPerSession
                              ? `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2 }).format(selected.salaryPerSession)} € / sesión`
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  {selected.notes && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Notas</p>
                      <div className="bg-slate-50 rounded-xl px-4 py-3">
                        <p className="text-sm text-slate-600 whitespace-pre-line">{selected.notes}</p>
                      </div>
                    </div>
                  )}

                  {/* Audit trail */}
                  <div className="border-t border-slate-100 pt-4 space-y-1">
                    <p className="text-xs text-slate-400">
                      Creada por <span className="font-medium text-slate-600">{selected.createdByName}</span>
                    </p>
                    {selected.submittedForApprovalByName && (
                      <p className="text-xs text-slate-400">
                        Enviada por <span className="font-medium text-slate-600">{selected.submittedForApprovalByName}</span> el {fmtDate(selected.submittedForApprovalAt)}
                      </p>
                    )}
                    {selected.approvedByName && (
                      <p className="text-xs text-slate-400">
                        Aprobada por <span className="font-medium text-slate-600">{selected.approvedByName}</span> el {fmtDate(selected.approvedAt)}
                      </p>
                    )}
                  </div>

                  {/* Ver ficha */}
                  <Link href={`/project/${projectId}/team/crew/${selected.id}`}
                    className="flex items-center justify-center gap-2 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <FileText size={14} /> Ver ficha completa
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Reject modal ────────────────────────────────────────────────────── */}
      {showRejectModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">Rechazar alta</h3>
              <button onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600">
                ¿Rechazar el alta de <strong>{selected.name}</strong>? Podrás indicar el motivo.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Motivo (opcional)</label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  rows={3} placeholder="Ej: Faltan documentos, datos incorrectos…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleReject} disabled={processing}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {processing
                    ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <X size={14} />}
                  Rechazar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
