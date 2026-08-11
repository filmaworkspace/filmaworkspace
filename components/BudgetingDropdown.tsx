"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Check, ChevronDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Desplegable propio de Budgeting — nada de <select> nativo del navegador.
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetingDropdownOption {
  value: string;
  label: string;
}

export default function BudgetingDropdown({
  value, options, onChange, placeholder, className, buttonClassName, align = "left",
}: {
  value: string;
  options: BudgetingDropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          buttonClassName ||
          "flex items-center justify-between gap-2 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors"
        }
      >
        <span className={current ? "text-slate-900 truncate" : "text-slate-400 truncate"}>{current?.label || placeholder || "Selecciona"}</span>
        <ChevronDown size={13} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className={`absolute top-full mt-1.5 min-w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50 max-h-64 overflow-y-auto ${align === "right" ? "right-0" : "left-0"}`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-sm text-left whitespace-nowrap hover:bg-slate-50 transition-colors ${o.value === value ? "font-medium text-[#5B57E0]" : "text-slate-700"}`}
            >
              {o.label}
              {o.value === value && <Check size={13} className="flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
