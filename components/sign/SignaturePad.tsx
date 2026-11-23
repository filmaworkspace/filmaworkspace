"use client";

// Panel de firma de Filma Sign: dibujar con el dedo / ratón o escribir el
// nombre (se convierte en firma). Devuelve un PNG transparente recortado.

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";

export interface SignatureValue { image: string; method: "draw" | "type"; typedName: string }

const INK = "#0F172A";
const FONTS = ["'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive"];

/** Recorta el lienzo a lo dibujado (con margen) y lo devuelve como PNG. */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 12;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  // Proporción fija 3:1 para que encaje igual en el PDF.
  let cw = x1 - x0, ch = y1 - y0;
  if (cw / ch > 3) { const nh = cw / 3; y0 = Math.max(0, y0 - (nh - ch) / 2); ch = nh; } else { const nw = ch * 3; x0 = Math.max(0, x0 - (nw - cw) / 2); cw = nw; }
  const out = document.createElement("canvas");
  out.width = Math.round(cw); out.height = Math.round(ch);
  out.getContext("2d")!.drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export function SignaturePad({ onChange, defaultName = "", height = 180 }: { onChange: (v: SignatureValue | null) => void; defaultName?: string; height?: number }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [name, setName] = useState(defaultName);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const width = useRef(2.4);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = INK; ctx.fillStyle = INK;
  }, []);

  const clear = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  }, []);

  useEffect(() => { setup(); }, [setup, mode]);
  useEffect(() => {
    // Solo al cambiar de ancho de verdad (girar el móvil): la barra del
    // navegador que aparece y desaparece no debe borrar la firma.
    let w = canvas.current?.getBoundingClientRect().width || 0;
    const onResize = () => {
      const nw = canvas.current?.getBoundingClientRect().width || 0;
      if (Math.abs(nw - w) < 2) return;
      w = nw; setup(); setEmpty(true); onChange(null);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setup, onChange]);

  // Escribir: pinta el nombre con letra manuscrita.
  useEffect(() => {
    if (mode !== "type") return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    ctx.clearRect(0, 0, c.width, c.height);
    if (!name.trim()) { setEmpty(true); onChange(null); return; }
    let size = 56;
    ctx.font = `${size}px ${FONTS[0]}`;
    while (ctx.measureText(name).width > r.width - 40 && size > 20) { size -= 2; ctx.font = `${size}px ${FONTS[0]}`; }
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = INK;
    ctx.fillText(name.trim(), r.width / 2, r.height / 2);
    setEmpty(false);
    const img = trimmed(c);
    onChange(img ? { image: img, method: "type", typedName: name.trim() } : null);
  }, [mode, name, onChange]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  };
  const down = (e: React.PointerEvent) => {
    if (mode !== "draw") return;
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e); width.current = 2.4;
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2); ctx.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    // Trazo más fino cuanto más rápido (como con un bolígrafo).
    const v = Math.hypot(p.x - last.current.x, p.y - last.current.y) / Math.max(1, p.t - last.current.t);
    width.current = width.current * 0.7 + Math.max(1.1, Math.min(3.4, 3.6 - v * 1.6)) * 0.3;
    ctx.lineWidth = width.current;
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y);
    const mx = (last.current.x + p.x) / 2, my = (last.current.y + p.y) / 2;
    ctx.quadraticCurveTo(last.current.x, last.current.y, mx, my); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    const img = trimmed(canvas.current!);
    onChange(img ? { image: img, method: "draw", typedName: name.trim() } : null);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-[#F7F7F8] p-0.5 text-[13px]">
          {([["draw", "Dibujar", PenLine], ["type", "Escribir", Type]] as const).map(([v, label, Icon]) => (
            <button key={v} type="button" onClick={() => { setMode(v); clear(); onChange(null); }}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 ${mode === v ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {mode === "draw" && !empty && (
          <button type="button" onClick={() => { clear(); onChange(null); }} className="flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-slate-500 hover:text-slate-900">
            <Eraser size={14} /> Borrar
          </button>
        )}
      </div>
      {mode === "type" && (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Escribe tu nombre completo" autoComplete="name"
          className="mb-2 h-11 w-full rounded-xl border border-slate-300 px-3 text-[15px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
      )}
      <div className="relative overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white">
        <canvas ref={canvas} style={{ height, touchAction: "none" }} className={`block w-full ${mode === "draw" ? "cursor-crosshair" : ""}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-t border-slate-200" />
        {empty && mode === "draw" && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-slate-400">Firma aquí</p>}
      </div>
    </div>
  );
}
