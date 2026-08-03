// ─── Framework ────────────────────────────────────────────────────────────────
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowRight, Mail, Wallet, Users, ClipboardCheck } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Wallet,
    title: "Contabilidad de producción",
    description: "Órdenes de compra, facturas, proveedores y presupuesto controlados en tiempo real.",
  },
  {
    icon: Users,
    title: "Gestión de equipo",
    description: "Altas de crew, control horario y nóminas sin depender de hojas de cálculo sueltas.",
  },
  {
    icon: ClipboardCheck,
    title: "Aprobaciones centralizadas",
    description: "Flujos de aprobación claros por departamento, con trazabilidad de cada decisión.",
  },
];

export default function HomePage() {
  const year = new Date().getFullYear();

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>

      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Image src="/logodark.svg" alt="Filma Workspace" width={120} height={28} priority />

          <a
            href="#contacto"
            className="hidden sm:block text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            Contacto
          </a>

          <div className="flex items-center gap-2 sm:gap-3">
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
        <section className="max-w-4xl mx-auto px-6 pt-20 sm:pt-28 pb-14 sm:pb-20 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-slate-900 leading-[1.08]">
            La producción audiovisual,
            <br />
            <span style={{ color: "#2F52E0" }}>organizada de verdad.</span>
          </h1>
          <p className="mt-6 text-base sm:text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
            Contabilidad, equipo y flujo de aprobación de tu proyecto en un solo lugar.
            Sin carpetas compartidas imposibles ni hojas de cálculo sueltas.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 text-white rounded-full px-7 py-3.5 text-sm font-semibold hover:opacity-90 transition-opacity w-full sm:w-auto"
              style={{ backgroundColor: "#2F52E0" }}
            >
              Crear cuenta
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 text-slate-700 rounded-full px-7 py-3.5 text-sm font-semibold border border-slate-200 hover:bg-slate-50 transition-colors w-full sm:w-auto"
            >
              Iniciar sesión
            </Link>
          </div>
        </section>

        {/* ── Visual showcase — mismo lenguaje que el panel izquierdo del login ── */}
        <section className="max-w-6xl mx-auto px-6">
          <div
            className="relative overflow-hidden rounded-[2rem] h-[280px] sm:h-[420px] flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #1a3a9e 0%, #2F52E0 50%, #4F6FE8 100%)" }}
          >
            <div
              className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 blur-3xl"
              style={{ backgroundColor: "#4F6FE8", transform: "translate(30%, -30%)" }}
            />
            <div
              className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15 blur-3xl"
              style={{ backgroundColor: "#1a3a9e", transform: "translate(-20%, 20%)" }}
            />
            <Image src="/logo.svg" alt="Filma Workspace" width={240} height={76} className="relative z-10 opacity-95" />
          </div>
        </section>

        {/* ── Feature grid ── */}
        <section className="max-w-6xl mx-auto px-6 py-20 sm:py-28 grid sm:grid-cols-3 gap-12 sm:gap-10">
          {FEATURES.map((f) => (
            <div key={f.title} className="text-center sm:text-left">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 mx-auto sm:mx-0"
                style={{ backgroundColor: "#EFF2FF" }}
              >
                <f.icon size={20} style={{ color: "#2F52E0" }} />
              </div>
              <h3 className="text-base font-semibold text-slate-900 mb-1.5">{f.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </section>

        {/* ── Contact band ── */}
        <section id="contacto" className="border-t border-slate-100 bg-slate-50">
          <div className="max-w-4xl mx-auto px-6 py-16 sm:py-24 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">¿Tienes dudas o quieres una demo?</h2>
            <p className="mt-3 text-slate-500">Escríbenos y te respondemos en menos de 24 horas.</p>
            <a
              href="mailto:hola@filmaworkspace.com"
              className="mt-8 inline-flex items-center gap-2 bg-slate-900 text-white rounded-full px-7 py-3.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
            >
              <Mail size={16} />
              Contactar
            </a>
          </div>
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-slate-400">
        © {year} Filma Workspace. Todos los derechos reservados.
      </footer>
    </div>
  );
}
