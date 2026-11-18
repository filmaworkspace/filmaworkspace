"use client";

// Barra de búsqueda avanzada: selector de campo + texto + nº de resultados.
// Se usa en todas las listas para que la búsqueda funcione igual en todas.

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ds";

export interface SearchField<T extends string> {
  value: T;
  label: string;
  placeholder?: string;
  /** Muestra el texto en monoespaciada (códigos, NIF, IBAN). */
  mono?: boolean;
}

export default function SearchBar<T extends string>({
  fields, field, onField, value, onChange, count,
}: {
  fields: SearchField<T>[];
  field: T;
  onField: (f: T) => void;
  value: string;
  onChange: (v: string) => void;
  /** Resultados encontrados; solo se muestra mientras hay búsqueda. */
  count?: number;
}) {
  const current = fields.find((f) => f.value === field) || fields[0];
  const inputRef = useRef<HTMLInputElement>(null);

  // Atajo: "/" lleva al buscador (si no se está escribiendo ya en otro campo);
  // Escape lo vacía.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    // Ancho fijo e igual en toda la app (selector 176 px + texto 288 px): no se
    // estira para llenar la fila ni se comprime cuando hay más filtros al lado.
    <div className="flex flex-none items-center gap-2">
      <div className="w-44 flex-shrink-0">
        <Select value={field} onChange={(e) => onField(e.target.value as T)}>
          {fields.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
      </div>
      <div className="relative w-72 flex-none">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          ref={inputRef}
          value={value}
          onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }}
          onChange={(e) => onChange(e.target.value)}
          placeholder={current.placeholder || "Buscar"}
          className={`pl-8 pr-8 ${current.mono ? "font-mono" : ""}`}
        />
        {!value && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-[#F7F7F8] px-1.5 font-mono text-[10px] text-slate-400">/</kbd>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Borrar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-900"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {value.trim() && count !== undefined && (
        <span className="w-20 whitespace-nowrap text-xs text-slate-500">{count} {count === 1 ? "resultado" : "resultados"}</span>
      )}
    </div>
  );
}
