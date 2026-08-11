"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Wallet } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BUDGETING_ACCENT, BudgetingDraft } from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Top Sheet + edición de cuentas y Detail Lines llega en la Fase 2 — de
// momento esta pantalla solo confirma que el borrador existe y es tuyo.
// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingDraftPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();
  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "budgetingDrafts", draftId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !draft || draft.ownerUid !== user?.uid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Este presupuesto no existe o no tienes acceso.</p>
      </div>
    );
  }

  return (
    <div className="px-10 py-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${BUDGETING_ACCENT}1a` }}>
          <Wallet size={16} style={{ color: BUDGETING_ACCENT }} />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{draft.name}</h1>
      </div>
      <p className="text-sm text-slate-400 mt-4">
        El Top Sheet y la edición de cuentas llegan en la siguiente fase — de momento este borrador ya está creado y guardado.
      </p>
    </div>
  );
}
