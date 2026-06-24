"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, setDoc, Timestamp } from "firebase/firestore";

import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

const INPUT_STYLE = {
  color: "#363636",
  backgroundColor: "#FFFFFF",
  borderColor: "rgba(54, 54, 54, 0.2)",
};

export default function RegisterPage() {
  const router = useRouter();

  // ── Step 1 state ─────────────────────────────────────────────────────────
  const [name,         setName]         = useState("");
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Step 2 state ─────────────────────────────────────────────────────────
  const [step,        setStep]        = useState<1 | 2>(1);
  const [digits,      setDigits]      = useState(["", "", "", "", "", ""]);
  const [codeError,   setCodeError]   = useState("");
  const digitRefs = [
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null),
  ];

  // ── Shared state ─────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  // ── Step 1: send verification code ───────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Error al enviar el código");
      }
      setStep(2);
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => digitRefs[0].current?.focus(), 100);
    } catch (err: any) {
      setError(err.message || "Error al enviar el código");
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: digit input handling ─────────────────────────────────────────
  const handleDigit = (i: number, v: string) => {
    if (!/^\d?$/.test(v)) return;
    const next = [...digits]; next[i] = v; setDigits(next); setCodeError("");
    if (v && i < 5) digitRefs[i + 1].current?.focus();
    if (v && i === 5) verifyAndCreate([...next]);
  };

  const handleDigitKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) digitRefs[i - 1].current?.focus();
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      const next = text.split(""); setDigits(next); setCodeError("");
      digitRefs[5].current?.focus();
      verifyAndCreate(next);
    }
  };

  // ── Step 2: verify code then create account ───────────────────────────────
  const verifyAndCreate = async (d = digits) => {
    const code = d.join("");
    if (code.length < 6) return;
    setLoading(true); setCodeError("");
    try {
      // 1. Verify code
      const vRes = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!vRes.ok) {
        const body = await vRes.json();
        setCodeError(body.error || "Código incorrecto");
        setDigits(["", "", "", "", "", ""]);
        setTimeout(() => digitRefs[0].current?.focus(), 50);
        return;
      }

      // 2. Create Firebase account
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email, role: "user",
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });

      router.push("/dashboard");
    } catch (err: any) {
      const messages: Record<string, string> = {
        "auth/email-already-in-use": "Ya existe una cuenta con este email",
        "auth/weak-password":        "La contraseña es demasiado débil",
      };
      setCodeError(messages[err.code] || err.message || "Error al crear la cuenta");
      setDigits(["", "", "", "", "", ""]);
      setTimeout(() => digitRefs[0].current?.focus(), 50);
    } finally {
      setLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen flex ${inter.className}`}>

      {/* Left — brand */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{ background: "linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)" }}>
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: "#4F6FE8", transform: "translate(30%, -30%)" }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: "#1a3a9e", transform: "translate(-20%, 20%)" }} />
        <div className="relative z-10 flex items-center justify-center w-full">
          <Image src="/logo.svg" alt="Logo" width={220} height={70} className="opacity-95" priority />
        </div>
      </div>

      {/* Right — form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8" style={{ backgroundColor: "#FFFFFF" }}>
        <div className="w-full max-w-xs">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-12">
            <Image src="/logodark.svg" alt="Logo" width={140} height={45} priority />
          </div>

          {/* ── STEP 1: form ── */}
          {step === 1 && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div>
                <input type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Nombre completo" disabled={loading} autoComplete="name"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50"
                  style={INPUT_STYLE} />
              </div>
              <div>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Email" disabled={loading} autoComplete="email"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50"
                  style={INPUT_STYLE} />
              </div>
              <div>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} required value={password}
                    onChange={e => setPassword(e.target.value)} placeholder="Contraseña"
                    disabled={loading} autoComplete="new-password"
                    className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50 pr-10"
                    style={INPUT_STYLE} />
                  <button type="button" onClick={() => setShowPassword(v => !v)} disabled={loading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors disabled:opacity-50"
                    style={{ color: "rgba(54,54,54,0.4)" }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-[10px] mt-1.5 ml-1" style={{ color: "rgba(54,54,54,0.5)" }}>
                  Mínimo 6 caracteres
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <span className="text-xs text-red-600">{error}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <span className="text-lg font-semibold" style={{ color: "#363636" }}>Crear cuenta</span>
                <button type="submit" disabled={loading}
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                  style={{ backgroundColor: "#363636" }}>
                  {loading
                    ? <div className="w-4 h-4 border-2 rounded-full animate-spin"
                        style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
                    : <ArrowRight size={18} style={{ color: "#fff" }} />}
                </button>
              </div>
            </form>
          )}

          {/* ── STEP 2: code verification ── */}
          {step === 2 && (
            <div>
              <button onClick={() => { setStep(1); setCodeError(""); }}
                className="inline-flex items-center gap-1.5 text-xs mb-6 transition-colors hover:opacity-70"
                style={{ color: "rgba(54,54,54,0.5)" }}>
                <ArrowLeft size={14} /> Volver
              </button>

              <p className="text-lg font-semibold mb-1" style={{ color: "#363636" }}>
                Revisa tu email
              </p>
              <p className="text-xs mb-8" style={{ color: "rgba(54,54,54,0.5)" }}>
                Hemos enviado un código de 6 dígitos a{" "}
                <span className="font-medium" style={{ color: "#363636" }}>{email}</span>
              </p>

              {/* 6-digit input */}
              <div className="flex gap-2 justify-center mb-6" onPaste={handleDigitPaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={digitRefs[i]}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={e => handleDigit(i, e.target.value)}
                    onKeyDown={e => handleDigitKey(i, e)}
                    disabled={loading}
                    className="w-10 h-12 text-center text-lg font-bold border rounded-xl focus:outline-none focus:ring-2 focus:border-transparent transition-all disabled:opacity-50"
                    style={{
                      color: codeError ? "#dc2626" : "#363636",
                      borderColor: codeError ? "#fca5a5" : d ? "#363636" : "rgba(54,54,54,0.2)",
                      backgroundColor: codeError ? "#fff1f2" : "#fff",
                    }}
                  />
                ))}
              </div>

              {codeError && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 rounded-xl mb-4">
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                  <span className="text-xs text-red-600">{codeError}</span>
                </div>
              )}

              {loading && (
                <div className="flex justify-center">
                  <div className="w-5 h-5 border-2 rounded-full animate-spin"
                    style={{ borderColor: "rgba(54,54,54,0.2)", borderTopColor: "#363636" }} />
                </div>
              )}

              <p className="mt-6 text-center text-xs" style={{ color: "rgba(54,54,54,0.5)" }}>
                ¿No recibiste el código?{" "}
                <button onClick={handleSendCode as any}
                  className="font-medium hover:opacity-70 transition-colors"
                  style={{ color: "#363636" }}>
                  Reenviar
                </button>
              </p>
            </div>
          )}

          {/* Login link (step 1 only) */}
          {step === 1 && (
            <p className="mt-6 text-center text-xs" style={{ color: "rgba(54,54,54,0.5)" }}>
              ¿Ya tienes cuenta?{" "}
              <Link href="/login" className="font-medium transition-colors hover:opacity-80"
                style={{ color: "#363636" }}>
                Acceder
              </Link>
            </p>
          )}

        </div>
      </div>
    </div>
  );
}
