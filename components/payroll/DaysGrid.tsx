"use client";

// Rejilla personas × días. Se pinta con un "pincel" (una marca): clic para
// poner o quitar, arrastrar para varias celdas. Los días fuera de la ventana
// de la marca elegida se atenúan: van en otra nómina.

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, dayDiff, fullName, parseIso, personEnd, type MonthDays, type PayrollPerson, type Window } from "@/lib/payroll/model";

export interface Brush { id: string; label: string; short: string; unit: "day" | "km" | "hour"; state?: boolean }
export interface CellChange { memberId: string; date: string; cell: Record<string, number> }

const DOW = ["D", "L", "M", "X", "J", "V", "S"];
const dowOf = (s: string) => { const { y, m0, d } = parseIso(s); return new Date(Date.UTC(y, m0, d)).getUTCDay(); };

export function cellOf(days: Record<string, MonthDays>, memberId: string, date: string): Record<string, number> {
  return days[date.slice(0, 7)]?.[memberId]?.[date.slice(8, 10)] || {};
}

export function DaysGrid({ people, days, range, active, brush, qty, brushes, onCommit, onOpenPerson }: {
  people: PayrollPerson[];
  days: Record<string, MonthDays>;
  range: Window;          // días que se muestran
  active: Window;         // ventana de la marca elegida en esta nómina
  brush: Brush;
  qty: number;
  brushes: Brush[];
  onCommit: (changes: CellChange[]) => void;
  onOpenPerson: (id: string) => void;
}) {
  const dates = useMemo(() => {
    const n = Math.max(0, Math.min(120, dayDiff(range.from, range.to) + 1));
    return Array.from({ length: n }, (_, i) => addDays(range.from, i));
  }, [range.from, range.to]);

  // Pintado: cambios pendientes mientras se arrastra
  const [draft, setDraft] = useState<Map<string, CellChange>>(new Map());
  const paint = useRef<{ add: boolean } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const current = (mid: string, date: string) => draft.get(`${mid}|${date}`)?.cell || cellOf(days, mid, date);

  const apply = (mid: string, date: string, add: boolean) => {
    const k = `${mid}|${date}`;
    const base = { ...(draftRef.current.get(k)?.cell || cellOf(days, mid, date)) };
    if (add) base[brush.id] = brush.unit === "day" ? 1 : qty || 1;
    else delete base[brush.id];
    setDraft((d) => new Map(d).set(k, { memberId: mid, date, cell: base }));
  };

  useEffect(() => {
    const up = () => {
      if (!paint.current) return;
      paint.current = null;
      const changes = [...draftRef.current.values()];
      setDraft(new Map());
      if (changes.length) onCommit(changes);
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [onCommit]);

  const monthChange = (i: number) => i > 0 && dates[i].slice(0, 7) !== dates[i - 1].slice(0, 7);
  const inWin = (d: string) => d >= active.from && d <= active.to;
  const short = (id: string) => brushes.find((b) => b.id === id)?.short || id;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 select-none">
      <table className="border-collapse text-[11px]" style={{ minWidth: 220 + dates.length * 34 }}>
        <thead>
          <tr className="border-b border-slate-200 bg-[#FAFAFA]">
            <th className="sticky left-0 z-10 w-[220px] min-w-[220px] bg-[#FAFAFA] px-3 py-1.5 text-left text-xs font-medium text-slate-500">Persona</th>
            {dates.map((d, i) => {
              const w = dowOf(d), wk = w === 0 || w === 6;
              return (
                <th key={d} className={`w-[34px] min-w-[34px] px-0 py-1 text-center font-normal ${monthChange(i) ? "border-l-2 border-slate-300" : ""} ${inWin(d) ? "" : "opacity-40"}`}>
                  <div className={`text-[10px] ${wk ? "text-slate-400" : "text-slate-500"}`}>{DOW[w]}</div>
                  <div className={`tabular-nums ${wk ? "text-slate-400" : "text-slate-900"} ${d.endsWith("-01") ? "font-semibold" : ""}`}>{Number(d.slice(8))}</div>
                </th>
              );
            })}
            <th className="w-12 px-2 text-right text-xs font-medium text-slate-500">{brush.short}</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const end = personEnd(p);
            let total = 0;
            return (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 z-10 bg-white px-3 py-1">
                  <button onClick={() => onOpenPerson(p.id)} className="block w-full truncate text-left text-[13px] text-slate-900 hover:underline">{fullName(p)}</button>
                  <span className="block truncate text-[11px] text-slate-500">{p.department || "Sin departamento"}</span>
                </td>
                {dates.map((d, i) => {
                  const c = current(p.id, d);
                  const out = (p.startDate && d < p.startDate) || (end && d > end);
                  const win = inWin(d);
                  if (win && c[brush.id]) total += brush.unit === "day" ? 1 : c[brush.id];
                  const marks = Object.keys(c).filter((k) => c[k] && k !== "w" && k !== "comp" && k !== "it");
                  const wd = dowOf(d), wk = wd === 0 || wd === 6;
                  const bg = c.it ? "bg-amber-50" : c.comp ? "bg-slate-50" : c.w ? "bg-[#EEF1F6]" : wk ? "bg-[#FBFBFC]" : "";
                  return (
                    <td key={d}
                      onMouseDown={(e) => { e.preventDefault(); const add = !c[brush.id]; paint.current = { add }; apply(p.id, d, add); }}
                      onMouseEnter={() => { if (paint.current) apply(p.id, d, paint.current.add); }}
                      title={`${fullName(p)} · ${Number(d.slice(8))}/${Number(d.slice(5, 7))}${c.w ? " · trabajado" : ""}${c.it ? " · IT" : ""}${c.comp ? " · compensación" : ""}${marks.length ? " · " + marks.map((m) => `${short(m)}${c[m] !== 1 ? " " + c[m] : ""}`).join(", ") : ""}`}
                      className={`h-9 cursor-pointer p-0 text-center align-middle ${monthChange(i) ? "border-l-2 border-slate-300" : "border-l border-slate-100"} ${bg} ${out ? "bg-[repeating-linear-gradient(135deg,transparent,transparent_3px,#F1F1F3_3px,#F1F1F3_5px)]" : ""} ${win ? "" : "opacity-40"} ${c[brush.id] ? "ring-1 ring-inset ring-slate-900" : "hover:bg-slate-100"}`}>
                      <span className="block truncate px-0.5 leading-tight text-slate-700">
                        {c.it ? <span className="font-medium text-amber-700">IT</span> : c.comp ? <span className="text-slate-500">Cp</span> : null}
                        {marks.slice(0, 2).map((m) => <span key={m} className="block">{short(m)}{c[m] !== 1 ? <sup className="ml-px">{c[m]}</sup> : null}</span>)}
                        {marks.length > 2 && <span className="block text-slate-400">+{marks.length - 2}</span>}
                      </span>
                    </td>
                  );
                })}
                <td className="px-2 text-right tabular-nums text-slate-700">{total || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
