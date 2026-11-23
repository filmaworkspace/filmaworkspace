"use client";

// Detalle de una solicitud de Filma Sign: estado, partes, auditoría y
// acciones (PDF, recordar con enlace nuevo, reenviar la copia, cancelar).
// Lo usan el panel de admin y Equipo › Filma Sign de cada proyecto.

import { useState } from "react";
import Link from "next/link";
import { Bell, Download, Mail, X } from "lucide-react";
import { Button } from "@/components/ds";
import { ConfirmModal } from "@/components/admin/ConfirmModal";
import { BlockTitle } from "@/components/admin/ui";
import { SignDocument } from "./SignDocument";
import { buildSignedPdf, signedFileName } from "@/lib/sign/render";
import { EVENT_LABEL, fmtDateTime, SIGN_STATUS, type SignRequest, type SignStatus } from "@/lib/sign/types";

export const signStatusOf = (r: Pick<SignRequest, "status" | "expiresAt">): SignStatus => (r.status === "pending" && r.expiresAt < Date.now() ? "expired" : r.status);

export function SignRequestPanel({ r, busy, onClose, onAction, admin = false }: {
  r: SignRequest;
  busy: boolean;
  onClose: () => void;
  onAction: (a: "remind" | "resend_copy" | "cancel") => Promise<void>;
  admin?: boolean;
}) {
  const [cancel, setCancel] = useState(false);
  const statusOf = signStatusOf;
  return (
    <>
    <aside className="min-w-0">
      <div className="sticky top-[64px] space-y-5 rounded-lg border border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-slate-900">{r.title}</p>
            <p className="text-xs text-slate-500">{SIGN_STATUS[statusOf(r)].label}{r.completedAt ? ` · ${fmtDateTime(r.completedAt)}` : ""}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={async () => { const pdf = await buildSignedPdf(r); pdf.save(signedFileName(r)); }}><Download size={13} /> PDF {r.status === "completed" ? "firmado" : "con auditoría"}</Button>
          {statusOf(r) === "pending" || statusOf(r) === "expired" ? <Button size="sm" disabled={busy || r.status !== "pending"} onClick={() => onAction("remind")}><Bell size={13} /> Recordar</Button> : null}
          {r.status === "completed" && <Button size="sm" disabled={busy} onClick={() => onAction("resend_copy")}><Mail size={13} /> Reenviar copia</Button>}
          {r.status === "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancel(true)}>Cancelar</Button>}
          {admin && r.refPath?.startsWith("billingQuotes/") && <Link href={`/admindashboard/accounts/billing/quotes/${r.refPath.split("/")[1]}`} className="flex items-center px-2 text-xs text-slate-500 hover:text-slate-900">Ver presupuesto →</Link>}
        </div>

        <div>
          <BlockTitle>Partes</BlockTitle>
          <div className="space-y-2">
            {r.parties.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-md border border-slate-100 px-3 py-2">
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="truncate font-medium text-slate-900">{p.name} <span className="font-normal text-slate-400">· {p.side === "issuer" ? "Emisor" : "Firmante"}</span></p>
                  <p className="truncate text-xs text-slate-500">{[p.email, p.role, p.taxId && `NIF ${p.taxId}`].filter(Boolean).join(" · ")}</p>
                  <p className={`text-xs ${p.status === "signed" ? "text-emerald-700" : p.status === "declined" ? "text-red-600" : "text-amber-700"}`}>
                    {p.status === "signed" ? `Firmado ${fmtDateTime(p.signature?.signedAt)} · IP ${p.signature?.ip || "—"}` : p.status === "declined" ? `Rechazado${p.declineReason ? `: ${p.declineReason}` : ""}` : "Pendiente"}
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.signature && <img src={p.signature.image} alt="" className="h-9 w-24 object-contain" />}
              </div>
            ))}
          </div>
        </div>

        <div>
          <BlockTitle>Auditoría</BlockTitle>
          <ol className="space-y-1.5">
            {[...r.events].sort((a, b) => a.at - b.at).map((e, i) => (
              <li key={i} className="grid grid-cols-[112px_1fr] gap-2 text-[12px]">
                <span className="tabular-nums text-slate-400">{fmtDateTime(e.at)}</span>
                <span className="min-w-0 text-slate-700">
                  {EVENT_LABEL[e.type]}{r.parties.find((p) => p.id === e.party) ? ` · ${r.parties.find((p) => p.id === e.party)!.name}` : e.by ? ` · ${e.by}` : ""}
                  {e.detail && <span className="block truncate text-slate-400">{e.detail}</span>}
                  {e.ip && <span className="block truncate font-mono text-[10.5px] text-slate-400">{e.ip}</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 break-all font-mono text-[10.5px] text-slate-400">SHA-256 {r.docHash}</p>
        </div>

        <details>
          <summary className="cursor-pointer text-xs text-slate-500">Ver documento</summary>
          <div className="mt-3"><SignDocument r={r} /></div>
        </details>
      </div>
    </aside>
      <ConfirmModal open={cancel} onClose={() => setCancel(false)} title="Cancelar la solicitud" password={false} confirmLabel="Cancelar solicitud"
        notice="El enlace deja de funcionar. Queda en la auditoría." onConfirm={async () => { await onAction("cancel"); }} />
    </>
  );
}
