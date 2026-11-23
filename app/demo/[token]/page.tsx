"use client";

// ─── Entrada a la demo ───────────────────────────────────────────────────────
// Enlace personal que envía el admin: intro a pantalla completa y, mientras se
// ve, se prepara (la primera vez) el proyecto de ejemplo. «Entrar» inicia
// sesión sin contraseña y abre el panel de Contabilidad.

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { inter } from "@/lib/fonts";
import DemoIntro from "@/components/demo/DemoIntro";
import { setDemoRole } from "@/lib/demoClient";
import type { DemoRoleKey } from "@/lib/demoRoles";

const post = (body: object) =>
  fetch("/api/demo/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se ha podido abrir la demo"); return d; });

export default function DemoEntryPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string } | null>(null);
  const [fatal, setFatal] = useState("");
  const [session, setSession] = useState<{ customToken: string; projectId: string } | null>(null);
  const [prepError, setPrepError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    post({ token, check: true }).then((d) => {
      setInfo(d);
      // El proyecto se prepara mientras se ve la intro.
      if (started.current) return;
      started.current = true;
      post({ token }).then(setSession).catch((e) => setPrepError(e.message));
    }).catch((e) => setFatal(e.message));
  }, [token]);

  // Elegido el perfil: sesión, rol en el proyecto de ejemplo y a su página de inicio.
  const choose = async (role: DemoRoleKey) => {
    if (!session) return;
    try {
      if (auth.currentUser) await signOut(auth);
      await signInWithCustomToken(auth, session.customToken);
      await setDemoRole(role);
      router.replace(`/project/${session.projectId}`);
    } catch {
      setPrepError("No se ha podido entrar. Vuelve a abrir el enlace.");
    }
  };

  if (fatal) {
    return (
      <div className={`fixed inset-0 flex items-center justify-center px-6 text-center text-white ${inter.className}`}
        style={{ background: "linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%)" }}>
        <div>
          <h1 className="text-[32px] font-semibold tracking-tight sm:text-[44px]">{fatal}</h1>
          <p className="mt-4 text-[17px] text-white/75">Si necesitas un enlace nuevo, pídeselo a quien te lo envió.</p>
        </div>
      </div>
    );
  }
  if (!info) return <div className="fixed inset-0" style={{ background: "linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%)" }} />;
  return <DemoIntro name={info.name} onChoose={choose} ready={!!session} error={prepError} />;
}
