// Cliente: pide al servidor que recalcule el presupuesto del proyecto desde los
// documentos (lib/budgetLedger) y lo guarde. Llamarlo SIEMPRE después de
// guardar el cambio (aprobar, codificar, anular, cerrar, sobre…).
import { auth } from "@/lib/firebase";
import type { LedgerIssue, LedgerSettings, PoLedger, SubTotals } from "@/lib/budgetLedger";

export interface LedgerResponse {
  settings: LedgerSettings;
  bySubId: Record<string, SubTotals & { code: string }>;
  bySub: Record<string, SubTotals>;
  totals: SubTotals;
  pos: Record<string, PoLedger>;
  invoiceRealized: Record<string, boolean>;
  issues: LedgerIssue[];
}

const inflight = new Map<string, Promise<LedgerResponse | null>>();

export async function syncBudget(projectId: string): Promise<LedgerResponse | null> {
  // Si ya hay una en curso, se encadena otra después (la última ve el estado final).
  const prev = inflight.get(projectId);
  const run = (async () => {
    if (prev) await prev.catch(() => null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return null;
      const res = await fetch("/api/accounting/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) { console.warn("syncBudget", res.status); return null; }
      return (await res.json()) as LedgerResponse;
    } catch (e) {
      console.warn("syncBudget", e);
      return null;
    }
  })();
  inflight.set(projectId, run);
  try { return await run; } finally { if (inflight.get(projectId) === run) inflight.delete(projectId); }
}
