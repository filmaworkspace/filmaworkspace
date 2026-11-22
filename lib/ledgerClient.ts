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

// Agrupación: varias peticiones seguidas del mismo proyecto (guardar varias
// cosas, cambios en Caja…) se juntan en un solo recálculo, que se lanza
// cuando hay una pausa corta (o como mucho a los 2 s). Si ya hay uno en
// marcha, se hace otro al terminar para que el último vea el estado final.
const QUIET_MS = 400;
const MAX_WAIT_MS = 2000;
interface Pending { timer: ReturnType<typeof setTimeout> | null; firstAt: number; waiters: ((r: LedgerResponse | null) => void)[] }
const pending = new Map<string, Pending>();
const running = new Map<string, Promise<LedgerResponse | null>>();

async function callServer(projectId: string): Promise<LedgerResponse | null> {
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
}

function flush(projectId: string) {
  const p = pending.get(projectId);
  if (!p) return;
  pending.delete(projectId);
  if (p.timer) clearTimeout(p.timer);
  const prev = running.get(projectId) || Promise.resolve(null);
  const run = prev.catch(() => null).then(() => callServer(projectId));
  running.set(projectId, run);
  run.then((r) => { p.waiters.forEach((w) => w(r)); if (running.get(projectId) === run) running.delete(projectId); });
}

export function syncBudget(projectId: string): Promise<LedgerResponse | null> {
  return new Promise((resolve) => {
    const now = Date.now();
    const p = pending.get(projectId) || { timer: null, firstAt: now, waiters: [] };
    p.waiters.push(resolve);
    if (p.timer) clearTimeout(p.timer);
    const wait = Math.max(0, Math.min(QUIET_MS, MAX_WAIT_MS - (now - p.firstAt)));
    p.timer = setTimeout(() => flush(projectId), wait);
    pending.set(projectId, p);
  });
}

/**
 * Cifras del presupuesto por código de subcuenta. Pide el recálculo al
 * servidor; si no responde, lo calcula aquí con los documentos que se puedan
 * leer (mismas reglas: lib/budgetLedger).
 */
export async function loadLedger(projectId: string): Promise<Pick<LedgerResponse, "bySub" | "totals" | "pos" | "issues" | "settings"> & { bySubId?: LedgerResponse["bySubId"] }> {
  const remote = await syncBudget(projectId);
  if (remote) return remote;
  const { collection, doc, getDoc, getDocs } = await import("firebase/firestore");
  const { db } = await import("@/lib/firebase");
  const { computeLedger, normalizeSettings } = await import("@/lib/budgetLedger");
  const base = `projects/${projectId}`;
  const read = async (c: string) => { try { return (await getDocs(collection(db, `${base}/${c}`))).docs.map((d) => ({ id: d.id, ...d.data() })); } catch { return []; } };
  const [cfg, pos, invoices, cardExpenses, transferExpenses, transferEnvelopes, cashMovements] = await Promise.all([
    getDoc(doc(db, `${base}/config/cost`)).catch(() => null), read("pos"), read("invoices"), read("cardExpenses"), read("transferExpenses"), read("transferEnvelopes"), read("cashMovements"),
  ]);
  const settings = normalizeSettings(cfg?.exists() ? cfg.data() : null);
  const l = computeLedger({ pos, invoices, cardExpenses, transferExpenses, transferEnvelopes, cashMovements }, settings);
  return { bySub: l.bySub, totals: l.totals, pos: l.pos, issues: l.issues, settings };
}
