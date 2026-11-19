"use client";

// Datos fiscales de Filma (emisor de las facturas y presupuestos), cuenta
// bancaria, series de numeración y valores por defecto.

import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button, Field, Input, Modal, Textarea } from "@/components/ds";
import { BillingSettings } from "@/lib/billing";

export function BillingSettingsModal({ open, onClose, settings, onSaved }: { open: boolean; onClose: () => void; settings: BillingSettings; onSaved: (s: BillingSettings) => void }) {
  const [f, setF] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setF(settings); setError(""); } }, [open, settings]);
  const t = (k: keyof BillingSettings) => ({ value: String(f[k] ?? ""), onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }) });
  const n = (k: keyof BillingSettings) => ({ value: String(f[k] ?? ""), inputMode: "decimal" as const, onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: Number(e.target.value.replace(",", ".")) || 0 }) });

  const save = async () => {
    setSaving(true); setError("");
    try {
      const clean = { ...f, taxId: f.taxId.trim().toUpperCase(), iban: f.iban.replace(/\s+/g, "").toUpperCase(), invoicePrefix: f.invoicePrefix.trim() || "F", rectifyingPrefix: f.rectifyingPrefix.trim() || "R", quotePrefix: f.quotePrefix.trim() || "P" };
      if (new Set([clean.invoicePrefix, clean.rectifyingPrefix, clean.quotePrefix]).size < 3) throw new Error("Las tres series tienen que ser distintas");
      await setDoc(doc(db, "adminConfig", "billing"), { ...clean, updatedAt: serverTimestamp() });
      onSaved(clean);
      onClose();
    } catch (e) { setError((e as Error).message || "No se pudo guardar"); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Datos fiscales de Filma" width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button></>}>
      <div className="flex flex-col gap-5">
        <p className="text-xs text-slate-500">Aparecen como emisor en las facturas y presupuestos. Al emitir un documento se copian en él, así que cambiarlos no altera lo ya emitido.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Razón social" className="col-span-2"><Input {...t("name")} placeholder="Filma Workspace S.L." /></Field>
          <Field label="NIF / CIF"><Input {...t("taxId")} className="font-mono" /></Field>
          <Field label="Email de facturación"><Input {...t("email")} /></Field>
          <Field label="Dirección fiscal" className="col-span-2"><Input {...t("address")} /></Field>
          <div className="col-span-2 grid grid-cols-[110px_1fr_1fr_1fr] gap-3">
            <Field label="C. P."><Input {...t("postalCode")} /></Field>
            <Field label="Ciudad"><Input {...t("city")} /></Field>
            <Field label="Provincia"><Input {...t("province")} /></Field>
            <Field label="País"><Input {...t("country")} /></Field>
          </div>
          <Field label="Teléfono"><Input {...t("phone")} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_200px] gap-3 border-t border-slate-100 pt-4">
          <Field label="IBAN para los cobros"><Input {...t("iban")} className="font-mono" placeholder="ES00 0000 0000 0000 0000 0000" /></Field>
          <Field label="Banco"><Input {...t("bank")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
          <Field label="Serie de facturas" hint="F2026-0001"><Input {...t("invoicePrefix")} className="font-mono" /></Field>
          <Field label="Serie de rectificativas" hint="R2026-0001"><Input {...t("rectifyingPrefix")} className="font-mono" /></Field>
          <Field label="Serie de presupuestos" hint="P2026-0001"><Input {...t("quotePrefix")} className="font-mono" /></Field>
          <Field label="IVA por defecto (%)"><Input {...n("defaultVat")} /></Field>
          <Field label="Pago a (días)"><Input {...n("paymentDays")} /></Field>
          <Field label="Validez presupuesto (días)"><Input {...n("quoteValidityDays")} /></Field>
          <Field label="Cuota mensual por proyecto (€)" hint="Se propone al crear un presupuesto"><Input {...n("monthlyPrice")} /></Field>
        </div>
        <Field label="Condiciones de los presupuestos"><Textarea rows={3} {...t("quoteConditions")} /></Field>
        <Field label="Pie de página" hint="Opcional. Si lo dejas vacío: razón social, NIF y dirección."><Input {...t("footer")} placeholder="Inscrita en el Registro Mercantil de…" /></Field>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
