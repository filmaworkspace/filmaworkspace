"use client";

// Verificación de una acreditación: lo que ve quien escanea el QR en el set.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { BadgeCheck, ShieldX } from "lucide-react";
import { inter } from "@/lib/fonts";
import { Spinner } from "@/components/ds";

interface R { valid: boolean; reason?: string; name?: string; role?: string; department?: string; crewNumber?: string; photoUrl?: string | null; projectName?: string; start?: string; end?: string }
const dmy = (s?: string) => (s ? s.split("-").reverse().join("/") : "");

export default function VerifyAccreditation() {
  const { token } = useParams() as { token: string };
  const [r, setR] = useState<R | null>(null);
  const [at] = useState(() => new Date());
  useEffect(() => {
    fetch("/api/accreditation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then((x) => x.json()).then(setR).catch(() => setR({ valid: false, reason: "No se ha podido comprobar" }));
  }, [token]);

  return (
    <div className={`min-h-screen bg-white text-slate-900 ${inter.className}`}>
      <div className="mx-auto max-w-sm px-5 py-8">
        <Image src="/logodark.svg" alt="Filma" width={64} height={14} className="mx-auto h-auto w-16 opacity-70" />
        {!r ? <div className="flex justify-center py-24"><Spinner /></div> : (
          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200">
            <div className={`flex items-center justify-center gap-2 px-4 py-4 text-[15px] font-semibold ${r.valid ? "bg-slate-900 text-white" : "bg-red-600 text-white"}`}>
              {r.valid ? <BadgeCheck size={20} /> : <ShieldX size={20} />}
              {r.valid ? "Acreditación válida" : "No válida"}
            </div>
            {r.name ? (
              <div className="px-5 py-6 text-center">
                {r.photoUrl
                  ? <img src={r.photoUrl} alt={`Foto de ${r.name}`} className={`mx-auto h-36 w-28 rounded-lg object-cover ${r.valid ? "" : "grayscale"}`} />
                  : <div className="mx-auto flex h-36 w-28 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Sin foto</div>}
                <p className="mt-4 text-xl font-semibold tracking-tight">{r.name}</p>
                <p className="mt-0.5 text-[14px] text-slate-700">{r.role}</p>
                {r.department && <p className="text-[13px] text-slate-500">{r.department}</p>}
                <p className="mt-4 text-[13px] font-medium text-slate-900">{r.projectName}</p>
                {(r.start || r.end) && <p className="text-xs text-slate-500">{r.start && r.end ? `Del ${dmy(r.start)} al ${dmy(r.end)}` : r.start ? `Desde el ${dmy(r.start)}` : `Hasta el ${dmy(r.end)}`}</p>}
                {!r.valid && r.reason && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700">{r.reason}</p>}
              </div>
            ) : <p className="px-5 py-8 text-center text-[13px] text-slate-600">{r.reason}</p>}
            <p className="border-t border-slate-100 px-5 py-3 text-center text-[11px] text-slate-400">
              Comprobado el {at.toLocaleDateString("es-ES")} a las {at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}{r.crewNumber ? ` · CRW-${String(r.crewNumber).padStart(4, "0")}` : ""}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
