"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ChevronDown, ChevronRight, Copy, Download, Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingDraft, BudgetingCategoryDef, BudgetingAccount, BudgetingDetailLine,
  categoriesEnabled, resolveCategories, fmtCurrency, ICON_BTN_LIGHT,
} from "@/lib/budgeting";
import { buildFwbFromDraft, downloadFwb } from "@/lib/budgetingExport";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { accountId: string; label: string };

export default function BudgetingTopSheetPage() {
  const { draftId } = useParams() as { draftId: string };
  const { user } = useUser();
  const router = useRouter();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [accounts, setAccounts] = useState<BudgetingAccount[]>([]);
  const [linesByAccount, setLinesByAccount] = useState<Record<string, BudgetingDetailLine[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const [accountModal, setAccountModal] = useState<{ category: string | null; account: BudgetingAccount | null } | null>(null);
  const [accountForm, setAccountForm] = useState({ code: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

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

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts`), (snap) => {
      setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingAccount)));
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsubs: Record<string, () => void> = {};
    accounts.forEach((a) => {
      unsubs[a.id] = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${a.id}/detailLines`), (snap) => {
        setLinesByAccount((prev) => ({ ...prev, [a.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)) }));
      });
    });
    return () => { Object.values(unsubs).forEach((fn) => fn()); };
  }, [accounts, draftId]);

  const catEnabled = categoriesEnabled(draft);
  const cats: BudgetingCategoryDef[] = catEnabled ? resolveCategories(draft) : [];

  const accountsByCategory = (categoryId: string) => accounts.filter((a) => a.category === categoryId);
  const accountTotal = (accountId: string) => (linesByAccount[accountId] || []).reduce((s, l) => s + (l.total || 0), 0);
  const categoryTotal = (categoryId: string) => accountsByCategory(categoryId).reduce((s, a) => s + accountTotal(a.id), 0);
  const grandTotal = catEnabled
    ? cats.reduce((s, c) => s + categoryTotal(c.id), 0)
    : accounts.reduce((s, a) => s + accountTotal(a.id), 0);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);

  const toggleCategory = (catId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(catId) ? next.delete(catId) : next.add(catId);
      return next;
    });
  };

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const handleDuplicateDraft = async () => {
    if (!draft || !user) return;
    setDuplicating(true);
    try {
      const newName = `${draft.name} (copia)`;
      const newRef = doc(collection(db, "budgetingDrafts"));
      const now = serverTimestamp();
      await setDoc(newRef, {
        name: newName, ownerUid: user.uid, ownerName: user.name, currency: draft.currency,
        createdAt: now, updatedAt: now, sentToProjectId: null, sentToProjectName: null, sentAt: null,
        categoriesEnabled: draft.categoriesEnabled ?? true,
        categories: draft.categories ?? [],
        globals: draft.globals ?? [], fringes: draft.fringes ?? [], phases: draft.phases ?? [],
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, newRef.id), {
        name: newName, updatedAt: now, status: "draft", sentToProjectName: null,
      });
      for (const account of accounts) {
        const newAccountRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts`), {
          code: account.code, description: account.description, category: account.category, createdAt: Timestamp.now(),
        });
        for (const line of linesByAccount[account.id] || []) {
          await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newAccountRef.id}/detailLines`), {
            code: line.code, description: line.description, units: line.units, unit: line.unit || "",
            multiplier: line.multiplier, rate: line.rate, total: line.total, createdAt: Timestamp.now(),
          });
        }
      }
      router.push(`/budgeting/${newRef.id}`);
    } catch (e) {
      console.error("[Budgeting] Error duplicando borrador:", e);
    } finally {
      setDuplicating(false);
    }
  };

  const handleExport = () => {
    if (!draft) return;
    const fwb = buildFwbFromDraft({
      name: draft.name,
      currency: draft.currency,
      categoriesEnabled: catEnabled,
      categories: cats,
      accountsByCategory: (categoryId) => (catEnabled ? accountsByCategory(categoryId as string) : accounts).map((a) => ({ id: a.id, code: a.code, description: a.description })),
      linesByAccount,
    });
    downloadFwb(fwb, draft.name.replace(/[^\w\-]+/g, "_"));
  };

  // ── Accounts ─────────────────────────────────────────────────────────────
  const openCreateAccount = (category: string | null) => {
    setAccountForm({ code: "", description: "" });
    setAccountModal({ category, account: null });
  };

  const openEditAccount = (account: BudgetingAccount) => {
    setAccountForm({ code: account.code, description: account.description });
    setAccountModal({ category: account.category, account });
  };

  const handleSaveAccount = async () => {
    if (!accountModal || !accountForm.code.trim() || !accountForm.description.trim()) return;
    setSaving(true);
    try {
      if (accountModal.account) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, accountModal.account.id), {
          code: accountForm.code.trim(), description: accountForm.description.trim(),
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), {
          code: accountForm.code.trim(), description: accountForm.description.trim(),
          category: accountModal.category, createdAt: Timestamp.now(),
        });
      }
      await touchDraft();
      setAccountModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const lines = linesByAccount[deleteTarget.accountId] || [];
      await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.accountId}/detailLines`, l.id))));
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, deleteTarget.accountId));
      await touchDraft();
      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

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

  const colsTop = "grid-cols-[44px_1fr_90px_150px]";
  const colsAccount = "grid-cols-[44px_1fr_100px_60px]";

  const AccountRow = ({ account }: { account: BudgetingAccount }) => (
    <div className={`grid ${colsAccount} gap-2 items-center pl-11 pr-3 py-2.5 hover:bg-white group`}>
      <span />
      <Link href={`/budgeting/${draftId}/accounts/${account.id}`} className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-slate-800 truncate hover:text-[#5B57E0] transition-colors">{account.description}</span>
        <span className="text-xs text-slate-400 font-mono flex-shrink-0">{account.code}</span>
      </Link>
      <span className="text-sm font-medium text-slate-700 text-right rounded-lg px-2 py-0.5 justify-self-end bg-slate-50">
        {fmt(accountTotal(account.id))}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-self-end">
        <button onClick={() => openEditAccount(account)} className={`p-1.5 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar cuenta">
          <Pencil size={12} />
        </button>
        <button
          onClick={() => setDeleteTarget({ accountId: account.id, label: account.description })}
          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Borrar cuenta"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="w-full px-10 py-8">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-lg font-semibold text-slate-900">Top Sheet</h1>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold text-slate-900">{fmt(grandTotal)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleExport} className={`p-2 rounded-lg ${ICON_BTN_LIGHT}`} title="Descargar .fwb">
              <Download size={15} />
            </button>
            <button onClick={handleDuplicateDraft} disabled={duplicating} className={`p-2 rounded-lg ${ICON_BTN_LIGHT} disabled:opacity-50`} title="Duplicar presupuesto">
              <Copy size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Top Sheet */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {catEnabled ? (
          <>
            <div className={`grid ${colsTop} gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
              <span>#</span>
              <span>Categoría</span>
              <span className="text-right">Cuentas</span>
              <span className="text-right">Total</span>
            </div>

            {cats.map((cat, catIdx) => {
              const catAccounts = accountsByCategory(cat.id);
              const isOpen = expandedCategories.has(cat.id);
              return (
                <div key={cat.id} className="border-b border-slate-100 last:border-0">
                  <button onClick={() => toggleCategory(cat.id)} className={`w-full grid ${colsTop} gap-2 items-center px-5 py-3.5 hover:bg-slate-50 transition-colors text-left`}>
                    <span className="text-xs font-mono text-slate-400">{String(catIdx + 1).padStart(2, "0")}</span>
                    <span className="flex items-center gap-2 min-w-0">
                      <ChevronDown size={13} className={`text-slate-400 transition-transform flex-shrink-0 ${isOpen ? "" : "-rotate-90"}`} />
                      <span className="text-sm font-semibold text-slate-900 truncate">{cat.label}</span>
                    </span>
                    <span className="text-xs text-slate-400 text-right">{catAccounts.length}</span>
                    <span className="text-sm font-semibold text-slate-900 text-right rounded-lg px-2.5 py-1 justify-self-end bg-slate-50">
                      {fmt(categoryTotal(cat.id))}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="bg-slate-50/60 border-t border-slate-100">
                      {catAccounts.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-5">Sin cuentas en esta categoría todavía</p>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {catAccounts.map((account) => <AccountRow key={account.id} account={account} />)}
                        </div>
                      )}
                      <div className="pl-11 pr-5 py-3">
                        <button
                          onClick={() => openCreateAccount(cat.id)}
                          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${BTN_LIGHT}`}
                        >
                          <Plus size={13} />
                          Añadir cuenta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className={`grid ${colsTop} gap-2 items-center px-5 py-3.5 border-t border-slate-200 bg-slate-50`}>
              <span />
              <span className="text-sm font-bold text-slate-900">Total</span>
              <span />
              <span className="text-base font-bold text-slate-900 text-right justify-self-end">{fmt(grandTotal)}</span>
            </div>
          </>
        ) : (
          <>
            <div className={`grid ${colsAccount} gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
              <span />
              <span>Cuenta</span>
              <span className="text-right">Total</span>
              <span></span>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-5">Sin cuentas todavía</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {accounts.map((account) => <AccountRow key={account.id} account={account} />)}
              </div>
            )}
            <div className="px-5 py-3 border-t border-slate-100">
              <button onClick={() => openCreateAccount(null)} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${BTN_LIGHT}`}>
                <Plus size={13} />
                Añadir cuenta
              </button>
            </div>
            <div className={`grid ${colsAccount} gap-2 items-center px-5 py-3.5 border-t border-slate-200 bg-slate-50`}>
              <span />
              <span className="text-sm font-bold text-slate-900">Total</span>
              <span className="text-base font-bold text-slate-900 text-right justify-self-end">{fmt(grandTotal)}</span>
              <span />
            </div>
          </>
        )}
      </div>

      {/* ── Account modal ────────────────────────────────────────────────── */}
      {accountModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{accountModal.account ? "Editar cuenta" : "Nueva cuenta"}</h3>
              <button onClick={() => setAccountModal(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Código</label>
                <input
                  value={accountForm.code}
                  onChange={(e) => setAccountForm((p) => ({ ...p, code: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Descripción</label>
                <input
                  autoFocus
                  value={accountForm.description}
                  onChange={(e) => setAccountForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              {catEnabled && accountModal.category && (
                <p className="text-xs text-slate-400">{cats.find((c) => c.id === accountModal.category)?.label}</p>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setAccountModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSaveAccount}
                disabled={!accountForm.code.trim() || !accountForm.description.trim() || saving}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
              >
                {saving ? "Guardando..." : accountModal.account ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar cuenta "{deleteTarget.label}"</h3>
            <p className="text-xs text-slate-500 mb-4">Se borrarán también todas sus líneas de detalle. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
