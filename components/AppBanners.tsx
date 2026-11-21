"use client";
import { toast as appToast } from "@/lib/toast";

// ─── Avisos globales de la app ───────────────────────────────────────────────
// - Sesión "Ver como" (admin viendo la app como otro usuario, solo lectura).
// - Avisos y novedades publicados desde admindashboard → Avisos.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Eye, Megaphone, Sparkles, X } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { useUser } from "@/contexts/UserContext";
import { Announcement, isLive } from "@/lib/announcements";

const DISMISSED_KEY = "filma:dismissedAnnouncements";

function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"); } catch { return []; }
}

export default function AppBanners({ isAuthPage, isMobilePage, isAdminDashboard }: { isAuthPage: boolean; isMobilePage: boolean; isAdminDashboard: boolean }) {
  const { user } = useUser();
  const router = useRouter();
  const [items, setItems] = useState<Record<string, Announcement>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [exiting, setExiting] = useState(false);

  useEffect(() => { setDismissed(readDismissed()); }, []);

  useEffect(() => {
    if (!user?.uid || isAuthPage) { setItems({}); return; }
    const merge = (key: string) => (snap: { docs: { id: string; data: () => unknown }[] }) =>
      setItems((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, a]) => (a as Announcement & { _q?: string })._q !== key));
        snap.docs.forEach((d) => { next[d.id] = { id: d.id, ...(d.data() as object), _q: key } as unknown as Announcement; });
        return next;
      });
    const u1 = onSnapshot(query(collection(db, "announcements"), where("audienceAll", "==", true), where("active", "==", true)), merge("all"), () => {});
    const u2 = onSnapshot(query(collection(db, "announcements"), where("audienceUserIds", "array-contains", user.uid), where("active", "==", true)), merge("mine"), () => {});
    return () => { u1(); u2(); };
  }, [user?.uid, isAuthPage]);

  // Re-evaluar cada minuto (inicio/fin programados)
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);

  const visible = useMemo(() => {
    void tick;
    return Object.values(items)
      .filter((a) => isLive(a) && !dismissed.includes(a.id))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  }, [items, dismissed, tick]);

  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* nada */ }
  };

  const exitImpersonation = async () => {
    setExiting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const targetUid = auth.currentUser?.uid;
      const res = await fetch("/api/admin/impersonate/end", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "No se pudo salir");
      await signInWithCustomToken(auth, body.token);
      window.location.href = `/admindashboard/users/${targetUid}`;
    } catch (e) {
      appToast.error(e);
      setExiting(false);
    }
  };

  const showCards = !isMobilePage && !isAdminDashboard && visible.length > 0;
  const banners = visible.filter((a) => a.kind === "banner").slice(0, 2);
  const changelog = visible.filter((a) => a.kind === "changelog").slice(0, 3);

  return (
    <>
      {user?.impersonatedBy && (
        <div className="fixed bottom-0 left-0 z-[90] flex w-full items-center justify-center gap-3 bg-slate-900 px-4 py-2.5 text-[13px] text-white shadow-lg print:hidden">
          <Eye size={14} className="flex-shrink-0 text-amber-300" />
          <span>Estás viendo Filma como <strong className="font-semibold">{user.name}</strong> · solo lectura</span>
          <button onClick={exitImpersonation} disabled={exiting} className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 disabled:opacity-50">
            {exiting ? "Saliendo…" : "Volver a mi cuenta"}
          </button>
        </div>
      )}

      {showCards && (
        <div className={`fixed left-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden ${user?.impersonatedBy ? "bottom-14" : "bottom-4"}`}>
          {changelog.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Sparkles size={12} /> Novedades</span>
                <button onClick={() => changelog.forEach((c) => dismiss(c.id))} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar"><X size={14} /></button>
              </div>
              <div className="flex flex-col gap-3">
                {changelog.map((c) => (
                  <div key={c.id}>
                    <p className="text-sm font-semibold text-slate-900">{c.title}</p>
                    {c.body && <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{c.body}</p>}
                    {c.link?.url && <a href={c.link.url} className="mt-1 inline-block text-[13px] font-medium text-slate-900 underline-offset-2 hover:underline">{c.link.label || "Ver más"} →</a>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {banners.map((b) => (
            <div key={b.id} className={`flex gap-3 rounded-xl border bg-white p-3.5 shadow-xl ${b.level === "warning" ? "border-amber-200" : b.level === "success" ? "border-emerald-200" : "border-slate-200"}`}>
              <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${b.level === "warning" ? "bg-amber-50 text-amber-600" : b.level === "success" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-600"}`}>
                <Megaphone size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{b.title}</p>
                {b.body && <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">{b.body}</p>}
                {b.link?.url && <a href={b.link.url} className="mt-1 inline-block text-[13px] font-medium text-slate-900 hover:underline">{b.link.label || "Ver más"} →</a>}
              </div>
              <button onClick={() => dismiss(b.id)} className="h-6 w-6 flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
