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
  Calculator,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Receipt,
  Users,
} from "lucide-react";

// ─── Tokens ──────────────────────────────────────────────────────────────────
const BRAND = "#2F52E0";
const BRAND_HOVER = "#2545C7";
const INK = "#0B1020";

// ─── Panel de marca ──────────────────────────────────────────────────────────
const MODULES = [
  { icon: Receipt, title: "Contabilidad" },
  { icon: Users, title: "Equipo" },
  { icon: Calculator, title: "Presupuesto" },
];

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
    <div className={`min-h-screen flex bg-white ${inter.className}`}>

      {/* ── Panel de marca (solo pantallas anchas) ── */}
      <aside
        className="relative hidden lg:flex lg:w-[45%] xl:w-1/2 flex-col items-center justify-center overflow-hidden px-10 text-white"
        style={{ backgroundColor: INK }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              `radial-gradient(70% 55% at 50% 42%, ${BRAND}40 0%, transparent 70%),` +
              `radial-gradient(60% 40% at 50% 100%, ${BRAND}26 0%, transparent 70%)`,
          }}
        />

        <div className="relative z-10 flex flex-col items-center gap-14">
          <Image src="/logo.svg" alt="Filma Workspace" width={220} height={44} className="h-auto w-[180px] xl:w-[220px]" priority />

          <ul className="flex items-start gap-10 xl:gap-14">
            {MODULES.map(({ icon: Icon, title }) => (
              <li key={title} className="flex flex-col items-center gap-2.5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
                  <Icon size={18} className="text-[#8EA6FF]" />
                </span>
                <span className="text-xs font-medium text-white/60">{title}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ── Formulario ── */}
      <main className="flex flex-1 flex-col px-6 py-8 sm:px-10">
        {/* Logo (sin panel de marca) */}
        <div className="flex justify-center lg:hidden">
          <Image src="/logodark.svg" alt="Filma Workspace" width={140} height={28} className="h-auto w-[130px]" priority />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inicia sesión</h1>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nombre@productora.com"
                    disabled={loading}
                    autoComplete="email"
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-[#2F52E0] focus:outline-none focus:ring-4 focus:ring-[#2F52E0]/15 disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Contraseña */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                    Contraseña
                  </label>
                  <Link href="/forgot-password" className="text-xs font-medium hover:underline" style={{ color: BRAND }}>
                    ¿La has olvidado?
                  </Link>
                </div>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={loading}
                    autoComplete="current-password"
                    className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-11 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-[#2F52E0] focus:outline-none focus:ring-4 focus:ring-[#2F52E0]/15 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={loading}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
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

              {/* Error */}
              {error && (
                <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
                  <AlertCircle size={16} className="mt-px flex-shrink-0 text-red-500" />
                  <span className="text-sm text-red-700">{error}</span>
                </div>
              )}

              {/* Enviar */}
              <button
                type="submit"
                disabled={loading}
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--brand-hover)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#2F52E0]/30 disabled:cursor-not-allowed disabled:opacity-70"
                style={{ backgroundColor: BRAND, ["--brand-hover" as string]: BRAND_HOVER }}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Accediendo…
                  </>
                ) : (
                  <>
                    Iniciar sesión
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-slate-500">
              ¿No tienes cuenta?{" "}
              <Link href="/register" className="font-medium hover:underline" style={{ color: BRAND }}>
                Crear cuenta
              </Link>
            </p>
          </div>
        </div>

      </main>
    </div>
  );
}
