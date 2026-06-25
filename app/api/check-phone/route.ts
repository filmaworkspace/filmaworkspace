import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebase-admin";

export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ error: "Falta el teléfono" }, { status: 400 });

  const snap = await adminDb.collection("users").where("phone", "==", phone).limit(1).get();
  return NextResponse.json({ exists: !snap.empty });
}
