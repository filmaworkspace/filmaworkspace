"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Bold } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { TEXT_LINE_COLORS } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Controles de una línea de solo texto (sin código ni importe): negrita y
// color, reutilizados igual en Top Sheet, Capítulo y Detalle. Un puñado de
// colores fijos en vez de un selector libre, para no complicar la fila.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingTextLineControls({
  bold, color, onChangeBold, onChangeColor,
}: {
  bold: boolean; color: string; onChangeBold: (v: boolean) => void; onChangeColor: (c: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onChangeBold(!bold)}
        className={`p-1 rounded transition-colors ${bold ? "text-[#8DA7BE] bg-[#8DA7BE]/[0.1]" : "text-slate-300 hover:text-slate-500"}`}
        title="Negrita"
      >
        <Bold size={12} />
      </button>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-4 h-4 rounded-full border border-slate-300"
          style={{ background: color }}
          title="Color del texto"
        />
        {open && (
          <div className="absolute z-30 top-full right-0 mt-1 p-1.5 bg-white border border-slate-200 rounded-lg shadow-lg flex gap-1">
            {TEXT_LINE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => { onChangeColor(c); setOpen(false); }}
                className={`w-4 h-4 rounded-full border transition-transform ${c === color ? "border-slate-900 scale-110" : "border-slate-200"}`}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
