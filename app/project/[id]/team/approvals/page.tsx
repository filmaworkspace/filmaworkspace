"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, query, updateDoc, where, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Check, CheckCircle, ChevronDown, ChevronRight, Clock,
  FileText, Mail, Phone, User, Users, X, XCircle,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

// ─── Types ───────────────────────────────────────────────────────────────────

type ApprovalStatus = "pending_approval" | "approved" | "rejected";

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
  approvalStatus: ApprovalStatus;
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

const SECTION_LABEL: Record<string, string> = {
  technical: "Equipo técnico", cast: "Cast", specialists: "Especialistas",
};

const fmtDate = (d?: Date) => {
  if (!d) return "—";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(d);
};

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamApprovalsPage() {
  const { id } = useParams();
  const router = useRouter();
  const projectId = id as string;
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<PendingMember[]>([]);
  const [selected, setSelected] = useState<PendingMember | null>(null);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState(false);

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

  const filtered = members.filter((m) => m.approvalStatus === tab);
  const pendingCount = members.filter((m) => m.approvalStatus === "pending_approval").length;

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>

      {/* Top bar */}
      <div className="mt-[53px] bg-white border-b border-slate-200 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-4">
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/project/${projectId}/team`}
            className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft size={14} /> Team
          </Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-900 font-medium">Aprobaciones</span>
          {pendingCount > 0 && (
            <span className="ml-1 bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">{pendingCount}</span>
          )}
        </div>
      </div>

      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-6">
        <div className="flex gap-6 h-[calc(100vh-160px)]">

          {/* Left panel */}
          <div className="w-80 flex-shrink-0 flex flex-col gap-4">

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
              {([
                { key: "pending", label: "Pendientes", count: members.filter((m) => m.approvalStatus === "pending_approval").length },
                { key: "approved", label: "Aprobadas" },
                { key: "rejected", label: "Rechazadas" },
              ] as const).map((t) => (
                <button key={t.key} onClick={() => { setTab(t.key); setSelected(null); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t.key ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
                  {t.label}
                  {t.count ? <span className="bg-amber-100 text-amber-700 rounded-full px-1.5 text-xs">{t.count}</span> : null}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                  <Users size={28} className="mb-2 opacity-40" />
                  <p className="text-sm">Sin {tab === "pending" ? "altas pendientes" : tab === "approved" ? "aprobadas" : "rechazadas"}</p>
                </div>
              ) : filtered.map((m) => (
                <button key={m.id} onClick={() => setSelected(m)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all ${selected?.id === m.id ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 hover:border-slate-300"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex-shrink-0 overflow-hidden ${selected?.id === m.id ? "bg-white/20" : "bg-slate-100"}`}>
                      {m.photoUrl
                        ? <img src={m.photoUrl} alt={m.name} className="w-full h-full object-cover" />
                        : <span className={`w-full h-full flex items-center justify-center text-sm font-bold ${selected?.id === m.id ? "text-white" : "text-slate-500"}`}>{m.name.charAt(0)}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${selected?.id === m.id ? "text-white" : "text-slate-900"}`}>{m.name}</p>
                      <p className={`text-xs truncate ${selected?.id === m.id ? "text-white/70" : "text-slate-500"}`}>{m.role}{m.department ? ` · ${m.department}` : ""}</p>
                    </div>
                    <ChevronRight size={14} className={selected?.id === m.id ? "text-white/60" : "text-slate-300"} />
                  </div>
                  {m.submittedForApprovalAt && (
                    <p className={`text-xs mt-1.5 ${selected?.id === m.id ? "text-white/50" : "text-slate-400"}`}>
                      <Clock size={10} className="inline mr-1" />{fmtDate(m.submittedForApprovalAt)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right panel */}
          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center text-slate-400">
                  <FileText size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Selecciona un alta para revisarla</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden h-full flex flex-col">

                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                      {selected.photoUrl
                        ? <img src={selected.photoUrl} alt={selected.name} className="w-full h-full object-cover" />
                        : <span className="w-full h-full flex items-center justify-center text-xl font-bold text-slate-400">{selected.name.charAt(0)}</span>
                      }
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                      {selected.artisticName && <p className="text-sm text-slate-400 italic">"{selected.artisticName}"</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{SECTION_LABEL[selected.section]}</span>
                        <span className="text-xs text-slate-500">{selected.role}</span>
                        {selected.department && <span className="text-xs text-slate-400">{selected.department}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {selected.approvalStatus === "pending_approval" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setShowRejectModal(true)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                        <X size={14} /> Rechazar
                      </button>
                      <button onClick={() => handleApprove(selected)} disabled={processing}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
                        style={{ backgroundColor: "#6BA319" }}>
                        {processing ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Check size={14} />}
                        Aprobar alta
                      </button>
                    </div>
                  )}

                  {selected.approvalStatus === "approved" && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl">
                      <CheckCircle size={14} /> Aprobada {fmtDate(selected.approvedAt)}
                    </span>
                  )}

                  {selected.approvalStatus === "rejected" && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 px-3 py-1.5 rounded-xl">
                      <XCircle size={14} /> Rechazada
                    </span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                  {/* Rejection reason */}
                  {selected.approvalStatus === "rejected" && selected.rejectedReason && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-xs font-semibold text-red-700 mb-1">Motivo del rechazo</p>
                      <p className="text-sm text-red-600">{selected.rejectedReason}</p>
                    </div>
                  )}

                  {/* Contact */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contacto</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">Email</p>
                        <p className="text-sm font-medium text-slate-900">{selected.email || "—"}</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">Teléfono</p>
                        <p className="text-sm font-medium text-slate-900">{selected.phone || "—"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Contract */}
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contrato</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">Fecha de alta</p>
                        <p className="text-sm font-medium text-slate-900">{selected.startDate || "—"}</p>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-[10px] text-slate-400 mb-0.5">Remuneración</p>
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

                  {/* Notes */}
                  {selected.notes && (
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Notas</p>
                      <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-3 whitespace-pre-line">{selected.notes}</p>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="text-xs text-slate-400 space-y-0.5 pt-2 border-t border-slate-100">
                    <p>Creada por <span className="font-medium">{selected.createdByName}</span></p>
                    {selected.submittedForApprovalByName && (
                      <p>Enviada para aprobación por <span className="font-medium">{selected.submittedForApprovalByName}</span> el {fmtDate(selected.submittedForApprovalAt)}</p>
                    )}
                    {selected.approvedByName && (
                      <p>Aprobada por <span className="font-medium">{selected.approvedByName}</span> el {fmtDate(selected.approvedAt)}</p>
                    )}
                  </div>

                  {/* Link to member page */}
                  <Link href={`/project/${projectId}/team/crew/${selected.id}`}
                    className="flex items-center justify-center gap-2 py-3 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">
                    <FileText size={14} /> Ver ficha completa
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reject modal */}
      {showRejectModal && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">Rechazar alta</h3>
              <button onClick={() => { setShowRejectModal(false); setRejectReason(""); }} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-slate-600">¿Rechazar el alta de <strong>{selected.name}</strong>? Podrás indicar el motivo.</p>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Motivo (opcional)</label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  rows={3} placeholder="Ej: Faltan documentos, datos incorrectos…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowRejectModal(false); setRejectReason(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleReject} disabled={processing}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                  {processing ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <X size={14} />}
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
