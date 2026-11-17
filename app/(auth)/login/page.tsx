"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth } from "@/lib/firebase";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import AuthShell, { AuthError, BRAND, Spinner, authStyles as ui } from "@/components/AuthShell";

// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Set persistence explicitly on every login (never rely on whatever mode a
      // previous tab/session left behind) — local (survives closing the browser,
      // backed by a Firebase-managed refresh token, never the raw password) when
      // "Recordarme" is checked, session-only otherwise. Done BEFORE signIn and
      // not awaited together with router.push, to avoid the race condition where
      // a transient null auth state redirects the user back to login.
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      await signInWithEmailAndPassword(auth, email, password);

      if (rememberMe) {
        localStorage.setItem("rememberedEmail", email);
      } else {
        localStorage.removeItem("rememberedEmail");
      }

      router.push("/dashboard");
    } catch (err: any) {
      const errorMessages: Record<string, string> = {
        "auth/invalid-email": "Email no válido",
        "auth/user-disabled": "Cuenta deshabilitada",
        "auth/user-not-found": "No existe una cuenta con este email",
        "auth/wrong-password": "Contraseña incorrecta",
        "auth/invalid-credential": "Credenciales incorrectas",
        "auth/too-many-requests": "Demasiados intentos. Inténtalo más tarde",
      };
      setError(errorMessages[err.code] || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <h1 className={ui.title}>Inicia sesión</h1>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Email */}
        <div>
          <label htmlFor="email" className={ui.label}>Email</label>
          <div className="relative">
            <Mail size={16} className={ui.fieldIcon} />
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@productora.com"
              disabled={loading}
              autoComplete="email"
              className={ui.inputWithIcon}
            />
          </div>
        </div>

        {/* Contraseña */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Contraseña</label>
            <Link href="/forgot-password" className="text-xs font-medium hover:underline" style={{ color: BRAND }}>
              ¿La has olvidado?
            </Link>
          </div>
          <div className="relative">
            <Lock size={16} className={ui.fieldIcon} />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              autoComplete="current-password"
              className={`${ui.inputWithIcon} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              disabled={loading}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className={ui.iconButton}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Recordarme */}
        <label className="flex cursor-pointer select-none items-center gap-2.5">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-[#2F52E0]"
          />
          <span className="text-sm text-slate-600">Mantener la sesión iniciada</span>
        </label>

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className={ui.primaryButton} style={ui.primaryButtonStyle}>
          {loading ? (
            <><Spinner /> Accediendo…</>
          ) : (
            <>Iniciar sesión <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>
          )}
        </button>
      </form>

      <p className={ui.footer}>
        ¿No tienes cuenta?{" "}
        <Link href="/register" className={ui.link} style={{ color: BRAND }}>Crear cuenta</Link>
      </p>
    </AuthShell>
  );
}
