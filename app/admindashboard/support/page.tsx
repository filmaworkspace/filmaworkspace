"use client";

// ─── Soporte ─────────────────────────────────────────────────────────────────
// Cola de tickets (sin asignar / míos / todos / cerrados), conversación en
// tiempo real, asignar y transferir, guías y respuestas guardadas. Cada
// ticket muestra cuánto lleva esperando y enlaza a la ficha del usuario y
// al proyecto desde el que escribió. Al cerrar se pide valoración al usuario.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  addDoc, collection, doc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where,
} from "firebase/firestore";
import {
  BookOpen, CheckCheck, Download, ExternalLink, HeadphonesIcon, Loader2, MessageSquare, Plus, RefreshCw, Send, Settings, Star, Trash2, UserCheck,
} from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { AutomatedMessages, DEFAULT_AUTOMATED_MESSAGES, fetchAutomatedMessages } from "@/lib/automatedMessages";
import { AnchoredPanel, Button, Field, IconButton, Input, Menu, MenuItem, Modal, Page, PageHeader, Textarea, buttonClass, useToast } from "@/components/ds";
import { Dot, Pills, timeAgo, Tone } from "@/components/admin/ui";

interface SupportChat {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: "open" | "resolved";
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  createdAt?: Timestamp | null;
  unreadAdmin: number;
  contactType?: "person" | "company";
  interestedInFW?: boolean | null;
  currentPage?: string;
  ticketNumber?: number;
  department?: "sales" | "technical" | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  assignedAt?: Timestamp | null;
  archived?: boolean;
  closedAt?: Timestamp | null;
  closedByName?: string;
  messageCount?: number;
  rating?: number;
  ratingComment?: string;
}
interface SupportMessage {
  id: string;
  text: string;
  sender: "user" | "admin";
  senderName: string;
  createdAt: Timestamp | null;
  system?: boolean;
  guide?: { title: string; url: string };
}
type Agent = { id: string; name: string; email: string; role: string; supportSpecialty?: string };

const SPECIALTY: Record<string, string> = { sales: "Ventas", technical: "Técnico", both: "Ventas + técnico" };
const ticketNo = (n?: number) => (n ? `#${String(n).padStart(5, "0")}` : "");
const waitTone = (ts: Timestamp | null | undefined): Tone => {
  const m = ts?.toMillis?.();
  if (!m) return "none";
  const min = (Date.now() - m) / 60000;
  return min < 10 ? "ok" : min < 60 ? "warn" : "bad";
};
const projectFromPage = (page?: string) => page?.match(/^\/project\/([^/]+)/)?.[1] || null;

export default function SupportPage() {
  const { user } = useUser();
  const isAdmin = user?.role === "admin";
  const myId = user?.uid;
  const [toast, showToast] = useToast();

  const [chats, setChats] = useState<SupportChat[]>([]);
  const [archived, setArchived] = useState<SupportChat[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [guides, setGuides] = useState<{ id: string; title: string; slug: string; category: string }[]>([]);
  const [auto, setAuto] = useState<AutomatedMessages>(DEFAULT_AUTOMATED_MESSAGES);
  const [filter, setFilter] = useState<"unassigned" | "mine" | "all" | "resolved">("unassigned");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [guideSearch, setGuideSearch] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [macroOpen, setMacroOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<AutomatedMessages>(DEFAULT_AUTOMATED_MESSAGES);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const legacy = useRef(new Set<string>());
  const [, setTick] = useState(0);

  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  // Cerrar los desplegables de guía y respuestas al pulsar fuera
  useEffect(() => {
    if (!guideOpen && !macroOpen) return;
    const close = () => { setGuideOpen(false); setMacroOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [guideOpen, macroOpen]);

  useEffect(() => onSnapshot(collection(db, "supportChats"), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportChat));
    list.sort((a, b) => (b.lastMessageAt?.seconds ?? 0) - (a.lastMessageAt?.seconds ?? 0));
    setChats(list);
  }, () => {}), []);
  useEffect(() => onSnapshot(query(collection(db, "supportArchive"), orderBy("closedAt", "desc"), limit(300)), (snap) => {
    setArchived(snap.docs.map((d) => ({ id: d.id, ...d.data(), archived: true } as SupportChat)));
  }, () => {}), []);
  useEffect(() => onSnapshot(doc(db, "meta", "supportChat"), (s) => setEnabled(s.data()?.enabled !== false), () => {}), []);
  useEffect(() => onSnapshot(query(collection(db, "users"), where("role", "in", ["admin", "support_agent"])), (s) => setAgents(s.docs.map((d) => ({ id: d.id, ...d.data() } as Agent))), () => {}), []);
  useEffect(() => onSnapshot(query(collection(db, "guides"), where("published", "==", true)), (s) => setGuides(s.docs.map((d) => ({ id: d.id, ...d.data() } as { id: string; title: string; slug: string; category: string }))), () => {}), []);
  useEffect(() => { fetchAutomatedMessages(db).then(setAuto); }, []);

  const closeChat = async (chatId: string) => {
    const token = await auth.currentUser?.getIdToken();
    const res = await fetch("/api/support/close", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ chatId }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  };

  // Conversaciones cerradas con el sistema antiguo: se archivan.
  useEffect(() => {
    chats.filter((c) => c.status === "resolved" && !legacy.current.has(c.id)).forEach((c) => {
      legacy.current.add(c.id);
      closeChat(c.id).catch(() => {});
    });
  }, [chats]);

  const activeArchived = !!activeId && archived.some((c) => c.id === activeId);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    const base = activeArchived ? "supportArchive" : "supportChats";
    const unsub = onSnapshot(query(collection(db, `${base}/${activeId}/messages`), orderBy("createdAt", "asc")), (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SupportMessage)));
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }, () => {});
    if (!activeArchived) updateDoc(doc(db, "supportChats", activeId), { unreadAdmin: 0 }).catch(() => {});
    return () => unsub();
  }, [activeId, activeArchived]);

  const open = chats.filter((c) => c.status === "open");
  const unassigned = open.filter((c) => !c.assignedTo);
  const mine = open.filter((c) => c.assignedTo === myId);
  const visible = filter === "unassigned" ? unassigned : filter === "mine" ? mine : filter === "resolved" ? archived : isAdmin ? open : [...mine, ...unassigned];
  const active = chats.find((c) => c.id === activeId) || archived.find((c) => c.id === activeId) || null;

  // Indicadores de la última semana: primera respuesta y valoración media.
  const kpis = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    const recent = archived.filter((c) => (c.closedAt?.toMillis?.() ?? 0) >= weekAgo);
    const firsts = recent.map((c) => (c.assignedAt?.toMillis?.() ?? 0) - (c.createdAt?.toMillis?.() ?? 0)).filter((x) => x > 0);
    const rated = archived.filter((c) => c.rating);
    const avgFirst = firsts.length ? firsts.reduce((s, x) => s + x, 0) / firsts.length : null;
    const fmt = (msv: number) => (msv < 3_600_000 ? `${Math.max(1, Math.round(msv / 60000))} min` : `${(msv / 3_600_000).toFixed(1).replace(".", ",")} h`);
    return {
      firstResponse: avgFirst ? fmt(avgFirst) : "—",
      rating: rated.length ? (rated.reduce((s, c) => s + (c.rating || 0), 0) / rated.length).toFixed(1).replace(".", ",") : "—",
      ratedCount: rated.length,
      closedWeek: recent.length,
    };
  }, [archived]);

  const reply = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    if (!textOverride) setInput("");
    try {
      await addDoc(collection(db, `supportChats/${activeId}/messages`), { text, sender: "admin", senderName: user?.name || "Soporte Filma", createdAt: serverTimestamp() });
      await updateDoc(doc(db, "supportChats", activeId), { lastMessage: text, lastMessageAt: serverTimestamp(), unreadUser: 1 });
    } finally { setSending(false); }
  };

  const claim = async (chatId: string) => {
    if (!user?.uid) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "supportChats", chatId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Ticket no encontrado");
        if (snap.data().assignedTo) throw new Error("Este ticket ya lo tiene otro agente");
        tx.update(ref, { assignedTo: user.uid, assignedToName: user.name || user.email || "Agente", assignedAt: serverTimestamp() });
      });
      await addDoc(collection(db, `supportChats/${chatId}/messages`), { text: `Ticket asignado a ${user.name || user.email}`, sender: "admin", senderName: "Sistema", system: true, createdAt: serverTimestamp() });
      setActiveId(chatId); setFilter("mine");
      showToast("success", "Ticket asignado a ti");
    } catch (e) { showToast("error", (e as Error).message || "No se pudo asignar"); }
  };

  const transfer = async (chatId: string, agent: Agent) => {
    try {
      await updateDoc(doc(db, "supportChats", chatId), { assignedTo: agent.id, assignedToName: agent.name, assignedAt: serverTimestamp() });
      await addDoc(collection(db, `supportChats/${chatId}/messages`), { text: `Transferido a ${agent.name} por ${user?.name || user?.email || "un agente"}`, sender: "admin", senderName: "Sistema", system: true, createdAt: serverTimestamp() });
      showToast("success", `Transferido a ${agent.name}`);
    } catch { showToast("error", "No se pudo transferir"); }
  };

  const sendGuide = async (chatId: string, g: { title: string; slug: string }) => {
    try {
      const url = `${window.location.origin}/guias/${g.slug}`;
      await addDoc(collection(db, `supportChats/${chatId}/messages`), { text: g.title, guide: { title: g.title, url }, sender: "admin", senderName: user?.name || "Soporte Filma", createdAt: serverTimestamp() });
      await updateDoc(doc(db, "supportChats", chatId), { lastMessage: `📘 ${g.title}`, lastMessageAt: serverTimestamp(), unreadUser: 1 });
      setGuideOpen(false); setGuideSearch("");
      showToast("success", "Guía enviada");
    } catch { showToast("error", "No se pudo enviar la guía"); }
  };

  const resolve = async (chatId: string) => {
    try { await closeChat(chatId); if (activeId === chatId) setActiveId(null); showToast("success", "Conversación cerrada; se pide valoración al usuario"); }
    catch (e) { showToast("error", (e as Error).message || "No se pudo cerrar"); }
  };

  const toggleEnabled = async () => {
    try {
      await setDoc(doc(db, "meta", "supportChat"), { enabled: !enabled, updatedAt: serverTimestamp(), updatedBy: user?.uid || null }, { merge: true });
      showToast("success", !enabled ? "Chat activado" : "Chat desactivado");
    } catch { showToast("error", "No se pudo cambiar"); }
  };

  const download = (chat: SupportChat) => {
    const fmt = (t?: Timestamp | null) => (t ? t.toDate().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "");
    const lines = [
      `Conversación de soporte ${ticketNo(chat.ticketNumber) || chat.id}`,
      `Usuario: ${chat.userName} <${chat.userEmail}>`,
      `Departamento: ${chat.department === "sales" ? "Ventas" : "Técnico"}`,
      `Atendida por: ${chat.assignedToName || "—"}`,
      `Cerrada: ${fmt(chat.closedAt)}${chat.closedByName ? ` por ${chat.closedByName}` : ""}`,
      chat.rating ? `Valoración: ${chat.rating}/5${chat.ratingComment ? ` — ${chat.ratingComment}` : ""}` : "",
      "", "─".repeat(60), "",
      ...messages.map((m) => m.system ? `[${fmt(m.createdAt)}] — ${m.text} —` : `[${fmt(m.createdAt)}] ${m.senderName || (m.sender === "admin" ? "Soporte" : "Usuario")}: ${m.guide ? `${m.guide.title} (${m.guide.url})` : m.text}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `soporte-${(ticketNo(chat.ticketNumber) || chat.id).replace("#", "")}.txt`;
    a.click();
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "meta", "automatedMessages"), { ...form, updatedAt: serverTimestamp(), updatedBy: user?.name || user?.email || "Admin" });
      setAuto(form); setSettingsOpen(false);
      showToast("success", "Mensajes guardados");
    } catch { showToast("error", "No se pudo guardar"); } finally { setSaving(false); }
  };

  const macroGroups = useMemo(() => {
    const g = new Map<string, typeof auto.macros>();
    auto.macros.forEach((m) => g.set(m.category || "General", [...(g.get(m.category || "General") || []), m]));
    return Array.from(g.entries());
  }, [auto.macros]);

  const isMine = active?.assignedTo === myId;
  const canReply = !!active && active.status === "open" && !active.archived && (isAdmin || isMine);
  const projectId = projectFromPage(active?.currentPage);

  return (
    <Page>
      {toast}
      <PageHeader
        title={<>Soporte <span className="text-[15px] font-normal text-slate-400">{open.length}</span></>}
        actions={
          <>
            <span className="mr-2 hidden items-center gap-4 text-xs text-slate-500 lg:flex">
              <span>1ª respuesta <strong className="font-medium text-slate-900">{kpis.firstResponse}</strong></span>
              <span className="flex items-center gap-1"><Star size={12} className="fill-amber-400 text-amber-400" /> <strong className="font-medium text-slate-900">{kpis.rating}</strong> <span className="text-slate-400">({kpis.ratedCount})</span></span>
              <span>Cerrados 7 d <strong className="font-medium text-slate-900">{kpis.closedWeek}</strong></span>
            </span>
            <button
              onClick={toggleEnabled}
              className="flex h-8 items-center gap-2 rounded-md border border-slate-200 px-2.5 text-[13px] text-slate-700 hover:bg-[#F7F7F8]"
              title="Mostrar u ocultar el chat a los usuarios"
            >
              <Dot tone={enabled ? "ok" : "none"} /> Chat {enabled ? "activo" : "desactivado"}
            </button>
            <IconButton label="Mensajes automáticos y respuestas guardadas" onClick={() => { setForm(auto); setSettingsOpen(true); }}><Settings size={15} /></IconButton>
            {isAdmin && <Link href="/admindashboard/guides" className={buttonClass("secondary")}><BookOpen size={14} /> Guías</Link>}
          </>
        }
      />

      <div className="mt-6 flex items-center justify-between gap-3">
        <Pills value={filter} onChange={setFilter} label="Cola" options={[
          { value: "unassigned", label: "Sin asignar", count: unassigned.length },
          { value: "mine", label: "Míos", count: mine.length },
          ...(isAdmin ? [{ value: "all" as const, label: "Todos", count: open.length }] : []),
          { value: "resolved", label: "Cerrados", count: archived.length },
        ]} />
      </div>

      <div className="mt-3 flex overflow-hidden rounded-lg border border-slate-200" style={{ height: "calc(100vh - 250px)", minHeight: 480 }}>
        {/* Cola */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-slate-200">
          {visible.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-slate-400">Nada por aquí</p>}
          {visible.map((c) => {
            const waiting = c.status === "open" && c.unreadAdmin > 0;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`relative block w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-[#FAFAFA] ${activeId === c.id ? "bg-[#F4F4F5]" : ""}`}
              >
                {waiting && <span className={`absolute inset-y-0 left-0 w-[3px] ${waitTone(c.lastMessageAt) === "bad" ? "bg-red-500" : waitTone(c.lastMessageAt) === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />}
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-slate-900">{c.userName || c.userEmail || "Usuario"}</span>
                  <span className="tabular-nums text-[10px] text-slate-400">{ticketNo(c.ticketNumber)}</span>
                  <span className="ml-auto flex-shrink-0 text-[11px] text-slate-400">{timeAgo(c.archived ? c.closedAt : c.lastMessageAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{c.lastMessage || "Sin mensajes"}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  {c.department && <span className="text-slate-400">{c.department === "sales" ? "Ventas" : "Técnico"}</span>}
                  {c.archived
                    ? c.rating ? <span className="flex items-center gap-0.5 text-amber-600"><Star size={10} className="fill-amber-400 text-amber-400" />{c.rating}</span> : null
                    : c.assignedTo ? <span className="truncate text-slate-500">→ {c.assignedToName}</span> : <span className="text-amber-700">Sin asignar</span>}
                  {waiting && <span className={`ml-auto ${waitTone(c.lastMessageAt) === "bad" ? "text-red-600" : "text-slate-500"}`}>espera {timeAgo(c.lastMessageAt).replace("hace ", "")}</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Conversación */}
        {active ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {active.userId ? (
                    <Link href={`/admindashboard/users/${active.userId}`} className="truncate text-[14px] font-semibold text-slate-900 hover:underline">{active.userName}</Link>
                  ) : <span className="text-[14px] font-semibold text-slate-900">{active.userName}</span>}
                  <span className="tabular-nums text-[11px] text-slate-400">{ticketNo(active.ticketNumber)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  <span>{active.userEmail}</span>
                  {active.contactType && <span>{active.contactType === "company" ? "Productora" : "Persona"}</span>}
                  {active.department && <span>{active.department === "sales" ? "Ventas" : "Técnico"}</span>}
                  {active.contactType === "company" && active.interestedInFW != null && <span>{active.interestedInFW ? "Interesada en Filma" : "No interesada"}</span>}
                  {active.currentPage && (
                    projectId && isAdmin
                      ? <Link href={`/admindashboard/project/${projectId}`} className="font-mono text-[11px] text-slate-500 hover:text-slate-900" title={active.currentPage}>{active.currentPage}</Link>
                      : <span className="font-mono text-[11px]" title={active.currentPage}>{active.currentPage}</span>
                  )}
                  {active.rating && <span className="flex items-center gap-1 text-amber-700"><Star size={11} className="fill-amber-400 text-amber-400" /> {active.rating}/5{active.ratingComment ? ` · “${active.ratingComment}”` : ""}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {active.status === "open" && !active.archived && (
                  !active.assignedTo ? (
                    <Button variant="primary" onClick={() => claim(active.id)}><UserCheck size={14} /> Atender</Button>
                  ) : (isMine || isAdmin) && (
                    <Menu trigger={(t) => <Button onClick={t}><RefreshCw size={13} /> {isMine ? "Transferir" : `→ ${active.assignedToName}`}</Button>}>
                      {(close) => (
                        <>
                          {agents.filter((a) => a.id !== active.assignedTo).map((a) => (
                            <MenuItem key={a.id} onClick={() => { close(); transfer(active.id, a); }}>
                              <span className="flex-1 truncate">{a.name}</span>
                              {a.supportSpecialty && <span className="text-[11px] text-slate-400">{SPECIALTY[a.supportSpecialty]}</span>}
                            </MenuItem>
                          ))}
                          {agents.length <= 1 && <p className="px-2.5 py-1.5 text-xs text-slate-400">No hay otros agentes</p>}
                        </>
                      )}
                    </Menu>
                  )
                )}
                {canReply && (
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                    <Button onClick={() => setGuideOpen((o) => !o)}><BookOpen size={13} /> Guía</Button>
                    {guideOpen && (
                      <AnchoredPanel align="right" className="w-72 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                        <Input value={guideSearch} onChange={(e) => setGuideSearch(e.target.value)} placeholder="Buscar guía" autoFocus />
                        <div className="mt-1 max-h-64 overflow-y-auto">
                          {guides.filter((g) => g.title.toLowerCase().includes(guideSearch.toLowerCase())).map((g) => (
                            <button key={g.id} onClick={() => sendGuide(active.id, g)} className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-[#F4F4F5]">
                              <span className="block truncate text-[13px] text-slate-800">{g.title}</span>
                              <span className="text-[11px] text-slate-400">{g.category}</span>
                            </button>
                          ))}
                        </div>
                      </AnchoredPanel>
                    )}
                  </div>
                )}
                {active.status === "open" && !active.archived
                  ? <Button onClick={() => resolve(active.id)}><CheckCheck size={14} /> Cerrar</Button>
                  : <Button onClick={() => download(active)}><Download size={14} /> Descargar</Button>}
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-[#FAFAFA] px-5 py-5">
              {messages.map((m) => {
                if (m.system) return <div key={m.id} className="text-center"><span className="rounded-full bg-slate-200/60 px-3 py-1 text-[11px] text-slate-500">{m.text}</span></div>;
                const agent = m.sender === "admin";
                return (
                  <div key={m.id} className={`flex ${agent ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[70%]">
                      {m.guide ? (
                        <a href={m.guide.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] text-slate-900 hover:border-slate-300">
                          <BookOpen size={14} className="text-slate-500" /> {m.guide.title} <ExternalLink size={11} className="text-slate-400" />
                        </a>
                      ) : (
                        <div className={`whitespace-pre-wrap break-words rounded-xl px-3.5 py-2 text-[13px] leading-relaxed ${agent ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"}`}>{m.text}</div>
                      )}
                      <p className={`mt-1 text-[10.5px] text-slate-400 ${agent ? "text-right" : ""}`}>
                        {!agent ? "" : `${m.senderName} · `}{m.createdAt?.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {canReply ? (
              <div className="flex items-end gap-2 border-t border-slate-200 px-4 py-3">
                <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                  <IconButton label="Respuestas guardadas" onClick={() => setMacroOpen((o) => !o)} disabled={auto.macros.length === 0}><MessageSquare size={15} /></IconButton>
                  {macroOpen && (
                    <AnchoredPanel className="w-80 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                      <div className="max-h-72 overflow-y-auto">
                        {macroGroups.map(([cat, list]) => (
                          <div key={cat}>
                            <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-slate-400">{cat}</p>
                            {list.map((m) => (
                              <button key={m.id} onClick={() => { setInput((p) => (p.trim() ? `${p}\n${m.text}` : m.text)); setMacroOpen(false); }} className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-[#F4F4F5]">
                                <span className="block text-[13px] font-medium text-slate-800">{m.label}</span>
                                <span className="block truncate text-[11px] text-slate-400">{m.text}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </AnchoredPanel>
                  )}
                </div>
                <Textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); reply(); } }}
                  placeholder="Escribe una respuesta…"
                  className="max-h-28 flex-1 resize-none"
                />
                <Button variant="primary" onClick={() => reply()} disabled={!input.trim() || sending}>
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Enviar
                </Button>
              </div>
            ) : (
              <p className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-400">
                {active.archived || active.status !== "open" ? "Conversación cerrada" : !active.assignedTo ? "Atiende el ticket para responder" : `Asignado a ${active.assignedToName}`}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <HeadphonesIcon size={26} className="text-slate-300" />
            <p className="text-[13px] text-slate-500">Elige una conversación</p>
          </div>
        )}
      </div>

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Mensajes automáticos y respuestas guardadas"
        width="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Button><Button variant="primary" onClick={saveSettings} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button></>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-slate-500">Usa <code className="rounded bg-slate-100 px-1 font-mono">{"{{nombre}}"}</code> para el nombre de quien escribe.</p>
          <Field label="Bienvenida · Ventas"><Textarea rows={2} value={form.welcomeSales} onChange={(e) => setForm({ ...form, welcomeSales: e.target.value })} /></Field>
          <Field label="Bienvenida · Soporte técnico"><Textarea rows={2} value={form.welcomeTechnical} onChange={(e) => setForm({ ...form, welcomeTechnical: e.target.value })} /></Field>
          <Field label="Aviso de respuesta lenta" hint="Chat de la home, si nadie responde en 3 minutos."><Textarea rows={2} value={form.slowResponse} onChange={(e) => setForm({ ...form, slowResponse: e.target.value })} /></Field>
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-[13px] font-medium text-slate-900">Respuestas guardadas</p>
            <div className="flex flex-col gap-2">
              {form.macros.map((m, i) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex gap-2">
                    <Input value={m.label} placeholder="Nombre" onChange={(e) => { const macros = [...form.macros]; macros[i] = { ...m, label: e.target.value }; setForm({ ...form, macros }); }} />
                    <Input value={m.category || ""} placeholder="Categoría" className="w-40" onChange={(e) => { const macros = [...form.macros]; macros[i] = { ...m, category: e.target.value }; setForm({ ...form, macros }); }} />
                    <IconButton label="Quitar" onClick={() => setForm({ ...form, macros: form.macros.filter((x) => x.id !== m.id) })}><Trash2 size={14} /></IconButton>
                  </div>
                  <Textarea className="mt-2" rows={2} value={m.text} onChange={(e) => { const macros = [...form.macros]; macros[i] = { ...m, text: e.target.value }; setForm({ ...form, macros }); }} />
                </div>
              ))}
            </div>
            <Button className="mt-2" variant="ghost" onClick={() => setForm({ ...form, macros: [...form.macros, { id: `m${Date.now()}`, label: "", text: "", category: "" }] })}><Plus size={14} /> Añadir respuesta</Button>
          </div>
        </div>
      </Modal>
    </Page>
  );
}
