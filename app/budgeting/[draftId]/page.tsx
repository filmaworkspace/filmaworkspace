"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot,
  query, serverTimestamp, setDoc, Timestamp, updateDoc,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, Check, ChevronRight, Copy, Download, Hash, Layers, Pencil, Plus, Send, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingDraft, BudgetingCategoryDef, BudgetingAccount, BudgetingDetailLine,
  categoriesEnabled, resolveCategories, fmtCurrency, ICON_BTN_LIGHT,
} from "@/lib/budgeting";
import { buildFwbFromDraft, downloadFwb } from "@/lib/budgetingExport";

// ─────────────────────────────────────────────────────────────────────────────

type DeleteTarget = { accountId: string; label: string };
type EligibleProject = { id: string; name: string };

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

  const [accountModal, setAccountModal] = useState<{ category: string | null; account: BudgetingAccount | null } | null>(null);
  const [accountForm, setAccountForm] = useState({ code: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Enviar a proyecto
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendStep, setSendStep] = useState<"pick" | "confirm" | "done">("pick");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [eligibleProjects, setEligibleProjects] = useState<EligibleProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<EligibleProject | null>(null);
  const [projectStatus, setProjectStatus] = useState<Record<string, "checking" | "empty" | "occupied">>({});
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

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
  const totalLines = Object.values(linesByAccount).reduce((s, lines) => s + lines.length, 0);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);

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

  // ── Enviar a proyecto ────────────────────────────────────────────────────
  const openSendModal = async () => {
    setShowSendModal(true);
    setSendStep("pick");
    setSelectedProject(null);
    setSendError("");
    if (!user) return;
    setLoadingProjects(true);
    try {
      const upSnap = await getDocs(collection(db, `userProjects/${user.uid}/projects`));
      const eligible: EligibleProject[] = [];
      for (const d of upSnap.docs) {
        const data = d.data();
        if (!data.permissions?.accounting) continue;
        const projSnap = await getDoc(doc(db, "projects", d.id));
        if (projSnap.exists()) eligible.push({ id: d.id, name: projSnap.data().name || "Proyecto" });
      }
      setEligibleProjects(eligible);
    } finally {
      setLoadingProjects(false);
    }
  };

  const handlePickProject = async (project: EligibleProject) => {
    setSelectedProject(project);
    setProjectStatus((p) => ({ ...p, [project.id]: "checking" }));
    const [accSnap, posSnap, invSnap] = await Promise.all([
      getDocs(query(collection(db, `projects/${project.id}/accounts`), limit(1))),
      getDocs(query(collection(db, `projects/${project.id}/pos`), limit(1))),
      getDocs(query(collection(db, `projects/${project.id}/invoices`), limit(1))),
    ]);
    const empty = accSnap.empty && posSnap.empty && invSnap.empty;
    setProjectStatus((p) => ({ ...p, [project.id]: empty ? "empty" : "occupied" }));
    if (empty) setSendStep("confirm");
  };

  const handleSendToProject = async () => {
    if (!selectedProject || !draft || !user) return;
    setSending(true);
    setSendError("");
    try {
      for (const account of accounts) {
        const accountRef = await addDoc(collection(db, `projects/${selectedProject.id}/accounts`), {
          code: account.code, description: account.description, createdAt: Timestamp.now(), createdBy: user.uid,
        });
        for (const line of linesByAccount[account.id] || []) {
          await addDoc(collection(db, `projects/${selectedProject.id}/accounts/${accountRef.id}/subaccounts`), {
            code: line.code, description: line.description, budgeted: line.total || 0,
            committed: 0, actual: 0, accountId: accountRef.id, createdAt: Timestamp.now(), createdBy: user.uid,
          });
        }
      }
      const now = serverTimestamp();
      await updateDoc(doc(db, "budgetingDrafts", draftId), {
        sentToProjectId: selectedProject.id, sentToProjectName: selectedProject.name, sentAt: now, updatedAt: now,
      });
      await updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), {
        status: "sent", sentToProjectName: selectedProject.name, updatedAt: now,
      });
      setSendStep("done");
    } catch (e: any) {
      setSendError(e?.message || "Error al enviar el presupuesto");
    } finally {
      setSending(false);
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

  const colsTop = "grid-cols-[36px_1fr_80px_130px]";
  const colsAccount = "grid-cols-[36px_1fr_100px_84px]";

  const AccountRow = ({ account }: { account: BudgetingAccount }) => (
    <Link
      href={`/budgeting/${draftId}/accounts/${account.id}`}
      className={`grid ${colsAccount} gap-2 items-center pl-9 pr-3 py-2.5 hover:bg-white group`}
    >
      <span />
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-slate-800 truncate group-hover:text-[#5B57E0] transition-colors">{account.description}</span>
        <span className="text-xs text-slate-400 font-mono flex-shrink-0">{account.code}</span>
      </span>
      <span className="text-sm font-medium text-slate-700 text-right justify-self-end">{fmt(accountTotal(account.id))}</span>
      <span className="flex items-center justify-end gap-0.5 flex-shrink-0">
        <span
          onClick={(e) => { e.preventDefault(); openEditAccount(account); }}
          className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity ${ICON_BTN_LIGHT}`}
          title="Editar cuenta"
        >
          <Pencil size={12} />
        </span>
        <span
          onClick={(e) => { e.preventDefault(); setDeleteTarget({ accountId: account.id, label: account.description }); }}
          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          title="Borrar cuenta"
        >
          <Trash2 size={12} />
        </span>
        <ChevronRight size={14} className="text-slate-300 group-hover:text-[#5B57E0] group-hover:translate-x-0.5 transition-all" />
      </span>
    </Link>
  );

  return (
    <div className="w-full px-10 py-8">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-sm font-semibold text-slate-500">{draft.name}</h1>
        <div className="flex items-center gap-4 flex-shrink-0">
          {draft.sentToProjectId && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
              <Check size={10} /> Enviado a {draft.sentToProjectName}
            </span>
          )}
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
            <button onClick={openSendModal} className={`p-2 rounded-lg ${ICON_BTN_LIGHT}`} title="Enviar a proyecto">
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Top Sheet */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        {catEnabled ? (
          <>
            <div className={`grid ${colsTop} gap-2 px-5 py-2 border-b border-slate-100 text-xs text-slate-400`}>
              <span className="flex items-center"><Hash size={11} /></span>
              <span className="flex items-center gap-1.5"><Layers size={11} /> Categoría</span>
              <span className="text-right">Cuentas</span>
              <span className="text-right">Total</span>
            </div>

            {cats.map((cat, catIdx) => {
              const catAccounts = accountsByCategory(cat.id);
              return (
                <div key={cat.id} className="border-b border-slate-100 last:border-0">
                  <div className={`grid ${colsTop} gap-2 items-center px-5 py-2.5`}>
                    <span className="text-xs font-mono text-slate-400">{String(catIdx + 1).padStart(2, "0")}</span>
                    <span className="text-sm font-semibold text-slate-900 truncate">{cat.label}</span>
                    <span className="text-xs text-slate-400 text-right">{catAccounts.length}</span>
                    <span className="text-sm font-semibold text-slate-900 text-right justify-self-end">{fmt(categoryTotal(cat.id))}</span>
                  </div>

                  <div>
                    {catAccounts.length === 0 ? (
                      <p className="text-xs text-slate-400 pl-9 py-2">Sin cuentas en esta categoría todavía</p>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {catAccounts.map((account) => <AccountRow key={account.id} account={account} />)}
                      </div>
                    )}
                    <div className="pl-9 pr-5 py-2">
                      <button
                        onClick={() => openCreateAccount(cat.id)}
                        className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}
                      >
                        <Plus size={12} />
                        Añadir cuenta
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className={`grid ${colsTop} gap-2 items-center px-5 py-3 border-t border-slate-200`}>
              <span />
              <span className="text-sm font-bold text-slate-900">Total</span>
              <span />
              <span className="text-sm font-bold text-slate-900 text-right justify-self-end">{fmt(grandTotal)}</span>
            </div>
          </>
        ) : (
          <>
            <div className={`grid ${colsAccount} gap-2 px-5 py-2 border-b border-slate-100 text-xs text-slate-400`}>
              <span />
              <span>Cuenta</span>
              <span className="text-right">Total</span>
              <span></span>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-5">Sin cuentas todavía</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {accounts.map((account) => <AccountRow key={account.id} account={account} />)}
              </div>
            )}
            <div className="px-5 py-2.5 border-t border-slate-100">
              <button onClick={() => openCreateAccount(null)} className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg ${BTN_LIGHT}`}>
                <Plus size={12} />
                Añadir cuenta
              </button>
            </div>
            <div className={`grid ${colsAccount} gap-2 items-center px-5 py-3 border-t border-slate-200`}>
              <span />
              <span className="text-sm font-bold text-slate-900">Total</span>
              <span className="text-sm font-bold text-slate-900 text-right justify-self-end">{fmt(grandTotal)}</span>
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

      {/* ── Send to project modal ────────────────────────────────────────── */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">
                {sendStep === "pick" && "Enviar a proyecto"}
                {sendStep === "confirm" && "Confirmar envío"}
                {sendStep === "done" && "Enviado"}
              </h3>
              <button onClick={() => setShowSendModal(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
                <X size={15} />
              </button>
            </div>

            {sendStep === "pick" && (
              <div className="px-5 py-4">
                {loadingProjects ? (
                  <p className="text-xs text-slate-400 text-center py-6">Cargando proyectos...</p>
                ) : eligibleProjects.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No tienes proyectos con acceso a Accounting.</p>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {eligibleProjects.map((p) => {
                      const status = projectStatus[p.id];
                      return (
                        <button
                          key={p.id}
                          onClick={() => handlePickProject(p)}
                          disabled={status === "checking"}
                          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 border border-slate-200 rounded-xl text-left hover:border-[#5B57E0] transition-colors disabled:opacity-60"
                        >
                          <span className="text-sm text-slate-800 truncate">{p.name}</span>
                          {status === "checking" && <span className="text-[11px] text-slate-400 flex-shrink-0">Comprobando...</span>}
                          {status === "occupied" && <span className="text-[11px] text-amber-600 flex-shrink-0">Ya tiene actividad</span>}
                        </button>
                      );
                    })}
                    {Object.values(projectStatus).includes("occupied") && (
                      <p className="text-[11px] text-slate-400 pt-1">
                        Los proyectos con actividad en Accounting no se pueden rellenar así — contacta con el equipo de Filma Workspace para cargarlo.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {sendStep === "confirm" && selectedProject && (
              <div className="px-5 py-4 space-y-4">
                <p className="text-sm text-slate-600">
                  Se creará el presupuesto en <span className="font-medium text-slate-900">{selectedProject.name}</span>:
                </p>
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Cuentas</span>
                    <span className="font-medium text-slate-900">{accounts.length}</span>
                  </div>
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Detail lines</span>
                    <span className="font-medium text-slate-900">{totalLines}</span>
                  </div>
                  <div className="flex items-center justify-between px-3.5 py-2 text-sm">
                    <span className="text-slate-500">Total</span>
                    <span className="font-semibold text-slate-900">{fmt(grandTotal)}</span>
                  </div>
                </div>
                {sendError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} />
                    {sendError}
                  </div>
                )}
              </div>
            )}

            {sendStep === "done" && (
              <div className="px-5 py-8 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                  <Check size={18} className="text-emerald-600" />
                </div>
                <p className="text-sm text-slate-700">Enviado a {selectedProject?.name}</p>
              </div>
            )}

            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              {sendStep === "confirm" && (
                <>
                  <button onClick={() => setSendStep("pick")} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Volver
                  </button>
                  <button
                    onClick={handleSendToProject}
                    disabled={sending}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
                  >
                    {sending ? "Enviando..." : "Confirmar"}
                  </button>
                </>
              )}
              {(sendStep === "pick" || sendStep === "done") && (
                <button onClick={() => setShowSendModal(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
