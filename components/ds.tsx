"use client";

// ─── Sistema de diseño de Filma (ds) ─────────────────────────────────────────
// Piezas comunes para las páginas internas: minimalistas y técnicas. Texto
// pequeño y denso, grises suaves, sin iconos decorativos, el color solo para
// estados y para los módulos. Se empieza por Configuración y se irá llevando
// a Contabilidad y Equipo.
//
//   <Page>            contenedor (deja sitio al header fijo)
//   <PageHeader>      título + acciones (sin subtítulo)
//   <Section>         bloque con título a la izquierda y contenido a la derecha
//   <Button>          primary | secondary | ghost | danger, tamaños sm | md
//   <IconButton>      botón de solo icono
//   <Field> + Input / Select / Textarea
//   <Badge>           etiqueta pequeña (neutral | success | warning | danger | info)
//   <Table>, <Th>, <Td>, <Tr>
//   <DataList>        pares etiqueta/valor (vista de solo lectura)
//   <Modal>           diálogo pequeño
//   <Menu>            menú desplegable con cierre al hacer clic fuera / Escape
//   <EmptyState>
//   useToast()        avisos breves abajo a la izquierda

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { inter } from "@/lib/fonts";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ─── Tokens ──────────────────────────────────────────────────────────────────
export const tokens = {
  text: "text-slate-900",
  muted: "text-slate-500",
  subtle: "text-slate-400",
  border: "border-slate-200",
  surface: "bg-[#F7F7F8]",
  module: { accounting: "#2F52E0", team: "#6BA319" },
} as const;

// ─── Página ──────────────────────────────────────────────────────────────────
export function Page({ children, width = "" }: { children: React.ReactNode; width?: string }) {
  return (
    <div className={cx("min-h-screen bg-white", inter.className)}>
      <main className={cx("mx-auto px-6 pb-24 pt-[85px] sm:px-10", width)}>{children}</main>
    </div>
  );
}

export function PageHeader({ title, actions }: { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-[44px] flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Bloque de ajustes: título (y acción) a la izquierda, contenido a la derecha. */
export function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("grid gap-4 border-b border-slate-100 py-7 last:border-0 md:grid-cols-[200px_1fr] md:gap-10", className)}>
      <div className="flex items-start justify-between gap-3 md:block">
        <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
        {action && <div className="md:mt-3">{action}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// ─── Botones ─────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-[13px]",
};
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-[#E4E4E7] bg-[#F1F1F3] text-slate-900 hover:bg-[#E8E8EB]",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900",
  ghost: "text-slate-500 hover:bg-[#F4F4F5] hover:text-slate-900",
  danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return cx(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant]);
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cx(buttonClass(variant, size), className)} {...rest}>
      {loading && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ label, className, children, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cx(
          "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#F4F4F5] hover:text-slate-900 disabled:opacity-50",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

// ─── Formularios ─────────────────────────────────────────────────────────────
const CONTROL =
  "w-full rounded-md border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 transition " +
  "focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/10 disabled:bg-[#F7F7F8] disabled:text-slate-500";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL, "h-8 px-2.5", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(CONTROL, "resize-none px-2.5 py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cx(CONTROL, "h-8 appearance-none pl-2.5 pr-8", className)} {...rest}>
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
});

/** Grupo de opciones excluyentes (p. ej. Película / Serie). */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-[#F7F7F8] p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "h-7 rounded-[5px] px-3 text-xs transition-colors",
            value === o.value ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-slate-300 accent-slate-900" />
      <span>
        <span className="block text-[13px] text-slate-900">{label}</span>
        {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

// ─── Datos ───────────────────────────────────────────────────────────────────
type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-[#F7F7F8] text-slate-600",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
};

export function Badge({ tone = "neutral", dot, children }: { tone?: BadgeTone; dot?: string; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium leading-none", BADGE_TONES[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />}
      {children}
    </span>
  );
}

/** Valores de solo lectura en rejilla: etiqueta pequeña arriba, valor debajo. */
export function DataList({ items, columns = 3 }: { items: { label: string; value?: React.ReactNode }[]; columns?: 2 | 3 | 4 }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <dl className={cx("grid gap-x-8 gap-y-5", cols)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs text-slate-500">{it.label}</dt>
          <dd className="mt-1 truncate text-[13px] text-slate-900 tabular-nums">
            {it.value === undefined || it.value === null || it.value === "" ? <span className="text-slate-300">—</span> : it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-slate-200", className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}
export function Th({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <th className={cx("h-8 border-b border-slate-200 bg-[#F7F7F8] px-3 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500", align === "right" ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}
export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cx("border-b border-slate-100 last:border-0 hover:bg-[#FAFAFA]", className)}>{children}</tr>;
}
export function Td({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" }) {
  return <td className={cx("h-11 px-3 align-middle text-slate-700", align === "right" ? "text-right" : "text-left", className)}>{children}</td>;
}

export function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center">
      <p className="text-[13px] text-slate-500">{title}</p>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700", className)} />;
}

export function PageLoading() {
  return (
    <div className={cx("flex min-h-screen items-center justify-center bg-white", inter.className)}>
      <Spinner className="h-7 w-7" />
    </div>
  );
}

// ─── Capas: modal y menú ─────────────────────────────────────────────────────
function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, onClose, ref]);
}

export function Modal({
  open, onClose, title, children, footer, width = "max-w-md",
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(open, onClose, panel);
  if (!open) return null;
  return (
    <div className={cx("fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]", inter.className)}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className={cx("flex max-h-[85vh] w-full flex-col rounded-xl border border-slate-200 bg-white shadow-xl", width)}>
        <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-slate-100 pl-5 pr-3">
          <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
          <IconButton label="Cerrar" onClick={onClose}><X size={15} /></IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Menú desplegable. `trigger` recibe la función para abrir/cerrar. */
export function Menu({ trigger, children, align = "right" }: {
  trigger: (toggle: () => void, open: boolean) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div className={cx("absolute top-full z-50 mt-1 min-w-[180px] rounded-lg border border-slate-200 bg-white p-1 shadow-lg", align === "right" ? "right-0" : "left-0")}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-[#F4F4F5] hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 border-t border-slate-100" />;

// ─── Avisos ──────────────────────────────────────────────────────────────────
type ToastState = { type: "success" | "error"; message: string } | null;

/** Devuelve [elemento a pintar, función para mostrar un aviso]. */
export function useToast(): [React.ReactNode, (type: "success" | "error", message: string) => void] {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  const node = toast ? (
    <div
      role="status"
      className={cx(
        "fixed bottom-5 left-5 z-[70] flex h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium text-white shadow-lg",
        toast.type === "success" ? "bg-slate-900" : "bg-red-600",
        inter.className,
      )}
    >
      {toast.message}
    </div>
  ) : null;
  return [node, show];
}

/** Pantalla de "sin acceso". */
export function NoAccess({ backHref = "/dashboard" }: { backHref?: string }) {
  return (
    <div className={cx("flex min-h-screen items-center justify-center bg-white px-6", inter.className)}>
      <div className="text-center">
        <p className="text-[15px] font-semibold text-slate-900">Sin acceso</p>
        <p className="mt-1 text-[13px] text-slate-500">No tienes permiso para ver esta configuración.</p>
        <a href={backHref} className={cx(buttonClass("primary"), "mt-5")}>Volver a proyectos</a>
      </div>
    </div>
  );
}
