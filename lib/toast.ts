// ─── Avisos de Filma ─────────────────────────────────────────────────────────
// Un solo sistema para toda la app (ver components/Toaster):
//   toast.success("PO-0012 enviada a aprobación", { action: { label: "Ver", onClick } })
//   toast.error(err)                 // acepta un Error: lo traduce a texto claro
//   toast.warning("Factura guardada sin adjunto")
//   toast.info("Presupuesto recalculado")
//   const t = toast.loading("Generando ZIP…"); … t.success("ZIP listo") / t.error(e)
//   await toast.promise(tarea, { loading, success, error })
// Tarjeta blanca abajo en el centro, una línea, máximo tres; el mismo aviso
// repetido no se duplica (×2). Duración: hecho 3 s, aviso/info 5 s, error 8 s
// (no se cierra con el ratón encima); "en curso" hasta que termina.

export type ToastKind = "success" | "error" | "warning" | "info" | "loading";
export interface ToastAction { label: string; onClick: () => void }
export interface ToastItem { id: number; kind: ToastKind; message: string; action?: ToastAction; count: number; duration: number; createdAt: number }

const DURATION: Record<ToastKind, number> = { success: 3000, warning: 5000, info: 5000, error: 8000, loading: 0 };
const MAX = 3;

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(items));

export function subscribeToasts(l: Listener) { listeners.add(l); l(items); return () => { listeners.delete(l); }; }

/** Texto claro a partir de un error (nunca el mensaje técnico crudo). */
export function errorText(e: unknown, fallback = "No se ha podido completar"): string {
  if (!e) return fallback;
  if (typeof e === "string") return e;
  const err = e as { code?: string; message?: string };
  const code = String(err.code || "").replace(/^firestore\/|^storage\/|^auth\//, "");
  const MAP: Record<string, string> = {
    "permission-denied": "No tienes permiso para hacer esto",
    unauthorized: "No tienes permiso para hacer esto",
    unauthenticated: "Tu sesión ha caducado. Vuelve a entrar",
    "not-found": "El documento ya no existe",
    "object-not-found": "El archivo ya no existe",
    unavailable: "Sin conexión. Inténtalo de nuevo",
    "deadline-exceeded": "La operación ha tardado demasiado. Inténtalo de nuevo",
    "resource-exhausted": "Demasiadas operaciones seguidas. Espera un momento",
    "already-exists": "Ya existe",
    "failed-precondition": "No se puede hacer en el estado actual",
    aborted: "Otra persona lo ha cambiado a la vez. Vuelve a intentarlo",
    "wrong-password": "Contraseña incorrecta",
    "invalid-credential": "Contraseña incorrecta",
    "too-many-requests": "Demasiados intentos. Espera un momento",
    "network-request-failed": "Sin conexión. Inténtalo de nuevo",
    "quota-exceeded": "Se ha superado el espacio disponible",
    canceled: "Se ha cancelado",
  };
  if (MAP[code]) return MAP[code];
  const msg = String(err.message || "");
  // Mensajes propios ya escritos para personas (sin prefijos técnicos).
  if (msg && !/firebase|firestore|error \(|\bat \w|undefined|null|exception|typeerror|status code/i.test(msg) && msg.length < 140) return msg;
  return fallback;
}

function push(kind: ToastKind, message: string, opts: { action?: ToastAction; duration?: number } = {}): number {
  const dup = items.find((t) => t.kind === kind && t.message === message);
  if (dup) {
    items = items.map((t) => (t === dup ? { ...t, count: t.count + 1, createdAt: Date.now() } : t));
    emit();
    return dup.id;
  }
  const t: ToastItem = { id: ++seq, kind, message, action: opts.action, count: 1, duration: opts.duration ?? DURATION[kind], createdAt: Date.now() };
  items = [...items, t].slice(-MAX);
  emit();
  return t.id;
}

export function dismissToast(id: number) { items = items.filter((t) => t.id !== id); emit(); }

function update(id: number, kind: ToastKind, message: string, opts: { action?: ToastAction } = {}) {
  if (!items.some((t) => t.id === id)) return push(kind, message, opts);
  items = items.map((t) => (t.id === id ? { ...t, kind, message, action: opts.action, duration: DURATION[kind], createdAt: Date.now() } : t));
  emit();
  return id;
}

type Opts = { action?: ToastAction; duration?: number };
export const toast = {
  success: (m: string, o?: Opts) => push("success", m, o),
  warning: (m: string, o?: Opts) => push("warning", m, o),
  info: (m: string, o?: Opts) => push("info", m, o),
  error: (e: unknown, o?: Opts & { fallback?: string }) => push("error", errorText(e, o?.fallback), o),
  /** Aviso "en curso" que luego se convierte en hecho o error. */
  loading: (m: string) => {
    const id = push("loading", m);
    return {
      id,
      success: (msg: string, o?: { action?: ToastAction }) => update(id, "success", msg, o),
      error: (e: unknown, fallback?: string) => update(id, "error", errorText(e, fallback)),
      info: (msg: string) => update(id, "info", msg),
      dismiss: () => dismissToast(id),
    };
  },
  async promise<T>(p: Promise<T> | (() => Promise<T>), m: { loading: string; success: string | ((v: T) => string); error?: string }) {
    const t = toast.loading(m.loading);
    try {
      const v = await (typeof p === "function" ? p() : p);
      t.success(typeof m.success === "function" ? m.success(v) : m.success);
      return v;
    } catch (e) {
      t.error(e, m.error);
      throw e;
    }
  },
  dismiss: dismissToast,
};

// ─── Confirmación (sustituye a window.confirm) ───────────────────────────────
export interface ConfirmRequest { id: number; title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
let confirmReq: ConfirmRequest | null = null;
const confirmListeners = new Set<(r: ConfirmRequest | null) => void>();
export function subscribeConfirm(l: (r: ConfirmRequest | null) => void) { confirmListeners.add(l); l(confirmReq); return () => { confirmListeners.delete(l); }; }
function setConfirm(r: ConfirmRequest | null) { confirmReq = r; confirmListeners.forEach((l) => l(r)); }

/** `if (!(await confirmDialog({ title: "¿Eliminar el borrador?", danger: true }))) return;` */
export function confirmDialog(o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq?.resolve(false);
    setConfirm({ id: ++seq, ...o, resolve: (ok) => { setConfirm(null); resolve(ok); } });
  });
}
