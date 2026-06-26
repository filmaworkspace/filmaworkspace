import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  const { email, code } = await req.json();

  if (!email || !code) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const snap = await adminDb.collection("emailVerifications").doc(email).get();

  if (!snap.exists) {
    return NextResponse.json({ error: "Código no encontrado o expirado" }, { status: 400 });
  }

  const { code: stored, expiresAt } = snap.data()!;

  if ((expiresAt as Timestamp).toMillis() < Date.now()) {
    await snap.ref.delete();
    return NextResponse.json({ error: "El código ha caducado" }, { status: 400 });
  }

  if (stored !== code) {
    return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
  }

  await snap.ref.delete();
  return NextResponse.json({ ok: true });
}
