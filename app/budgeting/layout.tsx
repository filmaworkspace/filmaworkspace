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
    // Pantalla de carga mientras se comprueba el acceso a Budgeting del
    // usuario (o mientras UserContext resuelve la sesión).
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${inter.className}`}
        style={{ background: "linear-gradient(180deg, #E86F4A1a, #ffffff 60%)" }}
      >
        {(isLoading || !user) && (
          <Image
            src="/logo-budgeting.svg"
            alt="Budgeting"
            width={82}
            height={24}
            className="h-6 w-auto"
            priority
          />
        )}
      </div>
    );
  }

  return <BudgetingShell>{children}</BudgetingShell>;
}
