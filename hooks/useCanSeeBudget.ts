"use client";

// ¿Puede el usuario actual ver cifras de presupuesto (presupuestado, disponible,
// % de ejecución) de las cuentas? Solo contabilidad avanzada y EP/PM, los
// mismos que pueden abrir la página de Presupuesto. El resto elige cuentas por
// código y descripción, sin cifras.

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export function canSeeBudget(member: { accountingAccessLevel?: string; role?: string } | null | undefined) {
  if (!member) return false;
  return member.accountingAccessLevel === "accounting_extended" || member.role === "EP" || member.role === "PM";
}

export function useCanSeeBudget(projectId: string | undefined) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!projectId) return;
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) return setAllowed(false);
      try {
        const snap = await getDoc(doc(db, `projects/${projectId}/members`, u.uid));
        setAllowed(canSeeBudget(snap.exists() ? (snap.data() as any) : null));
      } catch {
        setAllowed(false);
      }
    });
    return () => unsub();
  }, [projectId]);
  return allowed;
}
