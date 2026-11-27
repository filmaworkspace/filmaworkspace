// ─── Verificación pública de una acreditación (QR) ───────────────────────────
// Comprueba en el momento si la acreditación vale: no revocada, la persona
// sigue de alta y está dentro de sus fechas. Devuelve lo justo para
// identificarla (foto, nombre, puesto, proyecto) y apunta el escaneo.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!(await rateLimit(`accr:${ip}`, 60, 10 * 60 * 1000))) return NextResponse.json({ error: "Demasiadas consultas" }, { status: 429 });
  const { token } = await req.json().catch(() => ({ token: "" }));
  if (!token || String(token).length < 16) return NextResponse.json({ valid: false, reason: "QR no válido" }, { status: 404 });
  const id = sha(String(token));
  const ref = db.collection("accreditations").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ valid: false, reason: "Esta acreditación no existe" }, { status: 404 });
  const a = snap.data()!;
  const [crewSnap, projSnap] = await Promise.all([
    db.doc(`projects/${a.projectId}/crew/${a.crewId}`).get(),
    db.doc(`projects/${a.projectId}`).get(),
  ]);
  const c = crewSnap.data() || {};
  const p = projSnap.data() || {};
  const name = (c.artisticName && String(c.artisticName).trim()) || [c.firstName, c.lastName1, c.lastName2].filter(Boolean).join(" ") || "—";
  const start = String(c.startDate || "").slice(0, 10), end = String(c.endDateApprox || c.endDate || "").slice(0, 10);
  const t = today();
  let reason = "";
  if (a.revoked) reason = "Acreditación anulada";
  else if (!crewSnap.exists || c.status === "inactive") reason = "Ya no forma parte del equipo";
  else if (c.accreditation?.id && c.accreditation.id !== id) reason = "Acreditación sustituida por otra";
  else if (start && t < start) reason = `Válida a partir del ${start.split("-").reverse().join("/")}`;
  else if (end && t > end) reason = "Fuera de fechas";
  else if (p.archived) reason = "El proyecto ha terminado";
  await Promise.all([
    ref.update({ scans: FieldValue.increment(1), lastScanAt: FieldValue.serverTimestamp() }).catch(() => {}),
    ref.collection("scans").add({ at: FieldValue.serverTimestamp(), valid: !reason, ipHash: sha(`${id}:${ip}`).slice(0, 16) }).catch(() => {}),
  ]);
  return NextResponse.json({
    valid: !reason, reason, name, role: c.role || "", department: c.department || "",
    crewNumber: c.crewNumber || "", photoUrl: c.documents?.photoAccreditation || c.photoUrl || null,
    projectName: p.name || "", start, end,
  }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
