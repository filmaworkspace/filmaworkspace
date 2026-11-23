"use client";

// Presupuesto por fases: cada fase (preproducción, rodaje, postproducción…)
// con su nombre, sus meses y sus líneas mensuales editables. Debajo de cada
// fase, cuota al mes × meses = total de la fase; al final, el total.

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ds";
import { LinesEditor } from "./LinesEditor";
import { eur, invoiceTotals, monthName, newLineId, phaseSchedule, type QuotePhase } from "@/lib/billing";

export const PHASE_COLORS = ["#24406E", "#5B7BB0", "#8FA9D3", "#3F6B5A", "#7A5C99", "#A6683A"];

export function PhasesEditor({ phases, startMonth, onChange, defaultVat, readOnly, defaultPrice }: {
  phases: QuotePhase[];
  startMonth: string | null;
  onChange: (p: QuotePhase[]) => void;
  defaultVat: number;
  defaultPrice: number;
  readOnly?: boolean;
}) {
  const set = (i: number, patch: Partial<QuotePhase>) => onChange(phases.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => { const n = [...phases]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  const schedule = phaseSchedule({ startMonth, phases });
  const range = (id: string) => {
    const ms = schedule.filter((s) => s.phase.id === id).map((s) => s.month);
    return ms.length ? (ms.length === 1 ? monthName(ms[0]) : `${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}`) : "";
  };

  return (
    <div className="space-y-4">
      {phases.map((p, i) => {
        const m = invoiceTotals(p.lines);
        return (
          <div key={p.id} className="relative overflow-hidden rounded-lg border border-slate-200">
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: PHASE_COLORS[i % PHASE_COLORS.length] }} />
            <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 py-3 pl-5 pr-3">
              <label className="min-w-[180px] flex-1">
                <span className="mb-1 block text-[11px] text-slate-500">Fase</span>
                <Input value={p.name} disabled={readOnly} onChange={(e) => set(i, { name: e.target.value })} placeholder="Preproducción" />
              </label>
              <label className="w-24">
                <span className="mb-1 block text-[11px] text-slate-500">Meses</span>
                <Input value={String(p.months)} disabled={readOnly} inputMode="numeric" className="text-right tabular-nums"
                  onChange={(e) => set(i, { months: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
              </label>
              <div className="flex-1 pb-2 text-right text-xs text-slate-500">
                <span className="capitalize">{range(p.id)}</span>
              </div>
              {!readOnly && (
                <div className="flex gap-0.5 pb-0.5">
                  <IconButton label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
                  <IconButton label="Bajar" disabled={i === phases.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
                  <IconButton label="Quitar fase" onClick={() => onChange(phases.filter((_, k) => k !== i))}><Trash2 size={13} /></IconButton>
                </div>
              )}
            </div>
            <div className="py-2 pl-5 pr-3">
              <LinesEditor lines={p.lines} readOnly={readOnly} defaultVat={defaultVat} onChange={(lines) => set(i, { lines })} />
              <p className="mt-2 text-right text-[13px] text-slate-500">
                {eur(m.baseAmount)} / mes × {p.months} {p.months === 1 ? "mes" : "meses"} = <strong className="font-medium text-slate-900">{eur(m.baseAmount * p.months)}</strong> <span className="text-slate-400">+ IVA</span>
              </p>
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <Button variant="ghost" onClick={() => onChange([...phases, {
          id: newLineId(), name: "", months: 1,
          lines: [{ id: newLineId(), description: "Licencia mensual de Filma Workspace", quantity: 1, unitPrice: defaultPrice, vatRate: defaultVat }],
        }])}>
          <Plus size={14} /> Añadir fase
        </Button>
      )}
    </div>
  );
}
