"use client";

// Botón «Firmar en app»: crea la solicitud de firma para el móvil del cajero,
// muestra si está pendiente o firmada y deja ver la firma.

import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button, Modal } from "@/components/ds";
import { toast } from "@/lib/toast";
import { cancelSignature, directionLabel, MOMENT_LABEL, requestSignature, type SignDirection, type SignKind, type SignMoment } from "@/lib/box/signatures";

const money = (n: number) => `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions).format(n || 0)} €`;
const when = (v: any) => { const d = v?.toDate ? v.toDate() : v instanceof Date ? v : null; return d ? d.toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; };

export interface SignTarget {
  kind: SignKind; moment: SignMoment; direction: SignDirection;
  personName: string; personDepartment?: string; amount: number; detail: string; reference: string; sourceId: string;
}

/** Estado de la firma guardado en el origen (movimiento o sobre). */
export interface SignState { request?: { id: string; status: string } | null; signature?: { image: string; signedAt?: any; cashierName?: string } | null }

export function SignInApp({ projectId, target, state, user, size = "sm", onChange }: {
  projectId: string; target: SignTarget; state: SignState; user: { uid: string; name: string }; size?: "sm" | "md"; onChange?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(false);
  if (state.signature?.image) {
    return (
      <>
        <button onClick={() => setView(true)} title={state.signature.signedAt ? `Firmado el ${when(state.signature.signedAt)}` : undefined} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-700 hover:text-slate-900">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-900" />Firmado
        </button>
        <Modal open={view} onClose={() => setView(false)} title={`${MOMENT_LABEL[target.moment]} · ${target.reference}`}>
          <p className="text-[13px] text-slate-700">{target.personName} · {directionLabel(target.direction).toLowerCase()} {money(target.amount)}</p>
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2"><img src={state.signature.image} alt={`Firma de ${target.personName}`} className="mx-auto max-h-40" /></div>
          <p className="mt-2 text-xs text-slate-500">Firmado el {when(state.signature.signedAt)}{state.signature.cashierName ? ` en el móvil de ${state.signature.cashierName}` : ""}.</p>
        </Modal>
      </>
    );
  }
  if (state.request?.status === "pending") {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-amber-800" title="Esperando la firma en la app del cajero">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Por firmar
        <button disabled={busy} onClick={async () => {
          setBusy(true);
          try { await cancelSignature(projectId, { id: state.request!.id, kind: target.kind, moment: target.moment, sourceId: target.sourceId }); onChange?.(); }
          catch (e) { toast.error(e); } finally { setBusy(false); }
        }} className="text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">Cancelar</button>
      </span>
    );
  }
  return (
    <Button size={size} variant="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await requestSignature(projectId, target, user);
        toast.success("Enviado a la app del cajero para firmar");
        onChange?.();
      } catch (e) { toast.error(e); } finally { setBusy(false); }
    }}><PenLine size={13} /> Firmar en app</Button>
  );
}
