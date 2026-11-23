"use client";

// App instalable: registro del service worker y aviso para añadir Filma a la
// pantalla de inicio (Android/Chrome con un botón; iPhone con los pasos).

import { useEffect, useState } from "react";
import Image from "next/image";
import { Share, X } from "lucide-react";

const DISMISS = "filma-m:install-dismissed";

export function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
}

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** Captura el aviso de instalación de Chrome para lanzarlo desde un botón. */
export function useInstall() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(isStandalone());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    const on = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const done = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", on); window.removeEventListener("appinstalled", done); };
  }, []);
  const install = async () => { if (!evt) return false; await evt.prompt(); const r = await evt.userChoice; setEvt(null); return r.outcome === "accepted"; };
  return { canInstall: !!evt, ios, installed, install };
}

/** Tarjeta "Instala Filma" en el inicio (hasta que se instale o se descarte). */
export function InstallCard() {
  const { canInstall, ios, installed, install } = useInstall();
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(DISMISS) === "1"); } catch { setHidden(false); } }, []);
  if (installed || hidden || (!canInstall && !ios)) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS, "1"); } catch { /* sin almacenamiento */ } };
  return (
    <div className="relative flex items-center gap-3 rounded-2xl border border-slate-200 p-3 pr-9">
      <Image src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Instala Filma</p>
        {ios
          ? <p className="text-xs text-slate-500">Pulsa <Share size={12} className="inline -mt-0.5" /> y «Añadir a pantalla de inicio».</p>
          : <p className="text-xs text-slate-500">Ábrela como una app, a pantalla completa.</p>}
      </div>
      {!ios && <button onClick={async () => { if (await install()) dismiss(); }} className="h-9 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white">Instalar</button>}
      <button onClick={dismiss} aria-label="Cerrar" className="absolute right-2 top-2 p-1 text-slate-400"><X size={14} /></button>
    </div>
  );
}
