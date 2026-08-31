"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowUpRight, Percent } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { CELL_INPUT, FringeGroupTarget } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Fila de una carga social ("fringe") representada en el nivel donde su
// alcance calcula el importe (Top Sheet para "total", Capítulo para
// "chapter"): aparece como una línea más, con su propio código y nombre
// editables — el importe es de solo lectura porque sale calculado de las
// líneas de detalle. Si varios fringes comparten carpeta, ya vienen fundidos
// en una sola fila (ver groupFringeSumsByFolder): en ese caso, editar el
// código/nombre aquí edita la carpeta, no un fringe suelto (`target` decide
// a qué documento escribir; lo resuelve el `onCommit` de quien la use).
// Usa el mismo `cols` que las filas de esa tabla para alinearse con ellas.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingFringeLineRow({
  code: initialCode, label: initialLabel, amount, target, fmt, draftId, cols, tooltip, onCommit,
}: {
  code: string; label: string; amount: number; target: FringeGroupTarget;
  fmt: (n: number) => string; draftId: string; cols: string; tooltip: string;
  onCommit: (target: FringeGroupTarget, code: string, label: string) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [label, setLabel] = useState(initialLabel);

  const commit = () => {
    if (!code.trim() || !label.trim()) { setCode(initialCode); setLabel(initialLabel); return; }
    onCommit(target, code.trim(), label.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(initialCode); setLabel(initialLabel); }
  };

  return (
    <div className={`grid ${cols} gap-0 divide-x divide-slate-200 px-3 hover:bg-slate-50 group`}>
      <span />
      <span className="flex items-center justify-center text-slate-300" title={tooltip}>
        <Percent size={11} />
      </span>
      <input value={code} onChange={(e) => setCode(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`} />
      <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className={`${CELL_INPUT} text-xs pl-2`} />
      <span className="flex items-center justify-end text-xs font-medium text-slate-500 pr-2" title="Importe calculado a partir de las líneas de detalle: no se edita aquí">
        {fmt(amount)}
      </span>
      <Link
        href="?library=fringes"
        className="flex items-center justify-end gap-0 pl-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-[#E86F4A]"
        title="Ver en Cargas sociales"
      >
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}
