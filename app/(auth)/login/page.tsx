"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth } from "@/lib/firebase";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

// ─── Decoration ──────────────────────────────────────────────────────────────
// Opacidades del mosaico decorativo del panel izquierdo
const POSTERS = [0.07, 0.14, 0.09, 0.16, 0.12, 0.06, 0.15, 0.08, 0.1, 0.13, 0.07, 0.11];

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
    <div className={`min-h-screen flex flex-col lg:flex-row ${inter.className}`}>

      {/* ── Left Side (franja superior en móvil) ── */}
      <div
        className="relative overflow-hidden flex items-end h-44 p-6 lg:h-auto lg:w-1/2 lg:p-16"
        style={{
          background: "linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)",
        }}
      >
        {/* Mosaico decorativo de pósters */}
        <div
          aria-hidden="true"
          className="absolute grid grid-cols-3 gap-2.5 w-60 -top-16 -right-14 lg:grid-cols-4 lg:gap-4 lg:w-[720px] lg:-top-36 lg:-right-32"
          style={{ transform: "rotate(-10deg)" }}
        >
          {POSTERS.map((opacity, i) => (
            <div
              key={i}
              className={`aspect-[2/3] rounded-lg lg:rounded-xl ${i % 2 === 1 ? "mt-8 lg:mt-16" : ""} ${i >= 6 ? "hidden lg:block" : ""}`}
              style={{ backgroundColor: `rgba(255, 255, 255, ${opacity})` }}
            />
          ))}
        </div>

        <div className="relative z-10">
          <Image
            src="/logo.svg"
            alt="Logo"
            width={180}
            height={48}
            className="w-[120px] lg:w-[180px] h-auto opacity-95"
            priority
          />
        </div>
      </div>

      {/* ── Right Side – Form ── */}
      <div className="w-full flex-1 lg:w-1/2 flex items-center justify-center p-8" style={{ backgroundColor: "#FFFFFF" }}>
        <div className="w-full max-w-xs">

          {/* Title */}
          <h1 className="mb-8 text-2xl font-semibold tracking-tight" style={{ color: "#363636" }}>
            Inicia sesión
          </h1>

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
                style={{ color: "#363636", backgroundColor: "#FFFFFF", borderColor: "rgba(54, 54, 54, 0.2)" }}
              />
            </div>

            {/* Password */}
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                disabled={loading}
                autoComplete="current-password"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50 pr-10"
                style={{ color: "#363636", backgroundColor: "#FFFFFF", borderColor: "rgba(54, 54, 54, 0.2)" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors disabled:opacity-50"
                style={{ color: "rgba(54, 54, 54, 0.4)" }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {/* Remember me + forgot password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    disabled={loading}
                    className="sr-only peer"
                  />
                  <div
                    className="w-4 h-4 border rounded transition-all"
                    style={{
                      borderColor: rememberMe ? "#363636" : "rgba(54, 54, 54, 0.3)",
                      backgroundColor: rememberMe ? "#363636" : "transparent",
                    }}
                  />
                  <svg
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 transition-opacity ${rememberMe ? "opacity-100" : "opacity-0"}`}
                    style={{ color: "#FFFFFF" }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-xs" style={{ color: "rgba(54, 54, 54, 0.6)" }}>Recordarme</span>
              </label>

              <Link
                href="/forgot-password"
                className="text-xs transition-colors hover:opacity-80"
                style={{ color: "rgba(54, 54, 54, 0.5)" }}
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <span className="text-xs text-red-600">{error}</span>
              </div>
            )}

            {/* Submit */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-lg font-semibold" style={{ color: "#363636" }}>Acceder</span>
              <button
                type="submit"
                disabled={loading}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                style={{ backgroundColor: "#363636" }}
              >
                {loading ? (
                  <div
                    className="w-4 h-4 border-2 rounded-full animate-spin"
                    style={{ borderColor: "rgba(255, 255, 255, 0.3)", borderTopColor: "#FFFFFF" }}
                  />
                ) : (
                  <ArrowRight size={18} style={{ color: "#FFFFFF" }} />
                )}
              </button>
            </div>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-xs" style={{ color: "rgba(54, 54, 54, 0.5)" }}>
            ¿No tienes cuenta?{" "}
            <Link
              href="/register"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: "#363636" }}
            >
              Crear cuenta
            </Link>
          </p>
        </div>
      </div>

    </div>
  );
}
