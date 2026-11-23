"use client";

// ─── Guía de la demo ─────────────────────────────────────────────────────────
// Solo para usuarios demo (creados desde un enlace del admin). Recorre el
// proyecto de ejemplo con tareas que se marcan al hacerlas (aprobar, codificar,
// crear una PO…) y deja ver la demo con otro rol para comprobar lo que ve cada
// uno. Cierra la sesión cuando la demo caduca.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { Check, ChevronDown, Compass, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { inter } from "@/lib/fonts";
import { DEMO_ROLES, demoRoleOf, type DemoRoleKey } from "@/lib/demoRoles";

type Check = (ctx: { pid: string; uid: string; seen: string[] }) => Promise<boolean>;
interface Step { id: string; href: string; title: string; hint: string; done: Check }

const visited = (path: string, exact = false): Check => async ({ seen }) => seen.some((p) => (exact ? p === path : p.startsWith(path)));
const get = async (pid: string, col: string, id: string) => (await getDoc(doc(db, `projects/${pid}/${col}`, id)).catch(() => null))?.data();
const decided = (d?: Record<string, any>) => !!d && (!!d.approvedAt || d.status === "rejected" || d.approvalStatus === "rejected");

const STEPS: Step[] = [
  { id: "panel", href: "/accounting", title: "Panel de Contabilidad", hint: "El circuito de facturas, el presupuesto y lo que vence esta semana.", done: visited("/accounting", true) },
  { id: "po", href: "/accounting/approvals", title: "Aprueba la PO-0005", hint: "Está en Aprobaciones. También puedes aprobarla desde su ficha.", done: async ({ pid }) => { const d = await get(pid, "pos", "po5"); return !!d && d.status !== "pending"; } },
  { id: "inv", href: "/accounting/approvals", title: "Decide la FAC-0005 y la FAC-0006", hint: "Apruébalas o recházalas con un motivo.", done: async ({ pid }) => decided(await get(pid, "invoices", "inv5")) && decided(await get(pid, "invoices", "inv6")) },
  { id: "code", href: "/accounting/invoices/inv3", title: "Codifica la FAC-0003", hint: "Lee el documento, elige los datos propuestos y asigna la cuenta.", done: async ({ pid }) => !!(await get(pid, "invoices", "inv3"))?.codedAt },
  { id: "newpo", href: "/accounting/pos/new", title: "Crea una PO", hint: "Proveedor, cuenta e importe. Se envía a aprobación.", done: async ({ pid, uid }) => ((await getDocs(query(collection(db, `projects/${pid}/pos`), where("createdBy", "==", uid))).catch(() => null))?.size || 0) > 1 },
  { id: "budget", href: "/accounting/budget", title: "Mira el presupuesto", hint: "Comprometido y realizado por cuenta, al momento.", done: visited("/accounting/budget") },
  { id: "payments", href: "/accounting/payments", title: "Prepara un pago", hint: "Una remesa con las facturas aprobadas y su fichero SEPA.", done: visited("/accounting/payments") },
  { id: "team", href: "/team/crew", title: "Entra en Equipo", hint: "Crew por departamentos, fichas y formularios de alta.", done: visited("/team") },
  { id: "payroll", href: "/team/payroll", title: "Abre las nóminas", hint: "Días trabajados, dietas y complementos del mes.", done: visited("/team/payroll") },
];

export default function DemoGuide() {
  const { user } = useUser();
  const pathname = usePathname() || "";
  const router = useRouter();
  const demo = user?.demo;
  const key = demo ? `filma:demo:${user!.uid}` : "";
  const base = demo ? `/project/${demo.projectId}` : "";
  const [seen, setSeen] = useState<string[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [role, setRole] = useState<DemoRoleKey | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!key) return;
    try { const s = JSON.parse(localStorage.getItem(key) || "{}"); setSeen(s.seen || []); setOpen(s.open ?? true); } catch { /* sin almacenamiento */ }
  }, [key]);
  const persist = useCallback((next: { seen?: string[]; open?: boolean }) => {
    try { const s = JSON.parse(localStorage.getItem(key) || "{}"); localStorage.setItem(key, JSON.stringify({ ...s, ...next })); } catch { /* sin almacenamiento */ }
  }, [key]);

  // Rol actual en el proyecto de la demo
  useEffect(() => {
    if (!demo || !user) return;
    getDoc(doc(db, `projects/${demo.projectId}/members`, user.uid)).then((s) => setRole(demoRoleOf(s.data() as never))).catch(() => setRole("pm"));
  }, [demo, user]);

  // Páginas visitadas y tareas hechas (se recalcula al cambiar de pantalla)
  useEffect(() => {
    if (!demo || !user || !pathname.startsWith(base)) return;
    const rest = pathname.slice(base.length);
    const nextSeen = seen.includes(rest) ? seen : [...seen, rest];
    if (nextSeen !== seen) { setSeen(nextSeen); persist({ seen: nextSeen }); }
    let alive = true;
    Promise.all(STEPS.map((s) => s.done({ pid: demo.projectId, uid: user.uid, seen: nextSeen }).catch(() => false)))
      .then((r) => { if (alive) setDone(Object.fromEntries(STEPS.map((s, k) => [s.id, r[k]]))); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, demo?.projectId]);

  // Caducada: fuera.
  useEffect(() => {
    if (demo?.expiresAt && demo.expiresAt.getTime() < Date.now()) signOut(auth).then(() => router.replace("/login"));
  }, [demo, router]);

  const switchRole = async (r: DemoRoleKey) => {
    if (r === role || switching) return;
    setSwitching(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/demo/role", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ role: r }) });
      if (!res.ok) throw new Error();
      window.location.href = `${base}/accounting`;
    } catch { setSwitching(false); }
  };

  if (!demo || hidden || !pathname.startsWith("/project/")) return null;
  const count = STEPS.filter((s) => done[s.id]).length;
  const all = count === STEPS.length;
  const nextStep = STEPS.find((s) => !done[s.id]);
  const until = demo.expiresAt?.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  const toggle = () => { setOpen(!open); persist({ open: !open }); };

  return (
    <aside aria-label="Guía de la demo" className={`fixed bottom-24 right-6 z-40 w-[330px] rounded-lg border border-slate-200 bg-white shadow-lg print:hidden ${inter.className}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Compass size={15} className="text-slate-500" />
        <button onClick={toggle} aria-expanded={open} className="flex flex-1 items-center gap-2 text-left text-[13px] font-medium text-slate-900">
          Guía de la demo <span className="font-normal tabular-nums text-slate-500">{count}/{STEPS.length}</span>
          <ChevronDown size={14} className={`ml-auto text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button onClick={() => setHidden(true)} aria-label="Ocultar la guía" className="rounded p-0.5 text-slate-400 hover:text-slate-900"><X size={14} /></button>
      </div>
      <div className="mx-3 mb-2 h-[3px] overflow-hidden rounded-full bg-[#F1F1F3]"><div className="h-full bg-slate-800 transition-all" style={{ width: `${(count / STEPS.length) * 100}%` }} /></div>

      {open && (
        <>
          {/* Ver la demo como… */}
          <div className="border-t border-slate-100 px-3 py-2.5">
            <p className="mb-1.5 text-[11.5px] font-medium text-slate-500">Ver la demo como</p>
            <div className="grid grid-cols-4 gap-1 rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5" role="radiogroup" aria-label="Ver la demo como">
              {(Object.keys(DEMO_ROLES) as DemoRoleKey[]).map((r) => (
                <button key={r} role="radio" aria-checked={role === r} disabled={switching} onClick={() => switchRole(r)}
                  className={`truncate rounded-[5px] px-1 py-1 text-[11.5px] ${role === r ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}>
                  {DEMO_ROLES[r].label.replace(" de Arte", "")}
                </button>
              ))}
            </div>
            {role && <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">{switching ? "Cambiando de rol…" : `${DEMO_ROLES[role].label}. ${DEMO_ROLES[role].note}`}</p>}
          </div>

          {all ? (
            <div className="border-t border-slate-100 px-3 py-3">
              <p className="text-[13px] font-medium text-slate-900">Has visto lo esencial.</p>
              <p className="mt-0.5 text-xs text-slate-500">Puedes seguir probando con otros roles.</p>
              <div className="mt-2.5 flex gap-2">
                <Link href="/demo/intro" className="flex h-7 items-center rounded-md border border-slate-200 px-2.5 text-xs text-slate-700 hover:bg-[#F7F7F8]">Volver a ver la intro</Link>
                <button onClick={() => window.dispatchEvent(new Event("filma:open-support"))} className="flex h-7 items-center rounded-md border border-[#E4E4E7] bg-[#F1F1F3] px-2.5 text-xs font-medium text-slate-900 hover:bg-[#E8E8EB]">Hablar con nosotros</button>
              </div>
            </div>
          ) : (
            <ol className="border-t border-slate-100 py-1">
              {STEPS.map((s, k) => {
                const ok = !!done[s.id];
                const current = nextStep?.id === s.id;
                return (
                  <li key={s.id}>
                    <Link href={base + s.href} className={`flex gap-2.5 px-3 py-1.5 hover:bg-[#F7F7F8] ${current ? "bg-[#F7F7F8]" : ""}`}>
                      <span className={`mt-px flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] ${ok ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-500"}`}>
                        {ok ? <Check size={10} /> : k + 1}
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[13px] ${ok ? "text-slate-500 line-through decoration-slate-300" : current ? "font-medium text-slate-900" : "text-slate-800"}`}>{s.title}</span>
                        {current && <span className="block text-xs text-slate-500">{s.hint}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            <span>Datos ficticios{until ? ` · hasta el ${until}` : ""}</span>
            {!all && <Link href="/demo/intro" className="hover:text-slate-900">Ver la intro</Link>}
          </div>
        </>
      )}
    </aside>
  );
}
