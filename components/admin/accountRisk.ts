import type { AdminProducer, AdminProject, ProjectStats } from "./AdminData";
import type { Tone } from "./ui";

export interface AccountActivity { now: number; prev: number; live: number; risk: { label: string; tone: Tone } }

/** Actividad de una cuenta (POs + facturas de sus proyectos, 30 d frente a los 30 anteriores) y riesgo de abandono. */
export function accountActivity(acc: AdminProducer, projects: AdminProject[], stats: Record<string, ProjectStats>): AccountActivity {
  const own = projects.filter((p) => p.producers.includes(acc.id) && !p.trashedAt);
  const live = own.filter((p) => p.phase !== "Finalizado").length;
  const now = own.reduce((s, p) => s + (stats[p.id]?.pos30 ?? 0) + (stats[p.id]?.invoices30 ?? 0), 0);
  const prev = own.reduce((s, p) => s + (stats[p.id]?.posPrev30 ?? 0) + (stats[p.id]?.invoicesPrev30 ?? 0), 0);
  let risk: AccountActivity["risk"];
  if (!own.length) risk = { label: "Sin proyectos", tone: "none" };
  else if (!live) risk = { label: "Sin proyectos en curso", tone: "none" };
  else if (now === 0 && prev === 0) risk = { label: "Sin actividad", tone: "bad" };
  else if (prev > 0 && now < prev * 0.5) risk = { label: "Bajando", tone: "warn" };
  else risk = { label: now > prev ? "Creciendo" : "Estable", tone: "ok" };
  return { now, prev, live, risk };
}
