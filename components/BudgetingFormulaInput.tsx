"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Input de texto con autocompletado de códigos de Globales: se usa en
// cualquier campo que admite fórmulas (Valor de un Global, Cantidad/X/Tarifa
// de una línea de Detalle). Mientras escribes, si el último token parece el
// principio de un código, sugiere los Globales que empiezan por ahí; clic o
// Tab lo completa. No es un <select>: sigue siendo texto libre.
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

export default function BudgetingFormulaInput({ value, onChange, onFocus, onBlur, onKeyDown, globals, className, autoFocus, title }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value);
  const token = match ? match[0] : "";
  const suggestions = token
    ? globals.filter((g) => g.code.toLowerCase().startsWith(token.toLowerCase()) && g.code.toLowerCase() !== token.toLowerCase()).slice(0, 6)
    : [];

  const insert = (code: string) => {
    const next = match ? value.slice(0, match.index) + code : value + code;
    onChange(next);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={wrapRef} className="relative h-full">
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        title={title}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); onFocus?.(); }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Tab" && open && suggestions.length > 0) { e.preventDefault(); insert(suggestions[0].code); return; }
          if (e.key === "Escape") setOpen(false);
          onKeyDown?.(e);
        }}
        className={className}
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
              <span className="text-[11px] font-mono flex-shrink-0" style={{ color: "#A855F7" }}>{g.code}</span>
              <span className="text-[10px] text-slate-400 truncate">{g.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
