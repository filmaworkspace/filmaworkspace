"use client";
// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
// ─── Internal ────────────────────────────────────────────────────────────────
import { UserProvider } from "@/contexts/UserContext";
import MaintenanceGate from "@/components/MaintenanceGate";

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
    pathname?.startsWith("/guias");

  const isMobilePage = pathname === "/mobile";
  const isAdminDashboard = pathname?.startsWith("/admindashboard");

  // Redirigir a /mobile si el usuario accede desde un dispositivo móvil
  // y no está en una página de autenticación ni ya en /mobile.
  useEffect(() => {
    if (isAuthPage || isMobilePage) return;
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    if (isMobile) {
      router.replace("/mobile");
    }
  }, [pathname]);

  return (
    <UserProvider>
      <MaintenanceGate isAuthPage={isAuthPage} isMobilePage={isMobilePage} isAdminDashboard={isAdminDashboard}>
        {children}
      </MaintenanceGate>
    </UserProvider>
  );
}
