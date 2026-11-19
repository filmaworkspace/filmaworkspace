import type { Timestamp } from "firebase/firestore";

// ─── Avisos dentro de la app y novedades ─────────────────────────────────────
// announcements/{id}. "banner": aviso con fecha de inicio/fin para todos o
// para un grupo (usuarios ya resueltos al crearlo). "changelog": novedades,
// se enseñan una vez a cada usuario. Se crean en admindashboard → Avisos.
export type AnnouncementKind = "banner" | "changelog";
export type AnnouncementLevel = "info" | "warning" | "success";

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  level: AnnouncementLevel;
  title: string;
  body: string;
  link?: { label: string; url: string } | null;
  active: boolean;
  audienceAll: boolean;
  audienceUserIds: string[];
  audienceLabel?: string;
  startsAt: Timestamp | null;
  endsAt: Timestamp | null;
  createdAt: Timestamp | null;
  createdByName?: string;
}

export function isLive(a: Pick<Announcement, "active" | "startsAt" | "endsAt">, now = Date.now()) {
  if (!a.active) return false;
  const s = a.startsAt?.toMillis?.() ?? 0;
  const e = a.endsAt?.toMillis?.() ?? Infinity;
  return now >= s && now < e;
}
