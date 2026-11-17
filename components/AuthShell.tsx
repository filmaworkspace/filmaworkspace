// ─── Pantallas de acceso (login, registro, recuperar contraseña) ─────────────
// Formulario a la izquierda sobre fondo claro y panel visual a la derecha con
// una vista ilustrativa de la plataforma. Estilos comunes de los campos, para
// que las tres pantallas se vean igual.

import Image from "next/image";
import { AlertCircle, Calculator, Receipt, Users } from "lucide-react";
import { inter } from "@/lib/fonts";

export const BRAND = "#2F52E0";

const MODULES = [
  { icon: Receipt, title: "Contabilidad" },
  { icon: Users, title: "Equipo" },
  { icon: Calculator, title: "Presupuesto" },
];

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
    "group flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm font-medium text-white transition " +
    "hover:bg-slate-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:opacity-60",
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

export function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 ${
        dark ? "border-slate-200 border-t-slate-700" : "border-white/30 border-t-white"
      }`}
    />
  );
}

// ─── Vista ilustrativa de la plataforma (no son datos reales) ────────────────
const PREVIEW_ROWS: { desc: string; supplier: string; dot: string; status: "Aprobada" | "Pendiente" | "Pagada"; amount: string; account: string; tint: string }[] = [
  { desc: "Alquiler de cámara y ópticas", supplier: "Rental Norte", dot: "#22D3EE", status: "Aprobada", amount: "4.850,00", account: "04.01", tint: "#38BDF8" },
  { desc: "Localización: nave industrial", supplier: "Espacios BCN", dot: "#F472B6", status: "Pendiente", amount: "2.300,00", account: "06.02", tint: "#F472B6" },
  { desc: "Catering rodaje semana 2", supplier: "Cocina Móvil", dot: "#FB923C", status: "Pagada", amount: "1.920,50", account: "08.03", tint: "#FB923C" },
  { desc: "Iluminación: grupo electrógeno", supplier: "Luz y Grúas", dot: "#A78BFA", status: "Aprobada", amount: "3.410,00", account: "04.03", tint: "#A78BFA" },
  { desc: "Transporte de equipo", supplier: "Furgo Pro", dot: "#34D399", status: "Pendiente", amount: "780,00", account: "09.01", tint: "#34D399" },
  { desc: "Vestuario y arreglos", supplier: "Taller Sastre", dot: "#F472B6", status: "Pagada", amount: "1.150,00", account: "05.02", tint: "#F472B6" },
  { desc: "Seguro de producción", supplier: "Aseguradora", dot: "#22D3EE", status: "Aprobada", amount: "2.640,00", account: "12.01", tint: "#38BDF8" },
  { desc: "Postproducción: etalonaje", supplier: "Color Lab", dot: "#FBBF24", status: "Pendiente", amount: "5.200,00", account: "10.04", tint: "#FBBF24" },
  { desc: "Maquillaje y peluquería", supplier: "Studio MUA", dot: "#A78BFA", status: "Pagada", amount: "960,00", account: "05.03", tint: "#A78BFA" },
  { desc: "Dietas equipo técnico", supplier: "Varios", dot: "#34D399", status: "Aprobada", amount: "1.380,00", account: "08.01", tint: "#34D399" },
];

const STATUS_COLOR = { Aprobada: "#60A5FA", Pendiente: "#FBBF24", Pagada: "#34D399" };

function PlatformPreview() {
  return (
    <div
      aria-hidden="true"
      className="w-full overflow-hidden rounded-xl border border-white/10 bg-[#0D1117] shadow-[0_30px_80px_-20px_rgba(8,15,35,0.65)] select-none"
    >
      {/* Barra superior */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-1.5 text-[9px] text-white/40">
          <span className="text-white/60">Proyecto</span>
          <span>›</span>
          <span className="text-white/80">Órdenes de compra</span>
        </div>
        <div className="flex gap-1">
          <span className="h-3 w-10 rounded bg-white/[0.06]" />
          <span className="h-3 w-3 rounded bg-white/[0.06]" />
          <span className="h-3 w-3 rounded bg-white/[0.06]" />
        </div>
      </div>

      <div className="flex">
        {/* Barra lateral */}
        <div className="flex w-7 flex-col items-center gap-2 border-r border-white/[0.06] py-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <span key={i} className={`h-2.5 w-2.5 rounded-sm ${i === 1 ? "bg-[#6C8BFF]" : "bg-white/10"}`} />
          ))}
        </div>

        {/* Tabla */}
        <div className="min-w-0 flex-1 text-[8.5px] leading-none">
          <div className="grid grid-cols-[1fr_0.7fr_0.5fr_0.5fr_0.4fr] gap-2 border-b border-white/[0.06] px-3 py-2 text-white/35">
            <span>Descripción</span><span>Proveedor</span><span>Estado</span><span className="text-right">Importe</span><span>Cuenta</span>
          </div>
          {PREVIEW_ROWS.map((r, i) => (
            <div
              key={i}
              className={`grid grid-cols-[1fr_0.7fr_0.5fr_0.5fr_0.4fr] items-center gap-2 border-b border-white/[0.04] px-3 py-[7px] ${i === 1 ? "bg-white/[0.04]" : ""}`}
            >
              <span className="truncate text-white/80">{r.desc}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-white/55">
                <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: r.dot }} />
                <span className="truncate">{r.supplier}</span>
              </span>
              <span className="flex items-center gap-1" style={{ color: STATUS_COLOR[r.status] }}>
                <span className="h-1 w-1 rounded-full" style={{ backgroundColor: STATUS_COLOR[r.status] }} />
                {r.status}
              </span>
              <span className="text-right tabular-nums text-white/70">{r.amount} €</span>
              <span>
                <span className="rounded px-1 py-0.5 tabular-nums" style={{ color: r.tint, backgroundColor: `${r.tint}22` }}>{r.account}</span>
              </span>
            </div>
          ))}
          <div className="flex justify-end px-3 py-2 tabular-nums text-white/45">Total 24.590,50 €</div>
        </div>
      </div>
    </div>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────
export default function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`min-h-screen flex bg-[#FAFAFA] ${inter.className}`}>

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
          style={{
            background:
              "radial-gradient(60% 50% at 85% 15%, rgba(148,190,214,0.85) 0%, transparent 70%)," +
              "radial-gradient(55% 45% at 10% 90%, rgba(120,150,210,0.7) 0%, transparent 70%)," +
              "radial-gradient(70% 60% at 30% 30%, rgba(47,82,224,0.55) 0%, transparent 70%)," +
              "linear-gradient(160deg, #3B5A86 0%, #24406E 45%, #1A2E52 100%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 top-1/3 h-[420px] w-[620px] rotate-[-18deg] rounded-full blur-3xl"
          style={{ background: "rgba(170,205,225,0.35)" }}
        />

        {/* Vista de la plataforma, centrada */}
        <div className="relative z-10 flex w-full max-w-[600px] flex-1 items-center">
          <PlatformPreview />
        </div>

        {/* Módulos, abajo y separados por una línea */}
        <div className="relative z-10 w-full max-w-[600px]">
          <ul className="grid grid-cols-3 gap-6 border-t border-white/20 pt-6">
            {MODULES.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10">
                  <Icon size={15} className="text-white" />
                </span>
                <span className="text-sm font-medium text-white/85">{title}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
