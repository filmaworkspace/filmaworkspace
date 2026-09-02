"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Internal ────────────────────────────────────────────────────────────────
import BudgetingFloatingMenu from "@/components/BudgetingFloatingMenu";

// ─────────────────────────────────────────────────────────────────────────────
// Input de texto para el campo "Unidad" de una línea de Detalle, con
// sugerencias de las Unidades del borrador (ver /units). A diferencia de un
// <input list="..."> nativo (que enseña todas las opciones nada más hacer
// clic), aquí el desplegable solo aparece al escribir al menos una letra,
// filtrado a lo que coincida — sigue siendo texto libre, no un <select>.
// ─────────────────────────────────────────────────────────────────────────────

interface UnitOption { id: string; singular: string; }

interface Props {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  units: UnitOption[];
  className?: string;
  autoFocus?: boolean;
  title?: string;
}

export default function BudgetingUnitInput({ value, onChange, onFocus, onBlur, onKeyDown, units, className, autoFocus, title }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const trimmed = value.trim().toLowerCase();
  const suggestions = trimmed
    ? units.filter((u) => u.singular.toLowerCase().includes(trimmed) && u.singular.toLowerCase() !== trimmed).slice(0, 8)
    : [];

  const select = (singular: string) => {
    onChange(singular);
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
        onFocus={() => onFocus?.()}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === "Tab" && open && suggestions.length > 0) { e.preventDefault(); select(suggestions[0].singular); return; }
          if (e.key === "Escape") setOpen(false);
          onKeyDown?.(e);
        }}
        className={className}
      />
      {open && suggestions.length > 0 && (
        <BudgetingFloatingMenu anchorRef={wrapRef} className="w-40 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-40 overflow-y-auto">
          {suggestions.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(u.singular)}
              className="w-full px-2.5 py-1 text-left text-[11px] text-slate-700 hover:bg-slate-50"
            >
              {u.singular}
            </button>
          ))}
        </BudgetingFloatingMenu>
      )}
    </div>
  );
}
