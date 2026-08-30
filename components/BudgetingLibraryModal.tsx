"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import BudgetingCategoriesPanel from "@/components/BudgetingCategoriesPanel";
import BudgetingFringesPanel from "@/components/BudgetingFringesPanel";
import BudgetingGlobalsPanel from "@/components/BudgetingGlobalsPanel";
import BudgetingSettingsList from "@/components/BudgetingSettingsList";
import BudgetingUnitsPanel from "@/components/BudgetingUnitsPanel";
import BudgetingVersionsPanel from "@/components/BudgetingVersionsPanel";

const ACCENT = "#E86F4A";

export type BudgetingLibraryTab = "categories" | "phases" | "fringes" | "globals" | "units" | "versions";

const TABS: { id: BudgetingLibraryTab; label: string }[] = [
  { id: "categories", label: "Categorías" },
  { id: "phases", label: "Fases" },
  { id: "fringes", label: "Cargas sociales" },
  { id: "globals", label: "Globales" },
  { id: "units", label: "Unidades" },
  { id: "versions", label: "Versiones" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Todos los ajustes de un borrador (antes repartidos en 6 rutas propias con
// su propio hueco en el sidebar) viven aquí dentro, como pestañas de un solo
// modal grande: así el Presupuesto (Top Sheet) se queda con todo el ancho
// para la tabla, y estos ajustes —que se tocan mucho menos a menudo— no
// piden un sitio permanente en pantalla. Se abre desde el botón "Librería"
// del BudgetingShell, que también sabe abrirlo directo en una pestaña
// concreta (p.ej. desde un enlace "Cargas sociales" en el Detalle).
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingLibraryModal({
  draftId, open, initialTab = "categories", onClose,
}: {
  draftId: string; open: boolean; initialTab?: BudgetingLibraryTab; onClose: () => void;
}) {
  const [tab, setTab] = useState<BudgetingLibraryTab>(initialTab);

  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[85vh] flex overflow-hidden">
        <aside className="w-48 flex-shrink-0 border-r border-slate-100 py-4 px-2.5 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">Librería</p>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`block w-full text-left px-2.5 py-2 rounded-lg text-sm transition-colors ${tab === t.id ? "" : "text-slate-600 hover:bg-slate-50"}`}
              style={tab === t.id ? { background: `${ACCENT}1a`, color: ACCENT, fontWeight: 500 } : undefined}
            >
              {t.label}
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
            <h2 className="text-sm font-semibold text-slate-900">{TABS.find((t) => t.id === tab)?.label}</h2>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {tab === "categories" && <BudgetingCategoriesPanel draftId={draftId} />}
            {tab === "phases" && (
              <BudgetingSettingsList
                draftId={draftId}
                arrayField="phases"
                fields={[{ key: "label", label: "Nombre", type: "text" }]}
                emptyLabel="Sin fases todavía"
              />
            )}
            {tab === "fringes" && <BudgetingFringesPanel draftId={draftId} />}
            {tab === "globals" && <BudgetingGlobalsPanel draftId={draftId} />}
            {tab === "units" && <BudgetingUnitsPanel draftId={draftId} />}
            {tab === "versions" && <BudgetingVersionsPanel draftId={draftId} />}
          </div>
        </div>
      </div>
    </div>
  );
}
