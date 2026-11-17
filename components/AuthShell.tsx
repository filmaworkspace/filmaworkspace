// ─── Pantallas de acceso (login, registro, recuperar contraseña) ─────────────
// Panel de marca + columna del formulario, y los estilos comunes de los
// campos, para que las tres pantallas se vean igual.

import Image from "next/image";
import { AlertCircle, Calculator, Receipt, Users } from "lucide-react";
import { inter } from "@/lib/fonts";

export const BRAND = "#2F52E0";
const BRAND_HOVER = "#2545C7";
const INK = "#0B1020";

const MODULES = [
  { icon: Receipt, title: "Contabilidad" },
  { icon: Users, title: "Equipo" },
  { icon: Calculator, title: "Presupuesto" },
];

// ─── Estilos compartidos ─────────────────────────────────────────────────────
const FIELD =
  "h-11 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition " +
  "focus:border-[#2F52E0] focus:outline-none focus:ring-4 focus:ring-[#2F52E0]/15 disabled:opacity-60";

export const authStyles = {
  label: "mb-1.5 block text-sm font-medium text-slate-700",
  input: `${FIELD} px-3.5`,
  /** Con icono a la izquierda (pl-10). Añade pr-11 si lleva botón a la derecha. */
  inputWithIcon: `${FIELD} pl-10 pr-3.5`,
  fieldIcon: "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400",
  iconButton:
    "absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50",
  primaryButton:
    "group flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white shadow-sm transition " +
    "hover:bg-[var(--brand-hover)] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#2F52E0]/30 disabled:cursor-not-allowed disabled:opacity-70",
  primaryButtonStyle: { backgroundColor: BRAND, ["--brand-hover" as string]: BRAND_HOVER } as React.CSSProperties,
  link: "font-medium hover:underline",
  title: "text-2xl font-semibold tracking-tight text-slate-900",
  footer: "mt-8 text-center text-sm text-slate-500",
};

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
      <AlertCircle size={16} className="mt-px flex-shrink-0 text-red-500" />
      <span className="text-sm text-red-700">{children}</span>
    </div>
  );
}

export function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 ${
        dark ? "border-slate-200 border-t-slate-700" : "border-white/30 border-t-white"
      }`}
    />
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`min-h-screen flex bg-white ${inter.className}`}>

      {/* Panel de marca (solo pantallas anchas) */}
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

      {/* Formulario */}
      <main className="flex flex-1 flex-col px-6 py-8 sm:px-10">
        <div className="flex justify-center lg:hidden">
          <Image src="/logodark.svg" alt="Filma Workspace" width={140} height={28} className="h-auto w-[130px]" priority />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
