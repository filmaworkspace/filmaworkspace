"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Mail,
} from "lucide-react";

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
        const body = await res.json();
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
    <div className={`min-h-screen flex ${inter.className}`}>
      {/* Left Side - Brand with gradient */}
      <div 
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{ 
          background: 'linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)'
        }}
      >
        {/* Decorative elements */}
        <div 
          className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: '#4F6FE8', transform: 'translate(30%, -30%)' }}
        />
        <div 
          className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: '#1a3a9e', transform: 'translate(-20%, 20%)' }}
        />
        
        <div className="relative z-10 flex items-center justify-center w-full">
          <Image
            src="/logo.svg"
            alt="Logo"
            width={220}
            height={70}
            className="opacity-95"
            priority
          />
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8" style={{ backgroundColor: '#FFFFFF' }}>
        <div className="w-full max-w-xs">
          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center justify-center mb-12">
            <Image
              src="/logodark.svg"
              alt="Logo"
              width={140}
              height={45}
              priority
            />
          </div>

          {/* Back link */}
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs mb-6 transition-colors hover:opacity-70"
            style={{ color: 'rgba(54, 54, 54, 0.5)' }}
          >
            <ArrowLeft size={14} />
            Volver
          </Link>

          {success ? (
            /* Success State */
            <div className="text-center">
              <div 
                className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-5"
                style={{ backgroundColor: 'rgba(54, 54, 54, 0.1)' }}
              >
                <Mail size={20} style={{ color: '#363636' }} />
              </div>
              
              <h1 className="text-lg font-medium mb-1.5" style={{ color: '#363636' }}>
                Revisa tu email
              </h1>
              <p className="text-xs mb-6" style={{ color: 'rgba(54, 54, 54, 0.5)' }}>
                Hemos enviado un enlace de recuperación a<br />
                <span className="font-medium" style={{ color: '#363636' }}>{email}</span>
              </p>

              <div 
                className="p-3 rounded-xl mb-6"
                style={{ backgroundColor: 'rgba(54, 54, 54, 0.05)' }}
              >
                <div className="flex items-start gap-2">
                  <CheckCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: '#363636' }} />
                  <p className="text-[11px] text-left" style={{ color: 'rgba(54, 54, 54, 0.6)' }}>
                    Sigue las instrucciones del email para restablecer tu contraseña. Si no lo ves, revisa la carpeta de spam.
                  </p>
                </div>
              </div>

              <Link
                href="/login"
                className="block w-full px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-center hover:opacity-90"
                style={{ backgroundColor: '#363636', color: '#FFFFFF' }}
              >
                Volver a Acceder
              </Link>

              <button
                onClick={() => { setSuccess(false); setEmail(""); }}
                className="mt-4 text-xs transition-colors hover:opacity-70"
                style={{ color: 'rgba(54, 54, 54, 0.5)' }}
              >
                ¿No recibiste el email? Intentar de nuevo
              </button>
            </div>
          ) : (
            /* Form State */
            <>
              {/* Subtitle */}
              <p className="text-xs mb-6" style={{ color: 'rgba(54, 54, 54, 0.5)' }}>
                Te enviaremos un enlace para restablecer tu contraseña
              </p>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email */}
                <div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    disabled={loading}
                    autoComplete="email"
                    className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50"
                    style={{ 
                      color: '#363636', 
                      backgroundColor: '#FFFFFF',
                      borderColor: 'rgba(54, 54, 54, 0.2)'
                    }}
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl">
                    <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                    <span className="text-xs text-red-600">{error}</span>
                  </div>
                )}

                {/* Submit - Arrow button */}
                <div className="flex items-center justify-between pt-2">
                  <span className="text-lg font-semibold" style={{ color: '#363636' }}>Recuperar</span>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                    style={{ backgroundColor: '#363636' }}
                  >
                    {loading ? (
                      <div 
                        className="w-4 h-4 border-2 rounded-full animate-spin"
                        style={{ borderColor: 'rgba(255, 255, 255, 0.3)', borderTopColor: '#FFFFFF' }}
                      />
                    ) : (
                      <ArrowRight size={18} style={{ color: '#FFFFFF' }} />
                    )}
                  </button>
                </div>
              </form>

              {/* Back to login */}
              <p className="mt-6 text-center text-xs" style={{ color: 'rgba(54, 54, 54, 0.5)' }}>
                ¿Recordaste tu contraseña?{" "}
                <Link
                  href="/login"
                  className="font-medium transition-colors hover:opacity-80"
                  style={{ color: '#363636' }}
                >
                  Acceder
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
