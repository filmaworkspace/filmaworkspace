"use client";

// Barra de búsqueda avanzada: selector de campo + texto + nº de resultados.
// Se usa en todas las listas para que la búsqueda funcione igual en todas.

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
  return (
    <div className="flex min-w-[300px] flex-1 items-center gap-2">
      <div className="w-44 flex-shrink-0">
        <Select value={field} onChange={(e) => onField(e.target.value as T)}>
          {fields.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
      </div>
      <div className="relative flex-1">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={current.placeholder || "Buscar"}
          className={`pl-8 pr-8 ${current.mono ? "font-mono" : ""}`}
        />
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
        <span className="whitespace-nowrap text-xs text-slate-500">{count} {count === 1 ? "resultado" : "resultados"}</span>
      )}
    </div>
  );
}
