import { NextRequest } from "next/server";
import { db } from "@/lib/firebase-admin";

/**
 * Simple fixed-window rate limiter backed by Firestore (works across
 * serverless instances, unlike an in-memory counter).
 * Returns true if the call is allowed, false if the caller is over the limit.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const ref = db.collection("_rateLimits").doc(key);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() as { windowStart: number; count: number } | undefined;

    if (!data || now - data.windowStart > windowMs) {
      tx.set(ref, { windowStart: now, count: 1 });
      return true;
    }

    if (data.count >= limit) return false;

    tx.update(ref, { count: data.count + 1 });
    return true;
  });
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
