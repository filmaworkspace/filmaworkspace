"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Arrastrar y soltar para reordenar filas (Capítulos, Cuentas, líneas de
// Detalle), con eventos de ratón normales (mousedown en el icono de agarre +
// mousemove/mouseup en document) en vez del drag-and-drop nativo de HTML5.
//
// El nativo (draggable + dragstart/dragover/drop) resultó poco fiable en la
// práctica: a veces no arrancaba, el indicador de posición no siempre
// aparecía, y mover varias filas hacia abajo fallaba más que hacia arriba.
// Depende del algoritmo de arrastre del propio navegador —hay que llamar a
// `preventDefault()` en cada tick de `dragover` para que cuente como zona de
// suelta válida, Firefox exige `dataTransfer.setData()` para arrancar
// siquiera, y toda la operación se cancela en silencio si el nodo de origen
// se re-renderiza en el momento equivocado— y esas piezas fallaban de forma
// intermitente y difícil de depurar sin poder reproducir en un navegador
// real con sesión.
//
// Con ratón normal el comportamiento es determinista y no depende de nada
// del navegador salvo eventos de ratón corrientes: en cada `mousemove`, con
// el ratón ya pulsado, se busca con `elementFromPoint` + `closest()` sobre
// qué fila cae el cursor (identificadas por el atributo `data-drag-row-id`,
// puesto en el contenedor de cada fila) y se calcula con
// `getBoundingClientRect()` si toca antes o después de esa fila. Al soltar
// (`mouseup`), se llama al callback que cada página registra con el `order`
// final ya resuelto por ella (conoce el grupo exacto de hermanos —p.ej. la
// categoría de un Capítulo— que el hook no tiene por qué conocer).
// ─────────────────────────────────────────────────────────────────────────────

export type DragOverState = { id: string; position: "before" | "after" } | null;

export function useRowDrag(onDrop: (draggedId: string, dragOver: DragOverState) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOverState>(null);

  // Refs para que los listeners de document (montados una sola vez por
  // arrastre) siempre vean el valor más reciente, sin tener que
  // desmontar/remontar el listener en cada mousemove.
  const draggedIdRef = useRef<string | null>(null);
  const dragOverRef = useRef<DragOverState>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const reset = useCallback(() => {
    draggedIdRef.current = null;
    dragOverRef.current = null;
    setDraggedId(null);
    setDragOver(null);
  }, []);

  /** Se pasa como onMouseDown del icono de agarre (BudgetingDragHandle). */
  const onHandleMouseDown = useCallback((id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return; // solo clic izquierdo
    e.preventDefault();
    draggedIdRef.current = id;
    setDraggedId(id);
  }, []);

  useEffect(() => {
    if (!draggedId) return;

    const onMouseMove = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const row = target ? (target.closest("[data-drag-row-id]") as HTMLElement | null) : null;
      const id = row?.getAttribute("data-drag-row-id") || null;
      if (!id || id === draggedIdRef.current) {
        if (dragOverRef.current !== null) { dragOverRef.current = null; setDragOver(null); }
        return;
      }
      const rect = row!.getBoundingClientRect();
      const position: "before" | "after" = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      const prev = dragOverRef.current;
      if (prev && prev.id === id && prev.position === position) return;
      const next = { id, position };
      dragOverRef.current = next;
      setDragOver(next);
    };

    const onMouseUp = () => {
      const dragged = draggedIdRef.current;
      const finalDragOver = dragOverRef.current;
      if (dragged) onDropRef.current(dragged, finalDragOver);
      reset();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [draggedId, reset]);

  return { draggedId, dragOver, onHandleMouseDown, reset };
}

/**
 * A partir de dónde se soltó (antes/después de qué fila) y la lista de
 * hermanos ya ordenada (sin la fila arrastrada — quien llama ya la excluye
 * al construir esta lista, p.ej. `chaptersByCategory(cat).filter(c => c.id
 * !== draggedId)`), calcula el id tras el que debe quedar la fila arrastrada
 * (null = al principio). Se filtra `draggedId` de nuevo aquí por si acaso
 * como red de seguridad: si no se excluye en algún sitio y el hueco anterior
 * a la posición de suelta resulta ser la propia fila arrastrada,
 * `orderAfter` no la encuentra (porque sus `siblings` sí la excluyen) y cae
 * a `nextOrderValue()`, moviendo la fila a un sitio distinto del pedido.
 */
export function resolveDragAfterId(sortedSiblings: { id: string }[], draggedId: string | null, dragOver: DragOverState): string | null {
  if (!dragOver) return null;
  if (dragOver.position === "after") return dragOver.id;
  const siblings = draggedId ? sortedSiblings.filter((s) => s.id !== draggedId) : sortedSiblings;
  const idx = siblings.findIndex((s) => s.id === dragOver.id);
  if (idx <= 0) return null;
  return siblings[idx - 1].id;
}
