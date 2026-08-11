"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  serverTimestamp, setDoc, Timestamp, updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Calculator, Check, ChevronDown, ChevronRight, Copy, Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BUDGETING_ACCENT, BUDGETING_ACCENT_DARK, BudgetingDraft,
  BudgetCategory, BUDGET_CATEGORIES, CATEGORY_LABELS,
  BudgetingAccount, BudgetingDetailLine, computeLineTotal,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────
// Top Sheet de un borrador: categorías → cuentas → detail lines. Cada Detail
// Line tiene su propio código (el que luego se elige en una PO) y un importe
// calculado con unidades × X × tarifa, en vez de un número escrito a mano.
// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget =
  | { type: "account"; accountId: string; label: string }
  | { type: "line"; accountId: string; lineId: string; label: string };

export default function BudgetingDraftPage() {
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

  const [expandedCategories, setExpandedCategories] = useState<Set<BudgetCategory>>(new Set(BUDGET_CATEGORIES));
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const editingNameRef = useRef(false);
  useEffect(() => { editingNameRef.current = editingName; }, [editingName]);

  const [accountModal, setAccountModal] = useState<{ category: BudgetCategory; account: BudgetingAccount | null } | null>(null);
  const [accountForm, setAccountForm] = useState({ code: "", description: "" });

  const [lineModal, setLineModal] = useState<{ accountId: string; line: BudgetingDetailLine | null } | null>(null);
  const [lineForm, setLineForm] = useState({ code: "", description: "", units: "1", multiplier: "1", rate: "0" });
  const [lineCodeError, setLineCodeError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // ── Load draft ───────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "budgetingDrafts", draftId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() } as BudgetingDraft;
        setDraft(data);
        if (!editingNameRef.current) setNameInput(data.name);
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId]);

  // ── Load accounts ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts`), (snap) => {
      setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingAccount)));
    });
    return () => unsub();
  }, [draftId]);

  // ── Load detail lines — un listener por cuenta, sincronizado con la lista de cuentas ──
  const lineUnsubsRef = useRef<Record<string, () => void>>({});
  useEffect(() => {
    const currentIds = new Set(accounts.map((a) => a.id));
    accounts.forEach((a) => {
      if (lineUnsubsRef.current[a.id]) return;
      const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${a.id}/detailLines`), (snap) => {
        setLinesByAccount((prev) => ({ ...prev, [a.id]: snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)) }));
      });
      lineUnsubsRef.current[a.id] = unsub;
    });
    Object.keys(lineUnsubsRef.current).forEach((accId) => {
      if (!currentIds.has(accId)) {
        lineUnsubsRef.current[accId]();
        delete lineUnsubsRef.current[accId];
        setLinesByAccount((prev) => { const next = { ...prev }; delete next[accId]; return next; });
      }
    });
  }, [accounts, draftId]);

  useEffect(() => {
    return () => { Object.values(lineUnsubsRef.current).forEach((fn) => fn()); };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const accountsByCategory = (cat: BudgetCategory) => accounts.filter((a) => a.category === cat);
  const accountTotal = (accountId: string) => (linesByAccount[accountId] || []).reduce((s, l) => s + (l.total || 0), 0);
  const categoryTotal = (cat: BudgetCategory) => accountsByCategory(cat).reduce((s, a) => s + accountTotal(a.id), 0);
  const grandTotal = BUDGET_CATEGORIES.reduce((s, c) => s + categoryTotal(c), 0);

  const fmt = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: draft?.currency || "EUR", maximumFractionDigits: 0 }).format(n);
  const fmtDecimal = (n: number) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(n);

  const isLineCodeTaken = (code: string, excludeLineId?: string): boolean =>
    Object.values(linesByAccount).some((lines) =>
      lines.some((l) => l.id !== excludeLineId && l.code.trim().toLowerCase() === code.trim().toLowerCase())
    );

  const toggleCategory = (cat: BudgetCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const toggleAccount = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
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

  // ── Draft: rename / duplicate ───────────────────────────────────────────
  const handleRenameDraft = async () => {
    setEditingName(false);
    if (!draft || !user || !nameInput.trim() || nameInput.trim() === draft.name) return;
    const name = nameInput.trim();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { name, updatedAt: serverTimestamp() }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { name, updatedAt: serverTimestamp() }),
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
        name: newName,
        ownerUid: user.uid,
        ownerName: user.name,
        currency: draft.currency,
        createdAt: now,
        updatedAt: now,
        sentToProjectId: null,
        sentToProjectName: null,
        sentAt: null,
      });
      await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, newRef.id), {
        name: newName,
        updatedAt: now,
        status: "draft",
        sentToProjectName: null,
      });
      for (const account of accounts) {
        const newAccountRef = await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts`), {
          code: account.code,
          description: account.description,
          category: account.category,
          createdAt: Timestamp.now(),
        });
        for (const line of linesByAccount[account.id] || []) {
          await addDoc(collection(db, `budgetingDrafts/${newRef.id}/accounts/${newAccountRef.id}/detailLines`), {
            code: line.code,
            description: line.description,
            units: line.units,
            multiplier: line.multiplier,
            rate: line.rate,
            total: line.total,
            createdAt: Timestamp.now(),
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

  // ── Accounts ─────────────────────────────────────────────────────────────
  const openCreateAccount = (category: BudgetCategory) => {
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
          code: accountForm.code.trim(),
          description: accountForm.description.trim(),
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts`), {
          code: accountForm.code.trim(),
          description: accountForm.description.trim(),
          category: accountModal.category,
          createdAt: Timestamp.now(),
        });
      }
      await touchDraft();
      setAccountModal(null);
    } finally {
      setSaving(false);
    }
  };

  // ── Detail lines ─────────────────────────────────────────────────────────
  const openCreateLine = (accountId: string) => {
    setLineForm({ code: "", description: "", units: "1", multiplier: "1", rate: "0" });
    setLineCodeError("");
    setLineModal({ accountId, line: null });
  };

  const openEditLine = (accountId: string, line: BudgetingDetailLine) => {
    setLineForm({ code: line.code, description: line.description, units: String(line.units), multiplier: String(line.multiplier), rate: String(line.rate) });
    setLineCodeError("");
    setLineModal({ accountId, line });
  };

  const lineFormTotal = computeLineTotal(parseFloat(lineForm.units) || 0, parseFloat(lineForm.multiplier) || 0, parseFloat(lineForm.rate) || 0);

  const handleSaveLine = async () => {
    if (!lineModal) return;
    const code = lineForm.code.trim();
    const description = lineForm.description.trim();
    if (!code || !description) return;
    if (isLineCodeTaken(code, lineModal.line?.id)) {
      setLineCodeError("Ese código ya se usa en otra línea de este presupuesto");
      return;
    }
    const units = parseFloat(lineForm.units) || 0;
    const multiplier = parseFloat(lineForm.multiplier) || 0;
    const rate = parseFloat(lineForm.rate) || 0;
    const total = computeLineTotal(units, multiplier, rate);
    setSaving(true);
    try {
      if (lineModal.line) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${lineModal.accountId}/detailLines`, lineModal.line.id), {
          code, description, units, multiplier, rate, total,
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${lineModal.accountId}/detailLines`), {
          code, description, units, multiplier, rate, total, createdAt: Timestamp.now(),
        });
      }
      await touchDraft();
      setLineModal(null);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete (account o line) ─────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.type === "account") {
        const lines = linesByAccount[deleteTarget.accountId] || [];
        await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.accountId}/detailLines`, l.id))));
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, deleteTarget.accountId));
      } else {
        await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${deleteTarget.accountId}/detailLines`, deleteTarget.lineId));
      }
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

  const gradient = `linear-gradient(135deg, #6C64F5, ${BUDGETING_ACCENT_DARK})`;
  const tint = `${BUDGETING_ACCENT}0f`;
  const colsTop = "grid-cols-[44px_1fr_90px_150px]";
  const colsAccount = "grid-cols-[44px_1fr_100px_60px]";
  const colsLine = "grid-cols-[100px_1fr_60px_40px_90px_110px_56px]";

  return (
    <div className="px-10 py-8 max-w-5xl mx-auto">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm" style={{ background: gradient }}>
            <Calculator size={17} className="text-white" />
          </div>
          <div className="min-w-0">
            {editingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleRenameDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") { setNameInput(draft.name); setEditingName(false); }
                }}
                className="text-xl font-semibold text-slate-900 border-b-2 rounded-none focus:outline-none bg-transparent px-0 py-0.5 w-full"
                style={{ borderColor: BUDGETING_ACCENT }}
              />
            ) : (
              <button onClick={() => setEditingName(true)} className="text-xl font-semibold text-slate-900 hover:text-slate-600 transition-colors text-left truncate block max-w-full" title="Renombrar">
                {draft.name}
              </button>
            )}
            {draft.sentToProjectId && (
              <span className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-medium text-emerald-600">
                <Check size={10} /> Enviado a {draft.sentToProjectName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold text-slate-900">{fmt(grandTotal)}</p>
          </div>
          <button
            onClick={handleDuplicateDraft}
            disabled={duplicating}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 shadow-sm hover:shadow-md hover:border-slate-300 transition-all disabled:opacity-50"
          >
            <Copy size={13} />
            {duplicating ? "Duplicando..." : "Duplicar"}
          </button>
        </div>
      </div>

      {/* Top Sheet */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <div className={`grid ${colsTop} gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
          <span>#</span>
          <span>Categoría</span>
          <span className="text-right">Cuentas</span>
          <span className="text-right">Total</span>
        </div>

        {BUDGET_CATEGORIES.map((cat, catIdx) => {
          const catAccounts = accountsByCategory(cat);
          const isOpen = expandedCategories.has(cat);
          return (
            <div key={cat} className="border-b border-slate-100 last:border-0">
              <button onClick={() => toggleCategory(cat)} className={`w-full grid ${colsTop} gap-2 items-center px-5 py-3.5 hover:bg-slate-50 transition-colors text-left`}>
                <span className="text-xs font-mono text-slate-400">{String(catIdx + 1).padStart(2, "0")}</span>
                <span className="flex items-center gap-2 min-w-0">
                  <ChevronDown size={13} className={`text-slate-400 transition-transform flex-shrink-0 ${isOpen ? "" : "-rotate-90"}`} />
                  <span className="text-sm font-semibold text-slate-900 truncate">{CATEGORY_LABELS[cat]}</span>
                </span>
                <span className="text-xs text-slate-400 text-right">{catAccounts.length}</span>
                <span className="text-sm font-semibold text-slate-900 text-right rounded-lg px-2.5 py-1 justify-self-end" style={{ background: tint }}>
                  {fmt(categoryTotal(cat))}
                </span>
              </button>

              {isOpen && (
                <div className="bg-slate-50/60 border-t border-slate-100">
                  {catAccounts.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-5">Sin cuentas en esta categoría todavía</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {catAccounts.map((account) => {
                        const lines = linesByAccount[account.id] || [];
                        const accOpen = expandedAccounts.has(account.id);
                        return (
                          <div key={account.id}>
                            <div className={`grid ${colsAccount} gap-2 items-center pl-11 pr-3 py-2.5 hover:bg-white group`}>
                              <span />
                              <button onClick={() => toggleAccount(account.id)} className="flex items-center gap-2 min-w-0 text-left">
                                <ChevronRight size={12} className={`text-slate-300 transition-transform flex-shrink-0 ${accOpen ? "rotate-90" : ""}`} />
                                <span className="text-sm text-slate-800 truncate">{account.description}</span>
                                <span className="text-xs text-slate-400 font-mono flex-shrink-0">{account.code}</span>
                              </button>
                              <span className="text-sm font-medium text-slate-700 text-right rounded-lg px-2 py-0.5 justify-self-end" style={{ background: tint }}>
                                {fmt(accountTotal(account.id))}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity justify-self-end">
                                <button onClick={() => openEditAccount(account)} className="p-1.5 text-slate-300 hover:text-slate-600 hover:bg-white rounded-lg" title="Editar cuenta">
                                  <Pencil size={12} />
                                </button>
                                <button
                                  onClick={() => setDeleteTarget({ type: "account", accountId: account.id, label: account.description })}
                                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-white rounded-lg"
                                  title="Borrar cuenta"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>

                            {accOpen && (
                              <div className="pl-11 pr-5 pb-3">
                                {lines.length > 0 && (
                                  <div className="mb-2 rounded-xl border border-slate-200 bg-white overflow-hidden overflow-x-auto">
                                    <div className="min-w-[600px]">
                                      <div className={`grid ${colsLine} gap-2 px-3 py-2 border-b border-slate-100 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
                                        <span>Código</span>
                                        <span>Descripción</span>
                                        <span className="text-right">Unid.</span>
                                        <span className="text-right">X</span>
                                        <span className="text-right">Tarifa</span>
                                        <span className="text-right">Total</span>
                                        <span></span>
                                      </div>
                                      {lines.map((line) => (
                                        <div key={line.id} className={`grid ${colsLine} gap-2 px-3 py-2 items-center border-b border-slate-50 last:border-0 hover:bg-slate-50 group/line`}>
                                          <span className="text-xs font-mono text-slate-500 truncate">{line.code}</span>
                                          <span className="text-xs text-slate-800 truncate">{line.description}</span>
                                          <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.units)}</span>
                                          <span className="text-xs text-slate-400 text-right">×{fmtDecimal(line.multiplier)}</span>
                                          <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.rate)}</span>
                                          <span className="text-xs font-semibold text-slate-900 text-right rounded-md px-1.5 py-0.5" style={{ background: tint }}>{fmt(line.total)}</span>
                                          <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover/line:opacity-100 transition-opacity">
                                            <button onClick={() => openEditLine(account.id, line)} className="p-1 text-slate-300 hover:text-slate-600" title="Editar línea">
                                              <Pencil size={11} />
                                            </button>
                                            <button
                                              onClick={() => setDeleteTarget({ type: "line", accountId: account.id, lineId: line.id, label: line.description })}
                                              className="p-1 text-slate-300 hover:text-red-500"
                                              title="Borrar línea"
                                            >
                                              <Trash2 size={11} />
                                            </button>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <button
                                  onClick={() => openCreateLine(account.id)}
                                  className="flex items-center gap-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm hover:shadow transition-all"
                                >
                                  <Plus size={12} />
                                  Añadir línea
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="pl-11 pr-5 py-3">
                    <button
                      onClick={() => openCreateAccount(cat)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white shadow-sm hover:shadow-md hover:brightness-105 transition-all"
                      style={{ background: gradient }}
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

        {/* Grand total footer */}
        <div className={`grid ${colsTop} gap-2 items-center px-5 py-3.5 border-t border-slate-200`} style={{ background: tint }}>
          <span />
          <span className="text-sm font-bold text-slate-900">Total</span>
          <span />
          <span className="text-base font-bold text-slate-900 text-right justify-self-end">{fmt(grandTotal)}</span>
        </div>
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
                  placeholder="Ej: 2100"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Descripción</label>
                <input
                  autoFocus
                  value={accountForm.description}
                  onChange={(e) => setAccountForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Ej: Cámara"
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              <p className="text-xs text-slate-400">{CATEGORY_LABELS[accountModal.category]}</p>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setAccountModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSaveAccount}
                disabled={!accountForm.code.trim() || !accountForm.description.trim() || saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white shadow-sm hover:shadow-md hover:brightness-105 transition-all disabled:opacity-40 disabled:shadow-none"
                style={{ background: gradient }}
              >
                {saving ? "Guardando..." : accountModal.account ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail line modal ────────────────────────────────────────────── */}
      {lineModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">{lineModal.line ? "Editar línea" : "Nueva línea"}</h3>
              <button onClick={() => setLineModal(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Código</label>
                  <input
                    autoFocus
                    value={lineForm.code}
                    onChange={(e) => { setLineForm((p) => ({ ...p, code: e.target.value })); setLineCodeError(""); }}
                    placeholder="Ej: 03-01-0210"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Descripción</label>
                  <input
                    value={lineForm.description}
                    onChange={(e) => setLineForm((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Ej: Alquiler ARRI"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                  />
                </div>
              </div>
              {lineCodeError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle size={12} />
                  {lineCodeError}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Unidades</label>
                  <input type="number" value={lineForm.units} onChange={(e) => setLineForm((p) => ({ ...p, units: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-right focus:outline-none focus:ring-2" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">X</label>
                  <input type="number" value={lineForm.multiplier} onChange={(e) => setLineForm((p) => ({ ...p, multiplier: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-right focus:outline-none focus:ring-2" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Tarifa</label>
                  <input type="number" value={lineForm.rate} onChange={(e) => setLineForm((p) => ({ ...p, rate: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-right focus:outline-none focus:ring-2" />
                </div>
              </div>
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 rounded-xl">
                <span className="text-xs text-slate-500">Total</span>
                <span className="text-sm font-semibold text-slate-900">{fmt(lineFormTotal)}</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setLineModal(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleSaveLine}
                disabled={!lineForm.code.trim() || !lineForm.description.trim() || saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white shadow-sm hover:shadow-md hover:brightness-105 transition-all disabled:opacity-40 disabled:shadow-none"
                style={{ background: gradient }}
              >
                {saving ? "Guardando..." : lineModal.line ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">
              Borrar {deleteTarget.type === "account" ? "cuenta" : "línea"} "{deleteTarget.label}"
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              {deleteTarget.type === "account" ? "Se borrarán también todas sus líneas de detalle. " : ""}
              Esta acción no se puede deshacer.
            </p>
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
