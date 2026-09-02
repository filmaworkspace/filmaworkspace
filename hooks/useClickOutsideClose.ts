"use client";

import { useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Cierra un modal al hacer click fuera de su tarjeta — pero al revés de como
// se hacía hasta ahora (un onMouseDown en el propio fondo oscuro, comprobando
// `e.target === e.currentTarget`): eso depende de que el click caiga EXACTO
// sobre ese div de fondo, y en algún modal (con lista interna con scroll)
// dejaba de detectarse el click en cualquier punto, sin causa clara.
//
// Este hook, en cambio, escucha a nivel de documento y solo mira si el click
// cayó DENTRO de la tarjeta (`cardRef`) o no — no le importa qué elemento en
// concreto lo recibió, así que no depende de la geometría/orden de pintado
// del fondo. Es el patrón estándar de "click outside" (el mismo que usan
// librerías como Radix/Headless UI), más robusto que comparar `target`.
// ─────────────────────────────────────────────────────────────────────────────

export function useClickOutsideClose(cardRef: React.RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    // Capture: se entera del mousedown antes que cualquier stopPropagation
    // que pueda haber más abajo en el árbol (p.ej. otro dropdown interno).
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => document.removeEventListener("mousedown", handleMouseDown, true);
  }, [active, cardRef]);
}
