"use client";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { GripVertical } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Icono de "agarrar y arrastrar" para reordenar una fila (Capítulo, Cuenta o
// línea de Detalle): sustituye a las flechas de subir/bajar de un paso, para
// poder soltar una fila donde se quiera de un solo gesto. Solo el icono
// arranca el arrastre (mousedown), no la fila entera, así que nunca compite
// con la selección múltiple (shift/cmd+clic) ni con los inputs de la fila —
// `stopPropagation` evita que ese mismo clic también dispare la selección de
// la fila al agarrar el icono. El mecanismo en sí (ratón normal, no
// drag-and-drop nativo de HTML5 — resultó poco fiable) vive en
// hooks/useRowDrag.ts.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingDragHandle({ onMouseDown }: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e); }}
      className="flex items-center justify-center h-full cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Arrastrar para reordenar"
    >
      <GripVertical size={12} />
    </div>
  );
}
