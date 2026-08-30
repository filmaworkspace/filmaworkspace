import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { requireUser } from "@/lib/require-auth";

// ─────────────────────────────────────────────────────────────────────────────
// Compartir un borrador de Budgeting con otro usuario de Filma Workspace: NO
// es un enlace en vivo, es una copia independiente completa (árbol de
// Capítulos → Cuentas → Detalle + Categorías/Globales/Fringes/Fases/
// Unidades/config de export), propiedad del destinatario desde que se crea.
// Los cambios posteriores en el original no se reflejan ahí, y viceversa.
//
// Se hace server-side con el SDK admin (no desde el cliente) porque las
// reglas de Firestore exigen `ownerUid == request.auth.uid` para crear un
// budgetingDrafts y para escribir en userBudgetingDrafts/{uid}: el
// remitente nunca podría crear directamente un documento a nombre de otro
// usuario, así que aquí es donde se hace esa excepción, ya validada a mano.
// ─────────────────────────────────────────────────────────────────────────────

async function commitInChunks(ops: { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }[]) {
  const CHUNK = 400; // margen sobre el límite de 500 operaciones por batch de Firestore
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = db.batch();
    for (const op of ops.slice(i, i + CHUNK)) batch.set(op.ref, op.data);
    await batch.commit();
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const sharerUid = auth.uid;

  try {
    const { draftId, targetUid } = await req.json();
    if (!draftId || !targetUid) {
      return NextResponse.json({ error: "Faltan draftId o targetUid" }, { status: 400 });
    }
    if (targetUid === sharerUid) {
      return NextResponse.json({ error: "No puedes compartir un presupuesto contigo mismo" }, { status: 400 });
    }

    const [sharerSnap, targetSnap, draftSnap] = await Promise.all([
      db.collection("users").doc(sharerUid).get(),
      db.collection("users").doc(targetUid).get(),
      db.collection("budgetingDrafts").doc(draftId).get(),
    ]);

    if (!sharerSnap.exists || !sharerSnap.data()?.budgetingAccess) {
      return NextResponse.json({ error: "No tienes acceso a Budgeting" }, { status: 403 });
    }
    if (!draftSnap.exists) {
      return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });
    }
    const draft = draftSnap.data()!;
    if (draft.ownerUid !== sharerUid) {
      return NextResponse.json({ error: "Solo el propietario puede compartir este presupuesto" }, { status: 403 });
    }
    if (!targetSnap.exists) {
      return NextResponse.json({ error: "Ese usuario no existe" }, { status: 404 });
    }
    const target = targetSnap.data()!;
    if (!target.budgetingAccess) {
      return NextResponse.json({ error: "Ese usuario no tiene acceso a Budgeting" }, { status: 400 });
    }

    // ── 1. Leer el árbol completo del borrador de origen ──────────────────
    const draftRef = db.collection("budgetingDrafts").doc(draftId);
    const accountsSnap = await draftRef.collection("accounts").get();
    const tree = await Promise.all(accountsSnap.docs.map(async (accDoc) => {
      const subSnap = await accDoc.ref.collection("subchapters").get();
      const subs = await Promise.all(subSnap.docs.map(async (subDoc) => {
        const linesSnap = await subDoc.ref.collection("detailLines").get();
        return { id: subDoc.id, data: subDoc.data(), lines: linesSnap.docs.map((l) => ({ id: l.id, data: l.data() })) };
      }));
      return { id: accDoc.id, data: accDoc.data(), subs };
    }));

    // ── 2. Crear la copia: propiedad del destinatario desde ya ────────────
    const now = Timestamp.now();
    const sharerName = sharerSnap.data()?.name || draft.ownerName || "Alguien";
    const newDraftRef = db.collection("budgetingDrafts").doc();
    await newDraftRef.set({
      name: draft.name,
      ownerUid: targetUid,
      ownerName: target.name || "",
      currency: draft.currency || "EUR",
      createdAt: now,
      updatedAt: now,
      // Copia nueva: no hereda el envío a proyecto del original, ni el
      // escenario que se estuviera previsualizando (estado de sesión, no
      // parte de la estructura del presupuesto).
      sentToProjectId: null,
      sentToProjectName: null,
      sentAt: null,
      activeScenarioId: null,
      categoriesEnabled: draft.categoriesEnabled ?? true,
      categories: draft.categories ?? [],
      globals: draft.globals ?? [],
      globalFolders: draft.globalFolders ?? [],
      fringes: draft.fringes ?? [],
      fringeFolders: draft.fringeFolders ?? [],
      units: draft.units ?? [],
      phases: draft.phases ?? [],
      scenarios: draft.scenarios ?? [],
      exportConfig: draft.exportConfig ?? null,
      detailColumnsConfig: draft.detailColumnsConfig ?? null,
      fringeVisibility: draft.fringeVisibility ?? null,
      projectInfo: draft.projectInfo ?? null,
      receivedFrom: { uid: sharerUid, name: sharerName },
      receivedAt: now,
    });

    const ops: { ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }[] = [];
    for (const acc of tree) {
      const accRef = newDraftRef.collection("accounts").doc();
      ops.push({ ref: accRef, data: acc.data });
      for (const sub of acc.subs) {
        const subRef = accRef.collection("subchapters").doc();
        ops.push({ ref: subRef, data: sub.data });
        for (const line of sub.lines) {
          // Las redirecciones "Sumar en" apuntan a IDs de Cuenta/Subcapítulo
          // del borrador original, que no existen en la copia: se limpian,
          // igual que ya hace handleDuplicateDraft al duplicar un borrador.
          const { routedTo, ...lineData } = line.data as Record<string, unknown>;
          ops.push({ ref: subRef.collection("detailLines").doc(), data: lineData });
        }
      }
    }
    await commitInChunks(ops);

    // ── 3. Índices: uno para que aparezca en "Compartido conmigo" del
    // destinatario, y una nota en el original de a quién se le ha enviado. ──
    await Promise.all([
      db.collection("userBudgetingDrafts").doc(targetUid).collection("drafts").doc(newDraftRef.id).set({
        name: draft.name,
        updatedAt: now,
        status: "draft",
        sentToProjectName: null,
        shared: true,
        sharedByName: sharerName,
      }),
      draftRef.update({
        sharedWith: [...(draft.sharedWith || []), { uid: targetUid, name: target.name || "", sharedAt: now }],
      }),
    ]);

    return NextResponse.json({ ok: true, draftId: newDraftRef.id });
  } catch (err: any) {
    console.error("[budgeting/share]", err?.code, err?.message);
    return NextResponse.json({ error: err?.message || "No se pudo compartir el presupuesto" }, { status: 500 });
  }
}
