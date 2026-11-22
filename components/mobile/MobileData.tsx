"use client";

// Datos compartidos de la versión móvil: lo que espera a la persona
// (lib/myPending) y sus invitaciones. Se cargan una vez y se recargan tras
// aprobar, rechazar o aceptar una invitación.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { loadMyPending, type MyPending } from "@/lib/myPending";

export interface MobileInvitation { id: string; projectId: string; projectName: string; invitedByName?: string; role?: string; position?: string; department?: string }

interface Ctx {
  data: MyPending | null;
  invitations: MobileInvitation[];
  loading: boolean;
  reload: () => Promise<void>;
}
const MobileCtx = createContext<Ctx>({ data: null, invitations: [], loading: true, reload: async () => {} });
export const useMobileData = () => useContext(MobileCtx);

export function MobileDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const [data, setData] = useState<MyPending | null>(null);
  const [invitations, setInvitations] = useState<MobileInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [p, inv] = await Promise.all([
        loadMyPending(user.uid),
        user.email
          ? getDocs(query(collection(db, "invitations"), where("invitedEmail", "==", user.email), where("status", "==", "pending"))).catch(() => null)
          : Promise.resolve(null),
      ]);
      setData(p);
      setInvitations((inv?.docs || []).map((d) => ({ id: d.id, ...(d.data() as Omit<MobileInvitation, "id">) })));
    } finally {
      setLoading(false);
    }
  }, [user?.uid, user?.email]);

  useEffect(() => { reload(); }, [reload]);
  // Al volver a la pestaña, refrescar (otra persona puede haber aprobado).
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  return <MobileCtx.Provider value={{ data, invitations, loading, reload }}>{children}</MobileCtx.Provider>;
}
