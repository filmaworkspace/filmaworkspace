"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { AlertCircle, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import {
  BTN_LIGHT, BudgetingAccount, BudgetingDetailLine, BudgetingDraft,
  ICON_BTN_LIGHT, UNIT_SUGGESTIONS, computeLineTotal, fmtCurrency, fmtDecimal,
} from "@/lib/budgeting";

// ─────────────────────────────────────────────────────────────────────────────

export default function BudgetingAccountPage() {
  const { draftId, accountId } = useParams() as { draftId: string; accountId: string };
  const { user } = useUser();
  const router = useRouter();

  const [draft, setDraft] = useState<BudgetingDraft | null>(null);
  const [account, setAccount] = useState<BudgetingAccount | null>(null);
  const [lines, setLines] = useState<BudgetingDetailLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editingAccount, setEditingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({ code: "", description: "" });
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState(false);

  const [lineModal, setLineModal] = useState<{ line: BudgetingDetailLine | null } | null>(null);
  const [lineForm, setLineForm] = useState({ code: "", description: "", units: "1", unit: "", multiplier: "1", rate: "0" });
  const [lineCodeError, setLineCodeError] = useState("");
  const [deleteLineTarget, setDeleteLineTarget] = useState<BudgetingDetailLine | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "budgetingDrafts", draftId), (snap) => {
      if (snap.exists()) setDraft({ id: snap.id, ...snap.data() } as BudgetingDraft);
    });
    return () => unsub();
  }, [draftId]);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, `budgetingDrafts/${draftId}/accounts`, accountId),
      (snap) => {
        if (!snap.exists()) { setNotFound(true); setLoading(false); return; }
        const data = { id: snap.id, ...snap.data() } as BudgetingAccount;
        setAccount(data);
        setAccountForm({ code: data.code, description: data.description });
        setLoading(false);
      },
      () => { setNotFound(true); setLoading(false); }
    );
    return () => unsub();
  }, [draftId, accountId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/detailLines`), (snap) => {
      setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDetailLine)));
    });
    return () => unsub();
  }, [draftId, accountId]);

  const currency = draft?.currency || "EUR";
  const fmt = (n: number) => fmtCurrency(n, currency);
  const total = lines.reduce((s, l) => s + (l.total || 0), 0);

  const touchDraft = async () => {
    if (!user) return;
    const now = serverTimestamp();
    await Promise.all([
      updateDoc(doc(db, "budgetingDrafts", draftId), { updatedAt: now }),
      updateDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, draftId), { updatedAt: now }),
    ]);
  };

  const handleSaveAccount = async () => {
    if (!accountForm.code.trim() || !accountForm.description.trim()) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, accountId), {
        code: accountForm.code.trim(), description: accountForm.description.trim(),
      });
      await touchDraft();
      setEditingAccount(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    try {
      await Promise.all(lines.map((l) => deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/detailLines`, l.id))));
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts`, accountId));
      await touchDraft();
      router.push(`/budgeting/${draftId}`);
    } finally {
      setSaving(false);
    }
  };

  const isLineCodeTaken = (code: string, excludeId?: string): boolean =>
    lines.some((l) => l.id !== excludeId && l.code.trim().toLowerCase() === code.trim().toLowerCase());

  const openCreateLine = () => {
    setLineForm({ code: "", description: "", units: "1", unit: "", multiplier: "1", rate: "0" });
    setLineCodeError("");
    setLineModal({ line: null });
  };

  const openEditLine = (line: BudgetingDetailLine) => {
    setLineForm({ code: line.code, description: line.description, units: String(line.units), unit: line.unit || "", multiplier: String(line.multiplier), rate: String(line.rate) });
    setLineCodeError("");
    setLineModal({ line });
  };

  const lineFormTotal = computeLineTotal(parseFloat(lineForm.units) || 0, parseFloat(lineForm.multiplier) || 0, parseFloat(lineForm.rate) || 0);

  const handleSaveLine = async () => {
    if (!lineModal) return;
    const code = lineForm.code.trim();
    const description = lineForm.description.trim();
    if (!code || !description) return;
    if (isLineCodeTaken(code, lineModal.line?.id)) {
      setLineCodeError("Ese código ya se usa en otra línea de esta cuenta");
      return;
    }
    const units = parseFloat(lineForm.units) || 0;
    const multiplier = parseFloat(lineForm.multiplier) || 0;
    const rate = parseFloat(lineForm.rate) || 0;
    const total = computeLineTotal(units, multiplier, rate);
    setSaving(true);
    try {
      if (lineModal.line) {
        await updateDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/detailLines`, lineModal.line.id), {
          code, description, units, unit: lineForm.unit.trim(), multiplier, rate, total,
        });
      } else {
        await addDoc(collection(db, `budgetingDrafts/${draftId}/accounts/${accountId}/detailLines`), {
          code, description, units, unit: lineForm.unit.trim(), multiplier, rate, total, createdAt: Timestamp.now(),
        });
      }
      await touchDraft();
      setLineModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLine = async () => {
    if (!deleteLineTarget) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, `budgetingDrafts/${draftId}/accounts/${accountId}/detailLines`, deleteLineTarget.id));
      await touchDraft();
      setDeleteLineTarget(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !account) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6">
        <AlertCircle size={28} className="text-slate-300" />
        <p className="text-sm text-slate-500">Esta cuenta no existe.</p>
      </div>
    );
  }

  const cols = "grid-cols-[110px_1fr_70px_90px_50px_90px_110px_56px]";

  return (
    <div className="w-full px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm mb-1 text-slate-400">
        <Link href={`/budgeting/${draftId}`} className="hover:text-[#5B57E0] transition-colors">Topsheet</Link>
        <ChevronRight size={13} />
        <span className="text-slate-700 font-medium">{account.code} {account.description}</span>
        <ChevronRight size={13} />
        <span className="text-slate-400">Details</span>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 mt-3 mb-6">
        <div className="min-w-0">
          {editingAccount ? (
            <div className="flex items-center gap-2">
              <input
                value={accountForm.code}
                onChange={(e) => setAccountForm((p) => ({ ...p, code: e.target.value }))}
                className="w-28 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2"
              />
              <input
                autoFocus
                value={accountForm.description}
                onChange={(e) => setAccountForm((p) => ({ ...p, description: e.target.value }))}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2"
              />
              <button onClick={handleSaveAccount} disabled={saving} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${BTN_LIGHT}`}>
                Guardar
              </button>
              <button onClick={() => { setEditingAccount(false); setAccountForm({ code: account.code, description: account.description }); }} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg">
                <X size={15} />
              </button>
            </div>
          ) : (
            <h1 className="text-lg font-semibold text-slate-900 truncate">{account.description}</h1>
          )}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold text-slate-900">{fmt(total)}</p>
          </div>
          {!editingAccount && (
            <div className="flex items-center gap-1">
              <button onClick={() => setEditingAccount(true)} className={`p-2 rounded-lg ${ICON_BTN_LIGHT}`} title="Editar cuenta">
                <Pencil size={15} />
              </button>
              <button onClick={() => setDeleteAccountConfirm(true)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Borrar cuenta">
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail lines table */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`grid ${cols} gap-2 px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-400 uppercase tracking-wider`}>
            <span>Código</span>
            <span>Descripción</span>
            <span className="text-right">Cant.</span>
            <span>Unidad</span>
            <span className="text-right">X</span>
            <span className="text-right">Tarifa</span>
            <span className="text-right">Total</span>
            <span></span>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Sin líneas de detalle todavía</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((line) => (
                <div key={line.id} className={`grid ${cols} gap-2 px-5 py-3 items-center hover:bg-slate-50 group`}>
                  <span className="text-xs font-mono text-slate-500 truncate">{line.code}</span>
                  <span className="text-sm text-slate-800 truncate">{line.description}</span>
                  <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.units)}</span>
                  <span className="text-xs text-slate-400 truncate">{line.unit}</span>
                  <span className="text-xs text-slate-400 text-right">×{fmtDecimal(line.multiplier)}</span>
                  <span className="text-xs text-slate-500 text-right">{fmtDecimal(line.rate)}</span>
                  <span className="text-sm font-semibold text-slate-900 text-right rounded-md px-1.5 py-0.5 bg-slate-50">{fmt(line.total)}</span>
                  <span className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEditLine(line)} className={`p-1 rounded ${ICON_BTN_LIGHT}`} title="Editar línea">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setDeleteLineTarget(line)} className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors" title="Borrar línea">
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <button onClick={openCreateLine} className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${BTN_LIGHT}`}>
          <Plus size={13} />
          Añadir línea
        </button>
      </div>

      {/* ── Line modal ───────────────────────────────────────────────────── */}
      {lineModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
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
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Descripción</label>
                  <input
                    value={lineForm.description}
                    onChange={(e) => setLineForm((p) => ({ ...p, description: e.target.value }))}
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
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Cantidad</label>
                  <input type="number" value={lineForm.units} onChange={(e) => setLineForm((p) => ({ ...p, units: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-right focus:outline-none focus:ring-2" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1.5">Unidad</label>
                  <input
                    list="unit-suggestions"
                    value={lineForm.unit}
                    onChange={(e) => setLineForm((p) => ({ ...p, unit: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                  />
                  <datalist id="unit-suggestions">
                    {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
                  </datalist>
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
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
              >
                {saving ? "Guardando..." : lineModal.line ? "Guardar" : "Crear"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete line confirm ──────────────────────────────────────────── */}
      {deleteLineTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar línea "{deleteLineTarget.description}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteLineTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteLine} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete account confirm ───────────────────────────────────────── */}
      {deleteAccountConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar cuenta "{account.description}"</h3>
            <p className="text-xs text-slate-500 mb-4">Se borrarán también todas sus líneas de detalle. Esta acción no se puede deshacer.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteAccountConfirm(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteAccount} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {saving ? "Borrando..." : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
