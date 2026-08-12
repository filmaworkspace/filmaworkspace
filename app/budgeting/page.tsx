"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, Timestamp,
} from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { Check, FileUp, LayoutTemplate, Plus, Search, Trash2, X } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { BTN_LIGHT, BudgetingDraftIndex, BudgetingTemplate, CURRENCIES, DEFAULT_CATEGORIES } from "@/lib/budgeting";
import { FwbFile, parseFwbText } from "@/lib/budgetingExport";
import BudgetingDropdown from "@/components/BudgetingDropdown";

// ─────────────────────────────────────────────────────────────────────────────

function relativeTime(ts: Timestamp | null): string {
  if (!ts) return "";
  const diffMs = Date.now() - ts.toDate().getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "justo ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d}d`;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(ts.toDate());
}

export default function BudgetingHomePage() {
  const { user } = useUser();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [drafts, setDrafts] = useState<BudgetingDraftIndex[]>([]);
  const [search, setSearch] = useState("");
  const [showNewDraft, setShowNewDraft] = useState(false);
  const [newDraftName, setNewDraftName] = useState("");
  const [newDraftCurrency, setNewDraftCurrency] = useState("EUR");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<BudgetingDraftIndex | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Plantillas guardadas: estructuras reutilizables para arrancar un borrador ya montado
  const [templates, setTemplates] = useState<BudgetingTemplate[]>([]);
  const [templatesPanelOpen, setTemplatesPanelOpen] = useState(false);
  const templatesPanelRef = useRef<HTMLDivElement>(null);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<BudgetingTemplate | null>(null);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `userBudgetingDrafts/${user.uid}/drafts`), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setDrafts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingDraftIndex)));
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `userBudgetingTemplates/${user.uid}/templates`), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setTemplates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetingTemplate)));
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (templatesPanelRef.current && !templatesPanelRef.current.contains(e.target as Node)) setTemplatesPanelOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
        currency: newDraftCurrency,
        createdAt: now,
        updatedAt: now,
        sentToProjectId: null,
        sentToProjectName: null,
        sentAt: null,
        categoriesEnabled: true,
        categories: DEFAULT_CATEGORIES,
        globals: [],
        fringes: [],
        phases: [],
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

  /** Crea un borrador nuevo a partir de un árbol .fwb, venga de un archivo cargado o de una plantilla guardada. */
  const createDraftFromFwb = async (fwb: FwbFile, fallbackName: string): Promise<string> => {
    if (!user) throw new Error("Sin sesión");
    const name = fwb.name?.trim() || fallbackName;
    const ref = doc(collection(db, "budgetingDrafts"));
    const now = serverTimestamp();
    const categories = fwb.categories.map((c) => ({ id: c.id, code: c.code, label: c.label }));
    await setDoc(ref, {
      name,
      ownerUid: user.uid,
      ownerName: user.name,
      currency: fwb.currency || "EUR",
      createdAt: now,
      updatedAt: now,
      sentToProjectId: null,
      sentToProjectName: null,
      sentAt: null,
      categoriesEnabled: fwb.categoriesEnabled,
      categories,
      globals: [],
      fringes: [],
      phases: [],
    });
    await setDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, ref.id), {
      name, updatedAt: now, status: "draft", sentToProjectName: null,
    });
    for (const block of fwb.categories) {
      for (const chapter of block.chapters) {
        const chapterRef = await addDoc(collection(db, `budgetingDrafts/${ref.id}/accounts`), {
          code: chapter.code,
          description: chapter.description,
          category: fwb.categoriesEnabled ? block.id : null,
          createdAt: Timestamp.now(),
        });
        for (const sub of chapter.subchapters || []) {
          const subRef = await addDoc(collection(db, `budgetingDrafts/${ref.id}/accounts/${chapterRef.id}/subchapters`), {
            code: sub.code, description: sub.description, createdAt: Timestamp.now(),
          });
          for (const line of sub.detailLines || []) {
            await addDoc(collection(db, `budgetingDrafts/${ref.id}/accounts/${chapterRef.id}/subchapters/${subRef.id}/detailLines`), {
              code: line.code, description: line.description, units: line.units, unit: line.unit || "",
              multiplier: line.multiplier, rate: line.rate, total: line.total,
              notes: line.notes || "", tags: line.tags || [],
              createdAt: Timestamp.now(),
            });
          }
        }
      }
    }
    return ref.id;
  };

  const handleImportFwb = async (file: File) => {
    if (!user) return;
    setImporting(true);
    setImportError("");
    try {
      const text = await file.text();
      const fwb = parseFwbText(text);
      const draftId = await createDraftFromFwb(fwb, file.name.replace(/\.fwb$/i, ""));
      router.push(`/budgeting/${draftId}`);
    } catch (e: any) {
      setImportError(e?.message || "No se pudo cargar el archivo .fwb");
    } finally {
      setImporting(false);
    }
  };

  const handleUseTemplate = async (template: BudgetingTemplate) => {
    if (!user || !template.structure) return;
    setApplyingTemplateId(template.id);
    try {
      const draftId = await createDraftFromFwb(template.structure, template.name);
      router.push(`/budgeting/${draftId}`);
    } catch (e) {
      console.error("[Budgeting] Error creando borrador desde plantilla:", e);
    } finally {
      setApplyingTemplateId(null);
      setTemplatesPanelOpen(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteTemplateTarget || !user) return;
    await deleteDoc(doc(db, `userBudgetingTemplates/${user.uid}/templates`, deleteTemplateTarget.id));
    setDeleteTemplateTarget(null);
  };

  const handleDeleteDraft = async () => {
    if (!deleteTarget || !user) return;
    setDeleting(true);
    try {
      await Promise.all([
        deleteDoc(doc(db, "budgetingDrafts", deleteTarget.id)),
        deleteDoc(doc(db, `userBudgetingDrafts/${user.uid}/drafts`, deleteTarget.id)),
      ]);
      setDeleteTarget(null);
    } catch (e) {
      console.error("[Budgeting] Error borrando borrador:", e);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen px-10 py-8" style={{ background: "linear-gradient(180deg, #8DA7BE14, #ffffff 55%)" }}>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "#1D201F" }}>Presupuestos</h1>

      <div className="flex items-center gap-2 mb-8 flex-wrap">
        <button onClick={() => setShowNewDraft(true)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${BTN_LIGHT}`}>
          <Plus size={12} />
          Nuevo presupuesto
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${BTN_LIGHT}`}
        >
          <FileUp size={12} />
          {importing ? "Cargando..." : "Cargar .fwb"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".fwb"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFwb(f); e.target.value = ""; }}
        />
        {templates.length > 0 && (
          <div ref={templatesPanelRef} className="relative">
            <button
              onClick={() => setTemplatesPanelOpen((o) => !o)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${BTN_LIGHT}`}
            >
              <LayoutTemplate size={12} />
              Plantillas
            </button>
            {templatesPanelOpen && (
              <div className="absolute z-30 top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 max-h-80 overflow-y-auto">
                {templates.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 group">
                    <button
                      onClick={() => handleUseTemplate(t)}
                      disabled={applyingTemplateId === t.id}
                      className="flex-1 min-w-0 text-left disabled:opacity-50"
                    >
                      <p className="text-xs font-medium text-slate-800 truncate">{t.name}</p>
                      <p className="text-[10px] text-slate-400">{t.chapterCount} capítulos · {t.lineCount} líneas</p>
                    </button>
                    {applyingTemplateId === t.id ? (
                      <span className="text-[10px] text-slate-400 flex-shrink-0">Creando...</span>
                    ) : (
                      <button
                        onClick={() => setDeleteTemplateTarget(t)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 rounded transition-opacity flex-shrink-0"
                        title="Borrar plantilla"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="relative ml-auto w-56">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300"
          />
        </div>
      </div>

      {importError && (
        <p className="text-xs text-red-600 mb-4">{importError}</p>
      )}

      {filteredDrafts.length === 0 ? (
        <p className="text-sm text-slate-400">
          {drafts.length === 0 ? "Sin presupuestos todavía." : "Sin resultados."}
        </p>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {filteredDrafts.map((d) => (
            <div key={d.id} className="group">
              <Link
                href={`/budgeting/${d.id}`}
                className="relative block h-28 rounded-2xl border border-slate-200 bg-white/70 hover:border-[#8DA7BE] transition-colors flex items-center justify-center px-4 overflow-hidden"
              >
                {d.status === "sent" && (
                  <span className="absolute top-2.5 right-2.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-medium">
                    <Check size={9} />
                  </span>
                )}
                <span className="text-base font-bold text-center line-clamp-2" style={{ color: "#1D201F" }}>{d.name}</span>
              </Link>
              <div className="flex items-center justify-between mt-2 px-0.5">
                <p className="text-xs text-slate-400 truncate">
                  {d.status === "sent" && d.sentToProjectName ? `Enviado a ${d.sentToProjectName}` : `Editado ${relativeTime(d.updatedAt)}`}
                </p>
                <button
                  onClick={() => setDeleteTarget(d)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 rounded-md transition-opacity flex-shrink-0"
                  title="Borrar borrador"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Nombre</label>
                <input
                  type="text"
                  value={newDraftName}
                  onChange={(e) => setNewDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateDraft(); }}
                  autoFocus
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1.5">Moneda</label>
                <BudgetingDropdown
                  value={newDraftCurrency}
                  options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
                  onChange={setNewDraftCurrency}
                  buttonClassName="flex items-center justify-between gap-2 w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm bg-white hover:border-slate-300 transition-colors"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex gap-2">
              <button onClick={() => setShowNewDraft(false)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleCreateDraft}
                disabled={!newDraftName.trim() || creating}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 ${BTN_LIGHT}`}
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

      {/* ── Delete template confirm modal ───────────────────────────────── */}
      {deleteTemplateTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1.5">Borrar plantilla "{deleteTemplateTarget.name}"</h3>
            <p className="text-xs text-slate-500 mb-4">Esta acción no se puede deshacer. Los presupuestos ya creados desde ella no se ven afectados.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTemplateTarget(null)} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                onClick={handleDeleteTemplate}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
