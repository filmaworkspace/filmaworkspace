"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { auth, db } from "@/lib/firebase";
import { browserLocalPersistence, createUserWithEmailAndPassword, setPersistence, updateProfile } from "firebase/auth";
import { doc, setDoc, Timestamp } from "firebase/firestore";

import { ArrowLeft, ArrowRight, ChevronDown, Eye, EyeOff } from "lucide-react";

import AuthShell, { AuthError, Spinner, authStyles as ui } from "@/components/AuthShell";

// ─────────────────────────────────────────────────────────────────────────────

const COUNTRIES = [
  { code: "ES", dial: "+34", flag: "🇪🇸", name: "España",         digits: 9,  placeholder: "612 345 678" },
  { code: "US", dial: "+1",  flag: "🇺🇸", name: "Estados Unidos", digits: 10, placeholder: "212 555 0100" },
  { code: "GB", dial: "+44", flag: "🇬🇧", name: "Reino Unido",    digits: 10, placeholder: "7911 123456" },
  { code: "FR", dial: "+33", flag: "🇫🇷", name: "Francia",        digits: 9,  placeholder: "6 12 34 56 78" },
  { code: "DE", dial: "+49", flag: "🇩🇪", name: "Alemania",       digits: 10, placeholder: "1512 3456789" },
  { code: "IT", dial: "+39", flag: "🇮🇹", name: "Italia",         digits: 10, placeholder: "312 345 6789" },
  { code: "PT", dial: "+351",flag: "🇵🇹", name: "Portugal",       digits: 9,  placeholder: "912 345 678" },
  { code: "MX", dial: "+52", flag: "🇲🇽", name: "México",         digits: 10, placeholder: "55 1234 5678" },
  { code: "AR", dial: "+54", flag: "🇦🇷", name: "Argentina",      digits: 10, placeholder: "11 2345-6789" },
  { code: "CO", dial: "+57", flag: "🇨🇴", name: "Colombia",       digits: 10, placeholder: "312 345 6789" },
];

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter();

  // ── Step 1 state ─────────────────────────────────────────────────────────
  const [name,         setName]         = useState("");
  const [phoneRaw,     setPhoneRaw]     = useState("");       // digits only
  const [phoneDisplay, setPhoneDisplay] = useState("");       // formatted display
  const [country,      setCountry]      = useState(COUNTRIES[0]);
  const [showCountry,  setShowCountry]  = useState(false);
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phoneError,   setPhoneError]   = useState("");

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

  // ── Phone input handler ───────────────────────────────────────────────────
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, country.digits);
    setPhoneRaw(raw);
    setPhoneDisplay(formatPhoneInput(raw));
    setPhoneError("");
  };

  const fullPhone = `${country.dial} ${phoneDisplay}`.trim();

  // ── Step 1: send verification code ───────────────────────────────────────
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setPhoneError("");

    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    if (phoneRaw.length < country.digits) {
      setPhoneError(`El número debe tener ${country.digits} dígitos`);
      return;
    }

    setLoading(true);
    try {
      // Check phone uniqueness via API (user is not authenticated yet)
      const phoneCheck = await fetch("/api/check-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone }),
      });
      const phoneData = await phoneCheck.json();
      if (phoneData.exists) {
        setPhoneError("Este número ya está registrado en otra cuenta");
        setLoading(false);
        return;
      }

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

      // Sesión persistente por defecto para cuentas recién creadas (mismo criterio
      // que "Recordarme" en login) — no depende de la persistencia que haya quedado
      // fijada en una pestaña previa.
      await setPersistence(auth, browserLocalPersistence);

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        name, email, phone: fullPhone, role: "user",
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
    <AuthShell>

      {/* ── PASO 1: datos ── */}
      {step === 1 && (
        <>
          <h1 className={ui.title}>Crea tu cuenta</h1>

          <form onSubmit={handleSendCode} className="mt-8 space-y-5">
            <div>
              <label htmlFor="name" className={ui.label}>Nombre completo</label>
              <div className="relative">
                <input id="name" type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Nombre y apellidos" disabled={loading} autoComplete="name"
                  className={ui.input} />
              </div>
            </div>

            {/* Teléfono con prefijo */}
            <div>
              <label htmlFor="phone" className={ui.label}>Teléfono</label>
              <div className={`flex h-10 rounded-lg border transition focus-within:ring-4 ${
                phoneError
                  ? "border-red-300 bg-red-50 focus-within:ring-red-500/15"
                  : "border-slate-300 bg-white focus-within:border-slate-900 focus-within:ring-slate-900/10"
              }`}>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCountry(v => !v)}
                    disabled={loading}
                    aria-label="Prefijo del país"
                    className="flex h-full min-w-[84px] items-center gap-1.5 rounded-l-lg border-r border-slate-200 px-3 text-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    <span className="text-base leading-none">{country.flag}</span>
                    <span className="text-slate-600">{country.dial}</span>
                    <ChevronDown size={13} className={`text-slate-400 transition-transform ${showCountry ? "rotate-180" : ""}`} />
                  </button>

                  {showCountry && (
                    <div className="absolute left-0 top-full z-30 mt-1.5 min-w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {COUNTRIES.map(c => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => { setCountry(c); setShowCountry(false); setPhoneRaw(""); setPhoneDisplay(""); }}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                            c.code === country.code ? "font-medium text-slate-900" : "text-slate-600"
                          }`}
                        >
                          <span className="text-base">{c.flag}</span>
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="text-xs text-slate-400">{c.dial}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  id="phone"
                  type="tel"
                  required
                  value={phoneDisplay}
                  onChange={handlePhoneChange}
                  placeholder={country.placeholder}
                  disabled={loading}
                  autoComplete="tel"
                  inputMode="numeric"
                  className={`min-w-0 flex-1 rounded-r-lg bg-transparent px-3.5 text-sm placeholder:text-slate-400 focus:outline-none disabled:opacity-60 ${
                    phoneError ? "text-red-600" : "text-slate-900"
                  }`}
                />
              </div>
              {phoneError && <p className="mt-1.5 text-xs text-red-600">{phoneError}</p>}
            </div>

            <div>
              <label htmlFor="email" className={ui.label}>Email</label>
              <div className="relative">
                <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="nombre@productora.com" disabled={loading} autoComplete="email"
                  className={ui.input} />
              </div>
            </div>

            <div>
              <label htmlFor="password" className={ui.label}>Contraseña</label>
              <div className="relative">
                <input id="password" type={showPassword ? "text" : "password"} required value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres"
                  disabled={loading} autoComplete="new-password" minLength={6}
                  className={ui.inputWithButton} />
                <button type="button" onClick={() => setShowPassword(v => !v)} disabled={loading}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  className={ui.iconButton}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <AuthError>{error}</AuthError>}

            <button type="submit" disabled={loading} className={ui.primaryButton}>
              {loading ? (
                <><Spinner /> Enviando código…</>
              ) : (
                <>Crear cuenta <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>
          </form>

          <p className={ui.footer}>
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className={ui.link}>Inicia sesión</Link>
          </p>
        </>
      )}

      {/* ── PASO 2: código de verificación ── */}
      {step === 2 && (
        <div>
          <button
            type="button"
            onClick={() => { setStep(1); setCodeError(""); }}
            className={ui.back}
          >
            <ArrowLeft size={15} /> Volver
          </button>

          <h1 className={ui.title}>Revisa tu email</h1>
          <p className="mt-2 text-sm text-slate-500">
            Código enviado a <span className="font-medium text-slate-800">{email}</span>
          </p>

          <div className="mt-8 flex justify-between gap-2" onPaste={handleDigitPaste}>
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
                aria-label={`Dígito ${i + 1}`}
                className={`h-14 w-12 rounded-lg border text-center text-xl font-semibold transition focus:outline-none focus:ring-4 disabled:opacity-60 ${
                  codeError
                    ? "border-red-300 bg-red-50 text-red-600 focus:ring-red-500/15"
                    : d
                      ? "border-slate-400 bg-white text-slate-900 focus:border-slate-900 focus:ring-slate-900/10"
                      : "border-slate-300 bg-white text-slate-900 focus:border-slate-900 focus:ring-slate-900/10"
                }`}
              />
            ))}
          </div>

          {codeError && <div className="mt-5"><AuthError>{codeError}</AuthError></div>}

          {loading && (
            <div className="mt-6 flex justify-center"><Spinner dark /></div>
          )}

          <p className={ui.footer}>
            ¿No te ha llegado?{" "}
            <button type="button" onClick={handleSendCode as any} className={ui.link}>
              Reenviar
            </button>
          </p>
        </div>
      )}

      {/* Click fuera para cerrar el selector de país */}
      {showCountry && (
        <div className="fixed inset-0 z-20" onClick={() => setShowCountry(false)} />
      )}
    </AuthShell>
  );
}
