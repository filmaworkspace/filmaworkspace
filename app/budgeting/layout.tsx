"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import BudgetingShell from "@/components/BudgetingShell";

// ─────────────────────────────────────────────────────────────────────────────
// Budgeting no usa el Header/Footer estándar (ver app/layout-client.tsx,
// prefijo "/budgeting" en isAuthPage): es una app aparte, con su propio
// shell (BudgetingShell). Solo entra quien tiene users/{uid}.budgetingAccess.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !user) return; // UserContext ya redirige a /login si hace falta
    if (!user.budgetingAccess) router.replace("/dashboard");
  }, [isLoading, user, router]);

  if (isLoading || !user || !user.budgetingAccess) {
    // Mismo logo que la transición del badge en Header.tsx: si se viene de ahí,
    // esta pantalla continúa la animación en vez de cortar a un spinner suelto.
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${inter.className}`}
        style={{ background: "linear-gradient(180deg, #6D5A881a, #ffffff 60%)" }}
      >
        {(isLoading || !user) && (
          <Image
            src="/logo-budgeting-text.svg"
            alt="Budgeting"
            width={368}
            height={48}
            className="w-64 h-auto animate-budgetingLogoIn"
            priority
          />
        )}
      </div>
    );
  }

  return <BudgetingShell>{children}</BudgetingShell>;
}
