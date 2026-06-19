"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, setDoc, Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft, Check, ChevronDown, Info, Plus, Save, Settings, Shield,
  Trash2, User, Users, X,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role?: string;
  department?: string;
}

interface TeamConfig {
  approverUserIds: string[];
  approverNames: Record<string, string>;
  requireApproval: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TeamConfigPage() {
  const { id } = useParams();
  const router = useRouter();
  const projectId = id as string;
  const { user, isLoading: userLoading } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [config, setConfig] = useState<TeamConfig>({
    approverUserIds: [],
    approverNames: {},
    requireApproval: false,
  });
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [saved, setSaved] = useState(false);

  const userId = user?.uid || "";

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
      // Load project members
      const membersSnap = await getDocs(collection(db, `projects/${projectId}/members`));
      const ms: ProjectMember[] = membersSnap.docs.map((d) => ({
        userId: d.data().userId || d.id,
        name: d.data().name || d.data().displayName || "Usuario",
        email: d.data().email || "",
        role: d.data().role || "",
        department: d.data().department || "",
      }));
      setMembers(ms);

      // Load team config
      const cfgSnap = await getDoc(doc(db, `projects/${projectId}/teamConfig`, "approvals"));
      if (cfgSnap.exists()) {
        const d = cfgSnap.data();
        setConfig({
          approverUserIds: d.approverUserIds || [],
          approverNames: d.approverNames || {},
          requireApproval: d.requireApproval ?? false,
          updatedAt: d.updatedAt?.toDate(),
          updatedBy: d.updatedBy || "",
        });
      }
    } catch (e) { console.error(e); }
  };

  const addApprover = (m: ProjectMember) => {
    if (config.approverUserIds.includes(m.userId)) return;
    setConfig((c) => ({
      ...c,
      approverUserIds: [...c.approverUserIds, m.userId],
      approverNames: { ...c.approverNames, [m.userId]: m.name },
    }));
    setShowMemberPicker(false);
  };

  const removeApprover = (uid: string) => {
    setConfig((c) => {
      const names = { ...c.approverNames };
      delete names[uid];
      return { ...c, approverUserIds: c.approverUserIds.filter((x) => x !== uid), approverNames: names };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, `projects/${projectId}/teamConfig`, "approvals"), {
        ...config,
        updatedAt: Timestamp.now(),
        updatedBy: userId,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  if (loading || userLoading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 ${inter.className}`}>
      <div className="mt-[53px] bg-white border-b border-slate-200 px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/project/${projectId}/team`}
              className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors">
              <ArrowLeft size={14} /> Team
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-slate-900 font-medium">Configuración</span>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "#6BA319" }}>
            {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Guardando…</> : saved ? <><Check size={14} />Guardado</> : <><Save size={14} />Guardar cambios</>}
          </button>
        </div>
      </div>

      <div className="px-6 md:px-8 lg:px-12 xl:px-16 2xl:px-24 py-8">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Header */}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "rgba(107,163,25,0.1)" }}>
                <Settings size={18} style={{ color: "#6BA319" }} />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Configuración de Team</h1>
            </div>
            <p className="text-sm text-slate-500 ml-12">Gestiona el flujo de aprobación de altas de crew</p>
          </div>

          {/* Require approval toggle */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Shield size={16} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Requerir aprobación para altas</p>
                  <p className="text-xs text-slate-500 mt-0.5">Las nuevas altas de crew pasarán por un proceso de aprobación antes de quedar activas</p>
                </div>
              </div>
              <button
                onClick={() => setConfig((c) => ({ ...c, requireApproval: !c.requireApproval }))}
                className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${config.requireApproval ? "bg-[#6BA319]" : "bg-slate-200"}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.requireApproval ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>

            {!config.requireApproval && (
              <div className="mt-4 flex items-start gap-2 bg-slate-50 rounded-xl p-3">
                <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-500">Sin aprobación activa, las altas se crean directamente como activas.</p>
              </div>
            )}
          </div>

          {/* Approvers */}
          {config.requireApproval && (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-slate-400" />
                  <p className="text-sm font-semibold text-slate-900">Aprobadores</p>
                </div>
                <button onClick={() => setShowMemberPicker(true)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors">
                  <Plus size={13} /> Añadir aprobador
                </button>
              </div>

              {config.approverUserIds.length === 0 ? (
                <div className="px-6 py-8 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <User size={20} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500">No hay aprobadores configurados</p>
                  <p className="text-xs text-slate-400 mt-1">Añade al menos un aprobador para que el flujo funcione</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {config.approverUserIds.map((uid) => {
                    const member = members.find((m) => m.userId === uid);
                    const name = config.approverNames[uid] || member?.name || uid;
                    return (
                      <div key={uid} className="flex items-center justify-between px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                            {name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{name}</p>
                            {member?.role && <p className="text-xs text-slate-400">{member.role}</p>}
                          </div>
                        </div>
                        <button onClick={() => removeApprover(uid)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Member picker modal */}
          {showMemberPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <p className="text-sm font-semibold text-slate-900">Seleccionar aprobador</p>
                  <button onClick={() => setShowMemberPicker(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {members.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-slate-400">No hay miembros del proyecto</p>
                  ) : (
                    members.map((m) => {
                      const already = config.approverUserIds.includes(m.userId);
                      return (
                        <button key={m.userId} onClick={() => addApprover(m)} disabled={already}
                          className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 disabled:opacity-50 transition-colors border-b border-slate-50 last:border-0">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 text-left">
                            <p className="text-sm font-medium text-slate-900">{m.name}</p>
                            {m.role && <p className="text-xs text-slate-400">{m.role}</p>}
                          </div>
                          {already && <Check size={14} className="text-[#6BA319] flex-shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
