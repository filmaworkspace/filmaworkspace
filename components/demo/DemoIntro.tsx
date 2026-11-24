"use client";

// ─── Intro de la demo ────────────────────────────────────────────────────────
// Presentación a pantalla completa sobre el degradado de Filma: textos que
// entran y salen con fundido, a su ritmo. Clic, espacio o flecha adelantan;
// flecha izquierda vuelve; «Saltar intro» va al final.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { BadgeCheck, Briefcase, Clapperboard, HardHat, Palette, Banknote, Bell, Calculator, Check, Eye, FilePlus2, FolderOpen, Layers, PenLine, PenTool, Search, SlidersHorizontal, Smartphone, Sparkles, Stamp, Users, WifiOff, type LucideIcon } from "lucide-react";
import { inter } from "@/lib/fonts";
import { DEMO_ROLES, DEMO_ROLE_ORDER, type DemoRoleKey } from "@/lib/demoRoles";

type Item = { title: string; text?: string; icon?: LucideIcon };
/** Tono del fondo: el de Filma, el de cada entorno, o los dos a la vez. */
type Theme = "filma" | "accounting" | "team" | "both";
/** Cambios de tono dentro de una diapositiva (ms desde que empieza). */
type Tones = { theme: Theme; at?: number }[];
type Slide =
  | { kind: "hero"; title: string; text?: string; icon?: LucideIcon; tones?: Tones }
  | { kind: "list"; title: string; items: Item[] ; tones?: Tones }
  | { kind: "ladder"; title: string; items: Item[] ; tones?: Tones }
  | { kind: "flow"; title: string; steps: Item[]; text: string; tones?: Tones }
  | { kind: "phone"; title: string; text: string; items: Item[]; tones?: Tones }
  | { kind: "cloud"; title: string; text: string; words: string[]; icon?: LucideIcon; tones?: Tones }
  | { kind: "brand"; text: string; tones?: Tones }
  | { kind: "end"; title: string; text: string ; tones?: Tones };

const ROLE_ICON: Record<DemoRoleKey, LucideIcon> = { pm: Clapperboard, controller: Briefcase, hod: Palette, crew: HardHat };

const STEP_MS = 1100; // entre elementos de una lista
/** Dónde flotan las palabras de Filma Hub alrededor del título: x %, y %, opacidad. */
const CLOUD: [number, number, number][] = [[6, 14, .55], [70, 8, .4], [80, 40, .6], [2, 52, .35], [62, 80, .5], [14, 84, .45], [40, 4, .3], [36, 92, .35]];

const slidesFor = (first: string): Slide[] => [
  { kind: "hero", title: "Filma Workspace", text: "Toda la producción en un solo lugar" },
  { kind: "hero", title: first ? `Hola, ${first}` : "Hola" },
  { kind: "hero", icon: Layers, title: "Un proyecto.\nDos entornos de trabajo.", tones: [{ theme: "both", at: 600 }] },
  { kind: "hero", icon: Calculator, title: "Contabilidad", text: "Cada euro de la producción, con su historia. Del presupuesto al pago, en tiempo real.", tones: [{ theme: "accounting" }] },
  { kind: "hero", icon: Users, title: "Equipo", text: "Las personas que hacen posible el rodaje, en un mismo sitio y siempre al día.", tones: [{ theme: "team" }] },
  { kind: "flow", title: "Nada sale sin aprobar", steps: [{ title: "Se pide", icon: FilePlus2 }, { title: "Se aprueba", icon: BadgeCheck }, { title: "Se paga", icon: Banknote }], text: "Circuitos por rol, por departamento o por importe. Cada decisión queda registrada.", tones: [{ theme: "accounting" }] },
  { kind: "cloud", icon: FolderOpen, title: "Filma Hub", text: "Toda la documentación del proyecto, ordenada y a un clic.",
    words: ["Contratos", "Facturas", "Presupuestos", "Certificados", "Órdenes de compra", "Fichas del equipo", "Justificantes", "Informes"], tones: [{ theme: "both" }] },
  { kind: "list", title: "Cada persona, su lugar", tones: [{ theme: "both" }], items: [
    { title: "La producción", text: "Lo ve todo.", icon: Clapperboard },
    { title: "Cada departamento", text: "Ve lo suyo.", icon: Users },
  ] },
  { kind: "ladder", title: "Y cada acceso, a medida", tones: [{ theme: "accounting" }], items: [
    { title: "Consulta", icon: Eye }, { title: "Propone", icon: PenLine }, { title: "Gestiona", icon: SlidersHorizontal }, { title: "Decide", icon: Stamp },
  ] },
  { kind: "phone", title: "Y en tu bolsillo", text: "La app móvil, para decidir desde el rodaje.", tones: [{ theme: "filma" }], items: [
    { title: "Aprueba con un gesto", icon: Check },
    { title: "Lo pendiente, siempre a mano", icon: Bell },
    { title: "Encuentra cualquier documento", icon: Search },
    { title: "También sin conexión", icon: WifiOff },
  ] },
  { kind: "hero", icon: Sparkles, title: "Menos tiempo administrando.\nMás tiempo haciendo cine.", tones: [{ theme: "both", at: 400 }, { theme: "filma", at: 3200 }] },
  { kind: "list", title: "Y cuando lo necesites, más", items: [
    { title: "Filma Sign", text: "Firma digital, sin salir de la plataforma.", icon: PenTool },
    { title: "Budgeting", text: "El presupuesto, antes de rodar.", icon: Calculator },
  ] },
  { kind: "end", title: "¿Cómo quieres verla?", text: "«La última marea», una producción de ejemplo con datos ficticios. Elige un perfil: cada uno ve la plataforma a su manera." },
];

const durationOf = (s: Slide) =>
  s.kind === "end" ? Infinity
  : s.kind === "brand" ? 4200
  : s.kind === "hero" ? (s.text ? 4800 : s.title.includes("\n") ? 4600 : 2600)
  : s.kind === "flow" ? 7200
  : s.kind === "cloud" ? 6800
  : s.kind === "phone" ? 8200
  : 2400 + s.items.length * (s.kind === "ladder" ? 1300 : STEP_MS + 400);

/** Icono de trazo fino en un círculo translúcido. */
function Mark({ icon: Icon, size = 56, delay = "0ms", className = "" }: { icon: LucideIcon; size?: number; delay?: string; className?: string }) {
  return (
    <span className={`demo-in inline-flex items-center justify-center rounded-full bg-white/[.07] ring-1 ring-white/25 ${className}`} style={{ width: size, height: size, animationDelay: delay }}>
      <Icon size={Math.round(size * 0.44)} strokeWidth={1.4} />
    </span>
  );
}

export default function DemoIntro({ name, onChoose, ready = true, error }: {
  name?: string;
  /** Al elegir perfil en la última pantalla. */
  onChoose: (role: DemoRoleKey) => void;
  /** El proyecto ya está preparado (si no, el botón espera). */
  ready?: boolean;
  error?: string;
}) {
  const slides = slidesFor((name || "").trim().split(" ")[0]);
  const [i, setI] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState<DemoRoleKey | null>(null);
  const [theme, setTheme] = useState<Theme>("filma");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = slides.length - 1;

  const go = useCallback((to: number) => {
    if (to < 0 || to > last || to === i) return;
    if (timer.current) clearTimeout(timer.current);
    setLeaving(true);
    timer.current = setTimeout(() => { setI(to); setLeaving(false); }, 550);
  }, [i, last]);

  // Avance automático
  useEffect(() => {
    const d = durationOf(slides[i]);
    if (!isFinite(d) || leaving) return;
    const t = setTimeout(() => go(i + 1), d);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, leaving]);

  // Tono del fondo: cambia con la diapositiva (y dentro de ella, a su ritmo).
  useEffect(() => {
    const tones = slides[i].tones || [{ theme: "filma" as Theme }];
    const ts = tones.map((t) => setTimeout(() => setTheme(t.theme), t.at || 0));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // Teclado
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(i + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      if (e.key === "Escape") go(last);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, go, ready]);

  const choose = (r: DemoRoleKey) => { if (entering || !ready) return; setEntering(r); onChoose(r); };
  const s = slides[i];

  return (
    <div className={`demo-intro fixed inset-0 z-[100] overflow-hidden text-white ${inter.className}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) go(i + 1); }}>
      <style>{CSS}</style>
      {/* Fondo: una capa por tono, que aparece y desaparece despacio */}
      {(["filma", "accounting", "team", "both"] as Theme[]).map((t) => (
        <div key={t} aria-hidden="true" className={`demo-layer demo-bg-${t} absolute inset-0`} style={{ opacity: theme === t ? 1 : 0 }} />
      ))}
      {(["filma", "accounting", "team"] as Theme[]).map((t) => (
        <div key={t} aria-hidden="true" className={`demo-glow demo-glow-${t} absolute`}
          style={{ opacity: theme === t || (theme === "both" && t !== "filma") ? 1 : 0 }} />
      ))}

      {/* Marca y saltar */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-5 sm:px-10">
        <Image src="/logo.svg" alt="Filma" width={96} height={19} className="h-auto w-[84px] opacity-90" priority />
        {i < last && (
          <button onClick={() => go(last)} className="rounded-md px-2.5 py-1 text-[13px] text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            Saltar intro
          </button>
        )}
      </div>

      {/* Diapositiva */}
      <main className="relative z-10 flex h-full items-center justify-center px-6 pb-[12vh] sm:px-10" aria-live="polite">
        <div key={i} className={`w-full ${["hero", "end", "flow", "cloud", "phone", "brand"].includes(s.kind) ? "max-w-5xl" : "max-w-3xl"} [text-wrap:balance] ${leaving ? "demo-out" : ""}`}>
          {s.kind === "brand" && (
            <div className="flex flex-col items-center text-center">
              <Image src="/logo.svg" alt="Filma Workspace" width={560} height={110} priority className="demo-in h-auto w-[min(560px,78vw)]" />
              <p className="demo-in mt-4 text-[13px] font-medium uppercase tracking-[0.42em] text-white/70 sm:text-[15px]" style={{ animationDelay: "500ms" }}>Workspace</p>
              <p className="demo-in mt-10 text-[19px] text-white/85 sm:text-[24px]" style={{ animationDelay: "1300ms" }}>{s.text}</p>
            </div>
          )}

          {s.kind === "hero" && (
            <div className="text-center">
              {s.icon && <Mark icon={s.icon} size={64} className="mb-7" />}
              <h1 className="demo-in whitespace-pre-line text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[64px]">{s.title}</h1>
              {s.text && <p className="demo-in mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-white/75 sm:text-[22px]" style={{ animationDelay: "900ms" }}>{s.text}</p>}
            </div>
          )}

          {s.kind === "list" && (
            <div>
              <h2 className="demo-in text-[32px] font-semibold leading-tight tracking-tight sm:text-[48px]">{s.title}</h2>
              <ul className="mt-8 space-y-5">
                {s.items.map((it, k) => (
                  <li key={k} className="demo-in" style={{ animationDelay: `${700 + k * STEP_MS}ms` }}>
                    {it.text ? (
                      <div className="flex items-start gap-4">
                        {it.icon && <Mark icon={it.icon} size={48} className="mt-0.5 flex-shrink-0" />}
                        <div>
                          <p className="text-[24px] font-semibold sm:text-[30px]">{it.title}</p>
                          <p className="mt-1 text-[17px] text-white/70 sm:text-[19px]">{it.text}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[20px] text-white/85 sm:text-[26px]">{it.title}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.kind === "ladder" && (
            <div>
              <h2 className="demo-in text-[30px] font-semibold leading-tight tracking-tight sm:text-[44px]">{s.title}</h2>
              <ol className="mt-8 space-y-2">
                {s.items.map((it, k) => (
                  <li key={k} className="demo-step flex items-baseline gap-4 rounded-lg px-4 py-3"
                    style={{ marginLeft: `${k * 8}%`, animationDelay: `${700 + k * 1300}ms` }}>
                    <span className="w-6 text-[15px] tabular-nums text-white/50">{k + 1}</span>
                    {it.icon && <it.icon size={24} strokeWidth={1.4} className="self-center text-white/80" />}
                    <span className="text-[26px] font-semibold sm:text-[34px]">{it.title}</span>
                    {it.text && <span className="text-[15px] text-white/70 sm:text-[17px]">{it.text}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {s.kind === "flow" && (
            <div className="text-center">
              <h1 className="demo-in text-[38px] font-semibold leading-[1.08] tracking-tight sm:text-[60px]">{s.title}</h1>
              <div className="relative mx-auto mt-14 max-w-2xl">
                <div aria-hidden="true" className="absolute left-[16.6%] right-[16.6%] top-[28px] h-px bg-white/20" />
                <div aria-hidden="true" className="demo-line absolute left-[16.6%] top-[28px] h-px bg-white" style={{ animationDelay: "1500ms" }} />
                <ol className="relative grid grid-cols-3">
                  {s.steps.map((st, k) => (
                    <li key={st.title} className="flex flex-col items-center">
                      <span className="demo-dot relative flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-[#172544]/40" style={{ animationDelay: `${1300 + k * 1100}ms` }}>
                        {st.icon && <st.icon size={24} strokeWidth={1.4} />}
                      </span>
                      <span className="demo-in mt-4 text-[18px] font-medium sm:text-[22px]" style={{ animationDelay: `${1300 + k * 1100}ms` }}>{st.title}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="demo-in mx-auto mt-12 max-w-xl text-[17px] leading-relaxed text-white/75 sm:text-[20px]" style={{ animationDelay: "4600ms" }}>{s.text}</p>
            </div>
          )}

          {s.kind === "cloud" && (
            <div className="relative text-center">
              <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[70vh] w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2">
                {s.words.map((w, k) => {
                  const pos = CLOUD[k % CLOUD.length];
                  return (
                    <span key={w} className="demo-float absolute whitespace-nowrap text-[15px] font-medium text-white sm:text-[19px]"
                      style={{ left: `${pos[0]}%`, top: `${pos[1]}%`, animationDelay: `${300 + k * 380}ms, ${300 + k * 380}ms`, ["--o" as string]: pos[2] }}>{w}</span>
                  );
                })}
              </div>
              {s.icon && <Mark icon={s.icon} size={64} delay="1300ms" className="relative mb-7" />}
              <h1 className="demo-in relative text-[44px] font-semibold leading-[1.05] tracking-tight sm:text-[72px]" style={{ animationDelay: "1600ms" }}>{s.title}</h1>
              <p className="demo-in relative mx-auto mt-5 max-w-xl text-[18px] leading-relaxed text-white/80 sm:text-[22px]" style={{ animationDelay: "2600ms" }}>{s.text}</p>
            </div>
          )}

          {s.kind === "phone" && (
            <div className="grid items-center gap-10 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-16">
              {/* Teléfono dibujado en línea: una aprobación se desliza y la lista sube */}
              <div className="demo-in mx-auto hidden h-[440px] w-[220px] rounded-[38px] border border-white/35 bg-white/[.04] p-3 sm:block" aria-hidden="true">
                <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/25" />
                <p className="px-2 text-[11px] font-medium text-white/70">Pendiente de ti</p>
                <div className="mt-3 space-y-2.5 overflow-hidden">
                  <div className="demo-swipe relative h-[62px] rounded-2xl bg-white/[.12] px-3 py-2.5">
                    <div className="h-2 w-20 rounded-full bg-white/60" /><div className="mt-2 h-1.5 w-28 rounded-full bg-white/25" /><div className="mt-2 h-1.5 w-12 rounded-full bg-white/25" />
                    <span className="demo-ok absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[#172544]"><Check size={15} strokeWidth={2.2} /></span>
                  </div>
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="demo-rise h-[62px] rounded-2xl bg-white/[.07] px-3 py-2.5">
                      <div className="h-2 w-16 rounded-full bg-white/45" /><div className="mt-2 h-1.5 w-24 rounded-full bg-white/20" /><div className="mt-2 h-1.5 w-10 rounded-full bg-white/20" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <Mark icon={Smartphone} size={56} className="mb-6" />
                <h2 className="demo-in text-[34px] font-semibold leading-tight tracking-tight sm:text-[52px]" style={{ animationDelay: "200ms" }}>{s.title}</h2>
                <p className="demo-in mt-3 text-[18px] text-white/75 sm:text-[21px]" style={{ animationDelay: "600ms" }}>{s.text}</p>
                <ul className="mt-8 space-y-4">
                  {s.items.map((it, k) => (
                    <li key={it.title} className="demo-in flex items-center gap-3.5" style={{ animationDelay: `${1600 + k * 900}ms` }}>
                      {it.icon && <it.icon size={20} strokeWidth={1.5} className="text-white/80" />}
                      <span className="text-[18px] sm:text-[21px]">{it.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {s.kind === "end" && (
            <div className="text-center">
              <h1 className="demo-in text-[36px] font-semibold leading-[1.1] tracking-tight sm:text-[56px]">{s.title}</h1>
              <p className="demo-in mx-auto mt-4 max-w-xl text-[17px] text-white/75 sm:text-[20px]" style={{ animationDelay: "600ms" }}>{s.text}</p>
              {error ? (
                <p className="demo-in mx-auto mt-10 max-w-md rounded-lg bg-white/10 px-4 py-3 text-[15px]" style={{ animationDelay: "1100ms" }}>{error}</p>
              ) : (
                <div className="mx-auto mt-10 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Elige un perfil">
                  {DEMO_ROLE_ORDER.map((r, k) => {
                    const Icon = ROLE_ICON[r];
                    const busy = entering === r;
                    return (
                      <button key={r} onClick={() => choose(r)} disabled={!ready || !!entering}
                        className={`demo-in group flex flex-col items-center rounded-2xl px-4 pb-5 pt-6 text-center ring-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default ${busy ? "bg-white text-[#172544] ring-white" : "bg-white/[.06] ring-white/20 hover:bg-white/[.12] hover:ring-white/50"} ${entering && !busy ? "opacity-40" : ""}`}
                        style={{ animationDelay: `${1100 + k * 160}ms` }}>
                        <span className={`flex h-12 w-12 items-center justify-center rounded-full ring-1 ${busy ? "ring-[#172544]/20" : "ring-white/30"}`}><Icon size={22} strokeWidth={1.4} /></span>
                        <span className="mt-4 text-[17px] font-semibold">{DEMO_ROLES[r].label}</span>
                        <span className={`mt-1.5 text-[13px] leading-snug ${busy ? "text-[#172544]/70" : "text-white/65"}`}>{busy ? "Entrando…" : DEMO_ROLES[r].note}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {!ready && !error && <p className="demo-in mt-6 text-[13px] text-white/60" style={{ animationDelay: "1600ms" }}>Preparando tu proyecto…</p>}
            </div>
          )}
        </div>
      </main>

      {/* Progreso */}
      <nav aria-label="Diapositivas" className="absolute inset-x-0 bottom-6 z-20 flex justify-center gap-2">
        {slides.map((_, k) => (
          <button key={k} onClick={() => go(k)} aria-label={`Ir a la diapositiva ${k + 1}`} aria-current={k === i}
            className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60"}`} />
        ))}
      </nav>

      {entering && <div aria-hidden="true" className="demo-fade fixed inset-0 z-30 bg-white" />}
    </div>
  );
}

const CSS = `
.demo-layer { transition: opacity 2.4s cubic-bezier(.4,0,.2,1); }
.demo-bg-filma { background: linear-gradient(135deg, #172544 0%, #24406E 55%, #3B5D96 100%); }
.demo-bg-accounting { background: linear-gradient(135deg, #16184A 0%, #24309A 55%, #4A47C8 100%); }
.demo-bg-team { background: linear-gradient(135deg, #11281A 0%, #24481F 55%, #4E7A1E 100%); }
.demo-bg-both { background: linear-gradient(120deg, #1B1F5E 0%, #253C78 45%, #2B4A3A 75%, #3F6A1E 100%); }
.demo-glow { width: 90vmax; height: 90vmax; right: -35vmax; top: -45vmax; border-radius: 9999px; filter: blur(20px);
  transition: opacity 2.4s cubic-bezier(.4,0,.2,1); animation: demo-drift 26s ease-in-out infinite alternate; }
.demo-glow-filma { background: radial-gradient(closest-side, rgba(110,143,199,.75), rgba(110,143,199,0)); }
.demo-glow-accounting { background: radial-gradient(closest-side, rgba(129,120,255,.7), rgba(129,120,255,0)); }
.demo-glow-team { right: auto; left: -40vmax; top: auto; bottom: -50vmax; animation-delay: -13s;
  background: radial-gradient(closest-side, rgba(150,205,80,.55), rgba(150,205,80,0)); }
@keyframes demo-drift { from { transform: translate(0,0) scale(1); } to { transform: translate(-12vmax, 10vmax) scale(1.15); } }
.demo-in { opacity: 0; animation: demo-in 900ms cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes demo-in { from { opacity: 0; filter: blur(10px); transform: translateY(10px); } to { opacity: 1; filter: blur(0); transform: none; } }
.demo-out { animation: demo-out 550ms ease forwards; }
@keyframes demo-out { to { opacity: 0; filter: blur(8px); transform: translateY(-6px); } }
.demo-step { opacity: .18; animation: demo-step 700ms ease forwards; }
@keyframes demo-step { to { opacity: 1; background: rgba(255,255,255,.08); } }
.demo-line { width: 0; animation: demo-line 2400ms cubic-bezier(.6,0,.2,1) forwards; }
@keyframes demo-line { to { width: 66.8%; } }
.demo-dot { animation: demo-dot 600ms ease forwards; }
@keyframes demo-dot { to { background: rgba(255,255,255,.16); border-color: #fff; box-shadow: 0 0 0 6px rgba(255,255,255,.08), 0 0 28px rgba(255,255,255,.35); } }
.demo-float { opacity: 0; filter: blur(6px); animation: demo-float-in 1400ms ease forwards, demo-bob 9s ease-in-out infinite alternate; }
@keyframes demo-float-in { to { opacity: var(--o); filter: blur(0); } }
@keyframes demo-bob { from { transform: translateY(0); } to { transform: translateY(-14px); } }
.demo-swipe { animation: demo-swipe 1100ms cubic-bezier(.5,0,.3,1) 2600ms forwards; }
@keyframes demo-swipe { 60% { transform: translateX(10px); opacity: 1; } to { transform: translateX(120%); opacity: 0; height: 0; margin-bottom: -10px; padding: 0; } }
.demo-ok { opacity: 0; animation: demo-ok 500ms ease 1900ms forwards; }
@keyframes demo-ok { to { opacity: 1; } }
.demo-rise { transition: transform .6s; }
.demo-fade { opacity: 0; animation: demo-fade 500ms ease forwards; }
@keyframes demo-fade { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .demo-glow { animation: none; }
  .demo-layer, .demo-glow { transition-duration: 1.2s !important; }
  .demo-in, .demo-out, .demo-step, .demo-fade, .demo-line, .demo-dot, .demo-float, .demo-swipe, .demo-ok { animation-duration: 1ms !important; filter: none !important; transform: none !important; }
}
`;
