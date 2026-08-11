"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowLeft, FileUp, Plus, Search, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BUDGETING_ACCENT, BUDGETING_ACCENT_DARK, BudgetingDraftIndex } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  const [drafts, setDrafts] = useState<BudgetingDraftIndex[]>([]);
  const [search, setSearch] = useState("");
  const [showNewDraft, setShowNewDraft] = useState(false);
  const [newDraftName, setNewDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDraftIndex | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `userBudgetingDrafts/${user.uid}/drafts`), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setDrafts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDraftIndex)));
    });
    return () => unsub();
  }, [user]);

  const filteredDrafts = drafts.filter((d) => d.name.toLowerCase().includes(search.trim().toLowerCase()));

  const handleCreateDraft = async () => {
    if (!newDraftName.trim() || !user) return;
    setCreating(true);
    try {
      const ref = doc(collection(db, "budgetingDrafts"));
      const now = serverTimestamp();
      await setDoc(ref, {
        name: newDraftName.trim(),
        ownerUid: user.uid,
        ownerName: user.name,
        currency: "EUR",
        createdAt: now,
        updatedAt: now,
        sentToProjectId: null,
        sentToProjectName: null,
        sentAt: null,
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, ref.id), {
        name: newDraftName.trim(),
        updatedAt: now,
        status: "draft",
        sentToProjectName: null,
      });
      setShowNewDraft(false);
      setNewDraftName("");
      router.push(`/budgeting/${ref.id}`);
    } catch (e) {
      console.error("[Budgeting] Error creando borrador:", e);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    try {
      await Promise.all([
        deleteDoc(doc(db, "budgetingDrafts", deleteTarget.id)),
        deleteDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, deleteTarget.id)),
      ]);
      if (pathname === `/budgeting/${deleteTarget.id}`) router.push("/budgeting");
      setDeleteTarget(null);
    } catch (e) {
      console.error("[Budgeting] Error borrando borrador:", e);
    } finally {
      setDeleting(false);
    }
  };

  const gradient = `linear-gradient(135deg, #6C64F5, ${BUDGETING_ACCENT_DARK})`;

  return (
    <div className={`min-h-screen flex flex-col bg-white ${inter.className}`}>
      {/* Barra de acento superior */}
      <div className="h-1 flex-shrink-0" style={{ background: gradient }} />

      <div className="flex flex-1 min-h-0">
        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside className="w-64 flex-shrink-0 border-r border-slate-100 flex flex-col h-[calc(100vh-4px)] sticky top-1">
          <div className="px-5 pt-6 pb-4">
            <div className="mb-5">
              <Image src="/logo-budgeting.svg" alt="Budgeting" width={161} height={23} className="h-6 w-auto" priority />
            </div>

            <button
              onClick={() => setShowNewDraft(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium text-white shadow-sm hover:shadow-md hover:brightness-105 active:brightness-95 transition-all"
              style={{ background: gradient }}
            >
              <Plus size={14} />
              Nuevo presupuesto
            </button>
          </div>

          <div className="px-5 pb-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 space-y-0.5">
            {filteredDrafts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8 px-3">
                {drafts.length === 0 ? "Sin borradores todavía" : "Sin resultados"}
              </p>
            ) : filteredDrafts.map((d) => {
              const isActive = pathname === `/budgeting/${d.id}`;
              return (
                <Link
                  key={d.id}
                  href={`/budgeting/${d.id}`}
                  className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors ${
                    isActive ? "bg-[#5B57E0]/[0.08] text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                    style={{ background: d.status === "sent" ? "linear-gradient(135deg, #34d399, #059669)" : gradient }}
                  >
                    {d.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 truncate">{d.name}</span>
                  <button
                    onClick={(e) => { e.preventDefault(); setDeleteTarget(d); }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 rounded-md transition-opacity flex-shrink-0"
                    title="Borrar borrador"
                  >
                    <Trash2 size={12} />
                  </button>
                </Link>
              );
            })}
          </div>

          <div className="px-3 pb-3">
            <button
              disabled
              title="Próximamente"
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-300 cursor-not-allowed"
            >
              <FileUp size={13} />
              Cargar presupuesto (.fwb)
            </button>
          </div>

          <div className="px-3 py-3 border-t border-slate-100 space-y-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft size={13} />
              Volver a Dashboard
            </Link>
            <div className="flex items-center gap-2 px-2">
              <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0">
                {user?.name?.charAt(0).toUpperCase() || "?"}
              </div>
              <span className="text-xs text-slate-500 truncate">{user?.name}</span>
            </div>
          </div>
        </aside>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>

      {/* ── New draft modal ─────────────────────────────────────────────── */}
      {showNewDraft && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">Nuevo presupuesto</h3>
              <button onClick={() => setShowNewDraft(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre</label>
              <input
                type="text"
                value={newDraftName}
                onChange={(e) => setNewDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateDraft(); }}
                placeholder="Ej: Marea Alta"
                autoFocus
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
              />
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowNewDraft(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleCreateDraft}
                disabled={!newDraftName.trim() || creating}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white shadow-sm hover:shadow-md hover:brightness-105 transition-all disabled:opacity-40 disabled:shadow-none"
                style={{ background: gradient }}
              >
                {creating ? "Creando..." : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm modal ────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar "{deleteTarget.name}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleDeleteDraft}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
