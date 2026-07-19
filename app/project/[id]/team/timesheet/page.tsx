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
  AlertCircle, Check, ChevronLeft, ChevronRight,
  Download, Eye, Hash, Link2, Pencil, Plus, RefreshCw, Send, Settings, Trash2,
  UserMinus, UserPlus, Users, X, CheckCircle,
} from "lucide-react";
import { useUser } from "@/contexts/UserContext";

const G = "#6BA319";

// ─── Types ───────────────────────────────────────────────────────────────────

interface HorarioConfig {
  enabled:           boolean;
  sendTime:          string;
  defaultRecipients: Recipient[];
  emailContactName?: string;
  emailContactMail?: string;
  emailBody?:        string;
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

interface Group {
  id:         string;
  name:       string;
  recipients: Recipient[];
}

interface CrewMember {
  id:         string;
  firstName:  string;
  lastName1:  string;
  role:       string;
  email:      string;
  status:     string;
  section:    string;
  department: string;
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
  const [groups,     setGroups]     = useState<Group[]>([]);
  const [selectedDate, setSelectedDate] = useState(today());

  // UI state
  const [showConfig,     setShowConfig]     = useState(false);
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [showGroups,     setShowGroups]     = useState(false);
  const [groupView,      setGroupView]      = useState<"list" | "create" | "edit">("list");
  const [editingGroup,   setEditingGroup]   = useState<Group | null>(null);
  const [groupFormName,  setGroupFormName]  = useState("");
  const [groupFormUids,  setGroupFormUids]  = useState<string[]>([]);
  const [showFormDetail, setShowFormDetail] = useState<FormResponse | null>(null);
  const [saving,         setSaving]         = useState(false);
  const [sending,        setSending]        = useState(false);
  const [toast,          setToast]          = useState<{ type: "success" | "error"; msg: string } | null>(null);

  // Config form state
  const [cfgSendTime,        setCfgSendTime]        = useState("19:00");
  const [cfgEnabled,         setCfgEnabled]         = useState(true);
  const [cfgContactName,     setCfgContactName]     = useState("");
  const [cfgContactMail,     setCfgContactMail]     = useState("");
  const [cfgEmailBody,       setCfgEmailBody]       = useState("");

  // New day jornada edit
  const [editingJornada, setEditingJornada] = useState(false);
  const [jornadaInput,   setJornadaInput]   = useState("");

  // Review email sending: keyed by uid → "sending" | "sent" | null
  const [reviewState, setReviewState] = useState<Record<string, "sending" | "sent">>({});

  // Download modal
  const [showDownload,   setShowDownload]   = useState(false);
  const [dlMode,         setDlMode]         = useState<"day" | "week" | "month">("month");
  const [dlMonth,        setDlMonth]        = useState(today().slice(0, 7));      // YYYY-MM
  const [dlWeek,         setDlWeek]         = useState(() => {
    const d = new Date(); const y = d.getFullYear();
    const w = Math.ceil((((d.getTime() - new Date(y, 0, 1).getTime()) / 86400000) + new Date(y, 0, 1).getDay() + 1) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  });
  const [downloading,    setDownloading]    = useState(false);

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
      await Promise.all([loadConfig(), loadDays(), loadCrew(), loadGroups()]);
    } finally {
      setLoading(false);
    }
  };

  const loadConfig = async () => {
    const snap = await getDoc(doc(db, `projects/${id}/horario/__config__`));
    if (snap.exists()) {
      const d = snap.data() as HorarioConfig;
      setConfig(d);
      setCfgSendTime(d.sendTime       ?? "19:00");
      setCfgEnabled(d.enabled         ?? true);
      setCfgContactName(d.emailContactName ?? "");
      setCfgContactMail(d.emailContactMail ?? "");
      setCfgEmailBody(d.emailBody          ?? "");
    } else {
      const def: HorarioConfig = {
        enabled: true, sendTime: "19:00", defaultRecipients: [],
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
      query(collection(db, `projects/${id}/crew`), where("status", "==", "active"))
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
        section:    v.section    || "",
        department: v.department || "",
      };
    }));
  };

  const loadGroups = async () => {
    const snap = await getDocs(collection(db, `projects/${id}/horarioGroups`));
    setGroups(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Group)));
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

  const sendReviewEmail = async (r: Recipient) => {
    if (reviewState[r.uid] === "sending") return;
    setReviewState((s) => ({ ...s, [r.uid]: "sending" }));
    try {
      const res  = await fetch("/api/horario/send-review", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ projectId: id, recipientUid: r.uid, recipientName: r.name, recipientEmail: r.email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      showToast("success", `Enlace enviado a ${r.name}`);
      setReviewState((s) => ({ ...s, [r.uid]: "sent" }));
      setTimeout(() => setReviewState((s) => { const n = { ...s }; delete n[r.uid]; return n; }), 3000);
    } catch (e: any) {
      showToast("error", e.message || "Error al enviar");
      setReviewState((s) => { const n = { ...s }; delete n[r.uid]; return n; });
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Determine date range
      let dateStart: string, dateEnd: string, label: string;
      if (dlMode === "day") {
        dateStart = dateEnd = selectedDate;
        label = selectedDate;
      } else if (dlMode === "week") {
        // Parse YYYY-Www → Monday of that week
        const [wy, ww] = dlWeek.split("-W").map(Number);
        const jan4 = new Date(wy, 0, 4);
        const monday = new Date(jan4.getTime() + (ww - 1) * 7 * 86400000 - (jan4.getDay() || 7 - 1) * 86400000);
        const sunday = new Date(monday.getTime() + 6 * 86400000);
        dateStart = monday.toISOString().slice(0, 10);
        dateEnd   = sunday.toISOString().slice(0, 10);
        label     = `semana-${dlWeek}`;
      } else {
        dateStart = `${dlMonth}-01`;
        const [y, m] = dlMonth.split("-").map(Number);
        dateEnd = new Date(y, m, 0).toISOString().slice(0, 10);
        label   = dlMonth;
      }

      // Load all submitted forms in range
      const snap = await getDocs(
        query(
          collection(db, `projects/${id}/horarioForms`),
          where("date", ">=", dateStart),
          where("date", "<=", dateEnd),
        )
      );
      type FullForm = FormResponse & { date: string; jornada: number };
      const allForms = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FullForm));

      // Build crew map: uid → { department, section }
      const crewMap = Object.fromEntries(crew.map((c) => [c.id, c]));

      // Sort: department → name → date
      const sorted = allForms.sort((a, b) => {
        const deptA = crewMap[a.recipientUid]?.department || crewMap[a.recipientUid]?.section || "zzz";
        const deptB = crewMap[b.recipientUid]?.department || crewMap[b.recipientUid]?.section || "zzz";
        if (deptA !== deptB) return deptA.localeCompare(deptB, "es");
        if (a.recipientName !== b.recipientName) return a.recipientName.localeCompare(b.recipientName, "es");
        return a.date.localeCompare(b.date);
      });

      const header = ["Nombre", "Departamento", "Rol", "Fecha", "Jornada", "Entrada", "Salida", "Pausa (min)", "Observaciones", "Estado"];
      const rows = sorted.map((f) => {
        const cm = crewMap[f.recipientUid];
        return [
          f.recipientName,
          cm?.department || cm?.section || "—",
          f.recipientRole || cm?.role || "—",
          f.date,
          String(f.jornada ?? ""),
          f.entrada  || "—",
          f.salida   || "—",
          f.comida   != null ? String(f.comida) : "—",
          f.observaciones || "",
          f.submittedAt ? "Rellenado" : "Pendiente",
        ];
      });

      const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
      const a = Object.assign(document.createElement("a"), {
        href:     URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })),
        download: `control-horario-${label}.csv`,
      });
      a.click();
      setShowDownload(false);
    } finally {
      setDownloading(false);
    }
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
      const updated: Partial<HorarioConfig> = {
        enabled:          cfgEnabled,
        sendTime:         cfgSendTime,
        emailContactName: cfgContactName.trim(),
        emailContactMail: cfgContactMail.trim(),
        emailBody:        cfgEmailBody.trim(),
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

  const openCreateGroup = () => {
    setEditingGroup(null);
    setGroupFormName("");
    setGroupFormUids([]);
    setGroupView("create");
  };

  const openEditGroup = (g: Group) => {
    setEditingGroup(g);
    setGroupFormName(g.name);
    setGroupFormUids(g.recipients.map((r) => r.uid));
    setGroupView("edit");
  };

  const handleSaveGroup = async () => {
    if (!groupFormName.trim() || groupFormUids.length === 0) return;
    const recipients: Recipient[] = crew
      .filter((m) => groupFormUids.includes(m.id))
      .map((m) => ({ uid: m.id, name: `${m.firstName} ${m.lastName1}`.trim(), email: m.email, role: m.role }));

    if (groupView === "edit" && editingGroup) {
      await updateDoc(doc(db, `projects/${id}/horarioGroups`, editingGroup.id), { name: groupFormName.trim(), recipients });
      setGroups((prev) => prev.map((g) => g.id === editingGroup.id ? { ...g, name: groupFormName.trim(), recipients } : g));
      showToast("success", "Grupo actualizado");
    } else {
      const ref = doc(collection(db, `projects/${id}/horarioGroups`));
      await setDoc(ref, { name: groupFormName.trim(), recipients, createdAt: serverTimestamp() });
      setGroups((prev) => [...prev, { id: ref.id, name: groupFormName.trim(), recipients }]);
      showToast("success", "Grupo creado");
    }
    setGroupView("list");
  };

  const handleApplyGroup = async (g: Group) => {
    const day = await getOrCreateDay(selectedDate);
    // Merge: add members not already in the day list
    const existing = new Set(day.recipients.map((r) => r.uid));
    const toAdd = g.recipients.filter((r) => !existing.has(r.uid));
    if (toAdd.length === 0) { showToast("error", "Todos ya están en el día"); return; }
    const updated = [...day.recipients, ...toAdd];
    await updateDoc(doc(db, `projects/${id}/horario`, selectedDate), { recipients: updated });
    setDays((prev) => ({ ...prev, [selectedDate]: { ...day, recipients: updated } }));
    showToast("success", `${toAdd.length} persona${toAdd.length !== 1 ? "s" : ""} añadida${toAdd.length !== 1 ? "s" : ""} del grupo "${g.name}"`);
  };

  const handleDeleteGroup = async (gid: string) => {
    await deleteDoc(doc(db, `projects/${id}/horarioGroups`, gid));
    setGroups((prev) => prev.filter((g) => g.id !== gid));
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

            {/* Recipients list — always visible, day auto-created on first action */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {currentDay ? (
                    <>
                      {currentDay.recipients.length} destinatarios
                      {currentDay.status === "sent" && ` · ${responded.length} respondieron`}
                    </>
                  ) : "Sin destinatarios"}
                </span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setGroupView("list"); setShowGroups(true); }}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-slate-100">
                    <Users size={13} />
                    Grupos
                  </button>
                  <button onClick={() => setShowAddMember(true)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 px-2 py-1.5 rounded-lg hover:bg-slate-100">
                    <UserPlus size={13} />
                    Añadir
                  </button>
                </div>
              </div>

              {!currentDay || currentDay.recipients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 gap-3">
                  <Users size={24} className="text-slate-300" />
                  <p className="text-sm text-slate-400">
                    {crew.length === 0 ? "No hay crew activo en el proyecto" : "Añade personas para este día"}
                  </p>
                  <button onClick={() => setShowAddMember(true)}
                    className="text-xs px-4 py-2 rounded-xl text-white font-medium" style={{ background: G }}>
                    Añadir personas
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {currentDay.recipients.map((r) => {
                    const form = currentForms.find((f) => f.recipientUid === r.uid);
                    const submitted = !!form?.submittedAt;
                    return (
                      <div key={r.uid} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{
                          background: submitted ? G : currentDay.status === "sent" ? "#fac775" : "#d3d1c7",
                        }} />
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                          {r.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">{r.name}</p>
                          <p className="text-xs text-slate-400 truncate">{r.role}</p>
                        </div>
                        {submitted && form ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs px-2 py-0.5 rounded-lg font-medium" style={{ background: "#eaf3de", color: "#3b6d11" }}>
                              {formatTime(form.submittedAt)}
                            </span>
                            <button onClick={() => setShowFormDetail(form)}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => sendReviewEmail(r)}
                              disabled={reviewState[r.uid] === "sending"}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Enviar enlace de revisión"
                            >
                              {reviewState[r.uid] === "sent"
                                ? <Check size={13} className="text-green-500" />
                                : reviewState[r.uid] === "sending"
                                  ? <RefreshCw size={13} className="animate-spin" />
                                  : <Link2 size={13} />}
                            </button>
                          </div>
                        ) : currentDay.status === "sent" ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">Sin respuesta</span>
                            <button onClick={() => handleResendOne(r.uid)} disabled={sending}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Reenviar">
                              <RefreshCw size={13} />
                            </button>
                            <button
                              onClick={() => sendReviewEmail(r)}
                              disabled={reviewState[r.uid] === "sending"}
                              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Enviar enlace de revisión"
                            >
                              {reviewState[r.uid] === "sent"
                                ? <Check size={13} className="text-green-500" />
                                : reviewState[r.uid] === "sending"
                                  ? <RefreshCw size={13} className="animate-spin" />
                                  : <Link2 size={13} />}
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
              )}
            </div>
          </div>

          {/* Right: stats + legend */}
          <div className="space-y-4">
            {/* Download button */}
            <button
              onClick={() => setShowDownload(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download size={14} /> Descargar datos
            </button>

            {/* Stats card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
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
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
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

          </div>
        </div>
      </main>

      {/* ── Config Modal ───────────────────────────────────────────────────── */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Configuración</h3>
              <button onClick={() => setShowConfig(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl">
                <X size={16} />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">Envío automático</p>
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

              <div className="pt-1 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Personalización del email</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Mensaje del email</label>
                    <textarea
                      rows={4}
                      value={cfgEmailBody}
                      onChange={(e) => setCfgEmailBody(e.target.value)}
                      placeholder={"Por favor, completa tu parte del control horario de hoy. Solo te llevará un momento."}
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Si lo dejas vacío se usará el mensaje por defecto.</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre de contacto</label>
                    <input
                      type="text"
                      value={cfgContactName}
                      onChange={(e) => setCfgContactName(e.target.value)}
                      placeholder="Ej: María García (Coordinación)"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Email de contacto</label>
                    <input
                      type="email"
                      value={cfgContactMail}
                      onChange={(e) => setCfgContactMail(e.target.value)}
                      placeholder="coordinacion@produccion.com"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Se muestra al pie del email para que el crew pueda contactar si tiene dudas.</p>
                  </div>
                </div>
              </div>

            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3 flex-shrink-0">
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
            <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
              {(() => {
                const available = crew.filter((m) => !currentDay?.recipients.find((r) => r.uid === m.id));
                if (crew.length === 0) return (
                  <p className="text-sm text-slate-400 text-center py-10">No hay crew activo en el proyecto</p>
                );
                if (available.length === 0) return (
                  <p className="text-sm text-slate-400 text-center py-10">Todos están ya añadidos</p>
                );
                return available.map((m) => (
                  <button key={m.id} onClick={async () => { await handleAddMember(m); setShowAddMember(false); }}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 text-left transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                      {m.firstName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{m.firstName} {m.lastName1}</p>
                      <p className="text-xs text-slate-400">{m.role || m.section || "—"}</p>
                    </div>
                  </button>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Groups Modal ───────────────────────────────────────────────────── */}
      {showGroups && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
              {groupView !== "list" ? (
                <button onClick={() => setGroupView("list")} className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800">
                  <ChevronLeft size={16} /> Grupos
                </button>
              ) : (
                <h3 className="text-sm font-semibold text-slate-900">Grupos</h3>
              )}
              <button onClick={() => setShowGroups(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>

            {/* List view */}
            {groupView === "list" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
                  {groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-2">
                      <Users size={28} className="text-slate-200" />
                      <p className="text-sm text-slate-400">Sin grupos todavía</p>
                    </div>
                  ) : groups.map((g) => (
                    <div key={g.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{g.name}</p>
                        <p className="text-xs text-slate-400">{g.recipients.length} persona{g.recipients.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => handleApplyGroup(g)}
                          className="px-3 py-1.5 text-xs font-medium rounded-xl text-white" style={{ background: G }}>
                          Añadir al día
                        </button>
                        <button onClick={() => openEditGroup(g)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDeleteGroup(g.id)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex-shrink-0">
                  <button onClick={openCreateGroup}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium text-white"
                    style={{ background: G }}>
                    <Plus size={15} /> Nuevo grupo
                  </button>
                </div>
              </div>
            )}

            {/* Create / Edit view */}
            {(groupView === "create" || groupView === "edit") && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="px-5 py-4 space-y-4 flex-1 overflow-y-auto">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre del grupo</label>
                    <input
                      type="text"
                      value={groupFormName}
                      onChange={(e) => setGroupFormName(e.target.value)}
                      placeholder="Ej: Cámara, Dirección, Equipo técnico..."
                      autoFocus
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-2">
                      Personas del grupo
                      <span className="ml-1.5 text-slate-400 font-normal">{groupFormUids.length} seleccionadas</span>
                    </label>
                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-64 overflow-y-auto">
                      {crew.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-6">No hay crew activo</p>
                      ) : crew.map((m) => {
                        const checked = groupFormUids.includes(m.id);
                        return (
                          <button key={m.id}
                            onClick={() => setGroupFormUids((prev) =>
                              checked ? prev.filter((u) => u !== m.id) : [...prev, m.id]
                            )}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left transition-colors">
                            <div className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                              checked ? "border-transparent" : "border-slate-300"
                            }`} style={checked ? { background: G, borderColor: G } : {}}>
                              {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                            </div>
                            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 flex-shrink-0">
                              {m.firstName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-900 truncate">{m.firstName} {m.lastName1}</p>
                              <p className="text-xs text-slate-400 truncate">{m.role || m.department || "—"}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-slate-100 flex gap-2 flex-shrink-0">
                  <button onClick={() => setGroupView("list")}
                    className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Cancelar
                  </button>
                  <button onClick={handleSaveGroup}
                    disabled={!groupFormName.trim() || groupFormUids.length === 0}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40"
                    style={{ background: G }}>
                    {groupView === "edit" ? "Guardar cambios" : "Crear grupo"}
                  </button>
                </div>
              </div>
            )}
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

      {/* Download modal */}
      {showDownload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDownload(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-slate-900">Descargar datos</h3>
              <button onClick={() => setShowDownload(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={16} />
              </button>
            </div>

            {/* Mode selector */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {([
                { value: "day",   label: "Día" },
                { value: "week",  label: "Semana" },
                { value: "month", label: "Mes" },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDlMode(value)}
                  className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                    dlMode === value
                      ? "text-white border-transparent"
                      : "border-slate-200 text-slate-600 hover:border-slate-300 bg-white"
                  }`}
                  style={dlMode === value ? { background: G, borderColor: G } : {}}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Range picker */}
            <div className="mb-5">
              {dlMode === "day" && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Día</label>
                  <p className="text-sm font-semibold text-slate-900 px-3.5 py-2.5 bg-slate-50 rounded-xl border border-slate-200">
                    {formatFull(selectedDate)}
                  </p>
                </div>
              )}
              {dlMode === "week" && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Semana</label>
                  <input
                    type="week"
                    value={dlWeek}
                    onChange={(e) => setDlWeek(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                  />
                </div>
              )}
              {dlMode === "month" && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Mes</label>
                  <input
                    type="month"
                    value={dlMonth}
                    onChange={(e) => setDlMonth(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                  />
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 mb-4">
              El CSV incluye todos los formularios del período, ordenados por departamento y nombre.
            </p>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: G }}
            >
              {downloading
                ? <><RefreshCw size={14} className="animate-spin" /> Generando...</>
                : <><Download size={14} /> Descargar CSV</>
              }
            </button>
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
