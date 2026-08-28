"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { MoreVertical } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Kebab (⋮) genérico para la cabecera de una tabla: se usa en Top Sheet,
// Capítulo y Detalle para activar/desactivar columnas y, en los tres, para
// el toggle de "Mostrar cargas sociales". El contenido del panel lo decide
// quien lo usa (children); este componente solo pone el icono y el popover.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingColumnsMenu({ children, title = "Columnas" }: { children: React.ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded text-slate-400 hover:text-[#6D5A88] hover:bg-[#6D5A88]/[0.1] transition-colors normal-case"
        title={title}
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <div className="absolute z-30 top-full right-0 mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-3 space-y-2 normal-case">
          {children}
        </div>
      )}
    </div>
  );
}
