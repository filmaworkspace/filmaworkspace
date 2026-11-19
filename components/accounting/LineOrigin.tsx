"use client";

// Origen de una línea de factura: un ítem de la PO de la factura, un ítem de
// OTRA PO, o una línea nueva. El vínculo es un metadato (poId + índice + id del
// ítem): cambiar después el concepto de la línea no lo rompe; lo facturado y
// realizado se imputa siempre a ese ítem (cada ítem funciona como una PO
// dentro de la PO).

import { useMemo, useState } from "react";
import { Modal, Segmented } from "@/components/ds";

export interface OriginPOItem {
  id?: string;
  description?: string;
  subAccountId?: string;
  subAccountCode?: string;
  subAccountDescription?: string;
  quantity?: number;
  unitPrice?: number;
  baseAmount?: number;
  vatRate?: number;
  irpfRate?: number;
  invoicedAmount?: number;
  isClosed?: boolean;
}
export interface OriginPO { id: string; number: string; supplier?: string; items: OriginPOItem[] }
export interface LineLink { poId?: string | null; poNumber?: string | null; poItemIndex?: number | null; poItemId?: string | null; isNewItem: boolean }

const money = (n: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0);
const itemBase = (it: OriginPOItem) => it.baseAmount ?? (it.quantity || 0) * (it.unitPrice || 0);

/** Clave estable de un ítem: su id si lo tiene; si no, su posición. */
export const poItemKey = (it: OriginPOItem | undefined, idx: number) => it?.id || `item-${idx}`;

export function originMode(link: LineLink, invoicePoId?: string | null): "po" | "other" | "new" {
  if (link.isNewItem || link.poItemIndex === null || link.poItemIndex === undefined) return "new";
  return link.poId && invoicePoId && link.poId !== invoicePoId ? "other" : link.poId && !invoicePoId ? "other" : "po";
}

/** Tabla de ítems de una PO con base, facturado y disponible (base imponible). */
function ItemsTable({ po, onPick, pending }: { po: OriginPO; onPick: (it: OriginPOItem, idx: number) => void; pending?: Record<string, number> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="tbl w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-[#FAFAFA] text-[11px] text-slate-500">
            <th className="w-10 px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Ítem</th>
            <th className="w-20 px-3 py-2 text-left font-medium">Cuenta</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Base</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Facturado</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Disponible</th>
          </tr>
        </thead>
        <tbody>
          {po.items.map((it, idx) => {
            const base = itemBase(it);
            const invoiced = (it.invoicedAmount || 0) + (pending?.[`${po.id}:${idx}`] || 0);
            const avail = base - invoiced;
            return (
              <tr key={poItemKey(it, idx)} onClick={() => !it.isClosed && onPick(it, idx)}
                className={`border-b border-slate-100 last:border-0 ${it.isClosed ? "cursor-not-allowed text-slate-400" : "cursor-pointer hover:bg-[#F4F4F5]"}`}
                title={it.isClosed ? "Ítem cerrado" : "Elegir este ítem"}>
                <td className="px-3 py-1.5 tabular-nums text-xs text-slate-500">{idx + 1}</td>
                <td className="truncate px-3 py-1.5">{it.description || "Sin concepto"}{it.isClosed && <span className="ml-1.5 text-xs text-slate-400">· cerrado</span>}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{it.subAccountCode || "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(base)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{money(invoiced)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${avail < 0 ? "text-red-700" : avail < base * 0.1 ? "text-amber-800" : ""}`}>{money(avail)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Modal para elegir un ítem de una PO (la de la factura o cualquier otra accesible). */
export function POItemPicker({ open, onClose, pos, fixedPoId, pending, onPick }: {
  open: boolean; onClose: () => void; pos: OriginPO[]; fixedPoId?: string | null;
  /** Lo ya puesto en esta factura por ítem (clave poId:índice), para el disponible. */
  pending?: Record<string, number>;
  onPick: (po: OriginPO, item: OriginPOItem, idx: number) => void;
}) {
  const [poId, setPoId] = useState<string>("");
  const [q, setQ] = useState("");
  const current = pos.find((p) => p.id === (fixedPoId || poId));
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return pos.filter((p) => p.id !== fixedPoId && (!n || `${p.number} ${p.supplier || ""}`.toLowerCase().includes(n)));
  }, [pos, q, fixedPoId]);
  const close = () => { setPoId(""); setQ(""); onClose(); };
  return (
    <Modal open={open} onClose={close} width="max-w-3xl" title={current ? `Ítems de PO-${current.number}` : "Elegir PO"}>
      {current ? (
        <div className="space-y-3">
          {!fixedPoId && <button onClick={() => setPoId("")} className="text-xs text-slate-500 hover:text-slate-900">← Otra PO</button>}
          <ItemsTable po={current} pending={pending} onPick={(it, idx) => { onPick(current, it, idx); close(); }} />
        </div>
      ) : (
        <div className="space-y-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número o proveedor"
            className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-[13px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
            {list.length === 0 ? <p className="py-8 text-center text-[13px] text-slate-500">No hay POs aprobadas</p> : list.map((p) => (
              <button key={p.id} onClick={() => setPoId(p.id)} className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-[13px] last:border-0 hover:bg-[#F4F4F5]">
                <span className="w-20 font-mono text-xs text-slate-900">PO-{p.number}</span>
                <span className="flex-1 truncate text-slate-700">{p.supplier || "—"}</span>
                <span className="tabular-nums text-xs text-slate-500">{money(p.items.reduce((t, it) => t + itemBase(it), 0))}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Selector compacto del origen de una línea: [PO-0012 · ítem] [Otra PO] [Nuevo].
 * `onLink` recibe el ítem elegido para que la línea copie cuenta e importes
 * la primera vez; el concepto se puede cambiar después sin perder el vínculo.
 */
export function LineOrigin({ link, invoicePO, pos, pending, onLink, onNew }: {
  link: LineLink;
  invoicePO?: OriginPO | null;
  pos: OriginPO[];
  pending?: Record<string, number>;
  onLink: (po: OriginPO, item: OriginPOItem, idx: number) => void;
  onNew: () => void;
}) {
  const mode = originMode(link, invoicePO?.id);
  const [picker, setPicker] = useState<null | "po" | "other">(null);
  const options = [
    ...(invoicePO ? [{ value: "po" as const, label: `PO-${invoicePO.number}` }] : []),
    { value: "other" as const, label: invoicePO ? "Otra PO" : "De una PO" },
    { value: "new" as const, label: "Nuevo" },
  ];
  const linkedPo = link.poId ? pos.find((p) => p.id === link.poId) || (invoicePO?.id === link.poId ? invoicePO : null) : invoicePO;
  const linkedItem = linkedPo && link.poItemIndex != null ? linkedPo.items[link.poItemIndex] : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented value={mode} onChange={(v) => { if (v === "new") onNew(); else setPicker(v); }} options={options} />
      {mode !== "new" && (
        <button type="button" onClick={() => setPicker(mode === "po" ? "po" : "other")} className="min-w-0 max-w-full truncate rounded-md border border-slate-200 px-2 py-1 text-left text-xs text-slate-700 hover:border-slate-300" title="Cambiar ítem">
          {linkedPo && mode === "other" && <span className="mr-1 font-mono text-slate-500">PO-{linkedPo.number}</span>}
          <span className="font-medium">#{(link.poItemIndex ?? 0) + 1}</span> {linkedItem?.description || "Ítem"}
        </button>
      )}
      <POItemPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        pos={picker === "po" && invoicePO ? [invoicePO] : pos.filter((p) => p.id !== invoicePO?.id)}
        fixedPoId={picker === "po" ? invoicePO?.id : undefined}
        pending={pending}
        onPick={onLink}
      />
    </div>
  );
}
