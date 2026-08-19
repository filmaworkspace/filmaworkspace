"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowUpRight, Percent } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { BudgetingFringe, CELL_INPUT } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Fila de una carga social ("fringe") representada en el nivel donde su
// alcance calcula el importe (Top Sheet para "total", Capítulo para
// "chapter"): aparece como una línea más, con su propio código y nombre
// editables (misma fringe de draft.fringes, no una copia), pero el importe
// es de solo lectura porque sale calculado de las líneas de detalle.
// Usa el mismo `cols` que las filas de esa tabla para alinearse con ellas.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingFringeLineRow({
  fringe, amount, fmt, draftId, cols, tooltip, onCommit,
}: {
  fringe: BudgetingFringe; amount: number; fmt: (n: number) => string; draftId: string; cols: string; tooltip: string;
  onCommit: (code: string, label: string) => void;
}) {
  const [code, setCode] = useState(fringe.code);
  const [label, setLabel] = useState(fringe.label);

  const commit = () => {
    if (!code.trim() || !label.trim()) { setCode(fringe.code); setLabel(fringe.label); return; }
    onCommit(code.trim(), label.trim());
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") { setCode(fringe.code); setLabel(fringe.label); }
  };

  return (
    <div className={`grid ${cols} gap-0 divide-x divide-slate-200 px-3 hover:bg-slate-50 group`}>
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
        href={`/budgeting/${draftId}/fringes`}
        className="flex items-center justify-end gap-0 pl-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-[#C2652F]"
        title="Ver en Cargas sociales"
      >
        <ArrowUpRight size={12} />
      </Link>
    </div>
  );
}
