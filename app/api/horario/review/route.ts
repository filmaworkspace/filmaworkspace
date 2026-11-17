import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Datos de la página pública /timesheet-review/[code].
//
// Antes la página consultaba la colección horarioForms directamente desde el
// navegador sin sesión, lo que obligaba a dejar esa colección listable por
// cualquiera (todos los horarios de todos los proyectos). Ahora el servidor
// valida el código de acceso y devuelve solo los horarios de esa persona.
// ─────────────────────────────────────────────────────────────────────────────

function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !/^[a-zA-Z0-9]{1,64}$/.test(code)) {
    return NextResponse.json({ error: "Código no válido" }, { status: 400 });
  }

  if (!(await rateLimit(`horario-review:${clientIp(req)}`, 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });
  }

  try {
    const accessSnap = await db.collection("horarioAccess").doc(code).get();
    const access = accessSnap.data();
    if (!accessSnap.exists || !access?.active) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const formsSnap = await db
      .collection("horarioForms")
      .where("recipientUid", "==", access.recipientUid)
      .where("projectId", "==", access.projectId)
      .orderBy("date", "desc")
      .get();

    return NextResponse.json({
      access: {
        projectId: access.projectId,
        projectName: access.projectName,
        recipientUid: access.recipientUid,
        recipientName: access.recipientName,
        active: access.active,
      },
      forms: formsSnap.docs.map((d) => ({ id: d.id, ...(serialize(d.data()) as object) })),
    });
  } catch (err: any) {
    console.error("[horario/review]", err?.message);
    return NextResponse.json({ error: "Error al cargar los horarios" }, { status: 500 });
  }
}
