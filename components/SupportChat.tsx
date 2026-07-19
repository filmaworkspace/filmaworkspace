"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import {
  doc, collection, addDoc, onSnapshot, updateDoc,
  serverTimestamp, Timestamp, query, orderBy, setDoc, runTransaction, increment,
} from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { MessageCircle, X, Send, Loader2, CheckCheck, ArrowRight } from "lucide-react";

interface Message {
  id:         string;
  text:       string;
  sender:     "user" | "admin";
  senderName: string;
  createdAt:  Timestamp | null;
}

export default function SupportChat() {
  const { user } = useUser();

  const [open,           setOpen]           = useState(false);
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState("");
  const [sending,        setSending]        = useState(false);
  const [unread,         setUnread]         = useState(0);
  const [resolved,       setResolved]       = useState(false);
  const [ticketNumber,   setTicketNumber]   = useState<number | null>(null);
  const [step,           setStep]           = useState<"info" | "type" | "chat">("info");
  const [idName,         setIdName]         = useState("");
  const [idEmail,        setIdEmail]        = useState("");
  const [idError,        setIdError]        = useState("");
  const [idSaving,       setIdSaving]       = useState(false);
  const [contactType,    setContactType]    = useState<"person" | "company" | null>(null);
  const [interestedInFW, setInterestedInFW] = useState<boolean | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const pathname = usePathname();
  const uid     = user?.uid ?? null;
  const isAdmin = user?.role === "admin";

  // All hooks before any conditional return
  useEffect(() => {
    if (!uid || isAdmin) return;

    const chatRef = doc(db, "supportChats", uid);
    const msgsRef = collection(db, `supportChats/${uid}/messages`);

    const unsubMeta = onSnapshot(
      chatRef,
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setResolved(d.status === "resolved");
        setStep("chat");
        setIdName(d.userName ?? "");
        setIdEmail(d.userEmail ?? "");
        setTicketNumber(d.ticketNumber ?? null);
        setContactType(d.contactType ?? null);
        setInterestedInFW(d.interestedInFW ?? null);
        if (!open) setUnread(d.unreadUser ?? 0);
      },
      () => {} // swallow permission-denied on logout
    );

    const q = query(msgsRef, orderBy("createdAt", "asc"));
    const unsubMsgs = onSnapshot(
      q,
      (snap) => setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message))),
      () => {}
    );

    return () => { unsubMeta(); unsubMsgs(); };
  }, [uid, isAdmin]);

  useEffect(() => {
    if (!open || !uid || isAdmin) return;
    setUnread(0);
    updateDoc(doc(db, "supportChats", uid), { unreadUser: 0, currentPage: pathname }).catch(() => {});
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }, 80);
  }, [open]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.sender === "admin") setUnread((n) => n + 1);
    }
  }, [messages.length]);

  // ── After all hooks: guard render ──────────────────────────────────────────
  if (!user || isAdmin) return null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  const chatRef = doc(db, "supportChats", uid!);
  const msgsRef = collection(db, `supportChats/${uid}/messages`);

  const handleInfoNext = () => {
    if (!idName.trim())  { setIdError("Indica tu nombre"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(idEmail.trim())) { setIdError("Email no válido"); return; }
    setIdError("");
    setStep("type");
  };

  const handleTypeNext = async (type: "person" | "company", interested?: boolean) => {
    setIdSaving(true);
    try {
      const counterRef = doc(db, "meta", "supportTicketCounter");
      const ticketNum = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const next = (snap.exists() ? snap.data().count : 0) + 1;
        tx.set(counterRef, { count: next }, { merge: true });
        return next;
      });
      await setDoc(chatRef, {
        userId:         uid,
        userName:       idName.trim(),
        userEmail:      idEmail.trim(),
        contactType:    type,
        interestedInFW: interested ?? null,
        status:         "open",
        ticketNumber:   ticketNum,
        createdAt:      serverTimestamp(),
        lastMessageAt:  serverTimestamp(),
        lastMessage:    "",
        unreadAdmin:    0,
        unreadUser:     0,
      });
      setTicketNumber(ticketNum);
      setContactType(type);
      setInterestedInFW(interested ?? null);

      // Auto welcome message
      const isSales = type === "company" && interested === true;
      const agentLabel = isSales ? "agente de ventas" : "agente de soporte";
      const firstName = idName.trim().split(" ")[0];
      const welcomeText = isSales
        ? `Hola, ${firstName} 👋 Nos alegra que estéis interesados en Filma. Un ${agentLabel} estará con vosotros en breve — mientras tanto, contadnos un poco sobre vuestro proyecto o lo que necesitáis.`
        : `Hola, ${firstName} 👋 Un ${agentLabel} te atenderá enseguida. Mientras tanto, cuéntanos qué te trae por aquí.`;

      await addDoc(msgsRef, {
        text:       welcomeText,
        sender:     "admin",
        senderName: "Filma",
        createdAt:  serverTimestamp(),
      });

      setStep("chat");
      setTimeout(() => inputRef.current?.focus(), 80);
    } finally {
      setIdSaving(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await addDoc(msgsRef, {
        text,
        sender:     "user",
        senderName: idName || user.name,
        createdAt:  serverTimestamp(),
      });
      await updateDoc(chatRef, {
        lastMessage:   text,
        lastMessageAt: serverTimestamp(),
        status:        "open",
        unreadAdmin:   999,
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const formatTime = (ts: Timestamp | null) => {
    if (!ts) return "";
    return ts.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 ${inter.className}`}>

      {open && (
        <div className="w-[340px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          style={{ height: 460 }}>

          {/* Header */}
          <div className="px-4 py-3.5 flex items-center justify-between border-b border-slate-100"
            style={{ background: "linear-gradient(135deg, #1e293b, #334155)" }}>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <MessageCircle size={15} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-tight">Soporte</p>
                {ticketNumber && (
                  <p className="text-[10px] text-white/50 leading-tight">#{String(ticketNumber).padStart(5, "0")}</p>
                )}
              </div>
            </div>
            <button onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Step 1 — Name + email */}
          {step === "info" && (
            <div className="flex-1 flex flex-col justify-center px-6 py-8 gap-5">
              <p className="text-sm font-semibold text-slate-900 text-center">¿En qué podemos ayudarte?</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Nombre</label>
                  <input
                    type="text"
                    value={idName}
                    onChange={(e) => setIdName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInfoNext()}
                    placeholder="Tu nombre"
                    autoFocus
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Email</label>
                  <input
                    type="email"
                    value={idEmail}
                    onChange={(e) => setIdEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleInfoNext()}
                    placeholder="tu@email.com"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-transparent"
                  />
                </div>
                {idError && <p className="text-xs text-red-500">{idError}</p>}
                <button
                  onClick={handleInfoNext}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
                  style={{ background: "#1e293b" }}
                >
                  Continuar <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Person or company */}
          {step === "type" && (
            <div className="flex-1 flex flex-col justify-center px-6 py-8 gap-6">
              <p className="text-sm font-semibold text-slate-900 text-center">¿Con quién hablamos?</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: "person",  label: "Persona",    emoji: "👤" },
                  { value: "company", label: "Productora", emoji: "🎬" },
                ] as const).map(({ value, label, emoji }) => (
                  <button
                    key={value}
                    onClick={() => { setContactType(value); setInterestedInFW(null); }}
                    className={`flex flex-col items-center gap-2 py-5 rounded-2xl border-2 transition-all text-sm font-medium ${
                      contactType === value
                        ? "border-slate-800 bg-slate-800 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <span className="text-2xl">{emoji}</span>
                    {label}
                  </button>
                ))}
              </div>

              {contactType === "company" && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-600 text-center">
                    ¿Estás interesada en crear un proyecto en Filma Workspace?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {([{ value: true, label: "Sí" }, { value: false, label: "No" }] as const).map(({ value, label }) => (
                      <button
                        key={String(value)}
                        onClick={() => setInterestedInFW(value)}
                        className={`py-2 rounded-xl border text-sm font-medium transition-all ${
                          interestedInFW === value
                            ? "border-slate-800 bg-slate-800 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  if (!contactType) return;
                  handleTypeNext(contactType, interestedInFW ?? undefined);
                }}
                disabled={!contactType || (contactType === "company" && interestedInFW === null) || idSaving}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-30"
                style={{ background: "#1e293b" }}
              >
                {idSaving ? <Loader2 size={14} className="animate-spin" /> : <>Iniciar chat <ArrowRight size={14} /></>}
              </button>
            </div>
          )}

          {/* Step 3 — Chat */}
          {step === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                      <MessageCircle size={20} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-medium text-slate-700">¿En qué podemos ayudarte?</p>
                  </div>
                )}

                {messages.map((msg) => {
                  const isUser = msg.sender === "user";
                  return (
                    <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] ${isUser ? "" : "flex items-end gap-1.5"}`}>
                        {!isUser && (
                          <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 mb-0.5">
                            <span className="text-[9px] font-bold text-white">FW</span>
                          </div>
                        )}
                        <div>
                          <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isUser
                              ? "bg-slate-800 text-white rounded-br-sm"
                              : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm shadow-sm"
                          }`}>
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

                {resolved && (
                  <div className="flex flex-col items-center gap-2 py-3">
                    <span className="text-[11px] bg-green-50 text-green-600 border border-green-100 px-3 py-1 rounded-full">
                      Conversación cerrada
                    </span>
                    <button
                      onClick={() => {
                        setMessages([]);
                        setResolved(false);
                        setStep("info");
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
                    >
                      Iniciar nueva conversación
                    </button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {!resolved && (
                <div className="px-3 py-3 border-t border-slate-100 bg-white flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
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
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 relative"
        style={{ background: "#1e293b", width: 52, height: 52 }}
      >
        {open ? <X size={20} className="text-white" /> : <MessageCircle size={20} className="text-white" />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
