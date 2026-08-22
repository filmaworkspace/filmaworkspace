import { doc, getDoc, type Firestore } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Flags de función: generaliza lo que `budgetingAccess` en `users/{uid}` ya
// hacía de forma binaria y de un solo uso (ver contexts/UserContext.tsx) a un
// mecanismo reutilizable para la próxima función nueva — activarla para un
// grupo reducido de usuarios antes de abrirla a todos, sin tocar código.
// Se guardan todos juntos en un único doc (`meta/featureFlags`) porque nunca
// van a ser muchos ni van a cambiar a la vez que otra cosa.
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureFlag {
  id: string;
  label: string;
  description: string;
  enabledGlobally: boolean;
  /** uids de usuarios concretos para los que está activo, aunque `enabledGlobally` sea false. */
  enabledUserIds: string[];
}

export type FeatureFlags = Record<string, FeatureFlag>;

export async function fetchFeatureFlags(db: Firestore): Promise<FeatureFlags> {
  try {
    const snap = await getDoc(doc(db, "meta", "featureFlags"));
    return snap.exists() ? (snap.data() as FeatureFlags) : {};
  } catch {
    return {};
  }
}

/** Resuelve si un flag está activo para un usuario concreto: global, o en su lista de excepciones. */
export function isFeatureEnabled(flags: FeatureFlags, flagId: string, uid?: string | null): boolean {
  const flag = flags[flagId];
  if (!flag) return false;
  if (flag.enabledGlobally) return true;
  return !!uid && flag.enabledUserIds.includes(uid);
}
