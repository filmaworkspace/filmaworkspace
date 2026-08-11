"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowLeft } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BudgetingDraft } from "@/lib/budgeting";

const ACCENT = "#8DA7BE";

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar de Budgeting: dos modos según la ruta.
//  · /budgeting               → solo el logo y el pie (la lista de
//    presupuestos vive en el propio contenido, como una grid de tarjetas).
//  · /budgeting/{draftId}/... → nav propia del borrador (Top Sheet,
//    Categorías, Globales, Seguridad Social, Fases) y el nombre del
//    borrador, editable aquí; ya no se repite en el contenido.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const draftId = segments[0] === "budgeting" && segments[1] ? segments[1] : null;

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const editingNameRef = useRef(false);
  useEffect(() => { editingNameRef.current = editingName; }, [editingName]);

  useEffect(() => {
    if (!draftId) { setDraft(null); return; }
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() } as BudgetingDraft;
      setDraft(data);
      if (!editingNameRef.current) setNameInput(data.name);
    });
    return () => unsub();
  }, [draftId]);

  const handleRenameDraft = async () => {
    setEditingName(false);
    if (!draft || !user || !nameInput.trim() || nameInput.trim() === draft.name) return;
    const name = nameInput.trim();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draft.id), { name, updatedAt: serverTimestamp() }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draft.id), { name, updatedAt: serverTimestamp() }),
    ]);
  };

  const navItems = draftId ? [
    { href: `/budgeting/${draftId}`, label: "Presupuesto", exact: true },
    { href: `/budgeting/${draftId}/categories`, label: "Categorías", exact: false },
    { href: `/budgeting/${draftId}/phases`, label: "Fases", exact: false },
    { href: `/budgeting/${draftId}/fringes`, label: "Cargas sociales", exact: false },
    { href: `/budgeting/${draftId}/globals`, label: "Globales", exact: false },
    { href: `/budgeting/${draftId}/versions`, label: "Versiones", exact: false },
  ] : [];

  return (
    <div className={`min-h-screen flex bg-white ${inter.className}`}>
      <aside className="w-60 flex-shrink-0 border-r border-slate-100 flex flex-col h-screen sticky top-0">
        <div className="px-5 pt-6 pb-5 flex justify-center border-b border-slate-100">
          <Link href="/budgeting">
            <Image src="/logo-budgeting.svg" alt="Budgeting" width={82} height={24} className="h-6 w-auto" priority />
          </Link>
        </div>

        {draftId ? (
          <>
            <div className="px-5 py-4 border-b border-slate-100">
              <Link href="/budgeting" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors mb-3">
                <ArrowLeft size={12} />
                Presupuestos
              </Link>
              {editingName ? (
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleRenameDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape" && draft) { setNameInput(draft.name); setEditingName(false); }
                  }}
                  className="text-sm font-semibold text-slate-900 border-b-2 focus:outline-none bg-transparent px-0 py-0.5 w-full"
                  style={{ borderColor: ACCENT }}
                />
              ) : (
                <button
                  onClick={() => setEditingName(true)}
                  className="text-sm font-semibold text-slate-900 hover:text-[#8DA7BE] transition-colors text-left truncate block w-full"
                  title="Renombrar"
                >
                  {draft?.name || ""}
                </button>
              )}
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
              {navItems.map((item) => {
                const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block px-3 py-2 rounded-lg text-sm transition-colors ${isActive ? "" : "text-slate-600 hover:bg-slate-50"}`}
                    style={isActive ? { background: `${ACCENT}1a`, color: ACCENT, fontWeight: 500 } : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </>
        ) : (
          <nav className="flex-1 px-3 py-3">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider px-3 mb-1.5">Budgeting</p>
            <Link
              href="/budgeting"
              className="block px-3 py-2 rounded-lg text-sm"
              style={{ background: `${ACCENT}1a`, color: ACCENT, fontWeight: 500 }}
            >
              Presupuestos
            </Link>
          </nav>
        )}

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

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
