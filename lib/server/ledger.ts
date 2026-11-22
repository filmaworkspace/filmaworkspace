// Servidor: calcula el libro de presupuesto de un proyecto desde los documentos
// y guarda el resultado en las subcuentas (committed/actual/box) y en las POs
// (facturado por línea). Así cualquier pantalla —también las de usuarios que
// no pueden leer todos los documentos— ve las mismas cifras.
import { db } from "@/lib/firebase-admin";
import { computeLedger, normalizeSettings, UNASSIGNED, type Ledger, type LedgerSettings } from "@/lib/budgetLedger";

const all = async (path: string) => (await db.collection(path).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const same = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

export interface LedgerResult {
  settings: LedgerSettings;
  ledger: Ledger;
  /** Por id de subcuenta (lo que usan las pantallas). */
  bySubId: Record<string, { code: string; committed: number; actual: number; box: number }>;
  written: number;
  /** Escrituras necesarias (también en simulación). */
  changes: number;
}

export async function syncProjectLedger(projectId: string, opts: { write?: boolean } = {}): Promise<LedgerResult> {
  const base = `projects/${projectId}`;
  const [cfg, pos, invoices, cardExpenses, transferExpenses, transferEnvelopes, cashMovements, accounts] = await Promise.all([
    db.doc(`${base}/config/cost`).get(),
    all(`${base}/pos`), all(`${base}/invoices`), all(`${base}/cardExpenses`),
    all(`${base}/transferExpenses`), all(`${base}/transferEnvelopes`), all(`${base}/cashMovements`),
    db.collection(`${base}/accounts`).get(),
  ]);
  const settings = normalizeSettings(cfg.exists ? cfg.data() : null);
  const ledger = computeLedger({ pos, invoices, cardExpenses, transferExpenses, transferEnvelopes, cashMovements }, settings);

  const bySubId: LedgerResult["bySubId"] = {};
  const writes: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[] = [];
  const subsByAccount = await Promise.all(accounts.docs.map((a) => a.ref.collection("subaccounts").get()));
  for (const subs of subsByAccount) {
    for (const s of subs.docs) {
      const d = s.data();
      const t = ledger.bySub[d.code || UNASSIGNED] || { committed: 0, actual: 0, box: 0 };
      bySubId[s.id] = { code: d.code || "", ...t };
      if (!same(d.committed, t.committed) || !same(d.actual, t.actual) || !same(d.box, t.box)) {
        writes.push({ ref: s.ref, data: { committed: t.committed, actual: t.actual, box: t.box } });
      }
    }
  }
  // POs: facturado por línea y total (lo que enseña la ficha y limita nuevas facturas).
  for (const po of pos as Record<string, any>[]) {
    const pl = ledger.pos[po.id];
    if (!pl) continue;
    const items = (po.items || []) as Record<string, any>[];
    const changedItem = items.some((it, i) => !same(it.invoicedAmount, pl.lines[i]?.invoiced));
    const remaining = Math.max(0, Math.round(((Number(po.baseAmount) || pl.base) - pl.invoiced) * 100) / 100);
    if (changedItem || !same(po.invoicedAmount, pl.invoiced) || !same(po.remainingAmount, remaining)) {
      writes.push({
        ref: db.doc(`${base}/pos/${po.id}`),
        data: { items: items.map((it, i) => ({ ...it, invoicedAmount: pl.lines[i]?.invoiced || 0 })), invoicedAmount: pl.invoiced, remainingAmount: remaining },
      });
    }
  }
  if (opts.write !== false && writes.length) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => batch.update(w.ref, w.data));
      await batch.commit();
    }
  }
  return { settings, ledger, bySubId, written: opts.write === false ? 0 : writes.length, changes: writes.length };
}
