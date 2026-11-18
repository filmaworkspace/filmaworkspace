// ─── Migración: seguridad de Contabilidad ────────────────────────────────────
// Ejecutar UNA vez, después de publicar la app y ANTES de publicar las reglas
// nuevas de Firestore. Para cada proyecto:
//   1. Traslada el presupuestado de cada subcuenta (campo `budgeted`) a
//      projects/{id}/budgetLines/{subId} y lo borra de la subcuenta.
//   2. Rellena `approverIds` en POs y facturas a partir de `approvalSteps`.
//   3. Crea los contadores de numeración (projects/{id}/counters/pos|invoices).
//
// Uso (con las mismas variables que .env.local):
//   node --env-file=.env.local scripts/migrate-accounting-security.mjs          (simulación)
//   node --env-file=.env.local scripts/migrate-accounting-security.mjs --apply  (escribe)
//
// Es idempotente: se puede repetir sin efectos secundarios.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const { FIREBASE_ADMIN_PROJECT_ID: projectId, FIREBASE_ADMIN_CLIENT_EMAIL: clientEmail } = process.env;
const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (process.env.FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: process.env.EMULATOR_PROJECT || "demo-filma" }); // pruebas locales
} else if (!projectId || !clientEmail || !privateKey) {
  console.error("Faltan FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY");
  process.exit(1);
} else {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}
const db = getFirestore();

const approverIdsOf = (steps) => [...new Set((steps || []).flatMap((s) => s?.approvers || []).filter(Boolean))];
const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));

let writer = db.batch(), pending = 0;
async function write(fn) {
  if (!APPLY) return;
  fn(writer);
  if (++pending >= 400) { await writer.commit(); writer = db.batch(); pending = 0; }
}

const totals = { projects: 0, budget: 0, approvers: 0, counters: 0 };
const projects = await db.collection("projects").get();
for (const p of projects.docs) {
  totals.projects++;
  let moved = 0, filled = 0;

  // 1. Presupuestado → budgetLines
  const accounts = await p.ref.collection("accounts").get();
  for (const acc of accounts.docs) {
    const subs = await acc.ref.collection("subaccounts").get();
    for (const s of subs.docs) {
      const d = s.data();
      if (!("budgeted" in d)) continue;
      moved++;
      await write((b) => {
        b.set(p.ref.collection("budgetLines").doc(s.id), { budgeted: Number(d.budgeted) || 0, accountId: acc.id, code: d.code || "" }, { merge: true });
        b.update(s.ref, { budgeted: FieldValue.delete() });
      });
    }
  }

  // 2. approverIds + 3. contadores
  for (const kind of ["pos", "invoices"]) {
    const snap = await p.ref.collection(kind).get();
    let max = 0;
    for (const d of snap.docs) {
      const data = d.data();
      const n = parseInt(data.number || "0", 10);
      if (n > max) max = n;
      const ids = approverIdsOf(data.approvalSteps);
      if (!sameSet(ids, data.approverIds)) {
        filled++;
        await write((b) => b.update(d.ref, { approverIds: ids }));
      }
    }
    const counterRef = p.ref.collection("counters").doc(kind);
    const counter = await counterRef.get();
    if (!counter.exists || (counter.data().last || 0) < max) {
      totals.counters++;
      await write((b) => b.set(counterRef, { last: max }));
    }
  }

  totals.budget += moved; totals.approvers += filled;
  if (moved || filled) console.log(`${p.id} (${p.data().name || ""}): ${moved} subcuentas con presupuesto, ${filled} documentos con aprobadores`);
}
if (APPLY && pending) await writer.commit();

console.log(`\n${totals.projects} proyectos · ${totals.budget} cifras de presupuesto trasladadas · ${totals.approvers} POs/facturas con approverIds · ${totals.counters} contadores`);
console.log(APPLY ? "Hecho." : "Simulación: no se ha escrito nada. Repite con --apply.");
