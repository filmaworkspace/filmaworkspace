"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowLeft, LibraryBig } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BTN_LIGHT, BudgetingDraft } from "@/lib/budgeting";
import BudgetingLibraryModal, { BudgetingLibraryTab } from "@/components/BudgetingLibraryModal";

const ACCENT = "#6D5A88";
const LIBRARY_TABS: BudgetingLibraryTab[] = ["categories", "phases", "fringes", "globals", "units", "versions"];

// ─────────────────────────────────────────────────────────────────────────────
// Shell de Budgeting: dos modos según la ruta.
//  · /budgeting               → sin borrador abierto, no hay nada que
//    navegar (la lista de presupuestos vive en el propio contenido, como una
//    grid de tarjetas), así que en vez de un sidebar se muestra solo una
//    barra superior fina con el logo y la vuelta a Dashboard.
//  · /budgeting/{draftId}/... → misma barra fina (ya no un sidebar ancho que
//    le robaba sitio a la tabla del presupuesto), con el nombre del borrador
//    editable aquí, y un botón "Librería" que abre en un modal grande todo
//    lo que antes eran rutas propias (Categorías, Fases, Cargas sociales,
//    Globales, Unidades, Versiones) — ver BudgetingLibraryModal. Un enlace
//    profundo puede abrirlo directo en una pestaña con ?library=<tab> (lo
//    consume este componente y limpia la URL al abrir).
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingShell({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // ── Modal de Librería: abre por botón, o por enlace profundo ?library=tab
  // (p.ej. desde "Cargas sociales" en una línea de Detalle). Al consumirlo
  // se limpia el parámetro, para que no se reabra solo con back/refresh. ──
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<BudgetingLibraryTab>("categories");

  useEffect(() => {
    const requested = searchParams.get("library");
    if (requested && (LIBRARY_TABS as string[]).includes(requested)) {
      setLibraryTab(requested as BudgetingLibraryTab);
      setLibraryOpen(true);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("library");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, pathname]);

  const openLibrary = (tab: BudgetingLibraryTab = "categories") => { setLibraryTab(tab); setLibraryOpen(true); };

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      <header className="h-14 flex-shrink-0 border-b border-slate-100 flex items-center gap-4 px-5 sticky top-0 bg-white z-20">
        <Link href="/budgeting" className="flex-shrink-0">
          <Image src="/logo-budgeting.svg" alt="Budgeting" width={82} height={24} className="h-5 w-auto" priority />
        </Link>

        {draftId && (
          <>
            <div className="w-px h-5 bg-slate-200 flex-shrink-0" />
            <Link href="/budgeting" className="flex items-center text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0" title="Presupuestos">
              <ArrowLeft size={14} />
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
                className="text-sm font-semibold text-slate-900 border-b-2 focus:outline-none bg-transparent px-0 py-0.5 min-w-0 max-w-xs"
                style={{ borderColor: ACCENT }}
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-sm font-semibold text-slate-900 hover:text-[#6D5A88] transition-colors text-left truncate max-w-xs min-w-0"
                title="Renombrar"
              >
                {draft?.name || ""}
              </button>
            )}
          </>
        )}

        <div className="flex-1" />

        {draftId && (
          <button onClick={() => openLibrary("categories")} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${BTN_LIGHT}`}>
            <LibraryBig size={13} />
            Librería
          </button>
        )}
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={13} />
          Volver a Dashboard
        </Link>
        <div className="w-6 h-6 rounded-full bg-slate-900 flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0" title={user?.name}>
          {user?.name?.charAt(0).toUpperCase() || "?"}
        </div>
      </header>

      <main>{children}</main>

      {draftId && (
        <BudgetingLibraryModal draftId={draftId} open={libraryOpen} initialTab={libraryTab} onClose={() => setLibraryOpen(false)} />
      )}
    </div>
  );
}
