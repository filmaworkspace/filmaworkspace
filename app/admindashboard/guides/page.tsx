"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db } from "@/lib/firebase";
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Megaphone,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { Guide, GUIDE_CATEGORIES } from "@/lib/guides";

// ─────────────────────────────────────────────────────────────────────────────

export default function GuidesListPage() {
  const router = useRouter();
  const { user: contextUser, isLoading: userLoading } = useUser();
  const isAdmin = contextUser?.role === "admin";
  const isSupportAgent = contextUser?.role === "support_agent";
  const hasAccess = isAdmin || isSupportAgent;

  const [guides, setGuides] = useState<Guide[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Guide | null>(null);
  const [announceTarget, setAnnounceTarget] = useState<Guide | null>(null);
  const [announcing, setAnnouncing] = useState(false);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!userLoading && !hasAccess) router.push("/dashboard");
  }, [userLoading, hasAccess, router]);

  useEffect(() => {
    if (!hasAccess) return;
    const q = query(collection(db, "guides"), orderBy("updatedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setGuides(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Guide)));
      setLoading(false);
    });
    return () => unsub();
  }, [isAdmin]);

  const togglePublished = async (guide: Guide) => {
    try {
      await updateDoc(doc(db, "guides", guide.id), { published: !guide.published });
      showToast("success", guide.published ? "Guía pasada a borrador" : "Guía publicada");
    } catch {
      showToast("error", "Error al actualizar");
    }
  };

  const copyLink = (guide: Guide) => {
    const url = `${window.location.origin}/guias/${guide.slug}`;
    navigator.clipboard.writeText(url);
    showToast("success", "Link copiado");
  };

  // No hay (todavía) un registro de quién ha visto cada guía, solo el
  // contador agregado de `views` — así que el aviso va a todos los usuarios,
  // no solo a quien no la haya abierto. Sigue siendo mucho mejor que
  // publicar una guía nueva y que nadie se entere.
  const handleAnnounceGuide = async (guide: Guide) => {
    setAnnouncing(true);
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const emails = usersSnap.docs.map((d) => d.data().email).filter((e): e is string => !!e);
      const url = `${window.location.origin}/guias/${guide.slug}`;
      const idToken = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/send-broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ to: emails, content: `Nueva guía disponible: "${guide.title}"\n\n${url}` }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Error al enviar");
      showToast("success", `Aviso enviado a ${body.sent ?? emails.length} usuarios`);
      setAnnounceTarget(null);
    } catch (err: any) {
      showToast("error", err.message || "Error al enviar el aviso");
    } finally {
      setAnnouncing(false);
    }
  };

  const doDelete = async (guide: Guide) => {
    try {
      await deleteDoc(doc(db, "guides", guide.id));
      showToast("success", "Guía eliminada");
      setConfirmDelete(null);
    } catch {
      showToast("error", "Error al eliminar");
    }
  };

  const filtered = guides.filter((g) => {
    const matchesSearch = g.title.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || g.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const publishedCount = guides.filter((g) => g.published).length;
  const totalViews = guides.reduce((acc, g) => acc + (g.views || 0), 0);

  const formatDate = (ts: Guide["updatedAt"]) =>
    ts && typeof (ts as any).toDate === "function"
      ? (ts as any).toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

  if (userLoading || loading) {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess) return null;

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-4 z-50">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white`}>
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      <div className="mt-[53px] flex items-stretch" style={{ minHeight: "calc(100vh - 53px)" }}>
        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 bg-slate-950 border-r border-slate-800/60 flex flex-col">
          <div className="px-5 py-5 border-b border-slate-800/60">
            <Link
              href="/admindashboard"
              className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 mb-3 font-mono"
            >
              <ArrowLeft size={12} />
              admin.console
            </Link>
            <h1 className="text-white font-bold text-base leading-tight">Guías</h1>
            <p className="font-mono text-[10px] text-slate-500 mt-1">base de conocimiento</p>
          </div>
          <div className="flex-1 px-2.5 py-4">
            <div className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-slate-800/80 text-white relative">
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-400" />
              <BookOpen size={15} className="text-emerald-400" />
              <span className="flex-1 text-left">Guías</span>
            </div>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 bg-slate-50/60 flex flex-col">
          <div className="px-8 py-5 bg-white border-b border-slate-200">
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
              <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white">
                <span className="inline-flex w-7 h-7 rounded-lg items-center justify-center mb-2 text-blue-600 bg-blue-50"><FileText size={14} /></span>
                <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">{guides.length}</p>
                <p className="text-[11px] text-slate-500 mt-1.5">Guías totales</p>
              </div>
              <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white">
                <span className="inline-flex w-7 h-7 rounded-lg items-center justify-center mb-2 text-emerald-600 bg-emerald-50"><Eye size={14} /></span>
                <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">{publishedCount}</p>
                <p className="text-[11px] text-slate-500 mt-1.5">Publicadas</p>
              </div>
              <div className="border border-slate-200 rounded-xl px-4 py-3 bg-white">
                <span className="inline-flex w-7 h-7 rounded-lg items-center justify-center mb-2 text-violet-600 bg-violet-50"><Eye size={14} /></span>
                <p className="text-2xl font-bold text-slate-900 font-mono tabular-nums leading-none">{totalViews}</p>
                <p className="text-[11px] text-slate-500 mt-1.5">Vistas totales</p>
              </div>
            </div>
          </div>

          <main className="flex-1 px-8 py-6">
            <div className="mb-5">
              <p className="font-mono text-[10px] text-slate-400 tracking-widest uppercase mb-1">// guides</p>
              <h2 className="text-xl font-bold text-slate-900">Guías</h2>
            </div>

            {/* Toolbar */}
            <div className="flex flex-row gap-3 items-center mb-6">
              <div className="relative flex-1 max-w-sm">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar guías"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none text-sm bg-white"
                />
              </div>
              {/* Category Dropdown */}
              <div className="relative" ref={categoryDropdownRef}>
                <button
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-colors min-w-[180px] ${
                    categoryFilter !== "all" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:border-slate-300 text-slate-700 bg-white"
                  }`}
                >
                  <span className="flex-1 text-left truncate">{categoryFilter === "all" ? "Todas las categorías" : categoryFilter}</span>
                  <ChevronDown size={14} className={`transition-transform ${showCategoryDropdown ? "rotate-180" : ""} ${categoryFilter !== "all" ? "text-white" : "text-slate-400"}`} />
                </button>
                {showCategoryDropdown && (
                  <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden min-w-full">
                    <button
                      onClick={() => { setCategoryFilter("all"); setShowCategoryDropdown(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                        categoryFilter === "all" ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      Todas las categorías
                    </button>
                    {GUIDE_CATEGORIES.map((c) => (
                      <button
                        key={c}
                        onClick={() => { setCategoryFilter(c); setShowCategoryDropdown(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors whitespace-nowrap ${
                          categoryFilter === c ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Link
                href="/admindashboard/guides/new"
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium ml-auto"
              >
                <Plus size={14} />
                Nueva guía
              </Link>
            </div>

            {filtered.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-16 text-center">
                <BookOpen size={28} className="text-slate-300 mx-auto mb-3" />
                <h3 className="font-semibold text-slate-900 mb-4">
                  {guides.length === 0 ? "Aún no hay guías" : "No se encontraron guías"}
                </h3>
                {guides.length === 0 && (
                  <Link
                    href="/admindashboard/guides/new"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800"
                  >
                    <Plus size={14} />
                    Crear la primera
                  </Link>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tl-xl">Guía</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Categoría</th>
                      <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Estado</th>
                      <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Vistas</th>
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Actualizada</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider rounded-tr-xl">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((guide) => (
                      <tr key={guide.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 max-w-[320px]">
                          <p className="font-medium text-slate-900 truncate">{guide.title}</p>
                          {guide.summary && <p className="text-xs text-slate-400 truncate">{guide.summary}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg font-medium">{guide.category}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => togglePublished(guide)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                              guide.published ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                            }`}
                          >
                            {guide.published ? <Eye size={10} /> : <EyeOff size={10} />}
                            {guide.published ? "Publicada" : "Borrador"}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-slate-700">{guide.views || 0}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">{formatDate(guide.updatedAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-0.5">
                            {guide.published && (
                              <button
                                onClick={() => setAnnounceTarget(guide)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                title="Avisar a los usuarios por correo"
                              >
                                <Megaphone size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => copyLink(guide)}
                              className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                              title="Copiar link público"
                            >
                              <Copy size={14} />
                            </button>
                            <Link
                              href={`/admindashboard/guides/${guide.id}`}
                              className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                              title="Editar"
                            >
                              <Edit2 size={14} />
                            </Link>
                            {isAdmin && (
                              <button
                                onClick={() => setConfirmDelete(guide)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                title="Eliminar"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">Eliminar &quot;{confirmDelete.title}&quot;</h3>
            <p className="text-sm text-slate-600 mb-6">Esta acción no se puede deshacer. El link público dejará de funcionar.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm">
                Cancelar
              </button>
              <button onClick={() => doDelete(confirmDelete)} className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium text-sm">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {announceTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !announcing && setAnnounceTarget(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 mb-2">Avisar de &quot;{announceTarget.title}&quot;</h3>
            <p className="text-sm text-slate-600 mb-6">
              Se mandará un correo a todos los usuarios de la plataforma con un enlace a esta guía. No hay forma de saber quién ya la ha visto, así que va a todos por igual.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setAnnounceTarget(null)} disabled={announcing} className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium text-sm disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={() => handleAnnounceGuide(announceTarget)} disabled={announcing} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-medium text-sm disabled:opacity-50">
                {announcing && <Loader2 size={14} className="animate-spin" />}
                {announcing ? "Enviando..." : "Enviar aviso"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
