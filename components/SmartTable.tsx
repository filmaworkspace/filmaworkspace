"use client";

// ─── Tabla configurable ──────────────────────────────────────────────────────
// Columnas que se muestran, ocultan y reordenan; orden y filtro por columna;
// edición en línea de campos sencillos (fechas, listas). La configuración se
// guarda por tabla y usuario en este navegador.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Columns3, Filter, Loader2, Pencil, RotateCcw, X } from "lucide-react";
import { AnchoredPanel } from "@/components/ds";

export interface InlineEdit<T> {
  type: "date" | "select";
  /** Valor actual: fecha ISO (yyyy-mm-dd) o texto. */
  value: (row: T) => string;
  options?: string[];
  can: (row: T) => boolean;
  save: (row: T, value: string) => Promise<void>;
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
  /** Siempre visible y sin mover (identificador de la fila). */
  locked?: boolean;
  defaultHidden?: boolean;
  /** Permite ordenar por esta columna. */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Permite filtrar: «text» (contiene) o «values» (lista de valores). */
  filter?: { type: "text" | "values"; value: (row: T) => string };
  edit?: InlineEdit<T>;
  footer?: (rows: T[]) => React.ReactNode;
  className?: string;
}

interface Config { order: string[]; hidden: string[]; sort: { key: string; dir: "asc" | "desc" } | null; filters: Record<string, string[]> }

function load(key: string): Partial<Config> {
  try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
}

/** Estado de la tabla (columnas, orden, filtros) persistido. */
export function useTableConfig<T>(storageKey: string, columns: Column<T>[]) {
  const defaults: Config = { order: columns.map((c) => c.key), hidden: columns.filter((c) => c.defaultHidden).map((c) => c.key), sort: null, filters: {} };
  const [cfg, setCfg] = useState<Config>(defaults);
  const ready = useRef(false);
  useEffect(() => {
    const saved = load(storageKey);
    const known = new Set(columns.map((c) => c.key));
    const order = [...(saved.order || []).filter((k) => known.has(k)), ...columns.map((c) => c.key).filter((k) => !(saved.order || []).includes(k))];
    setCfg({
      order,
      hidden: (saved.hidden || defaults.hidden).filter((k) => known.has(k) && !columns.find((c) => c.key === k)?.locked),
      sort: saved.sort && known.has(saved.sort.key) ? saved.sort : null,
      filters: Object.fromEntries(Object.entries(saved.filters || {}).filter(([k, v]) => known.has(k) && v?.length)),
    });
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!ready.current) return;
    try { localStorage.setItem(storageKey, JSON.stringify(cfg)); } catch { /* sin almacenamiento */ }
  }, [cfg, storageKey]);

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const visible = cfg.order.map((k) => byKey.get(k)!).filter((c) => c && !cfg.hidden.includes(c.key));

  const apply = (rows: T[]) => {
    let out = rows;
    for (const [k, vals] of Object.entries(cfg.filters)) {
      const col = byKey.get(k);
      if (!col?.filter || !vals.length) continue;
      if (col.filter.type === "text") {
        const q = vals[0].toLowerCase();
        out = out.filter((r) => col.filter!.value(r).toLowerCase().includes(q));
      } else {
        const set = new Set(vals);
        out = out.filter((r) => set.has(col.filter!.value(r)));
      }
    }
    const s = cfg.sort;
    const col = s ? byKey.get(s.key) : null;
    if (s && col?.sortValue) {
      const dir = s.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const x = col.sortValue!(a), y = col.sortValue!(b);
        if (x === y) return 0;
        if (x === null || x === undefined || x === "") return 1;
        if (y === null || y === undefined || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true })) * dir;
      });
    }
    return out;
  };

  return {
    cfg, visible, apply, columns,
    activeFilters: Object.values(cfg.filters).filter((v) => v.length).length,
    setSort: (key: string) => setCfg((c) => ({ ...c, sort: c.sort?.key !== key ? { key, dir: "asc" } : c.sort.dir === "asc" ? { key, dir: "desc" } : null })),
    setFilter: (key: string, vals: string[]) => setCfg((c) => ({ ...c, filters: { ...c.filters, [key]: vals } })),
    clearFilters: () => setCfg((c) => ({ ...c, filters: {} })),
    toggle: (key: string) => setCfg((c) => ({ ...c, hidden: c.hidden.includes(key) ? c.hidden.filter((k) => k !== key) : [...c.hidden, key] })),
    move: (key: string, dir: -1 | 1) => setCfg((c) => {
      const o = [...c.order]; const i = o.indexOf(key), j = i + dir;
      if (i < 0 || j < 0 || j >= o.length || byKey.get(o[j])?.locked) return c;
      [o[i], o[j]] = [o[j], o[i]];
      return { ...c, order: o };
    }),
    reset: () => setCfg(defaults),
  };
}

export type TableState<T> = ReturnType<typeof useTableConfig<T>>;

// ── Botón «Columnas» ─────────────────────────────────────────────────────────
export function ColumnsMenu<T>({ table }: { table: TableState<T> }) {
  const [open, setOpen] = useState(false);
  useOutside(open, () => setOpen(false));
  const order = table.cfg.order.map((k) => table.columns.find((c) => c.key === k)!).filter(Boolean);
  return (
    <span className="relative inline-flex">
      <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-700 hover:bg-[#F7F7F8]">
        <Columns3 size={14} /> Columnas
      </button>
      {open && (
        <AnchoredPanel align="right" className="w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {order.map((c, i) => {
            const on = !table.cfg.hidden.includes(c.key);
            return (
              <div key={c.key} className="flex items-center gap-2 px-2 py-0.5 hover:bg-[#F7F7F8]">
                <label className={`flex flex-1 items-center gap-2 py-1 text-[13px] ${c.locked ? "text-slate-500" : "cursor-pointer text-slate-800"}`}>
                  <input type="checkbox" checked={on} disabled={c.locked} onChange={() => table.toggle(c.key)} className="h-3.5 w-3.5 accent-slate-900" />
                  {c.label}
                </label>
                {!c.locked && (
                  <span className="flex">
                    <button type="button" aria-label={`Subir ${c.label}`} disabled={i === 0 || order[i - 1]?.locked} onClick={() => table.move(c.key, -1)} className="rounded p-0.5 text-slate-400 hover:text-slate-900 disabled:opacity-30"><ChevronUp size={14} /></button>
                    <button type="button" aria-label={`Bajar ${c.label}`} disabled={i === order.length - 1} onClick={() => table.move(c.key, 1)} className="rounded p-0.5 text-slate-400 hover:text-slate-900 disabled:opacity-30"><ChevronDown size={14} /></button>
                  </span>
                )}
              </div>
            );
          })}
          <div className="mt-1 border-t border-slate-100 px-2 pt-1">
            <button type="button" onClick={() => table.reset()} className="flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-xs text-slate-500 hover:text-slate-900"><RotateCcw size={12} /> Restablecer tabla</button>
          </div>
        </AnchoredPanel>
      )}
    </span>
  );
}

// ── Cabecera con orden y filtro ──────────────────────────────────────────────
function HeaderCell<T>({ col, table, rows, first }: { col: Column<T>; table: TableState<T>; rows: T[]; first: boolean }) {
  const [open, setOpen] = useState(false);
  useOutside(open, () => setOpen(false));
  const sort = table.cfg.sort?.key === col.key ? table.cfg.sort.dir : null;
  const vals = table.cfg.filters[col.key] || [];
  const right = col.align === "right";
  const distinct = useMemo(() => (col.filter?.type === "values" ? Array.from(new Set(rows.map((r) => col.filter!.value(r)))).sort((a, b) => a.localeCompare(b, "es")) : []), [rows, col]);
  return (
    <th scope="col" aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      className={`${first ? "pl-4 pr-3" : "px-3"} py-1.5 font-medium ${right ? "text-right" : "text-left"} ${col.width || ""}`}>
      <span className={`group inline-flex items-center gap-1 ${right ? "flex-row-reverse" : ""}`}>
        {col.sortValue ? (
          <button type="button" onClick={() => table.setSort(col.key)} className={`inline-flex items-center gap-1 rounded hover:text-slate-900 ${sort ? "text-slate-900" : ""}`}>
            {col.label}
            {sort === "asc" ? <ArrowUp size={11} /> : sort === "desc" ? <ArrowDown size={11} /> : null}
          </button>
        ) : col.label}
        {col.filter && (
          <span className="relative inline-flex">
            <button type="button" aria-label={`Filtrar ${col.label}`} aria-expanded={open} onMouseDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)}
              className={`rounded p-0.5 ${vals.length ? "text-[#2F52E0]" : "text-slate-400 opacity-0 hover:text-slate-900 focus-visible:opacity-100 group-hover:opacity-100"} ${open ? "opacity-100" : ""}`}>
              <Filter size={11} />
            </button>
            {open && (
              <AnchoredPanel align={right ? "right" : "left"} className="w-60 rounded-lg border border-slate-200 bg-white p-2 text-left text-[13px] font-normal text-slate-800 shadow-lg">
                {col.filter.type === "text" ? (
                  <input autoFocus value={vals[0] || ""} placeholder={`Contiene…`} aria-label={`Filtro ${col.label}`}
                    onChange={(e) => table.setFilter(col.key, e.target.value ? [e.target.value] : [])}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpen(false); }}
                    className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-[13px] focus:border-slate-400 focus:outline-none" />
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {distinct.map((v) => (
                      <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[#F7F7F8]">
                        <input type="checkbox" checked={vals.includes(v)} className="h-3.5 w-3.5 accent-slate-900"
                          onChange={() => table.setFilter(col.key, vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v])} />
                        <span className="flex-1 truncate">{v || "—"}</span>
                        <span className="text-xs tabular-nums text-slate-400">{rows.filter((r) => col.filter!.value(r) === v).length}</span>
                      </label>
                    ))}
                  </div>
                )}
                {vals.length > 0 && (
                  <button type="button" onClick={() => table.setFilter(col.key, [])} className="mt-1.5 flex items-center gap-1 px-1 text-xs text-slate-500 hover:text-slate-900"><X size={11} /> Quitar filtro</button>
                )}
              </AnchoredPanel>
            )}
          </span>
        )}
      </span>
    </th>
  );
}

// ── Celda editable ───────────────────────────────────────────────────────────
function EditableCell<T>({ row, col }: { row: T; col: Column<T> }) {
  const e = col.edit!;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const can = e.can(row);
  const commit = async (v: string) => {
    setEditing(false);
    if (v === e.value(row)) return;
    setBusy(true);
    try { await e.save(row, v); setDone(true); setTimeout(() => setDone(false), 1200); } finally { setBusy(false); }
  };
  if (editing) {
    const common = "h-7 w-full min-w-[120px] rounded-md border border-slate-400 bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-slate-900/10";
    return (
      <span onClick={(ev) => ev.stopPropagation()}>
        {e.type === "date" ? (
          <input type="date" autoFocus defaultValue={e.value(row)} aria-label={col.label} className={common}
            onBlur={(ev) => commit(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") commit((ev.target as HTMLInputElement).value); if (ev.key === "Escape") setEditing(false); }} />
        ) : (
          <select autoFocus defaultValue={e.value(row)} aria-label={col.label} className={common}
            onChange={(ev) => commit(ev.target.value)} onBlur={() => setEditing(false)}
            onKeyDown={(ev) => { if (ev.key === "Escape") setEditing(false); }}>
            <option value="">—</option>
            {Array.from(new Set([...(e.options || []), e.value(row)].filter(Boolean))).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </span>
    );
  }
  return (
    <span className="group/edit inline-flex max-w-full items-center gap-1.5">
      <span className="min-w-0 truncate">{col.render(row)}</span>
      {busy ? <Loader2 size={12} className="animate-spin text-slate-400" />
        : done ? <Check size={12} className="text-emerald-600" />
        : can && (
          <button type="button" aria-label={`Editar ${col.label}`} onClick={(ev) => { ev.stopPropagation(); setEditing(true); }}
            className="rounded p-0.5 text-slate-400 opacity-0 hover:text-slate-900 focus-visible:opacity-100 group-hover/edit:opacity-100">
            <Pencil size={11} />
          </button>
        )}
    </span>
  );
}

// ── Tabla ────────────────────────────────────────────────────────────────────
export function SmartTable<T>({
  table, rows, allRows, rowKey, onRowClick, rowClassName, actions, footerLabel, minWidth = "min-w-[1000px]",
}: {
  table: TableState<T>;
  rows: T[];
  /** Filas antes de los filtros de columna (para los valores de los filtros). */
  allRows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  actions?: (row: T) => React.ReactNode;
  footerLabel?: string;
  minWidth?: string;
}) {
  const cols = table.visible;
  const firstFooter = cols.findIndex((c) => c.footer);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className={`tbl w-full ${minWidth} border-collapse text-[13px]`}>
        <thead>
          <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-600">
            {cols.map((c, i) => <HeaderCell key={c.key} col={c} table={table} rows={allRows} first={i === 0} />)}
            {actions && <th scope="col" className="w-12 py-1.5 pr-3"><span className="sr-only">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(r); } : undefined}
              className={`border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA] ${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(r) || ""}`}>
              {cols.map((c, i) => (
                <td key={c.key} className={`${i === 0 ? "relative pl-4 pr-3" : "px-3"} py-1.5 ${c.align === "right" ? "text-right" : ""} ${c.className || ""}`}>
                  {c.edit ? <EditableCell row={r} col={c} /> : c.render(r)}
                </td>
              ))}
              {actions && <td className="py-1.5 pr-3 text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
        {firstFooter >= 0 && (
          <tfoot>
            <tr className="border-t border-slate-200 bg-[#F4F4F5] text-xs">
              {cols.map((c, i) => {
                if (i < firstFooter) return i === 0 ? <td key={c.key} colSpan={firstFooter} className="px-4 py-2 font-semibold">{footerLabel}</td> : null;
                return <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""} tabular-nums font-semibold`}>{c.footer?.(rows)}</td>;
              })}
              {actions && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Chip con los filtros de columna activos. */
export function ColumnFiltersBar<T>({ table }: { table: TableState<T> }) {
  const active = Object.entries(table.cfg.filters).filter(([, v]) => v.length);
  if (!active.length) return null;
  return (
    <>
      {active.map(([k, v]) => {
        const col = table.columns.find((c) => c.key === k);
        return (
          <button key={k} type="button" onClick={() => table.setFilter(k, [])}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-[#F7F7F8] px-1.5 py-0.5 text-xs text-slate-700 hover:border-slate-300">
            {col?.label}: {col?.filter?.type === "text" ? `«${v[0]}»` : v.length === 1 ? v[0] || "—" : `${v.length} valores`} <X size={11} />
          </button>
        );
      })}
    </>
  );
}


function useOutside(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => document.addEventListener("mousedown", close), 0);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", k);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", close); document.removeEventListener("keydown", k); };
  }, [open, close]);
}
