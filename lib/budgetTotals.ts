// ─── Cálculo de comprometido / realizado / caja por subcuenta ───────────────
// Lógica compartida por la página de Presupuesto y el Panel de contabilidad,
// para que las dos muestren siempre las mismas cifras.

import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CostSettings, shouldCommitPO, shouldRealizeInvoice } from "@/lib/budgetRules";

type Totals = Record<string, number>;

const add = (map: Totals, key: string, amount: number) => { map[key] = (map[key] || 0) + amount; };

/**
 * Comprometido = lo que queda por facturar de cada línea de PO.
 * Una línea cerrada no compromete nada; una PO en modificación sigue
 * contando con su versión anterior hasta que la nueva se apruebe.
 */
export function committedBySubaccount(pos: any[], config: CostSettings): Totals {
  const out: Totals = {};
  for (const po of pos) {
    const modifying = po.previousCommittedItems?.length > 0 && (po.status === "draft" || po.status === "pending");
    if (modifying) {
      for (const item of po.previousCommittedItems) {
        if (item.subAccountCode) add(out, item.subAccountCode, Math.max(0, (item.baseAmount || 0) - (item.invoicedAmount || 0)));
      }
      continue;
    }
    if (po.status && shouldCommitPO(po.status, config) && po.items) {
      for (const item of po.items) {
        if (!item.subAccountCode) continue;
        add(out, item.subAccountCode, item.isClosed ? 0 : Math.max(0, (item.baseAmount || 0) - (item.invoicedAmount || 0)));
      }
    }
  }
  return out;
}

/** Realizado = líneas de facturas que ya cuentan según la configuración de costes. */
export function actualBySubaccount(invoices: any[], config: CostSettings): Totals {
  const out: Totals = {};
  for (const inv of invoices) {
    const terminal = ["cancelled", "rejected", "void"].includes(inv.status);
    const realized = terminal
      ? false
      : config.invoiceActualTrigger === "on_code"
        ? !!inv.codedAt
        : config.invoiceActualTrigger === "on_account"
          ? !!(inv.accountedAt || inv.accounted)
          : shouldRealizeInvoice(inv.status, config, {
              codedAt: inv.codedAt, accountedAt: inv.accountedAt || inv.accounted, paidAt: inv.paidAt, approvedAt: inv.approvedAt,
            });
    if (inv.status && realized && inv.items) {
      for (const item of inv.items) {
        if (item.subAccountCode) add(out, item.subAccountCode, item.baseAmount || 0);
      }
    }
  }
  return out;
}

/** Caja: gastos de tarjeta contabilizados, todas las transferencias y los
 *  gastos de efectivo (pagos con ticket y justificaciones) contabilizados. */
export async function loadBoxBySubaccount(projectId: string): Promise<Totals> {
  const out: Totals = {};
  const [cards, transfers, cash] = await Promise.all([
    getDocs(collection(db, `projects/${projectId}/cardExpenses`)),
    getDocs(collection(db, `projects/${projectId}/transferExpenses`)),
    getDocs(collection(db, `projects/${projectId}/cashMovements`)).catch(() => null),
  ]);
  cash?.docs.forEach((d) => {
    const m = d.data();
    if ((m.type === "expense" || m.type === "settlement") && m.status === "accounted") {
      (m.lines || []).forEach((l: any) => { if (l.subAccountCode) add(out, l.subAccountCode, l.baseAmount || 0); });
    }
  });
  cards.docs.forEach((d) => {
    const e = d.data();
    if (e.status === "accounted" && e.subAccountCode) add(out, e.subAccountCode, e.baseAmount || 0);
  });
  transfers.docs.forEach((d) => {
    const e = d.data();
    if (e.subAccountCode) add(out, e.subAccountCode, e.baseAmount || 0);
  });
  return out;
}
