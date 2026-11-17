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
  Clock,
  Eye,
  EyeOff,
  FileCheck2,
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
// Vista previa ilustrativa (no son datos reales) de lo que hay dentro.
const PREVIEW_CHAPTERS = [
  { label: "Equipo técnico", pct: 72 },
  { label: "Localizaciones", pct: 54 },
  { label: "Alquiler de equipo", pct: 88 },
  { label: "Postproducción", pct: 23 },
];

const MODULES = [
  { icon: Receipt, title: "Contabilidad", text: "Órdenes de compra, facturas, pagos y caja." },
  { icon: Users, title: "Equipo", text: "Fichas, partes de horas y nóminas." },
  { icon: Calculator, title: "Budgeting", text: "Presupuestos por capítulos y versiones." },
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

      {/* ── Panel de marca (solo escritorio) ── */}
      <aside
        className="relative hidden lg:flex lg:w-[52%] xl:w-[55%] flex-col justify-between overflow-hidden px-12 py-10 xl:px-16 xl:py-12 text-white"
        style={{ backgroundColor: INK }}
      >
        {/* Fondo: resplandor de marca + retícula */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              `radial-gradient(900px 520px at 0% 0%, ${BRAND}55 0%, transparent 60%),` +
              `radial-gradient(700px 480px at 100% 100%, ${BRAND}30 0%, transparent 60%)`,
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at 30% 40%, black 30%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse at 30% 40%, black 30%, transparent 75%)",
          }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <Image src="/logo.svg" alt="Filma Workspace" width={168} height={34} className="h-auto w-[168px]" priority />
        </div>

        {/* Mensaje + vista previa */}
        <div className="relative z-10 max-w-xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-white/50">
            Gestión de producción audiovisual
          </p>
          <h2 className="text-4xl xl:text-[2.75rem] font-semibold leading-[1.1] tracking-tight">
            Toda tu producción,<br />bajo control.
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/60">
            Contabilidad, equipo y presupuestos de cada proyecto en un único espacio de trabajo.
          </p>

          {/* Vista previa de la plataforma */}
          <div aria-hidden="true" className="relative mt-12 mr-8">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/40 backdrop-blur-sm">
              <div className="mb-4">
                <span className="text-[11px] font-medium text-white/40">Presupuesto · Gastado vs. previsto</span>
              </div>
              <div className="space-y-3.5">
                {PREVIEW_CHAPTERS.map((c) => (
                  <div key={c.label}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="text-white/75">{c.label}</span>
                      <span className="tabular-nums text-white/45">{c.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${c.pct}%`,
                          background: c.pct > 85 ? "#F5A524" : `linear-gradient(90deg, ${BRAND}, #6C8BFF)`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tarjetas flotantes */}
            <div className="absolute -right-8 -top-9 flex items-center gap-3 rounded-xl border border-white/10 bg-[#141A2E]/95 px-4 py-3 shadow-xl shadow-black/40">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${BRAND}33` }}>
                <FileCheck2 size={16} className="text-[#8EA6FF]" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/90">Orden de compra aprobada</p>
                <p className="text-[11px] text-white/45">Lista para facturar</p>
              </div>
            </div>
            <div className="absolute -bottom-11 left-10 flex items-center gap-3 rounded-xl border border-white/10 bg-[#141A2E]/95 px-4 py-3 shadow-xl shadow-black/40">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15">
                <Clock size={16} className="text-emerald-300" />
              </div>
              <div>
                <p className="text-xs font-medium text-white/90">Partes de horas del día</p>
                <p className="text-[11px] text-white/45">Enviados al equipo</p>
              </div>
            </div>
          </div>
        </div>

        {/* Módulos */}
        <div className="relative z-10">
          <div className="grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
            {MODULES.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon size={18} className="mb-2.5 text-[#8EA6FF]" />
                <p className="text-sm font-medium text-white/90">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/45">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs text-white/30">© {new Date().getFullYear()} Filma Workspace</p>
        </div>
      </aside>

      {/* ── Formulario ── */}
      <main className="flex flex-1 flex-col px-6 py-8 sm:px-10 lg:px-16">
        {/* Cabecera */}
        <div className="flex items-center justify-between lg:justify-end">
          <Image src="/logodark.svg" alt="Filma Workspace" width={140} height={28} className="h-auto w-[140px] lg:hidden" priority />
          <p className="hidden text-sm text-slate-500 sm:block">
            ¿No tienes cuenta?{" "}
            <Link href="/register" className="font-medium hover:underline" style={{ color: BRAND }}>
              Crear cuenta
            </Link>
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px]">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-slate-900">Bienvenido de nuevo</h1>
            <p className="mt-2 text-sm text-slate-500">Accede a tu espacio de trabajo.</p>

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

            <p className="mt-8 text-center text-sm text-slate-500 sm:hidden">
              ¿No tienes cuenta?{" "}
              <Link href="/register" className="font-medium hover:underline" style={{ color: BRAND }}>
                Crear cuenta
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 lg:hidden">© {new Date().getFullYear()} Filma Workspace</p>
      </main>
    </div>
  );
}
