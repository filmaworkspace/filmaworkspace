"use client";

import { History } from "lucide-react";

/** Aviso de "recuperado del autoguardado", con opción de descartar. */
export function AutosaveNotice({ restoredAt, onDiscard }: { restoredAt: Date | null; onDiscard: () => void }) {
  if (!restoredAt) return null;
  const when = restoredAt.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-[#F7F7F8] px-3 py-2 text-[13px] text-slate-700">
      <History size={14} className="shrink-0 text-slate-500" />
      <span className="flex-1">Recuperado lo que estabas escribiendo ({when})</span>
      <button onClick={onDiscard} className="text-xs font-medium text-slate-500 hover:text-slate-900">Descartar</button>
    </div>
  );
}

/** Texto discreto del estado del autoguardado para la cabecera. */
export function AutosaveStatus({ savedAt }: { savedAt: Date | null }) {
  if (!savedAt) return null;
  return <span className="hidden text-xs text-slate-400 sm:inline">Guardado automáticamente {savedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>;
}
