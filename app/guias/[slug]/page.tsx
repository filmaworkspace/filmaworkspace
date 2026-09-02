"use client";

// ─── Framework ────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { inter } from "@/lib/fonts";

// ─── Firebase ────────────────────────────────────────────────────────────────
import { db } from "@/lib/firebase";
import { collection, doc, getDocs, increment, query, updateDoc, where } from "firebase/firestore";

// ─── Icons ───────────────────────────────────────────────────────────────────
import { ArrowRight, BookOpen, ExternalLink } from "lucide-react";

// ─── Internal ────────────────────────────────────────────────────────────────
import { Guide } from "@/lib/guides";

// ─────────────────────────────────────────────────────────────────────────────

export default function GuidePublicPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const [guide, setGuide] = useState<Guide | null>(null);
  const [status, setStatus] = useState<"loading" | "found" | "not-found">("loading");

  useEffect(() => {
    if (!slug) return;
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, "guides"), where("slug", "==", slug)));
        if (snap.empty) { setStatus("not-found"); return; }
        const d = snap.docs[0];
        const data = { id: d.id, ...d.data() } as Guide;
        if (!data.published) { setStatus("not-found"); return; }
        setGuide(data);
        setStatus("found");
        updateDoc(doc(db, "guides", d.id), { views: increment(1) }).catch(() => {});
      } catch {
        setStatus("not-found");
      }
    };
    load();
  }, [slug]);

  if (status === "loading") {
    return (
      <div className={`min-h-screen bg-white flex items-center justify-center ${inter.className}`}>
        <div className="w-10 h-10 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "not-found" || !guide) {
    return (
      <div className={`min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6 text-center ${inter.className}`}>
        <BookOpen size={32} className="text-slate-300" />
        <h1 className="text-xl font-bold text-slate-900">Guía no encontrada</h1>
        <p className="text-sm text-slate-500 max-w-sm">Puede que el link haya caducado o la guía ya no esté publicada.</p>
        <Link href="/" className="text-sm font-medium hover:opacity-80" style={{ color: "#2F52E0" }}>
          Ir a Filma Workspace
        </Link>
      </div>
    );
  }

  const formatDate = (ts: Guide["updatedAt"]) =>
    ts && typeof (ts as any).toDate === "function"
      ? (ts as any).toDate().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
      : "";

  return (
    <div className={`min-h-screen bg-white ${inter.className}`}>
      {/* ── Minimal nav ── */}
      <header className="border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center">
            <Image src="/logodark.svg" alt="Filma Workspace" width={110} height={26} priority />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Iniciar sesión
            <ArrowRight size={14} />
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <span className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-lg mb-4" style={{ backgroundColor: "#EFF2FF", color: "#2F52E0" }}>
          {guide.category}
        </span>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">{guide.title}</h1>
        {guide.summary && <p className="mt-4 text-lg text-slate-500 leading-relaxed">{guide.summary}</p>}
        {formatDate(guide.updatedAt) && (
          <p className="mt-4 text-xs text-slate-400">Actualizado el {formatDate(guide.updatedAt)}</p>
        )}

        {guide.coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={guide.coverImageUrl} alt={guide.title} className="w-full rounded-2xl mt-8 border border-slate-100" />
        )}

        <article className="mt-10 space-y-6">
          {guide.blocks.map((block) => {
            if (block.type === "heading") {
              return block.level === 2 ? (
                <h2 key={block.id} className="text-2xl font-bold text-slate-900 pt-2">{block.text}</h2>
              ) : (
                <h3 key={block.id} className="text-lg font-semibold text-slate-900 pt-1">{block.text}</h3>
              );
            }
            if (block.type === "paragraph") {
              return (
                <div
                  key={block.id}
                  className="text-[15px] text-slate-700 leading-relaxed [&_a]:text-blue-600 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: block.html }}
                />
              );
            }
            if (block.type === "image") {
              return (
                <figure key={block.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={block.url} alt={block.caption || guide.title} className="w-full rounded-xl border border-slate-100" />
                  {block.caption && <figcaption className="text-xs text-slate-400 text-center mt-2">{block.caption}</figcaption>}
                </figure>
              );
            }
            if (block.type === "link") {
              return (
                <a
                  key={block.id}
                  href={block.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: "#2F52E0" }}
                >
                  {block.label || block.url}
                  <ExternalLink size={14} />
                </a>
              );
            }
            return null;
          })}
        </article>
      </main>

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} Filma Workspace
      </footer>
    </div>
  );
}
