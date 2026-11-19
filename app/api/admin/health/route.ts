import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";

// ─────────────────────────────────────────────────────────────────────────────
// Estado de los servicios para admindashboard → Sistema: Firestore, Auth,
// Resend, el cron de horarios y la configuración que falta.
// ─────────────────────────────────────────────────────────────────────────────

type Check = { id: string; label: string; ok: boolean | null; detail: string; ms?: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const t = Date.now();
  try { const value = await fn(); return { ms: Date.now() - t, value }; }
  catch (e) { return { ms: Date.now() - t, error: (e as Error).message }; }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const checks: Check[] = [];

  const fs = await timed(() => db.collection("meta").doc("maintenance").get());
  checks.push({ id: "firestore", label: "Base de datos (Firestore)", ok: !fs.error, detail: fs.error || `Responde en ${fs.ms} ms`, ms: fs.ms });

  const au = await timed(() => adminAuth.listUsers(1));
  checks.push({ id: "auth", label: "Cuentas (Firebase Auth)", ok: !au.error, detail: au.error || `Responde en ${au.ms} ms`, ms: au.ms });

  if (process.env.RESEND_API_KEY) {
    const rs = await timed(async () => {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { data?: { name: string; status: string }[] };
    });
    const domains = rs.value?.data || [];
    const verified = domains.filter((d) => d.status === "verified").map((d) => d.name);
    checks.push({
      id: "resend", label: "Envío de emails (Resend)", ok: !rs.error && (verified.length > 0 || domains.length === 0),
      detail: rs.error ? rs.error : verified.length ? `Dominio verificado: ${verified.join(", ")}` : domains.length ? `Dominio sin verificar: ${domains.map((d) => `${d.name} (${d.status})`).join(", ")}` : "Sin dominio propio (se envía desde resend.dev)",
      ms: rs.ms,
    });
  } else {
    checks.push({ id: "resend", label: "Envío de emails (Resend)", ok: false, detail: "Falta RESEND_API_KEY" });
  }

  const cron = await timed(() => db.collection("meta").doc("horarioCron").collection("runs").orderBy("runAt", "desc").limit(1).get());
  const last = cron.value?.docs[0]?.data();
  const lastAt = last?.runAt?.toDate?.() as Date | undefined;
  const hours = lastAt ? (Date.now() - lastAt.getTime()) / 3_600_000 : null;
  checks.push({
    id: "cron", label: "Envío automático de horarios (cron)",
    ok: cron.error ? false : hours === null ? null : hours < 26 && !(last?.errors || []).length,
    detail: cron.error || (lastAt ? `Última ejecución ${lastAt.toLocaleString("es-ES")}${(last?.errors || []).length ? ` · ${(last?.errors || []).length} errores` : ""}` : "Nunca se ha ejecutado"),
  });

  const missing = ["RESEND_FROM", "RESEND_WEBHOOK_SECRET", "CRON_SECRET", "NEXT_PUBLIC_BASE_URL"].filter((k) => !process.env[k]);
  checks.push({ id: "env", label: "Configuración", ok: missing.length === 0, detail: missing.length ? `Faltan: ${missing.join(", ")}` : "Completa" });

  return NextResponse.json({ checks, at: new Date().toISOString() });
}
