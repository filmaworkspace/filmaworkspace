import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

const SESSION_DURATION_MS = 60 * 60 * 24 * 5 * 1000; // 5 days

export async function POST(req: NextRequest) {
  const { idToken } = await req.json();
  if (!idToken) {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  try {
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set("__filma_session", sessionCookie, {
      maxAge: SESSION_DURATION_MS / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Error al crear sesión" }, { status: 401 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("__filma_session", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
  });
  return res;
}
