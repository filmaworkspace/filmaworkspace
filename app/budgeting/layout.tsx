"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import BudgetingShell from "@/components/BudgetingShell";

// ─────────────────────────────────────────────────────────────────────────────
// Budgeting no usa el Header/Footer estándar (ver app/layout-client.tsx,
// prefijo "/budgeting" en isAuthPage): es una app aparte, con su propio
// shell (BudgetingShell). Solo entra quien tiene users/{uid}.budgetingAccess.
//
// Mientras se comprueba el acceso (o se resuelve la sesión) no se enseña
// ningún logo ni fondo de color: cualquier pantalla intermedia con marca se
// nota como una "transición" al entrar o al recargar, y eso es justo lo que
// no se quiere — así que se enseña blanco liso (el mismo fondo que el resto
// de la app) hasta que hay algo real que mostrar.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !user) return; // UserContext ya redirige a /login si hace falta
    if (!user.budgetingAccess) router.replace("/dashboard");
  }, [isLoading, user, router]);

  if (isLoading || !user || !user.budgetingAccess) {
    return <div className="min-h-screen bg-white" />;
  }

  return <BudgetingShell>{children}</BudgetingShell>;
}
