"use client";

// Vista previa en pantalla de una factura o un presupuesto, con el mismo
// diseño que el PDF (lib/billingPdf.ts): hoja A4, cabecera con el degradado
// de Filma, emisor y cliente, líneas, desglose de IVA y total.

import { eur, lineTotal, partyLines, type BillingParty } from "@/lib/billing";
import type { DocView } from "@/lib/billingPdf";

const label = "text-[7.5px] font-semibold uppercase tracking-[0.08em] text-slate-400";

function Party({ title, p }: { title: string; p: BillingParty }) {
  return (
    <div className="min-w-0">
      <p className={label}>{title}</p>
      <p className="mt-1 text-[10.5px] font-semibold leading-snug text-slate-900">{p.name || <span className="text-slate-300">Sin datos fiscales</span>}</p>
      <div className="mt-0.5 text-[8.5px] leading-[1.5] text-slate-600">
        {p.taxId && <div>NIF {p.taxId}</div>}
        {partyLines(p).map((l) => <div key={l}>{l}</div>)}
        {p.email && <div>{p.email}</div>}
      </div>
    </div>
  );
}

export function DocPreview({ v }: { v: DocView }) {
  const fmtQty = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);
  return (
    <div className="relative mx-auto aspect-[210/297] w-full max-w-[560px] overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(15,23,42,0.08),0_16px_48px_rgba(15,23,42,0.12)] ring-1 ring-slate-200">
      <div className="flex h-full flex-col">
        <div className="relative h-[14.1%] flex-shrink-0 bg-cover bg-left" style={{ backgroundImage: "url(/email/header.jpg)", backgroundColor: "#24406E" }}>
          <div className="absolute right-[8.5%] top-1/2 -translate-y-1/2 text-right text-white">
            <p className="text-[8px] uppercase tracking-[0.18em] opacity-90">{v.title}</p>
            <p className="mt-1 text-[17px] font-bold leading-none tracking-tight">{v.number || "Sin número"}</p>
          </div>
        </div>

        {v.watermark && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-[30deg] select-none text-[72px] font-black tracking-[0.08em] text-slate-900/[0.05]">{v.watermark}</span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-[8.5%] pt-[6%]">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-5">
            <Party title="Emisor" p={v.issuer} />
            <Party title="Cliente" p={v.client} />
            <div className="text-right">
              {v.meta.map(([k, val], i) => (
                <div key={k} className={i ? "mt-2" : ""}>
                  <p className={label}>{k}</p>
                  <p className="ml-auto mt-0.5 max-w-[130px] text-[9.5px] leading-snug text-slate-900">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {v.banner && <div className="mt-5 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[9px] font-semibold leading-relaxed text-slate-900">{v.banner}</div>}

          <table className="mt-5 w-full text-[9.5px]">
            <thead>
              <tr className="border-b-[1.5px] border-slate-900 text-[7.5px] uppercase tracking-[0.06em] text-slate-500">
                <th className="pb-1.5 text-left font-semibold">Concepto</th>
                <th className="w-[9%] pb-1.5 text-right font-semibold">Cant.</th>
                <th className="w-[15%] pb-1.5 text-right font-semibold">Precio</th>
                <th className="w-[8%] pb-1.5 text-right font-semibold">IVA</th>
                <th className="w-[17%] pb-1.5 text-right font-semibold">Importe</th>
              </tr>
            </thead>
            <tbody>
              {v.lines.length === 0 && <tr><td colSpan={5} className="py-3 text-slate-300">Añade las líneas</td></tr>}
              {v.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5 pr-3 text-slate-900">{l.description || <span className="text-slate-300">Concepto</span>}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{fmtQty(l.quantity)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{eur(l.unitPrice)}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-600">{l.vatRate} %</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-900">{eur(lineTotal(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="ml-auto mt-4 w-[46%] text-[9.5px]">
            <div className="flex justify-between py-0.5"><span className="text-slate-500">Base imponible</span><span className="tabular-nums text-slate-900">{eur(v.totals.baseAmount)}</span></div>
            {v.totals.vatBreakdown.map((b) => (
              <div key={b.rate} className="flex justify-between py-0.5"><span className="text-slate-500">IVA {b.rate} %</span><span className="tabular-nums text-slate-900">{eur(b.vat)}</span></div>
            ))}
            <div className="mt-2 flex items-center justify-between rounded px-2.5 py-2 text-white" style={{ background: "#24406E" }}>
              <span className="text-[10px] font-semibold">{v.totalLabel}</span>
              <span className="text-[13px] font-bold tabular-nums">{eur(v.totals.totalAmount)}</span>
            </div>
            {v.extraTotals.map(([k, val], i) => (
              <div key={k} className={`flex justify-between py-0.5 ${i === 0 ? "mt-2 font-semibold text-slate-900" : "text-slate-500"}`}><span>{k}</span><span className="tabular-nums">{val}</span></div>
            ))}
          </div>

          {v.payment.length > 0 && (
            <div className="mt-5">
              <p className={label}>{v.signature ? "Facturación" : "Forma de pago"}</p>
              <p className="mt-1 text-[9px] leading-relaxed text-slate-600">{v.payment.map((p) => <span key={p} className="block">{p}</span>)}</p>
            </div>
          )}
          {v.conditions && (
            <div className="mt-3">
              <p className={label}>Condiciones</p>
              <p className="mt-1 whitespace-pre-line text-[8.5px] leading-relaxed text-slate-600">{v.conditions}</p>
            </div>
          )}
          {v.notes && (
            <div className="mt-3">
              <p className={label}>{v.notesTitle}</p>
              <p className="mt-1 whitespace-pre-line text-[9px] leading-relaxed text-slate-600">{v.notes}</p>
            </div>
          )}
          {v.signatures?.length ? (
            <div className="mt-4 grid grid-cols-2 gap-6">
              {v.signatures.map((sg) => (
                <div key={sg.label}>
                  <p className={label}>{sg.label}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sg.image} alt={`Firma de ${sg.name}`} className="mt-1 h-10 object-contain object-left" />
                  <div className="border-t border-slate-300 pt-1 text-[8.5px] font-semibold text-slate-900">{sg.name}</div>
                  <div className="text-[7.5px] text-slate-500">{[sg.role, sg.date].filter(Boolean).join(" · ")}</div>
                </div>
              ))}
            </div>
          ) : v.signature && (
            <div className="mt-4">
              <p className={label}>Aceptado por el cliente</p>
              <div className="mt-6 grid grid-cols-[1.6fr_1fr] gap-8 text-[7.5px] text-slate-500">
                <div className="border-t border-slate-300 pt-1">Nombre, firma y sello</div>
                <div className="border-t border-slate-300 pt-1">Fecha</div>
              </div>
            </div>
          )}

          <div className="mt-auto flex justify-between gap-4 border-t border-slate-200 bg-white py-3 text-[7.5px] text-slate-400">
            <span className="truncate">{v.issuer.footer || [v.issuer.name, v.issuer.taxId && `NIF ${v.issuer.taxId}`, partyLines(v.issuer).join(", ")].filter(Boolean).join(" · ")}</span>
            <span className="flex-shrink-0">{v.number || "Borrador"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
