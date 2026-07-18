import { NextRequest, NextResponse } from "next/server";
import { adminAuth, db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
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
      role: "user",
      isDemo: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ uid: userRecord.uid });
  } catch (err: any) {
    console.error("[create-demo-user]", err?.code, err?.message);
    const msg =
      err?.code === "auth/email-already-exists"
        ? "Ese email demo ya existe"
        : err?.message || "Error al crear el usuario";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
