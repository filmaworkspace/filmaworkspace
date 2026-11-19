"use client";

// ─── Errores del navegador → admin ───────────────────────────────────────────
// Manda a /api/log-error los fallos que ven los usuarios (excepciones sin
// capturar y promesas rechazadas). Cada mensaje se manda una sola vez por
// sesión. Se ignoran los de extensiones del navegador.
import { useEffect } from "react";
import { auth } from "@/lib/firebase";

const IGNORE = [
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
  /A listener indicated an asynchronous response/,
  /ResizeObserver loop/,
  /Loading chunk \d+ failed/,
  /NEXT_REDIRECT/,
];

export default function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    const report = async (message: string, stack: string) => {
      const text = `${message}\n${stack}`;
      if (!message || IGNORE.some((r) => r.test(text)) || seen.has(message) || seen.size > 20) return;
      seen.add(message);
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => undefined);
        await fetch("/api/log-error", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ message, stack, url: window.location.pathname }),
          keepalive: true,
        });
      } catch { /* nada */ }
    };
    const onError = (e: ErrorEvent) => report(e.message || String(e.error), e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      report(r?.message || String(r), r?.stack || "");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
