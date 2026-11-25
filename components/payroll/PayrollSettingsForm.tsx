"use client";

// Ajustes de nóminas: cortes por grupo, marcas diarias (columna y tarifa),
// conceptos propios del proyecto y columnas que se usan. Controlado.

import { Plus, Trash2 } from "lucide-react";
import { Button, Checkbox, Field, Input, Select } from "@/components/ds";
import {
  AMOUNT_COLUMNS, CUT_GROUPS, GROUPS, type CutGroup, type DailyItem, type PayrollSettings,
} from "@/lib/payroll/model";

const num = (v: string) => { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-8 text-[13px] font-semibold text-slate-900 first:mt-0">{children}</h3>;
}

export function PayrollSettingsForm({ value: s, onChange }: { value: PayrollSettings; onChange: (s: PayrollSettings) => void }) {
  const set = (p: Partial<PayrollSettings>) => onChange({ ...s, ...p });
  const setItem = (i: number, p: Partial<DailyItem>) => set({ items: s.items.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const setCut = (g: CutGroup, p: Partial<PayrollSettings["cutoffs"][CutGroup]>) => set({ cutoffs: { ...s.cutoffs, [g]: { ...s.cutoffs[g], ...p } } });
  const colOptions = AMOUNT_COLUMNS.filter((c) => c.group !== "descuentos" && c.group !== "especie" && c.group !== "it");

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Empresa"><Input value={s.company} onChange={(e) => set({ company: e.target.value })} /></Field>
        <Field label="Base mensual (días)"><Input inputMode="numeric" value={String(s.baseMonth)} onChange={(e) => set({ baseMonth: num(e.target.value) || 30 })} /></Field>
        <Field label="Base semanal (días)"><Input inputMode="numeric" value={String(s.baseWeek)} onChange={(e) => set({ baseWeek: num(e.target.value) || 7 })} /></Field>
      </div>

      <H>Cortes</H>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {CUT_GROUPS.map((g) => {
          const c = s.cutoffs[g.id];
          return (
            <div key={g.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-0">
              <span className="min-w-0 flex-1 text-[13px] text-slate-900">{g.label}</span>
              <div className="w-40">
                <Select value={c.mode} onChange={(e) => setCut(g.id, { mode: e.target.value as "natural" | "day" })}>
                  <option value="natural">Mes natural</option>
                  <option value="day">Corte el día</option>
                </Select>
              </div>
              <div className={`w-16 ${c.mode === "day" ? "" : "invisible"}`}>
                <Input aria-label={`Día de corte · ${g.label}`} inputMode="numeric" value={String(c.day)} onChange={(e) => setCut(g.id, { day: Math.max(1, Math.min(28, Math.round(num(e.target.value)) || 1)) })} className="h-9 text-right tabular-nums" />
              </div>
            </div>
          );
        })}
      </div>

      <H>Marcas por día</H>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-[#FAFAFA] text-xs text-slate-500">
              <th className="w-10 px-3 py-2" />
              <th className="px-3 py-2 text-left font-medium">Marca</th>
              <th className="w-16 px-2 py-2 text-left font-medium">Corta</th>
              <th className="w-24 px-2 py-2 text-left font-medium">Por</th>
              <th className="w-56 px-2 py-2 text-left font-medium">Columna del cuadro</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Tarifa</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Artistas</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {s.items.map((it, i) => (
              <tr key={it.id} className={`border-b border-slate-100 last:border-0 ${it.active ? "" : "text-slate-400"}`}>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Usar ${it.label}`} checked={it.active} onChange={(e) => setItem(i, { active: e.target.checked })} className="h-4 w-4 accent-slate-900" /></td>
                <td className="px-3 py-1.5"><Input aria-label="Nombre" value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} className="h-8" /></td>
                <td className="px-2 py-1.5"><Input aria-label="Abreviatura" value={it.short} maxLength={3} onChange={(e) => setItem(i, { short: e.target.value })} className="h-8" /></td>
                <td className="px-2 py-1.5">
                  <Select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value as DailyItem["unit"] })}>
                    <option value="day">día</option><option value="km">km</option><option value="hour">hora</option>
                  </Select>
                </td>
                <td className="px-2 py-1.5">
                  <Select value={String(it.code)} onChange={(e) => setItem(i, { code: Number(e.target.value) })}>
                    {colOptions.map((c) => <option key={c.code} value={String(c.code)}>{c.code} · {c.label}</option>)}
                  </Select>
                </td>
                <td className="px-2 py-1.5"><Input aria-label="Tarifa" inputMode="decimal" value={String(it.rate)} onChange={(e) => setItem(i, { rate: num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                <td className="px-2 py-1.5"><Input aria-label="Tarifa artistas" inputMode="decimal" placeholder="Igual" value={it.rateArtistic == null ? "" : String(it.rateArtistic)} onChange={(e) => setItem(i, { rateArtistic: e.target.value.trim() === "" ? undefined : num(e.target.value) })} className="h-8 text-right tabular-nums" /></td>
                <td className="px-2 py-1.5 text-right">
                  {it.id.startsWith("x") && <button aria-label={`Quitar ${it.label}`} onClick={() => set({ items: s.items.filter((_, k) => k !== i) })} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-end">
        <Button variant="ghost" size="sm" onClick={() => set({ items: [...s.items, { id: `x${Date.now().toString(36)}`, label: "Nueva marca", short: "N", unit: "day", code: 603, rate: 0, active: true }] })}><Plus size={13} /> Añadir marca</Button>
      </div>

      <H>Conceptos y descuentos del proyecto</H>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...s.projectConcepts.map((c, i) => ({ c, i, kind: "p" as const })), ...s.projectDiscounts.map((c, i) => ({ c, i, kind: "d" as const }))].map(({ c, i, kind }) => {
          const upd = (p: Partial<typeof c>) => kind === "p"
            ? set({ projectConcepts: s.projectConcepts.map((x, k) => (k === i ? { ...x, ...p } : x)) })
            : set({ projectDiscounts: s.projectDiscounts.map((x, k) => (k === i ? { ...x, ...p } : x)) });
          return (
            <div key={`${kind}${i}`} className="flex items-center gap-2">
              <span className="w-24 flex-shrink-0 text-xs text-slate-500">{kind === "p" ? `Concepto ${i + 1}` : `Descuento ${i + 1}`}</span>
              <Input aria-label="Código" inputMode="numeric" placeholder="Cód." value={c.code == null ? "" : String(c.code)} onChange={(e) => upd({ code: e.target.value.trim() ? Math.round(num(e.target.value)) : null })} className="h-8 w-20 text-right font-mono tabular-nums" />
              <Input aria-label="Nombre" placeholder="Nombre" value={c.label} onChange={(e) => upd({ label: e.target.value })} className="h-8" />
            </div>
          );
        })}
      </div>

      <H>Columnas en uso</H>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {GROUPS.filter((g) => g.id !== "proyecto").map((g) => (
          <div key={g.id}>
            <p className="mb-1 text-xs font-medium text-slate-500">{g.label}</p>
            {AMOUNT_COLUMNS.filter((c) => c.group === g.id).map((c) => {
              const k = String(c.code), on = !s.hiddenColumns.includes(k);
              return <Checkbox key={k} checked={on} label={`${c.code} · ${c.label}`} onChange={(v) => set({ hiddenColumns: v ? s.hiddenColumns.filter((x) => x !== k) : [...s.hiddenColumns, k] })} />;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
