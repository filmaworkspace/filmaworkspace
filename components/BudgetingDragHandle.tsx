"use client";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { GripVertical } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Icono de "agarrar y arrastrar" para reordenar una fila (Capítulo, Cuenta o
// línea de Detalle): sustituye a las flechas de subir/bajar de un paso, para
// poder soltar una fila donde se quiera de un solo gesto. Solo el icono es
// `draggable`, no la fila entera, así que el drag nunca compite con la
// selección múltiple (shift/cmd+clic) ni con los inputs de la fila; el
// `stopPropagation` del mousedown evita que ese clic también dispare la
// selección de la fila al agarrar el icono. Ver hooks/useRowDrag.ts para el
// resto del mecanismo (con qué fila coincide, antes o después).
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingDragHandle({ onDragStart, onDragEnd }: {
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseDown={(e) => e.stopPropagation()}
      className="flex items-center justify-center h-full cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity"
      title="Arrastrar para reordenar"
    >
      <GripVertical size={12} />
    </div>
  );
}
