import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { resendLogged } from "@/lib/emails/send";
import { auditFromServer } from "@/lib/server/audit";

// Reenviar un email del registro (centro de emails del admin).
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  const { logId } = await req.json().catch(() => ({}));
  if (!logId || typeof logId !== "string") return NextResponse.json({ error: "logId requerido" }, { status: 400 });
  try {
    const { error } = await resendLogged(logId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await auditFromServer(admin.uid, "email_resent", logId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
