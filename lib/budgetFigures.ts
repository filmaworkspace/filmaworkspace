// ─── Cifras de presupuesto (protegidas) ──────────────────────────────────────
// El importe presupuestado de cada subcuenta NO se guarda en la subcuenta (que
// leen todos los usuarios de contabilidad para codificar POs y facturas), sino
// en una colección aparte que solo pueden leer contabilidad avanzada, EP y PM:
//
//   projects/{id}/budgetLines/{subAccountId}  { budgeted, accountId, code }
//
// Las subcuentas antiguas aún pueden tener el campo `budgeted`; quien tiene
// permiso lo traslada con migrateBudgetFigures() la primera vez que entra.

import {
  collection, deleteField, doc, getDocs, writeBatch, type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export const budgetLinesPath = (projectId: string) => `projects/${projectId}/budgetLines`;

/** Presupuestado por id de subcuenta. Sin permiso devuelve un mapa vacío. */
export async function loadBudgetFigures(projectId: string): Promise<Record<string, number>> {
  try {
    const snap = await getDocs(collection(db, budgetLinesPath(projectId)));
    const out: Record<string, number> = {};
    snap.forEach((d) => { out[d.id] = Number(d.data().budgeted) || 0; });
    return out;
  } catch {
    return {};
  }
}

/** Escribe (en un batch) el presupuestado de una subcuenta. */
export function setBudgetFigure(
  batch: WriteBatch, projectId: string, subAccountId: string,
  data: { budgeted: number; accountId: string; code?: string },
) {
  batch.set(doc(db, budgetLinesPath(projectId), subAccountId), {
    budgeted: Math.round((Number(data.budgeted) || 0) * 100) / 100,
    accountId: data.accountId,
    code: data.code || "",
  }, { merge: true });
}

export async function saveBudgetFigure(
  projectId: string, subAccountId: string,
  data: { budgeted: number; accountId: string; code?: string },
) {
  const batch = writeBatch(db);
  setBudgetFigure(batch, projectId, subAccountId, data);
  await batch.commit();
}

export function deleteBudgetFigure(batch: WriteBatch, projectId: string, subAccountId: string) {
  batch.delete(doc(db, budgetLinesPath(projectId), subAccountId));
}

/**
 * Traslada a budgetLines el `budgeted` que aún quede en subcuentas antiguas y
 * lo borra de la subcuenta. Solo funciona para quien puede escribir
 * presupuesto; para el resto no hace nada. Devuelve cuántas ha movido.
 */
const migrated = new Set<string>();

export async function migrateBudgetFigures(projectId: string): Promise<number> {
  if (migrated.has(projectId)) return 0;
  migrated.add(projectId);
  try {
    const accounts = await getDocs(collection(db, `projects/${projectId}/accounts`));
    let batch = writeBatch(db);
    let ops = 0;
    let moved = 0;
    for (const acc of accounts.docs) {
      const subs = await getDocs(collection(db, `projects/${projectId}/accounts/${acc.id}/subaccounts`));
      for (const s of subs.docs) {
        const d = s.data();
        if (!("budgeted" in d)) continue;
        setBudgetFigure(batch, projectId, s.id, { budgeted: d.budgeted || 0, accountId: acc.id, code: d.code });
        batch.update(s.ref, { budgeted: deleteField() });
        ops += 2;
        moved++;
        if (ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0; }
      }
    }
    if (ops) await batch.commit();
    return moved;
  } catch (e) {
    console.warn("No se pudieron trasladar las cifras de presupuesto", e);
    return 0;
  }
}
