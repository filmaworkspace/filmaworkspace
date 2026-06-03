"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import { Eye, EyeOff, AlertCircle, ArrowRight } from "lucide-react";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from "firebase/auth";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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
    <div className={`min-h-screen flex ${inter.className}`}>

      {/* ── Left Side ── */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)",
        }}
      >
        <div
          className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: "#4F6FE8", transform: "translate(30%, -30%)" }}
        />
        <div
          className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: "#1a3a9e", transform: "translate(-20%, 20%)" }}
        />
        <div className="relative z-10 flex items-center justify-center w-full">
          <Image src="/logo.svg" alt="Logo" width={220} height={70} className="opacity-95" priority />
        </div>
      </div>

      {/* ── Right Side – Form ── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8" style={{ backgroundColor: "#FFFFFF" }}>
        <div className="w-full max-w-xs">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-12">
            <Image src="/logodark.svg" alt="Logo" width={140} height={45} priority />
          </div>

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
