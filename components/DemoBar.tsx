"use client";

// ─── Demo: etiqueta discreta ─────────────────────────────────────────────────
// Solo para usuarios demo. Sin guía: la demo es libre. Una etiqueta abajo a la
// derecha indica el perfil y permite cambiarlo, volver a ver la intro o hablar
// con nosotros. Cierra la sesión cuando la demo caduca.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Check, ChevronUp } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { inter } from "@/lib/fonts";
import { DEMO_ROLES, DEMO_ROLE_ORDER, demoRoleOf, type DemoRoleKey } from "@/lib/demoRoles";
import { setDemoRole } from "@/lib/demoClient";

export default function DemoBar() {
  const { user } = useUser();
  const pathname = usePathname() || "";
  const router = useRouter();
  const demo = user?.demo;
  const [role, setRole] = useState<DemoRoleKey | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<DemoRoleKey | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!demo || !user) return;
    getDoc(doc(db, `projects/${demo.projectId}/members`, user.uid)).then((s) => setRole(demoRoleOf(s.data() as never))).catch(() => setRole("pm"));
  }, [demo, user]);

  useEffect(() => {
    if (demo?.expiresAt && demo.expiresAt.getTime() < Date.now()) signOut(auth).then(() => router.replace("/login"));
  }, [demo, router]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!demo || !(pathname.startsWith("/project/") || pathname === "/dashboard")) return null;

  const change = async (r: DemoRoleKey) => {
    if (r === role || switching) return;
    setSwitching(r);
    try { await setDemoRole(r); window.location.href = `/project/${demo.projectId}`; } catch { setSwitching(null); }
  };
  const until = demo.expiresAt?.toLocaleDateString("es-ES", { day: "numeric", month: "long" });

  return (
    <div ref={box} className={`fixed bottom-6 right-24 z-40 print:hidden ${inter.className}`}>
      {open && (
        <div className="absolute bottom-11 right-0 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg" role="menu">
          <p className="px-3 pb-1 pt-2.5 text-[11.5px] font-medium text-slate-500">Ver la demo como</p>
          {DEMO_ROLE_ORDER.map((r) => (
            <button key={r} role="menuitemradio" aria-checked={role === r} onClick={() => change(r)} disabled={!!switching}
              className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left hover:bg-[#F7F7F8]">
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">{role === r && <Check size={14} className="text-slate-900" />}</span>
              <span className="min-w-0">
                <span className="block text-[13px] text-slate-900">{switching === r ? "Cambiando…" : DEMO_ROLES[r].label}</span>
                <span className="block text-xs text-slate-500">{DEMO_ROLES[r].note}</span>
              </span>
            </button>
          ))}
          <div className="mt-1 border-t border-slate-100 py-1">
            <Link href="/demo/intro" className="block px-3 py-1.5 text-[13px] text-slate-700 hover:bg-[#F7F7F8]">Volver a ver la intro</Link>
            <button onClick={() => { setOpen(false); window.dispatchEvent(new Event("filma:open-support")); }} className="block w-full px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-[#F7F7F8]">Hablar con nosotros</button>
          </div>
          <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">Datos ficticios{until ? ` · hasta el ${until}` : ""}</p>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"
        className="flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-2.5 text-[12.5px] text-slate-700 shadow-sm hover:border-slate-300 hover:text-slate-900">
        <span className="h-1.5 w-1.5 rounded-full bg-[#2F52E0]" />
        Demo{role ? <span className="text-slate-500">· {DEMO_ROLES[role].label}</span> : null}
        <ChevronUp size={13} className={`text-slate-400 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
    </div>
  );
}
