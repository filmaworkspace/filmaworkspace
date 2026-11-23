import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { sendEmail } from "@/lib/emails/send";
import { adminDigestHtml, adminDigestText } from "@/lib/emails/admin-digest";
import { purgeProject } from "@/lib/server/deleteProject";

// ─────────────────────────────────────────────────────────────────────────────
// Cron diario del admin (programarlo una vez al día con CRON_SECRET, igual que
// el de horarios):
//   1. Vacía la papelera: borra los proyectos que llevan más de 30 días.
//   2. Manda el resumen diario a los admins (adminConfig/digest: enabled,
//      recipients = uids; por defecto, todos los admins).
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://filmaworkspace.com";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Papelera
  const purged: string[] = [];
  const old = await db.collection("projects").where("trashedAt", "<=", Timestamp.fromMillis(Date.now() - 30 * DAY)).get();
  for (const d of old.docs) {
    try { await purgeProject(d.id); purged.push(d.data().name || d.id); } catch (e) { console.error("[admin-digest] purge", d.id, (e as Error).message); }
  }

  // 1b. Demos: una semana después de caducar se borran el usuario y su proyecto de ejemplo.
  const demos = await db.collection("demoLinks").where("expiresAt", "<=", Timestamp.fromMillis(Date.now() - 7 * DAY)).get();
  for (const d of demos.docs) {
    const x = d.data();
    if (x.cleanedAt) continue;
    try {
      if (x.projectId) await purgeProject(x.projectId);
      if (x.uid) { await adminAuth.deleteUser(x.uid).catch(() => {}); await db.collection("users").doc(x.uid).delete().catch(() => {}); }
      await d.ref.update({ cleanedAt: Timestamp.now(), status: x.status === "revoked" ? "revoked" : "expired" });
    } catch (e) { console.error("[admin-digest] demo", d.id, (e as Error).message); }
  }

  // 2. Resumen
  const cfg = (await db.collection("adminConfig").doc("digest").get()).data() || {};
  if (cfg.enabled === false) return NextResponse.json({ ok: true, purged, sent: 0 });

  const since = Timestamp.fromMillis(Date.now() - DAY);
  const [newUsers, newProjects, chats, errors, mails, security, admins] = await Promise.all([
    db.collection("users").where("createdAt", ">=", since).get(),
    db.collection("projects").where("createdAt", ">=", since).get(),
    db.collection("supportChats").get(),
    db.collection("appErrors").where("resolved", "==", false).get(),
    db.collection("emailLog").where("createdAt", ">=", since).get(),
    db.collection("securityEvents").where("createdAt", ">=", since).get(),
    db.collection("users").where("role", "==", "admin").get(),
  ]);
  const open = chats.docs.filter((d) => (d.data().status || "open") === "open");
  const unassigned = open.filter((d) => !d.data().assignedTo).length;
  const failedMails = mails.docs.filter((d) => ["bounced", "failed", "complained"].includes(d.data().status)).length;
  const newErrors = errors.docs.filter((d) => (d.data().lastSeenAt?.toMillis?.() ?? 0) >= since.toMillis()).length;

  const attention: string[] = [];
  if (unassigned) attention.push(`${unassigned} ticket(s) de soporte sin asignar`);
  if (newErrors) attention.push(`${newErrors} error(es) de la app en las últimas 24 h`);
  if (failedMails) attention.push(`${failedMails} email(s) rebotado(s) o fallido(s)`);
  if (security.size) attention.push(`${security.size} evento(s) de seguridad`);
  if (purged.length) attention.push(`Papelera vaciada: ${purged.join(", ")}`);

  const rows: [string, string][] = [
    ["Usuarios nuevos", String(newUsers.size)],
    ["Proyectos nuevos", String(newProjects.size)],
    ["Tickets abiertos", String(open.length)],
    ["Emails enviados", String(mails.size)],
    ["Errores sin revisar", String(errors.size)],
  ];
  const date = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
  const data = { date: date.charAt(0).toUpperCase() + date.slice(1), rows, attention, url: `${BASE_URL}/admindashboard` };

  const wanted: string[] | null = Array.isArray(cfg.recipients) && cfg.recipients.length ? cfg.recipients : null;
  const to = admins.docs.filter((d) => !wanted || wanted.includes(d.id)).map((d) => d.data().email).filter(Boolean) as string[];
  let sent = 0;
  for (const email of to) {
    const { error } = await sendEmail({ to: [email], subject: `Filma Workspace | Resumen diario${attention.length ? ` · ${attention.length} pendientes` : ""}`, html: adminDigestHtml(data), text: adminDigestText(data), tags: [{ name: "type", value: "admin-digest" }] });
    if (!error) sent++;
  }
  return NextResponse.json({ ok: true, purged, sent });
}
