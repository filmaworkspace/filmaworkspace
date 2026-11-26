"use client";

// Versión móvil: una reducción de la app de escritorio para lo que se hace
// fuera del ordenador. Cabecera compacta, barra inferior (Inicio, Aprobar,
// Buscar, Actividad, Perfil) e instalable como app (PWA).

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Bell, CheckCircle2, CloudOff, Home, Search, User, Wallet } from "lucide-react";
import { useCashierBadge } from "@/components/mobile/useCashier";
import { inter } from "@/lib/fonts";
import { useUser } from "@/contexts/UserContext";
import { MobileDataProvider, useMobileData } from "@/components/mobile/MobileData";
import { useServiceWorker } from "@/components/mobile/pwa";
import { activitySeen, buildActivity, countNew } from "@/lib/mobileActivity";

function BottomNav() {
  const pathname = usePathname() || "";
  const { user } = useUser();
  const { data, invitations } = useMobileData();
  const pending = data?.approvals.length || 0;
  // Novedades de Actividad desde la última visita (se recalcula al cambiar de pantalla).
  const fresh = useMemo(() => (user?.uid && !pathname.startsWith("/m/actividad") ? countNew(buildActivity(data, invitations), activitySeen(user.uid)) : 0),
    [data, invitations, user?.uid, pathname]);
  const cashier = useCashierBadge(pathname);
  // En la pantalla de firma, sin barra: toda la pantalla para firmar.
  const signing = /^\/m\/caja\/[^/]+\/[^/]+/.test(pathname);
  const items = [
    { href: "/m", label: "Inicio", icon: Home, active: pathname === "/m" || pathname.startsWith("/m/p/") },
    { href: "/m/aprobaciones", label: "Aprobar", icon: CheckCircle2, active: pathname.startsWith("/m/aprobaciones"), badge: pending },
    ...(cashier.enabled ? [{ href: "/m/caja", label: "Caja", icon: Wallet, active: pathname.startsWith("/m/caja"), badge: cashier.pending }] : []),
    { href: "/m/buscar", label: "Buscar", icon: Search, active: pathname.startsWith("/m/buscar") },
    { href: "/m/actividad", label: "Actividad", icon: Bell, active: pathname.startsWith("/m/actividad"), badge: fresh },
    { href: "/m/perfil", label: "Perfil", icon: User, active: pathname.startsWith("/m/perfil") },
  ];
  if (signing) return null;
  return (
    <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="mx-auto flex max-w-lg">
        {items.map(({ href, label, icon: Icon, active, badge }) => (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "font-medium text-slate-900" : "text-slate-500"}`}>
            <span className="relative">
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {!!badge && (
                <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-[#2F52E0] px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </span>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { online } = useMobileData();
  useServiceWorker();
  return (
    <div className={`min-h-screen bg-white text-slate-900 ${inter.className}`}>
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-12 max-w-lg items-center justify-between px-4">
          <Link href="/m" aria-label="Inicio"><Image src="/logodark.svg" alt="Filma" width={72} height={16} className="h-auto w-[72px]" priority /></Link>
          {!online && <span className="ml-auto mr-2 flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"><CloudOff size={12} /> Sin conexión</span>}
          <Link href="/m/perfil" aria-label="Perfil" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F1F3] text-xs font-semibold text-slate-700">
            {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 pb-28 pt-4">{children}</main>
      <BottomNav />
    </div>
  );
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileDataProvider>
      <Shell>{children}</Shell>
    </MobileDataProvider>
  );
}
