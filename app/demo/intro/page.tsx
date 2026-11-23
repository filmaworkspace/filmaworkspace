"use client";

// Volver a ver la intro de la demo (desde la guía).
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import DemoIntro from "@/components/demo/DemoIntro";

export default function DemoIntroAgain() {
  const { user, isLoading } = useUser();
  const router = useRouter();
  if (isLoading) return <div className="fixed inset-0" style={{ background: "linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%)" }} />;
  const back = () => setTimeout(() => router.replace(user?.demo ? `/project/${user.demo.projectId}/accounting` : "/dashboard"), 450);
  return <DemoIntro name={user?.name} onEnter={back} enterLabel="Volver a la demo" />;
}
