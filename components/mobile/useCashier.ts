"use client";

// ¿Lleva la caja de algún proyecto? Y cuántas firmas esperan en su móvil.
// Se guarda en el dispositivo para que la pestaña no aparezca tarde.

import { useEffect, useState } from "react";
import { useUser } from "@/contexts/UserContext";
import { cashierProjects, pendingSignatures } from "@/lib/box/cashier";

const KEY = (uid: string) => `filma-cajero:${uid}`;

export function useCashierBadge(pathname: string) {
  const { user } = useUser();
  const [state, setState] = useState<{ enabled: boolean; pending: number }>({ enabled: false, pending: 0 });
  useEffect(() => {
    if (!user?.uid) return;
    try { const c = localStorage.getItem(KEY(user.uid)); if (c) setState(JSON.parse(c)); } catch { /* sin almacenamiento */ }
  }, [user?.uid]);
  useEffect(() => {
    if (!user?.uid || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    let alive = true;
    (async () => {
      const projects = await cashierProjects(user.uid).catch(() => []);
      const pending = projects.length ? (await pendingSignatures(projects).catch(() => [])).length : 0;
      if (!alive) return;
      const s = { enabled: projects.length > 0, pending };
      setState(s);
      try { localStorage.setItem(KEY(user.uid), JSON.stringify(s)); } catch { /* sin almacenamiento */ }
    })();
    return () => { alive = false; };
  }, [user?.uid, pathname]);
  return state;
}
