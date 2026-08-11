"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ChevronDown, Folder, Plus } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { BudgetingFolder } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Selector de carpeta reutilizado por Globales y Fringes: permite elegir una
// carpeta existente o crear una nueva al vuelo, sin desplegable nativo del
// navegador. No hay anidamiento — son carpetas planas, solo para agrupar la
// lista visualmente.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  folders: BudgetingFolder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  onCreateFolder: (label: string) => void;
}

export default function BudgetingFolderPicker({ folders, value, onChange, onCreateFolder }: Props) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setNewLabel(""); } };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = folders.find((f) => f.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors"
      >
        <span className="flex items-center gap-1.5 truncate text-slate-700">
          <Folder size={13} className="text-slate-400 flex-shrink-0" />
          {current ? current.label : "Sin carpeta"}
        </span>
        <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 max-h-56 overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-3.5 py-1.5 text-sm hover:bg-slate-50 ${!value ? "font-medium" : "text-slate-600"}`}
            style={!value ? { color: "#8DA7BE" } : undefined}
          >
            Sin carpeta
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => { onChange(f.id); setOpen(false); }}
              className={`w-full text-left px-3.5 py-1.5 text-sm hover:bg-slate-50 truncate ${value === f.id ? "font-medium" : "text-slate-600"}`}
              style={value === f.id ? { color: "#8DA7BE" } : undefined}
            >
              {f.label}
            </button>
          ))}
          <div className="px-2 pt-1.5 mt-1 border-t border-slate-100 flex items-center gap-1">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) { onCreateFolder(newLabel.trim()); setNewLabel(""); } }}
              placeholder="Nueva carpeta..."
              className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-[#8DA7BE]"
            />
            <button
              onClick={() => { if (newLabel.trim()) { onCreateFolder(newLabel.trim()); setNewLabel(""); } }}
              className="p-1.5 rounded-lg text-white flex-shrink-0"
              style={{ background: "#8DA7BE" }}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
