// ─── Filma Sign por uso: qué se factura en un periodo ────────────────────────
// Solicitudes de una cuenta (y proyecto) que terminaron en el periodo:
// firmadas (fecha de la última firma) y caducadas o rechazadas (fecha de
// caducidad o del rechazo). Las canceladas y las aún vivas no cuentan; las ya
// facturadas en otra factura, tampoco.

import { collection, getDocs, query, where, type Firestore } from "firebase/firestore";
import type { SignRequest } from "./types";

export interface SignUsage { signed: { id: string; title: string; at: number }[]; expired: { id: string; title: string; at: number }[] }

const monthStart = (ym: string) => new Date(`${ym}-01T00:00:00`).getTime();
const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 1).getTime() - 1; };

export function classifySignUsage(rows: Pick<SignRequest, "id" | "title" | "status" | "completedAt" | "expiresAt" | "events">[], from: string, to: string, exclude: Set<string>, now = Date.now()): SignUsage {
  const a = monthStart(from), b = monthEnd(to);
  const inRange = (t?: number | null) => !!t && t >= a && t <= b;
  const out: SignUsage = { signed: [], expired: [] };
  for (const r of rows) {
    if (exclude.has(r.id)) continue;
    if (r.status === "completed" && inRange(r.completedAt)) out.signed.push({ id: r.id, title: r.title, at: r.completedAt! });
    else if (r.status === "declined") {
      const at = [...(r.events || [])].reverse().find((e) => e.type === "declined")?.at;
      if (inRange(at)) out.expired.push({ id: r.id, title: r.title, at: at! });
    } else if ((r.status === "pending" || r.status === "expired") && r.expiresAt < now && inRange(r.expiresAt)) {
      out.expired.push({ id: r.id, title: r.title, at: r.expiresAt });
    }
  }
  return out;
}

export async function loadSignUsage(db: Firestore, o: { producerId: string; projectId?: string | null; from: string; to: string; exclude: Set<string> }): Promise<SignUsage> {
  const snap = await getDocs(query(collection(db, "signRequests"), where("producerId", "==", o.producerId)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SignRequest)).filter((r) => !o.projectId || r.projectId === o.projectId);
  return classifySignUsage(rows, o.from, o.to, o.exclude);
}
