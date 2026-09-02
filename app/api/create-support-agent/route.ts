import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  try {
    const { name, email, password, specialty } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
    }
    if (!["sales", "technical", "both"].includes(specialty)) {
      return NextResponse.json({ error: "Especialidad no válida" }, { status: 400 });
    }

    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: name,
      emailVerified: true,
    });

    await db.collection("users").doc(userRecord.uid).set({
      name,
      email,
      phone: "",
      role: "support_agent",
      supportSpecialty: specialty,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ uid: userRecord.uid });
  } catch (err: any) {
    console.error("[create-support-agent]", err?.code, err?.message);
    const msg =
      err?.code === "auth/email-already-exists"
        ? "Ese email ya existe"
        : err?.message || "Error al crear el agente";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
