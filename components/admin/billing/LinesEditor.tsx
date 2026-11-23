"use client";

// Editor de líneas de una factura o presupuesto: concepto, cantidad, precio,
// IVA e importe, con reordenar, duplicar y borrar.

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ds";
import { BillingLine, eur, lineTotal, newLineId } from "@/lib/billing";

const num = (v: string) => { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export function LinesEditor({ lines, onChange, defaultVat, readOnly, compact }: { lines: BillingLine[]; onChange: (l: BillingLine[]) => void; defaultVat: number; readOnly?: boolean; compact?: boolean }) {
  // Compacto (dentro de una fase): columnas más estrechas y solo duplicar y quitar.
  const cols = compact ? "grid-cols-[minmax(0,1fr)_48px_84px_44px_84px_52px]" : "grid-cols-[minmax(0,1fr)_72px_110px_64px_96px_auto]";
  const set = (i: number, patch: Partial<BillingLine>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: number) => { const n = [...lines]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div>
      <div className={`grid ${cols} items-center gap-2 border-b border-slate-200 pb-1.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-slate-500`}>
        <span>Concepto</span><span className="text-right">Cant.</span><span className="text-right">Precio</span><span className="text-right">IVA %</span><span className="text-right">Importe</span><span className={compact ? "" : "w-[84px]"} />
      </div>
      {lines.map((l, i) => (
        <div key={l.id} className={`group grid ${cols} items-center gap-2 border-b border-slate-100 py-1.5`}>
          <Input value={l.description} disabled={readOnly} onChange={(e) => set(i, { description: e.target.value })} placeholder="Concepto" />
          <Input value={String(l.quantity)} disabled={readOnly} inputMode="decimal" className="text-right tabular-nums" onChange={(e) => set(i, { quantity: num(e.target.value) })} />
          <Input value={String(l.unitPrice)} disabled={readOnly} inputMode="decimal" className="text-right tabular-nums" onChange={(e) => set(i, { unitPrice: num(e.target.value) })} />
          <Input value={String(l.vatRate)} disabled={readOnly} inputMode="decimal" className="text-right tabular-nums" onChange={(e) => set(i, { vatRate: num(e.target.value) })} />
          <span className="text-right text-[13px] tabular-nums text-slate-900">{eur(lineTotal(l))}</span>
          <span className={`flex justify-end gap-0.5 ${compact ? "" : "w-[84px]"} ${readOnly ? "invisible" : "opacity-0 group-hover:opacity-100"}`}>
            {!compact && <IconButton label="Subir" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>}
            {!compact && <IconButton label="Bajar" disabled={i === lines.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>}
            <IconButton label="Duplicar" onClick={() => onChange([...lines.slice(0, i + 1), { ...l, id: newLineId() }, ...lines.slice(i + 1)])}><Copy size={13} /></IconButton>
            <IconButton label="Quitar" onClick={() => onChange(lines.filter((_, k) => k !== i))}><Trash2 size={13} /></IconButton>
          </span>
        </div>
      ))}
      {!readOnly && (
        <Button variant="ghost" className="mt-2" onClick={() => onChange([...lines, { id: newLineId(), description: "", quantity: 1, unitPrice: 0, vatRate: defaultVat }])}>
          <Plus size={14} /> Añadir línea
        </Button>
      )}
    </div>
  );
}
