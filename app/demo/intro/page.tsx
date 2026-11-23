"use client";

// Volver a ver la intro de la demo: al final se elige de nuevo el perfil.
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import DemoIntro from "@/components/demo/DemoIntro";
import { setDemoRole } from "@/lib/demoClient";
import type { DemoRoleKey } from "@/lib/demoRoles";

export default function DemoIntroAgain() {
  const { user, isLoading } = useUser();
  const router = useRouter();
  if (isLoading) return <div className="fixed inset-0" style={{ background: "linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%)" }} />;
  const choose = async (role: DemoRoleKey) => {
    if (user?.demo) await setDemoRole(role).catch(() => {});
    window.location.href = user?.demo ? `/project/${user.demo.projectId}` : "/dashboard";
  };
  return <DemoIntro name={user?.name} onChoose={choose} ready={!!user} />;
}
