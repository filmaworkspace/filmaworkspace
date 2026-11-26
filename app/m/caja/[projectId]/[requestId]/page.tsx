"use client";

// Firma en el móvil del cajero: quién, cuánto, si recibe o entrega, y la firma.

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { toast, errorText } from "@/lib/toast";
import { fromDoc, MOMENT_LABEL, signRequest, type BoxSignatureRequest } from "@/lib/box/signatures";
import { SignaturePad, type SignaturePadHandle } from "@/components/box/SignaturePad";
import { haptic } from "@/components/mobile/gestures";
import { money } from "@/components/mobile/ui";

export default function MobileSign() {
  const { projectId, requestId } = useParams() as { projectId: string; requestId: string };
  const router = useRouter();
  const { user } = useUser();
  const [r, setR] = useState<BoxSignatureRequest | null | undefined>(undefined);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  useEffect(() => {
    getDoc(doc(db, `projects/${projectId}/boxSignatures`, requestId))
      .then((s) => setR(s.exists() ? fromDoc(projectId, s.id, s.data()) : null))
      .catch(() => setR(null));
  }, [projectId, requestId]);

  if (r === undefined) return <p className="py-16 text-center text-[13px] text-slate-400">Cargando…</p>;
  if (r === null) return <p className="py-16 text-center text-[13px] text-slate-500">Esta solicitud ya no existe.</p>;

  const receives = r.direction === "receives";
  const save = async () => {
    const img = pad.current?.toDataURL();
    if (!img || !user?.uid) return;
    setBusy(true);
    try {
      await signRequest(projectId, r.id, img, { uid: user.uid, name: user.name || user.email || "" });
      haptic([10, 40, 10]);
      setDone(true);
    } catch (e) { toast.error(errorText(e, "No se ha podido guardar la firma")); } finally { setBusy(false); }
  };

  if (done || r.status === "signed") {
    return (
      <div className="py-12 text-center">
        <p className="text-[15px] font-semibold text-slate-900">Firmado</p>
        <p className="mt-1 text-[13px] text-slate-500">{r.personName} · {money(r.amount)}</p>
        <button onClick={() => router.push("/m/caja")} className="mt-6 h-11 rounded-xl bg-slate-900 px-6 text-[14px] font-medium text-white">Volver a Caja</button>
      </div>
    );
  }
  if (r.status === "cancelled") return <p className="py-16 text-center text-[13px] text-slate-500">Esta solicitud se ha cancelado desde el ordenador.</p>;

  return (
    <div>
      <button onClick={() => router.push("/m/caja")} className="-ml-1 mb-3 flex items-center gap-1 text-[13px] text-slate-500"><ChevronLeft size={16} /> Caja</button>

      {/* Resumen: lo que tiene que leer quien firma */}
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 text-center">
        <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{MOMENT_LABEL[r.moment]}</p>
        <p className="mt-2 text-[17px] font-semibold text-slate-900">{r.personName}</p>
        {r.personDepartment && <p className="text-xs text-slate-500">{r.personDepartment}</p>}
        <p className="mt-4 text-[13px] text-slate-600">{receives ? "Recibe" : "Entrega"}</p>
        <p className="text-[34px] font-semibold leading-tight tracking-tight tabular-nums text-slate-900">{money(r.amount)}</p>
        <p className="mt-1 text-xs text-slate-500">{r.detail}{r.reference ? ` · ${r.reference}` : ""}</p>
      </div>

      <p className="mb-2 mt-5 text-[13px] text-slate-600">
        {(() => {
          const first = r.personName.split(" ")[0];
          const tickets = r.moment === "cash_settlement" || r.moment === "transfer_tickets";
          return receives ? `Firmando, ${first} confirma que recibe ${money(r.amount)}.` : tickets ? `Firmando, ${first} confirma que entrega los tickets por ${money(r.amount)}.` : `Firmando, ${first} confirma que entrega ${money(r.amount)}.`;
        })()}
      </p>
      <SignaturePad ref={pad} height={230} onChange={setEmpty} />
      <div className="mt-3 flex gap-2">
        <button onClick={() => pad.current?.clear()} disabled={empty} className="flex h-12 items-center gap-1.5 rounded-xl border border-slate-200 px-4 text-[14px] text-slate-700 disabled:opacity-40"><RotateCcw size={15} /> Borrar</button>
        <button onClick={save} disabled={empty || busy} className="h-12 flex-1 rounded-xl bg-slate-900 text-[15px] font-medium text-white disabled:opacity-40">{busy ? "Guardando…" : "Confirmar firma"}</button>
      </div>
    </div>
  );
}
