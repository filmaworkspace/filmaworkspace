"use client";

// ─── ⌘K: buscador y acciones del panel de administración ─────────────────────
// Busca usuarios, proyectos y cuentas, y lanza acciones escribiendo
// ("mantenimiento", "nuevo aviso", "ver como ana"…). Ctrl/⌘ + K para abrir.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, BarChart3, Receipt, Briefcase, Building2, CornerDownLeft, Eye, HeadphonesIcon, Home, Mail, Megaphone, Plus, Search, Settings, Users, Wrench,
} from "lucide-react";
import { inter } from "@/lib/fonts";
import { useAdminData } from "./AdminData";

interface Item {
  id: string;
  group: "Acciones" | "Secciones" | "Usuarios" | "Proyectos" | "Cuentas";
  label: string;
  hint?: string;
  icon: React.ElementType;
  keywords?: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function useCommandPaletteHotkey(setOpen: (v: boolean | ((o: boolean) => boolean)) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

export default function CommandPalette({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const router = useRouter();
  const { users, projects, producers } = useAdminData();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const go = (href: string) => () => { onClose(); router.push(href); };

  const items = useMemo<Item[]>(() => {
    const sections: Item[] = [
      { id: "s-home", group: "Secciones", label: "Inicio", icon: Home, run: go("/admindashboard") },
      { id: "s-projects", group: "Secciones", label: "Proyectos", icon: Briefcase, run: go("/admindashboard/projects") },
      { id: "s-users", group: "Secciones", label: "Usuarios", icon: Users, run: go("/admindashboard/users") },
      { id: "s-accounts", group: "Secciones", label: "Cuentas", hint: "Productoras", icon: Building2, keywords: "productoras clientes", run: go("/admindashboard/accounts") },
      { id: "s-support", group: "Secciones", label: "Soporte", icon: HeadphonesIcon, keywords: "tickets chat", run: go("/admindashboard/support") },
      { id: "s-emails", group: "Secciones", label: "Emails", icon: Mail, keywords: "correos rebotes", run: go("/admindashboard/emails") },
      { id: "s-ann", group: "Secciones", label: "Avisos", icon: Megaphone, keywords: "comunicados novedades changelog banner", run: go("/admindashboard/announcements") },
      { id: "s-system", group: "Secciones", label: "Sistema", icon: Settings, keywords: "errores seguridad auditoria cron flags", run: go("/admindashboard/system") },
      { id: "s-metrics", group: "Secciones", label: "Métricas", icon: BarChart3, keywords: "embudo retencion cohortes", run: go("/admindashboard/metrics") },
    ];
    const actions: Item[] = [
      { id: "a-project", group: "Acciones", label: "Crear proyecto", icon: Plus, keywords: "nuevo proyecto", run: go("/admindashboard/projects?new=1") },
      { id: "a-account", group: "Acciones", label: "Crear cuenta (productora)", icon: Plus, keywords: "nueva productora", run: go("/admindashboard/accounts?new=1") },
      { id: "a-bill", group: "Acciones", label: "Facturación", hint: "Presupuestos y facturas", icon: Receipt, keywords: "facturas presupuestos cobros", run: go("/admindashboard/accounts/billing") },
      { id: "a-ann", group: "Acciones", label: "Publicar un aviso", icon: Megaphone, keywords: "nuevo aviso banner comunicado", run: go("/admindashboard/announcements?new=banner") },
      { id: "a-changelog", group: "Acciones", label: "Publicar novedades", icon: Megaphone, keywords: "changelog que hay de nuevo", run: go("/admindashboard/announcements?new=changelog") },
      { id: "a-mail", group: "Acciones", label: "Enviar un comunicado por email", icon: Mail, keywords: "difusion broadcast", run: go("/admindashboard/announcements?new=email") },
      { id: "a-maint", group: "Acciones", label: "Mantenimiento", hint: "Programar o desactivar", icon: Wrench, keywords: "modo mantenimiento", run: go("/admindashboard/system?tab=maintenance") },
      { id: "a-errors", group: "Acciones", label: "Ver errores de la app", icon: Activity, keywords: "fallos bugs", run: go("/admindashboard/system?tab=errors") },
    ];
    const userItems: Item[] = users.flatMap((u) => [
      { id: `u-${u.id}`, group: "Usuarios" as const, label: u.name, hint: u.email, icon: Users, keywords: `${u.email} ${u.phone || ""}`, run: go(`/admindashboard/users/${u.id}`) },
      ...(u.role === "user" ? [{ id: `uv-${u.id}`, group: "Acciones" as const, label: `Ver como ${u.name}`, hint: u.email, icon: Eye, keywords: `ver como ${u.email}`, run: go(`/admindashboard/users/${u.id}?impersonate=1`) }] : []),
    ]);
    const projectItems: Item[] = projects.map((p) => ({ id: `p-${p.id}`, group: "Proyectos", label: p.name, hint: `${p.id} · ${p.phase}`, icon: Briefcase, keywords: p.id, run: go(`/admindashboard/project/${p.id}`) }));
    const accountItems: Item[] = producers.map((p) => ({ id: `c-${p.id}`, group: "Cuentas", label: p.name, hint: p.plan, icon: Building2, run: go(`/admindashboard/accounts/${p.id}`) }));
    return isAdmin ? [...actions, ...sections, ...userItems, ...projectItems, ...accountItems] : sections.filter((s) => s.id === "s-support");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, projects, producers, isAdmin]);

  const results = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return items.filter((i) => i.group === "Acciones" && !i.id.startsWith("uv-") || i.group === "Secciones").slice(0, 14);
    const words = t.split(/\s+/);
    return items
      .map((i) => {
        const hay = norm(`${i.label} ${i.hint || ""} ${i.keywords || ""}`);
        if (!words.every((w) => hay.includes(w))) return null;
        const score = (norm(i.label).startsWith(t) ? 0 : 1) + (i.group === "Acciones" && i.id.startsWith("uv-") ? 1 : 0);
        return { i, score };
      })
      .filter(Boolean)
      .sort((a, b) => a!.score - b!.score)
      .slice(0, 30)
      .map((x) => x!.i);
  }, [q, items]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); results[sel]?.run(); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let lastGroup = "";
  return (
    <div className={`fixed inset-0 z-[95] flex items-start justify-center bg-slate-900/20 px-4 pt-[12vh] ${inter.className}`} onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4">
          <Search size={15} className="text-slate-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={isAdmin ? "Busca usuarios, proyectos, cuentas o escribe una acción…" : "Ir a…"}
            className="h-12 flex-1 bg-transparent text-[14px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 bg-[#F7F7F8] px-1.5 tabular-nums text-[10px] text-slate-400">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-slate-400">Sin resultados</p>}
          {results.map((r, idx) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const Icon = r.icon;
            return (
              <div key={r.id}>
                {header && <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-slate-400">{header}</p>}
                <button
                  data-idx={idx}
                  onMouseMove={() => setSel(idx)}
                  onClick={r.run}
                  className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] ${sel === idx ? "bg-[#F1F1F3] text-slate-900" : "text-slate-700"}`}
                >
                  <Icon size={14} className="flex-shrink-0 text-slate-400" />
                  <span className="truncate font-medium">{r.label}</span>
                  {r.hint && <span className="truncate text-xs text-slate-400">{r.hint}</span>}
                  {sel === idx && <CornerDownLeft size={12} className="ml-auto flex-shrink-0 text-slate-400" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <span><kbd className="tabular-nums">↑↓</kbd> moverse</span>
          <span><kbd className="tabular-nums">↵</kbd> abrir</span>
          <span className="ml-auto"><kbd className="tabular-nums">⌘K</kbd> / <kbd className="tabular-nums">Ctrl K</kbd></span>
        </div>
      </div>
    </div>
  );
}
