"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertTriangle, Wrench } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { useUser } from "@/contexts/UserContext";

// ─────────────────────────────────────────────────────────────────────────────

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function MaintenanceGate({
  children,
  isAuthPage,
  isMobilePage,
  isAdminDashboard,
}: {
  children: React.ReactNode;
  isAuthPage: boolean;
  isMobilePage: boolean;
  isAdminDashboard: boolean;
}) {
  const { user, maintenance } = useUser();
  const pathname = usePathname();

  // Solo se activa el "tick" mientras el mantenimiento está programado —
  // cuando está apagado, cero overhead.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!maintenance.enabled) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [maintenance.enabled]);

  const isAdmin = user?.role === "admin";
  const startAtMs = maintenance.startAt ? maintenance.startAt.getTime() : null;
  const isActive = maintenance.enabled && startAtMs !== null && now >= startAtMs;
  const isExemptRoute = pathname === "/login";
  const isBlocked = isActive && !isAdmin && !isExemptRoute;

  if (isBlocked) {
    return (
      <div className={`min-h-screen flex items-center justify-center bg-slate-50 px-6 ${inter.className}`}>
        <div className="max-w-md w-full text-center">
          <div className="flex justify-center mb-8">
            <Image src="/logodark.svg" alt="Filma Workspace" width={160} height={38} priority />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Filma Workspace está en mantenimiento</h1>
          <p className="text-sm text-slate-500">
            {maintenance.message || "Estamos realizando tareas de mantenimiento. Volvemos enseguida."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {!isAuthPage && !isMobilePage && <Header />}
      <main className="flex flex-col flex-grow">{children}</main>
      {!isAuthPage && !isMobilePage && !isAdminDashboard && <Footer />}

      {/* Aviso de cuenta atrás — visible para todos, no bloquea nada todavía.
          Se ancla abajo (no arriba) porque el Header es `fixed top-0` y ya
          asume una altura fija en todas las páginas (mt-[53px]); un banner
          arriba pelearía con eso. */}
      {maintenance.enabled && !isActive && startAtMs !== null && (
        <div className="fixed bottom-0 left-0 w-full z-[70] bg-amber-500 text-white text-sm font-medium px-4 py-3 flex items-center justify-center gap-2 text-center shadow-lg">
          <AlertTriangle size={15} className="flex-shrink-0" />
          Filma Workspace entrará en mantenimiento en {formatCountdown(startAtMs - now)} · guarda tus cambios antes de que acabe la cuenta atrás.
        </div>
      )}

      {/* Recordatorio para el admin mientras el mantenimiento está activo
          (a él no le bloquea, pero conviene que no se le olvide apagarlo). */}
      {isActive && isAdmin && (
        <div className="fixed bottom-0 left-0 w-full z-[70] bg-red-600 text-white text-sm font-medium px-4 py-3 flex items-center justify-center gap-2 text-center shadow-lg">
          <Wrench size={15} className="flex-shrink-0" />
          Mantenimiento activo · el resto de usuarios no puede entrar. Desactívalo desde AdminDashboard cuando termines.
        </div>
      )}
    </div>
  );
}
