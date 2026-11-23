// ─── Actividad (versión móvil) ───────────────────────────────────────────────
// Lo que ha pasado con lo tuyo, en orden: te llega algo que aprobar, te
// aprueban o te rechazan un documento, te invitan a un proyecto… Lo nuevo es
// lo posterior a la última vez que abriste Actividad (guardado en el
// dispositivo).

import type { MyPending } from "@/lib/myPending";

export type ActivityTone = "action" | "ok" | "bad" | "wait" | "info";
export interface ActivityItem {
  id: string;
  at: Date | null;
  tone: ActivityTone;
  title: string;
  detail: string;
  amount?: number;
  href: string;
}

const SEEN = (uid: string) => `filma-m:activity-seen:${uid}`;
export const activitySeen = (uid: string) => { try { return Number(localStorage.getItem(SEEN(uid))) || 0; } catch { return 0; } };
export const markActivitySeen = (uid: string) => { try { localStorage.setItem(SEEN(uid), String(Date.now())); } catch { /* sin almacenamiento */ } };

export function buildActivity(data: MyPending | null, invitations: { id: string; projectName: string; invitedByName?: string }[]): ActivityItem[] {
  if (!data) return [];
  const out: ActivityItem[] = [];
  for (const a of data.approvals) {
    out.push({
      id: `appr:${a.kind}:${a.id}`, at: a.createdAt, tone: "action",
      title: `Aprobar ${a.number}`, detail: [a.supplier, a.projectName, a.createdByName && `de ${a.createdByName}`].filter(Boolean).join(" · "),
      amount: a.base, href: `/m/aprobaciones/${a.projectId}/${a.kind}/${a.id}`,
    });
  }
  for (const d of data.myDocs) {
    const tone: ActivityTone = d.state === "approved" ? "ok" : d.state === "rejected" ? "bad" : d.state === "pending" ? "wait" : "info";
    const verb = d.state === "approved" ? "aprobada" : d.state === "rejected" ? "rechazada" : d.state === "pending" ? "en aprobación" : "sin enviar";
    out.push({
      id: `doc:${d.kind}:${d.id}:${d.state}`, at: d.updatedAt, tone,
      title: `${d.number} ${verb}`, detail: [d.supplier, d.detail, d.projectName].filter(Boolean).join(" · "),
      amount: d.base, href: `/m/aprobaciones/${d.projectId}/${d.kind}/${d.id}?back=/m/actividad`,
    });
  }
  for (const i of invitations) {
    out.push({ id: `inv:${i.id}`, at: null, tone: "info", title: `Invitación a ${i.projectName}`, detail: i.invitedByName ? `De ${i.invitedByName}` : "Acéptala en Inicio", href: "/m" });
  }
  // Las invitaciones (sin fecha) arriba; el resto, de lo más reciente a lo más antiguo.
  return out.sort((a, b) => (b.at ? b.at.getTime() : Infinity) - (a.at ? a.at.getTime() : Infinity));
}

/** Cuántas novedades hay desde la última visita (sin contar borradores). */
export function countNew(items: ActivityItem[], seen: number) {
  return items.filter((i) => i.tone !== "info" && i.at && i.at.getTime() > seen).length + items.filter((i) => i.id.startsWith("inv:") && seen === 0).length;
}

/** "Hoy", "Ayer", "Esta semana", "Antes". */
export function dayGroup(d: Date | null) {
  if (!d) return "Pendiente";
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const t = d.getTime();
  if (t >= start.getTime()) return "Hoy";
  if (t >= start.getTime() - 86_400_000) return "Ayer";
  if (t >= start.getTime() - 6 * 86_400_000) return "Esta semana";
  return "Antes";
}
