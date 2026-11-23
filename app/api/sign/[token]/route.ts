import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { actByToken, openByToken } from "@/lib/server/sign";

// Filma Sign (público, con el enlace personal):
//   GET  → el documento y su estado (apunta la apertura en la auditoría)
//   POST { action: "sign", signature, name, taxId, consent } | { action: "decline", reason }

export const maxDuration = 60;

const meta = (req: NextRequest) => ({
  ip: (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "",
  userAgent: req.headers.get("user-agent") || "",
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = meta(req);
  if (!(await rateLimit(`sign-open:${m.ip}`, 60, 60_000))) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
  const r = await openByToken(token, m);
  if (!r) return NextResponse.json({ error: "Enlace no válido" }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const m = meta(req);
  if (!(await rateLimit(`sign-act:${m.ip}`, 10, 60_000))) return NextResponse.json({ error: "Demasiados intentos. Espera un minuto." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  try {
    const r = b.action === "decline"
      ? await actByToken(token, { type: "decline", reason: String(b.reason || "").trim() || "Sin motivo" }, m)
      : await actByToken(token, { type: "sign", signature: { image: String(b.signature?.image || ""), method: b.signature?.method === "type" ? "type" : "draw", typedName: String(b.signature?.typedName || "") }, name: b.name, taxId: b.taxId, consent: b.consent === true }, m);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "No se pudo completar" }, { status: 400 });
  }
}
