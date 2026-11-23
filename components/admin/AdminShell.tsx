"use client";

// ─── Panel de administración: marco ──────────────────────────────────────────
// Menú lateral por secciones (plegable), barra superior con la ruta, estado de
// los servicios en vivo, recientes, atajos de teclado (g + letra, ?) y ⌘K.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import {
  Activity, AlertOctagon, ArrowLeft, FileSignature, BarChart3, BookOpen, Briefcase, Building2, ChevronsLeft, ChevronsRight, Clock, Database, Flag,
  HeadphonesIcon, Home, Keyboard, LayoutDashboard, Mail, Megaphone, Newspaper, Receipt, ScrollText, Search, ShieldAlert, Users, Wrench, X,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { inter } from "@/lib/fonts";
import { useUser } from "@/contexts/UserContext";
import { PageTopProvider } from "@/components/ds";
import { useAdminData } from "./AdminData";
import { adminFetch } from "./ui";

interface NavItem { href: string; label: string; icon: React.ElementType; key?: string; badge?: number; badgeTone?: "bad" | "warn" }
interface NavGroup { label: string; items: NavItem[] }

const LS_COLLAPSED = "admin:sidebar";
const LS_RECENT = "admin:recent";

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

/** ¿Este enlace es la página actual? (las pestañas de Sistema van por ?tab=) */
function isActive(href: string, pathname: string, tab: string | null) {
  const [path, qs] = href.split("?");
  if (path === "/admindashboard") return pathname === path;
  if (qs) {
    const want = new URLSearchParams(qs).get("tab");
    return pathname === path && (tab || "status") === want;
  }
  if (path === "/admindashboard/projects") return pathname.startsWith(path) || pathname.startsWith("/admindashboard/project/");
  if (path === "/admindashboard/accounts") return pathname.startsWith(path) && !pathname.startsWith("/admindashboard/accounts/billing");
  return pathname.startsWith(path);
}

type Health = { ok: boolean | null; ms?: number; detail: string; at: number };

export default function AdminShell({ children, isAdmin, onSearch }: { children: React.ReactNode; isAdmin: boolean; onSearch: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { user, maintenance } = useUser();
  const { unassignedTickets, openTickets, projects, users, producers } = useAdminData();
  const [collapsed, setCollapsed] = useState(false);
  const [errors, setErrors] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [recent, setRecent] = useState<{ href: string; label: string; kind: string }[]>([]);
  const [help, setHelp] = useState(false);
  const tab = params.get("tab");

  useEffect(() => { setCollapsed(read(LS_COLLAPSED, false)); setRecent(read(LS_RECENT, [])); }, []);
  const toggle = () => setCollapsed((c) => { write(LS_COLLAPSED, !c); return !c; });

  // Errores sin revisar y estado de los servicios (cada 60 s).
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    const tick = async () => {
      getCountFromServer(query(collection(db, "appErrors"), where("resolved", "==", false))).then((c) => alive && setErrors(c.data().count)).catch(() => {});
      const t = Date.now();
      try {
        const r = await adminFetch<{ checks: { id: string; ok: boolean | null; detail: string; ms?: number }[] }>("/api/admin/health", undefined, "GET");
        const bad = r.checks.filter((c) => c.ok === false);
        const fs = r.checks.find((c) => c.id === "firestore");
        if (alive) setHealth({ ok: bad.length === 0, ms: fs?.ms ?? Date.now() - t, detail: bad.length ? bad.map((c) => c.id).join(", ") : "Todo operativo", at: Date.now() });
      } catch { if (alive) setHealth({ ok: false, detail: "Sin respuesta", at: Date.now() }); }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [isAdmin]);

  // Recientes: proyectos, usuarios y cuentas abiertos.
  const entity = useMemo(() => {
    const m = pathname.match(/^\/admindashboard\/(project|users|accounts)\/([^/]+)$/);
    if (!m || m[2] === "billing") return null;
    const [, kind, id] = m;
    const label = kind === "project" ? projects.find((p) => p.id === id)?.name : kind === "users" ? users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.email : producers.find((p) => p.id === id)?.name;
    return label ? { href: pathname, label, kind } : null;
  }, [pathname, projects, users, producers]);
  useEffect(() => {
    if (!entity) return;
    setRecent((r) => { const next = [entity, ...r.filter((x) => x.href !== entity.href)].slice(0, 5); write(LS_RECENT, next); return next; });
  }, [entity]);

  const groups: NavGroup[] = isAdmin ? [
    { label: "General", items: [
      { href: "/admindashboard", label: "Inicio", icon: Home, key: "h" },
      { href: "/admindashboard/metrics", label: "Métricas", icon: BarChart3, key: "m" },
    ] },
    { label: "Plataforma", items: [
      { href: "/admindashboard/projects", label: "Proyectos", icon: Briefcase, key: "p", badge: projects.filter((p) => !p.trashedAt).length },
      { href: "/admindashboard/users", label: "Usuarios", icon: Users, key: "u", badge: users.length },
      { href: "/admindashboard/accounts", label: "Cuentas", icon: Building2, key: "c", badge: producers.length },
      { href: "/admindashboard/accounts/billing", label: "Facturación", icon: Receipt, key: "f" },
    ] },
    { label: "Comunicación", items: [
      { href: "/admindashboard/support", label: "Soporte", icon: HeadphonesIcon, key: "s", badge: unassignedTickets || openTickets, badgeTone: unassignedTickets ? "bad" : undefined },
      { href: "/admindashboard/guides", label: "Guías", icon: BookOpen, key: "g" },
      { href: "/admindashboard/emails", label: "Emails", icon: Mail, key: "e" },
      { href: "/admindashboard/announcements", label: "Avisos", icon: Megaphone, key: "a" },
      { href: "/admindashboard/sign", label: "Filma Sign", icon: FileSignature, key: "i" },
    ] },
    { label: "Operaciones", items: [
      { href: "/admindashboard/system?tab=status", label: "Estado", icon: Activity, key: "y" },
      { href: "/admindashboard/system?tab=errors", label: "Errores", icon: AlertOctagon, badge: errors, badgeTone: errors ? "warn" : undefined },
      { href: "/admindashboard/system?tab=security", label: "Seguridad", icon: ShieldAlert },
      { href: "/admindashboard/system?tab=audit", label: "Auditoría", icon: ScrollText },
      { href: "/admindashboard/system?tab=cron", label: "Cron", icon: Clock },
      { href: "/admindashboard/system?tab=flags", label: "Flags", icon: Flag },
      { href: "/admindashboard/system?tab=maintenance", label: "Mantenimiento", icon: Wrench, badge: maintenance.enabled ? 1 : 0, badgeTone: "warn" },
      { href: "/admindashboard/system?tab=digest", label: "Resumen diario", icon: Newspaper },
      { href: "/admindashboard/data", label: "Datos", icon: Database, key: "d" },
    ] },
  ] : [
    { label: "Soporte", items: [
      { href: "/admindashboard/support", label: "Soporte", icon: HeadphonesIcon, key: "s", badge: unassignedTickets || openTickets, badgeTone: unassignedTickets ? "bad" : undefined },
      { href: "/admindashboard/guides", label: "Guías", icon: BookOpen, key: "g" },
    ] },
  ];
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => isActive(i.href, pathname, tab));

  // Atajos: g + letra para ir a una sección, ? para la ayuda, [ para plegar.
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); return; }
      if (e.key === "Escape") { setHelp(false); return; }
      if (e.key === "[") { toggle(); return; }
      if (e.key === "/") { e.preventDefault(); onSearch(); return; }
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const it = all.find((i) => i.key === e.key.toLowerCase());
        if (it) { e.preventDefault(); router.push(it.href); }
        return;
      }
      if (e.key === "g") pendingG = Date.now();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.map((i) => i.href).join(), onSearch]);

  // Ruta de la barra superior: sección › elemento.
  const crumbs: { label: string; href?: string }[] = [];
  if (current) {
    const g = groups.find((x) => x.items.includes(current));
    if (g) crumbs.push({ label: g.label });
    crumbs.push({ label: current.label, href: current.href });
  }
  if (entity) crumbs.push({ label: entity.label });

  const healthTone = health === null ? "bg-slate-300" : health.ok ? "bg-emerald-500" : "bg-red-500";
  const W = collapsed ? "w-[60px]" : "w-[232px]";

  return (
    <div className={`flex min-h-screen bg-white ${inter.className}`}>
      {/* Menú lateral */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex ${W} flex-col border-r border-slate-200 bg-[#FAFAFA] transition-[width] duration-150 print:hidden`}>
        <div className={`flex h-12 flex-shrink-0 items-center border-b border-slate-200 ${collapsed ? "justify-center" : "justify-between px-4"}`}>
          {collapsed ? (
            <Link href="/admindashboard" aria-label="Inicio" className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-900 font-mono text-[11px] font-semibold text-white">F</Link>
          ) : (
            <Link href="/admindashboard" className="flex items-center gap-2">
              <Image src="/logodark.svg" alt="Filma Workspace" width={80} height={19} className="h-auto w-[80px]" />
              <span className="rounded border border-slate-300 px-1 py-px font-mono text-[9px] font-medium uppercase tracking-wider text-slate-500">admin</span>
            </Link>
          )}
        </div>

        <button onClick={onSearch} title="Buscar (⌘K)" className={`mx-2 mt-3 flex h-8 flex-shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white text-[12.5px] text-slate-400 hover:border-slate-300 hover:text-slate-700 ${collapsed ? "justify-center" : "px-2.5"}`}>
          <Search size={13} />
          {!collapsed && <><span className="flex-1 text-left">Buscar…</span><kbd className="font-mono text-[10px]">⌘K</kbd></>}
        </button>

        <nav className="mt-1 flex-1 overflow-y-auto px-2 pb-3" aria-label="Administración">
          {groups.map((g) => (
            <div key={g.label} className="mt-2.5">
              {!collapsed && <p className="mb-0.5 px-2 text-[10.5px] font-medium uppercase tracking-wider text-slate-400">{g.label}</p>}
              {collapsed && <div className="mx-2 mb-1 border-t border-slate-200" />}
              {g.items.map((it) => {
                const on = it === current;
                const Icon = it.icon;
                return (
                  <Link key={it.href} href={it.href} title={collapsed ? it.label : undefined}
                    className={`group relative flex h-7 items-center gap-2.5 rounded-md text-[13px] ${collapsed ? "justify-center" : "px-2"} ${on ? "bg-white font-medium text-slate-900 shadow-[0_0_0_1px_rgb(226,232,240)]" : "text-slate-600 hover:bg-[#F1F1F3] hover:text-slate-900"}`}>
                    <Icon size={15} className={on ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600"} />
                    {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
                    {!!it.badge && (collapsed
                      ? (it.badgeTone && <span className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${it.badgeTone === "bad" ? "bg-red-500" : "bg-amber-500"}`} />)
                      : <span className={`rounded px-1.5 text-[11px] tabular-nums ${it.badgeTone === "bad" ? "bg-red-100 text-red-700" : it.badgeTone === "warn" ? "bg-amber-100 text-amber-800" : "text-slate-400"}`}>{it.badge}</span>)}
                  </Link>
                );
              })}
            </div>
          ))}

          {!collapsed && recent.length > 0 && (
            <div className="mt-5">
              <p className="mb-1 px-2 text-[10.5px] font-medium uppercase tracking-wider text-slate-400">Recientes</p>
              {recent.map((r) => (
                <Link key={r.href} href={r.href} className={`flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] ${pathname === r.href ? "text-slate-900" : "text-slate-500 hover:bg-[#F1F1F3] hover:text-slate-900"}`}>
                  <span className="w-3 font-mono text-[10px] uppercase text-slate-400">{r.kind[0]}</span>
                  <span className="truncate">{r.label}</span>
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* Pie: estado, usuario, volver */}
        <div className="flex-shrink-0 border-t border-slate-200 p-2">
          {isAdmin && (
            <Link href="/admindashboard/system?tab=status" title={health ? `${health.detail}${health.ms ? ` · ${health.ms} ms` : ""}` : "Comprobando…"}
              className={`flex h-8 items-center gap-2 rounded-md text-[12px] text-slate-500 hover:bg-[#F1F1F3] ${collapsed ? "justify-center" : "px-2"}`}>
              <span className="relative flex h-2 w-2">
                {health?.ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${healthTone}`} />
              </span>
              {!collapsed && <span className="flex-1 truncate">{health === null ? "Comprobando…" : health.ok ? "Operativo" : `Incidencia: ${health.detail}`}</span>}
              {!collapsed && health?.ms !== undefined && <span className="font-mono text-[10.5px] text-slate-400">{health.ms} ms</span>}
            </Link>
          )}
          <Link href="/dashboard" title="Volver a Filma" className={`flex h-8 items-center gap-2 rounded-md text-[12.5px] text-slate-500 hover:bg-[#F1F1F3] hover:text-slate-900 ${collapsed ? "justify-center" : "px-2"}`}>
            <ArrowLeft size={14} />{!collapsed && <span>Volver a Filma</span>}
          </Link>
          <div className={`mt-1 flex items-center gap-2 ${collapsed ? "flex-col" : "px-2"}`}>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-slate-900">{user?.name || user?.email}</p>
                <p className="truncate text-[11px] text-slate-400">{isAdmin ? "Administrador" : "Soporte"}</p>
              </div>
            )}
            <button onClick={() => setHelp(true)} title="Atajos (?)" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#F1F1F3] hover:text-slate-700"><Keyboard size={14} /></button>
            <button onClick={toggle} title={collapsed ? "Expandir ( [ )" : "Plegar ( [ )"} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-[#F1F1F3] hover:text-slate-700">
              {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Contenido */}
      <div className={`min-w-0 flex-1 ${collapsed ? "pl-[60px]" : "pl-[232px]"} transition-[padding] duration-150`}>
        <div className="sticky top-0 z-30 flex h-12 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-6 backdrop-blur-md sm:px-10 print:hidden">
          <nav className="flex min-w-0 items-center gap-2 text-[12.5px]" aria-label="Ruta">
            <LayoutDashboard size={13} className="flex-shrink-0 text-slate-400" />
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-2">
                {i > 0 && <span className="text-slate-300">/</span>}
                {c.href && i < crumbs.length - 1 ? <Link href={c.href} className="truncate text-slate-500 hover:text-slate-900">{c.label}</Link>
                  : <span className={`truncate ${i === crumbs.length - 1 ? "font-medium text-slate-900" : "text-slate-500"}`}>{c.label}</span>}
              </span>
            ))}
          </nav>
          <div className="flex flex-shrink-0 items-center gap-3 text-[11.5px] text-slate-400">
            {maintenance.enabled && <Link href="/admindashboard/system?tab=maintenance" className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">Mantenimiento</Link>}
            <Clock24 />
          </div>
        </div>
        <PageTopProvider value="pt-8">{children}</PageTopProvider>
      </div>

      {help && <ShortcutsHelp items={all} onClose={() => setHelp(false)} />}
    </div>
  );
}

/** Hora local y UTC (útil para cruzar con registros del servidor). */
function Clock24() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(id); }, []);
  if (!now) return null;
  const hhmm = (d: Date, utc = false) => `${String(utc ? d.getUTCHours() : d.getHours()).padStart(2, "0")}:${String(utc ? d.getUTCMinutes() : d.getMinutes()).padStart(2, "0")}`;
  return <span className="font-mono tabular-nums" title="Hora local · UTC">{hhmm(now)} <span className="text-slate-300">·</span> {hhmm(now, true)} UTC</span>;
}

function ShortcutsHelp({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const rows: [string, string][] = [
    ["⌘K", "Buscar y acciones"], ["/", "Buscar"], ["?", "Esta ayuda"], ["[", "Plegar el menú"],
    ...items.filter((i) => i.key).map((i) => [`g ${i.key}`, i.label] as [string, string]),
  ];
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/20 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Atajos de teclado" className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[14px] font-semibold text-slate-900">Atajos de teclado</p>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
        </div>
        <dl className="grid grid-cols-[72px_1fr] gap-y-1.5 text-[13px]">
          {rows.map(([k, l]) => (
            <div key={k} className="contents">
              <dt><kbd className="rounded border border-slate-200 bg-[#FAFAFA] px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{k}</kbd></dt>
              <dd className="text-slate-600">{l}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
