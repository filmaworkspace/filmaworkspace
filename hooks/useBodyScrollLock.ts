"use client";

import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Bloquea el scroll de la página de detrás mientras hay un modal a pantalla
// completa abierto (fixed inset-0) con su propio scroll interno: sin esto,
// deslizar dentro del modal —sobre todo al llegar al final de su contenido,
// donde el scroll "encadena" hacia lo de detrás— también mueve la página que
// queda debajo. Restaura el valor anterior de `overflow` al cerrar/desmontar,
// no lo pisa a "" a lo bruto (por si ya venía tocado por otra cosa).
//
// Se bloquea tanto <body> como <html>: solo <body> no basta en todos los
// casos — si <html> no tiene su propio `overflow` fijado, el navegador
// puede seguir usándolo como "scroller" de la página aunque <body> esté en
// hidden (la propagación de overflow de body al viewport no es fiable al
// 100%), y entonces el scroll dentro del modal seguía "encadenando" hacia
// la página de detrás. `overscroll-behavior: contain` es un cinturón extra:
// evita que el scroll al llegar al final del propio body/html rebote/pase
// a lo que hay por debajo (el navegador, en vez de la página).
//
// `allowSelector` (opcional) añade un tercer cinturón, a prueba de bombas:
// intercepta cualquier `wheel`/`touchmove` a nivel de documento y lo cancela
// a la fuerza salvo que se origine dentro de un elemento que haga match con
// ese selector (p.ej. "[data-modal-card]") — así, aunque el `overflow:
// hidden` de arriba fallara por lo que sea (algún navegador o combinación
// rara), el scroll de la página de detrás sigue sin poder moverse. Sin
// `allowSelector` no se activa este bloqueo duro (así los modales que no lo
// pasan siguen exactamente igual que antes). Usa un selector, no una ref
// única, para que valga igual con varios modales anidados abiertos a la vez
// (cada uno marca su propia tarjeta con el mismo atributo).
// ─────────────────────────────────────────────────────────────────────────────

export function useBodyScrollLock(active: boolean, allowSelector?: string) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const originalHtmlOverflow = html.style.overflow;
    const originalBodyOverflow = body.style.overflow;
    const originalHtmlOverscroll = html.style.overscrollBehavior;
    const originalBodyOverscroll = body.style.overscrollBehavior;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehavior = "contain";
    body.style.overscrollBehavior = "contain";

    let blockScroll: ((e: Event) => void) | null = null;
    if (allowSelector) {
      blockScroll = (e: Event) => {
        const target = e.target as Element | null;
        if (target && target.closest(allowSelector)) return;
        e.preventDefault();
      };
      document.addEventListener("wheel", blockScroll, { passive: false });
      document.addEventListener("touchmove", blockScroll, { passive: false });
    }

    return () => {
      html.style.overflow = originalHtmlOverflow;
      body.style.overflow = originalBodyOverflow;
      html.style.overscrollBehavior = originalHtmlOverscroll;
      body.style.overscrollBehavior = originalBodyOverscroll;
      if (blockScroll) {
        document.removeEventListener("wheel", blockScroll);
        document.removeEventListener("touchmove", blockScroll);
      }
    };
  }, [active, allowSelector]);
}
