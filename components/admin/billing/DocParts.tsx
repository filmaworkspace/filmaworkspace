"use client";

// Piezas comunes de los editores de factura y presupuesto.
import Link from "next/link";
import { useState } from "react";
import { Pencil, RefreshCw } from "lucide-react";
import { Button, Field, Input } from "@/components/ds";
import { BillingParty, partyLines } from "@/lib/billing";

/**
 * Datos fiscales del cliente tal y como saldrán en el documento. Se copian de
 * la cuenta o de la persona y, en un borrador, se pueden retocar a mano.
 */
export function ClientCard({ client, source, onRefresh, onChange, editable }: {
  client: BillingParty;
  source: { kind: "account" | "user"; id: string };
  onRefresh: () => void;
  onChange?: (c: BillingParty) => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const missing = !client.name || !client.taxId || !client.address;
  const href = source.kind === "account" ? `/admindashboard/accounts/${source.id}?edit=1` : `/admindashboard/users/${source.id}`;
  const f = (k: keyof BillingParty) => ({ value: client[k] || "", onChange: (e: { target: { value: string } }) => onChange?.({ ...client, [k]: e.target.value }) });
  return (
    <div className={`rounded-lg border px-4 py-3 ${missing && editable ? "border-amber-200 bg-[#FFFBEB]" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <p className="font-medium text-slate-900">{client.name || "Sin razón social"} {source.kind === "user" && <span className="ml-1 text-[11px] font-normal text-slate-400">persona</span>}</p>
          <p className="text-xs text-slate-500">{[client.taxId && `NIF ${client.taxId}`, ...partyLines(client)].filter(Boolean).join(" · ") || "Sin NIF ni dirección"}</p>
          {client.email && <p className="text-xs text-slate-500">{client.email}</p>}
        </div>
        {editable && (
          <div className="flex flex-shrink-0 items-center gap-1">
            {onChange && <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}><Pencil size={12} /> {open ? "Cerrar" : "Editar aquí"}</Button>}
            {source.id && <Link href={href} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-[#F4F4F5] hover:text-slate-900">{source.kind === "account" ? "Ver cuenta" : "Ver usuario"}</Link>}
            {source.id && <Button size="sm" variant="ghost" onClick={onRefresh} title="Volver a copiar los datos"><RefreshCw size={12} /> Actualizar</Button>}
          </div>
        )}
      </div>
      {editable && open && onChange && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-3">
          <Field label="Razón social o nombre" className="col-span-2"><Input {...f("name")} /></Field>
          <Field label="NIF"><Input {...f("taxId")} className="font-mono" /></Field>
          <Field label="Email"><Input {...f("email")} /></Field>
          <Field label="Dirección" className="col-span-2"><Input {...f("address")} /></Field>
          <div className="col-span-2 grid grid-cols-[100px_1fr_1fr_1fr] gap-2">
            <Field label="C. P."><Input {...f("postalCode")} /></Field>
            <Field label="Ciudad"><Input {...f("city")} /></Field>
            <Field label="Provincia"><Input {...f("province")} /></Field>
            <Field label="País"><Input {...f("country")} /></Field>
          </div>
        </div>
      )}
      {missing && editable && !open && <p className="mt-1.5 text-xs text-amber-900">Faltan datos fiscales del cliente.</p>}
    </div>
  );
}

/** Indicador de guardado automático de borradores. */
export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return <span className={`text-xs ${state === "error" ? "text-red-600" : "text-slate-400"}`}>{state === "saving" ? "Guardando…" : state === "saved" ? "Borrador guardado" : "No se pudo guardar"}</span>;
}
