"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { BarChart3, Calculator, Mail, Users } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import SalesContactModal from "@/components/SalesContactModal";

// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: BarChart3,
    color: "#2F52E0",
    title: "Contabilidad de producción",
    description: "Órdenes de compra, facturas, proveedores y presupuesto controlados en tiempo real.",
  },
  {
    icon: Calculator,
    color: "#E86F4A",
    title: "Presupuestos",
    description: "De capítulo a línea, con cargas sociales, control de cambios y reportes en PDF listos para producción.",
  },
  {
    icon: Users,
    color: "#6BA319",
    title: "Gestión de equipo",
    description: "Altas de crew, control horario y nóminas sin depender de hojas de cálculo sueltas.",
  },
];

// Opacidades del mosaico de pósters (mismo recurso que el panel del login)
const POSTERS = [
  0.07, 0.14, 0.09, 0.16, 0.12, 0.06,
  0.15, 0.08, 0.1, 0.13, 0.07, 0.11,
  0.09, 0.16, 0.06, 0.12, 0.14, 0.08,
];

export default function HomePage() {
  const [showContact, setShowContact] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-3 sm:py-0 sm:h-16 flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-2.5 sm:gap-0">
          <Image src="/logodark.svg" alt="Filma Workspace" width={120} height={28} priority />

          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-700 hover:text-slate-900 px-3.5 sm:px-4 py-2 transition-colors"
            >
              Iniciar sesión
            </Link>
            <Link
              href="/register"
              className="text-sm font-semibold text-white rounded-full px-4 sm:px-5 py-2.5 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#2F52E0" }}
            >
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="max-w-4xl mx-auto px-6 pt-20 sm:pt-28 pb-16 sm:pb-24 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-slate-900 leading-[1.08]">
            La producción audiovisual,
            <br />
            <span style={{ color: "#2F52E0" }}>organizada de verdad.</span>
          </h1>
        </section>

        {/* ── Visual showcase — mismo lenguaje que el panel izquierdo del login ── */}
        <section className="max-w-6xl mx-auto px-6">
          <div
            className="relative overflow-hidden rounded-[2rem] h-[240px] sm:h-[420px] flex items-end justify-start p-6 sm:p-12"
            style={{ background: "linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)" }}
          >
            {/* Mosaico decorativo de pósters */}
            <div
              aria-hidden="true"
              className="absolute grid grid-cols-4 gap-2.5 w-[300px] -top-20 -right-10 sm:grid-cols-6 sm:gap-4 sm:w-[760px] sm:-top-40 sm:-right-16"
              style={{ transform: "rotate(-10deg)" }}
            >
              {POSTERS.map((opacity, i) => (
                <div
                  key={i}
                  className={`aspect-[2/3] rounded-lg sm:rounded-xl ${i % 2 === 1 ? "mt-8 sm:mt-16" : ""} ${i >= 8 ? "hidden sm:block" : ""}`}
                  style={{ backgroundColor: `rgba(255, 255, 255, ${opacity})` }}
                />
              ))}
            </div>

            <Image src="/logo.svg" alt="Filma Workspace" width={240} height={76} className="relative z-10 opacity-95 w-[140px] sm:w-[200px] h-auto" />
          </div>
        </section>

        {/* ── Feature grid ── */}
        <section className="max-w-4xl mx-auto px-6 py-20 sm:py-28 grid sm:grid-cols-3 gap-12">
          {FEATURES.map((f) => (
            <div key={f.title} className="text-center flex flex-col items-center">
              <f.icon size={30} style={{ color: f.color }} className="mb-4" />
              <h3 className="text-base font-semibold text-slate-900">{f.title}</h3>
            </div>
          ))}
        </section>

        {/* ── Contact band ── */}
        <section className="border-t border-slate-100 bg-slate-50">
          <div className="max-w-4xl mx-auto px-6 py-16 sm:py-24 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">¿Tienes dudas o quieres una demo?</h2>
            <button
              onClick={() => setShowContact(true)}
              className="mt-7 inline-flex items-center gap-2 bg-slate-900 text-white rounded-full px-7 py-3.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              <Mail size={16} />
              Contáctanos
            </button>
          </div>
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-slate-400">
        © {year} Filma Workspace. Todos los derechos reservados.
      </footer>

      <SalesContactModal open={showContact} onClose={() => setShowContact(false)} />
    </div>
  );
}
