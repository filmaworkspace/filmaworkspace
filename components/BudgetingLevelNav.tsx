"use client";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ChevronLeft, ChevronRight } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import BudgetingDropdown from "@/components/BudgetingDropdown";

// ─────────────────────────────────────────────────────────────────────────────
// Navegador de "saltar a otro hermano" para la cabecera de un nivel del
// presupuesto: flechas anterior/siguiente + un desplegable propio (nada de
// <select> nativo) para ir directo a uno concreto sin tener que volver atrás
// y entrar de nuevo. Se usa en dos sitios con el mismo mecanismo pero
// alcance distinto — quien lo usa decide qué lista de `options` pasar:
//   - Cuenta (accounts/[accountId]): entre Capítulos de todo el presupuesto.
//   - Detalle (subchapters/[subchapterId]): entre Cuentas, pero solo las del
//     Capítulo actual (no las de todo el presupuesto — antes el desplegable
//     mezclaba las de todos los capítulos, que es justo lo que no se quería).
// No se enseña con un solo hermano (o ninguno): no hay a dónde ir.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingLevelNav({
  options, currentId, onNavigate, prevTitle, nextTitle,
}: {
  options: { value: string; label: string }[];
  currentId: string;
  onNavigate: (id: string) => void;
  prevTitle: string;
  nextTitle: string;
}) {
  if (options.length <= 1) return null;
  const idx = options.findIndex((o) => o.value === currentId);

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={() => idx > 0 && onNavigate(options[idx - 1].value)}
        disabled={idx <= 0}
        className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors disabled:opacity-20 disabled:pointer-events-none"
        title={prevTitle}
      >
        <ChevronLeft size={13} />
      </button>
      <BudgetingDropdown
        value={currentId}
        options={options}
        onChange={onNavigate}
        buttonClassName="flex items-center justify-between gap-1.5 max-w-[220px] text-xs text-slate-600 border border-slate-200 rounded-lg pl-2 pr-1.5 py-1 hover:border-slate-300 transition-colors bg-white"
      />
      <button
        onClick={() => idx >= 0 && idx < options.length - 1 && onNavigate(options[idx + 1].value)}
        disabled={idx < 0 || idx >= options.length - 1}
        className="p-1 rounded text-slate-400 hover:text-[#E86F4A] hover:bg-[#E86F4A]/[0.1] transition-colors disabled:opacity-20 disabled:pointer-events-none"
        title={nextTitle}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
