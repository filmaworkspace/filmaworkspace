"use client";

// ─── Intro de la demo ────────────────────────────────────────────────────────
// Presentación a pantalla completa sobre el degradado de Filma: textos que
// entran y salen con fundido, a su ritmo. Clic, espacio o flecha adelantan;
// flecha izquierda vuelve; «Saltar intro» va al final.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { inter } from "@/lib/fonts";

type Item = { title: string; text?: string };
/** Tono del fondo: el de Filma, el de cada entorno, o los dos a la vez. */
type Theme = "filma" | "accounting" | "team" | "both";
/** Cambios de tono dentro de una diapositiva (ms desde que empieza). */
type Tones = { theme: Theme; at?: number }[];
type Slide =
  | { kind: "hero"; title: string; text?: string ; tones?: Tones }
  | { kind: "list"; title: string; items: Item[] ; tones?: Tones }
  | { kind: "ladder"; title: string; items: Item[] ; tones?: Tones }
  | { kind: "end"; title: string; text: string ; tones?: Tones };

const STEP_MS = 1100; // entre elementos de una lista

const slidesFor = (first: string): Slide[] => [
  { kind: "hero", title: first ? `Hola, ${first}.` : "Hola." },
  { kind: "hero", title: "Filma Workspace.", text: "Toda la producción en un solo lugar." },
  { kind: "hero", title: "Un proyecto.\nDos entornos de trabajo.", text: "Cada equipo trabaja en el suyo, con los mismos datos.", tones: [{ theme: "both", at: 600 }] },
  { kind: "list", title: "Los entornos", tones: [{ theme: "accounting", at: 500 }, { theme: "team", at: 700 + STEP_MS }], items: [
    { title: "Contabilidad", text: "POs, facturas, pagos y presupuesto." },
    { title: "Equipo", text: "Crew, calendario, nóminas y control horario." },
  ] },
  { kind: "list", title: "El panel de Contabilidad.", tones: [{ theme: "accounting" }], items: [
    { title: "El circuito de facturas, de recibidas a pagadas." },
    { title: "El presupuesto comprometido y realizado, al momento." },
    { title: "Lo que vence esta semana." },
  ] },
  { kind: "list", title: "El panel de Equipo.", tones: [{ theme: "team" }], items: [
    { title: "Crew por departamentos." },
    { title: "Calendario de rodaje." },
    { title: "Nóminas, dietas y control horario." },
  ] },
  { kind: "list", title: "Cada persona, su rol.", tones: [{ theme: "both" }], items: [
    { title: "Proyecto", text: "EP, PM, Controller y PC." },
    { title: "Departamento", text: "Jefatura, coordinación y crew." },
  ] },
  { kind: "list", title: "Cada rol ve lo suyo.", items: [
    { title: "El proyecto ve todo." },
    { title: "Jefatura y coordinación ven su departamento." },
    { title: "El crew ve lo que crea." },
  ] },
  { kind: "ladder", title: "En Contabilidad, cuatro niveles de acceso.", tones: [{ theme: "accounting" }], items: [
    { title: "Visitante", text: "El panel." },
    { title: "Usuario", text: "Además, proveedores y POs." },
    { title: "Contabilidad", text: "Además, todas las facturas y los informes." },
    { title: "Ampliada", text: "Además, presupuesto y usuarios." },
  ] },
  { kind: "hero", title: "Nada se paga sin aprobar.", text: "Cada PO y cada factura siguen su circuito, por rol, por departamento o por importe.", tones: [{ theme: "accounting" }] },
  { kind: "list", title: "Y cuando lo necesites, más.", items: [
    { title: "Filma Sign", text: "Firma de contratos y documentos." },
    { title: "Budgeting", text: "Presupuestos antes de rodar." },
  ] },
  { kind: "end", title: "Tu proyecto de ejemplo está listo.", text: "«El último verano», con datos ficticios para probar sin miedo." },
];

const durationOf = (s: Slide) =>
  s.kind === "end" ? Infinity : s.kind === "hero" ? (s.text ? 4200 : 2600) : 2400 + s.items.length * (s.kind === "ladder" ? 1500 : STEP_MS + 400);

export default function DemoIntro({ name, onEnter, enterLabel = "Entrar", ready = true, error }: {
  name?: string;
  onEnter: () => void;
  enterLabel?: string;
  /** El proyecto ya está preparado (si no, el botón espera). */
  ready?: boolean;
  error?: string;
}) {
  const slides = slidesFor((name || "").trim().split(" ")[0]);
  const [i, setI] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(false);
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
      if (e.key === "Enter" && i === last && ready) enter();
      if (e.key === "Escape") go(last);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, go, ready]);

  const enter = () => { if (entering) return; setEntering(true); onEnter(); };
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
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Image src="/logo.svg" alt="Filma" width={96} height={19} className="h-auto w-[84px] opacity-90" priority />
        {i < last && (
          <button onClick={() => go(last)} className="rounded-md px-2.5 py-1 text-[13px] text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
            Saltar intro
          </button>
        )}
      </div>

      {/* Diapositiva */}
      <main className="relative z-10 flex h-full items-center justify-center px-6 sm:px-10" aria-live="polite">
        <div key={i} className={`w-full ${s.kind === "hero" || s.kind === "end" ? "max-w-5xl" : "max-w-3xl"} [text-wrap:balance] ${leaving ? "demo-out" : ""}`}>
          {s.kind === "hero" && (
            <div className="text-center">
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
                      <>
                        <p className="text-[24px] font-semibold sm:text-[30px]">{it.title}</p>
                        <p className="mt-1 text-[17px] text-white/70 sm:text-[19px]">{it.text}</p>
                      </>
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
                    style={{ marginLeft: `${k * 6}%`, animationDelay: `${700 + k * 1500}ms` }}>
                    <span className="w-6 text-[15px] tabular-nums text-white/50">{k + 1}</span>
                    <span className="text-[22px] font-semibold sm:text-[26px]">{it.title}</span>
                    <span className="text-[15px] text-white/70 sm:text-[17px]">{it.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {s.kind === "end" && (
            <div className="text-center">
              <h1 className="demo-in text-[36px] font-semibold leading-[1.1] tracking-tight sm:text-[56px]">{s.title}</h1>
              <p className="demo-in mx-auto mt-5 max-w-xl text-[18px] text-white/75 sm:text-[21px]" style={{ animationDelay: "700ms" }}>{s.text}</p>
              <div className="demo-in mt-10" style={{ animationDelay: "1300ms" }}>
                {error ? (
                  <p className="mx-auto max-w-md rounded-lg bg-white/10 px-4 py-3 text-[15px]">{error}</p>
                ) : (
                  <button onClick={enter} disabled={!ready || entering}
                    className="inline-flex h-12 min-w-[180px] items-center justify-center rounded-full bg-white px-8 text-[16px] font-semibold text-[#172544] transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-70">
                    {entering ? "Entrando…" : ready ? enterLabel : "Preparando tu proyecto…"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Progreso */}
      <nav aria-label="Diapositivas" className="absolute inset-x-0 bottom-6 z-10 flex justify-center gap-2">
        {slides.map((_, k) => (
          <button key={k} onClick={() => go(k)} aria-label={`Ir a la diapositiva ${k + 1}`} aria-current={k === i}
            className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-white" : "w-1.5 bg-white/35 hover:bg-white/60"}`} />
        ))}
      </nav>

      {entering && <div aria-hidden="true" className="demo-fade fixed inset-0 z-20 bg-white" />}
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
.demo-fade { opacity: 0; animation: demo-fade 500ms ease forwards; }
@keyframes demo-fade { to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .demo-glow { animation: none; }
  .demo-layer, .demo-glow { transition-duration: 1.2s !important; }
  .demo-in, .demo-out, .demo-step, .demo-fade { animation-duration: 1ms !important; filter: none !important; transform: none !important; }
}
`;
