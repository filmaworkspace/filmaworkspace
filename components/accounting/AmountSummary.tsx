"use client";

// Importes de una PO o factura: la BASE IMPONIBLE manda (grande); IVA, IRPF y
// total quedan en pequeño debajo.

const fmt = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);

export function AmountSummary({
  base, vat, irpf, total, symbol = "€", title = "Base imponible", children, className = "",
}: {
  base: number; vat: number; irpf?: number; total: number; symbol?: string; title?: string;
  children?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      <div className="px-5 pb-4 pt-4">
        <p className="text-xs text-slate-500">{title}</p>
        <p className="mt-0.5 text-[28px] font-semibold leading-tight tracking-tight tabular-nums text-slate-900">
          {fmt(base)} <span className="text-lg font-medium text-slate-400">{symbol}</span>
        </p>
        <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-[13px]">
          <div className="flex justify-between"><dt className="text-slate-500">IVA</dt><dd className="tabular-nums text-slate-700">+{fmt(vat)} {symbol}</dd></div>
          {!!irpf && <div className="flex justify-between"><dt className="text-slate-500">IRPF</dt><dd className="tabular-nums text-slate-700">−{fmt(irpf)} {symbol}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-500">Total</dt><dd className="tabular-nums text-slate-700">{fmt(total)} {symbol}</dd></div>
        </dl>
        {children}
      </div>
    </div>
  );
}
