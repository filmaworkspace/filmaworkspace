"use client";

// Datos compartidos de la versión móvil: lo que espera a la persona
// (lib/myPending) y sus invitaciones. Se guarda una copia en el dispositivo
// para abrir al instante y poder consultar sin conexión; se recarga al volver
// a la app, al recuperar la conexión, al tirar hacia abajo y tras cada acción.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { loadMyPending, type MyPending } from "@/lib/myPending";

export interface MobileInvitation { id: string; projectId: string; projectName: string; invitedByName?: string; role?: string; position?: string; department?: string }

interface Ctx {
  data: MyPending | null;
  invitations: MobileInvitation[];
  loading: boolean;
  /** Recargando en segundo plano (ya hay datos en pantalla). */
  refreshing: boolean;
  online: boolean;
  /** Cuándo se cargaron los datos que se ven. */
  updatedAt: number | null;
  reload: () => Promise<void>;
}
const MobileCtx = createContext<Ctx>({ data: null, invitations: [], loading: true, refreshing: false, online: true, updatedAt: null, reload: async () => {} });
export const useMobileData = () => useContext(MobileCtx);

// Copia local: las fechas se guardan como texto y se recuperan al leer.
const KEY = (uid: string) => `filma-m:${uid}`;
const revive = (_k: string, v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v) ? new Date(v) : v);
function readCache(uid: string): { data: MyPending; invitations: MobileInvitation[]; at: number } | null {
  try { const raw = localStorage.getItem(KEY(uid)); return raw ? JSON.parse(raw, revive) : null; } catch { return null; }
}
function writeCache(uid: string, v: { data: MyPending; invitations: MobileInvitation[]; at: number }) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

export function MobileDataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const [data, setData] = useState<MyPending | null>(null);
  const [invitations, setInvitations] = useState<MobileInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  // Primero, lo guardado en el dispositivo.
  useEffect(() => {
    if (!user?.uid) return;
    const c = readCache(user.uid);
    if (c) { setData(c.data); setInvitations(c.invitations); setUpdatedAt(c.at); setLoading(false); }
  }, [user?.uid]);

  const reload = useCallback(async () => {
    if (!user?.uid) return;
    // Sin conexión, las consultas vuelven vacías: se queda lo guardado.
    if (typeof navigator !== "undefined" && !navigator.onLine) { setLoading(false); return; }
    if (inflight.current) return inflight.current;
    setRefreshing(true);
    inflight.current = (async () => {
      try {
        const [p, inv] = await Promise.all([
          loadMyPending(user.uid),
          user.email
            ? getDocs(query(collection(db, "invitations"), where("invitedEmail", "==", user.email), where("status", "==", "pending"))).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (!navigator.onLine) return; // se cortó a mitad: no pisar lo guardado
        const invs = (inv?.docs || []).map((d) => ({ id: d.id, ...(d.data() as Omit<MobileInvitation, "id">) }));
        const at = Date.now();
        setData(p); setInvitations(invs); setUpdatedAt(at);
        writeCache(user.uid, { data: p, invitations: invs, at });
      } catch {
        /* sin conexión: se queda lo último que había */
      } finally {
        setLoading(false); setRefreshing(false); inflight.current = null;
      }
    })();
    return inflight.current;
  }, [user?.uid, user?.email]);

  useEffect(() => { reload(); }, [reload]);
  // Al volver a la app y al recuperar la conexión, refrescar.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    const on = () => { setOnline(true); reload(); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [reload]);

  return <MobileCtx.Provider value={{ data, invitations, loading, refreshing, online, updatedAt, reload }}>{children}</MobileCtx.Provider>;
}
