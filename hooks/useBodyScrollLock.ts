"use client";

import { useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Bloquea el scroll de la página de detrás mientras hay un modal a pantalla
// completa abierto (fixed inset-0) con su propio scroll interno: sin esto,
// deslizar dentro del modal —sobre todo al llegar al final de su contenido,
// donde el scroll "encadena" hacia lo de detrás— también mueve la página que
// queda debajo. Restaura el valor anterior de `overflow` al cerrar/desmontar,
// no lo pisa a "" a lo bruto (por si ya venía tocado por otra cosa).
// ─────────────────────────────────────────────────────────────────────────────

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, [active]);
}
