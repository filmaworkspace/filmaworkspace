import { NextRequest, NextResponse } from "next/server";
import { db as adminDb } from "@/lib/firebase-admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const { phone } = await req.json();
  if (!phone) return NextResponse.json({ error: "Falta el teléfono" }, { status: 400 });

  const allowed = await rateLimit(`check-phone:${clientIp(req)}`, 20, 10 * 60 * 1000);
  if (!allowed) return NextResponse.json({ error: "Demasiadas peticiones, inténtalo más tarde" }, { status: 429 });

  const snap = await adminDb.collection("users").where("phone", "==", phone).limit(1).get();
  return NextResponse.json({ exists: !snap.empty });
}
