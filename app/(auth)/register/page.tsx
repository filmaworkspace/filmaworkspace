"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, Timestamp } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"] });

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      await updateProfile(user, { displayName: name });

      await setDoc(doc(db, "users", user.uid), {
        name,
        email,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      router.push("/dashboard");
    } catch (err: any) {
      const errorMessages: Record<string, string> = {
        "auth/email-already-in-use": "Ya existe una cuenta con este email",
        "auth/invalid-email": "Email no válido",
        "auth/operation-not-allowed": "Operación no permitida",
        "auth/weak-password": "La contraseña es demasiado débil",
      };
      setError(errorMessages[err.code] || "Error al crear la cuenta");
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

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre completo"
                disabled={loading}
                autoComplete="name"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50"
                style={{ 
                  color: '#363636', 
                  backgroundColor: '#FFFFFF',
                  borderColor: 'rgba(54, 54, 54, 0.2)'
                }}
              />
            </div>

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

            {/* Password */}
            <div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña"
                  disabled={loading}
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50 pr-10"
                  style={{ 
                    color: '#363636', 
                    backgroundColor: '#FFFFFF',
                    borderColor: 'rgba(54, 54, 54, 0.2)'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={loading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors disabled:opacity-50"
                  style={{ color: 'rgba(54, 54, 54, 0.4)' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[10px] mt-1.5 ml-1" style={{ color: 'rgba(54, 54, 54, 0.5)' }}>
                Mínimo 6 caracteres
              </p>
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
              <span className="text-lg font-semibold" style={{ color: '#363636' }}>Crear cuenta</span>
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

          {/* Login link */}
          <p className="mt-6 text-center text-xs" style={{ color: 'rgba(54, 54, 54, 0.5)' }}>
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/login"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: '#363636' }}
            >
              Acceder
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
