"use client";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Calculator } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { BUDGETING_ACCENT_DARK } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingHomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm" style={{ background: `linear-gradient(135deg, #6C64F5, ${BUDGETING_ACCENT_DARK})` }}>
        <Calculator size={22} className="text-white" />
      </div>
      <p className="text-sm font-medium text-slate-900">Selecciona o crea un presupuesto</p>
    </div>
  );
}
