"use client";

// Autoguardado de formularios (crear/editar POs y facturas).
//
//  · Guarda en este navegador mientras se escribe (con una pequeña espera),
//    y también al cambiar de pestaña, cerrar o salir de la página.
//  · Al volver a abrir el formulario lo recupera solo y lo avisa, con opción
//    de descartarlo. Al editar un documento solo se recupera si es más nuevo
//    que la última versión guardada del documento.
//  · Al guardar de verdad (enviar / guardar borrador) se borra.
//
// Antes, en la PO nueva, abrir la página con el formulario vacío borraba a
// los segundos lo autoguardado la vez anterior.

import { useCallback, useEffect, useRef, useState } from "react";

interface Stored<T> { v: 1; savedAt: string; value: T }

const read = <T,>(key: string): Stored<T> | null => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as Stored<T>) : null; } catch { return null; }
};
const write = (key: string, data: unknown) => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* lleno o bloqueado */ } };
const remove = (key: string) => { try { localStorage.removeItem(key); } catch { /* */ } };

export function useFormAutosave<T>({
  key, value, ready, isEmpty, onRestore, newerThan,
}: {
  /** Clave única (incluye usuario, proyecto y documento). null = desactivado. */
  key: string | null;
  value: T;
  /** Datos del formulario ya cargados (para no pisar ni restaurar antes de tiempo). */
  ready: boolean;
  isEmpty: (v: T) => boolean;
  onRestore: (v: T) => void;
  /** Solo restaurar si lo guardado es posterior a esta fecha (edición de un documento). */
  newerThan?: Date | null;
}) {
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const hydrated = useRef(false);
  const stopped = useRef(false);
  const lastJson = useRef<string>("");
  const pending = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const emptyRef = useRef(isEmpty);
  emptyRef.current = isEmpty;

  const flush = useCallback(() => {
    if (!key || stopped.current || !hydrated.current || pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (emptyRef.current(v)) { remove(key); return; }
    const now = new Date();
    write(key, { v: 1, savedAt: now.toISOString(), value: v } satisfies Stored<T>);
    setSavedAt(now);
  }, [key]);

  // 1) Al tener los datos: recuperar lo autoguardado (una vez).
  useEffect(() => {
    if (!key || !ready || hydrated.current) return;
    const s = read<T>(key);
    if (s && !emptyRef.current(s.value) && (!newerThan || new Date(s.savedAt) > newerThan)) {
      restoreRef.current(s.value);
      setRestoredAt(new Date(s.savedAt));
      lastJson.current = JSON.stringify(s.value);
    } else if (s && newerThan && new Date(s.savedAt) <= newerThan) {
      remove(key); // el documento ya es más nuevo
    }
    // Se marca después del render de la restauración para no guardar el estado vacío previo.
    setTimeout(() => { hydrated.current = true; }, 0);
  }, [key, ready, newerThan]);

  // 2) Guardar mientras se escribe (espera corta).
  useEffect(() => {
    if (!key || !hydrated.current || stopped.current) return;
    const json = JSON.stringify(value);
    if (json === lastJson.current) return;
    lastJson.current = json;
    pending.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }, [key, value, flush]);

  // 3) Salir, cerrar o cambiar de pestaña: guardar ya.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush(); // navegación dentro de la app
    };
  }, [flush]);

  /** Tras guardar de verdad: borrar y dejar de autoguardar. */
  const clear = useCallback(() => {
    stopped.current = true;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    if (key) remove(key);
    setRestoredAt(null);
  }, [key]);

  /** Descartar lo recuperado (quien llama vuelve a dejar el formulario como estaba). */
  const discard = useCallback(() => {
    if (key) remove(key);
    setRestoredAt(null);
    lastJson.current = "";
  }, [key]);

  return { restoredAt, savedAt, clear, discard };
}

/** Aviso compacto de recuperación / estado del autoguardado. */
export function autosaveLabel(savedAt: Date | null) {
  if (!savedAt) return "";
  const s = Math.round((Date.now() - savedAt.getTime()) / 1000);
  return s < 10 ? "Guardado automáticamente" : `Guardado automáticamente · ${savedAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
}
