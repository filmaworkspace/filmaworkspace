// ─── Pantallas de acceso (login, registro, recuperar contraseña) ─────────────
// Formulario a la izquierda sobre fondo blanco y panel visual a la derecha con
// un titular. Estilos comunes de los campos, para
// que las tres pantallas se vean igual.

import Image from "next/image";
import { AlertCircle } from "lucide-react";
import { inter } from "@/lib/fonts";
import { coverGradient } from "@/lib/projectCover";

export const BRAND = "#2F52E0";


// Titular del panel derecho.
const HEADLINE = "Esto es cine.";

// ─── Estilos compartidos ─────────────────────────────────────────────────────
const FIELD =
  "h-10 w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 transition " +
  "focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10 disabled:opacity-60";

export const authStyles = {
  label: "mb-1.5 block text-sm font-medium text-slate-800",
  input: `${FIELD} px-3`,
  /** Para campos con botón a la derecha (mostrar contraseña). */
  inputWithButton: `${FIELD} pl-3 pr-11`,
  iconButton:
    "absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50",
  primaryButton:
    "group flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#E4E4E7] bg-[#F1F1F3] text-sm font-medium text-slate-900 transition " +
    "hover:bg-[#E8E8EB] focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-60",
  link: "font-medium text-slate-900 underline-offset-2 hover:underline",
  title: "text-[1.75rem] font-semibold tracking-tight text-slate-900",
  footer: "mt-6 text-center text-sm text-slate-500",
  back: "mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900",
};

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
      <AlertCircle size={16} className="mt-px flex-shrink-0 text-red-500" />
      <span className="text-sm text-red-700">{children}</span>
    </div>
  );
}

export function Spinner({ dark = true }: { dark?: boolean }) {
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

      {/* Formulario */}
      <main className="flex flex-1 flex-col px-6 py-7 sm:px-10 lg:w-1/2 lg:flex-none">
        <div>
          <Image src="/logodark.svg" alt="Filma Workspace" width={120} height={24} className="h-auto w-[110px]" priority />
        </div>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>
      </main>

      {/* Panel visual (solo pantallas anchas) */}
      <aside className="relative hidden lg:flex lg:w-1/2 flex-col items-center overflow-hidden px-10 pb-9 pt-16 xl:px-16">
        {/* Fondo: degradado de luz suave en los tonos de la marca */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: coverGradient() }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[620px] rotate-[-18deg] rounded-full blur-3xl"
          style={{ background: "rgba(170,205,225,0.35)" }}
        />

        {/* Titular */}
        <div className="relative z-10 flex w-full max-w-[600px] flex-1 items-center justify-center">
          <h2 className="text-center text-5xl font-semibold leading-[1.05] tracking-tight text-white xl:text-6xl">
            {HEADLINE}
          </h2>
        </div>

        {/* Marca, abajo y separada por una línea */}
        <div className="relative z-10 w-full max-w-[600px]">
          <p className="border-t border-white/20 pt-6 text-sm text-white/70">
            © {new Date().getFullYear()} Filma Workspace
          </p>
        </div>
      </aside>
    </div>
  );
}
