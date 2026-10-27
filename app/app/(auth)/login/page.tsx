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
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  type AuthProvider,
} from "firebase/auth";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

// ─── Tokens ──────────────────────────────────────────────────────────────────
const BRAND = "#2F52E0";
const TEXT = "#111318";
const TEXT_LABEL = "#1F2329";
const TEXT_MUTED = "#575C66"; // ≥ 4.5:1 sobre blanco
const BORDER_SOFT = "#D3D6DC";
const DIVIDER = "#E4E6EA";

// Opacidades del mosaico decorativo del panel izquierdo
const POSTERS = [0.07, 0.14, 0.09, 0.16, 0.12, 0.06, 0.15, 0.08, 0.1, 0.13, 0.07, 0.11];

// ─────────────────────────────────────────────────────────────────────────────


export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedEmail = localStorage.getItem("rememberedEmail");
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const errorMessages: Record<string, string> = {
    "auth/invalid-email": "Email no válido",
    "auth/user-disabled": "Cuenta deshabilitada",
    "auth/user-not-found": "No existe una cuenta con este email",
    "auth/wrong-password": "Contraseña incorrecta",
    "auth/invalid-credential": "Credenciales incorrectas",
    "auth/too-many-requests": "Demasiados intentos. Inténtalo más tarde",
    "auth/account-exists-with-different-credential": "Ya existe una cuenta con este email. Accede con tu contraseña",
    "auth/popup-blocked": "El navegador ha bloqueado la ventana emergente",
  };

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
      setError(errorMessages[err.code] || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  const handleProvider = async (provider: AuthProvider) => {
    setError("");
    setLoading(true);

    try {
      // Same persistence rule as the email flow.
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithPopup(auth, provider);
      router.push("/dashboard");
    } catch (err: any) {
      // Closing the popup is not an error worth showing.
      if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
        setError(errorMessages[err.code] || "Error al iniciar sesión");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(e.getModifierState("CapsLock"));
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
            alt="Filmoi"
            width={180}
            height={48}
            className="w-[120px] lg:w-[180px] h-auto"
            priority
          />
        </div>
      </div>

      {/* ── Right Side – Form ── */}
      <div className="w-full flex-1 lg:w-1/2 flex lg:items-center justify-center px-6 py-8 lg:p-8" style={{ backgroundColor: "#FFFFFF" }}>
        <div className="w-full max-w-[380px]">

          {/* Heading */}
          <div className="mb-6 space-y-2">
            <h1 className="text-[26px] lg:text-[30px] font-bold tracking-tight" style={{ color: TEXT }}>
              Inicia sesión
            </h1>
            <p className="text-[15px] leading-relaxed" style={{ color: TEXT_MUTED }}>
              Bienvenido de nuevo. Introduce tus datos para continuar.
            </p>
          </div>

          {/* Social login */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleProvider(new GoogleAuthProvider())}
              disabled={loading}
              className="h-12 rounded-[10px] border text-[15px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: TEXT, borderColor: BORDER_SOFT }}
            >
              Google
            </button>
            <button
              type="button"
              onClick={() => handleProvider(new OAuthProvider("apple.com"))}
              disabled={loading}
              className="h-12 rounded-[10px] border text-[15px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: TEXT, borderColor: BORDER_SOFT }}
            >
              Apple
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ backgroundColor: DIVIDER }} />
            <span className="text-[13px]" style={{ color: TEXT_MUTED }}>o con tu email</span>
            <div className="flex-1 h-px" style={{ backgroundColor: DIVIDER }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium" style={{ color: TEXT_LABEL }}>
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                disabled={loading}
                autoComplete="email"
                aria-invalid={!!error}
                className="w-full h-12 px-3.5 border rounded-[10px] border-[#C4C8CF] text-base lg:text-[15px] placeholder:text-[#6B7280] focus:outline-none focus:border-[#2F52E0] focus:ring-4 focus:ring-[#2F52E0]/15 transition-all disabled:opacity-50"
                style={{ color: TEXT, backgroundColor: "#FFFFFF" }}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="block text-sm font-medium" style={{ color: TEXT_LABEL }}>
                  Contraseña
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: BRAND }}
                >
                  ¿La olvidaste?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={handleCapsLock}
                  onKeyDown={handleCapsLock}
                  onBlur={() => setCapsLock(false)}
                  placeholder="Introduce tu contraseña"
                  disabled={loading}
                  autoComplete="current-password"
                  aria-invalid={!!error}
                  aria-describedby={capsLock ? "caps-lock-hint" : undefined}
                  className="w-full h-12 pl-3.5 pr-12 border rounded-[10px] border-[#C4C8CF] text-base lg:text-[15px] placeholder:text-[#6B7280] focus:outline-none focus:border-[#2F52E0] focus:ring-4 focus:ring-[#2F52E0]/15 transition-all disabled:opacity-50"
                  style={{ color: TEXT, backgroundColor: "#FFFFFF" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-10 rounded-lg flex items-center justify-center transition-colors hover:bg-gray-50 disabled:opacity-50"
                  style={{ color: TEXT_MUTED }}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {capsLock && (
                <p id="caps-lock-hint" className="text-[13px]" style={{ color: TEXT_MUTED }}>
                  Bloq Mayús está activado
                </p>
              )}
            </div>

            {/* Remember me */}
            <label className="flex items-center gap-2.5 cursor-pointer min-h-6">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className="w-[18px] h-[18px] m-0 cursor-pointer"
                style={{ accentColor: BRAND }}
              />
              <span className="text-sm" style={{ color: "#3B404A" }}>Recordarme en este dispositivo</span>
            </label>

            {/* Error */}
            {error && (
              <div role="alert" className="flex items-center gap-2 p-3 bg-red-50 rounded-[10px]">
                <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
                <span className="text-sm text-red-700">{error}</span>
              </div>
            )}

            {/* Submit */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[52px] rounded-[10px] flex items-center justify-center gap-2.5 text-base font-semibold transition-all disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#2F52E0]/30"
                style={{ backgroundColor: BRAND, color: "#FFFFFF" }}
              >
                {loading ? (
                  <>
                    <div
                      className="w-4 h-4 border-2 rounded-full animate-spin"
                      style={{ borderColor: "rgba(255, 255, 255, 0.3)", borderTopColor: "#FFFFFF" }}
                    />
                    <span>Accediendo…</span>
                  </>
                ) : (
                  <>
                    <span>Acceder</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Register link */}
          <p className="mt-6 text-center text-sm" style={{ color: TEXT_MUTED }}>
            ¿No tienes cuenta?{" "}
            <Link
              href="/register"
              className="font-semibold underline underline-offset-[3px] transition-colors hover:opacity-80"
              style={{ color: BRAND }}
            >
              Crear cuenta
            </Link>
          </p>
        </div>
      </div>

    </div>
  );
}
