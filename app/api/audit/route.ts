// ─── Enlace seguro para auditores ────────────────────────────────────────────
// Público (sin cuenta). Valida el enlace (existe, no revocado, no caducado y
// PIN si lo tiene), registra cada acceso y entrega los archivos del paquete
// congelado que se generó al crear el enlace. El auditor nunca toca la base de
// datos ni el almacenamiento directamente.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { db } from "@/lib/firebase-admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const bucket = () => getStorage().bucket(process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);

type Link = {
  projectId: string; projectName: string; projectCode?: string; auditorName: string; auditorCompany?: string; note?: string;
  expiresAt: Timestamp; revoked?: boolean; pinHash?: string | null; createdByName: string; createdAt?: Timestamp;
  files: { path: string; name: string; folder: string; number: string; type: string; status: string; size: number; sha256: string }[];
  ready?: boolean;
};

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!(await rateLimit(`audit:${ip}`, 120, 10 * 60 * 1000))) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  let body: { action?: string; token?: string; pin?: string; path?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Petición no válida" }, { status: 400 }); }
  const token = String(body.token || "");
  if (token.length < 20) return NextResponse.json({ error: "Enlace no válido" }, { status: 404 });

  const id = sha(token);
  const ref = db.collection("auditLinks").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Este enlace no existe" }, { status: 404 });
  const link = snap.data() as Link;
  if (link.revoked) return NextResponse.json({ error: "Este enlace se ha revocado" }, { status: 410 });
  if (!link.ready) return NextResponse.json({ error: "El paquete todavía se está preparando" }, { status: 409 });
  if (link.expiresAt.toMillis() < Date.now()) return NextResponse.json({ error: "Este enlace ha caducado" }, { status: 410 });

  const ua = (req.headers.get("user-agent") || "").slice(0, 200);
  const log = (type: string, extra: Record<string, unknown> = {}) =>
    ref.collection("access").add({ type, at: FieldValue.serverTimestamp(), ipHash: sha(`${id}:${ip}`).slice(0, 16), ua, ...extra }).catch(() => {});

  if (link.pinHash) {
    if (!(await rateLimit(`audit-pin:${id}:${ip}`, 10, 15 * 60 * 1000))) return NextResponse.json({ error: "Demasiados intentos de PIN. Espera 15 minutos." }, { status: 429 });
    if (!body.pin) return NextResponse.json({ needsPin: true, projectName: link.projectName, auditorName: link.auditorName }, { status: 401 });
    if (sha(`${id}:${String(body.pin).trim()}`) !== link.pinHash) { await log("pin_failed"); return NextResponse.json({ error: "PIN incorrecto", needsPin: true }, { status: 401 }); }
  }

  if (body.action === "file") {
    const f = link.files.find((x) => x.path === body.path);
    if (!f) return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
    const [bytes] = await bucket().file(`projects/${link.projectId}/audit/${id}/${f.path}`).download();
    await Promise.all([log("download", { path: f.path, number: f.number }), ref.update({ downloads: FieldValue.increment(1), lastAccessAt: FieldValue.serverTimestamp() })]);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": f.name.endsWith(".csv") ? "text/csv; charset=utf-8" : "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  }

  await Promise.all([log("open"), ref.update({ opens: FieldValue.increment(1), lastAccessAt: FieldValue.serverTimestamp() })]);
  return NextResponse.json({
    projectName: link.projectName, projectCode: link.projectCode || "", auditorName: link.auditorName, auditorCompany: link.auditorCompany || "",
    note: link.note || "", createdByName: link.createdByName, createdAt: link.createdAt?.toMillis() || null, expiresAt: link.expiresAt.toMillis(),
    files: link.files.map(({ path, name, folder, number, type, status, size, sha256 }) => ({ path, name, folder, number, type, status, size, sha256 })),
  }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
