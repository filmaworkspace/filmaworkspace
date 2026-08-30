"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { CELL_INPUT } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Fila "fantasma": se muestra en vez del "Clic derecho para añadir una
// línea" cuando un nivel (Capítulos del Top Sheet, Cuentas de un Capítulo)
// está vacío del todo. Se ve y se usa como una fila real —código y
// descripción editables ya mismo, sin tener que crearla antes—, pero no
// existe en Firestore hasta que se escribe algo en cualquiera de los dos
// campos y se sale de la celda: ahí es cuando `onCreate` la convierte en la
// primera fila de verdad. El clic derecho se conserva, por si se prefiere
// insertar directamente una línea de texto o un subtotal en vez de un ítem.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingPhantomRow({
  cols, onCreate, onContextMenu,
}: {
  cols: string;
  onCreate: (code: string, description: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  const commit = () => {
    if (!code.trim() && !description.trim()) return;
    onCreate(code.trim(), description.trim());
    // Se limpia por si el onSnapshot tarda un pelín en traer la fila real de
    // vuelta: no debería notarse, esta fila desaparece en cuanto deja de
    // estar vacía la lista.
    setCode("");
    setDescription("");
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };

  return (
    <div className={`grid ${cols} gap-0 divide-x divide-slate-200 pl-3 pr-3 hover:bg-white group`} onContextMenu={onContextMenu}>
      <span />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="Código"
        className={`${CELL_INPUT} font-mono text-xs pl-2 placeholder:text-slate-300`}
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        placeholder="Descripción — clic derecho para más opciones"
        className={`${CELL_INPUT} text-xs pl-2 placeholder:text-slate-300`}
      />
      <span className="flex items-center justify-end text-xs text-slate-300 pr-2">—</span>
      <span />
    </div>
  );
}
