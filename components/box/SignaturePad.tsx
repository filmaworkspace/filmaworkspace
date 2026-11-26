"use client";

// Panel de firma con el dedo o un lápiz. Devuelve la firma como PNG.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle { clear: () => void; toDataURL: () => string | null; isEmpty: () => boolean }

export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (empty: boolean) => void }>(function SignaturePad({ height = 220, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const bounds = useRef({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const setup = () => {
    const c = canvas.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0F172A"; ctx.lineWidth = 2.4;
  };
  useEffect(() => { setup(); }, []);
  const mark = (e: boolean) => { setEmpty(e); onChange?.(e); };

  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const grow = (p: { x: number; y: number }) => { const b = bounds.current; b.minX = Math.min(b.minX, p.x); b.minY = Math.min(b.minY, p.y); b.maxX = Math.max(b.maxX, p.x); b.maxY = Math.max(b.maxY, p.y); };

  useImperativeHandle(ref, () => ({
    clear: () => { const c = canvas.current; if (!c) return; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); bounds.current = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; mark(true); },
    isEmpty: () => empty,
    toDataURL: () => {
      const c = canvas.current; if (!c || empty) return null;
      // Recorta a la firma y la reduce: pesa poco y se ve nítida en el vale.
      const dpr = window.devicePixelRatio || 1, b = bounds.current, pad = 8;
      const sx = Math.max(0, (b.minX - pad) * dpr), sy = Math.max(0, (b.minY - pad) * dpr);
      const sw = Math.min(c.width - sx, (b.maxX - b.minX + pad * 2) * dpr), sh = Math.min(c.height - sy, (b.maxY - b.minY + pad * 2) * dpr);
      const scale = Math.min(1, 600 / sw, 240 / sh);
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * scale)); out.height = Math.max(1, Math.round(sh * scale));
      out.getContext("2d")!.drawImage(c, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL("image/png");
    },
  }));

  return (
    <canvas ref={canvas} aria-label="Firma" role="img" style={{ height, touchAction: "none" }}
      className="block w-full rounded-xl border border-slate-200 bg-white"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); grow(last.current); }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const p = pos(e), ctx = canvas.current!.getContext("2d")!;
        ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last.current = p; grow(p); if (empty) mark(false);
      }}
      onPointerUp={() => { drawing.current = false; last.current = null; }}
      onPointerCancel={() => { drawing.current = false; last.current = null; }} />
  );
});
