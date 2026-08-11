"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import BudgetingShell from "@/components/BudgetingShell";

// ─────────────────────────────────────────────────────────────────────────────
// Budgeting no usa el Header/Footer estándar (ver app/layout-client.tsx,
// prefijo "/budgeting" en isAuthPage) — es una app aparte, con su propio
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
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        {(isLoading || !user) && <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />}
      </div>
    );
  }

  return <BudgetingShell>{children}</BudgetingShell>;
}
