"use client";

// Pinta los avisos de lib/toast (tarjeta blanca, abajo en el centro) y el
// diálogo de confirmación que sustituye a window.confirm. Se monta una vez.

import { useEffect, useRef, useState } from "react";
import { dismissToast, subscribeConfirm, subscribeToasts, type ConfirmRequest, type ToastItem, type ToastKind } from "@/lib/toast";
import { inter } from "@/lib/fonts";
import { coverGradient } from "@/lib/projectCover";

// Degradado de la plataforma (portada del login y emails), en vertical para el filo.
const EDGE = coverGradient();

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

function Icon({ kind }: { kind: ToastKind }) {
  const common = { width: 16, height: 16, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true } as const;
  if (kind === "loading") return (
    <svg {...common} className="animate-spin text-slate-400 motion-reduce:animate-none"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" /><path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
  );
  if (kind === "success") return <svg {...common} className="text-emerald-600"><circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" /><path d="M6.5 10.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (kind === "error") return <svg {...common} className="text-red-600"><circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" /><path d="M7.3 7.3l5.4 5.4M12.7 7.3l-5.4 5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  if (kind === "warning") return <svg {...common} className="text-amber-600"><path d="M10 2.8l7.6 13.4H2.4L10 2.8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="14" r="0.9" fill="currentColor" /></svg>;
  return <svg {...common} className="text-slate-500"><circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" /><path d="M10 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="10" cy="6.4" r="0.9" fill="currentColor" /></svg>;
}

function ToastCard({ t }: { t: ToastItem }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!t.duration || hover) return;
    const left = Math.max(800, t.duration - (Date.now() - t.createdAt));
    const timer = setTimeout(() => dismissToast(t.id), left);
    return () => clearTimeout(timer);
  }, [t.id, t.duration, t.createdAt, hover]);
  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="pointer-events-auto relative flex w-[360px] max-w-full animate-[toastIn_.18s_ease-out] items-center gap-2.5 overflow-hidden rounded-lg border border-[#E4E4E7] bg-white py-2.5 pl-4 pr-3 text-[13px] text-slate-900 shadow-[0_6px_20px_rgba(15,23,42,0.08),0_1px_2px_rgba(15,23,42,0.06)] motion-reduce:animate-none"
    >
      {/* Filo con el degradado de la plataforma */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: EDGE }} />
      <span className="shrink-0"><Icon kind={t.kind} /></span>
      <span className="min-w-0 flex-1 font-medium">
        {t.message}
        {t.count > 1 && <span className="ml-1.5 rounded bg-[#F1F1F3] px-1.5 text-[11px] font-medium text-slate-500">×{t.count}</span>}
      </span>
      {t.action && (
        <button type="button" onClick={() => { t.action!.onClick(); dismissToast(t.id); }} className="shrink-0 rounded px-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400">
          {t.action.label}
        </button>
      )}
    </div>
  );
}

function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => subscribeConfirm(setReq), []);
  useEffect(() => {
    if (!req) return;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") req.resolve(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);
  if (!req) return null;
  return (
    <div className={cx("fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/20 p-4", inter.className)} onMouseDown={(e) => { if (e.target === e.currentTarget) req.resolve(false); }}>
      <div role="alertdialog" aria-modal="true" aria-label={req.title} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="px-5 pb-4 pt-5">
          <p className="text-[14px] font-semibold text-slate-900">{req.title}</p>
          {req.message && <p className="mt-1.5 text-[13px] text-slate-600">{req.message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={() => req.resolve(false)} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900">Cancelar</button>
          <button ref={okRef} type="button" onClick={() => req.resolve(true)}
            className={cx("h-8 rounded-md px-3 text-[13px] font-medium", req.danger ? "border border-red-200 bg-white text-red-600 hover:bg-red-50" : "border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]")}>
            {req.confirmLabel || "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setList), []);
  return (
    <>
      <div aria-live="polite"
        className={cx("pointer-events-none fixed left-1/2 z-[85] flex w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col gap-2", inter.className)}
        style={{ bottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
        {list.map((t) => <ToastCard key={t.id} t={t} />)}
      </div>
      <ConfirmHost />
    </>
  );
}
