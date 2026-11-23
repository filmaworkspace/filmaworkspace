"use client";
// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
// ─── Internal ────────────────────────────────────────────────────────────────
import { UserProvider } from "@/contexts/UserContext";
import MaintenanceGate from "@/components/MaintenanceGate";
import ErrorReporter from "@/components/ErrorReporter";
import AppBanners from "@/components/AppBanners";
import Toaster from "@/components/Toaster";

const MOBILE_BREAKPOINT = 768;

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isAuthPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname?.startsWith("/form") ||
    pathname?.startsWith("/timesheet") ||
    pathname?.startsWith("/timesheet-review") ||
    pathname?.startsWith("/access") ||
    pathname?.startsWith("/caja/") ||
    pathname?.startsWith("/sign/") ||
    pathname?.startsWith("/guias") ||
    pathname?.startsWith("/budgeting");

  // Versión móvil: rutas /m (y la antigua /mobile, que redirige a ella).
  const isMobilePage = pathname === "/mobile" || pathname === "/m" || !!pathname?.startsWith("/m/");
  const isAdminDashboard = pathname?.startsWith("/admindashboard");

  // En el móvil se usa la versión móvil (/m). Los enlaces a aprobaciones
  // (por ejemplo desde un email) van directos a la bandeja móvil; el resto de
  // pantallas, al inicio móvil.
  useEffect(() => {
    if (isAuthPage) return;
    if (pathname === "/mobile") { router.replace("/m"); return; }
    if (isMobilePage) return;
    if (window.innerWidth >= MOBILE_BREAKPOINT) return;
    const appr = pathname?.match(/^\/project\/([^/]+)\/accounting\/approvals/);
    router.replace(appr ? "/m/aprobaciones" : "/m");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <UserProvider>
      <ErrorReporter />
      <AppBanners isAuthPage={isAuthPage} isMobilePage={isMobilePage} isAdminDashboard={isAdminDashboard} />
      <MaintenanceGate isAuthPage={isAuthPage} isMobilePage={isMobilePage} isAdminDashboard={isAdminDashboard}>
        {children}
      </MaintenanceGate>
      <Toaster />
    </UserProvider>
  );
}
