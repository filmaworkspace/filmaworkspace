import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireSupportStaff } from "@/lib/require-admin";

// ─────────────────────────────────────────────────────────────────────────────
// Cerrar una conversación de soporte.
//
// La conversación (supportChats/{uid} y sus mensajes) se copia al archivo
// supportArchive/{id} y se borra del usuario: su chat vuelve a empezar de cero
// y ya no puede ver la conversación cerrada. El archivo solo lo pueden leer
// admins y agentes de soporte (ver firestore.rules).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireSupportStaff(req);
  if (!auth.ok) return auth.response;

  try {
    const { chatId } = await req.json();
    if (!chatId || typeof chatId !== "string") {
      return NextResponse.json({ error: "Falta chatId" }, { status: 400 });
    }

    const chatRef = db.collection("supportChats").doc(chatId);
    const [chatSnap, msgsSnap, closerSnap] = await Promise.all([
      chatRef.get(),
      // Sin orderBy: así no se pierde ningún mensaje aunque le falte createdAt.
      chatRef.collection("messages").get(),
      db.collection("users").doc(auth.uid).get(),
    ]);
    if (!chatSnap.exists) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const closer = closerSnap.data() || {};
    const archiveRef = db.collection("supportArchive").doc();

    // Archivo: metadatos + mensajes. Lotes de 400 para no pasar el límite de 500.
    const writes: Array<(b: FirebaseFirestore.WriteBatch) => void> = [
      (b) => b.set(archiveRef, {
        ...chatSnap.data(),
        chatId,
        status: "resolved",
        messageCount: msgsSnap.size,
        closedAt: FieldValue.serverTimestamp(),
        closedBy: auth.uid,
        closedByName: closer.name || closer.email || "Agente",
      }),
      ...msgsSnap.docs.map((m) => (b: FirebaseFirestore.WriteBatch) =>
        b.set(archiveRef.collection("messages").doc(m.id), m.data())),
    ];
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }

    // Solo se borra cuando el archivo ya está escrito.
    await db.recursiveDelete(chatRef);

    // Pide al usuario que valore la atención (lo enseña el chat de soporte).
    const chat = chatSnap.data() || {};
    if (chat.userId && (msgsSnap.size > 1)) {
      await db.collection("users").doc(chat.userId).set({
        pendingSupportRating: {
          archiveId: archiveRef.id,
          agentName: chat.assignedToName || closer.name || "Soporte",
          ticketNumber: chat.ticketNumber || null,
          at: FieldValue.serverTimestamp(),
        },
      }, { merge: true }).catch(() => {});
    }

    return NextResponse.json({ ok: true, archiveId: archiveRef.id });
  } catch (err: any) {
    console.error("[support/close]", err?.message);
    return NextResponse.json({ error: "No se pudo cerrar la conversación" }, { status: 500 });
  }
}
