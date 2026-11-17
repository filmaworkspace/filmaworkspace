"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowLeft, ArrowRight, MailCheck } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import AuthShell, { AuthError, Spinner, authStyles as ui } from "@/components/AuthShell";

// ─────────────────────────────────────────────────────────────────────────────

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/send-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al enviar el email");
      }
      setSuccess(true);
    } catch (err: any) {
      const errorMessages: Record<string, string> = {
        "auth/invalid-email":      "Email no válido",
        "auth/too-many-requests":  "Demasiados intentos. Inténtalo más tarde",
      };
      setError(errorMessages[err.code] || err.message || "Error al enviar el email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <Link
        href="/login"
        className={ui.back}
      >
        <ArrowLeft size={15} />
        Volver
      </Link>

      {success ? (
        <div>
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white">
            <MailCheck size={20} className="text-slate-700" />
          </div>
          <h1 className={ui.title}>Revisa tu email</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enlace enviado a <span className="font-medium text-slate-800">{email}</span>
          </p>

          <Link href="/login" className={`${ui.primaryButton} mt-8`}>
            Volver a iniciar sesión
          </Link>

          <p className={ui.footer}>
            ¿No te ha llegado?{" "}
            <button
              type="button"
              onClick={() => { setSuccess(false); setEmail(""); }}
              className={ui.link}
             
            >
              Reenviar
            </button>
          </p>
        </div>
      ) : (
        <>
          <h1 className={ui.title}>Recuperar contraseña</h1>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className={ui.label}>Email</label>
              <div className="relative">
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@productora.com"
                  disabled={loading}
                  autoComplete="email"
                  className={ui.input}
                />
              </div>
            </div>

            {error && <AuthError>{error}</AuthError>}

            <button type="submit" disabled={loading} className={ui.primaryButton}>
              {loading ? (
                <><Spinner /> Enviando…</>
              ) : (
                <>Enviar enlace <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>
          </form>

          <p className={ui.footer}>
            ¿La recuerdas?{" "}
            <Link href="/login" className={ui.link}>Inicia sesión</Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
