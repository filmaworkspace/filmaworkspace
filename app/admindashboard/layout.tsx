"use client";

// ─── Panel de administración: estructura común ───────────────────────────────
// Datos compartidos (AdminDataProvider), ⌘K y control de acceso: admins ven
// todo; los agentes de soporte solo Soporte y Guías.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import { AdminDataProvider } from "@/components/admin/AdminData";
import CommandPalette, { useCommandPaletteHotkey } from "@/components/admin/CommandPalette";
import { PageLoading } from "@/components/ds";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [cmdk, setCmdk] = useState(false);
  const isAdmin = user?.role === "admin";
  const isAgent = user?.role === "support_agent";
  const agentAllowed = pathname.startsWith("/admindashboard/support") || pathname.startsWith("/admindashboard/guides");

  useEffect(() => {
    if (isLoading) return;
    if (!user || (!isAdmin && !isAgent) || user.impersonatedBy) { router.replace("/dashboard"); return; }
    if (isAgent && !agentAllowed) router.replace("/admindashboard/support");
  }, [isLoading, user, isAdmin, isAgent, agentAllowed, router]);

  useCommandPaletteHotkey(setCmdk);
  useEffect(() => {
    const open = () => setCmdk(true);
    window.addEventListener("admin:cmdk", open);
    return () => window.removeEventListener("admin:cmdk", open);
  }, []);

  if (isLoading || !user || (!isAdmin && !isAgent) || (isAgent && !agentAllowed)) return <PageLoading />;

  return (
    <AdminDataProvider>
      {children}
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} isAdmin={isAdmin} />
    </AdminDataProvider>
  );
}
