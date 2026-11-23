"use client";

// ─── Guía de la demo ─────────────────────────────────────────────────────────
// Solo para usuarios demo (creados desde un enlace del admin): un recorrido
// por el proyecto de ejemplo. Marca los pasos visitados, se puede plegar y
// cierra la sesión cuando la demo caduca.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { Check, ChevronDown, Compass, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { inter } from "@/lib/fonts";

const STEPS = [
  { path: "/accounting", exact: true, title: "Panel de contabilidad", hint: "Presupuesto, comprometido, realizado y lo que vence esta semana." },
  { path: "/accounting/budget", title: "Presupuesto", hint: "Cuentas y subcuentas con lo comprometido por las POs y lo realizado." },
  { path: "/accounting/pos", title: "Órdenes de compra", hint: "La PO-0005 espera tu aprobación." },
  { path: "/accounting/invoices", title: "Facturas", hint: "Aprueba la FAC-0005 y codifica la FAC-0006." },
  { path: "/accounting/payments", title: "Pagos", hint: "Prepara una remesa y descarga el fichero SEPA." },
  { path: "/team/crew", title: "Equipo", hint: "Crew por departamentos, fichas y formularios de alta." },
  { path: "/team/payroll", title: "Nóminas", hint: "Días trabajados, dietas y complementos del mes." },
];

export default function DemoGuide() {
  const { user } = useUser();
  const pathname = usePathname() || "";
  const router = useRouter();
  const demo = user?.demo;
  const key = demo ? `filma:demo:${user!.uid}` : "";
  const [seen, setSeen] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!key) return;
    try { const s = JSON.parse(localStorage.getItem(key) || "{}"); setSeen(s.seen || []); setOpen(s.open ?? true); } catch { /* sin almacenamiento */ }
  }, [key]);
  const persist = (next: { seen?: string[]; open?: boolean }) => {
    try { localStorage.setItem(key, JSON.stringify({ seen: next.seen ?? seen, open: next.open ?? open })); } catch { /* sin almacenamiento */ }
  };

  // Paso visitado
  const base = demo ? `/project/${demo.projectId}` : "";
  useEffect(() => {
    if (!demo || !pathname.startsWith(base)) return;
    const rest = pathname.slice(base.length);
    const step = STEPS.find((s) => (s.exact ? rest === s.path : rest.startsWith(s.path)));
    if (step && !seen.includes(step.path)) { const n = [...seen, step.path]; setSeen(n); persist({ seen: n }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, demo?.projectId]);

  // Caducada: fuera.
  useEffect(() => {
    if (demo?.expiresAt && demo.expiresAt.getTime() < Date.now()) signOut(auth).then(() => router.replace("/login"));
  }, [demo, router]);

  if (!demo || hidden || !pathname.startsWith("/project/")) return null;
  const done = STEPS.filter((s) => seen.includes(s.path)).length;
  const until = demo.expiresAt?.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  const toggle = () => { setOpen(!open); persist({ open: !open }); };

  return (
    <aside aria-label="Guía de la demo" className={`fixed bottom-24 right-6 z-40 w-80 rounded-lg border border-slate-200 bg-white shadow-lg print:hidden ${inter.className}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Compass size={15} className="text-slate-500" />
        <button onClick={toggle} aria-expanded={open} className="flex flex-1 items-center gap-2 text-left text-[13px] font-medium text-slate-900">
          Guía de la demo <span className="font-normal tabular-nums text-slate-500">{done}/{STEPS.length}</span>
          <ChevronDown size={14} className={`ml-auto text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button onClick={() => setHidden(true)} aria-label="Ocultar la guía" className="rounded p-0.5 text-slate-400 hover:text-slate-900"><X size={14} /></button>
      </div>
      <div className="mx-3 mb-2 h-[3px] overflow-hidden rounded-full bg-[#F1F1F3]"><div className="h-full bg-slate-800 transition-all" style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
      {open && (
        <>
          <ol className="border-t border-slate-100 py-1">
            {STEPS.map((s, i) => {
              const ok = seen.includes(s.path);
              const here = pathname === base + s.path || (!s.exact && pathname.startsWith(base + s.path));
              return (
                <li key={s.path}>
                  <Link href={base + s.path} className={`flex gap-2.5 px-3 py-1.5 hover:bg-[#F7F7F8] ${here ? "bg-[#F7F7F8]" : ""}`}>
                    <span className={`mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${ok ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-500"}`}>
                      {ok ? <Check size={10} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${here ? "font-medium text-slate-900" : "text-slate-800"}`}>{s.title}</span>
                      {here && <span className="block text-xs text-slate-500">{s.hint}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">Datos ficticios{until ? ` · disponible hasta el ${until}` : ""}</p>
        </>
      )}
    </aside>
  );
}
