"use client";

import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Estado y mecánica genéricos de "arrastrar y soltar" para reordenar una
// lista de filas (Capítulos, Cuentas, líneas de Detalle): en qué fila está
// encima el arrastre y en qué mitad (arriba/abajo, para saber si se suelta
// antes o después de esa fila), usado junto con BudgetingDragHandle. El
// cálculo del nuevo `order` en sí lo hace cada página con `orderAfter()` de
// lib/budgeting.ts (orden por huecos: solo hay que tocar el documento
// arrastrado, nadie más cambia de `order`), este hook solo resuelve el
// `afterId` a partir de dónde se soltó.
// ─────────────────────────────────────────────────────────────────────────────

export type DragOverState = { id: string; position: "before" | "after" } | null;

export function useRowDrag() {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState>(null);

  const onDragStart = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragOverRow = (id: string) => (e: React.DragEvent<HTMLDivElement>) => {
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const position: "before" | "after" = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
    setDragOver((prev) => (prev && prev.id === id && prev.position === position ? prev : { id, position }));
  };

  const reset = () => { setDraggedId(null); setDragOver(null); };

  return { draggedId, dragOver, onDragStart, onDragOverRow, reset };
}

/** A partir de dónde se soltó (antes/después de qué fila) y la lista ya ordenada, calcula el id tras el que debe quedar la fila arrastrada (null = al principio). */
export function resolveDragAfterId(sortedSiblings: { id: string }[], dragOver: DragOverState): string | null {
  if (!dragOver) return null;
  if (dragOver.position === "after") return dragOver.id;
  const idx = sortedSiblings.findIndex((s) => s.id === dragOver.id);
  if (idx <= 0) return null;
  return sortedSiblings[idx - 1].id;
}
