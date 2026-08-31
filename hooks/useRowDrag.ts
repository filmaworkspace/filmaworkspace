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
// Depende del algoritmo de arrastre del propio navegador y se cancela en
// silencio si el nodo de origen se re-renderiza en el momento equivocado.
//
// La primera versión con ratón normal seguía guardando "sobre qué fila estoy"
// en estado de React (`dragOver`), y por tanto cada `mousemove` volvía a
// renderizar TODA la página (recalculando listas ordenadas, totales, etc. de
// cada fila) solo para mover un borde de sitio — con presupuestos grandes eso
// se queda corto de fotogramas y el indicador se ve tarde, a saltos, o
// directamente no da tiempo a verlo antes de soltar (justo lo que se
// reportó: "a veces no se pone naranjita", "más abajo falla más" — cuantas
// más filas de por medio, más caro el re-render). Ahora el indicador se
// pinta directamente en el DOM (con `element.style`, sin pasar por React en
// absoluto) en cada `mousemove`: no hay re-render de por medio, así que
// nunca se queda atrás por mucha lista que haya. React solo vuelve a
// renderizar dos veces por arrastre (al empezar y al soltar), no en cada
// píxel de movimiento.
//
// Qué fila está bajo el cursor se resuelve con `elementFromPoint` +
// `closest()` sobre el atributo `data-drag-row-id` (puesto en el contenedor
// de cada fila), y `getBoundingClientRect()` decide si toca antes o después.
// Al soltar (`mouseup`), se llama al callback que cada página registra con
// el resultado final ya resuelto por ella (conoce el grupo exacto de
// hermanos —p.ej. la categoría de un Capítulo— que el hook no tiene por qué
// conocer).
// ─────────────────────────────────────────────────────────────────────────────

export type DragOverState = { id: string; position: "before" | "after" } | null;

const INDICATOR_COLOR = "#E86F4A";
// `box-shadow` en vez de `border`: se pinta encima sin ocupar espacio propio,
// así la fila no da un salto de layout de 2px al aparecer/desaparecer el
// indicador (un `border` sí lo haría, al no tener borde previo que sustituir).
const SHADOW_BEFORE = `inset 0 2px 0 0 ${INDICATOR_COLOR}`;
const SHADOW_AFTER = `inset 0 -2px 0 0 ${INDICATOR_COLOR}`;

export function useRowDrag(onDrop: (draggedId: string, dragOver: DragOverState) => void) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const draggedIdRef = useRef<string | null>(null);
  const dragOverRef = useRef<DragOverState>(null);
  const highlightedElRef = useRef<HTMLElement | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const clearHighlight = () => {
    if (highlightedElRef.current) {
      highlightedElRef.current.style.boxShadow = "";
      highlightedElRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearHighlight();
    draggedIdRef.current = null;
    dragOverRef.current = null;
    setDraggedId(null);
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
        if (dragOverRef.current !== null) { dragOverRef.current = null; clearHighlight(); }
        return;
      }
      const rect = row!.getBoundingClientRect();
      const position: "before" | "after" = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
      const prev = dragOverRef.current;
      if (prev && prev.id === id && prev.position === position) return;
      dragOverRef.current = { id, position };
      if (highlightedElRef.current !== row) clearHighlight();
      row!.style.boxShadow = position === "before" ? SHADOW_BEFORE : SHADOW_AFTER;
      highlightedElRef.current = row;
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
      clearHighlight();
    };
  }, [draggedId, reset]);

  return { draggedId, onHandleMouseDown, reset };
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
