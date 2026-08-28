"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Check, ChevronDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Desplegable propio de Budgeting: nada de <select> nativo del navegador.
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
  const [pos, setPos] = useState<{ left?: number; right?: number; minWidth: number; top?: number; bottom?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // `fixed` respecto al viewport (calculado desde el botón), no `absolute`
  // dentro del formulario: así no se queda recortado por el overflow de un
  // modal cuando el campo está pegado abajo. Si no cabe hacia abajo, se abre
  // hacia arriba.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const estHeight = 280;
    const openUp = window.innerHeight - rect.bottom < estHeight && rect.top > estHeight;
    const horizontal = align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left };
    setPos({
      ...horizontal,
      minWidth: rect.width,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open, align]);

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button
        ref={btnRef}
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
      {open && pos && (
        <div
          className="fixed bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-[70] max-h-64 overflow-y-auto"
          style={{ left: pos.left, right: pos.right, minWidth: pos.minWidth, top: pos.top, bottom: pos.bottom }}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-sm text-left whitespace-nowrap hover:bg-slate-50 transition-colors ${o.value === value ? "font-medium text-[#6D5A88]" : "text-slate-700"}`}
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
