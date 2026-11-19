"use client";

// Piezas comunes de los editores de factura y presupuesto.
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ds";
import { BillingParty, partyLines } from "@/lib/billing";

/** Datos fiscales del cliente tal y como saldrán en el documento. */
export function ClientCard({ client, producerId, onRefresh, editable }: { client: BillingParty; producerId: string; onRefresh: () => void; editable: boolean }) {
  const missing = !client.name || !client.taxId || !client.address;
  return (
    <div className={`rounded-lg border px-4 py-3 ${missing && editable ? "border-amber-200 bg-[#FFFBEB]" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <p className="font-medium text-slate-900">{client.name || "Sin razón social"}</p>
          <p className="text-xs text-slate-500">{[client.taxId && `NIF ${client.taxId}`, ...partyLines(client)].filter(Boolean).join(" · ") || "Sin NIF ni dirección"}</p>
          {client.email && <p className="text-xs text-slate-500">{client.email}</p>}
        </div>
        {editable && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <Link href={`/admindashboard/accounts/${producerId}?edit=1`} className="rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-[#F4F4F5] hover:text-slate-900">Editar en la cuenta</Link>
            <Button size="sm" variant="ghost" onClick={onRefresh} title="Volver a copiar los datos de la cuenta"><RefreshCw size={12} /> Actualizar</Button>
          </div>
        )}
      </div>
      {missing && editable && <p className="mt-1.5 text-xs text-amber-900">Faltan datos fiscales del cliente: complétalos en la cuenta y pulsa Actualizar.</p>}
    </div>
  );
}

/** Indicador de guardado automático de borradores. */
export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return <span className={`text-xs ${state === "error" ? "text-red-600" : "text-slate-400"}`}>{state === "saving" ? "Guardando…" : state === "saved" ? "Borrador guardado" : "No se pudo guardar"}</span>;
}
