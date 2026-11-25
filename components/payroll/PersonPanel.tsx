"use client";

// Ficha lateral de una persona en la nómina del mes: desglose con el origen de
// cada importe, su ventana de variables, ajustes del mes y datos de nómina.

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ds";
import { inter } from "@/lib/fonts";
import {
  AMOUNT_COLUMNS, CUT_GROUPS, PERIODICITIES, fmtDay, fullName, ibanValid, monthEnd, monthStart, personEnd, projectKey,
  type Line, type PayrollSettings, type PersonRun,
} from "@/lib/payroll/model";

const NF = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions);
export const eur = (n: number) => NF.format(n);
const numOrNull = (v: string) => { if (!v.trim()) return null; const n = parseFloat(v.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

/** Input que guarda al salir (o con Enter). */
function Lazy({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />;
}

export function labelOf(k: string, s: PayrollSettings) {
  if (k.startsWith("p")) { const c = s.projectConcepts[Number(k.slice(1)) - 1]; return c?.label || `Concepto del proyecto ${k.slice(1)}`; }
  if (k.startsWith("d")) { const c = s.projectDiscounts[Number(k.slice(1)) - 1]; return c?.label || `Descuento del proyecto ${k.slice(1)}`; }
  return AMOUNT_COLUMNS.find((c) => String(c.code) === k)?.label || k;
}

export function PersonPanel({ line, runKey, run, settings, onClose, onRun, onPerson, onCrew }: {
  line: Line;
  runKey: string;
  run: PersonRun;
  settings: PayrollSettings;
  onClose: () => void;
  onRun: (patch: Partial<PersonRun>) => void;
  onPerson: (patch: Record<string, unknown>) => void;   // payrollPeople
  onCrew: (patch: Record<string, unknown>) => void;     // crew
}) {
  const p = line.person;
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const end = personEnd(p);
  const leavesThisMonth = !!end && end >= monthStart(runKey) && end <= monthEnd(runKey);
  const varWin = line.windows.dietas;
  const amountKeys = Object.keys(line.amounts).filter((k) => line.amounts[k]);
  const allKeys = [...AMOUNT_COLUMNS.map((c) => String(c.code)), ...settings.projectConcepts.map((_c, i) => projectKey("p", i)), ...settings.projectDiscounts.map((_c, i) => projectKey("d", i))];
  const [newFixed, setNewFixed] = useState("");
  const [newManual, setNewManual] = useState("");

  return (
    <div className={`fixed inset-0 z-50 flex justify-end bg-slate-900/10 ${inter.className}`} onMouseDown={(e) => { if (!panel.current?.contains(e.target as Node)) onClose(); }}>
      <div ref={panel} role="dialog" aria-label={fullName(p)} className="flex h-full w-full max-w-[480px] flex-col border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-slate-900">{fullName(p) || "Sin nombre"}</h2>
            <p className="truncate text-xs text-slate-500">{[p.department, p.role].filter(Boolean).join(" · ") || "Sin departamento"}</p>
          </div>
          <button aria-label="Cerrar" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={16} /></button>
        </div>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 text-[13px]">
          {(line.issues.length > 0 || line.warnings.length > 0) && (
            <ul className="space-y-1">
              {line.issues.map((t) => <li key={t} className="flex gap-2 text-rose-700"><span aria-hidden>●</span>{t}</li>)}
              {line.warnings.map((t) => <li key={t} className="flex gap-2 text-amber-700"><span aria-hidden>●</span>{t}</li>)}
            </ul>
          )}

          {/* Desglose */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Nómina del mes</h3>
            <div className="rounded-lg border border-slate-200">
              <Row label="Salario" sub={line.person.periodicity === "Mensual" ? `${line.daysAlta ?? 0} días de alta${line.comp ? ` − ${line.comp} de compensación` : ""}` : line.person.periodicity === "Cerrado" ? "Cerrado" : `${line.worked} días trabajados`} value={line.gross} />
              {amountKeys.map((k) => (
                <Row key={k} label={labelOf(k, settings)} code={/^\d+$/.test(k) ? k : undefined}
                  sub={[...(line.sources[k] || []).map((s) => `${s.item} ${s.qty} × ${eur(s.rate)}`), p.fixed[k] ? `fijo ${eur(p.fixed[k])}` : "", run.amounts?.[k] ? `este mes ${eur(run.amounts[k])}` : ""].filter(Boolean).join(" · ")}
                  value={line.amounts[k]} />
              ))}
              <div className="flex justify-between border-t border-slate-200 bg-[#FAFAFA] px-3 py-2 font-medium text-slate-900"><span>Total bruto</span><span className="tabular-nums">{eur(line.totalGross)}</span></div>
              {line.totalDiscounts > 0 && <div className="flex justify-between px-3 py-2 text-slate-700"><span>Anticipos y descuentos</span><span className="tabular-nums">−{eur(line.totalDiscounts)}</span></div>}
            </div>
          </section>

          {/* Ventana */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Variables</h3>
            <div className="space-y-1 text-slate-700">
              {CUT_GROUPS.map((g) => <div key={g.id} className="flex justify-between"><span>{g.label}</span><span className="tabular-nums">{fmtDay(line.windows[g.id].from)} a {fmtDay(line.windows[g.id].to)}</span></div>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {leavesThisMonth && run.to !== end && <Button size="sm" onClick={() => onRun({ to: end })}>Liquidar hasta su baja ({fmtDay(end)})</Button>}
              {run.to !== monthEnd(runKey) && <Button size="sm" variant="ghost" onClick={() => onRun({ to: monthEnd(runKey) })}>Hasta fin de mes</Button>}
              <label className="flex items-center gap-2 text-xs text-slate-500">Hasta
                <Input type="date" aria-label="Fin de variables" value={run.to || ""} onChange={(e) => onRun({ to: e.target.value || undefined })} className="h-8 w-36" />
              </label>
              {run.to && <Button size="sm" variant="ghost" onClick={() => onRun({ to: undefined })}>Como el equipo</Button>}
            </div>
            {run.to && <p className="mt-1.5 text-xs text-slate-500">Sus días hasta el {fmtDay(run.to)} van en esta nómina. La siguiente empieza el día después.</p>}
          </section>

          {/* Este mes */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Este mes</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Salario pactado"><Lazy inputMode="decimal" placeholder={p.salary != null ? eur(p.salary) : ""} value={run.salaryOverride != null ? String(run.salaryOverride) : ""} onSave={(v) => onRun({ salaryOverride: numOrNull(v) })} /></Field>
              <Field label="Días trabajados"><Lazy inputMode="numeric" placeholder={String(line.worked)} value={run.workedOverride != null ? String(run.workedOverride) : ""} onSave={(v) => onRun({ workedOverride: numOrNull(v) })} /></Field>
              <Field label="Compensación sin cobro"><Lazy inputMode="numeric" placeholder={String(line.comp)} value={run.compOverride != null ? String(run.compOverride) : ""} onSave={(v) => onRun({ compOverride: numOrNull(v) })} /></Field>
              <Field label="Días de IT"><Lazy inputMode="numeric" placeholder={String(line.itDays)} value={run.itOverride != null ? String(run.itOverride) : ""} onSave={(v) => onRun({ itOverride: numOrNull(v) })} /></Field>
            </div>
            <div className="mt-3 space-y-1.5">
              {Object.entries(run.amounts || {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-slate-700">{labelOf(k, settings)}</span>
                  <Lazy aria-label={labelOf(k, settings)} inputMode="decimal" value={String(v)} onSave={(x) => onRun({ amounts: { ...(run.amounts || {}), [k]: numOrNull(x) || 0 } })} className="h-8 w-28 text-right tabular-nums" />
                  <button aria-label="Quitar" onClick={() => { const a = { ...(run.amounts || {}) }; delete a[k]; onRun({ amounts: a }); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Trash2 size={14} /></button>
                </div>
              ))}
              <div className="w-full">
                <Select value={newManual} onChange={(e) => { const k = e.target.value; setNewManual(""); if (k) onRun({ amounts: { ...(run.amounts || {}), [k]: 0 } }); }}>
                  <option value="">Añadir importe de este mes…</option>
                  {allKeys.filter((k) => !(k in (run.amounts || {}))).map((k) => <option key={k} value={k}>{/^\d+$/.test(k) ? `${k} · ` : ""}{labelOf(k, settings)}</option>)}
                </Select>
              </div>
            </div>
            <div className="mt-3 grid gap-3">
              <Field label="Desglose nómina"><Textarea rows={2} defaultValue={run.breakdown || ""} onBlur={(e) => { if (e.target.value !== (run.breakdown || "")) onRun({ breakdown: e.target.value }); }} /></Field>
              <Field label="Comentarios"><Textarea rows={2} defaultValue={run.comment || ""} onBlur={(e) => { if (e.target.value !== (run.comment || "")) onRun({ comment: e.target.value }); }} /></Field>
            </div>
          </section>

          {/* Fijos */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Fijos cada mes</h3>
            <div className="space-y-1.5">
              {Object.entries(p.fixed).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-slate-700">{labelOf(k, settings)}</span>
                  <Lazy aria-label={labelOf(k, settings)} inputMode="decimal" value={String(v)} onSave={(x) => onPerson({ fixed: { ...p.fixed, [k]: numOrNull(x) || 0 } })} className="h-8 w-28 text-right tabular-nums" />
                  <button aria-label="Quitar" onClick={() => { const f = { ...p.fixed }; delete f[k]; onPerson({ fixed: f }); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Trash2 size={14} /></button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Select value={newFixed} onChange={(e) => setNewFixed(e.target.value)}>
                    <option value="">Concepto fijo…</option>
                    {allKeys.filter((k) => !(k in p.fixed)).map((k) => <option key={k} value={k}>{/^\d+$/.test(k) ? `${k} · ` : ""}{labelOf(k, settings)}</option>)}
                  </Select>
                </div>
                <Button size="sm" disabled={!newFixed} onClick={() => { onPerson({ fixed: { ...p.fixed, [newFixed]: 0 } }); setNewFixed(""); }}><Plus size={13} /> Añadir</Button>
              </div>
            </div>
          </section>

          {/* Datos */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Datos de nómina</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre"><Lazy value={p.firstName} onSave={(v) => onCrew({ firstName: v.trim() })} /></Field>
              <Field label="DNI / NIE / Pasaporte"><Lazy value={p.dni} onSave={(v) => onCrew({ dni: v.trim().toUpperCase() })} /></Field>
              <Field label="Alta en SS"><Lazy type="date" value={p.startDate} onSave={(v) => onCrew({ startDate: v })} /></Field>
              <Field label="Baja estimada"><Lazy type="date" value={p.endDateApprox} onSave={(v) => onCrew({ endDateApprox: v })} /></Field>
              <Field label="Baja definitiva"><Lazy type="date" value={p.ssEndDate} onSave={(v) => onPerson({ ssEndDate: v })} /></Field>
              <Field label="% IRPF"><Lazy inputMode="decimal" value={p.irpf != null ? String(p.irpf) : ""} onSave={(v) => onCrew({ irpfRate: numOrNull(v) })} /></Field>
              <Field label="Salario pactado"><Lazy inputMode="decimal" value={p.salary != null ? String(p.salary) : ""} onSave={(v) => onCrew({ salaryAmount: numOrNull(v) })} /></Field>
              <Field label="Periodicidad">
                <Select value={p.periodicity} onChange={(e) => {
                  const v = e.target.value;
                  onPerson({ periodicity: v });
                  if (v === "Mensual" || v === "Semanal") onCrew({ salaryType: v === "Mensual" ? "monthly" : "weekly" });
                }}>
                  <option value="">Sin indicar</option>
                  {PERIODICITIES.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="IBAN" className="col-span-2"><Lazy value={p.iban} onSave={(v) => onCrew({ bankAccount: v.replace(/\s+/g, "").toUpperCase() })} className={p.iban && !ibanValid(p.iban) ? "border-rose-300" : ""} /></Field>
              <Field label="Código control"><Lazy className="font-mono" value={p.controlCode} onSave={(v) => onPerson({ controlCode: v.trim() })} /></Field>
              <Field label="Cuenta presupuesto"><Lazy className="font-mono" value={p.budgetAccount} onSave={(v) => onPerson({ budgetAccount: v.trim() })} /></Field>
              <Field label="Job title"><Lazy value={p.jobTitle} onSave={(v) => onPerson({ jobTitle: v.trim() })} /></Field>
              <Field label="ID período"><Lazy className="font-mono" value={p.periodId} onSave={(v) => onPerson({ periodId: v.trim() })} /></Field>
              <Field label="Horas pactadas"><Lazy inputMode="decimal" value={p.agreedHours != null ? String(p.agreedHours) : ""} onSave={(v) => onPerson({ agreedHours: numOrNull(v) })} /></Field>
              <Field label="Embargo">
                <Select value={p.embargo ? "si" : "no"} onChange={(e) => onPerson({ embargo: e.target.value === "si" })}>
                  <option value="no">No</option><option value="si">Sí</option>
                </Select>
              </Field>
            </div>
          </section>

          {/* Tarifas propias */}
          <section>
            <h3 className="mb-2 text-xs font-medium text-slate-500">Tarifas propias</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {settings.items.filter((i) => i.active).map((it) => (
                <label key={it.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-700">{it.label}</span>
                  <Lazy aria-label={`Tarifa ${it.label}`} inputMode="decimal" placeholder={eur(p.artistic && it.rateArtistic != null ? it.rateArtistic : it.rate)} value={p.rates[it.id] != null ? String(p.rates[it.id]) : ""}
                    onSave={(v) => { const r = { ...p.rates }; const n = numOrNull(v); if (n == null) delete r[it.id]; else r[it.id] = n; onPerson({ rates: r }); }} className="h-8 w-24 text-right tabular-nums" />
                </label>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, code, sub, value }: { label: string; code?: string; sub?: string; value: number | null }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-slate-900">{code && <span className="mr-1.5 font-mono text-[11px] text-slate-400">{code}</span>}{label}</p>
        {sub && <p className="text-xs text-slate-500">{sub}</p>}
      </div>
      <span className="tabular-nums text-slate-900">{value == null ? "" : eur(value)}</span>
    </div>
  );
}
