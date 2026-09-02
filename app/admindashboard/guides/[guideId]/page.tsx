"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { auth, db, storage } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

// ─── Icons ───────────────────────────────────────────────────────────────────
import {
  ArrowLeft,
  Bold,
  Copy,
  Eye,
  EyeOff,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  Loader2,
  Save,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { useUser } from "@/contexts/UserContext";
import { Guide, GuideBlock, GUIDE_CATEGORIES, GuideCategory, newBlockId, sanitizeInlineHtml, slugify } from "@/lib/guides";

// ─────────────────────────────────────────────────────────────────────────────

export default function GuideEditorPage() {
  const params = useParams();
  const router = useRouter();
  const guideId = params?.guideId as string;
  const isNew = guideId === "new";

  const { user: contextUser, isLoading: userLoading } = useUser();
  const isAdmin = contextUser?.role === "admin";
  const isSupportAgent = contextUser?.role === "support_agent";
  const hasAccess = isAdmin || isSupportAgent;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);

  const docIdRef = useRef<string>(isNew ? doc(collection(db, "guides")).id : guideId);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState<GuideCategory>("General");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [published, setPublished] = useState(false);
  const [blocks, setBlocks] = useState<GuideBlock[]>([]);
  const [existing, setExisting] = useState<Guide | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!userLoading && !hasAccess) router.push("/dashboard");
  }, [userLoading, hasAccess, router]);

  useEffect(() => {
    if (!hasAccess || isNew) return;
    const load = async () => {
      const snap = await getDoc(doc(db, "guides", guideId));
      if (!snap.exists()) {
        showToast("error", "Guía no encontrada");
        router.push("/admindashboard/guides");
        return;
      }
      const data = { id: snap.id, ...snap.data() } as Guide;
      setExisting(data);
      setTitle(data.title || "");
      setSlug(data.slug || "");
      setSummary(data.summary || "");
      setCategory(data.category || "General");
      setCoverImageUrl(data.coverImageUrl || "");
      setPublished(data.published || false);
      setBlocks(data.blocks || []);
      setLoading(false);
    };
    load();
  }, [hasAccess, isNew, guideId, router]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  // ── Block helpers ──────────────────────────────────────────────────────────
  const addBlock = (type: GuideBlock["type"]) => {
    const base = { id: newBlockId() };
    const block: GuideBlock =
      type === "heading" ? { ...base, type: "heading", level: 2, text: "" } :
      type === "paragraph" ? { ...base, type: "paragraph", html: "" } :
      type === "image" ? { ...base, type: "image", url: "", caption: "" } :
      { ...base, type: "link", url: "", label: "" };
    setBlocks((prev) => [...prev, block]);
  };

  const updateBlock = (id: string, patch: Partial<GuideBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as GuideBlock) : b)));
  };

  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id));

  const moveBlock = (index: number, direction: -1 | 1) => {
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleImageBlockUpload = async (blockId: string, file: File) => {
    if (!file.type.startsWith("image/")) { showToast("error", "Solo se admiten imágenes"); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("error", "Máximo 8MB por imagen"); return; }
    setUploadingBlockId(blockId);
    try {
      const path = `guides/${docIdRef.current}/${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      updateBlock(blockId, { url } as Partial<GuideBlock>);
    } catch {
      showToast("error", "Error al subir la imagen");
    } finally {
      setUploadingBlockId(null);
    }
  };

  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) { showToast("error", "Solo se admiten imágenes"); return; }
    if (file.size > 8 * 1024 * 1024) { showToast("error", "Máximo 8MB"); return; }
    setUploadingCover(true);
    try {
      const path = `guides/${docIdRef.current}/cover-${Date.now()}-${file.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      setCoverImageUrl(url);
    } catch {
      showToast("error", "Error al subir la portada");
    } finally {
      setUploadingCover(false);
    }
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async (publishOverride?: boolean) => {
    if (!title.trim()) { showToast("error", "El título es obligatorio"); return; }
    setSaving(true);
    try {
      let finalSlug = slugify(slug || title);
      if (!finalSlug) finalSlug = docIdRef.current.slice(0, 8);

      const dupSnap = await getDocs(query(collection(db, "guides"), where("slug", "==", finalSlug)));
      const collides = dupSnap.docs.some((d) => d.id !== docIdRef.current);
      if (collides) finalSlug = `${finalSlug}-${docIdRef.current.slice(0, 5)}`;

      const nextPublished = publishOverride ?? published;

      // Sanea el HTML de los bloques de párrafo antes de persistir
      const cleanBlocks = blocks.map((b) =>
        b.type === "paragraph" ? { ...b, html: sanitizeInlineHtml(b.html) } : b
      );

      await setDoc(
        doc(db, "guides", docIdRef.current),
        {
          title: title.trim(),
          slug: finalSlug,
          summary: summary.trim(),
          category,
          coverImageUrl,
          blocks: cleanBlocks,
          published: nextPublished,
          views: existing?.views || 0,
          createdAt: existing?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: existing?.createdBy || contextUser?.uid || "",
          createdByName: existing?.createdByName || contextUser?.name || contextUser?.email || "Admin",
        },
        { merge: true }
      );

      setSlug(finalSlug);
      setPublished(nextPublished);
      showToast("success", isNew ? "Guía creada" : "Guía guardada");
      if (isNew) router.replace(`/admindashboard/guides/${docIdRef.current}`);
    } catch (error) {
      console.error(error);
      showToast("error", "Error al guardar la guía");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/guias/${slug}`;
    navigator.clipboard.writeText(url);
    showToast("success", "Link copiado");
  };

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
      {toast && (
        <div className="fixed bottom-4 left-4 z-50">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg ${toast.type === "success" ? "bg-emerald-600" : "bg-red-600"} text-white`}>
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="mt-[53px] sticky top-[53px] z-30 bg-white border-b border-slate-200">
        <div className="px-8 h-16 flex items-center justify-between">
          <Link href="/admindashboard/guides" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft size={16} />
            Guías
          </Link>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button onClick={copyLink} className="flex items-center gap-2 px-3.5 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50">
                <Copy size={14} />
                Copiar link
              </button>
            )}
            <button
              onClick={() => handleSave(!published)}
              disabled={saving}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                published ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {published ? <EyeOff size={14} /> : <Eye size={14} />}
              {published ? "Pasar a borrador" : "Publicar"}
            </button>
            <button
              onClick={() => handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Guardar
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 grid grid-cols-3 gap-8">
        {/* ── Main canvas ── */}
        <div className="col-span-2 space-y-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la guía"
            className="w-full text-3xl font-bold text-slate-900 placeholder:text-slate-300 outline-none border-none px-0"
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Resumen corto (aparece en el listado)"
            rows={2}
            className="w-full text-sm text-slate-500 placeholder:text-slate-300 outline-none border-none px-0 resize-none"
          />

          <div className="border-t border-slate-100 pt-6 space-y-4">
            {blocks.map((block, index) => (
              <BlockEditor
                key={block.id}
                block={block}
                index={index}
                total={blocks.length}
                uploading={uploadingBlockId === block.id}
                onChange={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
                onMove={(dir) => moveBlock(index, dir)}
                onUploadImage={(file) => handleImageBlockUpload(block.id, file)}
              />
            ))}

            {blocks.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8 border-2 border-dashed border-slate-200 rounded-2xl">
                Añade el primer bloque de contenido
              </p>
            )}

            {/* Add block toolbar */}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={() => addBlock("heading")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
                <Heading2 size={13} /> Título
              </button>
              <button onClick={() => addBlock("paragraph")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
                <Type size={13} /> Texto
              </button>
              <button onClick={() => addBlock("image")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
                <ImageIcon size={13} /> Imagen
              </button>
              <button onClick={() => addBlock("link")} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50">
                <Link2 size={13} /> Enlace
              </button>
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Categoría</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as GuideCategory)}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900"
            >
              {GUIDE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Slug (URL)</label>
            <input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.replace(/[^a-z0-9-]/g, "")); }}
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-slate-900"
            />
            <p className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">/guias/{slug || "..."}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Portada</label>
            {coverImageUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverImageUrl} alt="Portada" className="w-full h-32 object-cover" />
                <button
                  onClick={() => setCoverImageUrl("")}
                  className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-lg hover:bg-black/80"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1.5 h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-300 text-slate-400">
                {uploadingCover ? <Loader2 size={18} className="animate-spin" /> : <ImageIcon size={18} />}
                <span className="text-xs">{uploadingCover ? "Subiendo..." : "Subir imagen"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f); }}
                />
              </label>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400 space-y-1">
            <p>Estado: <span className={published ? "text-emerald-600 font-medium" : "text-slate-500 font-medium"}>{published ? "Publicada" : "Borrador"}</span></p>
            {existing && <p>Vistas: <span className="font-mono">{existing.views || 0}</span></p>}
            {existing?.createdByName && <p>Autor: {existing.createdByName}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Block editor ──────────────────────────────────────────────────────────────

function BlockEditor({
  block,
  index,
  total,
  uploading,
  onChange,
  onRemove,
  onMove,
  onUploadImage,
}: {
  block: GuideBlock;
  index: number;
  total: number;
  uploading: boolean;
  onChange: (patch: Partial<GuideBlock>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onUploadImage: (file: File) => void;
}) {
  const editableRef = useRef<HTMLDivElement>(null);

  const exec = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  return (
    <div className="group relative border border-transparent hover:border-slate-200 rounded-xl p-3 -mx-3 transition-colors">
      {/* Block controls */}
      <div className="absolute -left-1 top-3 -translate-x-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5 pr-2">
        <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30">▲</button>
        <button onClick={() => onMove(1)} disabled={index === total - 1} className="p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30">▼</button>
      </div>
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 p-1.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 size={13} />
      </button>

      {block.type === "heading" && (
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1 pt-1.5">
            <button
              onClick={() => onChange({ level: 2 } as Partial<GuideBlock>)}
              className={`p-1 rounded ${block.level === 2 ? "text-slate-900" : "text-slate-300 hover:text-slate-500"}`}
            >
              <Heading2 size={14} />
            </button>
            <button
              onClick={() => onChange({ level: 3 } as Partial<GuideBlock>)}
              className={`p-1 rounded ${block.level === 3 ? "text-slate-900" : "text-slate-300 hover:text-slate-500"}`}
            >
              <Heading3 size={14} />
            </button>
          </div>
          <input
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value } as Partial<GuideBlock>)}
            placeholder={block.level === 2 ? "Título de sección" : "Subtítulo"}
            className={`flex-1 outline-none border-none placeholder:text-slate-300 ${block.level === 2 ? "text-2xl font-bold" : "text-lg font-semibold"} text-slate-900`}
          />
        </div>
      )}

      {block.type === "paragraph" && (
        <div>
          <div className="flex items-center gap-1 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onMouseDown={(e) => { e.preventDefault(); exec("bold"); }} className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50"><Bold size={12} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); exec("italic"); }} className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50"><Italic size={12} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); exec("underline"); }} className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50"><UnderlineIcon size={12} /></button>
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                const url = window.prompt("URL del enlace");
                if (url) exec("createLink", url);
              }}
              className="p-1.5 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50"
            >
              <Link2 size={12} />
            </button>
          </div>
          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => onChange({ html: e.currentTarget.innerHTML } as Partial<GuideBlock>)}
            dangerouslySetInnerHTML={{ __html: block.html }}
            data-placeholder="Escribe el texto..."
            className="min-h-[2.5rem] text-sm text-slate-700 leading-relaxed outline-none [&_a]:text-blue-600 [&_a]:underline empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300"
          />
        </div>
      )}

      {block.type === "image" && (
        <div>
          {block.url ? (
            <div className="rounded-xl overflow-hidden border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={block.url} alt={block.caption || ""} className="w-full max-h-[420px] object-contain bg-slate-50" />
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-1.5 h-40 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-300 text-slate-400">
              {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
              <span className="text-xs">{uploading ? "Subiendo..." : "Subir captura de pantalla"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); }}
              />
            </label>
          )}
          <input
            value={block.caption}
            onChange={(e) => onChange({ caption: e.target.value } as Partial<GuideBlock>)}
            placeholder="Pie de foto (opcional)"
            className="w-full mt-2 text-xs text-slate-500 placeholder:text-slate-300 outline-none border-none px-0 text-center"
          />
        </div>
      )}

      {block.type === "link" && (
        <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl">
          <input
            value={block.label}
            onChange={(e) => onChange({ label: e.target.value } as Partial<GuideBlock>)}
            placeholder="Texto del botón"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none bg-white"
          />
          <input
            value={block.url}
            onChange={(e) => onChange({ url: e.target.value } as Partial<GuideBlock>)}
            placeholder="https://..."
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono outline-none bg-white"
          />
        </div>
      )}
    </div>
  );
}
