"use client";

// Enviar por email una factura o un presupuesto emitido, con su PDF adjunto.
import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Textarea } from "@/components/ds";
import { adminFetch } from "@/components/admin/ui";
import { docPdfBase64, type DocView } from "@/lib/billingPdf";

export function SendDocModal({ open, onClose, type, id, view, defaultTo, onSent }: {
  open: boolean; onClose: () => void; type: "invoice" | "quote"; id: string; view: DocView; defaultTo: string; onSent: (to: string) => void;
}) {
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setTo(defaultTo); setMessage(""); setError(""); } }, [open, defaultTo]);

  const send = async () => {
    setBusy(true); setError("");
    try {
      const pdfBase64 = await docPdfBase64(view);
      await adminFetch("/api/admin/billing/send", { type, id, to, message, pdfBase64 });
      onSent(to);
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Enviar ${view.number}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={send} disabled={busy || !to.trim()}>{busy ? "Enviando…" : "Enviar con el PDF"}</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Para" hint="Varios emails separados por comas."><Input value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></Field>
        <Field label="Mensaje" hint="Opcional. Va encima de los datos del documento."><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
