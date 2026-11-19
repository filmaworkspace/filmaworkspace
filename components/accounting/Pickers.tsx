"use client";

// ─── Selectores compartidos de Contabilidad ──────────────────────────────────
// Los mismos modales en Nueva PO, Editar PO, Nueva factura y Editar factura:
//   · SupplierPickerModal  elegir proveedor (y alta rápida sin salir del modal)
//   · AccountPickerModal   elegir subcuenta presupuestaria
//   · EpisodeModal         repartir una línea entre capítulos (series)

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button, Field, Input, Modal, Segmented } from "@/components/ds";
import { matchCode, matchWords } from "@/lib/search";
import { round2, splitEqually } from "@/lib/amounts";

const money = (n: number) =>
  new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);
  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}

// ─── Proveedor ───────────────────────────────────────────────────────────────

export interface PickerSupplier {
  id: string;
  fiscalName: string;
  commercialName?: string;
  taxId?: string;
  country?: string;
}

export function SupplierPickerModal<T extends PickerSupplier>({
  open, onClose, suppliers, onSelect, onCreate, onNoSupplier,
}: {
  open: boolean;
  onClose: () => void;
  suppliers: T[];
  onSelect: (s: T) => void;
  /** Alta rápida (nombre fiscal + NIF). Si no se pasa, no se ofrece. */
  onCreate?: (data: { fiscalName: string; taxId: string }) => Promise<void>;
  /** "Continuar sin proveedor" (solo en POs). */
  onNoSupplier?: () => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ fiscalName: "", taxId: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setQ(""); setCreating(false); setDraft({ fiscalName: "", taxId: "" }); } }, [open]);

  const rows = useMemo(
    () => suppliers
      .filter((s) => !q.trim() || matchWords(q, s.fiscalName, s.commercialName) || matchCode(q, s.taxId))
      .sort((a, b) => a.fiscalName.localeCompare(b.fiscalName)),
    [suppliers, q],
  );

  const submitCreate = async () => {
    if (!onCreate || !draft.fiscalName.trim() || !draft.taxId.trim()) return;
    setSaving(true);
    try { await onCreate({ fiscalName: draft.fiscalName.trim(), taxId: draft.taxId.trim().toUpperCase() }); }
    finally { setSaving(false); }
  };

  if (creating) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Nuevo proveedor"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>Volver</Button>
            <Button variant="primary" onClick={submitCreate} disabled={saving || !draft.fiscalName.trim() || !draft.taxId.trim()}>
              {saving ? "Creando…" : "Crear y seleccionar"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Nombre fiscal">
            <Input value={draft.fiscalName} onChange={(e) => setDraft({ ...draft, fiscalName: e.target.value })} placeholder="Nombre o razón social" autoFocus />
          </Field>
          <Field label="NIF / CIF">
            <Input value={draft.taxId} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} placeholder="B12345678" className="font-mono" />
          </Field>
          <p className="text-xs text-slate-500">El resto de datos (IBAN, contacto, certificados) se completa en Proveedores.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Seleccionar proveedor"
      width="max-w-2xl"
      footer={
        <>
          {onNoSupplier && (
            <button onClick={onNoSupplier} className="mr-auto text-xs text-slate-400 hover:text-slate-700 hover:underline">
              Continuar sin proveedor
            </button>
          )}
          {onCreate && <Button variant="secondary" onClick={() => { setDraft({ fiscalName: q.trim(), taxId: "" }); setCreating(true); }}>Nuevo proveedor</Button>}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Nombre, nombre comercial o NIF" />
        {rows.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-500">{suppliers.length ? "Sin resultados" : "Aún no hay proveedores"}</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            <table className="tbl w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Proveedor</th>
                  <th scope="col" className="w-36 px-3 py-2 text-left font-medium">NIF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} onClick={() => onSelect(s)} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F4F4F5]">
                    <td className="px-3 py-1.5">
                      <span className="font-medium text-slate-900">{s.fiscalName}</span>
                      {s.commercialName && <span className="ml-2 text-xs text-slate-400">{s.commercialName}</span>}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{s.taxId || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Cuenta presupuestaria ───────────────────────────────────────────────────

export interface PickerSubAccount {
  id: string;
  code: string;
  description: string;
  accountCode?: string;
  accountDescription?: string;
  available?: number;
  budgeted?: number;
}

export function AccountPickerModal<T extends PickerSubAccount>({
  open, onClose, subAccounts, onSelect, showFigures = false, selectedId,
}: {
  open: boolean;
  onClose: () => void;
  subAccounts: T[];
  onSelect: (s: T) => void;
  /** Muestra el disponible (solo quien puede ver el presupuesto). */
  showFigures?: boolean;
  selectedId?: string;
}) {
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setQ(""); }, [open]);

  const rows = useMemo(
    () => subAccounts
      .filter((s) => !q.trim() || matchCode(q, s.code) || matchWords(q, s.description, s.accountDescription))
      .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true })),
    [subAccounts, q],
  );

  // Agrupadas por cuenta, como en el presupuesto
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: T[] }>();
    for (const s of rows) {
      const k = s.accountCode || "";
      if (!map.has(k)) map.set(k, { label: [s.accountCode, s.accountDescription].filter(Boolean).join(" · "), items: [] });
      map.get(k)!.items.push(s);
    }
    return [...map.values()];
  }, [rows]);

  return (
    <Modal open={open} onClose={onClose} title="Seleccionar cuenta" width="max-w-2xl">
      <div className="flex flex-col gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Código (03.01) o descripción" />
        {rows.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-500">{subAccounts.length ? "Sin resultados" : "El presupuesto aún no tiene cuentas"}</p>
        ) : (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
            <table className="tbl w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="w-24 px-3 py-2 text-left font-medium">Código</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Descripción</th>
                  {showFigures && <th scope="col" className="px-3 py-2 text-right font-medium">Disponible</th>}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.label} label={g.label} items={g.items} showFigures={showFigures} selectedId={selectedId} onSelect={onSelect} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function GroupRows<T extends PickerSubAccount>({ label, items, showFigures, selectedId, onSelect }: {
  label: string; items: T[]; showFigures: boolean; selectedId?: string; onSelect: (s: T) => void;
}) {
  return (
    <>
      {label && (
        <tr className="border-b border-slate-100 bg-[#FAFAFA]">
          <td colSpan={showFigures ? 3 : 2} className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</td>
        </tr>
      )}
      {items.map((s) => {
        const low = showFigures && s.budgeted !== undefined && s.available !== undefined && s.available < (s.budgeted || 0) * 0.1;
        return (
          <tr
            key={s.id}
            onClick={() => onSelect(s)}
            className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F4F4F5] ${s.id === selectedId ? "bg-[#F4F4F5]" : ""}`}
          >
            <td className="px-3 py-1.5 font-mono text-xs font-medium text-slate-900">{s.code}</td>
            <td className="px-3 py-1.5 text-slate-800">{s.description}</td>
            {showFigures && (
              <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${(s.available ?? 0) < 0 ? "text-red-700" : low ? "text-amber-800" : "text-slate-600"}`}>
                {s.available !== undefined ? money(s.available) : "—"}
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

// ─── Capítulos ───────────────────────────────────────────────────────────────

export interface EpisodeDistribution {
  episode: number;
  amount: number;
  percentage: number;
}

/**
 * Reparto de una línea entre capítulos. Devuelve [] si es "general" (todos los
 * capítulos a partes iguales) o la lista de capítulos con su importe.
 */
export function EpisodeModal({
  open, onClose, baseAmount, totalEpisodes, initial, onSave, label,
}: {
  open: boolean;
  onClose: () => void;
  baseAmount: number;
  totalEpisodes: number;
  initial?: EpisodeDistribution[];
  onSave: (dist: EpisodeDistribution[]) => void;
  /** Texto bajo el título, p. ej. "Línea 2". */
  label?: string;
}) {
  const [mode, setMode] = useState<"general" | "specific">("general");
  const [split, setSplit] = useState<"equal" | "amount" | "percentage">("equal");
  const [dist, setDist] = useState<EpisodeDistribution[]>([]);

  useEffect(() => {
    if (!open) return;
    const init = initial || [];
    setDist(init);
    setMode(init.length ? "specific" : "general");
    const equal = init.length > 0 && init.every((e) => Math.abs(e.percentage - init[0].percentage) < 0.01);
    setSplit(!init.length || equal ? "equal" : "amount");
  }, [open, initial]);

  const equalize = (list: EpisodeDistribution[]) => {
    const amounts = splitEqually(baseAmount, list.length);
    return list.map((e, i) => ({ ...e, amount: amounts[i], percentage: round2(100 / list.length) }));
  };

  const toggle = (ep: number) => {
    const exists = dist.some((e) => e.episode === ep);
    const next = exists ? dist.filter((e) => e.episode !== ep) : [...dist, { episode: ep, amount: 0, percentage: 0 }].sort((a, b) => a.episode - b.episode);
    setDist(split === "equal" ? equalize(next) : next);
  };
  const setAmount = (ep: number, amount: number) =>
    setDist(dist.map((e) => (e.episode === ep ? { ...e, amount, percentage: baseAmount ? round2((amount / baseAmount) * 100) : 0 } : e)));
  const setPercent = (ep: number, percentage: number) =>
    setDist(dist.map((e) => (e.episode === ep ? { ...e, percentage, amount: round2((percentage / 100) * baseAmount) } : e)));

  const totalPct = round2(dist.reduce((s, e) => s + (e.percentage || 0), 0));
  const totalAmt = round2(dist.reduce((s, e) => s + (e.amount || 0), 0));
  const balanced = split === "equal" || Math.abs(totalPct - 100) < 0.1 || Math.abs(totalAmt - baseAmount) < 0.01;
  const valid = mode === "general" || (dist.length > 0 && balanced);

  const save = () => {
    if (mode === "general") return onSave([]);
    onSave(split === "equal" ? equalize(dist) : dist);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Asignar capítulos"
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!valid}>Guardar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-500">{label ? `${label} · ` : ""}<span className="tabular-nums">{money(baseAmount)} €</span> de base</p>
        <Segmented
          value={mode}
          onChange={(v) => { setMode(v); if (v === "specific" && !dist.length) setDist(equalize([{ episode: 1, amount: 0, percentage: 0 }])); }}
          options={[{ value: "general", label: "Todos los capítulos" }, { value: "specific", label: "Capítulos concretos" }]}
        />

        {mode === "general" ? (
          <p className="text-[13px] text-slate-600">El importe se reparte a partes iguales entre los {totalEpisodes} capítulos.</p>
        ) : (
          <>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Capítulos</p>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map((ep) => {
                  const on = dist.some((e) => e.episode === ep);
                  return (
                    <button
                      key={ep}
                      type="button"
                      onClick={() => toggle(ep)}
                      className={`h-7 min-w-[32px] rounded-md border px-2 tabular-nums text-xs transition-colors ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                    >
                      {ep}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Reparto</p>
              <Segmented
                value={split}
                onChange={(v) => { setSplit(v); if (v === "equal") setDist(equalize(dist)); }}
                options={[{ value: "equal", label: "Partes iguales" }, { value: "amount", label: "Por importe" }, { value: "percentage", label: "Por porcentaje" }]}
              />
            </div>

            {dist.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="tbl w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                      <th scope="col" className="px-3 py-2 text-left font-medium">Capítulo</th>
                      <th scope="col" className="w-32 px-3 py-2 text-right font-medium">Importe</th>
                      <th scope="col" className="w-24 px-3 py-2 text-right font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dist.map((e) => (
                      <tr key={e.episode} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1 tabular-nums text-xs">Cap. {e.episode}</td>
                        <td className="px-3 py-1 text-right">
                          {split === "amount"
                            ? <Input type="number" step="0.01" value={e.amount || ""} onChange={(ev) => setAmount(e.episode, parseFloat(ev.target.value) || 0)} className="h-7 text-right tabular-nums" />
                            : <span className="tabular-nums text-xs">{money(e.amount)}</span>}
                        </td>
                        <td className="px-3 py-1 text-right">
                          {split === "percentage"
                            ? <Input type="number" step="0.01" value={e.percentage || ""} onChange={(ev) => setPercent(e.episode, parseFloat(ev.target.value) || 0)} className="h-7 text-right tabular-nums" />
                            : <span className="tabular-nums text-xs">{(e.percentage || 0).toFixed(1)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="px-3 py-1.5 font-medium">Total</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-semibold ${balanced ? "" : "text-amber-800"}`}>{money(split === "equal" ? baseAmount : totalAmt)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-semibold ${balanced ? "" : "text-amber-800"}`}>{split === "equal" ? "100,0" : totalPct.toFixed(1)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {!balanced && <p className="text-xs text-amber-800">El reparto debe sumar el 100 % ({money(baseAmount)} €).</p>}
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Líneas de una PO para facturar ──────────────────────────────────────────

export interface PickerPOItem {
  id?: string;
  description?: string;
  subAccountCode?: string;
  totalAmount: number;
  invoicedAmount: number;
  availableAmount: number;
}

export function POItemsModal<T extends PickerPOItem>({
  open, onClose, poNumber, items, onPick,
}: {
  open: boolean;
  onClose: () => void;
  poNumber?: string;
  items: T[];
  onPick: (item: T, index: number) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={poNumber ? `Líneas de PO-${poNumber}` : "Líneas de la PO"} width="max-w-3xl">
      {items.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-slate-500">La PO no tiene líneas</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="tbl w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Línea</th>
                  <th scope="col" className="w-20 px-3 py-2 text-left font-medium">Cuenta</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Facturado</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const over = it.availableAmount < 0;
                  const low = !over && it.availableAmount < it.totalAmount * 0.1;
                  return (
                    <tr key={it.id || idx} onClick={() => onPick(it, idx)} title="Añadir a la factura" className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-[#F4F4F5]">
                      <td className="px-3 py-1.5">{it.description || "Sin descripción"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{it.subAccountCode || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs">{money(it.totalAmount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-600">{money(it.invoicedAmount)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums text-xs ${over ? "text-red-700" : low ? "text-amber-800" : ""}`}>{money(it.availableAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Pulsa una línea para añadirla a la factura.</p>
        </>
      )}
    </Modal>
  );
}
