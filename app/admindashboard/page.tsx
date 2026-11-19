"use client";

// ─── Admin · Inicio ──────────────────────────────────────────────────────────
// Qué requiere atención ahora (ordenado por urgencia), actividad reciente de
// toda la plataforma y el pulso: usuarios activos, documentos del mes, salud
// de los proyectos y altas por semana.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import { ArrowRight, Briefcase, FileText, Plus, Receipt, RefreshCw, ScrollText, UserPlus } from "lucide-react";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { IconButton, Page, PageHeader, PageLoading, buttonClass } from "@/components/ds";
import { FeedItem, healthLabel, STALE_INVITE_DAYS, useAdminData } from "@/components/admin/AdminData";
import { Bars, BlockTitle, Dot, Pills, RowBar, timeAgo, Tone } from "@/components/admin/ui";

interface Attention { id: string; tone: Tone; title: string; detail: string; href: string; weight: number }

const DAY = 86_400_000;
const KIND_ICON: Record<FeedItem["kind"], React.ElementType> = { po: FileText, invoice: Receipt, user: UserPlus, project: Briefcase, log: ScrollText, support: ScrollText };

export default function AdminHome() {
  const router = useRouter();
  const { user, maintenance } = useUser();
  const { loading, statsLoading, projects, users, producers, invitations, stats, feed, unassignedTickets, openTickets, reload } = useAdminData();
  const [ext, setExt] = useState({ errors: 0, bounced: 0, cronErrors: 0, security24: 0 });
  const [feedFilter, setFeedFilter] = useState<"all" | "docs" | "people">("all");

  useEffect(() => {
    (async () => {
      const since24 = Timestamp.fromMillis(Date.now() - DAY);
      const [errSnap, mailSnap, cronSnap, secSnap] = await Promise.all([
        getDocs(query(collection(db, "appErrors"), where("resolved", "==", false), limit(100))).catch(() => null),
        getDocs(query(collection(db, "emailLog"), where("status", "in", ["bounced", "failed", "complained"]), limit(100))).catch(() => null),
        getDocs(query(collection(db, "meta/horarioCron/runs"), orderBy("runAt", "desc"), limit(1))).catch(() => null),
        getDocs(query(collection(db, "securityEvents"), where("createdAt", ">=", since24), limit(100))).catch(() => null),
      ]);
      const weekAgo = Date.now() - 7 * DAY;
      setExt({
        errors: errSnap?.size || 0,
        bounced: (mailSnap?.docs || []).filter((d) => (d.data().createdAt?.toMillis?.() ?? 0) >= weekAgo).length,
        cronErrors: (cronSnap?.docs[0]?.data().errors || []).length,
        security24: secSnap?.size || 0,
      });
    })();
  }, []);

  const attention = useMemo<Attention[]>(() => {
    const out: Attention[] = [];
    const now = Date.now();
    if (unassignedTickets) out.push({ id: "tickets", tone: "bad", weight: 100, title: `${unassignedTickets} ticket${unassignedTickets > 1 ? "s" : ""} de soporte sin asignar`, detail: "Alguien está esperando respuesta", href: "/admindashboard/support" });
    if (maintenance.enabled) out.push({ id: "maint", tone: "warn", weight: 95, title: maintenance.startAt && maintenance.startAt.getTime() > now ? `Mantenimiento programado ${timeAgo(maintenance.startAt.getTime())}` : "Modo mantenimiento activo", detail: "Los usuarios no pueden entrar mientras esté activo", href: "/admindashboard/system?tab=maintenance" });
    if (ext.cronErrors) out.push({ id: "cron", tone: "bad", weight: 90, title: `El último envío automático de horarios tuvo ${ext.cronErrors} error${ext.cronErrors > 1 ? "es" : ""}`, detail: "Cron de control horario", href: "/admindashboard/system?tab=cron" });
    if (ext.errors) out.push({ id: "errors", tone: ext.errors > 5 ? "bad" : "warn", weight: 80, title: `${ext.errors} error${ext.errors > 1 ? "es" : ""} de la app sin revisar`, detail: "Fallos que han visto los usuarios en el navegador", href: "/admindashboard/system?tab=errors" });
    if (ext.bounced) out.push({ id: "mail", tone: "warn", weight: 75, title: `${ext.bounced} email${ext.bounced > 1 ? "s" : ""} rebotado${ext.bounced > 1 ? "s" : ""} o fallido${ext.bounced > 1 ? "s" : ""} esta semana`, detail: "Direcciones mal escritas o bloqueadas", href: "/admindashboard/emails?status=problems" });
    if (ext.security24) out.push({ id: "sec", tone: "warn", weight: 70, title: `${ext.security24} evento${ext.security24 > 1 ? "s" : ""} de seguridad en 24 h`, detail: "Bloqueos por límite, códigos fallidos, accesos…", href: "/admindashboard/system?tab=security" });
    const risky = projects.filter((p) => !p.trashedAt && p.phase !== "Finalizado" && stats[p.id] && stats[p.id].health < 40);
    if (risky.length) out.push({ id: "risky", tone: "bad", weight: 65, title: `${risky.length} proyecto${risky.length > 1 ? "s" : ""} en riesgo`, detail: risky.slice(0, 3).map((p) => p.name).join(", ") + (risky.length > 3 ? "…" : ""), href: "/admindashboard/projects?health=bad" });
    projects.filter((p) => p.closingAt).forEach((p) => out.push({ id: `close-${p.id}`, tone: "warn", weight: 60, title: `${p.name} se eliminará ${timeAgo(p.closingAt)}`, detail: "Cierre programado", href: `/admindashboard/project/${p.id}` }));
    const staleInv = invitations.filter((i) => (i.createdAt?.toMillis?.() ?? now) < now - STALE_INVITE_DAYS * DAY);
    if (staleInv.length) out.push({ id: "inv", tone: "warn", weight: 50, title: `${staleInv.length} invitación${staleInv.length > 1 ? "es" : ""} sin aceptar desde hace más de ${STALE_INVITE_DAYS} días`, detail: "Gente que se quedó fuera", href: "/admindashboard/users?tab=invites" });
    producers.filter((p) => p.renewalAt && p.renewalAt.toMillis() - now < 30 * DAY && p.renewalAt.toMillis() > now - 7 * DAY).forEach((p) =>
      out.push({ id: `ren-${p.id}`, tone: "info", weight: 45, title: `Renovación de ${p.name} ${timeAgo(p.renewalAt)}`, detail: p.plan ? `Plan ${p.plan}` : "Cuenta", href: `/admindashboard/accounts/${p.id}` }));
    const emptyAcc = producers.filter((p) => !users.some((u) => u.companyId === p.id));
    if (emptyAcc.length) out.push({ id: "empty", tone: "none", weight: 20, title: `${emptyAcc.length} cuenta${emptyAcc.length > 1 ? "s" : ""} sin usuarios`, detail: emptyAcc.slice(0, 3).map((p) => p.name).join(", "), href: "/admindashboard/accounts?filter=empty" });
    return out.sort((a, b) => b.weight - a.weight);
  }, [unassignedTickets, maintenance, ext, projects, stats, invitations, producers, users]);

  const pulse = useMemo(() => {
    const now = Date.now();
    const active7 = users.filter((u) => (u.lastSeenAt?.toMillis?.() ?? 0) > now - 7 * DAY).length;
    const active30 = users.filter((u) => (u.lastSeenAt?.toMillis?.() ?? 0) > now - 30 * DAY).length;
    const s = Object.values(stats);
    const docs30 = s.reduce((a, x) => a + x.pos30 + x.invoices30, 0);
    const docsPrev = s.reduce((a, x) => a + x.posPrev30 + x.invoicesPrev30, 0);
    const live = projects.filter((p) => !p.trashedAt && p.phase !== "Finalizado");
    const health = { ok: 0, warn: 0, bad: 0 };
    live.forEach((p) => { const t = healthLabel(stats[p.id]?.health, p.phase).tone; if (t === "ok" || t === "warn" || t === "bad") health[t]++; });
    // Altas por semana (12 semanas)
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const end = now - (11 - i) * 7 * DAY;
      return users.filter((u) => { const c = u.createdAt?.toMillis?.() ?? 0; return c > end - 7 * DAY && c <= end; }).length;
    });
    const weekLabels = Array.from({ length: 12 }, (_, i) => new Date(now - (11 - i) * 7 * DAY).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }));
    return { active7, active30, docs30, docsPrev, live: live.length, health, weeks, weekLabels };
  }, [users, stats, projects]);

  const shownFeed = feed.filter((f) => feedFilter === "all" || (feedFilter === "docs" ? f.kind === "po" || f.kind === "invoice" : f.kind === "user" || f.kind === "project" || f.kind === "log")).slice(0, 25);

  if (loading) return <PageLoading />;

  const delta = pulse.docsPrev ? Math.round(((pulse.docs30 - pulse.docsPrev) / pulse.docsPrev) * 100) : null;
  const first = (user?.name || "").split(" ")[0];

  return (
    <Page>
      <PageHeader
        title={<>Hola{first ? `, ${first}` : ""}</>}
        actions={
          <>
            <IconButton label="Actualizar" onClick={() => reload()}><RefreshCw size={15} className={statsLoading ? "animate-spin" : ""} /></IconButton>
            <Link href="/admindashboard/projects?new=1" className={buttonClass("primary")}><Plus size={14} /> Nuevo proyecto</Link>
          </>
        }
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <BlockTitle count={attention.length}>Requiere atención</BlockTitle>
          {attention.length === 0 ? (
            <div className="rounded-lg border border-slate-200 px-4 py-6 text-center text-[13px] text-slate-500">Todo en orden. No hay nada pendiente.</div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {attention.map((a) => (
                <Link key={a.id} href={a.href} className="group relative flex items-center gap-4 border-b border-slate-100 px-4 py-2.5 last:border-0 hover:bg-[#FAFAFA]">
                  <RowBar tone={a.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-slate-900">{a.title}</p>
                    <p className="truncate text-xs text-slate-500">{a.detail}</p>
                  </div>
                  <ArrowRight size={14} className="flex-shrink-0 text-slate-300 group-hover:text-slate-700" />
                </Link>
              ))}
            </div>
          )}

          <div className="mt-10">
            <BlockTitle action={<Pills value={feedFilter} onChange={setFeedFilter} label="Actividad" options={[{ value: "all", label: "Todo" }, { value: "docs", label: "POs y facturas" }, { value: "people", label: "Usuarios y proyectos" }]} />}>
              Actividad reciente <span className="ml-1 text-[11px] text-slate-400">se actualiza cada minuto</span>
            </BlockTitle>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {shownFeed.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-slate-400">{statsLoading ? "Cargando…" : "Sin actividad"}</p>}
              {shownFeed.map((f) => {
                const Icon = KIND_ICON[f.kind];
                return (
                  <div key={f.id} onClick={() => f.href && router.push(f.href)} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-0 hover:bg-[#FAFAFA]">
                    <Icon size={14} className="flex-shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-slate-900">{f.title}</p>
                      {f.detail && <p className="truncate text-xs text-slate-500">{f.detail}</p>}
                    </div>
                    <span className="flex-shrink-0 text-xs text-slate-400">{timeAgo(f.at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="min-w-0">
          <BlockTitle>Pulso</BlockTitle>
          <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-[13px]">
            {[
              ["Usuarios activos (7 d)", <span key="a">{pulse.active7} <span className="text-slate-400">/ {users.length}</span></span>, "/admindashboard/users?active=7"],
              ["Usuarios activos (30 d)", pulse.active30, "/admindashboard/users?active=30"],
              ["Proyectos en curso", pulse.live, "/admindashboard/projects"],
              ["POs y facturas (30 d)", <span key="d">{pulse.docs30}{delta !== null && <span className={`ml-1.5 text-xs ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>{delta >= 0 ? "+" : ""}{delta} %</span>}</span>, "/admindashboard/metrics"],
              ["Tickets abiertos", openTickets, "/admindashboard/support"],
              ["Cuentas", producers.length, "/admindashboard/accounts"],
            ].map(([label, value, href]) => (
              <Link key={String(label)} href={String(href)} className="flex items-center justify-between px-4 py-2.5 hover:bg-[#FAFAFA]">
                <dt className="text-slate-500">{label}</dt>
                <dd className="font-medium tabular-nums text-slate-900">{value as React.ReactNode}</dd>
              </Link>
            ))}
          </dl>

          <div className="mt-8">
            <BlockTitle action={<Link href="/admindashboard/projects" className="text-xs text-slate-500 hover:text-slate-900">Ver →</Link>}>Salud de los proyectos</BlockTitle>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              {(["ok", "warn", "bad"] as const).map((k) => pulse.live > 0 && (
                <span key={k} className={k === "ok" ? "bg-emerald-500" : k === "warn" ? "bg-amber-500" : "bg-red-500"} style={{ width: `${(pulse.health[k] / pulse.live) * 100}%` }} />
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <Link href="/admindashboard/projects?health=ok" className="flex items-center gap-1.5 hover:text-slate-900"><Dot tone="ok" /> Sanos {pulse.health.ok}</Link>
              <Link href="/admindashboard/projects?health=warn" className="flex items-center gap-1.5 hover:text-slate-900"><Dot tone="warn" /> Atención {pulse.health.warn}</Link>
              <Link href="/admindashboard/projects?health=bad" className="flex items-center gap-1.5 hover:text-slate-900"><Dot tone="bad" /> En riesgo {pulse.health.bad}</Link>
            </div>
          </div>

          <div className="mt-8">
            <BlockTitle action={<Link href="/admindashboard/metrics" className="text-xs text-slate-500 hover:text-slate-900">Métricas →</Link>}>Altas por semana</BlockTitle>
            <Bars data={pulse.weeks} labels={pulse.weekLabels} height={56} />
          </div>
        </aside>
      </div>
    </Page>
  );
}
