"use client";

// ─── Entrada a la demo ───────────────────────────────────────────────────────
// Enlace personal que envía el admin. Al entrar se prepara (la primera vez) un
// proyecto de ejemplo con datos ficticios y se inicia sesión sin contraseña.

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import AuthShell, { AuthError, Spinner, authStyles } from "@/components/AuthShell";

export default function DemoEntryPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<{ name: string; expiresAt: string; started: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/demo/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, check: true }) })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setInfo(d); })
      .catch((e) => setError(e.message || "Enlace no válido"));
  }, [token]);

  const enter = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/demo/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (auth.currentUser) await signOut(auth);
      await signInWithCustomToken(auth, d.customToken);
      router.replace(`/project/${d.projectId}/accounting`);
    } catch (e) {
      setError((e as Error).message || "No se ha podido entrar");
      setBusy(false);
    }
  };

  const first = (info?.name || "").split(" ")[0];
  const until = info ? new Date(info.expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : "";

  return (
    <AuthShell>
      {!info && !error && <div className="flex justify-center"><Spinner /></div>}
      {error && !info && (
        <div className="space-y-4">
          <h1 className={authStyles.title}>Demo de Filma Workspace</h1>
          <AuthError>{error}</AuthError>
          <p className="text-sm text-slate-500">Si necesitas un enlace nuevo, pídeselo a quien te lo envió.</p>
        </div>
      )}
      {info && (
        <div className="space-y-6">
          <div>
            <h1 className={authStyles.title}>{first ? `Hola, ${first}` : "Demo de Filma Workspace"}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Vas a entrar en un proyecto de ejemplo con presupuesto, órdenes de compra, facturas y equipo. Los datos son ficticios: puedes crear, aprobar y codificar sin miedo.
            </p>
          </div>
          {error && <AuthError>{error}</AuthError>}
          <button onClick={enter} disabled={busy} className={authStyles.primaryButton}>
            {busy ? <><Spinner dark={false} /> {info.started ? "Entrando…" : "Preparando tu proyecto…"}</> : info.started ? "Volver a la demo" : "Entrar en la demo"}
          </button>
          <p className="text-xs text-slate-500">Enlace personal · funciona hasta el {until}.</p>
        </div>
      )}
    </AuthShell>
  );
}
