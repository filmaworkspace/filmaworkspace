// ─── Numeración correlativa de POs, facturas y crew ──────────────────────────
// Antes el siguiente número se calculaba leyendo toda la colección, pero las
// reglas ya no dejan a cada usuario leer las POs/facturas de los demás. El
// último número usado vive en projects/{id}/counters/{pos|invoices|crew} y se
// reserva en una transacción (sin duplicados aunque dos personas guarden a la vez).

import { collection, doc, getDocs, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CounterKind = "pos" | "invoices" | "crew";

// Campo que guarda el número en cada colección.
const NUMBER_FIELD: Record<CounterKind, string> = { pos: "number", invoices: "number", crew: "crewNumber" };

async function maxExisting(projectId: string, kind: CounterKind): Promise<number | null> {
  try {
    const snap = await getDocs(collection(db, `projects/${projectId}/${kind}`));
    let max = 0;
    snap.forEach((d) => { const n = parseInt(d.data()[NUMBER_FIELD[kind]] || "0", 10); if (n > max) max = n; });
    return max;
  } catch {
    return null; // sin permiso para leerlo todo
  }
}

/** Crea el contador si aún no existe (solo puede quien ve toda la colección). */
export async function ensureCounter(projectId: string, kind: CounterKind) {
  const ref = doc(db, `projects/${projectId}/counters`, kind);
  const max = await maxExisting(projectId, kind);
  if (max === null) return;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) tx.set(ref, { last: max });
      else if ((snap.data().last || 0) < max) tx.update(ref, { last: max });
    });
  } catch { /* sin permiso: lo creará quien lo tenga */ }
}

/** Reserva y devuelve el siguiente número ("0007"). */
export async function nextDocNumber(projectId: string, kind: CounterKind): Promise<string> {
  const ref = doc(db, `projects/${projectId}/counters`, kind);
  const exists = await runTransaction(db, async (tx) => (await tx.get(ref)).exists());
  if (!exists) await ensureCounter(projectId, kind);
  const n = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const last = snap.exists() ? Number(snap.data().last) || 0 : 0;
    if (snap.exists()) tx.update(ref, { last: last + 1 });
    else tx.set(ref, { last: last + 1 });
    return last + 1;
  });
  return String(n).padStart(4, "0");
}
