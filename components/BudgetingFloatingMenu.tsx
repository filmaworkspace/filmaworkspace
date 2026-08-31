"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

// ─────────────────────────────────────────────────────────────────────────────
// Envoltorio para los desplegables que cuelgan de una celda (comandos "/",
// menciones "@"): se sacan a un portal en <body> y se posicionan con
// `position: fixed` a partir de las coordenadas reales de su ancla, en vez de
// depender de que los contenedores de arriba (la tabla, con `overflow-x-auto`
// para el scroll horizontal) dejen pasar el desbordamiento. Sin esto, ese
// mismo `overflow-x-auto` de la tabla obliga a `overflow-y` a comportarse
// como `auto` también (así lo define CSS cuando un eje no es `visible`), y
// el desplegable queda cortado en vez de flotar por encima de todo. Se
// recalcula la posición una vez al aparecer (el menú se desmonta al
// cerrarse, así que vuelve a medir la próxima vez que se abre).
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingFloatingMenu({
  anchorRef, children, className, align = "left",
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; minWidth: number } | null>(null);

  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(
      align === "right"
        ? { top: rect.bottom + 2, right: window.innerWidth - rect.right, minWidth: rect.width }
        : { top: rect.bottom + 2, left: rect.left, minWidth: rect.width }
    );
  }, [anchorRef, align]);

  if (!pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={className}
      // El portal saca este nodo fuera del árbol DOM del ancla, así que un
      // clic aquí dentro ya no cae dentro de wrapRef/ref para el "cerrar al
      // clicar fuera" de quien lo usa (BudgetingFormulaInput, BudgetingUnitInput,
      // BudgetingColumnsMenu: todos escuchan mousedown en document y miran
      // `ref.contains(e.target)`). Cortar la propagación aquí evita que ese
      // mousedown llegue a document y cierre el menú antes de que el click
      // de la opción elegida llegue a disparar su onClick.
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", top: pos.top, left: pos.left, right: pos.right, minWidth: pos.minWidth, zIndex: 100 }}
    >
      {children}
    </div>,
    document.body
  );
}
