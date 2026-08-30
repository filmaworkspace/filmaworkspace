"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Check, Search, Share2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BTN_LIGHT, BudgetingSharedWithEntry } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Compartir un presupuesto con otro usuario de Filma Workspace: envía una
// COPIA completa e independiente (ver app/api/budgeting/share/route.ts), no
// un enlace en vivo — a partir de ahí, cambios en el original no se reflejan
// en la copia del destinatario, ni al revés. Solo aparecen aquí usuarios con
// acceso a Budgeting (los demás no podrían abrirla).
// ─────────────────────────────────────────────────────────────────────────────

interface ShareUser { uid: string; name: string; email: string }

export default function BudgetingShareModal({
  draftId, sharedWith, open, onClose,
}: {
  draftId: string; sharedWith: BudgetingSharedWithEntry[]; open: boolean; onClose: () => void;
}) {
  const { user } = useUser();
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [search, setSearch] = useState("");
  const [sendingUid, setSendingUid] = useState<string | null>(null);
  const [sentUids, setSentUids] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !user) return;
    setSearch("");
    setSentUids(new Set());
    setError("");
    setLoadingUsers(true);
    getDocs(query(collection(db, "users"), where("budgetingAccess", "==", true)))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ uid: d.id, name: d.data().name || "", email: d.data().email || "" }))
          .filter((u) => u.uid !== user.uid)
          .sort((a, b) => a.name.localeCompare(b.name));
        setUsers(list);
      })
      .catch(() => setError("No se pudo cargar la lista de usuarios"))
      .finally(() => setLoadingUsers(false));
  }, [open, user]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const filtered = q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : users;

  const handleShare = async (target: ShareUser) => {
    setSendingUid(target.uid);
    setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/budgeting/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ draftId, targetUid: target.uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo compartir el presupuesto");
      setSentUids((prev) => new Set(prev).add(target.uid));
    } catch (e: any) {
      setError(e?.message || "No se pudo compartir el presupuesto");
    } finally {
      setSendingUid(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-sm font-semibold text-slate-900">Compartir presupuesto</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 pt-3.5 pb-2 flex-shrink-0 space-y-2">
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Se envía una copia completa e independiente: los cambios que hagas después no se reflejan ahí, ni al revés.
          </p>
          {sharedWith.length > 0 && (
            <p className="text-[11px] text-slate-400">
              Ya compartido con: <span className="text-slate-600">{sharedWith.map((s) => s.name).join(", ")}</span>
            </p>
          )}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email"
              className="w-full pl-7 pr-2.5 py-2 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-red-600">
              <AlertCircle size={11} />
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2.5 pb-3">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-6 h-6 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              {users.length === 0 ? "Nadie más tiene acceso a Budgeting todavía." : "Sin resultados."}
            </p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((u) => {
                const sent = sentUids.has(u.uid);
                const sending = sendingUid === u.uid;
                return (
                  <div key={u.uid} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-900 truncate">{u.name || u.email}</p>
                      {u.name && <p className="text-[10px] text-slate-400 truncate">{u.email}</p>}
                    </div>
                    {sent ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 flex-shrink-0">
                        <Check size={11} /> Enviado
                      </span>
                    ) : (
                      <button
                        onClick={() => handleShare(u)}
                        disabled={sending}
                        className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50 flex-shrink-0 ${BTN_LIGHT}`}
                      >
                        <Share2 size={11} />
                        {sending ? "Enviando..." : "Enviar"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
