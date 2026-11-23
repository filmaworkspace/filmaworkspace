"use client";

// Documento que se firma, según su plantilla: el presupuesto con su vista A4
// o un documento de texto.

import { DocPreview } from "@/components/admin/billing/DocPreview";
import { signQuoteView } from "@/lib/sign/render";
import { fmtDateTime, type SignRequest } from "@/lib/sign/types";

export function SignDocument({ r }: { r: Pick<SignRequest, "payload" | "parties"> }) {
  const v = signQuoteView(r);
  if (v) return <DocPreview v={v} />;
  if (r.payload.kind !== "document") return null;
  const p = r.payload;
  return (
    <div className="mx-auto w-full max-w-[560px] rounded-sm bg-white px-7 py-8 shadow-[0_1px_3px_rgba(15,23,42,0.08),0_16px_48px_rgba(15,23,42,0.12)] ring-1 ring-slate-200">
      <h2 className="text-[17px] font-semibold tracking-tight text-slate-900">{p.title}</h2>
      <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-slate-700">
        {p.body.split(/\n{2,}/).map((para, i) => <p key={i} className="whitespace-pre-line">{para}</p>)}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-6">
        {r.parties.map((x) => (
          <div key={x.id}>
            <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">{x.side === "issuer" ? `Por ${p.issuerName}` : "Firmante"}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {x.signature ? <img src={x.signature.image} alt={`Firma de ${x.name}`} className="mt-1 h-12 object-contain object-left" /> : <div className="h-12" />}
            <div className="border-t border-slate-300 pt-1 text-[11px] font-semibold text-slate-900">{x.name}</div>
            <div className="text-[10px] text-slate-500">{[x.role, x.signature && fmtDateTime(x.signature.signedAt)].filter(Boolean).join(" · ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
