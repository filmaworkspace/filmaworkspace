"use client";

// ─── Piezas comunes del panel de administración ──────────────────────────────
import Link from "next/link";
import type { Timestamp } from "firebase/firestore";
import { auth } from "@/lib/firebase";

type TS = Timestamp | null | undefined;
const toMs = (v: TS | number | Date) =>
  v == null ? null : typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof (v as Timestamp).toMillis === "function" ? (v as Timestamp).toMillis() : null;

export function fmtDate(v: TS | number | Date, withTime = false) {
  const m = toMs(v);
  if (!m) return "—";
  const d = new Date(m);
  return withTime
    ? d.toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/** "hace 5 min", "hace 3 d", "ayer"… */
export function timeAgo(v: TS | number | Date) {
  const m = toMs(v);
  if (!m) return "—";
  const s = Math.round((Date.now() - m) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `en ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400) return `en ${Math.round(f / 3600)} h`;
    return `en ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 172800) return "ayer";
  if (s < 30 * 86400) return `hace ${Math.round(s / 86400)} d`;
  if (s < 365 * 86400) { const m = Math.round(s / (30 * 86400)); return `hace ${m} ${m === 1 ? "mes" : "meses"}`; }
  { const y = Math.round(s / (365 * 86400)); return `hace ${y} ${y === 1 ? "año" : "años"}`; }
}

export const daysSince = (v: TS | number | Date) => {
  const m = toMs(v);
  return m ? Math.floor((Date.now() - m) / 86_400_000) : null;
};

/** Pestañas tipo píldora con contador (mismo estilo que las listas de POs). */
export function Pills<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; label?: string;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex w-fit flex-wrap gap-0.5 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-xs transition-colors ${value === o.value ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}
        >
          {o.label}
          {o.count !== undefined && <span className="tabular-nums text-slate-400">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

const TONE = { ok: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", none: "bg-slate-300", info: "bg-blue-500" } as const;
export type Tone = keyof typeof TONE;

export function Dot({ tone, className = "" }: { tone: Tone; className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${TONE[tone]} ${className}`} />;
}

/** Barra lateral de color de una fila (estado), como en POs y facturas. */
export function RowBar({ tone }: { tone: Tone }) {
  return <span className={`absolute inset-y-0 left-0 w-[3px] ${TONE[tone]}`} />;
}

/** Medidor de salud 0–100. */
export function HealthMeter({ value, tone }: { value?: number; tone: Tone }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-100">
        <span className={`block h-full ${TONE[tone]}`} style={{ width: `${value ?? 0}%` }} />
      </span>
      <span className="w-7 text-right font-mono text-[11px] tabular-nums text-slate-500">{value ?? "—"}</span>
    </span>
  );
}

/** Vacío compacto para bloques dentro de una ficha. */
export function MiniEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-[13px] text-slate-400">{children}</p>;
}

/** Título de bloque pequeño con acción opcional (estilo "Movimientos recientes"). */
export function BlockTitle({ children, action, count }: { children: React.ReactNode; action?: React.ReactNode; count?: number }) {
  return (
    <div className="mb-2 flex min-h-[28px] items-center justify-between gap-3">
      <h2 className="text-[13px] text-slate-500">
        {children}
        {count !== undefined && <span className="ml-1.5 tabular-nums text-slate-400">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-[13px] text-slate-500 hover:text-slate-900">{children} →</Link>;
}

/** Gráfica de barras mínima (SVG), sin librerías. */
export function Bars({ data, height = 64, tone = "#334155", highlightLast = true, labels }: {
  data: number[]; height?: number; tone?: string; highlightLast?: boolean; labels?: string[];
}) {
  const max = Math.max(1, ...data);
  const w = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }}>
        {data.map((v, i) => {
          const h = Math.max(v > 0 ? 1.5 : 0.6, (v / max) * (height - 2));
          return (
            <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={height - h} height={h} rx={0.6}
              fill={v === 0 ? "#E2E8F0" : tone} opacity={highlightLast && i < data.length - 1 ? 0.55 : 1}>
              <title>{labels?.[i] ? `${labels[i]}: ${v}` : String(v)}</title>
            </rect>
          );
        })}
      </svg>
      {labels && (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
          <span>{labels[0]}</span><span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

/** fetch a una API de admin con el token de la sesión. */
export async function adminFetch<T = Record<string, unknown>>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  return data as T;
}

/** Descarga un objeto como fichero JSON. */
export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export const ROLE_LABEL: Record<string, string> = { admin: "Admin", user: "Usuario", support_agent: "Soporte" };
export const PHASES = ["Desarrollo", "Preproducción", "Rodaje", "Postproducción", "Finalizado"];
export const PHASE_DOT: Record<string, string> = {
  Desarrollo: "#0EA5E9", Preproducción: "#F59E0B", Rodaje: "#F43F5E", Postproducción: "#8B5CF6", Finalizado: "#10B981",
};
