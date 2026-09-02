import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

export type AuthCheckResult =
  | { ok: true; uid: string }
  | { ok: false; response: NextResponse };

/**
 * Verifies the Firebase ID token sent in the Authorization: Bearer header.
 * Use at the top of any API route that only logged-in Filma users should be able to call
 * (no role check — see requireAdmin for admin-only routes).
 */
export async function requireUser(req: NextRequest): Promise<AuthCheckResult> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    return { ok: true, uid: decoded.uid };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Token inválido" }, { status: 401 }) };
  }
}

/**
 * Like requireUser, but also accepts a request authenticated with the shared
 * CRON_SECRET (server-to-server calls from our own cron routes).
 */
export async function requireUserOrCronSecret(req: NextRequest): Promise<AuthCheckResult> {
  const authHeader = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return { ok: true, uid: "cron" };
  }
  return requireUser(req);
}
