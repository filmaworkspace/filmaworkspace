"use client";

import { useState, useEffect, useRef } from "react";
import { inter } from "@/lib/fonts";
import { db } from "@/lib/firebase";
import {
  doc, collection, addDoc, onSnapshot, updateDoc,
  serverTimestamp, Timestamp, query, orderBy, setDoc, getDoc,
} from "firebase/firestore";
import { useUser } from "@/contexts/UserContext";
import { MessageCircle, X, Send, Loader2, CheckCheck } from "lucide-react";

interface Message {
  id:         string;
  text:       string;
  sender:     "user" | "admin";
  senderName: string;
  createdAt:  Timestamp | null;
}

export default function SupportChat() {
  const { user } = useUser();
  const [open,       setOpen]       = useState(false);
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [sending,    setSending]    = useState(false);
  const [unread,     setUnread]     = useState(0);
  const [resolved,   setResolved]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Only show for logged-in non-admin users
  if (!user || user.role === "admin") return null;

  const chatRef  = doc(db, "supportChats", user.uid);
  const msgsRef  = collection(db, `supportChats/${user.uid}/messages`);

  // Subscribe to messages + chat meta
  useEffect(() => {
    if (!user) return;
    const unsubMeta = onSnapshot(chatRef, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setResolved(d.status === "resolved");
      if (!open) setUnread(d.unreadUser ?? 0);
    });

    const q = query(msgsRef, orderBy("createdAt", "asc"));
    const unsubMsgs = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Message)));
    });

    return () => { unsubMeta(); unsubMsgs(); };
  }, [user.uid]);

  // Mark as read + scroll when opened
  useEffect(() => {
    if (!open) return;
    setUnread(0);
    updateDoc(chatRef, { unreadUser: 0 }).catch(() => {});
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }, 80);
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.sender === "admin") setUnread((n) => n + 1);
    }
  }, [messages.length]);

  const ensureChat = async () => {
    const snap = await getDoc(chatRef);
    if (!snap.exists()) {
      await setDoc(chatRef, {
        userId:      user.uid,
        userName:    user.name,
        userEmail:   user.email ?? "",
        status:      "open",
        createdAt:   serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessage: "",
        unreadAdmin: 0,
        unreadUser:  0,
      });
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      await ensureChat();
      await addDoc(msgsRef, {
        text,
        sender:     "user",
        senderName: user.name,
        createdAt:  serverTimestamp(),
      });
      await updateDoc(chatRef, {
        lastMessage:   text,
        lastMessageAt: serverTimestamp(),
        status:        "open",
        unreadAdmin:   999, // admin will reset on read
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

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 ${inter.className}`}>

      {/* Chat panel */}
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
                <p className="text-sm font-semibold text-white leading-none">Soporte</p>
                <p className="text-[10px] text-white/50 mt-0.5">Filma Workspace</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-8">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <MessageCircle size={20} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">¿En qué podemos ayudarte?</p>
                  <p className="text-xs text-slate-400 mt-1">Escríbenos y te responderemos enseguida.</p>
                </div>
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
              <div className="text-center py-2">
                <span className="text-[11px] bg-green-50 text-green-600 border border-green-100 px-3 py-1 rounded-full">
                  Conversación cerrada
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          {!resolved && (
            <div className="px-3 py-3 border-t border-slate-100 bg-white flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Escribe tu mensaje..."
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
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-13 h-13 rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 relative"
        style={{ background: "#1e293b", width: 52, height: 52 }}
      >
        {open
          ? <X size={20} className="text-white" />
          : <MessageCircle size={20} className="text-white" />
        }
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
