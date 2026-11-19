"use client";

// Confirmación de acciones delicadas del admin, con contraseña (el servidor
// exige una autenticación reciente) y motivo opcional.
import { useEffect, useState } from "react";
import { ActionModal } from "@/components/accounting/ActionModal";
import { confirmPassword } from "@/lib/admin/reauth";
import { auth } from "@/lib/firebase";

export function ConfirmModal({
  open, onClose, title, notice, confirmLabel, danger = true, password = true, reason, onConfirm, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  notice?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  password?: boolean;
  /** Pide un motivo (queda en la auditoría). */
  reason?: { label: string; placeholder?: string; required?: boolean };
  onConfirm: (reason: string) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [pw, setPw] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPw(""); setWhy(""); setError(""); setBusy(false); } }, [open]);

  const run = async () => {
    setBusy(true); setError("");
    try {
      if (password) await confirmPassword(pw);
      await onConfirm(why.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message || "No se pudo completar");
    } finally { setBusy(false); }
  };

  return (
    <ActionModal
      open={open}
      onClose={onClose}
      title={title}
      notice={notice}
      danger={danger}
      confirmLabel={confirmLabel}
      processing={busy}
      onConfirm={run}
      reason={reason ? { label: reason.label, placeholder: reason.placeholder, required: reason.required ?? false, value: why, onChange: setWhy, rows: 2 } : undefined}
      password={password ? { value: pw, onChange: (v) => { setPw(v); setError(""); }, error, email: auth.currentUser?.email || undefined } : undefined}
    >
      {children}
      {!password && error && <p className="text-xs text-red-700">{error}</p>}
    </ActionModal>
  );
}
