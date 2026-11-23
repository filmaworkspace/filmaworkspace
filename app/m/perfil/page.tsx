"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { confirmDialog } from "@/lib/toast";
import { Card } from "@/components/mobile/ui";
import { useInstall } from "@/components/mobile/pwa";

function InstallRow() {
  const { canInstall, ios, installed, install } = useInstall();
  if (installed) return <p className="text-[13px] text-slate-500">Filma está instalada en este dispositivo.</p>;
  if (canInstall) return <button onClick={install} className="h-11 w-full rounded-xl border border-slate-200 text-[15px] font-medium">Instalar Filma en este dispositivo</button>;
  if (ios) return <p className="text-[13px] text-slate-500">Para instalar Filma: botón Compartir de Safari › «Añadir a pantalla de inicio».</p>;
  return null;
}

export default function MobileProfile() {
  const { user } = useUser();
  const router = useRouter();
  const logout = async () => {
    if (!(await confirmDialog({ title: "¿Cerrar sesión?", confirmLabel: "Cerrar sesión" }))) return;
    // Los datos guardados en el dispositivo se borran al salir.
    try { Object.keys(localStorage).filter((k) => k.startsWith("filma-m:")).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
    await signOut(auth);
    router.replace("/login");
  };
  return (
    <div className="space-y-6">
      <h1 className="text-[22px] font-semibold tracking-tight">Perfil</h1>
      <Card>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">Nombre</p>
          <p className="text-[15px]">{user?.name || "—"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">Email</p>
          <p className="break-all text-[15px]">{user?.email || "—"}</p>
        </div>
      </Card>
      <InstallRow />
      <p className="text-[13px] text-slate-500">Crear documentos, contabilidad, presupuesto y equipo están en la versión de ordenador.</p>
      <button onClick={logout} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-[15px] font-medium text-red-600 active:bg-red-50">
        <LogOut size={16} /> Cerrar sesión
      </button>
    </div>
  );
}
