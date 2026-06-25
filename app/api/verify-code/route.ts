import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const snap = await adminDb.collection("emailVerifications").doc(email).get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Código no encontrado o expirado" }, { status: 400 });
  }

  const { code: stored, expiresAt, attempts = 0 } = snap.data()!;

  if ((expiresAt as Timestamp).toMillis() < Date.now()) {
    await snap.ref.delete();
    return NextResponse.json({ error: "El código ha caducado" }, { status: 400 });
  }

  if (attempts >= MAX_ATTEMPTS) {
    await snap.ref.delete();
    return NextResponse.json({ error: "Demasiados intentos. Solicita un código nuevo" }, { status: 429 });
  }

  if (stored !== code) {
    await snap.ref.update({ attempts: attempts + 1 });
    return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
  }

  await snap.ref.delete();
  return NextResponse.json({ ok: true });
}
