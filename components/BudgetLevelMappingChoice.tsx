"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Selector de "qué nivel de Budgeting se queda como código operativo en
// Accounting" — Budgeting tiene tres niveles (Capítulo → Cuenta → Detalle),
// Accounting solo dos (Cuenta → Subcuenta, siendo la Subcuenta la que se
// asigna en PO/facturas/cajas). Se usa tanto al "Enviar a proyecto" desde
// Budgeting como al cargar un .fwb en Accounting > Budget — mismo choice,
// mismo texto, para que no diverjan.
// ─────────────────────────────────────────────────────────────────────────────

export type BudgetSubaccountLevel = "subchapter" | "detailLine";

const OPTIONS: { value: BudgetSubaccountLevel; title: string; description: string }[] = [
  {
    value: "subchapter",
    title: "Capítulo y Cuenta",
    description: "La Cuenta de Accounting será cada Capítulo, y la Subcuenta cada Cuenta de Budgeting. Es lo habitual: el código que se asigna en PO, facturas y cajas es el de cada Cuenta.",
  },
  {
    value: "detailLine",
    title: "Cuenta y Detalle",
    description: "La Cuenta de Accounting será cada Cuenta de Budgeting, y la Subcuenta cada línea de Detalle. El Capítulo no se conserva; el código que se asigna en PO, facturas y cajas es el de cada línea.",
  },
];

export default function BudgetLevelMappingChoice({
  value, onChange,
}: {
  value: BudgetSubaccountLevel;
  onChange: (v: BudgetSubaccountLevel) => void;
}) {
  return (
    <div className="space-y-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
            value === opt.value ? "border-[#C2652F] bg-[#C2652F]/[0.06]" : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 ${
                value === opt.value ? "border-[#C2652F] bg-[#C2652F]" : "border-slate-300"
              }`}
            />
            <span className="text-sm font-medium text-slate-900">{opt.title}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1" style={{ paddingLeft: "22px" }}>{opt.description}</p>
        </button>
      ))}
    </div>
  );
}
