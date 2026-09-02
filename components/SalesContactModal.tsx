"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { DEFAULT_AUTOMATED_MESSAGES, fetchAutomatedMessages, fillTemplate } from "@/lib/automatedMessages";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, CheckCheck, ExternalLink, Loader2, Mail, MessageCircle, Send } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  sender: "user" | "admin";
  senderName: string;
  createdAt: Timestamp | null;
  system?: boolean;
  guide?: { title: string; url: string };
  auto?: boolean;
}

// Si nadie del equipo responde en este tiempo, sugerimos escribir por email
const SLOW_RESPONSE_MS = 3 * 60 * 1000;

export default function SalesContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [uid, setUid] = useState<string | null>(null);
  const [screen, setScreen] = useState<"choose" | "form" | "chat">("choose");
  const [existingChat, setExistingChat] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [starting, setStarting] = useState(false);

  const [resolved, setResolved] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [slowResponse, setSlowResponse] = useState(false);
  const [templates, setTemplates] = useState(DEFAULT_AUTOMATED_MESSAGES);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<Message[]>([]);

  // Plantillas de mensajes automáticos configuradas desde admindashboard
  useEffect(() => {
    if (!open) return;
    fetchAutomatedMessages(db).then(setTemplates);
  }, [open]);

  // Sesión (posiblemente anónima) para poder crear/leer el ticket sin necesitar cuenta
  useEffect(() => {
    if (!open) return;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) { setUid(u.uid); return; }
      try {
        const cred = await signInAnonymously(auth);
        setUid(cred.user.uid);
      } catch {
        // Si falla, se avisará al intentar iniciar el chat (submitForm)
      }
    });
    return () => unsub();
  }, [open]);

  // Si ya existe un ticket de una visita anterior en este navegador, permite retomarlo
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, "supportChats", uid),
      (snap) => {
        if (!snap.exists()) { setExistingChat(false); return; }
        const d = snap.data();
        setExistingChat(true);
        setName(d.userName || "");
        setEmail(d.userEmail || "");
        setResolved(d.status === "resolved");
      },
      () => {}
    );
    return () => unsub();
  }, [uid]);

  useEffect(() => {
    if (screen !== "chat" || !uid) return;
    const q = query(collection(db, `supportChats/${uid}/messages`), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message))));
    updateDoc(doc(db, "supportChats", uid), { unreadUser: 0 }).catch(() => {});
    return () => unsub();
  }, [screen, uid]);

  useEffect(() => {
    if (screen === "chat") setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, [messages.length, screen]);

  // Aviso de respuesta lenta: si nadie del equipo (más allá del mensaje
  // automático de bienvenida) responde en SLOW_RESPONSE_MS, sugerimos email.
  useEffect(() => {
    messagesRef.current = messages;
    if (messages.some((m) => m.sender === "admin" && !m.auto)) setSlowResponse(false);
  }, [messages]);

  useEffect(() => {
    if (screen !== "chat") { setSlowResponse(false); return; }
    const timer = setTimeout(() => {
      const hasRealReply = messagesRef.current.some((m) => m.sender === "admin" && !m.auto);
      if (!hasRealReply) setSlowResponse(true);
    }, SLOW_RESPONSE_MS);
    return () => clearTimeout(timer);
  }, [screen]);

  if (!open) return null;

  const startChat = () => setScreen(existingChat ? "chat" : "form");

  const submitForm = async () => {
    if (!name.trim()) { setFormError("Indica tu nombre"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setFormError("Email no válido"); return; }
    if (!uid) { setFormError("No se pudo iniciar el chat. Prueba de nuevo en unos segundos, o escríbenos por email."); return; }
    setFormError("");
    setStarting(true);
    try {
      const counterRef = doc(db, "meta", "supportTicketCounter");
      const ticketNum = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const next = (snap.exists() ? snap.data().count : 0) + 1;
        tx.set(counterRef, { count: next }, { merge: true });
        return next;
      });
      await setDoc(doc(db, "supportChats", uid), {
        userId: uid,
        userName: name.trim(),
        userEmail: email.trim(),
        contactType: "company",
        interestedInFW: true,
        department: "sales",
        currentPage: "/ (landing)",
        status: "open",
        ticketNumber: ticketNum,
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessage: "",
        unreadAdmin: 0,
        unreadUser: 0,
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        resolvedAt: null,
      });

      const firstName = name.trim().split(" ")[0];
      await addDoc(collection(db, `supportChats/${uid}/messages`), {
        text: fillTemplate(templates.welcomeSales, { nombre: firstName }),
        sender: "admin",
        senderName: "Filma",
        auto: true,
        createdAt: serverTimestamp(),
      });

      setScreen("chat");
      setTimeout(() => inputRef.current?.focus(), 80);
    } catch {
      setFormError("Error al iniciar el chat");
    } finally {
      setStarting(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !uid) return;
    setSending(true);
    setInput("");
    try {
      await addDoc(collection(db, `supportChats/${uid}/messages`), {
        text,
        sender: "user",
        senderName: name,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "supportChats", uid), {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        status: "open",
        unreadAdmin: 999,
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const formatTime = (ts: Timestamp | null) => (ts ? ts.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "");

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm ${inter.className}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
        style={screen === "chat" ? { height: "min(460px, 82vh)" } : { maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra mínima: solo lo imprescindible por pantalla (volver en el
            formulario, estado en el chat) — sin título "Contacto" ni botón
            de cerrar, ya de sobra con hacer click fuera del modal. En la
            pantalla inicial ("choose") no hace falta barra en absoluto: así
            el contenido queda centrado desde arriba. */}
        {screen === "form" && (
          <div className="flex items-center px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
            <button onClick={() => setScreen("choose")} className="p-1.5 -ml-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              <ArrowLeft size={16} />
            </button>
          </div>
        )}
        {screen === "chat" && (
          <div className="flex items-center px-4 py-3.5 border-b border-slate-100 flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${resolved ? "bg-slate-300" : "bg-emerald-500 animate-pulse"}`} />
              {resolved ? "Conversación cerrada" : "Chat abierto"}
            </span>
          </div>
        )}

        {/* Choose */}
        {screen === "choose" && (
          <div className="flex flex-col px-6 pb-7 pt-7 gap-4 overflow-y-auto">
            <p className="text-sm font-semibold text-slate-900 text-center">¿Cómo prefieres hablar con nosotros?</p>

            <a
              href="mailto:ventas@filmaworkspace.com"
              className="flex items-center gap-3 p-4 rounded-2xl border-2 border-slate-200 hover:border-slate-300 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Mail size={18} className="text-slate-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Enviar un email</p>
                <p className="text-xs text-slate-500">ventas@filmaworkspace.com</p>
              </div>
            </a>

            <button
              onClick={startChat}
              className="flex items-center gap-3 p-4 rounded-2xl border-2 border-slate-200 hover:border-slate-300 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={18} className="text-slate-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Hablar por chat</p>
                <p className="text-xs text-slate-500">{existingChat ? "Continuar conversación" : "Te responderemos en cuanto podamos"}</p>
              </div>
            </button>
          </div>
        )}

        {/* Form (nombre + email) */}
        {screen === "form" && (
          <div className="flex flex-col px-6 pb-7 pt-6 gap-5 overflow-y-auto">
            <p className="text-sm font-semibold text-slate-900 text-center">Antes de empezar...</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitForm()}
                  placeholder="Tu nombre"
                  autoFocus
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitForm()}
                  placeholder="tu@productora.com"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
                />
              </div>
              {formError && <p className="text-xs text-red-500">{formError}</p>}
              <button
                onClick={submitForm}
                disabled={starting}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: "#1e293b" }}
              >
                {starting ? <Loader2 size={14} className="animate-spin" /> : <>Iniciar chat <ArrowRight size={14} /></>}
              </button>
            </div>
          </div>
        )}

        {/* Chat */}
        {screen === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50">
              {messages.map((msg) => {
                if (msg.system) {
                  return (
                    <div key={msg.id} className="flex justify-center">
                      <span className="text-[10px] text-slate-500 bg-slate-200/70 px-3 py-1 rounded-full">{msg.text}</span>
                    </div>
                  );
                }
                const isUser = msg.sender === "user";
                if (msg.guide) {
                  return (
                    <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <a
                        href={msg.guide.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-[85%] flex items-center gap-2.5 px-3 py-2.5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all"
                      >
                        <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <BookOpen size={14} className="text-blue-600" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-slate-900 truncate">{msg.guide.title}</span>
                          <span className="flex items-center gap-1 text-[11px] text-blue-600">
                            Ver guía <ExternalLink size={10} />
                          </span>
                        </span>
                      </a>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] ${!isUser ? "flex items-end gap-1.5" : ""}`}>
                      {!isUser && (
                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 mb-0.5">
                          <span className="text-[9px] font-bold text-white">FW</span>
                        </div>
                      )}
                      <div>
                        <div
                          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed break-words ${
                            isUser ? "bg-slate-800 text-white rounded-br-sm" : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                          }`}
                        >
                          {msg.text}
                        </div>
                        <p className={`text-[10px] text-slate-400 mt-1 ${isUser ? "text-right" : "text-left"}`}>
                          {formatTime(msg.createdAt)}
                          {isUser && <CheckCheck size={10} className="inline ml-1 text-slate-400" />}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {slowResponse && !resolved && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                  <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">{templates.slowResponse}</p>
                </div>
              )}
              {resolved && (
                <div className="flex justify-center py-2">
                  <span className="text-[11px] bg-emerald-50 text-emerald-600 border border-emerald-100 px-3 py-1 rounded-full">
                    Conversación cerrada
                  </span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {!resolved && (
              <div className="px-3 py-3 border-t border-slate-100 bg-white flex items-end gap-2 flex-shrink-0">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Escribe tu mensaje"
                  className="flex-1 resize-none text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent leading-relaxed"
                  style={{ maxHeight: 80 }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white flex-shrink-0 transition-all disabled:opacity-40"
                  style={{ background: "#1e293b" }}
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
