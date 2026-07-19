"use client";
// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
// ─── Internal ────────────────────────────────────────────────────────────────
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { UserProvider } from "@/contexts/UserContext";

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
    pathname?.startsWith("/access");

  const isMobilePage = pathname === "/mobile";

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
      <div className="flex flex-col min-h-screen">
        {!isAuthPage && !isMobilePage && <Header />}
        <main className="flex flex-col flex-grow">{children}</main>
        {!isAuthPage && !isMobilePage && <Footer />}
      </div>
    </UserProvider>
  );
}
