"use client";

// ─── Modal de acción con confirmación ────────────────────────────────────────
// Cerrar, reabrir, anular, modificar o eliminar (POs, líneas, facturas…):
// aviso opcional, motivo opcional, contraseña opcional y botón de confirmar.

import { Button, Field, Input, Modal, Textarea } from "@/components/ds";

export function ActionModal({
  open, onClose, title, subtitle, notice, reason, password, confirmLabel, processingLabel,
  processing = false, danger = false, onConfirm, children, width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Aviso (lo que va a pasar con el presupuesto, importes…). */
  notice?: React.ReactNode;
  reason?: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; rows?: number };
  password?: { value: string; onChange: (v: string) => void; error?: string; email?: string };
  confirmLabel: string;
  processingLabel?: string;
  processing?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
  width?: string;
}) {
  const missing =
    (reason?.required !== false && reason && !reason.value.trim()) ||
    (password && !password.value.trim());
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={width}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={processing || !!missing}>
            {processing ? processingLabel || "Procesando…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {subtitle && <p className="-mt-1 text-[13px] text-slate-500">{subtitle}</p>}
        {notice && (
          <div className="rounded-md border border-amber-200 bg-[#FFFBEB] px-3 py-2.5 text-xs leading-relaxed text-amber-900">{notice}</div>
        )}
        {children}
        {reason && (
          <Field label={`${reason.label}${reason.required === false ? "" : ""}`}>
            <Textarea
              value={reason.value}
              onChange={(e) => reason.onChange(e.target.value)}
              placeholder={reason.placeholder}
              rows={reason.rows || 3}
            />
          </Field>
        )}
        {password && (
          <Field label="Confirma con tu contraseña" hint={password.email ? `Usuario: ${password.email}` : undefined}>
            <Input
              type="password"
              value={password.value}
              onChange={(e) => password.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !missing && !processing) onConfirm(); }}
              autoFocus
              className={password.error ? "border-red-300" : ""}
            />
            {password.error && <p className="mt-1.5 text-xs text-red-700">{password.error}</p>}
          </Field>
        )}
      </div>
    </Modal>
  );
}
