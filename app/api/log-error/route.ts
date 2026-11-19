import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "@/lib/firebase-admin";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Errores que ven los usuarios en el navegador (components/ErrorReporter).
// Se agrupan por huella (mensaje + primera línea de la pila): un mismo fallo
// es un solo documento con su contador, primera y última vez, y una muestra
// de usuarios y páginas. Se leen en admindashboard → Sistema → Errores.
// ─────────────────────────────────────────────────────────────────────────────

const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export async function POST(req: NextRequest) {
  if (!(await rateLimit(`log-error:${clientIp(req)}`, 30, 10 * 60 * 1000))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const message = clip(body.message, 500);
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });
  const stack = clip(body.stack, 4000);
  const url = clip(body.url, 300).replace(/[?#].*$/, "");

  let uid: string | null = null;
  let email: string | null = null;
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (m) {
    try { const t = await adminAuth.verifyIdToken(m[1]); uid = t.uid; email = t.email || null; } catch { /* anónimo */ }
  }

  const firstFrame = stack.split("\n").find((l) => l.trim().startsWith("at ")) || "";
  const fingerprint = createHash("sha1").update(message + "|" + firstFrame.replace(/:\d+:\d+\)?$/, "")).digest("hex").slice(0, 20);

  try {
    const ref = db.collection("appErrors").doc(fingerprint);
    await db.runTransaction(async (tx) => {
      const exists = (await tx.get(ref)).exists;
      tx.set(ref, {
        message,
        stack,
        count: FieldValue.increment(1),
        lastSeenAt: FieldValue.serverTimestamp(),
        ...(exists ? {} : { firstSeenAt: FieldValue.serverTimestamp() }),
        lastUrl: url,
        lastUserAgent: clip(req.headers.get("user-agent"), 200),
        lastUid: uid,
        lastEmail: email,
        urls: FieldValue.arrayUnion(url),
        ...(uid ? { uids: FieldValue.arrayUnion(uid) } : {}),
        resolved: false,
      }, { merge: true });
    });
  } catch (err) {
    console.error("[log-error]", (err as Error)?.message);
  }
  return NextResponse.json({ ok: true });
}
