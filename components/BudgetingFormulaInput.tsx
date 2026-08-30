"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Input de texto con menciones de Globales al estilo "@": se usa en
// cualquier campo que admite fórmulas (Valor de un Global, Cantidad/X/Tarifa
// de una línea de Detalle). Escribir "@" abre la lista de Globales —clic o
// Tab inserta "@CODIGO"—, un poco a lo Notion/Slack y el sello propio de
// Budgeting: es la forma reconocible de "llamar" a un Global en cualquier
// fórmula. El "@" es opcional para el motor (ver evaluateExpr en
// lib/budgeting.ts, que lo admite y lo descarta al resolver), así que una
// fórmula vieja sin "@" sigue funcionando igual; esto solo cambia cómo se
// escriben las nuevas. No es un <select>: sigue siendo texto libre.
//
// Resaltado en vivo: un <input> nativo no puede colorear solo un trozo de su
// texto, así que debajo va un "calco" (mismas clases, mismo texto) que sí
// pinta cada "@CODIGO" a color; el input de verdad se queda encima con el
// texto invisible (solo se ve el cursor) para seguir siendo editable de
// verdad —selección, teclado, todo funciona en el input real, el calco es
// puramente visual (aria-hidden, sin eventos)—. Un Global reconocido sale en
// naranja; uno a medio escribir o que no existe, en gris con subrayado
// discontinuo, para distinguir "mención confirmada" de "todavía escribiendo".
// ─────────────────────────────────────────────────────────────────────────────

interface GlobalOption { code: string; label: string; }

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  globals: GlobalOption[];
  className?: string;
  autoFocus?: boolean;
  title?: string;
}

/** Trocea el texto en fragmentos planos y menciones "@CODIGO", para pintar cada uno por separado en el calco. */
function splitMentions(text: string): { text: string; mention: boolean }[] {
  const parts = text.split(/(@[A-Za-z0-9_]*)/g).filter((p) => p !== "");
  return parts.map((p) => ({ text: p, mention: p.startsWith("@") }));
}

export default function BudgetingFormulaInput({ value, onChange, onFocus, onBlur, onKeyDown, globals, className, autoFocus, title }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // El calco no tiene su propia barra de scroll: se sincroniza a mano con la
  // del input real cada vez que este se mueve (escribir más allá del ancho
  // visible, flechas, o insertar una mención) para que el texto coloreado
  // no se desalinee del cursor real.
  const syncScroll = () => { if (inputRef.current && backdropRef.current) backdropRef.current.scrollLeft = inputRef.current.scrollLeft; };
  useEffect(syncScroll, [value]);

  // Se dispara con "@" al final de lo escrito hasta ahora (mención, no
  // autocompletado genérico): "@" solo, o "@" + trozo de código.
  const match = /@([A-Za-z0-9_]*)$/.exec(value);
  const token = match ? match[1] : "";
  const suggestions = match
    ? globals.filter((g) => g.code.toLowerCase().startsWith(token.toLowerCase())).slice(0, 6)
    : [];
  const codeSet = new Set(globals.map((g) => g.code.toLowerCase()));

  const insert = (code: string) => {
    const next = match ? value.slice(0, match.index) + "@" + code : value + "@" + code;
    onChange(next);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className="relative h-full">
      <div
        ref={backdropRef}
        aria-hidden
        className={`${className} absolute inset-0 overflow-hidden whitespace-pre pointer-events-none`}
      >
        {splitMentions(value).map((part, i) => {
          if (!part.mention) return <span key={i}>{part.text}</span>;
          const code = part.text.slice(1);
          const known = code.length > 0 && codeSet.has(code.toLowerCase());
          return (
            <span
              key={i}
              style={known
                ? { color: "#E86F4A", fontWeight: 600 }
                : { color: "#94a3b8", textDecoration: "underline", textDecorationStyle: "dashed", textUnderlineOffset: "2px" }}
            >
              {part.text}
            </span>
          );
        })}
      </div>
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        title={title}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onScroll={syncScroll}
        onFocus={() => { setOpen(true); onFocus?.(); }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if ((e.key === "Tab" || e.key === "Enter") && open && suggestions.length > 0) { e.preventDefault(); insert(suggestions[0].code); return; }
          if (e.key === "Escape") setOpen(false);
          onKeyDown?.(e);
        }}
        className={`${className} relative bg-transparent`}
        style={{ color: "transparent", caretColor: "#1D201F" }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-30 top-full left-0 mt-0.5 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-40 overflow-y-auto">
          {suggestions.map((g) => (
            <button
              key={g.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(g.code)}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1 text-left hover:bg-slate-50"
            >
              <span className="text-[11px] font-mono flex-shrink-0" style={{ color: "#E86F4A" }}>@{g.code}</span>
              <span className="text-[10px] text-slate-400 truncate">{g.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
