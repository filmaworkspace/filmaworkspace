"use client";

// Gestos de la versión móvil: tirar hacia abajo para recargar, deslizar una
// fila para ver sus acciones y una vibración corta de confirmación.

import { useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";

/** Vibración corta (Android); en iOS no hace nada. */
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* sin vibración */ }
}

const PULL = 70;

/** Tirar hacia abajo desde arriba del todo para recargar. */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<unknown>; children: React.ReactNode }) {
  const [dy, setDy] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);

  const onStart = (e: React.TouchEvent) => { if (window.scrollY <= 0 && !busy) start.current = e.touches[0].clientY; };
  const onMove = (e: React.TouchEvent) => {
    if (start.current === null) return;
    const d = e.touches[0].clientY - start.current;
    if (d <= 0) { setDy(0); return; }
    setDy(Math.min(110, d * 0.5));
  };
  const onEnd = async () => {
    if (start.current === null) return;
    start.current = null;
    if (dy >= PULL) {
      haptic(); setBusy(true); setDy(48);
      try { await onRefresh(); } finally { setBusy(false); setDy(0); }
    } else setDy(0);
  };

  return (
    <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <div className="flex items-end justify-center overflow-hidden text-slate-400 transition-[height] duration-150" style={{ height: dy }} aria-hidden={!busy}>
        <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F1F3]">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowDown size={16} style={{ transform: `rotate(${dy >= PULL ? 180 : 0}deg)`, transition: "transform .15s" }} />}
        </span>
      </div>
      {children}
    </div>
  );
}

/**
 * Fila deslizable: hacia la derecha descubre la acción principal (p. ej.
 * Aprobar) y hacia la izquierda la secundaria. Las acciones se pulsan; el
 * gesto solo las enseña, así nada se aprueba por accidente.
 */
export function SwipeRow({ children, left, right }: {
  children: React.ReactNode;
  /** Acción que aparece al deslizar hacia la derecha (a la izquierda de la fila). */
  left?: { label: string; className: string; onClick: () => void };
  right?: { label: string; className: string; onClick: () => void };
}) {
  const [x, setX] = useState(0);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  const W = 96;

  const onStart = (e: React.TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: x }; axis.current = null; };
  const onMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const dx = e.touches[0].clientX - start.current.x, dy = e.touches[0].clientY - start.current.y;
    if (!axis.current && Math.abs(dx) + Math.abs(dy) > 8) axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (axis.current !== "x") return;
    let nx = start.current.base + dx;
    if (!left) nx = Math.min(0, nx);
    if (!right) nx = Math.max(0, nx);
    setX(Math.max(-W * 1.3, Math.min(W * 1.3, nx)));
  };
  const onEnd = () => {
    if (!start.current) return;
    start.current = null;
    const nx = x > W / 2 ? W : x < -W / 2 ? -W : 0;
    if (nx !== 0 && nx !== x) haptic(8);
    setX(nx);
  };
  const run = (fn: () => void) => { setX(0); fn(); };

  return (
    <div className="relative overflow-hidden">
      {left && (
        <button onClick={() => run(left.onClick)} className={`absolute inset-y-0 left-0 flex items-center justify-center text-[13px] font-semibold text-white ${left.className}`} style={{ width: W }} tabIndex={x > 0 ? 0 : -1}>
          {left.label}
        </button>
      )}
      {right && (
        <button onClick={() => run(right.onClick)} className={`absolute inset-y-0 right-0 flex items-center justify-center text-[13px] font-semibold text-white ${right.className}`} style={{ width: W }} tabIndex={x < 0 ? 0 : -1}>
          {right.label}
        </button>
      )}
      <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}
        onClickCapture={(e) => { if (x !== 0) { e.preventDefault(); e.stopPropagation(); setX(0); } }}
        className="relative bg-white" style={{ transform: `translateX(${x}px)`, transition: start.current ? "none" : "transform .18s ease-out" }}>
        {children}
      </div>
    </div>
  );
}
