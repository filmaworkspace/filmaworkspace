import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/require-auth";

// Valoración de una conversación de soporte ya cerrada (1–5 y comentario
// opcional). Solo la puede valorar su propio usuario, una vez.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const { score, comment, skip } = await req.json().catch(() => ({}));
  const userRef = db.collection("users").doc(auth.uid);
  const pending = (await userRef.get()).data()?.pendingSupportRating;
  if (!pending?.archiveId) return NextResponse.json({ ok: true });

  if (!skip) {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 1 || n > 5) return NextResponse.json({ error: "Valoración no válida" }, { status: 400 });
    const archiveRef = db.collection("supportArchive").doc(pending.archiveId);
    const archive = (await archiveRef.get()).data();
    if (archive && (archive.userId === auth.uid || archive.chatId === auth.uid) && !archive.rating) {
      await archiveRef.update({
        rating: n,
        ratingComment: typeof comment === "string" ? comment.trim().slice(0, 500) : "",
        ratedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  await userRef.update({ pendingSupportRating: FieldValue.delete() });
  return NextResponse.json({ ok: true });
}
