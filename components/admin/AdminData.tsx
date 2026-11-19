"use client";

// ─── Datos compartidos del panel de administración ───────────────────────────
// Se cargan una vez en app/admindashboard/layout.tsx y los usan todas las
// secciones (Inicio, Proyectos, Usuarios, Cuentas, ⌘K…). En dos fases:
//   1. Lo básico (proyectos, miembros, usuarios, productoras, invitaciones).
//   2. La actividad de cada proyecto (recuentos y últimos movimientos), que
//      alimenta la salud de los proyectos, el riesgo de las cuentas y el
//      feed de actividad. Se refresca sola cada minuto.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  collection, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, Timestamp, where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";

const DAY = 86_400_000;

export interface AdminMember { uid: string; name: string; email: string; role?: string; position?: string; department?: string }
export interface AdminProject {
  id: string;
  name: string;
  phase: string;
  description: string;
  language?: string;
  producers: string[];
  createdAt: Timestamp | null;
  frozen: boolean;
  trashedAt: Timestamp | null;
  closingAt: Timestamp | null;
  members: AdminMember[];
}
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "admin" | "user" | "support_agent";
  supportSpecialty?: "sales" | "technical" | "both";
  isDemo: boolean;
  budgetingAccess: boolean;
  companyId: string | null;
  suspended: boolean;
  createdAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  activeMonths: string[];
  projectIds: string[];
}
export interface AdminProducer {
  id: string;
  name: string;
  createdAt: Timestamp | null;
  plan?: string;
  modules?: { accounting?: boolean; team?: boolean; budgeting?: boolean };
  maxProjects?: number | null;
  maxUsers?: number | null;
  renewalAt?: Timestamp | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  taxId?: string;
}
export interface AdminInvitation { id: string; email: string; projectId: string; createdAt: Timestamp | null }

export interface ProjectStats {
  pos: number; pos30: number; posPrev30: number;
  invoices: number; invoices30: number; invoicesPrev30: number;
  crew: number; horarioDays: number; suppliers: number;
  lastActivityAt: number | null;
  health: number;
}
export interface FeedItem {
  id: string;
  at: number;
  kind: "po" | "invoice" | "user" | "project" | "log" | "support";
  title: string;
  detail?: string;
  href?: string;
  projectId?: string;
}

interface AdminDataValue {
  loading: boolean;
  statsLoading: boolean;
  projects: AdminProject[];
  users: AdminUser[];
  producers: AdminProducer[];
  invitations: AdminInvitation[];
  stats: Record<string, ProjectStats>;
  feed: FeedItem[];
  openTickets: number;
  unassignedTickets: number;
  reload: () => Promise<void>;
  reloadStats: () => Promise<void>;
  projectById: (id: string) => AdminProject | undefined;
  userById: (id: string) => AdminUser | undefined;
  producerById: (id: string) => AdminProducer | undefined;
}

const Ctx = createContext<AdminDataValue | null>(null);

export function useAdminData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdminData fuera de AdminDataProvider");
  return v;
}

const ts = (v: unknown): Timestamp | null => (v && typeof (v as Timestamp).toMillis === "function" ? (v as Timestamp) : null);
const ms = (v: unknown) => ts(v)?.toMillis() ?? null;

/** Salud de 0 a 100: actividad reciente, uso de módulos y equipo. */
export function computeHealth(p: AdminProject, s: Omit<ProjectStats, "health">, staleInvites: number): number {
  if (p.phase === "Finalizado") return 100;
  let h = 0;
  const days = s.lastActivityAt ? (Date.now() - s.lastActivityAt) / DAY : Infinity;
  h += days < 7 ? 40 : days < 30 ? 25 : days < 60 ? 10 : 0;
  if (s.pos + s.invoices > 0) h += 15;
  if (s.crew > 0) h += 15;
  if (s.horarioDays > 0) h += 10;
  if (p.members.length >= 3) h += 10;
  if (staleInvites === 0) h += 10;
  return Math.min(100, h);
}

export function healthLabel(h: number | undefined, phase?: string): { label: string; tone: "ok" | "warn" | "bad" | "none" } {
  if (phase === "Finalizado") return { label: "Finalizado", tone: "none" };
  if (h === undefined) return { label: "—", tone: "none" };
  if (h >= 70) return { label: "Sano", tone: "ok" };
  if (h >= 40) return { label: "Atención", tone: "warn" };
  return { label: "En riesgo", tone: "bad" };
}

export const STALE_INVITE_DAYS = 14;
export const STALE_PROJECT_DAYS = 30;

export function AdminDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const isAdmin = user?.role === "admin";
  const isStaff = isAdmin || user?.role === "support_agent";

  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [producers, setProducers] = useState<AdminProducer[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  const [projectFeed, setProjectFeed] = useState<FeedItem[]>([]);
  const [openTickets, setOpenTickets] = useState(0);
  const [unassignedTickets, setUnassignedTickets] = useState(0);
  const projectsRef = useRef<AdminProject[]>([]);
  const invitationsRef = useRef<AdminInvitation[]>([]);

  const reload = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    try {
      const [prodSnap, projSnap, usersSnap, invSnap] = await Promise.all([
        getDocs(collection(db, "producers")),
        getDocs(collection(db, "projects")),
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "invitations"), where("status", "==", "pending"))),
      ]);
      const prods: AdminProducer[] = prodSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id, name: x.name || "Sin nombre", createdAt: ts(x.createdAt), plan: x.plan, modules: x.modules,
          maxProjects: x.maxProjects ?? null, maxUsers: x.maxUsers ?? null, renewalAt: ts(x.renewalAt),
          contactName: x.contactName, contactEmail: x.contactEmail, contactPhone: x.contactPhone, taxId: x.taxId,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      const projs: AdminProject[] = await Promise.all(projSnap.docs.map(async (d) => {
        const x = d.data();
        const mSnap = await getDocs(collection(db, `projects/${d.id}/members`)).catch(() => null);
        return {
          id: d.id, name: x.name || d.id, phase: x.phase || "Desarrollo", description: x.description || "",
          language: x.language, producers: x.producers || [], createdAt: ts(x.createdAt),
          frozen: !!x.frozen, trashedAt: ts(x.trashedAt), closingAt: ts(x.closingAt),
          members: (mSnap?.docs || []).map((m) => {
            const md = m.data();
            return { uid: m.id, name: md.name || md.email || m.id, email: md.email || "", role: md.role || undefined, position: md.position || undefined, department: md.department || undefined };
          }),
        };
      }));
      projs.sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));

      const memberships = new Map<string, string[]>();
      projs.forEach((p) => p.members.forEach((m) => memberships.set(m.uid, [...(memberships.get(m.uid) || []), p.id])));

      const us: AdminUser[] = usersSnap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id, name: x.name || x.email || d.id, email: x.email || "", phone: x.phone || "",
          role: x.role || "user", supportSpecialty: x.supportSpecialty || undefined, isDemo: !!x.isDemo,
          budgetingAccess: !!x.budgetingAccess, companyId: x.companyId || null, suspended: !!x.suspended,
          createdAt: ts(x.createdAt), lastSeenAt: ts(x.lastSeenAt), activeMonths: x.activeMonths || [],
          projectIds: memberships.get(d.id) || [],
        };
      }).sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));

      const invs: AdminInvitation[] = invSnap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, email: x.invitedEmail || x.email || "", projectId: x.projectId || "", createdAt: ts(x.createdAt) };
      });

      projectsRef.current = projs;
      invitationsRef.current = invs;
      setProducers(prods);
      setProjects(projs);
      setUsers(us);
      setInvitations(invs);
    } catch (e) {
      console.error("[admin] carga", e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  const reloadStats = useCallback(async () => {
    const projs = projectsRef.current;
    if (!projs.length) return;
    setStatsLoading(true);
    const now = Date.now();
    const d30 = Timestamp.fromMillis(now - 30 * DAY);
    const d60 = Timestamp.fromMillis(now - 60 * DAY);
    const count = async (q: ReturnType<typeof query>) => {
      try { return (await getCountFromServer(q)).data().count; } catch { return 0; }
    };
    const feed: FeedItem[] = [];
    const next: Record<string, ProjectStats> = {};
    await Promise.all(projs.map(async (p) => {
      const base = `projects/${p.id}`;
      const posC = collection(db, `${base}/pos`);
      const invC = collection(db, `${base}/invoices`);
      const [pos, pos30, pos60, invoices, inv30, inv60, crew, horarioDays, suppliers, lastPos, lastInv, lastLog] = await Promise.all([
        count(query(posC)),
        count(query(posC, where("createdAt", ">=", d30))),
        count(query(posC, where("createdAt", ">=", d60))),
        count(query(invC)),
        count(query(invC, where("createdAt", ">=", d30))),
        count(query(invC, where("createdAt", ">=", d60))),
        count(query(collection(db, `${base}/crew`))),
        count(query(collection(db, `${base}/horario`))),
        count(query(collection(db, `${base}/suppliers`))),
        getDocs(query(posC, orderBy("createdAt", "desc"), limit(5))).catch(() => null),
        getDocs(query(invC, orderBy("createdAt", "desc"), limit(5))).catch(() => null),
        getDocs(query(collection(db, `${base}/logs`), orderBy("createdAt", "desc"), limit(5))).catch(() => null),
      ]);
      lastPos?.docs.forEach((d) => {
        const x = d.data();
        const at = ms(x.createdAt);
        if (at) feed.push({ id: `po-${p.id}-${d.id}`, at, kind: "po", projectId: p.id, title: `PO-${x.number || "—"} · ${x.supplier || "Sin proveedor"}`, detail: x.createdByName ? `${x.createdByName} en ${p.name}` : p.name, href: `/admindashboard/project/${p.id}` });
      });
      lastInv?.docs.forEach((d) => {
        const x = d.data();
        const at = ms(x.createdAt);
        if (at) feed.push({ id: `inv-${p.id}-${d.id}`, at, kind: "invoice", projectId: p.id, title: `Factura ${x.number ? (String(x.number).includes("-") ? x.number : `FAC-${x.number}`) : ""} · ${x.supplier || "Sin proveedor"}`, detail: x.createdByName ? `${x.createdByName} en ${p.name}` : p.name, href: `/admindashboard/project/${p.id}` });
      });
      lastLog?.docs.forEach((d) => {
        const x = d.data();
        const at = ms(x.createdAt);
        if (at) feed.push({ id: `log-${p.id}-${d.id}`, at, kind: "log", projectId: p.id, title: x.message || x.description || x.type || "Actividad", detail: p.name, href: `/admindashboard/project/${p.id}` });
      });
      const lastActivityAt = Math.max(
        ms(lastPos?.docs[0]?.data().createdAt) ?? 0,
        ms(lastInv?.docs[0]?.data().createdAt) ?? 0,
        ms(lastLog?.docs[0]?.data().createdAt) ?? 0,
      ) || null;
      const staleInvites = invitationsRef.current.filter((i) => i.projectId === p.id && (ms(i.createdAt) ?? now) < now - STALE_INVITE_DAYS * DAY).length;
      const s = { pos, pos30, posPrev30: pos60 - pos30, invoices, invoices30: inv30, invoicesPrev30: inv60 - inv30, crew, horarioDays, suppliers, lastActivityAt };
      next[p.id] = { ...s, health: computeHealth(p, s, staleInvites) };
    }));
    setStats(next);
    setProjectFeed(feed);
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    if (!isAdmin) { setLoading(false); return; }
    reload().then(reloadStats);
    const t = setInterval(() => reloadStats(), 60_000);
    return () => clearInterval(t);
  }, [user?.uid, isAdmin, reload, reloadStats]);

  // Tickets de soporte (para el contador de la navegación y "Requiere atención")
  useEffect(() => {
    if (!isStaff) return;
    return onSnapshot(collection(db, "supportChats"), (snap) => {
      const open = snap.docs.filter((d) => (d.data().status || "open") === "open");
      setOpenTickets(open.length);
      setUnassignedTickets(open.filter((d) => !d.data().assignedTo).length);
    }, () => {});
  }, [isStaff]);

  const feed = useMemo(() => {
    const extra: FeedItem[] = [];
    users.forEach((u) => { const at = ms(u.createdAt); if (at) extra.push({ id: `u-${u.id}`, at, kind: "user", title: `${u.name} se ha registrado`, detail: u.email, href: `/admindashboard/users/${u.id}` }); });
    projects.forEach((p) => { const at = ms(p.createdAt); if (at) extra.push({ id: `p-${p.id}`, at, kind: "project", title: `Proyecto creado: ${p.name}`, detail: p.phase, href: `/admindashboard/project/${p.id}` }); });
    return [...projectFeed, ...extra].sort((a, b) => b.at - a.at).slice(0, 80);
  }, [projectFeed, users, projects]);

  const value = useMemo<AdminDataValue>(() => ({
    loading, statsLoading, projects, users, producers, invitations, stats, feed, openTickets, unassignedTickets,
    reload: async () => { await reload(); await reloadStats(); },
    reloadStats,
    projectById: (id) => projects.find((p) => p.id === id),
    userById: (id) => users.find((u) => u.id === id),
    producerById: (id) => producers.find((p) => p.id === id),
  }), [loading, statsLoading, projects, users, producers, invitations, stats, feed, openTickets, unassignedTickets, reload, reloadStats]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

