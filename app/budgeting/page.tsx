"use client";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Wallet } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { BUDGETING_ACCENT } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingHomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: `${BUDGETING_ACCENT}1a` }}>
        <Wallet size={22} style={{ color: BUDGETING_ACCENT }} />
      </div>
      <p className="text-sm font-medium text-slate-900">Selecciona o crea un presupuesto</p>
      <p className="text-xs text-slate-400 text-center max-w-xs">
        Tus borradores aparecen en el panel de la izquierda. Empieza uno nuevo con "Nuevo presupuesto".
      </p>
    </div>
  );
}
