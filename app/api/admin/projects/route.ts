import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/require-admin";
import { logSecurityEvent } from "@/lib/server/securityLog";
import { auditFromServer } from "@/lib/server/audit";

// ─────────────────────────────────────────────────────────────────────────────
// Acciones de admin sobre un proyecto:
//   freeze / unfreeze — solo lectura para todos (producciones terminadas).
//   trash / restore   — papelera: congelado y fuera de las listas de sus
//                       miembros; se borra solo a los 30 días (cron
//                       admin-digest) o se restaura tal cual.
//   backup            — copia de seguridad en JSON (documentos, sin ficheros).
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE = new Set(["trash", "freeze"]);
const MAX_DOCS = 25_000;

type Json = unknown;
const plain = (v: unknown): Json => {
  if (v && typeof v === "object") {
    if (typeof (v as { toDate?: () => Date }).toDate === "function") return { __time: (v as { toDate: () => Date }).toDate().toISOString() };
    if (typeof (v as { path?: string; firestore?: unknown }).path === "string" && (v as { firestore?: unknown }).firestore) return { __ref: (v as { path: string }).path };
    if (Array.isArray(v)) return v.map(plain);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
};

async function dumpDoc(ref: FirebaseFirestore.DocumentReference, counter: { n: number }): Promise<Json> {
  const snap = await ref.get();
  counter.n++;
  const subs = await ref.listCollections();
  const children: Record<string, Json> = {};
  for (const c of subs) {
    if (counter.n > MAX_DOCS) break;
    const docs = await c.listDocuments();
    const out: Record<string, Json> = {};
    for (const d of docs) {
      if (counter.n > MAX_DOCS) break;
      out[d.id] = await dumpDoc(d, counter);
    }
    children[c.id] = out;
  }
  return { data: snap.exists ? plain(snap.data()) : null, ...(subs.length ? { collections: children } : {}) };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId, action } = body as { projectId?: string; action?: string };
  const admin = await requireAdmin(req, SENSITIVE.has(action || "") ? { recentAuthMinutes: 5 } : {});
  if (!admin.ok) return admin.response;
  if (!projectId || typeof projectId !== "string") return NextResponse.json({ error: "projectId requerido" }, { status: 400 });

  const ref = db.collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
  const p = snap.data() || {};
  const name = p.name || projectId;

  try {
    switch (action) {
      case "freeze":
      case "unfreeze": {
        const frozen = action === "freeze";
        if (!frozen && p.trashedAt) return NextResponse.json({ error: "Está en la papelera: restáuralo" }, { status: 400 });
        await ref.update({ frozen, frozenAt: frozen ? FieldValue.serverTimestamp() : null, frozenBy: frozen ? admin.uid : null, frozenReason: frozen ? String(body.reason || "").slice(0, 300) : null });
        if (frozen) await logSecurityEvent("project_frozen", { req, actorUid: admin.uid, target: projectId, details: name });
        await auditFromServer(admin.uid, frozen ? "project_frozen" : "project_unfrozen", `${name}${body.reason ? ` — ${body.reason}` : ""}`);
        return NextResponse.json({ ok: true });
      }

      case "trash": {
        if (p.trashedAt) return NextResponse.json({ error: "Ya está en la papelera" }, { status: 400 });
        const members = await ref.collection("members").listDocuments();
        const ups: Record<string, unknown> = {};
        for (const m of members) {
          const up = await db.collection("userProjects").doc(m.id).collection("projects").doc(projectId).get();
          if (up.exists) ups[m.id] = up.data();
        }
        const cps: Record<string, unknown> = {};
        for (const prod of (p.producers || []) as string[]) {
          const cp = await db.collection("companyProjects").doc(prod).collection("projects").doc(projectId).get();
          if (cp.exists) cps[prod] = cp.data();
        }
        await db.collection("adminTrash").doc(projectId).set({ userProjects: ups, companyProjects: cps, trashedAt: FieldValue.serverTimestamp(), trashedBy: admin.uid, name });
        const batch = db.batch();
        Object.keys(ups).forEach((uid) => batch.delete(db.collection("userProjects").doc(uid).collection("projects").doc(projectId)));
        Object.keys(cps).forEach((prod) => batch.delete(db.collection("companyProjects").doc(prod).collection("projects").doc(projectId)));
        batch.update(ref, { frozen: true, trashedAt: FieldValue.serverTimestamp(), trashedBy: admin.uid, trashedReason: String(body.reason || "").slice(0, 300) });
        await batch.commit();
        await logSecurityEvent("project_trashed", { req, actorUid: admin.uid, target: projectId, details: name });
        await auditFromServer(admin.uid, "project_trashed", `${name}${body.reason ? ` — ${body.reason}` : ""}`);
        return NextResponse.json({ ok: true });
      }

      case "restore": {
        const t = (await db.collection("adminTrash").doc(projectId).get()).data() || {};
        const batch = db.batch();
        Object.entries((t.userProjects || {}) as Record<string, FirebaseFirestore.DocumentData>).forEach(([uid, data]) => batch.set(db.collection("userProjects").doc(uid).collection("projects").doc(projectId), data));
        Object.entries((t.companyProjects || {}) as Record<string, FirebaseFirestore.DocumentData>).forEach(([prod, data]) => batch.set(db.collection("companyProjects").doc(prod).collection("projects").doc(projectId), data));
        batch.update(ref, { frozen: false, trashedAt: null, trashedBy: null, trashedReason: null });
        batch.delete(db.collection("adminTrash").doc(projectId));
        await batch.commit();
        await logSecurityEvent("project_restored", { req, actorUid: admin.uid, target: projectId, details: name });
        await auditFromServer(admin.uid, "project_restored", name);
        return NextResponse.json({ ok: true });
      }

      case "backup": {
        const counter = { n: 0 };
        const dump = await dumpDoc(ref, counter);
        await auditFromServer(admin.uid, "project_backup", `${name} (${counter.n} documentos)`);
        return NextResponse.json({
          backup: { format: "filma-project-backup/1", exportedAt: new Date().toISOString(), projectId, name, documents: counter.n, truncated: counter.n > MAX_DOCS, project: dump },
        });
      }

      default:
        return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }
  } catch (err) {
    console.error("[admin/projects]", action, (err as Error)?.message);
    return NextResponse.json({ error: (err as Error)?.message || "Error" }, { status: 500 });
  }
}
