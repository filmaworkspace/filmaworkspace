"use client";

// Portada de un proyecto: su foto, o el degradado de la marca si no tiene.
// Opcionalmente, con botones para cambiarla o quitarla (solo quien tiene
// permiso de configuración del proyecto).

import { useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { coverGradient, removeProjectCover, uploadProjectCover } from "@/lib/projectCover";

interface Props {
  projectId: string;
  coverUrl?: string | null;
  coverPath?: string | null;
  className?: string;
  /** Muestra los botones de cambiar/quitar portada al pasar el ratón. */
  editable?: boolean;
  /** Botones siempre visibles (no solo al pasar el ratón). */
  alwaysShowControls?: boolean;
  onChange?: (cover: { url: string | null; path: string | null }) => void;
  onError?: (message: string) => void;
  /** Si se indica, toda la portada enlaza aquí (los botones quedan por encima). */
  href?: string;
  /** Botones solo con icono (para tarjetas pequeñas). */
  compact?: boolean;
  children?: React.ReactNode;
}

export default function ProjectCover({
  projectId, coverUrl, coverPath, className = "", editable = false, alwaysShowControls = false, onChange, onError, href, compact = false, children,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url, path } = await uploadProjectCover(projectId, file, coverPath);
      onChange?.({ url, path });
    } catch (e: any) {
      onError?.(e?.message || "No se pudo subir la portada");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await removeProjectCover(projectId, coverPath);
      onChange?.({ url: null, path: null });
    } catch (e: any) {
      onError?.(e?.message || "No se pudo quitar la portada");
    } finally {
      setBusy(false);
    }
  };

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className={`group/cover relative overflow-hidden ${className}`}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div aria-hidden="true" className="absolute inset-0" style={{ background: coverGradient(projectId) }} />
      )}

      <div className="pointer-events-none absolute inset-0">{children}</div>

      {href && <Link href={href} className="absolute inset-0" aria-label="Abrir proyecto" />}

      {editable && (
        <div
          className={`absolute right-2.5 top-2.5 z-10 flex gap-1.5 transition-opacity ${
            alwaysShowControls || busy ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100 focus-within:opacity-100"
          }`}
        >
          <button
            type="button"
            onClick={(e) => { stop(e); inputRef.current?.click(); }}
            disabled={busy}
            aria-label={coverUrl ? "Cambiar portada" : "Añadir portada"}
            title={coverUrl ? "Cambiar portada" : "Añadir portada"}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/25 bg-black/30 text-xs font-medium text-white backdrop-blur-md transition hover:bg-black/45 disabled:opacity-70 ${compact ? "w-8" : "px-2.5"}`}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
            {!compact && (coverUrl ? "Cambiar portada" : "Añadir portada")}
          </button>
          {coverUrl && !busy && (
            <button
              type="button"
              onClick={(e) => { stop(e); handleRemove(); }}
              aria-label="Quitar portada"
              title="Quitar portada"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/25 bg-black/30 text-white backdrop-blur-md transition hover:bg-black/45"
            >
              <Trash2 size={13} />
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}
    </div>
  );
}
