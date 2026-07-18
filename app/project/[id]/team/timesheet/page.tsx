"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { inter } from "@/lib/fonts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, Timestamp, serverTimestamp,
} from "firebase/firestore";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight,
  Clock, Copy, Eye, Hash, Plus, RefreshCw, Send, Settings, Trash2,
  UserMinus, UserPlus, Users, X, CheckCircle, MoreHorizontal, BookTemplate,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const G = "#6BA319";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HorarioConfig {
  enabled:           boolean;
  sendTime:          string;
  comidaOptions:     string[];
  defaultRecipients: Recipient[];
}

interface Recipient {
  uid:   string;
  name:  string;
  email: string;
  role:  string;
}

interface DayConfig {
  date:        string;
  jornada:     number;
  status:      "draft" | "sent";
  recipients:  Recipient[];
  sentAt?:     Timestamp | null;
  templateId?: string;
}

interface FormResponse {
  id:            string;
  recipientUid:  string;
  recipientName: string;
  recipientRole: string;
  sentAt:        Timestamp | null;
  submittedAt:   Timestamp | null;
  entrada:       string | null;
  salida:        string | null;
  comida:        string | null;
  observaciones: string;
}

interface Template {
  id:         string;
  name:       string;
  recipients: Recipient[];
}

interface CrewMember {
  id:        string;
  firstName: string;
  lastName1: string;
  role:      string;
  email:     string;
  status:    string;
  section:   string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(d);
}

function formatFull(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(d);
}

function formatTime(ts: Timestamp | null | undefined): string {
  if (!ts) return "—";
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(ts.toDate());
}

const DAYS_WINDOW = 14; // show 14 days around today

// ─────────────────────────────────────────────────────────────────────────────

export default function ControlHorarioPage() {
  const { id } = useParams() as { id: string };
  const { user: contextUser } = useUser();

  const [loading,    setLoading]    = useState(true);
  const [config,     setConfig]     = useState<HorarioConfig | null>(null);
  const [days,       setDays]       = useState<Record<string, DayConfig>>({});
  const [forms,      setForms]      = useState<Record<string, FormResponse[]>>({}); // keyed by date
  const [crew,       setCrew]       = useState<CrewMember[]>([]);
  const [templates,  setTemplates]  = useState<Template[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());

  // UI state
  const [showConfig,     setShowConfig]     = useState(false);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showTemplates,  setShowTemplates]  = useState(false);
  const [showFormDetail, setShowFormDetail] = useState<FormResponse | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [sending,        setSending]        = useState(false);
  const [toast,          setToast]          = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Config form state
  const [cfgSendTime,      setCfgSendTime]      = useState("19:00");
  const [cfgEnabled,       setCfgEnabled]       = useState(true);
  const [cfgComidaOptions, setCfgComidaOptions] = useState("Sin pausa,15 min,30 min,45 min,1 hora,1h 30min,2 horas,Personalizado");

  // New day jornada edit
  const [editingJornada, setEditingJornada] = useState(false);
  const [jornadaInput,   setJornadaInput]   = useState("");

  // Template save
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { if (u) loadAll(); });
    return () => unsub();
  }, [id]);

  const showToast = (type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadAll = async () => {
    setLoading(true);
    try {
      await Promise.all([loadConfig(), loadDays(), loadCrew(), loadTemplates()]);
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    const snap = await getDoc(doc(db, `projects/${id}/horario/__config__`));
    if (snap.exists()) {
      const d = snap.data() as HorarioConfig;
      setConfig(d);
      setCfgSendTime(d.sendTime ?? "19:00");
      setCfgEnabled(d.enabled ?? true);
      setCfgComidaOptions((d.comidaOptions ?? []).join(","));
    } else {
      const def: HorarioConfig = {
        enabled: true, sendTime: "19:00",
        comidaOptions: ["Sin pausa","15 min","30 min","45 min","1 hora","1h 30min","2 horas","Personalizado"],
        defaultRecipients: [],
      };
      await setDoc(doc(db, `projects/${id}/horario/__config__`), def);
      setConfig(def);
    }
  };

  const loadDays = async () => {
    const daysMap: Record<string, DayConfig> = {};
    const formsMap: Record<string, FormResponse[]> = {};

    const start = addDays(today(), -7);
    const end   = addDays(today(), DAYS_WINDOW);

    // Days stored as docs in projects/{id}/horario collection, docId = date
    const daysSnap = await getDocs(collection(db, `projects/${id}/horario`));
    for (const d of daysSnap.docs) {
      if (d.id === "__config__") continue;
      if (d.id >= start && d.id <= end) {
        daysMap[d.id] = { ...(d.data() as DayConfig), date: d.id };
      }
    }
    setDays(daysMap);

    // Load forms for sent days
    for (const [date, day] of Object.entries(daysMap)) {
      if (day.status === "sent") {
        const fSnap = await getDocs(
          query(collection(db, `projects/${id}/horarioForms`), where("date", "==", date))
        );
        formsMap[date] = fSnap.docs.map((f) => ({ id: f.id, ...f.data() } as FormResponse));
      }
    }
    setForms(formsMap);
  };

  const loadCrew = async () => {
    const snap = await getDocs(
      query(collection(db, `projects/${id}/crew`),
        where("status", "==", "active"),
        where("section", "==", "technical"))
    );
    setCrew(snap.docs.map((d) => {
      const v = d.data();
      return {
        id:        d.id,
        firstName: v.firstName || "",
        lastName1: v.lastName1 || "",
        role:      v.role      || "",
        email:     v.email     || "",
        status:    v.status    || "active",
        section:   v.section   || "technical",
      };
    }));
  };

  const loadTemplates = async () => {
    const snap = await getDocs(collection(db, `projects/${id}/horarioTemplates`));
    setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Template)));
  };

  // ── Day helpers ───────────────────────────────────────────────────────────

  const getOrCreateDay = async (date: string): Promise<DayConfig> => {
    if (days[date]) return days[date];
    // Auto-create with default recipients
    const defaultRecipients = config?.defaultRecipients ?? crew.map((m) => ({
      uid: m.id, name: `${m.firstName} ${m.lastName1}`.trim(), email: m.email, role: m.role,
    }));
    const nextJornada = Object.values(days).filter((d) => d.date <= date && d.jornada).length + 1;
    const newDay: DayConfig = { date, jornada: nextJornada, status: "draft", recipients: defaultRecipients };
    await setDoc(doc(db, `projects/${id}/horario`, date), newDay);
    setDays((prev) => ({ ...prev, [date]: newDay }));
    return newDay;
  };

  const currentDay = days[selectedDate];

  const currentForms = forms[selectedDate] ?? [];
  const responded    = currentForms.filter((f) => f.submittedAt);
  const pending      = currentDay?.recipients.filter(
    (r) => !responded.find((f) => f.recipientUid === r.uid)
  ) ?? [];

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSendDay = async () => {
    setSending(true);
    try {
      await getOrCreateDay(selectedDate);
      const res = await fetch("/api/horario/send-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, date: selectedDate }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      showToast("success", `Enviado a ${body.sent} personas`);
      await loadDays();
    } catch (e: any) {
      showToast("error", e.message || "Error al enviar");
    } finally {
      setSending(false);
    }
  };

  const handleResendPending = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/horario/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, date: selectedDate, recipientUids: pending.map((r) => r.uid) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      showToast("success", `Reenviado a ${body.sent} personas`);
      await loadDays();
    } catch (e: any) {
      showToast("error", e.message || "Error al reenviar");
    } finally {
      setSending(false);
    }
  };

  const handleResendOne = async (recipientUid: string) => {
    setSending(true);
    try {
      const res = await fetch("/api/horario/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, date: selectedDate, recipientUids: [recipientUid] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      showToast("success", "Reenviado");
    } catch (e: any) {
      showToast("error", e.message || "Error");
    } finally {
      setSending(false);
    }
  };

  const handleAddMember = async (member: CrewMember) => {
    const day = await getOrCreateDay(selectedDate);
    const already = day.recipients.find((r) => r.uid === member.id);
    if (already) { showToast("error", "Ya está en la lista"); return; }
    const newRecipient: Recipient = {
      uid: member.id, name: `${member.firstName} ${member.lastName1}`.trim(),
      email: member.email, role: member.role,
    };
    const updated = [...day.recipients, newRecipient];
    await updateDoc(doc(db, `projects/${id}/horario`, selectedDate), { recipients: updated });
    setDays((prev) => ({ ...prev, [selectedDate]: { ...day, recipients: updated } }));
    showToast("success", `${newRecipient.name} añadido`);
  };

  const handleRemoveMember = async (uid: string) => {
    const day = currentDay;
    if (!day) return;
    const updated = day.recipients.filter((r) => r.uid !== uid);
    await updateDoc(doc(db, `projects/${id}/horario`, selectedDate), { recipients: updated });
    setDays((prev) => ({ ...prev, [selectedDate]: { ...day, recipients: updated } }));
  };

  const handleUpdateJornada = async () => {
    const n = parseInt(jornadaInput);
    if (isNaN(n) || n < 1) return;
    const day = await getOrCreateDay(selectedDate);
    await updateDoc(doc(db, `projects/${id}/horario`, selectedDate), { jornada: n });
    setDays((prev) => ({ ...prev, [selectedDate]: { ...day, jornada: n } }));
    setEditingJornada(false);
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const opts = cfgComidaOptions.split(",").map((s) => s.trim()).filter(Boolean);
      const updated: Partial<HorarioConfig> = {
        enabled: cfgEnabled,
        sendTime: cfgSendTime,
        comidaOptions: opts,
      };
      await updateDoc(doc(db, `projects/${id}/horario/__config__`), updated);
      setConfig((prev) => prev ? { ...prev, ...updated } : null);
      setShowConfig(false);
      showToast("success", "Configuración guardada");
    } catch (e: any) {
      showToast("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    const day = currentDay;
    if (!day) return;
    const ref = doc(collection(db, `projects/${id}/horarioTemplates`));
    const tmpl: Template = { id: ref.id, name: templateName.trim(), recipients: day.recipients };
    await setDoc(ref, { name: tmpl.name, recipients: tmpl.recipients, createdAt: serverTimestamp() });
    setTemplates((prev) => [...prev, tmpl]);
    setTemplateName("");
    showToast("success", "Plantilla guardada");
  };

  const handleApplyTemplate = async (tmpl: Template) => {
    const day = await getOrCreateDay(selectedDate);
    await updateDoc(doc(db, `projects/${id}/horario`, selectedDate), { recipients: tmpl.recipients });
    setDays((prev) => ({ ...prev, [selectedDate]: { ...day, recipients: tmpl.recipients } }));
    setShowTemplates(false);
    showToast("success", `Plantilla "${tmpl.name}" aplicada`);
  };

  const handleDeleteTemplate = async (id_tmpl: string) => {
    await deleteDoc(doc(db, `projects/${id}/horarioTemplates`, id_tmpl));
    setTemplates((prev) => prev.filter((t) => t.id !== id_tmpl));
  };

  // ── Date strip ────────────────────────────────────────────────────────────

  const dateStrip: string[] = [];
  for (let i = -3; i <= DAYS_WINDOW; i++) {
    dateStrip.push(addDays(today(), i));
  }

  const getDayStatus = (date: string) => {
    const d = days[date];
    if (!d) return "empty";
    if (d.status === "sent") {
      const f = forms[date] ?? [];
      const total = d.recipients.length;
      const done  = f.filter((x) => x.submittedAt).length;
      if (done === total && total > 0) return "complete";
      return "partial";
    }
    return "draft";
  };

  const dotColor = (status: string) => {
    if (status === "complete") return G;
    if (status === "partial")  return "#EF9F27";
    if (status === "draft")    return "#b4b2a9";
    return "transparent";
  };

  if (loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 rounded-full animate-spin" style={{ borderTopColor: G }} />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* Header */}
      <div className="mt-[4.5rem]">
        <div className="px-24 pt-10 pb-6">
          <div className="relative flex items-center justify-center">
            <h1 className="text-3xl font-bold text-slate-900 text-center">Control horario</h1>
            <div className="absolute right-0 flex items-center gap-1">
              <button onClick={() => setShowConfig(true)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors" title="Configuración">
                <Settings size={18} />
              </button>
            </div>
          </div>
          {config && (
            <p className="text-center text-sm text-slate-400 mt-1">
              Envío automático a las <span className="font-medium text-slate-600">{config.sendTime}</span>
              {config.enabled ? "" : " · Pausado"}
            </p>
          )}
        </div>
      </div>

      <main className="px-24 pb-16">

        {/* ── Day strip ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {dateStrip.map((date) => {
            const st   = getDayStatus(date);
            const isT  = date === today();
            const isSel = date === selectedDate;
            const dayNum  = new Date(date + "T00:00:00").getDate();
            const dayName = new Intl.DateTimeFormat("es-ES", { weekday: "short" }).format(new Date(date + "T00:00:00"));
            return (
              <button key={date} onClick={() => setSelectedDate(date)}
                className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border transition-all min-w-[58px] ${
                  isSel ? "border-transparent text-white shadow-sm"
                  : isT  ? "border-slate-200 bg-slate-50 hover:bg-slate-100"
                  :        "border-transparent hover:bg-slate-50"
                }`}
                style={isSel ? { background: G } : {}}
              >
                <span className={`text-[10px] font-medium uppercase tracking-wide ${isSel ? "text-white/80" : "text-slate-400"}`}>{dayName}</span>
                <span className={`text-lg font-semibold leading-none ${isSel ? "text-white" : "text-slate-900"}`}>{dayNum}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{
                  background: isSel ? "rgba(255,255,255,0.6)" : dotColor(st),
                  opacity: st === "empty" ? 0 : 1,
                }} />
              </button>
            );
          })}
        </div>

        {/* ── Selected day panel ─────────────────────────────────────────── */}
        <div className="grid grid-cols-[1fr_300px] gap-6 items-start">

          {/* Left: recipients + response status */}
          <div className="space-y-4">
            {/* Day header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 capitalize">{formatFull(selectedDate)}</h2>
                <div className="flex items-center gap-2 mt-1">
                  {editingJornada ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="number" min={1} value={jornadaInput}
                        onChange={(e) => setJornadaInput(e.target.value)}
                        className="w-16 px-2 py-1 border border-slate-300 rounded-lg text-sm"
                        autoFocus
                      />
                      <button onClick={handleUpdateJornada} className="p-1.5 rounded-lg text-white text-xs" style={{ background: G }}>
                        <Check size={13} />
                      </button>
                      <button onClick={() => setEditingJornada(false)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100">
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setJornadaInput(String(currentDay?.jornada ?? "")); setEditingJornada(true); }}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-lg transition-colors"
                    >
                      <Hash size={12} />
                      {currentDay ? `Jornada #${currentDay.jornada}` : "Asignar jornada"}
                    </button>
                  )}
                  {currentDay?.status === "sent" && (
                    <span className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ background: "#eaf3de", color: "#3b6d11" }}>
                      Enviado {formatTime(currentDay.sentAt ?? null)}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {currentDay?.status === "sent" && pending.length > 0 && (
                  <button onClick={handleResendPending} disabled={sending}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50">
                    <Send size={13} />
                    Reenviar a {pending.length} pendientes
                  </button>
                )}
                {(!currentDay || currentDay.status === "draft") && (
                  <button onClick={handleSendDay} disabled={sending}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl text-white transition-opacity disabled:opacity-50"
                    style={{ background: G }}>
                    <Send size={14} />
                    {sending ? "Enviando..." : "Enviar ahora"}
                  </button>
                )}
              </div>
            </div>

            {/* Recipients list */}
            {!currentDay ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                <Users size={28} className="text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-500 mb-1">Sin configuración para este día</p>
                <p className="text-xs text-slate-400 mb-4">Se usarán los destinatarios por defecto al enviar</p>
                <button onClick={() => getOrCreateDay(selectedDate).then(() => loadDays())}
                  className="text-xs px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
                  Crear día
                </button>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                {/* Column headers */}
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    {currentDay.recipients.length} destinatarios
                    {currentDay.status === "sent" && ` · ${responded.length} respondieron`}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setShowTemplates(true)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-slate-100">
                      <BookTemplate size={13} />
                      Plantillas
                    </button>
                    <button onClick={() => setShowAddMember(true)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-slate-100">
                      <UserPlus size={13} />
                      Añadir
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {currentDay.recipients.map((r) => {
                    const form = currentForms.find((f) => f.recipientUid === r.uid);
                    const submitted = !!form?.submittedAt;
                    return (
                      <div key={r.uid} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                        {/* Status dot */}
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{
                          background: submitted ? G : currentDay.status === "sent" ? "#fac775" : "#d3d1c7",
                        }} />

                        {/* Avatar */}
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                          {r.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 truncate">{r.role}</p>
                        </div>

                        {submitted && form ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ background: "#eaf3de", color: "#3b6d11" }}>
                              {formatTime(form.submittedAt)}
                            </span>
                            <button onClick={() => setShowFormDetail(form)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                              <Eye size={14} />
                            </button>
                          </div>
                        ) : currentDay.status === "sent" ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">Sin respuesta</span>
                            <button onClick={() => handleResendOne(r.uid)} disabled={sending}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Reenviar">
                              <RefreshCw size={13} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => handleRemoveMember(r.uid)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Quitar">
                            <UserMinus size={13} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: stats + legend */}
          <div className="space-y-4">
            {/* Stats card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-medium text-slate-500 mb-4">Resumen del día</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Total enviados</span>
                  <span className="text-sm font-semibold text-slate-900">{currentDay?.recipients.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Respondieron</span>
                  <span className="text-sm font-semibold" style={{ color: G }}>{responded.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Pendientes</span>
                  <span className={`text-sm font-semibold ${pending.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{pending.length}</span>
                </div>
                {currentDay && currentDay.recipients.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{
                        background: G,
                        width: `${(responded.length / currentDay.recipients.length) * 100}%`,
                      }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1.5 text-right">
                      {Math.round((responded.length / currentDay.recipients.length) * 100)}% completado
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <p className="text-xs font-medium text-slate-500 mb-3">Estado de días</p>
              <div className="space-y-2.5">
                {[
                  { color: G,        label: "Todos respondieron" },
                  { color: "#EF9F27", label: "Respuestas parciales" },
                  { color: "#b4b2a9", label: "Enviado / sin respuestas" },
                  { color: "transparent", label: "Sin enviar", border: "1px solid #d3d1c7" },
                ].map(({ color, label, border }) => (
                  <div key={label} className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color, border }} />
                    <span className="text-xs text-slate-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Save template */}
            {currentDay && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-xs font-medium text-slate-500 mb-3">Guardar como plantilla</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Nombre de la plantilla"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2"
                  />
                  <button onClick={handleSaveTemplate} disabled={!templateName.trim()}
                    className="px-3 py-2 rounded-xl text-white text-xs font-medium disabled:opacity-40"
                    style={{ background: G }}>
                    Guardar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ── Config Modal ───────────────────────────────────────────────────── */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">Configuración</h3>
              <button onClick={() => setShowConfig(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">Envío automático</p>
                  <p className="text-xs text-slate-400">Activar Vercel Cron para envíos automáticos</p>
                </div>
                <button onClick={() => setCfgEnabled(!cfgEnabled)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${cfgEnabled ? "" : "bg-slate-200"}`}
                  style={cfgEnabled ? { background: G } : {}}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${cfgEnabled ? "left-5" : "left-1"}`} />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Hora de envío diario</label>
                <input type="time" value={cfgSendTime} onChange={(e) => setCfgSendTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2" />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">
                  Opciones de pausa para comer <span className="font-normal text-slate-400">(separadas por coma)</span>
                </label>
                <textarea
                  rows={3}
                  value={cfgComidaOptions}
                  onChange={(e) => setCfgComidaOptions(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
                  placeholder="Sin pausa, 30 min, 1 hora, Personalizado"
                />
                <p className="text-[11px] text-slate-400 mt-1">La opción "Personalizado" permite escribir un valor libre</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowConfig(false)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={handleSaveConfig} disabled={saving}
                  className="flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium disabled:opacity-50"
                  style={{ background: G }}>
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add member Modal ───────────────────────────────────────────────── */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Añadir persona</h3>
              <button onClick={() => setShowAddMember(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100">
              {crew.filter((m) => !currentDay?.recipients.find((r) => r.uid === m.id)).map((m) => (
                <button key={m.id} onClick={async () => { await handleAddMember(m); setShowAddMember(false); }}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 text-left transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                    {m.firstName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.firstName} {m.lastName1}</p>
                    <p className="text-xs text-slate-400">{m.role}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Templates Modal ────────────────────────────────────────────────── */}
      {showTemplates && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Plantillas</h3>
              <button onClick={() => setShowTemplates(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="overflow-y-auto divide-y divide-slate-100">
              {templates.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Sin plantillas guardadas</p>
              ) : templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.recipients.length} personas</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => handleApplyTemplate(t)}
                      className="px-3 py-1.5 text-xs font-medium rounded-xl text-white" style={{ background: G }}>
                      Aplicar
                    </button>
                    <button onClick={() => handleDeleteTemplate(t.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Form detail Modal ──────────────────────────────────────────────── */}
      {showFormDetail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <div>
                <p className="text-sm font-semibold text-slate-900">{showFormDetail.recipientName}</p>
                <p className="text-xs text-slate-400">{showFormDetail.recipientRole}</p>
              </div>
              <button onClick={() => setShowFormDetail(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { label: "Hora de entrada", value: showFormDetail.entrada ?? "—" },
                { label: "Hora de salida",  value: showFormDetail.salida  ?? "—" },
                { label: "Pausa comida",    value: showFormDetail.comida  ?? "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className="text-sm font-semibold text-slate-900">{value}</span>
                </div>
              ))}
              {showFormDetail.observaciones && (
                <div className="pt-2">
                  <p className="text-xs text-slate-500 mb-1">Observaciones</p>
                  <p className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2">{showFormDetail.observaciones}</p>
                </div>
              )}
              <p className="text-xs text-slate-400 pt-1">Enviado: {formatTime(showFormDetail.submittedAt)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg z-50 text-sm font-medium ${
          toast.type === "success" ? "bg-white border border-slate-200 text-slate-900" : "bg-red-600 text-white"
        }`}>
          {toast.type === "success" ? <CheckCircle size={16} style={{ color: G }} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
