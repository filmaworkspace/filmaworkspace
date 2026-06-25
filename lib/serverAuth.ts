import { adminAuth } from "@/lib/firebase-admin";
import { NextRequest, NextResponse } from "next/server";

export async function verifyRequestAuth(
  req: NextRequest
): Promise<{ uid: string } | NextResponse> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return { uid: decoded.uid };
  } catch {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }
}
