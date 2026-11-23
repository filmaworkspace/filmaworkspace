"use client";

// ─── Filma Sign · página pública ─────────────────────────────────────────────
// Con el enlace personal: revisar el documento, firmar (dibujando o con el
// nombre) o rechazarlo. Al firmar, el PDF firmado por las dos partes llega por
// email y se puede descargar aquí. Cada paso queda en la auditoría.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, CheckCircle2, Download, FileText, Loader2, XCircle } from "lucide-react";
import { SignShell } from "@/components/sign/SignShell";
import { SignDocument } from "@/components/sign/SignDocument";
import { SignaturePad, type SignatureValue } from "@/components/sign/SignaturePad";
import { buildSignedPdf, signedFileName } from "@/lib/sign/render";
import { docTypeLabel, EVENT_LABEL, fmtDateTime, SIGN_TEMPLATES, type PublicSignRequest } from "@/lib/sign/types";

type View = "review" | "sign" | "decline";

export default function SignPage() {
  const { token } = useParams() as { token: string };
  const [r, setR] = useState<PublicSignRequest | null | undefined>(undefined);
  const [view, setView] = useState<View>("review");
  const [sig, setSig] = useState<SignatureValue | null>(null);
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/sign/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? (await res.json()) as PublicSignRequest : null))
      .then((d) => {
        setR(d);
        const me = d?.parties.find((p) => p.id === d.you);
        if (me) { setName(me.name); setTaxId(me.taxId || ""); }
      })
      .catch(() => setR(null));
  }, [token]);

  const onSig = useCallback((v: SignatureValue | null) => setSig(v), []);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "No se ha podido completar");
      setR(d as PublicSignRequest);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const download = async () => {
    if (!r) return;
    setPdfBusy(true);
    try { const pdf = await buildSignedPdf(r); pdf.save(signedFileName(r)); } finally { setPdfBusy(false); }
  };

  if (r === undefined) return <div className="flex min-h-screen items-center justify-center bg-[#F5F6F8]"><Loader2 className="animate-spin text-slate-400" /></div>;
  if (r === null) return (
    <SignShell title="Enlace no válido">
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <AlertCircle size={36} className="text-slate-300" />
        <p className="text-[14px] text-slate-600">Este enlace no existe o ya no es válido. Si te han enviado un recordatorio, usa el enlace más reciente.</p>
      </div>
    </SignShell>
  );

  const me = r.parties.find((p) => p.id === r.you)!;
  const issuer = r.parties.find((p) => p.side === "issuer");
  const done = me.status === "signed";
  const tpl = SIGN_TEMPLATES[r.kind];
  const subtitle = <>De {issuer?.name}{issuer?.role ? ` · ${issuer.role}` : ""} para {me.name}</>;

  // Firmado (por mí y, normalmente, por todos)
  if (done || r.status === "completed") return (
    <SignShell title={r.title} subtitle={subtitle} steps={["Revisar", "Firmar", "Listo"]} step={3}>
      <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3">
        <CheckCircle2 size={20} className="mt-0.5 flex-shrink-0 text-emerald-600" />
        <div className="text-[14px]">
          <p className="font-medium text-emerald-900">{r.status === "completed" ? "Firmado por todas las partes" : "Has firmado. Falta la otra parte."}</p>
          <p className="text-emerald-800/80">{r.status === "completed" ? `Te hemos enviado una copia en PDF a ${me.email}.` : "Recibirás la copia firmada cuando firmen todos."}</p>
        </div>
      </div>
      <button onClick={download} disabled={pdfBusy} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[15px] font-medium text-white disabled:opacity-60">
        {pdfBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Descargar PDF firmado
      </button>
      <div className="mt-6"><SignDocument r={r} /></div>
      <Audit r={r} />
    </SignShell>
  );

  if (r.status !== "pending") {
    const msg = r.status === "declined" ? (me.status === "declined" ? "Has rechazado este documento." : "El documento se ha rechazado.") : r.status === "expired" ? "El enlace ha caducado. Pide a quien te lo envió un recordatorio." : "La solicitud se ha cancelado.";
    return (
      <SignShell title={r.title} subtitle={subtitle}>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <XCircle size={36} className="text-slate-300" />
          <p className="text-[14px] text-slate-600">{msg}</p>
        </div>
      </SignShell>
    );
  }

  return (
    <SignShell eyebrow={docTypeLabel(r.docType) || "Filma Sign"} title={r.title} subtitle={subtitle} steps={["Revisar", "Firmar", "Listo"]} step={view === "review" ? 0 : 1}>
      {view === "review" && (
        <>
          {r.message && <p className="mb-4 whitespace-pre-line rounded-xl bg-[#F7F7F8] px-4 py-3 text-[14px] text-slate-700">{r.message}</p>}
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[13px] text-slate-500">Revisa {tpl.noun}. {issuer?.name} ya lo ha firmado.</p>
            <button onClick={download} disabled={pdfBusy} className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[13px] text-slate-700 hover:bg-[#F7F7F8] disabled:opacity-60">
              {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} PDF
            </button>
          </div>
          <SignDocument r={r} />
          <div className="sticky bottom-0 -mx-5 mt-6 flex gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>
            <button onClick={() => setView("decline")} className="h-11 rounded-xl px-4 text-[14px] text-slate-500 hover:text-slate-900">Rechazar</button>
            <button onClick={() => { setView("sign"); window.scrollTo({ top: 0 }); }} className="h-11 flex-1 rounded-xl bg-slate-900 text-[15px] font-medium text-white">Continuar para firmar</button>
          </div>
        </>
      )}

      {view === "sign" && (
        <div className="space-y-5">
          <button onClick={() => setView("review")} className="-ml-1 inline-flex items-center gap-1 text-[13px] text-slate-500"><ArrowLeft size={14} /> Volver al documento</button>
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Nombre y apellidos</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-[15px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">NIF (opcional)</span>
              <input value={taxId} onChange={(e) => setTaxId(e.target.value.toUpperCase())} className="h-11 w-full rounded-xl border border-slate-300 px-3 font-mono text-[15px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
            </label>
          </div>
          <SignaturePad onChange={onSig} defaultName={name} />
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-slate-900" />
            <span className="text-[13px] text-slate-700">He leído {tpl.noun}, lo acepto y lo firmo electrónicamente. Entiendo que mi firma tiene la misma validez que una firma manuscrita.</span>
          </label>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button disabled={busy || !sig || !consent || !name.trim()} onClick={() => act({ action: "sign", signature: sig, name, taxId, consent })}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[15px] font-medium text-white disabled:opacity-40">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} Firmar
          </button>
          <p className="text-center text-[11px] text-slate-400">Se registran la fecha y hora, tu IP y el dispositivo.</p>
        </div>
      )}

      {view === "decline" && (
        <div className="space-y-4">
          <button onClick={() => setView("review")} className="-ml-1 inline-flex items-center gap-1 text-[13px] text-slate-500"><ArrowLeft size={14} /> Volver al documento</button>
          <p className="text-[15px] font-medium">¿Por qué no lo firmas?</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Cuéntaselo a quien te lo envió" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-[15px] focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10" />
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button disabled={busy || !reason.trim()} onClick={() => act({ action: "decline", reason })} className="h-11 w-full rounded-xl border border-red-200 text-[15px] font-medium text-red-600 disabled:opacity-40">Rechazar el documento</button>
        </div>
      )}
    </SignShell>
  );
}

function Audit({ r }: { r: PublicSignRequest }) {
  return (
    <details className="mt-6 rounded-xl border border-slate-200 px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-medium text-slate-700">Registro de auditoría</summary>
      <p className="mt-2 break-all font-mono text-[10.5px] text-slate-400">SHA-256 {r.docHash}</p>
      <ol className="mt-2 space-y-1.5">
        {r.events.map((e, i) => (
          <li key={i} className="flex gap-3 text-[12px]">
            <span className="w-28 flex-shrink-0 tabular-nums text-slate-400">{fmtDateTime(e.at)}</span>
            <span className="text-slate-700">{EVENT_LABEL[e.type]}{r.parties.find((p) => p.id === e.party) ? ` · ${r.parties.find((p) => p.id === e.party)!.name}` : ""}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
