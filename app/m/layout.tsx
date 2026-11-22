"use client";

// Versión móvil: una reducción de la app de escritorio para lo que se hace
// fuera del ordenador. Cabecera compacta y barra inferior.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2, Home, User } from "lucide-react";
import { inter } from "@/lib/fonts";
import { useUser } from "@/contexts/UserContext";
import { MobileDataProvider, useMobileData } from "@/components/mobile/MobileData";

function BottomNav() {
  const pathname = usePathname() || "";
  const { data } = useMobileData();
  const pending = data?.approvals.length || 0;
  const items = [
    { href: "/m", label: "Inicio", icon: Home, active: pathname === "/m" },
    { href: "/m/aprobaciones", label: "Aprobaciones", icon: CheckCircle2, active: pathname.startsWith("/m/aprobaciones"), badge: pending },
    { href: "/m/perfil", label: "Perfil", icon: User, active: pathname.startsWith("/m/perfil") },
  ];
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
  return (
    <div className={`min-h-screen bg-white text-slate-900 ${inter.className}`}>
      <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto flex h-12 max-w-lg items-center justify-between px-4">
          <Link href="/m" aria-label="Inicio"><Image src="/logodark.svg" alt="Filma" width={72} height={16} className="h-auto w-[72px]" priority /></Link>
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
