"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Bold, Plus, Sigma, Trash2, Type } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { TEXT_LINE_COLORS } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Menú de clic derecho sobre una fila, igual en Top Sheet, Capítulo y
// Detalle: insertar una línea/línea de texto/subtotal justo debajo de la
// fila pulsada, y (si la fila es de texto o subtotal) negrita/color.
// Un solo componente, montado una vez por página en la posición del clic.
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetingRowContextMenuState {
  x: number;
  y: number;
  /** null = clic en un hueco vacío de la tabla: insertar al principio de la lista. */
  rowId: string | null;
  /** Si la fila pulsada es de texto o subtotal, se puede tocar negrita/color desde aquí mismo. */
  style?: { bold: boolean; color: string; onChangeBold: (v: boolean) => void; onChangeColor: (c: string) => void };
  onDelete?: () => void;
}

export default function BudgetingRowContextMenu({
  state, onClose, onInsertLine, onInsertText, onInsertSubtotal,
}: {
  state: BudgetingRowContextMenuState;
  onClose: () => void;
  onInsertLine: () => void;
  onInsertText: () => void;
  onInsertSubtotal: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(state.x, window.innerWidth - rect.width - 8);
    const y = Math.min(state.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.x, state.y]);

  const itemClass = "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50";

  return (
    <div ref={ref} className="fixed z-[60] w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5" style={{ left: pos.x, top: pos.y }}>
      <button className={itemClass} onClick={() => { onInsertLine(); onClose(); }}>
        <Plus size={13} className="text-slate-400" /> Insertar línea
      </button>
      <button className={itemClass} onClick={() => { onInsertText(); onClose(); }}>
        <Type size={13} className="text-slate-400" /> Insertar línea de texto
      </button>
      <button className={itemClass} onClick={() => { onInsertSubtotal(); onClose(); }}>
        <Sigma size={13} className="text-slate-400" /> Insertar subtotal
      </button>

      {state.style && (
        <>
          <div className="border-t border-slate-100 my-1.5" />
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-slate-700">Negrita</span>
            <button
              onClick={() => state.style!.onChangeBold(!state.style!.bold)}
              className={`p-1 rounded transition-colors ${state.style!.bold ? "text-[#8DA7BE] bg-[#8DA7BE]/[0.1]" : "text-slate-300 hover:text-slate-500"}`}
            >
              <Bold size={12} />
            </button>
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-xs text-slate-700">Color</span>
            <div className="flex items-center gap-1">
              {TEXT_LINE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => state.style!.onChangeColor(c)}
                  className={`w-3.5 h-3.5 rounded-full border transition-transform ${c === state.style!.color ? "border-slate-900 scale-110" : "border-slate-200"}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {state.onDelete && (
        <>
          <div className="border-t border-slate-100 my-1.5" />
          <button className={`${itemClass} text-red-500 hover:bg-red-50`} onClick={() => { state.onDelete!(); onClose(); }}>
            <Trash2 size={13} /> Eliminar
          </button>
        </>
      )}
    </div>
  );
}
