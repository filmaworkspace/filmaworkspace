"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useRef, useState } from "react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { CELL_INPUT } from "@/lib/budgeting";
import { useSlashCommands } from "@/hooks/useSlashCommands";
import BudgetingFloatingMenu from "@/components/BudgetingFloatingMenu";

// ─────────────────────────────────────────────────────────────────────────────
// Fila "fantasma": se muestra en vez del "Clic derecho para añadir una
// línea" cuando un nivel (Capítulos del Top Sheet, Cuentas de un Capítulo)
// está vacío del todo. Se ve y se usa como una fila real —código y
// descripción editables ya mismo, sin tener que crearla antes—, pero no
// existe en Firestore hasta que se escribe algo en cualquiera de los dos
// campos y se sale de la celda: ahí es cuando `onCreate` la convierte en la
// primera fila de verdad. El clic derecho se conserva, por si se prefiere
// el menú de siempre.
//
// Comandos "/": escribir "/" en Descripción abre un mini-menú (a lo
// Notion/Slack, mismo espíritu que "@" para Globales) para crear
// directamente una línea de texto o un subtotal, sin tener que hacer clic
// derecho. Mientras la descripción empiece por "/" no se crea un ítem
// normal al salir del campo: hay que elegir un comando o borrar la "/".
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingPhantomRow({
  cols, fmt, onCreate, onCreateText, onCreateSubtotal, onContextMenu,
}: {
  cols: string;
  fmt: (n: number) => string;
  onCreate: (code: string, description: string) => void;
  onCreateText: () => void;
  onCreateSubtotal: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const descWrapRef = useRef<HTMLDivElement>(null);

  const { isCommand, matches } = useSlashCommands(description);

  const runCommand = (cmd: string) => {
    setDescription("");
    if (cmd === "texto") onCreateText();
    else if (cmd === "subtotal") onCreateSubtotal();
  };

  const commit = () => {
    // Con "/" a medio escribir no se crea un ítem normal con eso como
    // descripción: o se elige un comando de la lista, o se borra la "/".
    if (isCommand) { setDescription(""); return; }
    if (!code.trim() && !description.trim()) return;
    onCreate(code.trim(), description.trim());
    // Se limpia por si el onSnapshot tarda un pelín en traer la fila real de
    // vuelta: no debería notarse, esta fila desaparece en cuanto deja de
    // estar vacía la lista.
    setCode("");
    setDescription("");
  };
  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };
  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && isCommand && matches.length > 0) { e.preventDefault(); runCommand(matches[0].cmd); return; }
    if (e.key === "Escape" && isCommand) { setDescription(""); return; }
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
  };

  return (
    <div className={`grid ${cols} gap-0 divide-x divide-slate-200 pl-3 pr-3 bg-white group`} onContextMenu={onContextMenu}>
      <span />
      <span />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onBlur={commit}
        onKeyDown={handleCodeKeyDown}
        className={`${CELL_INPUT} font-mono text-xs pl-2`}
      />
      <div ref={descWrapRef} className="relative h-full">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commit}
          onKeyDown={handleDescriptionKeyDown}
          className={`${CELL_INPUT} text-xs pl-2`}
        />
        {isCommand && matches.length > 0 && (
          <BudgetingFloatingMenu anchorRef={descWrapRef} className="w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
            {matches.map((c) => (
              <button
                key={c.cmd}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runCommand(c.cmd)}
                className="w-full flex flex-col items-start px-2.5 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="text-xs font-medium" style={{ color: "#E86F4A" }}>/{c.cmd}</span>
                <span className="text-[10px] text-slate-400">{c.hint}</span>
              </button>
            ))}
          </BudgetingFloatingMenu>
        )}
      </div>
      <span className="flex items-center justify-end text-xs font-medium text-slate-700 pr-2">{fmt(0)}</span>
      <span />
    </div>
  );
}
