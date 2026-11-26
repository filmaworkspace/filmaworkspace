// ─── App del cajero (móvil) ──────────────────────────────────────────────────
// Proyectos en los que la persona lleva la caja y, de cada uno, las firmas
// pendientes, el saldo de las cajas de efectivo y los anticipos abiertos.

import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { advanceOutstanding, balanceOf, type CashMovement } from "@/lib/cashBox";
import { fromDoc, type BoxSignatureRequest } from "./signatures";

export interface CashierProject { id: string; name: string }
export interface CashierFloat { id: string; name: string; code: string; balance: number }
export interface CashierAdvance { id: string; number: string; personName: string; amount: number; outstanding: number; date: string; floatName: string }
export interface CashierData {
  projects: CashierProject[];
  pending: BoxSignatureRequest[];
  floats: (CashierFloat & { projectId: string; projectName: string })[];
  advances: (CashierAdvance & { projectId: string; projectName: string })[];
}

const CASHIER_LEVELS = ["visitor", "accounting", "accounting_extended"];

/** Proyectos donde puede llevar la caja (mismo criterio que las reglas). */
export async function cashierProjects(uid: string): Promise<CashierProject[]> {
  const ups = await getDocs(collection(db, `userProjects/${uid}/projects`));
  const ids = ups.docs.filter((u) => {
    const d = u.data();
    if (d.archived || d.permissions?.accounting === false) return false;
    return d.boxAccess === true || CASHIER_LEVELS.includes(d.accountingAccessLevel) || ["EP", "PM"].includes(d.role);
  }).map((u) => u.id);
  const out = await Promise.all(ids.map(async (id) => {
    const p = await getDoc(doc(db, "projects", id)).catch(() => null);
    return p?.exists() && !p.data().archived ? { id, name: p.data().name || "Proyecto" } : null;
  }));
  return out.filter((x): x is CashierProject => !!x);
}

export async function pendingSignatures(projects: CashierProject[]): Promise<BoxSignatureRequest[]> {
  const lists = await Promise.all(projects.map(async (p) => {
    const s = await getDocs(query(collection(db, `projects/${p.id}/boxSignatures`), where("status", "==", "pending"))).catch(() => null);
    return (s?.docs || []).map((d) => ({ ...fromDoc(p.id, d.id, d.data()), projectName: p.name }));
  }));
  return lists.flat().sort((a, b) => (b.requestedAt?.getTime() || 0) - (a.requestedAt?.getTime() || 0));
}

export async function loadCashier(uid: string): Promise<CashierData> {
  const projects = await cashierProjects(uid);
  const [pending, perProject] = await Promise.all([
    pendingSignatures(projects),
    Promise.all(projects.map(async (p) => {
      const [fs, ms] = await Promise.all([
        getDocs(collection(db, `projects/${p.id}/cashFloats`)).catch(() => null),
        getDocs(collection(db, `projects/${p.id}/cashMovements`)).catch(() => null),
      ]);
      const movements = (ms?.docs || []).map((d) => ({ id: d.id, ...d.data() }) as CashMovement);
      const floats = (fs?.docs || []).filter((d) => d.data().status !== "closed").map((d) => {
        const own = movements.filter((m) => m.floatId === d.id);
        return { projectId: p.id, projectName: p.name, id: d.id, name: d.data().name || "Caja", code: d.data().code || "", balance: balanceOf(own) };
      });
      const floatName = new Map(floats.map((f) => [f.id, f.name]));
      const advances = movements.filter((m) => m.type === "advance").map((m) => {
        const outstanding = advanceOutstanding(m, movements.filter((x) => x.floatId === m.floatId));
        return { projectId: p.id, projectName: p.name, id: m.id, number: m.number, personName: m.personName || "—", amount: m.amount, outstanding, date: m.date, floatName: floatName.get(m.floatId) || "Caja" };
      }).filter((a) => a.outstanding > 0.004);
      return { floats, advances };
    })),
  ]);
  return {
    projects,
    pending,
    floats: perProject.flatMap((x) => x.floats),
    advances: perProject.flatMap((x) => x.advances).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
