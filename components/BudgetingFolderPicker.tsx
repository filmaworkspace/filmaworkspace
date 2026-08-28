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
// navegador. No hay anidamiento: son carpetas planas, solo para agrupar la
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
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setNewLabel(""); } };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // El desplegable se posiciona con `fixed` respecto al viewport (calculado
  // desde el botón), no `absolute` dentro del formulario: así no se queda
  // recortado por el overflow-y-auto del modal cuando el campo está pegado
  // abajo. Si no cabe hacia abajo, se abre hacia arriba.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const estHeight = 260;
    const openUp = window.innerHeight - rect.bottom < estHeight && rect.top > estHeight;
    setPos(openUp
      ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4 }
      : { left: rect.left, width: rect.width, top: rect.bottom + 4 });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);

  const current = folders.find((f) => f.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        ref={btnRef}
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
      {open && pos && (
        <div
          className="fixed z-[70] bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 max-h-56 overflow-y-auto"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
        >
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-3.5 py-1.5 text-sm hover:bg-slate-50 ${!value ? "font-medium" : "text-slate-600"}`}
            style={!value ? { color: "#6D5A88" } : undefined}
          >
            Sin carpeta
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => { onChange(f.id); setOpen(false); }}
              className={`w-full text-left px-3.5 py-1.5 text-sm hover:bg-slate-50 truncate ${value === f.id ? "font-medium" : "text-slate-600"}`}
              style={value === f.id ? { color: "#6D5A88" } : undefined}
            >
              {f.label}
            </button>
          ))}
          <div className="px-2 pt-1.5 mt-1 border-t border-slate-100 flex items-center gap-1">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) { onCreateFolder(newLabel.trim()); setNewLabel(""); } }}
              placeholder="Nueva carpeta"
              className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-[#6D5A88]"
            />
            <button
              onClick={() => { if (newLabel.trim()) { onCreateFolder(newLabel.trim()); setNewLabel(""); } }}
              className="p-1.5 rounded-lg text-white flex-shrink-0"
              style={{ background: "#6D5A88" }}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
